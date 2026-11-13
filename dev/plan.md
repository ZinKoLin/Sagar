# Plan.md — EPUB Translation Studio

### GitHub publication snapshot — 2026-11-13

Prepared the current user-requested working tree for publication to the user's
existing fork https://github.com/ZinKoLin/Sagar on branch
codex/sagar-translation-updates. Upstream saturngod/Sagar is read-only for this
account. The snapshot includes the pre-existing translation recovery/background,
bilingual study/export and XHTML preservation work, plus provider compatibility,
Grok integrations and the persistent handoff/update rules. These existing edits
were preserved and included at the user's explicit request to upload the project.

Pre-publication checks: git diff --check passed; a filename-only scan of source,
tests and documentation found no common API-token/private-key patterns. Generated
builds, local translation databases and credential files are not staged. Current
builds and focused feature test results are recorded above; this publication
does not claim the full suite, EPUBCheck or cross-platform checks passed.
Staging the new handoff then exposed two Markdown trailing-space line breaks;
these were removed and the final staged whitespace check was rerun.
Next: verify the pushed commit matches the local snapshot, then continue the
remaining native chapter-translation and release verification tasks.

### Grok Build account-login provider — 2026-11-13

Added standalone `grok` CLI identity, provider discovery including ~/.grok/bin,
saved translation selection, model listing with a labeled known-model fallback,
and headless translation/HTML repair through the shared execution adapter.
Grok Build uses its locally authenticated CLI session; Sagar does not request
or import an API key for this provider. The existing direct xAI API option stays
separate. The UI explains account login and account usage limits in Burmese.
Headless runs use the documented plain response format, disable built-in tools,
subagents, memory and web search, cap turns, and skip automatic updates. Existing
timeouts, cancellation, output limits, retention and chapter validation apply.
Nonzero/empty responses fail without displaying CLI stderr paths or diagnostics.

Installed official Grok Build 1.0.77 in ~/.grok/bin from the official Google
Storage release URL published by x.ai/cli/install.ps1. Browser OAuth completed
successfully. Authenticated `grok models` listed grok-4.7, grok-4.7-build-fast,
grok-4.6 and grok-4.5. A synthetic prompt with the exact translation flags
returned `<p>Hello</p>` and exit 0; no book content was sent.

Validation: frontend production build and focused lint passed (existing bundle
warning). Grok discovery/model parsing/persistence and successful/failed CLI
output tests passed; fixed-argument regression passed; Rust formatting checks
passed. Final native cargo build passed and Sagar was relaunched. Native
Translation Model displays Grok Build (account login) with the four live models;
no default model change was saved during verification. Account login and a
synthetic response were verified; a user's full chapter has not been tested.
References: https://docs.x.ai/build/cli/headless-scripting and
https://docs.x.ai/build/cli/reference. Actual book translation, minimum-window,
dark theme, IME and cross-platform behavior are not verified in this task.

### Direct Grok (xAI) provider setup — 2026-11-13

Added a dedicated Grok (xAI) setup entry to Translation Model and a Grok setup
button in Providers. Both open the existing direct-API provider form prefilled
with name Grok (xAI), https://api.x.ai/v1 and grok-4.7. Existing xAI providers
open for editing rather than being duplicated. The API key stays in the existing
Rust-owned provider storage; saved Grok appears as a separate selectable API
provider. Requests use the existing custom-provider model list and streaming
chat/completions transport, with no dependency on OpenCode. Setup explains the
xAI destination and potential API charges in Burmese. No database migration,
secret lookup from other apps, or book-content request was needed.

References checked: official xAI Chat Completions documentation at
https://docs.x.ai/developers/model-capabilities/legacy/chat-completions
(base URL, grok-4.7 and OpenAI-compatible text requests).

Validation: production frontend build passed (existing bundle-size warning);
focused Biome checks passed on both changed settings components. New frontend
regression passed (7 assertions): setup routes to configuration without issuing
a model request for the setup sentinel, and configured Grok saves a direct
custom-provider selection instead of OpenCode. Native Windows UI verified:
selecting the Grok entry opens Providers with the correct name/model/base URL
and empty API key. Left this form open for the user. Real xAI authentication,
model listing and translation require the user's API key and were not tested.
Dark/minimum-window behavior and cross-platform UI remain unverified.
Next: user enters their xAI key, saves/tests the provider, and selects its model.

### OpenCode 2 model catalog compatibility — 2026-11-13

Reproduced the Translation Model error with installed OpenCode 2.0.31:
`models --verbose` fails because v2 removed --verbose; plain `models` also
failed with Location plugins activation against the shared service. The actual
`models --standalone` command succeeded. Updated services/ai.rs to try the v1
verbose catalog first, then the private-server v2 catalog, then plain models.
Added a Windows command fixture reproducing both failure conditions and checking
that the standalone catalog is parsed. No chapter content was sent.

Validation: all 23 services::ai::tests passed, including the new regression;
rustfmt --check on services/ai.rs passed. An existing unused-import warning in
ai_translate.rs remains. Native cargo build passed; relaunched Sagar and verified
Translation Model → OpenCode shows a live list of 84 models with no catalog error.
Next: actual provider translation and broader
OpenCode 2 streaming compatibility remain separate verification work.

### Antigravity translation availability — 2026-11-13

Investigated the repeated request to make Antigravity available in Translation
Model. Existing code already lists Antigravity, discovers `agy`, loads models
and executes translations; this machine initially had the desktop app but no
standalone CLI. Added Burmese CLI availability/setup help to
`TranslationModelSection.tsx`, and recorded the reply-language and CLI readiness
rules in `AGENTS.md`. Consulted Google's official installation/authentication
documentation and started installing the official CLI in LOCALAPPDATA/agy/bin,
which the existing Rust discovery already searches. No book content was sent.

Validation: `bun run build` passed (existing bundle-size warning).
Focused Biome check of TranslationModelSection with CRLF passed. The previous
whole-tree check failed on existing formatting diagnostics. No broad formatting
or unrelated feature changes were performed. Native UI and real chapter
translation have not been verified. See PROJECT_HANDOFF.md for installation
outcome and the next remaining step. No milestone checkboxes changed.

Installation outcome: official CLI 1.5.8 was installed in LOCALAPPDATA/agy/bin;
the downloaded binary matched the manifest SHA512. `agy --version` succeeded
and `agy models` returned 18 models. Sagar's existing fallback discovery already
covers this location. Next step: reopen Settings, choose Antigravity and a model,
then perform a user-initiated translation. Authentication/translation and native
UI behavior are not claimed verified by a successful model-list command.

### Persistent handoff and update protocol — 2026-11-13

Added [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md) as a concise project-wide
continuity record for future contributors/AI, covering product scope, architecture,
storage, recent features, current uncommitted-work cautions, known risks and next
verification tasks. Updated `AGENTS.md` to require reading the handoff and this
chronological plan, preserving pre-existing diffs, and recording each code,
configuration, test or documentation change with actual validation results.
Clarified that the live master plan is `dev/plan.md` (there is no root `Plan.md`)
and updated the remaining protocol/definition-of-done references to that path.
Reconciled the stale AI-only prohibition with the existing rule that AI/network
features require explicit user authorization and clear consent/privacy handling.

Validation: documentation and worktree state were inspected. No tests, build or
runtime checks were run for this documentation-only task. The existing worktree
already contained extensive uncommitted feature changes; they were preserved.
Next task: inspect those current diffs before any code changes, then run the
relevant checks and native verification for the feature being continued.

### Long-chapter AI translation — 2026-10-17

Chapters whose XHTML exceeds the single-request limit are translated in
24,000-character groups of complete paragraph, heading, and list blocks.
Translated blocks are spliced back into the immutable chapter structure and
the complete recoverable HTML is saved after every group. Retry detects the
completed leading blocks and continues from the first unfinished block.
Individual blocks above the safe group limit still fail clearly rather than
being split in a way that could damage markup.

Validation: the Rust AI translation unit suite and the large-chapter block
preservation/resume regression passed; Rust formatting and diff checks passed.

### EPUB 2 navigation compatibility — 2026-10-17

EPUB 2 books are recognized as a supported legacy format. Import reads the
spine's NCX table of contents when an EPUB 3 `nav` document is absent or
unreadable, so chapter labels use the book's navigation titles rather than
falling back to headings. Books without either navigation resource still warn
and use heading/file-name fallbacks. SVG blocks remain preserved and visibly
warned because the block editor cannot safely translate their text yet.

Validation: the synthetic EPUB 2 import fixture resolves its chapter title from
NCX and produces neither the old-format nor missing-navigation warning.

### Bilingual EPUB export — 2026-10-17

The EPUB export dialog now offers a bilingual output option. It pairs each
translated XHTML block with the matching original block, preserves original
markup and chapter layout, labels both languages, and safely stops if block
structure no longer matches. The source language comes from Book Settings;
English is used when that value is unset. The separate output filename includes
`-bilingual` and the imported source EPUB is unchanged.
When a chapter has saved study-view phrase alignments, the bilingual output
also colors matching English/Myanmar text and includes meaning/grammar tooltips.
Only matches that occur verbatim inside an XHTML text node are highlighted;
all other content stays intact.

Validation: production build and Rust formatting passed; paired-block and
structure-mismatch regression tests passed. The full export integration suite
was attempted, but 13 tests failed when Windows denied access while finalizing
temporary EPUB files; several unrelated custom-stream tests also failed in the
full Rust run. The native export dialog and a generated EPUB in an external
reader still need visual verification.

### English–Myanmar color study view — 2026-10-17

The source pane has a study view that displays each original English sentence
with its Myanmar translation below it. The configured translation model
identifies exact corresponding words and phrases, which share one of six colors.
Hovering a colored phrase shows its English/Myanmar counterpart, a short meaning,
and its grammar role. Matching asks for word-level spans when accurate and groups
words only where grammar requires it. It does not show unmatched-translation
counts or require manual sentence pairing. Validated matches are cached per
chapter and source/translation version in local browser storage. The view follows
live chapter draft updates without changing the translation. Analysis runs in
four-sentence batches, saving completed matches after each batch so retry
continues from the last saved batch after a timeout. Each batch has a five-minute
deadline and the reader reports batch progress. Invalid model-proposed spans are
discarded individually while exact valid pairs from the same response are kept.

