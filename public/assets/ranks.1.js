/* Pitchside Forum: rank editor in Admin → Forum. Admins rename, add and remove ranks and set the posts
   each one needs. Ranks are saved as the RANKS site setting (the usual automatic save for admin changes).
   Post counts only include visible posts, so a member's rank drops if moderators remove their posts. */
(function () {
  if (typeof aForum !== "function") return;
  const MAX = 20;
  const sortRanks = () => { RANKS.sort((a, b) => a.min - b.min); if (RANKS.length) RANKS[0].min = 0; };

  function editor() {
    const rows = RANKS.map((r, i) => {
      const next = RANKS[i + 1], n = Object.values(USERS).filter(u => u.posts >= r.min && (!next || u.posts < next.min)).length;
      return `<div class="row rk-row" style="gap:6px;align-items:center;padding:4px 0;border-top:1px solid var(--line)">
        <input class="inp" style="flex:1 1 140px;min-width:0" maxlength="40" value="${esc(r.name)}" data-change="rankName" data-i="${i}" id="rkn-${i}" aria-label="Rank ${i + 1} name">
        <input class="inp" style="width:84px" type="number" min="0" value="${r.min}" data-change="rankMin" data-i="${i}" id="rkm-${i}" ${i === 0 ? 'disabled title="The first rank always starts at 0 posts"' : ""} aria-label="Posts needed for ${esc(r.name)}">
        <span class="muted" style="font-size:.8rem;width:58px;text-align:right" title="Members at this rank now">${fmt(n)} now</span>
        <button class="btn small ghost" type="button" data-act="rankDel" data-i="${i}" ${RANKS.length <= 1 ? "disabled" : ""} aria-label="Remove ${esc(r.name)}">✕</button></div>`;
    }).join("");
    return `<section class="panel"><h3 class="ph">Ranks</h3>
      <p class="muted" style="font-size:.85rem;margin:0 0 8px">Name and the posts needed for each rank. Only visible posts count: if moderators hide a member's posts, their rank goes down. Changes save as you make them.</p>
      <div class="row muted" style="gap:6px;font-size:.78rem;padding-bottom:4px"><span style="flex:1 1 140px">Rank name</span><span style="width:84px">Posts needed</span><span style="width:58px"></span><span style="width:34px"></span></div>
      ${rows}
      <div class="row" style="margin-top:8px"><button class="btn small" type="button" data-act="rankAdd" ${RANKS.length >= MAX ? "disabled" : ""}>Add a rank</button></div></section>`;
  }

  const baseForum = aForum;
  aForum = function () {
    return baseForum.apply(this, arguments).replace(/<section class="panel"><h3 class="ph">Ranks<\/h3>[\s\S]*?<\/section>/, () => editor());
  };

  CHANGE.rankName = el => {
    if (!can("manageCategories")) return;
    const v = el.value.trim().replace(/\s+/g, " ").slice(0, 40), r = RANKS[+el.dataset.i]; if (!r) return;
    if (!v) { el.value = r.name; return toast("A rank needs a name."); }
    if (RANKS.some((x, k) => k !== +el.dataset.i && x.name.toLowerCase() === v.toLowerCase())) { el.value = r.name; return toast(`There's already a rank called “${v}”.`); }
    r.name = v; render(); toast("Rank renamed");
  };
  CHANGE.rankMin = el => {
    if (!can("manageCategories")) return;
    const r = RANKS[+el.dataset.i]; if (!r) return;
    const v = Math.max(1, Math.min(1e7, Math.round(+el.value || 0)));
    if (RANKS.some(x => x !== r && x.min === v)) { el.value = r.min; return toast(`Another rank already starts at ${fmt(v)} posts.`); }
    r.min = v; sortRanks(); render(); toast(`${r.name} now needs ${fmt(v)} posts`);
  };
  Object.assign(ACT, {
    rankAdd() {
      if (!can("manageCategories") || RANKS.length >= MAX) return;
      const top = RANKS[RANKS.length - 1], min = top ? Math.max(top.min * 2, top.min + 10) : 0;
      let name = "New rank", k = 2; while (RANKS.some(x => x.name === name)) name = `New rank ${k++}`;
      RANKS.push({name, min}); sortRanks(); render(); toast("Rank added. Give it a name and the posts it needs.");
      setTimeout(() => { const el = document.getElementById(`rkn-${RANKS.findIndex(x => x.name === name)}`); if (el) { el.focus(); el.select(); } }, 50);
    },
    rankDel(el) {
      if (!can("manageCategories") || RANKS.length <= 1) return;
      const r = RANKS[+el.dataset.i]; if (!r) return;
      modal({title: `Remove the “${r.name}” rank?`, submit: "Remove", danger: true,
        body: `<p style="margin:0">Members at this rank move to the rank below it. You can add it back later.</p>`,
        onSubmit: () => { RANKS.splice(RANKS.indexOf(r), 1); sortRanks(); render(); toast("Rank removed"); if (typeof schedulePush === "function") schedulePush(); }});
    }
  });
  try { render(); } catch (e) {}
})();
