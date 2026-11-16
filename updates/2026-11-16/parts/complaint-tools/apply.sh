#!/usr/bin/env bash
# Pitchside Forum: complaint tools for specialists.
#  - Timers: a new complaint gives Pitchside 48 hours to respond; specialists set timers for the casino, the player or
#    Pitchside (hours to months). Everyone sees a countdown on the case.
#  - Hide sensitive text everywhere in a case (or a whole message).
#  - Files a player makes public wait for a specialist's approval.
#  - Specialists can reject a complaint straight away, with a reason shown in the case.
# Files: app/ops/zz-complaint-tools.php, public/assets/complaint-tools.2.js (new); app/shell.html loads the script;
# app/cron.php: the "7-day deadline" wording becomes "response deadline" (timers can now be any length).
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; SHELL_HTML="$APP/app/shell.html"; CRON="$APP/app/cron.php"
if [[ ! -f "$APP/app/lib/api.php" || ! -f "$SHELL_HTML" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
php -l app/ops/zz-complaint-tools.php >/dev/null 2>&1 || { echo "This server's PHP couldn't read the new file. Nothing was changed."; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$SHELL_HTML" "$BK/app/shell.html" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
[[ -f "$CRON" ]] && cp -a "$CRON" "$BK/app/cron.php"
OWN=$(stat -c '%U:%G' "$APP/app/ops"); OWNA=$(stat -c '%U:%G' "$APP/public/assets")
install -m 644 -o "${OWN%%:*}" -g "${OWN##*:}" app/ops/zz-complaint-tools.php "$APP/app/ops/zz-complaint-tools.php"
install -m 644 -o "${OWNA%%:*}" -g "${OWNA##*:}" public/assets/complaint-tools.2.js "$APP/public/assets/complaint-tools.2.js"
sed -i 's#/assets/complaint-tools\.1\.js#/assets/complaint-tools.2.js#' "$SHELL_HTML"
grep -q 'complaint-tools.2.js' "$SHELL_HTML" || sed -i 's#</body>#<script src="/assets/complaint-tools.2.js"></script>\n</body>#' "$SHELL_HTML"
if [[ $(grep -c 'complaint-tools.2.js' "$SHELL_HTML") -ne 1 ]]; then cp -a "$BK/app/shell.html" "$SHELL_HTML"; rm -f "$APP/app/ops/zz-complaint-tools.php" "$APP/public/assets/complaint-tools.2.js"; echo "Couldn't add the page script. Nothing was changed."; exit 1; fi
if [[ -f "$CRON" ]]; then
  sed -i -e "s/No operator response in 7 days\. A specialist will decide the case\./No operator response before the deadline. A specialist will decide the case./" \
         -e "s/Operator missed the 7-day deadline/Operator missed the response deadline/g" "$CRON"
  php -l "$CRON" >/dev/null 2>&1 || cp -a "$BK/app/cron.php" "$CRON"
fi
command -v restorecon >/dev/null 2>&1 && restorecon "$APP/app/ops/zz-complaint-tools.php" "$APP/public/assets/complaint-tools.2.js" "$SHELL_HTML" "$CRON" 2>/dev/null || true
echo "Done. Open any complaint as a specialist to set timers, hide sensitive text and approve public files."
