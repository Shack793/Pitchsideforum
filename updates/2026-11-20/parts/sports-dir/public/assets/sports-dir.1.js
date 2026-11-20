/* Pitchside Forum: Sports page organised by sport first.
   /sports: Football featured at the top (its competitions grouped by region), then a compact directory of the other
   sports. /sports/<sport>: that sport's competitions as tidy cards (name first; type, sport, country and season small)
   and the latest discussion. No bare counts, and no "Players and fighters..." line on cards.
   Loaded after league-boards.1.js. */
(function () {
  if (typeof vSportsHub !== "function" || typeof LEAGUES === "undefined") return;
  const ORDER = ["football", "basketball", "american-football", "tennis", "cricket", "rugby", "baseball", "ice-hockey", "motorsport", "combat-sports"];
  const ICON = {football: "⚽", basketball: "🏀", "american-football": "🏈", tennis: "🎾", cricket: "🏏", rugby: "🏉", baseball: "⚾", "ice-hockey": "🏒", motorsport: "🏎️", "combat-sports": "🥊"};
  const REG = ["International", "Europe", "North America", "South America", "Africa", "Asia", "Oceania"];
  const regName = r => r === "International" ? "Worldwide" : r;
  const sportsUsed = () => SPORTS.filter(s => LEAGUES.some(l => l.sport === s.slug)).sort((a, b) => {
    const i = ORDER.indexOf(a.slug), j = ORDER.indexOf(b.slug); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
  const comps = s => LEAGUES.filter(l => l.sport === s);
  const subs = l => l.board ? BOARDS.filter(b => b.parent === l.board && canReadBoard(b)).sort((a, b) => a.order - b.order) : [];
  const short = n => n.replace(/^UEFA /, "").replace(/ Série A$/, "").replace(/ Elite$/, "");
  function line(s) {
    const ls = comps(s.slug);
    if (ls.length === 1) { const sb = subs(ls[0]); return sb.length ? sb.slice(0, 3).map(b => esc(b.name.replace(/ Tour$/, ""))).join(" · ") : esc(ls[0].name); }
    const pick = ["premier-league", "laliga", "champions-league", "afcon"].map(x => ls.find(l => l.slug === x)).filter(Boolean);
    const names = (pick.length ? pick : ls).slice(0, 4).map(l => esc(short(l.name)));
    return names.join(" · ") + (ls.length > names.length ? " and more" : "");
  }
  const count = n => n > 1 ? `<div class="muted" style="font-size:.85rem;margin-top:2px">${n} competitions</div>` : "";
  const sportCard = s => `<a class="card sd-sport" href="/sports/${esc(s.slug)}" data-go="/sports/${esc(s.slug)}">
      <div class="sd-ico" aria-hidden="true">${ICON[s.slug] || "🏅"}</div><div style="min-width:0"><strong style="font-size:1.05rem">${esc(s.name)}</strong>
      ${count(comps(s.slug).length)}<div class="muted" style="font-size:.86rem;margin-top:3px">${line(s)}</div></div></a>`;
  const compCard = l => `<a class="card sd-comp" href="/leagues/${esc(l.slug)}" data-go="/leagues/${esc(l.slug)}">${leagueCrest(l, 40)}
      <div style="min-width:0"><strong style="font-size:1.02rem">${esc(l.name)}</strong>
      <div class="sd-type">${esc((TYPE_LABEL[l.type] || "League").toUpperCase())}</div>
      <div class="muted" style="font-size:.84rem">${[sportOf(l.sport).name, l.country && l.country !== l.region ? l.country : regName(l.region), l.season].filter(Boolean).map(esc).join(" · ")}</div></div></a>`;
  if (!document.getElementById("ps-sd")) {
    const st = document.createElement("style"); st.id = "ps-sd";
    st.textContent = ".sd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.sd-sport,.sd-comp{display:flex;gap:12px;align-items:flex-start;text-decoration:none;color:inherit}" +
      ".sd-ico{font-size:1.7rem;line-height:1;width:40px;height:40px;display:grid;place-items:center;border-radius:10px;background:var(--panel-2,rgba(127,127,127,.12));flex:none}" +
      ".sd-type{font-size:.7rem;letter-spacing:.06em;font-weight:700;color:var(--muted);margin:2px 0 1px}.sd-feat .sd-reg{display:grid;grid-template-columns:150px 1fr;gap:6px 14px;padding:9px 0;border-top:1px solid var(--line)}" +
      ".sd-feat .sd-reg:first-of-type{border-top:0}.sd-feat .sd-reg a{white-space:nowrap}.sd-feat .sd-links{display:flex;flex-wrap:wrap;gap:4px 14px}" +
      "@media (max-width:640px){.sd-feat .sd-reg{grid-template-columns:1fr}.sd-grid{grid-template-columns:1fr}}";
    document.head.appendChild(st);
  }
  vSportsHub = function (sportSlug) {
    const all = sportsUsed(), sp = sportSlug && sportSlug !== "all" ? all.find(s => s.slug === sportSlug) : null;
    const admin = can("manageCategories") ? link("/admin/sports", "Add sport, league or team", "btn") : "";
    if (!sp) {
      const fb = all.find(s => s.slug === "football"), rest = all.filter(s => s !== fb);
      const feat = fb ? `<section class="panel sd-feat" style="margin-bottom:22px"><div class="spread" style="margin-bottom:8px;gap:10px">
          <div class="row" style="gap:12px"><div class="sd-ico" aria-hidden="true">⚽</div><div><h2 class="sec" style="margin:0">Football</h2><div class="muted" style="font-size:.88rem">${comps("football").length} competitions</div></div></div>
          ${link("/sports/football", "All football competitions", "btn small")}</div>
          ${REG.map(r => { const ls = comps("football").filter(l => l.region === r); return ls.length ? `<div class="sd-reg"><strong>${esc(regName(r))}</strong><div class="sd-links">${ls.map(l => link("/leagues/" + l.slug, esc(l.name))).join("")}</div></div>` : ""; }).join("")}</section>` : "";
      return crumbs(["Sports"]) + phead("Follow the sports you love.", "Browse competitions, leagues and teams across the world.", admin) + feat +
        (rest.length ? `<h2 class="sec">More sports</h2><div class="sd-grid">${rest.map(sportCard).join("")}</div>` : "");
    }
    const ls = comps(sp.slug), boards = ls.flatMap(l => [l.board, ...subs(l).map(b => b.slug)]).filter(Boolean);
    const topics = readable().filter(t => boards.includes(t.board)).sort((a, b) => lastAt(b) - lastAt(a));
    const groups = sp.slug === "football" ? REG.map(r => [r, ls.filter(l => l.region === r)]).filter(([, x]) => x.length) : [[null, ls]];
    return crumbs(["Sports", "/sports"], [sp.name]) + phead(`${ICON[sp.slug] ? ICON[sp.slug] + " " : ""}${esc(sp.name)}`, ls.length > 1 ? `${ls.length} competitions` : "", admin) +
      groups.map(([r, x]) => `<section style="margin-bottom:20px">${r ? `<h2 class="sec">${esc(regName(r))}</h2>` : ""}<div class="sd-grid">${x.map(compCard).join("")}</div></section>`).join("") +
      `<section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Latest ${esc(sp.name.toLowerCase())} discussion</h3></div>${topicList(topics.slice(0, 15), "No discussion yet for this sport.")}</section>`;
  };
  if (typeof leagueCard === "function") {
    const base = leagueCard;
    leagueCard = function () { return base.apply(this, arguments).replace(/<p class="muted"[^>]*>Players and fighters are covered in the discussion board\.<\/p>/, ""); };
  }
  try { if (typeof render === "function" && /^\/sports(\/|\?|$)/.test(S.path || location.pathname)) render(); } catch (e) {}
})();
