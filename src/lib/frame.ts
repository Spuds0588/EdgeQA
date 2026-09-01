// Page-side in-browser compile for the Vue/Svelte build tier.
//
// The service worker cannot dynamic-import esm.sh compiler SDKs — the HTML spec bans
// import() on ServiceWorkerGlobalScope. A normal window can, though, so the SW delegates
// .vue/.svelte compilation to this page via a postMessage round-trip. Each function here
// returns the *final* ESM module text (postProcessJs applied), which the SW then serves
// as-is under a marker comment.

const ESM_CDN = "https://esm.sh/";

// Resolve a site-root-relative target path from a module's directory — the same
// "relative to the importing module" semantics Vite gives aliases/baseUrl imports.
export function relFrom(fromDir: string, toPath: string): string {
  // Absolute URLs (esm.sh, data:, blob:, https://…) and root-absolute paths are final —
  // the CSS-injector path re-enters here with an already-rewritten esm.sh URL, and treating
  // its scheme as a path segment mangles it ("src/router/https:/esm.sh/…").
  if (/^(?:[a-z][a-z0-9+.\-]*:|\/)/i.test(toPath || "")) return toPath;
  // Filter empty segments on BOTH sides: a module served at an extensionless directory URL
  // (src/api) yields dir "src/api/" whose trailing empty segment would inflate `from.length`
  // and emit a phantom extra "../". Mirrors the `to` side.
  const from = fromDir ? fromDir.split("/").filter(Boolean) : [];
  const to = (toPath || "").split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.length - i;
  const down = to.slice(i).join("/");
  // Browsers require relative specifiers to start with "./" or "../" — a bare name is an error.
  // A target that equals the importer's own directory (e.g. "@/store" re-exported from inside
  // src/store/) must step up one level and back in ("../store"), not emit an invalid "." — the
  // importing module is a FILE in that directory, so "." would point at the directory URL.
  if (down) return (ups ? "../".repeat(ups) : "./") + down;
  if (!ups && from.length) return "../" + from[from.length - 1];
  return ups ? "../".repeat(ups) : "./";
}

export interface RewriteCfg {
  /** Served directory of the importing module (site-root-relative; "" = root). */
  dir?: string;
  /** Source-path aliases ("@" -> "src", "$lib" -> "src/lib"). */
  aliasMap?: Record<string, string>;
  /** Top-level local dirs of the app root (for bare "src/..." imports). */
  localDirs?: string[];
  /** name -> version from the repo's package.json (esm.sh pins). */
  depVersions?: Record<string, string> | null;
  /** Site root (the sandbox document dir) — alias/local targets are relative to it. */
  siteRoot?: string;
  /** Framework runtime pins for esm.sh ?deps (e.g. "react@18.3.1,react-dom@18.3.1"). */
  pinDeps?: string;
  /** Directory-offset for directory-index modules served at an extensionless URL (./y -> ./x/y). */
  extraDir?: string;
  /** Committed .env* values (VITE_*, NODE_ENV…) merged into the import.meta.env shim. */
  env?: Record<string, string>;
}

// Relative path from a module's served directory to a target DIRECTORY (for template-literal
// import prefixes like "@/layouts/"): "./x" style, with "./" for the same directory.
function relDirFrom(fromDir: string, toDir: string): string {
  const from = fromDir ? fromDir.split("/").filter(Boolean) : [];
  const to = (toDir || "").split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.length - i;
  const down = to.slice(i).join("/");
  return (ups ? "../".repeat(ups) : "./") + down;
}

// Vite `define` globals: templates in the vue-element-admin family (and webpack-era peers)
// reference build-time JSON injected via vite.config's `define` (e.g. __APP_INFO__) unguarded
// at module scope. Provide a module-scoped stand-in so `const { pkg } = __APP_INFO__` boots
// and the app renders (fake) package metadata instead of ReferenceError-ing the whole graph.
// Mirrors the SW's copy.
const VITE_DEFINE_SHIMS: Record<string, string> = {
  __APP_INFO__: `{ pkg: { name: "preview", version: "0.0.0", description: "", author: "", homepage: "" }, lastBuildTime: "" }`,
};
export function shimWebpackAmd(js: string): string {
  if (!/require\.context\b/.test(js) && !/\bdefine\s*\(/.test(js) && !/require\s*\[/.test(js)) return js;
  js = js.replace(/require\.context\s*\(([^)]+)\)/g, (_m: string, args: string) =>
    `((dir, sub, reg) => { const f = () => ({}); f.keys = () => []; f.id = 0; return f; })(${args})`
  );
  js = js.replace(/\bdefine\s*\([^)]*function[^)]*\)\s*\{/g, "{}; /*amd-define*/ { ");
  js = js.replace(/\bdefine\s*\([^)]*\)\s*;?/g, "; /*amd-define*/ ");
  js = js.replace(/require\s*\[([^\]]+)\]\s*,\s*(?:function[^)]*\)|[^;]+)/g, "; /*amd-require*/ ");
  return js;
}

