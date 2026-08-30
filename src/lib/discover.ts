// Repo → entry-point discovery. This is the future-proofing seam: project types
// (static, and later Vite/React/Angular/Tauri/build-based) slot in as resolvers
// here without touching the picker, the `path` plumbing, the service worker, or
// issue reporting. Today only the generic/static resolver exists; `kind` already
// distinguishes "servable as-is" from "needs a build tier" for the future.
const GH = "https://api.github.com";

export interface Candidate {
  /** Value baked into &path= ("", "docs", "DualBoy/src", or "gui/root.html"). */
  doc: string;
  label: string;
  /** "static" = servable now; "build" = needs a compile tier (React/Angular source). */
  kind: "static" | "build";
}

export interface Probe {
  branch: string;
  defaultBranch: string;
  /** Best-guess entry doc for the happy path. */
  siteRoot: string;
  /** undefined = unknown (e.g. token gave access); true/false = known. */
  public: boolean | undefined;
  sources: Candidate[];
}

const identityCache = new Map<string, { account: string; repos: { full_name: string; private: boolean; default_branch: string }[] }>();
const branchCache = new Map<string, string[]>();

async function gh(path: string, token: string): Promise<{ status: number; json: any; rateLimited: boolean }> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(GH + path, { headers });
  let json: any = null;
  try { json = await res.json(); } catch { /* 204/rate-limit/etc. */ }
  const rateLimited = res.status === 429 || (res.status === 403 && Number(res.headers.get("x-ratelimit-remaining")) === 0);
  return { status: res.status, json, rateLimited };
}

// Generic/static resolver: index.html at the shallowest depth wins, plus top-level
// named pages as selectable entry files. Future resolvers key off tree signals and
// return more precise candidates (with kind "build" when a compile tier is needed).
export function resolveEntryPoints(tree: { path: string; type: string }[]): Candidate[] {
  const blobs = (tree || []).filter((n) => n.type === "blob" && /\.html?$/i.test(n.path || ""));
  const index: Candidate[] = [];
  const pages: Candidate[] = [];
  for (const b of blobs) {
    const p = b.path || "";
    const name = p.slice(p.lastIndexOf("/") + 1);
    if (/^index\.html?$/i.test(name)) {
      const dir = p.slice(0, Math.max(p.lastIndexOf("/"), 0)); // "" = repo root
      index.push({ doc: dir, label: dir ? `${dir}/index.html` : "/ (repo root)", kind: "static" });
    } else if (!p.includes("/")) {
      pages.push({ doc: p, label: p, kind: "static" });
    }
  }
  const depth = (c: Candidate) => (c.doc ? c.doc.split("/").length : 0);
  const all = [...index.sort((a, b) => depth(a) - depth(b)), ...pages.sort((a, b) => depth(a) - depth(b))];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of all) {
    if (!seen.has(c.doc)) { seen.add(c.doc); out.push(c); }
    if (out.length >= 20) break;
  }
  return out;
}

async function treeFor(owner: string, repo: string, ref: string, token: string): Promise<{ path: string; type: string }[]> {
  const res = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token);
  if (res.status !== 200 || !Array.isArray(res.json?.tree)) return [];
  return res.json.tree;
}

export async function probeRepo(owner: string, repo: string, branch: string, token: string): Promise<Probe> {
  let defaultBranch = branch;
  let isPublic: boolean | undefined;
  const meta = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
  if (meta.status === 200 && meta.json) {
    defaultBranch = meta.json.default_branch || branch;
    isPublic = token ? meta.json.private === false : true; // an anonymous 200 only happens for a public repo
  } else if (meta.rateLimited) {
    isPublic = undefined; // anonymous budget exhausted — we genuinely don't know; don't mislabel as private
  } else {
    isPublic = false; // 404/not found — not readable without a token (or owner/repo wrong)
  }

  let tree = await treeFor(owner, repo, branch, token);
  let sources = resolveEntryPoints(tree);
  let siteRoot = sources[0]?.doc || "";
  let resolved = branch;
  if (!siteRoot && defaultBranch !== branch) {
    tree = await treeFor(owner, repo, defaultBranch, token);
    const fb = resolveEntryPoints(tree);
    if (fb.length) { sources = fb; siteRoot = fb[0].doc || ""; resolved = defaultBranch; }
  }
  return { branch: resolved, defaultBranch, siteRoot, public: isPublic, sources };
}

export async function loadIdentity(token: string): Promise<{ account: string; repos: { full_name: string; private: boolean; default_branch: string }[] }> {
  const cached = identityCache.get(token);
  if (cached) return cached;
  const user = await gh("/user", token);
  if (user.status !== 200) throw new Error("unauthorized");
  const repos: { full_name: string; private: boolean; default_branch: string }[] = [];
  for (let page = 1; page <= 2; page++) {
    const r = await gh(`/user/repos?affiliation=owner,collaborator&per_page=100&page=${page}&sort=pushed`, token);
    if (r.status !== 200) break;
    if (!Array.isArray(r.json) || !r.json.length) break;
    r.json.filter((x: any) => x && !x.archived && !x.fork).forEach((x: any) => repos.push({ full_name: x.full_name, private: x.private, default_branch: x.default_branch }));
    if (r.json.length < 100) break;
  }
  const out = { account: String(user.json?.login ?? ""), repos };
  identityCache.set(token, out);
  return out;
}

export async function loadBranches(owner: string, repo: string, token: string): Promise<string[]> {
  const key = `${owner}/${repo}`;
  const cached = branchCache.get(key);
  if (cached) return cached;
  const out: string[] = [];
  for (let page = 1; page <= 2; page++) {
    const r = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`, token);
    if (r.status !== 200) break;
    if (!Array.isArray(r.json) || !r.json.length) break;
    r.json.forEach((b: any) => { if (b && b.name) out.push(b.name); });
    if (r.json.length < 100) break;
  }
  branchCache.set(key, out);
  return out;
}