/* auth screen: email/password + Google */
'use strict';

// Windows app: built and published as a GitHub release; the link only shows once it exists
const PC_DOWNLOAD = 'https://github.com/lumiwebcom/lumi/releases/latest/download/lumi-windows.zip';
let pcRelease;
async function showPcDownload() {
  if (window.lumiDesktop) return; // already in the app
  if (pcRelease === undefined) {
    try {
      const r = await fetch('https://api.github.com/repos/lumiwebcom/lumi/releases/latest', { credentials: 'omit' });
      const rel = r.ok ? await r.json() : null;
      pcRelease = rel && (rel.assets || []).find((a) => a.name === 'lumi-windows.zip') || null;
    } catch { pcRelease = null; }
  }
  const el = $('#pc-dl'); if (!el || !pcRelease) return;
  el.hidden = false;
  $('#pc-dl-meta').textContent = `Windows app · ${Math.round(pcRelease.size / 1048576)} MB · updates itself`;
}
function renderAuth(mode = 'login') {
  const root = $('#root');
  const signup = mode === 'signup';
  root.innerHTML = `
  <div class="auth">
    <section class="auth-panel">
      <div class="auth-card">
        ${wordmark()}
        <h2>${signup ? 'Create your account' : 'Welcome back'}</h2>
        <p class="muted" style="margin:-4px 0 22px">${signup ? 'It’s free and takes a minute.' : 'Good to see you again.'}</p>
        <div class="gbtn" id="gbtn"></div><div class="or" id="gor">or</div>
        <form id="auth-form" autocomplete="on">
          ${signup ? `
            <input class="input" name="email" type="email" placeholder="Email" autocomplete="email" required>
            <input class="input" name="displayName" placeholder="Your name" autocomplete="name">
            <input class="input" name="username" placeholder="Username" autocomplete="username" required pattern="[A-Za-z0-9_.]{2,24}">
            <input class="input" name="password" type="password" placeholder="Password (8+ characters)" autocomplete="new-password" required minlength="8">
          ` : `
            <input class="input" name="login" placeholder="Username or email" autocomplete="username" required>
            <input class="input" name="password" type="password" placeholder="Password" autocomplete="current-password" required>
          `}
          <button class="btn primary lg block" type="submit">${signup ? 'Create account' : 'Log in'}</button>
          <div class="err" id="auth-err" style="margin-top:12px"></div>
        </form>
        ${signup ? '' : '<div class="auth-forgot"><button type="button" data-forgot>Forgot password?</button></div>'}
        <div class="auth-switch">${signup ? 'Already have an account? <button data-mode="login">Log in</button>' : 'New to lumi? <button data-mode="signup">Create an account</button>'}</div>
      </div>
      <a class="pc-dl" id="pc-dl" hidden href="${PC_DOWNLOAD}" rel="noopener">
        <svg viewBox="0 0 24 24" class="i sm"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
        <span><b>Download lumi for PC</b><small id="pc-dl-meta">Windows app</small></span>
        <svg viewBox="0 0 24 24" class="i sm"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>
      </a>
    </section>
  </div>`;
  root.querySelector('[data-mode]').onclick = (e) => renderAuth(e.target.dataset.mode);
  root.querySelector('[data-forgot]')?.addEventListener('click', () => renderForgot());
  showPcDownload();
  const form = $('#auth-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; $('#auth-err').textContent = '';
    try {
      const data = Object.fromEntries(new FormData(form));
      const r = await api('POST', signup ? '/api/auth/signup' : '/api/auth/login', data);
      onSignedIn(r.user);
    } catch (err) { if ($('#auth-err')) $('#auth-err').textContent = err.message; btn.disabled = false; }
  };
  setupGoogle();
}

