<?php
// Pitchside Forum: the order of pinned topics on each board.
// Moderators who can pin on a board (and admins) move pinned topics up or down; the order is kept in the
// LAYOUT settings document under "pinOrder" ({"board-slug": [topic ids, top first]}), so every visitor's page gets it.
// A topic pinned later, and not placed yet, shows above the ordered ones until it's moved.
declare(strict_types=1);

op('pins.order', function (array $in, array $u) {
  $board = str_in($in, 'board', 64);
  if (!board_doc($board)) fail('That board no longer exists.');
  need_mp($u, 'topic.pin', $board);
  $want = array_values(array_unique(array_map('intval', arr_in($in, 'ids'))));
  $pinned = array_map(fn($r) => (int) $r['id'], rows("SELECT id FROM topics WHERE board = ? AND pinned = 1 AND deleted = 0 ORDER BY last_at DESC", [$board]));
  // keep only topics still pinned on this board; any pinned topic the request left out goes at the end
  $order = array_values(array_intersect($want, $pinned));
  foreach ($pinned as $id) if (!in_array($id, $order, true)) $order[] = $id;

  // read the stored document directly (the per-request cache may hold an older copy)
  $r = row("SELECT v FROM config WHERE k = 'LAYOUT'");
  $lay = $r ? jdec($r['v'], []) : [];
  if (!is_array($lay)) $lay = [];
  if (isset($lay[0])) fail('The layout settings look damaged, so the order was not saved.');
  $all = is_array($lay['pinOrder'] ?? null) ? $lay['pinOrder'] : [];
  $prev = array_map('intval', is_array($all[$board] ?? null) ? $all[$board] : []);
  $all[$board] = $order;
  // forget boards that no longer have pinned topics
  foreach (array_keys($all) as $b) if ($b !== $board && !val("SELECT 1 FROM topics WHERE board = ? AND pinned = 1 AND deleted = 0 LIMIT 1", [(string) $b])) unset($all[$b]);
  $lay['pinOrder'] = (object) $all;
  save_doc('LAYOUT', $lay, $u['name']);

  $names = fn(array $ids) => implode(', ', array_map(fn($id) => '#' . $id, $ids)) ?: 'none';
  audit($u, 'Reorder pinned topics', "board $board", 'Changed the order of pinned topics', $names($prev), $names($order));
  return ['board' => $board, 'order' => $order];
});
