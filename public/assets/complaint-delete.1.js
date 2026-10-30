/* Pitchside Forum: admins can delete a complaint.
   A "Delete complaint" button sits at the bottom of each complaint page, for admins only. It asks for a reason
   (kept in the Audit log and sent to the member who filed it), then removes the case, its messages and
   followers, and hides its discussion topic. Loaded after the main app script. */
(function () {
  if (typeof vComplaint !== "function" || typeof api !== "function") return;
  const isAdmin = () => typeof can === "function" && can("manageCategories");
  const base = vComplaint;
  vComplaint = function (id) {
    const h = base.apply(this, arguments);
    if (!isAdmin() || typeof COMPLAINTS === "undefined" || !COMPLAINTS.some(c => c.id === id)) return h;
    return h + `<section class="panel cd-zone"><div><strong>Delete this complaint</strong>
      <p class="muted" style="margin:2px 0 0;font-size:.88rem">Admins only. For spam, duplicates or complaints filed by mistake. This can't be undone; the reason goes in the Audit log and the member who filed it is told.</p></div>
      <button class="btn danger" type="button" data-act="complaintDel" data-id="${esc(id)}">Delete complaint</button></section>`;
  };
  ACT.complaintDel = el => {
    if (!isAdmin()) return;
    const c = COMPLAINTS.find(x => x.id === el.dataset.id); if (!c) return;
    modal({title: `Delete complaint ${c.id}?`, submit: "Delete", danger: true, body: `
      <p style="margin:0">“${esc(c.title)}”, filed by ${esc(c.user)}. The case, its messages and its discussion topic will be removed.</p>
      <label>Reason <span class="hint">Shown to ${esc(c.user)} and kept in the Audit log</span><textarea name="reason" required minlength="3" style="min-height:70px" placeholder="e.g. Duplicate of PC-1040"></textarea></label>`,
      onSubmit: f => {
        const reason = f.elements.reason.value.trim(); if (reason.length < 3) return "Give a reason (at least 3 characters).";
        return api("complaint.delete", {id: c.id, reason}).then(() => {
          COMPLAINTS = COMPLAINTS.filter(x => x.id !== c.id);
          if (c.thread && typeof TOPICS !== "undefined") TOPICS = TOPICS.filter(t => t.id !== c.thread);
          toast(`Complaint ${c.id} deleted`); nav("/complaints"); return null;
        }).catch(e => e.message || "Couldn't delete it. Try again.");
      }});
  };
  try { render(); } catch (e) {}
})();
