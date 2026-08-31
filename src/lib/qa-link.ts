// Shared QA-link construction: the payload crypto (PBKDF2 + AES-GCM, PIN-derived key) and
// the canonical #hash-format assembly. Used by the setup flow (src/main.tsx) and by the
// WebMCP agent tool (src/lib/webmcp.ts) so both mint identical links. The payload holds the
// repo token encrypted under the session PIN; public (tokenless) links carry a verification
// flag instead. Nothing is ever stored server-side or in the URL plaintext.
import { probeRepo } from "./discover";

// Cryptographically-random, easy-to-read session PIN (no ambiguous 0/O/1/l/I).
const PIN_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function randomPin(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += PIN_CHARS[bytes[i] % PIN_CHARS.length];
  return out;
}

async function deriveKey(pin: string, salt: BufferSource) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }

export async function makePayload(token: string, pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt.buffer);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return `${bytesToBase64(salt)}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function unlockPayload(payload: string, pin: string): Promise<string> {
  const [saltText, ivText, encryptedText] = payload.split(".");
  const key = await deriveKey(pin, fromBase64(saltText).buffer);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivText) }, key, fromBase64(encryptedText));
  return new TextDecoder().decode(decrypted);
}

export interface QaLinkInput {
  owner: string;
  repo: string;
  branch?: string;
  /** Web root folder or html file inside the repo (auto-detected when omitted). */
  path?: string;
  /** Framework preset ("react" | "preact" | "jsx" | "vue" | "svelte" | "" | "static"). */
  preset?: string;
  /** Comma-joined local dirs (bare "src/..." import roots). */
  local?: string;
  /** Comma-joined "key:value" source aliases. */
  aliases?: string;
  /** Fine-grained PAT — encrypted into the payload, never in the URL plaintext. */
  token?: string;
  /** Session PIN (generated when omitted for tokenless links). */
  pin?: string;
}

export interface QaLinkResult {
  link: string;
  branch: string;
  path: string;
  preset?: string;
  /** true = verified public, false = not readable anonymously, undefined = unknown. */
  public: boolean | undefined;
}

const appBaseHref = () => {
  if (typeof window === "undefined") return "/";
  const h = window.location.href.split("#")[0];
  return h.endsWith("/") ? h : h + "/";
};

// Build a full QA link: probe the repo (default branch, web root, framework detection,
// aliases/local dirs), encrypt the token when provided, and assemble the canonical link.
export async function buildQaLink(input: QaLinkInput): Promise<QaLinkResult> {
  const branch = input.branch || "main";
  let probe: Awaited<ReturnType<typeof probeRepo>>;
  try { probe = await probeRepo(input.owner, input.repo, branch, input.token || ""); }
  catch { probe = { branch, defaultBranch: branch, siteRoot: "", public: undefined, sources: [] }; }
  const resolvedBranch = probe.branch || branch;
  const path = input.path ?? probe.siteRoot ?? "";
  // Framework preset: explicit override beats auto-detection; "static" forces none.
  const preset = (input.preset === "static" ? "" : (input.preset || probe.preset || "")) || "";
  const local = input.local ?? probe.localDirs?.join(",") ?? "";
  const aliases = input.aliases ?? (probe.aliases ? Object.entries(probe.aliases).map(([k, v]) => `${k}:${v}`).join(",") : "");
  const payload = input.token ? await makePayload(input.token, input.pin || "") : "";
  // Tokenless links carry the verification result: "&public" (verified public) or
  // "&public=0" (couldn't verify — e.g. rate-limited or private-looking).
  const flags = input.token ? "" : probe.public === true ? "&public" : "&public=0";
  const params = new URLSearchParams({ repo: `${input.owner}/${input.repo}`, branch: resolvedBranch });
  if (path) params.set("path", path);
  if (preset) params.set("preset", preset);
  if (local) params.set("local", local);
  if (aliases) params.set("aliases", aliases);
  if (payload) params.set("payload", payload);
  return { link: `${appBaseHref()}#${params.toString()}${flags}`, branch: resolvedBranch, path, preset: preset || undefined, public: probe.public };
}
