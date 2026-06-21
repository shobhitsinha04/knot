# ISSUES_AND_FIXES.md

A phase-by-phase, sequential log of every real problem hit during development and
the fix shipped for it, plus the caveat / asterisk attached to each fix (what the
fix does *not* cover, the assumption it rests on, or the deviation it introduces).

This is a cross-cutting index for engineers debugging behaviour or weighing a
change. It is **derived** from the canonical sources and should be reconciled
against them, not treated as the source of truth:

- `docs/CHANGELOG.md` — the authoritative, Documenter-maintained phase record.
- `docs/DECISIONS.md` — the numbered architectural decisions referenced below.
- `docs/JUDGE_SCORES.md` — per-phase Judge review scores.
- Git history — the commit each in-progress (Phase 6) fix landed in.

Legend: **Issue → Fix → ⚠️ Caveat.** "Open" items are known issues still tracked
(Linear is external to this repo).

---

## Phase 1 — Ollama Integration + Hardware Detection  ·  *Closed, Judge 27/30*

1. **`localhost` resolves to IPv6 first → ECONNREFUSED.** Node's `fetch` can
   resolve `localhost` to `::1` before `127.0.0.1`, but Ollama listens on the
   IPv4 loopback, so calls failed.
   **Fix:** `OLLAMA_DEFAULT_BASE_URL = http://127.0.0.1:11434` (literal IPv4).
   ⚠️ Still loopback-only, so privacy is unchanged — but the IPv4 address is now
   the baked-in default; anything that later exposes a configurable `baseUrl`
   must preserve this default or the bug returns.

2. **`ollama pull` exits non-zero even when the model completes.** A transient
   network error ("context deadline exceeded") makes the CLI exit 1 while the
   server quietly retries and finishes the download. (Found during F5.)
   **Fix:** treat **model presence** (`hasModel` via `GET /api/tags`) as the
   success signal, not the exit code; retry up to `OLLAMA_PULL_MAX_ATTEMPTS = 3`;
   condense stderr via `summariseStderr` for diagnostics.
   ⚠️ The presence check uses exact `includes()` matching (see Open below), and
   because the exit code is ignored, a model left present from a *previous,
   stale* pull would read as success.

3. **A tier's models can exceed available free disk.**
   **Fix:** generalized disk-aware fallback — `TIER_REQUIRED_DISK_GB` defines a
   per-tier free-disk floor and `applyDiskFallback` steps down one tier at a time
   until the floor is met.
   ⚠️ Only Tier 4's floor (30 GB) comes straight from `HARDWARE_PROFILES.md`; the
   lower-tier floors are a generalization, not spec-explicit.

4. **Non-standard Homebrew prefix → false "Ollama not installed".**
   **Fix:** `findBinary()` falls back to scanning `PATH` after the known install
   paths.
   ⚠️ Covers known paths + `PATH` only; an install outside both is still missed.

5. **36 GB RAM was ambiguous** — `HARDWARE_PROFILES.md` listed it under both
   Tier 3 and Tier 4.
   **Fix:** resolved to **Tier 3** (14B chat / 3B autocomplete), formalized in
   DECISIONS 012; `detect()` maps exactly 36 → T3, 37 → T4.
   ⚠️ A deliberate deviation from one reading of the spec table.

6. **Helicone observability proxy dropped from v1** (DECISIONS 011, amends 008).
   **Fix:** `OllamaService` calls Ollama directly via the configurable base URL;
   dev debugging uses the VS Code Output Channel.
   ⚠️ No observability layer in v1; structured so a proxy can slot back in later
   with no call-site changes. ARCHITECTURE/TECH_STACK/DATA_FLOW/PHASES updated.

7. **Model pulls use the CLI, not the HTTP API** (spec deviation). `pullModel`
   shells out to `ollama pull` + stdout parsing (per PHASES / ONBOARDING_FLOW),
   not `POST /api/pull` (which TECH_STACK lists).
   ⚠️ The CLI path is what required the presence-check/retry robustness in #2;
   switching to `POST /api/pull` (cleaner streamed JSON) remains an option if
   spurious CLI failures recur.

