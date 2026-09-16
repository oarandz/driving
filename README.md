# Driving lesson diary

Unbranded website for one instructor and read-only pupil accounts. The front end can run on GitHub Pages; Supabase provides sign-in, records and private teaching files.

## Current status

The website is connected to your Supabase project, `driving-diary` (`cizbyvqloccdrufioqqt`). The database, access rules, private teaching-file bucket and map function are deployed. The website has not been published. See [UPLOAD-AND-SETUP.md](UPLOAD-AND-SETUP.md) for your remaining steps.

Your instructor account, custom email delivery and Mapbox token are not configured yet. The local preview now shows live sign-in. The fictional in-memory demo is used only when the Supabase URL in `config.js` is blank.

Included:

- Weekly diary, lesson prices and paid/unpaid status.
- Pickup and drop-off selection before booking; road travel estimates or explicit manual allowances; grey travel blocks; overlap and travel conflict checks.
- Start/stop lesson, actual start/end times and odometer mileage.
- All five editable note sections. Objectives inherit the latest previous completed lesson's aims when booking and refresh on starting if not manually edited.
- Book the next lesson from a completed lesson record.
- Pupil sign-in with access to only that pupil's lessons, notes, mileage, hours, routes and attached resources.
- GPS route recording while the page is visible, lesson maps, GPX import and a cumulative fog-of-war map.
- Private uploads for PNG, JPG, WebP, MP4, WebM and MOV, with attachment to the active lesson or a chosen lesson.

## Setup

The instructions below describe a fresh installation. **Do not run the initial migration again in your existing `driving-diary` project.** Its database and website connection are already configured.

### 1. Supabase

1. Create a fresh Supabase project.
2. In SQL Editor, run `supabase/migrations/202609160001_initial.sql` once. It creates the tables, access rules, lesson actions and private storage bucket.
3. Set up email authentication and a mail provider in Supabase. The default development email service is restricted; configure custom SMTP for pupil sign-in emails. Enable confirmed email sign-ins.
4. In Authentication → Users, create your own user. Copy its user ID and run the following, replacing the example:

   ```sql
   insert into public.instructors(user_id)
   values ('YOUR-AUTH-USER-UUID');
   ```

5. In `config.js`, set `supabaseUrl` and `supabasePublishableKey` from your project's Connect / API settings. These are public browser values. Never put a secret key or service-role key in the website or GitHub repository.
6. Once the website URL is known, set Supabase Authentication's Site URL and allowed redirect URL to the exact website address, including the repository path and trailing slash. Add `http://127.0.0.1:4173/` only to a development project's redirects if you use that local preview.
7. Sign in as the instructor and add pupil names and email addresses. A pupil signs in with their matching email. Their verified account is linked to their pupil record. A signed-in email that is not on the pupil list gets no lesson access.

### 2. Map service

Map display uses Leaflet and OpenStreetMap tiles. Address search and road travel estimates use Mapbox through an authenticated Supabase Edge Function. A Mapbox account is a separate dependency. Review its pricing before enabling it; no account or paid plan has been created for you.

1. Create a Mapbox token with access to Geocoding and Directions. The app stores selected address coordinates, so the function requests **permanent geocoding**. Mapbox requires an eligible billing setup for that use.
2. Add these Supabase Edge Function secrets:
   - `MAPBOX_ACCESS_TOKEN`: your Mapbox token.
   - `ALLOWED_ORIGIN`: the exact site origin, for example `https://yourname.github.io` (without the repository path).
3. Deploy `supabase/functions/maps/index.ts` as the `maps` function. The function validates the bearer token through Supabase Auth and checks the instructor role before contacting Mapbox.
   - With the Supabase CLI: `supabase functions deploy maps --no-verify-jwt`.
   - The explicit Auth check in the function remains mandatory. Disabling the gateway's legacy JWT verification does not remove this application's authentication check.

Search is currently limited to Great Britain. Estimates use a normal driving route plus five minutes; they do not predict live traffic for the future lesson time. When a service call fails, booking does not invent an estimate. You can select locations on the map and use manual allowances.

### 3. GitHub Pages

