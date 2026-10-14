//! CLI-driven translation proposals (assist slice).
//!
//! The user picks an installed coding-assistant CLI (Codex / OpenCode /
//! Claude Code) plus a model in Settings. An explicit Generate run executes
//! that tool with the chapter's original HTML body and returns a validated
//! proposal with identical structure: only human-readable text may change.
//! Tables, images, links, ids and attributes must round-trip byte-identical;
//! anything else is rejected and nothing is inserted. Runs never touch the
//! saved draft: the frontend inserts the proposal on confirmation (or
//! automatically into an empty draft). No book content is sent anywhere
//! except to the chosen local tool, and only after explicit per-run consent.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    LazyLock, Mutex, MutexGuard,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

use base64::Engine as _;

use crate::domain::{AiTranslationEvent, AiTranslationStart, CliProviderId};
use crate::error::AppError;
use crate::services::ai as ai_settings;
use crate::storage::ai_translate;

/// Hard deadline for one chapter run; users can always cancel earlier.
/// One hour covers long chapters and slow connections (all agents —
/// Codex, OpenCode, Claude Code — share this path, as does AI HTML fix).
const TRANSLATION_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// How often a running child is polled for cancel/deadline.
const POLL_INTERVAL: Duration = Duration::from_millis(200);
/// Refuse chapters (or proposals) that would make prompts/outputs unbounded.
/// The source budget counts HTML characters, which run larger than text.
const MAX_SOURCE_CHARS: usize = 200_000;
const MAX_OUTPUT_BYTES: usize = 1_000_000;
/// How much tool stderr (if any) accompanies a failure message. Shown locally
/// only, truncated; never logged or telemetered.
const MAX_STDERR_CHARS: usize = 500;

pub struct StartTranslationInput {
    pub chapter_id: String,
    pub agent: String,
    pub model: String,
    pub consent: bool,
    pub previous_output: Option<String>,
    pub current_instructions: Option<String>,
    pub reasoning_effort: Option<String>,
}

struct ActiveJob {
    cancel: AtomicBool,
}

static JOBS: LazyLock<Mutex<HashMap<String, std::sync::Arc<ActiveJob>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock_jobs() -> Result<MutexGuard<'static, HashMap<String, std::sync::Arc<ActiveJob>>>, AppError>
{
    JOBS.lock()
        .map_err(|_| AppError::new("task_failed", "The translation job could not start."))
}

/// Builds the translation prompt from synthetic-safe parts. The only
/// book-derived input is `body_html`, the chapter's original body markup,
/// supplied by the caller.
pub fn build_translation_prompt(
    source_language: Option<&str>,
    target_language: &str,
    body_html: &str,
) -> String {
    let source = source_language
        .map(str::trim)
        .filter(|language| !language.is_empty())
        .unwrap_or("the original language");
    format!(
        "Translate this book chapter from {source} into language \"{target}\".\n\
         \n\
         The text below is the chapter's XHTML. Translate ONLY the human-readable\n\
         text between the tags.\n\
         \n\
         Rules:\n\
         - Keep every tag, attribute, id, href, src, class and entity exactly\n\
           as-is. Do not add, remove, reorder or rename any element.\n\
         - Tables, images, links and formatting must round-trip unchanged.\n\
         - Sagar's editable formatting uses <em> for italics and <strong> for\n\
           bold, not <i> or <b>. Do not introduce unsupported formatting tags.\n\
           If the source already uses <i> or <b>, preserve them under the\n\
           structural rules above; conversion belongs to AI Fix HTML.\n\
         - Return valid, well-formed XHTML suitable for the body of an EPUB\n\
           XHTML document, never Markdown or plain text.\n\
         - Close every element, nest tags correctly, quote all attribute values,\n\
           and self-close void elements (for example <br/> and <img .../>).\n\
         - Escape literal & and < in translated text as &amp; and &lt;. Use\n\
           XML predefined entities or numeric character references; do not\n\
           introduce HTML-only named entities such as &nbsp;. Preserve Unicode.\n\
         - Check the complete output for XHTML well-formedness before returning it.\n\
         - Output only the translated XHTML body fragment: no explanations, no\n\
           commentary, no code fences, and no <html>, <head> or <body> wrapper.\n\
         \n\
         HTML to translate:\n\
         {html}",
        target = target_language.trim(),
        html = body_html,
    )
}

pub fn build_book_translation_prompt(
    source_language: Option<&str>,
    target_language: &str,
    body_html: &str,
    book: &str,
    current: &str,
) -> String {
    let base = build_translation_prompt(source_language, target_language, body_html);
    let guidance = format!(
        "Book-wide translation guidance (names, terminology and style):\n{}\n\nCurrent-run translation guidance:\n{}\n\nApply both sets of guidance to text translation; current-run guidance takes precedence for naming/style conflicts. The structural preservation and output-only rules still apply.\n\n",
        serde_json::to_string(book).unwrap_or_default(),
        serde_json::to_string(current).unwrap_or_default()
    );
    format!("{guidance}{base}")
}

/// Builds the HTML-fix prompt from the user's current draft HTML. The fix
/// restructures markup into the restricted rich-text schema without
/// translating: every human-readable character must stay identical.
pub fn build_html_fix_prompt(html: &str) -> String {
    format!(
        "Repair this chapter's HTML so it fits a restricted rich-text schema.\n\
         \n\
         The text below is the user's current translation draft. Do NOT translate\n\
         or reword it: keep every human-readable character exactly as-is, in the\n\
         same language and order.\n\
         \n\
         Rules:\n\
         - Use only these elements: p, h1, h2, h3, h4, h5, h6, ul, ol, li,\n\
           blockquote, table, thead, tbody, tfoot, tr, td, th, strong, em, u, s,\n\
           img, br, hr and a. Unwrap or convert any other element (div, span,\n\
           section, article, font, etc.) without dropping its text.\n\
         - Convert <i> to <em> and <b> to <strong>, including their closing\n\
           tags. Preserve their text, valid attributes and italic/bold meaning;\n\
           do not unwrap these elements or remove their formatting.\n\
         - Keep every img src/alt and every a href; keep id, class, style,\n\
           title, lang, dir, colspan, rowspan and start attributes where valid.\n\
         - Never nest block elements (p, h1-h6, ul, ol, blockquote, table)\n\
           inside p; move trailing hr elements outside their paragraph.\n\
         - Output only the fixed HTML fragment: no explanations, no\n\
           commentary, no code fences, and no <html>, <head> or <body> wrapper.\n\
         \n\
         HTML to repair:\n\
         {html}",
        html = html,
    )
}

