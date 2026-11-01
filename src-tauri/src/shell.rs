use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn use_login_path() {
    let shell = mono_core::login_shell();
    let mark = "__mono_path__";
    let Ok(mut child) = Command::new(&shell)
        .args(["-ilc", &format!("printf '{mark}%s{mark}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                return;
            }
        }
    }
    let Ok(out) = child.wait_with_output() else { return };
    let text = String::from_utf8_lossy(&out.stdout);
    if let Some(path) = text.split(mark).nth(1).filter(|p| !p.is_empty()) {
        std::env::set_var("PATH", path);
    }
}
