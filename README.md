# Driving lesson diary

Unbranded website for one instructor and read-only pupil accounts. The front end can run on GitHub Pages; Supabase provides sign-in, records and private teaching files.

## Current status

The website is connected to your Supabase project, `driving-diary` (`cizbyvqloccdrufioqqt`). The database, access rules, private teaching-file bucket and map function are deployed. The website is published at https://oarandz.github.io/driving/. The activity/skills migration has been applied successfully to the live project. This local package includes the supplied 36-heading / 664-item detailed syllabus, lesson skill pins and instructor-only pupil activity summaries, a pupil home with the next booking and newest-first lesson history, instructor pupil previews, YouTube video cards under lesson resources, instructor password sign-in, pupil access codes, email editing, GPX mileage and lesson-time editing. Upload all the extracted contents of the latest update ZIP, including its folders, to install the update. See [UPLOAD-AND-SETUP.md](UPLOAD-AND-SETUP.md) for the remaining steps.

Your instructor account is verified and has instructor access. Custom email delivery and the Mapbox token are not configured yet. Pupils sign in with their email and an instructor-issued access code; the instructor uses email and password. The fictional in-memory demo is used only when the Supabase URL in `config.js` is blank.

Included:

- Instructor-editable ratings for the supplied 664 detailed skills under 36 core headings. Pupils see a compact searchable overview with expandable read-only detail. Colours remain grey/red/orange/light green/dark green for levels 0–4. Overall progress uses points out of 2,656; all items rated 4 is 100%. Existing 27-skill ratings remain separately available for reference.
- Core skill pins in lesson summaries, with heading numbers and saved average ratings. Scores stay fixed unless the instructor explicitly refreshes them. Unpinning is reversible.
- Pupil sign-in session counts, visits and last activity, visible only to the instructor. Tracking excludes the demo, hidden pages and instructor previews.

- Weekly instructor diary, lesson prices and paid/unpaid status. Pupils see their next booking and a newest-first list of previous lessons.
- Instructor **View as pupil** on each pupil card/profile, with a clear return button. The preview displays the pupil interface using the instructor session; it does not change pupil credentials or sign them out.
- Pickup and drop-off selection before booking; road travel estimates or explicit manual allowances; grey travel blocks; overlap and travel conflict checks.
- Start/stop lesson, editable booked and actual times, odometer mileage, or completion directly from a GPX recording.
- All five editable note sections. Objectives inherit the latest previous completed lesson's aims when booking and refresh on starting if not manually edited.
- Book the next lesson from a completed lesson record.
- Instructor email/password sign-in; instructor-managed pupil emails and reusable access codes. Pupils can only read their own lessons, notes, mileage, hours, routes and attached resources.
- GPS route recording while the page is visible, lesson maps, GPX import and a cumulative fog-of-war map.
- Private uploads for PNG, JPG, WebP, MP4, WebM and MOV, with attachment to the active lesson or a chosen lesson.
- YouTube links with thumbnail cards under Lesson resources. Instructors can pin and unpin videos or attach library resources directly in a lesson, including after completion. Pupils can view only resources pinned to their own lessons.

## Setup

The instructions below describe a fresh installation. **Do not run the initial migration again in your existing `driving-diary` project.** Its database and website connection are already configured.

### 1. Supabase

1. Create a fresh Supabase project.
2. In SQL Editor, run the files in `supabase/migrations/` in filename order, once each. The initial migration creates the tables, access rules, lesson actions and private storage bucket. Subsequent updates add full-recording GPX uploads, editing lesson times, GPS mileage and optional completion from GPX. The fifth migration adds pupil email editing and code activation. The sixth adds instructor-managed YouTube pins with pupil access restricted to their own lessons. The seventh adds pupil skill ratings and account activity. The eighth adds the custom detailed syllabus ratings and saved lesson core-skill pins without modifying previous ratings. See UPLOAD-AND-SETUP.md for live deployment status.
3. Set up email authentication and a mail provider in Supabase. The default development email service is restricted; configure custom SMTP for instructor password reset emails. Pupil code sign-in and account creation do not send email. Keep instructor email confirmation enabled.
4. In Authentication → Users, create your own user. Copy its user ID and run the following, replacing the example:

   ```sql
   insert into public.instructors(user_id)
   values ('YOUR-AUTH-USER-UUID');
   ```

5. In `config.js`, set `supabaseUrl` and `supabasePublishableKey` from your project's Connect / API settings. These are public browser values. Never put a secret key or service-role key in the website or GitHub repository.
6. Once the website URL is known, set Supabase Authentication's Site URL and allowed redirect URL to the exact website address, including the repository path and trailing slash. Add `http://127.0.0.1:4173/` only to a development project's redirects if you use that local preview.
7. Deploy `supabase/functions/pupil-access/index.ts` as `pupil-access` with gateway legacy JWT verification off. Set `ALLOWED_ORIGIN` to the exact website origin. The function checks instructor JWTs for code generation and validates access codes for pupil login. Supabase supplies its server-only service-role credential; never copy it to the frontend.
8. Sign in as the instructor, add pupils, then choose **Email & access code → Generate access code** for each pupil. Copy the code and give it to that pupil. They use **Pupil sign in** with their email and code. Codes work until replaced; no signup email or pupil password setup is required.

### Pupil access and instructor passwords

