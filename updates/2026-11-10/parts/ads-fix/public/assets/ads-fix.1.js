/* Pitchside Forum: ad safety net. If the homepage banner or the side ads are switched on and have live ads,
   but the page came out without them, this puts them back. It never shows an ad that is paused, ended,
   scheduled, switched off, or (for 18+ ads) not allowed for this visitor. It only adds to the page. */
(function () {
  if (typeof render !== "function") return;
  const L = () => (typeof LAYOUT === "object" && LAYOUT) || {};
  const on = k => !L().clean && L()[k] !== false && L()[k] != null;
  const okGamble = () => !!((typeof S === "object" && S.ageOk) || (typeof signedIn === "function" && signedIn()));
  const live = a => { const n = Date.now(); return a && !a.paused && !(a.start && n < a.start) && !(a.end && n > a.end) && a.on !== false; };
  const ok = a => live(a) && (!a.gambling || okGamble());
  const homeFlag = b => !!(b.onHome || b.homepage || b.onHomepage || b.home || b.showOnHome || b.pinned || b.main);

  function bannerHtml() {
    if (typeof adBanner === "function") { try { const h = adBanner(); if (h && h.indexOf("ad-slide") >= 0) return h; } catch (e) {} }
    const list = (typeof BANNERS !== "undefined" && Array.isArray(BANNERS) ? BANNERS : []).filter(ok);
    if (!list.length) return "";
    const b = list.find(homeFlag) || list.find(x => !x.house) || list[0];
    const ink = typeof ctaInk === "function" ? ctaInk(b.accent) : "#000";
    return `<section class="ad" id="adBanner" aria-label="Sponsored banner"><div class="ad-stage">
      <a class="ad-slide on" href="#" data-act="adClick" data-id="${b.id}" style="background:${b.bg};color:${b.fg}">
        <span class="ad-copy"><span class="ad-label">${b.house ? "From Pitchside Forum" : `Sponsored · ${esc(b.advertiser || "")}`}</span><h2>${esc(b.headline || "")}</h2>${b.text ? `<p>${esc(b.text)}</p>` : ""}
          ${b.cta ? `<span class="ad-cta" style="background:${b.accent};color:${ink}">${esc(b.cta)} →</span>` : ""}
          ${b.gambling ? `<span class="ad-legal">18+ · Gamble responsibly · T&amp;Cs apply</span>` : ""}</span>
        ${b.img ? `<img class="ad-img" src="${esc(b.img)}" alt="">` : ""}</a></div></section>`;
  }
  function fixBanner() {
    if (!/^\/?$/.test(location.pathname) || !on("homeBanner")) return;
    if (document.querySelector(".ad-slide")) return;
    const main = document.querySelector("main") || document.body;
    if (!main.querySelector(".phead, section, .panel")) return;   // page not drawn yet
    const html = bannerHtml(); if (!html) return;
    const box = document.createElement("div"); box.innerHTML = html; const el = box.firstElementChild; el.setAttribute("data-adfix", "1");
    const hole = main.querySelector("section.hero > div:first-child:empty");
    if (hole) hole.replaceWith(el);
    else { const hero = main.querySelector("section.hero"); if (hero) hero.insertAdjacentElement("afterbegin", el); else main.insertAdjacentElement("afterbegin", el); }
  }
  function fixRails() {
    if (!on("sideAds") || window.innerWidth < 1420) return;
    if (document.querySelector(".rail-ad")) return;
    const slots = (typeof SIDE_SLOTS !== "undefined" && Array.isArray(SIDE_SLOTS) ? SIDE_SLOTS : []).filter(s => s.on);
    const ads = typeof SIDE_ADS !== "undefined" && Array.isArray(SIDE_ADS) ? SIDE_ADS : [];
    const want = slots.filter(s => ads.some(a => a.slot === s.id && ok(a))); if (!want.length) return;
    if (typeof renderRails === "function" && !fixRails.tried) { fixRails.tried = true; try { renderRails(); } catch (e) {} if (document.querySelector(".rail-ad")) return; }
    want.forEach(s => {
      const el = document.querySelector(s.id === "left" ? "#railL" : "#railR"); if (!el || el.querySelector(".rail-ad")) return;
      const pool = ads.filter(a => a.slot === s.id && ok(a)), paid = pool.filter(a => !a.house), a = (paid.length ? paid : pool)[0];
      if (typeof railAdHtml === "function") { try { el.innerHTML = `<div class="rail-rot" data-adfix="1">${railAdHtml(a, true)}</div>`; } catch (e) { return; } }
      const lay = el.closest(".layout"); if (lay) lay.classList.add("has-rails");
    });
  }
  function fix() { try { fixBanner(); } catch (e) {} try { fixRails(); } catch (e) {} }
  const base = render;
  render = function () { const r = base.apply(this, arguments); fixRails.tried = false; setTimeout(fix, 0); return r; };
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(fix, 300); }).observe(document.body, {childList: true, subtree: true});
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(fix, 300); });
  setTimeout(fix, 500); setTimeout(fix, 2500);
})();
