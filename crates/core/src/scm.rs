use crate::proc::{clean, is_binary, path_str, run, Output};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn git(repo: &Path, quiet: bool, args: &[&str]) -> Output {
    let repo = path_str(repo);
    let mut all = vec!["-C", repo.as_str()];
    all.extend_from_slice(args);
    let mut envs = vec![];
    if quiet {
        envs.push(("GIT_TERMINAL_PROMPT", "0"));
        if std::env::var_os("GIT_SSH_COMMAND").is_none() {
            envs.push(("GIT_SSH_COMMAND", "ssh -o BatchMode=yes"));
        }
    }
    run("git", &all, &envs)
}

pub fn root_of(dir: &Path) -> Option<PathBuf> {
    let r = git(dir, false, &["rev-parse", "--show-toplevel"]);
    let top = r.text().trim().to_string();
    (r.ok && !top.is_empty()).then(|| clean(Path::new(&top)))
}

pub const DEFAULT_DEPTH: usize = 4;

fn find_repos(folder: &Path, max: usize) -> Vec<PathBuf> {
    let above = root_of(folder);
    let mut repos: Vec<PathBuf> = above.iter().cloned().collect();
    fn walk(dir: &Path, depth: usize, max: usize, above: &Option<PathBuf>, repos: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        let mut dirs = vec![];
        for e in entries.filter_map(Result::ok) {
            let name = e.file_name();
            if name == ".git" {
                let d = clean(dir);
                if above.as_ref() != Some(&d) {
                    repos.push(d);
                }
                continue;
            }
            let skip = name.to_string_lossy().starts_with('.') || name == "node_modules" || (depth == 0 && name == "Library");
            if depth < max && !skip && e.file_type().is_ok_and(|t| t.is_dir()) {
                dirs.push(e.path());
            }
        }
        for d in dirs {
            walk(&d, depth + 1, max, above, repos);
        }
    }
    walk(folder, 0, max, &above, &mut repos);
    repos
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Change {
    status: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    old: Option<String>,
}

fn changes(repo: &Path) -> Vec<Change> {
    let r = git(repo, false, &["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    let text = r.text();
    let fields: Vec<&str> = text.split('\0').collect();
    let mut list = vec![];
    let mut i = 0;
    while i < fields.len() {
        let f = fields[i];
        i += 1;
        if f.len() < 4 {
            continue;
        }
        let xy = &f[..2];
        let status = if xy == "??" { "U".to_string() } else { xy.trim().chars().next().map(String::from).unwrap_or_default() };
        let mut c = Change { status, path: f[3..].to_string(), old: None };
        if xy.contains(['R', 'C']) && i < fields.len() {
            c.old = Some(fields[i].to_string());
            i += 1;
        }
        list.push(c);
    }
    list.sort_by(|a, b| a.path.cmp(&b.path));
    list
}

fn branch(repo: &Path) -> String {
    let name = git(repo, false, &["branch", "--show-current"]).text().trim().to_string();
    if !name.is_empty() {
        return name;
    }
    let unborn = git(repo, false, &["symbolic-ref", "--short", "--quiet", "HEAD"]).text().trim().to_string();
    if !unborn.is_empty() {
        return unborn;
    }
    let sha = git(repo, false, &["rev-parse", "--short", "HEAD"]).text().trim().to_string();
    if sha.is_empty() {
        String::new()
    } else {
        format!("detached at {sha}")
    }
}

#[derive(Serialize, Clone, Copy)]
pub struct Counts {
    ahead: u32,
    behind: u32,
}

fn sync_of(repo: &Path) -> Option<Counts> {
    let r = git(repo, false, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    if !r.ok {
        return None;
    }
    let text = r.text();
    let mut it = text.split_whitespace().map(|n| n.parse::<u32>());
    match (it.next(), it.next()) {
        (Some(Ok(ahead)), Some(Ok(behind))) => Some(Counts { ahead, behind }),
        _ => None,
    }
}

fn remote_of(repo: &Path) -> String {
    git(repo, false, &["remote"]).text().lines().next().unwrap_or("").trim().to_string()
}

fn arrows(s: Option<Counts>) -> String {
    let Some(s) = s else { return String::new() };
    let mut parts = vec![];
    if s.behind > 0 {
        parts.push(format!("↓{}", s.behind));
    }
    if s.ahead > 0 {
        parts.push(format!("↑{}", s.ahead));
    }
    parts.join(" ")
}

fn plural(n: u32, word: &str) -> String {
    if n == 1 {
        format!("1 {word}")
    } else {
        format!("{n} {word}s")
    }
}

#[derive(Serialize)]
pub struct Action {
    label: String,
    verb: &'static str,
    done: &'static str,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    dim: bool,
    #[serde(skip)]
    steps: Vec<Vec<String>>,
    #[serde(skip)]
    fetch: bool,
}

fn action_for(s: Option<Counts>, remote: &str) -> Option<Action> {
    let act = |label: String, verb, done, steps: Vec<Vec<&str>>| Action {
        label,
        verb,
        done,
        dim: false,
        steps: steps.into_iter().map(|s| s.into_iter().map(String::from).collect()).collect(),
        fetch: false,
    };
    let Some(s) = s else {
        if remote.is_empty() {
            return None;
        }
        return Some(act("↑ Publish branch".into(), "Publishing", "Published", vec![vec!["push", "--set-upstream", remote, "HEAD"]]));
    };
    Some(if s.behind > 0 && s.ahead > 0 {
        act(format!("⇅ Sync changes  {}", arrows(Some(s))), "Syncing", "Synced", vec![vec!["pull"], vec!["push"]])
    } else if s.behind > 0 {
        act(format!("↓ Pull {}", plural(s.behind, "commit")), "Pulling", "Pulled", vec![vec!["pull"]])
    } else if s.ahead > 0 {
        act(format!("↑ Push {}", plural(s.ahead, "commit")), "Pushing", "Pushed", vec![vec!["push"]])
    } else {
        Action { label: "✓ Up to date".into(), verb: "Checking", done: "Up to date", dim: true, steps: vec![], fetch: true }
    })
}

fn pull_args(repo: &Path) -> Vec<String> {
    let configured = git(repo, false, &["config", "pull.rebase"]).ok || git(repo, false, &["config", "pull.ff"]).ok;
    let mut args = vec!["pull".to_string(), "--no-edit".into()];
    if !configured {
        args.push("--no-rebase".into());
    }
    args
}

#[derive(Serialize)]
pub struct Info {
    path: String,
    name: String,
    branch: String,
    sync: Option<Counts>,
    arrows: String,
    remote: String,
    count: usize,
    action: Option<Action>,
}

fn info_of(repo: &Path, name: &str) -> Info {
    let (br, sync, remote, list) = std::thread::scope(|s| {
        let a = s.spawn(|| branch(repo));
        let b = s.spawn(|| sync_of(repo));
        let c = s.spawn(|| remote_of(repo));
        let list = changes(repo);
        (a.join().unwrap_or_default(), b.join().unwrap_or(None), c.join().unwrap_or_default(), list)
    });
    Info {
        path: path_str(repo),
        name: name.to_string(),
        branch: br,
        sync,
        arrows: arrows(sync),
        action: action_for(sync, &remote),
        remote,
        count: list.len(),
    }
}

#[derive(Deserialize)]
pub struct ReposArgs {
    roots: Option<Vec<String>>,
    depth: Option<usize>,
}

pub fn repos(a: ReposArgs) -> Vec<Info> {
    let mut all: Vec<(PathBuf, String)> = vec![];
    let mut seen = HashSet::new();
    let depth = a.depth.unwrap_or(DEFAULT_DEPTH).min(12);
    for r in a.roots.unwrap_or_default() {
        let root = PathBuf::from(&r);
        for repo in find_repos(&root, depth) {
            if !seen.insert(repo.clone()) {
                continue;
            }
            let name = match repo.strip_prefix(&root) {
                Ok(rel) if !rel.as_os_str().is_empty() => path_str(rel),
                _ => repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path_str(&repo)),
            };
            all.push((repo, name));
        }
    }
    let mut out: Vec<Info> = std::thread::scope(|s| {
        let handles: Vec<_> = all.iter().map(|(repo, name)| s.spawn(move || info_of(repo, name))).collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[derive(Deserialize)]
pub struct RepoArgs {
    repo: String,
}

pub fn changes_of(a: RepoArgs) -> Vec<Change> {
    changes(Path::new(&a.repo))
}

#[derive(Deserialize)]
pub struct VersionsArgs {
    repo: String,
    change: Change,
}

#[derive(Serialize)]
pub struct Version {
    content: String,
    binary: bool,
}

#[derive(Serialize)]
pub struct Versions {
    old: Version,
    new: Version,
}

fn version(data: &[u8]) -> Version {
    if is_binary(data) {
        Version { content: "(binary file)".into(), binary: true }
    } else {
        Version { content: String::from_utf8_lossy(data).into_owned(), binary: false }
    }
}

pub fn versions(a: VersionsArgs) -> Versions {
    let repo = PathBuf::from(&a.repo);
    let c = &a.change;
    let empty = || Version { content: String::new(), binary: false };
    let mut old = empty();
    let mut new = empty();
    if c.status != "U" && c.status != "A" && git(&repo, false, &["rev-parse", "--verify", "--quiet", "HEAD"]).ok {
        let spec = format!("HEAD:{}", c.old.as_deref().unwrap_or(&c.path));
        let r = git(&repo, false, &["show", &spec]);
        if r.ok {
            old = version(&r.stdout);
        }
    }
    if c.status != "D" {
        if let Ok(data) = fs::read(repo.join(&c.path)) {
            new = version(&data);
        }
    }
    Versions { old, new }
}

#[derive(Deserialize)]
pub struct FetchArgs {
    repo: String,
    name: String,
}

pub fn fetch(a: FetchArgs) -> Result<Info, String> {
    let repo = PathBuf::from(&a.repo);
    let r = git(&repo, true, &["fetch", "--quiet", "--no-tags"]);
    if !r.ok {
        return Err(r.stderr.trim().to_string());
    }
    Ok(info_of(&repo, &a.name))
}

#[derive(Serialize)]
pub struct Empty {}

pub fn sync(a: RepoArgs) -> Result<Empty, String> {
    let repo = PathBuf::from(&a.repo);
    let Some(action) = action_for(sync_of(&repo), &remote_of(&repo)) else {
        return Err("this branch has no remote to sync with".into());
    };
    if action.fetch {
        let r = git(&repo, true, &["fetch", "--quiet", "--no-tags"]);
        if !r.ok {
            return Err(r.stderr.trim().to_string());
        }
        return Ok(Empty {});
    }
    for step in action.steps {
        let step = if step[0] == "pull" { pull_args(&repo) } else { step };
        let args: Vec<&str> = step.iter().map(String::as_str).collect();
        let r = git(&repo, true, &args);
        if !r.ok {
            return Err(format!("git {}: {}", step.join(" "), format!("{}{}", r.stderr, r.text()).trim()));
        }
    }
    Ok(Empty {})
}

#[derive(Deserialize)]
pub struct LogArgs {
    repo: String,
    limit: Option<usize>,
}

#[derive(Serialize)]
pub struct Commit {
    hash: String,
    short: String,
    author: String,
    time: i64,
    subject: String,
    refs: String,
}

pub fn log(a: LogArgs) -> Vec<Commit> {
    let limit = format!("-{}", a.limit.unwrap_or(200).min(2000));
    let r = git(Path::new(&a.repo), false, &["log", &limit, "--format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%D%x1e"]);
    if !r.ok {
        return vec![];
    }
    r.text()
        .split('\x1e')
        .filter_map(|rec| {
            let f: Vec<&str> = rec.trim_start_matches('\n').split('\x1f').collect();
            let [hash, short, author, time, subject, refs] = f[..] else { return None };
            Some(Commit {
                hash: hash.into(),
                short: short.into(),
                author: author.into(),
                time: time.parse().unwrap_or(0),
                subject: subject.into(),
                refs: refs.into(),
            })
        })
        .collect()
}

#[derive(Deserialize)]
pub struct ShowArgs {
    repo: String,
    hash: String,
}

#[derive(Serialize)]
pub struct Shown {
    text: String,
}

const MAX_SHOW: usize = 4 * 1024 * 1024;

pub fn show(a: ShowArgs) -> Result<Shown, String> {
    if a.hash.starts_with('-') {
        return Err("not a commit".into());
    }
    let r = git(Path::new(&a.repo), false, &["show", "--stat", "--patch", "--format=fuller", "--no-color", &a.hash, "--"]);
    if !r.ok {
        return Err(r.stderr.trim().to_string());
    }
    let mut text = r.text();
    if text.len() > MAX_SHOW {
        let mut end = MAX_SHOW;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n… (cut off, too large to show)\n");
    }
    Ok(Shown { text })
}
