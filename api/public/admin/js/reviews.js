(function () {
  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 50;
  var status = 'all';
  var shown = 0;

  // Review text comes from the public: it is only ever inserted with textContent.
  function cell(tr, v, cls) {
    var td = tr.insertCell();
    if (cls) td.className = cls;
    td.textContent = v == null ? '' : String(v);
    return td;
  }
  function say(m) { $('msg').textContent = m || ''; $('msg').hidden = !m; }
  function toLogin() { location.replace('/admin/login.html'); }

  function button(label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function act(promise) {
    return promise.then(function (res) {
      if (res.status === 401) return toLogin();
      if (res.status !== 204) { say('That did not work (' + res.status + '). Reload and try again.'); return; }
      say('');
      return load(true);
    }, function () { say('Could not reach the server.'); });
  }

  function row(r) {
    var tr = document.createElement('tr');
    cell(tr, new Date(r.createdAt).toLocaleDateString());
    cell(tr, r.username || 'Player');
    cell(tr, '★'.repeat(r.rating) + ' ' + r.rating);
    var body = cell(tr, r.body);
    body.style.whiteSpace = 'pre-wrap';
    body.style.minWidth = '220px';
    body.style.maxWidth = '420px';
    body.style.overflowWrap = 'anywhere';
    cell(tr, r.status, r.status === 'hidden' ? 'status-hidden' : '');
    var actions = tr.insertCell();
    var wrap = actions.appendChild(document.createElement('div'));
    wrap.className = 'mod-actions';
    var next = r.status === 'visible' ? 'hidden' : 'visible';
    wrap.appendChild(button(next === 'hidden' ? 'Hide' : 'Unhide', function () {
      act(Fatty.send('PATCH', '/api/admin/reviews/' + r.id, { status: next }));
    }));
    var del = button('Delete', function () {
      // Two clicks: the first arms the button.
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Click again to delete'; return; }
      act(Fatty.send('DELETE', '/api/admin/reviews/' + r.id));
    });
    wrap.appendChild(del);
    return tr;
  }

  function load(reset) {
    if (reset) { shown = 0; $('table').tBodies[0].textContent = ''; }
    return Fatty.apiJson('/api/admin/reviews?status=' + status + '&limit=' + PAGE + '&offset=' + shown).then(function (res) {
      if (res.status === 401) return toLogin();
      if (res.status === 403) { $('dash').hidden = true; $('denied').hidden = false; return; }
      if (res.status !== 200) throw new Error('server');
      $('dash').hidden = false;
      var tb = $('table').tBodies[0];
      res.data.items.forEach(function (r) { tb.appendChild(row(r)); });
      shown += res.data.items.length;
      $('empty').hidden = res.data.total > 0;
      $('more').hidden = shown >= res.data.total;
    }).catch(function () { say('Could not load the reviews. Reload the page.'); });
  }

  $('more').addEventListener('click', function () { load(false); });
  $('signout').addEventListener('click', function () { Fatty.logout().then(toLogin, toLogin); });
  document.querySelector('.seg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-status]');
    if (!b) return;
    status = b.dataset.status;
    document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    load(true);
  });

  load(true);
})();
