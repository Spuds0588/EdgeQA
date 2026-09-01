// Round 2: real-repo testing harness. Loads each repo's preview through the actual
// EdgeQA flow (hash link -> Viewer -> service worker VFS -> in-browser build tier)
// in real Chromium, then reports what rendered and what broke.
//
// Usage: bun scripts/round2.mjs            (full run, all repos)
//        bun scripts/round2.mjs vue3-element-admin   (one repo)
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
  // ---- Round 5: fresh real apps stressing new building blocks ----
  // reactflow-vite: the React Flow (now @xyflow/react) official Vite example — real node/canvas
  // app on a heavy maintained library. Stresses alias-free Vite resolution + a large dep tree.
  { id: "reactflow-vite", repo: "xyflow/react-flow-example-apps", branch: "main", path: "reactflow-vite", preset: "react", expect: /React Flow|reactflow|node|canvas|edge/i },
  // r3f-example: the react-three-fiber repo's own bundled example — three.js + @react-three/drei
  // + zustand + wouter through the esm.sh build servers. WebGL in headless Chromium likely can't
  // paint, but the 3D scene + HUD must mount without module-tier failures.
  { id: "r3f-example", repo: "pmndrs/react-three-fiber", branch: "master", path: "example", preset: "react", expect: null },
  // vue-pure-admin: a mammoth real Vue3 + Vite + Element-Plus + Pinia admin (60+ runtime deps,
  // mock-service-worker, vite plugin codegen, import.meta.glob route/table maps). The in-browser
  // build tier isn't expected to boot the full app — it must degrade cleanly to the Document root,
  // not crash the module graph.
  { id: "vue-pure-admin", repo: "pure-admin/vue-pure-admin", branch: "main", path: "", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true, loadTimeout: 90_000 },
  // vue-naive-admin: real Vue3 + Vite + Pinia + UnoCSS admin using Naive UI. Naive UI is heavy
  // but published — a realistic test of a component-library admin booting from source.
  { id: "vue-naive-admin", repo: "zclzone/vue-naive-admin", branch: "2.x", path: "", preset: "vue", alias: "@:src", local: "src", expect: /登录|登录页|n-config-provider|admin|naive|体验/i, loadTimeout: 90_000 },
  // trucast: a real Svelte 5 (runes) + TS + Vite static weather app — the first Svelte 5-runes
  // repo in the suite, so it stresses the Svelte 5 compiler/CSS/script-block paths, not classic
  // Svelte 3/4 syntax. Vanilla Svelte, zero runtime deps beyond the compiler.
  { id: "trucast", repo: "CrooksJeremy/TrueCast-Weather", branch: "main", path: "", preset: "svelte", local: "src", expect: /weather|Weather|forecast|TrueCast|humidity|wind/i, expectHtml: true },
  // mismo: author's fresh MISMO 3.4 XML library + browser demo (vanilla web component, tokenless).
  { id: "mismo", repo: "Spuds0588/MISMO.js", branch: "main", path: "", preset: "", expect: /MISMO|mismo|XML|xml|demo|generate/i, expectHtml: true },
  // ---- Round 6: more real Vue admin apps across UI libraries ----
  // geeker-admin: a real Vue3 + Vite + Element-Plus + Pinia admin (6.8k★). Single app in src,
  // uses @ element-plus, vue-i18n, echarts, wangEditor. Stresses the Vue SFC tier on a
  // mainstream element-plus admin.
  { id: "geeker-admin", repo: "HalseySpicy/Geeker-Admin", branch: "master", path: "", preset: "vue", alias: "@:src", local: "src", expect: /登录|geeker|admin|管理|element/i, loadTimeout: 60_000 },
  // vue3-antd-admin: a real Vue3 + Vue3 + Vite + Ant Design Vue admin (4.1k★). ant-design-vue
  // is a heavy but published component library — a different UI library path than element/naive.
  { id: "vue3-antd-admin", repo: "buqiyuan/vue3-antd-admin", branch: "main", path: "", preset: "vue", alias: "@:src", local: "src", expect: /登录|antd|admin|管理|Ant Design/i, loadTimeout: 60_000 },
  // naive-ui-admin: a real Vue3 + Vite + Naive UI + TS admin (5.9k★). The jekip/naive-ui-admin
  // repo already booted in Round 5 testing, so this is a second naive-ui admin with a distinct
  // architecture (alova, vue-types, mockjs) to widen naive-ui coverage.
  { id: "jekip-naive-admin", repo: "jekip/naive-ui-admin", branch: "main", path: "", preset: "vue", alias: "@:src", local: "src", expect: /登录|naive|admin|管理|NaiveUI/i, loadTimeout: 60_000 },
  // soybean-admin: a heavyweight real Vue3 admin (14.9k★) tuned to Ant Design Vue + Tailwind +
  // UnoCSS. Uses unpublished workspace `@sa/*` packages, so must degrade cleanly (like refine-crm).
  { id: "soybean-admin", repo: "soybeanjs/soybean-admin", branch: "main", path: "", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true, loadTimeout: 60_000 },
  // vben-admin: the reference Vue3 admin monorepo (33k★). Web entries live in apps/web-* and consume
  // unpublished workspace `@vben/*` + `@sa/*` packages + internal UI packages, so it must degrade
  // cleanly to the Document root (whole app is a workspace build).
  { id: "vben-admin", repo: "vbenjs/vue-vben-admin", branch: "main", path: "apps/web-antd", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true, loadTimeout: 90_000 },
  // ---- Round 7: more real Vue admin apps — new UI libraries, vue-cli-era source, monorepo degrades ----
  // vue3-element-admin: a real Vue3 + Vite + Element-Plus + Pinia + TS admin (2.6k★) with
  // @wangeditor-next, codemirror, exceljs, echarts deps. Pinia auto-imports now inject defineStore,
  // but the stores/ tree has circular re-exports (index -> user -> index) that hit Chrome's
  // directory-index TDZ edge — same issue documented for vue3-antd-admin.
  { id: "vue3-element-admin", repo: "youlaitech/vue3-element-admin", branch: "master", path: "", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true, loadTimeout: 90_000 },
  // ruoyi-vue3: the canonical RuoYi framework admin (6.7k★) — Vue3 + element-plus + pinia, entry
  // src/main.js. Stresses deep element-plus ESM subpath imports, virtual:svg-icons-register shim,
  // and scss-served-as-css. Degrades on file-saver: esm.sh wraps it as default-only CJS,
  // so `import { saveAs } from 'file-saver'` fails the browser's static named-export check.
  { id: "ruoyi-vue3", repo: "yangzongzhuan/RuoYi-Vue3", branch: "master", path: "", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true, loadTimeout: 90_000 },
  // arco-pro: the official Arco Design Vue Pro app (1.8k★) living in arco-design-pro-vite/ — a THIRD
  // UI library (arco, vs element/naive/antd), committed .env.development/.env.production, TS entry.
  // Degrades on esm.sh CDN race: vue-router@4.6.4's pinned build hash sometimes returns a
  // truncated variant that fails with SyntaxError in the browser (healthy via curl).
  { id: "arco-pro", repo: "arco-design/arco-design-pro-vue", branch: "main", path: "arco-design-pro-vite", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true, loadTimeout: 90_000 },
  // vue-admin-better: the 18.9k★ admin (vue3.0-antdv branch = Vue 3 + Ant Design Vue) built with
  // vue-cli: index.html lives in public/ (bridged to src/main.js like CRA) and main.js branches on
  // process.env.NODE_ENV — the document-scope process shim must be dev-flavored so the require()-based
  // production mock branch never runs in the browser. Alias targets are site-root-relative, so @ must
  // point up out of public/ to the repo-root src/. The webpack require.context + AMD define shims
  // prevent module-graph crashes, but the app can't fully mount (mock/plugin loading returns empty).
  { id: "vue-admin-better", repo: "zxwk1998/vue-admin-better", branch: "vue3.0-antdv", path: "public", preset: "vue", alias: "@:../src", local: "src", expect: null, degrade: true, loadTimeout: 90_000 },
  // vea-admin: kailong321200875's vue-element-plus-admin (3.7k★) — apps/admin consumes unpublished
  // workspace @vea/* packages, so the app can't boot from source; it must degrade cleanly (like vben).
  { id: "vea-admin", repo: "kailong321200875/vue-element-plus-admin", branch: "master", path: "apps/admin", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true, loadTimeout: 90_000 },
  // fantastic: the hooray fantastic-admin element-plus app (3.4k★) from the fantastic-admin/basic
  // monorepo — apps/core-element-plus consumes unpublished workspace @core/* packages + pnpm catalog:
  // deps; must degrade cleanly.
  { id: "fantastic", repo: "fantastic-admin/basic", branch: "main", path: "apps/core-element-plus", preset: "vue", alias: "@:src", local: "src", expect: null, degrade: true, loadTimeout: 90_000 },
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
  const started = Date.now();
  const runAttempt = async () => {
    const consoleErrors = [];
    const pageErrors = [];
    const failedReqs = [];
    const frameLogs = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        const text = msg.text();
        const loc = msg.location()?.url ? ` @ ${msg.location().url}` : "";
        if (/\[edgeqa\]|Failed to load resource|net::ERR_/.test(text)) consoleErrors.push(text.slice(0, 300) + loc);
        else if (msg.type() === "error") consoleErrors.push(text.slice(0, 300) + loc);
      }
    });
    page.on("pageerror", (err) => {
      // Stack head carries the failing module URL for module-parse errors.
      const stack = (err.stack || "").split("\n").slice(0, 2).join(" | ");
      pageErrors.push(`${String(err).slice(0, 220)}${stack && !stack.includes(err.message) ? " :: " + stack.slice(0, 160) : ""}`);
    });
    page.on("requestfailed", (req) => {
      const u = req.url();
      if (!u.startsWith(BASE) && !u.includes("esm.sh") && !u.includes("unpkg") && !u.includes("raw.githubusercontent")) return;
      failedReqs.push(`${req.failure()?.errorText || "failed"} ${u.slice(0, 160)}`);
    });

  if (process.env.EDGEQA_TRACE) {
    await page.route("**esm.sh/**", async (route) => {
      const resp = await route.fetch();
      const body = await resp.body();
      console.log(`  [esm-trace ${resp.status()}] ${route.request().url().slice(0, 110)} len=${body.length} head=${new TextDecoder().decode(body.slice(0, 60)).replace(/\n/g, " ")}`);
      route.fulfill({ response: resp, body });
    });
  }
  const hash = new URLSearchParams({ repo: entry.repo, branch: entry.branch, public: "1" });
  if (entry.path) hash.set("path", entry.path);
  if (entry.preset) hash.set("preset", entry.preset);
  if (entry.local) hash.set("local", entry.local);
  if (entry.alias) hash.set("aliases", entry.alias);
    // Warm the esm.sh cold-build path: the app's first parallel burst can hit a build-in-
    // progress variant (truncated response, 512-byte stub) that permanently fails that load.
    // Import the entry's own wrapper URLs from a background page so the CDN build settles
    // before the sandbox asks. Only pre-warms the handful of top-level imports; the rest of
    // the graph benefits from the warm edge anyway.
    try {
      const warm = await ctx.newPage();
      await warm.goto("about:blank");
      const entrySrc = await page.evaluate(() => document.querySelector("#sandbox")?.getAttribute("src") || "");
      const warmImports = (entrySrc.match(/https:\/\/esm\.sh\/[^"'&?#\s]+/g) || []).slice(0, 6);
      for (const u of warmImports) {
        await warm.evaluate(async (url) => { try { await import(/* @vite-ignore */ url); } catch {} }, u).catch(() => {});
      }
      await warm.close().catch(() => {});
    } catch { /* prewarm is best-effort */ }
    // Raw CDP exceptions carry the source URL for module-eval/parse errors that cross the
    // realm boundary without a stack ("Cannot access 'x' before initialization", etc.)
    const cdp = await ctx.newCDPSession(page);
    const cdpErrors = [];
    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      const u = exceptionDetails?.url || (exceptionDetails?.exception?.description || "").match(/at (https?:\/\/[^ ]+)/)?.[1] || "";
      const msg = exceptionDetails?.exception?.description || exceptionDetails?.text || "";
      if (u || msg.includes("Cannot access") || /SyntaxError|Unexpected/.test(msg)) cdpErrors.push(`${msg.slice(0, 160)} ${u ? "@ " + u.slice(-140) : ""}`.trim());
    });
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
      if (process.env.EDGEQA_DEBUG_CONSOLE) console.log(`  [frame-${msg.type()}] ${msg.text().slice(0, 280)}${msg.location()?.url ? " @ " + msg.location().url : ""}`);
      if (msg.type() === "error" || msg.type() === "warning") {
        // Include the source URL — Chromium points at the failing module for parse errors.
        const loc = msg.location()?.url ? ` @ ${msg.location().url}` : "";
        frameLogs.push(`${msg.type()}: ${msg.text().slice(0, 250)}${loc}`);
      }
    });
    await frame.waitForLoadState("load", { timeout: entry.loadTimeout || 30_000 });
    // Give the app's JS time to boot (esm.sh imports, framework mount)
    await page.waitForTimeout(entry.preset ? 14_000 : 7_000);
    if (process.env.EDGEQA_INSPECT_URL) {
      const perf = await frame.evaluate(() => {
        const bad = performance.getEntriesByType("resource").filter((r) => r.name.includes("esm.sh") && (!r.decodedBodySize || r.decodedBodySize < 200));
        const vrs = performance.getEntriesByType("resource").filter((r) => r.name.includes("vue-router"));
        return { total: performance.getEntriesByType("resource").length, bad: bad.slice(0, 4).map((r) => ({ n: r.name.slice(-70), dec: r.decodedBodySize })), vrs: vrs.map((r) => ({ n: r.name.slice(-70), dec: r.decodedBodySize })) };
      }).catch(() => null);
      console.log(`  perf-esm: ${JSON.stringify(perf)}`);
      const frameInsp = await frame.evaluate(async (u) => {
        try { const m = await import(/* @vite-ignore */ u); return "FRAME-OK " + Object.keys(m).slice(0, 4).join(","); }
        catch (e) { return "FRAME-FAIL " + String(e).slice(0, 200); }
      }, process.env.EDGEQA_INSPECT_URL).catch((e) => "frame-eval-error: " + String(e).slice(0, 120));
      console.log(`  frame-import ${process.env.EDGEQA_INSPECT_URL.slice(0, 100)}: ${frameInsp}`);
      const insp = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u);
          const t = await r.text();
          let parse = "ok";
          try { new Function(t); } catch (e) { parse = "FUNCFAIL " + String(e).slice(0, 80); }
          let module = "n/a";
          try { const m = await import(/* @vite-ignore */ u); module = "OK " + Object.keys(m).slice(0, 4).join(","); }
          catch (e) { module = "IMPORTFAIL " + String(e).slice(0, 130); }
          return { status: r.status, len: t.length, head: t.slice(0, 70), parse, module };
        } catch (e) { return { err: String(e).slice(0, 180) }; }
      }, process.env.EDGEQA_INSPECT_URL);
      console.log(`  inspect ${process.env.EDGEQA_INSPECT_URL.slice(0, 110)}: ${JSON.stringify(insp)}`);
    }
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
    for (const e of cdpErrors.slice(0, 4)) console.log(`  cdp: ${e}`);
    const fatalErrors = [...consoleErrors, ...pageErrors, ...frameLogs, ...cdpErrors].filter(
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
    // Any EdgeQA-tier fatal is potentially a cold esm.sh race; app-level noise never reaches
    // fatalErrors, so a retry stays cheap and focused.
    return { pass, retryable: fatalErrors.length > 0, rendered, fatalErrors: fatalErrors.slice(0, 5), consoleErrors: consoleErrors.slice(0, 5), pageErrors: pageErrors.slice(0, 3), frameLogs: frameLogs.slice(0, 5), failedReqs: failedReqs.slice(0, 6), elapsed, snapshot };
  };
  try {
    let res = await runAttempt();
    // esm.sh cold-build/edge races occasionally serve a truncated module on the first burst of
    // parallel fetches (arco loads ~200 modules at once). Module-tier failures are retriable
    // by a fresh load; app-level noise must not trigger it.
    if (!res.pass && res.retryable) {
      console.log(`  [retry] ${entry.id}: module-tier failure, reloading once`);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
      res = await runAttempt();
      res.retried = true;
    }
    results.push({ id: entry.id, pass: res.pass, rendered: res.rendered, fatalErrors: res.fatalErrors, consoleErrors: res.consoleErrors, pageErrors: res.pageErrors, frameLogs: res.frameLogs, failedReqs: res.failedReqs, elapsed: res.elapsed, snapshot: res.snapshot, retried: res.retried });
    console.log(`\n=== ${entry.id} (${entry.repo}${entry.path ? "/" + entry.path : ""} ${entry.preset || "static"}) — ${res.pass ? "PASS" : "FAIL"} in ${res.elapsed}s${res.retried ? " (retried)" : ""} ===`);
    const fatalErrors = res.fatalErrors;
    const snapshot = res.snapshot;
    const consoleErrors = res.consoleErrors;
    const pageErrors = res.pageErrors;
    const frameLogs = res.frameLogs;
    const failedReqs = res.failedReqs;
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
