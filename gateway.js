// The admin pages are served by the API (so their session cookie is first-party). The API runs on a
// free host that sleeps when idle, so wait for it here, with an animation, before redirecting.
(function () {
  var API = (window.FATTY_CONFIG && window.FATTY_CONFIG.API_URL) || '';
  var msg = document.getElementById('gw-msg');
  var started = Date.now();
  var GIVE_UP_MS = 120000;
  var overlay = null, secondsEl = null, ticker = null;

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  }

  function showWake() {
    if (overlay) return;
    overlay = el('div', 'wake');
    overlay.setAttribute('role', 'status');
    var box = overlay.appendChild(el('div', 'wake-box'));
    var belt = box.appendChild(el('div', 'belt'));
    belt.setAttribute('aria-hidden', 'true');
    belt.appendChild(el('span', 'belt-strap'));
    belt.appendChild(el('span', 'belt-buckle'));
    box.appendChild(el('p', 'wake-title', 'Waking up the server…'));
    box.appendChild(el('p', 'wake-sub', 'The free host falls asleep when nobody is around. This can take up to a minute.'));
    var time = box.appendChild(el('p', 'wake-time'));
    secondsEl = time.appendChild(el('span', null, '0'));
    time.appendChild(document.createTextNode('s'));
    document.body.appendChild(overlay);
    ticker = setInterval(function () {
      secondsEl.textContent = Math.floor((Date.now() - started) / 1000);
    }, 500);
  }

  function giveUp() {
    clearInterval(ticker);
    if (overlay) overlay.remove();
    msg.textContent = 'The server did not wake up. Reload this page to try again.';
    msg.hidden = false;
  }

  if (!API) { giveUp(); return; }
  var wakeTimer = setTimeout(showWake, 1200);

  function attempt() {
    fetch(API + '/health', { cache: 'no-store' })
      .then(function (r) { return r.ok; }, function () { return false; })
      .then(function (ok) {
        if (ok) {
          clearTimeout(wakeTimer);
          location.replace(API + '/admin/');
        } else if (Date.now() - started > GIVE_UP_MS) {
          giveUp();
        } else {
          setTimeout(attempt, 2000);
        }
      });
  }
  attempt();
})();
