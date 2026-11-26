use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

fn valid(part: &str) -> bool {
    !part.is_empty() && !part.starts_with('.') && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub fn source(spec: &str) -> Result<(String, String), String> {
    let spec = spec.trim().trim_end_matches('/');
    let bad = || format!("“{spec}” isn't a theme repo; use owner/repo, like cvrnz/monomyth-dark-theme");
    if spec.contains("://") || spec.starts_with("git@") {
        let last = spec.rsplit(['/', ':']).next().unwrap_or("");
        let folder = last.strip_suffix(".git").unwrap_or(last);
        return if valid(folder) { Ok((spec.to_string(), folder.to_string())) } else { Err(bad()) };
    }
    match spec.split('/').collect::<Vec<_>>()[..] {
        [owner, repo] if valid(owner) && valid(repo) => {
            let repo = repo.strip_suffix(".git").unwrap_or(repo);
            Ok((format!("https://github.com/{owner}/{repo}.git"), repo.to_string()))
        }
        _ => Err(bad()),
    }
}

async fn git(args: &[&str]) -> Result<(), String> {
    let out = Command::new("git")
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "couldn't find git; install it to download themes".to_string() } else { e.to_string() })?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let line = err.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("git failed");
    Err(line.trim_start_matches("fatal: ").to_string())
}

fn target(dir: &Path, spec: &str) -> Result<(String, PathBuf), String> {
    let (url, folder) = source(spec)?;
    Ok((url, dir.join(folder)))
}

pub async fn install(dir: &Path, spec: &str) -> Result<bool, String> {
    let (url, path) = target(dir, spec)?;
    if path.join(".git").is_dir() {
        return Ok(false);
    }
    if path.exists() {
        return Err(format!("{} already exists and isn't a git clone", path.display()));
    }
    tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    let to = path.to_string_lossy();
    if let Err(e) = git(&["clone", "--depth", "1", "--quiet", &url, &to]).await {
        let _ = tokio::fs::remove_dir_all(&path).await;
        return Err(format!("couldn't download {spec}: {e}"));
    }
    if git(&["-C", &to, "rev-parse", "--verify", "--quiet", "HEAD"]).await.is_err() {
        let _ = tokio::fs::remove_dir_all(&path).await;
        return Err(format!("{spec} is empty"));
    }
    Ok(true)
}

pub async fn update(dir: &Path, spec: &str) -> Result<(), String> {
    let (_, path) = target(dir, spec)?;
    if !path.join(".git").is_dir() {
        return install(dir, spec).await.map(|_| ());
    }
    let at = path.to_string_lossy();
    git(&["-C", &at, "pull", "--ff-only", "--quiet"]).await.map_err(|e| format!("couldn't update {spec}: {e}"))
}

pub async fn remove(dir: &Path, spec: &str) -> Result<(), String> {
    let (_, path) = target(dir, spec)?;
    match tokio::fs::remove_dir_all(&path).await {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_repo_names() {
        assert_eq!(source("cvrnz/monomyth-dark-theme").unwrap(), ("https://github.com/cvrnz/monomyth-dark-theme.git".into(), "monomyth-dark-theme".into()));
        assert_eq!(source(" a/b.git ").unwrap().1, "b");
        assert_eq!(source("file:///tmp/x/my-theme.git").unwrap(), ("file:///tmp/x/my-theme.git".into(), "my-theme".into()));
        assert_eq!(source("git@github.com:a/b.git").unwrap().1, "b");
        for bad in ["", "a", "a/b/c", "../b", "a/..", "a/.git", "a b/c", "file:///tmp/.."] {
            assert!(source(bad).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn installs_updates_and_removes() {
        let root = std::env::temp_dir().join(format!("mm-theme-repos-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let origin = root.join("origin/fancy-theme");
        std::fs::create_dir_all(&origin).unwrap();
        let o = origin.to_string_lossy().to_string();
        let run = |args: &[&str]| assert!(std::process::Command::new("git").args(args).output().unwrap().status.success());
        run(&["init", "-q", &o]);
        std::fs::write(origin.join("fancy.json"), "{}").unwrap();
        run(&["-C", &o, "add", "."]);
        run(&["-C", &o, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one"]);

        let themes = root.join("themes");
        let spec = format!("file://{o}");
        assert!(install(&themes, &spec).await.unwrap());
        assert!(!install(&themes, &spec).await.unwrap());
        assert_eq!(std::fs::read_to_string(themes.join("fancy-theme/fancy.json")).unwrap(), "{}");

        std::fs::write(origin.join("fancy.json"), "{\"v\":2}").unwrap();
        run(&["-C", &o, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "two"]);
        update(&themes, &spec).await.unwrap();
        assert_eq!(std::fs::read_to_string(themes.join("fancy-theme/fancy.json")).unwrap(), "{\"v\":2}");

        assert!(install(&themes, &format!("file://{}/nope.git", root.display())).await.is_err());
        assert!(!themes.join("nope").exists());

        let empty = root.join("origin/empty-theme");
        run(&["init", "-q", &empty.to_string_lossy()]);
        assert!(install(&themes, &format!("file://{}", empty.display())).await.unwrap_err().contains("empty"));
        assert!(!themes.join("empty-theme").exists());

        remove(&themes, &spec).await.unwrap();
        assert!(!themes.join("fancy-theme").exists());
        remove(&themes, &spec).await.unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }
}
