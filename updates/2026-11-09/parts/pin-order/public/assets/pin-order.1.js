/* Pitchside Forum: choose the order of pinned topics.
   On a board with two or more pinned topics, moderators who can pin there (and admins) see Up and Down buttons
   on each pinned topic. The order is saved for everyone and stays put when topics get new replies.
   A topic pinned later shows at the top until it's moved. Members and guests just see the chosen order.
   Loaded after pins-scoped.1.js; it only wraps app functions, it doesn't change the app file. */
(function () {
  if (typeof render !== "function" || typeof TOPICS === "undefined") return;
  const TOP_NEW = 2000000, TOP_SET = 1000000;
  const orderMap = () => (typeof LAYOUT === "object" && LAYOUT && LAYOUT.pinOrder && typeof LAYOUT.pinOrder === "object") ? LAYOUT.pinOrder : {};
  const live = () => (typeof readable === "function" ? readable() : TOPICS);

  // Pinned topics carry a rank in place of "true", so the app's own "pinned first" sorting puts them in order
  function rank() {
    const po = orderMap();
    TOPICS.forEach(t => {
      if (!t.pinned) return;
      const l = Array.isArray(po[t.board]) ? po[t.board] : [];
      const i = l.indexOf(t.id);
      t.pinned = i < 0 ? TOP_NEW : TOP_SET - i;
    });
  }
  const lastOf = t => (typeof lastAt === "function" ? lastAt(t) : t.at || 0);
  // The pinned topics of a board, in the order they're shown
  const pinsOf = slug => { rank(); return live().filter(t => t.board === slug && t.pinned && !t.deleted).sort((a, b) => (b.pinned - a.pinned) || (lastOf(b) - lastOf(a))); };
  const canOrder = slug => typeof mp === "function" && !!S.user && mp("topic.pin", slug);

  function setLocal(slug, ids) {
    if (typeof LAYOUT !== "object" || !LAYOUT) return;
    if (!LAYOUT.pinOrder || typeof LAYOUT.pinOrder !== "object" || Array.isArray(LAYOUT.pinOrder)) LAYOUT.pinOrder = {};
    LAYOUT.pinOrder[slug] = ids;
    // the server keeps the order, so the admin settings autosave shouldn't send LAYOUT again because of it
    try { if (typeof PS === "object" && PS.docSnap && typeof docSer === "function") PS.docSnap.LAYOUT = docSer(LAYOUT); } catch (e) {}
  }

  ACT.pinMove = el => {
    const t = topic(el.dataset.id), dir = +el.dataset.dir; if (!t || !dir) return;
    const slug = t.board; if (!canOrder(slug)) return toast("Your moderator permissions don't include pinning on this board.");
    const list = pinsOf(slug).map(x => x.id), i = list.indexOf(t.id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const before = orderMap()[slug] ? orderMap()[slug].slice() : null;
    [list[i], list[j]] = [list[j], list[i]];
    setLocal(slug, list); render();
    api("pins.order", {board: slug, ids: list})
      .then(res => { if (res && Array.isArray(res.order)) setLocal(slug, res.order); render(); })
      .catch(e => {
        if (before) setLocal(slug, before);
        else { delete orderMap()[slug]; try { if (PS.docSnap && typeof docSer === "function") PS.docSnap.LAYOUT = docSer(LAYOUT); } catch (x) {} }
        render(); toast(e.message);
      });
  };

  // Up / Down buttons on pinned topics in topic lists
  function decorate() {
    const view = document.getElementById("view"); if (!view || !S.user) return;
    view.querySelectorAll("ul.tlist").forEach(ul => {
      const rows = [...ul.children].filter(li => li.classList.contains("pinned"));
      const groups = {};
      rows.forEach(li => {
        const a = li.querySelector('h4 a[data-go^="/topic/"]'); const t = a && topic(a.dataset.go.split("/")[2]);
        if (t) (groups[t.board] = groups[t.board] || []).push([li, t]);
      });
      Object.entries(groups).forEach(([slug, g]) => {
        if (g.length < 2 || !canOrder(slug)) return;
        const order = pinsOf(slug).map(x => x.id);
        g.forEach(([li, t]) => {
          if (li.querySelector(".po-ctl")) return;
          const i = order.indexOf(t.id);
          const box = document.createElement("div"); box.className = "po-ctl"; box.setAttribute("role", "group"); box.setAttribute("aria-label", "Pinned order");
          box.innerHTML = `<button type="button" class="btn small" data-act="pinMove" data-id="${t.id}" data-dir="-1" title="Move this pinned topic up" aria-label="Move “${esc(t.title)}” up"${i <= 0 ? " disabled" : ""}>▲ Up</button>`
            + `<button type="button" class="btn small" data-act="pinMove" data-id="${t.id}" data-dir="1" title="Move this pinned topic down" aria-label="Move “${esc(t.title)}” down"${i < 0 || i >= order.length - 1 ? " disabled" : ""}>▼ Down</button>`;
          (li.firstElementChild || li).appendChild(box);
        });
      });
    });
  }

  const st = document.createElement("style");
  st.textContent = ".po-ctl{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}.po-ctl .btn{padding:2px 10px;min-height:0;font-size:.78rem;line-height:1.6}.po-ctl .btn[disabled]{opacity:.4;cursor:default}";
  document.head.appendChild(st);

  const base = render;
  render = function () { rank(); const r = base.apply(this, arguments); try { decorate(); } catch (e) {} return r; };
  try { render(); } catch (e) {}
})();
