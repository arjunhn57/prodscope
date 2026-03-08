# ProdScope

**Automated Android App Analysis** — Upload an APK, get a full AI-powered UX audit with bugs, issues, and actionable suggestions emailed to you.

## Architecture

```
prodscope/
├── index.html                    # Marketing landing page
├── app.html                      # Analysis SPA (mock mode + live mode)
├── dev-server.mjs                # Local dev server — serves static files + proxies API to backend VM
├── package.json                  # Root package: dev-server deps + scripts
├── vercel.json                   # Vercel deployment config
│
├── api/                          # Vercel serverless functions (Edge deployment)
│   ├── start-job.js              #   Proxy multipart APK upload → backend
│   ├── job-status.js             #   Proxy job polling → backend
│   ├── start-analysis.js         #   Trigger analysis via GCS file key
│   ├── upload-url.js             #   Generate signed GCS upload URL
│   └── analyze.js                #   Direct Claude API proxy
│
└── prodscope-backend/            # Express backend (runs on GCE VM)
    ├── index.js                  #   Orchestrator: emulator → crawl → analyze → report → email
    ├── package.json              #   Backend deps + test script
    ├── CRAWLER_V1.md             #   Crawler engine architecture doc
    └── crawler/                  #   Modular crawler engine (v1)
        ├── adb.js                #     ADB command wrapper
        ├── screen.js             #     Screenshot + XML + activity capture
        ├── fingerprint.js        #     Deterministic screen hashing
        ├── actions.js            #     Action extraction + ranking
        ├── policy.js             #     Crawl policy / action selection
        ├── forms.js              #     Form detection + credential filling
        ├── graph.js              #     Visited-state graph + loop detection
        ├── system-handlers.js    #     Permission/crash dialog handling
        ├── run.js                #     Main crawl loop orchestrator
        └── __tests__/            #     Unit tests (31 total)
            ├── fingerprint.test.js
            ├── actions.test.js
            └── graph.test.js
```

## Frontend Modes

### Mock Mode (default)
`app.html` runs entirely client-side with simulated API responses. No backend needed.
- Open `http://localhost:3000` or just open `app.html` directly
- Upload any `.apk` → simulated 22-second analysis flow
- Toggle off: `http://localhost:3000/?mock=false`

### Live Mode
Connects to the GCE backend VM (`34.10.240.173:8080`) via the local dev server proxy.
```bash
# Start the dev server
npm start

# Open with live mode
# http://localhost:3000/?mock=false
```

## Running Locally

### Frontend (dev server)
```bash
cd prodscope
npm install
npm start
# → http://localhost:3000
```

### Backend (on GCE VM)
```bash
cd prodscope-backend
npm install
# Set env vars (see prodscope-backend/.env.example)
node index.js
# → http://0.0.0.0:8080
```

### Backend Tests
```bash
cd prodscope-backend
npm test
```

## Key Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/start-job` | POST | Upload APK + metadata, starts analysis job |
| `/api/job-status/:jobId` | GET | Poll job progress (steps 1-6) |
| `/health` | GET | Backend health check |

## Environment Variables

### Backend (`prodscope-backend/.env`)
| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key for screen analysis + report generation |
| `RESEND_API_KEY` | ✅ | Resend API key for emailing reports |
| `PORT` | | Backend port (default: `8080`) |
| `USE_CRAWLER_V1` | | `true` (default) for new crawler, `false` for legacy random-tap |

### Frontend / Vercel (`api/.env`)
| Variable | Required | Description |
|---|---|---|
| `CLOUD_RUN_URL` | ✅ | Backend URL (e.g. `http://34.10.240.173:8080`) |
| `GCS_SERVICE_ACCOUNT_KEY` | | Base64-encoded GCS service account JSON |
| `ANTHROPIC_API_KEY` | | For direct `/api/analyze` proxy |

### Dev Server
| Variable | Description |
|---|---|
| `BACKEND_BASE` | Override backend URL (default: `http://34.10.240.173:8080`) |
| `PORT` | Dev server port (default: `3000`) |

## Current Limitations

- Backend requires a Linux VM with Android emulator + KVM support
- One job at a time (single emulator)
- No persistent job storage (in-memory `jobs` map)
- Report delivered only via email (no in-app viewing yet)
- Crawler v1 doesn't use vision for action decisions (structural XML only)

## Roadmap

- **Crawler v2**: Vision-guided exploration using Claude to pick next actions from screenshots
- **Deep form flows**: Multi-step registration, CAPTCHA handling
- **Parallel crawl**: Multiple emulators for faster coverage
- **In-app reports**: View reports directly in the dashboard
- **Persistent jobs**: Database-backed job tracking
- **CI/CD integration**: API endpoint for automated regression testing
