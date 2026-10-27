/* Pitchside Forum: pictures in posts, hosted elsewhere.
   When a post contains a link straight to an image (ending .jpg, .png, .gif, .webp or .avif) or an Imgur page link,
   the picture is shown in the post. Nothing is uploaded to or stored on Pitchside: the picture loads from the
   member's image host (Imgur, Postimages, ImgBB…), which isn't told which Pitchside page it's shown on.
   The usual link rules still apply on the server: New Members can't post links, and blocked sites are refused.
   Admin → Forum has a switch to turn pictures off (they then show as plain links).
   Works wherever posts are shown: topics, replies, complaint threads and private messages. */
(function () {
  if (typeof renderBody !== "function") return;
  const MAX_PER_POST = 6;
  const on = () => typeof LAYOUT === "undefined" || LAYOUT.postImages !== false;
  const decode = s => s.replace(/&amp;/g, "&");
  // The picture address for a link, or null if it isn't a picture
  function imageUrl(href) {
    let u; try { u = new URL(decode(href)); } catch (e) { return null; }
    if (u.protocol !== "https:") return null;
    if (/\.(jpe?g|png|gif|webp|avif)$/i.test(u.pathname)) return u.href;
    const m = /^(?:www\.|m\.)?imgur\.com$/i.test(u.hostname) && u.pathname.match(/^\/([A-Za-z0-9]{5,8})\/?$/);
    if (m) return `https://i.imgur.com/${m[1]}.jpg`;
    return null;
  }

  const base = renderBody;
  renderBody = function () {
    const h = base.apply(this, arguments);
    if (!on() || typeof h !== "string") return h;
    let n = 0;
    return h.replace(/<a href="(https:\/\/[^"]+)" target="_blank" rel="noopener nofollow ugc">([^<]*)<\/a>/g, (m, href) => {
      const src = imageUrl(href); if (!src || n >= MAX_PER_POST) return m; n++;
      return `<a class="pimg" href="${esc(src)}" target="_blank" rel="noopener nofollow ugc" title="Open the full-size picture"><img src="${esc(src)}" alt="Picture shared by a member" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`;
    });
  };
  // A picture that can't load turns back into a plain link
  document.addEventListener("error", e => {
    const img = e.target; if (!(img instanceof HTMLImageElement)) return;
    const a = img.closest("a.pimg"); if (!a) return;
    a.classList.remove("pimg"); a.classList.add("pimg-broken"); a.textContent = `Picture couldn't be loaded: ${a.href}`;
  }, true);

  // Hint above the reply box
  if (typeof vTopic === "function") {
    const baseTopic = vTopic;
    vTopic = function () {
      const h = baseTopic.apply(this, arguments);
      return on() ? h.replace('<label for="replyBody">Reply</label>', '<label for="replyBody">Reply</label><span class="hint" style="display:block;margin:-2px 0 4px">To show a picture, paste a link to it from an image site such as Imgur or Postimages.</span>') : h;
    };
  }
  // Admin → Forum: the on/off switch
  if (typeof aForum === "function") {
    const baseForum = aForum;
    aForum = function () {
      const box = `<section class="panel" style="margin-bottom:16px"><h3 class="ph" style="margin:0 0 4px">Pictures in posts</h3>
        <label class="chk"><input type="checkbox" data-change="postImagesSet" id="postImagesSet"${on() ? " checked" : ""}> <strong>Show pictures from image links</strong>
        <span class="hint muted">Members paste a link from an image site (Imgur, Postimages, ImgBB…) and the picture shows in the post. Nothing is stored on Pitchside. Up to ${MAX_PER_POST} per post. When off, they show as plain links.</span></label></section>`;
      return box + baseForum.apply(this, arguments);
    };
  }
  CHANGE.postImagesSet = el => {
    if (typeof can === "function" && !can("manageCategories")) { el.checked = !el.checked; return; }
    LAYOUT.postImages = el.checked; render(); toast(el.checked ? "Pictures in posts are on" : "Pictures in posts are off");
  };
  try { render(); } catch (e) {}
})();
