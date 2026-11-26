//! The Neovim plugin's backend: projects (folders on this computer, or Docker containers through
//! the helper), SQL connections and theme repos, over stdin/stdout with one JSON message per line.

use mono_core::Service;
use mono_host::{docker, sql, theme_repos};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

enum Conn {
    Local(Arc<Service>),
    Docker(Arc<docker::Agent>),
}

impl Conn {
    fn close(&self) {
        match self {
            Conn::Local(s) => s.close(),
            Conn::Docker(a) => a.close(),
        }
    }
}

#[derive(Default)]
struct Host {
    conns: Mutex<HashMap<String, Arc<Conn>>>,
    starting: Mutex<HashMap<String, u64>>,
    next: AtomicU64,
    sql: sql::Sql,
}

static OUT: Mutex<()> = Mutex::new(());

fn send(msg: Value) {
    let _guard = OUT.lock().unwrap();
    let mut out = std::io::stdout().lock();
    let _ = serde_json::to_writer(&mut out, &msg);
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

fn event(name: &str, params: Value) {
    send(json!({ "event": name, "params": params }));
}

fn args<T: DeserializeOwned>(params: Value) -> Result<T, String> {
    let params = if params.is_null() { json!({}) } else { params };
    serde_json::from_value(params).map_err(|e| format!("bad parameters: {e}"))
}

fn docker_of(path: Option<String>) -> String {
    path.filter(|p| !p.trim().is_empty()).unwrap_or_else(|| "docker".into())
}

/// Where the Linux helpers are: given by the plugin, or next to this program, or in the repo it was built in.
fn agents_dir(given: Option<String>) -> PathBuf {
    if let Some(dir) = given.or_else(|| std::env::var("MONO_AGENTS").ok()).filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    let exe = std::env::current_exe().ok().and_then(|e| e.parent().map(PathBuf::from)).unwrap_or_default();
    let beside = exe.join("agent");
    if beside.is_dir() {
        return beside;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resources/agent")
}

fn json<T: serde::Serialize>(v: Result<T, String>) -> Result<Value, String> {
    v.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

#[derive(Deserialize)]
struct ConnectArgs {
    conn: String,
    kind: String,
    container: Option<String>,
    docker: Option<String>,
    agents: Option<String>,
}

#[derive(Deserialize)]
struct ConnArgs {
    conn: String,
}

#[derive(Deserialize)]
struct CallArgs {
    conn: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
struct DockerArgs {
    docker: Option<String>,
}

#[derive(Deserialize)]
struct SqlArgs {
    id: String,
    config: Option<sql::Config>,
    text: Option<String>,
    database: Option<String>,
    schema: Option<String>,
    table: Option<String>,
}

#[derive(Deserialize)]
struct ThemeArgs {
    dir: String,
    repo: String,
}

impl Host {
    fn conn(&self, id: &str) -> Result<Arc<Conn>, String> {
        self.conns.lock().unwrap().get(id).cloned().ok_or_else(|| "not connected".to_string())
    }

    fn disconnect(&self, conn: &str) {
        self.starting.lock().unwrap().remove(conn);
        if let Some(c) = self.conns.lock().unwrap().remove(conn) {
            c.close();
        }
    }

    async fn connect(self: &Arc<Self>, a: ConnectArgs) -> Result<Value, String> {
        self.disconnect(&a.conn);
        let token = self.next.fetch_add(1, Ordering::Relaxed);
        self.starting.lock().unwrap().insert(a.conn.clone(), token);
        let id = a.conn.clone();
        let on_event = move |name: &str, params: Value| event("agent", json!({ "conn": id, "event": name, "params": params }));
        let made = match a.kind.as_str() {
            "local" => Ok(Conn::Local(Arc::new(Service::new(Arc::new(on_event))))),
            "docker" => {
                let container = a.container.clone().filter(|c| !c.is_empty()).ok_or("pick a container")?;
                let id = a.conn.clone();
                let status = move |s: &str| event("status", json!({ "conn": id, "status": s }));
                let (host, id) = (self.clone(), a.conn.clone());
                let on_close = move |why: String| {
                    let mut conns = host.conns.lock().unwrap();
                    if let Some(Conn::Docker(_)) = conns.get(&id).map(|c| c.as_ref()) {
                        conns.remove(&id);
                        event("closed", json!({ "conn": id, "error": why }));
                    }
                };
                docker::Agent::start(&docker_of(a.docker), &container, agents_dir(a.agents), Box::new(status), Box::new(on_event), Box::new(on_close))
                    .await
                    .map(|a| Conn::Docker(Arc::new(a)))
            }
            _ => Err("unknown kind of project".into()),
        };
        let wanted = {
            let mut starting = self.starting.lock().unwrap();
            let mine = starting.get(&a.conn) == Some(&token);
            if mine {
                starting.remove(&a.conn);
            }
            mine
        };
        let made = made?;
        if !wanted {
            made.close();
            return Err("disconnected".into());
        }
        self.conns.lock().unwrap().insert(a.conn, Arc::new(made));
        Ok(json!({}))
    }

    async fn call(&self, a: CallArgs) -> Result<Value, String> {
        match self.conn(&a.conn)?.as_ref() {
            Conn::Local(s) => {
                let s = s.clone();
                tokio::task::spawn_blocking(move || s.call(&a.method, a.params)).await.map_err(|e| e.to_string())?
            }
            Conn::Docker(agent) => agent.call(&a.method, a.params).await,
        }
    }

    async fn sql(&self, method: &str, a: SqlArgs) -> Result<Value, String> {
        let need = |v: Option<String>, name: &str| v.ok_or_else(|| format!("bad parameters: missing {name}"));
        match method {
            "connect" => json(self.sql.connect(&a.id, a.config.ok_or("bad parameters: missing config")?).await),
            "query" => json(self.sql.query(&a.id, &need(a.text, "text")?).await),
            "cancel" => json(self.sql.cancel(&a.id).await),
            "databases" => json(self.sql.databases(&a.id).await),
            "objects" => json(self.sql.objects(&a.id, &need(a.database, "database")?).await),
            "columns" => json(self.sql.columns(&a.id, &need(a.database, "database")?, &need(a.schema, "schema")?, &need(a.table, "table")?).await),
            "disconnect" => {
                self.sql.disconnect(&a.id).await;
                Ok(json!({}))
            }
            _ => Err(format!("unknown method sql.{method}")),
        }
    }

    async fn handle(self: Arc<Self>, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "platform" => Ok(json!(match std::env::consts::OS {
                "macos" => "darwin",
                other => other,
            })),
            "docker.containers" => {
                let a: DockerArgs = args(params)?;
                json(docker::containers(&docker_of(a.docker)).await)
            }
            "connect" => self.connect(args(params)?).await,
            "disconnect" => {
                let a: ConnArgs = args(params)?;
                self.disconnect(&a.conn);
                Ok(json!({}))
            }
            "call" => self.call(args(params)?).await,
            "theme.install" => {
                let a: ThemeArgs = args(params)?;
                theme_repos::install(std::path::Path::new(&a.dir), &a.repo).await.map(|added| json!(added))
            }
            "theme.update" => {
                let a: ThemeArgs = args(params)?;
                theme_repos::update(std::path::Path::new(&a.dir), &a.repo).await.map(|_| json!({}))
            }
            "theme.remove" => {
                let a: ThemeArgs = args(params)?;
                theme_repos::remove(std::path::Path::new(&a.dir), &a.repo).await.map(|_| json!({}))
            }
            m if m.starts_with("sql.") => self.sql(&m[4..], args(params)?).await,
            _ => Err(format!("unknown method {method}")),
        }
    }

    async fn close_all(&self) {
        let all: Vec<_> = self.conns.lock().unwrap().drain().map(|(_, c)| c).collect();
        for c in all {
            c.close();
        }
        let _ = tokio::time::timeout(Duration::from_secs(2), self.sql.close_all()).await;
    }
}

#[tokio::main]
async fn main() {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let host = Arc::new(Host::default());
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(req) = serde_json::from_str::<Value>(&line) else { continue };
        let host = host.clone();
        tokio::spawn(async move {
            let id = req["id"].clone();
            let method = req["method"].as_str().unwrap_or("").to_string();
            match host.handle(&method, req["params"].clone()).await {
                Ok(result) => send(json!({ "id": id, "result": result })),
                Err(error) => send(json!({ "id": id, "error": error })),
            }
        });
    }
    host.close_all().await;
}
