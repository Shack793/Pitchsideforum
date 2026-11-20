/* Pitchside Forum: a "read the marketplace rules" link at the top of the Marketplace page and every
   marketplace section. It points to the pinned "Marketplace Rules & Trading Safety" topic in Marketplace Talk,
   and shows nothing if that topic isn't there. It only wraps app functions; the app file is unchanged. */
(function () {
  if (typeof vMarket !== "function" || typeof vBoard !== "function" || typeof TOPICS === "undefined") return;
  const TITLE = "Marketplace Rules & Trading Safety", HOME = "marketplace-talk";
  const rulesTopic = () => TOPICS.find(t => t.board === HOME && t.title === TITLE && !t.deleted);
  function note() {
    const t = rulesTopic(); if (!t) return "";
    return `<div class="panel mr-note" role="note"><span aria-hidden="true">🛡️</span><span>Before you buy, sell or trade, read the ${link("/topic/" + t.id, esc(TITLE))}. Pitchside doesn't guarantee private deals, so check the seller and keep your records.</span></div>`;
  }
  // put the note straight after the page heading
  function afterHead(html) {
    const n = note(); if (!n || typeof html !== "string") return html;
    const start = html.indexOf('<div class="phead">'); if (start < 0) return n + html;
    let depth = 0, i = start;
    const re = /<div\b|<\/div>/g; re.lastIndex = start; let m;
    while ((m = re.exec(html))) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { i = re.lastIndex; break; } }
    return html.slice(0, i) + n + html.slice(i);
  }
  const baseMarket = vMarket;
  vMarket = function (qs) { const out = baseMarket.apply(this, arguments); return qs && qs.cat ? out : afterHead(out); };
  const baseBoard = vBoard;
  vBoard = function (slug) {
    const out = baseBoard.apply(this, arguments);
    const b = typeof board === "function" ? board(slug) : null;
    return b && b.cat === "market" && b.slug !== HOME ? afterHead(out) : out;
  };
  const st = document.createElement("style");
  st.textContent = ".mr-note{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;margin:0 0 14px;font-size:.93rem;line-height:1.5}.mr-note a{font-weight:600}";
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
