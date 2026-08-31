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
const mime = { html: "text/html", css: "text/css", scss: "text/css", sass: "text/css", less: "text/css", styl: "text/css", js: "application/javascript", mjs: "application/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", txt: "text/plain", map: "application/json" };

// --- Experimental in-browser build tier (react / preact / jsx+tsx / vue / svelte) ---
// Source repos are compiled and served entirely in the browser. JSX/TSX transpile through
// @babel/standalone in the worker; every bare npm import is rewritten at serve time to the
// esm.sh CDN, so ANY dependency a real app imports resolves — no hand-mapped allowlist.
// Vue .vue and Svelte .svelte compiler SDKs are ESM, and import() is banned on
// ServiceWorkerGlobalScope, so the worker delegates those to the controlling app page via
// a postMessage round-trip (the page dynamic-imports them off esm.sh). No server, no
// bundler, no token leaving the browser.
const BABEL_URL = "https://unpkg.com/@babel/standalone@7.26.4/babel.min.js";
const ESM_CDN = "https://esm.sh/";
const presetByScope = new Map();
// Per-scope build-tier config: framework preset, source-path aliases ("@" -> "src"),
// top-level local dirs (for bare "src/..." imports), the site root (for package.json
// version pinning), and the lazily-fetched dependency version map.
const aliasByScope = new Map();
const localDirsByScope = new Map();
const siteRootByScope = new Map();
const depVersionsByScope = new Map();
const envByScope = new Map();
const publicByScope = new Map(); // tokenless sessions the generator verified as public

// Resolve a site-root-relative target path from a module's (served) directory — the
// same "relative to the importing module" semantics Vite gives aliases/baseUrl imports.
function relFrom(fromDir, toPath) {
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

// importScripts() is only legal in a service worker during install/evaluation, so load
// @babel/standalone lazily on first transpile via fetch + indirect eval (runs in the worker
// global scope, no CSP on this SW). Fails safe to raw bytes.
async function postDebug(payload) {
  try {
    const clients = await self.clients.matchAll();
    clients.forEach((client) => client.postMessage({ type: "EDGEQA_DEBUG", ...payload }));
  } catch { /* best-effort */ }
}
async function ensureBabel() {
  if (self.Babel) { postDebug({ babel: "already", has: !!self.Babel }); return true; }
  try {
    log("loading babel");
    const res = await fetch(BABEL_URL);
    if (!res.ok) {
      log("babel fetch failed", res.status);
      return false;
    }
    (0, eval)(await res.text());
    log("babel loaded", !!self.Babel);
    postDebug({ babel: "loaded", has: !!self.Babel });
    return !!self.Babel;
  } catch (error) {
    log("babel unavailable", String(error));
    return false;
  }
}

// Rewrite bare specifiers to what the browser can actually fetch.
//   * Local dirs ("src/services") and aliases ("@/x", "$lib/y") resolve relative to the
//     importing module — Vite's alias/baseUrl semantics, no import map needed.
//   * Everything else is an npm package: rewritten to absolute esm.sh URLs, pinned to
//     the repo's package.json version when known (esm.sh serves the LATEST by default,
//     which breaks apps built against older pins).
// Relative (./), absolute (/), and URL (https:/data:...) specifiers are left untouched.
// Relative path from a module's served directory to a target DIRECTORY (for template-literal
// import prefixes like "@/layouts/"): "./x" style, with "./" for the same directory.
function relDirFrom(fromDir, toDir) {
  const from = fromDir ? fromDir.split("/").filter(Boolean) : [];
  const to = (toDir || "").split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.length - i;
  const down = to.slice(i).join("/");
  return (ups ? "../".repeat(ups) : "./") + down;
}

function rewriteBareImports(js, cfg) {
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
    // rewrite them to a synthetic module (siteRoot/__edgeqa_virtual__/<name>.js) that this SW serves
    // as an empty ES module — a no-op side-effect import that lets the app boot without its SVG sprite.
    if (spec.startsWith("virtual:")) {
      const name = spec.slice("virtual:".length).replace(/[^A-Za-z0-9_\-/.\$]/g, "_") || "module";
      const rootPrefix = cfg.siteRoot ? cfg.siteRoot + "/" : "";
      return `${ctx}${q}${relFrom(cfg.dir || "", rootPrefix + "__edgeqa_virtual__/" + name + ".js")}${endq}`;
    }
    // A bare *npm* subpath ending in .json (e.g. `import icons from "@iconify-json/ep/icons.json"`,
    // the Iconify offline-icon pattern every admin uses) becomes an esm.sh URL that serves
    // application/json — browsers reject JSON as a module script without an import assertion.
    // Vite inlines those at build time; here we route them to the empty-module shim so the app
    // boots (the icon collection just doesn't register — app-level data, not module failure).
    if (/\/[A-Za-z0-9_.\-]+\.json$/.test(spec)) {
      const name = "json-" + spec.replace(/[^A-Za-z0-9_.$-]/g, "_").replace(/\.json$/, "");
      const rootPrefix = cfg.siteRoot ? cfg.siteRoot + "/" : "";
      return `${ctx}${q}${relFrom(cfg.dir || "", rootPrefix + "__edgeqa_virtual__/" + name + ".js")}${endq}`;
    }
    if (spec.startsWith(".") || spec.startsWith("/") || /^data:|^[a-z][a-z0-9+.\-]*:/i.test(spec)) return m;
    // Local dirs and aliases are relative to the *site root* (the sandbox document dir),
    // so targets are prefixed with it before computing the module-relative path.
    const rootPrefix = cfg.siteRoot ? cfg.siteRoot + "/" : "";
    const first = spec.split("/")[0];
    if (cfg.localDirs && cfg.localDirs.includes(first)) {
      return `${ctx}${q}${relFrom(cfg.dir || "", rootPrefix + spec)}${endq}`;
    }
    // source aliases: "@/x" -> <aliasRoot>/x, "$lib/y" -> src/lib/y (relative to module)
    if (cfg.aliasMap) {
      for (const [key, root] of Object.entries(cfg.aliasMap)) {
        if (spec === key || spec.startsWith(key + "/")) {
          const rest = spec.slice(key.length).replace(/^\/+/, "");
          return `${ctx}${q}${relFrom(cfg.dir || "", rootPrefix + (root ? root + "/" + rest : rest))}${endq}`;
        }
      }
    }
    let url = ESM_CDN + spec;
    // The npm package name is the first segment (react/jsx-runtime -> react) or the first two
    // for scoped packages (@s/p/sub -> @s/p). Pinning the PACKAGE keeps subpaths and the
    // framework's own runtime (react vs react/jsx-runtime) on the SAME version — a mismatch
    // breaks hooks.
    const pkgName = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    const pkgVer = cfg.depVersions && (cfg.depVersions[spec] || cfg.depVersions[pkgName]);
    // Workspace/file/link specs aren't npm versions — skip the pin and let esm.sh resolve latest.
    // `workspace:` / `catalog:` (pnpm) and other meta-protocols aren't npm versions — skip the
    // pin and let esm.sh resolve latest rather than pinning to a sentinel like `catalog:frontend`.
    if (pkgVer && !/^(workspace|file|link|npm|github|catalog):/i.test(pkgVer)) {
      const sub = spec.slice(pkgName.length).replace(/^\//, "");
      url = `${ESM_CDN}${pkgName}@${encodeURIComponent(pkgVer)}${sub ? "/" + sub : ""}`;
    }
    // Pin the framework runtime as a peer dep of every import so transitive packages
    // (e.g. a UI lib importing react) resolve to the app's react/react-dom instead of
    // esm.sh's latest — otherwise two React copies break hooks. The framework packages
    // themselves (already pinned by version) are skipped.
    if (cfg.pinDeps && !cfg.pinDeps.includes(pkgName + "@")) url += "?deps=" + cfg.pinDeps;
    return `${ctx}${q}${url}${endq}`;
  });
}

