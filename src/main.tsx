import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, Check, Clipboard, GitBranch, KeyRound, LockKeyhole, Menu, Play, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import "./index.css";

type Mode = "home" | "setup" | "unlock" | "viewer";

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
  const [token, setToken] = useState("");
  const [pin, setPin] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [error, setError] = useState("");

  const hashParams = useMemo(() => new URLSearchParams(window.location.hash.replace(/^#/, "")), []);

  useMemo(() => {
    if (!hashParams.get("payload") || !hashParams.get("repo")) return;
    const [parsedOwner, parsedRepo] = decodeURIComponent(hashParams.get("repo")!).split("/");
    setOwner(parsedOwner || ""); setRepo(parsedRepo || ""); setBranch(hashParams.get("branch") || "main"); setMode("unlock");
  }, [hashParams]);

  const repoLabel = useMemo(() => owner && repo ? `${owner}/${repo}` : "your private repository", [owner, repo]);

  const generate = async () => {
    setError("");
    if (!owner || !repo || !token || pin.length < 6) { setError("Add a repository, token, and a PIN of at least 6 characters."); return; }
    const payload = await makePayload(token, pin);
    const value = `${window.location.origin}/#repo=${encodeURIComponent(`${owner}/${repo}`)}&branch=${encodeURIComponent(branch)}&payload=${encodeURIComponent(payload)}`;
    setLink(value);
  };

  const copyLink = async () => { await navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  const unlock = async () => {
    try {
      const payload = hashParams.get("payload"); if (!payload) throw new Error("Missing secure payload");
      const [saltText, ivText, encryptedText] = payload.split(".");
      const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
      const salt = fromBase64(saltText), iv = fromBase64(ivText), encrypted = fromBase64(encryptedText);
      const key = await deriveKey(unlockPin, salt.buffer);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
      setToken(new TextDecoder().decode(decrypted)); setMode("viewer");
    } catch { setError("That PIN did not unlock this QA session."); }
  };

  if (mode === "viewer") return <Viewer repo={repoLabel} branch={branch} onExit={() => setMode("home")} />;

  return (
    <div className="app-shell">
      <header className="nav container">
        <button className="brand" onClick={() => setMode("home")}><span className="brand-mark"><Sparkles size={16} /></span><span>edge<span className="accent">qa</span></span></button>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        <nav className={menuOpen ? "nav-links open" : "nav-links"}><a href="#how">How it works</a><a href="#security">Security</a><button className="nav-cta" onClick={() => setMode("setup")}>Open workspace <ArrowRight size={15} /></button></nav>
      </header>

      {mode === "home" && <>
        <main>
          <section className="hero container">
            <div className="eyebrow"><span className="pulse" /> BROWSER-NATIVE QA FOR GITHUB</div>
            <h1>Ship confidence.<br /><em>Not your source code.</em></h1>
            <p className="hero-copy">Turn any private GitHub repository into a secure, shareable QA environment. No deploys. No servers. No code leaving your browser.</p>
            <div className="hero-actions"><button className="primary" onClick={() => setMode("setup")}>Create a QA link <ArrowRight size={17} /></button><button className="ghost" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}><Play size={15} fill="currentColor" /> See how it works</button></div>
            <div className="trust-row"><span>Built for teams who care about</span><b><LockKeyhole size={13} /> privacy</b><b><Zap size={13} /> velocity</b><b><GitBranch size={13} /> GitHub</b></div>
          </section>
          <section className="preview-wrap container"><div className="preview-glow" /><div className="preview-card"><div className="window-bar"><div className="traffic"><i /><i /><i /></div><div className="address"><LockKeyhole size={12} /> edgeqa.local <span>/sandbox/{repoLabel}</span></div><div className="live"><span className="live-dot" /> LIVE</div></div><div className="preview-content"><aside><div className="side-logo"><span className="mini-mark">✦</span> edgeqa</div><div className="side-section">WORKSPACE</div><div className="side-item selected">◈ <span>Preview</span></div><div className="side-item">⌁ <span>Issues</span><small>3</small></div><div className="side-section">REPOSITORY</div><div className="side-item muted">⌘ <span>{repoLabel}</span></div><div className="side-item muted">⑂ <span>{branch}</span></div><div className="side-footer"><div className="avatar">JD</div><span>QA session<br /><small>Token in memory</small></span></div></aside><div className="mock-site"><div className="mock-nav"><b>Northstar</b><span>Changelog</span><span>Docs</span><span>Pricing</span><button>Get started ↗</button></div><div className="mock-hero"><div className="mock-kicker">THE OPERATING SYSTEM FOR MODERN TEAMS</div><h2>Make work<br /><strong>flow.</strong></h2><p>One calm space for your team's best thinking, building, and shipping.</p><button>Explore Northstar <ArrowRight size={13} /></button></div><div className="mock-stats"><span><b>42k</b> teams in motion</span><span><b>99.9%</b> less busywork</span></div></div></div><div className="bug-pill">🐞 Report a bug</div></div></section>
          <section className="feature-section container" id="security"><div className="section-label">WHY EDGEQA</div><h2>QA without the <em>trade-offs.</em></h2><div className="feature-grid">{features.map(({ icon: Icon, title, text }) => <div className="feature" key={title}><div className="feature-icon"><Icon size={18} /></div><h3>{title}</h3><p>{text}</p></div>)}</div></section>
          <section className="how container" id="how"><div><div className="section-label">THREE STEPS</div><h2>From commit to<br /><em>confidence.</em></h2></div><div className="steps"><div><strong>01</strong><span><b>Connect your repo</b><small>Bring a fine-grained GitHub token. It never leaves your tab.</small></span></div><div><strong>02</strong><span><b>Generate a magic link</b><small>Protect the session with a PIN and send it to your tester.</small></span></div><div><strong>03</strong><span><b>Get feedback in context</b><small>Testers see your real app and file issues right where they find them.</small></span></div></div></section>
          <section className="bottom-cta container"><div><span className="mini-mark">✦</span><h2>Make your next review<br /><em>feel effortless.</em></h2></div><button className="primary" onClick={() => setMode("setup")}>Start a QA session <ArrowRight size={17} /></button></section>
        </main>
        <footer className="footer container"><span>© 2024 edgeqa</span><span>Frontend-only. Privacy-first.</span><span>Made for the web <span className="accent">✦</span></span></footer>
      </>}

      {mode === "setup" && <Setup owner={owner} setOwner={setOwner} repo={repo} setRepo={setRepo} branch={branch} setBranch={setBranch} token={token} setToken={setToken} pin={pin} setPin={setPin} error={error} link={link} copied={copied} generate={generate} copyLink={copyLink} onBack={() => setMode("home")} onLaunch={() => setMode("viewer")} />}
      {mode === "unlock" && <main className="unlock container"><div className="unlock-card"><div className="empty-icon"><LockKeyhole size={25} /></div><div className="eyebrow"><span className="pulse" /> PRIVATE QA SESSION</div><h1>Enter the <em>session PIN.</em></h1><p>Unlock the browser-only preview for <b>{repoLabel}</b>. The repository token will never be saved.</p><input autoFocus type="password" value={unlockPin} onChange={(e) => setUnlockPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} placeholder="Session PIN" />{error && <div className="error">{error}</div>}<button className="primary full" onClick={unlock}>Unlock preview <ArrowRight size={17} /></button><button className="back" onClick={() => { window.location.hash = ""; setMode("home"); }}>← Create your own session</button></div></main>}
    </div>
  );
}

function Setup(props: any) {
  return <main className="setup container"><button className="back" onClick={props.onBack}>← Back to home</button><div className="setup-grid"><div className="setup-intro"><div className="eyebrow"><span className="pulse" /> NEW QA SESSION</div><h1>Bring your repo.<br /><em>Leave the deploy.</em></h1><p>EdgeQA runs your static frontend directly from GitHub, inside a secure browser sandbox.</p><div className="setup-note"><ShieldCheck size={18} /><span><b>Your token is ephemeral</b><small>Held in memory and cleared when you close this tab.</small></span></div></div><div className="form-card"><div className="form-title"><span className="step-badge">01</span><span><b>Connect repository</b><small>Fine-grained token required</small></span></div><label>Repository owner<input value={props.owner} onChange={(e: any) => props.setOwner(e.target.value)} placeholder="e.g. acme-studio" /></label><label>Repository name<input value={props.repo} onChange={(e: any) => props.setRepo(e.target.value)} placeholder="e.g. marketing-site" /></label><div className="two-col"><label>Branch<input value={props.branch} onChange={(e: any) => props.setBranch(e.target.value)} /></label><label>Preset<select><option>Static site</option><option>React (experimental)</option></select></label></div><label>GitHub fine-grained token<div className="input-icon"><KeyRound size={15} /><input type="password" value={props.token} onChange={(e: any) => props.setToken(e.target.value)} placeholder="github_pat_••••••••••" /></div><small className="hint">Contents: Read · Issues: Write</small></label><div className="form-title second"><span className="step-badge">02</span><span><b>Protect your link</b><small>Share the PIN separately</small></span></div><label>Session PIN<div className="input-icon"><LockKeyhole size={15} /><input type="password" value={props.pin} onChange={(e: any) => props.setPin(e.target.value)} placeholder="At least 6 characters" /></div></label>{props.error && <div className="error">{props.error}</div>}<button className="primary full" onClick={props.generate}>Generate magic link <ArrowRight size={17} /></button>{props.link && <div className="link-result"><small>YOUR SECURE QA LINK</small><div><span>{props.link.slice(0, 42)}…</span><button onClick={props.copyLink}>{props.copied ? <Check size={16} /> : <Clipboard size={16} />}</button></div><button className="launch" onClick={props.onLaunch}>Open preview <ArrowRight size={14} /></button></div>}</div></div></main>;
}

function Viewer({ repo, branch, onExit }: { repo: string; branch: string; onExit: () => void }) {
  const [warning, setWarning] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [owner, repoName] = repo.split("/");
  const base = (import.meta.env.BASE_URL || "/").replace(/^[\.\/]/, "/");
  const baseRoot = base.endsWith("/") ? base : base + "/";
  const sandboxUrl = `${baseRoot}sandbox/${encodeURIComponent(owner || "owner")}/${encodeURIComponent(repoName || "repo")}/${encodeURIComponent(branch)}/index.html`;
  useMemo(() => {
    if (!("serviceWorker" in navigator)) return;
    console.log("[edgeqa] registering service worker at", `${baseRoot}edgeqa-sw.js`);
    navigator.serviceWorker.register(`${baseRoot}edgeqa-sw.js`).then(() => navigator.serviceWorker.ready).then((registration) => {
      registration.active?.postMessage({ type: "SET_TOKEN", scope: `${repo}/${branch}`, token: "session-token" });
    });
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "EDGEQA_WARNING") { console.warn("[edgeqa]", event.data.message); setWarning(event.data.message); }
    };
    navigator.serviceWorker.addEventListener("message", handler); return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [repo, branch, baseRoot]);
  return <div className="viewer"><div className="viewer-top"><button className="brand" onClick={onExit}><span className="brand-mark"><Sparkles size={16} /></span><span>edge<span className="accent">qa</span></span></button><div className="viewer-address"><LockKeyhole size={12} /> edgeqa.local /sandbox/{repo}</div><div className="viewer-actions"><span className="live"><span className="live-dot" /> LIVE</span><button className="report" onClick={() => setShowReport(true)}>🐞 Report a bug</button></div></div><div className="viewer-body"><iframe title="EdgeQA repository sandbox" src={sandboxUrl} /><div className="empty-state overlay"><div className="empty-icon"><GitBranch size={26} /></div><h2>Sandbox ready</h2><p>Connect a repository to load <b>{repo}</b> on the <b>{branch}</b> branch.</p><button className="primary" onClick={onExit}>Configure repository <ArrowRight size={16} /></button><small>Service Worker VFS · Token held in memory</small></div></div>{warning && <div className="toast">{warning}<button onClick={() => setWarning("")}>×</button></div>}{showReport && <div className="modal-backdrop"><div className="report-card"><button className="close" onClick={() => setShowReport(false)}>×</button><div className="eyebrow"><span className="pulse" /> IN-CONTEXT REPORT</div><h2>Found something <em>off?</em></h2><input placeholder="Short title" /><textarea placeholder="What happened?" rows={5} /><button className="primary full" onClick={() => { setReportSent(true); setShowReport(false); }}>Create GitHub issue <ArrowRight size={16} /></button>{reportSent && <small className="success">Issue queued with session context.</small>}</div></div>}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
