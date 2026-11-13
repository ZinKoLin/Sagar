//! Per-job authenticated loopback OpenCode server and incremental SSE text.
use crate::error::AppError;
use reqwest::blocking::{Client, RequestBuilder};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
const MAX_TEXT: usize = 1_000_000;
const MAX_FRAME: usize = 4_000_000;
fn failed() -> AppError {
    AppError::new(
        "translation_failed",
        "OpenCode Server could not complete the response. Check your OpenCode provider and selected model, then retry.",
    )
}
/// Classify provider failures without echoing response bodies, credentials,
/// paths or prompt text into user-visible diagnostics.
fn provider_error(error: &Value) -> AppError {
    let status = error["data"]["statusCode"].as_u64();
    let free_tier = error["data"]["message"]
        .as_str()
        .is_some_and(|message| message.to_ascii_lowercase().contains("free tier"));
    let message = match (error["name"].as_str(), status) {
        (_, Some(403)) if free_tier => {
            "OpenCode's free-model access check rejected this session (HTTP 403). Retry in OpenCode to check provider access."
        }
        (_, Some(401)) | (Some("ProviderAuthError"), _) => {
            "OpenCode provider authentication failed. Sign in to that provider in OpenCode, then retry."
        }
        (_, Some(403)) => {
            "The OpenCode provider rejected the request (HTTP 403). Check provider access in OpenCode, then retry."
        }
        (_, Some(429)) => {
            "The OpenCode provider's usage limit was reached (HTTP 429). Wait before retrying."
        }
        (_, Some(500..=599)) => {
            "The OpenCode provider is temporarily unavailable. Retry after the service recovers."
        }
        (Some("MessageOutputLengthError"), _) => {
            "OpenCode reached the model's output limit. The incomplete response was not applied; retry keeps complete sections."
        }
        _ => {
            "OpenCode reported a provider error. Check the provider connection in OpenCode, then retry."
        }
    };
    AppError::new("opencode_provider_error", message)
}

