mod lite;
mod ms;
mod my;
mod pg;
mod split;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const MAX_ROWS: usize = 10_000;
const MAX_CELL: usize = 10_000;
const SAFE_INT: i64 = 9_007_199_254_740_991;

pub type Cell = Value;

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub engine: String,
    pub host: Option<String>,
    pub port: Option<Value>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub file: Option<String>,
    pub ssl: Option<bool>,
    pub trust_cert: Option<bool>,
}

impl Config {
    pub fn host(&self) -> String {
        self.host.clone().filter(|h| !h.trim().is_empty()).unwrap_or_else(|| "localhost".into())
    }
    pub fn port(&self, default: u16) -> u16 {
        match &self.port {
            Some(Value::Number(n)) => n.as_u64().and_then(|n| u16::try_from(n).ok()).filter(|&n| n > 0).unwrap_or(default),
            Some(Value::String(s)) => s.trim().parse().ok().filter(|&n| n > 0).unwrap_or(default),
            _ => default,
        }
    }
    pub fn user(&self) -> Option<String> {
        self.user.clone().filter(|s| !s.is_empty())
    }
    pub fn password(&self) -> Option<String> {
        self.password.clone().filter(|s| !s.is_empty())
    }
    pub fn database(&self) -> Option<String> {
        self.database.clone().filter(|s| !s.is_empty())
    }
    pub fn ssl(&self) -> bool {
        self.ssl.unwrap_or(false)
    }
}

#[derive(Serialize, Default)]
pub struct ResultSet {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Serialize, Default)]
pub struct Outcome {
    pub results: Vec<ResultSet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub notices: Vec<String>,
}

impl Outcome {
    pub fn failed(results: Vec<ResultSet>, error: impl ToString) -> Self {
        Outcome { results, error: Some(error.to_string()), ..Default::default() }
    }
}

#[derive(Serialize)]
pub struct Database {
    pub name: String,
    pub system: bool,
}

#[derive(Serialize)]
pub struct Object {
    pub schema: String,
    pub name: String,
    /// table, view, procedure or function
    pub kind: String,
}

#[derive(Serialize)]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub nullable: bool,
    pub key: bool,
}

#[derive(Serialize, Clone)]
pub struct Info {
    pub engine: &'static str,
    pub version: String,
    pub database: String,
    pub user: String,
}

pub fn text(s: &str) -> Cell {
    if s.len() <= MAX_CELL {
        return Value::String(s.to_string());
    }
    let mut end = MAX_CELL;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    Value::String(format!("{}…", &s[..end]))
}

pub fn int(n: i64) -> Cell {
    if (-SAFE_INT..=SAFE_INT).contains(&n) {
        Value::from(n)
    } else {
        Value::String(n.to_string())
    }
}

pub fn uint(n: u64) -> Cell {
    if n <= SAFE_INT as u64 {
        Value::from(n)
    } else {
        Value::String(n.to_string())
    }
}

pub fn float(f: f64) -> Cell {
    serde_json::Number::from_f64(f).map(Value::Number).unwrap_or_else(|| Value::String(f.to_string()))
}

pub fn bytes(b: &[u8]) -> Cell {
    let keep = &b[..b.len().min(MAX_CELL / 2)];
    let mut s = String::with_capacity(2 + keep.len() * 2);
    s.push_str("0x");
    for byte in keep {
        s.push_str(&format!("{byte:02x}"));
    }
    if b.len() > keep.len() {
        s.push('…');
    }
    Value::String(s)
}

pub fn numeric_text(s: &str) -> Cell {
    if let Ok(n) = s.parse::<i64>() {
        if n.to_string() == s {
            return int(n);
        }
    }
    if s.contains('.') && s.len() < 16 {
        if let Ok(f) = s.parse::<f64>() {
            if f.is_finite() && f.to_string() == s {
                return float(f);
            }
        }
    }
    text(s)
}

pub enum Db {
    Pg(pg::Pg),
    My(my::My),
    Ms(ms::Ms),
    Lite(lite::Lite),
}

impl Db {
    async fn open(c: Config) -> Result<Db, String> {
        match c.engine.as_str() {
            "postgres" => pg::Pg::open(&c).await.map(Db::Pg),
            "mysql" => my::My::open(&c).await.map(Db::My),
            "mssql" => ms::Ms::open(&c).await.map(Db::Ms),
            "sqlite" => lite::Lite::open(&c).await.map(Db::Lite),
            _ => Err("pick a database type".into()),
        }
    }

