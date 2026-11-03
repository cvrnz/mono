use super::split::postgres_commands;
use super::{numeric_text, text, Column, Config, Info, Database, Object, Outcome, ResultSet, MAX_ROWS};
use futures_util::{stream, StreamExt};
use postgres_native_tls::MakeTlsConnector;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio_postgres::error::ErrorPosition;
use tokio_postgres::tls::{MakeTlsConnect, TlsConnect};
use tokio_postgres::{AsyncMessage, CancelToken, Client, Connection, NoTls, SimpleQueryMessage, Socket};

pub struct Pg {
    pub info: Info,
    client: Client,
    cancel: CancelToken,
    tls: Option<MakeTlsConnector>,
    notices: Arc<Mutex<Vec<String>>>,
    lost: Arc<Mutex<Option<String>>>,
    task: JoinHandle<()>,
    config: Config,
    others: tokio::sync::Mutex<HashMap<String, Arc<Pg>>>,
}

const OBJECTS: &str = "
select table_schema::text, table_name::text, case when table_type = 'VIEW' then 'view' else 'table' end
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema') and table_schema not like 'pg_toast%' and table_schema not like 'pg_temp%'
union
select n.nspname::text, p.proname::text, case when p.prokind = 'p' then 'procedure' else 'function' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema') and p.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by 1, 2";

const COLUMNS: &str = "
select c.column_name::text,
  (case when c.data_type = 'USER-DEFINED' then c.udt_name when c.data_type = 'ARRAY' then substr(c.udt_name, 2) || '[]' else c.data_type end)::text,
  c.is_nullable = 'YES',
  exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage k
      on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema and k.table_name = tc.table_name
    where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = c.table_schema and tc.table_name = c.table_name
      and k.column_name = c.column_name)
from information_schema.columns c
where c.table_schema = $1 and c.table_name = $2
order by c.ordinal_position";

fn error_text(e: &tokio_postgres::Error) -> String {
    match e.as_db_error() {
        Some(db) => db.message().to_string(),
        None => {
            let s = e.to_string();
            match std::error::Error::source(e) {
                Some(src) if !s.contains(&src.to_string()) => format!("{s}: {src}"),
                _ => s,
            }
        }
    }
}

fn drive<S, T>(mut conn: Connection<S, T>, notices: Arc<Mutex<Vec<String>>>, lost: Arc<Mutex<Option<String>>>) -> JoinHandle<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut messages = stream::poll_fn(move |cx| conn.poll_message(cx));
        while let Some(m) = messages.next().await {
            match m {
                Ok(AsyncMessage::Notice(n)) => notices.lock().unwrap().push(n.message().to_string()),
                Ok(_) => {}
                Err(e) => {
                    *lost.lock().unwrap() = Some(error_text(&e));
                    break;
                }
            }
        }
        lost.lock().unwrap().get_or_insert_with(|| "the server closed the connection".into());
    })
}

async fn connect<T>(cfg: &tokio_postgres::Config, tls: T, notices: Arc<Mutex<Vec<String>>>, lost: Arc<Mutex<Option<String>>>) -> Result<(Client, JoinHandle<()>), String>
where
    T: MakeTlsConnect<Socket> + 'static,
    T::Stream: Send + 'static,
    T::TlsConnect: Send,
    <T::TlsConnect as TlsConnect<Socket>>::Future: Send,
{
    let (client, conn) = cfg.connect(tls).await.map_err(|e| error_text(&e))?;
    Ok((client, drive(conn, notices, lost)))
}

