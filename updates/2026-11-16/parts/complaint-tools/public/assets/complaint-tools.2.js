/* Pitchside Forum: complaint tools (server side: app/ops/zz-complaint-tools.php).
   - A countdown on every open case showing who has to respond and how long they have left (or how overdue they are).
   - Specialists: "Set a timer" (casino, player or Pitchside; hours to months), "Hide sensitive text" (hides it
     everywhere in the case and its discussion) and "Hide" on any message.
   - Files a player makes public wait for a specialist to approve them.
   - Specialists: "Reject complaint" on any open case, with a reason shown in the case (v2). */
(function () {
  if (typeof vComplaint !== "function" || typeof COMPLAINTS === "undefined") return;

  const who = c => c.status === "Awaiting Business" ? "casino" : c.status === "Awaiting User" ? "player" : "pitchside";
  function left(ms) {
    const neg = ms < 0; ms = Math.abs(ms);
    const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
    const t = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
    return neg ? `overdue by ${t}` : `${t} left`;
  }
  function timerBox(c) {
    if (!OPEN_STATUSES.includes(c.status) || !c.deadline) return "";
    const o = op(c.op), w = who(c), ms = c.deadline - Date.now(), late = ms < 0;
    const name = w === "casino" ? esc(o.name) : w === "player" ? esc(c.user) : "Pitchside";
    const what = w === "casino" ? `${name} has until ${dday(c.deadline)} to respond.` + (late ? " A specialist will decide the case." : " If they don't, a specialist decides the case and their Safety Index can drop.")
      : w === "player" ? `${name} has until ${dday(c.deadline)} to reply to the specialist.`
      : `Pitchside will respond by ${dday(c.deadline)}.`;
    return `<div class="notice ${late ? "red" : "amber"} ct-timer" style="margin-bottom:12px;align-items:center"><span class="ct-clock" data-until="${c.deadline}">⏱ ${left(ms)}</span><span><strong>Waiting for ${name}.</strong> ${what}</span></div>`;
  }

  // pending public files, per case (only the player and specialists are told)
  const pend = {}, asked = {};
  function loadPending(c) {
    const key = c.id + ":" + c.evidence.length + ":" + c.messages.length;
    if (asked[c.id] === key) return; asked[c.id] = key;
    api("complaint.evPending", {id: c.id}).then(r => { const before = JSON.stringify(pend[c.id] || []); pend[c.id] = r.pending || [];
      if (JSON.stringify(pend[c.id]) !== before) render(); }).catch(() => {});
  }
  function evidenceBox(c, mine, spec, open) {
    const p = pend[c.id] || [];
    const rows = c.evidence.map((e, i) => {
      const see = e.public || mine || spec; if (!see) return "";
      const waiting = p.includes(i);
      const pill = e.public ? '<span class="pill green">Public</span>' : waiting ? '<span class="pill amber">Waiting for approval</span>' : '<span class="pill">Private</span>';
      const btns = (spec && waiting ? `<button class="btn small primary" type="button" data-act="ctApprove" data-id="${c.id}" data-i="${i}" data-ok="1">Approve</button><button class="btn small ghost" type="button" data-act="ctApprove" data-id="${c.id}" data-i="${i}" data-ok="">Keep private</button>` : "")
        + ((mine || spec) && !(spec && waiting && !mine) ? `<button class="btn small ghost" type="button" data-act="toggleEvidence" data-id="${c.id}" data-i="${i}">${waiting ? "Cancel request" : e.public ? "Make private" : mine && !spec ? "Ask to make public" : "Make public"}</button>` : "");
      return `<div class="spread" style="padding:6px 0;border-top:1px solid var(--line);flex-wrap:wrap;gap:6px"><span class="mono" style="font-size:.85rem;overflow-wrap:anywhere">📎 ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.name)}</a>` : esc(e.name)}</span><span class="row" style="gap:6px;flex-wrap:wrap">${pill}${btns}</span></div>`;
    }).join("") || '<p class="muted" style="margin:0;font-size:.9rem">No evidence uploaded.</p>';
    const hidden = c.evidence.filter(e => !(e.public || mine || spec)).length;
    return `<section class="panel"><h3 class="ph">Evidence ${mine && open ? `<button class="btn small" type="button" data-act="addEvidence" data-id="${c.id}">Add</button>` : ""}</h3>${rows}
      ${hidden ? `<p class="muted" style="font-size:.85rem;margin:8px 0 0">${hidden} private file(s) visible only to the player and specialists.</p>` : ""}
      ${mine ? '<p class="muted" style="font-size:.82rem;margin:8px 0 0">Files you make public are checked by Pitchside before anyone else can see them.</p>' : ""}</section>`;
  }

  const base = vComplaint;
  vComplaint = function (id, qs = {}) {
    let out = base.apply(this, arguments);
    const c = COMPLAINTS.find(x => x.id === id);
    if (typeof out !== "string" || !c) return out;
    const mine = c.user === S.user, spec = mp("complaint.manage"), open = OPEN_STATUSES.includes(c.status);
    // 1. timer: replace the old operator-only notice with a countdown for whoever has to respond
    out = out.replace(/<div class="notice amber" style="margin-bottom:12px"><strong>Waiting for [\s\S]*?<\/div>\s*(?=<nav class="subnav")/, "");
    out = out.replace(/(<ol class="stepper">[\s\S]*?<\/ol>)/, m => m + timerBox(c));
    // 2. evidence with approval
    if (mine || spec) {
      loadPending(c);
      const s = out.indexOf('<section class="panel"><h3 class="ph">Evidence');
      const e = s >= 0 ? out.indexOf("</section>", s) : -1;
      if (e > 0) out = out.slice(0, s) + evidenceBox(c, mine, spec, open) + out.slice(e + 10);
    }
    // 3. specialist tools
    if (spec) {
      const tools = `<div class="stack" style="gap:6px;margin:0 0 10px">${open ? `<button class="btn small" type="button" data-act="ctTimer" data-id="${c.id}">⏱ Set a timer…</button>` : ""}
        <button class="btn small" type="button" data-act="ctHideText" data-id="${c.id}">Hide sensitive text…</button>
        ${open ? `<button class="btn small danger" type="button" data-act="ctReject" data-id="${c.id}">Reject complaint…</button>` : ""}</div>`;
      out = out.replace('<h3 class="ph">Specialist tools</h3>', '<h3 class="ph">Specialist tools</h3>' + tools);
      // a Hide button on each message from the player, the casino or a specialist (case thread only)
      if ((qs.tab || "case") !== "discussion") {
        const idx = c.messages.map((m, i) => m.role === "system" ? -1 : i).filter(i => i >= 0); let k = 0;
        out = out.replace(/<article class="post"><aside>([\s\S]*?)<\/aside><div class="pb"><div class="meta"><span>/g, (all, aside) => {
          const i = idx[k++]; if (i === undefined) return all;
          return `<article class="post"><aside>${aside}</aside><div class="pb"><div class="meta"><button class="btn small ghost" type="button" data-act="ctHideMsg" data-id="${c.id}" data-i="${i}" style="float:right">Hide</button><span>`;
        });
      }
    }
    return out;
  };

  // live countdown
  setInterval(() => document.querySelectorAll(".ct-clock").forEach(el => { el.textContent = "⏱ " + left(+el.dataset.until - Date.now()); }), 30000);

  ACT.ctTimer = el => {
    const c = COMPLAINTS.find(x => x.id === el.dataset.id); if (!c) return;
    const o = op(c.op), cur = who(c);
    modal({title: "Set a timer", submit: "Start timer", body: `
      <label>Who has to respond?<select name="who">
        <option value="casino"${cur === "casino" ? " selected" : ""}>${esc(o.name)} (the casino)</option>
        <option value="player"${cur === "player" ? " selected" : ""}>${esc(c.user)} (the player)</option>
        <option value="pitchside"${cur === "pitchside" ? " selected" : ""}>Pitchside (us)</option>
        <option value="none">No timer (stop the current one)</option></select></label>
      <div class="row" style="gap:8px"><label style="flex:1">How long<input name="n" type="number" min="1" max="999" value="3"></label>
        <label style="flex:1">&nbsp;<select name="unit"><option value="hours">hours</option><option value="days" selected>days</option><option value="weeks">weeks</option><option value="months">months</option></select></label></div>
      <label>Message to both parties <span class="hint">Optional, public</span><textarea name="note" style="min-height:70px" placeholder="What you need from them"></textarea></label>
      <p class="hint" style="margin:0">Everyone sees the countdown on the case. The timer stops when that side replies.</p>`,
      onSubmit: f => viaApi("complaint.timer", {id: c.id, who: f.elements.who.value, n: +f.elements.n.value || 0, unit: f.elements.unit.value, note: f.elements.note.value.trim()}, () => { toast("Timer set"); }) });
  };
  ACT.ctHideText = el => {
    const c = COMPLAINTS.find(x => x.id === el.dataset.id); if (!c) return;
    modal({title: "Hide sensitive text", submit: "Hide it", danger: true, body: `
      <label>Text to hide <span class="hint">Copy it exactly, e.g. an email address, account number or full name</span><input name="t" maxlength="500" required></label>
      <p class="hint" style="margin:0">It's replaced with “[hidden by Pitchside]” everywhere in this case: the complaint, its title, every message from the player and the casino, and the community discussion. The original text is removed for good.</p>`,
      onSubmit: f => viaApi("complaint.hideText", {id: c.id, text: f.elements.t.value}, r => { toast(`Hidden in ${r.hits} place${r.hits > 1 ? "s" : ""}`); }) });
  };
  ACT.ctReject = el => {
    const c = COMPLAINTS.find(x => x.id === el.dataset.id); if (!c) return;
    modal({title: "Reject this complaint?", submit: "Reject complaint", danger: true, body: `
      <label>Reason <span class="hint">Shown in the case, so the player knows why</span><textarea name="why" required style="min-height:90px" placeholder="e.g. The player broke the casino's bonus terms, so the casino was entitled to void the winnings."></textarea></label>
      <p class="hint" style="margin:0">The case closes as “Rejected”. Rejected complaints don't count against ${esc(op(c.op).name)}'s Safety Index. The player is notified.</p>`,
      onSubmit: f => { const why = f.elements.why.value.trim(); if (why.length < 10) return "Give the player a short reason (at least 10 characters).";
        return viaApi("complaint.outcome", {id: c.id, st: "Rejected", rec: 0, note: "Complaint rejected: " + why, reason: why}, () => { toast("Complaint rejected"); }); } });
  };
  ACT.ctHideMsg = el => {
    modal({title: "Hide this message?", submit: "Hide message", danger: true, body: `<p style="margin:0">The whole message is replaced with “[Message hidden by Pitchside]” for everyone. The original text is removed for good. To hide just part of it, use “Hide sensitive text” instead.</p>`,
      onSubmit: () => viaApi("complaint.hideMsg", {id: el.dataset.id, i: +el.dataset.i}, () => { toast("Message hidden"); }) });
  };
  ACT.ctApprove = el => act("complaint.evApprove", {id: el.dataset.id, i: +el.dataset.i, ok: !!el.dataset.ok}, el.dataset.ok ? "File approved and now public" : "File kept private", () => { delete asked[el.dataset.id]; render(); });
  const baseToggle = ACT.toggleEvidence;
  ACT.toggleEvidence = el => api("complaint.evidenceToggle", {id: el.dataset.id, i: +el.dataset.i}).then(() => { delete asked[el.dataset.id]; render(); }).catch(e => toast(e.message));

  const st = document.createElement("style");
  st.textContent = `.ct-clock{font-weight:700;white-space:nowrap;margin-right:6px}.notice.red{background:color-mix(in srgb,var(--danger,#d33) 12%,transparent);border-color:var(--danger,#d33)}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