Validation: the targeted frontend regression passed (sentence pairs, matching
color marks and no manual pairing controls), TypeScript/production build passed,
targeted Biome lint passed. The existing bundle-size warning remains. Native visual check at
normal/minimum window sizes, dark theme, keyboard and Myanmar text remains
pending.

### Sequential chapter translation — 2026-10-15

An opt-in control can continue through chapters in spine order after a successful
translation. Accepted results save into empty drafts before moving on. The sequence
pauses for existing chapter drafts, saved recovery output, conflicts, failed saves,
or translation errors. Cancel stops the current run and sequence; the final chapter
reports that the book is complete.

Validation: TypeScript/Vite build and Biome check passed. Rust `cargo check` was
blocked by the existing `aws-lc-sys` native build (NASM unavailable; C compiler
check exited with status 2). Automated UI/native flow review remains pending.

### Numbered lists in the rich editor — 2026-10-15

The chapter translation editor now explicitly displays ordered-list numbers and
bullet markers, with readable indentation and spacing. Translation instructions
call out preserving list containers, item order and numbering attributes. Rich
editor round-tripping already retains list-item values such as resumed numbering.

Validation: `bun run build` and `cargo fmt --check` passed. Native visual review
of an imported list remains pending.

### Translation output recovery — 2026-10-15

Completed provider output is now stored append-only before HTML/skeleton validation,
so a rejected structure remains available without rerunning translation. The
translation dialog restores saved output, offers HTML checking, copy, and a
separate HTML repair action, and saves user edits before closing. Repaired output
can be adopted only after local validation and explicit review. Text checks prevent
HTML repair from changing translated words. A failed recovery write keeps the
window and output available with an actionable error. Starting over is an explicit
confirmed action; existing output snapshots remain stored.

Validation: 50 frontend tests passed; TypeScript/Vite production build passed;
Biome check and `cargo fmt --check` passed; Rust library suite passed (146 passed,
2 ignored), targeted recovery/provider tests passed, and EPUB import/export tests
passed (40 passed, 2 ignored). UI behavior is covered by tests; native UI recovery
interaction was not separately exercised. Next unfinished task: native recovery flow
check, including minimum-size and dark-theme review.

### Background chapter translation — 2026-10-15

The workspace now owns a single chapter-bound translation dialog independently
of the active reading/editing chapter. Run in background hides the dialog while
keeping its job, event subscription, stream and Retry result alive. A compact
toolbar control shows the job's original chapter and running/ready/failed state.
Readers can switch chapters and continue normal autosave. Background completion
normally retains a proposal for explicit insertion; Open translated chapter
navigates back through the normal save-flushing path. Insertion is disabled for
other chapters. The explicit auto-continue option inserts each validated result
and advances automatically, including replacing the unchanged chapter draft;
the replacement is saved as an unreviewed draft. It stops if the draft changes
during translation, a save/validation fails, or the book ends.
Hidden dialogs release focus trapping and Escape handling. Cancel/X still cancel;
leaving the book cancels the workspace-owned run, with tooltip/help text explaining
that lifetime. This does not persist running jobs/proposals across app restart.
Integration coverage exercises the actual workspace navigation/dialog lifecycle,
manual edits saved to a second chapter, early/stale events, hidden failure/Retry,
hidden Escape and original-chapter-only insertion. Targeted lint, TypeScript and
production build passed (existing bundle warning). Native normal-size light-theme
dialog chapter label, disabled Generate, progress control, Escape and restored
focus were visually checked without sending book text. Native running/ready/failed
background states, minimum-size/dark/IME and cross-platform checks remain pending;
next unfinished task is exercising one consented background run in the native UI.
No Rust/storage changes or milestone checkboxes were needed.
Final frontend suite: 47 passed, zero failures; diff checks passed.

### Readable live translation preview — 2026-10-15

The translation dialog now displays streamed output as selectable read-only
prose with Myanmar typography and paragraph breaks. Parsing occurs in an inert
document; only extracted text reaches React, with executable/embedded subtrees
omitted. Raw HTML remains available in a collapsed disclosure. The preview follows
new text only while the reader remains near the bottom; scrolling up pauses
following. Partial/unvalidated/unsaved status is explicit, and existing job,
Retry, cancellation and insertion rules are unchanged. Hidden disclosure controls
are excluded from dialog focus wrapping. All 45 frontend tests passed; targeted
lint and TypeScript/production build passed (existing bundle warning remains).
Tests cover partial Myanmar text, escaping, script exclusion, live updates,
read-only HTML and pause/resume scrolling. Native Sagar was inspected at its
normal size, but an active translation preview was not visually exercised:
user activity interrupted inspection and no verification translation was sent.
Minimum-size/light-dark/IME/native streaming checks are the next unfinished
verification. No milestone checkboxes changed.

### Added-class proposal recovery — 2026-10-15

Proposals and retained Retry prefixes discard newly introduced, unnamespaced
class attributes only on corresponding elements whose source has no class.
Tag order/count/nesting must match first, then the recovered result must pass
the unchanged strict attribute comparison. Existing class changes/removals,
changed links, and structural changes remain rejected. Myanmar regression
coverage verifies translated text, existing BOLD_ITAL, savable output and
completed Retry recovery. All 28 translation-service tests passed. Formatting
and diff checks passed. Next unfinished task: native Retry/insertion verification;
no source or saved draft was rewritten and no milestone checkboxes changed.

### Rich continued-list numbering — 2026-10-15

Reproduced the HTML-to-Rich preservation failure: the editor discarded li value
attributes, including value="6" in a continued numbered list. BookAttributes
now preserves explicit list-item values through parse/serialize, editing and
reload. Myanmar round-trip coverage includes multiple value overrides, italic
classes and a page-break anchor; an interaction regression checks external
proposal insertion and HTML/Rich switching. The 42-test frontend suite passed,
followed by all nine insertion/view tests after adding the interaction case.
TypeScript/production build passed with the existing bundle warning. Full lint
stops on checkout-wide line-ending formatting differences; changed-file lint
passed with formatter disabled. Native window/IME and cross-platform visual
checks remain unverified; next task is switching the affected chapter to Rich
in the running native app. The preservation guard remains enabled. No milestone
checkboxes changed.

### Page-break order rejection — 2026-10-15

Read-only source inspection and supplied translated HTML identified page_161
moved across an italic citation. Prompt instructions now explicitly preserve
page-break order relative to inline elements. Structural errors report the
first mismatching position, tags and nesting, or expected/actual element counts,
without attribute values/book text. A synthetic Myanmar regression covers the
moved marker, safe Retry rejection boundary and accepted source-order correction.
All 27 translation-service tests, formatting and diff checks passed; the native
development app rebuilt and relaunched. Existing test-import/cache warnings
remain. Next unfinished task: verify provider output and Retry in the native UI;
prompt guidance cannot guarantee structurally valid generated output. No saved
draft/source was changed and no milestone checkboxes changed.

### Protected attribute diagnostics — 2026-10-15

Follow-up: read-only inspection of the user's immutable source confirmed a
plain italic term precedes a BOLD_ITAL term; the returned translation reverses
these terms and moves the class between elements. Translation instructions now
explicitly require rephrasing to retain inline order/attributes. A synthetic
Myanmar regression checks rejection of moved classes, safe Retry boundaries and
acceptance of corrected word order. All 26 translation-service tests passed;
native provider output remains unverified. Source and saved drafts are unchanged.

Proposal rejection now identifies whether a protected attribute was added,
removed or changed, with its name, element tag and one-based chapter element
position. Attribute values and translated text remain excluded from errors.
Strict validation, saved drafts and Retry boundaries are unchanged. All 25
translation-service tests and Rust formatting/diff checks passed. An existing
unused AtomicBool test import warning remains. Next unfinished task: reproduce
the reported failure with source/returned markup to identify the actual changed
attribute; native error-display verification remains pending. No milestone
checkboxes changed.

### Rich text normalization and book compatibility — 2026-10-14

Supersedes preserving every empty decoration below. Conversion now removes
empty decorative headings/formatting/wrappers when only class attributes remain,
retaining IDs, EPUB/ARIA semantics, styles, meaningful whitespace and assets.
XHTML self-closing containers are parsed as XML before HTML conversion. Mixed
inline/block containers, bare list items, quotations and plain table cells gain
paragraph wrappers; only inter-block indentation is discarded. Cleanup enters
the existing draft/autosave service after successful validation and preservation
checks, with stale-result protection. Normal typing/composition does not reload
or normalize the editor. Eight common inline semantic tags and ARIA attributes
now round-trip. Tables with caption/thead/tfoot remain intact as protected,
readable content in Rich view; surrounding prose remains editable, and HTML
view owns edits to those tables. Their preview mounts no imported URLs/images/
CSS. Basic authored tables retain existing editing tools.

`bun run check`, all 41 frontend tests, Rust formatting and full Rust suite
passed (existing ignored probes unchanged). Coverage includes cleanup persistence,
HTML/Rich switching, Myanmar edits, whitespace/anchor preservation, mixed/list/
table structures, protected table assets and save/export/reopen/source immutability.
Existing bundle warning remains. The running desktop app was inspected and still
showed its old conversion failure; it has not been rebuilt/restarted with this
change. Updated native light/dark/minimum-size, keyboard/IME and Windows/Linux
verification remain open. Next unfinished task: rebuild/restart and verify Rich
conversion and cleanup in the desktop app. No milestone checkboxes advanced.

### Empty subtitle formatting in Rich text — 2026-10-14

The supplied chapter failed HTML → Rich because Tiptap marks dropped the empty
`em` inside its subtitle heading. Empty em/strong/u/s/code elements now have
inline node representations that preserve their tags and book attributes;
nonempty formatting still uses normal marks. The exact pasted chapter now
passes the preservation comparison. A synthetic subtitle fixture tests parsing,
Myanmar typing, saving/reloading and empty formatting with IDs/classes/titles;
mounted proposal tests cover immediate insertion and HTML → Rich switching.
All 24 affected frontend tests and `bun run check` passed. Existing bundle-size
warning remains. No Rust code changed; native IME, visual themes/minimum size
and Windows/Linux remain unverified. Next unfinished task: rebuild/restart and
select Rich text on the retained chapter; another translation is unnecessary.

