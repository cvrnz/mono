#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod docker;
mod shell;
mod sql;
mod theme_repos;

use mono_core::Service;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

enum Conn {
    Local(Arc<Service>),
    Docker(Arc<docker::Agent>),
}

impl Conn {
    fn close(&self) {
        match self {
            Conn::Local(s) => s.close(),
            Conn::Docker(a) => a.close(),
        }
    }
}

#[derive(Default)]
struct App {
    conns: Mutex<HashMap<String, Arc<Conn>>>,
    starting: Mutex<HashMap<String, u64>>,
    next: AtomicU64,
    sql: sql::Sql,
    dirty: AtomicBool,
    can_quit: AtomicBool,
}

#[derive(Deserialize)]
struct Target {
    kind: String,
    container: Option<String>,
}

fn config_dir(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."))
}

// Mono used to be called Monomyth; keep its settings and themes.
fn move_old_config(app: &AppHandle) {
    let dir = config_dir(app);
    let Some(old) = dir.parent().map(|p| p.join("dev.monomyth.app")) else { return };
    if !dir.exists() && old.is_dir() {
        let _ = std::fs::rename(old, dir);
    }
}

fn settings_path(app: &AppHandle) -> PathBuf {
    config_dir(app).join("settings.json")
}

fn read_settings(app: &AppHandle) -> String {
    std::fs::read_to_string(settings_path(app)).ok().filter(|s| serde_json::from_str::<Value>(s).is_ok()).unwrap_or_else(|| "{}".into())
}

fn docker_path(app: &AppHandle) -> String {
    serde_json::from_str::<Value>(&read_settings(app))
        .ok()
        .and_then(|v| v["dockerPath"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from))
        .unwrap_or_else(|| "docker".into())
}

fn agents_dir(app: &AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().map(|d| d.join("agent")).ok();
    match bundled {
        Some(d) if d.join("mono-agent-arm64").exists() => d,
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/agent"),
    }
}

