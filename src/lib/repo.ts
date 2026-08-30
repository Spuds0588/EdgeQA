export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
  /** Subpath from a /tree/{branch}/{path} or /blob/{branch}/{path} URL ("" when absent). */
  path?: string;
}

// Parse a GitHub repo reference into { owner, repo, branch, path }.
// Accepts a full URL (https://github.com/{owner}/{repo} optionally /tree/{branch}[/{path}]
// or /blob/{branch}/{path}) or an "owner/repo" shorthand. Returns null when it can't
// tell owner from repo.
export function parseRepoInput(raw: string): RepoRef | null {
  const value = raw.trim();
  if (!value) return null;
  const seg = (s: string) => s.split("#")[0].split("?")[0];

  // A full GitHub URL: strip scheme/host so only the path remains, then match owner/repo[/tree/branch[/path]]
  const pathOnly = value
    .replace(/^https:\/\//i, "")
    .replace(/^http:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(new RegExp(`^github\\.com\\/`, "i"), "");

  const m = seg(pathOnly).match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)(?:\/(?:tree|blob)\/([^/?#]+)(?:\/(.*))?)?(?:\/|$)/);
  if (m) {
    const ref: RepoRef = { owner: m[1].toLowerCase(), repo: m[2], branch: m[3] || "main" };
    if (m[4]) ref.path = m[4];
    return ref;
  }

  // Fallback for shorthand "owner/repo"
  const shorthand = seg(value).match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shorthand) return { owner: shorthand[1].toLowerCase(), repo: shorthand[2], branch: "main" };

  return null;
}