pub struct StartHtmlFixInput {
    pub chapter_id: String,
    pub html: String,
    pub agent: String,
    pub model: String,
    pub consent: bool,
    pub reasoning_effort: Option<String>,
}

// Match the restricted editor's namespace context for body-inner XHTML whose
// namespace declarations live on the source document's html element.
const FRAGMENT_OPENING: &str = "<w xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">";

/// Resume only complete top-level elements whose structure matches the source.
/// The incomplete tail is regenerated; never insert unvalidated partial output.
fn continuation_parts(original: &str, previous: &str) -> Result<(String, String), AppError> {
    if previous.len() > MAX_OUTPUT_BYTES {
        return Err(AppError::new(
            "proposal_too_large",
            "The previous proposal was too large.",
        ));
    }
    let previous = strip_code_fences(previous);
    let wrapped = format!("{FRAGMENT_OPENING}{original}</w>");
    let source = roxmltree::Document::parse(&wrapped).map_err(|_| {
        AppError::new(
            "proposal_structure",
            "The source markup could not be compared.",
        )
    })?;
    let elements: Vec<_> = source
        .root_element()
        .children()
        .filter(|n| n.is_element())
        .collect();
    let mut reader = quick_xml::Reader::from_str(previous);
    let mut depth = 0usize;
    let mut count = 0usize;
    let mut end = 0usize;
    loop {
        use quick_xml::events::Event;
        match reader.read_event() {
            Ok(Event::Start(_)) => depth += 1,
            Ok(Event::End(_)) if depth > 0 => depth -= 1,
            Ok(Event::Empty(_)) => {}
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => continue,
        }
        if depth != 0 {
            continue;
        }
        let candidate_end = reader.buffer_position() as usize;
        let candidate = &previous[..candidate_end];
        let Some(node) = elements.get(count) else {
            break;
        };
        let source_end = node.range().end - FRAGMENT_OPENING.len();
        if check_skeleton(&original[..source_end], candidate).is_err() {
            break;
        }
        count += 1;
        end = candidate_end;
    }
    let source_end = count
        .checked_sub(1)
        .and_then(|i| elements.get(i))
        .map(|n| n.range().end - FRAGMENT_OPENING.len())
        .unwrap_or(0);
    Ok((
        previous[..end].to_string(),
        original[source_end..].to_string(),
    ))
}

/// Fixed argument vectors per CLI. The prompt always travels as one trailing
/// argument; no user input ever becomes a flag, and no shell is involved.
/// Flag choices follow each tool's documented non-interactive mode.
pub fn agent_args(
    id: CliProviderId,
    model: &str,
    prompt: &str,
    effort: Option<&str>,
) -> Vec<String> {
    let mut args = match id {
        CliProviderId::Codex => vec![
            "exec".to_string(),
            // Translation runs use an isolated temporary directory, not a Git checkout.
            "--skip-git-repo-check".to_string(),
            "--model".to_string(),
            model.to_string(),
            prompt.to_string(),
        ],
        CliProviderId::Opencode => vec![
            "run".to_string(),
            "--model".to_string(),
            model.to_string(),
            prompt.to_string(),
        ],
        CliProviderId::ClaudeCode => vec![
            "-p".to_string(),
            prompt.to_string(),
            "--model".to_string(),
            model.to_string(),
            "--output-format".to_string(),
            "text".to_string(),
            "--max-turns".to_string(),
            "5".to_string(),
        ],
    };
    if let Some(effort) = effort {
        let flags = match id {
            CliProviderId::Codex => vec![
                "--config".to_string(),
                format!("model_reasoning_effort=\"{effort}\""),
            ],
            CliProviderId::Opencode => vec!["--variant".to_string(), effort.to_string()],
            CliProviderId::ClaudeCode => vec!["--effort".to_string(), effort.to_string()],
        };
        // Keep the prompt a positional argument; never interpret it as a flag.
        let position = if id == CliProviderId::ClaudeCode {
            0
        } else {
            args.len() - 1
        };
        args.splice(position..position, flags);
    }
    args
}

/// Output of a finished streaming run.
#[derive(Debug)]
pub(crate) struct StreamResult {
    pub status: std::process::ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Spawns `binary` with fixed args in `work_dir`, streaming stdout chunks to
/// `on_chunk` as they arrive while polling the shared cancel flag and a hard
/// deadline. The child is single-owned here: cancel/timeout/oversize kills
/// and reaps it before returning, so no runaway process survives the call.
/// Dropped receivers end the reader threads; the child is always reaped.
pub(crate) fn execute_streaming(
    binary: &Path,
    args: &[String],
    work_dir: &Path,
    cancel: &AtomicBool,
    timeout: Duration,
    mut on_chunk: impl FnMut(&[u8]),
) -> Result<StreamResult, AppError> {
    use std::io::Read as _;

    let failed = |message: &str| AppError::new("translation_failed", message.to_string());
    let mut command = std::process::Command::new(binary);
    command
        .args(args)
        .current_dir(work_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Same augmented environment as the settings probes: shim-based tools
    // (for example Codex via `node`) must resolve their runtime even when
    // the app launched with a sparse GUI environment.
    if let Some(path) = ai_settings::cli_child_path_env(binary) {
        command.env("PATH", path);
    }
    let mut child = command
        .spawn()
        .map_err(|_| failed("The translation tool could not be started."))?;

    // Reader threads own their pipes; the main loop owns the child handle.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut pipe = stdout_pipe;
        let mut buffer = [0u8; 8192];
        if let Some(pipe) = pipe.as_mut() {
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        if out_tx.send(buffer[..count].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });
    let (err_tx, err_rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut collected = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_end(&mut collected);
        }
        let _ = err_tx.send(collected);
    });

