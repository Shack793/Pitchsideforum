/* Pitchside Forum: "Keep me signed in" tick box on the sign-in form. Unticked, the sign-in ends when the browser
   closes or after 12 hours without using the site; ticked, it lasts 30 days. Server side: app/ops/zz-remember.php. */
(function () {
  if (typeof ACT !== "object" || typeof ACT.signIn !== "function" || typeof api !== "function") return;
  const baseSignIn = ACT.signIn;
  ACT.signIn = function () {
    const r = baseSignIn.apply(this, arguments);
    const f = document.getElementById("modalForm"), pw = f && f.querySelector('input[name="p"]');
    if (pw && !f.querySelector('input[name="remember"]')) {
      const lab = document.createElement("label"); lab.className = "chk rm-chk";
      lab.innerHTML = `<input type="checkbox" name="remember" value="1"> Keep me signed in <span class="hint">for 30 days on this device</span>`;
      pw.closest("label").insertAdjacentElement("afterend", lab);
    }
    return r;
  };
  const baseApi = api;
  api = function (op, args) {
    if (op === "auth.login") {
      const box = document.querySelector('#modalForm input[name="remember"]');
      args = Object.assign({}, args || {}, {remember: box && box.checked ? 1 : 0});
      return baseApi.call(this, op, args, ...Array.prototype.slice.call(arguments, 2));
    }
    return baseApi.apply(this, arguments);
  };
  const st = document.createElement("style");
  st.textContent = `.rm-chk{display:flex;flex-direction:row;align-items:center;gap:8px;font-weight:500}.rm-chk .hint{margin-left:2px}`;
  document.head.appendChild(st);
})();
