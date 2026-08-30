import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, Bug, Check, ChevronDown, Clipboard, GitBranch, KeyRound, Link2, LockKeyhole, Menu, Play, ShieldCheck, X, Zap } from "lucide-react";
import "./index.css";
import "./demo-element";
import { parseRepoInput } from "./lib/repo";

type Mode = "home" | "setup" | "unlock" | "viewer";

// The public example project behind the "Try the live demo" flow. Lives in this
// repo (examples/northstar/) so the VFS serves it with no token at all.
const DEMO = { owner: "Spuds0588", repo: "EdgeQA", branch: "main", path: "examples/northstar" };

const features = [
  { icon: ShieldCheck, title: "Private by design", text: "Your token stays in browser memory. Nothing is uploaded, proxied, or persisted." },
  { icon: Zap, title: "Instant VFS", text: "GitHub files become a live preview through a Service Worker and read-through cache." },
  { icon: LockKeyhole, title: "PIN-secured links", text: "Share a QA-ready environment without exposing credentials in the URL." },
];

async function deriveKey(pin: string, salt: BufferSource) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }

function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.6 7.6 2 12l1.6 4.4" />
      <path d="M20.4 7.6l1.6 4.4-1.6 4.4" />
      <path d="M10 2.8h4" />
      <path d="M10.8 2.8v6.9a1.8 1.8 0 0 1-.18.83L5.9 19.7a1 1 0 0 0 .9 1.5h10.4a1 1 0 0 0 .9-1.5l-4.72-9.17a1.8 1.8 0 0 1-.18-.83V2.8" />
      <path d="M7.3 16.2h9.4" />
    </svg>
  );
}

