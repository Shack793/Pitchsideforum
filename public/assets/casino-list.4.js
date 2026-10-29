/* Pitchside Forum: Casinos & Sportsbooks list as small tiles, in the style of AskGamblers.
   - Each tile: logo, name, type, Safety Index, "Read review", and a "Play" button with "18+ · T&Cs apply" once the
     casino has an active affiliate link (Admin → Affiliate links). Never for blacklisted casinos, ones with a
     warning, or a Safety Index under 5.0. Clicking anywhere else on a tile opens the review.
   - Rows: "Top picks" first (featured casinos from Admin → Businesses, topped up with the highest Safety Index
     scores of 7.0 and up, up to 6), then one row per type: Casino & Sportsbook, Casino, Sportsbook.
   - Big screens: 4 to 6 tiles across (depending on the width), first two rows of each type with "Show all".
     Phones and small tablets: each row scrolls sideways, so the page stays short.
   - Filters: Type, Filter by payment method, Sort.
   Loaded after operators.4.js and promotions.3.js; it replaces the list view only, not the app file. */
(function () {
  if (typeof vHub !== "function" || typeof safety !== "function") return;
  const KINDS = [["both", "Casino & Sportsbook"], ["casino", "Casino"], ["sportsbook", "Sportsbook"]];
  const kindOf = window.opKind || (o => o.type === "sportsbook" ? "sportsbook" : "casino");
  const kindLabel = o => (KINDS.find(k => k[0] === kindOf(o)) || KINDS[1])[1];
  const PICKS = 6, ROWS_SHOWN = 12;   // desktop: up to 12 tiles per type before "Show all"
  const initials = o => { const w = o.name.replace(/[^A-Za-z0-9 .]/g, "").split(/[ .]/).filter(Boolean);
    return esc((w.length > 1 ? w.map(x => x[0]).join("") : (w[0] || "?").slice(0, 2)).slice(0, 3).toUpperCase()); };

  function tile(o) {
    const s = safety(o);
    const aff = typeof affLinkFor === "function" && !o.blacklist && !o.warning && s.score >= 5 ? affLinkFor(o.slug) : null;
    const logo = o.logo ? `<img src="${esc(o.logo)}" alt="${esc(o.name)} logo" loading="lazy">` : `<span class="ct-init" style="background:${esc(o.color || "#334155")}">${initials(o)}</span>`;
    return `<article class="ct">
      <div class="ct-logo">${logo}</div>
      <h3 class="ct-name">${link(opPath(o), esc(o.name), "ct-hit")}</h3>
      <span class="ct-kind">${esc(kindLabel(o))}</span>
      <span class="ct-si si-${s.tone}" title="Safety Index ${s.score.toFixed(1)} of 10: ${esc(s.label)}"><b>${s.score.toFixed(1)}</b>${esc(s.label)}</span>
      ${warnBadge(o)}
      <div class="ct-act">${aff
        ? `${link(opPath(o), "Read review", "ct-rev")}${affButton(aff, "casino-list", "Play", "btn primary ct-play")}<span class="ct-tc">18+ · T&amp;Cs apply</span>`
        : `${link(opPath(o), "Read review", "btn primary ct-play")}`}</div>
    </article>`;
  }
  const row = (id, title, list, n, open) => `<section class="ct-sec" aria-labelledby="${id}">
      <div class="ct-head"><h2 class="cl-h" id="${id}">${title} <span class="ct-n">${n}</span></h2>
        ${n > ROWS_SHOWN ? `<button class="btn small ghost ct-all" type="button" data-act="hubOpen" data-id="${id}">${open ? "Show fewer" : `Show all ${n}`}</button>` : ""}</div>
      <div class="ct-row${open ? " open" : ""}" role="list">${list.map((o, i) => tile(o).replace('<article class="ct">', `<article class="ct${i >= ROWS_SHOWN ? " ct-more" : ""}" role="listitem">`)).join("")}</div>
    </section>`;

  vHub = function (qs = {}) {
    if (gated()) return ageGate();
    S.ui.hub = S.ui.hub || {}; S.ui.hubOpen = S.ui.hubOpen || {};
    if (KINDS.some(k => k[0] === qs.type)) S.ui.hub.kind = qs.type;
    if (PAY_TYPES.some(p => p[0] === qs.pay)) S.ui.hub.pay = qs.pay;
    const f = Object.assign({kind: "all", pay: "all", sort: "safety"}, S.ui.hub);
    const listed = OPERATORS.filter(o => !o.blacklist), nBlack = OPERATORS.length - listed.length;
    const byType = listed.filter(o => f.kind === "all" || kindOf(o) === f.kind);
    let list = byType.filter(o => f.pay === "all" || payType(o) === f.pay);
    const key = {safety: o => -safety(o).score, feedback: o => -(feedbackLabel(o).avg || 0), newest: o => -(+o.est || 0), name: o => 0};
    list.sort((a, b) => f.sort === "name" ? a.name.localeCompare(b.name) : key[f.sort](a) - key[f.sort](b));
    // Top picks: only on the unfiltered default view
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
    const groups = KINDS.map(([k, t]) => [k, t, list.filter(o => kindOf(o) === k)]).filter(g => g[2].length);
    const empty = `<div class="panel empty">${OPERATORS.length ? `Nothing matches these filters. <button class="btn small" type="button" data-act="hubReset">Show all</button>` : `No casinos or sportsbooks have been added yet.${can("manageCategories") ? ` ${link("/admin/businesses", "Add the first one")}.` : ""}`}</div>`;
    return crumbs(["Gambling", "/gambling"], ["Casinos & sportsbooks"]) +
      phead("Casinos & sportsbooks", "Every casino and sportsbook gets a Safety Index from its licence, complaint handling, terms and member reviews. Tap one for the full review.",
        `<button class="btn" type="button" data-act="fileComplaint">File a complaint</button>${kindButton({kind: "review"})}`) +
      filters +
      (picks.length ? row("ctPicks", "Top picks", picks, picks.length, true) : "") +
      (groups.length ? groups.map(([k, t, g]) => row("ct-" + k, picks.length || groups.length > 1 ? t : "Results", g, g.length, !!S.ui.hubOpen["ct-" + k])).join("") : (picks.length ? "" : empty)) +
      `<div class="cl-foot">
        ${nBlack ? `<div class="notice red"><strong>${nBlack} blacklisted operator${nBlack > 1 ? "s are" : " is"} not listed here.</strong><span>${link("/blacklist", "See the blacklist")} and why we warn players to avoid them.</span></div>` : ""}
        <p class="muted cl-how">Advertising and affiliate deals never change a Safety Index. ${link("/page/safety-index", "How we rate")} · ${link("/complaints", "Complaint Center")}</p>
      </div>`;
  };
  CHANGE.hubKind = el => { S.ui.hub = Object.assign(S.ui.hub || {}, {kind: el.value}); render(); };
  ACT.hubReset = () => { S.ui.hub = {kind: "all", pay: "all", sort: "safety"}; render(); };
  ACT.hubOpen = el => { S.ui.hubOpen = S.ui.hubOpen || {}; S.ui.hubOpen[el.dataset.id] = !S.ui.hubOpen[el.dataset.id]; render(); };
  // Tapping anywhere on a tile (not on a button or link) opens the review
  document.addEventListener("click", e => {
    const c = e.target.closest(".ct"); if (!c || e.target.closest("a,button")) return;
    const a = c.querySelector("a.ct-hit"); if (a) a.click();
  });
  try { render(); } catch (e) {}
})();
