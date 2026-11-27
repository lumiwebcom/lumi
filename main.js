/* boot + realtime */
'use strict';

let socket = null;

// ---- live updates: when a new version of lumi is deployed, show an Update button (top right)
const ASSETS = ['/', '/styles.css', ...['core', 'auth', 'views', 'social', 'extras', 'community', 'modals', 'call', 'main'].map((f) => `/js/${f}.js`)];
async function checkForUpdate() {
  try {
    const { build } = await fetch('/api/version', { cache: 'no-store' }).then((r) => r.json());
    if (!build) return;
    if (!S.build) { S.build = build; return; }
    if (build !== S.build && !$('#update-pill')) {
      const el = h(`<div id="update-pill" class="update-pill" role="status"><span>A new version of lumi is ready</span><button class="btn primary sm" data-update>Update</button></div>`);
      document.body.appendChild(el);
      el.querySelector('[data-update]').onclick = applyUpdate;
    }
  } catch {}
}
async function applyUpdate() {
  const b = $('#update-pill [data-update]'); if (b) { b.disabled = true; b.textContent = 'Updating…'; }
  if (Call.active) { try { socket.emit('voice:leave'); } catch {} }
  if (window.lumiDesktop?.update) return window.lumiDesktop.update(); // desktop app: clears its cache and reloads
  try { await Promise.all(ASSETS.map((u) => fetch(u, { cache: 'reload' }))); } catch {}
  location.reload();
}
setInterval(checkForUpdate, 60000);
window.addEventListener('focus', checkForUpdate);
async function boot() {
  applyTheme();
  checkForUpdate();
  try { S.config = await api('GET', '/api/config'); } catch {}
  try { const r = await api('GET', '/api/me'); onSignedIn(r.user); }
  catch {
    const r = parseRoute(); if (r.type === 'invite') sessionStorage.setItem('lumi.pendingInvite', r.code);
    renderAuth(r.type === 'invite' ? 'signup' : 'login');
  }
}

async function onSignedIn(user) {
  S.me = user; cacheUser(user);
  if (!S.me.email) try { S.me = { ...S.me, ...(await api('GET', '/api/me')).user }; } catch {}
  $('#root').innerHTML = `<div class="splash">${wordmark('lg')}</div>`;
  await Promise.all([refreshServers(), refreshDMs(), refreshFriends(), refreshStories(), loadNicknames(), loadTasks()]);
  if (typeof preloadGifs === 'function') preloadGifs();
  applySparkTheme();
  connectSocket();
  renderShell();
  const pending = sessionStorage.getItem('lumi.pendingInvite');
  if (pending) { sessionStorage.removeItem('lumi.pendingInvite'); history.replaceState({}, '', '/invite/' + pending); }
  else if (!/^\/(channels|invite|feed|activity|stargaze|sparks)/.test(location.pathname)) history.replaceState({}, '', '/channels/@me');
  route();
}