async function makePayload(token: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt.buffer);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return `${bytesToBase64(salt)}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

function App() {
  const [mode, setMode] = useState<Mode>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState(""); // held in memory only, per the PRD's "not localStorage" rule
  const [pin, setPin] = useState("");
  const [link, setLink] = useState("");
  const [demoPath, setDemoPath] = useState("");
  const [readonly, setReadonly] = useState(false);
  const [copied, setCopied] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasDemo = hash.has("demo");
    if (!hash.get("repo") && !hasDemo) return;
    const [parsedOwner, parsedRepo] = decodeURIComponent(hash.get("repo") || `${DEMO.owner}/${DEMO.repo}`).split("/");
    setOwner(parsedOwner || DEMO.owner); setRepo(parsedRepo || DEMO.repo); setBranch(hash.get("branch") || DEMO.branch); setDemoPath(hash.get("path") || (hasDemo ? DEMO.path : "")); setReadonly(hash.has("readonly"));
    setMode(hash.get("payload") ? "unlock" : hasDemo ? "viewer" : "setup");
  }, []);

  const openDemo = () => { setOwner(DEMO.owner); setRepo(DEMO.repo); setBranch(DEMO.branch); setDemoPath(DEMO.path); setMode("viewer"); };

  const repoLabel = useMemo(() => owner && repo ? `${owner}/${repo}` : "your private repository", [owner, repo]);

  const generate = async () => {
    setError("");
    if (!owner || !repo || !token || pin.length < 6) { setError("Add a repository, token, and a PIN of at least 6 characters."); return; }
    const payload = await makePayload(token, pin);
    const value = `${window.location.origin}/#repo=${encodeURIComponent(`${owner}/${repo}`)}&branch=${encodeURIComponent(branch)}&payload=${encodeURIComponent(payload)}`;
    setLink(value);
    // keep the token in memory for this tab so "Open preview" and issue filing work; it still never touches a server or localStorage
  };

  const applyRepoUrl = (value: string) => {
    setRepoUrl(value);
    const parsed = parseRepoInput(value);
    if (parsed) { setOwner(parsed.owner); setRepo(parsed.repo); setBranch(parsed.branch); }
  };

  const copyLink = async () => { await navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  const unlock = async () => {
    try {
      const payload = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("payload"); if (!payload) throw new Error("Missing secure payload");
      const [saltText, ivText, encryptedText] = payload.split(".");
      const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
      const salt = fromBase64(saltText), iv = fromBase64(ivText), encrypted = fromBase64(encryptedText);
      const key = await deriveKey(unlockPin, salt.buffer);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
      setToken(new TextDecoder().decode(decrypted)); setMode("viewer");
    } catch { setError("That PIN did not unlock this QA session."); }
  };

  if (mode === "viewer") return <Viewer repo={repoLabel} branch={branch} path={demoPath} token={token} readonly={readonly} onExit={() => setMode("home")} />;

  return (
    <div className="app-shell">
      <header className="nav container">
        <button className="brand" onClick={() => setMode("home")}><span className="brand-mark"><Logo /></span><span>edge<span className="accent">qa</span></span></button>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        <nav className={menuOpen ? "nav-links open" : "nav-links"}><a href="#how">How it works</a><a href="#security">Security</a><button className="nav-cta" onClick={() => setMode("setup")}>Open workspace <ArrowRight size={15} /></button></nav>
      </header>

      {mode === "home" && <>
        <main>
          <section className="hero container">
            <div className="eyebrow"><span className="pulse" /> BROWSER-NATIVE QA FOR GITHUB</div>
            <h1>Ship confidence.<br /><em>Not your source code.</em></h1>
            <p className="hero-copy">Turn any private GitHub repository into a secure, shareable QA environment. No deploys. No servers. No code leaving your browser.</p>
            <div className="hero-actions"><button className="primary" onClick={() => setMode("setup")}>Create a QA link <ArrowRight size={17} /></button><button className="demo-cta" onClick={openDemo}><Play size={15} /> Try the live demo</button><button className="ghost" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}><ArrowRight size={15} /> See how it works</button></div>
            <div className="trust-row"><span>Built for teams who care about</span><b><LockKeyhole size={13} /> privacy</b><b><Zap size={13} /> velocity</b><b><GitBranch size={13} /> GitHub</b></div>
          </section>
          <section className="preview-wrap container"><div className="preview-glow" />{createElement("edgeqa-demo", { auto: "auto", owner: owner || "acme", repo: repo || "marketing-site", branch: branch || "main" })}</section>
          <section className="feature-section container" id="security"><div className="section-label">WHY EDGEQA</div><h2>QA without the <em>trade-offs.</em></h2><div className="feature-grid">{features.map(({ icon: Icon, title, text }) => <div className="feature" key={title}><div className="feature-icon"><Icon size={18} /></div><h3>{title}</h3><p>{text}</p></div>)}</div></section>
          <section className="how container" id="how"><div><div className="section-label">THREE STEPS</div><h2>From commit to<br /><em>confidence.</em></h2></div><div className="steps"><div><strong>01</strong><span><b>Connect your repo</b><small>Bring a fine-grained GitHub token. It never leaves your tab.</small></span></div><div><strong>02</strong><span><b>Generate a magic link</b><small>Protect the session with a PIN and send it to your tester.</small></span></div><div><strong>03</strong><span><b>Get feedback in context</b><small>Testers see your real app and file issues right where they find them.</small></span></div></div></section>
          <section className="bottom-cta container"><div><span className="mini-mark">✦</span><h2>Make your next review<br /><em>feel effortless.</em></h2></div><button className="primary" onClick={() => setMode("setup")}>Start a QA session <ArrowRight size={17} /></button></section>
        </main>
        <footer className="footer container"><span><a href="https://github.com/Spuds0588/EdgeQA" target="_blank" rel="noreferrer">Spuds0588/EdgeQA</a> · <a href="https://github.com/Spuds0588" target="_blank" rel="noreferrer">built by @Spuds0588</a></span><span>Frontend-only. Privacy-first.</span><span><a href="https://github.com/Spuds0588/EdgeQA/issues" target="_blank" rel="noreferrer">Found a bug? Report it <ArrowRight size={11} /></a></span></footer>
      </>}

      {mode === "setup" && <Setup owner={owner} setOwner={setOwner} repo={repo} setRepo={setRepo} branch={branch} setBranch={setBranch} repoUrl={repoUrl} applyRepoUrl={applyRepoUrl} token={token} setToken={setToken} pin={pin} setPin={setPin} error={error} link={link} copied={copied} generate={generate} copyLink={copyLink} onBack={() => setMode("home")} onLaunch={() => setMode("viewer")} />}
      {mode === "unlock" && <main className="unlock container"><div className="unlock-card"><div className="empty-icon"><LockKeyhole size={25} /></div><div className="eyebrow"><span className="pulse" /> PRIVATE QA SESSION</div><h1>Enter the <em>session PIN.</em></h1><p>Unlock the browser-only preview for <b>{repoLabel}</b>. The repository token will never be saved.</p><input autoFocus type="password" value={unlockPin} onChange={(e) => setUnlockPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} placeholder="Session PIN" />{error && <div className="error">{error}</div>}<button className="primary full" onClick={unlock}>Unlock preview <ArrowRight size={17} /></button><button className="back" onClick={() => { window.location.hash = ""; setMode("home"); }}>← Create your own session</button></div></main>}
    </div>
  );
}