// Transpile JSX/TSX and rewrite CSS imports into stylesheet-link injectors (vite style
// `import "./App.css"`). Any remaining bare imports are rewritten (aliases/local dirs to
// relative paths, npm packages to esm.sh) so the browser resolves them without an import map.
function transpileModule(code, path, extraDir, cfg) {
  const isTs = /\.tsx?$/i.test(path);
  // Preact apps must compile JSX against preact's own runtime (preact/jsx-runtime) — the
  // React runtime produces React elements that preact's render can't mount (silently empty).
  const jsxOpts = { runtime: "automatic", ...(cfg && cfg.preset === "preact" ? { importSource: "preact" } : {}) };
  const presets = isTs ? [["react", jsxOpts], "typescript"] : [["react", jsxOpts]];
  const plugins = [["proposal-decorators", { legacy: true }], ["proposal-class-properties", { loose: true }]];
  const out = self.Babel.transform(code, { presets, plugins, filename: path, sourceMaps: false, comments: false });
  // postProcessJs applies the directory-index extraDir offset (and everything else).
  return postProcessJs(out.code || "", cfg, extraDir);
}

// Vite injects import.meta.env into every module; transpiled source still references it.
// Provide a module-scoped shim (production semantics) so `import.meta.env.MODE` and friends
// don't crash real apps. Real VITE_* vars are unknowable here — they read as undefined.
// env (optional) carries committed `.env*` file values (see envFor) so `import.meta.env.VITE_*`
// resolves to the repo's declared config instead of undefined.
function shimEnv(js, env) {
  // Vite injects import.meta.env (and glob/hot glue) into every module; transpiled source still
  // references them. env gets production semantics; glob/globEager return an empty module map so
  // dynamic `for (const [path, loader] of Object.entries(import.meta.glob(...)))` loops iterate
  // nothing instead of crashing on an unregistered Vite-only API; hot is undefined. import.meta.url
  // is left untouched. Mirrors frame.ts's copy.
  if (!/import\.meta\.(env|glob|globEager|hot)(?=[^A-Za-z0-9_$])/.test(js)) return js;
  const envLiteral = env && Object.keys(env).length
    ? ", " + Object.entries(env).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")
    : "";
  // Dev-flavored: a browser preview behaves like `vite dev`, and many apps branch on
  // import.meta.env.DEV/PROD/MODE (`import.meta.env.DEV ? devConfig : window[...]`). Production
  // semantics would push them down the wrong branch. Committed VITE_* values appende after.
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

// Shared per-module post-processing for the JSX/plain-JS tiers served directly by this
// worker: Vite-style CSS imports become stylesheet-link injectors, image/asset imports
// become URL strings, and bare imports are rewritten (aliases/local dirs relative,
// npm packages to esm.sh). extraDir offsets CSS/asset URLs for directory-index modules
// served at extensionless URLs. (Vue/Svelte output is post-processed on the page instead —
// see frame.ts.)
// A CSS import can reference a package file (import "pkg/style.css") — those need the same
// bare-import treatment (esm.sh + version pin) as JS imports, since the browser resolves
// bare specifiers as relative paths and 404s.
function rewriteAssetUrl(url, cfg) {
  if (url.startsWith(".") || url.startsWith("/") || /^[a-z][a-z0-9+.\-]*:/i.test(url)) return url;
  const out = { spec: url };
  // Reuse the bare-import decision by faking a single import line.
  const fake = `import x from ${JSON.stringify(url)}`;
  const rewritten = rewriteBareImports(fake, cfg);
  const m = rewritten.match(/from ([\"'])(.*?)\1/);
  return m ? m[2] : url;
}

// preact-iso SSG sites call hydrate(<App/>, container) — with no prerendered HTML in a
// browser-only preview, hydrate renders nothing. preact-iso doesn't export render, so drop
// hydrate from its import and bind render (from preact) under the hydrate name instead.
function remapPreactIsoHydrate(js) {
  return js.replace(/(import\s*\{)([^}]*?)(\}\s*from\s*["']preact-iso["'])/g, (m, head, names, tail) => {
    if (!/\bhydrate\b/.test(names)) return m;
    const rest = names.replace(/\bhydrate\b\s*,\s*/, "").replace(/\s*,\s*\bhydrate\b/, "").replace(/\s+/, " ").trim();
    const isoImport = rest ? `${head}${rest}${tail}` : "";
    return `import { render as hydrate } from 'preact';\n${isoImport}`.replace(/\n$/, "");
  });
}

// unplugin-auto-import lets real Vue apps use the Composition API + vue-router helpers in
// .vue AND .js/.ts modules without importing them (the plugin injects the imports at build
// time). The browser can't run that codegen, so compile-time here: for each standard
// auto-imported name the module actually references but never binds, inject the real import.
// Mirrors the page-side copy in frame.ts.
function injectVueAutoImports(code) {
  const bound = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) bound.add(name);
    }
  }
  for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/g)) bound.add(m[1]);
  for (const m of code.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  const inject = (names, from) => {
    const need = names.filter((n) => !bound.has(n) && new RegExp(`\\b${n}\\b`).test(code));
    return need.length ? `import { ${need.join(", ")} } from "${from}";` : "";
  };
  const lines = [inject(VUE_AUTO_IMPORTS, "vue"), inject(ROUTER_AUTO_IMPORTS, "vue-router")].filter(Boolean);
  return lines.length ? lines.join("\n") + "\n" + code : code;
}
const VUE_AUTO_IMPORTS = ["ref", "reactive", "computed", "watch", "watchEffect", "watchPostEffect", "watchSyncEffect", "onMounted", "onUnmounted", "onBeforeUnmount", "onUpdated", "onBeforeMount", "onBeforeUpdate", "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered", "onScopeDispose", "onServerPrefetch", "nextTick", "toRef", "toRefs", "toValue", "provide", "inject", "getCurrentInstance", "h", "createApp", "defineAsyncComponent", "markRaw", "shallowRef", "shallowReactive", "isRef", "unref", "isReactive", "isReadonly", "readonly", "customRef", "triggerRef", "effectScope", "getCurrentScope", "useAttrs", "useSlots", "useTemplateRef", "useId", "useModel", "mergeProps", "isProxy", "toRaw", "isShallow", "isVNode", "cloneVNode", "defineComponent"];
const ROUTER_AUTO_IMPORTS = ["useRoute", "useRouter", "useLink", "onBeforeRouteLeave", "onBeforeRouteUpdate"];

