// edgeqa-demo — an animated QA-environment demo for the EdgeQA landing page.
// Shows the actual thing you use: a sandboxed preview of a repo, with a tester
// opening the in-context report drawer, filling it out, and filing the issue
// back to GitHub. Rendered on a fixed 960x540 stage that is scaled to fit the
// host width (transform: scale), so it scales cleanly on every viewport.
// Kept as a web component with a <slot name="media"> so you can swap in a real
// video/GIF later without touching the rest of the app.

const CYCLE = 10400; // one full animation loop, ms
const TITLE = "Broken nav on mobile";
const BODY = "Nav links overlap and the CTA is cut off at mobile widths.";
const EASE = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
// cursor movement segments: [start, end, target selector]
const SEG = [
  { a: 1400, b: 2300, el: "#pill" },
  { a: 2800, b: 3500, el: "#dTitle" },
  { a: 4500, b: 5200, el: "#dBody" },
  { a: 6300, b: 6800, el: "#dSubmit" },
];

const CSS = `
:host { display:block; width:100%; height:540px; overflow:hidden; --qa-acid:#c9f36b; --qa-line:#223038; --qa-dim:#5b6a70; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color:#edf2f1; }
* { box-sizing:border-box; }
.stage { position:relative; width:960px; height:540px; transform-origin:top left; }
.win { position:absolute; inset:0; border:1px solid var(--qa-line); border-radius:10px; overflow:hidden; background:#0e171d; display:flex; flex-direction:column; }
.chrome { height:36px; flex:none; display:flex; align-items:center; gap:14px; padding:0 14px; border-bottom:1px solid var(--qa-line); background:#0a1116; }
.lights { display:flex; gap:6px; }
.lights i { width:8px; height:8px; border-radius:50%; background:#3a4650; }
.lights i:first-child { background:#e8685a; } .lights i:nth-child(2){ background:#e1b15a; } .lights i:nth-child(3){ background:#7ad05a; }
.addr { margin:auto; display:flex; align-items:center; gap:7px; font:600 10px ui-monospace, 'DM Mono', monospace; color:#8fa0a6; background:#141c22; border:1px solid #1f2b32; border-radius:5px; padding:5px 11px; }
.addr span { color:#5c6b72; }
.live { display:flex; align-items:center; gap:6px; font:600 9px ui-monospace,'DM Mono',monospace; color:var(--qa-acid); }
.live i { width:6px; height:6px; border-radius:50%; background:var(--qa-acid); box-shadow:0 0 0 0 rgba(201,243,107,.5); animation:beat 1.6s infinite; }
@keyframes beat { 0%,100%{box-shadow:0 0 0 0 rgba(201,243,107,.35)} 50%{box-shadow:0 0 0 5px rgba(201,243,107,0)} }
.body { flex:1; display:flex; min-height:0; }
.rail { width:168px; flex:none; border-right:1px solid var(--qa-line); padding:14px 11px; display:flex; flex-direction:column; gap:3px; background:#0c141a; }
.logo { display:flex; align-items:center; gap:6px; font-weight:800; font-size:12px; margin:0 6px 18px; letter-spacing:-.05em; }
.logo .lmark { width:13px; height:13px; color:var(--qa-acid); }
.sect { font:600 8px ui-monospace,'DM Mono',monospace; letter-spacing:.14em; color:#52636b; margin:12px 6px 4px; }
.item { font-size:10.5px; color:#9fb0b2; display:flex; align-items:center; gap:8px; padding:8px; border-radius:5px; }
.item.on { background:rgba(201,243,107,.12); color:var(--qa-acid); }
.item small { margin-left:auto; color:#5c6c73; font-size:9px; }
.item.dim { color:#6d7d84; }
.foot { margin-top:auto; border-top:1px solid var(--qa-line); padding:12px 6px 2px; display:flex; gap:8px; align-items:center; font-size:9px; color:#9fb0b2; }
.foot b { font-size:9.5px; font-weight:600; display:block; }
.foot small { color:#5c6c73; }
.ava { flex:none; width:24px; height:24px; display:grid; place-items:center; background:#ff805f; color:#211817; border-radius:50%; font-size:9px; font-weight:800; }
.site { flex:1; background:#f2f1e9; color:#152228; display:flex; flex-direction:column; }
.site nav { height:52px; flex:none; display:flex; align-items:center; gap:20px; padding:0 28px; font-size:9px; color:#526066; }
.site nav b { font-size:14px; color:#18292c; margin-right:auto; letter-spacing:-.06em; }
.site nav span { color:#6d7b80; }
.site nav button { background:#173237; color:#eaf0db; padding:8px 13px; border-radius:3px; font:800 9px system-ui,sans-serif; cursor:pointer; }
.hero { position:relative; flex:1; padding:48px 0 36px 12%; overflow:hidden; }
.kicker { color:#778785; font:500 8px ui-monospace,'DM Mono',monospace; letter-spacing:.12em; }
.hero h2 { font-size:52px; line-height:.96; letter-spacing:-.09em; margin:14px 0; color:#1b3338; }
.hero h2 strong { color:#e87352; }
.hero p { color:#68777a; font-size:9.5px; max-width:210px; line-height:1.6; }
.hero button { margin-top:16px; display:inline-flex; align-items:center; gap:7px; background:#c9f36b; color:#23312b; padding:10px 13px; font:800 9px system-ui,sans-serif; border-radius:0; cursor:pointer; }
.stats { display:flex; gap:38px; border-top:1px solid #d5d8cd; margin:0 10%; padding-top:13px; color:#84918e; font-size:8px; }
.stats b { font-size:14px; color:#203337; display:block; }
.snap { position:absolute; inset:0; border:2px solid rgba(201,243,107,0); pointer-events:none; transition:border-color .3s; }
.legend { position:absolute; left:16px; top:12px; font:600 8px ui-monospace,'DM Mono',monospace; letter-spacing:.14em; color:var(--qa-dim); z-index:3; }
/* QA chrome overlays */
.pill { position:absolute; right:16px; bottom:16px; display:flex; align-items:center; gap:8px; background:#132a2e; color:var(--qa-acid); font-size:10px; font-weight:600; padding:10px 14px; border-radius:5px; box-shadow:0 6px 20px rgba(0,0,0,.35); transition:transform .2s, box-shadow .2s; z-index:3; }
.pill.hot { transform:translateY(-2px); box-shadow:0 10px 26px rgba(201,243,107,.25); }
.pill.pop { transform:scale(1.12); }
.drawer { position:absolute; top:10px; right:10px; bottom:10px; width:300px; z-index:5; background:#0f181e; border:1px solid #2a3941; border-radius:8px; padding:16px 16px 14px; display:flex; flex-direction:column; transform:translateX(calc(100% + 24px)); transition:transform .32s ease; box-shadow:-14px 0 40px rgba(0,0,0,.35); }
.drawer.open { transform:translateX(0); }
.drawer-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px; }
.drawer-head b { font-size:12.5px; color:#e4ecea; display:block; letter-spacing:-.02em; }
.drawer-head small { font-size:8.5px; color:#6c7b81; }
.drawer-head span { color:#6c7b81; font-size:15px; line-height:1; }
.drawer label { display:block; font-size:9px; color:#93a1a5; margin-top:11px; }
.drawer input, .drawer textarea { display:block; width:100%; margin-top:5px; background:#0a1218; border:1px solid #27343d; border-radius:4px; color:#e8efed; font:inherit; font-size:10.5px; padding:8px 9px; outline:none; transition:border-color .2s; }
.drawer input.act, .drawer textarea.act { border-color:var(--qa-acid); box-shadow:0 0 0 1px rgba(201,243,107,.35); }
.drawer textarea { resize:none; height:66px; }
.dSubmit { margin-top:auto; background:var(--qa-acid); color:#1b2a10; font:800 10.5px system-ui,sans-serif; padding:10px 12px; border-radius:4px; transition:transform .15s; }
.dSubmit.pop { transform:scale(1.05); }
.dctx { font-size:8px; color:#5f6e74; line-height:1.5; margin-top:7px; }
.cursor { position:absolute; width:26px; height:26px; z-index:6; opacity:0; pointer-events:none; }
.cursor svg { width:100%; height:100%; opacity:.95; }
.cursor.on { opacity:1; }
.toast { position:absolute; right:16px; bottom:74px; z-index:6; background:#182416; border:1px solid #3d5231; color:#d9e6d5; font-size:10px; padding:11px 14px; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,.4); display:flex; gap:9px; align-items:flex-start; max-width:240px; transform:translateX(calc(100% + 20px)); transition:transform .35s ease; }
.toast.on { transform:translateX(0); }
.toast b { color:var(--qa-acid); display:block; font-size:10px; margin-bottom:2px; }
.toast small { color:#9fb0a4; font-size:9px; line-height:1.5; display:block; }
`;

