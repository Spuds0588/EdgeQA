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
| **Vite-style source resolution** | `@/`-style aliases (detected from `tsconfig.json` paths + `vite.config` aliases, `@ → src` by convention), `$lib` (SvelteKit), bare `src/...` baseUrl imports, extensionless/directory module imports (`./x` → `./x.jsx`, `./people` → `./people/index.tsx`), `import.meta.env`/`glob`/`globEager`/`hot` shims, and a client-side router URL fix so BrowserRouter/Vue Router apps boot at their home route. |
| **Read-only share links** | Append `&readonly=1` to any session URL to hide the EdgeQA header and bug-reporting UI — a pure preview for sharing with stakeholders. |
| **Paste-a-repo URL** | Drop in `https://github.com/acme/site` (or `acme/site`, or a `/tree/` branch URL) and the form fills itself. |
| **Bookmarklet** | One-click pre-fill from any GitHub repo page. |
| **Saved QA links** | After generating a link, EdgeQA asks if you want to save it — stored PIN-encrypted in `localStorage` (never the token, never the PIN), with per-link copy / open / delete. Manage many sessions at once. |
| **Encrypted backups** | Export all saved links as a JSON backup and re-import them on any browser — the payloads stay PIN-locked, so the backup is safe to move around. |
| **Mobile QA** | The full preview + report flow works on phones. A link can also prefill your token on the setup screen (`#token=…`) — it's stripped from the URL the moment it's read, so it can't leak through a shared link. |
| **WebMCP agent tool** | The site registers a `create_qa_link` tool via WebMCP (`document.modelContext.registerTool`), so WebMCP-capable coding/LLM agents can mint QA preview links for any public repo — tokenless — while browsing the site. Progressive enhancement: browsers without WebMCP just see the normal page. |
| **SEO / AEO-ready** | Full meta + Open Graph + Twitter cards, JSON-LD structured data (WebApplication, FAQPage, author), `llms.txt`, `robots.txt`, and `sitemap.xml` so search engines and LLM agents can find and use EdgeQA. |

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

**Prefill your token on mobile:** the GitHub app/PWA on Android can make pasting a long `github_pat_…` painful. You can open a link like `…#repo=acme/site&token=YOUR_TOKEN` and EdgeQA will prefill the token, run the connect check, and immediately strip the token out of the URL (`replaceState`) so it never survives in a shared link, a history entry, or a referrer. For anyone else, share the PIN-encrypted magic link instead — never a raw-token URL.

**Share a read-only preview:** append `&readonly=1` to a session link (e.g. `…#demo&readonly=1` or a PIN-protected link plus `&readonly=1`) and the recipient gets a pure preview with no EdgeQA header and no way to file bugs — handy for walkthroughs and stakeholder review.

## Project structure

