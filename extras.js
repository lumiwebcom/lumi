/* extras: friend nicknames, daily tasks & badges, Sparks, name fonts & themes, device manager */
'use strict';

// ------------------------------------------------------------------ friend nicknames (only you see them)
S.nicks = {};
async function loadNicknames() { try { S.nicks = (await api('GET', '/api/nicknames')).nicknames || {}; } catch {} }
const nameOf = (u) => (u && (S.nicks[u.id] || S.userCache[u.id]?.displayName || u.displayName || u.username)) || 'Unknown';
async function setNickname(uid) {
  const u = S.userCache[uid] || {};
  const v = await promptDialog(`Nickname for ${u.displayName || 'your friend'}`, 'Only you can see this. Leave blank to remove it.', S.nicks[uid] || '');
  if (v === null) return;
  try { const r = await api('PUT', `/api/nicknames/${uid}`, { nickname: v }); applyNickname(uid, r.nickname); toast(r.nickname ? `You’ll see them as ${r.nickname}` : 'Nickname removed'); }
  catch (e) { toast(e.message, true); }
}
function applyNickname(uid, nick) {
  if (nick) S.nicks[uid] = nick; else delete S.nicks[uid];
  renderSideBody(); renderMain();
}

// ------------------------------------------------------------------ Sparks: name fonts, gold nameplate, themes
const NAME_FONTS = {
  grotesk: ['Grotesk', '"Space Grotesk"', 'Space+Grotesk:wght@500;700'],
  serif: ['Serif', '"Fraunces"', 'Fraunces:opsz,wght@9..144,600'],
  mono: ['Mono', '"JetBrains Mono"', 'JetBrains+Mono:wght@600'],
  hand: ['Handwritten', '"Caveat"', 'Caveat:wght@600;700'],
  pixel: ['Pixel', '"Pixelify Sans"', 'Pixelify+Sans:wght@500'],
  round: ['Rounded', '"Nunito"', 'Nunito:wght@700;800'],
  slab: ['Slab', '"Roboto Slab"', 'Roboto+Slab:wght@600'],
};
const loadedFonts = new Set();
function ensureFont(key) {
  const f = NAME_FONTS[key]; if (!f || loadedFonts.has(key)) return;
  loadedFonts.add(key);
  document.head.appendChild(h(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f[2]}&display=swap">`));
}
const fontFamily = (key) => (NAME_FONTS[key] ? `${NAME_FONTS[key][1]}, var(--font)` : '');
// attributes for a person's name: their Sparks font, and the gold plate class
function nameAttrs(u, extra = '') {
  const x = (u && S.userCache[u.id]) || u || {};
  if (x.nameFont) ensureFont(x.nameFont);
  const style = [x.nameFont ? `font-family:${fontFamily(x.nameFont)}` : '', extra].filter(Boolean).join(';');
  return `class="nm-text ${x.sparks ? 'gold' : ''}" ${style ? `style="${style}"` : ''}`;
}
const sparkMark = (u) => ((u && (S.userCache[u.id] || u).sparks) ? `<span class="spark-mark" data-tip="Sparks member">${icon('gem', 'xs')}</span>` : '');

const SPARK_THEMES = {
  classic: { label: 'Classic', accent: '#743AFB', light: '#A78BFA' },
  ember: { label: 'Ember', accent: '#E8662F', light: '#F4A07A', bg: ['#0D0A09', '#17120F', '#1C1613', '#251E1A', '#30271F', '#2E2520', '#211A16'] },
  forest: { label: 'Forest', accent: '#2F9E62', light: '#7CCFA0', bg: ['#090D0B', '#111713', '#151C17', '#1C251F', '#253029', '#24302A', '#19211C'] },
  ocean: { label: 'Ocean', accent: '#2C83E6', light: '#86B9F3', bg: ['#080B10', '#10151C', '#141A23', '#1B232E', '#242E3B', '#243040', '#18202B'] },
  rose: { label: 'Rose', accent: '#D9466F', light: '#EF97B0', bg: ['#0E090B', '#181013', '#1E1418', '#281B20', '#33232A', '#33232A', '#22171B'] },
  gold: { label: 'Gold', accent: '#C9931A', light: '#E8C766', bg: ['#0C0B08', '#16140F', '#1B1913', '#24211A', '#2F2B22', '#2E2A20', '#201D16'] },
  mono: { label: 'Graphite', accent: '#D4D4D8', light: '#F4F4F5', ink: '#111113', bg: ['#09090B', '#131316', '#18181B', '#212125', '#2B2B30', '#2A2A2F', '#1D1D21'] },
};
const APP_FONTS = { default: ['Default', ''], ...Object.fromEntries(Object.entries(NAME_FONTS).filter(([k]) => k !== 'pixel' && k !== 'hand').map(([k, v]) => [k, [v[0], v[1]]])) };
function mix(hex, other, t) {
  const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const a = p(hex), b = p(other);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function applySparkTheme() {
  let el = $('#spark-theme'); if (!el) { el = h('<style id="spark-theme"></style>'); document.head.appendChild(el); }
  const on = S.me?.sparks;
  const key = on ? (S.settings.sparkTheme || 'classic') : 'classic';
  let th = key === 'custom' && /^#[0-9a-f]{6}$/i.test(S.settings.sparkAccent || '') ? { accent: S.settings.sparkAccent, light: mix(S.settings.sparkAccent, '#ffffff', 0.4) } : SPARK_THEMES[key] || SPARK_THEMES.classic;
  let css = '';
  if (key !== 'classic') {
    const a = th.accent, l = th.light, ink = th.ink || '#ffffff';
    css += `:root{--lime:${a};--lime-deep:${mix(a, '#000000', 0.15)};--teal:${l};--teal-deep:${a};--blue:${a};--blue-hover:${mix(a, '#000000', 0.15)};--ig:${a};--lime-soft:${mix(a, '#ffffff', 0.85)}}
      [data-theme="dark"]{--blue:${l};--blue-hover:${mix(l, '#ffffff', 0.3)};--bubble-me:${a};--bubble-me-text:${ink === '#ffffff' ? '#fff' : ink};--primary-bg:${a};--primary-text:${ink === '#ffffff' ? '#fff' : ink};--primary-hover:${mix(a, '#ffffff', 0.12)};--lime-soft:${a}2e}`;
    if (th.bg) { const [app, bg, bg2, bg3, bg4, border, border2] = th.bg; css += `[data-theme="dark"]{--app-bg:${app};--bg:${bg};--bg2:${bg2};--bg3:${bg3};--bg4:${bg4};--border:${border};--border2:${border2}}`; }
  }
  const font = on && APP_FONTS[S.settings.appFont] && S.settings.appFont !== 'default' ? S.settings.appFont : null;
  if (font) { ensureFont(font); css += `:root{--font:${APP_FONTS[font][1]}, "Manrope", -apple-system, "Segoe UI", sans-serif}`; }
  el.textContent = css;
}

// ------------------------------------------------------------------ Sparks page
async function renderSparks(main) {
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">${icon('gem', 'sm')} Sparks</div></header><div class="content"><div class="sparks-page" id="sparks-page"><div class="muted">Loading…</div></div></div>`;
  let st; try { st = await api('GET', '/api/sparks'); } catch (e) { return toast(e.message, true); }
  const q = new URLSearchParams(location.search);
  if (q.get('checkout') === 'done') { toast('Thanks! Sparks will switch on in a moment.'); history.replaceState({}, '', '/sparks'); }
  const el = $('#sparks-page'); if (!el) return;
  const perks = [
    ['type', 'Custom fonts', 'Pick a font for your name, and one for the whole app.'],
    ['palette', 'Custom themes', 'Ember, Forest, Ocean, Rose, Gold, Graphite, or any color you like.'],
    ['compass', 'Stargaze, free', 'List your communities on Stargaze without needing 1,000 members.'],
    ['gem', 'Golden nameplate', 'Your name shows in gold, with a plate in member lists and on your profile.'],
  ];
  const status = st.free ? `<div class="sp-status on">${icon('check', 'sm')} You have Sparks free as part of the lumi team.</div>`
    : st.active ? `<div class="sp-status on">${icon('check', 'sm')} Sparks is on${st.until ? ` · ${st.subscribed ? 'renews' : 'ends'} ${new Date(st.until).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</div>` : '';
  el.innerHTML = `<section class="sp-card">
      <div class="sp-top"><div class="sp-mark">${icon('gem')}</div><div><h1>Sparks</h1><p class="muted">Extras for people who want lumi to feel like theirs.</p></div>
        <div class="sp-price"><b>${esc(st.price)}</b><span>per month</span></div></div>
      <ul class="sp-perks">${perks.map(([i, t, d]) => `<li>${icon(i, 'sm')}<div><b>${t}</b><span>${d}</span></div></li>`).join('')}</ul>
      ${status}
      <div class="sp-acts">
        ${st.free ? `<button class="btn primary" data-sp="customize">Customize your look</button>`
          : st.active ? `<button class="btn primary" data-sp="customize">Customize your look</button>${st.manageable ? '<button class="btn" data-sp="manage">Manage subscription</button>' : ''}`
          : st.canBuy ? `<button class="btn primary lg" data-sp="buy">Get Sparks · ${esc(st.price)}/month</button><span class="muted small">Cancel anytime. Payments are handled by Stripe.</span>`
          : `<button class="btn lg" disabled>Coming soon</button><span class="muted small">Checkout isn’t switched on yet.</span>`}
      </div></section>
    <section class="sp-preview"><div class="lb-h"><span>How you’ll look</span></div>
      <div class="member" style="max-width:300px">${avatar(S.me, 34, { dot: true })}<div style="min-width:0"><div class="n"><span class="nm-plate"><span class="nm-text gold" ${S.me.nameFont ? `style="font-family:${fontFamily(S.me.nameFont)}"` : ''}>${esc(S.me.displayName)}</span></span>${sparkMark({ ...S.me, sparks: true })}</div><div class="s">${esc(S.me.customStatus || 'Online')}</div></div></div></section>`;
  el.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = async () => {
    const k = b.dataset.sp;
    if (k === 'customize') return openUserSettings('appearance');
    b.disabled = true;
    try {
      const r = await api('POST', k === 'buy' ? '/api/sparks/checkout' : '/api/sparks/manage');
      if (window.lumiDesktop) window.open(r.url, '_blank'); else location.href = r.url;
    } catch (e) { toast(e.message, true); } finally { b.disabled = false; }
  }));
}

// ------------------------------------------------------------------ daily tasks + badges
S.tasks = null;
async function loadTasks() { try { S.tasks = await api('GET', '/api/tasks'); } catch {} }
const TIER_COLORS = { 1: 'bronze', 2: 'silver', 3: 'gold' };
function badgeIcon(b, size = 40) {
  return `<span class="badge-ic ${b.tier ? TIER_COLORS[b.tier] : 'locked'}" style="--s:${size}px" data-tip="${esc(b.name)}${b.tier ? ` · ${b.tierName}` : ' · locked'}">${b.emoji}</span>`;
}
function tasksCard() {
  const t = S.tasks; if (!t) return '';
  const done = t.tasks.filter((x) => x.done).length;
  const left = Math.max(0, t.resetsAt - Date.now()), hrs = Math.floor(left / 3600e3), mins = Math.floor((left % 3600e3) / 60e3);
  return `<div class="tasks-card"><div class="tk-h"><b>Today’s tasks</b><span class="muted small">${done}/${t.tasks.length} · new in ${hrs ? `${hrs}h ` : ''}${mins}m</span></div>
    ${t.tasks.map((x) => `<div class="tk ${x.done ? 'done' : ''}"><span class="em">${x.done ? icon('check', 'sm') : x.emoji}</span><div class="m"><div class="l">${esc(x.label)}</div>
      <div class="bar"><i style="width:${Math.round((x.progress / x.goal) * 100)}%"></i></div></div><span class="muted small">${x.progress}/${x.goal}</span></div>`).join('')}
    <button class="btn ghost sm block" data-act="open-badges">${icon('glow', 'xs')} Badges · ${t.badges.filter((b) => b.tier).length}/${t.badges.length}</button></div>`;
}
function openBadges() {
  const t = S.tasks; if (!t) return;
  openModal({ title: 'Badges', cls: 'badges-modal', body: `<p class="muted" style="margin:0 0 14px">Finish daily tasks to earn badges. Each one levels up from Bronze to Silver (5 times) to Gold (15 times). They show on your profile.</p>
    <div class="badge-grid">${t.badges.map((b) => `<div class="bg-item ${b.tier ? '' : 'locked'}">${badgeIcon(b, 46)}<div><b>${esc(b.name)}</b><div class="small muted">${esc(b.how)}</div>
      <div class="small">${b.tier ? `<span class="tier ${TIER_COLORS[b.tier]}">${b.tierName}</span>` : ''}${b.next ? ` <span class="muted">${b.count}/${b.next} for ${['', 'Bronze', 'Silver', 'Gold'][b.tier + 1]}</span>` : b.tier ? ' <span class="muted">maxed out</span>' : ''}</div></div></div>`).join('')}</div>` });
}
function badgesRow(badges) {
  if (!badges?.length) return '';
  return `<div class="psec"><h5>Badges — ${badges.length}</h5><div class="p-badges">${badges.map((b) => badgeIcon(b, 34)).join('')}</div></div>`;
}
function onTasksUpdate({ tasks, completed, earned }) {
  if (S.tasks) S.tasks.tasks = tasks;
  if (completed) { const x = tasks.find((k) => k.id === completed); if (x) toast(`Task done: ${x.label}`); }
  for (const b of earned || []) {
    toast(`New badge: ${b.name} (${b.tierName})`);
    if (S.tasks) { const i = S.tasks.badges.findIndex((y) => y.id === b.id); if (i >= 0) S.tasks.badges[i] = b; }
  }
  if (S.view.type === 'home') renderActiveNow();
}

// ------------------------------------------------------------------ devices
function deviceName(ua) {
  ua = ua || '';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const app = /Electron\//.test(ua) ? 'lumi app' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ua ? 'Browser' : 'Unknown device';
  const kind = /lumi app/.test(app) ? 'desk' : /iPhone|Android/.test(os) ? 'phone' : 'screen';
  return { label: os ? `${app} on ${os}` : app, kind };
}
async function usDevices(pane) {
  pane.innerHTML = '<h2>Devices</h2><div class="muted">Loading…</div>';
  let r; try { r = await api('GET', '/api/devices'); } catch (e) { pane.innerHTML = `<h2>Devices</h2><p class="muted">${esc(e.message)}</p>`; return; }
  const others = r.devices.filter((d) => !d.current);
  const row = (d) => { const n = deviceName(d.ua); return `<div class="dev ${d.current ? 'cur' : ''}"><span class="dev-ic">${icon(n.kind === 'phone' ? 'phoneDev' : 'screen', 'sm')}</span>
    <div class="meta"><div class="bold">${esc(n.label)}${d.current ? ' <span class="tag">This device</span>' : d.online ? ' <span class="tag on">Online now</span>' : ''}</div>
    <div class="small muted">${d.current ? 'Active now' : `Last active ${ago(d.lastActive) === 'now' ? 'just now' : ago(d.lastActive) + ' ago'}`} · signed in ${new Date(d.signedInAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div></div>
    ${d.current ? '' : `<button class="btn" data-out="${d.id}">Sign out</button>`}</div>`; };
  pane.innerHTML = `<h2>Devices</h2><p class="muted" style="margin:-8px 0 16px">Everywhere you’re signed in to lumi. Don’t recognize one? Sign it out, then change your password.</p>
    ${r.devices.filter((d) => d.current).map(row).join('')}
    ${others.length ? `<h4>Other devices — ${others.length}</h4>${others.map(row).join('')}
      <button class="btn danger" data-out-all style="margin-top:14px">Sign out of all other devices</button>` : '<p class="muted small" style="margin-top:14px">You’re not signed in anywhere else.</p>'}`;
  pane.querySelectorAll('[data-out]').forEach((b) => (b.onclick = async () => {
    b.disabled = true; try { await api('DELETE', `/api/devices/${b.dataset.out}`); toast('Signed out of that device'); usDevices(pane); } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  pane.querySelector('[data-out-all]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Sign out everywhere else?', `This signs you out on ${plural(others.length, 'other device')}. You’ll stay signed in here.`, 'Sign them out'))) return;
    try { const x = await api('POST', '/api/devices/sign-out-others'); toast(`Signed out of ${plural(x.count, 'device')}`); usDevices(pane); } catch (e) { toast(e.message, true); }
  });
}

// ------------------------------------------------------------------ Sparks settings (inside Appearance)
function sparksAppearance() {
  const on = S.me.sparks;
  const cur = S.settings.sparkTheme || 'classic';
  const lock = on ? '' : 'disabled';
  return `<h4 style="display:flex;align-items:center;gap:8px">${icon('gem', 'sm')} Sparks ${on ? '' : '<button class="btn link" data-act-sparks>Get Sparks to unlock</button>'}</h4>
    <div class="field"><label>Color theme</label><div class="theme-row ${on ? '' : 'locked'}">
      ${Object.entries(SPARK_THEMES).map(([k, t]) => `<button class="theme-sw ${cur === k ? 'sel' : ''}" data-sth="${k}" ${lock} style="--a:${t.accent};--b:${(t.bg || ['#0A090D', '#141218'])[1]}"><i></i><span>${t.label}</span></button>`).join('')}
      <label class="theme-sw custom ${cur === 'custom' ? 'sel' : ''}" style="--a:${esc(S.settings.sparkAccent || '#743AFB')};--b:#141218"><input type="color" id="sth-custom" value="${esc(S.settings.sparkAccent || '#743AFB')}" ${lock}><i></i><span>Custom</span></label></div></div>
    <div class="field"><label>Name font</label><div class="font-row">
      <button class="font-sw ${!S.me.nameFont ? 'sel' : ''}" data-nfont="" ${lock}>Default</button>
      ${Object.entries(NAME_FONTS).map(([k, f]) => { ensureFont(k); return `<button class="font-sw ${S.me.nameFont === k ? 'sel' : ''}" data-nfont="${k}" style="font-family:${fontFamily(k)}" ${lock}>${esc(S.me.displayName)}</button>`; }).join('')}</div>
      <div class="hint">Everyone sees your name in this font.</div></div>
    <div class="field"><label>App font</label><select class="select" id="app-font" ${lock}>${Object.entries(APP_FONTS).map(([k, f]) => `<option value="${k}" ${(S.settings.appFont || 'default') === k ? 'selected' : ''}>${f[0]}</option>`).join('')}</select><div class="hint">Only changes lumi on this device.</div></div>`;
}
function wireSparksAppearance(pane, redraw) {
  pane.querySelector('[data-act-sparks]')?.addEventListener('click', () => { layers.slice().forEach((l) => l.close()); navigate('/sparks'); });
  pane.querySelectorAll('[data-sth]').forEach((b) => (b.onclick = () => { S.settings.sparkTheme = b.dataset.sth; saveSettings(); applySparkTheme(); redraw(); }));
  const c = pane.querySelector('#sth-custom');
  if (c) c.oninput = () => { S.settings.sparkTheme = 'custom'; S.settings.sparkAccent = c.value; saveSettings(); applySparkTheme(); };
  if (c) c.onchange = redraw;
  pane.querySelectorAll('[data-nfont]').forEach((b) => (b.onclick = async () => {
    try { const r = await api('PATCH', '/api/me', { nameFont: b.dataset.nfont || null }); S.me = { ...S.me, ...r.user }; cacheUser(r.user); renderSideFoot(); redraw(); } catch (e) { toast(e.message, true); }
  }));
  const af = pane.querySelector('#app-font');
  if (af) af.onchange = () => { S.settings.appFont = af.value; saveSettings(); applySparkTheme(); };
}

// ------------------------------------------------------------------ realtime
function extrasSocket(socket) {
  socket.on('tasks:update', onTasksUpdate);
  socket.on('nicknames:update', ({ userId, nickname }) => applyNickname(userId, nickname));
  socket.on('sparks:update', (st) => { if (st.active && !S.me.sparks) toast('Sparks is on. Enjoy!'); S.me.sparks = st.active; applySparkTheme(); if (S.view.type === 'sparks') renderMain(); });
  socket.on('session:revoked', () => { S.me = null; try { socket.disconnect(); } catch {} renderAuth('login'); toast('You were signed out from another device.'); });
  socket.on('member:xp', onXp);
  socket.on('level:up', onLevelUp);
}