export function shimViteGlobals(js: string): string {
  let out = js;
  for (const [name, value] of Object.entries(VITE_DEFINE_SHIMS)) {
    if (new RegExp(`\\b${name}\\b`).test(out)) out = `const ${name} = ${value};\n` + out;
  }
  return out;
}

// webpack/vue-cli-era source (vue-admin-better, the vue-element-admin template family…) is
// written in CommonJS: `require('./default')` + `module.exports = Object.assign(...)`. ESM
// can't execute either directly, so convert the dominant shapes: destructuring/default requires
// become imports, and `module.exports` writes route through a stub object that ends up as the
// module's default export. When the assigned RHS is a plain object literal its keys are ALSO
// emitted as named exports, so importers using `import { k } from './config'` link even without
// the importer-side namespace fallback. Mirrors the SW's copy.
export function shimCommonJS(js: string): string {
  if (!/\brequire\s*\(/.test(js) && !/\bmodule\.exports\b/.test(js) && !/(^|[^.\w])exports\.\w/.test(js)) return js;
  const head: string[] = [];
  js = js.replace(/const\s*\{([^}]*)\}\s*=\s*require\s*\(\s*(['"])([^'"]+)\2\s*\)\s*;?/g, (_m, names: string, q: string, spec: string) => {
    head.push(`import { ${names.trim()} } from ${q}${spec}${q};`);
    return "";
  });
  js = js.replace(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])([^'"]+)\2\s*\)\s*;?/g, (_m, name: string, q: string, spec: string) => {
    head.push(`import ${name} from ${q}${spec}${q};`);
    return "";
  });
  // Bare statement requires (`require('@/mock')` — the classic vue-cli main.js mock/prod
  // loading pattern) become side-effect imports. Only statement positions are matched;
  // expression positions (foo(require('x'))) are left alone.
  js = js.replace(/(^|\n)\s*require\s*\(\s*(['"])([^'"]+)\2\s*\)\s*;?/g, (_m, pre: string, q: string, spec: string) => {
    head.push(`import ${q}${spec}${q};`);
    return pre;
  });
  // Statically-enumerable keys of a `module.exports = { ... }` object literal (shorthand or
  // key: value) become named exports; anything non-trivial (Object.assign(…), expressions)
  // stays default-only and relies on the importer-side `?? default?.` fallback.
  let named: string[] = [];
  js = js.replace(/module\.exports\s*=\s*([^;]+);/g, (m, expr: string) => {
    named = [];
    const lit = expr.trim().match(/^\{([\s\S]*)\}$/);
    if (lit) {
      let depth = 0; const parts: string[] = []; let cur = "";
      for (const ch of lit[1]) {
        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; }
        else cur += ch;
      }
      if (cur.trim()) parts.push(cur);
      for (const part of parts) {
        const kn = part.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::.*)?$/);
        if (!kn) { named = []; break; }
        named.push(kn[1]);
      }
    }
    return `__edgeqaCjsMod.exports = ${expr};`;
  });
  // Replace remaining bare writes (handles the no-semicolon/EOF case the object-literal
  // regex can't see), then declare the stub ONLY when the transformed source references it —
  // the object-literal replace already consumed `module.exports =` by this point, so a check
  // for the original spelling would miss the most common shape and `__edgeqaCjsMod` would be
  // undefined at runtime.
  js = js.replace(/\bmodule\.exports\b/g, "__edgeqaCjsMod.exports").replace(/(^|[^.\w])exports\./g, "$1__edgeqaCjsMod.exports.");
  if (/\b__edgeqaCjsMod\b/.test(js) && !/\b(?:const|let|var)\s+__edgeqaCjsMod\b/.test(js)) js = "const __edgeqaCjsMod = { exports: {} };\n" + js;
  let out = (head.length ? head.join("\n") + "\n" : "") + js;
  if (/\b__edgeqaCjsMod\b/.test(out)) {
    // Named exports for importers. A key matching an existing module-scope binding (imported
    // name, const/function…) must be RE-exported (`export { k }`), never redeclared with
    // `export const k` — that is a SyntaxError on an already-declared identifier.
    const bound = new Set();
    for (const m of out.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
    for (const m of out.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const p of m[1].split(",")) { const n = p.trim().split(/\s+as\s+/)[0].trim(); if (n) bound.add(n); }
    for (const m of out.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) bound.add(m[1]);
    out += `\nexport default __edgeqaCjsMod.exports;`;
    for (const k of named) out += bound.has(k) ? `\nexport { ${k} };` : `\nexport const ${k} = __edgeqaCjsMod.exports.${k};`;
  }
  return out;
}

// CJS interop, importer side: vue-cli-era templates import named bindings from CJS modules
// (`import { recordRoute } from '@/config'` where config does `module.exports = Object.assign`).
// ESM can't statically name exports off a plain object, so for imports of LOCAL modules
// (relative/alias/baseUrl) rewrite the named-import statement to a namespace import plus a safe
// binding — `ns.name ?? ns.default?.name` — which binds whether the target turned out to be real
// ESM (named export) or CJS-transformed (default object). Bare npm imports keep native semantics.
// Mirrors the SW's copy.
// Repo-relative extensionless paths of modules this pipeline has SERVED. ESM targets stay in
// esmTargets; shimCommonJS-converted ones go in cjsTargets. Importer-side named imports keep
// native live bindings when the target is a KNOWN-ESM module — rewriting them to eager
// destructures TDZs cyclic graphs (vue3-element-admin's stores: index re-exports ./user, user
// imports `store` from index, and the namespace read fires before index's `const store`
// initializes). Unknown targets (not yet served — they're fetch-ordered after the importer)
// and known-CJS ones get the namespace+default fallback. Modules are crawled dependency-first,
// so a target that is a DEPENDENCY of the importer is always classified before the importer's
// own transform runs. Mirrors the SW's registry.
const cjsTargets = new Set<string>();
const esmTargets = new Set<string>();
export const extlessPath = (p: string) => p.split(/[?#]/)[0].replace(/\.[a-z0-9]+$/i, "");

export function cjsInteropNamedImports(js: string, cfg?: RewriteCfg, modulePath?: string, knownEsm?: ReadonlySet<string>): string {
  let cjsNsSeq = 0;
  // Resolve a local spec to the repo-relative extensionless path the pipeline serves and
  // check the esmTargets registry (populated when the target file was actually served
  // without CJS conversion). Known-ESM targets keep native live bindings; unknown/CJS
  // targets get the namespace+default fallback.
  const reg = knownEsm || esmTargets;
  const isKnownEsm = (spec: string): boolean => {
    if (!spec || !cfg) return false;
    const rootPrefix = cfg.siteRoot ? cfg.siteRoot.replace(/\/+$/, "") + "/" : "";
    let cand: string | null = null;
    if (spec.startsWith(".")) {
      const parts = (modulePath || cfg.dir || "").split("/").filter(Boolean);
      parts.pop(); // drop the module file itself
      for (const seg of spec.split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") parts.pop();
        else parts.push(seg);
      }
      cand = parts.join("/");
    } else if (cfg.aliasMap) {
      for (const [key, root] of Object.entries(cfg.aliasMap)) {
        if (spec === key || spec.startsWith(key + "/")) {
          const rest = spec.slice(key.length).replace(/^\/+/, "");
          cand = rootPrefix + (root ? root.replace(/\/+$/, "") + "/" + rest : rest);
          break;
        }
      }
      if (cand === null) return false;
    } else if (cfg.localDirs && cfg.localDirs.includes(spec.split("/")[0])) {
      cand = rootPrefix + spec;
    } else return false;
    const key = extlessPath(cand);
    return reg.has(key) || reg.has(key.replace(/\/index$/, ""));
  };
  return js.replace(/(^|\n)\s*import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\3\s*;?/g, (m, pre: string, names: string, q: string, spec: string) => {
    if (!spec) return m;
    const first = spec.split("/")[0];
    const aliasHit = !!(cfg?.aliasMap && Object.keys(cfg.aliasMap).some((k) => spec === k || spec.startsWith(k + "/")));
    const localHit = !!(cfg?.localDirs && cfg.localDirs.includes(first));
    if (spec.startsWith(".") || spec.startsWith("/") || aliasHit || localHit) {
      // Local module: keep native live bindings ONLY when the target is a known-ESM module
      // (cycle-safe); unknown targets (fetch-ordered after the importer) and CJS-converted
      // ones get the namespace+default fallback.
      if (isKnownEsm(spec)) return m;
    } else {
      // npm module: esm.sh collapses UMD/CJS packages to default-only, so named imports of
      // those (file-saver's `import { saveAs }`) need the namespace+default fallback. Skip
      // URLs and synthetic specs (virtual:, data:) that never make it to esm.sh.
      if (/^(virtual:|data:|blob:|https?:|\/)/i.test(spec)) return m;
    }
    const parts = names.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length || parts.some((p) => /^type\s/.test(p))) return m;
    const bindings: { orig: string; alias?: string }[] = [];
    for (const p of parts) {
      const mm = p.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!mm) return m; // exotic binding (default+named mix, string names…) — leave statement alone
      bindings.push({ orig: mm[1], alias: mm[2] });
    }
    // Multiple named imports in one module must each get a UNIQUE namespace binding —
    // reusing the same name is a SyntaxError (vue3-element-admin imports @/settings and
    // @/router in one file, etc.).
    let ns = "__edgeqaCjsNs";
    if (cjsNsSeq > 0) ns += cjsNsSeq;
    cjsNsSeq++;
    while (new RegExp(`\\b${ns}\\b`).test(js)) ns += "_";
    const lines = [`import * as ${ns} from ${q}${spec}${q};`];
    for (const b of bindings) lines.push(`const ${b.alias || b.orig} = ${ns}.${b.orig} ?? ${ns}.default?.${b.orig};`);
    return pre + "\n" + lines.join("\n");
  });
}

// Rewrite bare specifiers to what the browser can actually fetch (mirrors the SW's copy):
// local dirs and aliases become module-relative paths, npm packages become absolute esm.sh
// URLs pinned to the repo's package.json version when known. Relative (./), absolute (/),
// and URL (https:/data:...) specifiers are left untouched.
function rewriteBareImports(js: string, cfg?: RewriteCfg): string {
  cfg = cfg || {};
  // Template-literal specifiers with a static alias/local-dir prefix (import(`@/layouts/${name}/index.vue`))
  // also can't resolve as-is — rewrite the static prefix to a module-relative path, keep the ${...} parts.
  js = js.replace(/((?:from\s+|import\s*\(|(?:^|[\n]\s*)import\s+|export\s+[^;]*?from\s+)\s*`)([^`]*?)`/g, (m, ctx, tpl) => {
    if (!tpl.includes("${")) return m;
    const segs = tpl.split("${");
    const pre = segs[0];
    if (!pre || (!/^[@$]/.test(pre) && !(cfg.localDirs || []).some((d) => pre === d + "/" || pre.startsWith(d + "/")))) return m;
    const rootPrefix = cfg.siteRoot ? cfg.siteRoot + "/" : "";
    let target = "";
    if (cfg.aliasMap) {
      for (const [key, root] of Object.entries(cfg.aliasMap)) {
        if (pre === key + "/" || pre.startsWith(key + "/")) { target = root + pre.slice(key.length); break; }
      }
    }
    if (!target && cfg.localDirs) {
      for (const d of cfg.localDirs) {
        if (pre === d + "/" || pre.startsWith(d + "/")) { target = pre; break; }
      }
    }
    if (!target) return m;
    const relDir = relDirFrom(cfg.dir || "", rootPrefix + target.replace(/\/+$/, ""));
    const sep = relDir.endsWith("/") ? "" : "/";
    // ctx already ends with the opening backtick (it's part of the alternation group),
    // so only re-emit the closing one.
    return ctx + relDir + sep + "${" + segs.slice(1).join("${") + "`";
  });
  return js.replace(/((?:from\s+|import\s*\(|(?:^|[\n]\s*)import\s+|export\s+[^;]*?from\s+))(["'])([^\s"']+)(\2)/g, (m, ctx, q, spec, endq) => {
    if (!spec) return m;
    // A bare "." (import … from ".") means the module's own directory index in Vite
    // ("src/composables" -> src/composables/index.js); browsers reject "." outright.
    if (spec === "." || spec === "./") return `${ctx}${q}./index${endq}`;
    // `virtual:*` imports (vite-plugin-svg-icons' `import "virtual:svg-icons-register"`, vite-plugin-
    // vue-layouts' `virtual:generated-layouts`, etc.) are Vite-codegen modules with no real file.
    // As a bare name they'd be mistaken for a "virtual:" URL scheme and blocked by the browser, so
    // rewrite them to a synthetic module at the REPO ROOT (__edgeqa_virtual__/<name>.js) that the SW
    // serves as an empty ES module — a no-op side-effect import that lets the app boot without its
    // SVG sprite. Repo-root targeting (not siteRoot-prefixed) keeps the URL matchable at subfolder
    // entries too (arco-design-pro-vite). Mirrors the SW's copy.
    if (spec.startsWith("virtual:")) {
      const name = spec.slice("virtual:".length).replace(/[^A-Za-z0-9_\-/.\$]/g, "_") || "module";
      return `${ctx}${q}${relFrom(cfg!.dir || "", "__edgeqa_virtual__/" + name + ".js")}${endq}`;
    }
    // Relative/absolute/URL specifiers resolve on their own — route them back before the
    // package-json shim below, or local `@/config/settings.json` (a real repo file the SW can
    // serve as an ES module) would be mistaken for an npm subpath and swapped for the empty
    // virtual shim.
    if (spec.startsWith(".") || spec.startsWith("/") || /^data:|^[a-z][a-z0-9+.\-]*:/i.test(spec)) return m;
    // A bare *npm* subpath ending in .json (e.g. `import icons from "@iconify-json/ep/icons.json"`,
    // the Iconify offline-icon pattern every admin uses) becomes an esm.sh URL that serves
    // application/json — browsers reject JSON as a module script without an import assertion.
    // Vite inlines those at build time; here we route them to the empty-module shim so the app
    // boots (the icon collection just doesn't register — app-level data, not module failure).
    // Alias/local/relative specs are EXCLUDED — those are real repo files the SW serves as
    // ES modules (e.g. @/config/settings.json in arco-design-pro).
    const isAliasSpec = !!(cfg!.aliasMap && Object.keys(cfg!.aliasMap).some((k) => spec === k || spec.startsWith(k + "/")));
    const isLocalSpec = !!(cfg!.localDirs && cfg!.localDirs.includes(spec.split("/")[0]));
    if (!isLocalSpec && !isAliasSpec && /\/[A-Za-z0-9_.\-]+\.json$/.test(spec)) {
      const name = "json-" + spec.replace(/[^A-Za-z0-9_.$-]/g, "_").replace(/\.json$/, "");
      return `${ctx}${q}${relFrom(cfg!.dir || "", "__edgeqa_virtual__/" + name + ".js")}${endq}`;
    }
    const rootPrefix = cfg!.siteRoot ? cfg!.siteRoot + "/" : "";
    const first = spec.split("/")[0];
    if (cfg!.localDirs && cfg!.localDirs.includes(first)) {
      return `${ctx}${q}${relFrom(cfg!.dir || "", rootPrefix + spec)}${endq}`;
    }
    if (cfg!.aliasMap) {
      for (const [key, root] of Object.entries(cfg!.aliasMap)) {
        if (spec === key || spec.startsWith(key + "/")) {
          const rest = spec.slice(key.length).replace(/^\/+/, "");
          return `${ctx}${q}${relFrom(cfg!.dir || "", rootPrefix + (root ? root + "/" + rest : rest))}${endq}`;
        }
      }
    }
    let url = ESM_CDN + spec;
    // The npm package name is the first segment (react/jsx-runtime -> react) or the first two
    // for scoped packages (@s/p/sub -> @s/p). Pinning the PACKAGE keeps subpaths and the
    // framework's own runtime (react vs react/jsx-runtime) on the SAME version — a mismatch
    // breaks hooks.
    const pkgName = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    const pkgVer = cfg!.depVersions && (cfg!.depVersions[spec] || cfg!.depVersions[pkgName]);
    // `workspace:` / `catalog:` (pnpm) and other meta-protocols aren't npm versions — skip the
    // pin and let esm.sh resolve latest rather than pinning to a sentinel like `catalog:frontend`.
    if (pkgVer && !/^(workspace|file|link|npm|github|catalog):/i.test(pkgVer)) {
      const sub = spec.slice(pkgName.length).replace(/^\//, "");
      url = `${ESM_CDN}${pkgName}@${encodeURIComponent(pkgVer)}${sub ? "/" + sub : ""}`;
    }
    // Pin the framework runtime as a peer dep of every import so transitive packages
    // resolve to the app's framework version instead of esm.sh's latest (two React copies
    // break hooks). The framework packages themselves are already pinned by version.
    if (cfg!.pinDeps && !cfg!.pinDeps.includes(pkgName + "@")) url += "?deps=" + cfg!.pinDeps;
    return `${ctx}${q}${url}${endq}`;
  });
}

// Vite injects import.meta.env into every module; transpiled source still references it.
// Provide a module-scoped shim (production semantics) so `import.meta.env.MODE` and friends
// don't crash real apps (mirrors the SW's copy).
function shimEnv(js: string, env?: Record<string, string>): string {
  // Vite injects import.meta.env (and glob/hot glue) into every module; transpiled source still
  // references them. env gets production semantics; glob/globEager return an empty module map so
  // dynamic `for (const [path, loader] of Object.entries(import.meta.glob(...)))` loops iterate
  // nothing instead of crashing on an unregistered Vite-only API; hot is undefined. import.meta.url
  // is left untouched. Mirrors edgeqa-sw.js's copy.
  if (!/import\.meta\.(env|glob|globEager|hot)(?=[^A-Za-z0-9_$])/.test(js)) return js;
  const envLiteral = env && Object.keys(env).length
    ? ", " + Object.entries(env).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")
    : "";
  // Dev-flavored: a browser preview behaves like `vite dev`, and many apps branch on
  // import.meta.env.DEV/PROD/MODE (`import.meta.env.DEV ? devConfig : window[...]`). Production
  // semantics would push them down the wrong branch. Committed VITE_* values appended after.
  const shim = `const __edgeqa_env = { MODE: "development", DEV: true, PROD: false, SSR: false, BASE_URL: "/"${envLiteral} };`
    + '\nconst __edgeqa_glob = () => ({});'
    + '\nconst __edgeqa_globEager = () => ({});'
    + '\nconst __edgeqa_hot = undefined;';
  return shim + "\n" + js
    .replace(/import\.meta\.env(?=[^A-Za-z0-9_$])/g, "__edgeqa_env")
    .replace(/import\.meta\.globEager(?=[^A-Za-z0-9_$])/g, "__edgeqa_globEager")
    .replace(/import\.meta\.glob(?=[^A-Za-z0-9_$])/g, "__edgeqa_glob")
    .replace(/import\.meta\.hot(?=[^A-Za-z0-9_$])/g, "__edgeqa_hot");
}

// A CSS import can reference a package file (import "pkg/style.css") — those need the same
// bare-import treatment (esm.sh + version pin) as JS imports, since the browser resolves
// bare specifiers as relative paths and 404s. Mirrors the SW's copy.
function rewriteAssetUrl(url: string, cfg?: RewriteCfg): string {
  if (url.startsWith(".") || url.startsWith("/") || /^[a-z][a-z0-9+.\-]*:/i.test(url)) return url;
  const rewritten = rewriteBareImports(`import x from ${JSON.stringify(url)}`, cfg);
  const m = rewritten.match(/from ([\"'])(.*?)\1/);
  return m ? m[2] : url;
}

// preact-iso SSG sites call hydrate(<App/>, container) — with no prerendered HTML in a
// browser-only preview, hydrate renders nothing. preact-iso doesn't export render, so drop
// hydrate from its import and bind render (from preact) under the hydrate name instead.
// Mirrors the SW's copy.
function remapPreactIsoHydrate(js: string): string {
  return js.replace(/(import\s*\{)([^}]*?)(\}\s*from\s*["']preact-iso["'])/g, (m, head: string, names: string, tail: string) => {
    if (!/\bhydrate\b/.test(names)) return m;
    const rest = names.replace(/\bhydrate\b\s*,\s*/, "").replace(/\s*,\s*\bhydrate\b/, "").replace(/\s+/, " ").trim();
    const isoImport = rest ? `${head}${rest}${tail}` : "";
    return `import { render as hydrate } from 'preact';\n${isoImport}`.replace(/\n$/, "");
  });
}

// Shared per-module post-processing (matches the SW's copy): CSS imports become stylesheet
// injectors, asset imports become URL strings, and bare imports rewrite (aliases/local dirs
// relative, npm packages to esm.sh with version pins).
function postProcessJs(js: string, cfg?: RewriteCfg, modulePath?: string): string {
  js = remapPreactIsoHydrate(js);
  js = shimEnv(js, cfg?.env);
  // Vite `define` globals (__APP_INFO__) and CJS (require/module.exports) from webpack-era
  // source. The CJS conversion emits real imports, so it must run before the CSS/asset strips
  // (a `require('./x.css')`-converted `import './x.css'` still becomes a stylesheet injector)
  // and before the bare-import rewrite (converted specifiers still resolve aliases/esm.sh).
  js = shimWebpackAmd(js);
  js = shimViteGlobals(js);
  const beforeCjs = js;
  js = shimCommonJS(js);
  if (modulePath) {
    const key = extlessPath(modulePath);
    const reg = js !== beforeCjs ? cjsTargets : esmTargets;
    reg.add(key);
    if (/\/index$/.test(key)) reg.add(key.replace(/\/index$/, ""));
  }
  const extraDir = cfg?.extraDir;
  // Absolute URLs (esm.sh rewrites, data:, root-relative) must pass through untouched —
  // prefixing extraDir onto them mangles `/https:/…` style paths. Mirrors the SW's copy.
  const offset = (u: string) => (!extraDir || /^[a-z][a-z0-9+.\-]*:|^\//i.test(u) ? u : `./${extraDir}/${u}`);
  const cssUrls: string[] = [];
  // CSS modules: `import style from './x.module.css'` binds a class map (style.foo). We serve
  // the source CSS unhashed, so a Proxy that returns the key as the class name matches the
  // real selectors. Must run before the generic CSS-strip below. Mirrors the SW's copy.
  js = js.replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+?\.module\.(?:css|scss|sass|less|styl))\2/g, (m, name, q, url) => {
    cssUrls.push(offset(rewriteAssetUrl(url, cfg)));
    return `const ${name} = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : "") });`;
  });
  js = js.replace(/(?:import\s+(?:[^'"]*?\s+from\s+)?)(['"])([^'"]+?\.(?:css|scss|sass|less|styl))\1/g, (m, q, url) => { cssUrls.push(offset(rewriteAssetUrl(url, cfg))); return ""; });
  js = js.replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+?\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp|mp4|webm|mp3|wav|ogg|woff2?|ttf|eot))\2/g, (m, name, q, url) => `const ${name} = new URL(${q}${offset(url)}${q}, import.meta.url).href;`);
  if (cssUrls.length) {
    const injector = cssUrls.map((u) => `(()=>{const l=document.createElement("link");l.rel="stylesheet";l.href=new URL(${JSON.stringify(u)},import.meta.url).href;document.head.appendChild(l);})();`).join("");
    js = injector + js;
  }
  // Directory-index modules (./x -> ./x/index.js) are served at the extensionless URL
  // `/…/x`, so the browser resolves sibling imports (`./y`) against `/…` — one level up.
  // Prefix every relative specifier with the directory offset (./y -> ./x/y). Runs after the
  // CSS/asset rewrites so those specifiers aren't double-offset. Mirrors the SW's copy.
  if (extraDir) {
    js = js.replace(/((?:from\s+|import\s*\(|(?:^|[\n]\s*)import\s+|export\s+[^;]*?from\s+))(["'])((?:\.\.?\/)[^"']*)/g, (m, ctx, q, rel) => `${ctx}${q}./${extraDir}/${rel}`);
  }
  // Local named imports into CJS-transformed modules need the namespace+default fallback so
  // `import { recordRoute } from '@/config'` binds whether config is ESM-named or default-only.
  js = cjsInteropNamedImports(js, cfg, modulePath);
  return rewriteBareImports(js, cfg);
}

const componentName = (path: string) => (path.split("/").pop() || "Component").replace(/[^A-Za-z0-9_$]/g, "") || "Component";
function simpleHash(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h).toString(36); }

// sucrase's TypeScript transform elides imports it thinks are unused — but inside a Vue SFC's
// <script> the compiler only sees the script body, so imports referenced exclusively in the
// <template> (components, config objects) look unused and get stripped, breaking the render
// (missing bindings). Preserve every value import whose specifier no longer appears in the
// stripped output. `import type` and type-only forms are left elided (they don't exist at runtime).
export function preserveSucraseImports(raw: string, stripped: string, templateText?: string): string {
  // Without a template there is nothing the compiler can't see: sucrase only elides imports
  // that are type-only or genuinely unused, and re-adding them would resurrect bindings that
  // don't exist at runtime (e.g. `import { LanguageType } from "./stores/interface"` where the
  // module exports only types). Only Vue SFCs — whose script body hides template-only usages —
  // need the re-add, and only for names the template actually references.
  if (!templateText) return stripped;
  const out = [];
  for (const m of raw.matchAll(/import\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']\s*;?/g)) {
    const line = m[0];
    if (/\bimport\s+type\b/.test(line)) continue;
    // Binding names (named, default, or namespace): the template-referenced ones are why
    // sucrase's script-only view stripped the line, so only those may come back. A type-only
    // import's names never appear in the template and must stay elided.
    let names: string[] = [];
    const braces = line.match(/\{([^}]*)\}/);
    if (braces) {
      names = braces[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    } else {
      const def = line.match(/import\s+([A-Za-z_$][\w$]*)\s+from/);
      if (def) names = [def[1]];
    }
    if (names.length && !names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(templateText))) continue;
    const spec = m[1];
    // Still present (same specifier, any binding shape) -> sucrase kept it.
    // NOTE: template literals collapse a lone `\s` to a literal "s", so the regex must
    // use `\\s` — otherwise `froms*` never matches `from 'vue'` and every import gets
    // re-added, duplicating the ones sucrase kept (compileScript throws on duplicate ids).
    if (new RegExp(`from\\s*["']${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(stripped)) continue;
    out.push(line.replace(/;$/, "") + ";");
  }
  return out.length ? out.join("\n") + "\n" + stripped : stripped;
}

// Compile a .svelte file — component or Svelte 5 runes module (.svelte.ts/.svelte.js, whose
// top-level $state/$derived need compiler transformation) — to final module text. Svelte embeds
// the component's own CSS when css:injected, so the output is a single module with styles
// attached; svelte/internal/* (bare) imports rewrite to esm.sh like any other.
export async function compileSvelteText(text: string, path: string, cfg?: RewriteCfg): Promise<string> {
  // Compile with the repo's pinned Svelte major when known — Svelte 5's compiler emits Svelte 5
  // runtime calls (runes, Symbol($state)) that crash against a Svelte 3 runtime. esm.sh resolves
  // the range (^3.55.0 -> 3.x), so pass the raw pin through.
  const pinned = cfg?.depVersions?.svelte;
  const ver = pinned && !/^(workspace|file|link|npm|github|catalog):/i.test(pinned) ? encodeURIComponent(pinned) : "5";
  // @vite-ignore: this is a runtime esm.sh import, never a bundled dep.
  const svelte: any = await import(/* @vite-ignore */ `${ESM_CDN}svelte@${ver}/compiler`);
  const isRunesModule = /\.svelte\.(js|ts)$/i.test(path || "");
  if (isRunesModule) {
    // Runes modules compile through Svelte's dedicated compileModule API (compile() parses them
    // as components and chokes on module-level code). compileModule does NOT strip TypeScript,
    // so strip .svelte.ts types with sucrase first — the same trick the Vue SFC path uses.
    let source = text;
    if (/\.svelte\.ts$/i.test(path || "")) {
      const sucrase: any = await import(/* @vite-ignore */ `${ESM_CDN}sucrase`);
      try { source = preserveSucraseImports(text, sucrase.transform(text, { transforms: ["typescript"] }).code || text); } catch { /* keep raw on failure */ }
    }
    const result = svelte.compileModule(source, { filename: path, generate: "client", dev: false });
    return postProcessJs((result.js && result.js.code) || "", cfg, path);
  }
  const result = svelte.compile(text, { filename: path, name: componentName(path), generate: "client", css: "injected", dev: false });
  return postProcessJs((result.js && result.js.code) || "", cfg, path);
}

// unplugin-auto-import (and Vue's <script setup> ergonomics) let real Vue apps use the
// Composition API + vue-router helpers WITHOUT importing them — the plugin injects the imports
// at build time. The browser can't run that codegen, so compile-time here: for each standard
// auto-imported name the SFC actually references but never binds, inject the real import.
const VUE_AUTO_IMPORTS = ["ref", "reactive", "computed", "watch", "watchEffect", "watchPostEffect", "watchSyncEffect", "onMounted", "onUnmounted", "onBeforeUnmount", "onUpdated", "onBeforeMount", "onBeforeUpdate", "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered", "onScopeDispose", "onServerPrefetch", "nextTick", "toRef", "toRefs", "toValue", "provide", "inject", "getCurrentInstance", "h", "createApp", "defineAsyncComponent", "markRaw", "shallowRef", "shallowReactive", "isRef", "unref", "isReactive", "isReadonly", "readonly", "customRef", "triggerRef", "effectScope", "getCurrentScope", "useAttrs", "useSlots", "useTemplateRef", "useId", "useModel", "mergeProps", "isProxy", "toRaw", "isShallow", "isVNode", "cloneVNode", "defineComponent"];
const ROUTER_AUTO_IMPORTS = ["useRoute", "useRouter", "useLink", "onBeforeRouteLeave", "onBeforeRouteUpdate"];
const PINIA_AUTO_IMPORTS = ["defineStore", "storeToRefs", "mapState", "mapGetters", "mapActions", "mapMutations"];

function injectVueAutoImports(code: string): string {
  const bound = new Set<string>();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) bound.add(name);
    }
  }
  for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/g)) bound.add(m[1]);
  for (const m of code.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  const inject = (names: string[], from: string) => {
    const need = names.filter((n) => !bound.has(n) && new RegExp(`\\b${n}\\b`).test(code));
    return need.length ? `import { ${need.join(", ")} } from "${from}";` : "";
  };
  const lines = [inject(VUE_AUTO_IMPORTS, "vue"), inject(ROUTER_AUTO_IMPORTS, "vue-router"), inject(PINIA_AUTO_IMPORTS, "pinia")].filter(Boolean);
  return lines.length ? lines.join("\n") + "\n" + code : code;
}

// Compile a .vue SFC with @vue/compiler-sfc (final module text). Assembles a module that
// re-exports the component with render + scopeId attached so Vue's runtime can render it
// without a runtime template compiler.
export async function compileVueText(text: string, path: string, cfg?: RewriteCfg): Promise<string> {
  // @vite-ignore: runtime esm.sh import, not a bundled dep.
  const sfc: any = await import(/* @vite-ignore */ `${ESM_CDN}@vue/compiler-sfc@3`);
  const { parse, compileScript, compileTemplate, compileStyleAsync } = sfc;
  const id = "data-v-" + simpleHash(path);
  const filename = path.split("/").pop() || "App.vue";
  // <script lang="ts"> can't run in a browser: @vue/compiler-sfc wants fs access to resolve
  // imported types (and throws on unresolvable `extends`). Strip TypeScript from the script
  // blocks of the RAW source with sucrase BEFORE parse — compiler-sfc then sees plain JS and
  // never needs type resolution. Mutating descriptor blocks after parse doesn't work
  // (compileScript re-reads the original source).
  if (/<script[^>]*\blang\s*=\s*["']ts/.test(text)) {
    const sucrase: any = await import(/* @vite-ignore */ `${ESM_CDN}sucrase`);
    // Template-only bindings are why the re-add exists — pass the template so type-only
    // imports (whose names never appear in it) stay elided instead of resurrected.
    const templateText = (text.match(/<template[^>]*>([\s\S]*?)<\/template\s*>/) || [])[1] || "";
    const stripBody = (body: string) => {
      try { return preserveSucraseImports(body, sucrase.transform(body, { transforms: ["typescript"] }).code || body, templateText); } catch { return body; }
    };
    text = text.replace(/(<script[^>]*>)([\s\S]*?)(<\/script\s*>)/g, (m, open, body, close) =>
      /\blang\s*=\s*["']ts/.test(open) ? open + stripBody(body) + close : m,
    );
  }
  const { descriptor } = parse(text, { filename });
  let script: any = null;
  if (descriptor.script || descriptor.scriptSetup) {
    script = compileScript(descriptor, { id });
  }
  const scoped = (descriptor.styles || []).some((s: any) => s.scoped);
  let renderCode = "";
  if (descriptor.template) {
    const r = compileTemplate({ source: descriptor.template.content, filename, id, scoped, compilerOptions: { bindingMetadata: (script && script.bindings) || {}, isProd: true } });
    renderCode = (r && r.code) || "";
  }
  const cssParts: string[] = [];
  for (const block of descriptor.styles || []) {
    try {
      const res = block.scoped
        ? await compileStyleAsync({ source: block.content, filename, id, scoped: true })
        : await compileStyleAsync({ source: block.content, filename });
      if (res && res.code && !(res.errors && res.errors.length)) cssParts.push(res.code);
    } catch { /* skip a broken style block rather than fail the module */ }
  }
  const styleCode = cssParts.length ? `(()=>{const s=document.createElement("style");s.setAttribute("data-edgeqa-vue","1");s.textContent=${JSON.stringify(cssParts.join("\n"))};document.head.appendChild(s);})();` : "";
  let code = (script && script.content) ? script.content.replace(/export\s+default/, "const __sfc__ =") : "";
  const hasSfc = code.includes("__sfc__");
  code += "\n" + renderCode;
  code += "\n" + styleCode;
  code += hasSfc
    ? (scoped ? `\nexport default Object.assign({}, __sfc__, { render, __scopeId: ${JSON.stringify(id)} });` : `\nexport default Object.assign({}, __sfc__, { render });`)
    : (scoped ? `\nexport default { render, __scopeId: ${JSON.stringify(id)} };` : `\nexport default { render };`);
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  code = injectVueAutoImports(code);
  return postProcessJs(code, { ...cfg, dir: cfg?.dir || dir }, path);
}
