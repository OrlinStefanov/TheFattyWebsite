#!/usr/bin/env bash
# Publish a new APK: ./update-apk.sh <path-to-apk> <version> [-y]
# Example:          ./update-apk.sh "../The Belt/APKs/TheFatty.apk" 1.1
# Works in Git Bash on Windows, macOS and Linux. Run it from anywhere inside this repo.
set -euo pipefail

APK_SRC="${1:-}"
VERSION="${2:-}"
ASSUME_YES="${3:-}"
DEST="downloads/TheBelt.apk"
MAX_MB=95   # GitHub rejects files over 100 MB

die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "$APK_SRC" ] && [ -n "$VERSION" ] || die "usage: $0 <path-to-apk> <version> [-y]"
[ -f "$APK_SRC" ] || die "file not found: $APK_SRC"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+){1,2}$ ]] || die "version must look like 1.1 or 1.1.2, got: $VERSION"

cd "$(git rev-parse --show-toplevel)"

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "switch to the main branch first (you are on $(git rev-parse --abbrev-ref HEAD))"
[ -z "$(git status --porcelain)" ] || die "you have uncommitted changes; commit or stash them first"
git pull --ff-only -q origin main || die "could not update main from GitHub"

# Make sure it really is an APK and not a wrong file.
PY=$(command -v python3 || command -v python || true)
[ -n "$PY" ] || die "python is needed to validate the APK"
"$PY" - "$APK_SRC" <<'EOF' || die "not a valid APK (bad zip or no AndroidManifest.xml)"
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
assert "AndroidManifest.xml" in z.namelist()
EOF

SIZE_BYTES=$(wc -c < "$APK_SRC" | tr -d ' ')
SIZE_MB=$(( SIZE_BYTES / 1048576 ))
[ "$SIZE_MB" -lt "$MAX_MB" ] || die "APK is ${SIZE_MB} MB; GitHub rejects files over 100 MB. Use GitHub Releases instead."

if [ -f "$DEST" ] && cmp -s "$APK_SRC" "$DEST"; then
  die "this APK is identical to the one already published"
fi

OLD_VERSION=$(sed -n "s/^const APK_VERSION = '\(.*\)';/\1/p" script.js)
[ -n "$OLD_VERSION" ] || die "could not find APK_VERSION in script.js"
[ "$OLD_VERSION" != "$VERSION" ] || die "version is already $VERSION; use a new version number"

if command -v sha256sum >/dev/null; then SHA=$(sha256sum "$APK_SRC" | cut -d' ' -f1); else SHA=$(shasum -a 256 "$APK_SRC" | cut -d' ' -f1); fi

echo "Publishing:  $OLD_VERSION -> $VERSION"
echo "APK:         $APK_SRC (${SIZE_MB} MB)"
echo "SHA-256:     $SHA"
echo
echo "Reminder: the APK's Android version code must be higher than the last build,"
echo "and it must be signed with the same keystore, or players cannot update in place."
echo
if [ "$ASSUME_YES" != "-y" ]; then
  read -r -p "Commit and push to main? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Cancelled. Nothing changed."; exit 1; }
fi

cp "$APK_SRC" "$DEST"
sed -i.bak "s/^const APK_VERSION = '.*';/const APK_VERSION = '$VERSION';/" script.js && rm -f script.js.bak
grep -q "const APK_VERSION = '$VERSION';" script.js || { git checkout -- script.js "$DEST" 2>/dev/null || true; die "failed to update script.js"; }

git add "$DEST" script.js
git commit -q -m "Release The Belt v$VERSION" -m "SHA-256: $SHA"
git push -q origin main

echo
echo "Done. Pages redeploys in 1-2 minutes; some visitors may see the old file for up to ~10 minutes."
echo "Progress: https://github.com/OrlinStefanov/TheFattyWebsite/actions"
