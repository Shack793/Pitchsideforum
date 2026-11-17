/* Pitchside Forum: Bug Reports statuses. Shows each report's status as a coloured label in topic lists and on the
   topic, and gives staff a "Change status" button. Server side: app/ops/zz-bugs.php. It only wraps app functions. */
(function () {
  if (typeof vTopic !== "function" || typeof topicRow !== "function") return;
  const BOARD = "bug-reports";
  const ST = {"bug-new": ["New", "blue", "Reported, not looked at yet"], "bug-investigating": ["Investigating", "amber", "Staff are looking into it"],
    "bug-confirmed": ["Confirmed", "red", "We can reproduce it; a fix is on the way"], "bug-fixed": ["Fixed", "bug-good", "Fixed on the live site"],
    "bug-closed": ["Closed", "", "Closed: duplicate, not a bug, or no reply"]};
  const ORDER = Object.keys(ST);
  const statusOf = t => (t && t.tags || []).find(x => ST[x]) || null;
  const pill = s => `<span class="pill ${ST[s][1]} bug-pill" title="${esc(ST[s][2])}">${esc(ST[s][0])}</span>`;
  // the status tag link (#New…) becomes a status label
  const swap = html => typeof html === "string" ? html.replace(/<a href="[^"]*" data-go="\/tag\/(bug-[a-z]+)"[^>]*>#[^<]*<\/a>/g, (m, s) => ST[s] ? pill(s) : m) : html;
  const canSet = () => typeof can === "function" && (can("manageCategories") || (typeof isStaff === "function" && isStaff() && canModBoard(BOARD)));

  const baseRow = topicRow;
  topicRow = function (t) { return swap(baseRow.apply(this, arguments)); };

  function bar(t) {
    const s = statusOf(t) || "bug-new";
    const steps = ORDER.filter(x => x !== "bug-closed").map(x => `<span class="bug-step${x === s ? " bug-now" : ORDER.indexOf(x) < ORDER.indexOf(s) && s !== "bug-closed" ? " bug-done" : ""}">${esc(ST[x][0])}</span>`).join(`<span class="bug-arrow" aria-hidden="true">›</span>`);
    return `<div class="panel bug-bar" role="status"><div class="bug-bar-l"><span class="muted">Bug report status</span> ${pill(s)} <span class="muted bug-desc">${esc(ST[s][2])}</span></div>
      <div class="bug-steps" aria-hidden="true">${steps}</div>${canSet() ? `<button type="button" class="btn small" data-act="bugStatus" data-id="${t.id}">Change status</button>` : ""}</div>`;
  }
  function afterHead(html, n) {
    const start = html.indexOf('<div class="phead">'); if (start < 0) return n + html;
    let depth = 0, i = start; const re = /<div\b|<\/div>/g; re.lastIndex = start; let m;
    while ((m = re.exec(html))) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { i = re.lastIndex; break; } }
    return html.slice(0, i) + n + html.slice(i);
  }
  const baseTopic = vTopic;
  vTopic = function (id) {
    let out = swap(baseTopic.apply(this, arguments));
    const t = topic(id);
    if (t && t.board === BOARD && !(t.pinned && !statusOf(t))) out = afterHead(out, bar(t));
    return out;
  };
  if (typeof vBoard === "function") {
    const baseBoard = vBoard;
    vBoard = function (slug) {
      let out = baseBoard.apply(this, arguments);
      if (slug !== BOARD || typeof out !== "string") return out;
      // status filter buttons read "New", "Fixed"… instead of "#New"
      return out.replace(/(data-tag="(bug-[a-z]+)"[^>]*>)#([^<]*)</g, (m, a, s, n) => ST[s] ? `${a}${esc(ST[s][0])}<` : m);
    };
  }

  ACT.bugStatus = el => {
    const t = topic(el.dataset.id); if (!t) return;
    const cur = statusOf(t) || "bug-new";
    modal({title: "Change bug status", submit: "Save",
      body: `<p style="margin-top:0">“${esc(t.title)}” by ${esc(t.author)}</p>
        <fieldset class="bug-pick"><legend class="lbl">Status</legend>${ORDER.map(s => `<label class="chk"><input type="radio" name="st" value="${s}"${s === cur ? " checked" : ""}> ${pill(s)} <span class="muted">${esc(ST[s][2])}</span></label>`).join("")}</fieldset>
        <label>Note for the reporter (optional, posted in the topic)<textarea class="inp" name="note" rows="3" maxlength="3000" placeholder="e.g. Fixed in today's update. Thanks for the clear steps!"></textarea></label>
        <p class="muted" style="margin:0;font-size:.85rem">${esc(t.author)} gets a notification when the status changes.</p>`,
      onSubmit: f => {
        const st = (f.querySelector('input[name="st"]:checked') || {}).value, note = f.elements.note.value.trim();
        if (!st) return "Pick a status.";
        if (st === cur && !note) return null;
        return api("bug.status", {id: t.id, status: st, note}).then(() => { toast(`Status set to ${ST[st][0]}.`); return null; });
      }});
  };

  const css = document.createElement("style");
  css.textContent = `label.chk:has(input[name^="tag_bug-"]){display:none!important}
.bug-pill{white-space:nowrap}.pill.bug-good{background:var(--good-soft);color:var(--good)}.bug-bar{display:flex;align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;padding:12px 14px;margin:0 0 14px}
.bug-bar-l{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.bug-desc{font-size:.88rem}.bug-steps{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:.82rem;color:var(--muted)}
.bug-step{padding:2px 8px;border-radius:999px;border:1px solid var(--line)}.bug-done{color:var(--fg)}.bug-now{color:var(--fg);font-weight:700;border-color:var(--turf)}
.bug-pick{border:0;padding:0;margin:0 0 10px;display:flex;flex-direction:column;gap:8px}.bug-pick .chk{display:flex;align-items:center;gap:8px;flex-direction:row}
@media (max-width:560px){.bug-steps{display:none}}`;
  document.head.appendChild(css);
  try { render(); } catch (e) {}
})();
