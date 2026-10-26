/* Pitchside Forum: Promotions & bonuses page (/promotions), under Gambling.
   Admins add, edit, schedule, pause and delete offers right on the page; offers are saved as the
   "PROMOS" site setting on the server. "Get bonus" buttons go through the tracked /go/ affiliate
   redirect (placement "promotions") when the offer or its operator has an affiliate link.
   Offers from blacklisted operators, paused offers and offers outside their dates are hidden from members. */
(function () {
  if (typeof liveGate !== "function" || typeof api !== "function") return;
  let PROMOS = [];
  const fromBoot = d => { if (d && d.docs && Array.isArray(d.docs.PROMOS)) PROMOS = d.docs.PROMOS; };
  fromBoot(window.PS_BOOT);
  const applyBase = apply;
  apply = function (d) { fromBoot(d); return applyBase(d); };

  const TYPES = [["welcome","Welcome bonus"],["no-deposit","No-deposit bonus"],["free-spins","Free spins"],["free-bet","Free bet"],["reload","Reload bonus"],["cashback","Cashback"],["crypto","Crypto bonus"],["other","Other"]];
  const typeLabel = k => (TYPES.find(t => t[0] === k) || [k, "Offer"])[1];
  const now = () => Date.now();
  const status = p => p.paused ? "Paused" : (p.start && now() < p.start) ? "Scheduled" : (p.end && now() > p.end) ? "Ended" : "Live";
  const opOf = p => p.op ? OPERATORS.find(o => o.slug === p.op) : null;
  const isAdmin = () => typeof can === "function" && can("manageCategories");
  const visible = p => { const o = opOf(p); return status(p) === "Live" && !(o && o.blacklist); };
  const dayStr = t => t ? new Date(t).toISOString().slice(0, 10) : "";
  const left = t => { const d = Math.ceil((t - now()) / 86400000); return d <= 0 ? "Ends today" : d === 1 ? "Ends tomorrow" : d <= 14 ? `Ends in ${d} days` : `Until ${dday(t)}`; };
  // Where "Get bonus" goes: the offer's affiliate link, else the operator's, else the offer's own address
  function target(p) {
    const l = (p.aff && affById(p.aff)) || (p.op && affLinkFor(p.op));
    if (l && l.status === "active") return `/go/${encodeURIComponent(l.slug)}?p=promotions`;
    return p.url && /^https:\/\//.test(p.url) ? p.url : null;
  }

  function card(p) {
    const o = opOf(p), st = status(p), go = target(p);
    const crestHtml = o ? opCrest(o, 46) : `<span class="crest" style="background:var(--head);width:46px;height:46px;font-size:15px;border-radius:12px">${esc((p.brand || "?").slice(0, 2).toUpperCase())}</span>`;
    const name = o ? link(opPath(o), esc(o.name)) : esc(p.brand || "");
    const terms = [p.minDeposit && `Min. deposit ${esc(p.minDeposit)}`, p.wagering && `Wagering ${esc(p.wagering)}`, p.countries && `Countries: ${esc(p.countries)}`].filter(Boolean);
    return `<article class="promo${p.featured ? " promo-feat" : ""}" id="promo-${p.id}">
      <div class="promo-head">${crestHtml}<div style="min-width:0"><div class="promo-op">${name} ${o ? safetyBadge(o, "sm") : ""}</div>
        <div class="row" style="gap:6px;margin-top:4px"><span class="pill">${esc(typeLabel(p.type))}</span>${p.featured ? '<span class="pill green">Featured</span>' : ""}${p.exclusive ? '<span class="pill blue">Pitchside exclusive</span>' : ""}
        ${isAdmin() && st !== "Live" ? `<span class="pill amber">${st}</span>` : ""}</div></div></div>
      <h3 class="promo-title">${esc(p.title)}</h3>
      ${p.desc ? `<p class="promo-desc">${esc(p.desc)}</p>` : ""}
      ${terms.length ? `<p class="promo-terms">${terms.join(" · ")}</p>` : ""}
      <div class="promo-foot">
        ${p.code ? `<button class="promo-code" type="button" data-act="promoCopy" data-code="${esc(p.code)}" title="Copy code">Code <strong class="mono">${esc(p.code)}</strong> <span aria-hidden="true">⧉</span></button>` : `<span class="muted" style="font-size:.85rem">No code needed</span>`}
        <span class="muted" style="font-size:.85rem">${p.end ? left(p.end) : "Ongoing"}</span>
        ${go ? `<a class="btn primary promo-go" href="${esc(go)}" target="_blank" rel="noopener sponsored">Get bonus <span aria-hidden="true">↗</span></a>` : ""}
      </div>
      <p class="promo-small">18+ · New customers only unless stated · Full T&Cs apply on the operator's site · ${o && o.affiliate || p.aff ? "Affiliate link · " : ""}Gamble responsibly</p>
      ${isAdmin() ? `<div class="row promo-admin"><button class="btn small" type="button" data-act="promoEdit" data-id="${p.id}">Edit</button>
        <button class="btn small" type="button" data-act="promoPause" data-id="${p.id}">${p.paused ? "Resume" : "Pause"}</button>
        <button class="btn small ghost" type="button" data-act="promoDel" data-id="${p.id}">Delete</button></div>` : ""}
    </article>`;
  }

  function vPromotions() {
    if (typeof gated === "function" && gated()) return ageGate();
    const f = S.ui.promoType || "all", pay = S.ui.promoPay || "all";
    const admin = isAdmin();
    let list = PROMOS.filter(p => admin || visible(p));
    const counts = Object.fromEntries(TYPES.map(([k]) => [k, list.filter(p => p.type === k).length]));
    if (f !== "all") list = list.filter(p => p.type === f);
    if (pay !== "all") list = list.filter(p => { const o = opOf(p); return o && payType(o) === pay; });
    list.sort((a, b) => (b.featured - a.featured) || (status(a) === "Live" ? 0 : 1) - (status(b) === "Live" ? 0 : 1) || ((a.end || 9e15) - (b.end || 9e15)));
    const chips = `<div class="row" style="gap:6px;margin-bottom:12px">${[["all", "All offers", PROMOS.filter(p => admin || visible(p)).length], ...TYPES.filter(([k]) => counts[k]).map(([k, t]) => [k, t, counts[k]])]
      .map(([k, t, n]) => `<button type="button" class="btn small${f === k ? " on" : ""}" data-act="promoType" data-k="${k}" aria-pressed="${f === k}">${esc(t)} <span class="muted">${n}</span></button>`).join("")}</div>`;
    const payBox = `<label class="row" style="gap:6px;font-size:.9rem">Filter by payment method <select class="inp" style="width:auto" data-change="promoPay" aria-label="Filter by payment method">
      <option value="all">All</option>${PAY_TYPES.map(([k, t]) => `<option value="${k}" ${pay === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
    return crumbs(["Gambling", "/gambling"], ["Promotions & bonuses"]) +
      phead("Promotions & bonuses", "The latest welcome offers, free spins, free bets and reload bonuses. Check the Safety Index and the full terms before you deposit.",
        admin ? `<button class="btn primary" type="button" data-act="promoEdit">Add a promotion</button>` : "") +
      `<div class="notice" style="margin-bottom:14px"><span><strong>18+ only.</strong> Bonuses come with wagering requirements and other terms set by the operator. Some links are affiliate links, and Pitchside may earn a commission; that never changes a Safety Index. ${link("/forum/responsible-gambling", "Gamble responsibly")}.</span></div>
      <div class="spread" style="flex-wrap:wrap;gap:8px">${chips}${payBox}</div>
      ${list.length ? `<div class="promo-grid">${list.map(card).join("")}</div>`
        : `<section class="panel empty">${PROMOS.length ? "No offers match these filters." : `No promotions yet.${admin ? " Use <strong>Add a promotion</strong> to post the first one." : " Check back soon."}`}</section>`}`;
  }

  // Route /promotions
  const gateBase = liveGate;
  liveGate = function (seg, qs) {
    if ((seg[0] || "") === "promotions") return SOON && !featureOn("casinos") ? vSoon("Promotions & bonuses", "Casino and sportsbook promotions open with the casino directory.") : vPromotions();
    return gateBase(seg, qs);
  };

  async function savePromos(next, okMsg) {
    try {
      const r = await api("config.save", {k: "PROMOS", v: next, ver: PS.docVers.PROMOS});
      PROMOS = next; if (r && r.ver) PS.docVers.PROMOS = r.ver; if (okMsg) toast(okMsg); render();
    } catch (e) { return e.message; }
  }
  Object.assign(ACT, {
    promoType(el) { S.ui.promoType = el.dataset.k; render(); },
    promoCopy(el) { const c = el.dataset.code; try { navigator.clipboard.writeText(c).then(() => toast(`Copied ${c}`), () => toast(`Code: ${c}`)); } catch (e) { toast(`Code: ${c}`); } },
    promoPause(el) { const id = +el.dataset.id; savePromos(PROMOS.map(p => p.id === id ? Object.assign({}, p, {paused: !p.paused}) : p), "Saved"); },
    promoDel(el) { const p = PROMOS.find(x => x.id === +el.dataset.id); if (!p) return;
      modal({title: `Delete “${p.title}”?`, submit: "Delete", danger: true, body: `<p style="margin:0">This removes the offer from the page.</p>`,
        onSubmit: () => savePromos(PROMOS.filter(x => x.id !== p.id), "Promotion deleted") }); },
    promoEdit(el) {
      const p = el && el.dataset && el.dataset.id ? PROMOS.find(x => x.id === +el.dataset.id) : null;
      const v = (k, d = "") => esc(p && p[k] != null ? p[k] : d);
      modal({title: p ? "Edit promotion" : "Add a promotion", submit: p ? "Save" : "Add", body: `
        <div class="row"><label style="flex:2 1 220px">Casino or sportsbook<select name="op"><option value="">Not listed on Pitchside</option>${OPERATORS.map(o => `<option value="${o.slug}" ${p && p.op === o.slug ? "selected" : ""}>${esc(o.name)}${o.blacklist ? " (blacklisted)" : ""}</option>`).join("")}</select></label>
          <label style="flex:1 1 160px">Brand name <span class="hint">If not listed</span><input name="brand" value="${v("brand")}"></label></div>
        <div class="row"><label style="flex:2 1 220px">Offer headline<input name="title" maxlength="90" required value="${v("title")}" placeholder="e.g. 100% up to $500 + 50 free spins"></label>
          <label style="flex:1 1 160px">Type<select name="type">${TYPES.map(([k, t]) => `<option value="${k}" ${p && p.type === k ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
        <label>Details <span class="hint">Optional, one or two sentences</span><textarea name="desc" maxlength="300" style="min-height:60px">${v("desc")}</textarea></label>
        <div class="row"><label style="flex:1 1 140px">Bonus code <span class="hint">Optional</span><input name="code" maxlength="30" value="${v("code")}"></label>
          <label style="flex:1 1 140px">Min. deposit<input name="minDeposit" maxlength="30" value="${v("minDeposit")}" placeholder="$20"></label>
          <label style="flex:1 1 140px">Wagering<input name="wagering" maxlength="40" value="${v("wagering")}" placeholder="35× bonus"></label></div>
        <div class="row"><label style="flex:1 1 200px">Countries <span class="hint">Optional</span><input name="countries" maxlength="80" value="${v("countries")}" placeholder="UK, IE"></label>
          <label style="flex:2 1 240px">Affiliate link<select name="aff"><option value="">Use the operator's link, if any</option>${AFF_LINKS.map(l => `<option value="${l.id}" ${p && p.aff === l.id ? "selected" : ""}>${esc(l.name)}${l.status !== "active" ? " (paused)" : ""}</option>`).join("")}</select></label></div>
        <label>Offer page address <span class="hint">Used only when there's no affiliate link. https://…</span><input name="url" value="${v("url")}" placeholder="https://"></label>
        <div class="row"><label style="flex:1">Starts<input type="date" name="start" value="${dayStr(p ? p.start : now())}"></label><label style="flex:1">Ends <span class="hint">Empty = ongoing</span><input type="date" name="end" value="${dayStr(p ? p.end : now() + 30 * 864e5)}"></label></div>
        <div class="row"><label class="chk"><input type="checkbox" name="featured" ${p && p.featured ? "checked" : ""}> Featured (shown first)</label><label class="chk"><input type="checkbox" name="exclusive" ${p && p.exclusive ? "checked" : ""}> Pitchside exclusive</label></div>`,
        onSubmit: f => {
          const g = k => f.elements[k].value.trim();
          if (g("title").length < 5) return "Write the offer headline.";
          if (!g("op") && !g("brand")) return "Pick the casino or sportsbook, or type the brand name.";
          if (g("url") && !/^https:\/\/\S+\.\S+/.test(g("url"))) return "The offer page address must start with https://";
          const start = g("start") ? new Date(g("start")).getTime() : now(), end = g("end") ? new Date(g("end")).getTime() + 864e5 - 1 : null;
          if (end && end <= start) return "The end date must be after the start date.";
          const o = g("op") && OPERATORS.find(x => x.slug === g("op"));
          if (o && o.blacklist) return `${o.name} is blacklisted, so its offers can't be promoted.`;
          if (o && o.warning && o.warning.status === "confirmed") return `${o.name} has a confirmed scam finding and can't be promoted.`;
          const data = {op: g("op") || null, brand: g("brand"), title: g("title"), type: g("type"), desc: g("desc"), code: g("code"), minDeposit: g("minDeposit"), wagering: g("wagering"),
            countries: g("countries"), aff: +g("aff") || null, url: g("url"), start, end, featured: f.elements.featured.checked, exclusive: f.elements.exclusive.checked};
          const next = p ? PROMOS.map(x => x.id === p.id ? Object.assign({}, x, data) : x)
                         : [Object.assign({id: Math.max(0, ...PROMOS.map(x => x.id || 0)) + 1, paused: false, created: now()}, data), ...PROMOS];
          return savePromos(next, p ? "Promotion saved" : "Promotion added");
        }});
    }
  });
  CHANGE.promoPay = el => { S.ui.promoPay = el.value; render(); };
  // Casinos & Sportsbooks list: same wording for its payments filter (the options stay the same)
  if (typeof vHub === "function") {
    const baseHub = vHub;
    vHub = function () { return baseHub.apply(this, arguments).replace('font-weight:600">Payments <select', 'font-weight:600">Filter by payment method <select'); };
  }
  try { render(); } catch (e) {}
})();