### Paragraph-boundary instructions and recoverable structure feedback — 2026-10-14

Translation prompts now include computed element counts from the supplied
fragment and require in-place text translation, unchanged paragraph boundaries,
no splitting/merging/repetition/added ending, and preserved header/footer/empty
element order and nesting. Counts supplement the full structure comparison;
they do not replace it. Structure failures now explain the issue in plain
language, retain returned text and explain Retry's matching-prefix behavior
instead of showing raw indexed markup/attribute diffs. A synthetic chapter
regression covers an extra paragraph before the footer, the prompt contract,
recovery and a corrected Retry; equal-count nesting changes remain rejected.
`cargo fmt --check` and the full Rust suite passed, with existing ignored
probes unchanged. No live model or native interaction check made. Prompts do
not guarantee model compliance; automatic deletion/merging of translated
paragraphs remains disallowed to prevent content loss. Next unfinished task:
rebuild/restart and Retry the retained proposal with the strengthened prompt.

### Book-configured language names in prompts — 2026-10-14

Supersedes the Myanmar-specific prompt rule below. Translation instructions
now resolve both saved Book Settings language tags into names and codes using
the same shared JSON catalog as the toolbar. Every language pair uses identical
instructions for translation and Unicode writing; there is no language-specific
branch. Regional tags use primary-language names while retaining the full tag;
unknown tags remain visible verbatim. Tests cover reversed and unrelated pairs,
regional/case variants, unknown tags, catalog consistency and the HTTP payload.
`bun run check`, all 34 frontend tests, Rust formatting and full Rust suite passed
(four existing tests ignored). Existing bundle warning remains. No live provider
or native visual check made. Next unfinished task: rebuild/restart and generate
a fresh proposal with the desired Book Settings language direction.

### Explicit Myanmar translation direction — 2026-10-14

Investigation confirmed the saved source/target language tags reach the prompt
and custom API user message; the old prompt identified Myanmar only as `my`.
The supplied English output does not establish why the provider ignored it.
Myanmar targets (including regional/case variants) now explicitly require
Myanmar/Burmese Unicode prose and headings, forbid English paraphrasing and
Latin transliteration, and prioritize the saved target over conflicting book/
run/content instructions. Link labels may translate while hrefs remain fixed.
The existing mock HTTP regression now sends a real book-translation prompt and
verifies the complete direction/instructions in the received request. Generic
targets retain their requested language. Formatting and full Rust suite passed
(four existing tests ignored). No live provider request or native check made;
language correctness is not guaranteed by XHTML/structure validation. Next
unfinished task: rebuild/restart and generate a fresh proposal; continuation
Retry may retain the previously returned English prefix.

### Translated title attributes — 2026-10-14

Chapter translation now permits existing unnamespaced XHTML `title` values
to be translated as tooltip text. The structure check still requires the
attribute to exist on the same element, rejects added titles and protects
other attribute values (including IDs, classes and URLs). Prompt instructions
explicitly describe this exception. Regression covers the reported legal-notice
title, proposal validation, structure comparison and Retry recovery, plus
rejected structural changes and namespaced title changes. Formatting and the
full Rust suite passed (four existing tests ignored). No frontend code changed;
native execution remains unverified. Next unfinished task: rebuild/restart and
Retry the retained proposal with its translated legal-notice title.

### Explicit XHTML and anchor-target output instructions — 2026-10-14

Translation and HTML repair prompts now explicitly require well-formed EPUB
body XHTML and removal of every anchor `target`, preserving href and link text.
The translation rule explicitly overrides the general attribute-preservation
instruction. Existing validation still removes targets if a tool echoes them;
structure comparison still accepts that normalization. Formatting and all 30
AI translation service tests passed. No UI changed or live provider run made.
Next unfinished task: rebuild/restart and verify the next proposal uses these
instructions. No milestone checkboxes changed.

### Proposal structure comparison after target normalization — 2026-10-14

The prior target-removal change missed the subsequent proposal structure check:
it compared immutable source attributes against already-normalized output and
rejected a missing anchor `target`. The shared structure skeleton now ignores
only unnamespaced `target` on XHTML anchors on both sides. Regression exercises
validation → structure comparison → completed Retry recovery, with both echoed
and omitted targets, and confirms changed URLs, IDs, classes and non-anchor
targets remain rejected. `cargo fmt --check` and the full Rust suite passed;
four existing tests were ignored. No frontend code changed in this follow-up.
Native execution remains unverified. Next unfinished task: rebuild/restart Sagar
and use Retry on the retained proposal. No milestone checkboxes changed.

### Translated titlepage Rich text conversion — 2026-10-14

Supersedes target preservation below: the user authorized removing link targets
from translated XHTML. Chapter validation now accepts but omits anchor `target`
attributes, including older drafts; URLs and text remain intact. The Rich schema
also preserves standalone links beside paragraphs in book containers, avoiding
the extra paragraph that previously failed the preservation check. Its editor
node view omits the URL so editing cannot navigate away. Unsupported structures
still trigger the existing loss-aware check rather than being broadly stripped.
Regression covers the synthetic Myanmar titlepage, editing/reloading, immediate
proposal insertion and HTML → Rich switching. `bun run check`, all 34 frontend
tests, `cargo fmt --check` and the full Rust suite passed (two existing probes
ignored). Existing bundle-size warning remains. Native visual/IME and Windows/
Linux checks remain unverified. Next unfinished task: rebuild/restart Sagar and
verify the affected saved chapter switches to Rich text. No checkboxes advanced.

### Preserved link targets — 2026-10-14

Milestone 2 validation follow-up: chapter documents now preserve `target` on
XHTML anchors, fixing rejected translation proposals containing `_top` links.
A synthetic titlepage fixture checks Myanmar text, target preservation,
repeat validation and inert preview links; active URLs/event handlers and
misplaced target attributes remain rejected. `cargo fmt --check` and the full
Rust test suite passed (two existing import probes ignored). No UI changed;
native and cross-platform interaction remain unverified. Next unfinished task:
rebuild/restart Sagar and retry the affected proposal. No checkboxes advanced.

### Reasoning controls for every custom model — 2026-10-14

Supersedes the Z.ai/model-specific restriction below. All custom API models now
expose the same user-selectable reasoning overrides, including GLM-5.3-Flash,
arbitrary catalog entries and manually entered IDs. No hostname/model checks
control availability. Both live/saved model catalogs expose these overrides;
the frontend also supplies them when metadata/catalog lookup is absent.
Rust validates the provider exists and the effort token is allowed, persists the
selection and forwards it through the existing API transport. Default omits the
parameter. UI text explains these are overrides whose acceptance is determined
by the endpoint, rather than detected model capabilities. CLI behavior unchanged.
Validation: Rust formatting/full suite passed, frontend lint/build and all 32
frontend tests passed. Regression covers arbitrary/local/Z.ai endpoints, model
IDs, effort persistence/execution validation, flash/catalog model switching and
Default saving; existing HTTP transport test verifies effort forwarding.
Native rendered themes/minimum-size/keyboard and cross-platform behavior remain
unverified. Existing bundle-size warning remains. Next unfinished task: rebuild/
restart and verify the selected custom model/effort against its API endpoint.
No milestone checkboxes changed.


### Custom API stall tracing and Z.ai effort — 2026-10-14

Follow-up to custom-provider streaming: the generic no-output notice previously
could not distinguish waiting for HTTP headers, active reasoning and answer text.
Both translation and HTML repair now retain a bounded, expandable API request
trace with response timing/status and stream/event/answer/reasoning byte counts.
Only fixed messages and numeric counters are emitted: no keys, endpoints,
book text, raw response bodies or reasoning text are logged or included.
Status events are non-terminal, do not reset the answer-silence timer or alter
the output, and obey existing job/chapter ownership and early-event buffering.
The disclosure participates in dialog keyboard focus trapping.
Z.ai's documented GLM-5.3 reasoning choices (low/high/max) now appear in model
selection for the exact official standard/coding endpoints. Save and execution
validate those choices locally, and custom calls send explicit reasoning_effort
only when chosen. Default remains the provider default; arbitrary compatible
providers do not gain inferred effort support. Existing CLI paths remain intact.
Official source: https://docs.z.ai/guides/llm/glm-5.3 documents always-enabled
reasoning and max as default. This is a plausible explanation for the user's
240s no-answer report, not an authenticated reproduction or latency diagnosis.
Validation: full Rust suite and formatting passed; frontend lint/build and all
31 frontend tests passed, with the affected dialog regression rerun after final
focus/label changes. Coverage includes effort validation/forwarding, endpoint
scoping, reasoning-only counters, private-data exclusion, early/stale status
routing and continued Cancel behavior. Existing bundle-size warning remains.
Native rendered layout/themes/minimum-size/IME and Windows/Linux remain unverified.
Next unfinished task: rebuild/restart, select Low for Z.ai GLM-5.3 and retry;
inspect API request details if it stalls. No live request with the user's key was
made and no milestone checkboxes changed.


### OpenAI-compatible custom provider streaming — 2026-10-14

