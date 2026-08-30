import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";

// Load the real service worker file and evaluate it in a mocked browser-like scope,
// so the exact production code under public/edgeqa-sw.js is what gets tested.
const code = readFileSync(new URL("../public/edgeqa-sw.js", import.meta.url), "utf8");

const DEMO_HTML_URL = "http://localhost:4173/sandbox/Spuds0588/EdgeQA/main/examples/northstar/index.html";
const ASSET_URL = "http://localhost:4173/sandbox/Spuds0588/EdgeQA/main/assets/app.js";
const ROUTE_URL = "http://localhost:4173/sandbox/Spuds0588/EdgeQA/main/some/route";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const contentsJson = (body: string) => ({ type: "file", size: body.length, content: b64(body) });

type FetchMock = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

function makeSW(fetchImpl: FetchMock) {
  const listeners: Record<string, ((event: any) => void)[]> = {};
  const store = new Map<string, Map<string, Response>>();

  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return {
        match: async (req: Request) => m.get(req.url) ?? undefined,
        put: async (req: Request, res: Response) => void m.set(req.url, res),
        keys: async () => [...m.keys()].map((u) => new Request(u)),
        delete: async (req: Request) => m.delete(req.url),
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };

  const self: any = {
    registration: { scope: "http://localhost:4173/" },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) },
    addEventListener: (type: string, fn: (e: any) => void) => void (listeners[type] ||= []).push(fn),
  };

  const fn = new Function("self", "caches", "fetch", "atob", code);
  fn(self, caches, fetchImpl, globalThis.atob);

  return {
    caches,
    async fire(type: string, event: any) {
      const waits: Promise<any>[] = [];
      event.waitUntil = (p: Promise<any>) => void waits.push(p);
      for (const l of listeners[type] || []) l(event);
      await Promise.all(waits);
    },
    async message(data: any) {
      await this.fire("message", { data });
    },
    async fetchEvent(url: string) {
      let respondWithPromise: Promise<Response> | undefined;
      const event = { request: new Request(url), respondWith: (p: Promise<Response>) => void (respondWithPromise = p) };
      await this.fire("fetch", event);
      return respondWithPromise!;
    },
  };
}

const ok = (body: string, status = 200, type = "text/html") =>
  new Response(body, { status, headers: { "Content-Type": type } });

// The SW serves tokenless previews from raw.githubusercontent.com (raw bytes) and
// token-backed previews from api.github.com (contents JSON). This mock answers both.
const htmlFetch = (body: string) =>
  vi.fn<FetchMock>(async (url: string) =>
    url.startsWith("https://raw.githubusercontent.com/")
      ? ok(body)
      : ok(JSON.stringify(contentsJson(body))),
  );

