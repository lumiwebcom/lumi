/* boot + realtime */
'use strict';

let socket = null;

async function boot() {
  applyTheme();
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
  await Promise.all([refreshServers(), refreshDMs(), refreshFriends(), refreshStories()]);
  connectSocket();
  renderShell();
  const pending = sessionStorage.getItem('lumi.pendingInvite');
  if (pending) { sessionStorage.removeItem('lumi.pendingInvite'); history.replaceState({}, '', '/invite/' + pending); }
  else if (location.pathname === '/' || /^\/channels\/@me\/?$/.test(location.pathname)) history.replaceState({}, '', '/home');
  route();
}

function connectSocket() {
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect_error', (e) => { if (e.message === 'unauthorized') location.reload(); });
  socket.on('connect', () => { if (S._wasConnected) resync(); S._wasConnected = true; });
  socialSocket(socket);
  socket.on('disconnect', () => { if (Call.active) { cleanupCall(); renderCallUI(); toast('Connection lost — you left the call', true); } });

  socket.on('message:new', ({ message: m, serverId }) => {
    cacheUser(m.author);
    upsertMessage(m);
    const mine = m.author.id === S.me.id;
    const viewing = S.view.channelId === m.channelId;
    const typ = S.typing[m.channelId]; if (typ?.has(m.author.id)) { clearTimeout(typ.get(m.author.id)); typ.delete(m.author.id); if (viewing) renderTyping(); }
    if (viewing) { renderMessages(); if (!mine && document.visibilityState === 'visible') markRead(m.channelId); }
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
      if (mention && (!viewing || !document.hasFocus())) { playSound('message'); notify(`${m.author.displayName} in ${sd?.server.name || 'a community'}`, m.content, () => navigate(`/channels/${serverId}/${m.channelId}`)); }
    }
    renderRail(); if (!viewing || !serverId) renderSideBody(); updateTitle();
  });
  socket.on('message:update', ({ message: m }) => { cacheUser(m.author); upsertMessage(m); if (S.view.channelId === m.channelId) renderMessages(); if (S.panel?.type === 'pins' && S.view.channelId === m.channelId) { S.panel = null; openPins(); } });
  socket.on('message:delete', ({ id, channelId }) => { const st = S.messages[channelId]; if (st) st.list = st.list.filter((x) => x.id !== id); if (S.view.channelId === channelId) renderMessages(); });
  socket.on('typing', ({ channelId, userId }) => {
    const map = S.typing[channelId] ||= new Map();
    clearTimeout(map.get(userId));
    map.set(userId, setTimeout(() => { map.delete(userId); if (S.view.channelId === channelId) renderTyping(); }, 4000));
    if (S.view.channelId === channelId) renderTyping();
  });
  socket.on('presence', ({ userId, online }) => {
    S.presence[userId] = online; if (S.userCache[userId]) S.userCache[userId].online = online;
    renderSideBody(); if (S.view.type === 'home') { renderHomeBody(); renderActiveNow(); } else if (S.view.type === 'feed') { renderFeedSide(); } else { renderRight(); }
    if (S.view.type === 'dm') { const d = S.dms.find((x) => x.id === S.view.dmId); if (d?.recipients[0]?.id === userId) { const sub = $('.main-head .who .sub'); if (sub) sub.textContent = online ? 'Active now' : '@' + d.recipients[0].username; } }
  });
  socket.on('user:update', ({ user }) => {
    cacheUser(user); if (user.id === S.me.id) { const was = S.me.siteRole; S.me = { ...S.me, ...user }; if (was !== S.me.siteRole) { const t = S.me.siteRole === 'admin' ? 'You are now a lumi admin' : !S.me.siteRole ? 'Your admin access was removed' : ''; if (t) toast(t); } renderRail(); }
    for (const d of S.dms) d.members = d.members.map((m) => (m.id === user.id ? { ...m, ...user } : m)), d.recipients = d.recipients.map((m) => (m.id === user.id ? { ...m, ...user } : m));
    for (const sd of Object.values(S.serverData)) sd.members.forEach((m) => { if (m.user.id === user.id) Object.assign(m.user, user); });
    renderRail(); renderSideBody(); renderSideFoot();
  });
  socket.on('friends:update', async (ev) => {
    await refreshFriends();
    if (ev.kind === 'request' && ev.to === S.me.id) { toast(`${ev.from.displayName} sent you a friend request`); playSound('message'); }
    if (ev.kind === 'accepted' && ev.to === S.me.id && ev.from) toast(`${ev.from.displayName} accepted your friend request 🎉`);
    renderRail(); renderSideBody();
    if (S.view.type === 'home' && S.homeTab !== 'add') renderMain();
    if (S.view.type === 'activity') renderActivity($('#main'));
    if (S.view.type === 'feed') { renderFeedSide(); S.feed.loaded = false; loadFeed(); }
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
      const head = $('.main-head .t'); if (ch && head && !focused) renderMain(); else if (ch && head) head.innerHTML = `${icon(ch.type === 'text' ? 'hash' : 'volume', 'sm')} ${esc(ch.name)}`;
    }
    renderRail();
    if (S.openServerSettings?.sid === serverId) S.openServerSettings.refresh?.();
  });
  socket.on('server:removed', ({ serverId, reason }) => {
    const name = S.servers.find((s) => s.id === serverId)?.name || 'a community';
    removeServerLocal(serverId);
    if (S.openServerSettings?.sid === serverId) S.openServerSettings.close();
    if (reason === 'kicked') toast(`You were removed from ${name}`, true);
    if (reason === 'banned') toast(`You were banned from ${name}`, true);
    if (reason === 'deleted') toast(`${name} was deleted`);
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
  socket.on('account:banned', ({ reason } = {}) => {
    if (Call.active) cleanupCall();
    S.me = null;
    $('#root').innerHTML = `<div class="auth" style="display:grid;place-items:center"><div class="auth-card" style="text-align:center;max-width:420px">${wordmark()}<h2>Your account has been banned</h2><p class="muted">${reason ? esc(reason) : 'An admin banned this account from lumi.'}</p></div></div>`;
  });
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
  await Promise.all([refreshServers(), refreshDMs(), refreshFriends()]).catch(() => {});
  for (const id of Object.keys(S.serverData)) await loadServer(id).catch(() => {});
  S.messages = {};
  renderAll();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.view.channelId && $('#messages')) markRead(S.view.channelId); });
window.addEventListener('beforeunload', () => { if (Call.active) socket.emit('voice:leave'); });

boot();
