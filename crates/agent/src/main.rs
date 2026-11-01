use mono_core::Service;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let send = {
        let out = out.clone();
        move |msg: Value| {
            let mut o = out.lock().unwrap();
            let _ = serde_json::to_writer(&mut *o, &msg);
            let _ = o.write_all(b"\n");
            let _ = o.flush();
        }
    };
    let events = send.clone();
    let service = Arc::new(Service::new(Arc::new(move |event: &str, params: Value| {
        events(json!({ "event": event, "params": params }))
    })));
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(req) = serde_json::from_str::<Value>(&line) else { continue };
        let (service, send) = (service.clone(), send.clone());
        std::thread::spawn(move || {
            let id = req["id"].clone();
            let method = req["method"].as_str().unwrap_or("");
            match service.call(method, req["params"].clone()) {
                Ok(result) => send(json!({ "id": id, "result": result })),
                Err(error) => send(json!({ "id": id, "error": error })),
            }
        });
    }
    service.close();
}
