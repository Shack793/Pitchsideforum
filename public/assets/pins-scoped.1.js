/* Pitchside Forum: a pinned topic is pinned only in its own board.
   - On its board (or sub-board) page it stays at the top with the "Pinned" label.
   - Everywhere else (homepage, section pages like Sports or Gambling, the parent board of a sub-board,
     the "All" view of Gambling and Crypto) it's listed like any other topic, by latest activity, with no label.
   - Picking a board in the Gambling or Crypto filters shows that board's pins on top.
   - The topic page itself still says "Pinned".
   Loaded after the main app script; it only wraps the list pages, it doesn't change the app file. */
(function () {
  if (typeof TOPICS === "undefined") return;
  // While a list page is drawn, only the topics pinned in "keep(board)" count as pinned
  function scoped(fn, keepFor) {
    return function () {
      const keep = keepFor.apply(this, arguments) || (() => false), off = [];
      TOPICS.forEach(t => { if (t.pinned && !keep(t.board)) { t.pinned = false; off.push(t); } });
      try { return fn.apply(this, arguments); }
      finally { off.forEach(t => { t.pinned = true; }); }
    };
  }
  const none = () => null;
  if (typeof vHome === "function") vHome = scoped(vHome, none);
  if (typeof vCategory === "function") vCategory = scoped(vCategory, none);
  if (typeof vCommunity === "function") vCommunity = scoped(vCommunity, none);
  if (typeof vBoard === "function") vBoard = scoped(vBoard, slug => b => b === slug);
  if (typeof vGambling === "function") vGambling = scoped(vGambling, () => { const f = S.ui.gSec; return f && f !== "all" ? b => b === f : null; });
  if (typeof vCrypto === "function") vCrypto = scoped(vCrypto, () => { const f = S.ui.cBoard; return f && f !== "all" ? b => b === f : null; });
  try { render(); } catch (e) {}
})();
