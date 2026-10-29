/* Pitchside Forum: a cleaner Casinos & Sportsbooks list, in the style of AskGamblers.
   - "Top picks" first: up to 2 featured operators (Admin → Businesses → Featured), topped up with the
     highest Safety Index scores (7.0 and up).
   - Then every other listed operator as a tidy card: logo, name, type, Safety Index, member rating,
     licence and payments, with "Read review" (and "Play now" when there's an affiliate link).
     "Play now" (tracked affiliate link) appears next to "Read review" once a casino has an affiliate link.
     Clicking anywhere on a card opens the full review page, where the pros and cons, complaints and
     rating live.
   - Filters cut down to three: Type, Filter by payment method (now with "All"), Sort.
   Loaded after operators.3.js and promotions.3.js; it replaces the list view only, not the app file. */
(function () {
  if (typeof vHub !== "function" || typeof safety !== "function") return;
  const KINDS = [["casino", "Casino"], ["both", "Casino & Sportsbook"], ["sportsbook", "Sportsbook"]];
  const kindOf = window.opKind || (o => o.type === "sportsbook" ? "sportsbook" : "casino");
  const kindLabel = o => (KINDS.find(k => k[0] === kindOf(o)) || KINDS[0])[1];
  const crestOf = (o, px) => typeof window.opCrestBig === "function" ? window.opCrestBig(o, px) : opCrest(o, px);
  const licenceOf = o => (LICENCE[o.regulator] && LICENCE[o.regulator].label.split(" (")[0]) || (o.license || "").split(/[.(]/)[0].trim() || "Licence not stated";
  const PICKS = 2;
  const starRow = n => { const k = Math.round(n); return `<span class="on">${"★".repeat(k)}</span><span class="off">${"★".repeat(5 - k)}</span>`; };

  function card(o, pick) {
    const s = safety(o), fb = feedbackLabel(o);
    // "Play now" only when the casino has an active affiliate link (Admin → Affiliate links), and never for
    // blacklisted casinos, ones with a warning, or a low Safety Index (under 5.0)
    const aff = typeof affLinkFor === "function" && !o.blacklist && !o.warning && s.score >= 5 ? affLinkFor(o.slug) : null;
    const rating = fb.n ? `<span class="cl-stars" aria-hidden="true">${starRow(fb.avg)}</span> <strong>${fb.avg.toFixed(1)}</strong> <span class="muted">(${fb.n} review${fb.n === 1 ? "" : "s"})</span>` : `<span class="muted">No member reviews yet</span>`;
    return `<article class="cl-card${pick ? " cl-pick" : ""}">
      ${pick ? `<span class="cl-ribbon">Top pick</span>` : ""}
      <div class="cl-head">
        <div class="cl-logo">${crestOf(o, 46)}</div>
        <div class="cl-id">
          <h3 class="cl-name">${link(opPath(o), esc(o.name), "cl-hit")}</h3>
          <div class="cl-tags"><span class="pill">${esc(kindLabel(o))}</span>${o.verified ? '<span class="pill green">Verified</span>' : ""}${warnBadge(o)}</div>
          <div class="cl-meta"><span class="cl-si">${safetyBadge(o)}</span><span class="cl-rate">${rating}</span></div>
        </div>
      </div>
      <dl class="cl-facts"><div><dt>Licence</dt><dd>${esc(licenceOf(o))}</dd></div><div><dt>Payments</dt><dd>${esc(payLabel(o))}</dd></div>${o.minDeposit ? `<div><dt>Min. deposit</dt><dd>${esc(o.minDeposit)}</dd></div>` : ""}</dl>
      <div class="cl-btns">${aff ? link(opPath(o), "Read review", "btn cl-review") + affButton(aff, "casino-list", "Play now", "btn primary") : link(opPath(o), "Read review", "btn primary")}</div>
      ${aff ? `<div class="cl-note">${affNote()}</div>` : ""}
    </article>`;
  }

  vHub = function (qs = {}) {
    if (gated()) return ageGate();
    S.ui.hub = S.ui.hub || {};
    if (KINDS.some(k => k[0] === qs.type)) S.ui.hub.kind = qs.type;
    if (PAY_TYPES.some(p => p[0] === qs.pay)) S.ui.hub.pay = qs.pay;
    const f = Object.assign({kind: "all", pay: "all", sort: "safety"}, S.ui.hub);
    const listed = OPERATORS.filter(o => !o.blacklist), nBlack = OPERATORS.length - listed.length;
    const byType = listed.filter(o => f.kind === "all" || kindOf(o) === f.kind);
    let list = byType.filter(o => f.pay === "all" || payType(o) === f.pay);
    const key = {safety: o => -safety(o).score, feedback: o => -(feedbackLabel(o).avg || 0), newest: o => -(o.est || 0), name: o => 0};
    list.sort((a, b) => f.sort === "name" ? a.name.localeCompare(b.name) : key[f.sort](a) - key[f.sort](b));
    // Top picks: only on the unfiltered default view, so filtering always shows one plain list
    let picks = [];
    if (f.kind === "all" && f.pay === "all" && f.sort === "safety" && list.length > PICKS) {
      const bySafety = [...list].sort((a, b) => safety(b).score - safety(a).score);
      picks = bySafety.filter(o => o.featured && !o.warning).slice(0, PICKS);
      for (const o of bySafety) { if (picks.length >= PICKS) break; if (!picks.includes(o) && !o.warning && safety(o).score >= 7) picks.push(o); }
      list = list.filter(o => !picks.includes(o));
    }
    const nKind = k => listed.filter(o => kindOf(o) === k).length, nPay = k => byType.filter(o => payType(o) === k).length;
    const sel = (id, ch, label, opts, v) => `<label class="cl-f"><span>${label}</span><select class="inp" data-change="${ch}" id="${id}">${opts.map(([k, t]) => `<option value="${k}" ${v === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
    const filters = `<div class="cl-filters" role="group" aria-label="Filters">
      ${sel("hubKind", "hubKind", "Type", [["all", `All types (${listed.length})`], ...KINDS.map(([k, t]) => [k, `${t} (${nKind(k)})`])], f.kind)}
      ${sel("hubPay", "hubPay", "Filter by payment method", [["all", `All (${byType.length})`], ...PAY_TYPES.map(([k, t]) => [k, `${t} (${nPay(k)})`])], f.pay)}
      ${sel("hubSort", "hubSort", "Sort", [["safety", "Safety Index"], ["feedback", "Member rating"], ["newest", "Newest"], ["name", "A to Z"]], f.sort)}
    </div>`;
    const empty = `<div class="panel empty">${OPERATORS.length ? `Nothing matches these filters. <button class="btn small" type="button" data-act="hubReset">Show all</button>` : `No casinos or sportsbooks have been added yet.${can("manageCategories") ? ` ${link("/admin/businesses", "Add the first one")}.` : ""}`}</div>`;
    return crumbs(["Gambling", "/gambling"], ["Casinos & sportsbooks"]) +
      phead("Casinos & sportsbooks", "Every casino and sportsbook gets a Safety Index from its licence, complaint handling, terms and member reviews. Click one for the full review.",
        `<button class="btn" type="button" data-act="fileComplaint">File a complaint</button>${kindButton({kind: "review"})}`) +
      filters +
      (picks.length ? `<section class="cl-sec" aria-labelledby="clPicks"><h2 class="cl-h" id="clPicks">Top picks</h2><div class="cl-grid">${picks.map(o => card(o, true)).join("")}</div></section>` : "") +
      `<section class="cl-sec" aria-labelledby="clAll">${picks.length ? `<h2 class="cl-h" id="clAll">More casinos & sportsbooks</h2>` : ""}${list.length ? `<div class="cl-grid">${list.map(o => card(o, false)).join("")}</div>` : (picks.length ? "" : empty)}</section>` +
      `<div class="cl-foot">
        ${nBlack ? `<div class="notice red"><strong>${nBlack} blacklisted operator${nBlack > 1 ? "s are" : " is"} not listed here.</strong><span>${link("/blacklist", "See the blacklist")} and why we warn players to avoid them.</span></div>` : ""}
        <p class="muted cl-how">Advertising and affiliate deals never change a Safety Index. ${link("/page/safety-index", "How we rate")} · ${link("/complaints", "Complaint Center")}</p>
      </div>`;
  };
  CHANGE.hubKind = el => { S.ui.hub = Object.assign(S.ui.hub || {}, {kind: el.value}); render(); };
  ACT.hubReset = () => { S.ui.hub = {kind: "all", pay: "all", sort: "safety"}; render(); };
  // Clicking anywhere on a card (not on a button or link) opens the review
  document.addEventListener("click", e => {
    const c = e.target.closest(".cl-card"); if (!c || e.target.closest("a,button,input,select,label")) return;
    const a = c.querySelector("a.cl-hit"); if (a) a.click();
  });
  try { render(); } catch (e) {}
})();
