/* Pitchside Forum: Admin → Visitors. Unique visitors per day, week, month and year, by country.
   No IP addresses are stored. Server side: app/ops/zz-visitors.php. It only wraps app functions. */
(function () {
  if (typeof vAdmin !== "function" || typeof ADMIN_TABS === "undefined") return;
  if (!ADMIN_TABS.some(t => t[0] === "visitors")) {
    const i = ADMIN_TABS.findIndex(t => t[0] === "overview");
    ADMIN_TABS.splice(i < 0 ? 0 : i + 1, 0, ["visitors", "Visitors"]);
  }
  const V = {unit: "day", back: 0, data: null, loading: false, err: ""};
  const nf = n => Number(n || 0).toLocaleString("en-GB");
  let names = null; try { names = new Intl.DisplayNames(["en"], {type: "region"}); } catch (e) {}
  const cname = cc => (!cc || cc === "XX" || cc === "ZZ") ? "Unknown" : ((names && names.of(cc)) || cc);
  const flag = cc => (!cc || cc === "XX" || cc === "ZZ" || !/^[A-Z]{2}$/.test(cc)) ? "🌐" : String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  const UNITS = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]];

  function load() {
    if (V.loading) return; V.loading = true; V.err = "";
    api("visitors.stats", {unit: V.unit, back: V.back})
      .then(d => { V.data = d; V.loading = false; render(); })
      .catch(e => { V.loading = false; V.err = e.message || "Couldn't load visitor numbers."; render(); });
  }
  function change(now, prev) {
    if (!prev) return now ? `<span class="muted">new</span>` : "";
    const p = Math.round((now - prev) / prev * 100);
    return `<span class="muted">${p > 0 ? "▲ " + p : p < 0 ? "▼ " + Math.abs(p) : "±0"}% vs previous</span>`;
  }
  function chart(d) {
    const max = Math.max(1, ...d.trend.map(t => t.visitors));
    const short = t => d.unit === "day" ? new Date(t.from + "T00:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"})
      : d.unit === "week" ? new Date(t.from + "T00:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"})
      : d.unit === "month" ? new Date(t.from + "T00:00:00Z").toLocaleDateString("en-GB", {month: "short", year: "2-digit", timeZone: "UTC"}) : t.from.slice(0, 4);
    const n = d.trend.length, show = i => i === 0 || i === n - 1 || (n > 6 ? i === Math.floor((n - 1) / 2) : true);
    return `<div class="vs-chart" role="group" aria-label="Unique visitors per ${d.unit}, oldest to newest">
      <div class="vs-ytop muted">${nf(max)}</div>
      <div class="vs-bars">${d.trend.map((t, i) => {
        const h = t.visitors ? Math.max(2, Math.round(t.visitors / max * 100)) : 0, sel = i === n - 1;
        return `<button type="button" class="vs-col${sel ? " vs-sel" : ""}" data-act="vsPick" data-back="${d.back + (n - 1 - i)}" aria-label="${esc(t.label)}: ${nf(t.visitors)} unique visitors, ${nf(t.loads)} page loads"
          data-tip="${esc(t.label)}|${nf(t.visitors)} unique visitors|${nf(t.loads)} page loads"><span class="vs-bar" style="height:${h}%"></span></button>`; }).join("")}</div>
      <div class="vs-x muted">${d.trend.map((t, i) => `<span>${show(i) ? esc(short(t)) : ""}</span>`).join("")}</div>
      <div class="vs-tip" hidden></div></div>
      <details class="vs-table"><summary>Show as a table</summary><div class="tw"><table class="t"><thead><tr><th>${esc(UNITS.find(u => u[0] === d.unit)[1])}</th><th class="n">Unique visitors</th><th class="n">Page loads</th></tr></thead>
        <tbody>${d.trend.slice().reverse().map(t => `<tr><td>${esc(t.label)}</td><td class="n">${nf(t.visitors)}</td><td class="n">${nf(t.loads)}</td></tr>`).join("")}</tbody></table></div></details>`;
  }
  function page() {
    if (!V.data) { if (!V.err) load(); return V.err ? `<div class="notice red">${esc(V.err)}</div>` : `<p class="muted">Loading…</p>`; }
    const d = V.data, tot = d.now.visitors || 0;
    const geo = d.geo.installed ? `Country data: <a href="https://db-ip.com" target="_blank" rel="noopener">IP Geolocation by DB-IP</a> (${esc(d.geo.source.replace("dbip-country-lite-", ""))}).`
      : `Country lookup isn't installed yet, so visitors show as "Unknown". The server tries to download it every day.`;
    return `<p class="muted vs-intro">Unique visitors are counted once per period, however many pages they open. No IP addresses are stored; only the country is kept. Bots and crawlers aren't counted. Days run on UTC.${d.first ? ` Counting since ${esc(dday(new Date(d.first + "T00:00:00Z").getTime()))}.` : ""}</p>
      <div class="grid vs-tiles">${d.tiles.map(t => `<button type="button" class="panel vs-tile${t.unit === V.unit && V.back === 0 ? " vs-on" : ""}" data-act="vsUnit" data-v="${t.unit}">
        <span class="ph" style="margin-bottom:4px">${esc(t.label)}</span><span class="score" style="font-size:1.8rem">${nf(t.visitors)}</span><span class="muted" style="font-size:.82rem">unique visitors · ${nf(t.loads)} page loads</span></button>`).join("")}</div>
      <section class="panel vs-panel">
        <div class="vs-head"><div class="tabs" style="margin:0">${UNITS.map(([k, l]) => `<button type="button" data-act="vsUnit" data-v="${k}" aria-pressed="${V.unit === k}">${l}</button>`).join("")}</div>
          <div class="row" style="gap:6px"><button type="button" class="btn small" data-act="vsStep" data-v="1" aria-label="Previous ${V.unit}">‹</button><strong class="vs-label">${esc(d.label)}</strong>
            <button type="button" class="btn small" data-act="vsStep" data-v="-1" aria-label="Next ${V.unit}"${V.back === 0 ? " disabled" : ""}>›</button>${V.back ? `<button type="button" class="btn small" data-act="vsNow">Now</button>` : ""}</div></div>
        <p style="margin:6px 0 12px"><span class="score" style="font-size:1.4rem">${nf(tot)}</span> unique visitors · ${nf(d.now.loads)} page loads ${V.back === 0 ? `<span class="muted">so far</span>` : change(tot, d.prev.visitors)}</p>
        ${chart(d)}
      </section>
      <section class="panel flush"><h3 class="ph" style="padding:14px 16px 0">Countries · ${esc(d.label)}</h3>
        ${d.countries.length ? `<div class="tw"><table class="t vs-ct"><thead><tr><th>Country</th><th class="n">Unique visitors</th><th class="n">Share</th><th class="n">Page loads</th></tr></thead><tbody>
          ${d.countries.map(c => { const s = tot ? c.visitors / tot * 100 : 0; return `<tr><td><span class="vs-flag" aria-hidden="true">${flag(c.cc)}</span> ${esc(cname(c.cc))}</td><td class="n">${nf(c.visitors)}</td>
            <td class="n"><span class="vs-share"><span class="vs-sbar"><span style="width:${Math.max(1, Math.round(s))}%"></span></span>${s < 1 && s > 0 ? "<1" : Math.round(s)}%</span></td><td class="n">${nf(c.loads)}</td></tr>`; }).join("")}
        </tbody></table></div>` : `<p class="muted" style="padding:0 16px 14px;margin:8px 0 0">No visitors in this period yet.</p>`}
        <p class="muted vs-note">${geo} A visitor who travels can appear under more than one country, so countries can add up to slightly more than the total.</p>
      </section>`;
  }

  const baseAdmin = vAdmin;
  vAdmin = function (tab) {
    if (tab !== "visitors") return baseAdmin.apply(this, arguments);
    if (!can("manageCategories")) return vMissing("The admin dashboard is for admins.");
    return crumbs(["Admin", "/admin"], ["Visitors"]) + phead("Admin", "Configure the platform without a developer. Every change here is audited.") +
      `<div class="tabs">${ADMIN_TABS.filter(t => t[0] !== "system" || can("system")).map(([k, v]) => `<a href="#" data-go="/admin/${k}" aria-pressed="${tab === k}">${v}</a>`).join("")}</div>` + page();
  };
  ACT.vsUnit = el => { V.unit = el.dataset.v; V.back = 0; load(); };
  ACT.vsStep = el => { V.back = Math.max(0, V.back + (+el.dataset.v)); load(); };
  ACT.vsNow = () => { V.back = 0; load(); };
  ACT.vsPick = el => { V.back = +el.dataset.back; load(); };

  // hover / focus tooltip on the bars
  const tip = (el, on) => {
    const box = el.closest(".vs-chart"), t = box && box.querySelector(".vs-tip"); if (!t) return;
    if (!on) { t.hidden = true; return; }
    const [a, b, c] = el.dataset.tip.split("|"); t.innerHTML = `<strong>${a}</strong><br>${b}<br><span class="muted">${c}</span>`; t.hidden = false;
    const r = el.getBoundingClientRect(), br = box.getBoundingClientRect();
    t.style.left = Math.min(Math.max(0, r.left - br.left + r.width / 2 - t.offsetWidth / 2), br.width - t.offsetWidth) + "px";
  };
  document.addEventListener("mouseover", e => { const b = e.target.closest && e.target.closest(".vs-col"); if (b) tip(b, true); });
  document.addEventListener("mouseout", e => { const b = e.target.closest && e.target.closest(".vs-col"); if (b) tip(b, false); });
  document.addEventListener("focusin", e => { const b = e.target.closest && e.target.closest(".vs-col"); if (b) tip(b, true); });
  document.addEventListener("focusout", e => { const b = e.target.closest && e.target.closest(".vs-col"); if (b) tip(b, false); });

  const st = document.createElement("style");
  st.textContent = `.vs-intro{margin:0 0 12px;line-height:1.55}.vs-tiles{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px}
.vs-tile{display:flex;flex-direction:column;align-items:flex-start;text-align:left;cursor:pointer;font:inherit;color:inherit}.vs-on{outline:2px solid var(--turf);outline-offset:-2px}
.vs-panel{margin-bottom:16px}.vs-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.vs-label{min-width:0;text-align:center}
.vs-chart{position:relative;padding-top:18px}.vs-ytop{position:absolute;top:0;left:0;font-size:.75rem}
.vs-bars{display:flex;align-items:flex-end;gap:2px;height:180px;border-bottom:1px solid var(--line);background:linear-gradient(var(--line),var(--line)) 0 0/100% 1px no-repeat}
.vs-col{flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end;padding:0;border:0;background:none;cursor:pointer}
.vs-col:focus-visible{outline:2px solid var(--focus,var(--turf));outline-offset:1px}.vs-bar{display:block;width:100%;max-width:28px;margin:0 auto;background:var(--turf);border-radius:4px 4px 0 0;opacity:.55}
.vs-sel .vs-bar,.vs-col:hover .vs-bar{opacity:1}.vs-x{display:flex;gap:2px;font-size:.72rem;margin-top:4px}.vs-x span{flex:1 1 0;min-width:0;text-align:center;white-space:nowrap;overflow:visible}
.vs-x span:first-child{text-align:left}.vs-x span:last-child{text-align:right}
.vs-tip{position:absolute;top:0;z-index:5;padding:6px 10px;border-radius:8px;background:var(--surface);border:1px solid var(--line);box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:.82rem;line-height:1.4;pointer-events:none;white-space:nowrap}
.vs-table{margin-top:10px}.vs-table summary{cursor:pointer;font-size:.88rem;color:var(--muted)}
.vs-flag{font-size:1.1rem;margin-right:4px}.vs-share{display:inline-flex;align-items:center;gap:8px;justify-content:flex-end}.vs-sbar{display:inline-block;width:70px;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.vs-sbar span{display:block;height:100%;background:var(--turf);border-radius:3px}.vs-note{font-size:.82rem;padding:10px 16px 14px;margin:0}
@media (max-width:520px){.vs-sbar{width:36px}.vs-bars{height:140px}.vs-ct th:nth-child(4),.vs-ct td:nth-child(4){display:none}.vs-ct td,.vs-ct th{padding-left:8px;padding-right:8px}}`;
  document.head.appendChild(st);
  try { render(); } catch (e) {}
})();
