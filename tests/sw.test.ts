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

function makeSW(fetchImpl: FetchMock, extraSelf: Record<string, any> = {}) {
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
    ...extraSelf,
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

  it("preset scope: rewrites absolute asset paths in HTML (no import map needed)", async () => {
    const sw = makeSW(htmlFetch('<html><head><title>App</title></head><body><script type="module" src="/src/main.tsx"></script></body></html>'));
    await sw.message({ type: "SET_PRESET", scope: "acme/site/main", preset: "react" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/index.html");
    const text = await res.text();
    expect(text).not.toContain("importmap"); // resolution happens per-module
    expect(text).toContain("src=\"src/main.tsx\""); // absolute /src → relative to doc dir (root)
  });

  it("preset scope: any bare npm import is rewritten to the esm.sh CDN", async () => {
    const fakeBabel = { transform: (code: string, opts: any) => ({ code: `/*${opts.filename}*/` + code }) };
    const src = `import { observer } from \"mobx-react\";\nimport { useQuery } from \"@tanstack/react-query\";\nimport deep from \"lodash/fp\";\nimport icon from \"./Logo.svg\";\nexport const App = () => <logo/>;`;
    const sw = makeSW(htmlFetch(src), { Babel: fakeBabel });
    await sw.message({ type: "SET_PRESET", scope: "acme/site/main", preset: "react" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/src/App.jsx");
    const text = await res.text();
    expect(text).toContain("https://esm.sh/mobx-react");
    expect(text).toContain("https://esm.sh/@tanstack/react-query");
    expect(text).toContain("https://esm.sh/lodash/fp");
    expect(text).not.toContain(`from \"./Logo.svg\"`); // asset import rewritten to URL string
  });

  it("preset scope: plain ESM .js source also gets bare imports rewritten (no babel)", async () => {
    const sw = makeSW(htmlFetch(`import { createStore } from \"redux\";\nexport const s = createStore();`));
    await sw.message({ type: "SET_PRESET", scope: "acme/site/main", preset: "jsx" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/src/store.js");
    expect(await res.text()).toContain("https://esm.sh/redux");
  });

  it("preset scope: committed build artifacts (dist) pass through untouched", async () => {
    const sw = makeSW(htmlFetch(`import { createStore } from \"redux\";`));
    await sw.message({ type: "SET_PRESET", scope: "acme/site/main", preset: "jsx" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/dist/app.js");
    expect(await res.text()).toBe(`import { createStore } from \"redux\";`); // untouched
  });

  it("preset scope: absolute paths rewrite relative to a subfolder document", async () => {
    const sw = makeSW(htmlFetch('<html><body><script type="module" src="/index.jsx"></script></body></html>'));
    await sw.message({ type: "SET_PRESET", scope: "preactjs/preact/main", preset: "jsx" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/preactjs/preact/main/demo/index.html");
    expect(await res.text()).toContain("src=\"index.jsx\""); // doc-dir-relative (app root), not repo root
  });

  it("preset scope: JSX is transpiled and CSS imports become stylesheet injectors", async () => {
    const fakeBabel = { transform: (code: string, opts: any) => ({ code: `/*${opts.filename}*/` + code }) };
    const sw = makeSW(htmlFetch('import { useState } from "react";\nimport "./App.css";\nexport const App = () => <button>x</button>;'), { Babel: fakeBabel });
    await sw.message({ type: "SET_PRESET", scope: "acme/site/main", preset: "react" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/src/App.jsx");
    expect(res.status).toBe(200);
    expect((await res.headers.get("Content-Type") || "")).toContain("javascript");
    const text = await res.text();
    expect(text).toContain("/*src/App.jsx*/"); // fake babel ran
    expect(text).not.toContain('import "./App.css"'); // css import stripped
    expect(text).toContain("App.css"); // injector references it
    expect(text).toContain("stylesheet");
  });

  it("preset scope: single-quoted CSS and Vite asset imports are rewritten after transpile", async () => {
    const fakeBabel = { transform: (code: string, opts: any) => ({ code: `/*${opts.filename}*/` + code }) };
    const sw = makeSW(htmlFetch('import { useState } from \'react\';\nimport \'./index.css\';\nimport heroImg from \'./assets/hero.png\';\nexport const App = () => <img src={heroImg} />;'), { Babel: fakeBabel });
    await sw.message({ type: "SET_PRESET", scope: "acme/site/main", preset: "react" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/src/App.jsx");
    const text = await res.text();
    expect(text).not.toContain("import './index.css'"); // single-quoted side-effect css import stripped
    expect(text).toContain("index.css"); // injector references it
    expect(text).not.toContain("import heroImg"); // asset import rewritten
    expect(text).toContain("const heroImg = new URL('./assets/hero.png', import.meta.url).href");
    expect(text).toContain("https://esm.sh/react"); // bare import rewritten to the esm.sh CDN
  });

  it("preset scope: extensionless module import resolves to ./name.jsx (vite-style)", async () => {
    const fetchMock = vi.fn<FetchMock>(async (url: string) => {
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        if (url.endsWith("/demo/style.jsx") || url.endsWith("/demo/style/index.jsx")) return ok("export const x = <b/>;", 200, "text/plain");
        return ok("not found", 404, "text/plain");
      }
      return ok("{}", 404, "application/json");
    });
    const sw = makeSW(fetchMock, { Babel: { transform: (c: string) => ({ code: c }) } });
    await sw.message({ type: "SET_PRESET", scope: "preactjs/preact/main", preset: "jsx" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/preactjs/preact/main/demo/style");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SW-TRANSPILED"); // resolved ./style -> ./style.jsx then transpiled
    expect(fetchMock.mock.calls.some(([u]) => u.includes("/demo/style.jsx"))).toBe(true);
  });

  it("preset scope: bare directory import resolves to ./dir/index.tsx (vite-style)", async () => {
    const fetchMock = vi.fn<FetchMock>(async (url: string) => {
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        if (url.includes("/people/index.tsx")) return ok("export const P = <i/>;", 200, "text/plain");
        return ok("not found", 404, "text/plain");
      }
      return ok("{}", 404, "application/json");
    });
    const sw = makeSW(fetchMock, { Babel: { transform: (c: string, o: any) => ({ code: `/*${o.filename}*/` + c }) } });
    await sw.message({ type: "SET_PRESET", scope: "preactjs/preact/main", preset: "jsx" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/preactjs/preact/main/demo/people");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("SW-TRANSPILED");
    expect(text).toContain("/*demo/people/index.tsx*/"); // transpiled as tsx
  });

  it("preset scope: directory-index module's sibling relative imports are rewired to its real folder", async () => {
    const body = `import { Router } from './simple-router';;\nexport const X = () => <b/>;`;
    const fetchMock = vi.fn<FetchMock>(async (url: string) => {
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        if (url.includes("/suspense-router/index.jsx")) return ok(body, 200, "text/plain");
        return ok("not found", 404, "text/plain");
      }
      return ok("{}", 404, "application/json");
    });
    const sw = makeSW(fetchMock, { Babel: { transform: (c: string) => ({ code: c }) } });
    await sw.message({ type: "SET_PRESET", scope: "preactjs/preact/main", preset: "jsx" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/preactjs/preact/main/demo/suspense-router");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("./suspense-router/./simple-router"); // leading ./ kept, sibling prefix inserted
  });

  it("preset scope: CSS files pass through untouched (real stylesheets)", async () => {
    const fakeBabel = { transform: (code: string) => ({ code }) };
    const sw = makeSW(async () => ok("body { color: red; }", 200, "text/css"), { Babel: fakeBabel });
    await sw.message({ type: "SET_PRESET", scope: "acme/site/main", preset: "react" });
    const res = await sw.fetchEvent("http://localhost:4173/sandbox/acme/site/main/src/App.css");
    expect(await res.text()).toBe("body { color: red; }");
  });

  it("no preset: JSX is served raw, no import map injected", async () => {
    const fakeBabel = { transform: (code: string) => ({ code }) };
    const sw = makeSW(htmlFetch("<html><body>hi</body></html>"), { Babel: fakeBabel });
    const res = await sw.fetchEvent(DEMO_HTML_URL);
    expect(await res.text()).not.toContain("importmap");
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
