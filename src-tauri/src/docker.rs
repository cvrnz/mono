use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;

#[derive(Serialize)]
pub struct Container {
    id: String,
    name: String,
    image: String,
    status: String,
    running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    service: Option<String>,
}

fn not_found(docker: &str) -> String {
    format!("couldn't find the docker command ({docker}); install Docker, or set its path")
}

pub async fn run(docker: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(docker)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { not_found(docker) } else { e.to_string() })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { format!("docker {} failed", args.first().unwrap_or(&"")) } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn containers(docker: &str) -> Result<Vec<Container>, String> {
    let out = run(docker, &["ps", "--no-trunc", "--format", "{{json .}}"]).await?;
    let mut list: Vec<Container> = out
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| {
            let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
            let labels: HashMap<String, String> = s("Labels")
                .split(',')
                .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
                .collect();
            Container {
                id: s("ID").chars().take(12).collect(),
                name: s("Names").split(',').next().unwrap_or("").to_string(),
                image: s("Image"),
                status: s("Status"),
                running: s("State") == "running",
                project: labels.get("com.docker.compose.project").cloned(),
                service: labels.get("com.docker.compose.service").cloned(),
            }
        })
        .collect();
    list.sort_by(|a, b| a.project.cmp(&b.project).then(a.name.cmp(&b.name)));
    Ok(list)
}

fn digest(data: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in data {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

async fn arch(docker: &str, container: &str) -> Result<&'static str, String> {
    let image = run(docker, &["inspect", "--format", "{{.Image}}", container]).await?;
    let a = match run(docker, &["image", "inspect", "--format", "{{.Architecture}}", image.trim()]).await {
        Ok(a) if !a.trim().is_empty() => a,
        _ => run(docker, &["exec", container, "uname", "-m"])
            .await
            .map_err(|e| format!("couldn't tell which kind of CPU the container is for: {e}"))?,
    };
    match a.trim() {
        "arm64" | "aarch64" => Ok("arm64"),
        "amd64" | "x86_64" => Ok("amd64"),
        other => Err(format!("containers for {other} aren't supported (only amd64 and arm64)")),
    }
}

async fn install(docker: &str, container: &str, agents: &Path, status: &(dyn Fn(&str) + Send + Sync)) -> Result<String, String> {
    let arch = arch(docker, container).await?;
    let local = agents.join(format!("monomyth-agent-{arch}"));
    let data = tokio::fs::read(&local).await.map_err(|e| format!("the container helper is missing ({}): {e}", local.display()))?;
    let remote = format!("/tmp/monomyth-agent-{}", digest(&data));
    if run(docker, &["exec", container, &remote, "--version"]).await.is_ok() {
        return Ok(remote);
    }
    status("Copying the helper…");
    let target = format!("{container}:{remote}");
    run(docker, &["cp", &local.to_string_lossy(), &target]).await?;
    Ok(remote)
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct Agent {
    stdin: tokio::sync::Mutex<ChildStdin>,
    pending: Pending,
    next: AtomicU64,
    child: Mutex<Option<Child>>,
}

impl Agent {
    pub async fn start(
        docker: &str,
        container: &str,
        agents: PathBuf,
        status: Box<dyn Fn(&str) + Send + Sync>,
        on_event: Box<dyn Fn(&str, Value) + Send + Sync>,
        on_close: Box<dyn Fn(String) + Send + Sync>,
    ) -> Result<Agent, String> {
        status("Checking the container…");
        let remote = install(docker, container, &agents, status.as_ref()).await?;
        status("Starting…");
        let mut child = Command::new(docker)
            .args(["exec", "-i", container, &remote])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { not_found(docker) } else { e.to_string() })?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let mut stderr = child.stderr.take().ok_or("no stderr")?;
        let pending: Pending = Default::default();
        let errors = Arc::new(Mutex::new(String::new()));
        let tail = errors.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                let mut t = tail.lock().unwrap();
                t.push_str(&String::from_utf8_lossy(&buf[..n]));
                if t.len() > 2000 {
                    let cut = t.len() - 2000;
                    let cut = (cut..t.len()).find(|&i| t.is_char_boundary(i)).unwrap_or(0);
                    t.drain(..cut);
                }
            }
        });
        let waiting = pending.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                if let Some(event) = msg["event"].as_str() {
                    on_event(event, msg["params"].clone());
                    continue;
                }
                let Some(id) = msg["id"].as_u64() else { continue };
                let reply = match msg.get("error").and_then(Value::as_str) {
                    Some(e) => Err(e.to_string()),
                    None => Ok(msg["result"].clone()),
                };
                if let Some(tx) = waiting.lock().unwrap().remove(&id) {
                    let _ = tx.send(reply);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            let why = errors.lock().unwrap().trim().lines().last().unwrap_or("").to_string();
            let why = if why.is_empty() { "the container connection closed".to_string() } else { why };
            for (_, tx) in waiting.lock().unwrap().drain() {
                let _ = tx.send(Err(why.clone()));
            }
            on_close(why);
        });
        Ok(Agent { stdin: tokio::sync::Mutex::new(stdin), pending, next: AtomicU64::new(0), child: Mutex::new(Some(child)) })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let mut line = serde_json::to_vec(&json!({ "id": id, "method": method, "params": params })).map_err(|e| e.to_string())?;
        line.push(b'\n');
        let sent = {
            let mut stdin = self.stdin.lock().await;
            match stdin.write_all(&line).await {
                Ok(()) => stdin.flush().await,
                Err(e) => Err(e),
            }
        };
        if sent.is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err("not connected".into());
        }
        rx.await.map_err(|_| "not connected".to_string())?
    }

    pub fn close(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.start_kill();
        }
    }
}

impl Drop for Agent {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    async fn talks_to_a_running_container() {
        let Ok(container) = std::env::var("MONOMYTH_TEST_CONTAINER") else { return };
        let listed = containers("docker").await.unwrap();
        assert!(listed.iter().any(|c| c.name == container && c.running));
        let agents = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/agent");
        let closed = Arc::new(Mutex::new(None));
        let seen = closed.clone();
        let agent = Agent::start("docker", &container, agents, Box::new(|_| {}), Box::new(|_, _| {}), Box::new(move |why| *seen.lock().unwrap() = Some(why)))
            .await
            .unwrap();
        let hello = agent.call("hello", json!({})).await.unwrap();
        let root = hello["root"].as_str().unwrap().to_string();
        agent.call("fs.write", json!({ "path": format!("{root}/mm-test.txt"), "content": "x" })).await.unwrap();
        let read = agent.call("fs.read", json!({ "path": format!("{root}/mm-test.txt") })).await.unwrap();
        assert_eq!(read["content"], json!("x"));
        agent.call("fs.delete", json!({ "path": format!("{root}/mm-test.txt") })).await.unwrap();
        assert!(agent.call("nope", json!({})).await.unwrap_err().contains("unknown method"));
        agent.close();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        assert!(closed.lock().unwrap().is_some());
    }
}
