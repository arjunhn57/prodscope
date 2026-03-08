# Crawler v1 — Architecture & Usage

## Overview

The crawler engine replaces the inline random-tap crawl in `index.js` with a modular, deterministic system that uses screen fingerprinting, a visited-state graph, and ranked action selection to systematically explore an Android app.

## Module Map

```
prodscope-backend/
├── index.js                     # Orchestrator: emulator → crawl → analyze → report
└── crawler/
    ├── adb.js                   # ADB command wrapper (tap, swipe, screencap, etc.)
    ├── screen.js                # Captures screenshot + XML + activity metadata
    ├── fingerprint.js           # SHA-256 hash of structural XML (strips volatile attrs)
    ├── actions.js               # Extracts & ranks candidate actions from XML
    ├── policy.js                # Picks best action using priority + guidance boost
    ├── forms.js                 # Detects login/signup forms, fills credentials
    ├── graph.js                 # StateGraph: visited nodes, edges, loop detection
    ├── system-handlers.js       # Auto-dismisses permission/crash/Google dialogs
    ├── run.js                   # Main crawl loop orchestrator
    └── __tests__/
        ├── fingerprint.test.js
        ├── actions.test.js
        └── graph.test.js
```

## How It Works

Each crawl step:

1. **Capture** — screenshot PNG + UI XML + current activity
2. **Fingerprint** — hash structural XML (class, resource-id, text) ignoring volatile attrs (bounds, focus)
3. **Graph update** — register state, check if new or revisited
4. **System check** — auto-dismiss permission prompts, crash dialogs, Google sign-in
5. **Form check** — if login screen detected and credentials available, fill and submit
6. **Extract actions** — parse XML for tap/type/scroll/back candidates, filter already-tried
7. **Policy decision** — rank by priority, boost actions matching `goldenPath`/`goals`/`painPoints`
8. **Execute** — perform the chosen action via ADB
9. **Record transition** — update graph edge from old fingerprint → new fingerprint
10. **Stop check** — max steps, no-new-states for 5 consecutive steps, or loop detected

## Feature Flag

```bash
# Use new crawler (default)
USE_CRAWLER_V1=true

# Fall back to legacy random-tap crawl
USE_CRAWLER_V1=false
```

## Running Tests

```bash
cd prodscope-backend
npm test
```

Uses Node.js built-in test runner (`node --test`). Tests cover fingerprinting, action extraction/ranking, and graph/loop detection.

## Crawl Artifacts

Each job saves `crawl_artifacts.json` in the screenshot directory with:
- `screens` — all captured snapshots with metadata
- `actionsTaken` — every action with reason and fingerprint context
- `graph` — full state graph (nodes + transitions)
- `stopReason` — why the crawl ended
- `reproPath` — ordered fingerprint sequence for reproduction
- `stats` — totalSteps, uniqueStates, totalTransitions

## What Remains for v2

- **Vision-guided exploration** — use Claude to decide next action from screenshot
- **Deep form filling** — multi-step registration flows, CAPTCHA handling
- **Parallel crawl** — run multiple emulators for faster coverage
- **State-space coverage metric** — estimate how much of the app was explored
- **Network traffic capture** — HAR-like logging during crawl
- **Persistent crawl resume** — save/restore graph to continue from where we left off