```
public/edgeqa-sw.js      Service worker: VFS interceptor, GitHub API proxy, caching, SPA fallback, build tier
public/llms.txt          LLM/agent-readable site summary (AEO)
public/robots.txt        Crawler rules + sitemap pointer
public/sitemap.xml       Sitemap
src/main.tsx             App shell: landing page, setup flow, unlock flow, sandbox viewer + report drawer
src/demo-element.js      Home-page animated demo (web component, swappable via <slot name="media">)
src/lib/repo.ts          GitHub URL → owner/repo/branch parser (unit-tested)
src/lib/discover.ts      Repo → entry-point/framework/alias discovery (unit-tested)
src/lib/frame.ts         Page-side Vue/Svelte compiler delegation + module rewriting
src/lib/qa-link.ts       Shared magic-link builder: PIN/AES-GCM payload crypto + canonical #hash assembly
src/lib/webmcp.ts        WebMCP agent tool registration (create_qa_link)
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

Also working (experimental): the **in-browser build tier** — source repos for React / Preact / JSX+TSX / Vue / Svelte are transpiled in the browser, with framework auto-detection, `@`/`$lib` alias + baseUrl resolution from `tsconfig.json`/`vite.config`, package.json-pinned esm.sh dependency loading, and a client-side router URL fix. Round-2 (20 real public repos — calendar apps, whiteboards, emulator UIs, Vue/Svelte playgrounds, the repo owner's own projects) and round-3 (six fresh new apps: React `pmndrs/leva`, Vue `antfu/vitesse` + `element-plus` play, SolidJS `solid-playground`, and static `three.js` / `mermaid`) verified real apps render. Round-3 also added the **pnpm `catalog:` version-protocol fix** (Vitesse and other modern pnpm repos no longer pin to `@catalog%3Afrontend` and fail), the **`import.meta.glob/globEager` shims** (Vue apps that register dynamic routes/components no longer crash on the Vite-only API), and **Solid detection** (repos committed to `solid-js` are no longer mislabeled as React JSX and get a clean degrade instead of a confusing blank page).

Round-4 (7 more fresh real apps, all on the supported build tiers) verified **CRA-style React** (JSX inside `.js` files now transpiles — `gothinkster/react-redux-realworld-example-app` renders), **Preact** (the preactjs website itself — hydrate→render bridge for preact-iso SSG, CSS-module proxy, JSON module support), **Svelte** (the official `sveltejs/template` — compiler version now follows the repo's pinned Svelte), the heavy Vue app **snapshot** (documented degrade: esm.sh can't build its `@snapshot-labs/lock/connectors/*` subpaths), **Vue 2** detection (not mislabeled as Vue 3 — degrades cleanly), and two of the author's own apps (ZipLayer, Sparrow-Offline-CRM). Round-4 added: the **source-entry HTML bridge** (CRA/rollup templates whose committed `index.html` references build artifacts or nothing — now bridged to the real `src/main.*`), **JSX-in-`.js` transpile**, **`.json` served as a module** when imported as a script, **JSON-module + bare-CSS package imports**, the **preact `hydrate` → `render as hydrate` bridge**, and the **CSS-module proxy** (`.module.css` default-import returns a key→className map). Remaining per-repo causes are documented in `scripts/round2.mjs`.

Round-5 (6 more fresh real apps, all on the supported build tiers) verified **React Flow** (the official `xyflow` Vite example renders its node/canvas board), **react-three-fiber** (the repo's own bundled example loads — the react 19 vs `react-reconciler` error is an upstream esm.sh-pinning quirk at the app level, the document still loads), **Svelte 5 runes** (`TrueCast-Weather` renders — runes modules like `.svelte.ts` now compile via Svelte's dedicated `compileModule` with TS stripped, instead of leaking literal `$state`/`$derived` identifiers), the two heavyweight Vue admins — **vue-pure-admin** (clean degrade) and **vue-naive-admin** (now **boots its full module graph and renders the login page**, up from failing outright), and the author's **MISMO.js**. Round-5 added the fixes that unlocked the Vue admins: **template-literal dynamic-import preamble rewriting** (`import(`@/layouts/${name}/index.vue`)` → module-relative, keeping `${…}` parts), plus the **`.vue`/plain-JS directory-index sibling-import offset**, bare **`.` (directory self-import) → `./index`**, and auto-import shimming for common Vue globals — a handful of real edge cases that were breaking heavier component-library apps. Remaining per-repo causes are documented in `scripts/round2.mjs`.

Round-6 (five more fresh real Vue admins) verified the admin tier specifically: **Geeker-Admin** (element-plus, 6.8k★) and **jekip/naive-ui-admin** (naive-ui, 5.9k★) now each **render their login pages** — both were blocked on a stack of real, common admin patterns that are now handled; the heavyweight **soybean-admin** and **vue-vben-admin** (still a small-workspace-package monorepo) degrade cleanly. Round-6 added the fixes that unlocked the admins: **`virtual:*` module shimming** (`vite-plugin-svg-icons`' `import "virtual:svg-icons-register"` and the Iconify offline `@iconify-json/*/icons.json` imports now boot instead of CORS/JSON-MIME-blocking), **committed-`.env*` loading** (real admins read `import.meta.env.VITE_*` from checked-in env files), a development-flavored `import.meta.env` shim (many apps branch on `DEV/PROD`), **`.js`-specifier → `.ts`-file resolution** (the ESM `./foo.js`-imports-a-`.ts`-file convention), a **dir-index trailing-slash fix** in `relFrom`, and **template-aware sucrase import preservation** (imports used only in a Vue `<template>` — i.e. referenced nowhere in the script body — are re-added after TS strip instead of dropped; the `\s` template-literal regex trap that was silently resurrecting imports is fixed and regression-tested). One residual, documented case: **vue3-antd-admin**'s router has a static circular import (`routes/basic → router/index`) that, served at our extensionless directory-index URLs, hits a Chrome ESM edge where `basic` references the router via `'../'` (trailing-slash URL) while other modules reference it via `'./router'` (no slash) — the browser treats the two as separate module instances and deadlocks (TDZ `basicRoutes`), and a 301 canonicalization can't merge them (Chrome keeps redirect-split module identities). Real Vite avoids it by serving `index.ts` under a real filename; folding dot-dot dir-index imports into one canonical spelling is the planned fix.

Round-7 (six more Vue admin apps across new UI libraries, vue-cli-era source, and monorepo degrades) extended the admin tier to a third UI library (Arco Design) and the first vue-cli-built admin. **vea-admin** (vue-element-plus-admin, 3.7k★) **passes** — it's the first Round-7 app to fully boot. Round-7 added the fixes that unlocked more admins: **Pinia auto-import injection** (`defineStore`, `storeToRefs`, `mapState`/`mapGetters`/`mapActions`/`mapMutations` from `pinia` are now auto-imported for `.vue`/`.js` modules that reference them without an explicit `import`, mirroring `unplugin-auto-import`), and **webpack `require.context` + AMD `define`/`require([...])` shimming** (vue-cli-era admin templates that use `require.context('./modules', ...)` for store registration or `require([...], resolve)` for lazy routes no longer crash with `require is not defined`; the stubs return empty contexts so the app degrades cleanly instead of breaking the module graph). Four repos degrade cleanly with documented causes: **vue3-element-admin** (Pinia stores have circular re-exports that hit Chrome's directory-index TDZ edge), **ruoyi-vue3** (esm.sh wraps `file-saver` as default-only CJS — `import { saveAs }` fails the static named-export check), **arco-pro** (esm.sh's CDN occasionally returns a truncated `vue-router` build variant), and **vue-admin-better** (webpack `require.context` stubs prevent crashes but mock/plugin loading returns empty).

Next up:

- Angular source preview (needs an in-browser AOT seam — currently degrades gracefully).
- CSS-level `@import "tailwindcss"` (Tailwind v4) needs a CSS build step; the app still boots, just un-styled.

## What EdgeQA can't preview (and how to fix it)

EdgeQA runs the repo **as committed, in the browser**. Anything that needs a server, a build step, or injected secrets won't run — but many of these are easy to work around, and the rest degrade cleanly (you'll see "no web app" or a minimal page, never a crash):

| Not supported | Why | The fix |
| --- | --- | --- |
| Server-side code (Node.js, PHP, API routes, Next.js pages) | No server executes code in the sandbox | Point the link at a static build output, or use the framework's static export into a `dist/`/`out/` folder committed to the repo |
| Injected `.env` secrets | The sandbox can't read your `.env` | Preview with real-but-safe values committed (or none) — secrets never belong in a shareable QA link anyway |
| Unpublished **workspace-only packages** (`@repo/ui`, `@tldraw/*`, `@element-plus/components/*`) | They don't exist on npm, so the esm.sh resolver 404s | Publish them (or the app) to npm, or point the link at the built bundle that inlines them |
| Packages esm.sh's build servers reject (`svelte-sonner`, `leva/headless`) | esm.sh can't build them — an upstream limitation, not ours | Swap the import for a published alternative, or commit the built output |
| Angular / Solid source | No in-browser compiler for those JSX dialects yet — detected automatically so they degrade cleanly instead of rendering nothing | Preview a static/compiled build instead |
| Vite build-step codegen (`virtual:*` modules from `vite-plugin-vue-layouts`, `import.meta.glob`-generated route maps, Sass/Less preprocessing, Tailwind v4's `@import "tailwindcss"`) | These are compile-time steps the browser can't run | Commit the built `dist/` (or preprocessed CSS) — or wait; the `import.meta.glob`/`hot` shims already keep most such apps from crashing |
| Highly complex bundler module graphs (nested Webpack/Vite resolution) | Out of scope for now | Commit a built bundle and preview that |

**Best practice:** for the most reliable preview, commit your app's built output (`dist/`, `build/`, `docs/`) alongside source — EdgeQA then serves the real deployable, exactly as your hosting would. Source-repo previews (React/Vue/Svelte) are the convenience path and work for the vast majority of real apps tested.

## Sandbox origin & CORS

The previewed app runs inside an iframe **on the EdgeQA origin** (e.g. `https://spuds0588.github.io`), not on your domain. That means:

- **GitHub's own API is CORS-enabled**, so the VFS file serving and issue filing need **no allowlist** — the token-based flow works as-is.
- **Any third-party API your app calls from the preview will see requests originating from the EdgeQA origin.** If that API enforces CORS, allowlists, or OAuth redirect URLs, add the EdgeQA origin (shown on the setup screen as `window.location.origin`) to it.
- Local/private-network endpoints (e.g. `localhost`, a dev server on your machine) are not reachable from the sandbox unless they already allow cross-origin browser requests from the EdgeQA origin.

## Contributing

Found a bug or have an idea? Open an [issue](https://github.com/Spuds0588/EdgeQA/issues) — the app itself is a frontend-only project, so contributions that keep it that way are especially welcome.

## License

[MIT](LICENSE) © 2026 Corey Burns ([@Spuds0588](https://github.com/Spuds0588))
