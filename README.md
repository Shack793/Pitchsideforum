# Pitchside Forum on a Namecheap Quasar VPS

This folder contains the latest Pitchside Forum build (version 34) ready to serve from your VPS with Nginx and free HTTPS.

## What's inside

| Path | What it is |
| --- | --- |
| `public/` | The website: `index.html`, favicons and app icons, `robots.txt` |
| `nginx/pitchside.conf` | Nginx site config: compression, caching, security headers, every app page served by `index.html` |
| `setup.sh` | First-time setup: installs Nginx, Certbot and the firewall, copies the site, gets HTTPS |
| `update.sh` | Publishes a new version and keeps a backup of the old one |

## Before you start

1. In Namecheap, choose **Ubuntu 22.04 or 24.04** as the VPS operating system.
2. Point your domain at the VPS: in Domain List → Manage → Advanced DNS, add two **A records**, `@` and `www`, both set to the VPS IP address. DNS can take up to an hour to update.

## First-time setup (about 5 minutes)

From your computer, upload the folder (replace the IP):

```
scp pitchside-vps.zip root@YOUR_VPS_IP:/root/
```

Then log in and run the setup (replace the domain and email):

```
ssh root@YOUR_VPS_IP
apt-get update && apt-get install -y unzip
unzip pitchside-vps.zip && cd pitchside-vps
sudo bash setup.sh yourdomain.com you@youremail.com
```

When it finishes, the site is live at `https://yourdomain.com`. The HTTPS certificate renews itself.

## Publishing a new version later

Upload the new zip, unzip it over the old folder, then:

```
cd pitchside-vps && sudo bash update.sh
```

Each update saves the previous version in `/var/www/pitchside-backups` (last 10 kept).

## Good to know

- **This is still the clickable prototype.** All data is sample data held in the visitor's browser, and changes reset on reload. Accounts, posts, payments, escrow and verification need a backend (database and server code) before launch. The VPS is ready to host that backend next to the site.
- **Hidden from search engines for now.** `robots.txt` and a `noindex` tag keep the prototype out of Google. Remove both at launch.
- **Testing roles:** add `?demo=1` to the address for the demo role switcher.
- **Live scores** links point to a placeholder address (scores.pitchside.example) until the real scores site exists.
