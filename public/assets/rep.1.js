/* Pitchside Forum: forum rep wording. Forum rep is the number of likes a member's visible posts have
   received from other members (worked out on the server). This explains it where it's shown. */
(function () {
  const HINT = "Likes from other members on their posts";
  if (typeof vProfile === "function") {
    const baseProfile = vProfile;
    vProfile = function () { return baseProfile.apply(this, arguments).replace("Helpful posts, likes, age", HINT); };
  }
  if (typeof vTopic === "function") {
    const baseTopic = vTopic;
    vTopic = function () { return baseTopic.apply(this, arguments).replace(/<span class="muted">Forum rep <strong/g, `<span class="muted" title="${HINT}">Forum rep <strong`); };
  }
  try { render(); } catch (e) {}
})();