function Setup(props: any) {
  const [patOpen, setPatOpen] = useState(false);
  const target = props.owner && props.repo ? `${props.owner}/${props.repo}#${props.branch}` : "owner/repo#main";
  const appUrl = window.location.href.split("#")[0];
  const bookmarklet = "javascript:(()=>{const m=location.pathname.match(/^\\/([^/]+)\\/([^/]+)/);if(!m)return alert('Open a GitHub repo page first');const b=(location.pathname.match(/\\/(?:tree|blob)\\/([^/]+)/)||[])[1]||'main';location.href='" + appUrl + "#repo='+m[1]+'/'+m[2]+'&branch='+b})()";
  return <main className="setup container"><button className="back" onClick={props.onBack}>← Back to home</button><div className="setup-grid"><div className="setup-intro"><div className="eyebrow"><span className="pulse" /> NEW QA SESSION</div><h1>Bring your repo.<br /><em>Leave the deploy.</em></h1><p>Paste a GitHub repository URL, pick your branch, and mint a PIN-protected QA link — all in your browser.</p><div className="setup-note"><ShieldCheck size={18} /><span><b>Your token is ephemeral</b><small>Held in browser memory (per-tab) and not sent to any server.</small></span></div><div className="bookmark-box"><Zap size={15} /><div><b>Open any repo in one click</b><small>Drag this into your bookmarks bar, then press it while viewing a GitHub repo to pre-fill this form.</small></div><a className="bookmarklet" href={bookmarklet}>⚡ Install bookmarklet</a></div></div><div className="form-card"><div className="form-title"><span className="step-badge">01</span><span><b>Connect repository</b><small>Fine-grained token required</small></span></div><label>Repository URL<div className="input-icon"><Link2 size={15} /><input value={props.repoUrl} onChange={(e: any) => props.applyRepoUrl(e.target.value)} placeholder="https://github.com/acme/site or acme/site" /></div><small className="hint">Paste a full GitHub URL (owner & repo are pulled out), or fill the fields below. Supports <code>/tree/BRANCH</code>.</small></label><div className="two-col"><label>Repository owner<input value={props.owner} onChange={(e: any) => props.setOwner(e.target.value)} placeholder="e.g. acme-studio" /></label><label>Repository name<input value={props.repo} onChange={(e: any) => props.setRepo(e.target.value)} placeholder="e.g. marketing-site" /></label></div><label>Branch<input value={props.branch} onChange={(e: any) => props.setBranch(e.target.value)} /></label><div className="target-chip"><Link2 size={13} /> <span>{target}</span></div><div className="pat-box"><div className="pat-head" onClick={() => setPatOpen(!patOpen)}><KeyRound size={15} /><span><b>Need a fine-grained token?</b><small>Steps to create one</small></span><ChevronDown size={15} className={patOpen ? "spin" : ""} /></div>{patOpen && <ol className="pat-steps"><li>Go to <a href="https://github.com/settings/personal-access-tokens/new?scopes=" target="_blank" rel="noreferrer">github.com/settings/tokens</a> → <b>Generate new token</b>.</li><li>Choose <b>Fine-grained tokens</b>.</li><li>Under <b>Repository access</b>, pick the repo(s) you want to preview.</li><li>Under <b>Permissions</b> set <b>Contents → Read-only</b> and <b>Issues → Read and write</b>.</li><li>Generate, then paste the <code>github_pat_…</code> token into the field below.</li><li>Reuse it across sessions in this tab, or remove it after the link is minted — it stays in your browser.</li></ol>}</div><label>GitHub fine-grained token<div className="input-icon"><KeyRound size={15} /><input type="password" value={props.token} onChange={(e: any) => props.setToken(e.target.value)} placeholder="github_pat_••••••••••" /></div><small className="hint">Needs <b>Contents: Read</b> to serve files and <b>Issues: Write</b> to accept bug reports.</small></label><div className="form-title second"><span className="step-badge">02</span><span><b>Protect your link</b><small>Share the PIN separately</small></span></div><label>Session PIN<div className="input-icon"><LockKeyhole size={15} /><input type="password" value={props.pin} onChange={(e: any) => props.setPin(e.target.value)} placeholder="At least 6 characters" /></div></label>{props.error && <div className="error">{props.error}</div>}<button className="primary full" onClick={props.generate}>Generate magic link <ArrowRight size={17} /></button>{props.link && <div className="link-result"><small>YOUR SECURE QA LINK</small><div><span>{props.link.slice(0, 42)}…</span><button onClick={props.copyLink}>{props.copied ? <Check size={16} /> : <Clipboard size={16} />}</button></div><button className="launch" onClick={props.onLaunch}>Open preview <ArrowRight size={14} /></button></div>}</div></div></main>;
}