const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 7.4 2 12l2.6 4.6"/><path d="M19.4 7.4 22 12l-2.6 4.6"/><path d="M8.5 2.6h7"/><path d="M10 2.6v7.4a2 2 0 0 1-.2.9L4.7 20.4a1 1 0 0 0 .9 1.5h12.8a1 1 0 0 0 .9-1.5l-5.1-9.5a2 2 0 0 1-.2-.9V2.6"/><path d="M8 16.4h8"/></svg>';

const template = document.createElement("template");
template.innerHTML = `<style>${CSS}</style><div class="stage">
  <div class="win">
    <div class="chrome"><div class="lights"><i></i><i></i><i></i></div><div class="addr">◆&nbsp; edgeqa.local <span id="addr">/sandbox/…</span></div><div class="live"><i></i>&nbsp;LIVE</div></div>
    <div class="body">
      <aside class="rail"><div class="logo"><span class="lmark">${LOGO}</span> edgeqa</div><div class="sect">WORKSPACE</div>
        <div class="item on">◈ Preview</div><div class="item">⌁ Issues <small id="issues">3</small></div>
        <div class="sect">REPOSITORY</div><div class="item dim"><span id="repoName">acme/marketing-site</span></div><div class="item dim"><span id="branchName">main</span></div>
        <div class="foot"><div class="ava">JD</div><span><b>QA session</b><small>Token in memory</small></span></div>
      </aside>
      <div class="site">
        <nav><b>Northstar</b><span>Changelog</span><span>Docs</span><span>Pricing</span><button>Get started ↗</button></nav>
        <div class="hero"><div class="snap" id="snap"></div><div class="kicker">THE OPERATING SYSTEM FOR MODERN TEAMS</div><h2>Make work<br /><strong>flow.</strong></h2><p>One calm space for your team's best thinking, building, and shipping.</p><button>Explore Northstar →</button></div>
        <div class="stats"><span><b>42k</b> teams in motion</span><span><b>99.9%</b> less busywork</span></div>
      </div>
    </div>
  </div>
  <span class="legend">● LIVE SANDBOX · recording</span>
  <slot name="media"></slot>
  <div class="pill" id="pill">🐞 <span>Report a bug</span></div>
  <aside class="drawer" id="drawer">
    <div class="drawer-head"><div><b>Report a bug</b><small id="dRepo">acme/marketing-site · main</small></div><span>×</span></div>
    <label>Short title<input id="dTitle" placeholder="e.g. Broken nav on mobile" autocomplete="off"></label>
    <label>What happened?<textarea id="dBody" placeholder="Describe the bug and what you expected instead…"></textarea></label>
    <button class="dSubmit" id="dSubmit">Create GitHub issue →</button>
    <small class="dctx">Current path · viewport · UA attached automatically</small>
  </aside>
  <div class="cursor" id="cursor"><svg viewBox="0 0 24 24" fill="none" stroke="#cff36b" stroke-width="2"><path d="M5 3l5 14 2.5-5.5L18 9z"/></svg></div>
  <div class="toast" id="toast"><div><b>✓ Bug filed to GitHub Issues</b><small id="toastMsg">acme/marketing-site · issue opened</small></div></div>
</div>`;

