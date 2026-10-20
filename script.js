// Edit these when you ship a new APK.
const APK_PATH = 'downloads/TheBelt.apk';
const APK_VERSION = '1.0';
// Set by update-apk.sh; shown for external (R2) links where the size can't be fetched.
const APK_SIZE_MB = 0;

(function () {
  document.querySelectorAll('[data-version]').forEach(function (el) { el.textContent = APK_VERSION; });

  var btn = document.getElementById('dl-btn');
  var meta = document.getElementById('dl-meta');
  var size = document.getElementById('dl-size');
  btn.setAttribute('href', APK_PATH);

  // Check the APK exists and show its size. If it's missing, say so instead of giving a dead download.
  // External URLs (e.g. a GitHub Release) can't be checked from the browser because of CORS.
  if (/^https?:\/\//.test(APK_PATH)) {
    if (APK_SIZE_MB > 0) {
      size.textContent = APK_SIZE_MB + ' MB';
      size.hidden = false;
    }
    return;
  }

  fetch(APK_PATH, { method: 'HEAD' }).then(function (res) {
    if (!res.ok) throw new Error('missing');
    var bytes = parseInt(res.headers.get('content-length'), 10);
    if (bytes > 0) {
      size.textContent = (bytes / 1048576).toFixed(0) + ' MB';
      size.hidden = false;
    }
  }).catch(function () {
    btn.classList.add('unavailable');
    btn.removeAttribute('download');
    btn.setAttribute('aria-disabled', 'true');
    meta.textContent = 'APK coming soon';
  });
})();
