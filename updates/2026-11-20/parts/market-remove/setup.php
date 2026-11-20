<?php
// Removes the Marketplace from the site: section switched off, menu link hidden, escrow off, and the Marketplace
// boards closed (only admins can still see what's in them; nobody can post). Nothing is deleted: the boards' old
// settings are kept in MARKET_REMOVED so they can be brought back later.
declare(strict_types=1);
$app = rtrim($argv[1] ?? '/var/www/pitchside', '/');
require $app . '/app/lib/api.php';
$S = doc('SETTINGS'); $f = (array) ($S['features'] ?? []);
if (!empty($f['marketplace']) || !empty($f['escrow'])) { $f['marketplace'] = false; $f['escrow'] = false; $S['features'] = $f; save_doc('SETTINGS', $S); }
$N = doc('NAV'); $ch = false;
foreach ($N as &$n) if ((($n['id'] ?? '') === 'market' || ($n['path'] ?? '') === '/marketplace') && !empty($n['on'])) { $n['on'] = false; $ch = true; }
unset($n); if ($ch) save_doc('NAV', $N);
$E = doc('ESCROW_CFG'); if (is_array($E) && !empty($E['on'])) { $E['on'] = false; save_doc('ESCROW_CFG', $E); }
$B = doc('BOARDS'); $keep = doc('MARKET_REMOVED'); if (!is_array($keep)) $keep = []; $n = 0;
foreach ($B as &$b) if (($b['cat'] ?? '') === 'market') {
  if (!isset($keep[$b['slug']])) $keep[$b['slug']] = ['readRoles' => $b['readRoles'] ?? [], 'postRoles' => $b['postRoles'] ?? [], 'kind' => $b['kind'] ?? null];
  $b['readRoles'] = ['admin', 'super_admin']; $b['postRoles'] = []; $n++;
}
unset($b);
if ($n) { save_doc('MARKET_REMOVED', $keep); save_doc('BOARDS', $B); }
if (function_exists('audit')) audit(null, 'Settings', 'Marketplace', 'Removed from the site', 'on', 'off');
echo "REMOVED $n boards closed\n";
