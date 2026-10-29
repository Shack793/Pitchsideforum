/* Pitchside Forum: homepage banner rotation switch and steadier side ads.
   - Banner rotation is off unless Admin → Ads → "Rotate banners" is ticked (saved as SETTINGS.bannerRotate).
     While it's off, only the top live banner shows (paid banners come before the house ad) and nothing rotates.
     While it's on, banners rotate as before, but only when two or more are live.
   - A single banner no longer counts an impression every few seconds while it sits still.
   - Side slots: the layout class below lets the right slot show on screens from 1280px wide (see shell.html).
   - Which banner shows while rotation is off: the one marked "On homepage" in Admin → Ads (SETTINGS.bannerPick).
     Saving or creating a banner makes it the one shown, so a change is visible straight away; "Show this one"
     picks another. If the picked banner isn't live (paused, ended, or 18+ for a visitor who hasn't confirmed
     their age), the next live banner shows instead.
   - Edits that were silently lost: the ad editors (banners, side ads, in-post ads, ticker, affiliate links) kept a
     reference to the item from when the form opened. If the site refreshed its data in the background while the
     form was open (easy while choosing an image), "Save" changed that old copy and nothing reached the server.
     Saving now always updates the current item.
   - Banner images: big photos are shrunk in the browser before upload (so phone photos over 2 MB work), with a
     preview in the form. The image now shows on the homepage banner, on phones too (see shell.html).
   Loaded after the main app script; it only wraps app functions, it doesn't change the app file. */
