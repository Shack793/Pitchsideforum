/* Pitchside Forum: videos and formatting in posts.
   - Videos: YouTube and Vimeo links show as a player. Nothing is hosted on Pitchside: the video plays from
     YouTube's privacy-enhanced player (youtube-nocookie.com) or Vimeo, and only after the member presses play.
   - Formatting: **bold**, *italic*, ~~strike~~, lists ("- " or "1. " at the start of a line) and [spoiler]…[/spoiler].
     Posts are still stored as plain text; formatting is applied when they're shown, after everything is made safe.
   - Toolbar above every post and message box: Bold, Italic, Strike, List, Numbered list, Quote, Spoiler,
     Link, Picture and Video. Picture and Video ask for a link (pictures stay on the member's image host).
   Version 2: lists keep their own numbers (a list that continues after a paragraph carries on at 4, 5…), indented
   lines and sub-points stay inside their item, "### Headings" and "---" lines from ChatGPT show properly, and
   pasting from ChatGPT, Google Docs, Word or a web page turns its lists, bold and headings into post formatting.
   Loaded after post-images.1.js; it only wraps app functions, it doesn't change the app file. */
(function () {
  if (typeof renderBody !== "function") return;
  const MAX_VIDEOS = 3;

  // ---------- Videos ----------
  function videoOf(href) {
    let u; try { u = new URL(href.replace(/&amp;/g, "&")); } catch (e) { return null; }
    if (u.protocol !== "https:") return null;
    const h = u.hostname.replace(/^(www|m)\./, ""), start = parseInt((u.searchParams.get("t") || u.searchParams.get("start") || "0").replace(/s$/, ""), 10) || 0;
    let id = null;
    if (h === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (h === "youtube.com" || h === "music.youtube.com") id = u.pathname === "/watch" ? u.searchParams.get("v") : (u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/) || [])[1];
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return {kind: "yt", id, start, url: `https://www.youtube.com/watch?v=${id}`};
    const v = h === "vimeo.com" && u.pathname.match(/^\/(\d{6,12})\/?$/);
    if (v) return {kind: "vimeo", id: v[1], start: 0, url: `https://vimeo.com/${v[1]}`};
    return null;
  }
  const videoHtml = v => `<div class="pvid" data-kind="${v.kind}" data-id="${esc(v.id)}" data-start="${v.start}"><button type="button" class="pvid-play" data-act="playVideo" aria-label="Play ${v.kind === "yt" ? "YouTube" : "Vimeo"} video">${v.kind === "yt" ? `<img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pvid-vimeo">Vimeo video</span>`}<span class="pvid-btn" aria-hidden="true">▶</span></button><a class="pvid-src" href="${esc(v.url)}" target="_blank" rel="noopener nofollow ugc">Watch on ${v.kind === "yt" ? "YouTube" : "Vimeo"} ↗</a></div><!--pv-->`;
  ACT.playVideo = el => {
    const box = el.closest(".pvid"); if (!box) return;
    const id = box.dataset.id, start = +box.dataset.start || 0;
    const src = box.dataset.kind === "yt" ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0${start ? `&start=${start}` : ""}` : `https://player.vimeo.com/video/${encodeURIComponent(id)}?autoplay=1&dnt=1`;
    const f = document.createElement("iframe");
    f.src = src; f.title = "Video"; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.allowFullscreen = true; f.referrerPolicy = "strict-origin-when-cross-origin";
    el.replaceWith(f);
  };

  // ---------- Formatting ----------
  const inline = t => t
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(>])\*([^*\s][^*\n]*?)\*(?=$|[\s).,!?:;<])/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+?)~~/g, "<s>$1</s>");

  // ---------- Lists, headings and lines ----------
  // An item: optional indent, then "- ", "• ", "* ", "● " or a number "1." / "1)" followed by a space or tab
  const ITEM = /^([ \t]*)(?:([-•*●○▪■◦])|(\d{1,3})[.)])[ \t]+(.*)$/;
  const indentOf = w => w.replace(/\t/g, "    ").length;
  function lists(h) {
    const src = h.split("\n"), out = [];
    let stack = [];   // open lists, outermost first: {ind, type, start, items: [html]}
    const listHtml = l => `<${l.type}${l.type === "ol" && l.start !== 1 ? ` start="${l.start}"` : ""}>${l.items.map(x => `<li>${x}</li>`).join("")}</${l.type}>`;
    const closeTop = () => {
      const l = stack.pop(), html = listHtml(l);
      if (stack.length) { const p = stack[stack.length - 1]; p.items[p.items.length - 1] += html; }
      else out.push({list: html});
    };
    const closeAll = () => { while (stack.length) closeTop(); };
    const nextLine = i => { for (let k = i + 1; k < src.length; k++) if (src[k].trim()) return src[k]; return null; };
    for (let i = 0; i < src.length; i++) {
      const line = src[i];
      // a line that opens or closes a quote or spoiler is never a list item (the tags would cross)
      const edge = /<\/?(blockquote|details|div)[\s>]/.test(line);
      const m = edge ? null : line.match(ITEM);
      if (m) {
        const ind = indentOf(m[1]), type = m[3] ? "ol" : "ul", num = m[3] ? +m[3] : 1;
        while (stack.length && stack[stack.length - 1].ind > ind) closeTop();
        const top = stack[stack.length - 1];
        if (top && top.ind === ind && top.type !== type) { closeTop(); }
        const t2 = stack[stack.length - 1];
        if (!t2 || t2.ind < ind) stack.push({ind, type, start: num, items: []});
        stack[stack.length - 1].items.push(m[4]);
        continue;
      }
      if (stack.length) {
        if (!line.trim()) {
          // a blank line inside a list keeps it open when the list carries on afterwards
          const nx = nextLine(i);
          if (nx !== null && (ITEM.test(nx) || /^[ \t]+\S/.test(nx))) continue;
          closeAll(); out.push(line); continue;
        }
        if (!edge && /^[ \t]+\S/.test(line)) {
          // an indented line under an item belongs to that item
          const ind = indentOf(line.match(/^[ \t]*/)[0]);
          while (stack.length > 1 && stack[stack.length - 1].ind >= ind) closeTop();
          const l = stack[stack.length - 1]; l.items[l.items.length - 1] += "<br>" + line.trim();
          continue;
        }
        closeAll();
      }
      const hd = line.match(/^#{1,6}[ \t]+(.+?)[ \t#]*$/);
      if (hd) { out.push(`<strong class="pm-h">${hd[1].replace(/^\*\*(.*)\*\*$/, "$1")}</strong>`); continue; }
      if (/^[ \t]*(?:-{3,}|\*{3,}|_{3,}|—{2,})[ \t]*$/.test(line)) { out.push({list: '<hr class="pm-hr">'}); continue; }
      out.push(line);
    }
    closeAll();
    // blocks (lists, rules) sit on their own: no line break straight after them
    let r = "";
    out.forEach((x, k) => {
      if (typeof x === "object") { r = r.replace(/\n$/, "") + x.list + "\x00"; return; }
      r += x + (k < out.length - 1 ? "\n" : "");
    });
    return r.replace(/\x00/g, "");
  }

  function format(h) {
    // spoilers
    h = h.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]\n?/gi, (m, x) => `<details class="spoiler"><summary>Spoiler: click to show</summary><div>${x.replace(/^\n|\n$/g, "")}</div></details>`);
    h = lists(h);
    // bold / italic / strike only in text, never inside tags or links
    let inA = 0;
    return h.split(/(<[^>]+>)/).map(part => {
      if (part.startsWith("<")) { if (/^<a[\s>]/i.test(part)) inA++; else if (/^<\/a>/i.test(part)) inA = Math.max(0, inA - 1); return part; }
      return inA ? part : inline(part);
    }).join("");
  }

  const base = renderBody;
  renderBody = function () {
    let h = base.apply(this, arguments); if (typeof h !== "string") return h;
    let n = 0;
    h = h.replace(/<a href="(https:\/\/[^"]+)" target="_blank" rel="noopener nofollow ugc">([^<]*)<\/a>/g, (m, href) => {
      const v = videoOf(href); if (!v || n >= MAX_VIDEOS) return m; n++; return videoHtml(v);
    });
    // a video is a block of its own: drop the line breaks around it so there are no big gaps
    h = h.replace(/[ \t]*\n?(<div class="pvid")/g, "$1").replace(/<!--pv-->[ \t]*\n?/g, "");
    return format(h);
  };

  // ---------- Toolbar ----------
  const TOOLS = [
    ["b", "Bold", "<b>B</b>"], ["i", "Italic", "<i>I</i>"], ["s", "Strikethrough", "<s>S</s>"],
    ["ul", "Bulleted list", "•≡"], ["ol", "Numbered list", "1≡"], ["q", "Quote", "❝"], ["sp", "Spoiler", "Spoiler"],
    ["link", "Link", "Link"], ["img", "Picture", "Picture"], ["vid", "Video", "Video"]
  ];
  const BOX = 'textarea[name="body"]';
  function addToolbar(ta) {
    if (!ta || ta.dataset.tb || ta.closest(".pm-tb-skip")) return;
    ta.dataset.tb = "1";
    const bar = document.createElement("div");
    bar.className = "fmt-bar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Formatting");
    bar.innerHTML = TOOLS.map(([k, label, ic]) => `<button type="button" class="fmt-btn" data-fmt="${k}" title="${label}" aria-label="${label}">${ic}</button>`).join("")
      + `<div class="fmt-ask" hidden><input type="url" placeholder="https://" aria-label="Link"><input type="text" class="fmt-text" placeholder="Text to show (optional)" aria-label="Link text"><button type="button" class="btn small primary" data-fmt="ok">Insert</button><button type="button" class="btn small ghost" data-fmt="cancel">Cancel</button><span class="hint fmt-help"></span></div>`;
    ta.before(bar);
  }
  function insert(ta, before, after = "", placeholder = "") {
    ta.focus();
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s, sel = ta.value.slice(s, e) || placeholder;
    ta.setRangeText(before + sel + after, s, e, "end");
    if (!ta.value.slice(s, e).length && placeholder) { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; }
    ta.dispatchEvent(new Event("input", {bubbles: true}));
  }
  function lines(ta, kind) {
    ta.focus();
    let s = ta.selectionStart, e = ta.selectionEnd; const v = ta.value;
    s = v.lastIndexOf("\n", s - 1) + 1; if (e < v.length) { const k = v.indexOf("\n", e); e = k < 0 ? v.length : k; }
    const rows = (v.slice(s, e) || "item").split("\n");
    const marked = rows.map(l => l.match(ITEM));
    let n = 0, out;
    if (marked.some(Boolean)) {
      // already a list (pasted or typed): renumber/re-mark the items, leave their explanation lines alone
      const base = Math.min(...marked.filter(Boolean).map(m => indentOf(m[1])));
      const sub = {};
      out = rows.map((l, i) => {
        const m = marked[i]; if (!m) return l;
        const ind = indentOf(m[1]);
        if (ind > base) { if (!m[3]) return l; sub[ind] = (sub[ind] || 0) + 1; return `${m[1]}${sub[ind]}. ${m[4]}`; }
        Object.keys(sub).forEach(k => delete sub[k]);
        return kind === "ol" ? `${m[1]}${++n}. ${m[4]}` : `${m[1]}- ${m[4]}`;
      });
    } else {
      // plain lines: each line with text becomes an item; blank lines are skipped, not numbered
      out = rows.map(l => !l.trim() ? l : (kind === "ol" ? `${++n}. ` : "- ") + l.replace(/^[ \t]+/, ""));
    }
    ta.setRangeText(out.join("\n"), s, e, "end"); ta.dispatchEvent(new Event("input", {bubbles: true}));
  }

  document.addEventListener("click", e => {
    const b = e.target.closest(".fmt-bar [data-fmt]"); if (!b) return;
    e.preventDefault();
    const bar = b.closest(".fmt-bar"), ta = bar.nextElementSibling; if (!ta || ta.tagName !== "TEXTAREA") return;
    const ask = bar.querySelector(".fmt-ask"), k = b.dataset.fmt;
    const me_ = typeof S === "object" && S.user ? S.user : "member";
    if (k === "b") return insert(ta, "**", "**", "bold text");
    if (k === "i") return insert(ta, "*", "*", "italic text");
    if (k === "s") return insert(ta, "~~", "~~", "struck text");
    if (k === "ul") return lines(ta, "ul");
    if (k === "ol") return lines(ta, "ol");
    if (k === "q") return insert(ta, `[quote=${me_}]`, "[/quote]", "quoted text");
    if (k === "sp") return insert(ta, "[spoiler]", "[/spoiler]", "hidden text");
    if (k === "link" || k === "img" || k === "vid") {
      ask.hidden = false; ask.dataset.kind = k;
      ask.querySelector(".fmt-text").hidden = k !== "link";
      ask.querySelector(".fmt-help").textContent = k === "img" ? "Paste a link to the picture on an image site (Imgur, Postimages…). It isn't uploaded here." : k === "vid" ? "Paste a YouTube or Vimeo link." : "";
      const inp = ask.querySelector("input[type=url]"); inp.value = ""; ask.querySelector(".fmt-text").value = ""; inp.focus(); return;
    }
    if (k === "cancel") { ask.hidden = true; ta.focus(); return; }
    if (k === "ok") {
      const url = ask.querySelector("input[type=url]").value.trim(), text = ask.querySelector(".fmt-text").value.trim(), kind = ask.dataset.kind;
      if (!/^https:\/\/\S+\.\S+/.test(url)) return toast("Paste a full link starting with https://");
      if (kind === "vid" && !videoOf(url)) return toast("That isn't a YouTube or Vimeo video link.");
      ask.hidden = true;
      insert(ta, (ta.value && !/\s$/.test(ta.value.slice(0, ta.selectionStart)) ? " " : "") + (kind === "link" && text ? `${text}: ` : "") + url + (kind === "link" ? " " : "\n"));
    }
  });
  document.addEventListener("keydown", e => {
    const inp = e.target.closest && e.target.closest(".fmt-ask input");
    if (inp && e.key === "Enter") { e.preventDefault(); inp.closest(".fmt-ask").querySelector("[data-fmt=ok]").click(); }
    const ta = e.target.closest && e.target.closest(BOX);
    if (ta && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (e.key === "b") { e.preventDefault(); insert(ta, "**", "**", "bold text"); }
      if (e.key === "i") { e.preventDefault(); insert(ta, "*", "*", "italic text"); }
    }
  });

  // ---------- Pasting from ChatGPT, Google Docs, Word or a web page ----------
  // The copied page's lists, bold, italics, headings, links and tables are turned into post formatting,
  // so numbers come through right (Docs and ChatGPT don't put list numbers in plain copied text).
  function fromHtml(html) {
    let doc; try { doc = new DOMParser().parseFromString(html, "text/html"); } catch (e) { return null; }
    if (!doc || !doc.body) return null;
    const BLOCK = /^(P|DIV|H[1-6]|LI|UL|OL|TR|TABLE|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|DL|DT|DD|FIGURE)$/;
    const styleOf = el => (el.getAttribute && el.getAttribute("style") || "").toLowerCase();
    const isBold = el => { const st = styleOf(el), w = (st.match(/font-weight:\s*(\w+)/) || [])[1];
      if (w) return w === "bold" || w === "bolder" || +w >= 600; return /^(B|STRONG)$/.test(el.tagName); };
    const isItal = el => /font-style:\s*italic/.test(styleOf(el)) || /^(I|EM)$/.test(el.tagName);
    const isStrike = el => /line-through/.test(styleOf(el)) || /^(S|DEL|STRIKE)$/.test(el.tagName);
    const wrap = (t, m) => { const mm = t.match(/^(\s*)([\s\S]*?)(\s*)$/); return mm[2] && !mm[2].includes("\n") ? mm[1] + m + mm[2] + m + mm[3] : t; };
    const level = el => { const a = +(el.getAttribute && el.getAttribute("aria-level")); return a > 0 ? a - 1 : 0; };
    function walk(node, pre, depth) {
      if (node.nodeType === 3) return pre ? node.nodeValue : node.nodeValue.replace(/[\s ]+/g, " ");
      if (node.nodeType !== 1) return "";
      const el = node, tag = el.tagName;
      if (/^(STYLE|SCRIPT|HEAD|META|TITLE|NOSCRIPT|TEMPLATE|SVG|BUTTON)$/.test(tag)) return "";
      if (tag === "BR") return "\n";
      if (tag === "HR") return "\n---\n";
      if (tag === "IMG") { const src = el.getAttribute("src") || ""; return /^https:\/\//.test(src) ? `\n${src}\n` : ""; }
      const kids = (p, d) => Array.from(el.childNodes).map(c => walk(c, p, d)).join("");
      if (tag === "UL" || tag === "OL") {
        const counters = {};   // Google Docs puts sub-items in the same list with aria-level, so number per level
        let n0 = tag === "OL" ? (parseInt(el.getAttribute("start"), 10) || 1) : 1;
        const items = Array.from(el.children).map(li => {
          if (li.tagName === "UL" || li.tagName === "OL") return walk(li, pre, depth + 1);
          if (li.tagName !== "LI") return walk(li, pre, depth);
          const lv = level(li), d = depth + lv, p2 = "   ".repeat(d);
          Object.keys(counters).forEach(k => { if (+k > lv) delete counters[k]; });
          const lt = (styleOf(li).match(/list-style-type:\s*([\w-]+)/) || [])[1];
          const ordered = lt ? !/^(disc|circle|square|none)$/.test(lt) : tag === "OL";
          if (!(lv in counters)) counters[lv] = lv ? 1 : n0;
          const mark = ordered ? `${counters[lv]++}. ` : "- ";
          const body = Array.from(li.childNodes).map(c => walk(c, pre, d + 1)).join("").replace(/^\s+|\s+$/g, "");
          const ls = body.split("\n").filter(x => x.trim());
          return "\n" + p2 + mark + (ls.shift() || "").trim() + ls.map(x => "\n" + (ITEM.test(x) ? x : p2 + "   " + x.trim())).join("");
        }).join("");
        return "\n" + items.replace(/^\n/, "") + "\n" + (depth ? "" : "\n");
      }
      if (/^H[1-6]$/.test(tag)) { const t = kids(false, depth).trim(); return t ? `\n\n### ${t.replace(/\*\*/g, "")}\n\n` : ""; }
      if (tag === "PRE") return "\n" + el.textContent.replace(/\n$/, "") + "\n";
      if (tag === "TR") return "\n" + Array.from(el.children).map(c => walk(c, false, depth).replace(/\s+/g, " ").trim()).join(" | ");
      if (tag === "A") {
        const t = kids(pre, depth), href = el.getAttribute("href") || "", clean = t.trim();
        if (!/^https?:\/\//.test(href)) return t;
        if (!clean || clean === href || href.replace(/\/$/, "") === clean.replace(/\/$/, "")) return " " + href + " ";
        return `${t}: ${href} `;
      }
      let t = kids(pre || tag === "CODE", depth);
      // Google Docs wraps everything in <b style="font-weight:normal">, so styles are checked, not just tags
      if (isBold(el) && !/^H[1-6]$/.test(tag)) t = wrap(t, "**");
      if (isItal(el)) t = wrap(t, "*");
      if (isStrike(el)) t = wrap(t, "~~");
      if (tag === "P" || tag === "BLOCKQUOTE") return depth ? "\n" + t + "\n" : "\n\n" + t + "\n\n";
      if (BLOCK.test(tag)) return "\n" + t + "\n";
      return t;
    }
    let txt = walk(doc.body, false, 0);
    txt = txt.replace(/\*\*\*\*/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n (?=\S)/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    return txt;
  }
  function cleanPlain(t) {
    return t.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/​/g, "")
      .replace(/^([ \t]*)[●○▪■◦][ \t]+/gm, "$1- ").replace(/^([ \t]*)(\d{1,3})[.)]\t+/gm, "$1$2. ").replace(/\n{3,}/g, "\n\n");
  }
  document.addEventListener("paste", e => {
    const ta = e.target.closest && e.target.closest(BOX); if (!ta || !e.clipboardData) return;
    const html = e.clipboardData.getData("text/html"), plain = e.clipboardData.getData("text/plain");
    let txt = null;
    if (html && /<(li|h[1-6]|strong|b|em|i|p|br|table)[\s>]|font-weight|docs-internal/i.test(html)) txt = fromHtml(html);
    if (!txt && plain) txt = cleanPlain(plain);
    if (!txt || txt === plain) return;
    e.preventDefault();
    ta.focus();
    ta.setRangeText(txt, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", {bubbles: true}));
  });

  const scan = root => (root.querySelectorAll ? root.querySelectorAll(BOX) : []).forEach(addToolbar);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches && n.matches(BOX)) addToolbar(n); scan(n); } })))
    .observe(document.documentElement, {childList: true, subtree: true});
  scan(document);
  try { render(); } catch (e) {}
})();
