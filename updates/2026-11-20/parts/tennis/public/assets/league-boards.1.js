/* Pitchside Forum: on the Sports page, a league card with no teams (like Tennis) lists its forum sub-boards instead
   (ATP Tour, WTA Tour, ITF, Grand Slams...), and the league page shows them too. Old /leagues/atp and /leagues/wta
   links go to /leagues/tennis. Loaded after sports-tidy.1.js. */
(function () {
  if (typeof leagueCard !== "function" || typeof vLeague !== "function") return;
  const MOVED = {atp: "tennis", wta: "tennis"};
  const subsOf = l => l && l.board ? BOARDS.filter(b => b.parent === l.board && canReadBoard(b)).sort((a, b) => a.order - b.order) : [];
  const chips = l => subsOf(l).map(b => `<a href="#" data-go="/forum/${esc(b.slug)}" class="tchip nb"><span>${esc(b.name)}</span></a>`).join("");
  const baseCard = leagueCard;
  leagueCard = function (l) {
    const h = baseCard.apply(this, arguments), c = chips(l);
    if (!c || (typeof teamsIn === "function" && teamsIn(l.slug).length)) return h;
    const tp = document.createElement("template"); tp.innerHTML = h;
    const art = tp.content.querySelector("article"); if (!art) return h;
    art.querySelectorAll(":scope > p.muted").forEach(p => p.remove());
    art.insertAdjacentHTML("beforeend", `<div class="tchips">${c}</div>`);
    return tp.innerHTML;
  };
  const baseLeague = vLeague;
  vLeague = function (slug) {
    if (MOVED[slug] && typeof league === "function" && !league(slug) && league(MOVED[slug])) { S.path = "/leagues/" + MOVED[slug]; try { history.replaceState({}, "", S.path); } catch (e) {} slug = MOVED[slug]; }
    const h = baseLeague.call(this, slug), l = league(slug), c = chips(l);
    if (!c) return h;
    const tp = document.createElement("template"); tp.innerHTML = h;
    const stack = tp.content.querySelector(".cols > .stack");
    if (stack && (S.ui["lt:" + slug] || "overview") === "overview") stack.insertAdjacentHTML("afterbegin", `<section class="panel"><h3 class="ph">Boards</h3><div class="tchips">${c}</div></section>`);
    return tp.innerHTML;
  };
  try { if (typeof render === "function" && /^\/(sports|leagues)(\/|\?|$)/.test(S.path || location.pathname)) render(); } catch (e) {}
})();
