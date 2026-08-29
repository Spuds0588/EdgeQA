// edgeqa-demo — an animated demo walkthrough for the EdgeQA landing page.
// It's a web component so the media can be swapped for a video/gif later without
// touching the rest of the app. Pause-aware loops through three steps.
const STEP_MS = 2600;

const CSS = `
:host { display:block; overflow:hidden; --demo-acid:#c9f36b; --demo-line:#223038; --demo-dim:#5b6a70; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color:#edf2f1; }
* { box-sizing:border-box; }
.demo { position:relative; aspect-ratio: 16/9; min-height:220px; border:1px solid var(--demo-line); border-radius:8px; overflow:hidden; background:linear-gradient(145deg,#0e171d,#0a1116); display:flex; flex-direction:column; }
.media { position:absolute; inset:0; }
.media::slotted(*) { width:100%; height:100%; object-fit:cover; }
@keyframes cycleMask { 0%{opacity:.28} 8%{opacity:.28} 15%{opacity:.08} 30%{opacity:.08} 38%{opacity:.28} 100%{opacity:.28} }
@keyframes growBar { 0%{transform:scaleX(0)} 45%{transform:scaleX(1)} 100%{transform:scaleX(1)} }
.seq { position:absolute; inset:0; padding:26px 30px; display:grid; grid-auto-rows:1fr; gap:14px; }
.seq::before { content:""; position:absolute; inset:0; background:radial-gradient(ellipse at 30% 0%, rgba(201,243,107,.10), transparent 55%); animation:cycleMask 7.8s linear infinite; pointer-events:none; }
.step { display:flex; align-items:center; gap:14px; border:1px solid var(--demo-line); border-radius:7px; padding:10px 14px; background:#0c141a; opacity:.22; transform:translateY(2px); transition:opacity .4s, transform .4s; }
.step.on { opacity:1; transform:none; border-color:rgba(201,243,107,.5); }
.step .n { flex:none; width:22px; height:22px; border-radius:6px; display:grid; place-items:center; font:600 11px 'DM Mono', ui-monospace, monospace; background:#20303a; color:#9eb0b1; }
.step.on .n { background: var(--demo-acid); color:#142019; }
.step svg { flex:none; color:var(--demo-acid); }
.step .tx { display:flex; flex-direction:column; line-height:1.25; }
.step .tx b { font-size:12px; }
.step .tx span { font-size:10.5px; color:var(--demo-dim); }
.bar { margin-top:auto; height:3px; border-radius:3px; background:var(--demo-line); overflow:hidden; position:relative; }
.bar i { position:absolute; inset:0; transform-origin:left; background:var(--demo-acid); width:100%; }
.demo.on .bar i { animation: growBar 7.8s linear infinite; }
.legend { position:absolute; right:16px; top:14px; display:flex; gap:8px; }
.legend span { font:10px 'DM Mono', ui-monospace, monospace; letter-spacing:.05em; color:var(--demo-dim); }
.badge { position:absolute; left:16px; top:16px; font:11px 'DM Mono', ui-monospace, monospace; color:var(--demo-acid); letter-spacing:.08em; }
`;

function icon(s) {
  const paths = {
    repo: '<rect x="3" y="3" width="6" height="6"/><rect x="14" y="14" width="7" height="7"/><path d="M14 6h4a3 3 0 0 1 3 3v2M6 14v4a3 3 0 0 0 3 3h2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    bug: '<rect x="3" y="10" width="18" height="10" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3M5 15H3m0-5h2M21 15h-2m0-5h2M19 15l2 3M5 15l-2 3"/>',
  }[s];
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const STEPS = [
  { icon: "repo", b: "Connect repository", t: "Fine-grained token stays in your tab" },
  { icon: "link", b: "Mint a protected magic link", t: "PIN-encrypted and shareable" },
  { icon: "bug", b: "Testers submit in-context reports", t: "Filed straight to GitHub Issues" },
];

const template = document.createElement("template");
template.innerHTML = `<style>${CSS}</style><div class="demo">
  <span class="badge">HOW IT WORKS</span>
  <div class="legend"><span>· auto-playing demo</span></div>
  <slot name="media" class="media"></slot>
  <div class="seq"></div>
  <div class="bar"><i></i></div>
</div>`;

export default class EdgeQaDemo extends HTMLElement {
  static observedAttributes = ["auto"];

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.#build();
    if (this.getAttribute("auto") !== "false") this.play();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#frame);
    this.#ts = 0;
  }

  #build() {
    const seq = this.shadowRoot.querySelector(".seq");
    seq.textContent = "";
    for (let i = 0; i < STEPS.length; i++) {
      const d = document.createElement("div");
      d.className = "step";
      d.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>${icon(STEPS[i].icon)}<span class="tx"><b>${STEPS[i].b}</b><span>${STEPS[i].t}</span></span>`;
      seq.appendChild(d);
    }
  }

  #frame = 0;
  #ts = 0;

  play() {
    const step = this.shadowRoot.querySelectorAll(".step");
    const tick = (t) => {
      if (!this.#ts) this.#ts = t;
      const i = Math.floor((t - this.#ts) / STEP_MS) % step.length;
      step.forEach((s, k) => s.classList.toggle("on", k <= i));
      this.shadowRoot.host.classList.add("on");
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }  stop() {
    cancelAnimationFrame(this.#frame);
    this.shadowRoot.querySelectorAll(".step").forEach((s) => s.classList.remove("on"));
  }
}

if (!customElements.get("edgeqa-demo")) customElements.define("edgeqa-demo", EdgeQaDemo);