#[tauri::command]
fn settings(app: AppHandle) -> String {
    read_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, data: String) -> Result<(), String> {
    serde_json::from_str::<Value>(&data).map_err(|_| "settings aren't valid JSON".to_string())?;
    let path = settings_path(&app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn hide_window_buttons(w: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    let Ok(ptr) = w.ns_window() else { return };
    let window = unsafe { &*(ptr as *const NSWindow) };
    for b in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
        if let Some(button) = window.standardWindowButton(b) {
            button.setHidden(true);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn hide_window_buttons(_: &tauri::WebviewWindow) {}

#[tauri::command]
fn themes(app: AppHandle) -> Vec<Value> {
    theme_files(&config_dir(&app).join("themes")).into_iter().map(|(file, text)| json!({ "file": file, "text": text })).collect()
}

#[tauri::command]
async fn theme_install(app: AppHandle, repo: String) -> Result<bool, String> {
    theme_repos::install(&config_dir(&app).join("themes"), &repo).await
}

#[tauri::command]
async fn theme_update(app: AppHandle, repo: String) -> Result<(), String> {
    theme_repos::update(&config_dir(&app).join("themes"), &repo).await
}

#[tauri::command]
async fn theme_remove(app: AppHandle, repo: String) -> Result<(), String> {
    theme_repos::remove(&config_dir(&app).join("themes"), &repo).await
}

fn theme_files(dir: &std::path::Path) -> Vec<(String, String)> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    let mut found: Vec<(String, PathBuf)> = vec![];
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            let Ok(inner) = std::fs::read_dir(&path) else { continue };
            for file in inner.filter_map(Result::ok) {
                let inner_name = file.file_name().to_string_lossy().into_owned();
                if inner_name.to_lowercase().ends_with(".json") && file.path().is_file() {
                    found.push((format!("{name}/{inner_name}"), file.path()));
                }
            }
        } else if name.to_lowercase().ends_with(".json") {
            found.push((name, path));
        }
    }
    found.sort();
    found
        .into_iter()
        .filter_map(|(shown, path)| {
            let text = std::fs::read_to_string(path).ok().filter(|t| !t.is_empty())?;
            let file = shown.rsplit('/').next().unwrap_or(&shown).to_string();
            Some((file, text))
        })
        .collect()
}

#[cfg(test)]
mod theme_tests {
    #[test]
    fn reads_themes_and_cloned_theme_repos() {
        let dir = std::env::temp_dir().join(format!("mono-themes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("monomyth-dark/.git")).unwrap();
        std::fs::write(dir.join("mine.json"), "{}").unwrap();
        std::fs::write(dir.join("monomyth-dark/monomyth-dark.json"), "{\"name\":\"monomyth-dark\"}").unwrap();
        std::fs::write(dir.join("monomyth-dark/README.md"), "x").unwrap();
        std::fs::write(dir.join("monomyth-dark/.git/config.json"), "{}").unwrap();
        let files: Vec<String> = super::theme_files(&dir).into_iter().map(|(f, _)| f).collect();
        assert_eq!(files, ["mine.json", "monomyth-dark.json"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[tauri::command]
fn platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    }
}

#[tauri::command]
async fn docker_containers(app: AppHandle) -> Result<Vec<docker::Container>, String> {
    docker::containers(&docker_path(&app)).await
}

#[tauri::command]
async fn connect(app: AppHandle, state: State<'_, App>, target: Target, conn: String) -> Result<(), String> {
    disconnect_conn(&state, &conn);
    let token = state.next.fetch_add(1, Ordering::Relaxed);
    state.starting.lock().unwrap().insert(conn.clone(), token);
    let id = conn.clone();
    let emitter = app.clone();
    let on_event = move |event: &str, params: Value| {
        let _ = emitter.emit("agent:event", json!({ "conn": id, "event": event, "params": params }));
    };
    let made = match target.kind.as_str() {
        "local" => {
            let _ = app.emit("agent:status", json!({ "conn": conn, "status": "Opening…" }));
            Ok(Conn::Local(Arc::new(Service::new(Arc::new(on_event)))))
        }
        "docker" => {
            let container = target.container.clone().filter(|c| !c.is_empty()).ok_or("pick a container")?;
            let (a, id) = (app.clone(), conn.clone());
            let status = move |s: &str| {
                let _ = a.emit("agent:status", json!({ "conn": id, "status": s }));
            };
            let (a, id) = (app.clone(), conn.clone());
            let on_close = move |why: String| {
                let state = a.state::<App>();
                let mut conns = state.conns.lock().unwrap();
                if let Some(Conn::Docker(_)) = conns.get(&id).map(|c| c.as_ref()) {
                    conns.remove(&id);
                    let _ = a.emit("agent:closed", json!({ "conn": id, "error": why }));
                }
            };
            docker::Agent::start(&docker_path(&app), &container, agents_dir(&app), Box::new(status), Box::new(on_event), Box::new(on_close))
                .await
                .map(|a| Conn::Docker(Arc::new(a)))
        }
        _ => Err("unknown kind of project".into()),
    };
    let wanted = {
        let mut starting = state.starting.lock().unwrap();
        let mine = starting.get(&conn) == Some(&token);
        if mine {
            starting.remove(&conn);
        }
        mine
    };
    let made = made?;
    if !wanted {
        made.close();
        return Err("disconnected".into());
    }
    state.conns.lock().unwrap().insert(conn, Arc::new(made));
    Ok(())
}

fn disconnect_conn(state: &App, conn: &str) {
    state.starting.lock().unwrap().remove(conn);
    if let Some(c) = state.conns.lock().unwrap().remove(conn) {
        c.close();
    }
}

#[tauri::command]
fn disconnect(state: State<'_, App>, conn: String) {
    disconnect_conn(&state, &conn);
}

async fn conn_call(c: &Conn, method: &str, params: Value) -> Result<Value, String> {
    match c {
        Conn::Local(s) => {
            let (s, method) = (s.clone(), method.to_string());
            tauri::async_runtime::spawn_blocking(move || s.call(&method, params)).await.map_err(|e| e.to_string())?
        }
        Conn::Docker(a) => a.call(method, params).await,
    }
}

#[tauri::command]
async fn call(state: State<'_, App>, conn: String, method: String, params: Value) -> Result<Value, String> {
    let c = state.conns.lock().unwrap().get(&conn).cloned().ok_or("not connected")?;
    conn_call(&c, &method, params).await
}

/// "notes.txt" → "notes copy.txt", then "notes copy 2.txt", the way Finder names duplicates.
async fn free_name(c: &Conn, dir: &str, name: &str) -> Result<String, String> {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 0..1000 {
        let candidate = match n {
            0 => name.to_string(),
            1 => format!("{stem} copy{ext}"),
            _ => format!("{stem} copy {n}{ext}"),
        };
        let path = format!("{}/{candidate}", dir.trim_end_matches('/'));
        let stat = conn_call(c, "fs.stat", json!({ "path": path })).await?;
        if stat["exists"] != Value::Bool(true) {
            return Ok(path);
        }
    }
    Err(format!("couldn't find a free name for {name}"))
}

/// Copies files dropped from the desktop into a folder of the project.
#[tauri::command]
async fn drop_files(state: State<'_, App>, conn: String, paths: Vec<String>, dir: String) -> Result<Vec<String>, String> {
    let c = state.conns.lock().unwrap().get(&conn).cloned().ok_or("not connected")?;
    let mut made = vec![];
    for from in paths {
        let name = std::path::Path::new(&from).file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("can't copy that")?;
        let to = free_name(&c, &dir, &name).await?;
        match c.as_ref() {
            Conn::Local(_) => {
                conn_call(&c, "fs.copy", json!({ "from": from, "to": to })).await?;
            }
            Conn::Docker(a) => {
                docker::run(&a.docker, &["cp", "--", &from, &format!("{}:{to}", a.container)]).await?;
            }
        }
        made.push(to);
    }
    Ok(made)
}

#[tauri::command]
async fn sql_connect(state: State<'_, App>, id: String, config: sql::Config) -> Result<sql::Info, String> {
    state.sql.connect(&id, config).await
}

#[tauri::command]
async fn sql_query(state: State<'_, App>, id: String, text: String) -> Result<sql::Timed, String> {
    state.sql.query(&id, &text).await
}

#[tauri::command]
async fn sql_cancel(state: State<'_, App>, id: String) -> Result<(), String> {
    state.sql.cancel(&id).await
}

#[tauri::command]
async fn sql_databases(state: State<'_, App>, id: String) -> Result<Vec<sql::Database>, String> {
    state.sql.databases(&id).await
}

#[tauri::command]
async fn sql_objects(state: State<'_, App>, id: String, database: String) -> Result<Vec<sql::Object>, String> {
    state.sql.objects(&id, &database).await
}

#[tauri::command]
async fn sql_columns(state: State<'_, App>, id: String, database: String, schema: String, table: String) -> Result<Vec<sql::Column>, String> {
    state.sql.columns(&id, &database, &schema, &table).await
}

#[tauri::command]
async fn sql_disconnect(state: State<'_, App>, id: String) -> Result<(), String> {
    state.sql.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
fn set_dirty(state: State<'_, App>, dirty: bool) {
    state.dirty.store(dirty, Ordering::Relaxed);
}

#[tauri::command]
fn request_close(app: AppHandle) {
    ask_page(&app);
}

#[tauri::command]
fn quit(app: AppHandle) {
    quit_now(&app);
}

fn ask_page(app: &AppHandle) -> bool {
    let state = app.state::<App>();
    if state.can_quit.load(Ordering::Relaxed) {
        return false;
    }
    let _ = app.emit("app:quit-requested", ());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let state = app.state::<App>();
        if !state.dirty.load(Ordering::Relaxed) && !state.can_quit.load(Ordering::Relaxed) {
            quit_now(&app);
        }
    });
    true
}

fn quit_now(app: &AppHandle) {
    let state = app.state::<App>();
    state.can_quit.store(true, Ordering::Relaxed);
    let conns: Vec<_> = state.conns.lock().unwrap().drain().map(|(_, c)| c).collect();
    conns.iter().for_each(|c| c.close());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tokio::time::timeout(Duration::from_secs(2), app.state::<App>().sql.close_all()).await;
        app.exit(0);
    });
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Mono", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "Mono",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

fn main() {
    shell::use_login_path();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(App::default())
        .menu(menu)
        .on_menu_event(|app, e| if e.id().as_ref() == "quit" {
            ask_page(app);
        })
        .setup(|app| {
            move_old_config(app.handle());
            if let Some(w) = app.get_webview_window("main") {
                hide_window_buttons(&w);
            }
            Ok(())
        })
        .on_window_event(|w, e| {
            if matches!(e, WindowEvent::Resized(_) | WindowEvent::Focused(_)) {
                if let Some(w) = w.app_handle().get_webview_window(w.label()) {
                    hide_window_buttons(&w);
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = e {
                if ask_page(w.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings,
            save_settings,
            themes,
            theme_install,
            theme_update,
            theme_remove,
            platform,
            docker_containers,
            connect,
            disconnect,
            call,
            drop_files,
            sql_connect,
            sql_query,
            sql_cancel,
            sql_databases,
            sql_objects,
            sql_columns,
            sql_disconnect,
            set_dirty,
            request_close,
            quit,
        ])
        .build(tauri::generate_context!())
        .expect("couldn't start Mono");
    app.run(|app, e| {
        if let RunEvent::ExitRequested { api, code, .. } = e {
            if code.is_none() && ask_page(app) {
                api.prevent_exit();
            }
        }
    });
}
