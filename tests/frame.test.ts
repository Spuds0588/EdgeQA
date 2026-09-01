import { describe, expect, it } from "vitest";
import { cjsInteropNamedImports, preserveSucraseImports, relFrom, shimCommonJS, shimViteGlobals } from "../src/lib/frame";

describe("shimViteGlobals", () => {
  it("prepends a module-scoped __APP_INFO__ when the source references it", () => {
    const out = shimViteGlobals('const { pkg } = __APP_INFO__;\nexport const t = pkg.name;');
    expect(out.startsWith("const __APP_INFO__ = { pkg:"));
    expect(out).toContain('const { pkg } = __APP_INFO__;');
  });

  it("leaves modules that don't reference define-globals untouched", () => {
    const src = "export const x = 1;";
    expect(shimViteGlobals(src)).toBe(src);
  });
});

describe("shimCommonJS", () => {
  it("converts destructuring/default requires to imports and module.exports to ESM exports", () => {
    const out = shimCommonJS("const { setting, theme } = require('./default');\nconst network = require('./config');\nconst locked = true;\nmodule.exports = { setting, locked, routes: 3 };\n");
    expect(out).toContain("import { setting, theme } from './default';");
    expect(out).toContain("import network from './config';");
    expect(out).toContain("export default __edgeqaCjsMod.exports;");
    // The stub must ALWAYS be declared (the object-literal rewrite consumed `module.exports`
    // before the old declaration check ran — ReferenceError in real vue-cli configs).
    expect(out).toContain("const __edgeqaCjsMod = { exports: {} };");
    // module.exports keys: imported/declared keys are re-exported, fresh keys become const
    // exports (no redeclaration). Non-exported bindings like theme are NOT re-exported.
    expect(out).toContain("export { setting };");
    expect(out).toContain("export { locked };");
    expect(out).toContain("export const routes = __edgeqaCjsMod.exports.routes;");
    expect(out).not.toContain("export { theme };");
    expect(out).not.toContain("require(");
    expect(out).not.toContain("module.exports");
  });

  it("Object.assign-style module.exports stays default-only (no fake named exports)", () => {
    const out = shimCommonJS("const { setting } = require('./default');\nmodule.exports = Object.assign({}, setting, { routes: 3 });\n");
    expect(out).toContain("export default __edgeqaCjsMod.exports;");
    expect(out).not.toMatch(/export const routes/);
    expect(out).not.toContain("require(");
  });

  it("leaves ESM source untouched", () => {
    const src = 'import { x } from "./y";\nexport const z = x;';
    expect(shimCommonJS(src)).toBe(src);
  });

  it("converts bare statement requires (vue-cli mock loading) to side-effect imports", () => {
    // vue-admin-better's main.js: `if (process.env.NODE_ENV !== 'production') { require('@/utils/mock') }`
    // — a statement-position require with no binding. The bundler injects require(); ESM can't,
    // so it becomes a side-effect import and the guarded branch can't crash on `require`.
    const out = shimCommonJS("const app = new Vue();\nif (process.env.NODE_ENV !== 'production') {\n  require('@/utils/mock')\n}\nmodule.exports = app;\n");
    expect(out).toContain("import '@/utils/mock';");
    expect(out).not.toContain("require(");
  });
});

describe("cjsInteropNamedImports", () => {
  const cfg = { aliasMap: { "@": "src" }, localDirs: ["src"], siteRoot: "" };

  it("rewrites local named imports to namespace + default fallback bindings", () => {
    // vue-admin-better's .vue script does `import { recordRoute } from '@/config'` where
    // config is CJS (`module.exports = Object.assign(...)`) — bind through ns OR ns.default.
    const out = cjsInteropNamedImports('import { recordRoute, permission as p } from "@/config";\nexport const r = recordRoute(p);', cfg);
    expect(out).toContain('import * as __edgeqaCjsNs from "@/config";');
    expect(out).toContain("const recordRoute = __edgeqaCjsNs.recordRoute ?? __edgeqaCjsNs.default?.recordRoute;");
    expect(out).toContain("const p = __edgeqaCjsNs.permission ?? __edgeqaCjsNs.default?.permission;");
    expect(out).not.toContain("import { recordRoute");
  });

  it("rewrites bare npm named imports to namespace + default fallback (esm.sh collapses UMD/CJS packages to default-only)", () => {
    // file-saver regression: esm.sh serves `export { k as default }` only for UMD/CJS
    // packages, so `import { saveAs } from 'file-saver'` dies with "does not provide an
    // export named 'saveAs'". The ns ?? ns.default?. binding links either shape.
    const src = 'import { useRouter } from "vue-router";\nexport const x = useRouter;';
    const out = cjsInteropNamedImports(src, cfg);
    expect(out).toContain('import * as __edgeqaCjsNs from "vue-router";');
    expect(out).toContain("const useRouter = __edgeqaCjsNs.useRouter ?? __edgeqaCjsNs.default?.useRouter;");
    expect(out).not.toContain('import { useRouter } from "vue-router";');
  });

  it("keeps native live bindings for known-ESM targets (cycle-safe — no eager destructure)", () => {
    // vue3-element-admin regression: stores/index re-exports ./user, user imports
    // `{ store } from '@/stores'` — an eager `const store = ns.store ?? …` read fires
    // before index's `const store = createPinia()` initializes (TDZ). Known-ESM targets
    // must keep the native named import.
    const src = 'import { store } from "@/stores";\nexport const r = () => store.x;';
    const out = cjsInteropNamedImports(src, cfg, "src/stores/user.ts", new Set(["src/stores", "src/stores/index"]));
    expect(out).toContain('import { store } from "@/stores";');
    expect(out).not.toContain("__edgeqaCjsNs");
  });

  it("leaves `import type` statements alone", () => {
    const src = 'import type { Thing } from "./types";\nimport { real } from "./real";\nexport const x = real;';
    const out = cjsInteropNamedImports(src, cfg);
    expect(out).toContain('import type { Thing } from "./types";');
    expect(out).toContain("const real = __edgeqaCjsNs.real ?? __edgeqaCjsNs.default?.real;");
  });

  it("gives EACH local named import its own namespace binding (no duplicate const redeclare)", () => {
    // vue3-element-admin imports @/settings and @/router in one module; reusing one ns name
    // is a SyntaxError ("Identifier '__edgeqaCjsNs' has already been declared").
    const src = 'import { appTitle } from "@/settings";\nimport { constantRouterMap } from "@/router";\nexport const x = [appTitle, constantRouterMap];';
    const out = cjsInteropNamedImports(src, cfg);
    expect(out).toContain("import * as __edgeqaCjsNs from \"@/settings\";");
    expect(out).toContain("import * as __edgeqaCjsNs1 from \"@/router\";");
    expect(out).not.toContain("import * as __edgeqaCjsNs from \"@/router\"");
  });
});

