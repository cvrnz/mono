use crate::proc::{clean, expand_home, home_dir, host_name, is_binary, login_shell, path_str, user_name};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{ErrorKind, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

const MAX_READ: u64 = 20 * 1024 * 1024;
const MAX_BYTES: u64 = 100 * 1024 * 1024;

fn err(e: std::io::Error, p: &Path) -> String {
    match e.kind() {
        ErrorKind::NotFound => format!("{} doesn't exist", p.display()),
        ErrorKind::PermissionDenied => format!("{}: permission denied", p.display()),
        _ => format!("{}: {e}", p.display()),
    }
}

fn base(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path_str(p))
}

#[derive(Deserialize)]
pub struct HelloArgs {
    root: Option<String>,
}

#[derive(Serialize)]
pub struct Hello {
    hostname: String,
    user: String,
    home: String,
    root: String,
    shell: String,
}

pub fn hello(a: HelloArgs) -> Result<Hello, String> {
    let home = home_dir();
    let asked = a.root.as_deref().map(str::trim).unwrap_or("");
    let root = if !asked.is_empty() {
        expand_home(asked)
    } else {
        match std::env::current_dir() {
            Ok(d) if d != Path::new("/") => d,
            _ => home.clone(),
        }
    };
    let root = if root.is_absolute() { root } else { std::env::current_dir().map(|d| d.join(&root)).unwrap_or(root) };
    if !root.is_dir() {
        return Err(format!("{} isn't a folder", root.display()));
    }
    Ok(Hello {
        hostname: host_name(),
        user: user_name(),
        home: path_str(&home),
        root: path_str(&clean(&root)),
        shell: login_shell(),
    })
}

#[derive(Deserialize)]
pub struct PathArgs {
    path: String,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    dir: bool,
    link: bool,
    size: u64,
}

pub fn list(a: PathArgs) -> Result<Vec<Entry>, String> {
    let dir = PathBuf::from(&a.path);
    let mut out: Vec<Entry> = fs::read_dir(&dir)
        .map_err(|e| err(e, &dir))?
        .filter_map(Result::ok)
        .map(|item| {
            let full = item.path();
            let meta = fs::symlink_metadata(&full).ok();
            let link = meta.as_ref().is_some_and(|m| m.file_type().is_symlink());
            let mut is_dir = meta.as_ref().is_some_and(|m| m.is_dir());
            if link {
                is_dir = fs::metadata(&full).is_ok_and(|m| m.is_dir());
            }
            Entry { name: item.file_name().to_string_lossy().into_owned(), dir: is_dir, link, size: meta.map_or(0, |m| m.len()) }
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[derive(Deserialize)]
pub struct ReadArgs {
    path: String,
    limit: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    content: String,
    binary: bool,
    too_large: bool,
    size: u64,
}

pub fn read(a: ReadArgs) -> Result<ReadResult, String> {
    let file = PathBuf::from(&a.path);
    let meta = fs::metadata(&file).map_err(|e| err(e, &file))?;
    if meta.is_dir() {
        return Err(format!("{} is a folder", file.display()));
    }
    let limit = a.limit.filter(|&l| l > 0 && l < MAX_READ).unwrap_or(MAX_READ);
    let size = meta.len();
    if size > limit {
        return Ok(ReadResult { content: String::new(), binary: false, too_large: true, size });
    }
    let data = fs::read(&file).map_err(|e| err(e, &file))?;
    if is_binary(&data) {
        return Ok(ReadResult { content: String::new(), binary: true, too_large: false, size });
    }
    Ok(ReadResult { content: String::from_utf8_lossy(&data).into_owned(), binary: false, too_large: false, size })
}

#[derive(Deserialize)]
pub struct BytesArgs {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BytesResult {
    data: String,
    too_large: bool,
    size: u64,
}

/// Reads a file as base64, for images, spreadsheets and slides.
pub fn read_bytes(a: BytesArgs) -> Result<BytesResult, String> {
    let file = PathBuf::from(&a.path);
    let meta = fs::metadata(&file).map_err(|e| err(e, &file))?;
    if meta.is_dir() {
        return Err(format!("{} is a folder", file.display()));
    }
    let size = meta.len();
    if size > MAX_BYTES {
        return Ok(BytesResult { data: String::new(), too_large: true, size });
    }
    let data = fs::read(&file).map_err(|e| err(e, &file))?;
    Ok(BytesResult { data: B64.encode(data), too_large: false, size })
}

#[derive(Deserialize)]
pub struct WriteArgs {
    path: String,
    content: String,
}

#[derive(Serialize)]
pub struct Empty {}

pub fn write(a: WriteArgs) -> Result<Empty, String> {
    let given = PathBuf::from(&a.path);
    let target = fs::canonicalize(&given).unwrap_or(given);
    let mut mode = 0o644;
    match fs::metadata(&target) {
        Ok(m) if m.is_dir() => return Err(format!("{} is a folder", target.display())),
        Ok(m) => mode = m.permissions().mode() & 0o777,
        Err(_) => {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| err(e, parent))?;
            }
        }
    }
    let parent = target.parent().unwrap_or(Path::new("/"));
    let tmp = parent.join(format!(".{}.{}.tmp", base(&target), std::process::id() ^ (std::time::UNIX_EPOCH.elapsed().map_or(0, |d| d.subsec_nanos()))));
    let opened = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp);
    let Ok(mut f) = opened else {
        fs::write(&target, &a.content).map_err(|e| err(e, &target))?;
        return Ok(Empty {});
    };
    let done = f
        .write_all(a.content.as_bytes())
        .and_then(|_| f.sync_all())
        .and_then(|_| fs::set_permissions(&tmp, fs::Permissions::from_mode(mode)))
        .and_then(|_| fs::rename(&tmp, &target));
    if let Err(e) = done {
        let _ = fs::remove_file(&tmp);
        return Err(err(e, &target));
    }
    Ok(Empty {})
}

#[derive(Deserialize)]
pub struct CreateArgs {
    path: String,
    dir: Option<bool>,
}

pub fn create(a: CreateArgs) -> Result<Empty, String> {
    let p = PathBuf::from(&a.path);
    if fs::symlink_metadata(&p).is_ok() {
        return Err(format!("{} already exists", base(&p)));
    }
    if a.dir.unwrap_or(false) {
        fs::create_dir_all(&p).map_err(|e| err(e, &p))?;
        return Ok(Empty {});
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| err(e, parent))?;
    }
    fs::OpenOptions::new().write(true).create_new(true).mode(0o644).open(&p).map_err(|e| err(e, &p))?;
    Ok(Empty {})
}

