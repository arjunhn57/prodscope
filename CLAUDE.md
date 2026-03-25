# ProdScope Backend Architecture — Consolidated Design Document

> **⚡ Active refactor in progress.** See `prodscope-backend/HANDOFF.md` for current state and next steps.

**Consolidated from:** Two independent architecture reviews of `arjunhn57/prodscope-backend`
**Date:** 2026-03-25

---

## 1. Hard Truths About the Current System

### 1.1 The Monolith

`index.cjs` is 558 lines handling Express routing, emulator lifecycle, APK installation, crawling orchestration, screenshot analysis, report generation, email HTML templating, and delivery — all in one file. The 15+ `index.cjs.before_*` backup files confirm you are patching a live VM through terminal instead of using git branches. The `vm-backups-*` folders committed to the repo are VM state that does not belong in version control.

### 1.2 Crawler v1 is Structurally Blind But Mechanically Sound

Your `CRAWLER_V1.md` reveals solid fundamentals — SHA-256 fingerprinting of structural XML, state graph, action ranking, system dialog handling, form detection. These are keeper modules. The problem is higher up: the crawler cannot understand *what* a screen is (login? feed? settings?), cannot distinguish "same screen, different content" from "different screen," and has no concept of feature-level coverage. Combined with `maxSteps: 20`, this guarantees shallow exploration of any non-trivial app.

### 1.3 AI Is Used in the Wrong Place

`analyzeScreenshots()` sends every captured screenshot to Claude Haiku with a generic prompt. A 20-step crawl = 20 LLM calls for analysis + 1 Sonnet call for report synthesis. The crawl loop itself uses zero intelligence — it picks actions by heuristic ranking with no semantic awareness. You're paying for AI to write prose about screens that a blind crawler chose randomly, instead of using AI to guide exploration.

### 1.4 No Persistence, No Concurrency, No Recovery

`const jobs = {};` — server restart = all state lost. One emulator, cold-booted per job (~4 minutes), killed after each job. No checkpoints. If the emulator freezes at step 15, the entire job fails. No crash detection via logcat. No ANR detection. Free bug signals are being thrown away.

### 1.5 Increasing Emulator RAM/CPU Is Partially Correct

