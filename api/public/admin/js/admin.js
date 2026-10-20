(function () {
  var $ = function (id) { return document.getElementById(id); };
  var days = 30;
  var lastData = null;

  // All text from the API goes in through textContent: referrers come from visitors.
  function text(el, value) { el.textContent = value == null ? '' : String(value); return el; }
  function cell(tr, value) { text(tr.appendChild(document.createElement('td')), value); }
  function fmt(n) { return Number(n).toLocaleString(); }
  function shortDay(s) {
    var d = new Date(s + 'T00:00:00Z');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function show(which) {
    ['denied', 'error', 'dash'].forEach(function (id) { $(id).hidden = id !== which; });
  }

  function toLogin() { location.replace('login.html'); }

  // ---- summary tiles, rankings, tables ---------------------------------------
  function renderTiles(d) {
    text($('t-total'), fmt(d.total));
    text($('t-visitors'), fmt(d.visitor_days));
    var peak = d.by_day.reduce(function (a, b) { return b.downloads > a.downloads ? b : a; }, { downloads: 0 });
    text($('t-peak'), peak.downloads > 0 ? fmt(peak.downloads) + ' · ' + shortDay(peak.day) : '–');
    text($('t-country'), d.by_country.length ? d.by_country[0].label : '–');
  }

  function renderRank(id, items) {
    var ul = $(id);
    ul.textContent = '';
    if (!items.length) {
      text(ul.appendChild(document.createElement('li')), 'No data yet.').className = 'empty';
      return;
    }
    var max = items[0].downloads || 1;
    items.forEach(function (it) {
      var li = document.createElement('li');
      text(li.appendChild(document.createElement('span')), it.label).className = 'rank-label';
      var track = li.appendChild(document.createElement('span'));
      track.className = 'rank-track';
      var fill = track.appendChild(document.createElement('span'));
      fill.className = 'rank-fill';
      fill.style.width = Math.max(2, (it.downloads / max) * 100) + '%';
      text(li.appendChild(document.createElement('span')), fmt(it.downloads)).className = 'rank-value';
      ul.appendChild(li);
    });
  }

  function renderTables(d) {
    var tb = $('day-table').tBodies[0];
    tb.textContent = '';
    d.by_day.slice().reverse().forEach(function (r) {
      var tr = tb.insertRow();
      cell(tr, r.day); cell(tr, fmt(r.downloads)); cell(tr, fmt(r.visitors));
    });
    var rb = $('recent').tBodies[0];
    rb.textContent = '';
    if (!d.recent.length) {
      var tr0 = rb.insertRow();
      var td = tr0.insertCell();
      td.colSpan = 6;
      text(td, 'No downloads recorded in this period.');
    }
    d.recent.forEach(function (r) {
      var tr = rb.insertRow();
      cell(tr, new Date(r.ts).toLocaleString());
      cell(tr, r.version); cell(tr, r.country || 'Unknown'); cell(tr, r.device || 'other');
      cell(tr, r.browser || 'other'); cell(tr, r.referrer || 'Direct');
    });
  }

  // ---- column chart (SVG, drawn at the real width so text stays readable) ------
  var SVG = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var e = document.createElementNS(SVG, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function niceStep(raw) {
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var opts = [1, 2, 5, 10];
    for (var i = 0; i < opts.length; i++) if (opts[i] * mag >= raw) return opts[i] * mag;
    return 10 * mag;
  }
  function roundedTop(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function renderChart(d) {
    var host = $('chart');
    host.textContent = '';
    var rows = d.by_day;
    if (!d.total) {
      text(host.appendChild(document.createElement('p')), 'No downloads in this period yet.').className = 'empty';
      return;
    }
    var W = Math.max(300, host.clientWidth), H = 240;
    var m = { t: 10, r: 8, b: 26, l: 40 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var maxV = rows.reduce(function (a, r) { return Math.max(a, r.downloads); }, 0);
    var step = niceStep(Math.max(1, maxV) / 4), top = step * 4;
    var slot = iw / rows.length, bw = Math.min(24, slot * 0.7);
    var y = function (v) { return m.t + ih - (v / top) * ih; };

    var svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, tabindex: '0', role: 'img',
      'aria-label': 'Downloads per day. Use the left and right arrow keys to read each day.' });

    for (var t = 0; t <= 4; t++) {
      var gy = y(t * step);
      svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: gy, y2: gy, class: 'grid' }));
      var lab = svgEl('text', { x: m.l - 8, y: gy + 4, class: 'axis', 'text-anchor': 'end' });
      lab.textContent = fmt(t * step);
      svg.appendChild(lab);
    }
    var every = Math.ceil(rows.length / Math.max(2, Math.floor(iw / 70)));
    rows.forEach(function (r, i) {
      if (i % every) return;
      var lx = svgEl('text', { x: m.l + slot * (i + 0.5), y: H - 6, class: 'axis', 'text-anchor': 'middle' });
      lx.textContent = shortDay(r.day);
      svg.appendChild(lx);
    });

    var bars = [];
    rows.forEach(function (r, i) {
      var h = (r.downloads / top) * ih;
      var x = m.l + slot * i + (slot - bw) / 2;
      var bar = svgEl('path', { d: h > 0 ? roundedTop(x, y(r.downloads), bw, h, 4) : '', class: 'bar' });
      svg.appendChild(bar);
      bars.push(bar);
    });

    var tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    var active = -1;
    function setActive(i) {
      if (active >= 0) bars[active].classList.remove('on');
      active = i;
      if (i < 0) { tip.hidden = true; return; }
      bars[i].classList.add('on');
      var r = rows[i];
      tip.textContent = '';
      text(tip.appendChild(document.createElement('strong')), fmt(r.downloads) + (r.downloads === 1 ? ' download' : ' downloads'));
      text(tip.appendChild(document.createElement('span')), shortDay(r.day) + ' · ' + fmt(r.visitors) + ' visitors');
      tip.hidden = false;
      var cx = m.l + slot * (i + 0.5);
      var tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(cx - tw / 2, 0), W - tw) + 'px';
      tip.style.top = Math.max(0, y(r.downloads) - tip.offsetHeight - 8) + 'px';
    }

    // One hit area per day, as tall as the chart, so the pointer never has to land on a thin bar.
    rows.forEach(function (r, i) {
      var hit = svgEl('rect', { x: m.l + slot * i, y: m.t, width: slot, height: ih, class: 'hit' });
      hit.addEventListener('pointerenter', function () { setActive(i); });
      svg.appendChild(hit);
    });
    svg.addEventListener('pointerleave', function () { if (document.activeElement !== svg) setActive(-1); });
    svg.addEventListener('focus', function () { setActive(active < 0 ? rows.length - 1 : active); });
    svg.addEventListener('blur', function () { setActive(-1); });
    svg.addEventListener('keydown', function (e) {
      var n = active < 0 ? rows.length - 1 : active;
      if (e.key === 'ArrowLeft') n = Math.max(0, n - 1);
      else if (e.key === 'ArrowRight') n = Math.min(rows.length - 1, n + 1);
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = rows.length - 1;
      else return;
      e.preventDefault();
      setActive(n);
    });

    host.appendChild(svg);
    host.appendChild(tip);
  }

  function render(d) {
    lastData = d;
    renderTiles(d);
    renderChart(d);
    renderRank('r-version', d.by_version);
    renderRank('r-country', d.by_country);
    renderRank('r-device', d.by_device);
    renderRank('r-browser', d.by_browser);
    renderRank('r-referrer', d.by_referrer);
    renderTables(d);
  }

  // ---- loading ---------------------------------------------------------------
  function load() {
    var content = $('content');
    content.classList.add('loading'); // keep the frame, dim the old numbers while refetching
    content.setAttribute('aria-busy', 'true');
    return Fatty.apiJson('/api/admin/analytics/downloads?days=' + days).then(function (res) {
      if (res.status === 401) return toLogin();
      if (res.status === 403) return show('denied');
      if (res.status !== 200) throw new Error('server');
      show('dash');
      render(res.data);
    }).catch(function (err) {
      if (lastData) { show('dash'); }
      else {
        text($('error-msg'), err.message === 'timeout'
          ? 'The server took too long to answer. Try again in a moment.'
          : 'Could not reach the server. Check your connection and try again.');
        show('error');
      }
    }).then(function () {
      content.classList.remove('loading');
      content.removeAttribute('aria-busy');
    });
  }

  function start() {
    Fatty.apiJson('/api/me').then(function (res) {
      if (res.status === 401) return toLogin();
      if (res.status !== 200) throw new Error('server');
      text($('who'), res.data.email || '');
      $('who').hidden = false;
      $('signout').hidden = false;
      if (res.data.role !== 'admin') return show('denied');
      return load();
    }).catch(function () {
      text($('error-msg'), 'Could not reach the server. Check your connection and try again.');
      show('error');
    });
  }

  $('signout').addEventListener('click', function () { Fatty.logout().then(toLogin, toLogin); });
  $('retry').addEventListener('click', start);
  document.querySelector('.seg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-days]');
    if (!b) return;
    days = Number(b.dataset.days);
    document.querySelectorAll('.seg button').forEach(function (x) {
      x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    });
    load();
  });
  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (lastData && !$('dash').hidden) renderChart(lastData); }, 150);
  });

  start();
})();
