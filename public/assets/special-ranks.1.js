/* Pitchside Forum: special ranks such as "Donor", "VIP" or "Founding member".
   Admins create them in Admin → Forum and give them to members there or on a member's profile.
   They show as a coloured badge next to the member's name (on posts, profiles and the Members list),
   alongside their normal post-based rank. Saved as the SPECIAL_RANKS site setting. */
(function () {
  if (typeof roleBadge !== "function" || typeof api !== "function") return;
  let SPECIAL = [];
  const fromBoot = d => { if (d && d.docs && Array.isArray(d.docs.SPECIAL_RANKS)) SPECIAL = d.docs.SPECIAL_RANKS; };
  fromBoot(window.PS_BOOT);
  const applyBase = apply;
  apply = function (d) { fromBoot(d); return applyBase(d); };

  const COLORS = [["#f5a623", "Gold", "#1f1300"], ["#18c37e", "Green", "#04261a"], ["#0b63c9", "Blue", "#ffffff"], ["#7c3aed", "Purple", "#ffffff"],
    ["#e5252a", "Red", "#ffffff"], ["#db2777", "Pink", "#ffffff"], ["#0f766e", "Teal", "#ffffff"], ["#475569", "Slate", "#ffffff"]];
  const inkFor = c => (COLORS.find(x => x[0] === c) || [, , "#ffffff"])[2];
  const isAdmin = () => typeof can === "function" && can("manageCategories");
  const ranksOf = name => SPECIAL.filter(r => (r.members || []).includes(name));
  const pill = r => `<span class="pill sp-rank" style="background:${esc(r.color || "#f5a623")};color:${inkFor(r.color)};border-color:transparent" title="Special rank">${esc(r.name)}</span>`;

  // Badge next to the member's name wherever their role badge appears
  const baseBadge = roleBadge;
  roleBadge = function (name) { return baseBadge.apply(this, arguments) + ranksOf(name).map(pill).join(""); };

  async function save(next, okMsg) {
    try { const r = await api("config.save", {k: "SPECIAL_RANKS", v: next, ver: PS.docVers.SPECIAL_RANKS}); SPECIAL = next; if (r && r.ver) PS.docVers.SPECIAL_RANKS = r.ver; if (okMsg) toast(okMsg); render(); }
    catch (e) { return e.message; }
  }
  async function member(id, user, on) {
    try { await api("specialrank.member", {id, user, on}); render(); toast(on ? `${user} now has “${(SPECIAL.find(r => r.id === id) || {}).name}”` : `Removed from ${user}`); }
    catch (e) { toast(e.message); }
  }
  const colorSelect = (v, attrs) => `<select class="inp" style="width:auto" ${attrs}>${COLORS.map(([c, n]) => `<option value="${c}" ${v === c ? "selected" : ""}>${n}</option>`).join("")}</select>`;

  function panel() {
    const names = Object.keys(USERS).sort();
    const rows = SPECIAL.map(r => `<div class="sp-row" style="padding:10px 0;border-top:1px solid var(--line)">
        <div class="row" style="gap:6px;align-items:center">${pill(r)}
          <input class="inp" style="flex:1 1 140px;min-width:0" maxlength="30" value="${esc(r.name)}" data-change="spName" data-id="${esc(r.id)}" id="spn-${esc(r.id)}" aria-label="Name">
          ${colorSelect(r.color, `data-change="spColor" data-id="${esc(r.id)}" id="spc-${esc(r.id)}" aria-label="Colour"`)}
          <button class="btn small ghost" type="button" data-act="spDel" data-id="${esc(r.id)}" aria-label="Delete ${esc(r.name)}">✕</button></div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${(r.members || []).map(m => `<span class="pill">${esc(m)} <button type="button" data-act="spOff" data-id="${esc(r.id)}" data-user="${esc(m)}" aria-label="Remove ${esc(r.name)} from ${esc(m)}" style="border:0;background:none;cursor:pointer;padding:0 0 0 4px;color:inherit">✕</button></span>`).join("") || '<span class="muted" style="font-size:.85rem">Nobody yet</span>'}</div>
        <form class="row" data-form="spGive" data-id="${esc(r.id)}" style="gap:6px;margin-top:6px"><input class="inp" name="user" list="spNames" placeholder="Username" style="flex:1 1 140px;min-width:0" required autocomplete="off"><button class="btn small" type="submit">Give rank</button></form>
      </div>`).join("");
    return `<section class="panel"><h3 class="ph">Special ranks</h3>
      <p class="muted" style="font-size:.85rem;margin:0 0 8px">Titles you give to chosen members, such as Donor, VIP or Founding member. They show as a coloured badge next to the member's name, alongside their normal rank. Members are notified when they get one.</p>
      <datalist id="spNames">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      ${rows || ""}
      <div class="row" style="margin-top:8px"><button class="btn small primary" type="button" data-act="spNew">Create a special rank</button></div></section>`;
  }

  // Admin → Forum: right after the Ranks box
  if (typeof aForum === "function") {
    const baseForum = aForum;
    aForum = function () {
      const h = baseForum.apply(this, arguments);
      const i = h.indexOf('<h3 class="ph">Ranks</h3>'); if (i < 0) return panel() + h;
      const j = h.indexOf("</section>", i) + "</section>".length;
      return h.slice(0, j) + panel() + h.slice(j);
    };
  }
  // A member's profile: admins can give or take special ranks right there
  if (typeof vProfile === "function") {
    const baseProfile = vProfile;
    vProfile = function (name) {
      const h = baseProfile.apply(this, arguments);
      if (!isAdmin() || !USERS[name] || !SPECIAL.length) return h;
      return h + `<section class="panel" style="margin-top:16px"><h3 class="ph">Special ranks <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:.85rem">(admins only)</span></h3>
        <div class="row" style="gap:8px;flex-wrap:wrap">${SPECIAL.map(r => { const has = (r.members || []).includes(name);
          return `<button class="btn small${has ? " on" : ""}" type="button" data-act="${has ? "spOff" : "spOn"}" data-id="${esc(r.id)}" data-user="${esc(name)}" aria-pressed="${has}">${has ? "✓ " : "+ "}${esc(r.name)}</button>`; }).join("")}</div></section>`;
    };
  }

  const clean = s => s.trim().replace(/\s+/g, " ").slice(0, 30);
  CHANGE.spName = el => {
    const r = SPECIAL.find(x => x.id === el.dataset.id); if (!r) return; const v = clean(el.value);
    if (!v) { el.value = r.name; return toast("A special rank needs a name."); }
    if (SPECIAL.some(x => x !== r && x.name.toLowerCase() === v.toLowerCase())) { el.value = r.name; return toast(`There's already a special rank called “${v}”.`); }
    save(SPECIAL.map(x => x === r ? Object.assign({}, x, {name: v}) : x), "Special rank renamed").then(m => m && toast(m));
  };
  CHANGE.spColor = el => { save(SPECIAL.map(x => x.id === el.dataset.id ? Object.assign({}, x, {color: el.value}) : x), "Colour saved").then(m => m && toast(m)); };
  FORMS.spGive = f => { const u = f.elements.user.value.trim(); if (!USERS[u]) return toast(`There's no member called “${u}”.`); member(f.dataset.id, u, true); };
  Object.assign(ACT, {
    spOn(el) { member(el.dataset.id, el.dataset.user, true); },
    spOff(el) { member(el.dataset.id, el.dataset.user, false); },
    spNew() {
      if (SPECIAL.length >= 30) return toast("You can have up to 30 special ranks.");
      modal({title: "Create a special rank", submit: "Create", body: `
        <label>Name<input name="name" maxlength="30" required placeholder="e.g. Donor"></label>
        <label>Colour${colorSelect("#f5a623", 'name="color"')}</label>
        <p class="hint" style="margin:0">Next, give it to members in this box or from their profile.</p>`,
        onSubmit: f => {
          const name = clean(f.elements.name.value); if (!name) return "Give it a name.";
          if (SPECIAL.some(x => x.name.toLowerCase() === name.toLowerCase())) return `There's already a special rank called “${name}”.`;
          const id = "sr" + Date.now().toString(36);
          return save([...SPECIAL, {id, name, color: f.elements.color.value, members: []}], `“${name}” created`);
        }});
    },
    spDel(el) {
      const r = SPECIAL.find(x => x.id === el.dataset.id); if (!r) return;
      modal({title: `Delete “${r.name}”?`, submit: "Delete", danger: true, body: `<p style="margin:0">${(r.members || []).length ? `${(r.members || []).length} member${r.members.length > 1 ? "s lose" : " loses"} this badge.` : "Nobody has it yet."}</p>`,
        onSubmit: () => save(SPECIAL.filter(x => x !== r), "Special rank deleted")});
    }
  });
  try { render(); } catch (e) {}
})();
