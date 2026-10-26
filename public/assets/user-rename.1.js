/* Pitchside Forum: "Change a username" in Admin → Users (Super Admins only).
   The server renames the member everywhere (posts, messages, reviews, complaints, moderator lists, raffle…).
   Sign-in details stay the same apart from the new username. */
(function () {
  if (typeof aUsers !== "function" || typeof api !== "function") return;
  const isSuper = () => !!(me() && me().role === "super_admin");
  const norm = s => s.replace(/[^A-Za-z0-9_]+/g, "_").toLowerCase().replace(/^_+|_+$/g, "");

  const baseUsers = aUsers;
  aUsers = function () {
    const html = baseUsers.apply(this, arguments);
    if (!isSuper()) return html;
    const names = Object.keys(USERS).sort();
    return `<section class="panel" style="margin-bottom:16px"><h3 class="ph" style="margin:0 0 4px">Change a username</h3>
      <p class="muted" style="font-size:.9rem;margin:0 0 10px">Renames the member everywhere: their posts, topics, messages, reviews, complaints, moderator boards and raffle entries. Their password and email stay the same; they sign in with the new name. Usernames use 3 to 24 lowercase letters, numbers or underscores.</p>
      <form data-form="renameUser" class="row" style="align-items:flex-end;gap:10px">
        <label style="flex:1 1 180px">Current username<input name="user" list="renameNames" required value="${esc(S.user || "")}" autocomplete="off"><datalist id="renameNames">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist></label>
        <label style="flex:1 1 180px">New username<input name="name" required maxlength="24" autocomplete="off" data-input="renamePreview"></label>
        <label style="flex:2 1 220px">Reason <span class="hint">Optional, for the audit log</span><input name="reason" maxlength="300"></label>
        <button class="btn primary" type="submit">Change username</button></form>
      <p class="hint" id="renamePreview" style="margin:6px 0 0" aria-live="polite"></p></section>` + html;
  };
  INPUT.renamePreview = el => { const p = document.getElementById("renamePreview"), n = norm(el.value); if (p) p.textContent = el.value && n !== el.value ? `Will be saved as “${n}”` : ""; };

  FORMS.renameUser = f => {
    const user = f.elements.user.value.trim(), name = norm(f.elements.name.value), reason = f.elements.reason.value.trim();
    if (!USERS[user]) return toast(`There's no member called “${user}”.`);
    if (name.length < 3 || name.length > 24) return toast("Usernames have 3 to 24 letters, numbers or underscores.");
    const self = user === S.user;
    modal({title: `Rename ${user} to ${name}?`, submit: "Change username", body: `<p style="margin:0">Everything ${self ? "you've" : `${esc(user)} has`} posted moves to the new name, and the change is recorded in the audit log. ${self ? "You'll sign in as <strong>" + esc(name) + "</strong> from now on; this page reloads after the change." : "They're notified and sign in with the new name from now on."}</p>`,
      onSubmit: async () => {
        try {
          const r = await api("user.rename", {user, name, reason});
          if (r.self) { toast(`You're now ${r.name}. Reloading…`); setTimeout(() => location.reload(), 900); return; }
          if (typeof resync === "function") await resync(true);
          toast(`${user} is now ${r.name}`); render();
        } catch (e) { return e.message; }
      }});
  };
  try { render(); } catch (e) {}
})();
