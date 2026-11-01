use std::ffi::CStr;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

pub struct Output {
    pub ok: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl Output {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

pub fn run(cmd: &str, args: &[&str], envs: &[(&str, &str)]) -> Output {
    let mut c = Command::new(cmd);
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (k, v) in envs {
        c.env(k, v);
    }
    match c.output() {
        Ok(o) => Output {
            ok: o.status.success(),
            stdout: o.stdout,
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Output {
            ok: false,
            stdout: vec![],
            stderr: format!("{cmd} isn't installed"),
        },
        Err(e) => Output { ok: false, stdout: vec![], stderr: e.to_string() },
    }
}

pub fn is_binary(data: &[u8]) -> bool {
    data[..data.len().min(8000)].contains(&0)
}

pub fn clean(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() && !p.is_absolute() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    }
}

pub fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

struct Passwd {
    name: String,
    home: String,
    shell: String,
}

fn passwd() -> Option<Passwd> {
    unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if pw.is_null() {
            return None;
        }
        let s = |p: *const libc::c_char| if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() };
        Some(Passwd { name: s((*pw).pw_name), home: s((*pw).pw_dir), shell: s((*pw).pw_shell) })
    }
}

pub fn user_name() -> String {
    std::env::var("USER").ok().filter(|u| !u.is_empty()).or_else(|| passwd().map(|p| p.name)).unwrap_or_default()
}

pub fn home_dir() -> PathBuf {
    if let Some(h) = std::env::var_os("HOME").filter(|h| !h.is_empty()) {
        return PathBuf::from(h);
    }
    passwd().map(|p| PathBuf::from(p.home)).filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| PathBuf::from("/"))
}

pub fn host_name() -> String {
    let mut buf = [0u8; 256];
    let ok = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) } == 0;
    if !ok {
        return String::new();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

pub fn login_shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        if !s.is_empty() && Path::new(&s).exists() {
            return s;
        }
    }
    if let Some(p) = passwd() {
        if !p.shell.is_empty() && Path::new(&p.shell).exists() && !p.shell.ends_with("nologin") && !p.shell.ends_with("/false") {
            return p.shell;
        }
    }
    let mut candidates = vec!["/bin/bash", "/usr/bin/bash", "/bin/ash", "/bin/sh"];
    if cfg!(target_os = "macos") {
        candidates.insert(0, "/bin/zsh");
    }
    candidates.into_iter().find(|s| Path::new(s).exists()).unwrap_or("sh").to_string()
}

pub fn expand_home(p: &str) -> PathBuf {
    if p == "~" {
        return home_dir();
    }
    if let Some(rest) = p.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(p)
}
