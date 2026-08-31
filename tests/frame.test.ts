import { describe, expect, it } from "vitest";
import { preserveSucraseImports } from "../src/lib/frame";

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
