/* Pitchside Forum: penalty points. Admins take points straight off a casino's Safety Index, with a reason shown to
   visitors under "What lowers it". Set in Admin → Reviews → Penalty points. Server side: app/ops/zz-penalty.php. */
(function () {
  if (typeof safety !== "function" || typeof OPERATORS === "undefined") return;
  const pts = o => (o && o.penalty != null && isFinite(+o.penalty)) ? Math.max(0, Math.min(10, +o.penalty)) : 0;

  const base = safety;
  safety = function (o) {
    const r = base.apply(this, arguments), p = pts(o);
    if (!r || !p || !isFinite(r.score)) return r;
    const score = Math.max(0, Math.round((r.score - p) * 10) / 10);
    const bad = (r.bad || []).slice(); bad.unshift(`Pitchside penalty, −${p.toFixed(1)}: ${o.penaltyReason || "concerns raised by our research"}`);
    return Object.assign({}, r, {score, bad, label: typeof safetyLabel === "function" ? safetyLabel(score) : r.label, tone: score >= 8 ? "good" : score >= 5 ? "mid" : "bad"});
  };

  // Admin → Reviews: penalty points panel
  let filter = "";
  function panel() {
    const list = OPERATORS.slice().sort((a, b) => pts(b) - pts(a) || a.name.localeCompare(b.name)).filter(o => !filter || o.name.toLowerCase().includes(filter));
    const shown = list.slice(0, 60);
    return `<section class="panel" id="penaltyPoints" style="margin-bottom:16px"><h3 class="ph">Penalty points</h3>
      <p class="muted" style="margin-top:0">Take points straight off a casino's Safety Index, from 0.5 to 10. Visitors see your reason under &ldquo;What lowers it&rdquo; on its page. Set to 0 or empty to remove the penalty.</p>
      <input class="inp" type="search" id="pnFilter" placeholder="Find a casino or sportsbook…" value="${esc(filter)}" style="max-width:320px;margin-bottom:8px" data-change="pnFilter">
      <div>${shown.map(o => `<div class="pn-row"><strong>${esc(o.name)}</strong><span class="muted">Safety Index ${safety(o).score.toFixed(1)}</span>
        <span class="row" style="gap:6px;margin-left:auto;flex-wrap:wrap"><input class="inp" type="number" min="0" max="10" step="0.5" id="pn-${esc(o.slug)}" value="${pts(o) ? esc(String(pts(o))) : ""}" placeholder="Points" style="width:90px" aria-label="${esc(o.name)} penalty points">
        <input class="inp" type="text" maxlength="160" id="pnr-${esc(o.slug)}" value="${esc(o.penaltyReason || "")}" placeholder="Reason, e.g. players report long withdrawal delays" style="width:300px" aria-label="${esc(o.name)} penalty reason">
        <button class="btn small primary" type="button" data-act="pnSave" data-slug="${esc(o.slug)}">Save</button></span></div>`).join("")}</div>
      ${list.length > shown.length ? `<p class="muted" style="margin:8px 0 0">${list.length - shown.length} more. Type a name above to find one.</p>` : ""}</section>`;
  }
  if (typeof vAdmin === "function") {
    const baseAdmin = vAdmin;
    vAdmin = function (tab) {
      const out = baseAdmin.apply(this, arguments);
      if (tab !== "reviews" || typeof out !== "string" || !(typeof isAdmin === "function" ? isAdmin() : can("manageCategories"))) return out;
      const i = out.indexOf('<section class="panel" id="adminRating"');
      return i >= 0 ? out.slice(0, i) + panel() + out.slice(i) : out + panel();
    };
  }
  if (typeof CHANGE === "object") CHANGE.pnFilter = el => { filter = el.value.trim().toLowerCase(); render(); setTimeout(() => { const i = document.getElementById("pnFilter"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); };
  ACT.pnSave = el => {
    const slug = el.dataset.slug, o = OPERATORS.find(x => x.slug === slug); if (!o) return;
    const v = (document.getElementById("pn-" + slug) || {}).value, why = (document.getElementById("pnr-" + slug) || {}).value || "";
    api("oppenalty.set", {slug, points: v, reason: why}).then(r => {
      if (!r.points) { delete o.penalty; delete o.penaltyReason; } else { o.penalty = r.points; o.penaltyReason = r.reason; }
      toast(r.points ? `${o.name}: −${r.points} penalty. Safety Index now ${safety(o).score.toFixed(1)}.` : `${o.name}: penalty removed. Safety Index ${safety(o).score.toFixed(1)}.`); render();
    }).catch(e => toast(e.message));
  };
  const st = document.createElement("style");
  st.textContent = `.pn-row{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