export default class EdgeQaDemo extends HTMLElement {
  static observedAttributes = ["auto"];

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.#wire();
    this.#resize();
    if (typeof ResizeObserver !== "undefined") {
      this.#ro = new ResizeObserver(() => this.#resize());
      this.#ro.observe(this);
    } else {
      window.addEventListener("resize", this.#onWinResize);
    }
    if (this.getAttribute("auto") !== "false") this.play();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#frame);
    this.#ts = 0;
    this.#ro?.disconnect();
    window.removeEventListener("resize", this.#onWinResize);
  }

  #ro = null;
  #onWinResize = () => this.#resize();

  #resize() {
    const w = this.clientWidth || 960;
    const s = w / 960;
    const stage = this.shadowRoot?.querySelector(".stage");
    if (!stage) return;
    stage.style.transform = `scale(${s})`;
    this.style.height = `${Math.round(540 * s)}px`;
  }

  #wire() {
    const owner = this.getAttribute("owner") || "acme";
    const repo = this.getAttribute("repo") || "marketing-site";
    const branch = this.getAttribute("branch") || "main";
    this.shadowRoot.querySelector("#addr").textContent = `/sandbox/${owner}/${repo}/${branch}`;
    this.shadowRoot.querySelector("#repoName").textContent = `${owner}/${repo}`;
    this.shadowRoot.querySelector("#branchName").textContent = branch;
    this.shadowRoot.querySelector("#dRepo").textContent = `${owner}/${repo} · ${branch}`;
    this.shadowRoot.querySelector("#toastMsg").textContent = `${owner}/${repo} · issue opened`;
  }

  #frame = 0;
  #ts = 0;
  #seg = null;
  #from = { x: 920, y: 500 };
  #pos = { x: 920, y: 500 };

  play() {
    const $ = (s) => this.shadowRoot.querySelector(s);
    const tick = (now) => {
      if (!this.#ts) this.#ts = now;
      const t = (now - this.#ts) % CYCLE;
      const cursor = $("#cursor");
      const stage = $(".stage");

      // cursor: follow the movement segments, eased, in unscaled stage coords
      const seg = SEG.find((s) => t >= s.a && t < s.b);
      if (seg && seg !== this.#seg) { this.#from = this.#pos; this.#seg = seg; }
      if (seg) {
        const p = EASE(Math.min((t - seg.a) / (seg.b - seg.a), 1));
        const el = $(seg.el);
        const r = el.getBoundingClientRect();
        const st = stage.getBoundingClientRect();
        const k = st.width / 960;
        const to = { x: (r.left - st.left + r.width / 2) / k, y: (r.top - st.top + r.height / 2) / k };
        this.#pos = { x: this.#from.x + (to.x - this.#from.x) * p, y: this.#from.y + (to.y - this.#from.y) * p };
      } else if (this.#seg) { this.#from = this.#pos; this.#seg = null; }
      cursor.style.transform = `translate(${this.#pos.x}px, ${this.#pos.y}px) translate(-50%, -50%)`;
      cursor.classList.toggle("on", t >= 1400 && t < 9600);

      // drawer lifecycle
      $("#drawer").classList.toggle("open", t >= 2600 && t < 7100);
      $("#pill").classList.toggle("hot", t >= 2300 && t < 2600);
      $("#pill").classList.toggle("pop", t >= 2600 && t < 2800);
      $("#dSubmit").classList.toggle("pop", t >= 6800 && t < 7000);
      $("#snap").style.borderColor = t >= 2600 && t < 9500 ? "rgba(201,243,107,.4)" : "transparent";

      // typing into the form
      const titleEl = $("#dTitle");
      const bodyEl = $("#dBody");
      const type = (el, txt, a, b) => { el.value = txt.slice(0, Math.max(0, Math.min(txt.length, Math.floor(((t - a) / (b - a)) * txt.length)))); };
      if (t >= 3500 && t < 4500) type(titleEl, TITLE, 3500, 4500);
      if (t >= 5200 && t < 6300) type(bodyEl, BODY, 5200, 6300);
      if (t < 2600) { titleEl.value = ""; bodyEl.value = ""; }
      titleEl.classList.toggle("act", t >= 3500 && t < 4500);
      bodyEl.classList.toggle("act", t >= 5200 && t < 6300);

      // result: issue filed
      $("#toast").classList.toggle("on", t >= 7300 && t < 9600);
      $("#issues").textContent = t >= 7300 && t < 9600 ? "4" : "3";

      void cursor.offsetWidth; // keep transitions/rAF flowing even when headless
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.#frame);
    this.shadowRoot.querySelector("#toast").classList.remove("on");
    this.shadowRoot.querySelector("#drawer").classList.remove("open");
  }
}

if (!customElements.get("edgeqa-demo")) customElements.define("edgeqa-demo", EdgeQaDemo);