Explicitly requested extension to the existing Milestone 5 AI workflow: saved
custom providers now execute chapter translation, partial Retry and AI Fix HTML
through POST {base}/chat/completions with stream=true. The Rust transport uses
the saved endpoint/key and selected model; assistant content alone feeds existing
progress events and proposal validation. Existing book/run instructions,
continuation structure checks and immutable source/saved-draft boundaries remain.
No CLI installation is needed for custom providers. Custom effort remains Default;
provider-specific reasoning controls are outside this slice.
SSE decoding handles split UTF-8, CRLF, multiline data and bounded events/output.
Successful completion requires stop plus DONE; truncated/filter/tool/error output
is rejected with recoverable partial text. HTTP failures omit raw provider bodies
and secrets; redirects are disabled. Cancellation/deadline drop the async request,
including during silent streams. Consent text in both dialogs distinguishes the
configured API endpoint from an installed tool. No schema change.
Validation: Rust formatting and full suite passed; seven custom-provider tests
passed after adding the final chapter/Retry regression. Local HTTP tests cover
endpoint/auth/model/stream payload, Unicode deltas, errors, redirects, cancellation,
timeouts, saved-provider HTML repair, chapter retry, snapshot immutability and no
automatic draft persistence. Frontend lint/build and 31 frontend tests passed;
existing bundle-size warning remains. No live GLM request or native rendered UI,
minimum-window/theme/IME or Windows/Linux verification was performed.
Next unfinished task: rebuild/restart Sagar and verify the saved GLM endpoint with
a real chapter, cancellation, Retry and HTML repair. No milestone checkboxes changed.


### Existing EPUB 2 volume navigation — 2026-10-14

The user's Joy of Life snapshot is EPUB 2 with seven nested NCX parents.
Workspace reopening now resolves the NCX referenced by OPF spine@toc when
EPUB 3 navigation is absent, and maps navPoint ancestry to the same sidebar
accordion without changing saved chapter IDs, progress or snapshots. The header
picker shows indented chapter options with volume context and searches ancestor
labels. This is limited NCX workspace navigation compatibility; EPUB 2 export
conformance and per-anchor navigation remain separate unfinished work.
NCX parsing is namespace-aware, reads only navMap and permits the standard
inert NCX doctype without resolving DTDs; internal entities remain rejected.
Validation: frontend lint/build and 30 frontend tests passed, plus the new picker
interaction regression passed separately. Rust formatting and suite passed
(138 unit, 20 export, 20 import; four ignored probes/sweeps). The local snapshot
probe passed explicitly: 758 chapters, 746 grouped; no reimport needed.
Native current-build layout/theme/minimum-window checks and Windows/Linux remain
unverified. Existing bundle-size warning remains. Next unfinished task: rebuild
and restart the desktop app, then verify both chapter controls with this book.
No broader EPUB 2 milestone checkbox was marked complete.


### Expandable volume navigation — 2026-10-14

Milestone 2 chapter navigation now displays nested EPUB 3 TOC parents as
expandable groups, including unlinked span labels and multiple nesting levels.
Linked volume opening pages remain selectable in the group header. Chapters
retain spine order, saved IDs and progress. Search includes ancestor labels;
filter changes and active-chapter changes reveal the relevant groups.
Hierarchy is derived from the immutable snapshot when opening a project, so
existing projects need no reimport or database migration. Missing/unreadable
navigation retains the existing flat fallback. EPUB 2/NCX and navigation to
multiple anchors within one chapter remain unfinished compatibility work.
Validation: frontend lint/build and 30 frontend tests passed; Rust suite passed
(137 unit tests, 20 export tests, 18 import tests, 3 ignored), plus the new
snapshot reopening integration test passed separately. Rust formatting passed.
Synthetic coverage checks nested linked/unlinked groups, spine order, stable
chapter IDs, immutable snapshot bytes, selection, collapse/expand, active
chapter reveal, keyboard movement and Myanmar labels. Existing bundle-size
warning remains. Native rendered layout, minimum window, light/dark appearance,
IME and Windows/Linux interactions remain unverified; the running release has
not been rebuilt. Next unfinished task: rebuild and smoke-test the native
sidebar with the user's volume book, then address EPUB 2/NCX if needed.
No milestone checkboxes changed.


### Windows npm CLI launcher selection regression — 2026-10-14

Fixed a Milestone 5 Windows launch failure: discovery previously selected npm's
extensionless POSIX shim before its Windows launcher. Windows now searches
.exe, .cmd and .bat only, preserving directory precedence. Shared discovery
applies to provider Check, model listing and translation for Codex, OpenCode,
Claude and agy. Unix bare-name lookup is unchanged. Regression coverage stages
all four tools with coexisting shims and verifies launcher preference on any OS;
a Windows-only test probes a .cmd launcher in a directory containing spaces.
Existing staged tests now use platform executable suffixes.
Formatting and the Rust suite passed on macOS (134 unit, 20 export, 18 import;
3 ignored). No frontend changes; frontend checks were not run.
Native Windows Check/translation remains unverified on this macOS host.
Next unfinished task: rebuild Windows Sagar and verify Codex Check and a
translation with the actual install. No milestone checkboxes changed.

### Windows agy install detection regression — 2026-10-14

Fixed the Milestone 5 cross-platform provider lookup to include
LOCALAPPDATA/agy/bin and the normal AppData/Local/agy/bin profile fallback.
Relocated local app data takes priority; relative environment paths are ignored.
The existing shared discovery supplies provider listing, Check and CLI execution.
Regression coverage stages installs without PATH, including spaces, relocation,
missing/relative environment values and duplicate locations. cargo fmt --check
and cargo test passed (133 unit, 20 export, 18 import; 3 ignored).
No frontend or EPUB behavior changed. Native Windows detection and execution
remain unverified on this macOS host. Next unfinished task: rebuild the Windows
app and verify Providers → Antigravity → Check with the installed agy.exe.
No milestone checkboxes changed.

### Release HTML → Rich mode regression — 2026-10-14

Fixed the Milestone 2 editor-readiness race: a parent chapter-reset effect
cleared the editor after the child reported readiness on immediate mount.
Development Strict Mode effect replay hid the issue. Readiness is now scoped
to chapter identity without clearing the current child registration.
The browser-initialized regression harness reproduces the failure before the
fix (its previous SSR/deferred mount concealed it). Coverage now verifies
HTML → Rich after initial mount and chapter navigation without Strict Mode,
including Myanmar text and inline emphasis; validation failures and external
draft updates remain covered. All 26 frontend tests and bun run check passed;
the existing bundle-size warning remains. No Rust code or persistence changed;
Rust checks were not run. Native release, minimum-window, themes, keyboard/IME
and Windows/Linux verification remain open. Next unfinished task: rebuild the
native release and verify view switching with an existing chapter. No milestone
checkboxes changed.

### Muse Spark free-model server regression — 2026-10-14

Reproduced the saved opencode/muse-spark-1.3-contributor-free selection with
synthetic text: the regular CLI succeeded while Sagar's server adapter returned
APIError / HTTP 403 before any output. Blanket deny permissions removed the
normal tool definitions and triggered OpenCode's free-tier access gate, matching
upstream issue #50627. Temporary sessions now require approval (ask), retaining
the normal schema; any actual permission/question request still aborts without
approval and cleans up the session/server. Sharing remains disabled and provider,
model and variant selections are unchanged. No header impersonation or model
fallback introduced.
The exact Muse Spark model now succeeds through the Rust SSE adapter: two text
deltas, first at 2.91s and finished at 2.98s for synthetic short text. This is a
compatibility/streaming check, not a chapter timing benchmark. Provider errors
now classify access/authentication/rate-limit/service/output-limit failures
without echoing raw response bodies, prompts, paths or credentials. Regression
coverage includes an actual tool-approval request being rejected and cleaned
up, plus sanitized provider errors. Rust formatting, 132 unit, 20 export and
18 import tests passed; normally ignored live probe passed explicitly, and the
performance sweep remains ignored. Frontend lint/build and 18 tests passed;
existing bundle-size warning remains. Temporary event diagnostics were removed.
Next unfinished task: rebuild/restart Sagar and retry the actual Muse Spark
chapter; native UI, chapter timing and Windows/Linux remain unverified. No
milestone checkboxes changed.

### OpenCode Server text streaming — 2026-10-14

OpenCode translation and HTML repair now use a per-job Rust adapter for
opencode serve instead of run --format json. The server binds 127.0.0.1 on
an assigned port with a generated Basic-auth password; clients bypass proxies
and redirects. Subscribe to SSE before prompt_async, route only the current
session's assistant text parts/deltas into the existing single text box,
deduplicate final snapshots, and require completed assistant output before
validating the proposal. Preserve provider/model and variant selections.
Server/session cleanup runs on success, cancellation, timeout and errors;
only this adapter's temporary session is aborted/deleted. Runtime configuration
disables sharing while preserving inline settings and leaving user files alone;
managed settings that prevent this are rejected before sending book text.
Temporary session permissions deny tools. No new JS runtime/dependencies or
changes to Codex, Claude or agy transports.
Installed OpenAPI inspection and authenticated synthetic probe verified live
text deltas using zai-coding-plan/glm-5.3: final probe emitted two deltas, first
at 4.94s and finished at 4.97s. Earlier probe emitted five deltas. These are
streaming checks, not chapter speed benchmarks. Rust formatting and 131 unit,
20 export and 18 import tests passed; both live probes are normally ignored
and were run explicitly in their respective tasks. Performance sweep ignored.
Frontend lint/build and all 18 tests passed; existing bundle-size warning remains.
Initial live-probe setup failed because the full provider catalog exceeded the
bounded response limit; the probe now takes an explicitly selected installed
model and the actual translation adapter does not fetch that catalog.
Next unfinished task: rebuild/restart and verify an actual OpenCode chapter
and HTML repair with its selected model/variant in the native app. Native
window/themes/IME and Windows/Linux verification remain open. No checkboxes
changed.

### Codex App Server text streaming — 2026-10-14

Supersedes the stderr display approach, which the user confirmed only showed
startup text until completion. Codex translation and HTML repair now use a
Rust stdio client for codex app-server: initialize, ephemeral read-only thread,
selected model/effort, and a single turn. item/agentMessage/delta feeds translated
text into the existing single output box; final messages are deduplicated and
successful turn completion is required before the existing XHTML/skeleton checks.
Removed the separate diagnostics box. Other providers retain their adapters.
No Node/Python runtime, TCP listener, source mutation or user config changes.
The process is reaped on success, cancellation, timeout and protocol errors;
messages/output are bounded, stale turns/commentary are ignored, and unexpected
interactive actions fail explicitly rather than approving tools.
Verified the installed protocol schema and an authenticated Rust adapter probe
using gpt-6.1-sol / low: six text deltas, first at 4.17s, completion at 4.42s
for synthetic short text. This is evidence of live deltas, not a chapter speed
benchmark. Rust formatting, 125 unit tests, 20 export and 18 import tests passed;
the live probe passed separately (normally ignored), and the performance sweep
remains ignored. Frontend lint/build and 18 tests passed, including early/stale
stream routing, single textarea, Myanmar text, Cancel/Escape and focus restore.
Existing bundle-size warning remains. Next unfinished task: rebuild/restart and
verify the same chapter/model/effort in the native app, with a timing comparison.
Native themes/minimum-size/IME and Windows/Linux remain unverified. No checkboxes
changed.

