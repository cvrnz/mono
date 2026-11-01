use super::split::split_batches;
use super::{bytes, float, int, text, Cell, Column, Config, Info, Outcome, ResultSet, Table, MAX_ROWS};
use futures_util::TryStreamExt;
use std::sync::Arc;
use std::time::Duration;
use tiberius::{AuthMethod, Client, ColumnData, EncryptionLevel, FromSql, QueryItem};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::task::AbortHandle;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

type Conn = Client<Compat<TcpStream>>;

pub struct Ms {
    pub info: Info,
    config: tiberius::Config,
    client: Arc<Mutex<Option<Conn>>>,
    running: std::sync::Mutex<Option<AbortHandle>>,
}

const COLUMNS: &str = "
select c.COLUMN_NAME, c.DATA_TYPE,
  case when c.IS_NULLABLE = 'YES' then 1 else 0 end,
  case when exists (
    select 1 from INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    join INFORMATION_SCHEMA.KEY_COLUMN_USAGE k on k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME and k.TABLE_SCHEMA = tc.TABLE_SCHEMA
    where tc.CONSTRAINT_TYPE = 'PRIMARY KEY' and tc.TABLE_SCHEMA = c.TABLE_SCHEMA and tc.TABLE_NAME = c.TABLE_NAME
      and k.COLUMN_NAME = c.COLUMN_NAME) then 1 else 0 end
from INFORMATION_SCHEMA.COLUMNS c
where c.TABLE_SCHEMA = @P1 and c.TABLE_NAME = @P2
order by c.ORDINAL_POSITION";

fn err(e: tiberius::error::Error) -> String {
    match e {
        tiberius::error::Error::Server(t) => t.message().to_string(),
        other => other.to_string(),
    }
}

async fn connect(config: &tiberius::Config) -> Result<Conn, String> {
    let attempt = async {
        let tcp = TcpStream::connect(config.get_addr()).await.map_err(|e| e.to_string())?;
        tcp.set_nodelay(true).map_err(|e| e.to_string())?;
        Client::connect(config.clone(), tcp.compat_write()).await.map_err(err)
    };
    tokio::time::timeout(Duration::from_secs(15), attempt).await.map_err(|_| "timed out connecting".to_string())?
}

fn date<'a, T: FromSql<'a>>(data: &'a ColumnData<'static>, show: impl Fn(T) -> String) -> Cell {
    match T::from_sql(data) {
        Ok(Some(v)) => text(&show(v)),
        Ok(None) => Cell::Null,
        Err(e) => text(&e.to_string()),
    }
}

fn cell(data: &ColumnData<'static>) -> Cell {
    use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
    match data {
        ColumnData::U8(v) => v.map_or(Cell::Null, |n| int(n as i64)),
        ColumnData::I16(v) => v.map_or(Cell::Null, |n| int(n as i64)),
        ColumnData::I32(v) => v.map_or(Cell::Null, |n| int(n as i64)),
        ColumnData::I64(v) => v.map_or(Cell::Null, int),
        ColumnData::F32(v) => v.map_or(Cell::Null, |f| float(f as f64)),
        ColumnData::F64(v) => v.map_or(Cell::Null, float),
        ColumnData::Bit(v) => v.map_or(Cell::Null, Cell::Bool),
        ColumnData::String(v) => v.as_deref().map_or(Cell::Null, text),
        ColumnData::Guid(v) => v.map_or(Cell::Null, |g| text(&g.to_string())),
        ColumnData::Binary(v) => v.as_deref().map_or(Cell::Null, bytes),
        ColumnData::Numeric(v) => v.map_or(Cell::Null, |n| text(&n.to_string())),
        ColumnData::Xml(v) => v.as_deref().map_or(Cell::Null, |x| text(x.as_ref())),
        ColumnData::DateTime(_) | ColumnData::SmallDateTime(_) | ColumnData::DateTime2(_) => {
            date(data, |d: NaiveDateTime| d.format("%Y-%m-%d %H:%M:%S%.f").to_string())
        }
        ColumnData::Date(_) => date(data, |d: NaiveDate| d.to_string()),
        ColumnData::Time(_) => date(data, |t: NaiveTime| t.to_string()),
        ColumnData::DateTimeOffset(_) => date(data, |d: DateTime<FixedOffset>| d.to_rfc3339()),
    }
}

async fn run(conn: &mut Conn, sql: &str) -> Outcome {
    let mut results: Vec<ResultSet> = vec![];
    for batch in split_batches(sql) {
        let mut stream = match conn.simple_query(batch).await {
            Ok(s) => s,
            Err(e) => return Outcome::failed(results, err(e)),
        };
        let mut sets = 0;
        loop {
            match stream.try_next().await {
                Ok(Some(QueryItem::Metadata(meta))) => {
                    sets += 1;
                    results.push(ResultSet { columns: meta.columns().iter().map(|c| c.name().to_string()).collect(), ..Default::default() });
                }
                Ok(Some(QueryItem::Row(row))) => {
                    let Some(set) = results.last_mut() else { continue };
                    if set.rows.len() >= MAX_ROWS {
                        set.truncated = true;
                        continue;
                    }
                    set.rows.push(row.cells().map(|(_, d)| cell(d)).collect());
                }
                Ok(None) => break,
                Err(e) => return Outcome::failed(results, err(e)),
            }
        }
        if sets == 0 {
            results.push(ResultSet::default());
        }
    }
    Outcome { results, ..Default::default() }
}