    let deadline = Instant::now() + timeout;
    let mut collected = Vec::new();
    loop {
        while let Ok(chunk) = out_rx.try_recv() {
            collected.extend_from_slice(&chunk);
            if collected.len() > MAX_OUTPUT_BYTES {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::new(
                    "proposal_too_large",
                    "The proposal was too large to use safely.",
                ));
            }
            on_chunk(&chunk);
        }
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(failed("The translation tool reported an error."));
            }
        }
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::new(
                "translation_cancelled",
                "The run was cancelled.",
            ));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::new(
                "translation_timeout",
                "The translation took longer than 60 minutes and was stopped. Slow connections can stall output for minutes; retrying keeps any complete sections.",
            ));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    // The process exited; collect whatever is still in flight (bounded: both
    // readers end at EOF once the pipes close).
    while let Ok(chunk) = out_rx.recv_timeout(Duration::from_secs(2)) {
        collected.extend_from_slice(&chunk);
        if collected.len() > MAX_OUTPUT_BYTES {
            break;
        }
        on_chunk(&chunk);
    }
    if collected.len() > MAX_OUTPUT_BYTES {
        let _ = child.wait();
        return Err(AppError::new(
            "proposal_too_large",
            "The proposal was too large to use safely.",
        ));
    }
    let status = child
        .wait()
        .map_err(|_| failed("The translation tool reported an error."))?;
    let stderr = err_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or_default();
    Ok(StreamResult {
        status,
        stdout: collected,
        stderr,
    })
}

fn ensure_success(result: &StreamResult) -> Result<(), AppError> {
    if result.status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "translation_failed",
            format!(
                "The translation tool exited with an error.{}",
                stderr_tail(&result.stderr)
            ),
        ))
    }
}

/// Repair only trailing horizontal rules inside paragraphs, a common source
/// XHTML defect. Preserve every byte except the position of the closing tag.
/// Other invalid nesting remains rejected by the restricted editor validator.
fn normalize_trailing_rules(fragment: &str) -> Result<String, AppError> {
    let opening = FRAGMENT_OPENING;
    let wrapped = format!("{opening}{fragment}</w>");
    let doc = roxmltree::Document::parse(&wrapped).map_err(|error| {
        AppError::new(
            "proposal_invalid",
            format!(
                "The proposal is not well-formed XHTML at {}. Nothing was inserted.",
                error.pos()
            ),
        )
    })?;
    let mut edits = Vec::new();
    for paragraph in doc
        .descendants()
        .filter(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "p")))
    {
        let children: Vec<_> = paragraph.children().collect();
        let Some(first_rule) = children
            .iter()
            .position(|n| n.has_tag_name(("http://www.w3.org/1999/xhtml", "hr")))
        else {
            continue;
        };
        if !children[first_rule..].iter().all(|n| {
            n.is_text() && n.text().is_some_and(|text| text.trim().is_empty())
                || n.has_tag_name(("http://www.w3.org/1999/xhtml", "hr"))
                    && n.children().next().is_none()
        }) {
            continue;
        }
        let range = paragraph.range();
        // This narrow repair handles unprefixed paragraphs only.
        if !wrapped[range.clone()].ends_with("</p>") {
            continue;
        }
        let rule_start = children[first_rule].range().start;
        let closing = range.end - "</p>".len();
        let replacement = format!(
            "{}{}{}",
            &wrapped[range.start..rule_start],
            &wrapped[closing..range.end],
            &wrapped[rule_start..closing]
        );
        edits.push((
            range.start - opening.len()..range.end - opening.len(),
            replacement,
        ));
    }
    let mut normalized = fragment.to_string();
    for (range, replacement) in edits.into_iter().rev() {
        normalized.replace_range(range, &replacement);
    }
    Ok(normalized)
}

/// Validates raw tool output as chapter HTML. Rejects empty, oversized and
/// non-conforming proposals so nothing unsafe reaches the draft.
fn validate_proposal(raw: &[u8]) -> Result<String, AppError> {
    if raw.len() > MAX_OUTPUT_BYTES {
        return Err(AppError::new(
            "proposal_too_large",
            "The proposal was too large to use safely.",
        ));
    }
    let text = std::str::from_utf8(raw).map_err(|_| {
        AppError::new(
            "proposal_invalid",
            "The proposal could not be read. Nothing was inserted.",
        )
    })?;
    if text.trim().is_empty() {
        return Err(AppError::new(
            "proposal_empty",
            "The tool returned no translation. Nothing was inserted.",
        ));
    }
    let normalized = normalize_trailing_rules(text)?;
    let (html, plain) =
        crate::epub::rich_text::validate_document(&normalized).map_err(|error| {
            AppError::new(
                "proposal_invalid",
                format!(
                    "The proposal could not be validated: {} Nothing was inserted.",
                    error.message
                ),
            )
        })?;
    if plain.trim().is_empty() {
        return Err(AppError::new(
            "proposal_empty",
            "The tool returned no translation. Nothing was inserted.",
        ));
    }
    Ok(html)
}

/// Strips Markdown code fences tools often wrap around HTML answers.
fn strip_code_fences(text: &str) -> &str {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed;
    }
    let without_opening = trimmed.split_once('\n').map(|(_, rest)| rest).unwrap_or("");
    without_opening
        .rsplit_once("```")
        .map(|(head, _)| head.trim())
        .unwrap_or_else(|| without_opening.trim())
}

/// Element skeleton of a fragment: tag local names plus sorted attributes in
/// document order. Text is ignored (that is what translation changes).
/// Namespace declarations are ignored; prefixes that cannot resolve make the
/// fragment uncomparable, which fails closed at the call site.
type ElementSkeleton = Vec<(usize, String, Vec<(String, String)>)>;

fn skeleton(fragment: &str) -> Result<ElementSkeleton, AppError> {
    let uncomparable = || {
        AppError::new(
            "proposal_structure",
            "The chapter markup could not be compared safely. Nothing was inserted.",
        )
    };
    let wrapped = format!("{FRAGMENT_OPENING}{fragment}</w>");
    let doc = roxmltree::Document::parse(&wrapped).map_err(|_| uncomparable())?;
    let mut elements = Vec::new();
    for node in doc
        .root_element()
        .descendants()
        .filter(|node| node.is_element())
    {
        let tag = node.tag_name().name().to_ascii_lowercase();
        let mut attrs: Vec<(String, String)> = node
            .attributes()
            .filter(|attr| attr.name() != "xmlns" && !attr.name().starts_with("xmlns:"))
            .map(|attr| (attr.name().to_string(), attr.value().to_string()))
            .collect();
        attrs.sort();
        elements.push((node.ancestors().count(), tag, attrs));
    }
    Ok(elements)
}