- Under **Pupils → Email & access code**, edit an email and choose **Save email**. A code-managed pupil then uses the new email with their existing code. Names, lessons and other records remain attached to the same pupil.
- **Generate access code** creates a random 16-character code, displayed in four groups. **Generate new code** replaces it. Codes are shown only in the result dialog; copy them before closing. The backend stores the credential through Supabase Auth, not as plaintext in application tables.
- A replacement links a fresh private authentication identity to the pupil. Previous identities immediately lose access through the row-level policies, and identities created by this code service are also banned. Old Auth identities remain for audit/history; no accounts or lesson data are deleted. Data already downloaded to a device cannot be recalled.
- Eight correctly formatted code attempts per email are allowed in each 15-minute window. Codes are case-insensitive and accept spaces/hyphens. Errors do not disclose whether an email belongs to a pupil.
- Existing pupil links continue working until replaced. New pupil accounts are linked only through instructor-generated codes, not automatic email matching. Generate a code for each existing pupil when switching them to the new sign-in screen.
- Your instructor account continues using **Instructor sign in** and **Password** / **Set or reset password**. Instructor password recovery still uses email.
- Changing a pupil email does not require an email to either address. Check the address before sharing their code. Private internal Auth addresses are separate from pupil contact emails.

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

This is not a guaranteed background or offline recorder. Closing the tab or iOS discarding it can lose unsynced points. Integrated background tracking requires an iPhone companion app with appropriate background location support. That app is not included. As a separate option, upload a timestamped GPX track from a background recorder. In a lesson, choose Upload a GPX route, inspect the map and recording time, then choose Save route to lesson. Imports retain the full recording even when it extends outside the lesson times. The target pupil and lesson are shown before saving. Scheduled, active and completed lessons support uploads; cancelled lessons do not. GPS distance becomes the lesson mileage used in pupil totals. Odometer readings remain stored; they are used for lessons without imported GPS mileage. For a scheduled lesson, an optional checkbox completes it using the uploaded recording’s first and last timestamps, without entering odometer readings or running the website recorder. Otherwise, actual lesson hours remain unchanged. Duplicate points are ignored in Supabase. GPX segment boundaries and tracking gaps remain separate on the map. The route points and source filename are saved in the database; the original XML file is not retained as a separate download.

The fog map reveals an approximate corridor around recorded GPS trails. It is not road-matched, does not prove every road driven, and does not infer missing sections. Mileage totals use GPS mileage where a GPX route has been imported, otherwise the odometer difference. GPS mileage is the sum of distances between successive points in each imported track segment; gaps over 90 seconds and equal-time points are not joined. GPS drift, sparse samples and missing sections affect this estimate. Upload only recordings belonging to the lesson: different recordings append and their distances contribute to its mileage. Hours come from actual start/finish timestamps, including those set when completing a lesson from GPX.

## Checks and limits

Run `node --test tests/*.test.js` for booking/date/route checks, GPX parsing/segment checks and authentication flow tests. Authentication tests use an isolated Auth service and a minimal DOM; they never send email or change live passwords. The optional database harness is `tests/database.check.mjs`; it needs `@electric-sql/pglite@0.3.14` installed locally and runs in a temporary in-memory database, not against live pupil records.

The database migration and role rules were exercised in a local PostgreSQL runtime with simulated Supabase Auth/Storage schemas: instructor access, isolation between two pupils, anonymous/unknown account denial, private resource access, rejected pupil writes, booking conflicts, one active lesson, mileage validation and legacy GPX timestamp restrictions all passed. The subsequent GPX update was tested for full recordings outside lesson times, repeated-upload deduplication, saved filenames/segments, invalid data rollback, unchanged lesson totals and instructor-only uploads. A supplied 566-point Open GPX Tracker recording was also previewed and saved in the local sample diary, with its route and start/finish markers checked visually. This does not replace testing real password sign-in, reset email delivery, Storage, Edge Functions and iPhone GPS in your actual Supabase project. The instructor has successfully signed in with the earlier email-link flow; the password update still requires deployment and the user choosing their password.

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

Lesson-time edits were tested for scheduled, active and completed lessons, travel gaps, overlaps, stale forms, permissions and preserved notes/routes/mileage. GPS mileage was checked against a known geographic distance, gap/segment handling, retry deduplication, pupil totals, completion without odometer readings and atomic rejection of invalid recordings. Browser checks covered rescheduling, corrected hours and completing a sample lesson from the supplied GPX file. No real pupil lesson was changed during testing.

Pupil access tests cover instructor-only generation, random code format, activation races, retired login access, pupil isolation, email validation/duplicates, rate limiting, and client session handling. Live probes check CORS and anonymous rejection; first real pupil code generation and successful sign-in should be checked after the frontend upload.

YouTube checks cover accepted link formats, invalid and spoofed URLs, completed-lesson pins, duplicate prevention, title updates, reversible unpinning and pupil read-only isolation. Browser checks covered thumbnail previews, pinning a sample video and the pupil view. The YouTube migration is applied to the live project; upload the frontend update to use it. No real pupil lesson was changed during testing.

Activity and skill tests cover all rating bounds, stale edits, own-pupil read access, denied pupil writes, instructor-only activity metrics, session deduplication, visit gaps and exclusion of instructor previews. Demo browser checks confirmed saved rating feedback and read-only pupil display. Activity tracking starts with the updated website; historical sign-ins are not backfilled. The 27 skill names use the [DVSA learning-to-drive record](https://assets.publishing.service.gov.uk/media/63e216648fa8f50e893514e9/learning-to-drive-record-overall-progress.pdf), Crown copyright, Open Government Licence v3.0. The user-specified 0–4 scale is separate from DVSA's official levels.

The detailed-syllabus migration has been applied to the live project. Tests cover category/item bounds, stale edits, pupil isolation, preserved legacy grades, progress across all 664 items, and saved lesson scores that change only on explicit refresh. Browser checks covered search, saving a detailed rating, updated averages and progress, the pupil overview, and a read-only pinned score on a completed sample lesson. No real pupil grades or lesson records were changed during testing.