More resources help — 4GB RAM and 4 vCPUs with KVM enabled is the minimum. Without KVM, the emulator runs in software emulation and is 10-50x slower (the #1 cause of "app stops responding"). But resources alone won't fix: apps that genuinely crash (that's a finding, not a system bug), network-dependent apps, WebView-heavy apps that timeout, or the architectural bottleneck of cold-booting per job. For those, you need the watchdog + snapshot system.

### 1.6 The Real Fix Map

| Problem | Root Cause | Correct Fix |
|---------|-----------|-------------|
| Emulator freezes | Cold-boot-per-job, no health monitoring | Warm snapshot pool, watchdog, 4GB/4vCPU/KVM |
| Shallow coverage | 20-step cap, no semantic planning | Planner module, coverage tracker, raise to 60-80 steps |
| Token waste | Every screenshot → LLM post-hoc | Gated AI calls, triage, cached screen types |
| No memory | `const jobs = {}` | SQLite persistence |
| App-specific patches | No abstraction layer | Generic screen classifier, configurable policies |
| Fragile deployment | Manual VM patching with file backups | Git branches, modular code, CI/CD |

---

## 2. Target Architecture

### 2.1 Module Map

```
prodscope-engine/
├── server.js                    # Express routes only (thin)
├── config/
│   └── defaults.js              # All thresholds, policies, constants
│
├── ingestion/
│   ├── apk-validator.js         # Validate APK is installable
│   └── manifest-parser.js       # Parse AndroidManifest.xml → activities, permissions, package name
│
├── jobs/
│   ├── queue.js                 # Job queue (in-memory for MVP, BullMQ later)
│   ├── store.js                 # SQLite persistence
│   └── runner.js                # Job lifecycle orchestrator
│
├── emulator/
│   ├── pool.js                  # Warm emulator pool with snapshot restore
│   ├── adb.js                   # ADB wrapper (evolved from crawler/adb.js)
│   ├── health.js                # Heartbeat checks
│   └── watchdog.js              # Freeze/ANR/crash/disconnect detection + recovery
│
├── crawler/
│   ├── loop.js                  # Main crawl loop (the agent loop from Section 3)
│   ├── screen-capture.js        # Screenshot + XML + activity capture
│   ├── fingerprint.js           # Exact + fuzzy fingerprinting
│   ├── action-extractor.js      # Parse XML → candidate actions (keep existing)
│   ├── system-handlers.js       # Generic dialog/permission dismissal (keep + generalize)
│   └── form-handler.js          # Generic form detection + filling (keep + generalize)
│
├── brain/
│   ├── screen-classifier.js     # Classify screen type (heuristic → LLM fallback)
│   ├── planner.js               # Strategic planning: what to explore next
│   ├── coverage-tracker.js      # Feature/flow/screen coverage state
│   ├── dedup.js                 # Same flow vs new meaningful variation
│   └── context-builder.js       # Build minimal context for LLM calls
│
├── oracle/
│   ├── crash-detector.js        # logcat FATAL EXCEPTION after each action
│   ├── anr-detector.js          # dumpsys ANR check
│   ├── ux-heuristics.js         # Accessibility, tap targets, empty screens, overlap
│   ├── triage.js                # Decide which screens need LLM analysis
│   └── ai-oracle.js             # Gated LLM analysis on flagged screens only
│
├── output/
│   ├── report-builder.js        # Structured JSON report
│   ├── report-renderer.js       # HTML email template (extracted from index.cjs)
│   └── email-sender.js          # Resend integration
│
└── utils/
    ├── sleep.js
    ├── retry.js                 # Generic retry with backoff
    ├── xml-parser.js            # Shared XML utilities
    └── token-counter.js         # Estimate tokens before LLM calls
```

### 2.2 Data Flow

```
APK Upload
    │
    ▼
┌─────────────┐
│  Ingestion   │ → Parse manifest → Extract AppProfile
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Job Queue   │ → Persist to SQLite
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Emulator Pool│ → Restore from snapshot (< 15s), install APK, launch
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│                    CRAWL LOOP                         │
│                                                      │
│  ┌──────────┐    ┌────────────┐    ┌──────────────┐  │
│  │ Capture   │───▶│ Fingerprint │───▶│ Classify     │  │
│  │ Screen    │    │ Exact+Fuzzy│    │ Screen Type  │  │
│  └──────────┘    └────────────┘    └──────┬───────┘  │
│                                           │          │
│                                           ▼          │
│  ┌──────────┐    ┌────────────┐    ┌──────────────┐  │
│  │ Execute   │◀──│ Plan/Select│◀──│ Check        │  │
│  │ Action    │    │ Action     │    │ Coverage     │  │
│  └────┬─────┘    └────────────┘    └──────────────┘  │
│       │                                              │
│       ▼                                              │
│  ┌──────────┐    ┌────────────┐                      │
│  │ Oracle    │───▶│ Watchdog   │                      │
│  │ Checks    │    │ Recovery   │                      │
│  └──────────┘    └────────────┘                      │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Triage       │ ← decide which screens need AI
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ AI Oracle    │ ← vision analysis on flagged screens only
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Report + Email│ ← 1 synthesis LLM call
                    └──────────────┘
```

### 2.3 Deterministic vs LLM Boundary

| Component | Deterministic | LLM (gated) |
|-----------|:---:|:---:|
| Manifest parsing, APK profiling | ✅ | |
| Screen capture, XML dump | ✅ | |
| Structural + fuzzy fingerprinting | ✅ | |
| Action extraction from XML | ✅ | |
| System dialog dismissal | ✅ | |
| Form detection + credential filling | ✅ | |
| Coverage tracking, flow recording | ✅ | |
| Loop/stuck detection | ✅ | |
| Crash/ANR/accessibility checks | ✅ | |
| Emulator health monitoring | ✅ | |
| Screen classification (heuristic first) | ✅ | Fallback only |
| Action selection (ranked heuristic first) | ✅ | Tie-breaking only |
| **Initial exploration plan** | | ✅ (1 call/crawl) |
| **Re-planning at navigation hubs** | | ✅ (~3-5 calls/crawl) |
| **"New variation or same thing?"** | ✅ (structural similarity) | Fallback only |
| **Deep bug analysis on flagged screens** | | ✅ (max 5 screens) |
| **Final report synthesis** | | ✅ (1 call/crawl) |

**Principle: Deterministic first, LLM only when you genuinely need semantic judgment.** Your current system inverts this.

---

## 3. Core Agent Loop — Concrete Algorithm

```
FUNCTION runTestSession(appProfile, userConfig, maxBudget = 80):
    
    // ── PHASE 0: Initialize ──
    emulator = pool.acquire()                          // Snapshot restore, not cold boot
    install(emulator, appProfile.apkPath)
    launch(emulator, appProfile.launcherActivity)       // From manifest, not pm list
    wait(3000)
    
    session = createSession(appProfile)
    coverageTracker = new CoverageTracker()
    stateGraph = new StateGraph()
    crawlMemory = new CrawlMemory()                    // Rolling summary, not full history
    watchdog = new CrawlWatchdog(maxIdle=30s, maxTotal=600s)
    
    // ── PHASE 1: Initial Planning (1 LLM call) ──
    initialScreen = observer.capture(emulator)
    appCategory = classifyApp(initialScreen)            // Heuristic: social, ecommerce, utility...
    testPlan = planner.createInitialPlan(appProfile, userConfig, appCategory)
    // testPlan = { targets: ['auth', 'main_feed', 'content_creation', 'settings', 'search'],
    //             currentTarget: 'auth', breadthFirst: true }
    
    stepsUsed = 0
    stuckCounter = 0
    lastFingerprint = null
    
    // ── PHASE 2: Guided Crawl Loop ──
    WHILE stepsUsed < maxBudget 
      AND testPlan.hasUnexploredTargets() 
      AND watchdog.check().status == 'ok':
        
        // STEP A: Observe
        screen = observer.capture(emulator)
        IF screen.failed:
            recovery.handleCaptureFailed(emulator, session)
            CONTINUE
        watchdog.reportProgress()
        
        // STEP B: System interrupts (deterministic, zero cost)
        IF systemHandler.isSystemDialog(screen):
            systemHandler.dismiss(screen, emulator)
            CONTINUE
        
        // STEP C: Fingerprint (exact + fuzzy)
        exactFP = fingerprint.exact(screen)             // SHA-256 of structural XML
        fuzzyFP = fingerprint.fuzzy(screen)             // SHA-256 of class names + resource-ids + counts
        
        IF exactFP == lastFingerprint:
            stuckCounter++
        ELSE:
            stuckCounter = 0
        lastFingerprint = exactFP
        
        // STEP D: Stuck detection (deterministic)
        IF stuckCounter >= 3:
            // Check for loop pattern: A→B→C→A→B→C
            IF stateGraph.detectLoop(lastNFingerprints=6):
                testPlan.markCurrentFlowFailed('loop_detected')
                testPlan.advanceToNextTarget()
                executor.pressBack(emulator, times=3)
                stuckCounter = 0
                CONTINUE
            ELIF stuckCounter >= 5:
                executor.restartApp(emulator, appProfile)
                stuckCounter = 0
                CONTINUE
        
        // STEP E: Classify screen (cached → heuristic → LLM fallback)
        screenType = classifier.classify(screen)
        // Cache hit: ~70% of the time (free)
        // Heuristic match: ~20% of the time (free)
        // LLM fallback: ~10% of the time (~500 tokens)
        
        // STEP F: Register state + check coverage
        isNewScreen = NOT stateGraph.hasExact(exactFP)
        stateGraph.addState(exactFP, fuzzyFP, screen, screenType)
        
        featureCategory = categorizeFeature(screenType, screen.activity)
        coverageTracker.recordVisit(featureCategory, exactFP, screenType)
        
        // STEP G: Coverage-based skip (deterministic)
        IF coverageTracker.isSaturated(featureCategory) 
           AND NOT testPlan.isHighPriority(featureCategory):
            executor.pressBack(emulator)
            stepsUsed++
            CONTINUE
        
        // STEP H: Deduplication check for flows
        IF dedup.shouldSkipFlow(screen, featureCategory, coverageTracker):
            executor.pressBack(emulator)
            stepsUsed++
            CONTINUE
        
        // STEP I: Re-plan at navigation hubs (gated LLM call)
        IF screenType == 'navigation_hub' 
           AND stepsUsed > 0 
           AND stepsUsed % 15 == 0:
            testPlan = planner.replan(testPlan, coverageTracker.summary(), screen)
            // ~1,500 tokens, happens 3-5 times per crawl
        
        // STEP J: Form handling (deterministic)
        IF formHandler.isLoginForm(screen) AND session.hasCredentials():
            formHandler.fillAndSubmit(screen, emulator, session.credentials)
            stepsUsed++
            CONTINUE
        
        // STEP K: Select action (heuristic-first, LLM fallback)
        candidates = actionExtractor.extract(screen)
        candidates = candidates.filter(a => NOT stateGraph.actionTriedHere(exactFP, a.id))
        
        IF candidates.length == 0:
            executor.pressBack(emulator)
            stepsUsed++
            CONTINUE
        
        IF canDecideWithHeuristic(candidates, screenType, coverageTracker):
            action = heuristicDecide(candidates, screenType, coverageTracker, testPlan)
        ELSE:
            action = llmDecide(candidates, screen, crawlMemory, coverageTracker, testPlan)
            // ~400 tokens input + ~50 output. Happens ~25% of ambiguous steps.
        
        // STEP L: Execute
        preActionFP = exactFP
        executor.execute(action, emulator)
        stepsUsed++
        wait(1500)
        
        // STEP M: Validate (deterministic oracle checks — free bugs)
        postScreen = observer.capture(emulator)
        oracle.checkCrash(emulator, appProfile.packageName)    // logcat FATAL EXCEPTION
        oracle.checkANR(emulator, appProfile.packageName)      // dumpsys ANR
        oracle.checkEmpty(postScreen)                           // No interactable elements
        oracle.checkAccessibility(postScreen)                   // Missing contentDescription, small tap targets
        oracle.checkSlowResponse(preActionTimestamp)            // > 3s transition
        
        // STEP N: Record transition + memory
        stateGraph.recordTransition(preActionFP, action, fingerprint.exact(postScreen))
        crawlMemory.append(stepsUsed, screenType, action, featureCategory)
        coverageTracker.update(preActionFP, action, postScreen)
        
        // STEP O: Flow tracking
        session.currentFlow.addStep(action, postScreen)
        IF postScreen indicates flow completion (back to hub, success toast):
            flow = session.currentFlow.finalize()
            dedup.registerFlow(flow)
            coverageTracker.registerCompletedFlow(flow)
            session.startNewFlow()
        
        // STEP P: Watchdog
        IF watchdog.check().status != 'ok':
            recovery.handle(watchdog.check(), emulator, session)
        
        // STEP Q: Checkpoint (every 5 steps)
        IF stepsUsed % 5 == 0:
            checkpoint.save(stateGraph, coverageTracker, crawlMemory, testPlan)
    
    // ── PHASE 3: Targeted Analysis (gated LLM, max 5-8 screens) ──
    screensToAnalyze = oracle.triage(stateGraph, coverageTracker)
    // Only: unique screen types, screens with deterministic flags,
    //       screens on critical paths. Skip: duplicates, dialogs, saturated types.
    
    analyses = []
    FOR screen IN screensToAnalyze (max 8):
        // Send screenshot (vision) — catches visual bugs XML can't see
        analysis = aiOracle.deepCheck(screen, crawlMemory.contextFor(screen))
        analyses.push(analysis)
    
    // ── PHASE 4: Report (1 LLM call) ──
    report = reporter.build(coverageTracker, oracle.getAllFindings(), analyses, session.flows)
    
    // ── PHASE 5: Cleanup ──
    pool.release(emulator)
    
    RETURN report
```

### 3.1 The Planner — Heuristic Decision Logic

```
FUNCTION heuristicDecide(actions, screenType, coverage, testPlan):
    
    // Priority 1: Untested flows from the test plan
    FOR flow IN testPlan.targets:
        IF NOT coverage.isCovered(flow):
            match = actions.find(a => a.likelyLeadsTo(flow))
            IF match → RETURN match
    
    // Priority 2: Untried actions (prefer those leading to new screen types)
    unexplored = actions.filter(a => NOT stateGraph.hasTransition(currentFP, a))
    IF unexplored.length > 0:
        RETURN rankByNovelty(unexplored)[0]
    
    // Priority 3: Under-tested feature categories
    underTested = coverage.leastCoveredCategory()
    match = actions.find(a => a.likelyLeadsTo(underTested))
    IF match → RETURN match
    
    // Priority 4: Back out
    RETURN { type: "back" }


FUNCTION canDecideWithHeuristic(actions, screenType, coverage):
    IF screenType == "system_dialog" → RETURN true
    IF screenType == "login" AND hasCredentials → RETURN true
    IF actions.length <= 2 → RETURN true
    IF coverage.hasObviousGap() → RETURN true
    RETURN false  // Send to LLM
```

### 3.2 LLM Decision Call — Minimal Token Design

When the LLM is needed, send only compressed context (~350 tokens):

```
FUNCTION llmDecide(actions, screen, memory, coverage, testPlan):
    prompt = {
        screenSummary: {
            type: screen.classifiedType,
            activity: screen.activity,
            keyLabels: screen.interactableLabels.slice(0, 10)
        },                                             // ~100 tokens
        availableActions: actions.map(a => a.label),   // ~50 tokens
        recentHistory: memory.last(5),                 // ~100 tokens
        coverageSummary: coverage.summary(),           // ~50 tokens
        currentGoal: testPlan.currentTarget             // ~20 tokens
    }
    response = callClaude(prompt, { model: "haiku", maxTokens: 100 })
    // Output: { "pick": 2, "why": "settings tab is untested" } ~50 tokens
    RETURN actions[response.pick]
```

### 3.3 Token Budget — 80-Step Crawl

| Call Type | When | Count | Tokens Each | Total |
|-----------|------|-------|-------------|-------|
| Initial plan | Start | 1 | ~2,000 | 2,000 |
| Replan at hubs | Every ~15 steps at hubs | 3-5 | ~1,500 | 6,000 |
| Screen classification | Cache miss, ambiguous | 3-6 | ~500 | 2,500 |
| Action selection fallback | Ties on complex screens | 5-10 | ~450 | 4,000 |
| Triaged screen analysis | Post-crawl, flagged only | 5-8 | ~2,000 (vision) | 14,000 |
| Report synthesis | End | 1 | ~3,000 | 3,000 |
| **Total** | | **~18-31 calls** | | **~31,500 tokens** |

**vs. Current approach:** 20 screenshots × ~1,300 tokens + 1 report × ~6,000 = ~32,000 tokens for 20 steps of blind exploration. The new approach spends a similar budget on 80 steps of intelligent exploration — **4x more coverage per dollar.**

---

## 4. Coverage, Deduplication & Feature Taxonomy

### 4.1 Definitions

| Term | Definition | Example |
|------|-----------|---------|
| **Screen** | A single UI state identified by exact fingerprint | Instagram home feed at one moment |
| **Screen Type** | Semantic category for a screen. Multiple fingerprints → one type. | "feed," "login," "settings" |
| **Flow** | Ordered (screen, action) sequence accomplishing a coherent task | home → compose → type → post → home |
| **Feature Type** | Semantic category for what a flow tests | "content_creation," "search," "authentication" |
| **Meaningful Variation** | Two flows for same feature type that differ enough to trigger different code paths | image post vs video post vs story |
| **Already Covered** | A feature type with ≥1 successfully completed flow and ≥2 unique screen fingerprints | |
| **Saturated** | A feature type with ≥4 visits and no new fingerprints in last 3 visits | |

### 4.2 Dual Fingerprinting

```javascript
// EXACT fingerprint (your existing approach — keep it)
// Screens with identical XML structure
exactFingerprint = sha256(structuralXml)

// FUZZY fingerprint (new — for "similar screen" detection)  
// Screens with same element types/counts but different text/content
fuzzyFingerprint = sha256(
  sortedClassNames.join(',') + '|' + 
  sortedResourceIds.join(',') + '|' + 
  interactableCount + '|' + 
  scrollableCount + '|' +
  currentActivity
)
```

| Comparison | Exact FP | Fuzzy FP | Meaning |
|-----------|----------|----------|---------|
| Same screen | Match | Match | Identical state |
| Similar screen | Different | Match | Same structure, different content (e.g., two product pages) |
| Different screen | Different | Different | Genuinely different UI |

### 4.3 Flow Fingerprinting

```javascript
flowFingerprint = sha256(
  steps.map(s => s.screenType + ':' + s.actionType + ':' + s.actionTarget)
       .join(' → ')
)
// "feed:tap:compose_button → compose:type:text_field → compose:tap:post_button → feed"
```

### 4.4 Screen Classification — Heuristic First

```javascript
function classifyScreenHeuristic(screen) {
    const xml = screen.xml;
    const activity = screen.activity.toLowerCase();
    
    // Rule-based classification (zero tokens)
    if (hasPasswordField(xml) || activity.includes("login") || activity.includes("auth"))
        return { type: "login", confidence: 0.9 };
    
    if (hasRecyclerView(xml) && getListItemCount(xml) > 3)
        return { type: "feed", confidence: 0.8 };
    
    if (activity.includes("settings") || activity.includes("preference"))
        return { type: "settings", confidence: 0.9 };
    
    if (hasFilePickerOrCamera(xml))
        return { type: "media_upload", confidence: 0.7 };
    
    if (getEditTextCount(xml) >= 2)
        return { type: "form", confidence: 0.6 };
    
    if (isOverlayDialog(xml) || xml.includes('android:id/alertTitle'))
        return { type: "dialog", confidence: 0.9 };
    
    if (!hasRecyclerView(xml) && hasLargeImage(xml) && hasTextContent(xml))
        return { type: "detail_view", confidence: 0.6 };
    
    if (hasErrorIndicators(xml))
        return { type: "error", confidence: 0.7 };
    
    // Detect navigation hubs (tab bars, bottom nav, drawer)
    if (hasBottomNavigation(xml) || hasTabLayout(xml))
        return { type: "navigation_hub", confidence: 0.8 };
    
    return { type: "unknown", confidence: 0.0 };
    // → Only "unknown" triggers LLM fallback, and result is cached by fingerprint
}
```

### 4.5 Feature Categorization

```javascript
const SCREEN_TO_FEATURE = {
    "login": "auth_flow",        "signup": "auth_flow",
    "feed": "browsing",          "detail_view": "content_viewing",
    "settings": "settings",      "media_upload": "content_creation",
    "form": "data_entry",        "search": "search",
    "profile": "profile_management",
    "dialog": "interaction",     "error": "error_handling",
};

// Activity-name fallback for unmapped screen types
function inferFromActivity(activity) {
    const a = activity.toLowerCase();
    if (a.includes("search")) return "search";
    if (a.includes("profile")) return "profile_management";
    if (a.includes("chat") || a.includes("message")) return "messaging";
    if (a.includes("cart") || a.includes("checkout")) return "commerce";
    if (a.includes("camera") || a.includes("gallery")) return "content_creation";
    return "other";
}
```

### 4.6 Content Creation Sub-Type Detection

For your specific example about image post vs reel vs story:

```javascript
function extractCreationSubType(screen) {
    const labels = extractTextLabels(screen.xml).map(l => l.toLowerCase());
    
    if (labels.some(l => l.includes("reel") || l.includes("video"))) return "video_post";
    if (labels.some(l => l.includes("story") || l.includes("stories"))) return "story";
    if (labels.some(l => l.includes("carousel") || l.includes("multiple"))) return "carousel";
    if (labels.some(l => l.includes("text") || l.includes("status"))) return "text_post";
    if (labels.some(l => l.includes("photo") || l.includes("image"))) return "image_post";
    if (labels.some(l => l.includes("live"))) return "live";
    return "generic_post";
}

// Coverage tracker tracks sub-types separately:
// content_creation.image_post: covered
// content_creation.video_post: not_tested  ← explore this
// content_creation.story: not_tested       ← explore this
```

### 4.7 Deduplication — When to Skip vs Re-Enter

```javascript
class FlowDeduplicator {
    
    shouldSkipFlow(currentScreen, featureCategory, coverageTracker) {
        const existing = coverageTracker.categories[featureCategory];
        
        if (!existing) return false;                    // New category → always explore
        if (existing.status === "saturated") return true; // Well-tested → skip
        
        // Check structural similarity against seen screens in this category
        const similarity = this.maxSimilarity(currentScreen, existing.fingerprints);
        
        if (similarity > 0.85) return true;             // Near-duplicate → skip
        if (similarity < 0.5) return false;             // Very different → explore
        
        // Medium similarity: check for meaningful variation signals
        const diff = this.findMeaningfulDifferences(currentScreen, existing);
        if (diff.hasNewActionTypes || diff.hasNewMediaType || diff.hasNewInputFields)
            return false;                               // Meaningful variation → explore
        
        return true;                                    // Minor cosmetic difference → skip
    }
    
    findMeaningfulDifferences(screen, existingCategory) {
        const currentActions = extractActions(screen.xml);
        const newActions = currentActions.filter(a => !existingCategory.seenLabels.has(a.label));
        return {
            hasNewActionTypes: newActions.length > 2,
            hasNewMediaType: screen.xml.includes("video") !== existingCategory.hasVideo,
            hasNewInputFields: getEditTextCount(screen.xml) !== existingCategory.avgInputCount,
        };
    }
}
```

### 4.8 The Coverage Graph

The single most important data structure in the system:

```
Nodes: Screen types (one node per type, not per fingerprint instance)
Edges: Actions that transition between screen types

Node annotations:
  - coverageRatio = actionsTried / actionsAvailable
  - visitCount
  - bugsFoundHere
  - status: exploring | covered | saturated

Edge annotations:
  - featureType this transition belongs to
  - traversalCount
  - success/failure record
```

This graph answers: "The app has 15 distinct screen types. We have deep coverage on 8, shallow on 4, and haven't reached 3."

---

## 5. Reusable Policies — Avoiding LLM for Obvious Decisions

```javascript
const SCREEN_POLICIES = {
    'login':             { policy: 'fill_and_submit',              priority: 'high',      maxAttempts: 3 },
    'feed':              { policy: 'scroll_and_sample',            priority: 'medium',    maxItems: 5 },
    'settings':          { policy: 'toggle_each',                  priority: 'low',       maxToggles: 10 },
    'dialog':            { policy: 'accept_or_dismiss',            priority: 'immediate' },
    'system_dialog':     { policy: 'dismiss',                      priority: 'immediate' },
    'detail_view':       { policy: 'interact_all_visible_buttons', priority: 'medium' },
    'search':            { policy: 'type_query_and_browse',        priority: 'medium' },
    'navigation_hub':    { policy: 'visit_each_tab',               priority: 'high' },
    'media_upload':      { policy: 'attach_and_submit',            priority: 'medium' },
    'form':              { policy: 'fill_all_fields_and_submit',   priority: 'medium' },
    'error':             { policy: 'log_bug_and_back',             priority: 'high' },
};
```

This table alone eliminates the majority of LLM calls. You do not need a language model to decide "tap the login button on a login screen" or "dismiss a system dialog."

---

## 6. Stability & Recovery

### 6.1 Failure Taxonomy

```
├── EMULATOR_FAILURES
│   ├── BOOT_FAILURE
│   │   Detection: Snapshot restore timeout > 30s (or cold boot > 120s)
│   │   Recovery: Kill → retry with reduced features → skip job if 2nd failure
│   │
│   ├── FREEZE
│   │   Detection: `adb shell getprop` times out 3 consecutive times
│   │   Recovery: `adb reboot` → resume from checkpoint
│   │   Fallback: Kill emulator → restore snapshot → restart from checkpoint
│   │
│   └── ADB_DISCONNECT
│       Detection: `adb devices` shows "offline" or empty
│       Recovery: `adb kill-server && adb start-server` → reconnect
│       Fallback: Full emulator restart
│
├── APP_FAILURES (these are REAL BUGS — capture them!)
│   ├── CRASH
│   │   Detection: `adb shell pidof <pkg>` empty OR logcat "FATAL EXCEPTION"
│   │   Recovery: Log finding (severity=HIGH) → relaunch → continue crawl
│   │
│   ├── ANR
│   │   Detection: `dumpsys activity | grep "ANR in"` OR ANR dialog in XML
│   │   Recovery: Log finding (severity=HIGH) → dismiss → force-stop → relaunch
│   │
│   ├── HANG (process alive, UI frozen)
│   │   Detection: 3 consecutive identical fingerprints + process alive
│   │   Recovery: force-stop → relaunch → navigate to last hub
│   │
│   └── UNEXPECTED_ACTIVITY (wrong app in foreground)
│       Detection: Current activity package ≠ target package
│       Recovery: `am start -n <pkg>/<launcher>` → resume
│
├── CRAWLER_FAILURES
│   ├── STUCK_IN_LOOP (A→B→C→A→B→C)
│   │   Detection: Fingerprint pattern repeats in last 6 entries
│   │   Recovery: Back ×3 → mark flow failed → advance plan
│   │
│   ├── NO_PROGRESS (only visiting covered screens)
│   │   Detection: Last 5 states all have coverageRatio > 0.8
│   │   Recovery: Replan via LLM → try alternative path → end target if still stuck
│   │
│   ├── ACTION_FAILED (tap produced no state change)
│   │   Detection: Pre/post fingerprint identical
│   │   Recovery: Mark action "ineffective" → try next candidate
│   │
│   └── CAPTURE_FAILED
│       Detection: uiautomator dump returns error/empty
│       Recovery: Wait 2s → retry ×3 → escalate to EMULATOR_FREEZE
```

### 6.2 Watchdog Implementation

```javascript
class EmulatorWatchdog {
    constructor(packageName, options = {}) {
        this.packageName = packageName;
        this.freezeThresholdMs = options.freezeThreshold || 15000;
        this.maxConsecutiveFailures = options.maxFailures || 3;
        this.consecutiveFailures = 0;
        this.lastScreenHash = null;
        this.lastScreenTime = Date.now();
    }
    
    async checkHealth() {
        const checks = {};
        
        // 1. ADB connection
        try {
            const devices = execSync("adb devices", { timeout: 5000 }).toString();
            checks.adbConnected = devices.includes("emulator-") && !devices.includes("offline");
            if (!checks.adbConnected) return { healthy: false, action: "restart_adb" };
        } catch (e) { return { healthy: false, action: "restart_adb" }; }
        
        // 2. Emulator responsive
        try {
            execSync("adb shell echo ok", { timeout: 5000 });
        } catch (e) { return { healthy: false, action: "restart_emulator" }; }
        
        // 3. App running
        try {
            const top = execSync("adb shell dumpsys activity top").toString();
            if (!top.includes(this.packageName))
                return { healthy: false, action: "restart_app" };
        } catch (e) { return { healthy: false, action: "restart_app" }; }
        
        // 4. ANR
        try {
            const anr = execSync("adb shell dumpsys activity processes | grep ANR").toString();
            if (anr.trim().length > 0)
                return { healthy: false, action: "dismiss_anr_restart_app" };
        } catch (e) {}
        
        // 5. Screen frozen
        try {
            const screencap = execSync("adb shell screencap -p", { maxBuffer: 10*1024*1024 });
            const hash = simpleHash(screencap);
            if (hash === this.lastScreenHash) {
                if (Date.now() - this.lastScreenTime > this.freezeThresholdMs)
                    return { healthy: false, action: "tap_to_unfreeze" };
            } else {
                this.lastScreenHash = hash;
                this.lastScreenTime = Date.now();
            }
        } catch (e) {}
        
        this.consecutiveFailures = 0;
        return { healthy: true };
    }
    
    async recover(action) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures)
            return await this.fullRestart();
        
        switch (action) {
            case "restart_adb":
                execSync("adb kill-server && adb start-server", { timeout: 10000 });
                await sleep(2000); break;
            case "restart_app":
                execSync(`adb shell am force-stop ${this.packageName}`, { timeout: 5000 });
                await sleep(1000);
                execSync(`adb shell monkey -p ${this.packageName} -c android.intent.category.LAUNCHER 1`);
                await sleep(3000); break;
            case "dismiss_anr_restart_app":
                execSync("adb shell input keyevent KEYCODE_ENTER", { timeout: 3000 });
                await sleep(1000);
                await this.recover("restart_app"); break;
            case "tap_to_unfreeze":
                execSync("adb shell input tap 540 960", { timeout: 3000 });
                await sleep(2000); break;
            case "restart_emulator":
                return await this.fullRestart();
        }
    }
}
```

### 6.3 Checkpoint System

```javascript
class CrawlCheckpoint {
    save(state) {
        const data = {
            step: state.step,
            stateGraph: state.stateGraph.serialize(),
            coverageTracker: state.coverageTracker.serialize(),
            crawlMemory: state.crawlMemory.serialize(),
            testPlan: state.testPlan.serialize(),
            timestamp: Date.now()
        };
        db.run('INSERT INTO checkpoints (session_id, step, data) VALUES (?, ?, ?)',
            [state.sessionId, state.step, JSON.stringify(data)]);
    }
    
    restore(sessionId) {
        const row = db.get(
            'SELECT data FROM checkpoints WHERE session_id = ? ORDER BY step DESC LIMIT 1',
            [sessionId]);
        return row ? JSON.parse(row.data) : null;
    }
}
```

### 6.4 Emulator Resource Requirements

| Resource | Minimum | Why |
|----------|---------|-----|
| RAM | 4GB emulator + 2GB host = 6-8GB total | Apps crash in 2GB when loading images/video |
| CPU | 4 vCPUs | Emulator + ADB + Node.js + app. 2 vCPUs = I/O contention |
| Disk | SSD, 40GB+ | Snapshots + APKs + screenshots |
| KVM | **Must be enabled** | Without KVM = 10-50x slower = "app stops responding" |

---

## 7. What to Delete

| Item | Action | Reason |
|------|--------|--------|
| All `index.cjs.before_*` (13+ files) | DELETE | Use git branches |
| `vm-backups-2026-03-12/` | DELETE from repo | VM state ≠ source code |
| `vm-backups-phase-shift/` | DELETE from repo | Same |
| `index.cjs.bad_overwrite_backup` | DELETE | Artifact |
| `index.js` (if duplicate entry point) | DELETE or consolidate | One entry point only |
| `legacyCrawl()` function | DELETE | Throws unconditionally — dead code |
| `prodscope-backend/` inside frontend repo | DELETE | Backend has its own repo |
| Hard-coded VM IP in `dev-server.mjs` | Replace with env var | Don't hardcode IPs |
| `execSync("sudo chmod 666 /dev/kvm")` per job | Move to system setup | Security concern, runs needlessly |
| `const jobs = {}` | Replace with SQLite | In-memory = zero persistence |
| Per-screenshot LLM loop in `analyzeScreenshots()` | Replace with triage + gated oracle | Biggest token waste |
| Inline email HTML (~150 lines in index.cjs) | Extract to template file | Separation of concerns |
| `processJob()` monolith (150 lines) | Split into runner + emulator + oracle + reporter | One function doing everything |

### App-Specific Code to Generalize

| Current Pattern | Replace With |
|----------------|-------------|
| Google sign-in dialog handler (specific) | Generic dialog classifier: detect ANY dialog → classify → dismiss |
| Form credential filling (assumes field layout) | Generic form detector: find EditText → classify by hint/inputType → fill |
| `pm list packages -3` then grab last | Parse manifest at ingestion → know exact package + launcher activity |

---

## 8. Output Schema

```javascript
{
  // Metadata
  jobId: String,
  appPackage: String,
  appName: String,
  crawlDuration: Number,                        // seconds
  totalSteps: Number,
  tokensUsed: Number,
  
  // Coverage
  coverage: {
    screenTypesDiscovered: Number,
    screenTypesCovered: Number,                  // >50% action coverage
    screenTypesDeep: Number,                     // >80% action coverage
    totalFlowsCompleted: Number,
    tested: [{
      category: String,                          // "content_creation"
      variants: [String],                        // ["image_post", "text_post"]
      screenCount: Number,
      confidence: 'high' | 'medium' | 'low'
    }],
    skipped: [{
      category: String,
      reason: String                             // "duplicate_of:flow_xyz" | "saturated" | "deprioritized"
    }],
    unreachable: [{
      category: String,
      reason: String                             // "requires_auth" | "requires_data" | "budget_exhausted"
    }],
    estimatedCoverage: 'low' | 'medium' | 'high',
    coverageGraph: {                             // For visualization
      nodes: [{ type, coverageRatio, visitCount, bugsFound }],
      edges: [{ from, to, action, traversals }]
    }
  },
  
  // Findings
  findings: [{
    id: String,
    type: 'crash' | 'anr' | 'ux_issue' | 'accessibility' | 'performance' | 'visual' | 'functional',
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info',
    confidence: Number,                          // 1.0 for deterministic, 0.6-0.9 for AI
    title: String,
    description: String,
    screenType: String,
    screenshotPath: String,
    reproductionSteps: [String],                 // Human-readable from flow
    detectedBy: 'oracle_crash' | 'oracle_anr' | 'oracle_accessibility' | 'oracle_ux' | 'ai_analysis',
    evidence: { logcat, xmlSnippet, timing }
  }],
  
  // Flows
  flows: [{
    id: String,
    featureType: String,
    subType: String,                             // "video_post" within "content_creation"
    steps: [{ screenType, action, result }],
    outcome: 'completed' | 'failed' | 'abandoned' | 'loop_detected',
    bugsFound: [findingId]
  }],
  
  // Deduplication Log
  deduplicationLog: [{
    skippedAction: String,
    reason: String,
    similarTo: String
  }],
  
  // AI Summary (from 1 synthesis LLM call)
  overallScore: Number,                          // 0-100
  executiveSummary: String,
  recommendedNextSteps: [String],                // What a human tester should check
  
  // Crawl Health
  crawlHealth: {
    emulatorRestarts: Number,
    appRestarts: Number,
    stuckRecoveries: Number,
    captureFailures: Number,
    stopReason: 'budget_exhausted' | 'full_coverage' | 'no_progress' | 'emulator_failure'
  }
}
```

---

## 9. LLM Prompt Templates

### A. Initial Plan (~2,000 tokens)

```
You are a QA test planner. Given an Android app profile, produce a test plan.

App: {packageName}
Category: {appCategory}
Declared activities: {activityList}
Permissions: {permissionList}
User goals: {userGoals}
User pain points: {userPainPoints}

Return JSON: { "targets": ["auth", "main_feed", ...], "priority": "breadth_first" | "depth_first", "notes": "..." }
```

### B. Decision Prompt (~350 tokens input, ~50 output)

```
You are a QA tester exploring an Android app. Pick the best next action.

Screen: {screenType} ({activity})
Elements: {keyLabels}
Recent: {last5actions}
Tested: {coverageSummary}
Goal: {currentPriority}

Actions:
0: {action0label}
1: {action1label}
...

Reply JSON only: {"pick":0,"why":"short reason"}
```

### C. Screen Analysis (~800 tokens input, vision)

```
Analyze this Android app screen for QA issues. The app is a {appCategory}.

Screen type: {screenType}
Activity: {activity}
Context: Reached by: {pathToScreen}

[screenshot image]

Return JSON: {
  "bugs": [{"desc":"...","severity":"critical|high|medium|low","confidence":0.0-1.0}],
  "ux_issues": [{"desc":"...","severity":"..."}],
  "suggestions": [{"desc":"...","effort":"low|medium|high"}],
  "accessibility": [{"desc":"..."}]
}
```

### D. Report Synthesis (~3,000 tokens input)

```
You are a senior QA engineer writing a test report.

App: {packageName}
Crawl: {stepsExecuted} steps, {uniqueScreens} unique screens, stopped: {stopReason}

Coverage: {coverageSummary}
Per-screen findings: {aggregatedFindings}
User goals: {userGoals}
User pain points: {userPainPoints}

Generate JSON: { "overall_score": 0-100, "summary": "...", "critical_bugs": [], "ux_issues": [], "suggestions": [], "coverage_assessment": "...", "recommended_next_steps": [] }
```

---

## 10. Implementation Roadmap

### Week 1: Foundation — Stop the Bleeding

**Goal:** Same features, reliable infrastructure.

- [ ] Delete all backup files, VM backups from repo. Proper git branches.
- [ ] Split `index.cjs` → `server.js`, `jobs/runner.js`, `emulator/manager.js`, `output/email-renderer.js`, `output/email-sender.js`
- [ ] Add SQLite: persist jobs, crawl sessions. Remove `const jobs = {}`.
- [ ] Add emulator snapshots: boot once → `adb emu avd snapshot save` → restore per job. Target: <15s job start.
- [ ] Add crash/ANR detection in crawl loop (logcat + dumpsys after each step). Free bug detection.
- [ ] Verify: identical behavior, 10x faster job start, persistent state.

### Week 2: Screen Intelligence + Coverage

**Goal:** Crawler understands what it sees and what it has covered.

- [ ] Build `brain/screen-classifier.js` — heuristic rules (Section 4.4), cache results by fingerprint.
- [ ] Build `brain/coverage-tracker.js` — feature categories, visit counts, saturation detection (Section 4.1).
- [ ] Build fuzzy fingerprinting alongside exact fingerprinting.
- [ ] Add coverage-gated skip: if screen type is saturated, back out.
- [ ] Implement flow recording and flow fingerprinting.
- [ ] Raise `maxSteps` from 20 to 60-80. With dedup, more steps = more value.
- [ ] Verify: crawler classifies screens and tracks coverage with zero LLM calls during crawling.

### Week 3: Watchdog + Intelligent Planning

**Goal:** Emulator reliability + strategic exploration.

- [ ] Build `emulator/watchdog.js` — full implementation from Section 6.2.
- [ ] Integrate watchdog into crawl loop (every step).
- [ ] Add ADB timeout wrappers to all ADB calls (5s default).
- [ ] Add checkpoint system (Section 6.3) — save every 5 steps.
- [ ] Build manifest parser: extract activities + permissions from APK at ingestion.
- [ ] Build initial planner: 1 LLM call → exploration plan from manifest + goals.
- [ ] Wire plan into action ranker: boost actions matching current plan target.
- [ ] Verify: jobs survive emulator hiccups; crawl has strategic direction.

### Week 4: Token Optimization + Report Quality

**Goal:** Cut LLM cost 60%+, improve output.

- [ ] Build `oracle/triage.js` — filter screens before AI analysis (Section 4 of data flow).
- [ ] Replace per-screenshot LLM with gated oracle: deterministic checks during crawl, vision on flagged screens only.
- [ ] Build `brain/context-builder.js` — compressed prompts (~350 tokens per decision call).
- [ ] Add LLM-fallback in planner for genuinely ambiguous situations only.
- [ ] Build structured JSON report (Section 8 schema) + 1 synthesis LLM call.
- [ ] Add token usage tracking/logging per job.
- [ ] Verify: same or better report quality, ~60% fewer tokens.

### Week 5: Generalization + Dedup

**Goal:** System works on any APK.

- [ ] Generalize `system-handlers.js` — detect ANY dialog by XML pattern, not just Google sign-in.
- [ ] Generalize `form-handler.js` — detect forms by structure/inputType, not specific field names.
- [ ] Build `brain/dedup.js` — structural similarity + meaningful variation detection (Section 4.7).
- [ ] Add content creation sub-type detection (Section 4.6).
- [ ] Remove all hardcoded app-specific patches.
- [ ] Test with 5+ diverse apps (social, ecommerce, utility, banking, content).
- [ ] Verify: system produces useful reports on apps it has never seen.

### Week 6: Polish + Multi-Job

**Goal:** Production-ready MVP.

- [ ] Job queue (BullMQ or simple file-based) — decouple HTTP from processing.
- [ ] Professional HTML report rendering from JSON schema.
- [ ] Re-plan gate at navigation hubs (LLM call every ~15 steps).
- [ ] End-to-end testing: upload APK → get email with structured QA report.
- [ ] Deploy and validate on 5+ diverse apps as final acceptance.

### What to Postpone

- Parallel emulators (get single-emulator perfect first)
- Vision-guided exploration during crawl (XML gets 80% of the way)
- Network traffic capture
- Persistent resume across server restarts
- Custom ML screen classifier (rules + LLM fallback is fine until 500+ screens in DB)
- Frontend (engine first)

### Highest-Leverage Moves — Next 2 Weeks

Ranked by impact per hour of work:

1. **Emulator snapshots** (~2h → 10x faster job start)
2. **SQLite persistence** (~3h → survivable restarts, cross-run learning foundation)
3. **Crash/ANR detection in loop** (~1h → free bug detection you're currently missing)
4. **Split index.cjs into modules** (~3h → enables everything else)
5. **Screen classifier (heuristic)** (~3h → crawler understands what it sees)
6. **Coverage tracker with skip logic** (~4h → doubles effective exploration depth)
7. **Replace per-screenshot AI with gated oracle** (~4h → 60% token cost reduction)
8. **Manifest parser + initial planner** (~3h → strategic exploration from step 1)

---

## Key Tradeoff Decisions

### Haiku vs Sonnet

**Use Haiku** for all in-crawl decisions — 10x cheaper, fast enough for action selection. Use **Sonnet** only for final report synthesis where nuance matters.

### Screenshot vs XML for LLM

**XML (structured) for decisions during crawl** — cheaper, faster, sufficient. **Screenshots (vision) for post-crawl analysis** — catches visual bugs XML can't see. This hybrid gives you both without sending screenshots at every step.

### Breadth vs Depth

**Default to breadth-first with guided depth.** Quick survey of main navigation first, then focused deep-dives per feature, then move on when coverage reaches "covered" threshold. This mimics how a human tester works.

### Stop Conditions

Stop when ANY is true: `maxBudget` reached, all plan targets covered/saturated, 5 consecutive no-new-fingerprint steps at top level, emulator crashed 3+ times, or token budget exhausted.

---

## Database Schema (SQLite MVP)

```sql
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,         -- queued|processing|complete|degraded|failed
    app_package TEXT,
    config JSON,                  -- credentials, goals, pain points
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE crawl_sessions (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES jobs(id),
    started_at DATETIME,
    ended_at DATETIME,
    stats JSON,                   -- totalSteps, uniqueScreens, tokensUsed
    stop_reason TEXT
);

CREATE TABLE screen_cache (
    fingerprint TEXT PRIMARY KEY,
    fuzzy_fingerprint TEXT,
    screen_type TEXT,
    element_count INTEGER,
    classified_by TEXT,           -- 'heuristic' | 'llm'
    app_package TEXT              -- for per-app cache scope
);

CREATE TABLE coverage (
    session_id TEXT REFERENCES crawl_sessions(id),
    feature_category TEXT,
    screen_type TEXT,
    fingerprint TEXT,
    visit_count INTEGER DEFAULT 1,
    actions_available INTEGER,
    actions_tried INTEGER,
    status TEXT DEFAULT 'exploring' -- exploring|covered|saturated
);

CREATE TABLE flows (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES crawl_sessions(id),
    feature_type TEXT,
    sub_type TEXT,
    fingerprint TEXT,              -- flow fingerprint for dedup
    steps JSON,
    outcome TEXT,                  -- completed|failed|abandoned|loop
    bug_found BOOLEAN DEFAULT FALSE
);

CREATE TABLE findings (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES crawl_sessions(id),
    type TEXT,                     -- crash|anr|ux_issue|accessibility|...
    severity TEXT,
    confidence REAL,
    title TEXT,
    description TEXT,
    screen_fingerprint TEXT,
    screenshot_path TEXT,
    detected_by TEXT,
    evidence JSON,
    reproduction_steps JSON
);

CREATE TABLE checkpoints (
    session_id TEXT,
    step INTEGER,
    data JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_screen_cache_pkg ON screen_cache(app_package);
CREATE INDEX idx_coverage_session ON coverage(session_id);
CREATE INDEX idx_flows_session ON flows(session_id);
CREATE INDEX idx_findings_session ON findings(session_id);
```