impl Pg {
    pub async fn open(c: &Config) -> Result<Pg, String> {
        let mut cfg = tokio_postgres::Config::new();
        cfg.host(c.host()).port(c.port(5432)).application_name("mono").connect_timeout(Duration::from_secs(15));
        cfg.user(c.user().unwrap_or_else(default_user));
        if let Some(p) = c.password() {
            cfg.password(p);
        }
        if let Some(d) = c.database() {
            cfg.dbname(d);
        }
        let notices = Arc::new(Mutex::new(vec![]));
        let lost = Arc::new(Mutex::new(None));
        let (client, task, tls) = if c.ssl() {
            let connector = native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true)
                .build()
                .map_err(|e| e.to_string())?;
            let tls = MakeTlsConnector::new(connector);
            cfg.ssl_mode(tokio_postgres::config::SslMode::Require);
            let (client, task) = connect(&cfg, tls.clone(), notices.clone(), lost.clone()).await?;
            (client, task, Some(tls))
        } else {
            let (client, task) = connect(&cfg, NoTls, notices.clone(), lost.clone()).await?;
            (client, task, None)
        };
        let row = client
            .query_one("select current_setting('server_version'), current_database()::text, current_user::text", &[])
            .await
            .map_err(|e| error_text(&e))?;
        let info = Info { engine: "postgres", version: row.get(0), database: row.get(1), user: row.get(2) };
        let cancel = client.cancel_token();
        Ok(Pg { info, client, cancel, tls, notices, lost, task, config: c.clone(), others: Default::default() })
    }

    pub async fn query(&self, sql: &str) -> Result<Outcome, String> {
        if let Some(why) = self.lost.lock().unwrap().clone() {
            return Err(format!("the connection was lost: {why}"));
        }
        self.notices.lock().unwrap().clear();
        let commands = postgres_commands(sql);
        let messages = self.client.simple_query(sql).await;
        let notices = std::mem::take(&mut *self.notices.lock().unwrap());
        let messages = match messages {
            Ok(m) => m,
            Err(e) => {
                let position = match e.as_db_error().and_then(|d| d.position()) {
                    Some(ErrorPosition::Original(p)) => Some(*p),
                    _ => None,
                };
                return Ok(Outcome { results: vec![], error: Some(error_text(&e)), position, notices });
            }
        };
        let mut results: Vec<ResultSet> = vec![];
        let mut current: Option<ResultSet> = None;
        let mut done = 0;
        for m in messages {
            match m {
                SimpleQueryMessage::RowDescription(cols) => {
                    current = Some(ResultSet { columns: cols.iter().map(|c| c.name().to_string()).collect(), ..Default::default() });
                }
                SimpleQueryMessage::Row(row) => {
                    let set = current.get_or_insert_with(|| ResultSet {
                        columns: row.columns().iter().map(|c| c.name().to_string()).collect(),
                        ..Default::default()
                    });
                    if set.rows.len() >= MAX_ROWS {
                        set.truncated = true;
                        continue;
                    }
                    set.rows.push((0..row.len()).map(|i| row.get(i).map_or(serde_json::Value::Null, |v| if is_numeric(v) { numeric_text(v) } else { text(v) })).collect());
                }
                SimpleQueryMessage::CommandComplete(n) => {
                    let command = commands.get(done).cloned().filter(|c| !c.is_empty());
                    done += 1;
                    let mut set = current.take().unwrap_or_default();
                    let dml = command.as_deref().is_some_and(|c| matches!(c, "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "COPY"));
                    if set.columns.is_empty() && dml {
                        set.affected = Some(n);
                    }
                    set.command = command;
                    results.push(set);
                }
                _ => {}
            }
        }
        if let Some(set) = current {
            results.push(set);
        }
        Ok(Outcome { results, notices, ..Default::default() })
    }

    pub async fn cancel(&self) -> Result<(), String> {
        let r = match &self.tls {
            Some(tls) => self.cancel.cancel_query(tls.clone()).await,
            None => self.cancel.cancel_query(NoTls).await,
        };
        r.map_err(|e| error_text(&e))
    }

    pub async fn databases(&self) -> Result<Vec<Database>, String> {
        let rows = self
            .client
            .query("select datname::text, datname in ('postgres', 'template0', 'template1') from pg_database where not datistemplate and datallowconn order by 1", &[])
            .await
            .map_err(|e| error_text(&e))?;
        Ok(rows.iter().map(|r| Database { name: r.get(0), system: r.get(1) }).collect())
    }

    async fn on(&self, database: &str) -> Result<Option<Arc<Pg>>, String> {
        if database.is_empty() || database == self.info.database {
            return Ok(None);
        }
        let mut others = self.others.lock().await;
        if let Some(pg) = others.get(database) {
            if pg.lost.lock().unwrap().is_none() {
                return Ok(Some(pg.clone()));
            }
        }
        let config = Config { database: Some(database.into()), ..self.config.clone() };
        let pg = Arc::new(Box::pin(Pg::open(&config)).await?);
        others.insert(database.into(), pg.clone());
        Ok(Some(pg))
    }

    pub async fn objects(&self, database: &str) -> Result<Vec<Object>, String> {
        let other = self.on(database).await?;
        let client = other.as_ref().map_or(&self.client, |p| &p.client);
        let rows = client.query(OBJECTS, &[]).await.map_err(|e| error_text(&e))?;
        Ok(rows.iter().map(|r| Object { schema: r.get(0), name: r.get(1), kind: r.get(2) }).collect())
    }

    pub async fn columns(&self, database: &str, schema: &str, table: &str) -> Result<Vec<Column>, String> {
        let other = self.on(database).await?;
        let client = other.as_ref().map_or(&self.client, |p| &p.client);
        let rows = client.query(COLUMNS, &[&schema, &table]).await.map_err(|e| error_text(&e))?;
        Ok(rows.iter().map(|r| Column { name: r.get(0), kind: r.get(1), nullable: r.get(2), key: r.get(3) }).collect())
    }

    pub async fn close(&self) {
        self.task.abort();
        for pg in self.others.lock().await.values() {
            pg.task.abort();
        }
    }
}

fn is_numeric(v: &str) -> bool {
    let v = v.strip_prefix('-').unwrap_or(v);
    !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit() || b == b'.') && v.bytes().filter(|&b| b == b'.').count() <= 1
}

fn default_user() -> String {
    std::env::var("USER").unwrap_or_else(|_| "postgres".into())
}
