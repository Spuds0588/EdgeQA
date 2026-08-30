import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveEntryPoints, probeRepo, detectPreset } from "../src/lib/discover";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("resolveEntryPoints (extensible generic resolver)", () => {
  it("repo-root index.html wins as the web root", () => {
    const tree = [
      { path: "index.html", type: "blob" },
      { path: "styles.css", type: "blob" },
      { path: "docs/index.html", type: "blob" },
    ];
    expect(resolveEntryPoints(tree)[0].doc).toBe("");
  });

  it("falls back to an app subfolder when there is no root index", () => {
    const tree = [
      { path: "README.md", type: "blob" },
      { path: "DualBoy/src/index.html", type: "blob" },
      { path: "src/other.js", type: "blob" },
    ];
    expect(resolveEntryPoints(tree)[0].doc).toBe("DualBoy/src");
  });

  it("surfaces top-level named pages as selectable entry files", () => {
    const tree = [{ path: "app.htm", type: "blob" }, { path: "README.md", type: "blob" }];
    const res = resolveEntryPoints(tree);
    expect(res.some((c) => c.doc === "app.htm" && c.kind === "static")).toBe(true);
  });

  it("handles a monorepo with several web apps, shallowest first", () => {
    const tree = [
      { path: "packages/site/index.html", type: "blob" },
      { path: "apps/web/index.html", type: "blob" },
      { path: "apps/web/index.htm", type: "blob" },
    ];
    const order = resolveEntryPoints(tree).map((c) => c.doc);
    expect(order).toEqual(["packages/site", "apps/web"]); // both depth-2; insertion order is stable
  });
});

describe("detectPreset (framework detection)", () => {
  it("package.json react deps → react", () => {
    expect(detectPreset([], { dependencies: { react: "^19", "react-dom": "^19" } })).toBe("react");
  });

  it("package.json preact dep → preact", () => {
    expect(detectPreset([], { dependencies: { preact: "^10" } })).toBe("preact");
  });

  it("vite config + src/main.tsx without package.json → generic jsx", () => {
    const tree = [{ path: "vite.config.ts", type: "blob" }, { path: "src/main.tsx", type: "blob" }];
    expect(detectPreset(tree, null)).toBe("jsx");
  });

  it("pure static tree → null (no framework)", () => {
    const tree = [{ path: "index.html", type: "blob" }, { path: "styles.css", type: "blob" }];
    expect(detectPreset(tree, null)).toBeNull();
  });

  it("detects Vue and Svelte source repos from deps + file signals", () => {
    expect(detectPreset([{ path: "src/App.vue", type: "blob" }], { dependencies: { vue: "^3" } })).toBe("vue");
    expect(detectPreset([{ path: "src/App.svelte", type: "blob" }], { dependencies: { svelte: "^5" } })).toBe("svelte");
    expect(detectPreset([{ path: "src/App.vue", type: "blob" }], {})).toBe("vue");
    expect(detectPreset([{ path: "src/App.svelte", type: "blob" }], {})).toBe("svelte");
  });
});

describe("probeRepo (token-aware)", () => {
  it("public repo: anonymous probe resolves branch + site root when the requested branch is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/repos/Spuds0588/mgba-splitscreen.git/trees") || url.includes("/git/trees")) {
          return url.includes("ref=master") || url.includes("/trees/master")
            ? json({ tree: [{ path: "DualBoy/src/index.html", type: "blob" }] })
            : json({ tree: [{ path: "README.md", type: "blob" }] });
        }
        return json({ default_branch: "master", private: false }); // repo meta
      }),
    );
    const probe = await probeRepo("Spuds0588", "mgba-splitscreen", "main", "");
    expect(probe.public).toBe(true);
    expect(probe.branch).toBe("master"); // fell back to default branch
    expect(probe.siteRoot).toBe("DualBoy/src");
    expect(probe.sources[0].doc).toBe("DualBoy/src");
  });

  it("rate-limited anonymous probe is 'unknown', not mislabeled as private", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      ),
    );
    const probe = await probeRepo("Spuds0588", "QuickRecord", "main", "");
    expect(probe.public).toBeUndefined(); // unknown — must NOT block tokenless generation with a false "private" label
    expect(probe.siteRoot).toBe("");
  });

  it("private repo without a token is detected as not public (blocks tokenless generation)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "Not Found" }, 404)),
    );
    const probe = await probeRepo("acme", "private-repo", "main", "");
    expect(probe.public).toBe(false);
    expect(probe.siteRoot).toBe("");
  });

  it("tokenless probe detects react from tree signals + raw package.json", async () => {
    const rawCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("https://raw.githubusercontent.com/")) {
          rawCalls.push(url);
          return new Response(JSON.stringify({ dependencies: { react: "^19", "react-dom": "^19" } }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/git/trees")) return json({ tree: [{ path: "index.html", type: "blob" }, { path: "vite.config.ts", type: "blob" }, { path: "src/main.tsx", type: "blob" }] });
        return json({ default_branch: "main", private: false });
      }),
    );
    const probe = await probeRepo("acme", "react-app", "main", "");
    expect(probe.preset).toBe("react");
    expect(rawCalls.some((u) => u.includes("package.json"))).toBe(true); // raw fetch, not the API budget
  });

  it("static repo never triggers a package.json fetch (no framework signals)", async () => {
    const rawCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("https://raw.githubusercontent.com/")) { rawCalls.push(url); return new Response("not found", { status: 404 }); }
        if (url.includes("/git/trees")) return json({ tree: [{ path: "index.html", type: "blob" }, { path: "styles.css", type: "blob" }] });
        return json({ default_branch: "main", private: false });
      }),
    );
    const probe = await probeRepo("acme", "static-site", "main", "");
    expect(probe.preset).toBeUndefined();
    expect(rawCalls.length).toBe(0);
  });

  it("sends the token as a Bearer header so private repos resolve", async () => {
    const calls: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push([String(input), (init?.headers as Record<string, string>)?.["Authorization"] || ""]);
        if (String(input).includes("/git/trees")) return json({ tree: [{ path: "index.html", type: "blob" }] });
        return json({ default_branch: "main", private: true });
      }),
    );
    await probeRepo("acme", "private-repo", "main", "github_pat_xyz");
    expect(calls.some(([u, a]) => u.includes("acme/private-repo") && a === "Bearer github_pat_xyz")).toBe(true);
  });
});