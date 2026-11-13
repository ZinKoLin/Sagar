# Sagar project handoff

**Reviewed:** 2026-11-13  
**Purpose:** A compact, current project record for a developer or AI continuing work in this repository.  
**Source of truth:** Current code and migrations first; then this handoff; then the dated history in [`plan.md`](plan.md) and the milestone documents. Where an older milestone document conflicts with later implemented behavior, use the dated follow-up in `plan.md` and verify the code.

## Product and workflow

Sagar is a desktop EPUB reading and translation studio. Users import an EPUB, browse chapters in spine order, read the source, write a Myanmar translation, save/review chapters and export a separate EPUB while preserving the original book and its resources.

The current product includes both manual chapter authoring and user-authorized AI assistance. AI requests are user initiated and use a selected local CLI or configured provider; when an external API provider is selected, the requested chapter text is sent to that provider. Do not repeat the older README claim that book content can never leave the device without correcting it: that statement conflicts with the implemented opt-in external-provider workflow. Keep the provider, consent and destination clear to the user.

Current supported/implemented areas include EPUB 3 import/export, EPUB 2 NCX navigation fallback, a restricted rich-text and HTML chapter editor, autosave and revisions, local project storage, review/export, custom book metadata and cover, CLI/custom AI providers, long-chapter grouped translation, recoverable translation output, live translation preview, background chapter translation, optional sequential chapter continuation, English–Myanmar bilingual study view and bilingual EPUB export. Unsupported content must remain preserved or be explicitly warned about; never silently claim arbitrary XHTML is editable.

## Milestone status

The master roadmap `dev/plan.md` marks milestones 0–4 implemented; milestone 5, desktop release and cross-platform verification, remains open. This does **not** mean all native, cross-platform or external-reader checks are complete. EPUBCheck has not been reported as run. Some milestone checklists predate later features and still have pending items that must not be marked complete without evidence.

The newest chronological implementation entries in `dev/plan.md` cover long-chapter translation, EPUB 2 NCX navigation, bilingual export, the English–Myanmar study view, sequential translation, numbered lists, output recovery, background translation and live translation preview. Earlier entries document extensive XHTML preservation/error-recovery work. Read the relevant dated entry before changing those features.

## Technical stack and development

- Desktop: Tauri 2, Rust 2024 edition.
- UI: React 19, TypeScript, Vite 8, Tiptap 3.
- JavaScript package manager: Bun only (`bun.lock` is authoritative; do not add npm/pnpm/Yarn lockfiles).
- Local persistence: Rust-owned SQLite via `rusqlite`; current ordered schema migrations are 1–10 in `src-tauri/src/storage/migrations.rs`.
- EPUB parser/exporter: Rust modules under `src-tauri/src/epub`; frontend calls typed Tauri wrappers under `src/lib/tauri`.
- Styles and reusable controls: `src/styles/tokens.css`, `src/styles/app.css`, shared `Icon` and splitter components.
- Package version at this review: `0.2.5`. Keep `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the `sagar` package in `src-tauri/Cargo.lock` synchronized through the release scripts; see `README.md`.

From the repository root:

```powershell
bun install
bun tauri dev
bun run check
cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

`bun run check` runs Biome lint and the TypeScript/Vite production build. Run only checks relevant to the change, and report exact failures. Do not claim a native UI check from a successful build.

### Windows development note

On 2026-11-06, `bun tauri dev` compiled successfully but launching its child process from the command session hit WebView2 `0x800700AA` (“The requested resource is in use”). Starting Vite separately with `bun run dev`, then launching `src-tauri/target/debug/sagar.exe` through the desktop session, opened the Tauri app at `http://localhost:1420/` and displayed the 11-book library. This is a recorded workaround, not a diagnosed permanent fix. If it recurs, first check whether port 1420 is occupied and whether an existing Sagar/WebView2 process is holding the profile; avoid killing unrelated WebView2 processes. The Vite server must stay running for the debug executable's dev URL.

## Architecture and important paths

### Frontend

- `src/app/App.tsx`: application and library/workspace routing.
- `src/features/library/`: project library and import/open actions.
- `src/features/chapters/`: chapter picker, sidebar and navigation tree.
- `src/features/reader/`: safe source rendering, original HTML view and bilingual study view.
- `src/features/translator/`: chapter rich-text/HTML editor, structure preservation, AI translation/recovery dialog and streamed preview.
- `src/features/workspace/`: book workspace, language and per-book settings.
- `src/features/export/`: export review/options.
- `src/lib/tauri/`: typed Rust command bridge.
- `src/styles/`: design tokens and application styles.

