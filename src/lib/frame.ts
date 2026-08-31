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
function relFrom(fromDir: string, toPath: string): string {
  const from = fromDir ? fromDir.split("/") : [];
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
}

// Relative path from a module's served directory to a target DIRECTORY (for template-literal
// import prefixes like "@/layouts/"): "./x" style, with "./" for the same directory.
function relDirFrom(fromDir: string, toDir: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const to = (toDir || "").split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.length - i;
  const down = to.slice(i).join("/");
  return (ups ? "../".repeat(ups) : "./") + down;
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
    if (spec.startsWith(".") || spec.startsWith("/") || /^data:|^[a-z][a-z0-9+.\-]*:/i.test(spec)) return m;
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
function shimEnv(js: string): string {
  // Vite injects import.meta.env (and glob/hot glue) into every module; transpiled source still
  // references them. env gets production semantics; glob/globEager return an empty module map so
  // dynamic `for (const [path, loader] of Object.entries(import.meta.glob(...)))` loops iterate
  // nothing instead of crashing on an unregistered Vite-only API; hot is undefined. import.meta.url
  // is left untouched. Mirrors edgeqa-sw.js's copy.
  if (!/import\.meta\.(env|glob|globEager|hot)(?=[^A-Za-z0-9_$])/.test(js)) return js;
  const shim = 'const __edgeqa_env = { MODE: "production", DEV: false, PROD: true, SSR: false, BASE_URL: "/" };'
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
function postProcessJs(js: string, cfg?: RewriteCfg): string {
  js = remapPreactIsoHydrate(js);
  js = shimEnv(js);
  const extraDir = cfg?.extraDir;
  const offset = (u: string) => (extraDir ? `./${extraDir}/${u}` : u);
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
  return rewriteBareImports(js, cfg);
}

const componentName = (path: string) => (path.split("/").pop() || "Component").replace(/[^A-Za-z0-9_$]/g, "") || "Component";
function simpleHash(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h).toString(36); }

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
      try { source = sucrase.transform(text, { transforms: ["typescript"] }).code || text; } catch { /* keep raw on failure */ }
    }
    const result = svelte.compileModule(source, { filename: path, generate: "client", dev: false });
    return postProcessJs((result.js && result.js.code) || "", cfg);
  }
  const result = svelte.compile(text, { filename: path, name: componentName(path), generate: "client", css: "injected", dev: false });
  return postProcessJs((result.js && result.js.code) || "", cfg);
}

// unplugin-auto-import (and Vue's <script setup> ergonomics) let real Vue apps use the
// Composition API + vue-router helpers WITHOUT importing them — the plugin injects the imports
// at build time. The browser can't run that codegen, so compile-time here: for each standard
// auto-imported name the SFC actually references but never binds, inject the real import.
const VUE_AUTO_IMPORTS = ["ref", "reactive", "computed", "watch", "watchEffect", "watchPostEffect", "watchSyncEffect", "onMounted", "onUnmounted", "onBeforeUnmount", "onUpdated", "onBeforeMount", "onBeforeUpdate", "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered", "onScopeDispose", "onServerPrefetch", "nextTick", "toRef", "toRefs", "toValue", "provide", "inject", "getCurrentInstance", "h", "createApp", "defineAsyncComponent", "markRaw", "shallowRef", "shallowReactive", "isRef", "unref", "isReactive", "isReadonly", "readonly", "customRef", "triggerRef", "effectScope", "getCurrentScope", "useAttrs", "useSlots", "useTemplateRef", "useId", "useModel", "mergeProps", "isProxy", "toRaw", "isShallow", "isVNode", "cloneVNode", "defineComponent"];
const ROUTER_AUTO_IMPORTS = ["useRoute", "useRouter", "useLink", "onBeforeRouteLeave", "onBeforeRouteUpdate"];

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
  const lines = [inject(VUE_AUTO_IMPORTS, "vue"), inject(ROUTER_AUTO_IMPORTS, "vue-router")].filter(Boolean);
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
    const stripBody = (body: string) => { try { return sucrase.transform(body, { transforms: ["typescript"] }).code || body; } catch { return body; } };
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
  return postProcessJs(code, { ...cfg, dir: cfg?.dir || dir });
}
