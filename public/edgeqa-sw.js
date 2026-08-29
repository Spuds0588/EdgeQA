const CACHE_NAME = "edgeqa-vfs-v1";
const tokenByScope = new Map();
const mime = { html: "text/html", css: "text/css", js: "application/javascript", mjs: "application/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", txt: "text/plain", map: "application/json" };

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_TOKEN" && event.data.scope && event.data.token) tokenByScope.set(event.data.scope, event.data.token);
  if (event.data?.type === "CLEAR_CACHE") event.waitUntil(caches.delete(CACHE_NAME));
});

function parseVirtual(url) {
  const match = new URL(url).pathname.match(/^\/sandbox\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/);
  return match && { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]), branch: decodeURIComponent(match[3]), path: match[4] || "index.html" };
}
function contentType(path) { return mime[path.split(".").pop()?.toLowerCase()] || "application/octet-stream"; }
function decodeBase64(value) { const binary = atob(value.replace(/\n/g, "")); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }
function scopeOf(info) { return `${info.owner}/${info.repo}/${info.branch}`; }
async function githubFile(info, token) {
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` };
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/contents/${info.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(info.branch)}`;
  const response = await fetch(endpoint, { headers });
  if (!response.ok) return null;
  const item = await response.json();
  if (item.type !== "file") return null;
  if (item.size > 100 * 1024 * 1024) {
    const warning = { type: "EDGEQA_WARNING", message: `${info.path} is over 100MB and was replaced with a safe placeholder.` };
    const clients = await self.clients.matchAll(); clients.forEach((client) => client.postMessage(warning));
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(info.path)) return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340"><rect width="100%" height="100%" fill="#18242a"/><text x="50%" y="50%" fill="#c9f36b" text-anchor="middle" font-family="sans-serif">Asset too large for browser preview</text></svg>`, { headers: { "Content-Type": "image/svg+xml" } });
    return new Response("", { headers: { "Content-Type": contentType(info.path) } });
  }
  let body;
  if (item.content) body = decodeBase64(item.content);
  else if (item.sha) {
    const blobResponse = await fetch(`https://api.github.com/repos/${info.owner}/${info.repo}/git/blobs/${item.sha}`, { headers });
    if (!blobResponse.ok) return null;
    const blob = await blobResponse.json(); body = blob.encoding === "base64" ? decodeBase64(blob.content) : new TextEncoder().encode(blob.content);
  }
  return body ? new Response(body, { headers: { "Content-Type": contentType(info.path), "Cache-Control": "no-store" } }) : null;
}
self.addEventListener("fetch", (event) => {
  const info = parseVirtual(event.request.url); if (!info) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME); const cached = await cache.match(event.request); if (cached) return cached;
    const token = tokenByScope.get(scopeOf(info)); if (!token) return new Response("EdgeQA session is locked", { status: 401 });
    let response = await githubFile(info, token);
    if (!response && info.path !== "index.html") response = await githubFile({ ...info, path: "index.html" }, token);
    if (!response) return new Response("File not found", { status: 404 });
    if (response.status === 200) await cache.put(event.request, response.clone());
    return response;
  })());
});
