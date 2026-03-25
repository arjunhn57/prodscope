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

## Deploy to VM

```bash
cd ~/prodscope-backend-live

# Install new dependency
npm install better-sqlite3

# Copy all files (or git pull)
# New dirs to create: brain/, jobs/, emulator/, output/, utils/, config/, data/

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
- Emulator AVD: `prodscope-test`
- Android SDK: `~/android-sdk`
- KVM enabled, 4 vCPUs, 14GB RAM
- Entry point: `node server.js` (index.cjs kept as rollback)
