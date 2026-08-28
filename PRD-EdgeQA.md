# Project: EdgeQA (Frontend-Only GitHub VFS & QA Sandbox)

## 1. Product Requirements Document (PRD)

### 1.1 Overview & Value Proposition
EdgeQA is a 100% frontend, zero-cost platform that allows developers to serve, run, and share private GitHub repositories directly in the browser. By leveraging Service Workers, IndexedDB, and the Web Crypto API, EdgeQA creates a Virtual File System (VFS) that proxies GitHub API requests into a live browser sandbox. It enables secure, password-protected "Magic Links" so developers can share staging environments with QA testers or clients—who can then submit bug reports directly to GitHub Issues—without ever deploying to a hosting provider.

### 1.2 Target Audience
*   Frontend Developers and Freelancers.
*   QA Testers and Clients reviewing web applications.
*   Developers building static sites, vanilla JS apps, or pre-compiled SPAs (React, Vue) stored in private repositories.

### 1.3 Core Features (V1)
*   **Zero-Backend Architecture:** Hosted entirely on GitHub Pages. No backend infrastructure or database costs.
*   **BYOK Auth:** Developers use a Fine-Grained Personal Access Token (PAT) scoped to specific repositories.
*   **Web Crypto Magic Links:** Secure, shareable URLs where the PAT is AES-GCM encrypted via a developer-defined PIN.
*   **Virtual File System (VFS):** Service Worker intercepts iframe requests, serving repository files with correct MIME types.
*   **Read-Through Cache:** Caches GitHub API Blobs in IndexedDB to defeat rate limits and provide instant reloads.
*   **Large Asset Fallback:** Handles GitHub's 1MB API limit by automatically falling back to the Git Database (100MB) API, and synthesizes mock files for >100MB assets to prevent crashes.
*   **In-Context Bug Reporting:** A floating QA widget allows testers to submit issues directly to the developer's GitHub repository via the decrypted PAT.
*   **Experimental JSX/React Support:** Optional preset to utilize `@babel/standalone` and Import Maps for in-browser transpilation of raw `.jsx` files and bare NPM imports.

### 1.4 Out of Scope (V1 Constraints)
*   Server-side code execution (Node.js, PHP, Next.js API routes).
*   Applications requiring injected `.env` secrets.
*   Complex bundler behavior (e.g., highly nested Webpack/Vite module resolution beyond basic imports).

---

## 2. Architecture & Implementation Guide

### 2.1 System Architecture
The application consists of three main frontend layers:
1.  **Parent Window (App Shell):** Handles routing, URL decryption, PAT memory storage, Service Worker registration, and the QA Bug Report widget.
2.  **The Sandbox (Iframe):** A full-width `<iframe>` pointing to a virtual URL (e.g., `/sandbox/{owner}/{repo}/{branch}/index.html`).
3.  **The Interceptor (Service Worker):** The core engine. Listens to `fetch` events from the Iframe, interfaces with IndexedDB, and proxies requests to GitHub.

### 2.2 Security & Authentication (Web Crypto API)
To avoid backend databases, V1 uses in-browser encryption for sharing tokens.
*   **Encryption:** Dev inputs PAT and a `PIN`. Use `window.crypto.subtle` to generate an AES-GCM key from the PIN (via PBKDF2). Encrypt the PAT.
*   **Link Generation:** Append the encrypted payload to the URL hash: `/#repo=user/app&payload={base64_encrypted_pat}`.
*   **Decryption:** Tester opens the link, enters the `PIN`. The browser decrypts the PAT, stores it in memory (not `localStorage`), and sends it to the Service Worker via `postMessage`.

### 2.3 Service Worker & VFS Logic
*   **Caching Strategy:** `idb-keyval` is used to store `ArrayBuffers`/`Blobs` against their virtual file path.
*   **MIME Types:** A lightweight dictionary must map file extensions to standard `Content-Type` headers. GitHub's raw API often defaults to `text/plain`, which breaks CSS/JS.
*   **SPA Fallback:** If a request returns a 404 from GitHub (e.g., a tester navigates to `/dashboard` in a React router app), the Service Worker must catch the 404 and return the root `index.html` file.

### 2.4 GitHub API Fallback Logic (File Sizes)
1.  **Primary Fetch:** `GET https://api.github.com/repos/{owner}/{repo}/contents/{path}`
2.  **Size Check:** If the JSON response lacks a `content` field but has a `size` > 1MB:
    *   Extract the `sha`.
    *   **Secondary Fetch:** `GET https://api.github.com/repos/{owner}/{repo}/git/blobs/{sha}` (Supports up to 100MB).
3.  **Hard Limit (>100MB):** If the file exceeds 100MB (Git LFS limit), return a synthetic HTTP 200 `Response`:
    *   *Images:* Return a generated SVG (`<svg>Asset too large</svg>`).
    *   *JS/CSS:* Return empty content.
    *   *Action:* `postMessage` to the parent window to trigger a toast warning.

