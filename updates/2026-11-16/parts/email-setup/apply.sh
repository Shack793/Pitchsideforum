#!/usr/bin/env bash
# Pitchside Forum: turn on email, so every new account must confirm its email address before it can post, reply,
# file complaints or message members. (Until email is set up the site can't send the confirmation link, so it lets
# everyone through.) It asks for your email provider's SMTP details, sends you a test email, and only keeps the
# settings if the test works. Your password is typed hidden and only stored in app/config.php on your server.
set -uo pipefail
if [[ $EUID -ne 0 ]]; then echo "Please run with sudo:  sudo bash apply.sh"; exit 1; fi
cd "$(dirname "$0")"
APP="${PITCHSIDE_DIR:-/var/www/pitchside}"; CFG="$APP/app/config.php"
if [[ ! -f "$CFG" ]]; then echo "Couldn't find the site in $APP. Nothing was changed."; exit 1; fi
command -v php >/dev/null || { echo "PHP isn't available on the command line. Nothing was changed."; exit 1; }
echo "Email setup for Pitchside Forum. Have your email provider's SMTP details ready (e.g. Brevo: Settings > SMTP & API)."
echo
read -rp "SMTP server (e.g. smtp-relay.brevo.com): " HOST
read -rp "Port [587]: " PORT; PORT=${PORT:-587}
read -rp "SMTP login: " USER_
read -rsp "SMTP password or key (hidden): " PASS; echo
read -rp "Send emails from [no-reply@pitchsideforum.com]: " FROM; FROM=${FROM:-no-reply@pitchsideforum.com}
read -rp "Your email address, for a test email: " TEST
if [[ -z "$HOST" || -z "$USER_" || -z "$PASS" || -z "$TEST" ]]; then echo "Something was left empty. Nothing was changed."; exit 1; fi
if [[ "$PORT" == 465 ]]; then SEC=ssl; else SEC=tls; fi
STAMP=$(date +%Y%m%d-%H%M%S); BK="/var/backups/pitchside/update-$STAMP-$$"
mkdir -p "$BK/app" && cp -a "$CFG" "$BK/app/config.php" || { echo "Couldn't make a backup. Nothing was changed."; exit 1; }
R=$(HOST="$HOST" PORT="$PORT" SEC="$SEC" USER_="$USER_" PASS="$PASS" FROM="$FROM" php set-config.php "$CFG")
if [[ "$R" != OK ]]; then cp -a "$BK/app/config.php" "$CFG"; echo "Couldn't update the settings file ($R). Nothing was changed."; exit 1; fi
echo "Sending a test email to $TEST ..."
T=$(TEST="$TEST" php -d display_errors=0 send-test.php "$APP" 2>&1 | tail -1)
if [[ "$T" != SENT ]]; then
  cp -a "$BK/app/config.php" "$CFG"
  echo "The test email didn't go through: $T"
  echo "Nothing was changed. Check the details with your provider and run this again."; exit 1
fi
FPM=$(systemctl list-units --type=service --all --no-legend 2>/dev/null | grep -o 'php[0-9.]*-fpm\.service' | head -1 || true)
[[ -n "$FPM" ]] && systemctl reload "$FPM"
echo "Test email sent. Check $TEST (and the spam folder)."
echo
echo "New accounts now have to confirm their email before they can post or reply."
read -rp "Make EXISTING members (not staff, not your AI chatbots) confirm their email too? They can't post until they click the link. [y/N]: " ALL
if [[ "${ALL,,}" == y* ]]; then
  N=$(php reset-verified.php "$APP" 2>&1 | tail -1)
  echo "$N"
fi
echo "Done. Email is on. (Backup of the old settings: $BK)"
