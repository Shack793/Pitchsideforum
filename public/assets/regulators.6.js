/* Pitchside Forum: more gambling regulators for casino and sportsbook listings.
   Adds national regulators (Gibraltar, Alderney, Isle of Man, Netherlands, Sweden, Spain, Italy, Portugal, Romania,
   Belgium, Estonia, Germany, Latvia, Ireland, Brazil, Ukraine, Bulgaria, Ontario, Australia, US states) and Kahnawake, each with a name and a licence score for the Safety Index, and adds them to the
   "Regulator" choice in Admin → Businesses. Listings with no known founding year show no year.
   Loaded after operators.4.js. */
(function () {
  if (typeof LICENCE !== "object" || !LICENCE) return;
  const MORE = [
    ["gib", 100, "Gibraltar Gambling Commissioner", "Gibraltar licence (strict)"],
    ["alderney", 95, "Alderney (AGCC)", "Alderney Gambling Control Commission licence (strict)"],
    ["iom", 95, "Isle of Man (GSC)", "Isle of Man Gambling Supervision Commission licence (strict)"],
    ["ksa", 100, "Netherlands (KSA)", "Netherlands Kansspelautoriteit licence (strict)"],
    ["sga", 100, "Sweden (Spelinspektionen)", "Swedish Gambling Authority licence (strict)"],
    ["dgoj", 100, "Spain (DGOJ)", "Spanish DGOJ licence (strict)"],
    ["adm", 100, "Italy (ADM)", "Italian ADM concession (strict)"],
    ["srij", 100, "Portugal (SRIJ)", "Portuguese SRIJ licence (strict)"],
    ["onjn", 90, "Romania (ONJN)", "Romanian ONJN licence (strict)"],
    ["be", 100, "Belgium (Gaming Commission)", "Belgian Gaming Commission licence (strict)"],
    ["ee", 90, "Estonia (Tax and Customs Board)", "Estonian licence (strict)"],
    ["br", 85, "Brazil (SPA)", "Brazilian federal licence (SPA)"],
    ["ie", 85, "Ireland (Revenue Commissioners)", "Irish remote bookmaker licence"],
    ["de", 95, "Germany (GGL)", "German GGL licence (strict)"],
    ["lv", 90, "Latvia (Gambling Supervisory)", "Latvian licence (strict)"],
    ["ua", 70, "Ukraine (PlayCity)", "Ukrainian PlayCity licence (moderate protection)"],
    ["bg", 85, "Bulgaria (NRA)", "Bulgarian National Revenue Agency licence"],
    ["ontario", 100, "Ontario (iGaming Ontario / AGCO)", "Ontario iGaming licence (strict)"],
    ["au", 95, "Australia (licensed wagering provider)", "Australian wagering licence (strict)"],
    ["us", 100, "US state regulator", "US state gaming regulator licence (strict)"],
    ["kahnawake", 70, "Kahnawake (KGC)", "Kahnawake Gaming Commission licence (moderate protection)"]
  ];
  MORE.forEach(([k, score, , label]) => { if (!LICENCE[k]) LICENCE[k] = {score, label}; });
  // Regulator choice in the admin forms: add the new ones before "Curaçao"
  function extend(sel) {
    if (!sel || sel.dataset.regs) return; sel.dataset.regs = "1";
    const have = new Set([...sel.options].map(o => o.value)), cur = sel.value;
    const before = [...sel.options].find(o => o.value === "curacao") || null;
    MORE.forEach(([k, , name]) => { if (have.has(k)) return; const o = new Option(name, k); sel.insertBefore(o, before); });
    sel.value = cur;
  }
  // Admin forms: add the choices when a form opens, then pick the listing's saved regulator (the form can only
  // pre-select regulators it already knew about)
  ["opAdmin", "opEdit", "operatorEdit"].forEach(name => {
    const inner = ACT[name]; if (typeof inner !== "function") return;
    ACT[name] = function (el) {
      const r = inner.apply(this, arguments);
      const est = document.querySelector('#modalForm input[name="est"]'); if (est) { est.min = "1900"; if (est.value === "null") est.value = ""; }   // older brands, e.g. Coral (1926)
      const sel = document.querySelector('#modalForm select[name="regulator"]'); if (!sel) return r;
      extend(sel);
      const key = el && el.dataset ? el.dataset.slug || el.dataset.id : null;
      const o = key && typeof OPERATORS !== "undefined" ? OPERATORS.find(x => x.slug === key || String(x.id) === String(key)) : null;
      if (o && o.regulator && [...sel.options].some(x => x.value === o.regulator)) sel.value = o.regulator;
      return r;
    };
  });
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.querySelectorAll) n.querySelectorAll('select[name="regulator"]').forEach(extend); }))).observe(document.documentElement, {childList: true, subtree: true});
  // Listings whose founding year isn't known: no "established null", and empty facts rows are left out
  if (typeof safety === "function") {
    const baseSafety = safety;
    safety = function (o) {
      const r = baseSafety.apply(this, arguments);
      if (r && Array.isArray(r.good) && !(+o.est)) r.good = r.good.map(g => typeof g === "string" ? g.replace(/, established (null|undefined|0|)$/, "") : g);
      return r;
    };
  }
  if (typeof opFacts === "function") {
    const baseFacts = opFacts;
    opFacts = function () { const h = baseFacts.apply(this, arguments); return typeof h === "string" ? h.replace(/<dt>[^<]*<\/dt><dd><\/dd>/g, "") : h; };
  }
  try { render(); } catch (e) {}
})();
