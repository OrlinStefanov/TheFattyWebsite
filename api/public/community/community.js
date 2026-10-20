(function () {
  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 10;
  var me = null;
  var shown = 0;

  // Everything that comes from the API (reviews are written by strangers) goes in via textContent.
  function text(el, v) { el.textContent = v == null ? '' : String(v); return el; }
  function el(tag, cls, v) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (v != null) e.textContent = v;
    return e;
  }
  function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function fmtDate(iso) { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  function say(node, msg) { text(node, msg); node.hidden = !msg; }

  // ---- summary ---------------------------------------------------------------------
  function renderSummary(s) {
    text($('avg'), s.count ? s.average.toFixed(1) : '–');
    text($('avg-stars'), s.count ? stars(Math.round(s.average)) : '');
    text($('count'), s.count ? s.count + (s.count === 1 ? ' review' : ' reviews') : 'No reviews yet');
    var ul = $('dist');
    ul.textContent = '';
    [5, 4, 3, 2, 1].forEach(function (n) {
      var c = s.distribution[String(n)] || 0;
      var li = ul.appendChild(el('li'));
      li.appendChild(el('span', 'dist-label', n + ' ★'));
      var track = li.appendChild(el('span', 'rank-track'));
      var fill = track.appendChild(el('span', 'rank-fill'));
      fill.style.width = (s.count ? Math.max(c ? 2 : 0, (c / s.count) * 100) : 0) + '%';
      li.appendChild(el('span', 'rank-value', c));
    });
  }

  // ---- review list -----------------------------------------------------------------
  function reviewCard(r) {
    var li = el('li', 'review');
    var head = li.appendChild(el('div', 'review-head'));
    head.appendChild(el('strong', 'review-name', r.username || 'Player'));
    var st = head.appendChild(el('span', 'stars', stars(r.rating)));
    st.setAttribute('aria-label', r.rating + ' out of 5');
    var when = fmtDate(r.createdAt) + (r.updatedAt !== r.createdAt ? ' (edited)' : '');
    head.appendChild(el('span', 'muted', when));
    li.appendChild(el('p', 'review-body', r.body));
    return li;
  }

  function loadReviews(reset, fresh) {
    if (reset) { shown = 0; $('reviews').textContent = ''; }
    return Fatty.apiJson('/api/reviews?limit=' + PAGE + '&offset=' + shown, fresh).then(function (res) {
      if (res.status !== 200) throw new Error('server');
      res.data.items.forEach(function (r) { $('reviews').appendChild(reviewCard(r)); });
      shown += res.data.items.length;
      $('reviews-empty').hidden = res.data.total > 0;
      $('more').hidden = shown >= res.data.total;
    });
  }

  // ---- signed-in panels --------------------------------------------------------------
  function showOwnReview(r) {
    var form = $('review-form');
    if (r) {
      var radio = form.querySelector('input[name="rating"][value="' + r.rating + '"]');
      if (radio) radio.checked = true;
      form.body.value = r.body;
      $('review-save').textContent = 'Save changes';
      $('review-delete').hidden = false;
      $('hidden-note').hidden = r.status !== 'hidden';
    } else {
      $('review-save').textContent = 'Post review';
      $('review-delete').hidden = true;
      $('hidden-note').hidden = true;
    }
    text($('chars'), form.body.value.length);
  }

  function showPanels() {
    var signedIn = !!me;
    $('signin').hidden = signedIn;
    $('username-panel').hidden = !(signedIn && !me.username);
    $('review-panel').hidden = !(signedIn && me.username);
    $('account').hidden = !signedIn;
    $('who').hidden = $('signout').hidden = !signedIn;
    $('admin-link').hidden = !(signedIn && me.role === 'admin');
    if (signedIn) text($('who'), me.username || me.email || '');
    if (signedIn && me.username) {
      Fatty.apiJson('/api/reviews/me').then(function (res) {
        if (res.status === 200) showOwnReview(res.data.review);
      }).catch(function () {});
    }
  }

  function refreshAll(fresh) {
    return Promise.all([
      Fatty.apiJson('/api/reviews/summary', fresh).then(function (r) { if (r.status === 200) renderSummary(r.data); }),
      loadReviews(true, fresh)
    ]);
  }

  // ---- forms -------------------------------------------------------------------------
  $('username-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('username-msg');
    say(msg, '');
    Fatty.send('PATCH', '/api/profile', { username: this.username.value.trim() }).then(function (res) {
      if (res.status === 200) { me.username = res.data.username; showPanels(); return; }
      say(msg, res.status === 409 ? 'That name is taken. Try another.'
        : res.status === 400 ? 'Use 3 to 30 letters, digits or underscores. Names that look like staff are not allowed.'
        : res.status === 429 ? 'Too many tries. Wait a minute.'
        : res.status === 401 ? 'Your session ended. Reload and sign in again.'
        : 'Something went wrong. Try again.');
    }, function () { say(msg, 'Could not reach the server. Check your connection.'); });
  });

  $('review-form').addEventListener('input', function () { text($('chars'), this.body.value.length); });

  $('review-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('review-msg');
    say(msg, '');
    var checked = this.querySelector('input[name="rating"]:checked');
    if (!checked) return say(msg, 'Pick a rating from 1 to 5 stars.');
    var body = this.body.value;
    if (!body.trim()) return say(msg, 'Write a few words about the game.');
    var save = $('review-save');
    save.disabled = true;
    Fatty.send('PUT', '/api/reviews/me', { rating: Number(checked.value), body: body }).then(function (res) {
      save.disabled = false;
      if (res.status === 200) { showOwnReview(res.data.review); say(msg, ''); return refreshAll(true); }
      var code = res.data && res.data.error;
      if (code === 'username_required') { me.username = null; return showPanels(); }
      say(msg, code === 'email_not_verified' ? 'Your sign-in provider has not verified your email, so you cannot post yet.'
        : res.status === 400 ? 'Check your rating and keep the text between 1 and 1000 characters.'
        : res.status === 429 ? 'Slow down a little and try again in a minute.'
        : res.status === 401 ? 'Your session ended. Reload and sign in again.'
        : 'Something went wrong. Try again.');
    }, function () { save.disabled = false; say(msg, 'Could not reach the server. Check your connection.'); });
  });

  $('review-delete').addEventListener('click', function () {
    Fatty.send('DELETE', '/api/reviews/me').then(function (res) {
      if (res.status === 204) {
        $('review-form').reset();
        showOwnReview(null);
        return refreshAll(true);
      }
      say($('review-msg'), res.status === 409
        ? 'A moderator hid this review, so it cannot be deleted. You can still edit it.'
        : 'Could not delete your review. Try again.');
    });
  });

  $('more').addEventListener('click', function () { loadReviews(false); });
  $('signout').addEventListener('click', function () { Fatty.logout().then(function () { location.reload(); }, function () { location.reload(); }); });

  $('delete-open').addEventListener('click', function () { $('delete-confirm').hidden = false; $('delete-open').hidden = true; });
  $('delete-no').addEventListener('click', function () { $('delete-confirm').hidden = true; $('delete-open').hidden = false; });
  $('delete-yes').addEventListener('click', function () {
    Fatty.send('DELETE', '/api/me').then(function (res) {
      if (res.status === 204) return location.reload();
      say($('banner'), res.status === 403 ? 'Admin accounts cannot be deleted here.' : 'Could not delete the account. Try again.');
      $('delete-confirm').hidden = true;
      $('delete-open').hidden = false;
    });
  });

  // ---- start -------------------------------------------------------------------------
  if (/[?&]error=login/.test(location.search)) {
    say($('banner'), 'Sign-in did not work. Please try again.');
    history.replaceState(null, '', location.pathname);
  }

  Fatty.apiJson('/api/me').then(function (res) {
    me = res.status === 200 ? res.data : null;
    showPanels();
  }, function () { showPanels(); });

  refreshAll().catch(function () {
    say($('banner'), 'Could not load the reviews. Check your connection and reload.');
  });
})();
