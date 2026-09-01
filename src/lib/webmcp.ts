// WebMCP (Web Model Context Protocol) agent tools — Chrome's proposed standard for exposing
// structured, callable tools to AI agents (origin trial, Chrome 149+; `document.modelContext`).
// EdgeQA registers a tool that lets coding and other LLM agents spin up a QA preview link for
// any public GitHub repo — tokenless, so agents can drive the whole flow without credentials.
// Tools are a progressive enhancement: browsers without WebMCP just run the normal site.
import { buildQaLink, randomPin } from "./qa-link";
import { qaNavigate, qaInspect, qaClick, qaGetConsole, qaEvaluate } from "./qa-agent";

interface ModelContextLike {
  registerTool?: (tool: unknown, opts?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener?: (...args: unknown[]) => void;
}

export async function registerEdgeQaAgentTools(): Promise<boolean> {
  const mc = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (!mc?.registerTool) return false;
  try {
    await mc.registerTool({
      name: "create_qa_link",
      description:
        "Create a QA preview link for a GitHub repository. EdgeQA turns any repo into a shareable, " +
        "browser-only QA environment — the repo's files are served from GitHub through a service " +
        "worker (no upload, no server). Public repos need no token; the link works for anyone with the " +
        "session PIN. Returns the full link plus the session PIN to share.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "GitHub owner (user or organization), e.g. \"Spuds0588\"." },
          repo: { type: "string", description: "Repository name, e.g. \"EdgeQA\"." },
          branch: { type: "string", description: "Branch to preview. Defaults to the repo's default branch when omitted." },
          path: { type: "string", description: "Web root inside the repo (folder or root html path, e.g. \"docs\" or \"app/index.html\"). Auto-detected when omitted." },
          pin: { type: "string", description: "Optional session PIN to protect the link. Auto-generated when omitted — return it to the user." },
        },
        required: ["owner", "repo"],
      },
      execute: async (args: { owner: string; repo: string; branch?: string; path?: string; pin?: string }) => {
        const owner = String(args?.owner || "").trim().replace(/\/$/, "");
        const repo = String(args?.repo || "").trim().replace(/\/(tree|blob)\/.*$/, "");
        if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
          return "Invalid owner/repo. Pass the GitHub owner (user or org) and repository name, e.g. owner: \"acme\", repo: \"site\".";
        }
        const pin = String(args?.pin || "").trim() || randomPin();
        const result = await buildQaLink({ owner, repo, branch: args?.branch, path: args?.path, pin });
        const fields = [
          `QA link: ${result.link}`,
          `Session PIN: ${pin}`,
          `Branch: ${result.branch}`,
          result.path ? `Web root: ${result.path}/` : "Web root: repo root",
          result.preset ? `Framework: ${result.preset}` : "Framework: static",
          result.public === true ? "Repo verified public — no token needed." : "Repo visibility could not be verified tokenlessly; a token may be required.",
        ];
        return fields.join("\n");
      },
    });

    // QA Agent Tools — allow coding/LLM agents to navigate, inspect, and test a running preview.
    // These only work when the EdgeQA viewer is open (iframe loaded and SW bridge ready).

    await mc.registerTool({
      name: "qa_navigate",
      description:
        "Navigate the EdgeQA sandbox to a different URL or path. Use this to test different " +
        "routes in the previewed app (e.g. '/login', '/dashboard'). Returns the navigation result.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL or path to navigate to (e.g. '/dashboard', './settings', 'https://example.com')" },
        },
        required: ["url"],
      },
      execute: async (args: { url: string }) => {
        try {
          const result = await qaNavigate(args.url);
          return JSON.stringify(result);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });

    await mc.registerTool({
      name: "qa_inspect",
      description:
        "Inspect the current page in the EdgeQA sandbox. Returns the page URL, title, visible " +
        "forms, links (up to 50), images (with broken detection), and a body text preview. " +
        "Optionally pass a CSS selector to inspect specific elements.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Optional CSS selector to inspect specific elements (e.g. '.error', '#app')" },
          maxBody: { type: "number", description: "Max characters of body text to return (default: 3000)" },
        },
      },
      execute: async (args: { selector?: string; maxBody?: number }) => {
        try {
          const result = await qaInspect({ selector: args.selector, maxBody: args.maxBody });
          return JSON.stringify(result);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });

    await mc.registerTool({
      name: "qa_click",
      description:
        "Click an element in the EdgeQA sandbox by CSS selector. Use this to interact with " +
        "buttons, links, or other clickable elements.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector for the element to click (e.g. 'button.submit', 'a[href=\"/login\"]')" },
        },
        required: ["selector"],
      },
      execute: async (args: { selector: string }) => {
        try {
          const result = await qaClick(args.selector);
          return JSON.stringify(result);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });

    await mc.registerTool({
      name: "qa_get_console",
      description:
        "Retrieve captured console log output from the EdgeQA sandbox. Returns log lines " +
        "with their level (log/info/warn/error/debug), message text, and timestamp.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max number of log lines to return (default: 200)" },
          since: { type: "number", description: "Timestamp (ms) to filter logs from (default: 0 = all)" },
        },
      },
      execute: async (args: { limit?: number; since?: number }) => {
        try {
          const result = await qaGetConsole({ limit: args.limit, since: args.since });
          return JSON.stringify(result);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });

    await mc.registerTool({
      name: "qa_evaluate",
      description:
        "Evaluate a JavaScript expression in the EdgeQA sandbox context. Use this to read " +
        "state, check DOM properties, or run logic inside the previewed app.",
      inputSchema: {
        type: "object",
        properties: {
          expression: { type: "string", description: "JavaScript expression to evaluate (e.g. 'document.title', 'window.__appState')" },
        },
        required: ["expression"],
      },
      execute: async (args: { expression: string }) => {
        try {
          const result = await qaEvaluate(args.expression);
          return JSON.stringify(result);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });

    return true;
  } catch {
    return false;
  }
}
