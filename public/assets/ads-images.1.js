/* Pitchside Forum: pictures for side ads and in-post ads.
   Before, these refused any picture over 2 MB (most phone photos and many banner files) and SVG logos,
   while the form still said "Ad saved". Now any picture works, like homepage banners: it's shrunk in the
   browser (largest side 800 px, transparency kept) and turned into PNG or JPG before it's uploaded.
   The form shows the picture you chose, with a Remove button.
   Loaded after ads-tweaks.2.js; it only adds to the app, it doesn't change the app file. */
(function () {
  if (typeof CHANGE !== "object" || typeof ACT !== "object") return;
  const KINDS = {
    railImg: {edit: "sideAdEdit", hint: "Optional. A square picture or logo works best (shown at 136 × 136 above the headline). Any size: big pictures are shrunk automatically."},
    postAdImg: {edit: "postAdEdit", hint: "Optional. A square logo or icon works best (shown at 64 × 64). Any size: big pictures are shrunk automatically."}
  };
  const prevHtml = (key, src) => src
    ? `<img src="${esc(src)}" alt="Ad picture"><button type="button" class="btn small ghost" data-act="adImgDel" data-k="${key}">Remove picture</button>`
    : '<span class="hint">No picture. Choose one above, or save without.</span>';
  function shrink(file) {
    return new Promise((res, rej) => {
      if (!file) return res(null);
      if (!/^image\//.test(file.type)) return rej(new Error("Choose a picture (JPG, PNG, WebP, GIF or SVG)."));
      if (file.size > 25e6) return rej(new Error("That picture is over 25 MB. Choose a smaller one."));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width || 512, h = img.naturalHeight || img.height || 512;
        const k = Math.min(1, 800 / Math.max(w, h)) || 1, c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        const keepAlpha = /png|webp|gif|svg/.test(file.type);
        let d = c.toDataURL(keepAlpha ? "image/png" : "image/jpeg", 0.88);
        if (d.length > 2.6e6) d = c.toDataURL("image/jpeg", 0.85);
        res(d);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That picture couldn't be read. Try a JPG or PNG.")); };
      img.src = url;
    });
  }
  Object.entries(KINDS).forEach(([key, spec]) => {
    CHANGE[key] = el => {
      const file = el.files && el.files[0]; if (!file) return;
      S.ui[key + "Busy"] = true;
      shrink(file).then(d => {
        S.ui[key] = d; const p = document.getElementById("adPrev-" + key); if (p) p.innerHTML = prevHtml(key, d);
        const no = document.querySelector('#modalForm input[name="noimg"]'); if (no) no.checked = false;
      }).catch(e => { toast(e.message); el.value = ""; }).finally(() => { S.ui[key + "Busy"] = false; });
    };
    const inner = ACT[spec.edit]; if (typeof inner !== "function") return;
    ACT[spec.edit] = function () {
      const r = inner.apply(this, arguments);
      const form = document.getElementById("modalForm"), inp = form && form.querySelector(`input[data-change="${key}"]`);
      const lab = inp && inp.closest("label");
      if (lab && !lab.querySelector(".bn-prev")) {
        const h = lab.querySelector(".hint"); if (h) h.textContent = spec.hint;
        inp.setAttribute("accept", "image/*");
        lab.insertAdjacentHTML("beforeend", `<span class="bn-prev" id="adPrev-${key}">${prevHtml(key, S.ui[key])}</span>`);
        // Wait for a picture that's still being prepared before saving
        if (typeof modalSubmit === "function") {
          const orig = modalSubmit;
          modalSubmit = function () {
            if (S.ui[key + "Busy"]) return "The picture is still being prepared. Press Save again in a moment.";
            return orig.apply(this, arguments);
          };
        }
      }
      return r;
    };
  });
  ACT.adImgDel = el => {
    const key = el.dataset.k; S.ui[key] = null;
    const p = document.getElementById("adPrev-" + key); if (p) p.innerHTML = prevHtml(key, null);
    const f = document.querySelector(`#modalForm input[data-change="${key}"]`); if (f) f.value = "";
    const no = document.querySelector('#modalForm input[name="noimg"]'); if (no) no.checked = true;
  };
})();
