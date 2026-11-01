use super::split::split_sqlite;
use super::{bytes, float, int, text, Cell, Column, Config, Info, Outcome, ResultSet, Table, MAX_ROWS};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, InterruptHandle};
use std::path::PathBuf;
use std::sync::mpsc;
use tokio::sync::oneshot;

type Job = Box<dyn FnOnce(&Connection) + Send>;

pub struct Lite {
    pub info: Info,
    jobs: std::sync::Mutex<Option<mpsc::Sender<Job>>>,
    interrupt: InterruptHandle,
}

fn path_of(file: &str) -> PathBuf {
    let f = file.trim();
    if f == ":memory:" {
        return PathBuf::from(f);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"));
    let p = if f == "~" {
        home.clone()
    } else if let Some(rest) = f.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(f)
    };
    if p.is_absolute() {
        p
    } else {
        home.join(p)
    }
}

fn cell(v: ValueRef) -> Cell {
    match v {
        ValueRef::Null => Cell::Null,
        ValueRef::Integer(n) => int(n),
        ValueRef::Real(f) => float(f),
        ValueRef::Text(t) => text(&String::from_utf8_lossy(t)),
        ValueRef::Blob(b) => bytes(b),
    }
}

fn statement(db: &Connection, sql: &str) -> Result<ResultSet, String> {
    let mut st = db.prepare(sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = st.column_names().into_iter().map(String::from).collect();
    if columns.is_empty() {
        st.raw_execute().map_err(|e| e.to_string())?;
        let command = sql.split_whitespace().next().unwrap_or("").to_uppercase();
        let dml = matches!(command.as_str(), "INSERT" | "UPDATE" | "DELETE" | "REPLACE");
        return Ok(ResultSet { affected: dml.then(|| db.changes()), command: Some(command), ..Default::default() });
    }
    let n = columns.len();
    let mut set = ResultSet { columns, ..Default::default() };
    let mut rows = st.raw_query();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if set.rows.len() >= MAX_ROWS {
            set.truncated = true;
            break;
        }
        set.rows.push((0..n).map(|i| row.get_ref(i).map_or(Cell::Null, cell)).collect());
    }
    Ok(set)
}

impl Lite {
    pub async fn open(c: &Config) -> Result<Lite, String> {
        let file = c.file.clone().unwrap_or_default();
        if file.trim().is_empty() {
            return Err("choose the database file".into());
        }
        let path = path_of(&file);
        if path.as_os_str() != ":memory:" && !path.exists() {
            return Err(format!("there's no file at {}", path.display()));
        }
        let (tx, rx) = mpsc::channel::<Job>();
        let (ready_tx, ready_rx) = oneshot::channel();
        let shown = path.to_string_lossy().into_owned();
        std::thread::spawn(move || {
            let opened = Connection::open(&path).and_then(|db| {
                let version: String = db.query_row("select sqlite_version()", [], |r| r.get(0))?;
                db.query_row("select count(*) from sqlite_schema", [], |r| r.get::<_, i64>(0))?;
                Ok((db, version))
            });
            let db = match opened {
                Ok((db, version)) => {
                    let _ = ready_tx.send(Ok((db.get_interrupt_handle(), version)));
                    db
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            for job in rx {
                job(&db);
            }
        });
        let (interrupt, version) = ready_rx.await.map_err(|_| "sqlite stopped".to_string())??;
        Ok(Lite {
            info: Info { engine: "sqlite", version, database: shown, user: String::new() },
            jobs: std::sync::Mutex::new(Some(tx)),
            interrupt,
        })
    }

    async fn on_thread<T: Send + 'static>(&self, f: impl FnOnce(&Connection) -> T + Send + 'static) -> Result<T, String> {
        let (tx, rx) = oneshot::channel();
        let job: Job = Box::new(move |db| {
            let _ = tx.send(f(db));
        });
        self.jobs.lock().unwrap().as_ref().ok_or("the database is closed")?.send(job).map_err(|_| "sqlite stopped".to_string())?;
        rx.await.map_err(|_| "sqlite stopped".to_string())
    }

    pub async fn query(&self, sql: &str) -> Result<Outcome, String> {
        let sql = sql.to_string();
        self.on_thread(move |db| {
            let mut results = vec![];
            for stmt in split_sqlite(&sql) {
                match statement(db, &stmt) {
                    Ok(set) => results.push(set),
                    Err(e) => return Outcome::failed(results, if e.contains("interrupted") { "cancelled".into() } else { e }),
                }
            }
            Outcome { results, ..Default::default() }
        })
        .await
    }

    pub async fn cancel(&self) -> Result<(), String> {
        self.interrupt.interrupt();
        Ok(())
    }

    pub async fn tables(&self) -> Result<Vec<Table>, String> {
        self.on_thread(|db| {
            let mut st = db
                .prepare("select name, type = 'view' from sqlite_schema where type in ('table', 'view') and name not like 'sqlite_%' order by name")
                .map_err(|e| e.to_string())?;
            let rows = st.query_map([], |r| Ok(Table { schema: "main".into(), name: r.get(0)?, view: r.get(1)? })).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
        .await?
    }

    pub async fn columns(&self, _schema: &str, table: &str) -> Result<Vec<Column>, String> {
        let table = table.to_string();
        self.on_thread(move |db| {
            let mut st = db.prepare("select name, type, \"notnull\", pk from pragma_table_info(?)").map_err(|e| e.to_string())?;
            let rows = st
                .query_map([table], |r| {
                    Ok(Column { name: r.get(0)?, kind: r.get(1)?, nullable: r.get::<_, i64>(2)? == 0, key: r.get::<_, i64>(3)? > 0 })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
        .await?
    }

    pub async fn close(&self) {
        self.interrupt.interrupt();
        self.jobs.lock().unwrap().take();
    }
}
