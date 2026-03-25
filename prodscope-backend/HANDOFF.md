# V2 Refactor — Handoff Briefing

> **Read this first.** This is the current state of the refactor from `CLAUDE.md` Section 10.

## Week 1 — Foundation ✅

### Task 1: Git Cleanup ✅
- Deleted: all `.bak_*` files, `patch_*`/`apply_*`/`fix_*` scripts, `vm-backups-*` dirs, `index.js`
- `.gitignore` updated to block backup patterns

### Task 2: Split index.cjs ✅
Split `index.cjs` (558 lines) into modules:

| New File | What It Contains |
|----------|-----------------|
| `server.js` | Express routes only (thin entry point) |
| `jobs/runner.js` | `processJob()`, `analyzeScreenshots()`, `generateReport()` |
| `jobs/store.js` | SQLite-backed job store (see Task 3) |
| `emulator/manager.js` | `bootEmulator()`, `installApk()`, `killEmulator()`, `saveSnapshot()` |
| `output/email-renderer.js` | `renderReportEmail()` + HTML helpers |
| `output/email-sender.js` | `sendReportEmail()` — Resend wrapper |
| `config/defaults.js` | All env flags, model names, paths, thresholds |
| `utils/sleep.js` | `sleep()` |

### Task 3: SQLite Persistence ✅
- `jobs/store.js` → `better-sqlite3`, WAL mode, prepared statements
- API: `createJob(id, data)`, `getJob(id)`, `updateJob(id, fields)`
- Future tables ready: `crawl_sessions`, `screen_cache`, `coverage`, `flows`, `findings`, `checkpoints`
- DB: `data/prodscope.db` (configurable via `DB_PATH` env var)

### Task 4: Emulator Snapshots ✅
- `emulator/manager.js` tries snapshot restore first (<15s), falls back to cold boot
- `saveSnapshot()` exported for one-time setup on VM
- Configurable: `SNAPSHOT_NAME`, `SNAPSHOT_BOOT_TIMEOUT`, `COLD_BOOT_TIMEOUT`

## Week 2 — Screen Intelligence + Coverage ✅

### Brain Modules (new `brain/` directory)

| File | Purpose |
|------|---------|
| `brain/screen-classifier.js` | Heuristic screen classification (login, feed, settings, navigation_hub, etc.) with fingerprint cache. Zero LLM calls. |
| `brain/coverage-tracker.js` | Feature-level coverage: visit counts, saturation detection, exploring/covered/saturated status per feature category. |
| `brain/flow-tracker.js` | Flow recording (ordered screen→action sequences) with SHA-256 flow fingerprinting. |
| `brain/dedup.js` | Flow + screen deduplication — fuzzy fingerprint comparison, meaningful-variation detection. |

### Crawler Enhancements

- **`crawler/fingerprint.js`** — Added `computeFuzzy(xml, activity)` alongside existing `compute(xml)`. Fuzzy FP groups same-structure screens (e.g. two product pages) by class names, resource IDs, interactable counts, and activity.
- **`crawler/run.js`** — Wired brain modules into crawl loop:
  - After fingerprinting: classify screen → record coverage → track flow
  - Before action selection: coverage-gated skip (saturated features → press back)
  - After action: record step in flow tracker
  - End of crawl: finalize flows, register with dedup, export coverage + flows in result
- **`maxSteps`** raised from 20 → 60 (in both `run.js` default and `config/defaults.js`)

### Screen Type → Feature Mapping

```
login/signup    → auth_flow
feed            → browsing
detail_view     → content_viewing
settings        → settings
media_upload    → content_creation
form            → data_entry
search          → search
navigation_hub  → navigation
dialog          → interaction
error           → error_handling
```

## Week 3 — Watchdog + Intelligent Planning ✅

### New Modules

| File | Purpose |
|------|---------|
| `emulator/watchdog.js` | EmulatorWatchdog: checks ADB, emulator responsiveness, app foreground, ANR, screen freeze. Returns recovery actions. |
| `crawler/checkpoint.js` | Saves crawl state to SQLite every 5 steps. Restores on resume, cleans up after completion. |
| `ingestion/manifest-parser.js` | Extracts package name, launcher activity, activities, permissions from APK via `aapt dump badging`. Replaces `pm list packages -3`. |
| `brain/planner.js` | 1 LLM call at crawl start → exploration plan with prioritized targets. Falls back to deterministic plan if LLM unavailable. |

### Integration Changes

