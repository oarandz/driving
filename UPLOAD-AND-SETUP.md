# Upload and remaining setup

## Latest update: pupil activity and driving skills

**The Supabase update has already been applied. No further Supabase changes are needed.**

The new migration is `supabase/migrations/202609180001_pupil_activity_skills.sql`. It has been run successfully in the existing driving-diary project. Do not rerun it or earlier migrations. It adds skill ratings, instructor-only activity summaries, private session deduplication and permission-checked actions.

After the database update, extract **skills-activity-update.zip** and upload **all contents, including tests and supabase folders**, to the root of [oarandz/driving](https://github.com/oarandz/driving), replacing matching files. Commit to `main`, wait for Pages deployment, then refresh. Upload the extracted files, not the ZIP itself. This package includes all previous updates.

### Driving skills

Choose **Pupils → Driving skills** for a pupil, or **Grade driving skills** from their lessons/progress profile. Each of the 27 DVSA skills has a rating that saves immediately when changed:

- 0 — Not introduced
- 1 — Always prompted
- 2 — Often prompted
- 3 — Mostly independent
- 4 — Fully independent

The skill names follow the official DVSA learning-to-drive record. These numbers and descriptions are your custom scale, not DVSA's official five levels. Each saved rating shows its update date/time. Failed saves keep the previous value and display an error. A stale edit cannot silently replace a newer rating.

Pupils see their ratings under **My progress → View driving skills**. They cannot change them. Your **View as pupil** preview also shows the ratings.

### Account activity

The pupil cards and their progress profiles show **Sign-ins recorded**, **Visits** and **Last active**. Choose **Refresh activity** on Pupils to load the latest figures.

Tracking begins when the pupil opens the updated website. It does not reconstruct earlier usage. A sign-in is counted once per authenticated session when first seen by the updated app, including an existing session on its first tracked use. Refreshes, token refreshes and switching tabs within the same session do not add sign-ins. A visit starts after 30 minutes without recorded activity or when a new sign-in session is seen.

Last active records page opens and pointer, keyboard, scroll or return-to-tab activity, at most once every 30 seconds. It is an approximate activity indicator, not proof that particular notes were read. Hidden tabs, the demo and instructor previews do not record activity. No browsing history, IP addresses or device fingerprints are collected. If a request fails, it is retried on later interaction without blocking the pupil. Activity totals remain attached to the pupil when their code is reset.

## Pupil lesson list and instructor preview

- Pupils open **My lessons** to see their next booked lesson, or **No next lesson booked**, followed by their previous lessons, newest first. Selecting a lesson opens its notes, route and resources. A lesson in progress appears above the next booking.
- In **Pupils**, choose **View as pupil** on a pupil's card or their lessons/progress profile. You see that pupil's read-only lesson list and progress. The banner identifies the selected pupil.
- Choose **Back to instructor view** to return to the page you came from. No pupil code is needed, no sign-in credentials are changed, and the pupil is not signed out. Reloading the page returns to your instructor account.

The preview uses your existing instructor session with the pupil interface and selected pupil's records. It does not test the pupil's access code or impersonate their authenticated session.

## YouTube videos and lesson resources

The YouTube database update has already been applied to your Supabase project. No Supabase setup is needed for this update.

1. Sign in as the instructor and open a lesson, including a completed lesson.
2. Under **Lesson resources**, choose **Pin a YouTube video**.
3. Paste the video link, optionally enter a title, then choose **Pin video to lesson**.
4. The pupil sees a thumbnail card in that lesson's resources. Selecting the card opens YouTube in a new tab.
5. Choose **Unpin video** to remove it from the pupil's view. Pinning the same link again restores it without creating a duplicate.

You can also choose **Pin a library resource** in the lesson to attach an existing teaching file. Upload files in the Resources area first. Pupils cannot add or remove resources or videos.

Titles are entered manually; a blank title displays “YouTube video”. Private, deleted or restricted videos may not be available to the pupil, and thumbnails depend on YouTube being reachable.

## Pupil emails and reusable access codes

The pupil-access migration, Edge Function and explicitly approved database lookup permissions are applied. Live checks passed for browser connection, rejection of anonymous code generation and rejection of an unknown pupil sign-in. Generate the first real pupil code and check successful sign-in after uploading the frontend.

1. Choose **Instructor sign in** and use your existing email/password.
2. Open **Pupils → Email & access code** for the pupil.
3. Edit the email and choose **Save email**, or choose **Generate access code** (which also saves an edited email).
4. Copy the displayed code and give it to the pupil. It is shown once; choose **Generate new code** if a replacement is needed.
5. The pupil chooses **Pupil sign in**, enters their email and code, and can read only their own records.

Codes remain valid until replaced. Resetting a code disconnects the previous login from that pupil’s records. Pupil access does not use email delivery. Your instructor password remains separate.

## Lesson times and GPS mileage

These features are included in the latest update, and their Supabase migrations are already applied.

- Open a lesson → **Edit lesson times** to correct booked dates/times or actual driving times, even after completion. Actual times update pupil hours. When moving a booking, check the displayed manual travel allowances.
- Open a lesson → **Upload a GPX route**. Preview the map and GPS mileage, then **Save route to lesson**. GPS mileage is saved and used for that completed lesson’s contribution to pupil totals.
- For a booked lesson, tick **Mark lesson completed using this recording’s start and finish times** to complete it directly from the file, without using the website recorder or entering odometer readings. Leave it unticked to attach the route and mileage only.
- GPS mileage is an estimate. Recording gaps over 90 seconds and separate segments are not joined. Recordings append to the lesson; upload only routes belonging to that lesson. Identical points are deduplicated.

The complete route is attached even if its timestamps differ from the lesson times. Its coordinates, recording times, segments and filename are saved; the original GPX file is not separately archived. Hours use actual lesson times. Mileage uses imported GPS distance when present and odometer readings otherwise.

## Instructor password

When signed in, choose **Password** at the top of the diary to set or change your password. If signed out, choose **Set or reset password** and follow the reset email. Pupils use the reusable codes you generate; they do not use instructor password recovery.

## Initial upload to GitHub

1. Extract `driving-diary.zip` and open the `driving-diary` folder.
2. Upload the **contents** to [oarandz/driving](https://github.com/oarandz/driving), on the `main` branch. `index.html` must be at the repository root, not inside another folder.
3. Include the hidden `.github` folder. On a Mac, press Command–Shift–period in Finder to show hidden files. Check that `.github/workflows/pages.yml` appears in the repository after uploading.
4. In the repository, open **Settings → Pages**, and choose **GitHub Actions** as the source.
5. Open **Actions → Publish diary to GitHub Pages**. If the first run failed before Pages was enabled, choose **Re-run all jobs**. You can also choose **Run workflow** after uploading.
6. When deployment succeeds, open [your website](https://oarandz.github.io/driving/).

GitHub does not extract uploaded ZIPs. Upload the extracted files, not the ZIP itself. No installation or build is needed on your computer.

## Already configured

- Supabase project: `driving-diary`, London, reference `cizbyvqloccdrufioqqt`.
- Website connection in `config.js`, containing only the public project URL and publishable key.
- Application tables, lesson actions and access rules. Row-level security is enabled on every application table; anonymous table reads are not permitted.
- Private `teaching-resources` storage bucket.
- Deployed `maps` function, with explicit user and instructor checks.
- Map function origin: `https://oarandz.github.io`.
- Authentication Site URL: `https://oarandz.github.io/driving/`.
- Additional authentication redirect: `http://127.0.0.1:4173/` for the current local preview. Map requests are restricted to the GitHub website origin.
- Flat blue L icon for Safari bookmarks and Add to Home Screen.

Do not rerun the initial SQL migration in this project. Instructor access has been enabled for your verified account. The setup did not add pupil records.

## Still needed

### Instructor account

Your account is verified and instructor access is enabled. After uploading the password update, choose your password as described above. You do not need another account.

### Instructor password reset emails

Custom SMTP is currently disabled. Configure an email provider in **Supabase → Authentication → Emails → SMTP Settings** for reliable instructor password recovery. The default Supabase service has restricted recipients and a small allowance. Pupil access codes do not use email delivery. Enter provider credentials directly into Supabase, never into GitHub.

### Address search and automatic travel times

Add a Mapbox token to **Supabase → Edge Functions → Secrets** as `MAPBOX_ACCESS_TOKEN`. The Mapbox account must support permanent geocoding because selected coordinates are saved. No Mapbox account, billing or token has been set up for you.

Until that is configured, select locations on the map and enter travel allowances manually. Route display and lesson GPS recording use a separate map display and do not require the Mapbox token.

### Final checks

After publishing and finishing account setup, test instructor sign-in, a pupil's read-only access, one lesson and a teaching-file upload. The application and access rules passed local tests, and the live database protection settings were checked, and the instructor has signed in using the earlier email-link flow. Real password sign-in and a live iPhone lesson still need testing after this update is uploaded.

On iPhone, keep the website open for GPS recording. Reliable recording with the screen locked still requires a separate recorder with GPX import, or a future native companion app.