### Codex live stderr progress — 2026-10-14

Preserved Codex's restored plain exec arguments and streamed its stderr into a
separate Codex progress box in both translation and HTML repair dialogs. Stdout
alone supplies the proposal, validation and retry content. Progress activity
resets the silence timer; stale jobs are ignored and early HTML repair events
are queued until the start response returns. Diagnostic pipes and retained
history are bounded (128 KiB tail); progress updates are throttled and flushed
at completion. No saved draft/source mutation or JSON mode reintroduction.
Rust formatting and all 31 translation-service tests passed. Regression coverage
verifies progress before final stdout, proposal separation, stderr flooding,
cancellation and continued structured output for other providers. Frontend
lint/build and all 18 tests passed; the dialog regression covers early/stale
progress, Myanmar text, readonly output, Cancel/Escape and focus restoration.
Existing bundle-size warning remains. No running Sagar window was available;
native light/dark, minimum-window, IME and Windows/Linux behavior remain
unverified. Next unfinished task: rebuild/restart and verify live progress with
the same chapter/model/effort, including a timing comparison. No checkboxes changed.

### Codex streaming rollback — 2026-10-14

User reported a chapter run increasing from about 140 seconds to over 200
seconds after enabling JSON mode. Restored Codex's previous exec arguments
without --json and its plain stdout execution path for translation and HTML
repair. Other providers retain structured streaming. The timing cause is not
confirmed; no same-chapter performance claim is made. Rust formatting and all
28 translation-service tests passed, including a plain Codex process regression.
Next unfinished task: rebuild/restart Sagar and time the same chapter with the
same model/effort; an already-running job is unaffected by source changes.
Native and cross-platform verification remain unverified. No checkboxes changed.

### Structured streaming for existing CLI providers — 2026-10-14

Codex now uses exec --json, OpenCode uses run --format json, and Claude Code
uses stream-json with verbose and include-partial-messages. Provider decoders
feed response text into the existing translation/HTML repair progress box,
ignore reasoning/tools, deduplicate text snapshots, and require successful
completion before validating proposals. Codex uses the last completed agent
message; OpenCode retains the final assistant message's text parts.
Live synthetic probes verified all three installed CLIs. Claude emitted text
deltas; OpenCode emitted a completed text part; Codex emitted only a completed
agent message. Codex exec therefore does not promise token-by-token output.
Rust formatter and translation service tests, plus frontend lint/build passed;
the existing bundle-size warning remains. Native dialog, keyboard/IME and
Windows/Linux verification remain unverified. Next unfinished task: native
verification and, if requested, a Codex transport with token delta support.
No milestone checkboxes changed.

### Antigravity CLI provider — 2026-10-14

Added Antigravity (agy) to built-in provider discovery/checks, live `agy models`
listing and saved translation selection, with low/medium/high effort controls.
Translation and HTML repair run headless with stream-json; only agent response
deltas appear in progress and the successful terminal response is validated.
Malformed, failed or missing results are rejected. Existing cancellation,
timeouts, isolated working directories and proposal review remain in use.
Verified installed agy 1.1.23 version/model probes. Frontend lint/build and
17 frontend tests passed; Rust unit/export/import tests passed (performance
sweep ignored). Build retains the existing bundle-size warning.
Next unfinished task: native provider selection and authenticated translation/
repair verification at normal/minimum sizes in both themes; Windows/Linux and
native keyboard/IME behavior remain unverified. No milestone checkboxes changed.

### Blockquote and code authoring — 2026-10-14

Enabled inline code and standard pre/code blocks in the chapter editor while
retaining plain pre elements and imported code attributes. Formatting toolbar
now has Blockquote, Inline code and Code block actions with icons, tooltips,
selected states and capability-aware disabled states. Slash menu supports
/blockquote (also /quote), /code and /inline code; applying a command removes
its query and formats in one undoable transaction. Added theme-token styling
for quotes/code, wrapping code lines without losing saved indentation.
All 17 frontend tests, frontend lint/build, and 13 Rust rich-text validator tests
passed. The build retains the existing bundle-size warning. Regression checks
cover Myanmar text, HTML escaping, pre/code round trips, slash-query removal,
undo, inline-code input, formatting toggles and disabled editors.
Native light/dark, minimum-window, toolbar/slash keyboard interaction and IME
checks remain unverified because no current running Sagar build was available.
Next unfinished task: native verification of these controls; broader XHTML
preservation work remains tracked below. No milestone checkboxes changed.


### Rich XHTML preservation expansion — 2026-10-14

The chapter Rich editor now retains structural containers (including imprint
section/header IDs and classes), text-only container variants, definition lists,
preformatted text, inline spans/b/i/code/sup/sub/ruby/rt/rp, inline images,
EPUB semantics, xml:lang, image srcset/sizes and layout attributes. SVG and picture
subtrees use protected nodes with inert editor placeholders and retained markup;
they remain editable in HTML. SVG namespaces are kept during serialization.
Disabled automatic trailing paragraphs and retained significant preformatted
whitespace so changing views does not rewrite these structures.
Regression coverage includes imprint markup, Myanmar text and links, inline
semantics/images, definition lists/pre, SVG namespaces and responsive images,
reload/edit cycles, and inert SVG node views. Frontend lint/build and all 12
frontend tests passed; build retains the existing bundle-size warning. Rust tests
passed (107 unit, 20 export, 18 import; performance sweep ignored).
No running Sagar window was available: native IME, keyboard, minimum-size,
light/dark and cross-platform verification remain unverified.
This is an expansion, not a claim of universal EPUB XHTML support. Next unfinished
task: deliberate models for complex table sections and mixed block/inline
containers, followed by safe MathML/media/form preservation and native verification.
The Rust safety policy and loss-aware view-switch guard remain in force. No
milestone checkboxes changed and no existing unrelated edits were reverted.


### Imprint markup comparison regression — 2026-10-14

Chapter proposal comparison, continuation, normalization and image embedding now
use the same XHTML/EPUB/XLink namespace context as the restricted editor.
This fixes inherited epub:type declarations being lost when extracting a body.
A synthetic imprint regression covers initial runs, partial retries, Myanmar text,
image srcset/link preservation, changed attributes and unknown-prefix rejection.
Rust formatting and 107 unit, 20 export and 18 import tests passed; one performance
sweep remains ignored. Frontend build passed with the existing bundle-size warning.
Combined frontend checks stopped on existing richText.ts formatting differences.
Next unfinished task: verify the imprint chapter in a rebuilt native app;
full proposal acceptance and Windows/Linux behavior remain unverified.
No milestone checkboxes changed.


### XHTML 1.1 import compatibility — 2026-10-14

The shared XML parser accepts the standard inert XHTML 1.1 PUBLIC declaration
without fetching a DTD; internal entity declarations and arbitrary external
DTDs remain rejected. Synthetic coverage checks editable Myanmar content,
preview, draft export, byte preservation and source immutability. Rust formatting
and 106 unit, 20 export and 18 import tests passed (performance sweep ignored).
The supplied book additionally uses named nbsp/copy entities in its verso page,
which remain unsupported in the strict parser. A separate compatibility copy
removes legacy declarations and replaces those references with numeric equivalents
using XML events; all 24 chapters load, 1706 blocks are editable, and draft
export validates. Original source files remain unchanged. Next unfinished task:
native import/edit verification of the compatibility copy; general named-entity
and EPUB 2/NCX compatibility remain open. No milestone checkboxes changed.

### Unpacked EPUB folder import feedback — 2026-10-14

Import now explains that an EPUB folder must be packaged as a .epub archive.
A regression confirms rejection preserves the folder and creates no project
storage. Rust formatting and 18 import tests passed (one performance sweep
ignored). A separate archive of the supplied local folder passed Sagar's
parser with 24 chapters and two book warnings; the source folder was unchanged.
Next unfinished verification: import that archive in the native app and review
its content warnings. Native/cross-platform UI and EPUBCheck remain unverified;
no milestone checkboxes changed.

### SVG cover preview and DOCTYPE export regression — 2026-10-14

Source XML parsing accepts the inert HTML5 doctype while rejecting internal
entity declarations and external DTDs. Chapter loading, segmentation, navigation,
patching and export validation share this behavior. Preview supports a restricted
passive SVG subset, rewrites image href/xlink:href to local snapshot URLs, and
drops scripts, foreignObject, animations, CSS and URL paints. Original SVG bytes
remain preserved in exports; arbitrary SVG authoring is still unsupported.
Synthetic regressions cover cover loading, sanitization, export validation and
resource/source byte preservation. Rust checks passed: 93 unit, 19 export and
17 import tests (large-book sweep ignored). A temporary diagnostic also imported,
loaded the cover and exported the supplied pg11-images-3.epub successfully.
Next unfinished verification: rebuilt native preview/export in both themes and
an external EPUB reader/EPUBCheck; cross-platform rendering remains unverified.
No milestone checkboxes changed.

### AI italic/bold formatting instructions — 2026-10-14

Translation instructions identify em/strong as editable italic/bold formatting
and prohibit introducing unsupported tags while retaining source structure.
AI Fix HTML explicitly converts i/b to em/strong without losing text, valid
attributes or formatting. All five prompt tests passed. Next unfinished check:
verify a native AI Fix HTML run on a draft containing i tags; no milestone
checkboxes changed.

### Reviewed chapter indicator — 2026-10-14

