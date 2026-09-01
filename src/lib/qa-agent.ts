// Parent-side QA agent bridge — sends commands to the iframe-side bridge (injected by the SW
// into every HTML page) and receives responses via postMessage. Used by the WebMCP tools so
// coding/LLM agents can navigate, inspect, and test sandboxed previews.

let _iframe: HTMLIFrameElement | null = null;
let _msgId = 0;
const _pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

/** Register the sandbox iframe so the dispatcher can send commands to it. */
export function setSandboxIframe(iframe: HTMLIFrameElement | null) {
  _iframe = iframe;
}

/** Call from the parent window's message event listener to dispatch iframe responses. */
export function handleQaBridgeResponse(event: MessageEvent) {
  const d = event.data || {};
  const id = d.id;
  if (!id || !d.type || !d.type.startsWith("edgeqa-qe-") || !d.type.endsWith("-response")) return;
  const entry = _pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  _pending.delete(id);
  if (d.ok) entry.resolve(d.result);
  else entry.reject(new Error(String(d.result || "Unknown error")));
}

/** Send a command to the iframe and wait for its response (timeout: 15s default). */
function sendCommand(type: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<any> {
  if (!_iframe?.contentWindow) throw new Error("Sandbox iframe not ready");
  const id = `edgeqa-qe-${++_msgId}-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { _pending.delete(id); reject(new Error(`QA command timed out: ${type}`)); }, timeoutMs);
    _pending.set(id, { resolve, reject, timer });
    _iframe!.contentWindow!.postMessage({ id, type, ...params }, "*");
  });
}

/** Navigate the sandbox to a new URL or path. */
export async function qaNavigate(url: string): Promise<{ url: string; message: string }> {
  return sendCommand("edgeqa-qe-navigate", { url });
}

/** Inspect the current page — returns DOM summary, broken images, forms, links, body preview. */
export async function qaInspect(opts?: { selector?: string; maxBody?: number }): Promise<any> {
  return sendCommand("edgeqa-qe-inspect", { selector: opts?.selector, maxBody: opts?.maxBody || 3000 });
}

/** Click an element by CSS selector. */
export async function qaClick(selector: string): Promise<{ clicked: string }> {
  return sendCommand("edgeqa-qe-click", { selector });
}

/** Evaluate a JavaScript expression in the sandbox context. */
export async function qaEvaluate(expression: string): Promise<{ value: string | null }> {
  return sendCommand("edgeqa-qe-evaluate", { expression });
}

/** Retrieve captured console logs from the iframe. */
export async function qaGetConsole(opts?: { since?: number; limit?: number }): Promise<{ lines: { level: string; line: string; ts: number }[]; total: number }> {
  return sendCommand("edgeqa-qe-get-console", { since: opts?.since || 0, limit: opts?.limit || 200 });
}
