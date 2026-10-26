/* Pitchside Forum: Weekly raffle page (/raffle), under Gambling.
   Free to enter. Members qualify with a minimum number of topics and posts, then press Enter.
   One entry per member and per device. The internet connection (IP address) doesn't matter.
   The server checks everything again, picks the winner at random, and keeps an audit trail.
   Admins create draws, review entries, run the draw, and record the USDT payout right on the page. */
(function () {
  if (typeof liveGate !== "function" || typeof api !== "function") return;
  const RF = {d: null, loading: false, err: null, user: undefined};
  const isAdmin = () => typeof can === "function" && can("manageCategories") && me() && ["admin", "super_admin"].includes(me().role);
  const when = t => new Date(t).toLocaleString("en-GB", {weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"});
  const NETS = [["TRC20", "TRC20 (Tron)"], ["ERC20", "ERC20 (Ethereum)"], ["BEP20", "BEP20 (BNB Smart Chain)"]];
  const explorer = (net, tx) => net === "TRC20" ? `https://tronscan.org/#/transaction/${tx.replace(/^0x/, "")}` : net === "BEP20" ? `https://bscscan.com/tx/${tx}` : `https://etherscan.io/tx/${tx}`;
  const short = s => s && s.length > 16 ? s.slice(0, 8) + "…" + s.slice(-6) : (s || "");

  // A random code kept on this device (browser storage and a cookie), so one device can't enter twice
  function deviceId() {
    const ok = v => /^[a-f0-9]{32}$/.test(v || "");
    let d = null;
    try { d = (document.cookie.match(/(?:^|; )ps_dev=([a-f0-9]{32})/) || [])[1] || localStorage.getItem("ps_dev"); } catch (e) {}
    if (!ok(d)) d = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    try { localStorage.setItem("ps_dev", d); } catch (e) {}
    document.cookie = `ps_dev=${d}; max-age=63072000; path=/; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
    return d;
  }

  async function load() {
    RF.loading = true; RF.user = S.user;
    try { RF.d = await api("raffle.get", {_nosync: true}); RF.err = null; }
    catch (e) { RF.err = e.message; }
    RF.loading = false; render();
  }
  const reload = msg => { if (msg) toast(msg); return load(); };
  // Runs a raffle action; returns an error message for modals, or shows it as a toast
  async function run(op, args, okMsg) { try { await api(op, args); await reload(okMsg); } catch (e) { return e.message; } }

  function statusLine(r) {
    const members = r.qualified;
    const n = Date.now();
    if (r.status === "cancelled") return `<span class="pill">Cancelled</span>`;
    if (r.status === "paid") return `<span class="pill green">Prize paid</span>`;
    if (r.status === "drawn") return `<span class="pill green">Winner drawn</span>`;
    if (n < r.starts) return `<span class="pill blue">Opens ${esc(when(r.starts))}</span>`;
    if (n < r.ends) return `<span class="pill green">Open</span> <span class="muted">Draw ${esc(when(r.ends))}</span>`;
    if (members < r.minMembers) return `<span class="pill amber">Waiting for ${fmt(r.minMembers)} qualified members</span> <span class="muted">Entries stay open until then</span>`;
    return `<span class="pill amber">Entries closed</span> <span class="muted">The draw takes place shortly</span>`;
  }

  function hero(r, d) {
    const pct = Math.min(100, Math.round(r.qualified / Math.max(1, r.minMembers) * 100));
    const needMembers = r.status === "open" && r.qualified < r.minMembers;
    return `<section class="rf-hero">
      <div class="rf-hero-main"><span class="rf-kicker">${esc(r.title)} · Free to enter</span>
        <div class="rf-prize">${esc(r.prize)}</div>
        ${r.prizeNote ? `<p class="rf-note">${esc(r.prizeNote)}</p>` : ""}
        <div class="row" style="gap:8px;margin-top:6px">${statusLine(r)}</div></div>
      <dl class="rf-facts"><div><dt>Entries</dt><dd>${fmt(r.entries)}</dd></div>
        <div><dt>Draw</dt><dd>${esc(dday(r.ends))}</dd></div>
        <div><dt>Qualified members</dt><dd>${fmt(r.qualified)}${needMembers ? ` <small>of ${fmt(r.minMembers)}</small>` : ""}</dd></div></dl>
      ${needMembers ? `<div class="rf-goal"><div class="spread"><span>This draw takes place once <strong>${fmt(r.minMembers)} members have qualified</strong> (${r.minTopics} topic${r.minTopics === 1 ? "" : "s"} and ${r.minPosts} posts each).</span><span class="num">${fmt(r.qualified)} / ${fmt(r.minMembers)}</span></div>
        <span class="track" style="display:block;margin-top:6px"><i style="width:${pct}%"></i></span></div>` : ""}
    </section>`;
  }

  function steps(r, d) {
    const m = d.me, si = signedIn(), open = r.status === "open" && Date.now() >= r.starts && !r.ready;
    const step = (done, title, sub) => `<li class="${done ? "done" : ""}"><span class="rf-tick" aria-hidden="true">${done ? "✓" : ""}</span><div><strong>${title}</strong>${sub ? `<div class="muted" style="font-size:.88rem">${sub}</div>` : ""}</div></li>`;
    const list = `<ol class="rf-steps">
      ${step(si, "Create a free account", si ? `Signed in as ${esc(S.user)}` : "It takes a minute.")}
      ${step(si && m && m.verified, "Confirm your email address", si && m && !m.verified ? "Use the link we emailed you." : "")}
      ${step(si && m && m.topics >= r.minTopics, `Start at least ${r.minTopics} topic${r.minTopics === 1 ? "" : "s"}`, si && m ? `You have ${fmt(m.topics)}.` : "Ask a question or start a discussion on any board.")}
      ${step(si && m && m.posts >= r.minPosts, `Make ${r.minPosts} posts`, (si && m ? `You have ${fmt(m.posts)} of ${r.minPosts}. ` : "") + "Your topic's first post counts. Posts removed by moderators don't.")}
      ${step(si && m && m.entry && m.entry.status === "ok", "Press Enter below", "Entering is free and takes one click.")}
    </ol>`;
    let action = "";
    if (!si) action = `<div class="row"><button class="btn primary" type="button" data-act="register">Join free</button><button class="btn" type="button" data-act="signIn">Sign in</button></div>`;
    else if (!m) action = "";
    else if (m.entry && m.entry.status === "ok") action = `<div class="notice green"><strong>You're in!</strong><span>Your entry was received ${esc(rel(m.entry.at))}. Keep posting as normal: you need to still meet the requirements at draw time. Good luck!</span></div>`;
    else if (m.entry) action = `<div class="notice red"><strong>Entry ${esc(m.entry.status)}.</strong><span>${esc(m.entry.note || "")} ${link("/staff", "Contact staff")} if you think this is a mistake.</span></div>`;
    else if (m.blocked) action = `<div class="notice"><span>${esc(m.blocked)}</span></div>`;
    else if (!open) action = `<p class="muted" style="margin:0">${Date.now() < r.starts ? `Entries open ${esc(when(r.starts))}.` : "Entries for this draw are closed."}</p>`;
    else if (!m.eligible) action = `<p class="muted" style="margin:0">Finish the steps above and the Enter button appears here.</p>`;
    else action = `<form class="rf-enter" data-form="rfEnter" data-id="${r.id}">
        <label class="chk"><input type="checkbox" name="agree" required> I'm 18 or older and I agree to the raffle rules below. One entry per person.</label>
        <button class="btn primary" type="submit">Enter the draw</button></form>`;
    return `<section class="panel"><h2 class="sec" style="margin:0 0 10px">How to enter</h2>${list}<div style="margin-top:12px">${action}</div></section>`;
  }

  function winnerBox(r) {
    if (r.status !== "drawn" || r.winner !== S.user) return "";
    const w = r.wallet;
    return `<section class="panel rf-win"><h2 class="sec" style="margin:0 0 6px">You won ${esc(r.prize)}! 🎉</h2>
      <p style="margin:0 0 10px">Send us the USDT wallet address to pay you, by <strong>${esc(dday(r.walletDue))}</strong>. Double-check it: crypto sent to a wrong address can't be recovered.</p>
      ${w ? `<div class="notice green" style="margin-bottom:10px"><span>We have your ${esc(w.network)} address <span class="mono">${esc(short(w.addr))}</span>. You can change it until we pay.</span></div>` : ""}
      <form data-form="rfWallet" data-id="${r.id}" class="row" style="align-items:flex-end;gap:10px">
        <label style="flex:1 1 200px">Network<select name="network">${NETS.map(([k, t]) => `<option value="${k}" ${w && w.network === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label style="flex:3 1 320px">USDT wallet address<input name="addr" class="mono" required autocomplete="off" spellcheck="false" value="${w ? esc(w.addr) : ""}" placeholder="T… or 0x…"></label>
        <button class="btn primary" type="submit">${w ? "Update address" : "Send address"}</button></form>
      <p class="hint" style="margin:8px 0 0">Use an address that can receive USDT on that network. Exchange deposit addresses work if the exchange supports that network.</p></section>`;
  }

  function past(rounds) {
    const done = rounds.filter(r => r.status === "drawn" || r.status === "paid");
    if (!done.length) return "";
    return `<section class="panel flush"><div style="padding:14px 16px 0"><h2 class="sec" style="margin:0">Results</h2></div>
      <ul class="rf-results">${done.map(r => `<li><div><strong>${esc(r.title)}</strong> · ${esc(r.prize)}
        <div class="muted" style="font-size:.88rem">Drawn ${esc(dday(r.drawnAt))}${r.draw ? ` · ticket ${r.draw.ticket} of ${r.draw.pool} eligible entries` : ""}</div>${r.draw && r.draw.previous ? r.draw.previous.map(x => `<div class="muted" style="font-size:.85rem">Redrawn: ${esc(x.winner || "")} was replaced${x.reason ? ` (${esc(x.reason)})` : ""}.</div>`).join("") : ""}
        <details><summary class="muted" style="font-size:.85rem">Rules for this draw</summary><div class="rf-rules" style="font-size:.85rem">${rulesList(r)}</div></details>${r.draw ? `<details><summary class="muted" style="font-size:.85rem">Entries in the draw</summary><p style="font-size:.85rem;margin:6px 0 0">${r.draw.names.map((n, i) => `${i + 1}. ${esc(n)}`).join(" · ")}</p></details>` : ""}</div>
        <div style="text-align:right">Winner ${ulink(r.winner)}<div style="font-size:.88rem">${r.status === "paid"
          ? `<span class="pill green">Paid</span> <a href="${esc(explorer(r.paidNetwork, r.paidTx))}" target="_blank" rel="noopener">${esc(short(r.paidTx))} ↗</a>`
          : `<span class="pill amber">${r.walletSet ? "Payment being sent" : "Waiting for the winner's wallet"}</span>`}</div></div></li>`).join("")}</ul></section>`;
  }

  // Standard rules, used for a new draw until an admin edits them. {placeholders} fill in that draw's numbers.
  const STANDARD_RULES = [
    "Free to enter. No purchase or deposit is needed, and entering never costs anything.",
    "Open to registered Pitchside members aged 18 or over, where prize draws like this are allowed. Staff and Pitchside's automated community accounts can't enter.",
    "To qualify you need a confirmed account, at least {topics} and {posts} posts. The first post of a topic counts. Posts removed by moderators don't count. You must still meet these at draw time.",
    "One entry per person and per device. Several accounts, shared or bought accounts, or spam posts to reach the post count lead to disqualification, and may lead to a ban.",
    "The draw takes place on the draw date once {members} members have qualified; until then entries stay open.",
    "The winner is picked at random by the server from all eligible entries. The winner's username, the number of entries and the winning ticket are published here.",
    "The prize ({prize}) is paid in USDT to a wallet the winner provides within {walletDays} days of the draw. If no valid address arrives in time, or the winner breaks these rules, the prize is redrawn. The winner is responsible for any taxes where they live. The prize can't be exchanged for anything else.",
    "Pitchside may change, pause or cancel a draw if something goes wrong (for example, technical problems or fraud), and will explain why on this page. Staff decisions on eligibility are final."
  ].join("\n");
  const fill = (text, r) => text
    .replace(/\{topics\}/g, `${r.minTopics} topic${r.minTopics === 1 ? "" : "s"}`).replace(/\{posts\}/g, String(r.minPosts))
    .replace(/\{members\}/g, fmt(r.minMembers)).replace(/\{prize\}/g, r.prize).replace(/\{walletDays\}/g, String(r.walletDays));
  const ruleLines = r => fill(r.rules || STANDARD_RULES, r).split("\n").map(l => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
  const spaced = t => t.split("\n").filter(l => l.trim()).join("\n\n");
  const rulesList = r => `<ol>${ruleLines(r).map(l => `<li>${esc(l)}</li>`).join("")}</ol>`;

  function rules(r) {
    const n = r || {minTopics: 1, minPosts: 25, minMembers: 100, walletDays: 14, prize: "$100 in USDT", rules: ""};
    return `<details class="panel rf-rules"${r && r.status === "open" ? " open" : ""}><summary><strong>Rules for ${r ? esc(r.title) : "the raffle"}</strong>${r && r.rulesAt ? ` <span class="muted" style="font-size:.85rem">· updated ${esc(dday(r.rulesAt))}</span>` : ""}</summary>${rulesList(n)}</details>`;
  }

  function adminBox(d) {
    if (!isAdmin()) return "";
    const open = d.rounds.find(r => r.status === "open"), drawn = d.rounds.filter(r => r.status === "drawn");
    const ents = r => (d.admin && d.admin[String(r.id)]) || [];
    const table = r => { const es = ents(r); return es.length ? `<div class="tw"><table class="t"><thead><tr><th>Member</th><th>Entered</th><th class="n">Topics</th><th class="n">Posts</th><th>Status</th><th>Checks</th><th></th></tr></thead><tbody>
      ${es.map(e => `<tr><td>${ulink(e.user)}${e.joined ? `<div class="muted" style="font-size:.8rem">joined ${esc(rel(e.joined))}</div>` : ""}</td><td style="white-space:nowrap">${esc(rel(e.at))}</td><td class="n">${e.topics}</td><td class="n">${e.posts}</td>
        <td><span class="pill ${e.status === "ok" ? "green" : "amber"}">${e.status === "ok" ? "In" : esc(e.status)}</span>${e.note ? `<div class="muted" style="font-size:.8rem">${esc(e.note)}</div>` : ""}</td>
        <td style="font-size:.82rem">${[e.problem ? `⚠ ${esc(e.problem)}` : "", !e.stillEligible && !e.problem && e.status === "ok" ? "⚠ No longer meets the topic and post requirements" : "",
          e.sharedNetwork.length ? `⚠ Signed in from the same network as ${e.sharedNetwork.map(esc).join(", ")}` : ""].filter(Boolean).join("<br>") || '<span class="muted">No flags</span>'}</td>
        <td class="n">${r.status === "open" ? `<button class="btn small ghost" type="button" data-act="rfDq" data-id="${e.id}" data-user="${esc(e.user)}" data-undo="${e.status !== "ok" ? 1 : ""}">${e.status === "ok" ? "Disqualify" : "Reinstate"}</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted" style="padding:0 16px 14px;margin:0">No entries yet.</p>`; };
    const openPanel = open ? `<section class="panel flush rf-admin"><div class="spread" style="padding:14px 16px;gap:10px;flex-wrap:wrap"><div><h3 class="ph" style="margin:0 0 4px">Admin · ${esc(open.title)}</h3>
        <span class="muted" style="font-size:.88rem">${fmt(open.entries)} entries · ${open.minPosts} posts, ${open.minTopics} topic(s), ${fmt(open.qualified)} of ${fmt(open.minMembers)} members qualified</span></div>
        <div class="row" style="gap:6px"><button class="btn small" type="button" data-act="rfEdit" data-id="${open.id}">Edit</button><button class="btn small ghost" type="button" data-act="rfCancel" data-id="${open.id}">Cancel draw</button>
        <button class="btn small primary" type="button" data-act="rfDraw" data-id="${open.id}" ${open.ready ? "" : "disabled"} title="${open.ready ? "" : Date.now() < open.ends ? "Available after the draw date" : `Needs ${open.minMembers} qualified members`}">Run the draw</button></div></div>${table(open)}</section>`
      : `<section class="panel rf-admin"><div class="spread" style="gap:10px;flex-wrap:wrap"><div><h3 class="ph" style="margin:0 0 4px">Admin</h3><span class="muted" style="font-size:.88rem">No draw is open. Start the next one.</span></div><button class="btn primary" type="button" data-act="rfEdit">Start a new draw</button></div></section>`;
    const drawnPanels = drawn.map(r => `<section class="panel rf-admin"><div class="spread" style="gap:10px;flex-wrap:wrap"><div><h3 class="ph" style="margin:0 0 4px">Admin · pay ${esc(r.title)}</h3>
        <div>Winner ${ulink(r.winner)} · ${esc(r.prize)}</div>
        <div style="font-size:.9rem;margin-top:4px">${r.wallet ? `Wallet (${esc(r.wallet.network)}): <span class="mono" style="word-break:break-all">${esc(r.wallet.addr)}</span> <button class="btn small ghost" type="button" data-act="rfCopy" data-v="${esc(r.wallet.addr)}">Copy</button>`
          : `<span class="muted">Waiting for the winner's wallet address (due ${esc(dday(r.walletDue))})</span>`}</div></div>
        <div class="row" style="gap:6px"><button class="btn small primary" type="button" data-act="rfPaid" data-id="${r.id}" ${r.wallet ? "" : "disabled"}>Mark as paid</button><button class="btn small ghost" type="button" data-act="rfRedraw" data-id="${r.id}">Redraw</button></div></div></section>`).join("");
    return `<div class="stack" style="gap:14px">${drawnPanels}${openPanel}</div>`;
  }

  function vRaffle() {
    if (typeof gated === "function" && gated()) return ageGate();
    if (RF.user !== S.user && !RF.loading) load();
    const head = crumbs(["Gambling", "/gambling"], ["Weekly raffle"]) + phead("Weekly raffle", "Free to enter, every week. Be part of the community and you could win USDT.");
    if (!RF.d) return head + `<section class="panel empty">${RF.err ? esc(RF.err) + ` <button class="btn small" type="button" data-act="rfReload">Try again</button>` : "Loading the raffle…"}</section>`;
    const d = RF.d, cur = d.rounds.find(r => r.id === d.current) || null;
    const latest = cur || d.rounds.find(r => r.status === "drawn" || r.status === "paid") || null;
    return head + `<div class="stack" style="gap:16px">
      ${latest ? hero(latest, d) : `<section class="panel empty">The first draw hasn't been announced yet. Check back soon.</section>`}
      ${latest && latest.status === "drawn" && latest.winner ? `<div class="notice green"><strong>Winner: ${esc(latest.winner)}</strong><span>Congratulations! ${latest.walletSet ? "The prize is on its way." : "We're waiting for the winner's wallet address."}</span></div>` : ""}
      ${cur ? winnerBox(cur) : ""}${d.rounds.filter(r => r.status === "drawn").map(winnerBox).join("")}
      ${cur ? steps(cur, d) : ""}
      ${adminBox(d)}
      ${past(d.rounds)}
      ${rules(cur || latest)}
      <p class="muted" style="font-size:.82rem;margin:0">18+ only. This is a free prize draw: no purchase or deposit is needed. ${link("/forum/responsible-gambling", "Gamble responsibly")}.</p></div>`;
  }

  // Route /raffle
  const gateBase = liveGate;
  liveGate = function (seg, qs) {
    if ((seg[0] || "") === "raffle") return SOON && typeof featureOn === "function" && !featureOn("casinos") ? vSoon("Weekly raffle", "The weekly raffle opens with the Gambling section.") : vRaffle();
    return gateBase(seg, qs);
  };

  // Forms on the page
  async function submitForm(f, op, args, okMsg) {
    const btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
    const err = await run(op, args, okMsg);
    if (err) { toast(err); if (btn) btn.disabled = false; }
  }
  Object.assign(FORMS, {
    rfEnter(f) { submitForm(f, "raffle.enter", {id: +f.dataset.id, agree: f.elements.agree.checked, device: deviceId()}, "You're in the draw. Good luck!"); },
    rfWallet(f) { submitForm(f, "raffle.wallet", {id: +f.dataset.id, network: f.elements.network.value, addr: f.elements.addr.value.trim()}, "Wallet address saved"); }
  });

  const toMs = v => v ? new Date(v).getTime() : 0;
  const local = t => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  Object.assign(ACT, {
    rfReload() { load(); },
    rfStdRules() { const t = document.querySelector("#modalForm textarea[name=rules]"); if (t) { t.value = spaced(STANDARD_RULES); toast("Standard rules filled in. Save to keep them."); } },
    rfCopy(el) { const v = el.dataset.v; try { navigator.clipboard.writeText(v).then(() => toast("Copied"), () => toast(v)); } catch (e) { toast(v); } },
    rfEdit(el) {
      const r = el && el.dataset && el.dataset.id ? RF.d.rounds.find(x => x.id === +el.dataset.id) : null;
      const n = RF.d.rounds.filter(x => x.status !== "cancelled").length + 1;
      // Round 1 opens tomorrow at midnight (your time); later rounds open straight away. Each runs 7 days.
      const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
      const start = n === 1 ? tomorrow.getTime() : Date.now(), endD = new Date(start); endD.setDate(endD.getDate() + 7); const end = endD.getTime();   // same clock time, even across a clock change
      const v = (k, def) => esc(r ? r[k] : def);
      // A new round starts from the previous round's rules (or the standard rules); an existing draw keeps its own
      const prev = RF.d.rounds.find(x => x.status !== "cancelled" && x.rules);
      const rulesText = r ? (r.rules || STANDARD_RULES) : (prev ? prev.rules : STANDARD_RULES);
      modal({title: r ? "Edit draw" : "Start a new draw", submit: r ? "Save" : "Start draw", body: `
        <div class="row"><label style="flex:2 1 220px">Name<input name="title" maxlength="120" required value="${v("title", `Round ${n} raffle`)}"></label>
          <label style="flex:1 1 160px">Prize<input name="prize" maxlength="80" required value="${v("prize", "$100 in USDT")}"></label></div>
        <label>Prize note <span class="hint">Optional</span><input name="prizeNote" maxlength="300" value="${v("prizeNote", "Paid in USDT (TRC20, ERC20 or BEP20) to the winner's wallet.")}"></label>
        <div class="row"><label style="flex:1">Entries open<input type="datetime-local" name="starts" required value="${local(r ? r.starts : start)}"></label>
          <label style="flex:1">Draw date<input type="datetime-local" name="ends" required value="${local(r ? r.ends : end)}"></label></div>
        <div class="row"><label style="flex:1">Topics needed<input type="number" min="0" name="minTopics" value="${v("minTopics", 1)}"></label>
          <label style="flex:1">Posts needed<input type="number" min="0" name="minPosts" value="${v("minPosts", 25)}"></label>
          <label style="flex:1">Qualified members before the draw<input type="number" min="0" name="minMembers" value="${v("minMembers", 100)}"></label>
          <label style="flex:1">Days to send a wallet<input type="number" min="1" max="90" name="walletDays" value="${v("walletDays", 14)}"></label></div>
        <label>Rules for this draw <span class="hint">One rule per paragraph, shown as a numbered list. Blank lines between rules are fine. {prize}, {topics}, {posts}, {members} and {walletDays} fill in the numbers above.</span>
          <textarea name="rules" rows="14" style="font-size:.9rem" required>${esc(spaced(rulesText))}</textarea></label>
        <button class="btn small ghost" type="button" data-act="rfStdRules">Reset to the standard rules</button>`,
        onSubmit: f => {
          const g = k => f.elements[k].value.trim();
          return run("raffle.save", {id: r ? r.id : 0, title: g("title"), prize: g("prize"), prizeNote: g("prizeNote"), starts: toMs(g("starts")), ends: toMs(g("ends")),
            minTopics: +g("minTopics"), minPosts: +g("minPosts"), minMembers: +g("minMembers"), walletDays: +g("walletDays"), blockIp: false, rules: f.elements.rules.value}, r ? "Draw saved" : "Draw started");
        }});
    },
    rfCancel(el) {
      modal({title: "Cancel this draw?", submit: "Cancel draw", danger: true, cancel: "Keep it", body: `<label>Reason <span class="hint">Recorded in the audit log</span><textarea name="reason" required></textarea></label>`,
        onSubmit: f => run("raffle.cancel", {id: +el.dataset.id, reason: f.elements.reason.value.trim()}, "Draw cancelled")});
    },
    rfDq(el) {
      if (el.dataset.undo) return run("raffle.dq", {entry: +el.dataset.id, undo: true}, "Entry reinstated").then(m => m && toast(m));
      modal({title: `Disqualify ${el.dataset.user}?`, submit: "Disqualify", danger: true, body: `<label>Reason <span class="hint">The member sees this</span><textarea name="reason" required placeholder="e.g. Second account on the same device as another entrant"></textarea></label>`,
        onSubmit: f => run("raffle.dq", {entry: +el.dataset.id, reason: f.elements.reason.value.trim()}, "Entry disqualified")});
    },
    rfDraw(el) {
      const r = RF.d.rounds.find(x => x.id === +el.dataset.id);
      modal({title: `Run the draw for ${r.title}?`, submit: "Draw the winner", body: `<p style="margin:0">The server checks every entry again, leaves out anyone who no longer qualifies, and picks one winner at random from ${fmt(r.entries)} entries. The result is published straight away and can't be undone (only redrawn with a public reason).</p>`,
        onSubmit: () => run("raffle.draw", {id: r.id}, "The winner has been drawn")});
    },
    rfRedraw(el) {
      modal({title: "Replace the winner and draw again?", submit: "Redraw", danger: true, body: `<label>Reason <span class="hint">Shown publicly and sent to the current winner</span><textarea name="reason" required placeholder="e.g. No wallet address within 14 days"></textarea></label>`,
        onSubmit: f => run("raffle.redraw", {id: +el.dataset.id, reason: f.elements.reason.value.trim()}, "New winner drawn")});
    },
    rfPaid(el) {
      const r = RF.d.rounds.find(x => x.id === +el.dataset.id);
      modal({title: `Mark ${r.title} as paid`, submit: "Mark as paid", body: `<p style="margin:0 0 8px">Send ${esc(r.prize)} to <span class="mono" style="word-break:break-all">${esc(r.wallet.addr)}</span> on <strong>${esc(r.wallet.network)}</strong>, then paste the transaction hash. It's published so members can see the prize was paid.</p>
        <label>Transaction hash<input name="tx" class="mono" required autocomplete="off" spellcheck="false"></label>`,
        onSubmit: f => run("raffle.paid", {id: r.id, tx: f.elements.tx.value.trim()}, "Marked as paid")});
    }
  });
  try { render(); } catch (e) {}
})();
