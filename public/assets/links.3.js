/* Pitchside Forum: every step in the page trail ("Home › Forum › Gambling › Casino Reviews") is a working link.
   The section names (Sports, Gambling, Crypto, Marketplace, Community) used to be plain text on board pages,
   and "Tags" had no page. This links them, and adds a /tags page listing every tag. On the Forum page, the section
   headings (Sports, Gambling…) open their section too, and so do the section names in the home page's Boards box. It only wraps app functions. */
(function () {
  if (typeof render !== "function" || typeof CATEGORIES === "undefined") return;
  const PATH = {sports: "/sports", gambling: "/gambling", crypto: "/crypto", market: "/marketplace", community: "/community"};
  const catPath = name => { const c = CATEGORIES.find(x => x.name === name); return c ? (PATH[c.id] || "/forum") : null; };
  function fixTrail() {
    document.querySelectorAll("nav.crumbs").forEach(nav => {
      const items = [...nav.children]; items.slice(0, -1).forEach(el => {
        if (el.matches("a") || el.querySelector("a")) return;
        const txt = el.textContent.trim(), p = txt === "Tags" ? "/tags" : catPath(txt);
        if (p) el.innerHTML = link(p, esc(txt));
      });
    });
  }
  // the tags page
  function vTags() {
    const pub = TAGS.filter(t => !/^bug-/.test(t.slug));
    const live = typeof readable === "function" ? readable() : TOPICS;
    const n = slug => live.filter(t => (t.tags || []).includes(slug)).length;
    const rows = pub.map(t => [t, n(t.slug)]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name));
    return crumbs(["Tags"]) + phead("Tags", "Every topic tag on Pitchside. Pick one to see its topics.") +
      `<section class="panel"><ul class="lk-tags">${rows.map(([t, c]) => `<li>${link("/tag/" + t.slug, "#" + esc(t.name))}<span class="muted">${c} topic${c === 1 ? "" : "s"}</span>${t.desc ? `<span class="muted lk-d">${esc(t.desc)}</span>` : ""}</li>`).join("")}</ul></section>`;
  }
  const baseGate = typeof liveGate === "function" ? liveGate : null;
  window.liveGate = function (seg, qs) {
    if ((seg[0] || "") === "tags" && !seg[1]) return vTags();
    return baseGate ? baseGate.apply(this, arguments) : null;
  };
  try { liveGate = window.liveGate; } catch (e) {}
  // Forum page: section headings open the section
  if (typeof vForum === "function") {
    const baseForum = vForum;
    vForum = function () {
      let out = baseForum.apply(this, arguments);
      if (typeof out !== "string") return out;
      CATEGORIES.forEach(c => {
        const p = PATH[c.id] || null; if (!p) return;
        out = out.split(`<h2 class="sec">${esc(c.name)}`).join(`<h2 class="sec">${link(p, esc(c.name), "lk-sec")}<span class="lk-go" aria-hidden="true">›</span>`);
      });
      return out;
    };
  }
  // Home page "Boards" box: the section names (Sports, Gambling, Crypto, Marketplace, Community) open their section
  if (typeof vHome === "function") {
    const baseHome = vHome;
    vHome = function () {
      let out = baseHome.apply(this, arguments);
      if (typeof out !== "string") return out;
      CATEGORIES.forEach(c => {
        const p = PATH[c.id] || null; if (!p) return;
        out = out.split(`<div style="margin-bottom:10px"><strong>${esc(c.name)}</strong>`).join(`<div style="margin-bottom:10px"><strong>${link(p, esc(c.name), "lk-sec")}</strong>`);
      });
      return out;
    };
  }
  const base = render;
  render = function () { const r = base.apply(this, arguments); try { fixTrail(); } catch (e) {} return r; };
  const st = document.createElement("style");
  st.textContent = `.lk-tags{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px 16px}
.lk-sec{color:inherit;text-decoration:none}.lk-sec:hover,.lk-sec:focus-visible{text-decoration:underline}.lk-go{margin-left:6px;color:var(--muted);font-weight:400}
.lk-tags li{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid var(--line)}.lk-tags a{font-weight:600}.lk-d{font-size:.85rem}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
