/* Pitchside Forum: Site admin rating. A part of the Safety Index set by the site admins (0 to 10 per casino or
   sportsbook), shown as "Site admin rating" in every score breakdown and on the "How we rate" page.
   Admins set it in Admin → Reviews. Casinos without one count as 5 out of 10. Server side: app/ops/zz-adminrating.php. */
(function () {
  if (typeof safety !== "function" || typeof SAFETY_W === "undefined" || typeof OPERATORS === "undefined") return;
  const LABEL = "Site admin rating";
  try { SAFETY_LABELS.admin = LABEL; } catch (e) {}
  const part = o => (o && o.adminScore != null && o.adminScore !== "" && isFinite(+o.adminScore)) ? Math.max(0, Math.min(10, +o.adminScore)) * 10 : 50;

  // The Safety Index with the admin part added
  const baseSafety = safety;
  safety = function (o) {
    const W = SAFETY_W;
    if (!W || W.admin == null) return baseSafety.apply(this, arguments);
    const rest = Object.assign({}, W); delete rest.admin;
    let r;
    try { SAFETY_W = rest; r = baseSafety.apply(this, arguments); } finally { SAFETY_W = W; }
    const parts = Object.assign({}, r.parts, {admin: part(o)});
    const wsum = Object.values(W).reduce((a, b) => a + (+b || 0), 0) || 1;
    const score = Math.round(Object.keys(W).reduce((n, k) => n + (parts[k] || 0) * (+W[k] || 0), 0) / wsum) / 10;
    const good = r.good.slice(), bad = r.bad.slice();
    if (o && o.adminScore != null && o.adminScore !== "") (+o.adminScore >= 7 ? good : +o.adminScore < 5 ? bad : good).push(`${LABEL}: ${(+o.adminScore).toFixed(1)} out of 10`);
    return Object.assign({}, r, {score, parts, label: safetyLabel(score), tone: score >= 8 ? "good" : score >= 5 ? "mid" : "bad", good, bad});
  };

  // "How we rate": describe the admin part
  if (typeof vSafetyPage === "function") {
    const basePage = vSafetyPage;
    vSafetyPage = function () {
      const out = basePage.apply(this, arguments);
      return typeof out === "string" ? out.replace(">undefined</p>", ">Pitchside's own rating of the operator, set by the site admins from their experience with it. Operators the admins haven't rated count as 5 out of 10.</p>") : out;
    };
  }

  // Admin → Reviews: set each operator's admin rating
  let filter = "";
  function panel() {
    const list = OPERATORS.slice().sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.name.localeCompare(b.name))
      .filter(o => !filter || o.name.toLowerCase().includes(filter));
    const shown = list.slice(0, 60);
    return `<section class="panel" id="adminRating" style="margin-bottom:16px"><h3 class="ph">${LABEL}</h3>
      <p class="muted" style="margin-top:0">Your own score for each casino or sportsbook, from 0 to 10. It counts ${SAFETY_W.admin != null ? `<strong>${SAFETY_W.admin}%</strong>` : "0% (add it in the weights above)"} of the Safety Index and shows as &ldquo;${LABEL}&rdquo; in every score breakdown. Not rated counts as 5.</p>
      <input class="inp" type="search" id="arFilter" placeholder="Find a casino or sportsbook…" value="${esc(filter)}" style="max-width:320px;margin-bottom:8px" data-change="arFilter">
      <div class="ar-list">${shown.map(o => `<div class="ar-row"><strong>${esc(o.name)}</strong><span class="muted">Safety Index ${safety(o).score.toFixed(1)}</span>
        <span class="row" style="gap:6px;margin-left:auto"><input class="inp" type="number" min="0" max="10" step="0.5" id="ar-${esc(o.slug)}" value="${o.adminScore != null ? esc(String(o.adminScore)) : ""}" placeholder="Not rated" style="width:110px" aria-label="${esc(o.name)} ${LABEL}">
        <button class="btn small primary" type="button" data-act="arSave" data-slug="${esc(o.slug)}">Save</button></span></div>`).join("")}</div>
      ${list.length > shown.length ? `<p class="muted" style="margin:8px 0 0">${list.length - shown.length} more. Type a name above to find one.</p>` : ""}</section>`;
  }
  if (typeof vAdmin === "function") {
    const baseAdmin = vAdmin;
    vAdmin = function (tab) {
      const out = baseAdmin.apply(this, arguments);
      if (tab !== "reviews" || typeof out !== "string" || !(typeof isAdmin === "function" ? isAdmin() : can("manageCategories"))) return out;
      const f = out.indexOf('data-form="safetyWeights"'); const end = f >= 0 ? out.indexOf("</form>", f) : -1;
      return end >= 0 ? out.slice(0, end + 7) + panel() + out.slice(end + 7) : out + panel();
    };
  }
  if (typeof CHANGE === "object") CHANGE.arFilter = el => { filter = el.value.trim().toLowerCase(); render(); setTimeout(() => { const i = document.getElementById("arFilter"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); };
  ACT.arSave = el => {
    const slug = el.dataset.slug, o = OPERATORS.find(x => x.slug === slug); if (!o) return;
    const v = (document.getElementById("ar-" + slug) || {}).value;
    api("opscore.set", {slug, score: v === "" ? null : v}).then(r => {
      if (r.score == null) delete o.adminScore; else o.adminScore = r.score;
      toast(r.score == null ? `${o.name}: admin rating cleared.` : `${o.name}: admin rating ${r.score}/10. Safety Index now ${safety(o).score.toFixed(1)}.`); render();
    }).catch(e => toast(e.message));
  };
  const st = document.createElement("style");
  st.textContent = `.ar-row{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
