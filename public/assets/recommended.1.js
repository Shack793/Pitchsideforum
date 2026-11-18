/* Pitchside Forum: "Recommended by Pitchside" on every casino and sportsbook page (at the top of the side column; at the
   bottom on tabs without one). Shows the listings chosen in Admin → Reviews → Recommended on every listing, except
   the page's own casino. Server side: app/ops/zz-recommended.php (LAYOUT.recommended). */
(function () {
  if (typeof vOperator !== "function" || typeof OPERATORS === "undefined") return;
  const picks = () => ((typeof LAYOUT === "object" && LAYOUT && Array.isArray(LAYOUT.recommended)) ? LAYOUT.recommended : []);
  const logo = o => o.logo ? `<img class="rc-logo" src="${esc(o.logo)}" alt="" loading="lazy">` : opCrest(o, 44);
  function box(cur) {
    const list = picks().map(s => OPERATORS.find(o => o.slug === s)).filter(o => o && o.slug !== cur && !o.blacklist);
    if (!list.length) return "";
    return `<section class="panel rc-box"><h3 class="ph">Recommended by Pitchside</h3>${list.map(o => {
      const s = safety(o), l = typeof affLinkFor === "function" ? affLinkFor(o.slug) : null;
      const visit = l && typeof affButton === "function" ? affButton(l, "recommended", "Visit") : (o.website ? `<a class="btn small primary" href="https://${esc(String(o.website).replace(/^https?:\/\//, ""))}" target="_blank" rel="noopener nofollow sponsored">Visit</a>` : "");
      return `<div class="rc-row">${logo(o)}<div class="rc-mid"><a href="${opPath(o)}" data-link><strong>${esc(o.name)}</strong></a><a class="muted" href="${opPath(o)}" data-link style="text-decoration:none">Safety Index <strong class="${s.tone === "good" ? "pos" : ""}">${s.score.toFixed(1)}</strong> · Review</a></div><div class="rc-btns">${visit}</div></div>`;
    }).join("")}</section>`;
  }
  const base = vOperator;
  vOperator = function (slug) {
    const out = base.apply(this, arguments);
    if (typeof out !== "string") return out;
    const b = box(slug); if (!b) return out;
    const i = out.indexOf('<aside class="stack">');
    return i >= 0 ? out.slice(0, i + 21) + b + out.slice(i + 21) : out + `<div style="margin-top:16px">${b}</div>`;
  };

  // Admin → Reviews: choose them
  function panel() {
    const cur = picks(), opts = sel => `<option value="">— none —</option>` + OPERATORS.slice().sort((a, b) => a.name.localeCompare(b.name)).map(o => `<option value="${esc(o.slug)}"${o.slug === sel ? " selected" : ""}>${esc(o.name)}</option>`).join("");
    return `<section class="panel" id="recPanel" style="margin-bottom:16px"><h3 class="ph">Recommended on every listing</h3>
      <p class="muted" style="margin-top:0">Shown as &ldquo;Recommended by Pitchside&rdquo; on every casino and sportsbook page (not on their own page, and never if blacklisted). Up to 6, in this order.</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">${[0, 1, 2, 3, 4, 5].map(k => `<select class="inp" id="rec-${k}" aria-label="Recommended ${k + 1}">${opts(cur[k] || "")}</select>`).join("")}</div>
      <button class="btn small primary" type="button" data-act="recSave" style="margin-top:10px">Save</button></section>`;
  }
  if (typeof vAdmin === "function") {
    const baseAdmin = vAdmin;
    vAdmin = function (tab) {
      const out = baseAdmin.apply(this, arguments);
      if (tab !== "reviews" || typeof out !== "string" || !(typeof isAdmin === "function" ? isAdmin() : can("manageCategories"))) return out;
      const i = out.indexOf('<section class="panel" id="penaltyPoints"'), j = out.indexOf('<section class="panel" id="adminRating"'), at = i >= 0 ? i : j;
      return at >= 0 ? out.slice(0, at) + panel() + out.slice(at) : out + panel();
    };
  }
  ACT.recSave = () => {
    const slugs = [0, 1, 2, 3, 4, 5].map(k => (document.getElementById("rec-" + k) || {}).value).filter(Boolean);
    api("recommended.set", {slugs}).then(r => { LAYOUT.recommended = r.slugs; toast(r.slugs.length ? "Recommended casinos saved" : "Recommended box turned off"); render(); }).catch(e => toast(e.message));
  };
  const st = document.createElement("style");
  st.textContent = `.rc-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line)}.rc-box h3+.rc-row{border-top:0}.rc-logo{width:44px;height:44px;border-radius:11px;object-fit:contain;background:#0f172a;flex:none}.rc-mid{display:flex;flex-direction:column;min-width:0;flex:1;font-size:.9rem}.rc-btns{display:flex;gap:6px;flex:none;align-items:center}.rc-btns a,.rc-btns .btn{font-size:.85rem!important;padding:6px 12px!important;min-height:0!important;line-height:1.2!important}.rc-mid .muted{white-space:nowrap;font-size:.82rem}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
