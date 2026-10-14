# The Belt – website

Static download page for the Android game. No build step.

## Publish a new APK
From the repo root, on the `main` branch (Git Bash on Windows works):

```
./update-apk.sh "path/to/new-build.apk" 1.1
```

It checks the file is a real APK under GitHub's size limit, copies it to `downloads/TheBelt.apk`, updates `APK_VERSION` in `script.js`, commits and pushes. Pages redeploys in 1-2 minutes. Add `-y` to skip the confirmation prompt.

Before every build: raise the Android version code in Unity and sign with the same keystore as before, or players cannot update in place.

GitHub rejects any single file over 100 MB. If the APK is bigger, attach it to a GitHub Release instead and set `APK_PATH` in `script.js` and the button `href` in `index.html` to the release URL.

## Hosting
GitHub Pages: Settings → Pages → deploy from the branch root.
