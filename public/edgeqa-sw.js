// Shown in place of a bare 404 when a repo has no index.html to preview.
const WEB_ROOTS_MISSING_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No web page to preview</title></head><body style="margin:0;background:#f3f2ea;color:#18242a;font:600 15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"><div style="max-width:560px;margin:10vh auto;padding:0 22px"><div style="font-size:28px;margin-bottom:14px">🕸</div><h1 style="font-size:20px;margin:0 0 10px">Nothing to preview here</h1><p style="margin:0 0 8px;color:#44565c">EdgeQA previews web applications, and we couldn't find an <code style="background:#e4e4da;border-radius:4px;padding:1px 6px;font:600 12px ui-monospace,monospace">index.html</code> on this branch.</p><p style="margin:0 0 8px;color:#44565c">The page may live in a subfolder, or a different branch (check the <b>branch</b> and <b>site folder</b> on your QA link).</p></div></body></html>`;
// Shown when a tokenless preview can't fetch anything (the repo is private, or it
// has no public web content at this entry). Keeps the session locked rather than
// pretending a private repo is a misconfigured public one.
const LOCKED_PAGE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview locked</title></head><body style="margin:0;background:#f3f2ea;color:#18242a;font:600 15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"><div style="max-width:560px;margin:10vh auto;padding:0 22px"><div style="font-size:28px;margin-bottom:14px">🔒</div><h1 style="font-size:20px;margin:0 0 10px">This preview needs the session PIN</h1><p style="margin:0;color:#44565c">This is a private repository (or has no public web page at this path), so it can only be unlocked with the token held behind the session PIN.</p></div></body></html>`;
const rateLimitPage = () => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub rate limit</title></head><body style="margin:0;background:#f3f2ea;color:#18242a;font:600 15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"><div style="max-width:560px;margin:10vh auto;padding:0 22px"><div style="font-size:28px;margin-bottom:14px">⏳</div><h1 style="font-size:20px;margin:0 0 10px">GitHub is rate-limiting previews</h1><p style="margin:0;color:#44565c">Try again in a minute — or add a token to raise the limit. Your cached copy will be served if there is one.</p></div></body></html>`, { status: 429, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const CACHE_NAME = "edgeqa-vfs-v2"; // bump to invalidate cached content (e.g. when the demo example changes)
const CACHE_TTL_MS = 5 * 60 * 1000; // serve cached files for up to 5 minutes, then refetch from GitHub
const tokenByScope = new Map();
// The public example repo the "Try the live demo" flow points at. It is served
// without a token so visitors can preview the platform before bringing their own
// repo. Update this if the example project moves to another repo/path.
const DEMO_SCOPE = "Spuds0588/EdgeQA/main";
const VFS_TAG = "[edgeqa-sw]";
const log = (...args) => console.log(VFS_TAG, ...args);
const scopePath = (self.registration && self.registration.scope ? new URL(self.registration.scope).pathname : "/").replace(/\/$/, "") || "/";
log("service worker starting, scope", scopePath);
const mime = { html: "text/html", css: "text/css", scss: "text/css", sass: "text/css", less: "text/css", styl: "text/css", js: "application/javascript", mjs: "application/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", txt: "text/plain", map: "application/json" };

// --- Experimental in-browser build tier (react / preact / jsx+tsx / vue / svelte) ---
// Source repos are compiled and served entirely in the browser. JSX/TSX transpile through
// @babel/standalone in the worker; every bare npm import is rewritten at serve time to the
// esm.sh CDN, so ANY dependency a real app imports resolves — no hand-mapped allowlist.
// Vue .vue and Svelte .svelte compiler SDKs are ESM, and import() is banned on
// ServiceWorkerGlobalScope, so the worker delegates those to the controlling app page via
// a postMessage round-trip (the page dynamic-imports them off esm.sh). No server, no
// bundler, no token leaving the browser.
const BABEL_URL = "https://unpkg.com/@babel/standalone@7.26.4/babel.min.js";
const ESM_CDN = "https://esm.sh/";
const presetByScope = new Map();

// importScripts() is only legal in a service worker during install/evaluation, so load
// @babel/standalone lazily on first transpile via fetch + indirect eval (runs in the worker
// global scope, no CSP on this SW). Fails safe to raw bytes.
async function postDebug(payload) {
  try {
    const clients = await self.clients.matchAll();
    clients.forEach((client) => client.postMessage({ type: "EDGEQA_DEBUG", ...payload }));
  } catch { /* best-effort */ }
}
async function ensureBabel() {
  if (self.Babel) { postDebug({ babel: "already", has: !!self.Babel }); return true; }
  try {
    log("loading babel");
    const res = await fetch(BABEL_URL);
    if (!res.ok) {
      log("babel fetch failed", res.status);
      return false;
    }
    (0, eval)(await res.text());
    log("babel loaded", !!self.Babel);
    postDebug({ babel: "loaded", has: !!self.Babel });
    return !!self.Babel;
  } catch (error) {
    log("babel unavailable", String(error));
    return false;
  }
}

// Rewrite bare npm specifiers (react, react-dom/client, @tanstack/react-query, …) to
// absolute esm.sh URLs — esm.sh resolves subpaths/versions and bundles each package, so
// any dependency a real source app imports works here. Relative (./), absolute (/),
// and URL (https:/data:...) specifiers are left untouched.
function rewriteBareImports(js) {
  return js.replace(/((?:from\s+|import\s*\(|(?:^|[\n]\s*)import\s+|export\s+[^;]*?from\s+))(["'])([^\s"']+)(\2)/g, (m, ctx, q, spec, endq) => {
    if (spec && !spec.startsWith(".") && !spec.startsWith("/") && !/^data:|^[a-z][a-z0-9+.\-]*:/i.test(spec)) {
      return `${ctx}${q}${ESM_CDN}${spec}${endq}`;
    }
    return m;
  });
}

// Transpile JSX/TSX and rewrite CSS imports into stylesheet-link injectors (vite style
// `import "./App.css"`). Any remaining bare imports are rewritten to esm.sh so the browser
// resolves them without an import map.
function transpileModule(code, path, extraDir) {
  const isTs = /\.tsx?$/i.test(path);
  const presets = isTs ? [["react", { runtime: "automatic" }], "typescript"] : [["react", { runtime: "automatic" }]];
  const plugins = [["proposal-decorators", { legacy: true }], ["proposal-class-properties", { loose: true }]];
  const out = self.Babel.transform(code, { presets, plugins, filename: path, sourceMaps: false, comments: false });
  let js = out.code || "";
  // A directory-index module (./x -> ./x/index.jsx) is served at the extensionless URL
  // `/…/x`, so the browser resolves sibling imports (`./y`) against `/…` — one level up.
  // Real Vite rewrites those specifiers to the resolved path; here we prefix every
  // relative specifier with the directory offset (./y -> ./x/y, ../y -> ./y) so they
  // resolve against the module's true folder.
  if (extraDir) {
    js = js.replace(/((?:from\s+|import\s*\(|import\s+|export\s+[^;]*?from\s+))(["'])((?:\.\.?\/)[^"']*)/g, (m, ctx, q, rel) => `${ctx}${q}./${extraDir}/${rel}`);
  }
  return postProcessJs(js);
}

// Shared per-module post-processing for the JSX/plain-JS tiers served directly by this
// worker: Vite-style CSS imports become stylesheet-link injectors, image/asset imports
// become URL strings, and any remaining bare npm imports are rewritten to esm.sh.
// (Vue/Svelte output is post-processed on the page instead — see frame.ts.)
function postProcessJs(js) {
  const cssUrls = [];
  js = js.replace(/(?:import\s+(?:[^'"]*?\s+from\s+)?)(['"])([^'"]+?\.(?:css|scss|sass|less|styl))\1/g, (m, q, url) => { cssUrls.push(url); return ""; });
  js = js.replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+?\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp|mp4|webm|mp3|wav|ogg|woff2?|ttf|eot))\2/g, (m, name, q, url) => `const ${name} = new URL(${q}${url}${q}, import.meta.url).href;`);
  if (cssUrls.length) {
    const injector = cssUrls.map((u) => `(()=>{const l=document.createElement("link");l.rel="stylesheet";l.href=new URL(${JSON.stringify(u)},import.meta.url).href;document.head.appendChild(l);})();`).join("");
    js = injector + js;
  }
  return rewriteBareImports(js);
}

// ---- Vue/Svelte compile delegation to the app page ---------------------------------
// The page owns the esm.sh compiler imports (Vue/Svelte are ESM and import() is disallowed
// on ServiceWorkerGlobalScope). The worker posts an EDGEQA_COMPILE_REQUEST to its clients,
// the app page compiles + post-processes, and replies with EDGEQA_COMPILE_RESPONSE which
// resolves the pending fetch. Fails safe to the raw file if no page answers in time.
const compileSeq = { n: 0 };
const compilePending = new Map();
function compileViaClient(preset, code, path) {
  return new Promise((resolve) => {
    const id = "c" + (++compileSeq.n);
    const timeout = setTimeout(() => {
      compilePending.delete(id);
      log("compile round-trip timed out (no page answered)", path, preset);
      resolve({ ok: false });
    }, 15000);
    compilePending.set(id, { path, resolve: (ok, out) => { clearTimeout(timeout); resolve(ok ? { ok: true, code: out } : { ok: false }); } });
    self.clients.matchAll().then((clis) => clis.forEach((c) => c.postMessage({ type: "EDGEQA_COMPILE_REQUEST", id, preset, code, path })));
  });
}

// Rewrite app-root-absolute asset refs ("/src/main.tsx") to be relative to this document's
// directory — vite dev HTML treats "/x" as relative to the folder holding index.html, which
// is exactly what the sandbox entry document represents. Bare-import resolution happens
// per-module (see rewriteBareImports), so no import map is needed.
function transformHtml(html) {
  return html.replace(/((?:src|href|poster)=[""])\/(?!\/)([^""]*)/g, (m, pre, p) => `${pre}${p}`);
}

// Returns a transformed Response, or null when no transform applies (or the compiler for the
// active preset is unavailable) so the caller serves the original bytes.
async function applyPreset(res, info, extraDir, preset) {
  try {
    const p = info.path;
    if (/\.html?$/i.test(p)) {
      const text = await res.text();
      return new Response(transformHtml(text) + "<!--SW-DONE-->", { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    const jsResp = (marker, body) => new Response(marker + body, { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" } });
    if (preset === "svelte" && /\.svelte$/i.test(p)) {
      const text = await res.text();
      const r = await compileViaClient("svelte", text, p);
      return jsResp(r.ok ? "/*SW-SVELTE*/" : "/*SW-SVELTE-FAIL*/", r.ok ? r.code : text);
    }
    if (preset === "vue" && /\.vue$/i.test(p)) {
      const text = await res.text();
      const r = await compileViaClient("vue", text, p);
      return jsResp(r.ok ? "/*SW-VUE*/" : "/*SW-VUE-FAIL*/", r.ok ? r.code : text);
    }
    if (/\.(jsx|tsx|ts)$/i.test(p)) {
      const text = await res.text();
      if (!(await ensureBabel())) return jsResp("/*SW-BABEL-FAIL*/", text);
      return jsResp("/*SW-TRANSPILED*/", transpileModule(text, p, extraDir));
    }
    // Plain ESM source (.js/.mjs) that isn't a build artifact: no JSX/SFC to transpile, but
    // still run the shared post-processing (CSS/asset imports -> injectors/URLs, bare npm
    // imports -> esm.sh) so depend-sparse entry files (Vue/Svelte main.js) load. Skipped for
    // build output folders so committed bundles pass through untouched.
    if (/\.(js|mjs)$/i.test(p) && !/(^|\/)(dist|build|out|output|bundles|bundle)\/|(^|\/)(dist|bundle)[^/]*\.js/i.test(p)) {
      const text = await res.text();
      return jsResp("/*SW-REWRITTEN*/", postProcessJs(text));
    }
  } catch (error) { log("preset transform failed", info.path, preset, String(error)); }
  return null;
}

self.addEventListener("install", () => { log("install: skipping wait"); self.skipWaiting(); });
self.addEventListener("activate", (event) => {
  log("activate: claiming clients");
  event.waitUntil((async () => {
    await self.clients.claim();
    const old = await caches.keys();
    await Promise.all(old.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    if (old.length > 1) log("removed stale caches:", old.join(", "));
  })());
});
self.addEventListener("message", (event) => {
  const { type, scope } = event.data || {};
  log("message", type, scope || "");
  if (type === "SET_TOKEN" && scope && event.data.token && !tokenByScope.has(scope)) {
    tokenByScope.set(scope, event.data.token); log("session unlocked for", scope);
  }
  if (type === "SET_PRESET" && scope && event.data.preset) {
    presetByScope.set(scope, event.data.preset); log("preset", event.data.preset, "for", scope);
  }
  if (type === "EDGEQA_COMPILE_RESPONSE") {
    const pending = compilePending.get(event.data.id);
    if (pending) { compilePending.delete(event.data.id); pending.resolve(!!event.data.ok, event.data.code); log("compile reply", pending.path, event.data.ok); }
  }
  if (type === "CLEAR_CACHE") { log("clearing cache"); event.waitUntil(caches.delete(CACHE_NAME)); }
});

function parseVirtual(url) {
  let path = new URL(url).pathname;
  if (scopePath !== "/" && path.startsWith(scopePath + "/")) path = path.slice(scopePath.length);
  if (!path.startsWith("/")) path = "/" + path;
  const match = path.match(/^\/sandbox\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/);
  return match && { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]), branch: decodeURIComponent(match[3]), path: match[4] || "index.html" };
}
function contentType(path) { return mime[path.split(".").pop()?.toLowerCase()] || "application/octet-stream"; }
function decodeBase64(value) { const binary = atob(value.replace(/\n/g, "")); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }
function scopeOf(info) { return `${info.owner}/${info.repo}/${info.branch}`; }
async function githubFile(info, token) {
  // Public repos (no token): serve straight from raw.githubusercontent.com. Its rate
  // limits dwarf the anonymous API's 60/hr, it needs no JSON/base64 round-trip, and
  // it's CORS-open — so tokenless previews barely touch the API budget at all.
  if (!token) {
    const rawUrl = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${info.path.split("/").map(encodeURIComponent).join("/")}`;
    log("fetch raw", info.path, ">", rawUrl);
    const rawResponse = await fetch(rawUrl);
    if (!rawResponse.ok) {
      if (rawResponse.status === 429 || (rawResponse.status === 403 && Number(rawResponse.headers.get("x-ratelimit-remaining")) === 0)) { log("rate-limited", info.path, rawResponse.status); return rateLimitPage(); }
      log("raw miss", info.path, rawResponse.status); return null;
    }
    const rawBody = await rawResponse.arrayBuffer();
    return new Response(rawBody, { headers: { "Content-Type": contentType(info.path), "Cache-Control": "no-store" } });
  }
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` };
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/contents/${info.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(info.branch)}`;
  log("fetch contents", info.path, ">", endpoint);
  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    if (response.status === 429 || (response.status === 403 && Number(response.headers.get("x-ratelimit-remaining")) === 0)) { log("rate-limited", info.path, response.status); return rateLimitPage(); }
    log("contents miss", info.path, response.status); return null;
  }
  const item = await response.json();
  if (item.type !== "file") { log("not a file", info.path, item.type); return null; }
  if (item.size > 100 * 1024 * 1024) {
    const warning = { type: "EDGEQA_WARNING", message: `${info.path} is over 100MB and was replaced with a safe placeholder.` };
    const clients = await self.clients.matchAll(); clients.forEach((client) => client.postMessage(warning));
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(info.path)) return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340"><rect width="100%" height="100%" fill="#18242a"/><text x="50%" y="50%" fill="#c9f36b" text-anchor="middle" font-family="sans-serif">Asset too large for browser preview</text></svg>`, { headers: { "Content-Type": "image/svg+xml" } });
    return new Response("", { headers: { "Content-Type": contentType(info.path) } });
  }
  let body;
  if (item.content) { log("decoded base64", info.path, item.size, "bytes"); body = decodeBase64(item.content); }
  else if (item.sha) {
    log("blob fallback", info.path, item.sha);
    const blobResponse = await fetch(`https://api.github.com/repos/${info.owner}/${info.repo}/git/blobs/${item.sha}`, { headers });
    if (!blobResponse.ok) { if (blobResponse.status === 429 || (blobResponse.status === 403 && Number(blobResponse.headers.get("x-ratelimit-remaining")) === 0)) { log("rate-limited", info.path, blobResponse.status); return rateLimitPage(); } log("blob miss", info.path, blobResponse.status); return null; }
    const blob = await blobResponse.json(); body = blob.encoding === "base64" ? decodeBase64(blob.content) : new TextEncoder().encode(blob.content);
  }
  return body ? new Response(body, { headers: { "Content-Type": contentType(info.path), "Cache-Control": "no-store" } }) : null;
}
// Never let a network failure (offline, DNS, GitHub blip) throw out of the fetch handler —
// return null so the caller can fall back to a cached copy instead of breaking the preview.
async function githubFileSafe(info, token) {
  try { return await githubFile(info, token); }
  catch (error) { log("github fetch error", info.path, String(error)); return null; }
}
// Vite-style module resolution for source repos under an active preset: maps an
// extensionless import (./pythagoras) to ./pythagoras.jsx and a bare directory
// (./people) to ./people/index.tsx. Probes raw.githubusercontent (cheap, no API
// budget) for each candidate; returns the first real file, or null. This only runs
// after a genuine miss and is gated to non-document requests, so SPA routing is
// unaffected — a navigation to /pythagoras still gets the SPA/index.html fallback.
const SOURCE_EXTS = ["js", "mjs", "jsx", "ts", "tsx", "svelte", "vue"];
async function resolveModule(info, token) {
  const slash = info.path.lastIndexOf("/");
  const dir = slash >= 0 ? info.path.slice(0, slash) : "";
  const name = info.path.slice(slash + 1);
  const prefix = dir ? dir + "/" : "";
  for (const ext of SOURCE_EXTS) {
    const cand = `${prefix}${name}.${ext}`;
    const r = await githubFileSafe({ ...info, path: cand }, token);
    if (r && r.status === 200) return { ...info, path: cand };
  }
  for (const ext of SOURCE_EXTS) {
    const cand = `${prefix}${name}/index.${ext}`;
    const r = await githubFileSafe({ ...info, path: cand }, token);
    if (r && r.status === 200) return { ...info, path: cand };
  }
  return null;
}
self.addEventListener("fetch", (event) => {
  let info = parseVirtual(event.request.url); if (!info) return;
  log("intercept", info.owner + "/" + info.repo + "/" + info.branch + "/" + info.path);
  postDebug({ intercept: info.path, preset: presetByScope.get(scopeOf(info)) || "" });
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    // HTML documents are always revalidated so a dev's push lands on the tester's next
    // reload; static assets are served from cache for up to CACHE_TTL_MS, then refetched.
    const isHtml = contentType(info.path) === "text/html";
    if (cached && !isHtml && Date.now() - Number(cached.headers.get("x-edgeqa-cached-at") || 0) < CACHE_TTL_MS) { log("cache hit", info.path); return cached; }
    if (cached) log(isHtml ? "html — refetching" : "cache stale — refetching", info.path);
    const token = tokenByScope.get(scopeOf(info));
    const preset = presetByScope.get(scopeOf(info));
    let response = await githubFileSafe(info, token);
    // Only document/navigation requests (routes and .html pages) get SPA fallback;
    // a missing asset (js/css/img/json…) is a plain 404, never an HTML page in its place.
    // Documents fall back to the nearest directory's index.html first, then repo root,
    // so subfolder sites (docs/, DualBoy/src/, public/views/) resolve their own root.
    const looksLikeAsset = /\.[a-z0-9]{2,6}$/i.test(info.path) && !/\.html?$/i.test(info.path);
    // Build-tier module resolution: source repos import modules extensionless and by
    // directory (./c -> ./c.jsx, ./people -> ./people/index.tsx). Only when a preset is
    // active, after a genuine miss, and for non-document requests, so SPA routes still
    // fall through to their index.html instead of being mis-resolved as modules.
    let extraDir = "";
    if (preset && !response && !looksLikeAsset && event.request.destination !== "document") {
      const requestPath = info.path;
      const resolved = await resolveModule(info, token);
      if (resolved) {
        const reqDir = requestPath.slice(0, requestPath.lastIndexOf("/"));
        const resDir = resolved.path.slice(0, resolved.path.lastIndexOf("/"));
        if (resDir !== reqDir) extraDir = resDir.slice(reqDir ? reqDir.length + 1 : 0);
        info = resolved;
        response = await githubFileSafe(resolved, token);
        log("resolved module", info.path, "extraDir", extraDir || "-");
      }
    }
    if (!response && !looksLikeAsset && info.path !== "index.html") {
      log("spa fallback", info.path);
      const dir = info.path.slice(0, info.path.lastIndexOf("/"));
      if (dir) response = await githubFileSafe({ ...info, path: `${dir}/index.html` }, token);
      if (!response) response = await githubFileSafe({ ...info, path: "index.html" }, token);
    }
    // Experimental build tier: when this scope carries a preset, transform the response
    // (transpile JSX/TSX, compile Vue/Svelte, rewrite the HTML) before caching.
    if (preset && response && response.status === 200) {
      const transformed = await applyPreset(response, info, extraDir, preset);
      if (transformed) { log("preset", preset, "applied to", info.path); response = transformed; }
    }
    if (response && response.status === 429) {
      if (cached) { log("rate-limited — serving cached copy", info.path); return cached; }
      log("rate-limited", info.path); return response;
    }
    if (!response) {
      // Refetch failed (rate limit, transient error): serve any cached copy rather than break the preview.
      if (cached) { log("refetch failed — serving cached copy", info.path); return cached; }
      const plain404 = new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
      if (token) { log("no web app", info.path); return looksLikeAsset ? plain404 : new Response(WEB_ROOTS_MISSING_HTML, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
      // Tokenless and GitHub anonymous fetch came up empty: this is a private repo (or
      // has no public web content at this entry). Keep the preview locked rather than proxy
      // material we couldn't fetch — the token behind the session PIN unlocks it. Only the
      // document itself gets the locked page; subresources fail cleanly as 404s so scripts
      // never receive HTML bytes.
      log("locked, anonymous fetch failed for", scopeOf(info)); return looksLikeAsset ? plain404 : new Response(LOCKED_PAGE_HTML, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (response.status === 200) {
      const headers = new Headers(response.headers);
      headers.set("x-edgeqa-cached-at", String(Date.now()));
      await cache.put(event.request, new Response(response.clone().body, { status: response.status, statusText: response.statusText, headers }));
      log("cached", info.path);
    }
    return response;
  })());
});
log("service worker ready");