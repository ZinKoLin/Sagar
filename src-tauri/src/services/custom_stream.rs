//! OpenAI-compatible Chat Completions SSE. Secrets and provider bodies never
//! leave this Rust transport; only assistant content reaches proposal review.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::{error::AppError, storage::ai_providers::CustomSecret};
use serde_json::{Value, json};

const LIMIT: usize = 1_000_000;

fn failed(message: &str) -> AppError {
    AppError::new("provider_failed", message)
}

#[derive(Default)]
struct Decoder {
    line: Vec<u8>,
    data: String,
    output: Vec<u8>,
    stopped: bool,
    done: bool,
    received: usize,
    events: usize,
    reasoning_bytes: usize,
}

impl Decoder {
    fn push(&mut self, bytes: &[u8], emit: &mut impl FnMut(&[u8])) -> Result<(), AppError> {
        self.received = self.received.saturating_add(bytes.len());
        if self.received > 16 * LIMIT {
            return Err(failed("The provider stream exceeded the size limit."));
        }
        for &byte in bytes {
            if self.done {
                break;
            }
            if byte == b'\n' {
                let line = std::str::from_utf8(&self.line)
                    .map_err(|_| failed("The provider returned invalid UTF-8."))?
                    .trim_end_matches('\r');
                if line.is_empty() {
                    let data = std::mem::take(&mut self.data);
                    self.event(data.trim(), emit)?;
                } else if let Some(data) = line.strip_prefix("data:") {
                    if !self.data.is_empty() {
                        self.data.push('\n');
                    }
                    self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
                }
                self.line.clear();
            } else {
                self.line.push(byte);
            }
            if self.line.len() + self.data.len() > LIMIT {
                return Err(failed("The provider returned an oversized stream event."));
            }
        }
        Ok(())
    }

    fn event(&mut self, data: &str, emit: &mut impl FnMut(&[u8])) -> Result<(), AppError> {
        if data.is_empty() {
            return Ok(());
        }
        if data == "[DONE]" {
            if !self.stopped {
                return Err(failed(
                    "The provider ended without a completed answer. Retry to continue.",
                ));
            }
            self.done = true;
            return Ok(());
        }
        self.events += 1;
        let value: Value = serde_json::from_str(data)
            .map_err(|_| failed("The provider returned an invalid streaming response."))?;
        if value.get("error").is_some() {
            return Err(failed(
                "The provider reported an API error. Check its configuration and retry.",
            ));
        }
        let Some(choices) = value.get("choices").and_then(Value::as_array) else {
            return Err(failed(
                "The provider returned an invalid streaming response.",
            ));
        };
        for choice in choices {
            if choice.get("index").and_then(Value::as_u64) != Some(0) {
                continue;
            }
            let delta = &choice["delta"];
            self.reasoning_bytes += delta
                .get("reasoning_content")
                .and_then(Value::as_str)
                .map_or(0, str::len);
            if delta.get("tool_calls").is_some() || delta.get("function_call").is_some() {
                return Err(failed(
                    "The provider requested a tool instead of returning text.",
                ));
            }
            if let Some(text) = delta.get("content").and_then(Value::as_str) {
                if self.stopped || self.output.len() + text.len() > LIMIT {
                    return Err(failed("The provider returned too much or unexpected text."));
                }
                self.output.extend_from_slice(text.as_bytes());
                emit(text.as_bytes());
            }
            if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                if reason != "stop" {
                    return Err(failed(match reason {
                        "length" => {
                            "The provider reached its output limit. Retry to continue complete sections."
                        }
                        "content_filter" => {
                            "The provider filtered the response. Review its content policy."
                        }
                        _ => {
                            "The provider did not finish a text answer. Retry or choose another model."
                        }
                    }));
                }
                self.stopped = true;
            }
        }
        Ok(())
    }

    fn finish(self) -> Result<Vec<u8>, AppError> {
        if !self.done || !self.stopped || self.output.is_empty() {
            return Err(failed(
                "The provider stream ended before a complete answer. Retry to continue.",
            ));
        }
        Ok(self.output)
    }
}

