/* Pitchside Forum: lighter pages (v2).
   1. Topics: the first download carries a short preview of long posts (app/ops/zz-boot-trim.php). When such a topic is
      opened, its full posts load first (a moment's "Loading…"), then the topic shows as normal.
   2. Casinos: pages outside the gambling section arrive without each casino's long details. They load in the background
      once the page is showing; the gambling pages wait for them. (The empty fields are filled in before the app starts,
      by the small "ps-op-fill" script in shell.html, so nothing breaks in the meantime.) */
(function () {
  if (typeof liveGate !== "function" || typeof topic !== "function" || typeof loadTopic !== "function") return;
  const needsOps = s => /^(casinos|sportsbooks|gambling|blacklist|complaints|compare|admin)$/.test(s || "");
  let opsFull = !(window.PS_BOOT && window.PS_BOOT.opSlim), opsLoading = null;
  function loadOps() {
    if (opsFull || opsLoading) return opsLoading;
    opsLoading = api("ops.full", {}).then(r => {
      const bySlug = {}; (r.operators || []).forEach(o => { bySlug[o.slug] = o; });
      OPERATORS.forEach(o => { if (bySlug[o.slug]) Object.assign(o, bySlug[o.slug]); });
      opsFull = true;
      if (needsOps(String(S.path || location.pathname).split(/[/?#]/)[1])) { try { render(); } catch (e) {} }   // only redraw a page that was waiting
    }).catch(() => { opsLoading = null; setTimeout(loadOps, 5000); });
    return opsLoading;
  }
  const base = liveGate;
  liveGate = function (seg, qs) {
    if (seg && !opsFull && needsOps(seg[0])) { loadOps(); return vLoading(); }
    if (seg && seg[0] === "topic" && seg[1]) {
      const t = topic(seg[1]);
      if (t && t.part && !(PS.missing && PS.missing["t" + seg[1]])) { loadTopic(+seg[1]); return vLoading(); }
    }
    return base.apply(this, arguments);
  };
  if (!opsFull) { if (document.readyState === "complete") setTimeout(loadOps, 300); else addEventListener("load", () => setTimeout(loadOps, 300)); }
})();