/// Requires the proposal to carry the original structure exactly: same
/// elements with same attributes in the same order. Only text may differ.
fn check_skeleton(original: &str, proposal: &str) -> Result<(), AppError> {
    let expected = skeleton(&normalize_trailing_rules(original)?)?;
    let actual = skeleton(&normalize_trailing_rules(proposal)?).map_err(|_| {
        AppError::new(
            "proposal_invalid",
            "The proposal could not be validated. Nothing was inserted.",
        )
    })?;
    if expected == actual {
        Ok(())
    } else {
        // Name the first divergence so Retry can fix exactly one thing.
        let hint = expected
            .iter()
            .zip(actual.iter())
            .enumerate()
            .find(|(_, (a, b))| a != b)
            .map(|(i, (a, b))| {
                format!(
                    " First difference at element {}: expected <{}> but found <{}>.",
                    i + 1,
                    describe_skeleton(a),
                    describe_skeleton(b)
                )
            })
            .unwrap_or_else(|| {
                format!(
                    " Expected {} elements but found {}.",
                    expected.len(),
                    actual.len()
                )
            });
        Err(AppError::new(
            "proposal_structure_changed",
            format!(
                "The tool changed the chapter structure (tags or attributes).{hint} Nothing was inserted."
            ),
        ))
    }
}

fn describe_skeleton(entry: &(usize, String, Vec<(String, String)>)) -> String {
    let attrs = entry
        .2
        .iter()
        .map(|(k, v)| format!("{k}=\"{v}\""))
        .collect::<Vec<_>>()
        .join(" ");
    if attrs.is_empty() {
        entry.1.clone()
    } else {
        format!("{} {}", entry.1, attrs)
    }
}

/// Rewrites proposal `<img>` sources that point at the book's own files into
/// `data:` URLs from the immutable snapshot so the Rich editor can display
/// them (the same convention manual image insertion uses; export packages
/// them back). Unresolvable sources stay untouched — the original files are
/// preserved in the package, so they still resolve on export.
fn embed_proposal_images(html: &str, snapshot_path: &Path, chapter_href: &str) -> String {
    let wrapped = format!("{FRAGMENT_OPENING}{html}</w>");
    let Ok(doc) = roxmltree::Document::parse(&wrapped) else {
        return html.to_string();
    };
    let Ok(mut snapshot) = crate::epub::archive::SafeArchive::open(
        snapshot_path,
        &crate::security::ArchiveLimits::default(),
    ) else {
        return html.to_string();
    };
    let mut output = html.to_string();
    for node in doc.descendants().filter(|n| n.has_tag_name("img")) {
        let Some(src) = node.attribute("src") else {
            continue;
        };
        if src.starts_with("data:")
            || src.contains(':')
            || src.starts_with('/')
            || src.starts_with("\\")
        {
            continue;
        }
        let resolved = crate::epub::resolve_href(chapter_href, src);
        let Ok(bytes) = snapshot.read_entry(&resolved) else {
            continue;
        };
        if bytes.len() > 8 * 1024 * 1024 {
            continue;
        }
        let Some(mime) = crate::epub::rich_text::image_mime_from_bytes(&bytes) else {
            continue;
        };
        let data_url = format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let escaped = crate::epub::preview::escape_html_text(src);
        output = output.replace(
            &format!("src=\"{escaped}\""),
            &format!("src=\"{data_url}\""),
        );
    }
    output
}

/// Last lines of tool stderr for a failure message. Local display only.
fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let tail: String = trimmed.chars().rev().take(MAX_STDERR_CHARS).collect();
    let tail: String = tail.chars().rev().collect();
    format!("\n\nTool output:\n{tail}")
}

fn create_work_dir(job_id: &str) -> Result<PathBuf, AppError> {
    let dir = std::env::temp_dir().join(format!("sagar-ai-{job_id}"));
    std::fs::create_dir_all(&dir)
        .map_err(|_| AppError::new("task_failed", "The translation job could not start."))?;
    Ok(dir)
}

fn event(
    job_id: &str,
    chapter_id: &str,
    kind: &str,
    proposal_html: Option<String>,
    partial_text: Option<String>,
    message: String,
) -> AiTranslationEvent {
    AiTranslationEvent {
        job_id: job_id.to_string(),
        chapter_id: chapter_id.to_string(),
        kind: kind.to_string(),
        proposal_html,
        partial_text,
        message,
    }
}

/// Minimum gap between `stream` progress events.
const STREAM_EMIT_INTERVAL: Duration = Duration::from_millis(750);

