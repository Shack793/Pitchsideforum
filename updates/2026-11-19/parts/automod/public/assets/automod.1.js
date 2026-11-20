/* Pitchside Forum: Admin → AI moderation.
   The log of everything the AI moderator did (with the reason, and a Reverse button), its settings, the AI service
   key (Super Admins only) and a test box. Server side: app/ops/zz-automod.php. It only wraps app functions. */
(function () {
  if (typeof vAdmin !== "function" || typeof ADMIN_TABS === "undefined") return;
  if (!ADMIN_TABS.some(t => t[0] === "automod")) {
    const i = ADMIN_TABS.findIndex(t => t[0] === "audit");
    ADMIN_TABS.splice(i < 0 ? ADMIN_TABS.length : i, 0, ["automod", "AI moderation"]);
  }
  const AM = {data: null, f: "", page: 0, user: "", loading: false, err: "", test: null, testing: false};
  const ACTIONS = {block: ["Link blocked", "red"], remove: ["Removed", "red"], hide: ["Hidden for checking", "amber"], flag: ["Sent to moderators", ""], warn: ["Warning", "amber"],
    suspend: ["Suspended", "red"], recommend_ban: ["Ban recommended", "red"], restore: ["Cleared", "green"], reviewed: ["Checked, no action", "green"]};
  const FILTERS = [["", "All"], ["removed", "Removed or blocked"], ["hidden", "Hidden"], ["flagged", "Sent to moderators"], ["members", "Warnings and suspensions"], ["serious", "Serious"], ["reversed", "Reversed"]];
  const pct = v => Math.round(Number(v) * 100);

  function load() {
    if (AM.loading) return; AM.loading = true; AM.err = "";
    api("automod.get", {f: AM.f, page: AM.page, user: AM.user})
      .then(d => { AM.data = d; AM.loading = false; render(); })
      .catch(e => { AM.loading = false; AM.err = e.message || "Couldn't load the AI moderator."; render(); });
  }
  function where(r) {
    if (r.kind === "message") return "A reported private message";
    if (r.topic) return link("/topic/" + r.topic + (r.post ? "#p" + r.post : ""), r.kind === "topic" ? "Topic #" + r.topic : "Post in topic #" + r.topic) + (r.board ? ` <span class="muted">· ${esc(r.board)}</span>` : "");
    if (r.kind === "member") return "Account";
    return r.board ? esc(r.board) : "";
  }
  function row(r) {
    const [label, tone] = ACTIONS[r.action] || [r.action, ""];
    const canUndo = !r.reversedAt && ["block", "remove", "hide", "warn", "suspend", "flag", "recommend_ban"].includes(r.action);
    const undoLabel = {flag: "Mark checked", recommend_ban: "Dismiss", block: "Mark as mistake", warn: "Remove warning", suspend: "Lift suspension"}[r.action] || "Reverse";
    return `<li class="am-row${r.reversedAt ? " am-rev" : ""}">
      <div class="am-top"><span class="pill ${tone}">${esc(label)}</span>${r.serious ? `<span class="pill red">Serious</span>` : ""}<span class="pill ${r.source === "ai" ? "blue" : ""}">${r.source === "ai" ? "AI" : "Rules"}</span>
        <span>${ulink(r.user)}</span><span class="muted">${esc(dstr(r.at))}</span></div>
      <div class="am-what"><strong>${esc(r.rule)}</strong>${r.reason ? `<div class="muted">${esc(r.reason)}</div>` : ""}<div class="muted">${where(r)}</div></div>
      ${r.excerpt ? `<details class="am-ex"><summary>Show the content</summary><pre>${esc(r.excerpt)}</pre></details>` : ""}
      ${r.reversedAt ? `<div class="am-revnote">Reversed by ${esc(r.reversedBy || "an admin")} · ${esc(dstr(r.reversedAt))}${r.reverseNote ? ": " + esc(r.reverseNote) : ""}</div>`
        : canUndo ? `<div class="row"><button type="button" class="btn small" data-act="amUndo" data-id="${r.id}" data-a="${esc(r.action)}">${undoLabel}</button></div>` : ""}
    </li>`;
  }
  function settings(d) {
    const c = d.cfg, chk = (k, label, hint) => `<label class="am-chk"><input type="checkbox" name="${k}"${c[k] ? " checked" : ""}><span><strong>${label}</strong>${hint ? `<span class="muted">${hint}</span>` : ""}</span></label>`;
    const num = (k, label, min, max, step, hint, val) => `<label>${label}<input class="inp" type="number" name="${k}" min="${min}" max="${max}" step="${step}" value="${val !== undefined ? val : c[k]}">${hint ? `<span class="muted am-hint">${hint}</span>` : ""}</label>`;
    return `<form class="panel form" data-form="amSave"><h3 class="ph">Settings</h3>
      ${chk("enabled", "Check new posts", "Topics, replies, edits and marketplace listings, plus private messages members report.")}
      ${chk("ai", "Use the AI check", "Runs on posts with any warning sign, new accounts and listings, once an AI key is added below.")}
      ${chk("strikes", "Warn and suspend automatically", "First removal: a warning. Then 1, 3 and 7-day suspensions. Suspected scams: suspended straight away. Never a permanent ban.")}
      ${chk("alerts", "Alert me about serious cases straight away", "Scam suspensions, ban recommendations and impersonation, by email and site notification.")}
      <div class="grid am-grid">
        <label>Summary email<select class="inp" name="summary">${[["daily", "Daily"], ["weekly", "Weekly"], ["off", "Off"]].map(([v, t]) => `<option value="${v}"${c.summary === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>What the AI checks<select class="inp" name="ai_scope"><option value="risky"${c.ai_scope === "risky" ? " selected" : ""}>Posts with warning signs (saves cost)</option><option value="all"${c.ai_scope === "all" ? " selected" : ""}>Every post</option></select></label>
        ${num("scam_suspend_days", "Suspension for suspected scams (days)", 0, 7, 1, "0 to 7. 0 means send to you instead.")}
        ${num("ai_daily_cap", "Most AI checks per day", 0, 20000, 10, "A spending cap.")}
      </div>
      <details class="am-adv"><summary>Thresholds</summary>
        <p class="muted" style="margin:6px 0">Each warning sign adds points (a look-alike link 4, asking for a seed phrase 4, a link shortener 2…). A single sign never leads to action on its own.</p>
        <div class="grid am-grid">${num("remove_at", "Remove at", 3, 30, 1, "points")}${num("hide_at", "Hide for checking at", 2, 30, 1, "points")}${num("flag_at", "Send to moderators at", 1, 30, 1, "points")}
        ${num("ai_remove_conf", "AI removes when this sure (%)", 50, 100, 1, "", pct(c.ai_remove_conf))}${num("ai_hide_conf", "AI hides when this sure (%)", 30, 100, 1, "", pct(c.ai_hide_conf))}</div>
      </details>
      <div class="grid am-grid2">
        <label>Blocked sites<textarea class="inp" name="blocked_domains" rows="4" placeholder="one per line, e.g. scam-site.com">${esc((c.blocked_domains || []).join("\n"))}</textarea><span class="muted am-hint">Posts linking here are refused. The sites in Admin → System "banned domains" count too.</span></label>
        <label>Trusted sites<textarea class="inp" name="trusted_domains" rows="4">${esc((c.trusted_domains || []).join("\n"))}</textarea><span class="muted am-hint">Links to these never count as a warning sign.</span></label>
      </div>
      <button class="btn primary" type="submit" style="align-self:flex-start">Save settings</button></form>`;
  }
  function service(d) {
    const c = d.cfg, k = d.key;
    if (!d.canKey) return `<section class="panel"><h3 class="ph">AI service</h3><p style="margin:0">${d.aiReady ? "Connected." : "No AI key yet."} Only a Super Admin can change the AI service.</p></section>`;
    return `<form class="panel form" data-form="amKey"><h3 class="ph">AI service</h3>
      <p class="muted" style="margin:0">${d.aiReady ? `Connected · key ending ${esc(k.end)} · ${d.aiToday} check${d.aiToday === 1 ? "" : "s"} today` : k.set ? "A key is saved but the model name is missing." : "Add a key from your AI provider to switch on the AI check. Until then, the rule-based checks run on their own."}</p>
      <div class="grid am-grid2">
        <label>Provider<select class="inp" name="provider"><option value="anthropic"${c.provider !== "openai" ? " selected" : ""}>Anthropic (Claude)</option><option value="openai"${c.provider === "openai" ? " selected" : ""}>OpenAI or compatible</option></select></label>
        <label>Model<input class="inp" name="model" value="${esc(c.model || "")}" placeholder="${c.provider === "openai" ? "the model name from your provider" : "claude-haiku-4-5-20251001 (default)"}"></label>
        <label class="am-openai"${c.provider === "openai" ? "" : " hidden"}>Service address<input class="inp" name="base_url" value="${esc(c.base_url || "")}" placeholder="https://api.openai.com/v1"></label>
        <label>API key<input class="inp" name="key" type="password" autocomplete="off" placeholder="${k.set ? "•••• " + esc(k.end) + " (leave empty to keep)" : "paste your key"}"></label>
      </div>
      <p class="muted" style="margin:0;font-size:.85rem">The key stays on your server; it's never sent to browsers. AI checks are billed by your provider per post checked.</p>
      <div class="row"><button class="btn primary" type="submit">Save AI service</button>${k.set && !k.fromConfig ? `<button type="button" class="btn" data-act="amKeyDel">Remove key</button>` : ""}</div></form>`;
  }
  function tester(d) {
    const t = AM.test;
    return `<form class="panel form" data-form="amTest"><h3 class="ph">Try it</h3>
      <label>Paste a post<textarea class="inp" name="text" rows="3" placeholder="e.g. Free USDT giveaway, connect your wallet at…"></textarea></label>
      <div class="row am-opts"><label class="am-chk2"><input type="checkbox" name="newAccount" checked> from a new account</label><label class="am-chk2"><input type="checkbox" name="review"> on a reviews board</label>
        <label class="am-chk2"><input type="checkbox" name="market"> in the marketplace</label>${d.aiReady ? `<label class="am-chk2"><input type="checkbox" name="ai" checked> ask the AI too</label>` : ""}</div>
      <button class="btn" type="submit" style="align-self:flex-start"${AM.testing ? " disabled" : ""}>${AM.testing ? "Checking…" : "Check"}</button>
      ${t ? `<div class="am-test"><p style="margin:0"><strong>${esc({remove: "Would be removed", hide: "Would be hidden for checking", flag: "Would be sent to moderators", block: "Would be refused (blocked link)", none: "No action"}[t.decision.action] || t.decision.action)}</strong> · score ${t.score}</p>
        ${t.signals.length ? `<ul>${t.signals.map(s => `<li>${esc(s.label)} <span class="muted">+${s.points}</span></li>`).join("")}</ul>` : `<p class="muted" style="margin:4px 0 0">No warning signs.</p>`}
        ${t.ai ? (t.ai.error ? `<p class="err" style="margin:4px 0 0">AI: ${esc(t.ai.error)}</p>` : `<p style="margin:4px 0 0">AI: <strong>${esc(t.ai.verdict)}</strong> (${pct(t.ai.confidence)}% sure) · ${esc(t.ai.reason)}</p>`) : ""}</div>` : ""}
    </form>`;
  }
  function page() {
    if (!AM.data) { if (!AM.err) load(); return AM.err ? `<div class="notice red">${esc(AM.err)}</div>` : `<p class="muted">Loading…</p>`; }
    const d = AM.data, s = d.stats || {}, n = k => s[k] || 0;
    const tiles = [["Removed or blocked", n("remove") + n("block")], ["Hidden for checking", n("hide")], ["Sent to moderators", n("flag")], ["Warnings", n("warn")], ["Suspensions", n("suspend")], ["Ban recommendations", n("recommend_ban")]];
    const pages = Math.max(1, Math.ceil(d.total / 50));
    return `<p class="muted am-intro">The AI moderator checks posts as they're made. It removes obvious spam and scams, hides doubtful posts until someone checks them, and warns or suspends for up to 7 days. It never bans permanently, never settles casino disputes and never removes criticism. You can reverse any decision here. Status: <strong>${d.cfg.enabled ? "checking posts" : "switched off"}</strong> · AI check <strong>${d.aiReady ? (d.cfg.ai ? "on" : "off") : "waiting for a key"}</strong>${d.queue ? ` · ${d.queue} waiting` : ""}.</p>
      <div class="grid am-tiles">${tiles.map(([l, v]) => `<div class="panel"><div class="ph" style="margin-bottom:4px">${l}</div><div class="score" style="font-size:1.6rem">${v}</div><div class="muted" style="font-size:.8rem">last 24 hours</div></div>`).join("")}</div>
      <div class="cols"><div class="stack">
        <section class="panel flush"><div class="am-head"><h3 class="ph" style="margin:0">Log</h3>
          <form class="row" data-form="amUser" style="gap:6px"><input class="inp" name="user" placeholder="Member name" value="${esc(AM.user)}" style="width:150px"><button class="btn small" type="submit">Filter</button>${AM.user ? `<button class="btn small" type="button" data-act="amClearUser">Clear</button>` : ""}</form></div>
          <div class="tabs am-filters">${FILTERS.map(([v, t]) => `<button type="button" data-act="amFilter" data-v="${v}" aria-pressed="${AM.f === v}">${t}</button>`).join("")}</div>
          ${d.log.length ? `<ul class="am-log">${d.log.map(row).join("")}</ul>` : `<p class="muted" style="padding:14px 16px;margin:0">Nothing here yet.</p>`}
          ${pages > 1 ? `<div class="row" style="padding:10px 16px"><button class="btn small" type="button" data-act="amPage" data-v="${AM.page - 1}"${AM.page <= 0 ? " disabled" : ""}>Newer</button><span class="muted">Page ${AM.page + 1} of ${pages}</span><button class="btn small" type="button" data-act="amPage" data-v="${AM.page + 1}"${AM.page + 1 >= pages ? " disabled" : ""}>Older</button></div>` : ""}
        </section>
        ${settings(d)}
      </div><aside class="stack">${service(d)}${tester(d)}
        <section class="panel"><h3 class="ph">What it may do</h3><ul class="am-limits">
          <li><span class="pill green">On its own</span> Refuse blocked links · remove obvious spam, scams and phishing · hide doubtful posts · warn · suspend up to 7 days (scams: straight away, sent to you to review)</li>
          <li><span class="pill amber">Asks you</span> Permanent bans · impersonation · anything it's unsure about</li>
          <li><span class="pill red">Never</span> Settle casino disputes · remove criticism of casinos or advertisers · read private messages nobody reported · touch staff accounts</li></ul></section>
      </aside></div>`;
  }

  const baseAdmin = vAdmin;
  vAdmin = function (tab) {
    if (tab !== "automod") return baseAdmin.apply(this, arguments);
    if (!can("manageCategories")) return vMissing("The admin dashboard is for admins.");
    return crumbs(["Admin", "/admin"], ["AI moderation"]) + phead("Admin", "Configure the platform without a developer. Every change here is audited.") +
      `<div class="tabs">${ADMIN_TABS.filter(t => t[0] !== "system" || can("system")).map(([k, v]) => `<a href="#" data-go="/admin/${k}" aria-pressed="${tab === k}">${v}</a>`).join("")}</div>` + page();
  };

  ACT.amFilter = el => { AM.f = el.dataset.v || ""; AM.page = 0; AM.data && (AM.data.log = []); load(); };
  ACT.amPage = el => { AM.page = Math.max(0, +el.dataset.v || 0); load(); };
  ACT.amClearUser = () => { AM.user = ""; AM.page = 0; load(); };
  FORMS.amUser = f => { AM.user = f.elements.user.value.trim(); AM.page = 0; load(); };
  ACT.amUndo = el => {
    const id = +el.dataset.id, a = el.dataset.a;
    const what = {remove: "The post goes back up and the member is told.", hide: "The post goes back up.", warn: "The warning is taken off their account.", suspend: "Their account becomes active again.",
      block: "Nothing was posted, so this only records that the block was a mistake. To allow the site, remove it from Blocked sites.", flag: "This only marks it as checked.", recommend_ban: "No ban happens; this dismisses the recommendation."}[a] || "";
    modal({title: a === "flag" ? "Mark as checked" : a === "recommend_ban" ? "Dismiss the ban recommendation" : "Reverse this decision", submit: a === "flag" ? "Mark checked" : a === "recommend_ban" ? "Dismiss" : "Reverse",
      body: `<p style="margin-top:0">${esc(what)}</p><label>Note for the log (optional)<input class="inp" name="note" maxlength="300"></label>`,
      onSubmit: f => api("automod.reverse", {id, note: f.elements.note.value.trim()}).then(() => { toast("Done."); AM.data = null; load(); return null; })});
  };
  FORMS.amSave = f => {
    const e = f.elements, b = k => e[k].checked;
    const body = {enabled: b("enabled"), ai: b("ai"), strikes: b("strikes"), alerts: b("alerts"), summary: e.summary.value, ai_scope: e.ai_scope.value,
      scam_suspend_days: +e.scam_suspend_days.value, ai_daily_cap: +e.ai_daily_cap.value, remove_at: +e.remove_at.value, hide_at: +e.hide_at.value, flag_at: +e.flag_at.value,
      ai_remove_conf: (+e.ai_remove_conf.value) / 100, ai_hide_conf: (+e.ai_hide_conf.value) / 100, blocked_domains: e.blocked_domains.value, trusted_domains: e.trusted_domains.value};
    api("automod.save", body).then(() => { toast("Settings saved."); AM.data = null; load(); }).catch(x => toast(x.message));
  };
  FORMS.amKey = f => {
    const e = f.elements, body = {provider: e.provider.value, model: e.model.value.trim(), base_url: e.base_url.value.trim()};
    if (e.key.value.trim()) body.key = e.key.value.trim();
    api("automod.save", body).then(() => { toast("AI service saved."); AM.data = null; load(); }).catch(x => toast(x.message));
  };
  ACT.amKeyDel = () => modal({title: "Remove the AI key?", body: `<p style="margin-top:0">The AI check stops. The rule-based checks carry on.</p>`, submit: "Remove key", danger: true,
    onSubmit: () => api("automod.save", {key: ""}).then(() => { toast("Key removed."); AM.data = null; load(); return null; })});
  FORMS.amTest = f => {
    const e = f.elements, text = e.text.value.trim(); if (!text) return toast("Paste some text to test.");
    AM.testing = true; render();
    api("automod.test", {text, newAccount: e.newAccount.checked, review: e.review.checked, market: e.market.checked, ai: e.ai ? e.ai.checked : false})
      .then(r => { AM.test = r; AM.testing = false; render(); const ta = document.querySelector('[data-form="amTest"] textarea'); if (ta) ta.value = text; })
      .catch(x => { AM.testing = false; render(); toast(x.message); });
  };
  document.addEventListener("change", ev => {
    const s = ev.target; if (!s.matches || !s.matches('[data-form="amKey"] select[name="provider"]')) return;
    const box = s.form.querySelector(".am-openai"); if (box) box.hidden = s.value !== "openai";
  });

  const st = document.createElement("style");
  st.textContent = `.am-intro{margin:0 0 12px;line-height:1.55}.am-tiles{grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:16px}
.am-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 16px 6px}.am-filters{padding:0 16px;margin:0 0 4px;flex-wrap:wrap}
.am-log{list-style:none;margin:0;padding:0}.am-row{padding:12px 16px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px}.am-rev{opacity:.7}
.am-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:.9rem}.am-what{font-size:.92rem;line-height:1.45;overflow-wrap:anywhere}
.am-ex summary{cursor:pointer;font-size:.85rem;color:var(--muted)}.am-ex pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.86rem;margin:6px 0 0;padding:8px 10px;border-radius:8px;background:var(--bg2,rgba(127,127,127,.08));max-height:220px;overflow:auto}
.am-revnote{font-size:.85rem;color:var(--muted)}.am-chk{display:flex;gap:10px;align-items:flex-start;flex-direction:row!important}.am-chk input{margin-top:4px}.am-chk span{display:flex;flex-direction:column;gap:2px}
.am-chk .muted{font-size:.85rem;font-weight:400}.am-grid{grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.am-grid2{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.am-hint{font-size:.8rem;font-weight:400}.am-adv summary{cursor:pointer;font-weight:600}.am-opts{gap:12px;flex-wrap:wrap}.am-chk2{display:flex;gap:6px;align-items:center;flex-direction:row!important;font-size:.9rem}
.am-test{border-top:1px solid var(--line);padding-top:10px;font-size:.92rem}.am-test ul{margin:6px 0 0;padding-left:18px}.am-limits{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px;font-size:.9rem;line-height:1.5}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