fn check(cancel: &AtomicBool, started: Instant, timeout: Duration) -> Result<(), AppError> {
    if cancel.load(Ordering::SeqCst) {
        return Err(AppError::new(
            "translation_cancelled",
            "The run was cancelled.",
        ));
    }
    if !timeout.is_zero() && started.elapsed() >= timeout {
        return Err(AppError::new(
            "translation_timeout",
            "The OpenCode response timed out. Retry keeps complete translated sections.",
        ));
    }
    Ok(())
}
fn runtime_config(existing: Option<&str>) -> Result<String, AppError> {
    let mut config = match existing {
        Some(text) => serde_json::from_str::<Value>(text).map_err(|_| {
            AppError::new(
                "opencode_config_invalid",
                "OpenCode's inline configuration must be a JSON object.",
            )
        })?,
        None => json!({}),
    };
    config
        .as_object_mut()
        .ok_or_else(failed)?
        .insert("share".into(), json!("disabled"));
    Ok(config.to_string())
}

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
struct Server {
    process: Process,
    client: Client,
    base: String,
    password: String,
    session: Option<String>,
}
impl Server {
    fn request(&self, method: reqwest::Method, path: &str) -> RequestBuilder {
        self.client
            .request(method, format!("{}{path}", self.base))
            .basic_auth("sagar", Some(&self.password))
    }
    fn start(
        binary: &Path,
        cwd: &Path,
        cancel: &AtomicBool,
        started: Instant,
        timeout: Duration,
    ) -> Result<Self, AppError> {
        let password = uuid::Uuid::new_v4().to_string();
        let config = runtime_config(std::env::var("OPENCODE_CONFIG_CONTENT").ok().as_deref())?;
        let mut command = Command::new(binary);
        command
            .args(["serve", "--hostname", "127.0.0.1", "--port", "0"])
            .current_dir(cwd)
            .env("OPENCODE_CONFIG_CONTENT", config)
            .env("OPENCODE_SERVER_PASSWORD", &password)
            .env("OPENCODE_SERVER_USERNAME", "sagar")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(path) = super::ai::cli_child_path_env(binary) {
            command.env("PATH", path);
        }
        let mut process = Process(command.spawn().map_err(|_| failed())?);
        let mut stdout = process.0.stdout.take().ok_or_else(failed)?;
        let stderr = process.0.stderr.take();
        std::thread::spawn(move || {
            if let Some(mut pipe) = stderr {
                let mut b = [0u8; 8192];
                while matches!(pipe.read(&mut b), Ok(n) if n > 0) {}
            }
        });
        let (tx, rx) = mpsc::sync_channel(16);
        std::thread::spawn(move || {
            let mut b = [0u8; 8192];
            loop {
                match stdout.read(&mut b) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(b[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        let mut output = Vec::new();
        let base = loop {
            check(cancel, started, timeout)?;
            if started.elapsed() > Duration::from_secs(30) {
                return Err(AppError::new(
                    "translation_failed",
                    "OpenCode Server did not become ready. Check the CLI installation and retry.",
                ));
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(chunk) => {
                    output.extend_from_slice(&chunk);
                    if output.len() > 32768 {
                        return Err(failed());
                    }
                    if let Some(base) = listening_url(&String::from_utf8_lossy(&output)) {
                        break base;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => {
                    // Prefer an expired deadline over a generic failure when
                    // the child pipe closes around the same time.
                    check(cancel, started, timeout)?;
                    return Err(failed());
                }
            }
        };
        // Continue draining stdout; a verbose child must not block on its pipe.
        std::thread::spawn(move || while rx.recv().is_ok() {});
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| failed())?;
        Ok(Self {
            process,
            client,
            base,
            password,
            session: None,
        })
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        if let Some(session) = &self.session {
            // Remove only this adapter's temporary session, never user sessions.
            let _ = self
                .request(reqwest::Method::POST, &format!("/session/{session}/abort"))
                .timeout(Duration::from_millis(500))
                .send();
            let _ = self
                .request(reqwest::Method::DELETE, &format!("/session/{session}"))
                .timeout(Duration::from_millis(500))
                .send();
        }
        let _ = self.process.0.kill();
        let _ = self.process.0.wait();
    }
}
fn listening_url(output: &str) -> Option<String> {
    let suffix = output.split("http://127.0.0.1:").nth(1)?;
    let port: String = suffix.chars().take_while(char::is_ascii_digit).collect();
    let port: u16 = port.parse().ok()?;
    if port == 0 {
        return None;
    }
    // Require a delimiter so a split port number is never used prematurely.
    if suffix.len() == port.to_string().len() {
        return None;
    }
    Some(format!("http://127.0.0.1:{port}"))
}
fn read_json(response: reqwest::blocking::Response) -> Result<Value, AppError> {
    let response = response.error_for_status().map_err(|_| failed())?;
    let mut bytes = Vec::new();
    response
        .take((MAX_FRAME + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| failed())?;
    if bytes.len() > MAX_FRAME {
        return Err(failed());
    }
    serde_json::from_slice(&bytes).map_err(|_| failed())
}

#[derive(Default)]
struct Sse {
    pending: Vec<u8>,
    data: Vec<u8>,
}
impl Sse {
    fn push(
        &mut self,
        bytes: &[u8],
        mut on_event: impl FnMut(Value) -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let line = line.strip_suffix(b"\n").unwrap_or(&line);
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            if line.is_empty() {
                if !self.data.is_empty() {
                    let value = serde_json::from_slice(&self.data).map_err(|_| failed())?;
                    self.data.clear();
                    on_event(value)?;
                }
            } else if let Some(data) = line.strip_prefix(b"data:") {
                if !self.data.is_empty() {
                    self.data.push(b'\n');
                }
                self.data
                    .extend_from_slice(data.strip_prefix(b" ").unwrap_or(data));
            }
            if self.data.len() > MAX_FRAME {
                return Err(failed());
            }
        }
        if self.pending.len() > MAX_FRAME {
            return Err(failed());
        }
        Ok(())
    }
}
#[derive(Default)]
struct Part {
    message: String,
    text: String,
    sent: usize,
}
#[derive(Default)]
struct Events {
    session: String,
    roles: HashMap<String, String>,
    parts: HashMap<String, Part>,
    order: Vec<String>,
    latest: Option<String>,
    complete: bool,
    done: bool,
}
impl Events {
    fn emit(&mut self, id: &str, on_text: &mut impl FnMut(&[u8])) -> Result<(), AppError> {
        if self.parts.len() > 2000
            || self.roles.len() > 2000
            || self.parts.values().map(|p| p.text.len()).sum::<usize>() > MAX_TEXT
        {
            return Err(AppError::new(
                "proposal_too_large",
                "The OpenCode proposal was too large to use safely.",
            ));
        }
        if let Some(part) = self.parts.get_mut(id) {
            if self
                .roles
                .get(&part.message)
                .is_some_and(|role| role == "assistant")
            {
                if part.text.len() > part.sent {
                    on_text(part.text[part.sent..].as_bytes());
                }
                part.sent = part.text.len();
            }
        }
        Ok(())
    }
    fn handle(&mut self, value: Value, on_text: &mut impl FnMut(&[u8])) -> Result<(), AppError> {
        let p = value
            .get("properties")
            .or_else(|| value.get("data"))
            .ok_or_else(failed)?;
        let kind = value["type"].as_str().ok_or_else(failed)?;
        let session = p["sessionID"]
            .as_str()
            .or_else(|| p["info"]["sessionID"].as_str())
            .or_else(|| p["part"]["sessionID"].as_str());
        if session != Some(&self.session) {
            return Ok(());
        }
        match kind {
            "message.updated" => {
                let info = &p["info"];
                let id = info["id"].as_str().ok_or_else(failed)?;
                let role = info["role"].as_str().ok_or_else(failed)?;
                self.roles.insert(id.into(), role.into());
                if role == "assistant" {
                    if !info["error"].is_null() {
                        return Err(provider_error(&info["error"]));
                    }
                    self.latest = Some(id.into());
                    self.complete =
                        info["time"]["completed"].is_number() && info["finish"] == "stop";
                    let ids = self.order.clone();
                    for id in ids {
                        self.emit(&id, on_text)?;
                    }
                }
            }
            "message.part.updated"
                if p["part"]["type"] == "text"
                    && p["part"]["ignored"] != true
                    && p["part"]["synthetic"] != true =>
            {
                let part = &p["part"];
                let id = part["id"].as_str().ok_or_else(failed)?;
                let message = part["messageID"].as_str().ok_or_else(failed)?;
                let text = part["text"].as_str().ok_or_else(failed)?;
                if !self.parts.contains_key(id) {
                    self.order.push(id.into());
                }
                let stored = self.parts.entry(id.into()).or_default();
                stored.message = message.into();
                if text.starts_with(&stored.text) {
                    stored.text = text.into();
                } else if !stored.text.starts_with(text) {
                    return Err(failed());
                }
                self.emit(id, on_text)?;
            }
            "message.part.delta" if p["field"] == "text" => {
                let id = p["partID"].as_str().ok_or_else(failed)?;
                // Text parts are registered by their initial snapshot. Never
                // stream reasoning, tools, or the user's echoed prompt.
                if let Some(part) = self.parts.get_mut(id) {
                    if p["messageID"].as_str() != Some(part.message.as_str()) {
                        return Err(failed());
                    }
                    part.text.push_str(p["delta"].as_str().ok_or_else(failed)?);
                    self.emit(id, on_text)?;
                }
            }
            "session.error" => return Err(provider_error(&p["error"])),
            "permission.asked" | "question.asked" => {
                return Err(AppError::new(
                    "opencode_tool_requested",
                    "OpenCode requested an interactive tool during translation. No tool was approved and your draft is unchanged.",
                ));
            }
            "session.idle" => {
                if self.latest.is_some() && !self.complete {
                    return Err(failed());
                }
                self.done = self.complete;
            }
            "session.status" if p["status"]["type"] == "idle" => {
                if self.latest.is_some() && !self.complete {
                    return Err(failed());
                }
                self.done = self.complete;
            }
            _ => {}
        }
        if self.parts.len() > 2000
            || self.roles.len() > 2000
            || self.parts.values().map(|p| p.text.len()).sum::<usize>() > MAX_TEXT
        {
            return Err(AppError::new(
                "proposal_too_large",
                "The OpenCode proposal was too large to use safely.",
            ));
        }
        Ok(())
    }
    fn response(&self) -> Result<Vec<u8>, AppError> {
        if !self.done {
            return Err(failed());
        }
        let text: String = self
            .order
            .iter()
            .filter_map(|id| self.parts.get(id))
            .filter(|p| Some(&p.message) == self.latest.as_ref())
            .map(|p| p.text.as_str())
            .collect();
        if text.trim().is_empty() {
            return Err(failed());
        }
        Ok(text.into_bytes())
    }
}
enum Wire {
    Ready,
    Chunk(Vec<u8>),
    Failed,
}

pub(super) fn run(
    binary: &Path,
    args: &[String],
    cwd: &Path,
    cancel: &AtomicBool,
    timeout: Duration,
    mut on_text: impl FnMut(&[u8]),
) -> Result<Vec<u8>, AppError> {
    let selected = args
        .windows(2)
        .find(|v| v[0] == "--model")
        .map(|v| v[1].as_str())
        .ok_or_else(failed)?;
    let (provider, model) = selected
        .split_once('/')
        .filter(|(p, m)| !p.is_empty() && !m.is_empty())
        .ok_or_else(failed)?;
    let prompt = args.last().ok_or_else(failed)?;
    let variant = args
        .windows(2)
        .find(|v| v[0] == "--variant")
        .map(|v| v[1].as_str());
    let started = Instant::now();
    let mut server = Server::start(binary, cwd, cancel, started, timeout)?;
    let config = read_json(
        server
            .request(reqwest::Method::GET, "/config")
            .send()
            .map_err(|_| failed())?,
    )?;
    if config["share"] != "disabled" {
        return Err(AppError::new(
            "opencode_sharing_enabled",
            "OpenCode's managed settings prevent disabling session sharing. Translation requires sharing to be disabled.",
        ));
    }
    // Keep OpenCode's normal tool schema: deny removes tools and triggers its
    // free-tier gate. Ask retains the schema, but our event handler aborts any
    // actual permission request without granting it.
    let session = read_json(server.request(reqwest::Method::POST, "/session").json(&json!({"title":"Sagar temporary translation","permission":[{"permission":"*","pattern":"*","action":"ask"}]})).send().map_err(|_| failed())?)?;
    let id = session["id"]
        .as_str()
        .filter(|id| {
            id.starts_with("ses")
                && id.len() < 128
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
        })
        .ok_or_else(failed)?
        .to_string();
    server.session = Some(id.clone());
    // The SSE stream lifetime is bounded by the polling loops below via
    // `check`. Give the underlying request headroom so reqwest's own timeout
    // cannot fire at the same instant as the translation deadline and mask a
    // timeout as a generic failure.
    let request = server.request(reqwest::Method::GET, "/event");
    let request = if timeout.is_zero() {
        // Management requests keep their five-second cap. The event stream
        // must not inherit it when the user explicitly selected no time limit.
        Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(None)
            .build()
            .map_err(|_| failed())?
            .get(format!("{}/event", server.base))
            .basic_auth("sagar", Some(&server.password))
    } else {
        request.timeout(
            timeout
                .checked_add(Duration::from_secs(10))
                .unwrap_or(timeout),
        )
    };
    let (tx, rx) = mpsc::sync_channel(16);
    std::thread::spawn(move || {
        let Ok(response) = request.send().and_then(|r| r.error_for_status()) else {
            let _ = tx.send(Wire::Failed);
            return;
        };
        if !response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"))
        {
            let _ = tx.send(Wire::Failed);
            return;
        }
        if tx.send(Wire::Ready).is_err() {
            return;
        }
        let mut response = response;
        let mut buf = [0u8; 8192];
        loop {
            match response.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(Wire::Chunk(buf[..n].to_vec())).is_err() {
                        return;
                    }
                }
            }
        }
        let _ = tx.send(Wire::Failed);
    });
    loop {
        check(cancel, started, timeout)?;
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(Wire::Ready) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            _ => {
                // The event thread reports every transport problem as Failed,
                // including its own read timeout. Prefer the translation
                // deadline when it has expired so timeouts stay distinct from
                // generic failures.
                check(cancel, started, timeout)?;
                return Err(failed());
            }
        }
    }
    let mut body = json!({"model":{"providerID":provider,"modelID":model},"parts":[{"type":"text","text":prompt}]});
    if let Some(variant) = variant {
        body["variant"] = json!(variant);
    }
    server
        .request(
            reqwest::Method::POST,
            &format!("/session/{id}/prompt_async"),
        )
        .json(&body)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| failed())?;
    let mut events = Events {
        session: id,
        ..Default::default()
    };
    let mut sse = Sse::default();
    while !events.done {
        check(cancel, started, timeout)?;
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(Wire::Chunk(chunk)) => sse.push(&chunk, |v| {
                // Connection/heartbeat events are intentionally payload-free.
                if matches!(
                    v["type"].as_str(),
                    Some("server.connected" | "server.heartbeat")
                ) {
                    return Ok(());
                }
                events.handle(v, &mut on_text)
            })?,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            _ => {
                // Same deadline precedence as above: a closed/idle event
                // stream at the deadline is a timeout, not a generic failure.
                check(cancel, started, timeout)?;
                return Err(failed());
            }
        }
    }
    events.response()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(kind: &str, properties: Value) -> Value {
        json!({"type":kind,"properties":properties})
    }
    fn message(id: &str, role: &str, finish: bool) -> Value {
        let mut info = json!({"id":id,"sessionID":"ses_test","role":role,"time":{"created":1}});
        if finish {
            info["time"]["completed"] = json!(2);
            info["finish"] = json!("stop");
        }
        event(
            "message.updated",
            json!({"sessionID":"ses_test","info":info}),
        )
    }
    fn part(message: &str, text: &str) -> Value {
        event(
            "message.part.updated",
            json!({"sessionID":"ses_test","part":{"id":"prt_text","messageID":message,"sessionID":"ses_test","type":"text","text":text}}),
        )
    }
    fn delta(text: &str) -> Value {
        event(
            "message.part.delta",
            json!({"sessionID":"ses_test","messageID":"msg_answer","partID":"prt_text","field":"text","delta":text}),
        )
    }
    fn idle() -> Value {
        event(
            "session.status",
            json!({"sessionID":"ses_test","status":{"type":"idle"}}),
        )
    }
    #[test]
    fn provider_errors_explain_status_without_echoing_sensitive_output() {
        let error = provider_error(
            &json!({"name":"APIError","data":{"statusCode":403,"message":"OpenCode's free tier can only be used from within OpenCode","responseBody":"private prompt and credentials"}}),
        );
        assert_eq!(error.code, "opencode_provider_error");
        assert!(error.message.contains("free-model access"));
        assert!(error.message.contains("403"));
        assert!(!error.message.contains("private"));
        for (status, expected) in [
            (401, "authentication"),
            (429, "usage limit"),
            (503, "temporarily unavailable"),
        ] {
            assert!(
                provider_error(&json!({"name":"APIError","data":{"statusCode":status}}))
                    .message
                    .contains(expected)
            );
        }
    }

    #[test]
    fn runtime_override_disables_sharing_and_preserves_inline_preferences() {
        let config: Value = serde_json::from_str(
            &runtime_config(Some(
                r#"{"share":"auto","model":"p/m","provider":{"p":{"name":"local"}}}"#,
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(config["share"], "disabled");
        assert_eq!(config["model"], "p/m");
        assert_eq!(config["provider"]["p"]["name"], "local");
        assert!(runtime_config(Some("not json")).is_err());
    }

    #[test]
    fn sse_handles_split_unicode_crlf_multiline_data_and_keepalive() {
        let input = format!(
            ": heartbeat\r\nevent: message\r\ndata: {}\r\n\r\n",
            delta("မြန်မာ")
        );
        let mut sse = Sse::default();
        let mut found = Vec::new();
        for chunk in input.as_bytes().chunks(2) {
            sse.push(chunk, |v| {
                found.push(v);
                Ok(())
            })
            .unwrap();
        }
        assert_eq!(found, vec![delta("မြန်မာ")]);
        sse.push(b"data: {\ndata: \"type\":\"server.connected\"}\n\n", |_| {
            Ok(())
        })
        .unwrap();
        assert!(sse.push(b"data: not-json\n\n", |_| Ok(())).is_err());
    }
    #[test]
    fn streaming_text_deduplicates_final_snapshot_and_requires_completed_assistant() {
        let mut e = Events {
            session: "ses_test".into(),
            ..Default::default()
        };
        let mut output = Vec::new();
        for v in [
            idle(),
            message("msg_answer", "assistant", false),
            part("msg_answer", ""),
            delta("<p>မြန်မာ"),
            delta("</p>"),
            part("msg_answer", "<p>မြန်မာ</p>"),
        ] {
            e.handle(v, &mut |c| output.extend_from_slice(c)).unwrap();
            assert!(!e.done);
        }
        assert_eq!(output, "<p>မြန်မာ</p>".as_bytes());
        e.handle(message("msg_answer", "assistant", true), &mut |c| {
            output.extend_from_slice(c)
        })
        .unwrap();
        e.handle(idle(), &mut |_| {}).unwrap();
        assert_eq!(e.response().unwrap(), output);
    }
    #[test]
    fn source_echo_reasoning_other_sessions_and_errors_never_become_proposals() {
        let mut e = Events {
            session: "ses_test".into(),
            ..Default::default()
        };
        let mut out = Vec::new();
        e.handle(message("msg_user", "user", false), &mut |_| {})
            .unwrap();
        e.handle(part("msg_user", "private source"), &mut |c| {
            out.extend_from_slice(c)
        })
        .unwrap();
        e.handle(event("message.part.updated",json!({"sessionID":"ses_test","part":{"id":"reason","type":"reasoning","text":"ignore"}})), &mut |_| panic!("reasoning leaked")).unwrap();
        e.handle(
            event(
                "message.part.delta",
                json!({"sessionID":"other","field":"text","delta":"ignore"}),
            ),
            &mut |_| panic!("other session leaked"),
        )
        .unwrap();
        assert!(out.is_empty());
        assert!(e.response().is_err());
        assert!(
            e.handle(
                event("session.error", json!({"sessionID":"ses_test","error":{}})),
                &mut |_| {}
            )
            .is_err()
        );
    }
    #[test]
    fn output_limit_is_checked_before_display_and_urls_stay_on_loopback() {
        let mut e = Events {
            session: "ses_test".into(),
            ..Default::default()
        };
        e.handle(message("msg_answer", "assistant", false), &mut |_| {})
            .unwrap();
        assert!(
            e.handle(
                part("msg_answer", &"x".repeat(MAX_TEXT + 1)),
                &mut |_| panic!("oversized output displayed")
            )
            .is_err()
        );
        assert_eq!(
            listening_url("opencode server listening on http://127.0.0.1:1234\n"),
            Some("http://127.0.0.1:1234".into())
        );
        for bad in [
            "http://example.com:1234\n",
            "http://0.0.0.0:1234\n",
            "http://127.0.0.1:1234",
            "http://127.0.0.1:0\n",
        ] {
            assert!(listening_url(bad).is_none());
        }
    }
    #[cfg(unix)]
    #[test]
    fn http_adapter_preserves_selection_streams_and_cleans_up_on_all_outcomes() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            os::unix::fs::PermissionsExt,
            sync::{Arc, Mutex},
        };
        for mode in ["success", "cancel", "timeout", "permission"] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let dir = tempfile::tempdir().unwrap();
            let binary = dir.path().join("opencode");
            std::fs::write(
                &binary,
                format!("#!/bin/sh\necho 'opencode server listening on {base}'\nexec sleep 10\n"),
            )
            .unwrap();
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
            let calls = Arc::new(Mutex::new(Vec::<(String, Value)>::new()));
            let recorded = calls.clone();
            let mock_server = std::thread::spawn(move || {
                let mut events = None;
                for connection in listener.incoming() {
                    let mut socket = connection.unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    let mut headers = Vec::new();
                    while !headers.ends_with(b"\r\n\r\n") {
                        let mut byte = [0];
                        socket.read_exact(&mut byte).unwrap();
                        headers.push(byte[0]);
                        assert!(headers.len() < 16384);
                    }
                    let headers = String::from_utf8(headers).unwrap();
                    assert!(headers.lines().any(|line| {
                        line.to_ascii_lowercase()
                            .starts_with("authorization: basic ")
                    }));
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|s| s.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    let mut body = vec![0; length];
                    socket.read_exact(&mut body).unwrap();
                    let request = headers
                        .lines()
                        .next()
                        .unwrap()
                        .split_whitespace()
                        .take(2)
                        .collect::<Vec<_>>()
                        .join(" ");
                    let body = if body.is_empty() {
                        Value::Null
                    } else {
                        serde_json::from_slice(&body).unwrap()
                    };
                    recorded.lock().unwrap().push((request.clone(), body));
                    if request == "GET /event" {
                        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"type\":\"server.connected\"}\n\n").unwrap();
                        events = Some(socket);
                        continue;
                    }
                    let response = if request == "POST /session" {
                        r#"{"id":"ses_test"}"#
                    } else if request == "GET /config" {
                        r#"{"share":"disabled"}"#
                    } else {
                        "true"
                    };
                    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{response}",response.len()).as_bytes()).unwrap();
                    if request.ends_with("/prompt_async") {
                        let stream = events.as_mut().unwrap();
                        for v in [
                            message("msg_answer", "assistant", false),
                            part("msg_answer", ""),
                            delta("<p>မြန်မာ"),
                        ] {
                            stream
                                .write_all(format!("data: {v}\n\n").as_bytes())
                                .unwrap();
                        }
                        if mode == "permission" {
                            let request = event(
                                "permission.asked",
                                json!({"sessionID":"ses_test","id":"permission","permission":"bash"}),
                            );
                            stream
                                .write_all(format!("data: {request}\n\n").as_bytes())
                                .unwrap();
                        }
                        if mode == "success" {
                            std::thread::sleep(Duration::from_millis(200));
                            for v in [
                                delta("</p>"),
                                part("msg_answer", "<p>မြန်မာ</p>"),
                                message("msg_answer", "assistant", true),
                                idle(),
                            ] {
                                stream
                                    .write_all(format!("data: {v}\n\n").as_bytes())
                                    .unwrap();
                            }
                        }
                    }
                    if request == "DELETE /session/ses_test" {
                        break;
                    }
                }
            });
            let args = super::super::ai_translate::agent_args(
                crate::domain::CliProviderId::Opencode,
                "provider/model",
                "Translate.",
                Some("high"),
            );
            let cancel = AtomicBool::new(false);
            let mut output = Vec::new();
            let mut arrivals = Vec::new();
            let started = Instant::now();
            let timeout = if mode == "timeout" {
                Duration::from_millis(200)
            } else {
                Duration::from_secs(5)
            };
            let result = run(&binary, &args, dir.path(), &cancel, timeout, |chunk| {
                arrivals.push(started.elapsed());
                output.extend_from_slice(chunk);
                if mode == "cancel" {
                    cancel.store(true, Ordering::SeqCst);
                }
            });
            mock_server.join().unwrap();
            if mode == "success" {
                assert_eq!(result.unwrap(), "<p>မြန်မာ</p>".as_bytes());
                assert_eq!(output, "<p>မြန်မာ</p>".as_bytes());
                assert_eq!(arrivals.len(), 2);
                assert!(arrivals[0] < arrivals[1]);
            } else {
                assert_eq!(
                    result.unwrap_err().code,
                    if mode == "cancel" {
                        "translation_cancelled"
                    } else if mode == "permission" {
                        "opencode_tool_requested"
                    } else {
                        "translation_timeout"
                    }
                );
            }
            let calls = calls.lock().unwrap();
            let create = &calls
                .iter()
                .find(|(path, _)| path == "POST /session")
                .unwrap()
                .1;
            assert_eq!(create["permission"][0]["action"], "ask");
            let prompt = &calls
                .iter()
                .find(|(path, _)| path.ends_with("/prompt_async"))
                .unwrap()
                .1;
            assert_eq!(prompt["model"]["providerID"], "provider");
            assert_eq!(prompt["model"]["modelID"], "model");
            assert_eq!(prompt["variant"], "high");
            assert_eq!(prompt["parts"][0]["text"], "Translate.");
            assert!(
                calls
                    .iter()
                    .any(|(path, _)| path == "POST /session/ses_test/abort")
            );
            assert!(
                calls
                    .iter()
                    .any(|(path, _)| path == "DELETE /session/ses_test")
            );
        }
    }

