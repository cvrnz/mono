use crate::Service;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

type Events = Arc<Mutex<Vec<(String, Value)>>>;

fn service() -> (Service, Events) {
    let events: Events = Default::default();
    let sink = events.clone();
    (Service::new(Arc::new(move |e: &str, p: Value| sink.lock().unwrap().push((e.to_string(), p)))), events)
}

fn dir() -> (tempfile::TempDir, String) {
    let d = tempfile::tempdir().unwrap();
    let p = std::fs::canonicalize(d.path()).unwrap().to_string_lossy().into_owned();
    (d, p)
}

#[test]
fn files_create_write_read_list_rename_stat() {
    let (s, _) = service();
    let (_d, w) = dir();
    s.call("fs.create", json!({ "path": format!("{w}/sub"), "dir": true })).unwrap();
    s.call("fs.write", json!({ "path": format!("{w}/sub/a.txt"), "content": "héllo\n" })).unwrap();
    assert_eq!(
        s.call("fs.read", json!({ "path": format!("{w}/sub/a.txt") })).unwrap(),
        json!({ "content": "héllo\n", "binary": false, "tooLarge": false, "size": 7 })
    );
    let e = s.call("fs.create", json!({ "path": format!("{w}/sub/a.txt") })).unwrap_err();
    assert!(e.contains("a.txt already exists"), "{e}");
    std::fs::write(format!("{w}/Z.bin"), [1u8, 0, 2]).unwrap();
    assert_eq!(s.call("fs.read", json!({ "path": format!("{w}/Z.bin") })).unwrap()["binary"], json!(true));
    let list = s.call("fs.list", json!({ "path": w })).unwrap();
    let names: Vec<&str> = list.as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["sub", "Z.bin"]);
    s.call("fs.rename", json!({ "from": format!("{w}/sub/a.txt"), "to": format!("{w}/new/b.txt") })).unwrap();
    assert_eq!(s.call("fs.stat", json!({ "path": format!("{w}/new/b.txt") })).unwrap(), json!({ "exists": true, "dir": false }));
    assert_eq!(s.call("fs.stat", json!({ "path": format!("{w}/sub/a.txt") })).unwrap(), json!({ "exists": false, "dir": false }));
}

#[test]
fn delete_refuses_roots_and_relative_paths() {
    let (s, _) = service();
    let (_d, w) = dir();
    assert!(s.call("fs.delete", json!({ "path": "relative" })).unwrap_err().contains("refusing"));
    assert!(s.call("fs.delete", json!({ "path": "/" })).unwrap_err().contains("refusing"));
    assert!(s.call("fs.delete", json!({ "path": "/tmp/.." })).unwrap_err().contains("refusing"));
    s.call("fs.create", json!({ "path": format!("{w}/new/x"), "dir": true })).unwrap();
    s.call("fs.delete", json!({ "path": format!("{w}/new") })).unwrap();
    assert_eq!(s.call("fs.stat", json!({ "path": format!("{w}/new") })).unwrap()["exists"], json!(false));
}

#[test]
fn write_keeps_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let (s, _) = service();
    let (_d, w) = dir();
    let f = format!("{w}/run.sh");
    std::fs::write(&f, "a").unwrap();
    std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
    s.call("fs.write", json!({ "path": f, "content": "b" })).unwrap();
    assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o755);
    assert_eq!(std::fs::read_to_string(&f).unwrap(), "b");
}