### Rust backend

- `src-tauri/src/commands/mod.rs`: thin validated Tauri command adapters.
- `src-tauri/src/domain/`: project, chapter and AI request/response data types.
- `src-tauri/src/epub/`: safe ZIP/OCF, XML, OPF, navigation, import/export and rich-HTML validation.
- `src-tauri/src/services/`: project, workspace, settings, import/export and explicit AI/provider use cases.
- `src-tauri/src/storage/`: SQLite setup, ordered migrations, projects, chapter documents, providers and translation-output recovery.
- `src-tauri/tests/` and `tests/frontend/`: Rust EPUB integration and frontend regression suites.

## Persistence and content safety

- The user's imported EPUB remains immutable. Sagar stores a private snapshot and records the original hash/path; exports are separate files.
- SQLite is authoritative for saved project/chapter work. Current data includes project/chapter identity, chapter documents/revisions, AI selection/custom providers and append-only translation output snapshots (`translation_outputs`, migration 10).
- Translation output is retained before structural validation so an invalid proposal can be inspected/repaired without translating again. Retry should resume from the last structurally matching section where supported; do not replace saved drafts or source content implicitly.
- The rich editor is deliberately restricted. Validate HTML and compare structure before converting. Preserve inline tags/attributes, anchors and targets, IDs, lists and numbering, page-break markers, images and EPUB-relative references. Unsupported structures remain recoverable in HTML/source form with an actionable warning.
- Treat EPUB files as untrusted input. Keep path/ZIP/XML limits, sanitize the source preview, do not execute book scripts, and resolve resources relative to the containing document.
- Network use is not implicit: local CLI use and external provider use have different privacy implications. Do not log book text, secrets or unnecessary local paths.

## AI translation lifecycle

The AI translation feature was explicitly requested after the original manual-only MVP was documented. Its current UI supports selecting/configuring providers, generating and retrying chapter translations, streaming progress, retaining output, validating/recovering HTML, and optional background/sequential work. A background job belongs to the open book/workspace and is not persisted across app restart. Normal completion retains a proposal for user review/insertion; optional auto-continue has guards for existing/changed drafts and save/validation failures. Read the detailed dated entries in `dev/plan.md` before modifying job lifetime, retry boundaries, consent prompts or insertion behavior.

## Bilingual study and export

The source pane can pair each English sentence with its Myanmar translation and display model-proposed matching words/phrases in shared colors with meaning and grammar information. Validate matches against literal spans in the source and translation; discard invalid spans individually and keep valid pairs. Analysis is batched and cached locally against chapter/source/translation versions. Study analysis must not mutate the saved translation.

Bilingual export is an optional separate EPUB output. It pairs matching source/translation blocks, preserves safe markup, and may apply cached study-view highlights. If block structure cannot be paired safely, stop with a clear error; do not guess or alter the source EPUB. The export's generated output still needs verification in a real reader and EPUBCheck where available.

## Current working-tree caution (2026-11-13)

Publication follow-up: the user requested uploading the current project. The
existing feature edits described below are being committed together with the
provider fixes and documentation to the user's existing GitHub fork,
https://github.com/ZinKoLin/Sagar, branch codex/sagar-translation-updates.
Upstream saturngod/Sagar is read-only for this account. This snapshot preserves
the existing work; publication is not certification of all feature acceptance
criteria. Re-check git status and the branch before the next edit.

At review time the worktree already contained **33 modified tracked files and 6 new files** before this handoff edit; these are not committed changes. They span AI streaming/recovery and persistence, chapter lifecycle UI, bilingual study/export, rich HTML structure and regression coverage. New files include `src-tauri/src/storage/translation_outputs.rs`, `src/features/reader/BilingualStudyView.tsx`, `src/features/translator/LiveTranslationPreview.tsx`, and frontend tests for background translation, bilingual study and live preview. `dev/plan.md` also already contained its chronological feature entries as an uncommitted edit.

Do not reset, revert, cherry-pick over, or broadly reformat these changes. Before continuing, run `git status --short` and inspect the actual diff; this document summarizes their apparent feature scope but does not certify every uncommitted line. No tests or build were run as part of this documentation task.

## Known open work and risks

