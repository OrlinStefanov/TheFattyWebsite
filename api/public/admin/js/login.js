(function () {
  var form = document.getElementById('login-form');
  var errorEl = document.getElementById('login-error');
  var submit = document.getElementById('login-submit');

  function fail(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  // Already signed in? Go straight to the dashboard.
  Fatty.apiJson('/api/me').then(function (res) {
    if (res.status === 200) location.replace('./');
  }, function () {});

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    submit.disabled = true;
    Fatty.login(form.email.value.trim(), form.password.value).then(function (res) {
      if (res.status === 204) return location.replace('./');
      fail(res.status === 401 ? 'Wrong email or password.'
        : res.status === 429 ? 'Too many attempts. Wait a minute and try again.'
        : res.status === 400 ? 'Enter a valid email and your password.'
        : 'Sign-in is unavailable right now. Try again in a moment.');
      submit.disabled = false;
      form.password.value = '';
      form.password.focus();
    }, function () {
      fail('Could not reach the server. Check your connection.');
      submit.disabled = false;
    });
  });
})();
