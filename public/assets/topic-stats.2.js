/* Pitchside Forum: switch the stats shown on each topic on or off (replies, views, last activity).
   Admin → Forum → "Topic stats". Saved in the LAYOUT settings as statReplies / statViews / statLast;
   anything not switched off stays on, so the site looks the same until an admin changes it.
   Loaded after the main app script; it only wraps app functions, it doesn't change the app file. */
(function () {
  if (typeof topicRow !== "function") return;
  const STATS = [["statReplies", "Replies", "How many replies each topic has"],
                 ["statViews", "Views", "How many times each topic was opened"],
                 ["statLast", "Last activity", "When the latest reply was posted, e.g. “last 2h ago”"]];
  const on = k => LAYOUT[k] !== false;

  // Topic lists (homepage, boards, tags, search, profiles)
  topicRow = function (t) {
    const b = board(t.board);
    const flags = [t.pinned ? '<span class="pill solid">Pinned</span>' : "", t.locked ? '<span class="pill amber">Locked</span>' : "", t.archived ? '<span class="pill">Archived</span>' : "", t.auto ? '<span class="pill blue">Auto</span>' : ""].join("");
    const tags = t.tags.map(s => link("/tag/" + s, "#" + esc((TAGS.find(x => x.slug === s) || {name: s}).name))).join(" ");
    const counts = [on("statReplies") ? `<strong class="num">${fmt(t.posts.length - 1)}</strong> replies` : "", on("statViews") ? `<span class="num">${fmt(t.views)}</span> views` : ""].filter(Boolean).join(" · ");
    const last = on("statLast") ? `<div>last ${rel(lastAt(t))}</div>` : "";
    const stats = counts || last ? `<div class="stats">${counts ? `<div>${counts}</div>` : ""}${last}</div>` : "";
    return `<li class="${t.pinned ? "pinned" : ""}">
    <div style="min-width:0"><h4>${isUnread(t) ? '<span class="new">New</span> ' : ""}${link("/topic/" + t.id, esc(t.title))}</h4>
      <div class="meta">${topicExtras(t)}${b ? link("/forum/" + b.slug, esc(b.name)) : ""}${flags}<span>by ${ulink(t.author)}</span>${tags}</div></div>
    ${stats}
  </li>`;
  };

  // The topic page header ("1,234 views")
  if (typeof vTopic === "function") {
    const baseTopic = vTopic;
    vTopic = function () {
      const h = baseTopic.apply(this, arguments);
      return on("statViews") ? h : h.replace(/<span>[^<]{1,16} views<\/span>/, "");
    };
  }

  // Admin → Forum: the switches
  if (typeof aForum === "function") {
    const baseForum = aForum;
    aForum = function () {
      const boxes = STATS.map(([k, label, hint]) => `<label class="chk"><input type="checkbox" data-change="topicStat" data-k="${k}" id="ts-${k}"${on(k) ? " checked" : ""}> <strong>${label}</strong> <span class="hint muted">${hint}</span></label>`).join("");
      return `<section class="panel" style="margin-bottom:16px"><h3 class="ph" style="margin:0 0 4px">Topic stats</h3>
        <span class="muted" style="font-size:.9rem">What shows next to each topic in topic lists. Views also shows at the top of each topic. Counting carries on while they're hidden, so switching back on shows the real numbers.</span>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px;margin-top:12px">${boxes}</div></section>` + baseForum.apply(this, arguments);
    };
  }
  CHANGE.topicStat = function (el) {
    if (typeof can === "function" && !can("manageCategories")) { el.checked = !el.checked; toast("Only admins can change this."); return; }
    LAYOUT[el.dataset.k] = el.checked;
    const label = (STATS.find(s => s[0] === el.dataset.k) || [, "Stat"])[1];
    if (typeof audit === "function") audit("Forum change", "Topic stats: " + label, el.checked ? "Turned on" : "Turned off", el.checked ? "off" : "on", el.checked ? "on" : "off");
    render(); toast(`${label} ${el.checked ? "shown" : "hidden"} on topics`);
  };

  // Admin settings: when several switches are flipped quickly, a change made while the previous one
  // was still saving used to be skipped. Save again once the current save finishes.
  if (typeof pushDocs === "function" && typeof PS === "object") {
    const basePush = pushDocs;
    pushDocs = async function () {
      if (PS.pushing) { PS.pushAgain = true; return; }
      await basePush();
      if (PS.pushAgain) { PS.pushAgain = false; await pushDocs(); }
    };
  }

  render();
})();