#[derive(Deserialize)]
pub struct RenameArgs {
    from: String,
    to: String,
}

pub fn rename(a: RenameArgs) -> Result<Empty, String> {
    let (from, to) = (PathBuf::from(&a.from), PathBuf::from(&a.to));
    if fs::symlink_metadata(&to).is_ok() {
        return Err(format!("{} already exists", base(&to)));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| err(e, parent))?;
    }
    fs::rename(&from, &to).map_err(|e| err(e, &from))?;
    Ok(Empty {})
}

pub fn copy(a: RenameArgs) -> Result<Empty, String> {
    let (from, to) = (clean(Path::new(&a.from)), clean(Path::new(&a.to)));
    if fs::symlink_metadata(&to).is_ok() {
        return Err(format!("{} already exists", base(&to)));
    }
    if to.starts_with(&from) {
        return Err(format!("can't copy {} into itself", base(&from)));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| err(e, parent))?;
    }
    copy_tree(&from, &to)?;
    Ok(Empty {})
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(from).map_err(|e| err(e, from))?;
    if meta.file_type().is_symlink() {
        let target = fs::read_link(from).map_err(|e| err(e, from))?;
        std::os::unix::fs::symlink(target, to).map_err(|e| err(e, to))?;
    } else if meta.is_dir() {
        fs::create_dir(to).map_err(|e| err(e, to))?;
        for entry in fs::read_dir(from).map_err(|e| err(e, from))? {
            let entry = entry.map_err(|e| err(e, from))?;
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        }
        fs::set_permissions(to, meta.permissions()).map_err(|e| err(e, to))?;
    } else {
        fs::copy(from, to).map_err(|e| err(e, from))?;
    }
    Ok(())
}

pub fn remove(a: PathArgs) -> Result<Empty, String> {
    let target = clean(Path::new(&a.path));
    if !target.is_absolute() || target.parent().is_none() {
        return Err(format!("refusing to delete {}", target.display()));
    }
    let meta = match fs::symlink_metadata(&target) {
        Ok(m) => m,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Empty {}),
        Err(e) => return Err(err(e, &target)),
    };
    let r = if meta.is_dir() { fs::remove_dir_all(&target) } else { fs::remove_file(&target) };
    r.map_err(|e| err(e, &target))?;
    Ok(Empty {})
}

#[derive(Serialize)]
pub struct Stat {
    exists: bool,
    dir: bool,
}

pub fn stat(a: PathArgs) -> Result<Stat, String> {
    let p = PathBuf::from(&a.path);
    match fs::metadata(&p) {
        Ok(m) => Ok(Stat { exists: true, dir: m.is_dir() }),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(Stat { exists: false, dir: false }),
        Err(e) => Err(err(e, &p)),
    }
}
