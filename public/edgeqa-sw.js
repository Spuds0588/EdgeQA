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
const mime = { html: "text/html", css: "text/css", js: "application/javascript", mjs: "application/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", txt: "text/plain", map: "application/json" };

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
self.addEventListener("fetch", (event) => {
  const info = parseVirtual(event.request.url); if (!info) return;
  log("intercept", info.owner + "/" + info.repo + "/" + info.branch + "/" + info.path);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    // HTML documents are always revalidated so a dev's push lands on the tester's next
    // reload; static assets are served from cache for up to CACHE_TTL_MS, then refetched.
    const isHtml = contentType(info.path) === "text/html";
    if (cached && !isHtml && Date.now() - Number(cached.headers.get("x-edgeqa-cached-at") || 0) < CACHE_TTL_MS) { log("cache hit", info.path); return cached; }
    if (cached) log(isHtml ? "html — refetching" : "cache stale — refetching", info.path);
    const token = tokenByScope.get(scopeOf(info));
    let response = await githubFileSafe(info, token);
    // Only document/navigation requests (routes and .html pages) get SPA fallback;
    // a missing asset (js/css/img/json…) is a plain 404, never an HTML page in its place.
    // Documents fall back to the nearest directory's index.html first, then repo root,
    // so subfolder sites (docs/, DualBoy/src/, public/views/) resolve their own root.
    const looksLikeAsset = /\.[a-z0-9]{2,6}$/i.test(info.path) && !/\.html?$/i.test(info.path);
    if (!response && !looksLikeAsset && info.path !== "index.html") {
      log("spa fallback", info.path);
      const dir = info.path.slice(0, info.path.lastIndexOf("/"));
      if (dir) response = await githubFileSafe({ ...info, path: `${dir}/index.html` }, token);
      if (!response) response = await githubFileSafe({ ...info, path: "index.html" }, token);
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
