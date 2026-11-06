---
layout: ../layouts/LegalLayout.astro
title: Privacy policy
description: "How GitNut and gitnut.dev handle your data: no app telemetry, cookieless website analytics, hosting and your rights."
path: /privacy
lede: "Short version: the GitNut app collects nothing, and this website counts visits without cookies. Last updated 2026-11-06."
---

## Who we are

GitNut is made by Flying Art. The data controller is GlideByte Artur Kumszczyński, st. Stawy 5, 02-467 Warsaw, Poland. Email: [contact@flyingart.dev](mailto:contact@flyingart.dev). This policy covers the website gitnut.dev and the GitNut app.

## The GitNut app

The app and the `gitnut` daemon collect no telemetry, usage data or crash reports. They only talk to:

- the GitNut daemons (servers) you add yourself;
- the update check, a plain request for `https://gitnut.dev/manifest.json` (the daemon) or `https://gitnut.dev/desktop/latest.json` (the desktop app, every 10 minutes). It sends no account, ID or app data. When you install an update, the app downloads the file for your platform through gitnut.dev from GitHub Releases. The daemon's automatic check can be turned off in the settings.

Like any web request, the update check shows your IP address and the HTTP client name to our server and to Cloudflare (see Hosting).

## Website analytics

We use [Rybbit](https://rybbit.io), an open-source analytics tool. We host it ourselves, on our own server in Germany, so the data doesn't go to an analytics company. We don't use cookies, and the script stores nothing in your browser. There is no cross-site tracking, no advertising and no session recording.

To count visits, the server hashes your IP address and browser details with a salt that changes every day, so visits can't be linked across days. The full IP address is not stored. We see aggregate data such as:

- pages viewed and the referring site;
- approximate location (country, region, city) derived from the IP address;
- browser, operating system, device type, screen size and language;
- clicks on downloads, install commands and links to other sites;
- downloads of GitNut files and install scripts from gitnut.dev, also app updates: our server reports the file, version, platform and kind of client (browser, install script, app) to Rybbit, with your IP address and browser details for the same daily-salted count and location. The IP address is not stored there either.

The legal basis is our legitimate interest in knowing how the site is used (GDPR Art. 6(1)(f)). You can object by emailing us, or block the script with your browser or an ad blocker.

## Hosting

**Cloudflare** is our CDN and proxy. It handles every request to gitnut.dev, including your IP address, and may process data outside the EEA under its safeguards. See [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

Our server is hosted by **Hostinger** in Germany. It keeps short technical logs (such as IP address, time and requested address) for security and troubleshooting.

Downloads are served from **GitHub Releases**. When you download GitNut, [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) applies.

## Donations

If you support GitNut with a donation, you do it through GitHub Sponsors, Ko-fi or PayPal. Those services handle the payment and your details under their own privacy policies. We only receive what they pass on to us, such as your name and the amount.

## Your rights

Under the GDPR you can ask for access to your data, and for its correction or deletion. You can also restrict or object to its processing, and ask for data portability. Email [contact@flyingart.dev](mailto:contact@flyingart.dev).

You can also complain to a supervisory authority: in Poland the President of the Personal Data Protection Office ([uodo.gov.pl](https://uodo.gov.pl)), or the authority where you live.

## Changes

We don't sell personal data and don't show ads. If this policy changes, we update this page and the date at the top.
