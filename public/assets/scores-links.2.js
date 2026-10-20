/* Pitchside Forum → LiveScoreNow links, plus the big Live Scores button on the homepage.
   Turns the forum's score buttons into addresses that exist on LiveScoreNow:
   - Match buttons: the match's own LiveScoreNow page when the fixtures feed supplies it ("url"),
     otherwise LiveScoreNow's scores for that day (/?date=YYYY-MM-DD).
   - League and team buttons: the league's LiveScoreNow page when known (from the feed's "leagueUrl",
     or the list below), otherwise the country or sport section.
   Loaded after the main app script; it only changes where these links point. */
(function () {
  if (typeof scoresUrl !== "function") return;
  // League pages confirmed on livescorenow.xyz
  const LEAGUE_PATHS = {
    "premier-league": "/football/england/premier-league-2/",
    "laliga": "/football/spain/la-liga-2/",
    "serie-a": "/football/italy/"
  };
  const SPORT_PATHS = { "football": "/", "basketball": "/basketball/", "tennis": "/tennis/", "ice-hockey": "/hockey/",
    "american-football": "/american-football/", "baseball": "/baseball/", "volleyball": "/volleyball/", "handball": "/handball/", "rugby": "/rugby/" };
  const base = () => (SETTINGS.scoresUrl || "").replace(/\/$/, "");
  const sameSite = u => typeof u === "string" && base() && u.indexOf(base() + "/") === 0;
  const pathOf = u => u.slice(base().length);
  function leaguePath(slug) {
    const ev = (EVENTS || []).find(e => e.league === slug && sameSite(e.leagueUrl));
    if (ev) return pathOf(ev.leagueUrl);
    if (LEAGUE_PATHS[slug]) return LEAGUE_PATHS[slug];
    const l = (LEAGUES || []).find(x => x.slug === slug);
    return (l && SPORT_PATHS[l.sport]) || "/";
  }
  function lsnPath(path) {
    const seg = String(path || "").split("?")[0].split("/").filter(Boolean);
    if (!seg.length) return "/";
    if (seg[0] === "match" || seg[0] === "events") {
      const e = (EVENTS || []).find(x => x.slug === seg[1]);
      if (e && sameSite(e.scoresUrl)) return pathOf(e.scoresUrl);
      if (e && e.at) { const d = new Date(e.at); if (!isNaN(d)) return "/?date=" + d.toISOString().slice(0, 10); }
      return "/";
    }
    if (seg[0] === "leagues") return leaguePath(seg[1]);
    if (seg[0] === "teams") { const t = (TEAMS || []).find(x => x.slug === seg[1]); return t ? leaguePath(t.league) : "/"; }
    return "/";
  }
  scoresUrl = function (path) {
    const u = base() + lsnPath(path);
    return SETTINGS.scoresUtm ? u + (u.includes("?") ? "&" : "?") + "utm_source=pitchside&utm_medium=forum" : u;
  };
  // Big "Live Scores" button at the top of the homepage
  if (typeof vHome === "function") {
    const homeView = vHome;
    vHome = function () {
      const live = (EVENTS || []).filter(e => e.status === "live").length;
      const sub = live ? `${live} match${live === 1 ? "" : "es"} live right now. Scores, stats, lineups and odds on LiveScoreNow.` : "Every match, live: scores, stats, lineups and odds on LiveScoreNow.";
      return `<section class="ls-cta" aria-label="Live scores"><div class="ls-cta-txt"><span class="ls-dot" aria-hidden="true"></span><div><strong>Live Scores</strong><span>${esc(sub)}</span></div></div>
        <a class="ls-cta-btn" href="${esc(scoresUrl(""))}" target="_blank" rel="noopener" data-ext="scores">Open Live Scores <span aria-hidden="true">↗</span><span class="sr"> (opens LiveScoreNow in a new tab)</span></a></section>` + homeView();
    };
  }
  try { renderFooter(); render(); } catch (e) {}
})();
