/* Pitchside Forum: Admin → Top picks. Picks which casinos and sportsbooks appear in the site's own Top picks
   section (they are the "featured" listings). Server side: app/ops/zz-toppicks.php. Adds no section of its own.
   On the Casinos & Sportsbooks pages it moves the site's own Top picks section to the top of the page, just under
   the pinned review-guidelines card (or the page title). */
(function () {
  if (typeof OPERATORS === "undefined") return;
  // Move the site's own "Top picks" section to the top of the Casinos & Sportsbooks page
  function moveTopPicks() {
    if (!/^\/(casinos|sportsbooks)\/?$/.test(location.pathname)) return;
    const head = document.querySelector(".phead"); if (!head || !head.parentElement) return;
    const top = head.parentElement;
    const h = [...top.querySelectorAll("h1,h2,h3,h4,strong,.ph,.sec")].find(el => /^top picks$/i.test(el.textContent.trim()) && !el.closest(".phead"));
    if (!h || h.closest("[data-tp-moved]")) return;
    let box = h.closest("section, .panel, article");
    if (!box || box.contains(head) || box === top) {
      // heading without its own box: take the heading and what follows it, up to the next heading
      const parts = [h]; let n = h.nextElementSibling;
      while (n && !/^H[1-4]$/.test(n.tagName)) { parts.push(n); n = n.nextElementSibling; }
      box = document.createElement("div"); h.parentElement.insertBefore(box, h); parts.forEach(p => box.appendChild(p));
    }
    box.setAttribute("data-tp-moved", "1"); box.classList.add("tp-moved");
    let after = head; const pin = top.querySelector(":scope > .pp-card"); if (pin) after = pin;
    after.insertAdjacentElement("afterend", box);
  }
  if (typeof render === "function") {
    const baseRender = render;
    render = function () { const r = baseRender.apply(this, arguments); try { moveTopPicks(); } catch (e) {} return r; };
  }
  // Admin → Top picks
  if (typeof vAdmin === "function" && typeof ADMIN_TABS !== "undefined") {
    if (!ADMIN_TABS.some(t => t[0] === "toppicks")) { const i = ADMIN_TABS.findIndex(t => t[0] === "operators" || t[0] === "casinos"); ADMIN_TABS.splice(i < 0 ? ADMIN_TABS.length : i + 1, 0, ["toppicks", "Top picks"]); }
    let draft = null;
    const cur = () => draft || ((typeof LAYOUT === "object" && LAYOUT && Array.isArray(LAYOUT.topPicks)) ? LAYOUT.topPicks.slice() : []);
    function page() {
      const list = cur(), name = s => (OPERATORS.find(o => o.slug === s) || {}).name || s;
      const others = OPERATORS.filter(o => !list.includes(o.slug)).sort((a, b) => a.name.localeCompare(b.name));
      return `<section class="panel"><h3 class="ph">Top picks</h3>
        <p class="muted" style="margin-top:0">These are the casinos and sportsbooks shown in the Top picks section on the Casinos &amp; Sportsbooks page. Anything not on this list is taken out of Top picks. Set each partner's tracking link in the affiliate links section so their Visit button earns you the commission.</p>
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
      if (typeof LAYOUT === "object" && LAYOUT) { LAYOUT.topPicks = r.picks; OPERATORS.forEach(o => { o.featured = r.picks.includes(o.slug); }); try { if (PS.docSnap && typeof docSer === "function") PS.docSnap.LAYOUT = docSer(LAYOUT); } catch (e) {} }
      draft = null; toast("Top picks saved."); render(); }).catch(e => toast(e.message));
  }
  const st = document.createElement("style");
  st.textContent = `.tp-moved{margin:0 0 16px}.tp-ed{list-style:none;margin:0;padding:0}.tp-ed li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line)}.tp-n{width:24px;color:var(--muted);font-weight:700}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
