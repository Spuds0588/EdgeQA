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
  const headers = token ? { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } : { Accept: "application/vnd.github+json" };
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/contents/${info.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(info.branch)}`;
  log("fetch contents", info.path, ">", endpoint);
  const response = await fetch(endpoint, { headers });
  if (!response.ok) { log("contents miss", info.path, response.status); return null; }
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
    if (!blobResponse.ok) { log("blob miss", info.path, blobResponse.status); return null; }
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
    if (!token && scopeOf(info) !== DEMO_SCOPE) { log("locked, no token for", scopeOf(info)); return new Response("EdgeQA session is locked", { status: 401 }); }
    let response = await githubFileSafe(info, token);
    if (!response && info.path !== "index.html") { log("spa fallback", info.path); response = await githubFileSafe({ ...info, path: "index.html" }, token); }
    if (!response) {
      // Refetch failed (rate limit, transient error): serve any cached copy rather than break the preview.
      if (cached) { log("refetch failed — serving cached copy", info.path); return cached; }
      log("404", info.path); return new Response("File not found", { status: 404 });
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
