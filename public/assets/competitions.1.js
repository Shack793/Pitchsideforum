/* Pitchside Forum: real logos for competitions (leagues and tournaments).
   Admin → Sports gets a "Competition logos" box listing every competition, the ones still showing initials first.
   For each one an admin can upload the logo file or paste a link to the logo picture, see it straight away,
   or remove it. Saved with the rest of the sports settings. A logo link that stops working falls back to the
   initials badge instead of a broken picture.
   Loaded after the main app script; it wraps the admin page, it doesn't change the app file. */
(function () {
  if (typeof aSports !== "function" || typeof LEAGUES === "undefined") return;
  const isAdmin = () => typeof can === "function" && can("manageCategories");
  const initials = l => esc(l.name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(w => w.length > 1 || /\d/.test(w)).map(w => w[0]).join("").slice(0, 3).toUpperCase());
  let showAll = false;

  function panel() {
    const missing = LEAGUES.filter(l => !l.logo);
    const list = showAll ? [...missing, ...LEAGUES.filter(l => l.logo)] : missing.slice(0, 6);
    const row = l => `<div class="cl-row">
        <span class="cl-crest">${leagueCrest(l, 40)}</span>
        <div class="cl-main"><strong>${esc(l.name)}</strong><span class="muted">${esc(l.country || l.region || "")}${l.logo ? (/^https:/.test(l.logo) ? " · logo from a link" : " · logo uploaded") : " · showing initials"}</span>
          <form class="cl-form" data-form="clUrl" data-slug="${esc(l.slug)}"><input class="inp" name="url" type="url" placeholder="Paste a link to the logo (https://…)" aria-label="Logo link for ${esc(l.name)}" autocomplete="off"><button class="btn small" type="submit">Use link</button>
          <label class="btn small ghost cl-up">Upload<input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" data-change="clFile" data-slug="${esc(l.slug)}" hidden></label>
          ${l.logo ? `<button class="btn small ghost" type="button" data-act="clDel" data-slug="${esc(l.slug)}">Remove</button>` : ""}</form></div></div>`;
    return `<section class="panel" style="margin-bottom:14px" id="compLogos"><h3 class="ph">Competition logos</h3>
      <p class="muted" style="font-size:.85rem;margin:0 0 8px">${missing.length ? `<strong>${missing.length} of ${LEAGUES.length}</strong> competitions are still showing initials instead of a logo.` : `All ${LEAGUES.length} competitions have a logo.`}
        Upload the logo file, or paste a link to the logo picture (for example from the competition's own site). PNG or SVG with a transparent background looks best. Use logos you have the right to use.</p>
      ${list.length ? list.map(row).join("") : ""}
      <div class="row" style="margin-top:8px"><button class="btn small ghost" type="button" data-act="clAll">${showAll ? "Show fewer" : `Show all ${LEAGUES.length} competitions`}</button></div></section>`;
  }

  const base = aSports;
  aSports = function () { const h = base.apply(this, arguments); return isAdmin() ? panel() + h : h; };

  function setLogo(l, v, msg) {
    l.logo = v;
    if (typeof audit === "function") audit("Sports entity edited", `league ${l.name}`, v ? "Logo set" : "Logo removed", "previous", v ? "logo" : "initials");
    render(); toast(msg);
  }
  FORMS.clUrl = f => {
    const l = LEAGUES.find(x => x.slug === f.dataset.slug), url = f.elements.url.value.trim();
    if (!l || !isAdmin()) return;
    if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return toast("Paste a full link starting with https://");
    const img = new Image(); img.referrerPolicy = "no-referrer";
    img.onload = () => setLogo(l, url, `${l.name} logo saved`);
    img.onerror = () => toast("That link didn't open as a picture. Copy the link to the image itself (right-click it, then Copy image address).");
    img.src = url;
  };
  CHANGE.clFile = el => {
    const l = LEAGUES.find(x => x.slug === el.dataset.slug); if (!l || !isAdmin()) return;
    readLogo(el.files && el.files[0], d => setLogo(l, d, `${l.name} logo saved`));
  };
  Object.assign(ACT, {
    clDel(el) { const l = LEAGUES.find(x => x.slug === el.dataset.slug); if (l && isAdmin()) setLogo(l, null, `${l.name} logo removed`); },
    clAll() { showAll = !showAll; render(); }
  });

  // A logo picture that no longer loads shows the initials badge instead
  document.addEventListener("error", e => {
    const img = e.target; if (!(img instanceof HTMLImageElement) || !img.classList.contains("crest") || img.dataset.fell) return;
    const src = img.getAttribute("src"), l = LEAGUES.find(x => x.logo === src); if (!l) return;
    img.dataset.fell = "1";
    const s = document.createElement("span"); s.className = "crest lcrest"; s.style.cssText = `width:${img.style.width};height:${img.style.height};font-size:${parseFloat(img.style.width) / 3.2}px`; s.innerHTML = initials(l);
    img.replaceWith(s);
  }, true);
  try { render(); } catch (e) {}
})();
