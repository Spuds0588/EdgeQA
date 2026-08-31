// Repo → entry-point discovery. This is the future-proofing seam: project types
// (static, and later Vite/React/Angular/Tauri/build-based) slot in as resolvers
// here without touching the picker, the `path` plumbing, the service worker, or
// issue reporting. `kind` distinguishes "servable as-is" from "needs a build
// tier", and `preset` names the in-browser transpile mode when one applies.
const GH = "https://api.github.com";

export type Preset = "react" | "preact" | "jsx" | "vue" | "svelte";

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
  /** Framework detected from repo signals ("react" | "preact" | "jsx"), if any. */
  preset?: Preset;
  /** Source-path aliases ("@" -> "src", "$lib" -> "src/lib") relative to the site root. */
  aliases?: Record<string, string>;
  /** Top-level source directories of the app root (for bare "src/..." style imports). */
  localDirs?: string[];
}

const identityCache = new Map<string, { account: string; repos: { full_name: string; private: boolean; default_branch: string }[] }>();
const branchCache = new Map<string, string[]>();
const pkgCache = new Map<string, any>();

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

// Tree-level signals that a repo holds framework *source* (not a built site) —
// the gate before spending a package.json fetch. .vue/.svelte/.tsx/.jsx files and
// build configs are the tells; a pure static site has none of them.
function looksLikeSource(tree: { path: string; type: string }[]): boolean {
  const paths = (tree || []).map((n) => n.path || "");
  return paths.some((p) => /\.(jsx|tsx|vue|svelte)$/i.test(p))
    || paths.some((p) => /(^|\/)vite\.config\.[cm]?[jt]s$/i.test(p))
    || paths.some((p) => /(^|\/)angular\.json$/i.test(p));
}

// Framework detection from repo signals. Only presets the build tier can actually
// run are returned (react / preact / generic jsx+tsx / vue / svelte). Angular's AOT
// compiler can't realistically run in a browser, so it stays out until a better seam.
export function detectPreset(tree: { path: string; type: string }[], pkg: any): Preset | null {
  const paths = new Set((tree || []).map((n) => n.path || ""));
  const has = (re: RegExp) => [...paths].some((p) => re.test(p));
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps["preact"]) return "preact";
  if (deps["react"] && deps["react-dom"]) return "react";
  if (deps["vue"]) {
    // Vue 2 repos (vue@2.x, or a vue-template-compiler devDep) can't run through the Vue 3
    // compiler-sfc — the emitted runtime API calls (openBlock, createElementBlock…) don't
    // exist in Vue 2 and the SFC syntax drifts. Degrade cleanly instead of miscompiling.
    const vueVer = String(deps["vue"] || "").replace(/^[~^]/, "");
    if (/^2(\.|$)/.test(vueVer) || deps["vue-template-compiler"]) return null;
    return "vue";
  }
  if (deps["svelte"]) return "svelte";
  // Solid/Angular/other committed frameworks whose JSX is NOT React: refusing a preset here is
  // better than mislabeling them as generic "jsx". The generic preset transpiles JSX to the React
  // runtime, which silently produces nothing for a Solid app — a confusing blank page instead of
  // a clean unsupported-framework degrade. Skipping lets them fall through as unservable source.
  if (deps["solid-js"] || deps["@solidjs/router"] || deps["solid-start"] || deps["@angular/core"] || deps["@analogjs/platform"]) return null;
  // file-signal fallbacks (no usable package.json)
  if (has(/^vite\.config\./)) return "jsx";
  if (has(/\.svelte$/)) return "svelte";
  if (has(/\.vue$/)) return "vue";
  if (has(/^src\/main\.(tsx|jsx)$/) || has(/\.(tsx|jsx)$/)) return "jsx";
  return null;
}

async function treeFor(owner: string, repo: string, ref: string, token: string): Promise<{ path: string; type: string }[]> {
  const res = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token);
  if (res.status !== 200 || !Array.isArray(res.json?.tree)) return [];
  return res.json.tree;
}

// package.json via raw.githubusercontent for tokenless (no API budget) or the
// contents API with a token (private repos). Only fetched when the tree already
// looks like framework source.
// Fetch a JSON file relative to the app root (siteRoot "" = repo root). Tokenless
// goes through raw.githubusercontent (no API budget); token-backed uses the contents
// API so private repos resolve. Cached per scope.
async function fetchJson(owner: string, repo: string, ref: string, token: string, siteRoot: string, file: string, cache: Map<string, any>): Promise<any | null> {
  const key = `${owner}/${repo}/${ref}/${siteRoot}/${file}`;
  if (cache.has(key)) return cache.get(key);
  const root = siteRoot ? `${siteRoot.replace(/^\/+|\/+$/g, "")}/` : "";
  let out: any = null;
  try {
    if (token) {
      const res = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${root}${file}?ref=${encodeURIComponent(ref)}`, token);
      if (res.status === 200 && res.json?.content) {
        const bin = atob(res.json.content.replace(/\n/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        out = JSON.parse(new TextDecoder().decode(bytes));
      }
    } else {
      const raw = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${root}${file}`);
      if (raw.ok) out = await raw.json();
    }
  } catch { out = null; }
  cache.set(key, out);
  return out;
}

async function fetchPackageJson(owner: string, repo: string, ref: string, token: string, siteRoot: string): Promise<any | null> {
  return fetchJson(owner, repo, ref, token, siteRoot, "package.json", pkgCache);
}

