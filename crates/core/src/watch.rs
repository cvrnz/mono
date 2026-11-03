use crate::Emit;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

#[derive(Deserialize)]
pub struct WatchArgs {
    paths: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct Empty {}

struct Inner {
    watcher: RecommendedWatcher,
    dirs: HashSet<PathBuf>,
}

pub struct Watch {
    inner: Mutex<Option<Inner>>,
    watched: Arc<Mutex<HashSet<PathBuf>>>,
    emit: Emit,
}

impl Watch {
    pub fn new(emit: Emit) -> Self {
        Watch { inner: Mutex::new(None), watched: Default::default(), emit }
    }

    fn start(&self) -> Result<Inner, String> {
        let (tx, rx) = mpsc::channel::<PathBuf>();
        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            if matches!(ev.kind, EventKind::Access(_)) {
                return;
            }
            for p in ev.paths {
                let _ = tx.send(p);
            }
        })
        .map_err(|e| e.to_string())?;
        let (emit, watched) = (self.emit.clone(), self.watched.clone());
        std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut changed = vec![first];
                while let Ok(p) = rx.recv_timeout(Duration::from_millis(150)) {
                    changed.push(p);
                }
                let watched = watched.lock().unwrap();
                let mut dirs: Vec<String> = vec![];
                for p in &changed {
                    for d in [Some(p.as_path()), p.parent()].into_iter().flatten() {
                        let s = d.to_string_lossy().into_owned();
                        if watched.contains(d) && !dirs.contains(&s) {
                            dirs.push(s);
                        }
                    }
                }
                drop(watched);
                if !dirs.is_empty() {
                    emit("fs.changed", json!({ "dirs": dirs }));
                }
            }
        });
        Ok(Inner { watcher, dirs: HashSet::new() })
    }

    pub fn set(&self, a: WatchArgs) -> Result<Empty, String> {
        let want: HashSet<PathBuf> = a.paths.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
        let mut guard = self.inner.lock().unwrap();
        if guard.is_none() {
            if want.is_empty() {
                return Ok(Empty {});
            }
            *guard = Some(self.start()?);
        }
        let inner = guard.as_mut().unwrap();
        for gone in inner.dirs.difference(&want).cloned().collect::<Vec<_>>() {
            let _ = inner.watcher.unwatch(&gone);
            inner.dirs.remove(&gone);
        }
        for new in want.difference(&inner.dirs.clone()) {
            if inner.watcher.watch(Path::new(new), RecursiveMode::NonRecursive).is_ok() {
                inner.dirs.insert(new.clone());
            }
        }
        *self.watched.lock().unwrap() = inner.dirs.clone();
        Ok(Empty {})
    }

    pub fn stop(&self) {
        self.inner.lock().unwrap().take();
        self.watched.lock().unwrap().clear();
    }
}