function setupGoogle() {
  const slot = $('#gbtn');
  if (!slot) return;
  if (!S.config.googleClientId && !S.config.canSetup) { slot.remove(); $('#gor')?.remove(); return; }
  if (!S.config.googleClientId) {
    // Not configured on server: show a disabled hint button so the feature is discoverable.
    slot.innerHTML = `<button class="btn block" type="button" style="background:var(--bg);border:1px solid var(--border);height:40px">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Continue with Google</button>`;
    slot.querySelector('button').onclick = () => S.config.canSetup ? openGoogleSetup() : toast('Google sign-in isn’t turned on for this Lumi yet.', true);
    return;
  }
  const go = () => {
    google.accounts.id.initialize({
      client_id: S.config.googleClientId,
      callback: async (resp) => {
        try { const r = await api('POST', '/api/auth/google', { credential: resp.credential }); onSignedIn(r.user); }
        catch (e) { if ($('#auth-err')) $('#auth-err').textContent = e.message; }
      },
    });
    google.accounts.id.renderButton(slot, { theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline', size: 'large', width: 268, text: 'continue_with', shape: 'rectangular' });
  };
  if (window.google?.accounts?.id) return go();
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = go;
  document.head.appendChild(s);
}

function openGoogleSetup() {
  const origin = location.origin;
  const m = openModal({ title: 'Turn on Google sign-in', body: `
    <p style="margin:0 0 12px;line-height:1.5">Google needs a free <b>Client ID</b> for your Lumi. It takes about 5 minutes, one time only:</p>
    <ol style="margin:0 0 16px;padding-left:20px;line-height:1.7">
      <li>Open <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener">Google Cloud → Clients</a> and sign in. Create a project if it asks (name it <b>Lumi</b>).</li>
      <li>If it asks you to set up the app first, click <b>Get started</b>: app name <b>Lumi</b>, your email, audience <b>External</b>, then finish.</li>
      <li>Click <b>Create client</b> → type <b>Web application</b>.</li>
      <li>Under <b>Authorized JavaScript origins</b>, add both:<br><code style="user-select:all">http://localhost</code> and <code style="user-select:all">${esc(origin)}</code></li>
      <li>Click <b>Create</b>, copy the <b>Client ID</b>, and paste it below.</li>
    </ol>
    <div class="field"><label>Client ID</label><input class="input" id="gid" placeholder="1234-abc.apps.googleusercontent.com" autofocus></div>
    <div class="err" id="gerr" style="text-align:left"></div>`,
    foot: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>Turn on</button>` });
  m.el.querySelector('[data-no]').onclick = () => m.close();
  m.el.querySelector('[data-ok]').onclick = async () => {
    try {
      await api('POST', '/api/setup/google', { clientId: m.el.querySelector('#gid').value });
      S.config = await api('GET', '/api/config');
      m.close(); toast('Google sign-in is on');
      const mode = $('[data-mode]')?.dataset.mode === 'login' ? 'signup' : 'login';
      renderAuth(mode);
    } catch (e) { m.el.querySelector('#gerr').textContent = e.message; }
  };
}

// ---- forgot password: ask for email, server emails a one-time reset link
function renderForgot() {
  const root = $('#root');
  root.innerHTML = `
  <div class="auth"><section class="auth-panel"><div class="auth-card">
    ${wordmark()}
    <h2>Reset your password</h2>
    <p class="muted" style="margin:-4px 0 22px">Enter your email and we'll send a link to set a new password.</p>
    <form id="forgot-form">
      <input class="input" name="email" type="email" placeholder="Email" autocomplete="email" required autofocus>
      <button class="btn primary lg block" type="submit">Send reset link</button>
      <div class="err" id="auth-err" style="margin-top:12px"></div>
    </form>
    <div class="auth-switch"><button type="button" data-back>Back to log in</button></div>
  </div></section></div>`;
  root.querySelector('[data-back]').onclick = () => renderAuth('login');
  const form = $('#forgot-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = form.email.value;
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; $('#auth-err').textContent = '';
    try {
      await api('POST', '/api/auth/forgot', { email });
      root.querySelector('.auth-card').innerHTML = `${wordmark()}
        <h2>Check your email</h2>
        <p class="muted" style="line-height:1.55">If an account uses <b>${esc(email)}</b>, a reset link is on its way. It expires in an hour.</p>
        <p class="muted" style="font-size:13px">Can't find it? Check your spam folder, or <button type="button" class="linklike" data-again>try again</button>.</p>
        <div class="auth-switch"><button type="button" data-back>Back to log in</button></div>`;
      root.querySelector('[data-back]').onclick = () => renderAuth('login');
      root.querySelector('[data-again]').onclick = () => renderForgot();
    } catch (err) { if ($('#auth-err')) $('#auth-err').textContent = err.message; btn.disabled = false; }
  };
}

// ---- reset page: /reset?token=... , set a new password
function renderReset() {
  const token = new URLSearchParams(location.search).get('token') || '';
  const root = $('#root');
  root.innerHTML = `
  <div class="auth"><section class="auth-panel"><div class="auth-card">
    ${wordmark()}
    <h2>Set a new password</h2>
    <p class="muted" style="margin:-4px 0 22px">Pick a new password for your lumi account.</p>
    <form id="reset-form">
      <input class="input" name="password" type="password" placeholder="New password (8+ characters)" autocomplete="new-password" required minlength="8" autofocus>
      <input class="input" name="confirm" type="password" placeholder="Confirm new password" autocomplete="new-password" required minlength="8">
      <button class="btn primary lg block" type="submit">Change password</button>
      <div class="err" id="auth-err" style="margin-top:12px"></div>
    </form>
  </div></section></div>`;
  const form = $('#reset-form');
  if (!token) $('#auth-err').textContent = 'This reset link is missing its code. Request a new one from the log in page.';
  form.onsubmit = async (e) => {
    e.preventDefault();
    $('#auth-err').textContent = '';
    if (form.password.value !== form.confirm.value) { $('#auth-err').textContent = "The passwords don't match."; return; }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await api('POST', '/api/auth/reset', { token, password: form.password.value });
      history.replaceState({}, '', '/');
      root.querySelector('.auth-card').innerHTML = `${wordmark()}
        <h2>Password changed ✓</h2>
        <p class="muted" style="margin-bottom:18px">You're all set. Log in with your new password.</p>
        <button class="btn primary lg block" type="button" data-login>Log in</button>`;
      root.querySelector('[data-login]').onclick = () => renderAuth('login');
    } catch (err) { if ($('#auth-err')) $('#auth-err').textContent = err.message; btn.disabled = false; }
  };
}