Grok Build follow-up (2026-11-13): separate built-in `grok` CLI provider uses
local account login. Installed official 1.0.77 in ~/.grok/bin; browser OAuth
succeeded, four authenticated model IDs were listed and an exact-flags synthetic
headless request returned `<p>Hello</p>` successfully. No user book content sent.
Uses documented plain headless output with built-in tools/subagents/memory/web
search disabled. Shared cancellation, limits, recovery and structural validation
remain authoritative. API provider setup is a separate option. Frontend build,
focused lint, Rust Grok-specific tests and formatting passed. Known catalog
fallback is explicit; model listing alone does not verify each model's access.
The CLI may print startup warnings and loads its user settings; Sagar does not
forward those diagnostics as answer text. Real chapter and other OS checks remain.
Final cargo build passed and the native Sagar model picker displays Grok Build
with four live model IDs. No model preference was saved during verification.

Direct Grok setup (2026-11-13): Translation Model offers an unconfigured Grok
(xAI) entry that opens Providers with the official xAI base URL and grok-4.7;
Providers also has a dedicated setup button. Existing xAI entries open for
editing. Saved entries use the existing custom-provider IDs, secret storage,
model-list and streaming Chat Completions services, directly to xAI. This is
separate from OpenCode's Grok models. Frontend build/focused lint and the new
selection regression passed. Native Windows setup form verified and left open
with an empty key for user entry. Actual API use is unverified without the key;
do not read credentials from other apps or claim model access verified.

OpenCode follow-up (2026-11-13): installed CLI is 2.0.31. It rejects
`models --verbose`, and shared-service `models` failed with Location plugins
activation. `models --standalone` succeeds. services/ai.rs now falls back from
v1 verbose listing to v2 standalone listing, then plain listing. All 23 focused
AI settings tests and the file's rustfmt check passed. Real chapter translation,
including OpenCode 2 server/stream compatibility, has not been checked here.
Native cargo build passed. Relaunched Sagar and verified OpenCode's live catalog
shows 84 models in Translation Model. No model was saved and no chapter sent.

Antigravity follow-up (2026-11-13): this Windows machine has the Antigravity
desktop app under LOCALAPPDATA/Programs/antigravity, but initially had no `agy`
CLI on PATH or in LOCALAPPDATA/agy/bin. The existing integration requires that
standalone CLI; the desktop executable is not a replacement. Translation Model
now explains CLI availability/setup in Burmese when Antigravity is selected.
Installed official standalone `agy` 1.5.8 into LOCALAPPDATA/agy/bin after verifying
the complete binary against the official manifest SHA512. `agy --version`
returned 1.5.8 and `agy models` succeeded with 18 model IDs. The existing Rust
discovery searches this directory without requiring a PATH change. Reopen
Settings, choose Antigravity (agy), refresh models and save the user's choice.
Do not select a model or send a book chapter on the user's behalf just to probe
authentication. Model listing success does not verify a real translation.
`bun run build` passed and focused Biome checking of TranslationModelSection
with Windows CRLF passed. The earlier whole-tree `bun run check` failed on
existing formatting diagnostics; no broad formatting was performed. Native UI
and actual chapter translation remain unverified in this follow-up.

1. Finish milestone 5: build/smoke-test Windows, macOS and Linux installers; cross-platform keyboard/accessibility checks; Burmese rendering, wrapping and IME composition checks.
2. Verify the newest AI flows in the native app: background running/ready/failed states, Retry and insertion, auto-continue stop conditions, output recovery, and live preview at normal/minimum size and light/dark themes.
3. Verify bilingual study with actual consented provider analysis, keyboard/focus behavior and Burmese text; verify bilingual EPUB output in an external reader and run EPUBCheck when available.
4. Re-run relevant frontend/Rust checks against the current working tree before claiming it passes. Historical test results in `dev/plan.md` describe earlier snapshots, not necessarily this checkout state.
5. Reconcile stale documentation, especially the README's absolute offline/no-network wording with the explicitly authorized external-provider feature; document the user-consent boundary accurately.
6. Keep EPUB 2, SVG/MathML, complex tables, legacy navigation and resource-link limitations explicit. Do not silently expand supported markup without fixtures and round-trip coverage.

Historical note: the 2026-10-17 bilingual-export entry records Windows temporary-file permission failures in 13 export tests and unrelated custom-stream failures in a full Rust run. This is evidence from that run only; re-run before treating it as a current failure or resolved.

## Documentation/update rule

`AGENTS.md` requires every task that changes code, configuration, tests or project documentation to append a dated, factual entry to `dev/plan.md` and update this handoff when current state or next steps change. Record checks actually run, separate automated and native verification, preserve older history, and update the next unfinished task. Never present a remembered test result as a current one.
