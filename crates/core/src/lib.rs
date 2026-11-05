mod files;
mod proc;
mod scm;
mod search;
mod term;
mod watch;

use serde::de::DeserializeOwned;
use serde_json::Value;
use std::sync::Arc;

pub use proc::login_shell;

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

pub struct Service {
    terms: term::Terminals,
    watch: watch::Watch,
}

fn args<T: DeserializeOwned>(params: Value) -> Result<T, String> {
    let params = if params.is_null() { Value::Object(Default::default()) } else { params };
    serde_json::from_value(params).map_err(|e| format!("bad parameters: {e}"))
}

fn json<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

impl Service {
    pub fn new(emit: Emit) -> Self {
        Service { terms: term::Terminals::new(emit.clone()), watch: watch::Watch::new(emit) }
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "hello" => json(files::hello(args(params)?)?),
            "fs.list" => json(files::list(args(params)?)?),
            "fs.read" => json(files::read(args(params)?)?),
            "fs.readBytes" => json(files::read_bytes(args(params)?)?),
            "fs.write" => json(files::write(args(params)?)?),
            "fs.create" => json(files::create(args(params)?)?),
            "fs.rename" => json(files::rename(args(params)?)?),
            "fs.copy" => json(files::copy(args(params)?)?),
            "fs.delete" => json(files::remove(args(params)?)?),
            "fs.stat" => json(files::stat(args(params)?)?),
            "fs.watch" => json(self.watch.set(args(params)?)?),
            "fs.files" => json(search::files(args(params)?)),
            "fs.grep" => json(search::grep(args(params)?)?),
            "scm.repos" => json(scm::repos(args(params)?)),
            "scm.changes" => json(scm::changes_of(args(params)?)),
            "scm.versions" => json(scm::versions(args(params)?)),
            "scm.log" => json(scm::log(args(params)?)),
            "scm.show" => json(scm::show(args(params)?)?),
            "scm.fetch" => json(scm::fetch(args(params)?)?),
            "scm.sync" => json(scm::sync(args(params)?)?),
            "term.open" => json(self.terms.open(args(params)?)?),
            "term.input" => json(self.terms.input(args(params)?)?),
            "term.resize" => json(self.terms.resize(args(params)?)?),
            "term.close" => json(self.terms.close(args(params)?)),
            _ => Err(format!("unknown method {method}")),
        }
    }

    pub fn close(&self) {
        self.terms.close_all();
        self.watch.stop();
    }
}

#[cfg(test)]
mod tests;
