# AGENTS.md — Chrome AI Web Crawler

## Quick Start
```bash
npm install
npm run build        # outputs to dist/
# Load dist/ as unpacked extension in Chrome (chrome://extensions)
```

No `dev` script for HMR — this is a Chrome extension, not a web app. Reload extension after each build.

## Architecture (Non-Obvious)
```
src/
├── background/index.ts    # Service Worker (Manifest V3) — message router
├── content/index.ts       # Injected into pages — DOM ops, scraping loop
├── sidepanel/            # Vue 3 app — user interface (side panel)
├── shared/
│   ├── messages.ts       # MessageType enum + routing helpers
│   └── types.ts         # All types, storage keys, constants
└── db/index.ts           # IndexedDB wrapper (scraped data)
```

**Message flow:** Content Script ↔ Background Service Worker ↔ Side Panel  
Background acts as router — all cross-script communication goes through it.

## Key Tech Decisions
- **Manifest V3** with `@crxjs/vite-plugin` — handles bundling, manifest generation
- **Service Worker** (not background page) — no DOM access, CORS-free fetch for AI API
- **Vue 3 + Tailwind CSS** — side panel UI only
- **`@/` alias** maps to `src/` (configured in vite.config.ts + tsconfig.json)
- **TypeScript strict mode** — noEmit (type checking only, Vite handles transpilation)

## Build & Dev Commands
```bash
npm run build    # Production build → dist/
npm run dev      # Vite dev (limited use — extension needs Chrome reload)
```

No test suite configured. No linter/formatter beyond TypeScript compiler.

## Chrome Extension Specifics
- Load extension from `dist/` folder (not root)
- Content script matches `<all_urls>` — runs on every page
- Side panel opens via action click (configured in `background/index.ts` line 367)
- **Manifest in dist/ differs from source** — crxjs adds loader wrappers and web accessible resources
- Content script uses Shadow DOM for highlight overlay isolation

## Storage Architecture
- **`chrome.storage.local`** — AI config, task state, templates (keys in `src/shared/types.ts` → `STORAGE_KEYS`)
- **IndexedDB** (`CrawlerDB`) — scraped data (large datasets)
- Task state persists across browser restarts — background resets running tasks to `paused` on startup

## Gotchas
- **HTML size capped at 30KB** (`PREPROCESSOR_CONFIG.MAX_HTML_SIZE` in types.ts) — AI analysis truncates
- **AI JSON mode fallback** — if API rejects `response_format`, background retries without it (see `callAiApi` in background/index.ts)
- **Content script reloads on URL navigation** — URL-based pagination triggers full re-injection
- **No `@types/chrome` at runtime** — dev dependency only, types imported for TS checking
- **Tailwind content path** — `./src/**/*.{html,ts,vue}` (must include all extensions)

## Extension Permissions (Why Each Exists)
- `storage` — save AI config, task state, templates
- `activeTab` — access current tab for scraping
- `sidePanel` — Chrome side panel API
- `scripting` — inject content scripts dynamically
- `downloads` — export CSV files
- `notifications` — alert on errors (captcha, pagination lost)
- `alarms` — scheduled task support (future)
- `host_permissions: <all_urls>` — scrape any site