function Viewer({ repo, branch, path, token, readonly, onExit }: { repo: string; branch: string; path: string; token: string; readonly: boolean; onExit: () => void }) {
  const [warning, setWarning] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [issueUrl, setIssueUrl] = useState("");
  const [demoFiled, setDemoFiled] = useState(false);
  const [reportError, setReportError] = useState("");
  const [sandboxLoaded, setSandboxLoaded] = useState(false);
  const [swReady, setSwReady] = useState(false);
  const [includeLog, setIncludeLog] = useState(true);
  const [logCount, setLogCount] = useState(0);
  const [owner, repoName] = repo.split("/");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const openReport = () => { setReportOpen(true); setIssueUrl(""); setDemoFiled(false); setReportError(""); };
  const base = import.meta.env.BASE_URL || "/";
  const baseRoot = base.endsWith("/") ? base : base + "/";
  const dir = path ? path.replace(/^\/+|\/+$/g, "") + "/" : "";
  const sandboxUrl = `${baseRoot}sandbox/${encodeURIComponent(owner || "owner")}/${encodeURIComponent(repoName || "repo")}/${encodeURIComponent(branch)}/${dir}index.html`;
  // capture the session's console lines (a ring buffer) so the tester can opt to attach them to a report
  const consoleBuf = useRef<{ level: string; line: string }[]>([]);
  useEffect(() => {
    const fmt = (a: unknown) => a instanceof Error ? `Error: ${a.message}` : typeof a === "string" ? a : (() => { try { const s = JSON.stringify(a); return s === undefined ? String(a) : s; } catch { return String(a); } })();
    const originals: Record<string, (...args: any[]) => void> = {};
    ["log", "info", "warn", "error", "debug"].forEach((level) => {
      originals[level] = (console as any)[level].bind(console);
      (console as any)[level] = (...args: any[]) => { consoleBuf.current.push({ level, line: args.map(fmt).join(" ") }); if (consoleBuf.current.length > 200) consoleBuf.current.shift(); setLogCount(consoleBuf.current.length); originals[level](...args); };
    });
    return () => Object.entries(originals).forEach(([level, fn]) => { (console as any)[level] = fn; });
  }, []);
  const device = useMemo(() => {
    const ua = navigator.userAgent;
    const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "Unknown OS";
    const browser = /Edg\//i.test(ua) ? "Edge" : /OPR\//i.test(ua) ? "Opera" : /Firefox\//i.test(ua) ? "Firefox" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "Other";
    return `${browser} · ${os}`;
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setSwReady(true);
      return;
    }
    console.log("[edgeqa] registering service worker at", `${baseRoot}edgeqa-sw.js`);
    navigator.serviceWorker.register(`${baseRoot}edgeqa-sw.js`)
      .then(() => navigator.serviceWorker.ready)
      .then(async (registration) => {
        if (token) registration.active?.postMessage({ type: "SET_TOKEN", scope: `${repo}/${branch}`, token });
        // wait until the SW controls this page (clients.claim) so the very first
        // sandbox navigation is intercepted instead of hitting the static host
        if (!navigator.serviceWorker.controller) {
          await Promise.race([
            new Promise<void>((resolve) => {
              const done = () => resolve();
              navigator.serviceWorker.addEventListener("controllerchange", done, { once: true });
              if (navigator.serviceWorker.controller) { navigator.serviceWorker.removeEventListener("controllerchange", done); resolve(); }
            }),
            new Promise((resolve) => setTimeout(resolve, 3000)),
          ]);
        }
        setSwReady(true);
      });
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "EDGEQA_WARNING") { console.warn("[edgeqa]", event.data.message); setWarning(event.data.message); }
    };
    navigator.serviceWorker.addEventListener("message", handler); return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [repo, branch, baseRoot, token]);
  const submitIssue = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true); setReportError(""); setIssueUrl(""); setDemoFiled(false);
    if (!token) {
      // demo mode: simulate the round-trip so visitors can feel the full QA flow
      await new Promise((resolve) => setTimeout(resolve, 700));
      setDemoFiled(true); setTitle(""); setBody(""); setSubmitting(false);
      return;
    }
    const pagePath = iframeRef.current?.contentWindow?.location.pathname || sandboxUrl;
    const capturedLog = includeLog ? consoleBuf.current.slice(-80).map((e) => `[${e.level}] ${e.line}`) : [];
    const context = [
      "**Reported via EdgeQA**",
      `- Repository: \`${repo}\``,
      `- Branch: \`${branch}\``,
      `- Page: \`${pagePath}\``,
      `- Viewport: ${window.innerWidth}×${window.innerHeight}`,
      `- Device: ${device}`,
      `- Browser: ${navigator.userAgent}`,
      `- Time: ${new Date().toLocaleString()}`,
      body.trim() ? `\n### What happened\n\n${body.trim()}` : "",
      capturedLog.length ? `\n### Console log (from this QA session)\n\n\`\`\`\n${capturedLog.join("\n")}\n\`\`\`` : "",
    ].filter(Boolean).join("\n");
    try {
      const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner || "owner")}/${encodeURIComponent(repoName || "repo")}/issues`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: context, labels: ["edgeqa-report"] }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        if (response.status === 401) setReportError("Your token is invalid or was revoked. Generate a new fine-grained token.");
        else if (response.status === 403 || response.status === 404) setReportError("Your token needs Issues: Read and write permission for this repository.");
        else setReportError(`GitHub could not file the issue (${detail?.message || response.status}).`);
        return;
      }
      const issue = await response.json();
      setIssueUrl(issue.html_url || "https://github.com");
      setTitle(""); setBody("");
    } catch {
      setReportError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };
  if (readonly) return <div className="viewer"><div className="viewer-body">{swReady && <iframe ref={iframeRef} id="sandbox" title="EdgeQA repository sandbox" src={sandboxUrl} onLoad={() => setSandboxLoaded(true)} />}{!sandboxLoaded && <div className="empty-state overlay"><div className="empty-icon"><GitBranch size={26} /></div><h2>Loading preview…</h2><p>{token ? <>Unlocking <b>{repo}</b> on the <b>{branch}</b> branch.</> : <>Opening the public demo for <b>{repo}</b>.</>}</p><small>Service Worker VFS · {token ? "Token held in memory" : "No token needed for public repos"}</small></div>}</div>{warning && <div className="toast">{warning}<button onClick={() => setWarning("")}>×</button></div>}</div>;
  return <div className="viewer"><div className="viewer-top"><button className="brand" onClick={onExit}><span className="brand-mark"><Logo /></span><span>edge<span className="accent">qa</span></span></button><div className="viewer-address"><LockKeyhole size={12} /> edgeqa.local /sandbox/{repo}{path ? `/${path}` : ""}</div><div className="viewer-actions"><span className="live"><span className="live-dot" /> LIVE</span><button className="report" onClick={openReport}><Bug size={14} /> Report a bug</button></div></div><div className="viewer-body">{swReady && <iframe ref={iframeRef} id="sandbox" title="EdgeQA repository sandbox" src={sandboxUrl} onLoad={() => setSandboxLoaded(true)} />}{!sandboxLoaded && <div className="empty-state overlay"><div className="empty-icon"><GitBranch size={26} /></div><h2>Loading preview…</h2><p>{token ? <>Unlocking <b>{repo}</b> on the <b>{branch}</b> branch.</> : <>Opening the public demo for <b>{repo}</b>.</>}</p><small>Service Worker VFS · {token ? "Token held in memory" : "No token needed for public repos"}</small></div>}</div>{warning && <div className="toast">{warning}<button onClick={() => setWarning("")}>×</button></div>}<button className="report-tab" onClick={openReport}><Bug size={16} /><span>Report a bug</span></button><aside className={`report-drawer${reportOpen ? " open" : ""}`}><div className="report-drawer-head"><div><div className="eyebrow"><span className="pulse" /> IN-CONTEXT REPORT</div><h2>Found something <em>off?</em></h2></div><button className="close" onClick={() => setReportOpen(false)}>×</button></div>{demoFiled ? <div className="report-done"><div className="empty-icon"><Check size={22} /></div><h3>Issue filed ✓</h3><p><b>Demo mode</b> — this was a simulation, nothing was created on GitHub.</p><button className="again" onClick={() => setDemoFiled(false)}>File another</button></div> : issueUrl ? <div className="report-done"><div className="empty-icon"><Check size={22} /></div><h3>Issue filed ✓</h3><p>Filed against <b>{repo}</b> with session context attached.</p><div className="actions"><a className="issue-link" href={issueUrl} target="_blank" rel="noreferrer">View on GitHub <ArrowRight size={13} /></a><button className="again" onClick={() => { setIssueUrl(""); setDemoFiled(false); }}>File another</button></div></div> : <><label>Short title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Broken nav on mobile" /></label><label>What happened?<textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe the bug and what you expected instead…" rows={6} /></label>{reportError && <div className="error">{reportError}</div>}<details className="sys"><summary>What gets attached to this report <em>{token ? "auto" : "in demo"}</em></summary><div className="sys-grid"><span><b>Repo</b>{repo}</span><span><b>Branch</b>{branch}</span><span><b>Page</b>/{path || "index.html"}</span><span><b>Screensize</b>{window.innerWidth}×{window.innerHeight}</span><span><b>Device</b>{device}</span><span><b>Time</b>{new Date().toLocaleString()}</span></div></details><label className="log-opt"><input type="checkbox" checked={includeLog} onChange={(e) => setIncludeLog(e.target.checked)} /><span>Attach the session's console log<small>{logCount ? `${logCount} line${logCount === 1 ? "" : "s"} captured` : "nothing captured yet"}</small></span></label><p className="report-context">{token ? <>Filed against <b>{repo}</b> as a GitHub issue. Nothing leaves your browser until you hit submit.</> : <>Demo mode — submitting simulates filing an issue; nothing is created on GitHub.</>}</p><button className="submit" disabled={submitting || !title.trim()} onClick={submitIssue}>{submitting ? "Filing issue…" : token ? "Create GitHub issue" : "File demo issue"}{!submitting && <ArrowRight size={16} />}</button></>}</aside></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
