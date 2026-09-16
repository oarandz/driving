# Upload and remaining setup

## Upload to GitHub

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
- Six database tables, lesson actions and access rules. Row-level security is enabled on every application table; anonymous table reads are not permitted.
- Private `teaching-resources` storage bucket.
- Deployed `maps` function, with explicit user and instructor checks.
- Map function origin: `https://oarandz.github.io`.
- Authentication Site URL: `https://oarandz.github.io/driving/`.
- Additional authentication redirect: `http://127.0.0.1:4173/` for the current local preview. Map requests are restricted to the GitHub website origin.
- Flat blue L icon for Safari bookmarks and Add to Home Screen.

Do not rerun the initial SQL migration in this project. No pupil records or instructor accounts have been added.

## Still needed

### Instructor account

Confirm the email address you want to use. Once that email has a verified Supabase Auth account, its user ID needs to be added to the `instructors` table. Until then, signing in does not give access to the diary. The website uses emailed sign-in links, not a password form.

### Pupil sign-in emails

Custom SMTP is currently disabled. Configure an email provider in **Supabase → Authentication → Emails → SMTP Settings** before using pupil sign-in. The default Supabase email service has restricted recipients and is not sufficient for general pupil access. Enter provider credentials directly into Supabase, never into the website files or GitHub.

### Address search and automatic travel times

Add a Mapbox token to **Supabase → Edge Functions → Secrets** as `MAPBOX_ACCESS_TOKEN`. The Mapbox account must support permanent geocoding because selected coordinates are saved. No Mapbox account, billing or token has been set up for you.

Until that is configured, select locations on the map and enter travel allowances manually. Route display and lesson GPS recording use a separate map display and do not require the Mapbox token.

### Final checks

After publishing and finishing account setup, test instructor sign-in, a pupil's read-only access, one lesson and a teaching-file upload. The application and access rules passed local tests, and the live database protection settings were checked, but real account sign-in and a live iPhone lesson have not yet been tested.

On iPhone, keep the website open for GPS recording. Reliable recording with the screen locked still requires a separate recorder with GPX import, or a future native companion app.
