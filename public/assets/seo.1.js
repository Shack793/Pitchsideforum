/* Pitchside Forum: search engine crawlers (Google, Bing…) read the page as a browser shows it. The 18+ check would
   hide every review, casino page and complaint from them, so known crawlers skip it. People still see the check.
   It only changes the app's own state; the app file is unchanged. */
(function () {
  if (typeof S === "undefined" || typeof render !== "function") return;
  if (/googlebot|google-inspectiontool|bingbot|adidxbot|duckduckbot|yandex|baiduspider|applebot|slurp|petalbot|seznambot|qwant/i.test(navigator.userAgent || "")) {
    S.ageOk = true; try { render(); } catch (e) {}
  }
})();