/// Starts a translation run after synchronous preflight (consent, agent,
/// model, chapter source, tool presence). Only execution is asynchronous;
/// progress arrives through `emit`. The saved draft is never modified here.
pub fn start_ai_translation<F>(
    data_dir: &Path,
    input: StartTranslationInput,
    emit: F,
) -> Result<AiTranslationStart, AppError>
where
    F: Fn(AiTranslationEvent) + Send + 'static,
{
    if !input.consent {
        return Err(AppError::new(
            "consent_required",
            "Confirm that the chapter text may be sent to the translation tool.",
        ));
    }
    let agent = ai_settings::TranslationAgent::parse(&input.agent).ok_or_else(|| {
        AppError::new(
            "invalid_agent",
            "Choose Codex, OpenCode, Claude Code or a saved custom provider.",
        )
    })?;
    let cli_id = match &agent {
        ai_settings::TranslationAgent::Cli(id) => *id,
        ai_settings::TranslationAgent::Custom(_) => {
            return Err(AppError::new(
                "agent_unsupported",
                "Custom API translation is not supported yet; pick Codex, OpenCode or Claude Code.",
            ));
        }
    };
    let model = ai_settings::validate_model(&input.model).map_err(|_| {
        AppError::new(
            "invalid_model",
            "Choose a model before generating a proposal.",
        )
    })?;
    let effort = ai_settings::validate_reasoning_effort(
        data_dir,
        &input.agent,
        &model,
        input.reasoning_effort.as_deref(),
    )?;
    let current_instructions = crate::services::book_settings::validate_instructions(
        input.current_instructions.as_deref().unwrap_or(""),
    )?;
    let conn = crate::services::workspace::open_db(data_dir)?;
    let source = ai_translate::translation_source(&conn, input.chapter_id.trim())?;
    // The original body travels so tables, images, links and attributes can
    // round-trip. Plain paragraphs only decide whether a run is worthwhile.
    let snapshot_abs = crate::services::workspace::snapshot_path(data_dir, &source.project_id)?;
    let body_html = {
        let mut snapshot = crate::epub::archive::SafeArchive::open(
            &snapshot_abs,
            &crate::security::ArchiveLimits::default(),
        )?;
        let bytes = snapshot.read_entry(&source.resource_href)?;
        crate::epub::export::chapter_body_inner(&bytes)?
    };
    if body_html.trim().is_empty() {
        return Err(AppError::new(
            "nothing_translatable",
            "This chapter has no translatable content.",
        ));
    }
    if body_html.chars().count() > MAX_SOURCE_CHARS {
        return Err(AppError::new(
            "chapter_too_long",
            "This chapter is too long for a single proposal.",
        ));
    }
    let (prefix, remaining) =
        continuation_parts(&body_html, input.previous_output.as_deref().unwrap_or(""))?;
    let binary = ai_settings::find_cli_binary(cli_id).ok_or_else(|| {
        AppError::new(
            "provider_not_available",
            "The translation tool was not found. Install it, then reopen Sagar and try again.",
        )
    })?;
    drop(conn);

    let job_id = uuid::Uuid::new_v4().to_string();
    let job = std::sync::Arc::new(ActiveJob {
        cancel: AtomicBool::new(false),
    });
    lock_jobs()?.insert(job_id.clone(), std::sync::Arc::clone(&job));
    let thread_job_id = job_id.clone();

    let prompt = build_book_translation_prompt(
        source.source_language.as_deref(),
        &source.target_language,
        &remaining,
        &source.instructions,
        &current_instructions,
    );
    let args = agent_args(cli_id, &model, &prompt, effort.as_deref());
    let chapter_id = input.chapter_id.trim().to_string();
    std::thread::spawn(move || {
        let finish = |kind: &str,
                      proposal_html: Option<String>,
                      partial_text: Option<String>,
                      message: String| {
            emit(event(
                &thread_job_id,
                &chapter_id,
                kind,
                proposal_html,
                partial_text,
                message,
            ));
            if kind != "started"
                && kind != "stream"
                && let Ok(mut jobs) = JOBS.lock()
            {
                jobs.remove(&thread_job_id);
            }
        };
        finish(
            "started",
            None,
            None,
            "The translation tool started.".to_string(),
        );
        let work_dir = match create_work_dir(&thread_job_id) {
            Ok(dir) => dir,
            Err(error) => {
                finish("failed", None, None, error.message);
                return;
            }
        };
        let mut streamed: Vec<u8> = prefix.as_bytes().to_vec();
        finish("stream", None, Some(prefix.clone()), String::new());
        let mut last_emit = Instant::now()
            .checked_sub(STREAM_EMIT_INTERVAL)
            .unwrap_or_else(Instant::now);
        let outcome = if !prefix.is_empty() && remaining.trim().is_empty() {
            validate_proposal(prefix.as_bytes())
        } else {
            execute_streaming(
                &binary,
                &args,
                &work_dir,
                &job.cancel,
                TRANSLATION_TIMEOUT,
                |chunk| {
                    streamed.extend_from_slice(chunk);
                    if last_emit.elapsed() >= STREAM_EMIT_INTERVAL {
                        last_emit = Instant::now();
                        emit(event(
                            &thread_job_id,
                            &chapter_id,
                            "stream",
                            None,
                            Some(String::from_utf8_lossy(&streamed).to_string()),
                            String::new(),
                        ));
                    }
                },
            )
            .and_then(|result| ensure_success(&result).map(|_| result))
            .and_then(|result| {
                let decoded = String::from_utf8_lossy(&result.stdout);
                let stripped = strip_code_fences(&decoded);
                validate_proposal(format!("{prefix}{stripped}").as_bytes())
            })
        }
        .and_then(|proposal| {
            check_skeleton(&body_html, &proposal)?;
            Ok(embed_proposal_images(
                &proposal,
                &snapshot_abs,
                &source.resource_href,
            ))
        });
        let _ = std::fs::remove_dir_all(&work_dir);
        match outcome {
            Err(error) if error.code == "translation_cancelled" => {
                finish("cancelled", None, None, error.message);
            }
            Err(error) => {
                finish(
                    "failed",
                    None,
                    Some(String::from_utf8_lossy(&streamed).to_string()),
                    error.message,
                );
            }
            Ok(proposal) => finish("done", Some(proposal), None, "Proposal ready.".to_string()),
        }
    });

    Ok(AiTranslationStart { job_id })
}

