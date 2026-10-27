/* Pitchside Forum: videos and formatting in posts.
   - Videos: YouTube and Vimeo links show as a player. Nothing is hosted on Pitchside: the video plays from
     YouTube's privacy-enhanced player (youtube-nocookie.com) or Vimeo, and only after the member presses play.
   - Formatting: **bold**, *italic*, ~~strike~~, lists ("- " or "1. " at the start of a line) and [spoiler]…[/spoiler].
     Posts are still stored as plain text; formatting is applied when they're shown, after everything is made safe.
   - Toolbar above every post and message box: Bold, Italic, Strike, List, Numbered list, Quote, Spoiler,
     Link, Picture and Video. Picture and Video ask for a link (pictures stay on the member's image host).
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
  function format(h) {
    // spoilers
    h = h.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]\n?/gi, (m, x) => `<details class="spoiler"><summary>Spoiler: click to show</summary><div>${x.replace(/^\n|\n$/g, "")}</div></details>`);
    // lists: consecutive lines starting "- " / "• " or "1. "
    const START = "(?<=^|\\n|</ul>|</ol>|</details>)";
    h = h.replace(new RegExp(START + "((?:(?:- |• )[^\\n]*(?:\\n|$))+)", "g"), (m, block) => `<ul>${block.trim().split("\n").map(l => `<li>${l.replace(/^(- |• )/, "")}</li>`).join("")}</ul>`);
    h = h.replace(new RegExp(START + "((?:\\d{1,3}[.)] [^\\n]*(?:\\n|$))+)", "g"), (m, block) => `<ol>${block.trim().split("\n").map(l => `<li>${l.replace(/^\d{1,3}[.)] /, "")}</li>`).join("")}</ol>`);
    h = h.replace(/\n(?=<(?:ul|ol|details)[ >])/g, "");
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
  function lines(ta, prefix) {
    ta.focus();
    let s = ta.selectionStart, e = ta.selectionEnd; const v = ta.value;
    s = v.lastIndexOf("\n", s - 1) + 1; if (e < v.length) { const k = v.indexOf("\n", e); e = k < 0 ? v.length : k; }
    const block = v.slice(s, e) || "item";
    const out = block.split("\n").map((l, i) => (typeof prefix === "function" ? prefix(i) : prefix) + l.replace(/^(- |• |\d{1,3}[.)] )/, "")).join("\n");
    ta.setRangeText(out, s, e, "end"); ta.dispatchEvent(new Event("input", {bubbles: true}));
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
    if (k === "ul") return lines(ta, "- ");
    if (k === "ol") return lines(ta, i => `${i + 1}. `);
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
  const scan = root => (root.querySelectorAll ? root.querySelectorAll(BOX) : []).forEach(addToolbar);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches && n.matches(BOX)) addToolbar(n); scan(n); } })))
    .observe(document.documentElement, {childList: true, subtree: true});
  scan(document);
  try { render(); } catch (e) {}
})();
