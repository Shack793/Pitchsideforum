/* Pitchside Forum: member controls in the header.
   Signed-in members get Messages, Notifications and Settings icons, and a menu under their name with
   Profile, Settings, Messages, Notifications, Admin (admins) / Moderation (staff) and Sign out.
   Loaded after the main app script; it wraps the header drawing, it doesn't change the app file. */
(function () {
  if (typeof renderShell !== "function") return;
  const SLIDERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>';
  const CARET = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  const base = renderShell;
  renderShell = function () {
    base.apply(this, arguments);
    const area = document.getElementById("userArea"), u = typeof me === "function" ? me() : null;
    if (!area || !u) return;
    const who = area.querySelector("a.who"); if (!who || area.querySelector("#userMenuBtn")) return;
    // Settings icon next to Messages and Notifications
    const set = document.createElement("a");
    set.className = "iconbtn"; set.href = "/settings"; set.setAttribute("data-go", "/settings"); set.title = "Settings"; set.setAttribute("aria-label", "Settings"); set.innerHTML = SLIDERS;
    who.before(set);
    // The name opens a menu instead of going straight to the profile
    const btn = document.createElement("button");
    btn.type = "button"; btn.id = "userMenuBtn"; btn.className = "who who-btn"; btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = who.innerHTML + CARET;
    who.replaceWith(btn);
    // Sign out moves into the menu
    const out = area.querySelector("[data-act=signOut]"); if (out) out.remove();
  };

  function closeUserMenu() { const m = document.getElementById("userMenu"); if (m) m.remove(); const b = document.getElementById("userMenuBtn"); if (b) b.setAttribute("aria-expanded", "false"); }
  function openUserMenu(btn) {
    closeUserMenu();
    const u = me(); if (!u) return;
    const n = typeof unreadNotifs === "function" ? unreadNotifs() : 0, m = typeof unreadMsgs === "function" ? unreadMsgs() : 0;
    const item = (path, label, extra = "") => `<a href="${path}" role="menuitem" data-go="${path}">${label}${extra}</a>`;
    const count = k => k ? ` <span class="pill">${k}</span>` : "";
    const menu = document.createElement("div");
    menu.className = "menu user-menu"; menu.id = "userMenu"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-labelledby", "userMenuBtn");
    menu.innerHTML = `<div class="um-head"><strong>${esc(u.name)}</strong><small>${esc(typeof roleLabel === "function" ? roleLabel(u.role) : u.role)}</small></div>`
      + item("/members/" + encodeURIComponent(u.name), "Your profile")
      + item("/settings", "Settings")
      + item("/messages", "Messages", count(m))
      + item("/notifications", "Notifications", count(n))
      + (typeof isStaff === "function" && isStaff() ? item("/mod", "Moderation queue") : "")
      + (typeof can === "function" && can("manageCategories") ? item("/admin", "Admin dashboard") : "")
      + `<button type="button" role="menuitem" data-act="signOut" class="um-out">Sign out</button>`;
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + "px";
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + "px";
    btn.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("a"); if (first) first.focus({preventScroll: true});
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("#userMenuBtn");
    if (b) { e.preventDefault(); e.stopPropagation(); return document.getElementById("userMenu") ? closeUserMenu() : openUserMenu(b); }
    if (!e.target.closest("#userMenu")) closeUserMenu();
    else if (e.target.closest("a,button")) setTimeout(closeUserMenu, 0);
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.getElementById("userMenu")) { closeUserMenu(); const b = document.getElementById("userMenuBtn"); if (b) b.focus(); }
  });
  addEventListener("resize", closeUserMenu); addEventListener("scroll", closeUserMenu, {passive: true});
  try { renderShell(); } catch (e) {}
})();