The chapter review button stays green with a tinted background when the draft
status is reviewed, including hover. Its pressed state and accessible label/
tooltip identify Chapter reviewed. Editing resets status to draft through the
existing save service and clears the green state. Lint/build and all four
frontend tests passed. Next verification: native reviewed/edit/reload states
in both themes; no milestone checkboxes changed.

### Running-action button — 2026-10-14

Both AI dialogs use the shared red/white Cancel button with the close icon.
Frontend lint/build and four tests passed. Native rendered verification remains
pending on a current build; no milestone checkboxes changed.

### ZIP directory export regression — 2026-10-14

Export copies validated filenames rather than treating the filtered file list
as raw ZIP indices. Explicit directory entries previously truncated the copy
loop and dropped trailing resources. The supplied local project reproduced a
missing toc.ncx; export from an isolated database/snapshot copy now succeeds,
retains every source resource and preserves navigation/CSS bytes. A synthetic
integration regression covers multiple directory entries and source immutability.
All 18 export tests passed. Next unfinished verification: restart the native
app, export and reopen in a reader; EPUBCheck/cross-platform checks remain open.

### HTML view simplification — 2026-10-14

The user's latest preference supersedes displaying the read-only document
wrapper: HTML view shows only editable chapter content, with no wrapper
explanation. Original head, stylesheet links and body attributes remain
preserved by export. Native verification remains pending on a current build.

### Button consistency — 2026-10-14

All visible text buttons pair their labels with shared icons; icon-only actions
remain supported. Language and export dialog header dismissal uses an accessible
X button, and language saving uses Save/Saving…. Shared tab, heading and language
control spacing accommodates icon/text groups. AGENTS.md records this convention.
Frontend lint/build and all four tests passed; a source audit found no remaining
text-only buttons. The running native app still shows an older build, so current
native light/dark, minimum-size and keyboard verification remains unfinished.
Next task: verify the updated buttons in a rebuilt desktop app. No milestones
are advanced.

### Full XHTML authoring context — 2026-10-14

Translation HTML view shows the original XML declaration, document head,
stylesheet links and opening body above the editable chapter body, followed
by the original closing wrapper. The wrapper is read-only and comes from
namespace-aware source parsing in Rust, with original bytes retained for
ordinary bodies. Empty bodies are displayed with expanded opening/closing
tags. Saved drafts remain body content; export retains the source wrapper.
Regression tests verify stylesheet/head/body-class preservation and prefixed
and empty bodies. Frontend lint/build and four tests, Rust formatting and
the Rust suite passed (large-book sweep remains ignored). Next unfinished task:
restart the desktop development build and verify this view at normal/minimum
sizes in both themes, with keyboard and Myanmar IME checks. Milestones remain
unchanged.

### EPUB anchor preservation — 2026-10-14

Rich chapter editing now represents empty `a[id]` navigation targets as inline
nodes and preserves paragraph whitespace when loading or converting XHTML.
HTML-to-Rich applies the exact parsed document that passed the existing loss
check. A synthetic Myanmar regression fixture covers anchors, links, trailing
spaces, edits and reloads; the supplied chapter also passed a local round-trip
check. Native IME, minimum-window, light/dark and cross-OS checks remain open.
No milestone checkboxes are advanced. Next unfinished task: verify this
conversion and Myanmar composition in the running desktop build.

**Status:** Milestones 0–4 implemented and verified on macOS (import → translate → autosave → export). Milestone 5 is partially done: polish/docs verified on macOS; installers and cross-OS checks remain open (see docs/release-checklist.md).  
**Target:** Windows, macOS and Linux  
**Phase 1:** Manual side-by-side EPUB translation and EPUB export  
**Chosen scaffold:** Tauri 2 + React + TypeScript + **Bun**  
**Phase 2 (deferred):** AI-assisted translation and review

## 1. Product overview

Desktop application for manually translating a book chapter by chapter, without losing the original EPUB formatting or file structure.

**Primary user journey**

```text
Open EPUB
  -> Validate / import source snapshot
  -> Read metadata, OPF spine, TOC and resources
  -> Create local translation project
  -> Choose chapter
  -> View original | edit translated text
  -> Autosave progress and review missing blocks
  -> Repeat for all chapters
  -> Preview output / update language and title
  -> Export translated EPUB (separate file)
  -> Validate and reopen exported book
```

### MVP goals

- Open a **DRM-free, text-heavy, reflowable EPUB 3** book from disk.
- Provide a split editor: **original (left, read-only)** and **translation (right, editable)**.
- Support a chapter list and navigation based on the book's reading order.
- Save each chapter's translation automatically; restore a project after restarting the app.
- Preserve cover, image assets, chapter order, CSS where possible, link targets and footnotes.
- Track status for blocks and chapters; show incomplete content before export.
- Export a standalone translated EPUB file with updated book title/language metadata.
- Work entirely offline with no AI service or login.

### MVP exclusions

AI translation and provider keys, EPUB 2/NCX (until compatibility milestone), fixed-layout, DRM bypass, PDF/MOBI, collaborative editing, cloud storage, embedded authoring/source-code IDE, arbitrary CSS editing and full EPUB accessibility authoring tools.

## 2. UX / screen architecture

Detailed visual and interaction requirements: [Desktop UI/UX design](ui-ux-design.md). This specification supplements the screen architecture below and maps delivery to Milestones 0–5.

### A. Project Library

- **Open EPUB** button and native file picker.
- Recent projects, title/cover/author, source/target language, last edited, completion count.
- Resume an existing project. Re-importing the same source warns about duplicates by content hash.
- Clearly identify unsupported EPUBs and specific reasons.

### B. Translation Workspace

```text
+---------------------------------------------------------------------+
| Book title           Save: Saved           Preview       Export EPUB |
+----------------------+-------------------------+--------------------+
| Chapters             | ORIGINAL                | TRANSLATION        |
|  01  Completed       | read-only EPUB content  | editable blocks    |
|  02  In progress     | source heading/image    | target heading     |
| >03  In progress     | paragraph A             | translation A      |
|  04  Not started     | paragraph B             | translation B      |
|                      | paragraph C             | translation C      |
|                      |                         |                    |
| Book progress        | synchronized block      | status per block   |
+----------------------+-------------------------+--------------------+
| Chapter 3 of 20      | 8 / 12 blocks reviewed   | Autosaved 12:30 PM|
+---------------------------------------------------------------------+
```

- Sidebar: chapters, status (`not_started`, `in_progress`, `completed`), progress.
- Resizable left/right panes. Comfortable Myanmar font and line-height; independent scrolling initially. Block-linked scrolling later, after editor stability.
- Original pane renders protected/read-only content, including images, headings and links.
- Target pane presents a chapter document with restricted rich text, a shared formatting toolbar, and local/current-chapter image insertion. Original pane offers rendered Reader and read-only HTML modes.
- Target pane edits supported content blocks. Users can copy original text into target, save, undo, and mark blocks reviewed.
- Search inside the selected chapter (post-core milestone if necessary).
- Never claim an empty block is complete merely because its chapter was visited.
- Chapter changes wait for or flush pending writes; warn on persistent save failures.

### C. Export / Review

- Set translated book title and target language (`my`, `en`, etc.; store BCP 47 tags).
- Show completed/pending/unsupported block and chapter counts.
- Prevent silently exporting an unfinished book; allow explicit **Export draft** with warning and defined fallback behavior.
- Open native Save dialog, write to a new path, validate ZIP/OPF/reference integrity, and show success/error.
- Never replace the original imported file by accident.

## 3. Component architecture

```text
React + TypeScript (Bun/Vite)                    Tauri 2 / Rust
+---------------------------------+            +------------------------+
| ProjectLibrary                   |            | Tauri commands         |
| TranslationWorkspace            | <--------> | Application services   |
|  - ChapterSidebar               | typed      |  - ProjectService      |
|  - SourceChapterView            | commands   |  - ImportService       |
|  - TargetBlockEditor            |            |  - TranslationService  |
|  - SaveState / Progress         |            |  - ExportService       |
| ExportReviewDialog              |            +----------+-------------+
+---------------------------------+                       |
                                                          v
                                      +---------------------------------+
                                      | EPUB engine                     |
                                      | ZIP/OCF + OPF + XHTML + nav    |
                                      | source resource map / rewrite  |
                                      +----------------+----------------+
                                                       |
                                      +----------------v----------------+
                                      | Local project storage          |
                                      | SQLite + immutable source EPUB |
                                      | drafts / original resources    |
                                      +---------------------------------+
```

### Responsibilities

| Layer | Owns | Must not own |
| --- | --- | --- |
| React UI | display, navigation, editing UX | ZIP parsing, SQLite queries |
| Typed Tauri bridge | DTOs and command calls | business rules |
| Rust services | import, save, status, export orchestration | JSX/UI state |
| EPUB engine | archive, OPF/spine/nav, XHTML transforms | frontend behavior |
| SQLite repository | transactions and migrations | EPUB rendering |

**Initial Rust modules**: `commands`, `domain`, `services`, `epub`, `storage`, `security` (create as implemented, not as empty placeholders).

## 4. EPUB import design

**Import steps**

1. Native open dialog (`.epub` filter).
2. Rust validates file accessibility, ZIP structure, archive sizes/counts, path normalization, duplicate/symlink entries, and `mimetype`.
3. Read `META-INF/container.xml` to locate the OPF package, respecting relative paths.
4. Parse OPF metadata, manifest, spine and EPUB 3 navigation document with namespace-aware XML processing.
5. Resolve spine item IDs to XHTML resource paths. A TOC entry may point to an anchor within a chapter; do not assume one nav entry = one file.
6. Create immutable source snapshot under app project storage and compute `source_sha256`.
7. Extract an ordered block map for editable headings, paragraphs, list items, block quotes etc. Retain the original resource path and stable structural locator for each block.
8. Create project/chapter/block rows and a translation draft transactionally.
9. Display project overview; surface unsupported content with actionable warnings.

**Security:** never extract ZIP paths unchecked or allow embedded scripts to run in a privileged WebView. Restrict local asset serving to app-owned imported resources; prevent network fetches from book content.

