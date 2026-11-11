<?php
// Pitchside Forum: animated GIF ads. Ad images are normally re-saved as a still WebP picture, which keeps only the
// first frame of a GIF. For the ad settings (homepage banners, side ads, ads under the first post, ticker) a GIF is
// now saved as the original GIF, after checking it really is a GIF image and is under 2 MB, so it keeps moving.
declare(strict_types=1);

function gifads_save(string $data): ?string {
  if (!preg_match('#^data:image/gif;base64,([A-Za-z0-9+/=\s]+)$#', $data, $m)) return null;
  $bin = base64_decode(preg_replace('/\s+/', '', $m[1]), true);
  if ($bin === false || strlen($bin) > 4000000) fail('GIF images must be under 4 MB.');
  if (!str_starts_with($bin, 'GIF87a') && !str_starts_with($bin, 'GIF89a')) fail("That file isn't a GIF image.");
  $info = @getimagesizefromstring($bin);
  if (!$info || $info[2] !== IMAGETYPE_GIF || $info[0] * $info[1] > 40000000) fail("That GIF couldn't be read.");
  if (!@imagecreatefromstring($bin)) fail("That GIF couldn't be read.");
  // nothing after the GIF's end marker
  $end = strrpos($bin, "\x3B"); if ($end !== false && $end < strlen($bin) - 1) $bin = substr($bin, 0, $end + 1);
  $name = substr(hash('sha256', $bin), 0, 24) . '.gif';
  $folder = PUBLIC_DIR . '/uploads/media';
  if (!is_dir($folder)) mkdir($folder, 0755, true);
  if (!is_file("$folder/$name")) file_put_contents("$folder/$name", $bin);
  return "/uploads/media/$name";
}
function gifads_walk($v) {
  if (is_array($v)) { foreach ($v as $k => $x) $v[$k] = gifads_walk($x); return $v; }
  if (is_string($v) && str_starts_with($v, 'data:image/gif')) { $p = gifads_save($v); if ($p !== null) return $p; }
  return $v;
}
(function () {
  if (!isset($GLOBALS['OPS']['config.save'])) return;
  $ops = &$GLOBALS['OPS'];
  [$base, $need] = $ops['config.save'];
  $ops['config.save'] = [function (array $in, array $u) use ($base) {
    $k = (string) ($in['k'] ?? '');
    if (in_array($k, ['BANNERS', 'SIDE_ADS', 'POST_ADS', 'TICKER'], true) && isset($in['v']) && is_array($in['v'])) $in['v'] = gifads_walk($in['v']);
    return $base($in, $u);
  }, $need];
})();
