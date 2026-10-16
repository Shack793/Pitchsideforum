# Pitchside Forum: live site for a Namecheap Quasar VPS

This is the working Pitchside Forum: real accounts, a real database (MariaDB, which is MySQL-compatible) and a PHP backend, ready to run on your VPS with Nginx and free HTTPS.

## What works in this version (Phases 1 and 2)

| Area | What members and staff can do |
| --- | --- |
| Accounts | Join, confirm email, sign in, reset a forgotten password, two-factor sign-in codes, change password or email, see where they're signed in, sign out other devices, export their data, delete their account (30-day grace period) |
| Profiles | Avatar upload (cropped and re-saved by the server), initial colour, signature (200 characters, 3 lines), about, website, favourite teams, privacy and notification settings |
| Forum | Every board and sub-board, new topics, replies, quotes, @mentions, likes, edit history, polls, tags, follow, bookmarks, unread markers, search, New Member limits, flood control, blocked link domains |
| Sports | The Sports page with every sport, region, league and team; each league has its own board; match threads open automatically 2 hours before kick-off once the fixtures feed is connected; predictions |
| Crypto and Community | All coin boards and community boards |
| Messages | Direct messages, group chats, contacting staff, attachments (images and PDFs, private to the conversation), blocking, official moderator notices |
| Notifications | On the site (they appear within about 25 seconds without reloading) and by email, at most one email per hour per member |
| Moderation | The moderation queue, reports, hide posts, pin, lock, move, merge, split, delete, warn, suspend (ends automatically), ban, appeals, moderator templates and per-person permissions, full audit log |
| Admin | Every Admin tab: users and roles, moderators, boards and categories, permissions, sports/leagues/teams with logos, navigation, SEO, ad spots, ticker, banners, affiliate links, system settings. Changes save as you make them |
| Ads | Homepage banner, right side slot, ad under the first post, bottom ticker, scheduling, rotation, Clean look switch, real impression and click counts |
| Affiliates | Tracked `/go/{link}` redirects that log each click, postback URL for partner conversions, reports and CSV export |
| Casinos & Sportsbooks | One ranked list with the Payments filter, operator pages, Safety Index (weights in Admin → Reviews), "Rate it" stars, "Visit site" through tracked affiliate links. Admins add operators in Admin → Businesses |
| Reviews | One per member per operator every 180 days, category scores, helpful votes, edit history, official business responses, disputes, moderator statuses, duplicate-text and review-bombing checks |
| Business accounts | Operators claim their page (the claim shows whether the email matches the website); admins approve it in the moderation queue; reps respond to reviews and complaints and edit basic details |
| Complaints | Filing with evidence (public or private), the private case thread, the community discussion topic, specialists, every status, the 7-day operator deadline (checked automatically), outcomes and recovered amounts |
| Blacklist | Staff with the warning permission blacklist operators with public reasons; affiliate links pause automatically; warning labels |
| Search engines | Each page arrives with its title, description and a readable copy of the content; `/sitemap.xml`; hidden from Google until you switch indexing on |

**Opening in later phases.** The Marketplace and seller verification (Phase 3) and escrow (Phase 4, at 2.5% or $10) show an "Opening soon" page for now. Admin → System → Sections lets the Super Admin open or close each section.

**Casinos start empty.** Add real operators in Admin → Businesses with accurate licence details, because the Safety Index is calculated from them.

## Before you start

1. In Namecheap, choose **Ubuntu 22.04 or 24.04** for the VPS. Quasar's 2 CPU / 2–4 GB plans are plenty to start.
2. Point your domain at the VPS: Domain List → Manage → Advanced DNS → add two **A records**, `@` and `www`, set to the VPS IP address. DNS can take up to an hour.

## Setup (about 10 minutes)

From your computer, upload the zip (replace the IP):

```
scp pitchside-vps.zip root@YOUR_VPS_IP:/root/
```

Log in and run the setup (replace the domain and email):

