// Page-side in-browser compile for the Vue/Svelte build tier.
//
// The service worker cannot dynamic-import esm.sh compiler SDKs — the HTML spec bans
// import() on ServiceWorkerGlobalScope. A normal window can, though, so the SW delegates
// .vue/.svelte compilation to this page via a postMessage round-trip. Each function here
// returns the *final* ESM module text (postProcessJs applied), which the SW then serves
// as-is under a marker comment.

const ESM_CDN = "https://esm.sh/";

// Rewrite bare npm specifiers to absolute esm.sh URLs (matches the SW's copy). Relative
// (./), absolute (/), and URL (https:/data:...) specifiers are left untouched.
function rewriteBareImports(js: string): string {
  return js.replace(/((?:from\s+|import\s*\(|(?:^|[\n]\s*)import\s+|export\s+[^;]*?from\s+))(["'])([^\s"']+)(\2)/g, (m, ctx, q, spec, endq) => {
    if (spec && !spec.startsWith(".") && !spec.startsWith("/") && !/^data:|^[a-z][a-z0-9+.\-]*:/i.test(spec)) {
      return `${ctx}${q}${ESM_CDN}${spec}${endq}`;
    }
    return m;
  });
}

// Shared per-module post-processing (matches the SW's copy): CSS imports become stylesheet
// injectors, asset imports become URL strings, and bare npm imports rewrite to esm.sh.
function postProcessJs(js: string): string {
  const cssUrls: string[] = [];
  js = js.replace(/(?:import\s+(?:[^'"]*?\s+from\s+)?)(['"])([^'"]+?\.(?:css|scss|sass|less|styl))\1/g, (m, q, url) => { cssUrls.push(url); return ""; });
  js = js.replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+?\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp|mp4|webm|mp3|wav|ogg|woff2?|ttf|eot))\2/g, (m, name, q, url) => `const ${name} = new URL(${q}${url}${q}, import.meta.url).href;`);
  if (cssUrls.length) {
    const injector = cssUrls.map((u) => `(()=>{const l=document.createElement("link");l.rel="stylesheet";l.href=new URL(${JSON.stringify(u)},import.meta.url).href;document.head.appendChild(l);})();`).join("");
    js = injector + js;
  }
  return rewriteBareImports(js);
}

const componentName = (path: string) => (path.split("/").pop() || "Component").replace(/[^A-Za-z0-9_$]/g, "") || "Component";
function simpleHash(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h).toString(36); }

// Compile a .svelte file (final module text). Svelte embeds the component's own CSS when
// css:injected, so the output is a single module with styles attached; svelte/internal/*
// (bare) imports rewrite to esm.sh like any other.
export async function compileSvelteText(text: string, path: string): Promise<string> {
  // @vite-ignore: this is a runtime esm.sh import, never a bundled dep.
  const { compile }: any = await import(/* @vite-ignore */ `${ESM_CDN}svelte@5/compiler`);
  const result = compile(text, { filename: path, name: componentName(path), generate: "client", css: "injected", dev: false });
  return postProcessJs((result.js && result.js.code) || "");
}

// Compile a .vue SFC with @vue/compiler-sfc (final module text). Assembles a module that
// re-exports the component with render + scopeId attached so Vue's runtime can render it
// without a runtime template compiler.
export async function compileVueText(text: string, path: string): Promise<string> {
  // @vite-ignore: runtime esm.sh import, not a bundled dep.
  const sfc: any = await import(/* @vite-ignore */ `${ESM_CDN}@vue/compiler-sfc@3`);
  const { parse, compileScript, compileTemplate, compileStyleAsync } = sfc;
  const id = "data-v-" + simpleHash(path);
  const filename = path.split("/").pop() || "App.vue";
  const { descriptor } = parse(text, { filename });
  let script: any = null;
  if (descriptor.script || descriptor.scriptSetup) script = compileScript(descriptor, { id });
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
  return postProcessJs(code);
}