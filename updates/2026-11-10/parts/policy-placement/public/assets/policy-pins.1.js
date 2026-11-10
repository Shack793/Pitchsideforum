/* Pitchside Forum: shows the rules where they apply.
   - Complaints page (/complaints) and the "File a complaint" form: the Casino Complaints & Dispute Resolution Policy.
   - Casino and sportsbook card pages (/casinos, /sportsbooks) and the "Write a review" form: the Review Guidelines.
   Each links to the full post. Nothing shows if the post isn't on the site. It only wraps app functions. */
(function () {
  if (typeof TOPICS === "undefined" || typeof render !== "function") return;
  const DOCS = {
    complaints: {title: "Casino Complaints & Dispute Resolution Policy", blurb: "How complaints work here, what to include, how casinos can respond, and what Pitchside can and can't do.", cta: "Read the policy"},
    reviews: {title: "Casino & Sportsbook Review Guidelines", blurb: "What makes a useful review, how ratings work, disclosing affiliate links, and how operators can reply.", cta: "Read the guidelines"},
  };
  const find = k => TOPICS.find(t => t.title === DOCS[k].title && !t.deleted);
  function card(k) {
    const t = find(k); if (!t) return "";
    return `<div class="panel pp-card"><span class="pill solid pp-pin">📌 Pinned</span><div class="pp-txt"><strong>${link("/topic/" + t.id, esc(DOCS[k].title))}</strong><span class="muted">${esc(DOCS[k].blurb)}</span></div>
      <a class="btn small" href="${typeof LIVE !== "undefined" && LIVE ? "/topic/" + t.id : "#"}" data-go="/topic/${t.id}">${esc(DOCS[k].cta)}</a></div>`;
  }
  function line(k, verb) {
    const t = find(k); if (!t) return "";
    return `<p class="pp-line">📌 Before you ${verb}, please read the ${link("/topic/" + t.id, esc(DOCS[k].title))}.</p>`;
  }
  function afterHead(html, n) {
    if (!n || typeof html !== "string") return html;
    const start = html.indexOf('<div class="phead">'); if (start < 0) return html;   // e.g. the 18+ check: show nothing yet
    let depth = 0, i = start; const re = /<div\b|<\/div>/g; re.lastIndex = start; let m;
    while ((m = re.exec(html))) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { i = re.lastIndex; break; } }
    return html.slice(0, i) + n + html.slice(i);
  }
  if (typeof vComplaints === "function") { const base = vComplaints; vComplaints = function () { return afterHead(base.apply(this, arguments), card("complaints")); }; }
  if (typeof vHub === "function") { const base = vHub; vHub = function () { return afterHead(base.apply(this, arguments), card("reviews")); }; }
  if (typeof modal === "function") {
    const base = modal;
    modal = function (o) {
      try {
        if (o && typeof o.body === "string") {
          if (o.title === "File a complaint") o = Object.assign({}, o, {body: line("complaints", "file a complaint") + o.body});
          else if (o.title === "Post a review" || (/^Review /.test(o.title || "") && o.title !== "Review history")) o = Object.assign({}, o, {body: line("reviews", "write a review") + o.body});
        }
      } catch (e) {}
      return base.call(this, o);
    };
  }
  const st = document.createElement("style");
  st.textContent = `.pp-card{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;margin:0 0 14px}.pp-pin{white-space:nowrap}
.pp-txt{display:flex;flex-direction:column;gap:2px;flex:1 1 260px;min-width:0;line-height:1.45}.pp-txt .muted{font-size:.88rem}
.pp-line{margin:0 0 12px;padding:8px 10px;border-radius:8px;background:var(--info-soft);font-size:.9rem;line-height:1.45}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
