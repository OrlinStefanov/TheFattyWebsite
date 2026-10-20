// Calls the API that serves these pages. The session lives in HttpOnly cookies set by the API, so
// this script never sees or stores a token. A wake-up animation appears if a request is slow.
(function () {
  var WAKE_AFTER_MS = 1200;
  var TIMEOUT_MS = 90000;

  // ---- wake-up overlay ----------------------------------------------------
  var pending = 0, wakeTimer = null, overlay = null, secondsEl = null, ticker = null, startedAt = 0;

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  }

  function showWake() {
    wakeTimer = null;
    if (overlay || !pending) return;
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
    startedAt = Date.now();
    ticker = setInterval(function () {
      secondsEl.textContent = Math.floor((Date.now() - startedAt) / 1000);
    }, 500);
  }

  function hideWake() {
    clearTimeout(wakeTimer);
    wakeTimer = null;
    clearInterval(ticker);
    if (overlay) overlay.remove();
    overlay = secondsEl = ticker = null;
  }

  // The overlay appears only if a request is still running after WAKE_AFTER_MS.
  function track(promise) {
    pending++;
    if (!wakeTimer && !overlay) wakeTimer = setTimeout(showWake, WAKE_AFTER_MS);
    function done() {
      pending--;
      if (pending === 0) hideWake();
    }
    promise.then(done, done);
    return promise;
  }

  // ---- requests -----------------------------------------------------------
  // Resolves to { status, data }. Rejects with Error('timeout' | 'network').
  function request(method, path, body) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    var opts = { method: method, credentials: 'same-origin', signal: ctrl.signal, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var req = fetch(path, opts)
      .then(function (r) {
        return r.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
          return { status: r.status, data: data };
        });
      })
      .catch(function (e) {
        throw new Error(e && e.name === 'AbortError' ? 'timeout' : 'network');
      })
      .then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
    return track(req);
  }

  window.Fatty = {
    apiJson: function (path) { return request('GET', path); },
    login: function (email, password) { return request('POST', '/api/auth/login', { email: email, password: password }); },
    logout: function () { return request('POST', '/api/auth/logout', {}); }
  };
})();
