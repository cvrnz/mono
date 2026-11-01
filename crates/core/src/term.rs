use crate::proc::{expand_home, home_dir, login_shell};
use crate::Emit;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

struct Term {
    pid: Option<u32>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct Terminals {
    all: Arc<Mutex<HashMap<String, Term>>>,
    next: AtomicU64,
    emit: Emit,
}

#[derive(Deserialize)]
pub struct OpenArgs {
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
}

#[derive(Serialize)]
pub struct Opened {
    id: String,
    shell: String,
}

#[derive(Deserialize)]
pub struct InputArgs {
    id: String,
    data: String,
}

#[derive(Deserialize)]
pub struct ResizeArgs {
    id: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
pub struct IdArgs {
    id: String,
}

#[derive(Serialize)]
pub struct Empty {}

fn hang_up(pid: Option<u32>) {
    if let Some(pid) = pid {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGHUP);
            libc::kill(pid as i32, libc::SIGHUP);
        }
    }
}

impl Terminals {
    pub fn new(emit: Emit) -> Self {
        Terminals { all: Default::default(), next: AtomicU64::new(0), emit }
    }

    pub fn open(&self, a: OpenArgs) -> Result<Opened, String> {
        let shell = login_shell();
        let size = PtySize { cols: a.cols.unwrap_or(0).max(20), rows: a.rows.unwrap_or(0).max(5), pixel_width: 0, pixel_height: 0 };
        let pair = native_pty_system().openpty(size).map_err(|e| e.to_string())?;
        let cwd = a.cwd.as_deref().map(expand_home).filter(|p| p.is_dir()).unwrap_or_else(home_dir);
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "monomyth");
        cmd.env("SHELL", &shell);
        if std::env::var_os("LANG").is_none() {
            cmd.env("LANG", "C.UTF-8");
        }
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("couldn't start {shell}: {e}"))?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let id = (self.next.fetch_add(1, Ordering::Relaxed) + 1).to_string();
        let pid = child.process_id();
        self.all.lock().unwrap().insert(id.clone(), Term { pid, master: pair.master, writer });

        let (done_tx, done_rx) = mpsc::channel::<()>();
        let emit = self.emit.clone();
        let tid = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 65536];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => emit("term.data", json!({ "id": tid, "data": B64.encode(&buf[..n]) })),
                }
            }
            let _ = done_tx.send(());
        });
        let emit = self.emit.clone();
        let all = self.all.clone();
        let tid = id.clone();
        std::thread::spawn(move || {
            let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
            let _ = done_rx.recv_timeout(Duration::from_millis(500));
            all.lock().unwrap().remove(&tid);
            emit("term.exit", json!({ "id": tid, "code": code }));
        });
        Ok(Opened { id, shell })
    }

    pub fn input(&self, a: InputArgs) -> Result<Empty, String> {
        let data = B64.decode(a.data.as_bytes()).map_err(|e| e.to_string())?;
        let mut all = self.all.lock().unwrap();
        let t = all.get_mut(&a.id).ok_or_else(|| format!("no terminal {}", a.id))?;
        t.writer.write_all(&data).and_then(|_| t.writer.flush()).map_err(|e| e.to_string())?;
        Ok(Empty {})
    }

    pub fn resize(&self, a: ResizeArgs) -> Result<Empty, String> {
        let all = self.all.lock().unwrap();
        let t = all.get(&a.id).ok_or_else(|| format!("no terminal {}", a.id))?;
        let size = PtySize { cols: a.cols.unwrap_or(0).max(2), rows: a.rows.unwrap_or(0).max(1), pixel_width: 0, pixel_height: 0 };
        t.master.resize(size).map_err(|e| e.to_string())?;
        Ok(Empty {})
    }

    pub fn close(&self, a: IdArgs) -> Empty {
        let pid = self.all.lock().unwrap().get(&a.id).and_then(|t| t.pid);
        hang_up(pid);
        Empty {}
    }

    pub fn close_all(&self) {
        let pids: Vec<_> = self.all.lock().unwrap().values().map(|t| t.pid).collect();
        pids.into_iter().for_each(hang_up);
    }
}
