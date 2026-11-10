/* Pitchside Forum: Top picks v2. A neat row of compact tiles at the top of the Casinos & Sportsbooks page, in the
   order set in Admin → Top picks. A small "About featured listings" link opens the disclosure page. It only wraps app functions. */
(function () {
  if (typeof vHub !== "function" || typeof OPERATORS === "undefined") return;
  const picks = () => ((typeof LAYOUT === "object" && LAYOUT && Array.isArray(LAYOUT.topPicks)) ? LAYOUT.topPicks : [])
    .map(s => OPERATORS.find(o => o.slug === s)).filter(o => o && !o.blacklist);
  function tile(o, i) {
    const fb = typeof feedbackLabel === "function" ? feedbackLabel(o) : {n: 0};
    const lic = (typeof LICENCE === "object" && LICENCE[o.regulator] && LICENCE[o.regulator].label || o.license || "").split(" (")[0];
    const aff = typeof affLinkFor === "function" && affLinkFor(o.slug);
    return `<article class="panel tp-tile"><div class="tp-top"><span class="tp-rank">${i + 1}</span>${opCrest(o, 40)}
      <div class="tp-name"><strong>${link(opPath(o), esc(o.name))}</strong><span class="muted">${o.type === "casino" ? "Casino" : o.type === "both" ? "Casino &amp; sportsbook" : "Sportsbook"}${lic ? ` · ${esc(lic)}` : ""}</span></div>
      ${typeof safetyBadge === "function" ? safetyBadge(o, "sm") : ""}</div>
      <div class="tp-foot"><div class="tp-rate">${fb.n ? `<span class="stars">${stars(fb.avg)}</span> <strong>${fb.avg.toFixed(1)}</strong> <span class="muted">(${fb.n})</span>` : `<span class="muted">No reviews yet</span>`}</div>
      <div class="tp-btns">${link(opPath(o), "Read review", aff ? "btn small" : "btn small primary")}${aff ? affButton(aff, "top-picks", "Visit", "btn small primary") : ""}</div></div></article>`;
  }
  function block() {
    const list = picks(); if (!list.length || typeof opCrest !== "function") return "";
    return `<section class="tp-wrap" aria-labelledby="tp-h"><div class="tp-head"><h2 class="sec" id="tp-h">Top picks</h2>${link("/page/disclosures", "About featured listings", "tp-about")}</div>
      <div class="tp-grid">${list.map(tile).join("")}</div></section>`;
  }
  function afterHead(html, n) {
    if (!n || typeof html !== "string") return html;
    const start = html.indexOf('<div class="phead">'); if (start < 0) return html;
    let depth = 0, i = start; const re = /<div\b|<\/div>/g; re.lastIndex = start; let m;
    while ((m = re.exec(html))) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { i = re.lastIndex; break; } }
    // after the pinned review-guidelines card, if it's there
    const pin = html.indexOf('<div class="panel pp-card">', i);
    if (pin === i) { let d2 = 0; re.lastIndex = pin; while ((m = re.exec(html))) { d2 += m[0] === "</div>" ? -1 : 1; if (d2 === 0) { i = re.lastIndex; break; } } }
    return html.slice(0, i) + n + html.slice(i);
  }
  const baseHub = vHub;
  vHub = function () { return afterHead(baseHub.apply(this, arguments), block()); };

  // Admin → Top picks
  if (typeof vAdmin === "function" && typeof ADMIN_TABS !== "undefined") {
    if (!ADMIN_TABS.some(t => t[0] === "toppicks")) { const i = ADMIN_TABS.findIndex(t => t[0] === "operators" || t[0] === "casinos"); ADMIN_TABS.splice(i < 0 ? ADMIN_TABS.length : i + 1, 0, ["toppicks", "Top picks"]); }
    let draft = null;
    const cur = () => draft || ((typeof LAYOUT === "object" && LAYOUT && Array.isArray(LAYOUT.topPicks)) ? LAYOUT.topPicks.slice() : []);
    function page() {
      const list = cur(), name = s => (OPERATORS.find(o => o.slug === s) || {}).name || s;
      const others = OPERATORS.filter(o => !list.includes(o.slug)).sort((a, b) => a.name.localeCompare(b.name));
      return `<section class="panel"><h3 class="ph">Top picks</h3>
        <p class="muted" style="margin-top:0">These show first on the Casinos &amp; Sportsbooks page, in this order, with a small &ldquo;About featured listings&rdquo; link. Set each partner's tracking link in the affiliate links section so their Visit button earns you the commission.</p>
        ${list.length ? `<ol class="tp-ed">${list.map((s, i) => `<li><span class="tp-n">${i + 1}</span><strong>${esc(name(s))}</strong>
          <span class="row" style="gap:6px;margin-left:auto"><button class="btn small" type="button" data-act="tpMove" data-i="${i}" data-d="-1"${i === 0 ? " disabled" : ""} aria-label="Move ${esc(name(s))} up">▲</button>
          <button class="btn small" type="button" data-act="tpMove" data-i="${i}" data-d="1"${i === list.length - 1 ? " disabled" : ""} aria-label="Move ${esc(name(s))} down">▼</button>
          <button class="btn small" type="button" data-act="tpDel" data-i="${i}">Remove</button></span></li>`).join("")}</ol>` : `<p>No top picks yet.</p>`}
        <div class="row" style="gap:8px;margin:12px 0"><select class="inp" id="tpAdd" style="max-width:320px"><option value="">Add a casino or sportsbook…</option>${others.map(o => `<option value="${esc(o.slug)}">${esc(o.name)}</option>`).join("")}</select>
          <button class="btn" type="button" data-act="tpAdd">Add</button></div>
        <div class="row" style="gap:8px"><button class="btn primary" type="button" data-act="tpSave"${draft ? "" : " disabled"}>Save top picks</button>${draft ? `<button class="btn" type="button" data-act="tpReset">Undo changes</button><span class="muted">Not saved yet</span>` : ""}</div></section>`;
    }
    const baseAdmin = vAdmin;
    vAdmin = function (tab) {
      if (tab !== "toppicks") return baseAdmin.apply(this, arguments);
      if (!can("manageCategories")) return vMissing("The admin dashboard is for admins.");
      return crumbs(["Admin", "/admin"], ["Top picks"]) + phead("Admin", "Configure the platform without a developer. Every change here is audited.") +
        `<div class="tabs">${ADMIN_TABS.filter(t => t[0] !== "system" || can("system")).map(([k, v]) => `<a href="#" data-go="/admin/${k}" aria-pressed="${tab === k}">${v}</a>`).join("")}</div>` + page();
    };
    ACT.tpMove = el => { const l = cur(), i = +el.dataset.i, j = i + (+el.dataset.d); if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; draft = l; render(); };
    ACT.tpDel = el => { const l = cur(); l.splice(+el.dataset.i, 1); draft = l; render(); };
    ACT.tpAdd = () => { const s = (document.getElementById("tpAdd") || {}).value; if (!s) return toast("Pick one from the list first."); const l = cur(); l.push(s); draft = l; render(); };
    ACT.tpReset = () => { draft = null; render(); };
    ACT.tpSave = () => api("toppicks.save", {picks: cur()}).then(r => {
      if (typeof LAYOUT === "object" && LAYOUT) { LAYOUT.topPicks = r.picks; try { if (PS.docSnap && typeof docSer === "function") PS.docSnap.LAYOUT = docSer(LAYOUT); } catch (e) {} }
      draft = null; toast("Top picks saved."); render(); }).catch(e => toast(e.message));
  }
  const st = document.createElement("style");
  st.textContent = `.tp-wrap{margin:0 0 18px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.tp-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 10px}.tp-head h2{margin:0}
.tp-about{font-size:.78rem;color:var(--muted);text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
.tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.tp-tile{display:flex;flex-direction:column;gap:10px;padding:14px;margin:0;min-width:0}
.tp-top{display:flex;align-items:center;gap:10px;min-width:0}.tp-rank{font-weight:800;color:var(--muted);font-size:.9rem;width:14px;text-align:center;flex:none}
.tp-top .crest{flex:none}.tp-name{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.3}
.tp-name strong,.tp-name .muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tp-name .muted{font-size:.8rem}
.tp-top .si{flex:none}.tp-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto}
.tp-rate{font-size:.85rem;white-space:nowrap}.tp-btns{display:flex;gap:6px;flex:none}
.tp-ed{list-style:none;margin:0;padding:0}.tp-ed li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line)}.tp-n{width:24px;color:var(--muted);font-weight:700}
@media (max-width:560px){.tp-grid{grid-template-columns:1fr;gap:8px}.tp-tile{padding:10px 12px;gap:8px}}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
