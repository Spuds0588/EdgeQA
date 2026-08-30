// edgeqa-demo — an animated QA-environment demo for the EdgeQA landing page.
// Tells the full story in three scenes on a fixed 960x540 stage that scales to
// the host width (transform: scale):
//   1. The dev shares the QA link + PIN with the tester in a chat message.
//   2. The tester runs the desktop preview, spots a bug, fills the report
//      drawer, and files it back to GitHub.
//   3. The same flow on a phone (mobile QA) with a bottom-sheet report.
// Kept as a web component with a <slot name="media"> so you can swap in a real
// video/GIF later without touching the rest of the app.

const CYCLE = 24000; // one full animation loop, ms (slowed so viewers can follow each step)
const TITLE = "New task fails with 500";
const BODY = "Clicking 'New task' shows the error banner and the task never appears. Reproducible every time.";
const TITLE2 = "New task 500 on mobile";
const BODY2 = "Same failure on the phone — error banner shows, task never created.";
const EASE = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
// cursor movement segments: [start, end, target selector]
const SEG = [
  { a: 1600, b: 2000, el: "#send" },
  { a: 6800, b: 7300, el: "#pill" },
  { a: 8000, b: 8600, el: "#dTitle" },
  { a: 9900, b: 10500, el: "#dBody" },
  { a: 12100, b: 12400, el: "#dSubmit" },
  { a: 15200, b: 15600, el: "#p3Pill" },
  { a: 16200, b: 16800, el: "#p3Title" },
  { a: 18300, b: 18900, el: "#p3Body" },
  { a: 20500, b: 20700, el: "#p3Submit" },
];

