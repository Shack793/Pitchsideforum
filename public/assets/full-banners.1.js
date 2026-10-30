/* Pitchside Forum: full-image banners for the ad spaces.
   Each ad can have an optional "full banner" picture that fills its space instead of the text layout:
     Homepage banner:  computers 2340 × 164 (shows about 1170 × 82), phones 716 × 252 (shows about 358 × 126)
     Side ad:          320 × 1200 (shows at 160 × 600; side ads only appear on wide screens)
     In-post ad:       computers 2240 × 280 (shows about 1120 × 140), phones 716 × 300 (shows about 358 × 150)
   If only the computer picture is set, phones use it too (shrunk). The ad keeps its "Sponsored" label, click
   counting and affiliate tracking; its headline becomes the picture's alt text.
   Saved as "full" (computers) and "fullM" (phones) on the ad. Loaded after ads-tweaks.2.js. */
(function () {
  if (typeof adBanner !== "function" || typeof railAdHtml !== "function") return;
  const SPECS = {
    bannerEdit: {list: () => BANNERS, d: "2340 × 164", m: "716 × 252", shows: "about 1170 × 82 on computers, 358 × 126 on phones"},
    sideAdEdit: {list: () => SIDE_ADS, d: "320 × 1200", m: null, shows: "160 × 600, on wide screens only"},
    postAdEdit: {list: () => POST_ADS, d: "2240 × 280", m: "716 × 300", shows: "about 1120 × 140 on computers, 358 × 150 on phones"}
  };
  const label = a => `<span class="fb-label">${a.house ? "From Pitchside Forum" : `Sponsored · ${esc(a.advertiser || "")}`}</span>`;
  const pic = (a, cls) => `<picture class="fb-pic ${cls}">${a.fullM ? `<source media="(max-width: 640px)" srcset="${esc(a.fullM)}">` : ""}<img src="${esc(a.full)}" alt="${esc(a.headline || a.advertiser || "Advertisement")}" loading="lazy" decoding="async"></picture>`;

  // Homepage banner: swap a slide's text layout for its picture
  const baseBanner = adBanner;
  adBanner = function () {
    let h = baseBanner.apply(this, arguments);
    BANNERS.forEach(b => {
      if (!b.full) return;
      h = h.replace(new RegExp(`(<a class="ad-slide)([^"]*)("[^>]*data-id="${b.id}"[^>]*>)[\\s\\S]*?(</a>)`), (m, a1, cls, rest, end) => `${a1}${cls} ad-full${rest}${pic(b, "fb-home")}${label(b)}${end}`);
    });
    return h;
  };
  // Side ads
  const baseRail = railAdHtml;
  railAdHtml = function (a) {
    const h = baseRail.apply(this, arguments);
    if (!a || !a.full) return h;
    const open = h.slice(0, h.indexOf(">") + 1).replace('class="rail-ad"', 'class="rail-ad rail-full"');
    return `${open}${pic(a, "fb-side")}${label(a)}</a>`;
  };
  // In-post ad
  if (typeof postAd === "function") {
    const basePost = postAd;
    postAd = function (t) {
      const h = basePost.apply(this, arguments);
      if (!h) return h;
      const id = +((h.match(/data-ad="(\d+)"/) || h.match(/data-act="postAdClick" data-id="(\d+)"/) || [])[1]);
      const a = POST_ADS.find(x => x.id === id); if (!a || !a.full) return h;
      const m = h.match(/<a class="op-cta"[^>]*>/); if (!m) return h;
      const open = m[0].replace('class="op-cta"', 'class="fb-post-link"').replace(/ style="[^"]*"/, "");
      return `<aside class="op-ad op-ad-full" aria-label="Advertisement">${open}${pic(a, "fb-post")}${label(a)}</a></aside>`;
    };
  }

  // Admin forms: "Full banner image" fields
  const read = (file, max) => new Promise((res, rej) => {
    if (!file) return res(null);
    if (!/^image\//.test(file.type)) return rej(new Error("Choose a picture (JPG, PNG or WebP)."));
    if (file.size > 25e6) return rej(new Error("That picture is over 25 MB. Choose a smaller one."));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let d = c.toDataURL(/png|webp|gif/.test(file.type) ? "image/png" : "image/jpeg", 0.9);
      if (d.length > 5.2e6) d = c.toDataURL("image/jpeg", 0.85);
      res(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That picture couldn't be read. Try a JPG or PNG.")); };
    img.src = url;
  });
  const FB = {full: undefined, fullM: undefined};
  const prev = (k, src) => `<span class="fb-prev" id="fbPrev-${k}">${src ? `<img src="${esc(src)}" alt=""><button type="button" class="btn small ghost" data-act="fbDel" data-k="${k}">Remove</button>` : '<span class="hint">None</span>'}</span>`;
  Object.entries(SPECS).forEach(([name, spec]) => {
    const inner = ACT[name]; if (typeof inner !== "function") return;
    ACT[name] = function (el) {
      const id = el && el.dataset && el.dataset.id ? +el.dataset.id : null;
      const before = new Set((spec.list() || []).map(x => x.id));
      const cur = id ? (spec.list() || []).find(x => x.id === id) : null;
      FB.full = cur ? cur.full || null : null; FB.fullM = cur ? cur.fullM || null : null;
      const r = inner.apply(this, arguments);
      const form = document.getElementById("modalForm"); if (!form || typeof modalSubmit !== "function") return r;
      const anchor = form.querySelector(".dacts") || form.lastElementChild;
      const box = document.createElement("fieldset"); box.className = "fb-box";
      box.innerHTML = `<legend>Full banner image <span class="hint">(optional)</span></legend>
        <p class="hint" style="margin:0 0 8px">Fills the whole ad space instead of the text layout. Shows ${spec.shows}. The headline is used as the picture's description, and the ad is still labelled Sponsored.</p>
        <label>Computers <span class="hint">${spec.d} px</span><input type="file" accept="image/*" data-fb="full"></label>${prev("full", FB.full)}
        ${spec.m ? `<label>Phones <span class="hint">${spec.m} px (optional; computers picture is used if empty)</span><input type="file" accept="image/*" data-fb="fullM"></label>${prev("fullM", FB.fullM)}` : ""}`;
      anchor.before(box);
      const orig = modalSubmit;
      modalSubmit = function () {
        const res = orig.apply(this, arguments);
        const apply = () => {
          const list = spec.list() || [];
          const item = id ? list.find(x => x.id === id) : list.find(x => !before.has(x.id));
          if (!item) return;
          if ((item.full || null) === FB.full && (item.fullM || null) === FB.fullM) return;
          item.full = FB.full || null; item.fullM = spec.m ? FB.fullM || null : null;
          render(); if (typeof schedulePush === "function") schedulePush();
        };
        if (res && typeof res.then === "function") res.then(err => { if (!err) apply(); }); else if (!res) apply();
        return res;
      };
      return r;
    };
  });
  document.addEventListener("change", e => {
    const inp = e.target.closest && e.target.closest("input[data-fb]"); if (!inp) return;
    const k = inp.dataset.fb;
    read(inp.files && inp.files[0], 2400).then(d => { if (!d) return; FB[k] = d; const p = document.getElementById("fbPrev-" + k); if (p) p.outerHTML = prev(k, d); })
      .catch(err => { inp.value = ""; toast(err.message); });
  });
  ACT.fbDel = el => { const k = el.dataset.k; FB[k] = null; const p = document.getElementById("fbPrev-" + k); if (p) p.outerHTML = prev(k, null); const i = document.querySelector(`#modalForm input[data-fb="${k}"]`); if (i) i.value = ""; };
  try { render(); } catch (e) {}
})();