```
ssh root@YOUR_VPS_IP
apt-get update && apt-get install -y unzip
unzip pitchside-vps.zip && cd pitchside-vps
sudo bash setup.sh yourdomain.com you@youremail.com
```

It asks for your **Super Admin** username and password (you sign in with these), and whether to load sample topics. Say **no** for the real launch; sample content is only for trying things out.

The script installs Nginx, PHP, MariaDB, the firewall and SSH brute-force protection, creates the database with a random password, makes your account, runs a self-test (every line should say `ok`), sets up nightly backups and background jobs, and gets the HTTPS certificate.

## After setup

1. Visit `https://yourdomain.com` and sign in.
2. **Admin → System**: set the **Live scores site** address and the **Fixtures feed** (see below).
3. **Email**: open `/var/www/pitchside/app/config.php` and fill in the SMTP settings from your email provider (Brevo has a free tier; Amazon SES and Postmark also work). Then run `sudo systemctl reload 'php*-fpm'`. Until email is set up, new accounts are confirmed automatically and emails are written to `app/storage/mail.log`.
4. **Human check on sign-up (recommended)**: create a free Cloudflare Turnstile widget for your domain and paste its site key and secret into `config.php`.
5. **Legal pages**: Terms, Privacy and Cookies still contain placeholder text. Have them written for your business before launch.
6. **At launch**: Admin → System → tick **Let Google and other search engines index the forum**.

## Fixtures feed (from the live scores site)

Every 5 minutes the forum reads a JSON list of matches from the address in Admin → System. Your live scores site should publish it like this:

```json
[
  {"slug": "arsenal-vs-chelsea-2026-10-18", "league": "premier-league", "home": "arsenal", "away": "chelsea",
   "at": "2026-10-18T15:00:00Z", "status": "upcoming"}
]
```

`league`, `home` and `away` use the same slugs as Admin → Sports. A team the forum doesn't know can be sent with `"homeName"` / `"awayName"` instead. `status` is `upcoming`, `live`, `finished` or `postponed`.

## Backups

Every night at 03:15 the database, uploaded images and your settings file are saved to `/var/backups/pitchside` (kept 14 days). Admin → System shows when the last one ran.

To also copy them off the server (strongly recommended, so a broken VPS can't take your forum with it):

```
sudo apt-get install -y rclone
sudo rclone config        # add a remote named "offsite", e.g. Backblaze B2
```

The nightly backup uploads to it automatically from then on.

To restore a database backup: `gunzip -c /var/backups/pitchside/db-DATE.sql.gz | sudo mysql pitchside`

## Publishing a new version

Upload and unzip the new `pitchside-vps.zip` over the old folder, then run the update. Going from Phase 1 to Phase 2 this way adds the new tables and opens the new sections; nothing you already have is changed.

```
cd pitchside-vps && sudo bash update.sh
```

It backs up first, keeps your settings, uploads and database, adds any new tables, runs the self-test and tells you how to roll back.

## If something isn't right

| Check | Command |
| --- | --- |
| Run the self-test | `sudo -u www-data php /var/www/pitchside/app/selftest.php` |
| Server errors | `sudo tail -50 /var/www/pitchside/app/storage/php-error.log` |
| Background jobs | `sudo tail -50 /var/www/pitchside/app/storage/cron.log` |
| Emails (when SMTP isn't set) | `sudo tail -50 /var/www/pitchside/app/storage/mail.log` |
| Web server | `sudo tail -50 /var/log/nginx/error.log` |

## Security notes

- `app/config.php` holds the database password. It's readable only by root and the web server. Don't share it.
- Passwords are hashed with Argon2id. Every change on the site is checked again on the server for permissions, and needs the session's security token.
- Uploaded images are re-saved by the server (which strips hidden data and photo locations). Message attachments are private to the conversation.
- Sign-in, sign-up, posting, messaging and searching are rate-limited.
- Ubuntu installs security updates automatically. The firewall allows only SSH, HTTP and HTTPS.
