/* Pitchside Forum: the Crypto page filters by its three boards (Cryptocurrency Discussion, Crypto Casinos &
   Sportsbooks, Crypto Trading & Investments) instead of by coin. Links to the old coin boards inside posts go to
   Cryptocurrency Discussion. Loaded after app.js. */
(function () {
  const OLD = ["bitcoin", "ethereum", "stablecoins", "tether", "usdc", "xrp", "bnb", "solana", "dogecoin", "tron", "cardano", "altcoins"];
  const known = s => typeof BOARDS !== "undefined" && BOARDS.some(b => b.slug === s);
  if (typeof vCrypto === "function") {
    const base = vCrypto;
    vCrypto = function () {
      if (S.ui.cBoard && S.ui.cBoard !== "all" && !known(S.ui.cBoard)) S.ui.cBoard = "all";
      const tp = document.createElement("template"); tp.innerHTML = base.apply(this, arguments);
      const row = tp.content.querySelector('.tabs[aria-label="Filter by coin"]');
      if (row) {
        const f = S.ui.cBoard || "all";
        const bs = BOARDS.filter(b => b.cat === "crypto" && !b.parent && canReadBoard(b)).sort((a, b) => a.order - b.order);
        row.setAttribute("aria-label", "Filter by board");
        row.innerHTML = [["all", "All"], ...bs.map(b => [b.slug, b.name])].map(([k, l]) => `<button type="button" data-act="cBoard" data-k="${esc(k)}" aria-pressed="${f === k}">${esc(l)}</button>`).join("");
      }
      return tp.innerHTML;
    };
  }
  function fixLinks() {
    document.querySelectorAll('a[data-go^="/forum/"], a[href^="/forum/"]').forEach(a => {
      const p = a.getAttribute("data-go") || a.getAttribute("href"), s = (p.split("/")[2] || "").split(/[?#]/)[0];
      if (!OLD.includes(s) || known(s) || !known("crypto-discussion")) return;
      if (a.hasAttribute("data-go")) a.setAttribute("data-go", "/forum/crypto-discussion");
      if (a.getAttribute("href") !== "#") a.setAttribute("href", "/forum/crypto-discussion");
    });
  }
  let t = 0;
  new MutationObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(fixLinks); }).observe(document.documentElement, {childList: true, subtree: true});
  try { if (typeof render === "function" && /^\/crypto(\/|\?|$)/.test(S.path || location.pathname)) render(); } catch (e) {}
})();