// Source-path aliases from tsconfig.json `compilerOptions.paths` (with baseUrl), the
// convention nearly every Vite/TS app uses for "@/x" style imports. Returns e.g.
// { "@": "src" } or { "@": "src", "$lib": "src/lib" }. Best-effort — a missing or
// unusual tsconfig simply yields {} and callers fall back to conventions.
export function aliasesFromTsconfig(tsconfig: any): Record<string, string> {
  const out: Record<string, string> = {};
  const paths = tsconfig?.compilerOptions?.paths;
  const baseUrl = String(tsconfig?.compilerOptions?.baseUrl || "").replace(/^\/\.?\//, "").replace(/^\.\//, "").replace(/\/+$/, "").replace(/^\.$/, "");
  if (!paths || typeof paths !== "object") return out;
  for (const [pattern, targets] of Object.entries<any>(paths)) {
    // Only alias-style keys ("@/*", "$lib/*", "@app/*") — never bare names.
    if (!/^[@$][^/]*\/\*$/.test(pattern)) continue;
    const key = pattern.replace(/\/\*$/, "");
    const value = String(Array.isArray(targets) ? targets[0] : targets || "").replace(/\/\*$/, "").replace(/^\.\//, "").replace(/\/+$/, "").replace(/^\.$/, "");
    if (!value && !baseUrl) continue; // an empty value only makes sense with a baseUrl ("@/*" -> baseUrl itself)
    const root = [baseUrl, value].filter(Boolean).join("/");
    out[key] = root || key;
  }
  return out;
}

// Best-effort vite.config alias extraction for the common literal forms:
//   alias: { "@": "/src" } | "@": resolve(__dirname, "./src") | "@": new URL("./src", import.meta.url)
// The fileURLToPath(...) wrapper around new URL is skipped, but the inner URL is captured.
export function aliasesFromViteConfig(configText: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!configText) return out;
  // Grab the resolve.alias object once, then scan entries inside it — a global regex that
  // re-anchors `alias:{` would only ever match the first entry.
  const obj = configText.match(/alias\s*:\s*\{([\s\S]*?)\}/);
  if (!obj) return out;
  const re = /(["']?)([@$][^"':\s]*?)\1\s*:\s*(?:["']([^"']+)["']|new\s+URL\(\s*["']([^"']+)["']|(?:path\.)?resolve\(\s*[^,)]*,\s*["']([^"']+)["'])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(obj[1]))) {
    const key = m[2];
    const raw = m[3] || m[4] || m[5];
    if (!key || !raw) continue;
    let value = raw.replace(/^\/+/g, "").replace(/^\.\//, ""); // "/src" or "./src" -> "src"
    out[key] = value;
  }
  return out;
}

// Top-level directories of the app root subtree — the local dirs bare imports like
// "src/services" resolve against (vite `resolve.alias`/baseUrl style). Hidden dirs
// (.github, .vscode, …), build/output folders, and file-looking entries are excluded;
// anything else is a candidate.
export function topLevelDirs(tree: { path: string; type: string }[], siteRoot: string): string[] {
  const root = siteRoot ? `${siteRoot.replace(/^\/+|\/+$/g, "")}/` : "";
  const seen = new Set<string>();
  for (const n of tree || []) {
    const p = n.path || "";
    if (!p.startsWith(root)) continue;
    const rest = p.slice(root.length);
    if (!rest) continue;
    const first = rest.split("/")[0];
    if (!first || first.includes(".") || first.startsWith(".")) continue;
    if (/^(node_modules|vendor|dist|build|out|coverage|docs|public)$/i.test(first)) continue;
    seen.add(first);
  }
  return [...seen].sort();
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
  let preset: Preset | undefined;
  let aliases: Record<string, string> | undefined;
  let localDirs: string[] | undefined;
  if (looksLikeSource(tree)) {
    const pkg = await fetchPackageJson(owner, repo, resolved, token, siteRoot);
    preset = detectPreset(tree, pkg) || undefined;
    if (preset) {
      // Alias + local-dir resolution for the in-browser build tier: tsconfig paths win,
      // vite.config string aliases are the fallback, and conventions cover the rest
      // ($lib -> src/lib for SvelteKit-style repos, @ -> src when a src/ dir exists).
      const tsconfig = await fetchJson(owner, repo, resolved, token, siteRoot, "tsconfig.json", pkgCache);
      let aliasMap = { ...aliasesFromViteConfig(await viteConfigText(owner, repo, resolved, token, siteRoot)), ...aliasesFromTsconfig(tsconfig) };
      const dirs = topLevelDirs(tree, siteRoot);
      if (!aliasMap["@"] && dirs.includes("src")) aliasMap["@"] = "src";
      if (!aliasMap["$lib"] && dirs.includes("src") && tree.some((n) => (n.path || "").startsWith(siteRoot ? `${siteRoot.replace(/\/+$/, "")}/src/lib/` : "src/lib/"))) aliasMap["$lib"] = "src/lib";
      if (Object.keys(aliasMap).length) aliases = aliasMap;
      if (dirs.length) localDirs = dirs;
    }
  }
  return { branch: resolved, defaultBranch, siteRoot, public: isPublic, sources, preset, aliases, localDirs };
}

async function viteConfigText(owner: string, repo: string, ref: string, token: string, siteRoot: string): Promise<string | null> {
  const root = siteRoot ? `${siteRoot.replace(/^\/+|\/+$/g, "")}/` : "";
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]) {
    try {
      if (token) {
        const res = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${root}${name}?ref=${encodeURIComponent(ref)}`, token);
        if (res.status === 200 && res.json?.content) {
          const bin = atob(res.json.content.replace(/\n/g, ""));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new TextDecoder().decode(bytes);
        }
      } else {
        const raw = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${root}${name}`);
        if (raw.ok) return await raw.text();
      }
    } catch { /* keep probing */ }
  }
  return null;
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
