// WebMCP (Web Model Context Protocol) agent tools — Chrome's proposed standard for exposing
// structured, callable tools to AI agents (origin trial, Chrome 149+; `document.modelContext`).
// EdgeQA registers a tool that lets coding and other LLM agents spin up a QA preview link for
// any public GitHub repo — tokenless, so agents can drive the whole flow without credentials.
// Tools are a progressive enhancement: browsers without WebMCP just run the normal site.
import { buildQaLink, randomPin } from "./qa-link";

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
    return true;
  } catch {
    return false;
  }
}