**Open:**
- `hasModel()` matches `/api/tags` names with exact `includes()`. A future Ollama
  returning digest-qualified names (`qwen2.5-coder:7b@sha256:…`) would miss and
  trigger an unnecessary re-pull. (Judge obs #7.)
- `smokeTestInFlight` is module-level state — correct for the single v1
  extension-host process, but would reset if the host hot-reloaded modules.

---

## Phase 2 — Codebase Indexing  ·  *Closed, Judge 28/30*

1. **All search hits scored ~0.002 → recency dominated ranking.**
   `nomic-embed-text` embeddings are not normalized, so raw L2 distances are
   large and `1/(1+d)` similarity collapses toward zero, letting the 0.3 recency
   weight pick the top results (newest file, not most relevant). Caught via a
   live indexing harness.
   **Fix:** `search()` uses `.distanceType("cosine")` and
   `computeSimilarity = clamp(1 − distance, 0, 1)` → meaningful ~0.5–0.63 scores
   and relevant ranking.
   ⚠️ A deliberate, documented deviation: DATA_FLOW §3/§4 text implied L2.

2. **Dense 150-line chunks returned HTTP 500 and were silently dropped**
   (~23 of 76 in one run). `nomic-embed-text` has a ~2048-token context that a
   dense chunk (>~4500 chars) overflows.
   **Fix:** `EMBED_MAX_CHARS = 4000` truncates the **embedding input** only; the
   **full** chunk text is still stored for prompt assembly, and chunk line
   geometry is unchanged.
   ⚠️ 4000 is empirical (≈4500 is the breaking point). For a very dense chunk the
   embedding represents only its first ~4000 chars, so retrieval of such chunks
   is approximate even though citations stay line-accurate.

3. **"Recency" is undefined in DATA_FLOW.**
   **Fix:** implemented as exponential decay with a 30-day half-life
   (`RECENCY_HALF_LIFE_MS`), isolated as one constant.
   ⚠️ Invented behaviour; trivially reversible by changing the constant/weight.

4. **LanceDB ships a native `.node` binary that can't be bundled.**
   **Fix:** `@lancedb/lancedb` is marked **external** in esbuild and `require()`d
   at runtime.
   ⚠️ The native module must be present at runtime — flagged as a Phase 7 `.vsix`
   packaging concern (the binary has to be packaged alongside the bundle).

5. **Watcher event before the first full index silently no-opped.**
   `proper-lockfile` with `realpath:true` threw `ENOENT` because the index dir
   didn't exist yet. (Judge minor.)
   **Fix:** `acquireLock()` now ensures the index dir before locking.

6. **`/project` matched `/project-2`.** `isIndexablePath` used a raw `startsWith`
   prefix check. (Judge minor.)
   **Fix:** replaced with a `path.relative` containment check.

7. **`EISDIR` thrown on watcher events** when a directory event reached the
   record builder (commit `c3c5d5b`).
   **Fix:** `buildRecords` skips non-files.

**Open:**
- `hasModel()`/`listModelNames()` exact-`includes()` matching: an untagged model
  (`nomic-embed-text`) is stored as `…:latest`, so a presence check returns false
  even when present. The Phase 2 path is unaffected (pull succeeds on exit 0;
  `embed()` passes the untagged name, which Ollama resolves), but a Phase 6
  onboarding presence check would misfire. Compounds Phase 1's Open item —
  consider tag-tolerant matching.
- Incremental `updateFile` does **not** re-check `.gitignore` (documented
  simplification): saving a gitignored *text* file the initial walk skipped could
  index it on update.

---

## Phase 3 — Sidebar Chat  ·  *Closed, Judge 27/30*

1. **File context never reached the model.** Focusing the chat webview clears
   `window.activeTextEditor`, so `gatherFileContext` saw nothing. (Found in F5.)
   **Fix:** track `lastEditor` via `onDidChangeActiveTextEditor`; context uses
   `activeTextEditor ?? lastEditor`.
   ⚠️ A heuristic — `lastEditor` can be stale if the user juggles many editors
   before chatting.

2. **Chat history lost when switching activity-bar views.**
   **Fix:** register the provider with `retainContextWhenHidden: true`.
   ⚠️ Keeps the webview alive in memory while hidden.

3. **Streaming felt frozen during long prefill.**
   **Fix:** show the blinking cursor (later a three-dot typing indicator)
   immediately on send.

4. **Code blocks overflowed the panel** (flexbox `min-width: auto`).
   **Fix:** `min-width: 0` on the conversation/message containers, body
   `overflow: hidden`. (Diagnosed via a headless-Chrome preview of the real
   webview CSS/JS with VS Code theme vars injected.)

5. **Immediate Stop posted a spurious "No response received" error.**
   (Judge minor.)
   **Fix:** an immediate Stop ends quietly and the empty assistant bubble is
   dropped.

6. **"Model not loaded" was indistinguishable from other failures.**
   (Judge minor.)
   **Fix:** a pre-send `hasModel()` check surfaces a distinct inline error with a
   working **Retry** action.

7. **XSS risk from rendering model output as markdown/HTML.**
   **Fix:** a CSP with `script-src 'nonce-…'` plus `marked` configured to escape
   raw HTML.
   ⚠️ No DOMPurify (deliberately no new dependency, user-confirmed); defense rests
   on the CSP + marked escaping rather than sanitization.

8. **Webview DOM types collided with `@types/node`'s fetch types.**
   **Fix:** a separate `tsconfig.webview.json` (`lib: DOM`, `types: []`); the main
   config excludes `src/webview`.

**Open:**
- Context-window trimming is by **message count only** (20 ≈ 10 exchanges); no
  token-based trimming or file-content truncation yet. Deferred to Phase 6, where
  `@codebase` introduces the larger contexts that need it.
- A failed send (e.g. Ollama down) shows the user bubble in the UI but does **not**
  record it in `ConversationManager` history — a minor UI/state divergence on the
  error path.
- Syntax-token colours are **hardcoded** in `webview.css` (the one UI_UX colour
  exception) because VS Code does not expose per-token editor theme colours to
  webviews.

---

## Phase 4 — Inline Completions  ·  *Closed, Judge 28/30*

1. **A filename in the FIM prompt made the model emit stray markdown fences.** A
   leading `<|file_sep|>` triggered prose/fence output.
   **Fix:** plain FIM — `buildFIMPrompt(prefix, suffix)`, no filename. PHASES.md's
   `(…, filename, language)` signature was updated to match.

2. **Without `raw: true`, completions came back as prose.** Ollama applied the
   instruct chat template to the FIM tokens.
   **Fix:** `complete()` sends `raw: true` on `/api/generate`.

3. **A 3 s timeout silently aborted cold model loads.** A cold load is ~2.7 s, so
   DATA_FLOW §1's 3 s budget killed it. (Judge minor.)
   **Fix:** timeout set to **5 s**, recorded as DECISIONS 013 (DATA_FLOW §1
   annotated).
   ⚠️ A hardware-informed default (warm path ~0.3 s, well under the 2 s DoD);
   revisit once more machines are profiled.

4. **Cold-load latency dominated time-to-first-completion.**
   **Fix:** `keep_alive` (30 m) keeps the model resident + an activation pre-warm.
   ⚠️ Additions beyond DATA_FLOW §1; keeping the model resident holds memory.

5. **The chat-header Autocomplete toggle didn't reach the provider.** Chat and the
   completion provider held separate `ConfigManager` instances.
   **Fix:** a single shared `ConfigManager` across chat, smoke test, and provider;
   the provider reads the flag each request.

6. **Accepting a completion could duplicate a bracket/line already after the
   cursor.**
   **Fix:** `cleanCompletion(raw, suffix)` strips echoed special tokens, unwraps
   stray fences, and trims a tail that merely repeats the start of the suffix.
   ⚠️ Best-effort small-model cleanup; returns `""` when nothing usable remains.

**Open:**
- Provider-level logic (debounce, supersession, status-bar ref-count, timing) is
  `vscode`-coupled and not unit-tested — verified by manual F5 per the DoD.
- The 5 s timeout default likely needs tuning against real-world latency on more
  hardware.

---

## Phase 5 — CMD+K Inline Editing  ·  *Closed, Judge 27/30*

1. **The spec's floating input box isn't buildable in stable APIs** — a decoration
   can't host an editable input.
   **Fix:** use `showInputBox` (DECISIONS 014).
   ⚠️ The CMD+K UI is an approximation of UI_UX.md, bounded by stable VS Code APIs.

2. **No theme-safe floating action bar or ±gutter glyphs.** A floating interactive
   widget isn't available, and gutter icons can't follow the theme without
   hardcoding colours (UI_UX forbids).
   **Fix:** render the diff as theme-coloured whole-line decorations + an
   Accept/Reject CodeLens (DECISIONS 015).
   ⚠️ No `−`/`+` gutter glyphs; the action bar is a CodeLens, not a floating bar.

3. **Small instruct models wrap output in ```lang fences despite the system
   prompt.**
   **Fix:** `cleanEditOutput(raw)` strips the fences; it's safe on a partial buffer
   so it runs on every streamed token for a clean live preview.

4. **A `raw` generate makes the model ignore the rewrite instruction.**
   **Fix:** `generateStream()` is **instruct-templated** (system prompt in the
   `system` field), unlike Phase 4's `raw` completion path.

5. **A mid-stream Esc could repaint over the restored original** (teardown race).
   **Fix:** the session is **detached synchronously before** aborting, and
   in-flight renders are drained before the original is restored — a mid-stream
   cancel leaves the file exactly as it was.

6. **A failed final restore edit failed silently.** (Judge obs.)
   **Fix:** it now logs a warning to the Output channel.

**Open:**
- The CMD+K UI is an approximation bounded by stable APIs (DECISIONS 014/015).
- The editor-coupled session machine is verified by manual F5, not Vitest (the
  pure logic it drives — diff, prompt, fence cleanup — *is* unit-tested).

---

## Phase 6 — @codebase + Onboarding UI  ·  *IN PROGRESS — not yet Judge-reviewed*

> These entries are reconstructed from the dev-branch commit history and **have
> not** been through a Judge review or a Documenter CHANGELOG entry. Reconcile
> this section against `docs/CHANGELOG.md` once Phase 6 closes.

1. **Duplicate chunks accumulated in the index across activations.**
   **Fix:** rebuild cleanly + reconcile on activation to kill duplicate chunks
   (`c307b51`); added a **"LocalPilot: Rebuild Index"** command for a clean full
   rebuild (`e570550`); covered indexing idempotency + reconcile mtime-diff with
   tests (`d6872ce`).
   ⚠️ Reconciliation is driven by an mtime diff — a change that doesn't move mtime
   wouldn't be reconciled; the manual Rebuild command is the escape hatch.

2. **`@codebase` retrieval wasn't wired into chat.**
   **Fix:** route retrieval through a new `ContextService` (`cb15b2a`, "Phase 6
   WP1").

3. **F5 review fixes** (`311ba72`): the first-token timeout was too short for
   `@codebase` (larger prompt → longer prefill); virtualenvs were being indexed;
   stale task chips lingered.
   **Fix:** longer first-token timeout, skip venvs during the walk, clear stale
   chips.
   ⚠️ The venv skip is a heuristic directory match (alongside the existing
   skip-dir list), not a full environment detection.

4. **Grounded answers were too loose and leaked raw LaTeX.**
   **Fix:** tighter grounded prompts, suppress raw LaTeX, add index-update logging
   (`12f4732`).

5. **Math wasn't rendered in answers.**
   **Fix:** render math with **KaTeX** in chat / `@codebase` answers (`3f93180`).
   ⚠️ KaTeX is bundled into the webview (watch the Phase 7 bundle-size budget).

6. **Incremental index updates didn't fire reliably from the file watcher.**
   **Fix:** drive incremental updates from `onDidSaveTextDocument` instead
   (`1db9437`).
   ⚠️ Updates are now **save-driven** — edits that never hit disk aren't indexed
   until saved.

7. **`@codebase` could read stale chunks** right after an edit.
   **Fix:** strong read consistency so `@codebase` sees fresh chunks (`8d35efd`).

8. **`@codebase` could search before indexing finished.**
   **Fix:** `@codebase` waits for in-flight indexing before searching (`8614d8b`).

**Carried into this phase (from earlier Open items):**
- Token-based context-window trimming (Phase 3) — the large `@codebase` contexts
  are exactly what need it.
- Tag-tolerant `hasModel()` matching (Phases 1 & 2) — relevant to onboarding
  presence checks.

---

## Cross-cutting themes

- **Live-harness verification pays off.** The cosine-vs-L2 (P2 #1), embed-500
  (P2 #2), FIM-fence (P4 #1), and cold-load-timeout (P4 #3) bugs were all found by
  running the real path, not by reading the spec.
- **Stable-API ceilings shaped the UI.** Phase 5's input box and diff chrome are
  approximations because VS Code's stable APIs can't host floating editable/
  interactive widgets or theme-safe gutter glyphs (DECISIONS 014/015).
- **Privacy held throughout.** Every Judge review confirmed all `fetch` traffic
  targets `127.0.0.1:11434`; no fix introduced an external call.
- **Recurring open item:** exact-`includes()` model-name matching (Phases 1 & 2)
  — still the most likely onboarding foot-gun for Phase 6.
