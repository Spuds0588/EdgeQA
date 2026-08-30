import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveEntryPoints, probeRepo } from "../src/lib/discover";

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