#[cfg(test)]
fn run(
    secret: &CustomSecret,
    model: &str,
    prompt: &str,
    cancel: &AtomicBool,
    timeout: Duration,
    emit: impl FnMut(&[u8]),
) -> Result<Vec<u8>, AppError> {
    run_with_status(secret, model, prompt, None, cancel, timeout, emit, |_| {})
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_with_status(
    secret: &CustomSecret,
    model: &str,
    prompt: &str,
    effort: Option<&str>,
    cancel: &AtomicBool,
    timeout: Duration,
    mut emit: impl FnMut(&[u8]),
    mut status_update: impl FnMut(&str),
) -> Result<Vec<u8>, AppError> {
    let start = std::time::Instant::now();
    status_update("Sending API request; waiting for response headers.");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| failed("The API request could not start."))?;
    runtime.block_on(async {
        let request = async {
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(30))
                .build().map_err(|_| failed("The API request could not start."))?;
            let mut body = json!({"model":model,"messages":[{"role":"user","content":prompt}],"stream":true});
            if let Some(effort) = effort { body["reasoning_effort"] = json!(effort); }
            let mut response = client.post(format!("{}/chat/completions", secret.base_url))
                .bearer_auth(&secret.api_key)
                .header("Accept", "text/event-stream")
                .json(&body)
                .send().await.map_err(|_| failed("Could not connect to the provider. Check its API endpoint and retry."))?;
            let status = response.status();
            status_update(&format!("HTTP {} received after {:.1}s.", status.as_u16(), start.elapsed().as_secs_f32()));
            if !status.is_success() {
                return Err(failed(match status.as_u16() {
                    401 | 403 => "The provider denied access. Check its API key and model access.",
                    429 => "The provider rate limit or quota was reached. Try again later.",
                    500..=599 => "The provider is temporarily unavailable. Try again later.",
                    _ => "The provider rejected the request. Check the endpoint and selected model.",
                }));
            }
            if !response.headers().get("content-type").and_then(|v| v.to_str().ok())
                .is_some_and(|v| v.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("text/event-stream")) {
                return Err(failed("The provider did not return an SSE stream. Check its OpenAI-compatible endpoint."));
            }
            status_update("Response is a streaming connection; waiting for the first data.");
            let mut last_update = std::time::Instant::now();
            let mut decoder = Decoder::default();
            while let Some(chunk) = response.chunk().await.map_err(|_| failed("The provider connection was interrupted. Retry to continue."))? {
                let first = decoder.received == 0;
                let was_reasoning = decoder.reasoning_bytes > 0;
                let had_content = !decoder.output.is_empty();
                decoder.push(&chunk, &mut emit)?;
                if first || was_reasoning != (decoder.reasoning_bytes > 0)
                    || had_content != !decoder.output.is_empty() || decoder.done
                    || last_update.elapsed() >= Duration::from_secs(2) {
                    status_update(&format!("{:.1}s: {} stream bytes, {} events, {} answer bytes, {} reasoning bytes. {}",
                        start.elapsed().as_secs_f32(), decoder.received, decoder.events,
                        decoder.output.len(), decoder.reasoning_bytes,
                        if decoder.done { "Answer complete." }
                        else if !decoder.output.is_empty() { "Receiving answer text." }
                        else if decoder.reasoning_bytes > 0 { "Provider is reasoning; answer text has not started." }
                        else { "Waiting for answer text." }));
                    last_update = std::time::Instant::now();
                }
                if decoder.done { break; }
            }
            decoder.finish()
        };
        let mut request = std::pin::pin!(request);
        let start = std::time::Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(AppError::new("translation_cancelled", "The request was cancelled."));
            }
            if !timeout.is_zero() && start.elapsed() >= timeout {
                return Err(AppError::new("translation_timeout", "The provider timed out. Retry to continue."));
            }
            if let Ok(result) = tokio::time::timeout(Duration::from_millis(100), &mut request).await {
                return result;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(text: &str, reason: &str) -> String {
        format!(
            "data: {}\r\n\r\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"index":0,"delta":{"content":text,"reasoning_content":"hidden"},"finish_reason":null}]}),
            json!({"choices":[{"index":0,"delta":{},"finish_reason":reason}]})
        )
    }

    fn mock_server(
        status: &str,
        body: String,
        pause: bool,
    ) -> (CustomSecret, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let status = status.to_string();
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let headers = String::from_utf8(request.clone()).unwrap();
            let size: usize = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .map(str::to_string)
                })
                .unwrap()
                .parse()
                .unwrap();
            let mut payload = vec![0; size];
            socket.read_exact(&mut payload).unwrap();
            request.extend_from_slice(&payload);
            write!(socket, "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}").unwrap();
            socket.flush().unwrap();
            if pause {
                std::thread::sleep(Duration::from_millis(500));
            }
            String::from_utf8(request).unwrap()
        });
        (
            CustomSecret {
                base_url: url,
                api_key: "test-secret".into(),
                model: "saved-model".into(),
            },
            handle,
        )
    }

    #[test]
    fn http_transport_uses_saved_endpoint_key_selected_model_and_stream() {
        let (secret, server) = mock_server("200 OK", stream("<p>မြန်မာ</p>", "stop"), false);
        let mut emitted = Vec::new();
        let prompt = super::super::ai_translate::build_book_translation_prompt(
            Some("en"),
            "my",
            "<p>A synthetic story.</p>",
            "Preserve names.",
            "Use formal prose.",
        );
        let output = run(
            &secret,
            "selected-model",
            &prompt,
            &AtomicBool::new(false),
            Duration::from_secs(3),
            |b| emitted.extend_from_slice(b),
        )
        .unwrap();
        assert_eq!(output, emitted);
        assert_eq!(output, "<p>မြန်မာ</p>".as_bytes());
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer test-secret")
        );
        let body: Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["model"], "selected-model");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["content"], prompt);
        let sent = body["messages"][0]["content"].as_str().unwrap();
        assert!(sent.contains("from English (en) into Myanmar (my)"));
        assert!(sent.contains("Translation language (Book Settings): Myanmar (my)"));
        assert!(sent.contains("prose and headings in Myanmar (my)"));
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn trace_reports_stages_without_secrets_and_forwards_explicit_effort() {
        let (secret, server) = mock_server("200 OK", stream("<p>answer</p>", "stop"), false);
        let mut trace = Vec::new();
        run_with_status(
            &secret,
            "m",
            "private prompt",
            Some("low"),
            &AtomicBool::new(false),
            Duration::from_secs(3),
            |_| {},
            |message| trace.push(message.to_string()),
        )
        .unwrap();
        assert!(trace[0].contains("waiting for response headers"));
        assert!(trace.iter().any(|line| line.contains("HTTP 200")));
        assert!(trace.iter().any(|line| line.contains("reasoning bytes")));
        assert!(trace.last().unwrap().contains("Answer complete"));
        for line in &trace {
            for private in ["test-secret", "private prompt", "hidden", "<p>answer</p>"] {
                assert!(!line.contains(private));
            }
        }
        let request = server.join().unwrap();
        let body: Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["reasoning_effort"], "low");
    }

    #[test]
    fn reasoning_only_activity_is_counted_without_entering_answer() {
        let mut decoder = Decoder::default();
        let event = format!(
            "data: {}\n\n",
            json!({"choices":[{"index":0,"delta":{"reasoning_content":"private reasoning"}}]})
        );
        let mut answer = Vec::new();
        decoder
            .push(event.as_bytes(), &mut |chunk| {
                answer.extend_from_slice(chunk)
            })
            .unwrap();
        assert!(answer.is_empty());
        assert_eq!(decoder.events, 1);
        assert_eq!(decoder.reasoning_bytes, "private reasoning".len());
        assert!(!decoder.done);
    }

    #[test]
    fn chapter_translation_and_retry_preserve_snapshot_and_saved_draft() {
        use crate::storage::projects::{NewChapter, NewProject};
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::services::workspace::open_db(dir.path()).unwrap();
        crate::storage::projects::create_project(
            &conn,
            &NewProject {
                original_source_path: None,
                id: "p".into(),
                source_sha256: "synthetic".into(),
                source_snapshot_path: "projects/p/source.epub".into(),
                title: "Synthetic".into(),
                author: None,
                source_language: Some("en".into()),
                created_at: "2026-10-14T00:00:00Z".into(),
            },
            &[(
                NewChapter {
                    id: "c".into(),
                    spine_index: 0,
                    manifest_item_id: "c".into(),
                    resource_href: "c.xhtml".into(),
                    title: "Chapter".into(),
                },
                vec![],
            )],
        )
        .unwrap();
        let snapshot = dir.path().join("projects/p/source.epub");
        std::fs::create_dir_all(snapshot.parent().unwrap()).unwrap();
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&snapshot).unwrap());
        zip.start_file(
            "mimetype",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("c.xhtml", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>Chapter</title></head><body><p>One</p><p>Two</p></body></html>").unwrap();
        zip.finish().unwrap();
        let before = std::fs::read(&snapshot).unwrap();
        let saved_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM chapter_documents", [], |r| r.get(0))
            .unwrap();
        for (previous, text, expected_kind) in [
            (None, "<p>မြန်မာ</p><p>နှစ်</p>", "done"),
            (Some("<p>မြန်မာ</p><p>unfinished"), "<p>နှစ်</p>", "done"),
            (None, "<p>မြန်မာ</p><p><i>နှစ်</i></p>", "needs_repair"),
        ] {
            let (secret, server) = mock_server("200 OK", stream(text, "stop"), false);
            let provider = crate::services::ai::save_ai_custom_provider(
                dir.path(),
                crate::services::ai::SaveCustomInput {
                    id: None,
                    name: "Test".into(),
                    base_url: secret.base_url,
                    api_key: Some(secret.api_key),
                    model: "glm-test".into(),
                },
            )
            .unwrap();
            let (send, receive) = std::sync::mpsc::channel();
            crate::services::ai_translate::start_ai_translation(
                dir.path(),
                crate::services::ai_translate::StartTranslationInput {
                    timeout_minutes: None,
                    chapter_id: "c".into(),
                    agent: format!("custom:{}", provider.id),
                    model: "glm-test".into(),
                    consent: true,
                    previous_output: previous.map(str::to_string),
                    current_instructions: None,
                    reasoning_effort: None,
                },
                move |event| {
                    send.send(event).unwrap();
                },
            )
            .unwrap();
            let terminal = loop {
                let event = receive.recv_timeout(Duration::from_secs(5)).unwrap();
                if event.kind == "done" || event.kind == "failed" || event.kind == "needs_repair" {
                    break event;
                }
            };
            assert_eq!(terminal.kind, expected_kind, "{}", terminal.message);
            if expected_kind == "done" {
                assert_eq!(
                    terminal.proposal_html.as_deref(),
                    Some("<p>မြန်မာ</p><p>နှစ်</p>")
                );
            } else {
                assert_eq!(terminal.partial_text.as_deref(), Some(text));
            }
            let retained = crate::services::ai_translate::get_translation_output(dir.path(), "c")
                .unwrap()
                .unwrap();
            assert_eq!(
                retained.html,
                if previous.is_some() {
                    format!("<p>မြန်မာ</p>{text}")
                } else {
                    text.to_string()
                }
            );
            let request = server.join().unwrap();
            if previous.is_some() {
                assert!(!request.contains("<p>One</p>"));
            }
        }
        assert_eq!(std::fs::read(snapshot).unwrap(), before);
        let saved_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM chapter_documents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(saved_after, saved_before);
    }

    #[test]
    fn saved_custom_provider_runs_html_repair_through_service() {
        let (secret, server) = mock_server("200 OK", stream("<p>မြန်မာ</p>", "stop"), false);
        let dir = tempfile::tempdir().unwrap();
        let provider = crate::services::ai::save_ai_custom_provider(
            dir.path(),
            crate::services::ai::SaveCustomInput {
                id: None,
                name: "GLM test".into(),
                base_url: secret.base_url,
                api_key: Some(secret.api_key),
                model: "glm-test".into(),
            },
        )
        .unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let started = crate::services::ai_translate::start_ai_html_fix(
            dir.path(),
            crate::services::ai_translate::StartHtmlFixInput {
                chapter_id: "synthetic-chapter".into(),
                html: "<p>မြန်မာ</p>".into(),
                agent: format!("custom:{}", provider.id),
                model: "glm-test".into(),
                consent: true,
                reasoning_effort: None,
            },
            move |event| {
                send.send(event).unwrap();
            },
        )
        .unwrap();
        let terminal = loop {
            let event = receive.recv_timeout(Duration::from_secs(5)).unwrap();
            assert_eq!(event.job_id, started.job_id);
            if event.kind == "done" || event.kind == "failed" {
                break event;
            }
        };
        assert_eq!(terminal.kind, "done", "{}", terminal.message);
        assert_eq!(terminal.fixed_html.as_deref(), Some("<p>မြန်မာ</p>"));
        server.join().unwrap();
    }

    #[test]
    fn http_errors_are_sanitized_and_redirects_are_rejected() {
        for status in [
            "401 Unauthorized",
            "429 Too Many Requests",
            "500 Server Error",
            "302 Found",
        ] {
            let (secret, server) = mock_server(status, "secret provider body".into(), false);
            let error = run(
                &secret,
                "m",
                "prompt",
                &AtomicBool::new(false),
                Duration::from_secs(3),
                |_| {},
            )
            .unwrap_err();
            assert!(!error.message.contains("secret"));
            server.join().unwrap();
        }
    }

    #[test]
    fn cancellation_and_deadline_interrupt_silent_streams() {
        for cancellation in [false, true] {
            let (secret, server) = mock_server("200 OK", ": waiting\n\n".into(), true);
            let cancel = AtomicBool::new(false);
            std::thread::scope(|scope| {
                if cancellation {
                    let cancel = &cancel;
                    scope.spawn(move || {
                        std::thread::sleep(Duration::from_millis(80));
                        cancel.store(true, Ordering::SeqCst);
                    });
                }
                let start = std::time::Instant::now();
                let error = run(
                    &secret,
                    "m",
                    "prompt",
                    &cancel,
                    Duration::from_millis(if cancellation { 1000 } else { 80 }),
                    |_| {},
                )
                .unwrap_err();
                assert_eq!(
                    error.code,
                    if cancellation {
                        "translation_cancelled"
                    } else {
                        "translation_timeout"
                    }
                );
                assert!(start.elapsed() < Duration::from_millis(450));
            });
            server.join().unwrap();
        }
    }

    #[test]
    fn fragmented_unicode_stream_emits_only_content() {
        let mut decoder = Decoder::default();
        let mut emitted = Vec::new();
        for byte in stream("<p>မြန်မာ</p>", "stop").bytes() {
            decoder
                .push(&[byte], &mut |b| emitted.extend_from_slice(b))
                .unwrap();
        }
        assert_eq!(decoder.finish().unwrap(), "<p>မြန်မာ</p>".as_bytes());
        assert_eq!(emitted, "<p>မြန်မာ</p>".as_bytes());
    }

    #[test]
    fn rejects_truncation_errors_tools_and_limits() {
        for data in [
            stream("partial", "length"),
            "data: [DONE]\n\n".into(),
            "data: {\"error\":{\"message\":\"secret\"}}\n\n".into(),
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[]}}]}\n\n".into(),
            "data: broken\n\n".into(),
        ] {
            let mut decoder = Decoder::default();
            let error = decoder.push(data.as_bytes(), &mut |_| {}).unwrap_err();
            assert!(!error.message.contains("secret"));
        }
        let mut decoder = Decoder::default();
        decoder
            .push(
                b"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"}}]}\n\n",
                &mut |_| {},
            )
            .unwrap();
        assert!(decoder.finish().is_err());
        assert!(
            Decoder::default()
                .push(&vec![b'x'; LIMIT + 1], &mut |_| {})
                .is_err()
        );
    }
}