(function () {
  if (typeof eligibleBanners !== "function" || typeof adStart !== "function") return;
  const rotateOn = () => SETTINGS.bannerRotate === true;

  const baseEligible = eligibleBanners;
  const picked = () => +(SETTINGS.bannerPick || 0);
  eligibleBanners = function () {
    const list = baseEligible(); if (rotateOn()) return list;
    const i = list.findIndex(b => b.id === picked());
    return i > 0 ? [list[i]] : list.slice(0, 1);
  };

  const baseStart = adStart;
  adStart = function () {
    baseStart();
    if (!rotateOn() || AD.list.length < 2) clearInterval(AD.timer);
  };

  // Admin → Ads: the "Rotate banners" switch next to the seconds box
  if (typeof aAds === "function") {
    const baseAds = aAds;
    aAds = function () {
      const on = rotateOn();
      return baseAds().replace(/ · rotates every (<input[^>]*id="bannerSecs"[^>]*>) seconds · pauses on hover/, (m, secs) =>
        ` · <label style="display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--fg);cursor:pointer"><input type="checkbox" data-change="bannerRotate" id="bannerRotate"${on ? " checked" : ""}> Rotate banners</label>` +
        (on ? ` every ${secs} seconds · pauses on hover` : ` <span>(off: only the banner marked “On homepage” shows)</span>`));
    };
  }
  CHANGE.bannerRotate = function (el) {
    if (typeof adminOnly === "function" && !adminOnly()) { el.checked = !el.checked; return; }
    SETTINGS.bannerRotate = el.checked; AD.i = 0; render();
    toast(el.checked ? "Banner rotation is on" : "Banner rotation is off. Only the banner marked “On homepage” shows");
  };

  // Admin → Ads: show which banner is on the homepage, and let admins pick it
  if (typeof bannerRows === "function") {
    const baseRows = bannerRows;
    bannerRows = function () {
      let h = baseRows();
      if (rotateOn()) return h;
      const cur = (() => { const l = eligibleBanners(); return l.length ? l[0].id : null; })();
      BANNERS.forEach(b => {
        const live = bannerStatus(b) === "Live";
        const tag = b.id === cur ? ' <span class="pill blue" title="This is the banner visitors see on the homepage">On homepage</span>' : "";
        const btn = live && b.id !== cur ? `<button class="btn small" type="button" data-act="bannerPick" data-id="${b.id}">Show this one</button>` : "";
        h = h.replace(new RegExp(`(<button class="btn small ghost" type="button" data-act="bannerEdit" data-id="${b.id}">Edit</button>)`), btn + "$1");
        // the status pill sits in the same row, before the dates
        const rowStart = h.indexOf(`data-act="bannerEdit" data-id="${b.id}"`);
        if (tag && rowStart > -1) { const tr = h.lastIndexOf("<tr>", rowStart), pillEnd = h.indexOf("</td>", h.indexOf('<span class="pill', tr + 4) ); if (tr > -1 && pillEnd > -1 && pillEnd < rowStart) h = h.slice(0, pillEnd) + tag + h.slice(pillEnd); }
      });
      return h;
    };
  }
  ACT.bannerPick = el => {
    if (typeof adminOnly === "function" && !adminOnly()) return;
    SETTINGS.bannerPick = +el.dataset.id; AD.i = 0; render(); saveSoon();
    const b = BANNERS.find(x => x.id === +el.dataset.id); toast(`“${b ? b.headline : "Banner"}” is now on the homepage`);
  };
  // Saving or creating a banner makes it the one on the homepage (while rotation is off)
  if (ACT.bannerEdit) {
    const baseEdit = ACT.bannerEdit;
    ACT.bannerEdit = function (el) {
      const before = JSON.stringify(BANNERS), ids = new Set(BANNERS.map(b => b.id)), editing = el && el.dataset.id ? +el.dataset.id : null;
      baseEdit.apply(this, arguments);
      const form = document.getElementById("modalForm");
      if (form) {
        const hint = form.querySelector('input[name="img"]'); const lab = hint && hint.closest("label");
        if (lab) { const h = lab.querySelector(".hint"); if (h) h.textContent = "Optional. A square picture or logo works best. Big photos are shrunk automatically. Shown beside the headline, on phones too.";
          lab.insertAdjacentHTML("beforeend", `<span class="bn-prev" id="bnPrev">${S.ui.bannerImg ? `<img src="${esc(S.ui.bannerImg)}" alt="Current image"><button type="button" class="btn small ghost" data-act="bannerImgDel">Remove image</button>` : ""}</span>`); }
      }
      const started = Date.now(), dlg = document.getElementById("modal");
      const t = setInterval(() => {
        if (dlg && dlg.open && Date.now() - started < 30 * 60000) return; clearInterval(t);
        if (JSON.stringify(BANNERS) === before) return;
        const fresh = BANNERS.find(b => !ids.has(b.id)), id = fresh ? fresh.id : editing;
        const b = BANNERS.find(x => x.id === id);
        if (b && !rotateOn() && bannerStatus(b) === "Live") pickAfterSaved(b.id);
      }, 300);
    };
  }
  // Picks the banner only once the banner itself has been saved, so saving the choice can't overtake the banner
  function pickAfterSaved(id, tries = 0) {
    const saved = typeof docSer === "function" && docSer(docGet("BANNERS")) === PS.docSnap.BANNERS;
    if ((!saved || PS.pushing) && tries < 60) { if (!PS.pushing && typeof pushDocs === "function") pushDocs(); return setTimeout(() => pickAfterSaved(id, tries + 1), 400); }
    if (!BANNERS.some(b => b.id === id)) return;
    SETTINGS.bannerPick = id; AD.i = 0; render(); saveSoon();
  }
  // Saves settings once any save already running has finished (a save in progress would otherwise skip this change)
  function saveSoon(tries = 0) {
    if (typeof pushDocs !== "function" || typeof PS === "undefined") return;
    const pending = () => typeof docSer === "function" && docSer(docGet("SETTINGS")) !== PS.docSnap.SETTINGS;
    if (!pending() || tries > 40) return;
    if (!PS.pushing) pushDocs();
    setTimeout(() => saveSoon(tries + 1), 500);
  }
  ACT.bannerImgDel = () => { S.ui.bannerImg = null; const p = document.getElementById("bnPrev"); if (p) p.innerHTML = '<span class="hint">No image. Choose one above, or save without.</span>'; const f = document.querySelector('#modalForm input[name="img"]'); if (f) f.value = ""; };
  // Big photos are shrunk before upload (max 800px), keeping transparency for PNG logos
  CHANGE.bannerImg = el => {
    const file = el.files && el.files[0]; if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Choose a picture (JPG, PNG or WebP)."); el.value = ""; return; }
    if (file.size > 25e6) { toast("That picture is over 25 MB. Choose a smaller one."); el.value = ""; return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 800 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const png = /png|webp|gif/.test(file.type);
      S.ui.bannerImg = c.toDataURL(png ? "image/png" : "image/jpeg", 0.88);
      if (png && S.ui.bannerImg.length > 2.6e6) S.ui.bannerImg = c.toDataURL("image/jpeg", 0.88);
      const p = document.getElementById("bnPrev"); if (p) p.innerHTML = `<img src="${S.ui.bannerImg}" alt="New image"><button type="button" class="btn small ghost" data-act="bannerImgDel">Remove image</button>`;
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast("That picture couldn't be read. Try a JPG or PNG."); el.value = ""; };
    img.src = url;
  };

  // Saves always land on the current item, even if the site refreshed its data while the form was open
  const EDITORS = {bannerEdit: () => BANNERS, sideAdEdit: () => SIDE_ADS, postAdEdit: () => POST_ADS,
    tickerEdit: () => (typeof TICKER === "object" && TICKER ? TICKER.items || [] : []), affEdit: () => AFF_LINKS};
  Object.entries(EDITORS).forEach(([name, list]) => {
    const inner = ACT[name]; if (typeof inner !== "function") return;
    ACT[name] = function (el) {
      const id = el && el.dataset ? el.dataset.id : null;
      let atOpen = null; try { atOpen = id ? (list() || []).find(x => String(x.id) === String(id)) || null : null; } catch (e) {}
      const r = inner.apply(this, arguments);
      if (!atOpen || typeof modalSubmit !== "function") return r;
      const orig = modalSubmit;
      const fix = () => {
        const arr = list() || []; if (arr.includes(atOpen)) return;   // nothing was refreshed: the edit is already in place
        const cur = arr.find(x => String(x.id) === String(atOpen.id)); if (!cur) return;
        Object.keys(atOpen).forEach(k => { if (k !== "imps" && k !== "clicks") cur[k] = atOpen[k]; });
        render(); if (typeof schedulePush === "function") schedulePush();
      };
      modalSubmit = function () {
        const res = orig.apply(this, arguments);
        if (res && typeof res.then === "function") res.then(err => { if (!err) fix(); });
        else if (!res) fix();
        return res;
      };
      return r;
    };
  });

  // Side slots: mark when only the left slot has an ad, so mid-width screens show that one
  if (typeof renderRails === "function") {
    const baseRails = renderRails;
    renderRails = function () {
      baseRails();
      const L = $("#railL"), R = $("#railR"), lay = $("#layout");
      if (lay) lay.classList.toggle("left-only", !!(L && L.innerHTML) && !(R && R.innerHTML));
    };
  }

  render();
})();
