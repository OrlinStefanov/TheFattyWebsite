// Asks first-time visitors to accept the Terms of Service. The choice is kept in a plain first-party cookie
// (no localStorage). Bump TERMS_VERSION when terms.html changes materially to ask everyone again.
(function () {
  var TERMS_VERSION = '2026-10-21';
  var COOKIE = 'fatty_terms';

  function accepted() {
    return document.cookie.split('; ').indexOf(COOKIE + '=' + TERMS_VERSION) !== -1;
  }
  function remember() {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = COOKIE + '=' + TERMS_VERSION + '; Max-Age=31536000; Path=/; SameSite=Lax' + secure;
  }

  if (accepted()) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  var overlay = el('div', 'consent');
  var box = el('div', 'consent-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'consent-title');
  box.tabIndex = -1;

  var title = el('h2', 'consent-title', 'Before you continue');
  title.id = 'consent-title';
  var text = el('p', 'consent-text',
    'The Fatty is a free game. By using this site you agree to our Terms of Service and Privacy notice, ' +
    'and you accept that the APK is installed at your own risk.');
  var link = el('a', null, 'Read the terms');
  link.href = 'terms.html';
  link.target = '_blank';
  link.rel = 'noopener';
  var linkP = el('p', 'consent-text');
  linkP.appendChild(link);

  var actions = el('div', 'consent-actions');
  var yes = el('button', 'consent-btn consent-yes', 'I agree');
  yes.type = 'button';
  var no = el('button', 'consent-btn consent-no', 'I do not agree');
  no.type = 'button';
  actions.appendChild(yes);
  actions.appendChild(no);

  var declined = el('p', 'consent-declined',
    'You need to accept the terms to use this site. You can read them first, or change your mind below.');
  declined.hidden = true;
  declined.setAttribute('role', 'status');

  box.appendChild(title);
  box.appendChild(text);
  box.appendChild(linkP);
  box.appendChild(declined);
  box.appendChild(actions);
  overlay.appendChild(box);

  // Keep keyboard and screen-reader users inside the dialog while it is open.
  var others = [];
  Array.prototype.forEach.call(document.body.children, function (n) {
    if (n.tagName !== 'SCRIPT') { n.inert = true; others.push(n); }
  });
  document.body.appendChild(overlay);
  document.documentElement.style.overflow = 'hidden';
  yes.focus();

  yes.addEventListener('click', function () {
    remember();
    others.forEach(function (n) { n.inert = false; });
    overlay.remove();
    document.documentElement.style.overflow = '';
  });

  no.addEventListener('click', function () {
    declined.hidden = false;
    title.textContent = 'You can’t continue without agreeing';
    no.hidden = true;
    yes.focus();
  });
})();
