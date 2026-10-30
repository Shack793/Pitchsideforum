/* Pitchside Forum: "New topic" form shows only the boards of the section you're posting in.
   - A Section dropdown (Sports, Gambling, Crypto, Community…) comes first. It's set from where you pressed
     "New topic": a board, a section page, or the page you're on. The Board dropdown then lists only that
     section's boards and their sub-boards.
   - From a place with no section (the Forum index), you choose the section first.
   - The Team field only shows for Sports.
   Loaded after the main app script; it changes the form after it opens, it doesn't change the app file. */
(function () {
  if (!ACT.newTopic || typeof BOARDS === "undefined") return;
  const PATH_CAT = {sports: "sports", leagues: "sports", teams: "sports", events: "sports", live: "sports", gambling: "gambling", casinos: "gambling",
    sportsbooks: "gambling", complaints: "gambling", reviews: "gambling", blacklist: "gambling", promotions: "gambling", raffle: "gambling", crypto: "crypto", community: "community", marketplace: "market"};
  function contextCat(el) {
    const d = (el && el.dataset) || {};
    const b = d.board && board(d.board); if (b) return b.cat;
    if (d.cat) return d.cat;
    const seg = (S.path || "/").split("?")[0].split("/").filter(Boolean);
    if (seg[0] === "forum" && seg[1]) { const fb = board(seg[1]); if (fb) return fb.cat; const c = (CATEGORIES || []).find(x => x.id === seg[1]); if (c) return c.id; }
    if (seg[0] === "topic" && seg[1] && typeof topic === "function") { const t = topic(+seg[1]); const tb = t && board(t.board); if (tb) return tb.cat; }
    return PATH_CAT[seg[0]] || "";
  }
  const base = ACT.newTopic;
  ACT.newTopic = function (el) {
    const r = base.apply(this, arguments);
    const form = document.getElementById("modalForm"), sel = form && form.querySelector('select[name="board"]');
    if (!sel || !document.getElementById("modal").open) return r;
    const allowed = new Set([...sel.options].map(o => o.value)), pre = sel.value, preset = el && el.dataset && el.dataset.board;
    const usable = BOARDS.filter(b => allowed.has(b.slug));
    const cats = (CATEGORIES || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).filter(c => usable.some(b => b.cat === c.id));
    let cat = contextCat(el); if (!cats.some(c => c.id === cat)) cat = cats.length === 1 ? cats[0].id : "";
    const teamLab = form.querySelector('select[name="team"]') && form.querySelector('select[name="team"]').closest("label");
    // Section dropdown before the Board one
    const lab = sel.closest("label");
    const secLab = document.createElement("label");
    secLab.innerHTML = `Section<select name="section" required>${cat ? "" : '<option value="">Choose a section…</option>'}${cats.map(c => `<option value="${esc(c.id)}"${c.id === cat ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;
    lab.before(secLab);
    const secSel = secLab.querySelector("select");
    function fill(c, keep) {
      const top = usable.filter(b => b.cat === c && !b.parent).sort((a, b) => (a.order || 0) - (b.order || 0));
      const html = top.map(t => {
        const kids = usable.filter(b => b.parent === t.slug).sort((a, b) => (a.order || 0) - (b.order || 0));
        return `<option value="${esc(t.slug)}">${esc(t.name)}</option>` + kids.map(k => `<option value="${esc(k.slug)}">↳ ${esc(k.name)}</option>`).join("");
      }).join("");
      // sub-boards whose parent isn't postable still get listed
      const orphans = usable.filter(b => b.cat === c && b.parent && !top.some(t => t.slug === b.parent)).map(k => `<option value="${esc(k.slug)}">${esc(k.name)}</option>`).join("");
      sel.innerHTML = c ? (html + orphans || '<option value="">No boards you can post in</option>') : '<option value="">Choose a section first</option>';
      sel.disabled = !c;
      if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
      if (teamLab) teamLab.hidden = c !== "sports";
    }
    fill(cat, preset || (cat && board(pre) && board(pre).cat === cat ? pre : ""));
    secSel.addEventListener("change", () => { const o = secSel.querySelector('option[value=""]'); if (o && secSel.value) o.remove(); fill(secSel.value, ""); });
    // Stop the form if no board was picked
    const orig = modalSubmit;
    modalSubmit = function (f) {
      if (!sel.value) return "Choose a section and a board.";
      if (teamLab && teamLab.hidden) { const t = f.elements.team; if (t) t.value = ""; }
      return orig.apply(this, arguments);
    };
    return r;
  };
})();