### 2.5 In-Browser Transpilation (Experimental React Mode)
If the URL includes `&preset=react`:
1.  **Intercept `.jsx` / `.tsx`:** The Service Worker routes the fetched text through `@babel/standalone`.
2.  **Transform:** `Babel.transform(code, { presets: ['react'] })`.
3.  **Import Maps:** Inject an `<script type="importmap">` into the `index.html` before returning it to the browser. Map `react` and `react-dom` to `https://esm.sh/react`.
4.  **Serve:** Return the compiled JS to the browser with `application/javascript`.

### 2.6 QA Bug Reporting
The parent window houses a floating widget. On submit:
1.  Query the iframe for current path: `document.getElementById('sandbox').contentWindow.location.pathname`.
2.  Gather `navigator.userAgent` and `window.innerWidth`.
3.  Use the decrypted PAT in memory to POST to `https://api.github.com/repos/{owner}/{repo}/issues`.
4.  Append predefined tags (e.g., `edgeqa-report`).

---

## 3. Developer Task List

### Phase 1: Project Setup & App Shell
- [ ] Initialize repository (Vite + Vanilla TS or React/Tailwind).
- [ ] Create layout: Main Landing Page, Dev Setup View, and Sandbox Viewer View.
- [ ] Implement robust URL Hash parser to extract state (e.g., `repo`, `branch`, `payload`, `preset`).
- [ ] Set up `<iframe id="sandbox">` component with 100vw/100vh styling.

### Phase 2: Web Crypto & Magic Links
- [ ] Implement PBKDF2 key derivation using a user-provided PIN.
- [ ] Implement AES-GCM encryption for the developer's PAT.
- [ ] Create "Generate Link" UI that outputs the shareable URL.
- [ ] Create "Unlock Link" UI (Tester View) that prompts for the PIN and decrypts the PAT.
- [ ] Establish secure `postMessage` pipeline to transmit the decrypted PAT from the Parent Window to the Service Worker memory.

### Phase 3: Service Worker & IndexedDB (VFS)
- [ ] Register Service Worker globally on app load.
- [ ] Integrate `idb-keyval` into the Service Worker.
- [ ] Write `fetch` event listener to intercept requests starting with `/sandbox/`.
- [ ] Implement Read-Through Cache logic: Check IndexedDB -> Return if exists -> Fetch from GitHub API if miss -> Save to IndexedDB -> Return.
- [ ] Create a comprehensive MIME-type mapping utility (HTML, CSS, JS, SVG, PNG, JSON, WOFF2, etc.).
- [ ] Implement SPA Fallback routing (return `index.html` on virtual 404s).

### Phase 4: GitHub API Integration & Large File Fallback
- [ ] Implement primary fetch to `repos/{owner}/{repo}/contents/{path}`.
- [ ] Add Base64 decoding logic for standard `< 1MB` file responses.
- [ ] Implement the `> 1MB` fallback logic utilizing the `/git/blobs/{sha}` API endpoint.
- [ ] Implement the `> 100MB` synthetic file generator (SVG generator for images, empty string for scripts).
- [ ] Set up `postMessage` alerts from SW to Parent Window to trigger UI toast notifications when large files are skipped.
- [ ] Implement "Clear Cache / Hard Refresh" button UI that calls `idb.clear()`.

### Phase 5: Experimental JSX / React Mode
- [ ] Add `@babel/standalone` to the Service Worker context.
- [ ] Write regex/parser to detect `<head>` in `index.html` and inject the `esm.sh` Import Map.
- [ ] Add logic in Service Worker to compile `.jsx` contents dynamically if `&preset=react` is active.
- [ ] Rewrite relative bare imports (if necessary) to align with the Import Map.

### Phase 6: QA Widget & Issue Submission
- [ ] Build floating "Report Bug" UI component in the Parent Window (Bottom Right corner, z-index above Iframe).
- [ ] Create form with Fields: Name, Title, Description.
- [ ] Write context-gathering script (Iframe URL, Screen resolution, User Agent).
- [ ] Write `submitGitHubIssue()` function leveraging the decrypted PAT in memory.
- [ ] Handle API responses (Success toast + Issue Link vs. Error toast for missing permissions).

### Phase 7: Polish, Documentation, & Deployment
- [ ] Write clear "Supported Project Types" warnings on the landing page (Vanilla, `/dist` folders, static sites).
- [ ] Provide step-by-step instructions in the UI for generating a GitHub PAT (Permissions needed: `Contents: Read`, `Issues: Write`).
- [ ] Test cross-origin iframe security policies (CORS, Sandbox attributes).
- [ ] Deploy to GitHub Pages (ensure routing works with standard static hosting).
- [ ] Perform end-to-end testing with a large pre-compiled React SPA repo.