impl Ms {
    pub async fn open(c: &Config) -> Result<Ms, String> {
        let mut config = tiberius::Config::new();
        config.host(c.host());
        config.port(c.port(1433));
        config.application_name("monomyth");
        if let Some(d) = c.database() {
            config.database(d);
        }
        let user = c.user().unwrap_or_default();
        if user.contains('\\') {
            return Err("signing in as DOMAIN\\user (Windows authentication) isn't supported; use a SQL Server login".into());
        }
        config.authentication(AuthMethod::sql_server(user, c.password().unwrap_or_default()));
        config.encryption(if c.ssl() { EncryptionLevel::Required } else { EncryptionLevel::NotSupported });
        if c.trust_cert.unwrap_or(true) {
            config.trust_cert();
        }
        let mut conn = connect(&config).await?;
        let row = conn
            .simple_query("select cast(SERVERPROPERTY('ProductVersion') as nvarchar(128)), DB_NAME(), SUSER_SNAME()")
            .await
            .map_err(err)?
            .into_row()
            .await
            .map_err(err)?
            .ok_or("the server didn't answer")?;
        let s = |i: usize| row.get::<&str, _>(i).unwrap_or("").to_string();
        let info = Info { engine: "mssql", version: s(0), database: s(1), user: s(2) };
        Ok(Ms { info, config, client: Arc::new(Mutex::new(Some(conn))), running: Default::default() })
    }

    pub async fn query(&self, sql: &str) -> Result<Outcome, String> {
        let client = self.client.clone();
        let sql = sql.to_string();
        let task = tokio::spawn(async move {
            let mut guard = client.lock().await;
            match guard.as_mut() {
                Some(conn) => Ok(run(conn, &sql).await),
                None => Err("the connection was lost".to_string()),
            }
        });
        *self.running.lock().unwrap() = Some(task.abort_handle());
        let done = task.await;
        self.running.lock().unwrap().take();
        match done {
            Ok(r) => r,
            Err(e) if e.is_cancelled() => {
                let fresh = connect(&self.config).await;
                let note = if fresh.is_ok() { "cancelled (the connection was opened again, so its settings and temporary tables are gone)" } else { "cancelled" };
                *self.client.lock().await = fresh.ok();
                Ok(Outcome::failed(vec![], note))
            }
            Err(e) => Err(e.to_string()),
        }
    }

    pub async fn cancel(&self) -> Result<(), String> {
        if let Some(h) = self.running.lock().unwrap().take() {
            h.abort();
        }
        Ok(())
    }

    async fn rows(&self, sql: &str, params: &[&str]) -> Result<Vec<tiberius::Row>, String> {
        let mut guard = self.client.lock().await;
        let conn = guard.as_mut().ok_or("the connection was lost")?;
        let params: Vec<&dyn tiberius::ToSql> = params.iter().map(|p| p as &dyn tiberius::ToSql).collect();
        let rows = conn.query(sql, &params).await.map_err(err)?.into_first_result().await.map_err(err);
        rows
    }

    pub async fn tables(&self) -> Result<Vec<Table>, String> {
        let rows = self
            .rows("select TABLE_SCHEMA, TABLE_NAME, case when TABLE_TYPE = 'VIEW' then 1 else 0 end from INFORMATION_SCHEMA.TABLES order by 1, 2", &[])
            .await?;
        Ok(rows
            .iter()
            .map(|r| Table {
                schema: r.get::<&str, _>(0).unwrap_or("").into(),
                name: r.get::<&str, _>(1).unwrap_or("").into(),
                view: r.get::<i32, _>(2) == Some(1),
            })
            .collect())
    }

    pub async fn columns(&self, schema: &str, table: &str) -> Result<Vec<Column>, String> {
        let rows = self.rows(COLUMNS, &[schema, table]).await?;
        Ok(rows
            .iter()
            .map(|r| Column {
                name: r.get::<&str, _>(0).unwrap_or("").into(),
                kind: r.get::<&str, _>(1).unwrap_or("").into(),
                nullable: r.get::<i32, _>(2) == Some(1),
                key: r.get::<i32, _>(3) == Some(1),
            })
            .collect())
    }

    pub async fn close(&self) {
        if let Some(h) = self.running.lock().unwrap().take() {
            h.abort();
        }
        if let Some(conn) = self.client.lock().await.take() {
            let _ = conn.close().await;
        }
    }
}
