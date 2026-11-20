/* Pitchside Forum: tidier casino/sportsbook review page (Overview tab).
   - Pros and cons move from the narrow side column into the main column, under the Safety Index card,
     as two side-by-side lists ("Pros" and "Cons"), so the two columns are balanced.
   - The Safety Index card no longer repeats the big score badge (it is already at the top of the page).
   - On phones, "What raises it" / "What lowers it" and the pros/cons stack instead of squeezing into two columns.
   Works on the page after it is drawn; changes nothing else. Loaded after recommended.1.js. */
(function () {
  const css = document.createElement("style");
  css.id = "ps-rt";
  css.textContent = ".rt-si .si-lg{display:none}.rt-pc .rt-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}" +
    ".rt-pc .rt-cols h3{margin-top:0}.rt-pc ul.pc{margin:0}" +
    "@media (max-width:640px){.rt-si .grid,.rt-pc .rt-cols{grid-template-columns:1fr!important;gap:10px!important}}";
  document.head.appendChild(css);
  const txt = el => (el && el.textContent || "").trim();
  function tidy() {
    const cols = document.querySelector(".cols"); if (!cols) return;
    const main = cols.querySelector(":scope > .stack"), side = cols.querySelector(":scope > aside.stack"); if (!main || !side) return;
    const si = [...main.children].find(s => s.matches("section.panel") && txt(s.querySelector("h2.sec")) === "Safety Index");
    if (!si) return;
    if (!si.classList.contains("rt-si")) si.classList.add("rt-si");
    const pc = [...side.children].find(s => s.matches("section.panel") && txt(s.querySelector("h3.ph")) === "Pros and cons");
    if (!pc || pc.dataset.rt) return;
    const pros = [...pc.querySelectorAll("li.pro")], cons = [...pc.querySelectorAll("li.con")];
    const list = (items, title, color) => items.length ? `<div><h3 class="ph" style="color:var(${color})">${title}</h3><ul class="pc">${items.map(li => li.outerHTML).join("")}</ul></div>` : "";
    pc.dataset.rt = "1"; pc.classList.add("rt-pc");
    pc.innerHTML = `<h2 class="sec" style="margin-bottom:12px">Pros and cons</h2><div class="rt-cols">${list(pros, "Pros", "--good")}${list(cons, "Cons", "--danger")}</div>`;
    if (!pros.length || !cons.length) pc.querySelector(".rt-cols").style.gridTemplateColumns = "1fr";
    si.after(pc);
  }
  let t = 0;
  const run = () => { cancelAnimationFrame(t); t = requestAnimationFrame(tidy); };
  new MutationObserver(run).observe(document.documentElement, {childList: true, subtree: true});
  run();
})();
