/* Pitchside Forum: simpler Sports section.
   - League pages: the "Teams" and "Betting" tabs are gone (Overview already lists the teams).
   - Team pages (other sports): the "Betting" tab is gone. Match pages: the "Betting discussion" box is gone.
   - Football has no team pages: each league is one section. Links to a football club go to its league instead,
     and the league cards on /sports no longer list football clubs.
   - The prediction leaderboard no longer shows the sample member names.
   Loaded after app.js; changes nothing outside the Sports pages. */
(function () {
  if (typeof vLeague !== "function" || typeof vTeam !== "function") return;
  const isFb = l => !!l && l.sport === "football";
  const fbLeagueOf = slug => { const t = typeof team === "function" ? team(slug) : null; const l = t && league(t.league); return isFb(l) ? l.slug : null; };
  const edit = (html, fn) => { const tp = document.createElement("template"); tp.innerHTML = html; fn(tp.content); return tp.innerHTML; };
  const title = (root, sel, text) => [...root.querySelectorAll(sel)].filter(x => (x.textContent || "").trim().startsWith(text));

  predBoard = function () {
    return `<p class="muted" style="margin:0">The leaderboard starts once members' predictions are settled. Make your picks on any upcoming match.</p>`;
  };

  const baseLeague = vLeague;
  vLeague = function (slug) {
    const k = "lt:" + slug;
    if (S.ui[k] === "teams" || S.ui[k] === "betting") S.ui[k] = "overview";
    const l = league(slug);
    return edit(baseLeague.apply(this, arguments), r => {
      r.querySelectorAll(`[data-act="tab"][data-key="${k}"][data-v="teams"], [data-act="tab"][data-key="${k}"][data-v="betting"]`).forEach(b => b.remove());
      if (isFb(l)) title(r, "section.panel > h3.ph", "Teams (").forEach(h => h.parentElement.remove());
    });
  };

  const baseTeam = vTeam;
  vTeam = function (slug) {
    const lg = fbLeagueOf(slug);
    if (lg) { S.path = "/leagues/" + lg; try { history.replaceState({}, "", S.path); } catch (e) {} return vLeague(lg); }
    const k = "tt:" + slug;
    if (S.ui[k] === "betting") S.ui[k] = "latest";
    return edit(baseTeam.apply(this, arguments), r => r.querySelectorAll(`[data-act="tab"][data-key="${k}"][data-v="betting"]`).forEach(b => b.remove()));
  };

  if (typeof vEvent === "function") {
    const baseEvent = vEvent;
    vEvent = function () {
      return edit(baseEvent.apply(this, arguments), r => title(r, "section.panel h3.ph", "Betting discussion").forEach(h => h.closest("section").remove()));
    };
  }

  if (typeof leagueCard === "function") {
    const baseCard = leagueCard;
    leagueCard = function (l) {
      const h = baseCard.apply(this, arguments);
      return isFb(l) ? edit(h, r => r.querySelectorAll(".tchips").forEach(x => x.remove())) : h;
    };
  }

  // Any link to a football club (topics, search, match pages...) goes to the club's league instead.
  function fixLinks(root) {
    (root.querySelectorAll ? root : document).querySelectorAll('a[data-go^="/teams/"], a[href^="/teams/"]').forEach(a => {
      const p = a.getAttribute("data-go") || a.getAttribute("href"); const lg = fbLeagueOf(p.split("/")[2] || "");
      if (!lg) return;
      if (a.hasAttribute("data-go")) a.setAttribute("data-go", "/leagues/" + lg);
      if (a.getAttribute("href") !== "#") a.setAttribute("href", "/leagues/" + lg);
    });
  }
  let t = 0;
  new MutationObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(() => fixLinks(document)); }).observe(document.documentElement, {childList: true, subtree: true});
  fixLinks(document);
  // The first page may have been drawn before this script loaded: draw Sports pages again with the changes.
  try { if (typeof render === "function" && /^\/(sports|leagues|teams|events)(\/|\?|$)/.test(S.path || location.pathname)) render(); } catch (e) {}
})();
