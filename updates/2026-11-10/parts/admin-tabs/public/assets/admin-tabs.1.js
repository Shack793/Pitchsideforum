/* Pitchside Forum: Admin tabs in alphabetical order (Overview stays first, as the dashboard), so each section is
   easier to find. Tabs added by other add-ons are sorted too. Loaded last; it only reorders the list. */
(function () {
  if (typeof ADMIN_TABS === "undefined" || !Array.isArray(ADMIN_TABS)) return;
  function sortTabs() {
    const first = ADMIN_TABS.filter(t => t[0] === "overview");
    const rest = ADMIN_TABS.filter(t => t[0] !== "overview").sort((a, b) => String(a[1]).localeCompare(String(b[1]), "en", {sensitivity: "base"}));
    const next = first.concat(rest);
    if (next.some((t, i) => t !== ADMIN_TABS[i])) ADMIN_TABS.splice(0, ADMIN_TABS.length, ...next);
  }
  sortTabs();
  if (typeof vAdmin === "function") {
    const base = vAdmin;
    vAdmin = function () { sortTabs(); return base.apply(this, arguments); };
  }
  try { render(); } catch (e) {}
})();