/// Starts an HTML-fix run over the user's current draft HTML after
/// synchronous preflight (consent, agent, model, tool presence). Only
/// execution is asynchronous; progress arrives through `emit`. The saved
/// draft is never modified here.
pub fn start_ai_html_fix<F>(
    data_dir: &Path,
    input: StartHtmlFixInput,
    emit: F,
) -> Result<crate::domain::AiHtmlFixStart, AppError>
where
    F: Fn(crate::domain::AiHtmlFixEvent) + Send + 'static,
{
    use crate::domain::AiHtmlFixEvent;

    if !input.consent {
        return Err(AppError::new(
            "consent_required",
            "Confirm that the draft text may be sent to the repair tool.",
        ));
    }
    let agent = ai_settings::TranslationAgent::parse(&input.agent).ok_or_else(|| {
        AppError::new(
            "invalid_agent",
            "Choose Codex, OpenCode, Claude Code or a saved custom provider.",
        )
    })?;
    let cli_id = match &agent {
        ai_settings::TranslationAgent::Cli(id) => *id,
        ai_settings::TranslationAgent::Custom(_) => {
            return Err(AppError::new(
                "agent_unsupported",
                "Custom API repair is not supported yet; pick Codex, OpenCode or Claude Code.",
            ));
        }
    };
    let model = ai_settings::validate_model(&input.model)
        .map_err(|_| AppError::new("invalid_model", "Choose a model before repairing the HTML."))?;
    let effort = ai_settings::validate_reasoning_effort(
        data_dir,
        &input.agent,
        &model,
        input.reasoning_effort.as_deref(),
    )?;
    let html = input.html.trim().to_string();
    if html.is_empty() {
        return Err(AppError::new(
            "nothing_repairable",
            "There is no draft HTML to repair.",
        ));
    }
    if html.chars().count() > MAX_SOURCE_CHARS {
        return Err(AppError::new(
            "chapter_too_long",
            "This chapter is too long for a single repair.",
        ));
    }
    let binary = ai_settings::find_cli_binary(cli_id).ok_or_else(|| {
        AppError::new(
            "provider_not_available",
            "The repair tool was not found. Install it, then reopen Sagar and try again.",
        )
    })?;

    let job_id = uuid::Uuid::new_v4().to_string();
    let job = std::sync::Arc::new(ActiveJob {
        cancel: AtomicBool::new(false),
    });
    lock_jobs()?.insert(job_id.clone(), std::sync::Arc::clone(&job));
    let thread_job_id = job_id.clone();

    let prompt = build_html_fix_prompt(&html);
    let args = agent_args(cli_id, &model, &prompt, effort.as_deref());
    let chapter_id = input.chapter_id.trim().to_string();
    std::thread::spawn(move || {
        let finish = |kind: &str,
                      fixed_html: Option<String>,
                      partial_text: Option<String>,
                      message: String| {
            emit(AiHtmlFixEvent {
                job_id: thread_job_id.clone(),
                chapter_id: chapter_id.clone(),
                kind: kind.to_string(),
                fixed_html,
                partial_text,
                message,
            });
            if kind != "started"
                && kind != "stream"
                && let Ok(mut jobs) = JOBS.lock()
            {
                jobs.remove(&thread_job_id);
            }
        };
        finish(
            "started",
            None,
            None,
            "The repair tool started.".to_string(),
        );
        let work_dir = match create_work_dir(&thread_job_id) {
            Ok(dir) => dir,
            Err(error) => {
                finish("failed", None, None, error.message);
                return;
            }
        };
        let mut streamed: Vec<u8> = Vec::new();
        finish("stream", None, Some(String::new()), String::new());
        let mut last_emit = Instant::now()
            .checked_sub(STREAM_EMIT_INTERVAL)
            .unwrap_or_else(Instant::now);
        let outcome = execute_streaming(
            &binary,
            &args,
            &work_dir,
            &job.cancel,
            TRANSLATION_TIMEOUT,
            |chunk| {
                streamed.extend_from_slice(chunk);
                if last_emit.elapsed() >= STREAM_EMIT_INTERVAL {
                    last_emit = Instant::now();
                    emit(AiHtmlFixEvent {
                        job_id: thread_job_id.clone(),
                        chapter_id: chapter_id.clone(),
                        kind: "stream".to_string(),
                        fixed_html: None,
                        partial_text: Some(String::from_utf8_lossy(&streamed).to_string()),
                        message: String::new(),
                    });
                }
            },
        )
        .and_then(|result| ensure_success(&result).map(|_| result))
        .and_then(|result| {
            let decoded = String::from_utf8_lossy(&result.stdout);
            let stripped = strip_code_fences(&decoded);
            validate_proposal(stripped.as_bytes())
        });
        let _ = std::fs::remove_dir_all(&work_dir);
        match outcome {
            Err(error) if error.code == "translation_cancelled" => {
                finish("cancelled", None, None, error.message);
            }
            Err(error) => {
                finish(
                    "failed",
                    None,
                    Some(String::from_utf8_lossy(&streamed).to_string()),
                    error.message,
                );
            }
            Ok(fixed) => finish("done", Some(fixed), None, "Repair ready.".to_string()),
        }
    });

    Ok(crate::domain::AiHtmlFixStart { job_id })
}

