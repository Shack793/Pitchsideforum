/* Pitchside Forum: preview a post before posting.
   Every post box (new topic, replies, editing a post, complaint posts and case messages, reviews) gets
   "Write" and "Preview" tabs. Preview shows the text exactly as it will appear in the thread: formatting,
   quotes, @mentions, pictures from links and videos. Nothing is saved or sent until you press Post.
   Private staff notes and the chat box (Enter sends) are left as they are.
   Loaded after post-media.1.js; it only adds to the page, it doesn't change the app file. */
(function () {
  if (typeof renderBody !== "function") return;
  const BOX = 'textarea[name="body"]';
  const skip = ta => ta.id === "msgBody" || ta.closest('[data-form="modNote"]') || ta.closest(".pm-tb-skip");

  function add(ta) {
    if (!ta || ta.dataset.pv || skip(ta)) return;
    ta.dataset.pv = "1";
    const tabs = document.createElement("div");
    tabs.className = "pv-tabs"; tabs.setAttribute("role", "tablist");
    tabs.innerHTML = `<button type="button" role="tab" class="pv-tab on" aria-selected="true" data-pv="write">Write</button><button type="button" role="tab" class="pv-tab" aria-selected="false" data-pv="preview">Preview</button>`;
    const box = document.createElement("div");
    box.className = "post pv-box"; box.hidden = true; box.setAttribute("aria-live", "polite");
    const bar = ta.previousElementSibling && ta.previousElementSibling.classList.contains("fmt-bar") ? ta.previousElementSibling : null;
    (bar || ta).before(tabs); ta.after(box);
  }
  const parts = tabs => {
    let ta = tabs.nextElementSibling; if (ta && ta.classList.contains("fmt-bar")) ta = ta.nextElementSibling;
    return {ta, box: ta && ta.nextElementSibling};
  };
  function show(tabs, mode) {
    const {ta, box} = parts(tabs); if (!ta || !box || !box.classList.contains("pv-box")) return;
    const bar = tabs.parentNode.querySelector(".fmt-bar");
    const pre = mode === "preview";
    tabs.querySelectorAll(".pv-tab").forEach(b => { const on = b.dataset.pv === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    if (pre) {
      const txt = ta.value.trim();
      let html;
      try { html = txt ? renderBody(ta.value) : ""; } catch (e) { html = esc(ta.value); }
      box.innerHTML = `<div class="pv-note">Preview: this is how your post will look. It isn't posted yet.</div><div class="body">${html || '<span class="muted">Nothing to preview yet.</span>'}</div>`;
      box.style.minHeight = Math.max(ta.offsetHeight, 90) + "px";
    }
    box.hidden = !pre; ta.hidden = pre;
    if (bar && bar.nextElementSibling === ta) bar.hidden = pre;
    if (!pre) ta.focus();
  }
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest(".pv-tabs [data-pv]");
    if (t) { e.preventDefault(); show(t.parentNode, t.dataset.pv); return; }
    // links in the preview don't leave the page (the draft would be lost); videos and spoilers still work
    const a = e.target.closest && e.target.closest(".pv-box a, .pv-box [data-go]");
    if (a) { e.preventDefault(); e.stopPropagation(); if (a.href && /^https?:/.test(a.getAttribute("href") || "")) window.open(a.href, "_blank", "noopener"); }
  }, true);
  // Posting while the preview is showing: go back to Write first so the browser can check the box
  document.addEventListener("invalid", e => { const ta = e.target; if (ta.matches && ta.matches(BOX) && ta.hidden) { const tabs = ta.parentNode.querySelector(".pv-tabs"); if (tabs) show(tabs, "write"); } }, true);
  document.addEventListener("submit", e => { const f = e.target; f.querySelectorAll && f.querySelectorAll(".pv-tabs").forEach(tb => { if (tb.querySelector(".pv-tab.on").dataset.pv === "preview") setTimeout(() => { if (document.contains(tb)) show(tb, "write"); }, 0); }); }, true);

  const scan = root => (root.querySelectorAll ? root.querySelectorAll(BOX) : []).forEach(add);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches && n.matches(BOX)) add(n); scan(n); } })))
    .observe(document.documentElement, {childList: true, subtree: true});
  scan(document);
})();
