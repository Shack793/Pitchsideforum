<?php
// Admins can delete a complaint (for example spam, a duplicate, or one filed by mistake).
// Removes the case, its messages and followers, hides its discussion topic, and closes its queue items.
// The reason is kept in the Audit log, and the member who filed it is notified.
op('complaint.delete', function (array $in, array $u) {
  if (!can($u, 'manageCategories')) fail('Only admins can delete complaints.', 403);
  $id = str_in($in, 'id', 16);
  $c = row("SELECT * FROM complaints WHERE id = ?", [$id]); if (!$c) fail('That complaint no longer exists.', 404);
  $reason = str_in($in, 'reason', 1000); if (mb_strlen($reason) < 3) fail('Give a reason so the audit log is useful.');
  $now = now_ms();
  tx(function () use ($c, $id, $now, $u) {
    q("DELETE FROM complaint_msgs WHERE complaint_id = ?", [$id]);
    q("DELETE FROM complaint_follows WHERE complaint_id = ?", [$id]);
    if (!empty($c['thread'])) q("UPDATE topics SET deleted = 1, updated = ? WHERE id = ?", [$now, (int) $c['thread']]);
    q("UPDATE reports SET status = 'resolved', closed_by = ?, closed_at = ?, updated = ? WHERE status = 'open' AND target = ?", [$u['name'], $now, $now, jenc(['complaint' => $id])]);
    q("DELETE FROM complaints WHERE id = ?", [$id]);
  });
  if (!empty($c['thread']) && function_exists('forum_rep_sync_topic')) forum_rep_sync_topic((int) $c['thread']);
  audit($u, 'Deleted complaint', "$id “{$c['title']}” ({$c['op']}, filed by {$c['user']})", $reason, $c['status'], 'deleted');
  if ($c['user'] !== $u['name']) notify($c['user'], 'complaint', "Your complaint $id “{$c['title']}” was removed by an admin: $reason", '/complaints', $u);
  return ['deleted' => $id];
});