**EPUB.js decision spike:** verify chapter preview, inline images, CSS, relative links, Burmese rendering and Tauri WebView security on all three desktop OSes. Prefer a safe document renderer if the preview library cannot satisfy these constraints. Reader rendering must never become the authoritative export source.

## 5. Translation data model (proposed SQLite v1)

The persisted block model is authoritative for manual edits. This schema is a starting point; migrations may refine it after the first import/export spike.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL,
  source_snapshot_path TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  source_language TEXT,
  target_language TEXT NOT NULL,
  translated_title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_chapter_id TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  spine_index INTEGER NOT NULL,
  manifest_item_id TEXT NOT NULL,
  resource_href TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  UNIQUE(project_id, spine_index)
);

CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  structural_locator TEXT NOT NULL,
  element_name TEXT NOT NULL,
  source_xhtml_fragment TEXT NOT NULL,
  source_plain_text TEXT NOT NULL,
  is_translatable INTEGER NOT NULL DEFAULT 1,
  support_status TEXT NOT NULL DEFAULT 'supported',
  UNIQUE(chapter_id, block_index)
);

CREATE TABLE translations (
  block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
  target_xhtml_fragment TEXT,
  target_plain_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  reviewed_at TEXT
);

CREATE INDEX idx_chapters_project ON chapters(project_id, spine_index);
CREATE INDEX idx_blocks_chapter ON blocks(chapter_id, block_index);
```

**Implementation notes**

- Enable SQLite foreign keys, WAL mode and migrations; keep SQLite in app-owned storage.
- Use UUIDs or equivalent stable IDs assigned **once at import**, never frontend array indexes.
- `structural_locator` is a stable-in-snapshot DOM locator, not a fragile displayed paragraph number. Store resource-relative URI and IDs necessary to remap references.
- `source_xhtml_fragment` represents the original content; keep original EPUB resource bytes as source of truth for export.
- `target_xhtml_fragment` should be a sanitized **inner fragment for a supported block**, not arbitrary XML from the browser. Validate element/attribute allowlists and namespaces before serialization.
- Manage changes with optimistic `revision` checking so a delayed autosave cannot replace a newer edit.
- Do not duplicate full book text in analytics or logs. SQLite stores translation working data only.

### Block/chapter status rules

- Translation block: `pending` (no reviewed content), `draft` (saved but unreviewed), `reviewed` (user confirmed), `skipped` (user intentionally retains original).
- Chapter: `not_started`, `in_progress`, `completed` (derived from required block states; optional cached status must be kept consistent).
- Unsupported content: tracked separately; cannot be auto-marked complete.
- Completion percentage: `reviewed + intentional skipped` / total supported required blocks, with unsupported warnings shown separately.

**Important editorial trade-off:** paragraph-to-paragraph alignment makes progress/scrolling reliable, but some translations need to merge or split sentences. Keep alignment at **block level**, allow free editing *within* a target block; defer cross-block merge/split to a deliberate later milestone. Nontrivial structures (tables, ruby, MathML, complex footnotes) must be detected rather than corrupted.

## 6. Tauri command contract (initial proposal)

TypeScript wrappers should return typed DTOs and map domain errors to user-readable states. Command names/DTOs may evolve, but the responsibilities should remain stable.

```ts
type ProjectId = string;
type ChapterId = string;
type BlockId = string;

type TranslationStatus = 'pending' | 'draft' | 'reviewed' | 'skipped';

type BlockDTO = {
  id: BlockId;
  sourceHtml: string;      // sanitized for display, never executable
  sourceText: string;
  targetHtml: string | null;
  status: TranslationStatus;
  revision: number;
  supportStatus: 'supported' | 'unsupported';
};

type ExportOptions = {
  title: string;
  targetLanguage: string;
  mode: 'completed' | 'draft';
};
```

| Command | Input | Output |
| --- | --- | --- |
| `import_epub` | selected source path | `ProjectSummary`, import warnings |
| `list_projects` | none | project summaries |
| `get_project` | `projectId` | project metadata/progress |
| `list_chapters` | `projectId` | ordered chapter summaries |
| `get_chapter` | `chapterId` | blocks + read-only resource locator |
| `save_translation` | `blockId`, target fragment, status, expected revision | saved revision + timestamp |
| `update_project_metadata` | `projectId`, translated title, language | project |
| `review_export` | `projectId` | missing/unsupported/invalid content report |
| `export_epub` | `projectId`, destination path, options | output path + validation report |

**Do not trust paths or HTML passed from React.** Rust validates file selection permissions, canonicalized paths, and output safety independently. Keep long imports/exports off the UI thread and report progress or cancellation when appropriate.

## 7. Autosave and recovery flow

```text
User edits a target block
  -> local UI draft updates immediately
  -> debounce (e.g. 400-800 ms; tune after testing)
  -> save_translation(blockId, content, status, expectedRevision)
  -> SQLite transaction updates content + revision + timestamp
  -> UI confirms Saved / shows failure and retry

Before chapter change / export / app close:
  -> flush pending edits where possible
  -> wait for acknowledged writes
  -> abort export and warn if save failed

On reopen:
  -> load project, selected chapter, saved translations
  -> resume from latest committed revisions
```

Avoid relying solely on an app-close callback (crashes and forced closes skip it). Consider a small in-memory unsaved-draft queue for transient failures, but don't represent uncommitted drafts as safely stored. Add recovery tests for killed/restarted processes once core persistence exists.

## 8. Export pipeline — most important correctness requirement

```text
User clicks Export
  -> flush saves
  -> review missing, skipped and unsupported blocks
  -> collect metadata and draft/complete decision
  -> copy immutable source EPUB into a temporary work archive
  -> map each translated block to its original XHTML resource
  -> replace only supported, intended content fragments
  -> update translated title/language + TOC labels where editable
  -> update nav/NCX as applicable; preserve spine/IDs/hrefs/assets
  -> produce OCF-correct ZIP
  -> validate internal references, XML, resource files
  -> EPUBCheck (optional developer/integration step)
  -> reopen output as a reader smoke test
  -> finalize destination file atomically where supported
  -> report export result and any warnings
