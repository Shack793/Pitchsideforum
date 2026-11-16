/* Pitchside Forum: tidy "Move topic" list. Boards are grouped by forum category, in the same order as the forum,
   with sub-boards indented under their board, the current board marked, and a search box to find a board fast. */
(function () {
  if (typeof ACT !== "object" || typeof ACT.modTopic !== "function" || typeof BOARDS === "undefined") return;
  const base = ACT.modTopic;
  function options(cur, q) {
    q = (q || "").trim().toLowerCase();
    const cats = (typeof CATEGORIES !== "undefined" ? CATEGORIES : []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name);
    const hit = b => !q || b.name.toLowerCase().includes(q) || (cats.find(c => c.id === b.cat) || {name: ""}).name.toLowerCase().includes(q);
    const opt = (b, sub) => `<option value="${esc(b.slug)}"${b.slug === cur ? " disabled" : ""}>${sub ? "   ↳ " : ""}${esc(b.name)}${b.slug === cur ? " (current board)" : ""}</option>`;
    const group = (label, list) => {
      const rows = list.filter(b => !b.parent).sort(byOrder).flatMap(b => {
        const subs = BOARDS.filter(x => x.parent === b.slug).sort(byOrder).filter(x => hit(x) || hit(b));
        return (hit(b) || subs.length) ? [opt(b, false), ...subs.map(x => opt(x, true))] : [];
      });
      return rows.length ? `<optgroup label="${esc(label)}">${rows.join("")}</optgroup>` : "";
    };
    let html = cats.map(c => group(c.name, BOARDS.filter(b => b.cat === c.id))).join("");
    const loose = BOARDS.filter(b => !cats.some(c => c.id === b.cat));
    if (loose.length) html += group("Other", loose);
    return html || `<option value="" disabled>No board matches “${esc(q)}”</option>`;
  }
  ACT.modTopic = function (el) {
    const r = base.apply(this, arguments);
    if (el && el.dataset && el.dataset.op === "move") {
      const sel = document.querySelector('#modalForm select[name="to"]'); if (!sel) return r;
      const t = typeof topic === "function" ? topic(el.dataset.id) : null, cur = t ? t.board : "";
      sel.innerHTML = options(cur, ""); sel.size = Math.min(14, sel.options.length + 2); sel.style.width = "100%";
      const first = [...sel.options].find(o => !o.disabled); if (first) first.selected = true;
      const box = document.createElement("input"); box.type = "search"; box.className = "inp"; box.placeholder = "Type to find a board…"; box.style.marginBottom = "6px"; box.setAttribute("aria-label", "Find a board");
      box.addEventListener("input", () => { const v = sel.value; sel.innerHTML = options(cur, box.value);
        const keep = [...sel.options].find(o => o.value === v && !o.disabled) || [...sel.options].find(o => !o.disabled && o.value); if (keep) keep.selected = true; });
      box.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); sel.focus(); } });
      sel.parentNode.insertBefore(box, sel); box.focus();
    }
    return r;
  };
})();
