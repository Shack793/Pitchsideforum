#!/usr/bin/env bash
# Pitchside Forum: Crypto section in three boards: Cryptocurrency Discussion, Crypto Casinos & Sportsbooks and
# Crypto Trading & Investments. Topics from the coin boards move to Cryptocurrency Discussion; old addresses forward.
#  Files: app/ops/zz-crypto-boards.php, public/assets/crypto-boards.1.js (new); app/shell.html loads the script.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]] || ! grep -q '</body>' "$SHELL_HTML"; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-crypto-boards.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
undo() { cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-crypto-boards.php" "$APP/public/assets/crypto-boards.1.js"; }
OWN=$(stat -c '%U:%G' "$APP/app/ops"); OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-crypto-boards.php "$APP/app/ops/zz-crypto-boards.php"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/crypto-boards.1.js "$APP/public/assets/crypto-boards.1.js"
grep -q 'crypto-boards.1.js' "$SHELL_HTML" || sed -i 's#</body>#<script src="/assets/crypto-boards.1.js"></script>\n</body>#' "$SHELL_HTML"
if [[ $(grep -c 'crypto-boards.1.js' "$SHELL_HTML") -ne 1 ]]; then undo; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
OWNER=$(stat -c '%U' "$APP/app/storage" 2>/dev/null || echo root)
RUN=(php); if [[ "$OWNER" != "root" ]] && id "$OWNER" >/dev/null 2>&1; then RUN=(runuser -u "$OWNER" -- php); fi
WORK=$(mktemp -d); cp setup.php "$WORK/"; chmod -R a+rX "$WORK"
OUT=$("${RUN[@]}" "$WORK/setup.php" "$APP" 2>&1); RC=$?; rm -rf "$WORK"
[[ $RC -eq 0 ]] || { undo; echo "Couldn't set up the crypto boards: $(echo "$OUT" | tail -1). Nothing was changed."; exit 1; }
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-crypto-boards.php" "$APP/public/assets/crypto-boards.1.js" "$SHELL_HTML" 2>/dev/null || true
rm -f "$APP"/app/storage/cache/*.json 2>/dev/null || true
C=$(awk '/^CRYPTO/{sub(/^CRYPTO /,""); print}' <<<"$OUT"); A=$(awk '/^AI /{print $2}' <<<"$OUT")
echo "Done. Crypto now has three boards ($C)."
[[ "${A:-0}" != "0" ]] && echo "Note: $A AI account(s) were set to post on an old coin board. They were not changed; set their board to Cryptocurrency Discussion in Admin if you want them to keep posting."
exit 0
