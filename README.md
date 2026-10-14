# The Belt – website

Static download page for the Android game. No build step.

## Publish a new APK
1. Name the file `TheBelt.apk` and put it in `downloads/` (replace the old one).
2. Update `APK_VERSION` in `script.js`.
3. Commit and push.

GitHub rejects any single file over 100 MB. If the APK is bigger, attach it to a GitHub Release instead and set `APK_PATH` in `script.js` and the button `href` in `index.html` to the release URL.

## Hosting
GitHub Pages: Settings → Pages → deploy from the branch root.