describe("relFrom", () => {
  it("passes absolute URLs through untouched (esm.sh css injector path)", () => {
    // arco-pro regression: `import 'nprogress/nprogress.css'` rewrites to an esm.sh URL,
    // then the CSS-injector path re-enters relFrom, which used to treat the scheme as a
    // path segment and emit "./https:/esm.sh/…" under the importing module's directory.
    const url = "https://esm.sh/nprogress@%5E0.2.0/nprogress.css?deps=vue@%5E3";
    expect(relFrom("src/router", url)).toBe(url);
    expect(relFrom("", "data:text/css;base64,Zm9v")).toBe("data:text/css;base64,Zm9v");
  });

  it("keeps computing relative paths for local targets", () => {
    expect(relFrom("src/layout/vab-avatar", "src/config")).toBe("../../config");
    expect(relFrom("src", "src/lib/utils")).toBe("./lib/utils");
  });
});

describe("preserveSucraseImports", () => {
  it("re-adds only template-referenced imports sucrase stripped, without duplicating kept ones", () => {
    // Sucrase 3.35's TS transform elides imports it deems unused. Inside a Vue SFC the
    // compiler only sees the script body, so imports referenced ONLY in the <template>
    // (LockScreen, AppProvider) look unused and get stripped — while imports used in the
    // script (computed/onMounted/onUnmounted, screenLock…) are kept.
    const raw = `import { computed, onMounted, onUnmounted } from 'vue';
import { zhCN, dateZhCN, darkTheme } from 'naive-ui';
import { LockScreen } from '@/components/Lockscreen';
import { AppProvider } from '@/components/Application';
import { useScreenLockStore } from '@/store/modules/screenLock.js';

const isLock = computed(() => useScreenLockStore().isLocked);
onMounted(() => {});
onUnmounted(() => {});
const theme = darkTheme;
`;
    const stripped = `import { computed, onMounted, onUnmounted } from 'vue';
import { darkTheme } from 'naive-ui';
import { useScreenLockStore } from '@/store/modules/screenLock.js';

const isLock = computed(() => useScreenLockStore().isLocked);
onMounted(() => {});
onUnmounted(() => {});
const theme = darkTheme;
`;
    const template = `<template><LockScreen /><AppProvider /></template>`;
    const out = preserveSucraseImports(raw, stripped, template);
    // The stripped-but-template-only imports come back…
    expect(out).toContain("import { LockScreen } from '@/components/Lockscreen';");
    expect(out).toContain("import { AppProvider } from '@/components/Application';");
    // …and kept imports are NOT duplicated (regression: a lone `\s` in the template
    // literal collapsed to a literal "s", so `froms*` never matched and every import
    // got re-added — compileScript then threw on duplicate `computed` bindings).
    expect(out.match(/from 'vue'/g)?.length).toBe(1);
    expect(out.match(/from 'naive-ui'/g)?.length).toBe(1);
    expect(out.match(/screenLock\.js/g)?.length).toBe(1);
  });

  it("does not resurrect type-only imports (value-style `import { T }` used only in types)", () => {
    // jekip/naive-ui-admin regression: `import { LanguageType } from "@/stores/interface"`
    // where stores/interface exports ONLY types. sucrase elides the import; the template
    // never mentions LanguageType, so it must stay elided — re-adding it links a
    // non-existent runtime export and crashes the module graph.
    const raw = `import { LanguageType } from "./stores/interface";
import { LockScreen } from "@/components/Lockscreen";

const setLang = (language: string) => {
  globalStore.setGlobalState("language", language as LanguageType);
};
`;
    const stripped = `const setLang = (language: string) => {
  globalStore.setGlobalState("language", language as LanguageType);
};
`;
    const template = `<template><LockScreen /></template>`;
    const out = preserveSucraseImports(raw, stripped, template);
    expect(out).not.toContain("stores/interface");
    expect(out).toContain('import { LockScreen } from "@/components/Lockscreen";');
  });

  it("returns stripped unchanged when no template is available (svelte runes modules)", () => {
    const raw = `import { ref } from 'vue';\nconst x = ref(0);\n`;
    const stripped = `import { ref } from 'vue';\nconst x = ref(0);\n`;
    expect(preserveSucraseImports(raw, stripped)).toBe(stripped);
  });
});