#[test]
fn search_and_source_control_in_a_repo() {
    let (s, _) = service();
    let (_d, w) = dir();
    let repo = format!("{w}/repo");
    let git = |args: &[&str]| assert!(Command::new("git").arg("-C").arg(&repo).args(args).output().unwrap().status.success());
    assert!(Command::new("git").args(["init", "-q", &repo]).status().unwrap().success());
    git(&["config", "user.email", "t@example.com"]);
    git(&["config", "user.name", "t"]);
    std::fs::write(format!("{repo}/.gitignore"), "ignored.txt\n").unwrap();
    std::fs::write(format!("{repo}/one.txt"), "alpha\nNeedle here\n").unwrap();
    git(&["add", "."]);
    git(&["commit", "-qm", "first"]);
    std::fs::write(format!("{repo}/one.txt"), "alpha\nneedle changed\n").unwrap();
    std::fs::write(format!("{repo}/two.txt"), "xx needle\n").unwrap();
    std::fs::write(format!("{repo}/ignored.txt"), "needle\n").unwrap();

    let files = s.call("fs.files", json!({ "root": repo })).unwrap();
    let mut names: Vec<String> = serde_json::from_value(files["files"].clone()).unwrap();
    names.sort();
    assert_eq!(names, [".gitignore", "one.txt", "two.txt"]);
    let grep = s.call("fs.grep", json!({ "root": repo, "query": "needle" })).unwrap();
    let found: Vec<(String, u64, u64)> = grep["matches"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| (m["path"].as_str().unwrap().to_string(), m["line"].as_u64().unwrap(), m["col"].as_u64().unwrap()))
        .collect();
    assert_eq!(found, [("one.txt".to_string(), 2, 1), ("two.txt".to_string(), 1, 4)]);
    assert_eq!(s.call("fs.grep", json!({ "root": repo, "query": "Needle" })).unwrap()["matches"].as_array().unwrap().len(), 0);

    let repos = s.call("scm.repos", json!({ "roots": [w] })).unwrap();
    let info = &repos[0];
    assert_eq!(info["name"], json!("repo"));
    assert_eq!(info["count"], json!(2));
    assert_eq!(info["action"], Value::Null);
    let changes = s.call("scm.changes", json!({ "repo": info["path"] })).unwrap();
    assert_eq!(changes, json!([{ "status": "M", "path": "one.txt" }, { "status": "U", "path": "two.txt" }]));
    let v = s.call("scm.versions", json!({ "repo": info["path"], "change": changes[0] })).unwrap();
    assert_eq!(v["old"]["content"], json!("alpha\nNeedle here\n"));
    assert_eq!(v["new"]["content"], json!("alpha\nneedle changed\n"));
}

#[test]
fn a_terminal_runs_a_command_and_reports_its_exit() {
    let (s, events) = service();
    let (_d, w) = dir();
    let opened = s.call("term.open", json!({ "cols": 80, "rows": 24, "cwd": w })).unwrap();
    let id = opened["id"].as_str().unwrap().to_string();
    s.call("term.resize", json!({ "id": id, "cols": 100, "rows": 30 })).unwrap();
    s.call("term.input", json!({ "id": id, "data": B64.encode("echo mono$(echo myth)\rexit\r") })).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while !events.lock().unwrap().iter().any(|(e, p)| e == "term.exit" && p["id"] == json!(id)) {
        assert!(Instant::now() < deadline, "the shell didn't exit");
        std::thread::sleep(Duration::from_millis(50));
    }
    let output: Vec<u8> = events
        .lock()
        .unwrap()
        .iter()
        .filter(|(e, p)| e == "term.data" && p["id"] == json!(id))
        .flat_map(|(_, p)| B64.decode(p["data"].as_str().unwrap()).unwrap())
        .collect();
    assert!(String::from_utf8_lossy(&output).contains("monomyth"));
    assert!(s.call("term.input", json!({ "id": id, "data": "" })).unwrap_err().contains("no terminal"));
}

#[test]
fn repos_are_found_to_the_chosen_depth() {
    let (s, _) = service();
    let (_d, w) = dir();
    for repo in ["a", "x/y/z/deep", "x/y/z/deep/inner", ".hidden/r", "node_modules/r", "Library/r", "five/b/c/d/e"] {
        std::fs::create_dir_all(format!("{w}/{repo}/.git")).unwrap();
    }
    let names = |depth: Value| -> Vec<String> {
        let list = s.call("scm.repos", json!({ "roots": [w], "depth": depth })).unwrap();
        list.as_array().unwrap().iter().map(|r| r["name"].as_str().unwrap().to_string()).collect()
    };
    assert_eq!(names(Value::Null), ["a", "x/y/z/deep"]);
    assert_eq!(names(json!(5)), ["a", "five/b/c/d/e", "x/y/z/deep", "x/y/z/deep/inner"]);
    assert_eq!(names(json!(1)), ["a"]);
}
