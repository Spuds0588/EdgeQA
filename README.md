# EdgeQA

**🔗 Live site:** [https://spuds0588.github.io/EdgeQA/](https://spuds0588.github.io/EdgeQA/)

**▶ Try the live demo** (no repo or token needed): [open a QA session for the example project](https://spuds0588.github.io/EdgeQA/#demo) — it previews the public [`examples/northstar/`](examples/northstar/) site straight from this repo's files via the VFS. The example is a fake **project-management + chat workspace** (kanban board, team chat) with a **built-in bug** for you to find — "New task" fails with a server 500, and "Invite teammate" silently does nothing — so you can experience the whole report flow, including a **simulated issue filing** (nothing is actually created on GitHub). Share it read-only with [`#demo&readonly=1`](https://spuds0588.github.io/EdgeQA/#demo&readonly=1) to hide the EdgeQA chrome.

[![Deploy to GitHub Pages](https://github.com/Spuds0588/EdgeQA/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Spuds0588/EdgeQA/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Frontend-only, privacy-focused QA environments for **private GitHub repositories**. Turn any repo into a secure, shareable preview — no deploys, no servers, no code leaving the browser.

- **Zero backend.** Runs entirely on GitHub Pages. No infrastructure, no database, no cost.
- **Private by design.** Your fine-grained token stays in browser memory and never touches a server.
- **PIN-protected magic links.** Share a QA-ready environment with a tester — the repo token is AES-GCM encrypted in the URL and unlocked only with the PIN you share separately.
- **Works on desktop and mobile.** Testers can run QA and file bugs from a phone.

---

## Why EdgeQA?

Staging environments are a pain. Deploying every branch to a preview host is slow, costs money, and — for private work — means trusting someone else with your code. EdgeQA removes the middleman: a Service Worker turns GitHub's API into a **Virtual File System (VFS)** so the browser itself serves your repository at a virtual `/sandbox/{owner}/{repo}/{branch}` URL. Share a link, the tester enters the PIN, and they're testing your real app with the real repo — nothing was ever uploaded anywhere.

## Features

| Feature | What it does |
| --- | --- |
| **Bring-your-own-key auth** | Paste a fine-grained PAT scoped to the repo you want to preview. The token lives in memory only (never `localStorage`, never a server). |
| **Web Crypto magic links** | The token is AES-GCM encrypted with a PIN-derived key (PBKDF2, 100k iterations) and embedded in the URL hash. |
| **Virtual File System (VFS)** | A Service Worker intercepts sandbox requests, fetches files from the GitHub API, and serves them with correct MIME types. |
| **Read-through cache** | HTML pages are always refetched (pushes show up on the tester's next reload); static assets are cached for 5 minutes to spare API rate limits, with a cached fallback if GitHub is unreachable or rate-limited. |
| **Large-asset fallback** | Handles GitHub's 1MB contents-API limit via the Git Database API (up to 100MB), and synthesizes safe placeholders for anything larger. |
| **SPA fallback** | Virtual 404s fall back to `index.html`, so client-side routers work. |
| **In-context bug reporting** | A report drawer (side panel on desktop, bottom sheet on mobile) collects title + description and shows exactly what will be auto-attached (repo, branch, page, screensize, device/browser, time) before you click submit. You can also opt to **include the session's console log** (last lines, default on) — then it opens a real GitHub issue via the session token. |
| **Tryable demo** | The tokenless live demo ([`/#demo`](https://spuds0588.github.io/EdgeQA/#demo)) previews a public example repo — a fake project-management + chat workspace with a built-in bug to find — and simulates the whole QA loop, including a fake issue submission, so visitors can experience the product before bringing their own repo. |
| **In-browser build tier (experimental)** | Source repos — not just built sites — preview too. React, Preact, JSX/TSX (via `@babel/standalone`), Vue `.vue` SFCs, and Svelte `.svelte` (via esm.sh compiler SDKs) are transpiled/compiled in your browser. Framework is **auto-detected** from repo signals (package.json deps, `vite.config`, tsconfig, file extensions) with a manual override in the setup form. |
| **Real dependency resolution** | Every bare npm import a real app makes is rewritten to **esm.sh pinned to the repo's package.json versions** (subpaths and transitive framework peers included), so heavy real-world dependency graphs — `@tanstack/react-query`, `react-day-picker`, `pinia`, `d3-scale`, … — resolve instead of failing. |
| **Vite-style source resolution** | `@/`-style aliases (detected from `tsconfig.json` paths + `vite.config` aliases, `@ → src` by convention), `$lib` (SvelteKit), bare `src/...` baseUrl imports, extensionless/directory module imports (`./x` → `./x.jsx`, `./people` → `./people/index.tsx`), `import.meta.env` shim, and a client-side router URL fix so BrowserRouter/Vue Router apps boot at their home route. |
| **Read-only share links** | Append `&readonly=1` to any session URL to hide the EdgeQA header and bug-reporting UI — a pure preview for sharing with stakeholders. |
| **Paste-a-repo URL** | Drop in `https://github.com/acme/site` (or `acme/site`, or a `/tree/` branch URL) and the form fills itself. |
| **Bookmarklet** | One-click pre-fill from any GitHub repo page. |
| **Saved QA links** | After generating a link, EdgeQA asks if you want to save it — stored PIN-encrypted in `localStorage` (never the token, never the PIN), with per-link copy / open / delete. Manage many sessions at once. |
| **Encrypted backups** | Export all saved links as a JSON backup and re-import them on any browser — the payloads stay PIN-locked, so the backup is safe to move around. |
| **Mobile QA** | The full preview + report flow works on phones. |

## How it works

```
┌────────────────────────────┐
│  Parent window (app shell) │  routing, link encryption/decryption,
│                           │  token held in memory, bug-report drawer
└─────────────┬──────────────┘
              │ postMessage (decrypted token)
              ▼
┌────────────────────────────┐
│  Service Worker (intercep‐ │  /sandbox/{owner}/{repo}/{branch}/…  →
│  tor / VFS)                │  GitHub Contents/Blobs API → MIME-typed responses
└─────────────┬──────────────┘
              ▼
┌────────────────────────────┐
│  Sandbox <iframe>          │  your repo's real index.html + assets
└────────────────────────────┘
```

**Security model**

1. The developer generates a magic link: the PAT is encrypted in the browser with a PIN-derived AES-GCM key, producing `/#repo=…&branch=…&payload=…`.
2. The tester opens the link and enters the PIN the developer shared out-of-band.
3. The browser decrypts the token **in memory**, sends it to the Service Worker via `postMessage`, and the sandbox starts serving the repo.
4. Nothing is stored server-side, nothing is persisted beyond the session, and the token never appears in the URL.

## Getting started (development)

Requirements: [Bun](https://bun.sh) (the project is built with Bun; scripts assume it).

```bash
# install dependencies
bun install

# run the dev server (Vite)
bun run dev

# typecheck
bun run typecheck

# run unit tests (Vitest)
bun run test

# run end-to-end tests (Playwright — starts a local Vite server)
bun run test:e2e

# production build → dist/
bun run build
```

The project deploys to GitHub Pages automatically on every push to `main` via `.github/workflows/deploy-pages.yml` (the build is `vite build`; Vite's `base: "./"` keeps asset paths portable under `/EdgeQA/`).

## Using EdgeQA

**As the developer:**

1. Open the app → **Create a QA link**.
2. Paste the repository URL (or type owner/repo/branch).
3. Create a **fine-grained PAT** with:
   - **Contents: Read-only** (serves the repo's files)
   - **Issues: Read and write** (accepts bug reports)
   - Scope it to the repository you're previewing.
4. Paste the token and choose a **session PIN** (≥ 6 chars).
5. Generate the magic link, copy it, and send it to your tester **along with the PIN separately** (the PIN is the only key to the token).
6. EdgeQA then asks **"Save this QA link?"** — saving keeps the PIN-encrypted link in this browser (under **Your QA links** below the form) so you can reopen it later with its PIN. Saving is always explicit, never automatic. Use **Export backup** / **Import backup** to move your saved links between browsers; each entry has copy, open, and delete, plus **Clear all saved links**.

**As the tester:**

1. Open the magic link and enter the PIN.
2. Test the app in the sandboxed preview — on desktop or mobile.
3. Found something off? Hit **Report a bug** (side tab on desktop, tab on mobile). The drawer shows exactly what will be auto-attached (repo, branch, page, screensize, device/browser, time) and lets you **include the session's console log** (on by default). Just describe the bug in one line — no need to know browser details — then submit; a real GitHub issue is opened for you.

**Bookmarklet:** on the setup screen, drag **⚡ Install bookmarklet** to your bookmarks bar. While viewing any GitHub repo, click it and EdgeQA opens with that repo pre-filled.

**Share a read-only preview:** append `&readonly=1` to a session link (e.g. `…#demo&readonly=1` or a PIN-protected link plus `&readonly=1`) and the recipient gets a pure preview with no EdgeQA header and no way to file bugs — handy for walkthroughs and stakeholder review.

## Project structure

```
public/edgeqa-sw.js      Service worker: VFS interceptor, GitHub API proxy, caching, SPA fallback, build tier
src/main.tsx             App shell: landing page, setup flow, unlock flow, sandbox viewer + report drawer
src/demo-element.js      Home-page animated demo (web component, swappable via <slot name="media">)
src/lib/repo.ts          GitHub URL → owner/repo/branch parser (unit-tested)
src/lib/discover.ts      Repo → entry-point/framework/alias discovery (unit-tested)
src/lib/frame.ts         Page-side Vue/Svelte compiler delegation + module rewriting
src/index.css            Design system (dark theme, tokens)
tests/*.test.ts          Vitest unit tests (SW, discovery, URL parser)
tests/edgeqa.spec.ts     Playwright e2e specs
scripts/round2.mjs       Real-repo regression harness: loads a repo preview through the real SW flow in Chromium
.github/workflows/       GitHub Pages deploy workflow
```

## Tech stack

- **Language:** TypeScript
- **UI:** React 19 + Vite (hand-rolled CSS design system, lucide-react icons)
- **Runtime APIs:** Web Crypto (PBKDF2 + AES-GCM), Service Worker, Cache Storage, GitHub REST API
- **Testing:** Vitest (unit), Playwright (e2e)

## Current status & roadmap

Working today: link generation/decryption, the VFS service worker (with the real decrypted token handed off securely), repo-URL parsing, bookmarklet, the full landing experience, the in-context report drawer (desktop + mobile), **real GitHub issue creation** — reports are `POST`ed to the repo's Issues API with an `edgeqa-report` label; the drawer transparently shows the auto-attached session context (repo, branch, page, screensize, device/browser, time) and can include the session's **console log** (optional, on by default), with a link to the filed issue on success — **saved QA links** (opt-in per generation, PIN-encrypted in `localStorage`, with copy/open/delete and JSON **export/import backups**) — and a **tokenless live demo** (`/#demo`) that previews this repo's public `examples/northstar/` site so anyone can try the platform without a repo or PAT.

Also working (experimental): the **in-browser build tier** — source repos for React / Preact / JSX+TSX / Vue / Svelte are transpiled in the browser, with framework auto-detection, `@`/`$lib` alias + baseUrl resolution from `tsconfig.json`/`vite.config`, package.json-pinned esm.sh dependency loading, and a client-side router URL fix. Round-2 testing against 20 real public repos (calendar apps, whiteboards, emulator UIs, Vue/Svelte playgrounds, the repo owner's own projects) verified real apps render; the remaining failures are documented per-repo in `scripts/round2.mjs`.

Next up:

- Angular source preview (needs an in-browser AOT seam — currently degrades gracefully).
- CSS-level `@import "tailwindcss"` (Tailwind v4) needs a CSS build step; the app still boots, just un-styled.

## Limitations

- No server-side code execution (Node.js, PHP, API routes).
- Apps that need injected `.env` secrets won't run in the sandbox.
- Unpublished **workspace-only packages** (`@repo/ui`, `@tldraw/*`) can't resolve via esm.sh.
- Packages esm.sh's build servers reject (e.g. `svelte-sonner`) won't load.
- Angular source and highly complex bundler module graphs (nested Webpack/Vite resolution) are out of scope for now.

## Sandbox origin & CORS

The previewed app runs inside an iframe **on the EdgeQA origin** (e.g. `https://spuds0588.github.io`), not on your domain. That means:

- **GitHub's own API is CORS-enabled**, so the VFS file serving and issue filing need **no allowlist** — the token-based flow works as-is.
- **Any third-party API your app calls from the preview will see requests originating from the EdgeQA origin.** If that API enforces CORS, allowlists, or OAuth redirect URLs, add the EdgeQA origin (shown on the setup screen as `window.location.origin`) to it.
- Local/private-network endpoints (e.g. `localhost`, a dev server on your machine) are not reachable from the sandbox unless they already allow cross-origin browser requests from the EdgeQA origin.

## Contributing

Found a bug or have an idea? Open an [issue](https://github.com/Spuds0588/EdgeQA/issues) — the app itself is a frontend-only project, so contributions that keep it that way are especially welcome.

## License

[MIT](LICENSE) © 2026 Corey Burns ([@Spuds0588](https://github.com/Spuds0588))
