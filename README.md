# The Fatty – website

Static download page for the Android game. No build step.

## Publish a new APK
From the repo root, on the `main` branch (Git Bash on Windows works):

```
./update-apk.sh "path/to/new-build.apk" 1.1
```

It checks the file is a real APK, runs a dry-run check (R2 credentials, Supabase, version unused), uploads the APK to Cloudflare R2, records it in the Supabase `releases` table, then updates `APK_PATH`, `APK_VERSION` and `APK_SIZE_MB` in `script.js`, commits that file and pushes. The APK itself is no longer stored in git. Pages redeploys in 1-2 minutes. Add `-y` to skip the confirmation prompt.

One-time setup: `cd api && npm install`, then copy `api/.env.example` to `api/.env` and fill in the Supabase and R2 values. To test the setup without uploading anything: `cd api && npm run release -- path/to/apk 1.1 --dry-run`.

Before every build: raise the Android version code in Unity and sign with the same keystore as before, or players cannot update in place.

## Hosting
GitHub Pages: Settings → Pages → deploy from the branch root.
