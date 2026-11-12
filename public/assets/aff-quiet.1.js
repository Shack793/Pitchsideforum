/* Pitchside Forum: quieter affiliate wording. Removes the "Affiliate partner" / "Affiliate" badges, the
   "Disclosure. Pitchside may earn a commission…" box on casino pages, and the "Affiliate link · we may earn a
   commission" wording next to Visit / Play buttons, banners and promotions. "18+ · T&Cs apply" and the ads'
   "Sponsored" labels stay, and the "Ad & affiliate disclosures" page in the footer still explains it.
   Admin pages are untouched. It only changes what's shown on the page. */
(function () {
  if (typeof render !== "function") return;
  const isAdmin = () => /^\/(admin|mod)(\/|$)/.test(location.pathname);
  function tidy(root) {
    if (isAdmin()) return;
    root.querySelectorAll('.pill.blue[title^="Pitchside earns a commission"]').forEach(e => e.remove());
    root.querySelectorAll(".notice").forEach(n => { const s = n.querySelector("strong"); if (s && s.textContent.trim() === "Disclosure." && /may earn a commission/i.test(n.textContent)) n.remove(); });
    root.querySelectorAll(".aff-note").forEach(e => { if (e.textContent !== "18+ · T&Cs apply") e.textContent = "18+ · T&Cs apply"; });
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const hits = [];
    while (w.nextNode()) { const t = w.currentNode.nodeValue; if (/Affiliate (partner|link)|labelled “Affiliate partner” on every page|Pitchside may earn a commission; that never/.test(t)) hits.push(w.currentNode); }
    hits.forEach(n => {
      n.nodeValue = n.nodeValue
        .replace(/Those operators are labelled “Affiliate partner” on every page\./, "Links to those operators are affiliate links.")
        .replace(/\s*·\s*Affiliate partner/g, "")
        .replace(/Affiliate link\s*·\s*/g, "")
        .replace(/\s*·\s*Affiliate link/g, "")
        .replace(/\s*Some links are affiliate links, and Pitchside may earn a commission; that never changes a Safety Index\./, "");
    });
  }
  const base = render;
  render = function () { const r = base.apply(this, arguments); try { tidy(document.body); } catch (e) {} return r; };
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { try { tidy(document.body); } catch (e) {} }, 50); }).observe(document.body, {childList: true, subtree: true});
  try { tidy(document.body); } catch (e) {}
})();