const CSS = `
:host { display:block; width:100%; height:540px; overflow:hidden; --qa-acid:#c9f36b; --qa-line:#223038; --qa-dim:#5b6a70; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color:#edf2f1; }
* { box-sizing:border-box; }
.stage { position:relative; width:960px; height:540px; transform-origin:top left; }
.win { position:absolute; inset:0; border:1px solid var(--qa-line); border-radius:10px; overflow:hidden; background:#0e171d; display:flex; flex-direction:column; transition:filter .5s ease; }
.win.dim { filter:brightness(.5); }
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
.site { flex:1; background:#f2f1e9; color:#152228; display:flex; flex-direction:column; min-width:0; }
.sitebar { height:42px; flex:none; display:flex; align-items:center; gap:10px; padding:0 12px; border-bottom:1px solid #dde0d4; background:#f7f6f0; }
.sitebar b { font-size:11px; color:#18292c; letter-spacing:-.05em; display:flex; align-items:center; gap:6px; }
.sitebar .ws { font-size:8px; color:#6d7b80; margin-right:auto; }
.sitebar .ws b { color:#18292c; }
.sitebar button { font:800 8px system-ui,sans-serif; border-radius:3px; padding:6px 9px; cursor:pointer; }
.sitebar .invite { background:none; border:1px solid #c9cec2; color:#4b5a5e; }
.sitebar .newtask { background:#c9f36b; border:0; color:#23312b; }
.workspace { position:relative; flex:1; display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.wrow { flex:1; display:flex; min-height:0; }
.errbanner { display:none; align-items:center; gap:6px; margin:8px 10px 0; background:#fdeee7; border:1px solid #f2c9b6; color:#a3431f; font-size:7.5px; padding:6px 9px; border-radius:5px; }
.errbanner.on { display:flex; }
.mnav { width:100px; flex:none; border-right:1px solid #dde0d4; padding:9px 6px; background:#f2f1e9; }
.mnav .sect { font:600 6px ui-monospace,'DM Mono',monospace; letter-spacing:.12em; color:#9aa49f; margin:8px 8px 3px; }
.mnav .mitem { font-size:8px; color:#5c6b70; padding:5px 7px; border-radius:4px; display:flex; align-items:center; gap:6px; }
.mnav .mitem.on { background:#e2e9dd; color:#1c2b1f; font-weight:600; }
.mnav .mava { width:12px; height:12px; border-radius:50%; display:inline-grid; place-items:center; font-size:5.5px; font-weight:800; color:#211817; background:var(--qa-acid); }
.board { flex:1; display:flex; gap:8px; padding:10px; min-width:0; }
.col { flex:1; min-width:0; background:#e9eae2; border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:6px; }
.col h4 { font:700 6.5px ui-monospace,'DM Mono',monospace; letter-spacing:.09em; color:#7a8786; margin:1px 3px 3px; text-transform:uppercase; }
.card { background:#fff; border:1px solid #dde0d4; border-radius:5px; padding:7px 8px; box-shadow:0 1px 2px rgba(21,34,40,.05); }
.card b { display:block; font-size:7.5px; color:#203337; line-height:1.35; }
.card small { display:block; font-size:6px; color:#8a9592; margin-top:3px; }
.card .tag { display:inline-block; font:700 5.5px ui-monospace,'DM Mono',monospace; letter-spacing:.05em; color:#b0542f; background:#fbe7dc; border-radius:2px; padding:1px 4px; margin-top:4px; }
.card .who { float:right; width:12px; height:12px; border-radius:50%; display:grid; place-items:center; font-size:5.5px; font-weight:800; color:#211817; background:#ff805f; margin-top:1px; }
.chatpane { width:168px; flex:none; border-left:1px solid #dde0d4; background:#f7f6f0; display:flex; flex-direction:column; min-height:0; }
.chead { padding:8px 10px; border-bottom:1px solid #dde0d4; display:flex; align-items:center; gap:7px; }
.chead b { font-size:8.5px; color:#203337; display:block; }
.chead small { font-size:6.5px; color:#8a9592; }
.chead .live { margin-left:auto; font:600 6.5px ui-monospace,'DM Mono',monospace; color:#3f8f2f; }
.cmsgs { flex:1; padding:8px 10px; display:flex; flex-direction:column; gap:6px; overflow:hidden; }
.cmsg { max-width:90%; font-size:7.5px; line-height:1.4; padding:5px 8px; border-radius:6px; }
.cmsg.me { align-self:flex-end; background:#dcefd2; color:#2a3b2b; }
.cmsg.them { align-self:flex-start; background:#fff; border:1px solid #e3e5db; color:#4a585b; }
.cmsg b { display:block; font-size:6px; opacity:.75; }
.cin { display:flex; gap:5px; padding:7px 10px; border-top:1px solid #dde0d4; }
.cin span { flex:1; background:#fff; border:1px solid #d9dccf; border-radius:10px; padding:4px 8px; font-size:7px; color:#9aa49f; }
.cin button { background:#173237; color:#eaf0db; border:0; border-radius:9px; padding:5px 8px; font:800 7px system-ui,sans-serif; }
.snap { position:absolute; inset:0; border:2px solid rgba(201,243,107,0); pointer-events:none; transition:border-color .3s; }
.legend { position:absolute; left:16px; top:12px; font:600 8px ui-monospace,'DM Mono',monospace; letter-spacing:.14em; color:var(--qa-dim); z-index:6; }
/* scene wrappers */
.desk, .chat, .phone { position:absolute; inset:0; opacity:0; transition:opacity .5s ease; z-index:3; pointer-events:none; }
.desk.on, .chat.on, .phone.on { opacity:1; }
/* scene 1: chat share of the QA link + PIN */
.chat { display:grid; place-items:center; z-index:4; }
.chat-card { width:370px; background:#0e171d; border:1px solid #2a3941; border-radius:12px; box-shadow:0 24px 60px rgba(0,0,0,.5); overflow:hidden; }
.chat-head { display:flex; align-items:center; gap:9px; padding:11px 14px; border-bottom:1px solid var(--qa-line); }
.chat-ava { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; background:var(--qa-acid); color:#1b2a10; font-size:9px; font-weight:800; }
.chat-head b { font-size:11px; display:block; }
.chat-head small { font-size:8.5px; color:#6c7b81; }
.chat-live { margin-left:auto; color:var(--qa-acid); font-size:9px; }
.chat-body { padding:12px 14px; display:flex; flex-direction:column; gap:9px; min-height:136px; }
.msg { max-width:84%; padding:8px 10px; border-radius:8px; font-size:9.5px; line-height:1.5; }
.msg.me { align-self:flex-end; background:#1c2b20; border:1px solid #31442f; color:#dce8d8; opacity:0; transform:translateY(6px); transition:opacity .4s ease, transform .4s ease; }
.msg.me.on { opacity:1; transform:none; }
.msg.me b { color:var(--qa-acid); font-size:9px; display:block; margin-bottom:4px; }
.msg.them { align-self:flex-start; background:#141c22; border:1px solid #24323a; color:#c3cfd2; opacity:0; transform:translateY(6px); transition:opacity .4s ease, transform .4s ease; }
.msg.them.on { opacity:1; transform:none; }
.link-chip, .pin-chip { display:flex; align-items:center; gap:6px; font:600 9px ui-monospace,'DM Mono',monospace; color:#bfd4cf; background:#0a1218; border:1px solid #2b3a42; border-radius:5px; padding:6px 8px; margin-top:4px; }
.pin-chip b { color:var(--qa-acid); }
.chat-input { display:flex; align-items:center; gap:8px; padding:9px 12px; border-top:1px solid var(--qa-line); }
.chat-input span { flex:1; font-size:9.5px; color:#5f6e74; }
.send { background:var(--qa-acid); color:#1b2a10; font:800 9.5px system-ui,sans-serif; padding:7px 12px; border-radius:4px; transition:transform .15s; }
.send.pop { transform:scale(1.12); }
/* scene 2: desktop QA overlays */
.pill { position:absolute; right:16px; bottom:16px; display:flex; align-items:center; gap:8px; background:#132a2e; color:var(--qa-acid); font-size:10px; font-weight:600; padding:10px 14px; border-radius:5px; box-shadow:0 6px 20px rgba(0,0,0,.35); transition:transform .2s, box-shadow .2s; }
.bug { width:12px; height:12px; flex:none; }
.ppill .bug { width:9px; height:9px; }
.pill.hot { transform:translateY(-2px); box-shadow:0 10px 26px rgba(201,243,107,.25); }
.pill.pop { transform:scale(1.12); }
.drawer { position:absolute; top:10px; right:10px; bottom:10px; width:300px; background:#0f181e; border:1px solid #2a3941; border-radius:8px; padding:16px 16px 14px; display:flex; flex-direction:column; transform:translateX(calc(100% + 24px)); transition:transform .32s ease; box-shadow:-14px 0 40px rgba(0,0,0,.35); }
.drawer.open { transform:translateX(0); }
.drawer-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px; }
.drawer-head b { font-size:12.5px; color:#e4ecea; display:block; letter-spacing:-.02em; }
.drawer-head small { font-size:8.5px; color:#6c7b81; }
.drawer-head span { color:#6c7b81; font-size:15px; line-height:1; }
.drawer label { display:block; font-size:9px; color:#93a1a5; margin-top:11px; }
.drawer input, .drawer textarea { display:block; width:100%; margin-top:5px; background:#0a1218; border:1px solid #27343d; border-radius:4px; color:#e8efed; font:inherit; font-size:10.5px; padding:8px 9px; outline:none; transition:border-color .2s; }
.drawer input.act, .drawer textarea.act { border-color:var(--qa-acid); box-shadow:0 0 0 1px rgba(201,243,107,.35); }
.drawer textarea { resize:none; height:66px; }
.dSubmit { margin-top:12px; background:var(--qa-acid); color:#1b2a10; font:800 10.5px system-ui,sans-serif; padding:10px 12px; border-radius:4px; transition:transform .15s; }
.dSubmit.pop { transform:scale(1.05); }
.dctx { font-size:8px; color:#5f6e74; line-height:1.5; margin-top:7px; }
.toast { position:absolute; right:16px; bottom:74px; background:#182416; border:1px solid #3d5231; color:#d9e6d5; font-size:10px; padding:11px 14px; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,.4); display:flex; gap:9px; align-items:flex-start; max-width:240px; transform:translateX(calc(100% + 20px)); transition:transform .35s ease; }
.toast.on { transform:translateX(0); }
.toast b { color:var(--qa-acid); display:block; font-size:10px; margin-bottom:2px; }
.toast small { color:#9fb0a4; font-size:9px; line-height:1.5; display:block; }
/* scene 3: mobile QA */
.phone { display:grid; place-items:center; z-index:4; }
.pbody { position:relative; width:206px; height:392px; background:#0a1116; border:2px solid #2a3941; border-radius:28px; padding:8px; box-shadow:0 30px 70px rgba(0,0,0,.55); }
.pstatus { display:flex; justify-content:space-between; align-items:center; height:16px; font:700 7px ui-monospace,'DM Mono',monospace; color:#93a1a5; padding:0 6px; }
.psite { position:relative; height:calc(100% - 16px); background:#f2f1e9; color:#152228; border-radius:18px; overflow:hidden; display:flex; flex-direction:column; }
.pnav { height:30px; flex:none; display:flex; align-items:center; gap:8px; padding:0 12px; font-size:8px; color:#526066; }
.pnav b { font-size:11px; color:#18292c; margin-right:auto; letter-spacing:-.06em; }
.plive { display:flex; align-items:center; gap:4px; font:600 6px ui-monospace,'DM Mono',monospace; color:#3f8f2f; }
.plive i { width:5px; height:5px; border-radius:50%; background:#7ad05a; animation:beat 1.6s infinite; }
.pher { padding:8px; position:relative; flex:1; display:flex; flex-direction:column; gap:7px; min-height:0; }
.pmini { display:flex; gap:6px; flex:1; min-height:0; }
.pcol { flex:1; background:#e9eae2; border-radius:5px; padding:6px; display:flex; flex-direction:column; gap:5px; }
.pcol h4 { font:700 5.5px ui-monospace,'DM Mono',monospace; letter-spacing:.08em; color:#7a8786; margin:0 2px 3px; text-transform:uppercase; }
.pcard { background:#fff; border:1px solid #dde0d4; border-radius:4px; padding:5px 6px; }
.pcard b { display:block; font-size:6px; color:#203337; line-height:1.3; }
.pcard small { display:block; font-size:5px; color:#8a9592; margin-top:2px; }
.pchat { flex:none; background:#f7f6f0; border:1px solid #dde0d4; border-radius:6px; padding:6px 7px; }
.pchat b { font-size:6px; color:#203337; display:block; margin-bottom:3px; }
.pchat .pm { font-size:5.5px; color:#4a585b; background:#fff; border:1px solid #e3e5db; border-radius:4px; padding:3px 5px; margin-bottom:3px; line-height:1.35; }
.pchat .pm.me { background:#dcefd2; color:#2a3b2b; }
.pchat .pnew { display:block; margin-top:4px; background:#c9f36b; color:#23312b; text-align:center; font:800 6px system-ui,sans-serif; padding:4px; border-radius:3px; }
.ppill { position:absolute; right:10px; bottom:10px; background:#132a2e; color:var(--qa-acid); font-size:7.5px; font-weight:600; padding:7px 9px; border-radius:5px; box-shadow:0 5px 14px rgba(0,0,0,.3); transition:transform .15s; z-index:3; }
.ppill.pop { transform:scale(1.12); }
.psheet { position:absolute; left:6px; right:6px; bottom:6px; background:#0f181e; border:1px solid #2a3941; border-radius:12px; padding:10px; transform:translateY(115%); transition:transform .3s ease; z-index:4; }
.psheet.open { transform:translateY(0); }
.psheet-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
.psheet-head b { font-size:9.5px; color:#e4ecea; }
.psheet-head span { color:#6c7b81; font-size:11px; }
.psheet label { display:block; font-size:6.5px; color:#93a1a5; margin-top:7px; }
.psheet input, .psheet textarea { display:block; width:100%; margin-top:3px; background:#0a1218; border:1px solid #27343d; border-radius:4px; color:#e8efed; font:inherit; font-size:8px; padding:6px 7px; outline:none; }
.psheet input.act, .psheet textarea.act { border-color:var(--qa-acid); }
.psheet textarea { height:44px; resize:none; }
.psheet .pctx { font-size:6px; color:#5f6e74; line-height:1.5; margin-top:6px; }
.psubmit { margin-top:9px; width:100%; background:var(--qa-acid); color:#1b2a10; font:800 8.5px system-ui,sans-serif; padding:8px; border-radius:5px; transition:transform .15s; }
.psubmit.pop { transform:scale(1.05); }
.ptoast { position:absolute; left:10px; right:10px; bottom:52px; background:#182416; border:1px solid #3d5231; color:#d9e6d5; font-size:7.5px; padding:8px 10px; border-radius:6px; opacity:0; transform:translateY(8px); transition:opacity .35s ease, transform .35s ease; z-index:5; }
.ptoast.on { opacity:1; transform:none; }
.ptoast b { color:var(--qa-acid); display:block; font-size:8px; margin-bottom:1px; }
.ptoast small { color:#9fb0a4; font-size:7px; }
.cursor { position:absolute; width:26px; height:26px; z-index:7; opacity:0; pointer-events:none; }
.cursor svg { width:100%; height:100%; opacity:.95; }
.cursor.on { opacity:1; }
`;