    fn info(&self) -> Info {
        match self {
            Db::Pg(d) => d.info.clone(),
            Db::My(d) => d.info.clone(),
            Db::Ms(d) => d.info.clone(),
            Db::Lite(d) => d.info.clone(),
        }
    }

    async fn query(&self, text: &str) -> Result<Outcome, String> {
        match self {
            Db::Pg(d) => d.query(text).await,
            Db::My(d) => d.query(text).await,
            Db::Ms(d) => d.query(text).await,
            Db::Lite(d) => d.query(text).await,
        }
    }

    async fn cancel(&self) -> Result<(), String> {
        match self {
            Db::Pg(d) => d.cancel().await,
            Db::My(d) => d.cancel().await,
            Db::Ms(d) => d.cancel().await,
            Db::Lite(d) => d.cancel().await,
        }
    }

    async fn databases(&self) -> Result<Vec<Database>, String> {
        match self {
            Db::Pg(d) => d.databases().await,
            Db::My(d) => d.databases().await,
            Db::Ms(d) => d.databases().await,
            Db::Lite(d) => d.databases().await,
        }
    }

    async fn objects(&self, database: &str) -> Result<Vec<Object>, String> {
        match self {
            Db::Pg(d) => d.objects(database).await,
            Db::My(d) => d.objects(database).await,
            Db::Ms(d) => d.objects(database).await,
            Db::Lite(d) => d.objects(database).await,
        }
    }

    async fn columns(&self, database: &str, schema: &str, table: &str) -> Result<Vec<Column>, String> {
        match self {
            Db::Pg(d) => d.columns(database, schema, table).await,
            Db::My(d) => d.columns(schema, table).await,
            Db::Ms(d) => d.columns(database, schema, table).await,
            Db::Lite(d) => d.columns(database, table).await,
        }
    }

    async fn close(&self) {
        match self {
            Db::Pg(d) => d.close().await,
            Db::My(d) => d.close().await,
            Db::Ms(d) => d.close().await,
            Db::Lite(d) => d.close().await,
        }
    }
}

#[derive(Default)]
pub struct Sql {
    dbs: Mutex<HashMap<String, Arc<Db>>>,
    starting: Mutex<HashMap<String, u64>>,
    next: AtomicU64,
}

#[derive(Serialize)]
pub struct Timed {
    #[serde(flatten)]
    outcome: Outcome,
    ms: u128,
}

impl Sql {
    fn db(&self, id: &str) -> Result<Arc<Db>, String> {
        self.dbs.lock().unwrap().get(id).cloned().ok_or_else(|| "not connected".to_string())
    }

    pub async fn connect(&self, id: &str, config: Config) -> Result<Info, String> {
        self.disconnect(id).await;
        let token = self.next.fetch_add(1, Ordering::Relaxed);
        self.starting.lock().unwrap().insert(id.to_string(), token);
        let opened = Db::open(config).await;
        let still_wanted = {
            let mut starting = self.starting.lock().unwrap();
            let mine = starting.get(id) == Some(&token);
            if mine {
                starting.remove(id);
            }
            mine
        };
        let db = opened?;
        if !still_wanted {
            db.close().await;
            return Err("disconnected".into());
        }
        let info = db.info();
        self.dbs.lock().unwrap().insert(id.to_string(), Arc::new(db));
        Ok(info)
    }

    pub async fn query(&self, id: &str, text: &str) -> Result<Timed, String> {
        let db = self.db(id)?;
        let start = Instant::now();
        let outcome = db.query(text).await?;
        Ok(Timed { outcome, ms: start.elapsed().as_millis() })
    }

    pub async fn cancel(&self, id: &str) -> Result<(), String> {
        self.db(id)?.cancel().await
    }

    pub async fn databases(&self, id: &str) -> Result<Vec<Database>, String> {
        self.db(id)?.databases().await
    }

    pub async fn objects(&self, id: &str, database: &str) -> Result<Vec<Object>, String> {
        self.db(id)?.objects(database).await
    }

    pub async fn columns(&self, id: &str, database: &str, schema: &str, table: &str) -> Result<Vec<Column>, String> {
        self.db(id)?.columns(database, schema, table).await
    }

