// Round 2: real-repo testing harness. Loads each repo's preview through the actual
// EdgeQA flow (hash link -> Viewer -> service worker VFS -> in-browser build tier)
// in real Chromium, then reports what rendered and what broke.
//
// Usage: bun scripts/round2.mjs            (full run, all repos)
//        bun scripts/round2.mjs owner/repo  (single repo)
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 4175;
const BASE = `http://127.0.0.1:${PORT}`;
const APP = `${BASE}/`;

// `alias`/`local` mirror what the setup flow's probeRepo detection bakes into the link
// (verified against each repo's tsconfig/vite.config). The harness navigates directly to
// the viewer hash, so it must supply them explicitly.
const REPOS = [
  // React / Vite source apps
  { id: "someday",        repo: "rbbydotdev/someday", branch: "master", path: "frontend", preset: "react", alias: "@:src", local: "src", expect: /someday|cal|event|book|Calendar|appointment/i },
  { id: "excalidraw",     repo: "excalidraw/excalidraw", branch: "master", path: "excalidraw-app", preset: "react", expect: /Excalidraw|excalidraw|Canvas|Loading/i },
  { id: "tldraw-examples", repo: "tldraw/tldraw", branch: "main", path: "apps/examples/src", preset: "react", expect: null, degrade: true }, // tldraw + @tldraw/* are unpublished workspace-only packages
  { id: "refine-crm",     repo: "refinedev/refine", branch: "main", path: "examples/app-crm-minimal", preset: "react", alias: "@:src", local: "src", expect: null, degrade: true }, // repo pins @refinedev/core@^5.1.0 which npm doesn't have (esm.sh 404s)
  { id: "starter-kit",    repo: "kriasoft/react-starter-kit", branch: "main", path: "apps/app", preset: "react", alias: "@:src", local: "src", expect: null, degrade: true }, // @repo/* are unpublished workspace-only packages
  { id: "react-hook-form", repo: "react-hook-form/react-hook-form", branch: "master", path: "app", preset: "react", expect: /react-hook-form|Form|Submit|Example|cypress/i },
  // Vue 3
  { id: "realworld-vue",  repo: "mutoe/vue3-realworld-example-app", branch: "main", path: "", preset: "vue", local: "src", expect: /conduit|RealWorld|Home|Sign in|New Post/i },
  { id: "a-m-l-core",     repo: "amll-dev/applemusic-like-lyrics", branch: "main", path: "packages/playground/core", preset: "vue", alias: "@:src", local: "src", expect: /sidebarprovider|lyricplayer/i, expectHtml: true },
  { id: "a-m-l-vue",      repo: "amll-dev/applemusic-like-lyrics", branch: "main", path: "packages/playground/vue", preset: "vue", alias: "@:src", local: "src", expect: /AMLL|绑定|调试|music/i },
  // Svelte
  { id: "muximux",        repo: "mescon/Muximux", branch: "main", path: "web", preset: "svelte", alias: "$lib:src/lib", local: "src", expect: null, degrade: true }, // svelte-sonner (its dep) 500s on esm.sh's build servers entirely
  // Preact / JSX
  { id: "preact-demo",    repo: "preactjs/preact", branch: "main", path: "demo", preset: "jsx", expect: null, degrade: true }, // preact-router@3.0.0 (2017) renders empty via esm.sh even standalone
  // Static / vanilla (tokenless)
  { id: "mgba",           repo: "Spuds0588/mgba-splitscreen", branch: "master", path: "DualBoy/src", preset: "", expect: /mGBA|GBA|Dual|emulator/i },
  { id: "quickrecord",    repo: "Spuds0588/QuickRecord", branch: "main", path: "", preset: "", expect: /Record|Screen|QuickRecord/i },
  { id: "ai-test-bench",  repo: "Spuds0588/Local-AI-Test-Bench", branch: "main", path: "", preset: "", expect: /AI|LLM|bench|model/i },
  { id: "arive-data",     repo: "Spuds0588/Arive-Data-Explorer", branch: "main", path: "", preset: "", expect: /Arive|data|Data/i },
  { id: "kabam",          repo: "Spuds0588/kabam-game", branch: "main", path: "", preset: "", expect: /canvas/i, expectHtml: true },
  { id: "kingfisher",     repo: "Spuds0588/kingfish.er", branch: "main", path: "", preset: "", expect: /under construction|Kingfisher/i, expectHtml: true },
  { id: "llm-compare",    repo: "Spuds0588/LLMComparisonTable", branch: "main", path: "", preset: "", expect: /under construction|Welcome/i, expectHtml: true },
  { id: "zen",            repo: "sheshbabu/zen", branch: "master", path: "docs", preset: "", expect: /zen|notes|Zettelkasten/i },
  // Negative: Angular source is out of scope — must degrade, not crash
  { id: "altair-angular", repo: "imolorhe/altair", branch: "master", path: "packages/altair-app/src", preset: "", expect: null, degrade: true },
  // ---- Round 3: fresh real apps on new axes ----
  // leva: real React controls library demo. `leva/headless` (and @leva-ui/plugin-*/ workspace
  // packages) 404 on esm.sh's build servers — an esm.sh-side limitation, not a platform bug.
  { id: "leva",          repo: "pmndrs/leva", branch: "main", path: "demo", preset: "react", local: "src", expect: null, degrade: true },
  // solid-playground: REAL SolidJS Vite app. Solid JSX is NOT React, so detectPreset must NOT
  // pick the generic "jsx" preset (it transpiles JSX to the React runtime and renders nothing).
  // Egg for detection correctness — the app should degrade cleanly, not mount `SolidPlayground`.
  { id: "solid-playground", repo: "solidjs/solid-playground", branch: "main", path: "packages/playground", preset: "", expect: null, degrade: true },
  // vitesse: real Vue Vite app (pnpm `catalog:` deps). The catalog-version fix lets Vue resolve
  // and main.ts boot; it still needs vite-plugin-vue-layouts' `virtual:generated-layouts` codegen
  // (a Vite build step) so the full app doesn't mount — documented out-of-scope degrade.
  { id: "vitesse",      repo: "antfu/vitesse", branch: "main", path: "", preset: "vue", local: "src", expect: null, degrade: true },
  // element-plus play: real Vue component-library dev playground. Out of scope — unpublished
  // workspace `@element-plus/components/*/style` subpaths, `import.meta.glob`, and Sass theme need
  // a real build. Must degrade cleanly (document loads, no module-tier crash).
  { id: "element-plus", repo: "element-plus/element-plus", branch: "dev", path: "play", preset: "vue", local: "src", expect: null, degrade: true },
  // three.js examples: real static ES-module demos (deep relative ../../build imports, large files)
  { id: "threejs",      repo: "mrdoob/three.js", branch: "dev", path: "examples", preset: "", expect: /three\.js|WebGL|example|geometry/i },
  // mermaid demos: real static site — the index page renders its own DOM (a live link list), not
  // inline SVGs (those live per-demo pages).
  { id: "mermaid",      repo: "mermaid-js/mermaid", branch: "develop", path: "demos", preset: "", expect: /Mermaid|quick test|demo|flowchart/i },
  // ---- Round 4: fresh real apps on the supported build tiers ----
  // realworld-react: the classic CRA-style React RealWorld app — JSX lives inside .js files
  // (CRA never used .jsx for src files), which stresses the JSX-in-.js transform path plus
  // react-router v4 + redux.
  { id: "realworld-react", repo: "gothinkster/react-redux-realworld-example-app", branch: "master", path: "public", preset: "react", expect: /conduit|realworld|Sign in|New Post|Home|article|tag/i },
  // preact-www: the Preact website itself — the flagship real Preact app (preact, signals,
  // preact-iso router, markdown rendering).
  { id: "preact-www", repo: "preactjs/preact-www", branch: "master", path: "", preset: "preact", expect: /preact|Preact|learn|docs|Get started|Guide|components/i },
  // svelte-template: the official Svelte template (rollup, public/index.html) — validates the
  // Svelte tier end-to-end on the reference repo.
  { id: "svelte-template", repo: "sveltejs/template", branch: "master", path: "public", preset: "svelte", expect: /hello|world|svelte|Svelte|component|rollup/i },
  // snapshot: a heavy real Vue 3 voting app (@snapshot-labs/* published deps, apollo client,
  // ethers, web workers) — a full-scale stress test of the Vue tier.
  { id: "snapshot", repo: "snapshot-labs/snapshot", branch: "master", path: "", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true }, // @snapshot-labs/lock/connectors/* fail esm.sh's ?deps-pinned builds (portis etc.), and the app fetches its own spaces data (snapshot-spaces) the sandbox can't provide
  // vue-hackernews-2.0: a Vue 2 SSR app — detection must NOT pick the vue preset (the Vue 3
  // compiler can't run Vue 2 SFCs). No index.html at root, so it must degrade to "no web app"
  // without crashing. The detection fix itself is unit-tested in discover.test.ts.
  { id: "vue2-hn", repo: "vuejs/vue-hackernews-2.0", branch: "master", path: "", preset: "", expect: null, degrade: true },
  // Author's own fresh apps: ZipLayer (vanilla JS library + demo) and Sparrow-Offline-CRM
  // (offline-first static CRM SPA).
  { id: "ziplayer", repo: "Spuds0588/ZipLayer", branch: "main", path: "", preset: "", expect: /zip|Zip|download/i },
  { id: "sparrow-crm", repo: "Spuds0588/Sparrow-Offline-CRM", branch: "main", path: "", preset: "", expect: /sparrow|Sparrow|CRM|customer|client/i, expectHtml: true },
];

