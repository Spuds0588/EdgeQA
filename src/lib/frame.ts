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
  const to = toPath.split("/");
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.length - i;
  const down = to.slice(i).join("/");
  // Browsers require relative specifiers to start with "./" or "../" — a bare name is an error.
  return ups ? "../".repeat(ups) + down : down ? "./" + down : ".";
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
}

// Rewrite bare specifiers to what the browser can actually fetch (mirrors the SW's copy):
// local dirs and aliases become module-relative paths, npm packages become absolute esm.sh
// URLs pinned to the repo's package.json version when known. Relative (./), absolute (/),
// and URL (https:/data:...) specifiers are left untouched.
function rewriteBareImports(js: string, cfg?: RewriteCfg): string {
  cfg = cfg || {};
  return js.replace(/((?:from\s+|import\s*\(|(?:^|[\n]\s*)import\s+|export\s+[^;]*?from\s+))(["'])([^\s"']+)(\2)/g, (m, ctx, q, spec, endq) => {
    if (!spec || spec.startsWith(".") || spec.startsWith("/") || /^data:|^[a-z][a-z0-9+.\-]*:/i.test(spec)) return m;
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
    if (pkgVer && !/^(workspace|file|link|npm|github):/i.test(pkgVer)) {
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
  if (!/import\.meta\.env/.test(js)) return js;
  const shim = 'const __edgeqa_env = { MODE: "production", DEV: false, PROD: true, SSR: false, BASE_URL: "/" };';
  return shim + "\n" + js.replace(/import\.meta\.env(?=[^A-Za-z0-9_$])/g, "__edgeqa_env");
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

// Shared per-module post-processing (matches the SW's copy): CSS imports become stylesheet
// injectors, asset imports become URL strings, and bare imports rewrite (aliases/local dirs
// relative, npm packages to esm.sh with version pins).
function postProcessJs(js: string, cfg?: RewriteCfg): string {
  js = shimEnv(js);
  const cssUrls: string[] = [];
  js = js.replace(/(?:import\s+(?:[^'"]*?\s+from\s+)?)(['"])([^'"]+?\.(?:css|scss|sass|less|styl))\1/g, (m, q, url) => { cssUrls.push(rewriteAssetUrl(url, cfg)); return ""; });
  js = js.replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+?\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp|mp4|webm|mp3|wav|ogg|woff2?|ttf|eot))\2/g, (m, name, q, url) => `const ${name} = new URL(${q}${url}${q}, import.meta.url).href;`);
  if (cssUrls.length) {
    const injector = cssUrls.map((u) => `(()=>{const l=document.createElement("link");l.rel="stylesheet";l.href=new URL(${JSON.stringify(u)},import.meta.url).href;document.head.appendChild(l);})();`).join("");
    js = injector + js;
  }
  return rewriteBareImports(js, cfg);
}

const componentName = (path: string) => (path.split("/").pop() || "Component").replace(/[^A-Za-z0-9_$]/g, "") || "Component";
function simpleHash(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h).toString(36); }

// Compile a .svelte file (final module text). Svelte embeds the component's own CSS when
// css:injected, so the output is a single module with styles attached; svelte/internal/*
// (bare) imports rewrite to esm.sh like any other.
export async function compileSvelteText(text: string, path: string, cfg?: RewriteCfg): Promise<string> {
  // @vite-ignore: this is a runtime esm.sh import, never a bundled dep.
  const { compile }: any = await import(/* @vite-ignore */ `${ESM_CDN}svelte@5/compiler`);
  const result = compile(text, { filename: path, name: componentName(path), generate: "client", css: "injected", dev: false });
  return postProcessJs((result.js && result.js.code) || "", cfg);
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
  return postProcessJs(code, { ...cfg, dir: cfg?.dir || dir });
}