    #[test]
    #[ignore = "explicit authenticated OpenCode probe; sends synthetic text only"]
    fn installed_opencode_delivers_multiple_text_deltas() {
        let binary =
            super::super::ai::find_cli_binary(crate::domain::CliProviderId::Opencode).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let model = std::env::var("SAGAR_TEST_OPENCODE_MODEL").expect("Set SAGAR_TEST_OPENCODE_MODEL to an installed, authenticated provider/model for this explicit probe");
        let args = super::super::ai_translate::agent_args(
            crate::domain::CliProviderId::Opencode,
            &model,
            "Reply exactly <p>hello</p>. Do not use tools.",
            None,
        );
        let started = Instant::now();
        let mut times = Vec::new();
        let mut streamed = Vec::new();
        let result = run(
            &binary,
            &args,
            dir.path(),
            &cancel,
            Duration::from_secs(60),
            |chunk| {
                times.push(started.elapsed());
                streamed.extend_from_slice(chunk);
            },
        )
        .unwrap();
        assert_eq!(result, b"<p>hello</p>");
        assert_eq!(result, streamed);
        assert!(times.len() > 1, "Expected actual incremental text deltas");
        eprintln!(
            "OpenCode live probe: {} deltas, first {:?}, finished {:?}",
            times.len(),
            times[0],
            started.elapsed()
        );
    }
}