const results = [];
const filters = process.argv.slice(2);
const targets = filters.length ? REPOS.filter((r) => filters.some((f) => r.id.includes(f) || r.repo.includes(f))) : REPOS;

async function waitForServer() {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try { const r = await fetch(APP); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server did not start");
}

async function runRepo(browser, entry) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedReqs = [];
  const frameLogs = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      const text = msg.text();
      if (/\[edgeqa\]|Failed to load resource|net::ERR_/.test(text)) consoleErrors.push(text.slice(0, 300));
      else if (msg.type() === "error") consoleErrors.push(text.slice(0, 300));
    }
  });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));
  page.on("requestfailed", (req) => {
    const u = req.url();
    if (!u.startsWith(BASE) && !u.includes("esm.sh") && !u.includes("unpkg") && !u.includes("raw.githubusercontent")) return;
    failedReqs.push(`${req.failure()?.errorText || "failed"} ${u.slice(0, 160)}`);
  });

  const hash = new URLSearchParams({ repo: entry.repo, branch: entry.branch, public: "1" });
  if (entry.path) hash.set("path", entry.path);
  if (entry.preset) hash.set("preset", entry.preset);
  if (entry.local) hash.set("local", entry.local);
  if (entry.alias) hash.set("aliases", entry.alias);
  const started = Date.now();
  try {
    await page.goto(`${APP}#${hash.toString()}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    // The Viewer mounts the iframe only after the SW is ready
    await page.waitForSelector("#sandbox", { timeout: 25_000 });
    // The iframe element appears before its frame attaches (URL starts about:blank) — poll for
    // the sandbox frame. Note the build tier rewrites the frame's URL to "/" (client-side router
    // fix), so match the child frame rather than its path.
    let frame = null;
    for (let i = 0; i < 40 && !frame; i++) {
      frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(BASE));
      if (!frame) await page.waitForTimeout(500);
    }
    if (!frame) {
      const diag = await page.evaluate(() => ({
        hasSandbox: !!document.querySelector("#sandbox"),
        sandboxSrc: document.querySelector("#sandbox")?.getAttribute("src") || "",
        body: document.body.innerText.slice(0, 200),
        swController: !!navigator.serviceWorker?.controller,
      })).catch(() => null);
      const allFrames = page.frames().map((f) => f.url());
      throw new Error(`no sandbox frame found — ${JSON.stringify(diag)} frames=${JSON.stringify(allFrames)} console=${consoleErrors.slice(0, 3).join(" | ")} pageerr=${pageErrors.slice(0, 2).join(" | ")}`);
    }
    frame.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") frameLogs.push(`${msg.type()}: ${msg.text().slice(0, 250)}`);
    });
    await frame.waitForLoadState("load", { timeout: 30_000 });
    // Give the app's JS time to boot (esm.sh imports, framework mount)
    await page.waitForTimeout(entry.preset ? 14_000 : 7_000);
    const snapshot = await frame.evaluate(() => {
      const body = document.body;
      const text = (body?.innerText || "").replace(/\n+/g, " ").slice(0, 700);
      return {
        url: location.href,
        title: document.title,
        text,
        html: (document.documentElement?.outerHTML || "").slice(0, 3000),
        htmlLen: (document.documentElement?.outerHTML || "").length,
        bodyChildren: body ? body.children.length : -1,
      };
    });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    // Only EdgeQA-tier failures are fatal: unresolved/transpiled-away module specifiers,
    // compile output that doesn't parse, and compile-tier marker failures. App-level noise
    // (missing backend APIs, WebGL in headless, CORS'd analytics) must not fail a rendering app.
    const fatalErrors = [...consoleErrors, ...pageErrors, ...frameLogs].filter(
      (e) => /Failed to resolve module specifier|Failed to fetch dynamically imported module|Importing a module script failed|does not provide an export named|Cannot use import statement outside a module|Unexpected token|SyntaxError: Unexpected|SW-SVELTE-FAIL|SW-VUE-FAIL|SW-BABEL-FAIL|is not a function|is not defined/.test(e) && !/is not valid JSON/.test(e),
    );
    const rendered = entry.expect ? (entry.expectHtml ? entry.expect.test(snapshot.html) : entry.expect.test(snapshot.text)) : snapshot.htmlLen > 0;
    // degrade entries only need the document to load without module-tier failures (app-level
    // errors from unsupported stacks — Angular source, unpublished workspace packages — are
    // expected degradation, not bugs).
    const moduleFatal = [...consoleErrors, ...pageErrors, ...frameLogs].filter(
      (e) => /Failed to resolve module specifier|Failed to fetch dynamically imported module|Importing a module script failed|does not provide an export named|Cannot use import statement outside a module|SW-SVELTE-FAIL|SW-VUE-FAIL|SW-BABEL-FAIL/.test(e),
    );
    const pass = entry.degrade ? snapshot.htmlLen > 0 && moduleFatal.length === 0 : rendered && fatalErrors.length === 0;
    results.push({ id: entry.id, pass, rendered, fatalErrors: fatalErrors.slice(0, 5), consoleErrors: consoleErrors.slice(0, 5), pageErrors: pageErrors.slice(0, 3), frameLogs: frameLogs.slice(0, 5), failedReqs: failedReqs.slice(0, 6), elapsed, snapshot });
    console.log(`\n=== ${entry.id} (${entry.repo}${entry.path ? "/" + entry.path : ""} ${entry.preset || "static"}) — ${pass ? "PASS" : "FAIL"} in ${elapsed}s ===`);
    console.log(`  title: ${snapshot.title || "(none)"}`);
    console.log(`  body: ${snapshot.text.slice(0, 200) || "(EMPTY)"}`);
    if (fatalErrors.length) console.log(`  FATAL: ${fatalErrors.join(" ;; ")}`);
    if (consoleErrors.length) console.log(`  console: ${consoleErrors.join(" ;; ")}`);
    if (pageErrors.length) console.log(`  pageerror: ${pageErrors.join(" ;; ")}`);
    if (frameLogs.length) console.log(`  framelog: ${frameLogs.join(" ;; ")}`);
    if (failedReqs.length) console.log(`  netfail: ${failedReqs.join(" ;; ")}`);
  } catch (err) {
    results.push({ id: entry.id, pass: false, error: String(err).slice(0, 300), elapsed: ((Date.now() - started) / 1000).toFixed(1) });
    console.log(`\n=== ${entry.id} — ERROR in ${((Date.now() - started) / 1000).toFixed(1)}s ===\n  ${String(err).slice(0, 300)}`);
  } finally {
    await ctx.close();
  }
}

const server = spawn("bun", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: false });
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const entry of targets) {
    try { await runRepo(browser, entry); } catch (e) { console.log(`HARNESS ERROR ${entry.id}: ${e}`); }
  }
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n\n===== ROUND 2 SUMMARY: ${passed}/${results.length} passed =====`);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id}${r.error ? " — " + r.error : ""}`);
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
} finally {
  server.kill();
}
