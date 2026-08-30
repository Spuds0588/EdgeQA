# EdgeQA

**🔗 Live site:** [https://spuds0588.github.io/EdgeQA/](https://spuds0588.github.io/EdgeQA/)

**▶ Try the live demo** (no repo or token needed): [open a QA session for the example project](https://spuds0588.github.io/EdgeQA/#demo) — it previews the public [`examples/northstar/`](examples/northstar/) site straight from this repo's files via the VFS.

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
| **Read-through cache** | Repo files are cached so reloads are instant and API rate limits are spared. |
| **Large-asset fallback** | Handles GitHub's 1MB contents-API limit via the Git Database API (up to 100MB), and synthesizes safe placeholders for anything larger. |
| **SPA fallback** | Virtual 404s fall back to `index.html`, so client-side routers work. |
| **In-context bug reporting** | A report drawer (side panel on desktop, bottom sheet on mobile) collects title + description with path, viewport, and UA attached. |
| **Paste-a-repo URL** | Drop in `https://github.com/acme/site` (or `acme/site`, or a `/tree/` branch URL) and the form fills itself. |
| **Bookmarklet** | One-click pre-fill from any GitHub repo page. |
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

**As the tester:**

1. Open the magic link and enter the PIN.
2. Test the app in the sandboxed preview — on desktop or mobile.
3. Found something off? Hit **Report a bug** (side tab on desktop, tab on mobile) and file it — the session context is attached automatically.

**Bookmarklet:** on the setup screen, drag **⚡ Install bookmarklet** to your bookmarks bar. While viewing any GitHub repo, click it and EdgeQA opens with that repo pre-filled.

## Project structure

```
public/edgeqa-sw.js      Service worker: VFS interceptor, GitHub API proxy, caching, SPA fallback
src/main.tsx             App shell: landing page, setup flow, unlock flow, sandbox viewer + report drawer
src/demo-element.js      Home-page animated demo (web component, swappable via <slot name="media">)
src/lib/repo.ts          GitHub URL → owner/repo/branch parser (unit-tested)
src/index.css            Design system (dark theme, tokens)
tests/repo.test.ts       Unit tests for the URL parser
tests/edgeqa.spec.ts     Playwright e2e specs
.github/workflows/       GitHub Pages deploy workflow
```

## Tech stack

- **Language:** TypeScript
- **UI:** React 19 + Vite (hand-rolled CSS design system, lucide-react icons)
- **Runtime APIs:** Web Crypto (PBKDF2 + AES-GCM), Service Worker, Cache Storage, GitHub REST API
- **Testing:** Vitest (unit), Playwright (e2e)

## Current status & roadmap

Working today: link generation/decryption, the VFS service worker (with the real decrypted token handed off securely), repo-URL parsing, bookmarklet, the full landing experience, the in-context report drawer (desktop + mobile), **real GitHub issue creation** — reports are `POST`ed to the repo's Issues API with an `edgeqa-report` label and session context (path, viewport, UA) attached, with a link to the filed issue on success — and a **tokenless live demo** (`/#demo`) that previews this repo's public `examples/northstar/` site so anyone can try the platform without a repo or PAT.

Next up:

- Experimental in-browser JSX/React transpilation mode (`&preset=react`).

## Limitations

- No server-side code execution (Node.js, PHP, API routes).
- Apps that need injected `.env` secrets won't run in the sandbox.
- Highly complex bundler module graphs (nested Webpack/Vite resolution) are out of scope.

## Contributing

Found a bug or have an idea? Open an [issue](https://github.com/Spuds0588/EdgeQA/issues) — the app itself is a frontend-only project, so contributions that keep it that way are especially welcome.

## License

[MIT](LICENSE) © 2026 Corey Burns ([@Spuds0588](https://github.com/Spuds0588))