1. Create an empty GitHub repository with `main` as its default branch.
2. Put the **contents of this folder** at the repository root, including `.github/workflows/pages.yml`. Do not upload the surrounding `outputs` folder.
3. In repository Settings → Pages, choose **GitHub Actions** as the source.
4. Push the files. The included workflow checks the JavaScript and booking tests, then publishes only the website files.
5. Use the resulting HTTPS address in the Supabase redirects and map function origin settings above.

All front-end links are relative, so a repository URL such as `https://yourname.github.io/diary/` works. The SQL, tests and setup guide are not included in the published Pages artifact. Do not add real pupil records or credentials to the repository.

### Safari bookmark / Home Screen icon

The generated blue L-plate icon is included as the website favicon, a 180×180 Apple touch icon and 192×192 / 512×512 manifest icons. The publishing workflow includes all required files.

After publishing, open the website in Safari on your iPhone, tap Share → Add to Home Screen, then Add. Safari uses the Apple touch icon for the shortcut. If a previous shortcut still shows the old icon, remove that shortcut and add it again after loading the updated website. The original generated artwork is saved in `icons/l-plate-master.png`. The blue is cobalt, rather than an exact match to a supplied BMW paint reference.

The icon setup preserves ordinary browser navigation and does not add offline or background GPS capability. [Apple's icon configuration guidance](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)

## iPhone route recording

A website cannot reliably record GPS in the background on iPhone. Installing it to the Home Screen does not remove this restriction. The included recorder:

- Requires permission and HTTPS, except on localhost.
- Requests a screen wake lock where supported.
- Saves GPS batches to Supabase while the page remains active.
- Temporarily keeps unsynced points in this tab's session storage, and warns before leaving while recording or while points remain unsynced.
- Does not join GPS segments across tracking gaps longer than 90 seconds.

This is not a guaranteed background or offline recorder. Closing the tab or iOS discarding it can lose unsynced points. Integrated background tracking requires an iPhone companion app with appropriate background location support. That app is not included. As a separate option, import a timestamped GPX track from a background recorder after stopping the lesson. Import keeps only points within the lesson's actual start/stop interval; duplicate points are ignored in Supabase.

The fog map reveals an approximate corridor around recorded GPS trails. It is not road-matched, does not prove every road driven, and does not infer missing sections. Mileage totals come from the odometer; hours come from actual start/stop timestamps.

## Checks and limits

Run `node --test tests/core.test.js` for date, objective inheritance, totals, overlap, travel allowance and route gap checks. The optional database harness is `tests/database.check.mjs`; it needs `@electric-sql/pglite@0.3.14` installed locally and runs in a temporary in-memory database, not against live pupil records.

The database migration and role rules were exercised in a local PostgreSQL runtime with simulated Supabase Auth/Storage schemas: instructor access, isolation between two pupils, anonymous/unknown account denial, private resource access, rejected pupil writes, booking conflicts, one active lesson, mileage validation and GPX timestamp restrictions all passed. This does not replace testing real sign-in email, Storage, Edge Functions and iPhone GPS in your actual Supabase project.

Before using real pupil data, confirm in the configured project that pupil A cannot read pupil B's lessons or files, and cannot edit records. Test an actual iPhone lesson and the chosen background-recording workaround.

Additional implementation limits:

- One shared instructor diary. Multiple instructors with separate calendars are not implemented.
- Times display in the device's local timezone, shown above the diary. Keep the device set to the timezone in which you teach.
- Notes save with the Save button and before lesson actions. Close without saving discards unsaved note edits.
- The current resource attachment target is an active lesson first, otherwise the single lesson whose booked time contains the current time. The selected pupil and lesson are shown before attachment.
- After cancelling a lesson, the following lesson's old travel block is marked for review. Use its travel review control to recalculate the new journey.
- The website loads Supabase JS, Leaflet, fonts and map tiles from external services. It needs a working internet connection for live records and maps.

## References

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Mapbox geocoding and permanent result storage](https://docs.mapbox.com/api/search/geocoding/)
- [Mapbox Directions](https://docs.mapbox.com/api/navigation/directions/)
- [Browser geolocation visibility rules](https://www.w3.org/TR/geolocation/)