function connectSocket() {
  socket = io({ transports: ['websocket', 'polling'] });
  socialSocket(socket);
  extrasSocket(socket);
  socket.on('connect_error', (e) => { if (e.message === 'unauthorized') location.reload(); });
  socket.on('connect', () => { if (S._wasConnected) { resync(); if (Call.active) rejoinCall(); } S._wasConnected = true; });
  // a dropped server connection doesn't end the call: audio/video are peer-to-peer. Rejoin when it comes back.
  socket.on('disconnect', () => { if (Call.active) callConnectionLost(); });

  socket.on('message:new', ({ message: m, serverId }) => {
    cacheUser(m.author);
    const roomPost = communityOnMessage(m); // board threads, gallery posts and thread replies
    if (!roomPost) upsertMessage(m);
    const mine = m.author.id === S.me.id;
    const viewing = S.view.channelId === m.channelId;
    const typ = S.typing[m.channelId]; if (typ?.has(m.author.id)) { clearTimeout(typ.get(m.author.id)); typ.delete(m.author.id); if (viewing) renderTyping(); }
    if (viewing) { if (!roomPost) renderMessages(); if (!mine && document.visibilityState === 'visible') markRead(m.channelId); }
    const mention = !mine && new RegExp(`(^|\\s)@(${S.me.username.replace('.', '\\.')}|everyone|here)\\b`, 'i').test(m.content);
    if (!serverId) {
      let d = S.dms.find((x) => x.id === m.channelId);
      if (!d) { refreshDMs().then(() => { renderRail(); if (S.view.type !== 'server') renderSideBody(); updateTitle(); }); }
      else { bumpDM(m); if (!mine && (!viewing || document.visibilityState !== 'visible')) d.unread++; }
      if (!mine && (!viewing || !document.hasFocus())) { playSound('message'); notify(m.author.displayName, m.content || 'Sent an attachment', () => navigate('/channels/@me/' + m.channelId)); }
    } else {
      const sd = S.serverData[serverId];
      const ch = sd?.channels.find((c) => c.id === m.channelId);
      if (!mine && !viewing) { if (ch) ch.unread = (ch.unread || 0) + 1; const s = S.servers.find((s) => s.id === serverId); if (s) s.unread++; }
      if (mention && (!viewing || !document.hasFocus())) { playSound('message'); notify(`${m.author.displayName} in ${sd?.server.name || 'a space'}`, m.content, () => navigate(`/channels/${serverId}/${m.channelId}`)); }
    }
    renderRail(); if (!viewing || !serverId) renderSideBody(); updateTitle();
  });
  socket.on('message:update', ({ message: m }) => { cacheUser(m.author); communityOnUpdate(m); if (m.threadId) return; upsertMessage(m); if (S.view.channelId === m.channelId) renderMessages(); if (S.panel?.type === 'pins' && S.view.channelId === m.channelId) { S.panel = null; openPins(); } });
  socket.on('message:delete', ({ id, channelId, threadId }) => { communityOnDelete({ id, channelId, threadId }); const st = S.messages[channelId]; if (st) st.list = st.list.filter((x) => x.id !== id); if (S.view.channelId === channelId) renderMessages(); });
  socket.on('typing', ({ channelId, userId }) => {
    const map = S.typing[channelId] ||= new Map();
    clearTimeout(map.get(userId));
    map.set(userId, setTimeout(() => { map.delete(userId); if (S.view.channelId === channelId) renderTyping(); }, 4000));
    if (S.view.channelId === channelId) renderTyping();
  });
  socket.on('presence', ({ userId, online }) => {
    S.presence[userId] = online; if (S.userCache[userId]) S.userCache[userId].online = online;
    renderSideBody(); if (S.view.type === 'home') { renderHomeBody(); renderActiveNow(); } else { renderRight(); }
    if (S.view.type === 'dm') { const d = S.dms.find((x) => x.id === S.view.dmId); if (d?.recipients[0]?.id === userId) { const sub = $('.main-head .who .sub'); if (sub) sub.textContent = online ? 'Active now' : '@' + d.recipients[0].username; } }
  });
  socket.on('user:update', ({ user }) => {
    cacheUser(user); if (user.id === S.me.id) { const was = S.me.siteRole, hadSparks = S.me.sparks; S.me = { ...S.me, ...user }; if (hadSparks !== S.me.sparks) applySparkTheme(); if (was !== S.me.siteRole) { const t = S.me.siteRole === 'admin' ? 'You are now a lumi admin' : !S.me.siteRole ? 'Your admin access was removed' : ''; if (t) toast(t); } renderRail(); }
    for (const d of S.dms) d.members = d.members.map((m) => (m.id === user.id ? { ...m, ...user } : m)), d.recipients = d.recipients.map((m) => (m.id === user.id ? { ...m, ...user } : m));
    for (const sd of Object.values(S.serverData)) sd.members.forEach((m) => { if (m.user.id === user.id) Object.assign(m.user, user); });
    renderRail(); renderSideBody(); renderSideFoot();
  });
  socket.on('friends:update', async (ev) => {
    await refreshFriends();
    if (ev.kind === 'request' && ev.to === S.me.id) { toast(`${ev.from.displayName} sent you a friend request`); playSound('message'); }
    if (ev.kind === 'accepted' && ev.to === S.me.id && ev.from) toast(`${ev.from.displayName} accepted your friend request`);
    renderRail(); renderSideBody();
    if (S.view.type === 'home' && S.homeTab !== 'add') renderMain();
    refreshStories().then(() => { if (S.view.type === 'home' && S.homeTab !== 'add' && !svState) renderHomeBody(); });
  });
  socket.on('dms:update', async () => { await refreshDMs(); renderRail(); if (S.view.type !== 'server') renderSideBody(); if (S.view.type === 'dm') { if (!S.dms.find((d) => d.id === S.view.dmId)) navigate('/channels/@me'); else renderMain(); } });
  socket.on('stories:update', async () => { await refreshStories(); refreshMomentsUI(); });
  socket.on('server:update', async ({ serverId, deletedChannel }) => {
    if (!S.servers.find((s) => s.id === serverId)) { await refreshServers(); renderRail(); return; }
    try { await loadServer(serverId); } catch { return; }
    if (S.view.serverId === serverId) {
      if (deletedChannel && S.view.channelId === deletedChannel) return navigate(`/channels/${serverId}`);
      const focused = document.activeElement?.id === 'msg-input';
      renderSideTop(); renderSideBody(); renderRight();
      const ch = S.serverData[serverId].channels.find((c) => c.id === S.view.channelId);
      const head = $('.main-head .t'); if (S.view.channelId === 'lobby') renderMain(); else if (ch && head && !focused && !S.thread) renderMain(); else if (ch && head && !S.thread) head.innerHTML = `${roomIcon(ch)} ${esc(ch.name)}`;
    }
    renderRail();
    if (S.openServerSettings?.sid === serverId) S.openServerSettings.refresh?.();
  });
  socket.on('server:removed', ({ serverId, reason }) => {
    const name = S.servers.find((s) => s.id === serverId)?.name || 'a space';
    removeServerLocal(serverId);
    if (S.openServerSettings?.sid === serverId) S.openServerSettings.close();
    if (reason === 'kicked') toast(`You were removed from ${name}`, true);
    if (reason === 'banned') toast(`You were banned from ${name}`, true);
    if (reason === 'deleted') toast(`${name} was deleted`);
    if (reason === 'removed') toast(`${name} was removed by lumi`, true);
  });
  socket.on('voice:state', ({ channelId, participants }) => {
    const before = (S.voice[channelId] || []).length;
    S.voice[channelId] = participants;
    participants.forEach((p) => cacheUser(p.user));
    if (Call.active?.channelId === channelId && before && participants.length !== before) playSound(participants.length > before ? 'join' : 'leave');
    renderCallUI();
    if (S.view.type === 'home') renderActiveNow();
    if (S.view.type !== 'home') renderRight();
  });
  socket.on('voice:force-leave', () => { cleanupCall(); renderCallUI(); toast('You joined a call on another device'); });
  socket.on('account:banned', ({ reason, until } = {}) => showBannedScreen({ reason, until }));
  socket.on('rtc:signal', onSignal);
  socket.on('rtc:peer-left', onPeerLeft);
  socket.on('call:ring', onRing);
  socket.on('call:ended', ({ channelId }) => { stopRinging(channelId); delete S.voice[channelId]; renderCallUI(); });
  socket.on('call:stop-ring', ({ channelId }) => stopRinging(channelId));
  socket.on('call:declined', ({ channelId, user }) => {
    toast(`${user.displayName} declined the call`);
    const d = S.dms.find((x) => x.id === channelId);
    if (d?.type === 'dm' && Call.active?.channelId === channelId && (S.voice[channelId] || []).length <= 1) setTimeout(() => leaveCall(), 1200);
  });
}
async function resync() {
  await Promise.all([refreshServers(), refreshDMs(), refreshFriends(), loadNicknames(), loadTasks()]).catch(() => {});
  for (const id of Object.keys(S.serverData)) await loadServer(id).catch(() => {});
  S.messages = {};
  renderAll();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.view.channelId && $('#messages')) markRead(S.view.channelId); });
window.addEventListener('beforeunload', () => { if (Call.active) socket.emit('voice:leave'); });

boot();

// lumi's own links (invites, chats) open right here, not in a new tab or the browser.
const LUMI_HOSTS = new Set([location.host, 'lumichat.pages.dev', 'lumi-gtih.onrender.com']);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]'); if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  let u; try { u = new URL(a.href, location.href); } catch { return; }
  if (!LUMI_HOSTS.has(u.host) || a.hasAttribute('download')) return;
  const inv = u.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)\/?$/);
  if (inv) {
    e.preventDefault();
    if (!S.me) { sessionStorage.setItem('lumi.pendingInvite', inv[1]); return renderAuth('signup'); }
    return openInviteAccept(inv[1]);
  }
  if (/^\/(channels|feed|activity|stargaze|sparks)(\/|$)/.test(u.pathname) && S.me) { e.preventDefault(); navigate(u.pathname); }
}, true);