```

### Export rules

- For Phase 1, **do not convert** the entire source book to Tiptap JSON and back. Patch only approved translated blocks into a copy of the original XHTML tree.
- Maintain original outer tags and stable resource IDs where possible; preserve embedded anchors/footnotes and reject edits that would break them.
- Rewriting a block must be XML-safe: escape text, serialize valid XHTML, maintain namespaces, and preserve required semantic attributes.
- Resource-level originals (covers, images, fonts, CSS, package data) stay unchanged unless deliberately edited.
- Package metadata: update `dc:language`, translated `dc:title` if provided; retain authors, publication data, identifiers by default; choose edition/identifier policy explicitly before publicly distributing translated editions.
- Translate visible TOC labels as a defined field or from reviewed headings; maintain each target `href`. Never blindly translate nav XML text without verifying its intended mapping.
- Write OCF `mimetype` entry **first, uncompressed**. Preserve `META-INF/container.xml`, manifest entries and spine order.
- For **draft export**, untranslated supported blocks retain original text with a clear warning/report; unsupported content is preserved unchanged. For **completed export**, block if required untranslated/unsupported items remain unless the user has explicitly reviewed a skip policy.
- Save to a different path than the source file or its immutable snapshot; confirm before replacing any unrelated existing output.
- Use temporary output and safe rename/copy fallback, avoiding half-written destination files.
- Export failures must not modify saved project translations.

## 9. Implementation roadmap

Checkboxes are checked only after the functionality exists and its acceptance criteria are verified.

### Phase files

The files below break down the existing roadmap without changing its scope or completion status. Numbered phase files follow Milestones 0–5 within product Phase 1; compatibility and AI remain deferred tracks.

- [x] [Milestone 0 — Bootstrap & architecture foundation](phase-0-bootstrap.md)
- [x] [Milestone 1 — EPUB import and chapter listing](phase-1-epub-import.md)
- [x] [Milestone 2 — Side-by-side reading/translation UI](phase-2-translation-workspace.md) (independent chapter rich text documents and image insertion; native IME checks pending)
- [x] [Milestone 3 — Local autosave, progress and resume](phase-3-autosave-and-resume.md)
- [x] [Milestone 4 — EPUB export (vertical-slice first)](phase-4-epub-export.md) (EPUBCheck pending)
- [ ] [Milestone 5 — Polish & desktop release](phase-5-desktop-release.md) (macOS polish done; installers/cross-OS open)
- [Milestone 2 — Side-by-side reading/translation UI](phase-2-translation-workspace.md)
- [Milestone 3 — Local autosave, progress and resume](phase-3-autosave-and-resume.md)
- [Milestone 4 — EPUB export (vertical-slice first)](phase-4-epub-export.md)
- [Milestone 5 — Polish & desktop release](phase-5-desktop-release.md)
- [Later — EPUB compatibility improvements](later-epub-compatibility.md)
- [Later — AI translation (explicitly NOT Phase 1)](later-ai-translation.md)

### Milestone 0 — Bootstrap & architecture foundation

- [x] Verify generated Tauri 2 + React + TS project runs with **Bun** on the current development OS.
- [x] Remove demo UI; create minimal app shell and navigation.
- [x] Add strict TS checks, format/lint conventions and relevant scripts.
- [x] Add Rust `domain`, `services`, `epub`, `storage` structure as functionality is introduced.
- [x] Implement typed Tauri command bridge and reusable error reporting.
- [x] Add SQLite schema/migration initialization with an automated persistence test.
- [x] Add native dialog plugin and narrowly scoped capabilities for import/export; avoid broad filesystem permissions.

**Done when:** `bun tauri dev` launches, the frontend invokes a typed Rust test command, and a local SQLite migration test passes.

### Milestone 1 — EPUB import and chapter listing

- [x] Implement archive and untrusted-input safety limits.
- [x] Parse container.xml + OPF manifest/spine/metadata for EPUB 3.
- [x] Parse EPUB navigation and resolve ordered chapter titles/anchors.
- [x] Copy immutable source snapshot, hash it, and create project rows.
- [x] Build stable editable block map for supported XHTML elements.
- [x] Surface unsupported EPUB feature warnings instead of failing silently.
- [x] Show imported project in library and chapter sidebar.
- [x] Add fixtures: simple multi-chapter, nested paths, images, links, missing OPF, malformed ZIP.

**Done when:** importing a fixture shows correct title, author, source language, cover if present, and spine-ordered chapters. Imported original is not modified.

### Milestone 2 — Side-by-side reading/translation UI

- [x] Design resizable 3-panel workspace (chapters, source, target).
- [x] Render source chapter safely with images and applicable book CSS.
- [x] Display target editor bound to stable source-block IDs.
- [ ] Support basic editing: Unicode text, paragraphs/headings, emphasis and inline links where safely mapped.
- [x] Add keyboard navigation, selection/focus, and clear save/error state.
- [ ] Test Myanmar Unicode line wrapping, copy/paste and multi-line content.
- [x] Validate EPUB.js/preview adapter compatibility with Tauri WebViews.

**Done when:** user can read one imported chapter and edit corresponding target blocks without altering source or breaking referenced images/links.

### Milestone 3 — Local autosave, progress and resume

- [x] Debounced autosave with revision conflict protection and retries.
- [x] Persist `pending`, `draft`, `reviewed`, `skipped` states.
- [x] Derive chapter status from required block review status.
- [x] Restore project and last chapter after a restart.
- [x] Flush saves before navigation and export.
- [x] Add recoverability and save-failure tests (including process interruption where feasible).

**Done when:** edited translations survive app restart and chapter switching without data loss; failures are reported honestly.

### Milestone 4 — EPUB export (vertical-slice first)

- [x] Implement a 1-chapter translated EPUB round trip on an intentionally simple fixture.
- [x] Patch translated XHTML fragments into source resource tree without flattening assets.
- [x] Repackage EPUB with correct OCF entry ordering/compression.
- [x] Update title, language and navigation labels without breaking hrefs.
- [x] Add native Save dialog, explicit draft mode and unfinished-content review.
- [x] Validate output ZIP, XHTML parsing, manifest targets and links.
- [x] Reimport the exported file and compare chapter/resource counts and spine order.
- [x] Add regression fixtures for formatting, internal links, images and footnotes.

**Done when:** a fully manually translated fixture exports, passes the project's integrity checks, reopens in a reading app, and retains its structural assets. EPUBCheck should also pass on supported compliant fixtures in CI/dev test environments.

### Milestone 5 — Polish & desktop release

- [x] UX review: dark mode, pane resizing, text zoom, shortcuts, error dialogs.
- [ ] Accessibility and Burmese text rendering cross-OS tests.
- [x] Performance checks with large books (bounded RAM/use lazy loading; 5,001 chapters / 56.9 MB macOS sweep, see Milestone 5 evidence).
- [ ] Package and smoke-test installers for Windows/macOS/Linux.
      (macOS .app/.dmg built and smoke-tested; Windows/Linux pending.)
- [x] Document backups, privacy, supported EPUB limits, and recovery.
- [x] Release checklist covering data-loss cases and export validation.

**Done when:** build artifacts install/open/export reliably on all supported desktop systems and known limitations are documented.

### Later — EPUB compatibility improvements

- [ ] EPUB 2 + NCX, and complex navigation structures.
- [ ] Advanced tables, ruby, semantic footnotes, SVG/MathML, media overlays as deliberate supported cases.
- [ ] Multi-block translation restructuring (join/split) with stable export mappings.
- [ ] Glossary/terminology, find/replace, side-by-side block scroll synchronization.
- [ ] Project import/export/backup files and manual revision history.

### Later — AI translation (explicitly NOT Phase 1)

- [ ] Provider-independent `TranslationProvider` interface with cancellable jobs.
- [ ] Prompt/context builder with glossary and per-block identity.
- [ ] API key security and opt-in network/privacy disclosures.
- [ ] Proposals stored as separate drafts, not automatic overwrites of reviewed manual translations.
- [ ] Batch progress, retry, costs, rate limits and user review.

## 10. Quality gates / test matrix

| Test case | Expected result |
| --- | --- |
| EPUB 3 book with non-alphabetical filenames | Correct OPF spine order |
| Nested OPF/XHTML/assets paths | References resolve correctly |
| Cover + images + CSS | Visible in source, retained in export |
| Bold/italic + internal link + footnote | Original semantics/targets survive export |
| Very long chapter | Smooth navigation, bounded memory |
| Burmese/Myanmar combining characters | No text corruption; UTF-8 intact |
| App closed during autosave | Last committed translation loads; unsaved state not falsely marked saved |
| Chapter changed quickly after typing | Buffered edits are flushed |
| ZIP traversal / huge decompressed payload | Safe rejection with meaningful error |
| Fixed-layout, DRM or unsupported block | Explicit warning; no silent corruption |
| Export with empty translations | Clear draft warning; never mislabel as complete |
| Export onto original input path | Rejected |
| Completed translated EPUB | ZIP valid, navigation and content readable, EPUBCheck passes for supported fixtures |
| Windows/macOS/Linux reader variations | Fonts, links and layout remain usable |

### Suggested command checks

```bash
bun install
bun tauri dev
bun run build
cd src-tauri && cargo fmt --check && cargo test
# Add these once configured in package.json/CI:
# bun run lint
# bun run test
# cd src-tauri && cargo clippy -- -D warnings
# java -jar <path-to-epubcheck.jar> <exported.epub>
```

## 11. Known technical risks / mitigations

| Risk | Mitigation |
| --- | --- |
| WYSIWYG serialization drops EPUB-specific inline markup | Restricted editor schema, original DOM preservation, explicit compatibility warnings and round-trip fixtures |
| Nav entries don't map 1:1 to XHTML files | Maintain spine item/resource/anchor models separately |
| WebView differences across OSes | Cross-OS EPUB.js spike and automated smoke fixtures |
| Tauri privilege exposure to imported HTML | Sandboxed/sanitized preview, restrictive CSP/capabilities, no network access by default |
| Crashes or delayed autosave | Transactional revisions, save state, flush on navigation, periodic persistence |
| Corrupt or unsafe EPUB ZIP | Input size/path/resource limits, XML validation |
| Valid-looking ZIP fails EPUB standard | OCF checks plus independent EPUBCheck fixture validation |
| Myanmar font shaping/line breaking differs by OS | Font fallback strategy, cross-platform visual tests, no string indexing by code unit |
| Huge books cause memory spikes | Lazy chapter load, storage-backed resource map, bounded parsing and previews |

## 12. Next action — first coding slice

**Start with Milestone 0** in the already-created React/TypeScript/Bun scaffold. Do **not** recreate the scaffold.

1. Confirm `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` and run `bun install` / `bun tauri dev`.
2. Create minimal Project Library and Translation Workspace shell (mock data permitted for UI only, clearly marked).
3. Add a typed Tauri command (e.g., `health_check`) and Rust service wiring.
4. Add local SQLite initialization and a migration test.
5. Implement a small EPUB **import/export proof of concept** on a synthetic EPUB 3 fixture before committing to a rich text schema. Verify lossless preservation of links, inline formatting and images.

**Do not start AI integration until the user explicitly changes the phase.**

## Technical references

- Tauri 2 create project & Bun commands: https://v2.tauri.app/start/create-project/
- Tauri file dialog: https://v2.tauri.app/plugin/dialog/
- Tauri permissions: https://v2.tauri.app/learn/security/using-plugin-permissions/
- EPUB overview / package, spine and navigation: https://www.w3.org/TR/epub-overview-34/
- EPUB specification: https://www.w3.org/publishing/epub/
- EPUBCheck validator: https://github.com/w3c/epubcheck

### Workspace revision — 2026-10-13

Milestone 2 follow-up replaces plain text fields with restricted Tiptap passage editors presented as a document, adds Reader/HTML source views and image insertion with EPUB manifest packaging. See [Milestone 2](phase-2-translation-workspace.md) for verified behavior and limitations. Native Myanmar IME/copy-paste and Windows/Linux remain unchecked; no release milestones were advanced.

### Chapter authoring correction — 2026-10-13

The user's clarified workflow supersedes the block-aligned editor/merge-split
restriction in this plan: each chapter has one independent, initially empty
rich text document. Paragraph selection is not required. Chapter IDs own saved
drafts, review and export; immutable source blocks remain for import and legacy
recovery. Export replaces the corresponding XHTML body with the authored
document. See Milestone 2 for preservation limits and verification.

Translation HTML authoring is now explicitly requested: the target pane has
an editable HTML body view sharing chapter autosave with Rich text, with
validation and a loss-aware check before converting back. This supersedes
the earlier HTML-authoring exclusion for the supported chapter schema; the
source HTML view stays read-only.

### Writer shortcuts — 2026-10-13

The editor has a `/` block menu for Text, H1–H3, Table and Image, with keyboard
filtering/selection and pointer selection at the caret. Basic authored tables
are now an explicitly requested feature, using the existing chapter save and
EPUB export services. See Milestone 2 for validation and remaining native checks.

### Per-book settings follow-up — 2026-10-13

Explicitly requested book metadata and AI instruction settings are implemented
as an extension of the export/workspace slice and the authorized AI assist
work. See [AI follow-ups](later-ai-translation.md) for fields, prompt behavior,
preservation tests and remaining native/cross-platform checks. Release and
future AI milestone checkboxes are unchanged.

### Custom cover follow-up — 2026-10-13

The explicitly requested custom cover feature is implemented in Book Settings
and EPUB export using local SQLite storage and an export-only asset override.
See Milestone 4 for behavior, regression tests and native verification limits.
Release checkboxes remain unchanged.

### Library views follow-up — 2026-10-13

The Home library supports the existing table and a responsive cover grid through
accessible view buttons beside Search. The view preference is saved locally;
search, open, progress, Book Settings and removal share the same project data
and actions in both layouts. This is a Milestone 5 UI polish follow-up.
`bun run check` passed (lint, TypeScript and production build); Vite reports a
large bundle warning. No running development build was available for rendered
light/dark, minimum-window, keyboard or native interaction verification.
Next unfinished task: verify both layouts in the desktop app at 1280×800 and
960×640 in both themes; Windows/Linux release checks remain open.