describe("edgeqa-sw VFS cache strategy", () => {
  it("always revalidates HTML documents — a cached copy is never served, even fresh", async () => {
    const sw = makeSW(htmlFetch("<html><body>FRESH</body></html>"));
    const cache = await sw.caches.open("edgeqa-vfs-v2");
    await cache.put(new Request(DEMO_HTML_URL), ok("<html><body>CACHED</body></html>"));
    const res = await sw.fetchEvent(DEMO_HTML_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("FRESH");
  });

  it("serves static assets from cache within the TTL (no GitHub call)", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => ok(JSON.stringify(contentsJson("FRESH_JS")), 200, "application/javascript"));
    const sw = makeSW(fetchMock);
    const cache = await sw.caches.open("edgeqa-vfs-v2");
    await cache.put(new Request(ASSET_URL), new Response("CACHED_JS", { headers: { "Content-Type": "application/javascript", "x-edgeqa-cached-at": String(Date.now()) } }));
    const res = await sw.fetchEvent(ASSET_URL);
    expect(await res.text()).toBe("CACHED_JS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches static assets after the TTL expires", async () => {
    const fetchMock = htmlFetch("FRESH_JS");
    const sw = makeSW(fetchMock);
    const cache = await sw.caches.open("edgeqa-vfs-v2");
    await cache.put(new Request(ASSET_URL), new Response("CACHED_JS", { headers: { "Content-Type": "application/javascript", "x-edgeqa-cached-at": String(Date.now() - 10 * 60 * 1000) } }));
    const res = await sw.fetchEvent(ASSET_URL);
    expect(await res.text()).toBe("FRESH_JS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a rate-limit page (not 'locked') when a tokenless GitHub fetch 429s", async () => {
    const sw = makeSW(async () => ok("{}", 429, "application/json"));
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/public-site/main/index.html");
    expect(res.status).toBe(429);
    expect(await res.text()).toContain("rate-limiting");
  });

  it("falls back to the cached copy when GitHub rate-limits (429)", async () => {
    const sw = makeSW(async () => ok("{}", 429, "application/json"));
    const cache = await sw.caches.open("edgeqa-vfs-v2");
    await cache.put(new Request(DEMO_HTML_URL), ok("<html><body>CACHED</body></html>"));
    const res = await sw.fetchEvent(DEMO_HTML_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("CACHED");
  });

  it("falls back to the cached copy when the network fetch throws", async () => {
    const sw = makeSW(async () => {
      throw new TypeError("Failed to fetch");
    });
    const cache = await sw.caches.open("edgeqa-vfs-v2");
    await cache.put(new Request(DEMO_HTML_URL), ok("<html><body>CACHED</body></html>"));
    const res = await sw.fetchEvent(DEMO_HTML_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("CACHED");
  });

  it("returns 404 (no web app) when a token-backed refetch fails and nothing is cached", async () => {
    const sw = makeSW(async () => {
      throw new TypeError("Failed to fetch");
    });
    await sw.message({ type: "SET_TOKEN", scope: "Spuds0588/EdgeQA/main", token: "t" });
    const res = await sw.fetchEvent(DEMO_HTML_URL);
    expect(res.status).toBe(404);
  });

  it("serves any public scope without a token (anonymous GitHub fetch)", async () => {
    const sw = makeSW(htmlFetch("<html><body>PUBLIC</body></html>"));
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/public-site/main/index.html");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("PUBLIC");
  });

  it("locks a tokenless scope when the anonymous fetch fails (401, private repo)", async () => {
    const sw = makeSW(async () => {
      throw new TypeError("Failed to fetch");
    });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/private-repo/main/index.html");
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("needs the session PIN");
  });

  it("tokenless missing asset gets a clean 404, never the locked HTML page", async () => {
    const sw = makeSW(async () => ok("not found", 404, "text/plain"));
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/openlayers/openlayers/main/examples/examples-info.js");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("session PIN");
  });

  it("tokenless missing asset with a cached copy serves the cached copy, not 404", async () => {
    const sw = makeSW(async () => ok("not found", 404, "text/plain"));
    const cache = await sw.caches.open("edgeqa-vfs-v2");
    await cache.put(new Request("http://localhost:4173/sandbox/acme/site/main/app.js"), new Response("CACHED_JS", { headers: { "Content-Type": "application/javascript", "x-edgeqa-cached-at": String(Date.now()) } }));
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("CACHED_JS");
  });

  it("serves the demo scope without a token", async () => {
    const sw = makeSW(htmlFetch("<html><body>DEMO</body></html>"));
    const res = await sw.fetchEvent(DEMO_HTML_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("DEMO");
  });

  it("attaches the unlocked token as a Bearer header", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => ok(JSON.stringify(contentsJson("<html><body>PRIVATE</body></html>"))));
    const sw = makeSW(fetchMock);
    await sw.message({ type: "SET_TOKEN", scope: "acme/site/main", token: "ghp_secret" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/index.html");
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers?.["Authorization"]).toBe("Bearer ghp_secret");
  });

  it("SPA route falls back to the nearest directory's index.html (subfolder sites)", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<FetchMock>(async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        if (url.includes("/app/dashboard")) return ok("not found", 404, "text/plain");
        if (url.includes("/app/index.html")) return ok("<html><body>DIR_ROOT</body></html>");
        return ok("<html><body>REPO_ROOT</body></html>");
      }
      return ok("{}", 404, "application/json");
    });
    const sw = makeSW(fetchMock);
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/app/dashboard");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("DIR_ROOT"); // nearest dir index.html wins, not repo root
    expect(calls.some((u) => u.includes("/app/index.html"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/main/index.html"))).toBe(false); // root never consulted
  });

  it("SPA route falls back to repo-root index.html when no directory index exists", async () => {
    const fetchMock = vi.fn<FetchMock>(async (url: string) => {
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        if (url.includes("/some/route") || url.includes("/some/index.html")) return ok("not found", 404, "text/plain");
        return ok("<html><body>SPA_ROOT</body></html>");
      }
      return ok("{}", 404, "application/json");
    });
    const sw = makeSW(fetchMock);
    const res = await sw.fetchEvent(ROUTE_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SPA_ROOT");
    expect(fetchMock.mock.calls.some(([u]) => u.includes("raw.githubusercontent.com") && u.endsWith("/main/index.html"))).toBe(true);
  });

  it("removes stale cache versions on activate", async () => {
    const sw = makeSW(htmlFetch("<html></html>"));
    const old = await sw.caches.open("edgeqa-vfs-v1");
    await old.put(new Request(DEMO_HTML_URL), ok("<html>old</html>"));
    const current = await sw.caches.open("edgeqa-vfs-v2");
    await current.put(new Request(ASSET_URL), ok("asset", 200, "application/javascript"));
    await sw.fire("activate", {});
    expect(await sw.caches.keys()).toEqual(["edgeqa-vfs-v2"]);
  });
});