    pub async fn disconnect(&self, id: &str) {
        self.starting.lock().unwrap().remove(id);
        let db = self.dbs.lock().unwrap().remove(id);
        if let Some(db) = db {
            db.close().await;
        }
    }

    pub async fn close_all(&self) {
        let all: Vec<_> = self.dbs.lock().unwrap().drain().map(|(_, d)| d).collect();
        for db in all {
            db.close().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SCRIPT: &str = "create table t (id int primary key, name varchar(20), score float);
insert into t values (1, 'a', 1.5), (2, '01234', null);
select id, name, score from t order by id;
select * from t where id > 99;";

    async fn check(engine: &str, config: Config) {
        let sql = Sql::default();
        let info = sql.connect("x", config).await.unwrap_or_else(|e| panic!("{engine}: {e}"));
        assert_eq!(info.engine, engine);
        let out = serde_json::to_value(sql.query("x", SCRIPT).await.unwrap()).unwrap();
        assert!(out.get("error").is_none(), "{engine}: {out}");
        let all = out["results"].as_array().unwrap();
        // SQL Server reports a batch's statements together, without the ones that return no rows.
        let results = if engine == "mssql" { &all[..] } else { &all[2..] };
        if engine != "mssql" {
            assert_eq!(all.len(), 4, "{engine}: {out}");
            assert_eq!(all[1]["affected"], json!(2), "{engine}: {out}");
        }
        assert_eq!(results[0]["columns"], json!(["id", "name", "score"]));
        assert_eq!(results[0]["rows"], json!([[1, "a", 1.5], [2, "01234", null]]), "{engine}");
        assert_eq!(results[1]["columns"], json!(["id", "name", "score"]), "{engine}: an empty result keeps its columns");
        let bad = serde_json::to_value(sql.query("x", "select nope from t").await.unwrap()).unwrap();
        assert!(bad["error"].is_string(), "{engine}: {bad}");
        let dbs = sql.databases("x").await.unwrap();
        let current = if engine == "sqlite" { "main" } else { info.database.as_str() };
        assert!(dbs.iter().any(|d| d.name == current), "{engine}: {current} isn't among the databases");
        let objects = sql.objects("x", current).await.unwrap();
        let t = objects.iter().find(|t| t.name == "t" && t.kind == "table").unwrap_or_else(|| panic!("{engine}: no table t"));
        let cols = sql.columns("x", current, &t.schema, "t").await.unwrap();
        assert_eq!(cols.iter().map(|c| (c.name.as_str(), c.key)).collect::<Vec<_>>(), [("id", true), ("name", false), ("score", false)]);
        if let Some(other) = dbs.iter().find(|d| d.name != current && !d.system) {
            sql.objects("x", &other.name).await.unwrap_or_else(|e| panic!("{engine}: listing {}: {e}", other.name));
        }
        sql.query("x", "drop table t").await.unwrap();
        sql.disconnect("x").await;
        assert!(sql.query("x", "select 1").await.is_err());
    }

    #[tokio::test]
    async fn sqlite() {
        check("sqlite", Config { engine: "sqlite".into(), file: Some(":memory:".into()), ..Default::default() }).await;
    }

    fn server(engine: &str, port: &str) -> Option<Config> {
        let port = std::env::var(port).ok()?;
        Some(Config {
            engine: engine.into(),
            port: Some(Value::String(port)),
            user: Some(match engine {
                "postgres" => "postgres",
                "mssql" => "sa",
                _ => "root",
            }
            .into()),
            password: Some(std::env::var("MONO_TEST_PASSWORD").unwrap_or_else(|_| "pw".into())),
            database: (engine == "mysql").then(|| "t".into()),
            ..Default::default()
        })
    }

    #[tokio::test]
    async fn postgres() {
        if let Some(c) = server("postgres", "MONO_TEST_PG_PORT") {
            check("postgres", c).await;
        }
    }

    #[tokio::test]
    async fn mssql() {
        if let Some(c) = server("mssql", "MONO_TEST_MS_PORT") {
            check("mssql", c).await;
        }
    }

    #[tokio::test]
    async fn mysql() {
        if let Some(c) = server("mysql", "MONO_TEST_MYSQL_PORT") {
            check("mysql", c).await;
        }
    }
}