const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.6 7.6 2 12l1.6 4.4"/><path d="M20.4 7.6l1.6 4.4-1.6 4.4"/><path d="M10 2.8h4"/><path d="M10.8 2.8v6.9a1.8 1.8 0 0 1-.18.83L5.9 19.7a1 1 0 0 0 .9 1.5h10.4a1 1 0 0 0 .9-1.5l-4.72-9.17a1.8 1.8 0 0 1-.18-.83V2.8"/><path d="M7.3 16.2h9.4"/></svg>';

const template = document.createElement("template");
template.innerHTML = `<style>${CSS}</style><div class="stage">
  <div class="win">
    <div class="chrome"><div class="lights"><i></i><i></i><i></i></div><div class="addr">◆&nbsp; edgeqa.local <span id="addr">/sandbox/…</span></div><div class="live"><i></i>&nbsp;LIVE</div></div>
    <div class="body">
      <div class="site">
        <div class="sitebar"><b>✦ Northstar</b><span class="ws">Acme Studio / <b>Website Redesign</b></span><button class="invite">＋ Invite</button><button class="newtask">＋ New task</button></div>
        <div class="workspace"><div class="snap" id="snap"></div><div class="errbanner" id="eBanner">⚠ Task creation failed — <b>server 500</b></div>
          <div class="wrow">
            <div class="mnav"><div class="sect">WORKSPACE</div><div class="mitem on">◐ Board</div><div class="mitem">➤ Chat</div><div class="sect">TEAM</div><div class="mitem"><span class="mava">JD</span>Jade</div><div class="mitem"><span class="mava">AB</span>Alex</div></div>
            <div class="board">
              <div class="col"><h4>To do <i>3</i></h4><div class="card"><span class="who">AB</span><b>Write pricing copy</b><small>Due Fri</small><span class="tag">Copy</span></div><div class="card"><span class="who">SP</span><b>Collect testimonials</b><small>Needs 3 more</small></div></div>
              <div class="col"><h4>In progress <i>2</i></h4><div class="card"><span class="who">JD</span><b>Build hero section</b><small>60% · blocked</small><span class="tag">Design</span></div><div class="card"><span class="who">AB</span><b>Checkout flow impl</b><small>In review</small></div></div>
              <div class="col"><h4>Done <i>2</i></h4><div class="card"><b>Set up analytics</b><small>Shipped Tue</small></div><div class="card"><b>Navigation IA</b><small>Approved</small></div></div>
            </div>
            <div class="chatpane">
              <div class="chead"><b># redesign</b><small>3 online</small><span class="live">● LIVE</span></div>
              <div class="cmsgs"><div class="cmsg them"><b>Alex</b>Hero copy is in — pushing now.</div><div class="cmsg me"><b>You</b>Great, I'll review.</div><div class="cmsg them"><b>Jade</b>New task button still errors for me 😕</div></div>
              <div class="cin"><span>Message #redesign…</span><button>Send</button></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="desk" id="desk">
    <div class="pill" id="pill"><svg class="bug" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg><span>Report a bug</span></div>
    <aside class="drawer" id="drawer">
      <div class="drawer-head"><div><b>Report a bug</b><small id="dRepo">acme/marketing-site · main</small></div><span>×</span></div>
      <label>Short title<input id="dTitle" placeholder="e.g. Broken nav on mobile" autocomplete="off"></label>
      <label>What happened?<textarea id="dBody" placeholder="Describe the bug and what you expected instead…"></textarea></label>
      <small class="dctx">Auto-attached: repo · branch · page · screensize<br>device/browser · time · console log</small>
      <button class="dSubmit" id="dSubmit">Create GitHub issue →</button>
    </aside>
    <div class="toast" id="toast"><div><b>✓ Bug filed to GitHub Issues</b><small id="toastMsg">acme/marketing-site · issue opened</small></div></div>
  </div>

  <div class="chat" id="chat">
    <div class="chat-card">
      <div class="chat-head"><div class="chat-ava">JD</div><div><b>QA channel</b><small>JD → Sam · just now</small></div><span class="chat-live">●</span></div>
      <div class="chat-body">
        <div class="msg me" id="msgLink"><b>QA link ready 🔗</b>Here's your secure preview — enter the PIN to unlock it.<div class="link-chip">🔗&nbsp; edgeqa.local<span id="chatRepo">/sandbox/acme/marketing-site</span></div><div class="pin-chip">🔑 PIN:&nbsp;<b>4521</b></div></div>
        <div class="msg them" id="msgReply">Got it — testing now 👍</div>
      </div>
      <div class="chat-input"><span>Send QA link + PIN…</span><button class="send" id="send">Send →</button></div>
    </div>
  </div>

  <div class="phone" id="phone">
    <div class="pbody">
      <div class="pstatus"><span>9:41</span><span>◉ ▮ ▯▯ ▯▯</span></div>
      <div class="psite">
        <div class="pnav"><b>Northstar</b><span class="plive"><i></i>LIVE</span></div>
        <div class="pher">
          <div class="pmini">
            <div class="pcol"><h4>To do</h4><div class="pcard"><b>Write pricing copy</b><small>Due Fri</small></div><div class="pcard"><b>Collect testimonials</b><small>Needs 3</small></div></div>
            <div class="pcol"><h4>Doing</h4><div class="pcard"><b>Build hero section</b><small>60% blocked</small></div><div class="pcard"><b>Checkout flow</b><small>In review</small></div></div>
          </div>
          <div class="pchat"><b># redesign</b><div class="pm them">New task button still errors for me 😕</div><div class="pnew">＋ New task</div></div>
        </div>
        <div class="ppill" id="p3Pill"><svg class="bug" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg> Report</div>
        <aside class="psheet" id="p3Sheet">
          <div class="psheet-head"><b>Report a bug</b><span>×</span></div>
          <label>Short title<input id="p3Title" placeholder="e.g. Checkout broken" autocomplete="off"></label>
          <label>What happened?<textarea id="p3Body" placeholder="Describe the bug…"></textarea></label>
          <small class="pctx">Auto-attached: repo · page · screensize · device · time</small>
          <button class="psubmit" id="p3Submit">Create issue →</button>
        </aside>
        <div class="ptoast" id="p3Toast"><b>✓ Bug filed to GitHub Issues</b><small>path · viewport · UA attached</small></div>
      </div>
    </div>
  </div>

  <span class="legend" id="legend">● QA LINK + PIN SHARED</span>
  <slot name="media"></slot>
  <div class="cursor" id="cursor"><svg viewBox="0 0 24 24" fill="none" stroke="#cff36b" stroke-width="2"><path d="M5 3l5 14 2.5-5.5L18 9z"/></svg></div>
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
    this.shadowRoot.querySelector("#dRepo").textContent = `${owner}/${repo} · ${branch}`;
    this.shadowRoot.querySelector("#toastMsg").textContent = `${owner}/${repo} · issue opened`;
    this.shadowRoot.querySelector("#chatRepo").textContent = `/sandbox/${owner}/${repo}`;
  }

  #frame = 0;
  #ts = 0;
  #seg = null;
  #from = { x: 950, y: 520 };
  #pos = { x: 950, y: 520 };

  play() {
    const $ = (s) => this.shadowRoot.querySelector(s);
    const type = (el, txt, a, b) => { el.value = txt.slice(0, Math.max(0, Math.min(txt.length, Math.floor(((t - a) / (b - a)) * txt.length)))); };
    let t = 0;
    const tick = (now) => {
      if (!this.#ts) this.#ts = now;
      t = (now - this.#ts) % CYCLE;
      const cursor = $("#cursor");
      const stage = $(".stage");

      // scenes: 1 = share link, 2 = desktop QA, 3 = mobile QA
      const s1 = t < 5200;
      const s2 = t >= 6000 && t < 13600;
      const s3 = t >= 14800 && t < 21600;
      $("#chat").classList.toggle("on", s1);
      $("#desk").classList.toggle("on", s2);
      $("#phone").classList.toggle("on", s3);
      $(".win").classList.toggle("dim", s1 || s3);
      $("#legend").textContent = s1 ? "● QA LINK + PIN SHARED" : s2 ? "● LIVE SANDBOX · desktop" : s3 ? "● MOBILE QA · 390px viewport" : "● edgeqa";

      // scene 1: share link + PIN
      $("#msgLink").classList.toggle("on", t >= 2100);
      $("#msgReply").classList.toggle("on", t >= 3300);
      $("#send").classList.toggle("pop", t >= 1800 && t < 2100);

      // scene 2: desktop QA
      $("#pill").classList.toggle("hot", t >= 6900 && t < 7300);
      $("#pill").classList.toggle("pop", t >= 7400 && t < 7600);
      $("#drawer").classList.toggle("open", t >= 7400 && t < 12800);
      $("#dSubmit").classList.toggle("pop", t >= 12400 && t < 12600);
      $("#snap").style.borderColor = t >= 7400 && t < 13200 ? "rgba(201,243,107,.4)" : "transparent";
      $("#eBanner").classList.toggle("on", t >= 6500 && t < 12800);
      if (t >= 8600 && t < 9900) type($("#dTitle"), TITLE, 8600, 9900);
      if (t >= 10500 && t < 12000) type($("#dBody"), BODY, 10500, 12000);
      if (t < 7400) { $("#dTitle").value = ""; $("#dBody").value = ""; }
      $("#dTitle").classList.toggle("act", t >= 8600 && t < 9900);
      $("#dBody").classList.toggle("act", t >= 10500 && t < 12000);
      $("#toast").classList.toggle("on", t >= 13000 && t < 13600);

      // scene 3: mobile QA
      $("#p3Pill").classList.toggle("pop", t >= 15600 && t < 16000);
      $("#p3Sheet").classList.toggle("open", t >= 15600 && t < 21100);
      $("#p3Submit").classList.toggle("pop", t >= 20700 && t < 20900);
      if (t >= 16800 && t < 18400) type($("#p3Title"), TITLE2, 16800, 18400);
      if (t >= 18900 && t < 20500) type($("#p3Body"), BODY2, 18900, 20500);
      if (t < 15600) { $("#p3Title").value = ""; $("#p3Body").value = ""; }
      $("#p3Title").classList.toggle("act", t >= 16800 && t < 18400);
      $("#p3Body").classList.toggle("act", t >= 18900 && t < 20500);
      $("#p3Toast").classList.toggle("on", t >= 21200 && t < 21600);

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
      cursor.classList.toggle("on", (t >= 800 && t < 5200) || (t >= 6000 && t < 13600) || (t >= 14800 && t < 21000));

      void cursor.offsetWidth; // keep transitions/rAF flowing even when headless
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.#frame);
    const s = this.shadowRoot;
    ["#toast", "#drawer", "#chat", "#desk", "#phone", "#msgLink", "#msgReply", "#p3Toast", "#p3Sheet"].forEach((sel) => s.querySelector(sel)?.classList.remove("on", "open"));
  }
}

if (!customElements.get("edgeqa-demo")) customElements.define("edgeqa-demo", EdgeQaDemo);
