/* Pitchside Forum: homepage banner rotation switch and steadier side ads.
   - Banner rotation is off unless Admin → Ads → "Rotate banners" is ticked (saved as SETTINGS.bannerRotate).
     While it's off, only the top live banner shows (paid banners come before the house ad) and nothing rotates.
     While it's on, banners rotate as before, but only when two or more are live.
   - A single banner no longer counts an impression every few seconds while it sits still.
   - Side slots: the layout class below lets the right slot show on screens from 1280px wide (see shell.html).
   Loaded after the main app script; it only wraps app functions, it doesn't change the app file. */
(function () {
  if (typeof eligibleBanners !== "function" || typeof adStart !== "function") return;
  const rotateOn = () => SETTINGS.bannerRotate === true;

  const baseEligible = eligibleBanners;
  eligibleBanners = function () { const list = baseEligible(); return rotateOn() ? list : list.slice(0, 1); };

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
        (on ? ` every ${secs} seconds · pauses on hover` : ` <span>(off: only the top live banner shows)</span>`));
    };
  }
  CHANGE.bannerRotate = function (el) {
    if (typeof adminOnly === "function" && !adminOnly()) { el.checked = !el.checked; return; }
    SETTINGS.bannerRotate = el.checked; AD.i = 0; render();
    toast(el.checked ? "Banner rotation is on" : "Banner rotation is off. Only the top live banner shows");
  };

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