- **`crawler/adb.js`** — Default timeout reduced from 15s → 5s. `screencap` and `dumpXml` keep 10s (they're legitimately slower).
- **`crawler/policy.js`** — Now imports `planBoost` from planner. Actions matching the current plan target get +15-20 priority boost.
- **`crawler/run.js`** — Wired in:
  - Watchdog health check at every step (before capture). Recovery on failure, abort on 3 consecutive failures.
  - Checkpoint save every 5 steps to SQLite.
  - Plan creation at crawl start, target advancement when coverage tracker marks a target as covered.
  - Plan passed to `policy.choose()` for action ranking boost.
- **`jobs/runner.js`** — Manifest parsing at ingestion. Uses launcher activity from manifest for `am start` (falls back to `monkey` if unavailable). Passes `appProfile` to `runCrawl`.

## Week 4 — Token Optimization + Report Quality ✅

### Oracle Pipeline (new `oracle/` directory)

Replaces the per-screenshot LLM loop with deterministic checks + gated AI:

| File | Purpose |
|------|---------|
| `oracle/crash-detector.js` | logcat FATAL EXCEPTION detection — zero tokens |
| `oracle/anr-detector.js` | dumpsys + XML ANR detection — zero tokens |
| `oracle/ux-heuristics.js` | Accessibility (missing contentDesc, small tap targets), empty screen, slow response — zero tokens |
| `oracle/triage.js` | Scores screens by findings/diversity/coverage, selects max 8 for AI vision |
| `oracle/ai-oracle.js` | Gated Haiku vision analysis on triaged screens only |

### Context + Report Modules

| File | Purpose |
|------|---------|
| `brain/context-builder.js` | Compressed prompts: ~800 tokens for screen analysis, ~3000 for report synthesis |
| `output/report-builder.js` | Structured JSON report (Section 8 schema) + 1 Sonnet LLM call. Fallback to deterministic-only report on LLM failure. |

### Key Changes

- **`crawler/run.js`** — Oracle checks (crash/ANR/UX) after every action. `oracleFindings` + `oracleFindingsByStep` in crawl result. Screen objects enriched with `screenType`, `feature`, `fuzzyFp`.
- **`jobs/runner.js`** — Deleted `analyzeScreenshots()` and `generateReport()`. New pipeline: `triageForAI()` → `analyzeTriagedScreens()` (max 8) → `buildReport()` (1 Sonnet call). Token usage tracked per job.
- **`config/defaults.js`** — Added `MAX_AI_TRIAGE_SCREENS: 8`, `ACCESSIBILITY_MIN_TAP_DP: 48`, `SLOW_RESPONSE_THRESHOLD_MS: 3000`

### Token Savings

Old: 20-60 Haiku vision calls + 1 Sonnet report = ~32K+ tokens
New: max 8 Haiku vision calls + 1 Sonnet report = ~10-12K tokens (~60-70% reduction)

## Week 5 — Generalization + Dedup ✅

### Generalized Modules

| File | Change |
|------|--------|
| `crawler/system-handlers.js` | Fully generic: detects ANY dialog/overlay by XML pattern (permission, crash/ANR, third-party auth, onboarding, generic catch-all). No app-specific code. |
| `crawler/forms.js` | Fully semantic: classifies fields by Android `inputType`, keyword matching, and form intent inference (auth/payment/address/profile/search). No hardcoded field names. |
| `brain/screen-classifier.js` | Added `extractCreationSubType()` (Section 4.6): detects content sub-types — image_post, video_post, story, carousel, text_post, live. Result stored in `classify().subType`. |

All hardcoded app-specific patches removed.

## Week 6 — Polish + Multi-Job ✅

| File | Change |
|------|--------|
| `jobs/queue.js` | In-process FIFO job queue. Decouples HTTP from processing. Single emulator constraint enforced. `recoverPendingJobs()` re-queues stuck jobs on startup. |
| `server.js` | Refactored to use queue: `POST /api/start-job` returns immediately with `jobId`, `GET /api/queue-status` exposes queue health. |
| `brain/planner.js` | Added `replan()` — LLM call every ~15 steps at navigation hubs. Re-prioritizes remaining targets based on coverage gaps. |
| `output/email-renderer.js` | Professional HTML email with score, stats bar, summary, critical bugs, UX issues, suggestions, quick wins, deterministic findings, coverage table, crawl health, footer with token usage. |

## Deploy to VM

```bash
cd ~/prodscope-backend-live
git fetch origin
git checkout feat/live-preview-device-presets
git pull origin feat/live-preview-device-presets

# Install new dependency
npm install better-sqlite3

# New dirs created automatically by modules:
# brain/, jobs/, emulator/, output/, utils/, config/, data/, oracle/, ingestion/

# One-time: create emulator snapshot
emulator -avd prodscope-test -no-window -no-audio -gpu swiftshader_indirect &
# Wait for full boot, then:
node -e "require('./emulator/manager').saveSnapshot()"
adb emu kill

# Start
node server.js
```

## Environment

- GCP VM: `34.10.240.173`, user: `arjunhn`
- Branch: `feat/live-preview-device-presets`
- Emulator AVD: `prodscope-test`
- Android SDK: `~/android-sdk`
- KVM enabled, 4 vCPUs, 14GB RAM
- Entry point: `node server.js` (index.cjs kept as rollback)