/// Requests cancellation of a running job. The worker observes the flag
/// within one poll interval, kills the child, and emits the terminal event.
pub fn cancel_ai_translation(job_id: &str) -> Result<(), AppError> {
    if job_id.trim().is_empty() {
        return Err(AppError::new(
            "invalid_job",
            "This translation job cannot be cancelled safely.",
        ));
    }
    let jobs = lock_jobs()?;
    let Some(job) = jobs.get(job_id.trim()) else {
        return Err(AppError::new(
            "job_not_found",
            "This translation job is no longer running.",
        ));
    };
    job.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn translation_deadline_is_one_hour() {
        // Long chapters and slow connections need headroom; the dialogs
        // advertise this deadline and warn on stalls before it.
        assert_eq!(TRANSLATION_TIMEOUT, Duration::from_secs(60 * 60));
    }

    #[test]
    fn prompts_combine_book_and_current_guidance_with_preservation_rules() {
        let prompt = build_book_translation_prompt(
            Some("en"),
            "my",
            "<p>Fan Xian</p>",
            "Use ဖန်ရှန်း for Fan Xian.",
            "Use formal speech in this chapter.",
        );
        assert!(prompt.contains("ဖန်ရှန်း"));
        assert!(prompt.contains("Use formal speech"));
        assert!(prompt.contains("<p>Fan Xian</p>"));
        assert!(prompt.contains("Keep every tag"));
        assert!(
            crate::services::book_settings::validate_instructions(&"x".repeat(20_001)).is_err()
        );
    }

    #[test]
    fn html_fix_prompt_preserves_text_without_translating() {
        let prompt = build_html_fix_prompt("<div><p>မင်္ဂလာပါ</p></div>");
        assert!(prompt.contains("မင်္ဂလာပါ"));
        assert!(prompt.contains("Do NOT translate"));
        assert!(prompt.contains("p, h1"));
        assert!(prompt.contains("Convert <i> to <em> and <b> to <strong>"));
        assert!(prompt.contains("do not unwrap these elements"));
        assert!(prompt.contains("Output only the fixed HTML fragment"));
    }

    #[test]
    fn completed_proposal_repairs_source_trailing_rule_without_losing_unicode_or_attributes() {
        let proposal = include_str!("../../../tests/fixtures/ai/trailing-rule.xhtml");
        let validated = validate_proposal(proposal.as_bytes()).expect("valid proposal");
        assert!(
            validated.contains("<p class=\"footnote4\" id=\"credits\">ဘာသာပြန်: Example</p><hr/>")
        );
        assert!(validated.contains("<em>မြန်မာ</em>"));
        check_skeleton(proposal, &validated).expect("same normalized structure");
        crate::epub::rich_text::validate_document(&validated).expect("savable draft");
        assert_eq!(
            normalize_trailing_rules(&validated).expect("normalize"),
            validated
        );
        let (prefix, remaining) = continuation_parts(proposal, proposal).expect("completed retry");
        assert!(remaining.trim().is_empty());
        assert_eq!(
            validate_proposal(prefix.as_bytes()).expect("recover completed"),
            validated.trim_end()
        );
    }

    #[test]
    fn rule_repair_preserves_multiple_rules_and_rejects_other_invalid_nesting() {
        let fragment = "<p id=\"note\">Text<hr class=\"divider\"/> \n<hr/></p>";
        assert_eq!(
            normalize_trailing_rules(fragment).expect("normalize"),
            "<p id=\"note\">Text</p><hr class=\"divider\"/> \n<hr/>"
        );
        assert!(validate_proposal(b"<p>Before<hr/>After</p>").is_err());
        assert!(validate_proposal(b"<p>Text<div>Block</div></p>").is_err());
        assert!(validate_proposal(b"<p>Text<hr onclick=\"alert(1)\"/></p>").is_err());
        assert!(
            check_skeleton(
                "<blockquote><p>One</p></blockquote>",
                "<blockquote></blockquote><p>Two</p>"
            )
            .is_err()
        );
    }

    #[test]
    fn effort_overrides_use_each_cli_control_and_leave_prompt_intact() {
        for (agent, flag, value) in [
            (
                CliProviderId::Codex,
                "--config",
                "model_reasoning_effort=\"xhigh\"",
            ),
            (CliProviderId::Opencode, "--variant", "xhigh"),
            (CliProviderId::ClaudeCode, "--effort", "xhigh"),
        ] {
            let args = agent_args(agent, "model", "Translate.", Some("xhigh"));
            if agent == CliProviderId::Codex {
                assert!(args.iter().any(|a| a == "--skip-git-repo-check"));
            }
            let position = args.iter().position(|a| a == flag).expect("flag");
            assert_eq!(args[position + 1], value);
            assert_eq!(args.iter().filter(|a| *a == "Translate.").count(), 1);
            assert!(
                !agent_args(agent, "model", "Translate.", None)
                    .iter()
                    .any(|a| a == flag)
            );
        }
    }

    #[test]
    fn imprint_body_with_inherited_epub_namespace_can_start_and_resume() {
        let source = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en-US">
<head><title>Imprint</title></head><body epub:type="frontmatter"><section id="imprint" epub:type="imprint"><header><h2 epub:type="title">Imprint</h2><img src="../images/logo.png" srcset="../images/logo-2x.png 2x, ../images/logo.png 1x" alt="Logo" epub:type="z3998:publisher-logo"/></header><p>Text <a href="https://standardebooks.org/">Standard Ebooks</a></p></section><p>Next</p></body></html>"#;
        let body = crate::epub::export::chapter_body_inner(source.as_bytes()).expect("body");
        assert_eq!(
            continuation_parts(&body, "").expect("start"),
            (String::new(), body.clone())
        );
        let translated = body.replace("Imprint</h2>", "မြန်မာ</h2>");
        check_skeleton(&body, &translated).expect("preserved structure");
        let complete = translated.split("<p>Next").next().expect("section");
        let (prefix, remaining) =
            continuation_parts(&body, &format!("{complete}<p>unfinished")).expect("resume");
        assert_eq!(prefix, complete);
        assert_eq!(remaining, "<p>Next</p>");
        assert!(
            check_skeleton(
                &body,
                &translated.replace("z3998:publisher-logo", "changed")
            )
            .is_err()
        );
        assert!(continuation_parts("<p unknown:type=\"x\">Text</p>", "").is_err());
    }

    #[test]
    fn retry_keeps_complete_sections_and_regenerates_truncated_unicode_tail() {
        let original = "<h1>Title</h1>\n<p class=\"a\">One</p><p>Two</p>";
        let partial = "<h1>ခေါင်းစဉ်</h1>\n<p class=\"a\">တစ်</p><p>နှစ်";
        let (prefix, remaining) = continuation_parts(original, partial).expect("resume");
        assert_eq!(prefix, "<h1>ခေါင်းစဉ်</h1>\n<p class=\"a\">တစ်</p>");
        assert_eq!(remaining, "<p>Two</p>");
        check_skeleton(original, &format!("{prefix}<p>နှစ်</p>")).expect("combined");
    }

    #[test]
    fn retry_stops_before_changed_structure_and_handles_nested_blocks() {
        let original = "<div><p>One</p><p>Two</p></div><p>Three</p>";
        let (prefix, remaining) = continuation_parts(
            original,
            "<div><p>တစ်</p><p>နှစ်</p></div><p id=\"changed\">သုံး</p>",
        )
        .expect("resume");
        assert_eq!(prefix, "<div><p>တစ်</p><p>နှစ်</p></div>");
        assert_eq!(remaining, "<p>Three</p>");
        assert_eq!(
            continuation_parts(original, "<div><p>တစ်</p>")
                .expect("incomplete")
                .0,
            ""
        );
        assert_eq!(continuation_parts(original, "").expect("fresh").1, original);
    }

    #[test]
    fn prompt_carries_html_and_structure_rules() {
        let body = "<h1>Title</h1><p>First <img src=\"images/a.png\"/></p>";
        let prompt = build_translation_prompt(Some("en"), "my", body);
        assert!(prompt.contains("\"my\""), "{prompt}");
        assert!(prompt.contains("from en"), "{prompt}");
        assert!(prompt.contains(body), "{prompt}");
        assert!(prompt.contains("Keep every tag"), "{prompt}");
        assert!(prompt.contains("<em> for italics"), "{prompt}");
        assert!(prompt.contains("<strong> for"), "{prompt}");
        assert!(
            prompt.contains("conversion belongs to AI Fix HTML"),
            "{prompt}"
        );
        assert!(prompt.contains("no code fences"), "{prompt}");
        assert!(
            prompt.contains("Return valid, well-formed XHTML"),
            "{prompt}"
        );
        assert!(prompt.contains("quote all attribute values"), "{prompt}");
        assert!(prompt.contains("self-close void elements"), "{prompt}");
        assert!(prompt.contains("&amp; and &lt;"), "{prompt}");
        assert!(
            prompt.contains("introduce HTML-only named entities"),
            "{prompt}"
        );
    }

    #[test]
    fn prompt_falls_back_without_a_source_language() {
        let prompt = build_translation_prompt(None, "my", "<p>Hi.</p>");
        assert!(prompt.contains("the original language"), "{prompt}");
    }

    #[test]
    fn fences_and_skeletons_behave() {
        assert_eq!(strip_code_fences("```html\n<p>Hi</p>\n```"), "<p>Hi</p>");
        assert_eq!(strip_code_fences("<p>Hi</p>"), "<p>Hi</p>");

        let original = "<h1>T</h1><p>One <img src=\"a.png\"/></p>";
        // Text changes are fine.
        check_skeleton(original, "<h1>X</h1><p>Two <img src=\"a.png\"/></p>").expect("text-only");
        // Structural changes are rejected.
        assert_eq!(
            check_skeleton(original, "<h1>X</h1><p>Two</p>")
                .expect_err("dropped image")
                .code,
            "proposal_structure_changed"
        );
        assert_eq!(
            check_skeleton(original, "<h1>X</h1><p>Two <img src=\"b.png\"/></p>")
                .expect_err("changed src")
                .code,
            "proposal_structure_changed"
        );
        assert_eq!(
            check_skeleton(original, "<h1>X</h1><p>Two</p><p>Extra</p>")
                .expect_err("added element")
                .code,
            "proposal_structure_changed"
        );
    }

    #[test]
    fn agent_arguments_use_fixed_documented_flags() {
        let codex = agent_args(CliProviderId::Codex, "gpt-5.6-sol", "Translate.", None);
        assert_eq!(
            codex[..4],
            ["exec", "--skip-git-repo-check", "--model", "gpt-5.6-sol"]
        );
        assert_eq!(codex[4], "Translate.");

        let opencode = agent_args(
            CliProviderId::Opencode,
            "openai/gpt-5.2",
            "Translate.",
            None,
        );
        assert_eq!(opencode[..3], ["run", "--model", "openai/gpt-5.2"]);

        let claude = agent_args(CliProviderId::ClaudeCode, "sonnet", "Translate.", None);
        assert!(claude.contains(&"-p".to_string()));
        assert!(claude.contains(&"--output-format".to_string()));
        assert_eq!(claude.last().map(String::as_str), Some("5"));
    }

    #[test]
    fn proposals_reject_empty_oversized_and_active_content() {
        assert_eq!(
            validate_proposal(b"   ").expect_err("blank").code,
            "proposal_empty"
        );
        assert_eq!(
            validate_proposal(b"<script>bad()</script>")
                .expect_err("active content")
                .code,
            "proposal_invalid"
        );
        assert!(validate_proposal("<p>Hi</p>".as_bytes()).is_ok());
        let big = vec![b'x'; MAX_OUTPUT_BYTES + 1];
        assert_eq!(
            validate_proposal(&big).expect_err("oversized").code,
            "proposal_too_large"
        );
    }

    #[cfg(unix)]
    mod unix_runner_tests {
        use super::*;
        use std::io::Write as _;

        fn stub_script(body: &str) -> PathBuf {
            let dir = tempfile::tempdir().expect("temp dir").keep();
            let path = dir.join(format!("stub-{}", uuid::Uuid::new_v4()));
            let mut file = std::fs::File::create(&path).expect("create stub");
            writeln!(file, "#!/bin/sh").expect("shebang");
            writeln!(file, "{body}").expect("body");
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .expect("chmod stub");
            path
        }

        fn run_collected(
            stub: &Path,
            args: &[String],
            cancel: &AtomicBool,
            timeout: Duration,
        ) -> (Result<StreamResult, AppError>, Vec<Vec<u8>>) {
            let dir = tempfile::tempdir().expect("work dir");
            let mut chunks = Vec::new();
            let result = execute_streaming(stub, args, dir.path(), cancel, timeout, |chunk| {
                chunks.push(chunk.to_vec());
            });
            (result, chunks)
        }

        #[test]
        fn stub_success_streams_chunks_and_collects_output() {
            let stub = stub_script("echo '<p>hi</p>'");
            let (result, chunks) = run_collected(
                &stub,
                &["anything".to_string()],
                &AtomicBool::new(false),
                Duration::from_secs(10),
            );
            let result = result.expect("stub runs");
            assert!(result.status.success());
            assert!(ensure_success(&result).is_ok());
            assert!(String::from_utf8_lossy(&result.stdout).contains("<p>hi</p>"));
            let streamed: Vec<u8> = chunks.concat();
            assert_eq!(streamed, result.stdout);
        }

        #[test]
        fn slow_output_arrives_as_multiple_chunks() {
            let stub = stub_script("for i in 1 2 3; do echo \"line$i\"; sleep 0.2; done");
            let (result, chunks) =
                run_collected(&stub, &[], &AtomicBool::new(false), Duration::from_secs(10));
            let result = result.expect("stub runs");
            assert!(
                chunks.len() >= 2,
                "expected streamed chunks, got {}",
                chunks.len()
            );
            let text = String::from_utf8_lossy(&result.stdout);
            assert!(text.contains("line1") && text.contains("line3"), "{text}");
        }

        #[test]
        fn nonzero_exits_and_timeouts_surface_distinct_errors() {
            let failing = stub_script("echo oops >&2; exit 3");
            let (result, _) = run_collected(
                &failing,
                &[],
                &AtomicBool::new(false),
                Duration::from_secs(10),
            );
            let result = result.expect("waited");
            let error = ensure_success(&result).expect_err("nonzero");
            assert_eq!(error.code, "translation_failed");
            assert!(
                error.message.contains("oops"),
                "stderr tail: {}",
                error.message
            );

            let sleeping = stub_script("sleep 30");
            let (result, _) = run_collected(
                &sleeping,
                &[],
                &AtomicBool::new(false),
                Duration::from_millis(300),
            );
            assert_eq!(result.expect_err("deadline").code, "translation_timeout");
        }

        #[test]
        fn cancel_flags_stop_a_running_child() {
            let sleeping = stub_script("sleep 30");
            let dir = tempfile::tempdir().expect("work dir");
            let cancel = AtomicBool::new(false);
            std::thread::scope(|scope| {
                scope.spawn(|| {
                    std::thread::sleep(Duration::from_millis(200));
                    cancel.store(true, Ordering::SeqCst);
                });
                let mut chunks = 0usize;
                let error = execute_streaming(
                    &sleeping,
                    &[],
                    dir.path(),
                    &cancel,
                    Duration::from_secs(30),
                    |_| chunks += 1,
                )
                .expect_err("cancelled");
                assert_eq!(error.code, "translation_cancelled");
            });
        }

        #[test]
        fn oversized_output_kills_the_child() {
            let flooding = stub_script(
                "i=0; while [ $i -lt 150000 ]; do printf 'xxxxxxxxxx'; i=$((i+1)); done",
            );
            let (result, _) = run_collected(
                &flooding,
                &[],
                &AtomicBool::new(false),
                Duration::from_secs(30),
            );
            assert_eq!(result.expect_err("oversized").code, "proposal_too_large");
        }
    }
}
