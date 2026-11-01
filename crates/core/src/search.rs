use crate::proc::path_str;
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::Lossy, BinaryDetection, SearcherBuilder};
use ignore::{WalkBuilder, WalkState};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_FILES: usize = 100_000;
const MAX_MATCHES: usize = 500;
const MAX_PER_FILE: usize = 50;
const MAX_COLUMNS: usize = 300;
const MAX_GREP_SIZE: u64 = 4 * 1024 * 1024;

fn walker(root: &Path) -> WalkBuilder {
    let mut w = WalkBuilder::new(root);
    w.hidden(false).filter_entry(|e| e.file_name() != ".git");
    w
}

fn relative(root: &Path, p: &Path) -> String {
    path_str(p.strip_prefix(root).unwrap_or(p))
}

#[derive(Deserialize)]
pub struct FilesArgs {
    root: String,
}

#[derive(Serialize)]
pub struct Files {
    files: Vec<String>,
    truncated: bool,
}

pub fn files(a: FilesArgs) -> Files {
    let root = PathBuf::from(&a.root);
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut out = Files { files: vec![], truncated: false };
    for entry in walker(&root).sort_by_file_name(|a, b| a.cmp(b)).build().filter_map(Result::ok) {
        if !entry.file_type().is_some_and(|t| t.is_file() || t.is_symlink()) {
            continue;
        }
        if out.files.len() >= MAX_FILES || Instant::now() > deadline {
            out.truncated = true;
            break;
        }
        out.files.push(relative(&root, entry.path()));
    }
    out
}

#[derive(Deserialize)]
pub struct GrepArgs {
    root: String,
    query: String,
}

#[derive(Serialize, Clone)]
pub struct Match {
    path: String,
    line: u64,
    col: usize,
    text: String,
}

#[derive(Serialize)]
pub struct Grep {
    matches: Vec<Match>,
    truncated: bool,
}

fn clip(line: &str) -> String {
    let line = line.trim_end_matches(['\r', '\n']);
    match line.char_indices().nth(MAX_COLUMNS) {
        Some((i, _)) => line[..i].to_string(),
        None => line.to_string(),
    }
}

pub fn grep(a: GrepArgs) -> Result<Grep, String> {
    let root = PathBuf::from(&a.root);
    if a.query.is_empty() {
        return Ok(Grep { matches: vec![], truncated: false });
    }
    let matcher = RegexMatcherBuilder::new()
        .case_smart(true)
        .fixed_strings(true)
        .build(&a.query)
        .map_err(|e| e.to_string())?;
    let found = Mutex::new(Vec::<Match>::new());
    let full = AtomicBool::new(false);
    let deadline = Instant::now() + Duration::from_secs(15);
    walker(&root).max_filesize(Some(MAX_GREP_SIZE)).build_parallel().run(|| {
        let matcher = matcher.clone();
        let mut searcher = SearcherBuilder::new().line_number(true).binary_detection(BinaryDetection::quit(0)).build();
        let (root, found, full) = (&root, &found, &full);
        Box::new(move |entry| {
            if full.load(Ordering::Relaxed) || Instant::now() > deadline {
                return WalkState::Quit;
            }
            let Ok(entry) = entry else { return WalkState::Continue };
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                return WalkState::Continue;
            }
            let rel = relative(root, entry.path());
            let mut mine = vec![];
            let _ = searcher.search_path(
                &matcher,
                entry.path(),
                Lossy(|line_number, line| {
                    let col = match matcher.find(line.as_bytes()) {
                        Ok(Some(m)) => line[..m.start()].chars().count() + 1,
                        _ => 1,
                    };
                    mine.push(Match { path: rel.clone(), line: line_number, col, text: clip(line) });
                    Ok(mine.len() < MAX_PER_FILE)
                }),
            );
            if mine.is_empty() {
                return WalkState::Continue;
            }
            let mut all = found.lock().unwrap();
            all.extend(mine);
            if all.len() >= MAX_MATCHES {
                full.store(true, Ordering::Relaxed);
                return WalkState::Quit;
            }
            WalkState::Continue
        })
    });
    let mut matches = found.into_inner().unwrap();
    matches.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    let truncated = matches.len() >= MAX_MATCHES;
    matches.truncate(MAX_MATCHES);
    Ok(Grep { matches, truncated })
}
