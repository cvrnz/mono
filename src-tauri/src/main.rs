#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod docker;
mod shell;
mod sql;

use monomyth_core::Service;
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
        Some(d) if d.join("monomyth-agent-arm64").exists() => d,
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

#[tauri::command]
fn themes(app: AppHandle) -> Vec<Value> {
    let dir = config_dir(&app).join("themes");
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![] };
    let mut files: Vec<String> = entries
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.to_lowercase().ends_with(".json"))
        .collect();
    files.sort();
    files
        .into_iter()
        .filter_map(|file| std::fs::read_to_string(dir.join(&file)).ok().filter(|t| !t.is_empty()).map(|text| json!({ "file": file, "text": text })))
        .collect()
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

#[tauri::command]
async fn call(state: State<'_, App>, conn: String, method: String, params: Value) -> Result<Value, String> {
    let c = state.conns.lock().unwrap().get(&conn).cloned().ok_or("not connected")?;
    match c.as_ref() {
        Conn::Local(s) => {
            let s = s.clone();
            tauri::async_runtime::spawn_blocking(move || s.call(&method, params)).await.map_err(|e| e.to_string())?
        }
        Conn::Docker(a) => a.call(&method, params).await,
    }
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
async fn sql_tables(state: State<'_, App>, id: String) -> Result<Vec<sql::Table>, String> {
    state.sql.tables(&id).await
}

#[tauri::command]
async fn sql_columns(state: State<'_, App>, id: String, schema: String, table: String) -> Result<Vec<sql::Column>, String> {
    state.sql.columns(&id, &schema, &table).await
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
    let quit = MenuItem::with_id(app, "quit", "Quit Monomyth", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "Monomyth",
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
        .on_window_event(|w, e| {
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
            platform,
            docker_containers,
            connect,
            disconnect,
            call,
            sql_connect,
            sql_query,
            sql_cancel,
            sql_tables,
            sql_columns,
            sql_disconnect,
            set_dirty,
            request_close,
            quit,
        ])
        .build(tauri::generate_context!())
        .expect("couldn't start Monomyth");
    app.run(|app, e| {
        if let RunEvent::ExitRequested { api, code, .. } = e {
            if code.is_none() && ask_page(app) {
                api.prevent_exit();
            }
        }
    });
}