function postProcessJs(js, cfg, extraDir) {
  js = remapPreactIsoHydrate(js);
  js = shimEnv(js, cfg && cfg.env);
  const offset = (u) => (extraDir ? `./${extraDir}/${u}` : u);
  const cssUrls = [];
  // CSS modules: `import style from './x.module.css'` binds a class map (style.foo). We serve
  // the source CSS unhashed, so a Proxy that returns the key as the class name matches the
  // real selectors. Must run before the generic CSS-strip below, which would drop the binding.
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
  // Real Vite rewrites those specifiers to the resolved path; here we prefix every relative
  // specifier with the directory offset (./y -> ./x/y, ../y -> ./x/../y) so they resolve
  // against the module's true folder. Runs after the CSS/asset rewrites so those specifiers
  // aren't double-offset. (transpileModule also ends here, so this covers the JSX tiers.)
  if (extraDir) {
    js = js.replace(/((?:from\s+|import\s*\(|(?:^|[\n]\s*)import\s+|export\s+[^;]*?from\s+))(["'])((?:\.\.?\/)[^"']*)/g, (m, ctx, q, rel) => `${ctx}${q}./${extraDir}/${rel}`);
  }
  // Vue apps commonly auto-import the Composition API in plain .js/.ts modules too — inject
  // the real imports so those modules don't ReferenceError. Compiled .vue output already gets
  // this on the page; raw .js/.mjs under the vue preset needs it here.
  if (cfg && cfg.preset === "vue") js = injectVueAutoImports(js);
  return rewriteBareImports(js, cfg);
}

// ---- Vue/Svelte compile delegation to the app page ---------------------------------
// The page owns the esm.sh compiler imports (Vue/Svelte are ESM and import() is disallowed
// on ServiceWorkerGlobalScope). The worker posts an EDGEQA_COMPILE_REQUEST to its clients,
// the app page compiles + post-processes, and replies with EDGEQA_COMPILE_RESPONSE which
// resolves the pending fetch. Fails safe to the raw file if no page answers in time.
const compileSeq = { n: 0 };
const compilePending = new Map();
function compileViaClient(preset, code, path, ctx) {
  return new Promise((resolve) => {
    const id = "c" + (++compileSeq.n);
    const timeout = setTimeout(() => {
      compilePending.delete(id);
      log("compile round-trip timed out (no page answered)", path, preset);
      resolve({ ok: false });
    }, 15000);
    compilePending.set(id, { path, resolve: (ok, out) => { clearTimeout(timeout); resolve(ok ? { ok: true, code: out } : { ok: false }); } });
    self.clients.matchAll().then((clis) => clis.forEach((c) => c.postMessage({ type: "EDGEQA_COMPILE_REQUEST", id, preset, code, path, ctx })));
  });
}

// Rewrite app-root-absolute asset refs ("/src/main.tsx") to be relative to this document's
// directory — vite dev HTML treats "/x" as relative to the folder holding index.html, which
// is exactly what the sandbox entry document represents. Bare-import resolution happens
// per-module (see rewriteBareImports), so no import map is needed.
function transformHtml(html) {
  return html.replace(/((?:src|href|poster)=[""])\/(?!\/)([^""]*)/g, (m, pre, p) => `${pre}${p}`);
}

// CRA/rollup/webpack-style repos commit an index.html that references build output (or
// nothing at all — CRA's dev template has no script tag; the bundler injects it). Under an
// active preset, bridge those documents to the repo's real source entry: probe the
// conventional Vite/CRA entries relative to the document's directory and rewrite the HTML
// to load the first one that exists. Returns the possibly-rewritten HTML.
const ENTRY_CANDIDATES = ["src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js", "src/index.tsx", "src/index.jsx", "src/index.ts", "src/index.js", "main.jsx", "main.tsx", "main.js"];
const ARTIFACT_SCRIPT_RE = /\/(?:build|dist|out|output|static|bundles|bundle)\/[^"']*\.js$|\/(?:bundle|vendor)\.[a-z0-9]+\.js$/i;
async function bridgeHtmlEntry(html, info, token) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi)].map((m) => ({ tag: m[0], src: m[1] }));
  const artifactRefs = scripts.filter((s) => ARTIFACT_SCRIPT_RE.test(s.src));
  // Vite-style docs reference real source files (./src/main.tsx) — nothing to bridge.
  // A doc with NO scripts (CRA template) or with artifact refs (rollup/webpack) needs the entry.
  if (scripts.length && !artifactRefs.length) return html;
  const docDir = info.path.includes("/") ? info.path.slice(0, info.path.lastIndexOf("/")) : "";
  const ups = docDir ? docDir.split("/").length : 0;
  const relPrefix = ups ? "../".repeat(ups) : "";
  // Probe conventional entries relative to the document's directory first (standard Vite/CRA
  // layout: index.html + src/ at the app root), then relative to the repo root (legacy
  // CRA/rollup templates keep index.html in public/ but src/ at the repo root). The injected
  // src must stay relative to the DOCUMENT, hence the ../-prefix for repo-root entries.
  const candidates = [
    ...ENTRY_CANDIDATES.map((c) => ({ probe: docDir ? docDir + "/" + c : c, rel: c })),
    ...ENTRY_CANDIDATES.map((c) => ({ probe: c, rel: relPrefix + c })),
  ];
  for (const { probe, rel } of candidates) {
    const r = await githubFileSafe({ ...info, path: probe }, token);
    if (r && r.status === 200) {
      log("bridged html entry", info.path, "->", rel);
      let out = html;
      for (const s of artifactRefs) out = out.replace(s.tag, "");
      const inject = `  <script type="module" src="${rel}"></script>\n`;
      return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, inject + "</body>") : out + inject;
    }
  }
  return html;
}

// Returns a transformed Response, or null when no transform applies (or the compiler for the
// active preset is unavailable) so the caller serves the original bytes.
async function applyPreset(res, info, extraDir, preset, cfg) {
  try {
    const p = info.path;
    if (/\.html?$/i.test(p)) {
      let text = await res.text();
      // Build-tier entry bridge: docs that reference build output (or nothing) get wired to
      // the repo's real source entry so CRA/rollup/webpack-style repos render too.
      if (preset) text = await bridgeHtmlEntry(text, info, cfg.token || "");
      // Source apps are written for Vite dev's "/" URL, so client-side routers (React
      // Router, Vue Router…) see a pathname they have routes for. Rewrite the address to
      // "/" after load — document baseURI is unchanged, so relative module/asset URLs
      // keep resolving against the real file, and the original path survives as data
      // attribute for bug reports.
      // CRA/webpack apps reference Node globals (`global`, `process.env`) that their bundler
      // polyfills; provide them at document scope so transpiled source boots.
      const routerFix = `<script>try{(function(){var p=location.pathname;if(p!=="/"){history.replaceState(null,"","/");document.documentElement.setAttribute("data-edgeqa-path",p);}})()}catch(e){}window.global=window;window.process={env:{NODE_ENV:"production"}};</script>`;
      return new Response(transformHtml(text) + routerFix + "<!--SW-DONE-->", { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    const jsResp = (marker, body) => new Response(marker + body, { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" } });
    // .svelte components AND Svelte 5 runes modules (.svelte.ts/.svelte.js, which hold top-level
    // $state/$derived that the browser can't parse). Without the runes-module match they'd fall
    // through to the plain TS/Babel branch below and keep literal `$state` -> ReferenceError.
    if (preset === "svelte" && /\.svelte(?:\.(?:js|ts))?$/i.test(p)) {
      const text = await res.text();
      const r = await compileViaClient("svelte", text, p, cfg);
      return jsResp(r.ok ? "/*SW-SVELTE*/" : "/*SW-SVELTE-FAIL*/", r.ok ? r.code : text);
    }
    if (preset === "vue" && /\.vue$/i.test(p)) {
      const text = await res.text();
      const r = await compileViaClient("vue", text, p, cfg);
      return jsResp(r.ok ? "/*SW-VUE*/" : "/*SW-VUE-FAIL*/", r.ok ? r.code : text);
    }
    // JSON module imports: `import data from './config.json'` is a Vite staple but browsers
    // reject application/json as a module script. When a .json is requested AS A SCRIPT
    // (module import, not fetch()), serve it wrapped as an ES module. fetch() calls keep the
    // raw JSON payload.
    if (preset && /\.json$/i.test(p) && cfg.requestDest === "script") {
      const text = await res.text();
      return new Response(`export default ${text.trim() || "{}"};`, { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" } });
    }
    if (/\.(jsx|tsx|ts)$/i.test(p)) {
      const text = await res.text();
      if (!(await ensureBabel())) return jsResp("/*SW-BABEL-FAIL*/", text);
      return jsResp("/*SW-TRANSPILED*/", transpileModule(text, p, extraDir, cfg));
    }
    // Plain ESM source (.js/.mjs) that isn't a build artifact: JSX-family presets (react,
    // preact, jsx) also transpile these — CRA apps keep JSX inside .js files — while other
    // presets (vue/svelte) just post-process (CSS/asset imports -> injectors/URLs, bare npm
    // imports -> esm.sh). Babel's react preset is a no-op on plain JS, so running it is safe.
    if (/\.(js|mjs)$/i.test(p) && !/(^|\/)(dist|build|out|output|bundles|bundle)\/|(^|\/)(dist|bundle)[^/]*\.js/i.test(p)) {
      const text = await res.text();
      if (preset === "react" || preset === "preact" || preset === "jsx") {
        if (!(await ensureBabel())) return jsResp("/*SW-BABEL-FAIL*/", text);
        return jsResp("/*SW-TRANSPILED*/", transpileModule(text, p, extraDir, cfg));
      }
      return jsResp("/*SW-REWRITTEN*/", postProcessJs(text, cfg, extraDir));
    }
  } catch (error) { log("preset transform failed", info.path, preset, String(error)); }
  return null;
}

// Lazily fetch the app-root package.json for a scope and build a name -> version map so
// esm.sh rewrites pin the versions the repo actually uses (esm.sh's default is latest,
// which breaks apps pinned to older releases). Cached per scope.
async function depVersionsFor(info) {
  const scope = scopeOf(info);
  if (depVersionsByScope.has(scope)) return depVersionsByScope.get(scope);
  const siteRoot = siteRootByScope.get(scope) || "";
  const token = tokenByScope.get(scope);
  // Try the app root first (siteRoot), then fall back to the repo root — CRA/rollup-style
  // repos keep index.html in public/ but package.json at the repo root.
  const roots = siteRoot ? [siteRoot.replace(/\/+$/g, ""), ""] : [""];
  let pkg = null;
  for (const root of roots) {
    try {
      if (token) {
        const ep = `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/contents/${root ? root + "/" : ""}package.json?ref=${encodeURIComponent(info.branch)}`;
        const res = await fetch(ep, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const item = await res.json();
          if (item && item.content) { pkg = JSON.parse(new TextDecoder().decode(decodeBase64(item.content))); break; }
        }
      } else {
        const raw = await fetch(`https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${root ? root + "/" : ""}package.json`);
        if (raw.ok) { pkg = await raw.json(); break; }
      }
    } catch { /* try next root */ }
  }
  const map = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : null;
  depVersionsByScope.set(scope, map);
  return map;
}

// Load committed .env* files (the repo's own published config) into a VITE_* / NODE_ENV
// … map so `import.meta.env.VITE_*` resolves in transpiled source. Vite loads .env, .env.local,
// .env.[mode], and .env.[mode].local; a prod-shaped build reads .env + .env.production. We merge
// .env then mode files (later wins) so the app's declared VITE_* config survives. Cached per scope.
async function envFor(info) {
  const scope = scopeOf(info);
  if (envByScope.has(scope)) return envByScope.get(scope);
  const siteRoot = siteRootByScope.get(scope) || "";
  const token = tokenByScope.get(scope);
  const roots = siteRoot ? [siteRoot.replace(/\/+$/g, ""), ""] : [""];
  const out = {};
  // Dev-flavored: vite dev loads .env, .env.local, then .env.development (later wins). We read
  // only the committed *.env* files the repo publishes — never the operator's local secrets.
  const FILES = [".env", ".env.local", ".env.development"];
  for (const root of roots) {
    for (const file of FILES) {
      try {
        const path = root ? root + "/" + file : file;
        let text = "";
        if (token) {
          const ep = `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/contents/${path}?ref=${encodeURIComponent(info.branch)}`;
          const res = await fetch(ep, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const item = await res.json();
            if (item && item.content) text = new TextDecoder().decode(decodeBase64(item.content));
          }
        } else {
          const raw = await fetch(`https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${path}`);
          if (raw.ok) text = await raw.text();
        }
        if (!text) continue;
        for (const line of text.split(/\r?\n/)) {
          const m = line.replace(/\s*#.*/, "").match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
          if (m) {
            let v = (m[2] || "").trim();
            v = v.replace(/^["']|["']$/g, "");
            if (v) out[m[1]] = v;
          }
        }
      } catch { /* try next */ }
    }
  }
  envByScope.set(scope, out);
  return out;
}

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
  if (type === "SET_PUBLIC" && scope && event.data.public) {
    publicByScope.set(scope, true); log("verified-public session", scope);
  }
  if (type === "SET_PRESET" && scope && event.data.preset) {
    presetByScope.set(scope, event.data.preset);
    if (event.data.alias && typeof event.data.alias === "object") aliasByScope.set(scope, event.data.alias);
    if (Array.isArray(event.data.localDirs) && event.data.localDirs.length) localDirsByScope.set(scope, event.data.localDirs);
    if (event.data.siteRoot) siteRootByScope.set(scope, String(event.data.siteRoot).replace(/^\/+|\/+$/g, ""));
    log("preset", event.data.preset, "for", scope, "alias", event.data.alias ? JSON.stringify(event.data.alias) : "-", "local", event.data.localDirs ? event.data.localDirs.join(",") : "-");
  }
  if (type === "EDGEQA_COMPILE_RESPONSE") {
    const pending = compilePending.get(event.data.id);
    if (pending) { compilePending.delete(event.data.id); pending.resolve(!!event.data.ok, event.data.code); log("compile reply", pending.path, event.data.ok); }
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
// Vite-style module resolution for source repos under an active preset: maps an
// extensionless import (./pythagoras) to ./pythagoras.jsx and a bare directory
// (./people) to ./people/index.tsx. Probes raw.githubusercontent (cheap, no API
// budget) for each candidate; returns the first real file, or null. This only runs
// after a genuine miss and is gated to non-document requests, so SPA routing is
// unaffected — a navigation to /pythagoras still gets the SPA/index.html fallback.
const SOURCE_EXTS = ["js", "mjs", "jsx", "ts", "tsx", "svelte", "vue"];
async function resolveModule(info, token) {
  const slash = info.path.lastIndexOf("/");
  const dir = slash >= 0 ? info.path.slice(0, slash) : "";
  const name = info.path.slice(slash + 1);
  const prefix = dir ? dir + "/" : "";
  // TS projects with "allowJs"/NodeNext-style ESM write `./foo.js` to import a .ts file
  // (`import { x } from './screenLock.js'` where the file is './screenLock.ts'). A name ending
  // in a source extension should also try every other source extension pinned to the same stem
  // (screenLock.js -> screenLock.ts), not just append extensions onto itself (screenLock.js.js).
  // A name ending in a SINGLE source extension may be a Svelte runes module written with an
  // ESM-style specifier (`import './lib/state.svelte'` where the file is 'state.svelte.ts'),
  // so probe full-name + every extension FIRST (state.svelte -> state.svelte.ts). Only when
  // the name itself is a js/ts-family extension (screenLock.js -> screenLock.ts, the
  // allowJs/NodeNext convention) also probe the stem-swapped variants — never strip .svelte
  // or .vue off the name, or state.svelte would resolve to an unrelated state.ts.
  const singleSrc = /\.(ts|tsx|js|jsx|mjs|mts)$/i.test(name);
  const nameStem = singleSrc ? name.replace(/\.(ts|tsx|js|jsx|mjs|mts)$/i, "") : name;
  for (const ext of SOURCE_EXTS) {
    const cand = `${prefix}${name}.${ext}`;
    const r = await githubFileSafe({ ...info, path: cand }, token);
    if (r && r.status === 200) return { ...info, path: cand };
  }
  if (singleSrc) {
    for (const ext of SOURCE_EXTS) {
      const cand = `${prefix}${nameStem}.${ext}`;
      const r = await githubFileSafe({ ...info, path: cand }, token);
      if (r && r.status === 200) return { ...info, path: cand };
    }
  }
  for (const ext of SOURCE_EXTS) {
    const cand = `${prefix}${name}/index.${ext}`;
    const r = await githubFileSafe({ ...info, path: cand }, token);
    if (r && r.status === 200) return { ...info, path: cand };
  }
  for (const ext of SOURCE_EXTS) {
    const cand = `${prefix}${nameStem}/index.${ext}`;
    const r = await githubFileSafe({ ...info, path: cand }, token);
    if (r && r.status === 200) return { ...info, path: cand };
  }
  return null;
}
self.addEventListener("fetch", (event) => {
  let info = parseVirtual(event.request.url); if (!info) return;
  log("intercept", info.owner + "/" + info.repo + "/" + info.branch + "/" + info.path);
  postDebug({ intercept: info.path, preset: presetByScope.get(scopeOf(info)) || "" });
  event.respondWith((async () => {
    // Synthetic virtual modules (vite-plugin-svg-icons etc.) are rewritten to
    // __edgeqa_virtual__/<name>.js by rewriteBareImports; serve an empty ES module so the
    // importing app boots without its Vite-codegen module (SVG sprite, generated routes…).
    if (info.path.startsWith("__edgeqa_virtual__/")) {
      log("virtual module shim", info.path);
      return new Response("/* edgeqa virtual module */\nexport default {};\n", { status: 200, headers: { "Content-Type": "application/javascript" } });
    }
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    // HTML documents are always revalidated so a dev's push lands on the tester's next
    // reload; static assets are served from cache for up to CACHE_TTL_MS, then refetched.
    const isHtml = contentType(info.path) === "text/html";
    if (cached && !isHtml && Date.now() - Number(cached.headers.get("x-edgeqa-cached-at") || 0) < CACHE_TTL_MS) { log("cache hit", info.path); return cached; }
    if (cached) log(isHtml ? "html — refetching" : "cache stale — refetching", info.path);
    const token = tokenByScope.get(scopeOf(info));
    const preset = presetByScope.get(scopeOf(info));
    let response = await githubFileSafe(info, token);
    // Only document/navigation requests (routes and .html pages) get SPA fallback;
    // a missing asset (js/css/img/json…) is a plain 404, never an HTML page in its place.
    // Documents fall back to the nearest directory's index.html first, then repo root,
    // so subfolder sites (docs/, DualBoy/src/, public/views/) resolve their own root.
    const looksLikeAsset = /\.[a-z0-9]{2,6}$/i.test(info.path) && !/\.html?$/i.test(info.path);
    // Build-tier module resolution: source repos import modules extensionless and by
    // directory (./c -> ./c.jsx, ./people -> ./people/index.tsx). Only when a preset is
    // active, after a genuine miss, and for non-document requests, so SPA routes still
    // fall through to their index.html instead of being mis-resolved as modules. The
    // gate uses known asset/stylesheet extensions only — unknown suffixes like `.gen`
    // (TanStack Router route trees) are modules, not assets.
    const BINARY_ASSET_RE = /\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp|mp4|webm|mp3|wav|ogg|woff2?|ttf|eot|wasm|zip|pdf)$/i;
    const DOC_LIKE_RE = /\.(?:css|scss|sass|less|styl|html?|json|map|txt)$/i;
    let extraDir = "";
    if (preset && !response && !BINARY_ASSET_RE.test(info.path) && !DOC_LIKE_RE.test(info.path) && event.request.destination !== "document") {
      const requestPath = info.path;
      const resolved = await resolveModule(info, token);
      if (resolved) {
        const reqDir = requestPath.slice(0, requestPath.lastIndexOf("/"));
        const resDir = resolved.path.slice(0, resolved.path.lastIndexOf("/"));
        if (resDir !== reqDir) extraDir = resDir.slice(reqDir ? reqDir.length + 1 : 0);
        info = resolved;
        response = await githubFileSafe(resolved, token);
        log("resolved module", info.path, "extraDir", extraDir || "-");
      }
    }
    if (!response && !looksLikeAsset && info.path !== "index.html") {
      log("spa fallback", info.path);
      const dir = info.path.slice(0, info.path.lastIndexOf("/"));
      if (dir) response = await githubFileSafe({ ...info, path: `${dir}/index.html` }, token);
      if (!response) response = await githubFileSafe({ ...info, path: "index.html" }, token);
    }
    // Experimental build tier: when this scope carries a preset, transform the response
    // (transpile JSX/TSX, compile Vue/Svelte, rewrite the HTML) before caching. The
    // rewrite config carries the module's served dir, aliases, local dirs, and the
    // repo's pinned dependency versions (fetched lazily from package.json).
    if (preset && response && response.status === 200) {
      const depVersions = await depVersionsFor(info);
      const env = await envFor(info);
      let servedDir = "";
      if (info.path.includes("/")) {
        servedDir = info.path.slice(0, info.path.lastIndexOf("/"));
        if (extraDir) servedDir = servedDir.replace(new RegExp(`/${extraDir.replace(/\//g, "\\/")}$`), "");
      }
      const dv = depVersions || {};
      const pin = (name) => (dv[name] && !/^(workspace|file|link|npm|github|catalog):/i.test(dv[name]) ? `${name}@${encodeURIComponent(dv[name])}` : "");
      // The runtime frameworks the app pins (and their dom/client halves) become peer-deps
      // of every esm.sh import so the whole graph shares ONE copy (duplicates break hooks).
      const frameworkPins = preset === "vue" ? ["vue"] : preset === "svelte" ? ["svelte"] : ["react", "react-dom", "preact"];
      const pinDeps = frameworkPins.map(pin).filter(Boolean).join(",");
      const cfg = { dir: servedDir, aliasMap: aliasByScope.get(scopeOf(info)), localDirs: localDirsByScope.get(scopeOf(info)), depVersions, siteRoot: siteRootByScope.get(scopeOf(info)) || "", pinDeps, token, requestDest: event.request.destination, preset, extraDir: extraDir || "", env };
      const transformed = await applyPreset(response, info, extraDir, preset, cfg);
      if (transformed) { log("preset", preset, "applied to", info.path); response = transformed; }
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
      // Tokenless and the anonymous fetch came up empty. For sessions the generator
      // verified as public this means the file is simply missing ("no web app"). Otherwise
      // the repo may be private — keep the preview locked rather than proxy material we
      // couldn't fetch; the token behind the session PIN unlocks it. Only the document
      // itself gets these pages; subresources fail cleanly as 404s so scripts never
      // receive HTML bytes.
      if (publicByScope.get(scopeOf(info))) { log("no web app (verified public)", info.path); return looksLikeAsset ? plain404 : new Response(WEB_ROOTS_MISSING_HTML, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
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