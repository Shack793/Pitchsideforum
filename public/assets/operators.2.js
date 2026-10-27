/* Pitchside Forum: casino and sportsbook listings.
   - Three listing types: Casino, Casino & Sportsbook, Sportsbook (with a Type filter on Casinos & Sportsbooks).
   - Admins upload a logo and up to 8 listing images (screenshots, promo art) in Admin → Businesses.
   - Logos show instead of the coloured initials, and logos are larger everywhere.
   - Listing images show as a gallery on the operator's page; click one to see it full size.
   Loaded after the main app script; it only wraps app functions, it doesn't change the app file. */
(function () {
  if (typeof opCrest !== "function" || typeof vHub !== "function") return;
  const KINDS = [["casino", "Casino"], ["both", "Casino & Sportsbook"], ["sportsbook", "Sportsbook"]];
  const kindOf = o => o.kind || (o.casino && o.sportsbook ? "both" : o.type === "sportsbook" ? "sportsbook" : "casino");
  const kindLabel = o => (KINDS.find(k => k[0] === kindOf(o)) || KINDS[0])[1];
  window.opKind = kindOf;

  // Logos: the uploaded logo when there is one, and 40% bigger than before. The app's crest helper can't be
  // replaced, so each view's output has the original crest swapped for this one.
  const SCALE = 1.4, SIZES = [44, 46, 64];
  const bigCrest = (o, px = 44) => {
    const s = Math.round(px * SCALE);
    if (o && o.logo) return `<img class="crest op-logo" src="${esc(o.logo)}" alt="${esc(o.name)} logo" style="width:${s}px;height:${s}px;border-radius:${Math.round(s / 4)}px">`;
    return `<span class="crest op-big" style="background:${o.color};width:${s}px;height:${s}px;font-size:${s / 3.2}px;border-radius:${s / 4}px">${esc(opInitials(o))}</span>`;
  };
  window.opCrestBig = bigCrest;
  // One pass: each original crest is looked up and swapped once (an enlarged crest is never enlarged again)
  function upgradeCrests(h) {
    if (typeof h !== "string" || h.indexOf('<span class="crest"') < 0) return h;
    const map = new Map();
    for (const o of OPERATORS) for (const px of SIZES) map.set(opCrest(o, px), bigCrest(o, px));
    return h.replace(/<span class="crest"[^>]*>[^<]*<\/span>/g, m => map.has(m) ? map.get(m) : m);
  }
  const wrapView = name => {
    const base = window[name]; if (typeof base !== "function") return;
    try { window[name] = function () { return upgradeCrests(base.apply(this, arguments)); }; } catch (e) {}
  };
  // function declarations live on window, so they can be wrapped
  ["recordHead", "vBlacklist", "vGambling"].forEach(wrapView);
  if (typeof liveGate === "function") { const baseGate = liveGate; liveGate = function () { return upgradeCrests(baseGate.apply(this, arguments)); }; }

  // Listing cards: show Casino / Casino & Sportsbook / Sportsbook
  if (typeof opCard === "function") {
    const baseCard = opCard;
    opCard = function (o) { return upgradeCrests(baseCard.apply(this, arguments)).replace(/<span class="pill">(Casino|Sportsbook)<\/span>/, `<span class="pill">${esc(kindLabel(o))}</span>`); };
  }

  // Casinos & Sportsbooks: a Type filter next to "Filter by payment method"
  const baseHub = vHub;
  vHub = function (qs = {}) {
    if (KINDS.some(k => k[0] === qs.type)) S.ui.hub = Object.assign(S.ui.hub || {}, {kind: qs.type});
    const kind = (S.ui.hub || {}).kind || "all";
    const all = OPERATORS, listed = all.filter(o => !o.blacklist);
    let h;
    try { if (kind !== "all") OPERATORS = all.filter(o => kindOf(o) === kind); h = baseHub.apply(this, arguments); }
    finally { OPERATORS = all; }
    const n = k => listed.filter(o => kindOf(o) === k).length;
    const sel = `<label class="row" style="gap:6px;font-size:.92rem;font-weight:600">Type <select class="inp" style="width:auto;font-weight:600" data-change="hubKind" id="hubKind">
      <option value="all">All types (${listed.length})</option>${KINDS.map(([k, t]) => `<option value="${k}" ${kind === k ? "selected" : ""}>${t} (${n(k)})</option>`).join("")}</select></label>`;
    return h.replace(/(<form class="panel row" data-form="dir"[^>]*>)/, `$1${sel}`);
  };
  CHANGE.hubKind = el => { S.ui.hub = Object.assign(S.ui.hub || {}, {kind: el.value}); render(); };

  // Operator page: type label, and the image gallery on the Overview tab
  if (typeof vOperator === "function") {
    const baseOp = vOperator;
    vOperator = function (slug, qs = {}) {
      let h = upgradeCrests(baseOp.apply(this, arguments));
      const o = typeof op === "function" ? op(slug) : null; if (!o) return h;
      h = h.replace(`<span class="pill">${o.type}</span>`, `<span class="pill">${esc(kindLabel(o))}</span>`);
      const imgs = (o.images || []).filter(Boolean);
      if (imgs.length && !(qs && qs.tab)) {
        const gal = `<section class="op-gallery" aria-label="${esc(o.name)} images">${imgs.map((src, i) => `<button type="button" data-act="opImg" data-slug="${esc(o.slug)}" data-i="${i}" aria-label="View image ${i + 1} of ${imgs.length}"><img src="${esc(src)}" alt="${esc(o.name)} image ${i + 1}" loading="lazy"></button>`).join("")}</section>`;
        const k = h.indexOf('<nav class="subnav"');
        if (k > -1) { const e = h.indexOf("</nav>", k) + 6; h = h.slice(0, e) + gal + h.slice(e); }
      }
      return h;
    };
  }

  // ----- Admin → Businesses: add / edit with logo and images -----
  const ED = {logo: null, images: []};
  function shrink(file, maxSide, keepAlpha) {
    return new Promise((res, rej) => {
      if (!/^image\//.test(file.type)) return rej(new Error("Choose a JPG, PNG, WebP or GIF image."));
      if (file.size > 15e6) return rej(new Error("That image is over 15 MB. Choose a smaller one."));
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const r = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(im.naturalWidth * r)); c.height = Math.max(1, Math.round(im.naturalHeight * r));
        const x = c.getContext("2d"); if (!keepAlpha) { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(keepAlpha ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.86));
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That file couldn't be read as an image.")); };
      im.src = url;
    });
  }
  function drawMedia() {
    const L = document.getElementById("opLogoBox"), G = document.getElementById("opImgBox"); if (!L || !G) return;
    L.innerHTML = ED.logo ? `<img src="${esc(ED.logo)}" alt="Logo preview" class="op-logo" style="width:96px;height:96px;border-radius:24px"><button class="btn small ghost" type="button" data-act="opLogoDel">Remove logo</button>`
      : `<span class="muted" style="font-size:.88rem">No logo: the coloured initials are shown.</span>`;
    G.innerHTML = ED.images.map((src, i) => `<div class="op-thumb"><img src="${esc(src)}" alt="Image ${i + 1}"><div class="row" style="gap:4px">
      <button class="btn small ghost" type="button" data-act="opImgMove" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Move left">←</button>
      <button class="btn small ghost" type="button" data-act="opImgMove" data-i="${i}" data-d="1" ${i === ED.images.length - 1 ? "disabled" : ""} aria-label="Move right">→</button>
      <button class="btn small ghost" type="button" data-act="opImgDel" data-i="${i}" aria-label="Remove image ${i + 1}">✕</button></div></div>`).join("")
      || `<span class="muted" style="font-size:.88rem">No images yet.</span>`;
    const add = document.getElementById("opImgAdd"); if (add) add.disabled = ED.images.length >= 8;
  }
  CHANGE.opLogoFile = async el => {
    const f = el.files && el.files[0]; if (!f) return;
    try { ED.logo = await shrink(f, 512, true); drawMedia(); } catch (e) { toast(e.message); }
    el.value = "";
  };
  CHANGE.opImgFiles = async el => {
    const files = [...(el.files || [])].slice(0, 8 - ED.images.length);
    for (const f of files) { try { ED.images.push(await shrink(f, 1600, false)); } catch (e) { toast(e.message); } }
    if ((el.files || []).length > files.length) toast("Up to 8 images per listing.");
    el.value = ""; drawMedia();
  };

  Object.assign(ACT, {
    opImg(el) {
      const o = op(el.dataset.slug), i = +el.dataset.i, src = (o.images || [])[i]; if (!src) return;
      modal({title: `${o.name} · image ${i + 1} of ${o.images.length}`, submit: "Close", noCancel: true,
        body: `<img src="${esc(src)}" alt="" style="display:block;width:100%;max-height:70vh;object-fit:contain;border-radius:8px;background:var(--sunk)">`, onSubmit: () => {}});
    },
    opLogoDel() { ED.logo = null; drawMedia(); },
    opImgDel(el) { ED.images.splice(+el.dataset.i, 1); drawMedia(); },
    opImgMove(el) { const i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= ED.images.length) return; [ED.images[i], ED.images[j]] = [ED.images[j], ED.images[i]]; drawMedia(); },
    opAdmin(el) {
      const o = el && el.dataset && el.dataset.slug ? op(el.dataset.slug) : null;
      ED.logo = o && o.logo || null; ED.images = o && o.images ? [...o.images] : [];
      const v = (k, d = "") => esc(o ? (Array.isArray(o[k]) ? o[k].join(k === "pros" || k === "cons" || k === "unfairTerms" ? "\n" : ", ") : (o[k] ?? d)) : d);
      const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([k, t]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${t}</option>`).join("")}</select>`;
      modal({title: o ? `Edit ${o.name}` : "Add a casino or sportsbook", submit: o ? "Save" : "Add", body: `
        <div class="row"><label style="flex:2 1 200px">Name<input name="name" value="${v("name")}" required maxlength="80"></label>
          <label style="flex:1 1 180px">Type${sel("kind", KINDS, o ? kindOf(o) : "casino")}</label></div>
        <fieldset class="op-media"><legend>Logo</legend><div id="opLogoBox" class="row" style="gap:10px;align-items:center"></div>
          <label class="btn small" style="margin-top:6px;display:inline-flex">Upload logo<input type="file" accept="image/*" data-change="opLogoFile" hidden></label>
          <p class="hint" style="margin:6px 0 0">Square works best (at least 256 × 256). PNG with a transparent background is ideal.</p></fieldset>
        <fieldset class="op-media"><legend>Listing images <span class="hint">Up to 8: screenshots, games, promo art</span></legend><div id="opImgBox" class="op-thumbs"></div>
          <label class="btn small" style="margin-top:6px;display:inline-flex">Add images<input type="file" accept="image/*" multiple data-change="opImgFiles" id="opImgAdd" hidden></label>
          <p class="hint" style="margin:6px 0 0">Shown as a gallery on the listing page, in this order. Large photos are resized automatically.</p></fieldset>
        <div class="row"><label style="flex:2 1 200px">Website <span class="hint">e.g. example.com</span><input name="website" value="${v("website")}"></label>
          <label style="flex:1 1 140px">Brand colour <span class="hint">Used when there's no logo</span><input type="color" name="color" value="${o ? o.color : "#1E6FB0"}" style="height:40px"></label></div>
        <div class="row"><label style="flex:2 1 200px">Owner company<input name="owner" value="${v("owner")}"></label><label style="flex:1 1 120px">Established<input name="est" type="number" min="1990" max="2100" value="${v("est", new Date().getFullYear())}"></label></div>
        <div class="row"><label style="flex:2 1 200px">Licence number / text<input name="license" value="${v("license")}"></label>
          <label style="flex:1 1 160px">Regulator (for the Safety Index)${sel("regulator", [["mga", "Malta (MGA)"], ["ukgc", "UK Gambling Commission"], ["curacao", "Curaçao"], ["anjouan", "Anjouan"], ["none", "None disclosed"]], o ? o.regulator : "none")}</label></div>
        <div class="row"><label style="flex:1 1 160px">Size${sel("size", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]], o ? o.size : "small")}</label>
          <label style="flex:1 1 160px">Minimum deposit<input name="minDeposit" value="${v("minDeposit")}"></label><label style="flex:1 1 160px">Withdrawal limit<input name="withdrawalLimit" value="${v("withdrawalLimit")}"></label></div>
        <div class="row"><label class="chk"><input type="checkbox" name="fiat" ${!o || o.fiat ? "checked" : ""}> Fiat payments</label><label class="chk"><input type="checkbox" name="crypto" ${o && o.crypto ? "checked" : ""}> Crypto payments</label>
          <label class="chk"><input type="checkbox" name="poker" ${o && o.poker ? "checked" : ""}> Poker</label></div>
        <label>Countries <span class="hint">Comma-separated codes, e.g. GH, NG, UK</span><input name="countries" value="${v("countries")}"></label>
        <label>Withdrawal methods <span class="hint">Comma-separated</span><input name="withdrawals" value="${v("withdrawals")}"></label>
        <label>KYC policy<input name="kyc" value="${v("kyc")}"></label>
        <div class="row"><label style="flex:1 1 200px">Games<input name="games" value="${v("games")}"></label><label style="flex:1 1 160px">Languages<input name="languages" value="${v("languages")}"></label></div>
        <label>Pros <span class="hint">One per line</span><textarea name="pros" style="min-height:60px">${v("pros")}</textarea></label>
        <label>Cons <span class="hint">One per line</span><textarea name="cons" style="min-height:60px">${v("cons")}</textarea></label>
        <label>Unfair terms <span class="hint">One per line. Each lowers the Safety Index.</span><textarea name="unfairTerms" style="min-height:60px">${v("unfairTerms")}</textarea></label>`,
        onSubmit: f => {
          const g = k => f.elements[k].value.trim(), chk = k => f.elements[k].checked, lines = k => g(k).split("\n").map(x => x.trim()).filter(Boolean);
          if (g("name").length < 2) return "Give the operator a name.";
          const kind = g("kind");
          return viaApi("operator.save", {slug: o ? o.slug : "", data: {name: g("name"), kind, type: kind === "sportsbook" ? "sportsbook" : "casino", website: g("website"), color: g("color"), owner: g("owner"), est: +g("est"),
            license: g("license"), regulator: g("regulator"), size: g("size"), minDeposit: g("minDeposit"), withdrawalLimit: g("withdrawalLimit"), fiat: chk("fiat"), crypto: chk("crypto"), poker: chk("poker"),
            countries: g("countries"), withdrawals: g("withdrawals"), kyc: g("kyc"), games: g("games"), languages: g("languages"), pros: lines("pros"), cons: lines("cons"), unfairTerms: lines("unfairTerms"),
            logo: ED.logo, images: ED.images}},
            () => { toast(o ? "Saved" : "Added. It now appears in Casinos & Sportsbooks."); });
        }});
      drawMedia();
    }
  });
  try { render(); } catch (e) {}
})();
