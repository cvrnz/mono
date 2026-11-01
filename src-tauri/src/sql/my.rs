use super::{bytes, float, int, text, uint, Column, Config, Info, Outcome, ResultSet, Table, MAX_ROWS};
use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Opts, OptsBuilder, Row, SslOpts, Value};
use std::time::Duration;
use tokio::sync::Mutex;

pub struct My {
    pub info: Info,
    conn: Mutex<Option<Conn>>,
    id: u32,
    opts: Opts,
}

const SYSTEM: &str = "('mysql', 'information_schema', 'performance_schema', 'sys')";

fn err(e: mysql_async::Error) -> String {
    match e {
        mysql_async::Error::Server(s) => s.message,
        other => other.to_string(),
    }
}

fn as_text(v: &Value) -> String {
    match v {
        Value::NULL => String::new(),
        Value::Bytes(b) => String::from_utf8_lossy(b).into_owned(),
        Value::Int(n) => n.to_string(),
        Value::UInt(n) => n.to_string(),
        Value::Float(f) => f.to_string(),
        Value::Double(f) => f.to_string(),
        other => other.as_sql(true).trim_matches('\'').to_string(),
    }
}

fn cell(v: Value, ty: ColumnType, binary: bool) -> serde_json::Value {
    use ColumnType::*;
    match v {
        Value::NULL => serde_json::Value::Null,
        Value::Int(n) => int(n),
        Value::UInt(n) => uint(n),
        Value::Float(f) => float(f as f64),
        Value::Double(f) => float(f),
        Value::Bytes(b) => {
            let s = match std::str::from_utf8(&b) {
                Ok(s) if !binary => s,
                _ => return bytes(&b),
            };
            match ty {
                MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_LONG | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => {
                    if let Ok(n) = s.parse::<i64>() {
                        return int(n);
                    }
                    if let Ok(n) = s.parse::<u64>() {
                        return uint(n);
                    }
                    text(s)
                }
                MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => s.parse::<f64>().map(float).unwrap_or_else(|_| text(s)),
                _ => text(s),
            }
        }
        other => text(&as_text(&other)),
    }
}

impl My {
    pub async fn open(c: &Config) -> Result<My, String> {
        let mut b = OptsBuilder::default()
            .ip_or_hostname(c.host())
            .tcp_port(c.port(3306))
            .user(c.user())
            .pass(c.password())
            .db_name(c.database())
            .prefer_socket(false);
        if c.ssl() {
            b = b.ssl_opts(Some(SslOpts::default().with_danger_accept_invalid_certs(true).with_danger_skip_domain_validation(true)));
        }
        let opts: Opts = b.into();
        let mut conn = tokio::time::timeout(Duration::from_secs(15), Conn::new(opts.clone()))
            .await
            .map_err(|_| "timed out connecting".to_string())?
            .map_err(err)?;
        let row: Option<(String, Option<String>, String)> = conn.query_first("select version(), database(), current_user()").await.map_err(err)?;
        let (version, database, user) = row.unwrap_or_default();
        let id = conn.id();
        Ok(My { info: Info { engine: "mysql", version, database: database.unwrap_or_default(), user }, conn: Mutex::new(Some(conn)), id, opts })
    }

    pub async fn query(&self, sql: &str) -> Result<Outcome, String> {
        let mut guard = self.conn.lock().await;
        let conn = guard.as_mut().ok_or("the connection was lost")?;
        let mut results = vec![];
        let mut result = match conn.query_iter(sql).await {
            Ok(r) => r,
            Err(e) => return Ok(Outcome::failed(results, err(e))),
        };
        while !result.is_empty() {
            let columns = result.columns().unwrap_or_else(|| Vec::new().into());
            let affected = result.affected_rows();
            let kinds: Vec<(ColumnType, bool)> = columns
                .iter()
                .map(|c| (c.column_type(), c.flags().contains(ColumnFlags::BINARY_FLAG) && c.character_set() == 63))
                .collect();
            let collected = result
                .reduce((Vec::new(), false), |(mut rows, mut truncated), row: Row| {
                    if rows.len() >= MAX_ROWS {
                        truncated = true;
                    } else {
                        let values = row.unwrap();
                        rows.push(values.into_iter().zip(&kinds).map(|(v, &(ty, bin))| cell(v, ty, bin)).collect::<Vec<_>>());
                    }
                    (rows, truncated)
                })
                .await;
            let (rows, truncated) = match collected {
                Ok(r) => r,
                Err(e) => return Ok(Outcome::failed(results, err(e))),
            };
            if columns.is_empty() {
                results.push(ResultSet { affected: Some(affected), ..Default::default() });
            } else {
                results.push(ResultSet { columns: columns.iter().map(|c| c.name_str().into_owned()).collect(), rows, truncated, ..Default::default() });
            }
        }
        Ok(Outcome { results, ..Default::default() })
    }

    pub async fn cancel(&self) -> Result<(), String> {
        let mut other = Conn::new(self.opts.clone()).await.map_err(err)?;
        let r = other.query_drop(format!("KILL QUERY {}", self.id)).await.map_err(err);
        let _ = other.disconnect().await;
        r
    }

    async fn rows(&self, sql: String, params: Vec<String>) -> Result<Vec<Vec<String>>, String> {
        let mut guard = self.conn.lock().await;
        let conn = guard.as_mut().ok_or("the connection was lost")?;
        let rows: Vec<Row> = conn.exec(sql, params).await.map_err(err)?;
        Ok(rows.into_iter().map(|r| r.unwrap().iter().map(as_text).collect()).collect())
    }

    pub async fn tables(&self) -> Result<Vec<Table>, String> {
        let sql = format!(
            "select table_schema, table_name, if(table_type = 'VIEW', 1, 0) from information_schema.tables
             where table_schema not in {SYSTEM} and (database() is null or table_schema = database()) order by 1, 2"
        );
        let rows = self.rows(sql, vec![]).await?;
        Ok(rows.into_iter().map(|r| Table { schema: r[0].clone(), name: r[1].clone(), view: r[2] == "1" }).collect())
    }

    pub async fn columns(&self, schema: &str, table: &str) -> Result<Vec<Column>, String> {
        let sql = "select column_name, column_type, if(is_nullable = 'YES', 1, 0), if(column_key = 'PRI', 1, 0) from information_schema.columns
             where table_schema = ? and table_name = ? order by ordinal_position";
        let rows = self.rows(sql.into(), vec![schema.into(), table.into()]).await?;
        Ok(rows.into_iter().map(|r| Column { name: r[0].clone(), kind: r[1].clone(), nullable: r[2] == "1", key: r[3] == "1" }).collect())
    }

    pub async fn close(&self) {
        if let Some(conn) = self.conn.lock().await.take() {
            let _ = conn.disconnect().await;
        }
    }
}
