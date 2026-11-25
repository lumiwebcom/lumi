/* views: shell, rail, sidebar, home, chat, members */
'use strict';

function renderShell() {
  $('#root').innerHTML = `<div class="app" id="app">
    <nav class="rail" id="rail"></nav>
    <aside class="side" id="side"><div id="side-top"></div><div class="side-body" id="side-body"></div><div class="side-foot" id="side-foot"></div></aside>
    <main class="main" id="main"></main></div>`;
  $('#rail').addEventListener('click', onRailClick);
  $('#rail').addEventListener('contextmenu', onRailContext);
  $('#side').addEventListener('click', onSideClick);
  $('#main').addEventListener('click', onMainClick);
  $('#app').addEventListener('click', (e) => { if (e.target.id === 'app') $('#app').classList.remove('drawer'); });
}
function renderAll() { renderRail(); renderSideTop(); renderSideBody(); renderSideFoot(); renderMain(); updateTitle(); }
function updateTitle() {
  const unread = S.dms.reduce((a, d) => a + d.unread, 0);
  let t = 'lumi';
  const v = S.view;
  if (v.type === 'dm') t = dmName(S.dms.find((d) => d.id === v.dmId)) + ' • lumi';
  if (v.type === 'server') { const sd = S.serverData[v.serverId]; const c = sd?.channels.find((c) => c.id === v.channelId); if (sd) t = `${c ? (c.type === 'text' ? '#' : '') + c.name + ' | ' : ''}${sd.server.name} • lumi`; }
  document.title = (unread ? `(${unread}) ` : '') + t;
}

async function route() {
  if (!S.me) return;
  const r = parseRoute();
  closeMenu(); $('#app')?.classList.remove('drawer');
  if (r.type === 'invite') { history.replaceState({}, '', '/channels/@me'); S.view = { type: 'home' }; renderAll(); openInviteAccept(r.code); return; }
  if (r.type === 'server') {
    if (!S.servers.find((s) => s.id === r.serverId)) return navigate('/channels/@me', true);
    let sd = S.serverData[r.serverId];
    if (!sd) { try { sd = await loadServer(r.serverId); } catch { return navigate('/channels/@me', true); } }
    let cid = r.channelId;
    if (!cid || !sd.channels.find((c) => c.id === cid)) {
      const last = S.lastChannel[r.serverId];
      cid = (last && sd.channels.find((c) => c.id === last && c.type === 'text') ? last : (sd.channels.find((c) => c.type === 'text') || sd.channels[0])?.id) || null;
      if (cid) history.replaceState({}, '', `/channels/${r.serverId}/${cid}`);
    }
    const ch = sd.channels.find((c) => c.id === cid);
    if (ch?.type === 'text') { S.lastChannel[r.serverId] = cid; localStorage.setItem('lumi.lastChannel', JSON.stringify(S.lastChannel)); }
    S.view = { type: 'server', serverId: r.serverId, channelId: cid };
  } else if (r.type === 'dm') {
    if (!S.dms.find((d) => d.id === r.dmId)) { await refreshDMs(); if (!S.dms.find((d) => d.id === r.dmId)) return navigate('/channels/@me', true); }
    S.view = { type: 'dm', dmId: r.dmId, channelId: r.dmId };
  } else S.view = { type: ['feed', 'activity', 'stargaze'].includes(r.type) ? r.type : 'home' };
  S.panel = null; S.replyTo = null; S.pending = null; S.editing = null;
  renderAll();
}

// ------------------------------------------------------------------ data loaders
async function loadServer(id) {
  const d = await api('GET', `/api/servers/${id}`);
  S.serverData[id] = d;
  d.members.forEach((m) => cacheUser(m.user));
  for (const [cid, parts] of Object.entries(d.voice || {})) S.voice[cid] = parts;
  const sum = S.servers.find((s) => s.id === id);
  if (sum) Object.assign(sum, { name: d.server.name, icon: d.server.icon, unread: d.channels.reduce((a, c) => a + (c.unread || 0), 0) });
  return d;
}
async function refreshDMs() { const r = await api('GET', '/api/dms'); S.dms = r.dms; r.dms.forEach((d) => d.members.forEach(cacheUser)); }
async function refreshFriends() { const r = await api('GET', '/api/friends'); S.friends = r.friends; r.friends.forEach((f) => cacheUser(f.user)); }
async function refreshServers() { const r = await api('GET', '/api/servers'); S.servers = r.servers; }
async function refreshStories() { try { const r = await api('GET', '/api/stories'); S.stories = r.stories; } catch {} }

function dmName(dm) {
  if (!dm) return 'Direct Message';
  if (dm.type === 'group') return dm.name || dm.recipients.map((r) => r.displayName).join(', ') || 'Just you';
  return dm.recipients[0]?.displayName || 'Deleted user';
}
function dmAvatar(dm, size = 48) {
  if (dm.type !== 'group') { const u = S.userCache[dm.recipients[0]?.id] || dm.recipients[0]; return avatar(u, size, { dot: true }); }
  if (dm.icon) return avatar({ id: dm.id, avatar: dm.icon }, size);
  const [a, b] = dm.recipients; const s = Math.round(size * 0.72);
  return `<div style="position:relative;width:${size}px;height:${size}px;flex:none">
    <div style="position:absolute;right:0;top:0">${avatar(b || a, s)}</div>
    <div style="position:absolute;left:0;bottom:0;border:2px solid var(--bg);border-radius:50%">${avatar(a, s)}</div></div>`;
}

// ------------------------------------------------------------------ rail
function railItem({ active, unread, tip, inner, data, badge }) {
  return `<div class="rail-item ${active ? 'active' : ''} ${unread ? 'unread' : ''}" ${data} data-tip="${esc(tip)}"><span class="pill"></span>${inner}${badge ? `<span class="badge">${badge > 99 ? '99+' : badge}</span>` : ''}</div>`;
}
function renderRail() {
  const v = S.view;
  const pending = S.friends.filter((f) => f.type === 'incoming').length;
  let html = railItem({ active: v.type !== 'server' && v.type !== 'stargaze', tip: 'Chats', inner: `<div class="rail-btn home">${LOGO_MARK}</div>`, data: 'data-go="home"', badge: pending });
  for (const d of S.dms.filter((d) => d.unread > 0).slice(0, 5))
    html += railItem({ tip: dmName(d), inner: `<div class="rail-btn" style="background:none">${dmAvatar(d, 48)}</div>`, data: `data-dm="${d.id}"`, badge: d.unread });
  html += '<div class="sep"></div>';
  for (const s of S.servers) {
    const inVoice = Call.active && S.serverData[s.id]?.channels.some((c) => c.id === Call.active.channelId);
    html += railItem({ active: v.serverId === s.id, unread: s.unread > 0, tip: s.name + (inVoice ? ' • in a lounge' : ''),
      inner: `<div class="rail-ring"><div class="rail-btn srv ${s.icon ? 'has-img' : ''}" style="--c:${colorFor(s.id)}">${serverIcon(s)}</div></div>`, data: `data-server="${s.id}"` });
  }
  html += railItem({ tip: 'Create a space', inner: `<div class="rail-btn add">${icon('plus')}</div>`, data: 'data-act="create-server"' });
  html += railItem({ active: v.type === 'stargaze', tip: 'Stargaze', inner: `<div class="rail-btn add sg-rail">${icon('compass')}</div>`, data: 'data-act="stargaze"' });
  if (isSiteAdmin()) html += '<div class="rail-spacer"></div>' + railItem({ tip: 'Admin panel', inner: `<div class="rail-btn add admin-btn">${SHIELD_BLUE}</div>`, data: 'data-act="admin-panel"' });
  $('#rail').innerHTML = html;
}
function onRailClick(e) {
  const it = e.target.closest('.rail-item'); if (!it) return;
  if (it.dataset.go === 'home') return navigate('/channels/@me');
  if (it.dataset.dm) return navigate('/channels/@me/' + it.dataset.dm);
  if (it.dataset.server) return navigate('/channels/' + it.dataset.server + (S.lastChannel[it.dataset.server] ? '/' + S.lastChannel[it.dataset.server] : ''));
  if (it.dataset.act === 'create-server') return openCreateServer();
  if (it.dataset.act === 'join-server') return openCreateServer('join');
  if (it.dataset.act === 'stargaze') return navigate('/stargaze');
  if (it.dataset.act === 'admin-panel') return openAdminPanel();
}
function onRailContext(e) {
  const it = e.target.closest('[data-server]'); if (!it) return;
  e.preventDefault(); serverMenu(it.dataset.server, { x: e.clientX, y: e.clientY });
}
async function serverMenu(sid, anchor) {
  const sd = S.serverData[sid] || await loadServer(sid);
  const owner = sd.server.ownerId === S.me.id;
  openMenu(anchor, [
    can(sd, P.CREATE_INVITE) && { label: 'Invite people', icon: 'userPlus', onClick: () => openInvite(sid) },
    { label: 'Mark as read', icon: 'check', onClick: () => markServerRead(sid) },
    (can(sd, P.MANAGE_SERVER) || can(sd, P.MANAGE_ROLES) || can(sd, P.KICK_MEMBERS) || can(sd, P.BAN_MEMBERS)) && { label: 'Community settings', icon: 'settings', onClick: () => openServerSettings(sid) },
    can(sd, P.MANAGE_CHANNELS) && { label: 'New room', icon: 'plus', onClick: () => openChannelModal(sid) },
    can(sd, P.MANAGE_CHANNELS) && { label: 'New category', icon: 'menu', onClick: () => openCategoryModal(sid) },
    { label: 'Edit my community profile', icon: 'edit', onClick: () => editNickname(sid, S.me.id) },
    'sep',
    !owner && { label: 'Leave space', icon: 'logout', danger: true, onClick: () => leaveServer(sid) },
    owner && can(sd, P.MANAGE_SERVER) && { label: 'Delete space', icon: 'trash', danger: true, onClick: () => openServerSettings(sid, 'delete') },
  ]);
}
async function markServerRead(sid) {
  const sd = S.serverData[sid] || await loadServer(sid);
  for (const c of sd.channels.filter((c) => c.unread)) { c.unread = 0; api('POST', `/api/channels/${c.id}/read`).catch(() => {}); }
  const s = S.servers.find((s) => s.id === sid); if (s) s.unread = 0;
  renderRail(); renderSideBody();
}
async function leaveServer(sid) {
  const sd = S.serverData[sid];
  if (!(await confirmDialog(`Leave '${sd?.server.name}'`, `Are you sure you want to leave <b>${esc(sd?.server.name)}</b>? You won't be able to rejoin unless you are re-invited.`, 'Leave'))) return;
  try { await api('POST', `/api/servers/${sid}/leave`); removeServerLocal(sid); toast('You left the space'); } catch (e) { toast(e.message, true); }
}
function removeServerLocal(sid) {
  if (Call.active && S.serverData[sid]?.channels.some((c) => c.id === Call.active.channelId)) leaveCall();
  S.servers = S.servers.filter((s) => s.id !== sid); delete S.serverData[sid];
  if (S.view.serverId === sid) navigate('/channels/@me'); else renderRail();
}

// ------------------------------------------------------------------ sidebar
function renderSideTop() {
  const v = S.view, el = $('#side-top');
  if (v.type === 'stargaze') return renderStargazeSide();
  if (v.type === 'server') {
    const sd = S.serverData[v.serverId]; if (!sd) return (el.innerHTML = '');
    const b = sd.server.banner;
    el.innerHTML = `<div class="server-head ${b ? 'has-banner' : ''}" data-act="server-menu">
      ${b ? `<div class="banner" style="background-image:url('${esc(b)}')"></div>` : ''}
      <div class="row"><span class="name">${esc(sd.server.name)}</span>${icon('chevron', 'sm')}</div></div>`;
  } else {
    el.innerHTML = `<div class="side-head"><div class="title">${esc(S.me.username)}</div>
      <button class="icon-btn" data-act="new-group" data-tip="New message">${icon('edit')}</button></div>
      <div class="side-search"><input id="dm-search" placeholder="Search" autocomplete="off"></div>`;
    $('#dm-search').oninput = () => renderSideBody();
  }
}
function renderSideBody() {
  const v = S.view, el = $('#side-body'); if (!el) return;
  if (v.type === 'server') return renderServerSide(el);
  if (v.type === 'stargaze') return renderStargazeSide();
  const q = ($('#dm-search')?.value || '').toLowerCase();
  const pending = S.friends.filter((f) => f.type === 'incoming').length;
  let html = `<div class="nav-item ${v.type === 'home' ? 'active' : ''}" data-go="home">
      <div style="width:48px;display:grid;place-items:center">${icon('users')}</div><div class="meta"><div class="n bold">Friends</div></div>
      ${pending ? `<span class="count">${pending}</span>` : ''}</div>
    ${socialNavItems(v)}
    <div class="side-section"><span>Chats</span><button class="icon-btn" data-act="new-group" data-tip="New group">${icon('plus', 'sm')}</button></div>`;
  const list = S.dms.filter((d) => !q || dmName(d).toLowerCase().includes(q) || d.recipients.some((r) => r.username.includes(q)));
  if (!list.length) html += `<div class="muted small" style="padding:8px 14px">${q ? 'No matches.' : 'No messages yet. Say hi to a friend!'}</div>`;
  for (const d of list) {
    const lm = d.lastMessage; const inCall = (S.voice[d.id] || []).length > 0;
    let sub = '';
    if (inCall) sub = `<span style="color:var(--green)">● Call in progress</span>`;
    else if (lm) sub = `${lm.authorId === S.me.id ? 'You: ' : ''}${esc(lm.content || (lm.attachmentType ? 'Sent an attachment' : ''))} · ${ago(lm.createdAt)}`;
    else if (d.type === 'dm') { const u = S.userCache[d.recipients[0]?.id] || d.recipients[0]; sub = u ? esc(u.customStatus || (isOnline(u.id) ? 'Active now' : '@' + u.username)) : ''; }
    else sub = `${d.members.length} members`;
    html += `<div class="nav-item ${v.dmId === d.id ? 'active' : ''} ${d.unread ? 'unread' : ''}" data-dm="${d.id}">
      ${dmAvatar(d, 48)}<div class="meta"><div class="n">${esc(dmName(d))}${d.type === 'dm' ? roleBadge(d.recipients[0]) : ''}</div><div class="sub">${sub}</div></div>
      ${streakChip(d)}${inCall ? `<span style="color:var(--green)">${icon('phone', 'sm')}</span>` : d.unread ? '<span class="unread-dot"></span>' : ''}</div>`;
  }
  el.innerHTML = html;
}
function renderServerSide(el) {
  const sd = S.serverData[S.view.serverId]; if (!sd) return (el.innerHTML = '');
  const manage = can(sd, P.MANAGE_CHANNELS);
  const collapsed = S.collapsedCats || (S.collapsedCats = new Set(JSON.parse(localStorage.getItem('lumi.collapsed') || '[]')));
  const order = (a, b) => (a.type === b.type ? 0 : a.type === 'text' ? -1 : 1) || a.position - b.position;
  const chanRow = (c) => `<div class="nav-item chan ${S.view.channelId === c.id ? 'active' : ''} ${c.unread && S.view.channelId !== c.id ? 'unread' : ''}" data-chan="${c.id}">
      ${icon(c.type === 'text' ? 'room' : 'waves', 'sm')}<span class="n" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
      <span class="tools">${can(sd, P.CREATE_INVITE) ? `<button data-act="invite" data-tip="Create invite">${icon('userPlus', 'xs')}</button>` : ''}${manage ? `<button data-act="edit-chan" data-tip="Edit">${icon('settings', 'xs')}</button>` : ''}</span>
      ${c.unread && S.view.channelId !== c.id ? '<span class="unread-dot"></span>' : ''}</div>`;
  const voiceUsers = (c) => {
    const parts = S.voice[c.id] || [];
    return parts.length ? `<div class="voice-users">${parts.map((p) => `<div class="voice-user" data-user="${p.userId}">
      ${avatar(p.user, 24, { ring: 'seen', speak: true })}<span>${esc(memberInfo(sd, p.userId).name)}</span>
      <span class="vu-icons">${p.screen ? '<span class="live">LIVE</span>' : ''}${p.video ? icon('video', 'xs') : ''}${p.muted ? icon('micOff', 'xs') : ''}${p.deafened ? icon('headphonesOff', 'xs') : ''}</span></div>`).join('')}</div>` : '';
  };
  const rows = (list) => list.sort(order).map((c) => chanRow(c) + (c.type === 'voice' ? voiceUsers(c) : '')).join('');
  const cats = [...(sd.categories || [])].sort((a, b) => a.position - b.position);
  const catIds = new Set(cats.map((c) => c.id));
  const loose = sd.channels.filter((c) => !c.categoryId || !catIds.has(c.categoryId));
  let html = loose.length ? `<div style="height:8px"></div>${rows(loose)}` : '';
  for (const cat of cats) {
    const list = sd.channels.filter((c) => c.categoryId === cat.id);
    const isCol = collapsed.has(cat.id);
    const hasUnread = list.some((c) => c.unread && c.id !== S.view.channelId);
    html += `<div class="side-section cat cat-head" data-cat="${cat.id}"><span class="cat-name">${icon('chevron', 'xs').replace('class="i xs"', `class="i xs" style="transition:transform .15s;${isCol ? 'transform:rotate(-90deg)' : ''}"`)} ${esc(cat.name)}${isCol && hasUnread ? ' <span class="unread-dot" style="display:inline-block"></span>' : ''}</span>
      ${manage ? `<span class="cat-tools"><button class="icon-btn" data-act="new-chan-in" data-tip="Add a room or lounge">${icon('plus', 'xs')}</button><button class="icon-btn" data-act="edit-cat" data-tip="Edit category">${icon('settings', 'xs')}</button></span>` : ''}</div>`;
    if (isCol) html += rows(list.filter((c) => c.id === S.view.channelId || (S.voice[c.id] || []).length));
    else html += list.length ? rows(list) : `<div class="muted small" style="padding:4px 14px 6px">${manage ? 'Empty — add a room with +' : 'Nothing here yet'}</div>`;
  }
  if (!sd.channels.length && !cats.length) html += `<div class="muted small" style="padding:14px">No rooms yet.</div>`;
  if (manage) html += `<button class="btn ghost" data-act="new-cat" style="margin:14px 6px 0;font-weight:500;color:var(--text2)">${icon('plus', 'sm')} New category</button>`;
  el.innerHTML = html;
}
function renderSideFoot() {
  const el = $('#side-foot'); if (!el || !S.me) return;
  let html = '';
  if (Call.active) {
    const cid = Call.active.channelId; let where = '';
    const dm = S.dms.find((d) => d.id === cid);
    if (dm) where = dmName(dm);
    else for (const sd of Object.values(S.serverData)) { const c = sd.channels.find((c) => c.id === cid); if (c) where = `${c.name} / ${sd.server.name}`; }
    html += `<div class="vc-panel"><div style="flex:1;min-width:0"><div class="st">${icon('waves', 'xs')} Connected</div><div class="where" data-act="goto-call">${esc(where)}</div></div>
      <button class="icon-btn ${Call.active.video ? 'active' : ''}" data-act="call-video" data-tip="${Call.active.video ? 'Turn off camera' : 'Turn on camera'}">${icon(Call.active.video ? 'video' : 'videoOff', 'sm')}</button>
      <button class="icon-btn ${Call.active.screen ? 'active' : ''}" data-act="call-screen" data-tip="Share screen">${icon('screen', 'sm')}</button>
      <button class="icon-btn danger" data-act="leave-call" data-tip="Disconnect">${icon('hangup', 'sm')}</button></div>`;
  }
  const muted = Call.active ? Call.active.muted : S.selfMute, deaf = Call.active ? Call.active.deafened : S.selfDeaf;
  html += `<div class="me-panel">${avatar(S.me, 36, { dot: true })}
    <div class="who" data-act="my-profile"><div class="n">${esc(S.me.displayName)}${roleBadge(S.me)}</div><div class="u">${esc(S.me.customStatus || '@' + S.me.username)}</div></div>
    <button class="icon-btn ${muted ? 'off' : ''}" data-act="toggle-mute" data-tip="${muted ? 'Unmute' : 'Mute'}">${icon(muted ? 'micOff' : 'mic', 'sm')}</button>
    <button class="icon-btn ${deaf ? 'off' : ''}" data-act="toggle-deafen" data-tip="${deaf ? 'Undeafen' : 'Deafen'}">${icon(deaf ? 'headphonesOff' : 'headphones', 'sm')}</button>
    <button class="icon-btn" data-act="user-settings" data-tip="Settings">${icon('settings', 'sm')}</button></div>`;
  el.innerHTML = html;
}
function onSideClick(e) {
  const t = e.target.closest('[data-act],[data-dm],[data-chan],[data-go],[data-user],[data-cat]'); if (!t) return;
  const act = t.dataset.act;
  if (!act && t.dataset.cat) {
    const set = S.collapsedCats; set.has(t.dataset.cat) ? set.delete(t.dataset.cat) : set.add(t.dataset.cat);
    localStorage.setItem('lumi.collapsed', JSON.stringify([...set])); return renderSideBody();
  }
  if (act === 'invite') { e.stopPropagation(); return openInvite(S.view.serverId); }
  if (act === 'edit-chan') { e.stopPropagation(); return openChannelModal(S.view.serverId, t.closest('[data-chan]').dataset.chan); }
  if (act === 'new-chan') return openChannelModal(S.view.serverId, null, t.dataset.type);
  if (act === 'new-chan-in') { e.stopPropagation(); return openChannelModal(S.view.serverId, null, 'text', t.closest('[data-cat]').dataset.cat); }
  if (act === 'edit-cat') { e.stopPropagation(); return openCategoryModal(S.view.serverId, t.closest('[data-cat]').dataset.cat); }
  if (act === 'new-cat') return openCategoryModal(S.view.serverId);
  if (act === 'server-menu') return serverMenu(S.view.serverId, t.querySelector('.row'));
  if (act === 'new-group') return openNewGroup();
  if (act === 'goto-call') return gotoCall();
  if (act === 'leave-call') return leaveCall();
  if (act === 'call-video') return toggleVideo();
  if (act === 'call-screen') return toggleScreen();
  if (act === 'toggle-mute') return toggleMute();
  if (act === 'toggle-deafen') return toggleDeafen();
  if (act === 'user-settings') return openUserSettings();
  if (act === 'my-profile') return openProfile(S.me.id);
  if (t.dataset.go === 'home') return navigate('/channels/@me');
  if (t.dataset.dm) return navigate('/channels/@me/' + t.dataset.dm);
  if (t.dataset.user) return openProfile(t.dataset.user, S.view.serverId);
  if (t.dataset.chan) {
    const sd = S.serverData[S.view.serverId]; const c = sd.channels.find((c) => c.id === t.dataset.chan);
    navigate(`/channels/${S.view.serverId}/${c.id}`);
    if (c.type === 'voice' && Call.active?.channelId !== c.id) joinCall(c.id);
  }
}
function gotoCall() {
  if (!Call.active) return;
  const cid = Call.active.channelId;
  if (S.dms.find((d) => d.id === cid)) return navigate('/channels/@me/' + cid);
  for (const sd of Object.values(S.serverData)) if (sd.channels.find((c) => c.id === cid)) return navigate(`/channels/${sd.server.id}/${cid}`);
}

// ------------------------------------------------------------------ member info
function memberInfo(sd, uid) {
  const u = S.userCache[uid] || {};
  if (!sd) return { name: u.displayName || u.username || 'Unknown', color: null, roles: [] };
  const m = sd.members.find((m) => m.user.id === uid);
  const roles = m ? sd.roles.filter((r) => !r.isDefault && m.roleIds.includes(r.id)) : [];
  const colored = roles.find((r) => r.color && r.color.toLowerCase() !== '#8e8e8e');
  return { name: m?.nickname || u.displayName || u.username || 'Unknown', color: colored?.color || null, roles, member: m, owner: sd.server.ownerId === uid };
}
const currentServer = () => (S.view.type === 'server' ? S.serverData[S.view.serverId] : null);

// ------------------------------------------------------------------ main area
const mobileBtn = () => `<button class="icon-btn mobile-menu" data-act="drawer">${icon('menu')}</button>`;
function renderMain() {
  const v = S.view, main = $('#main');
  if (v.type === 'home') return renderHome(main);
  if (v.type === 'feed') return renderFeed(main);
  if (v.type === 'stargaze') return renderStargaze(main);
  if (v.type === 'activity') return renderActivity(main);
  if (v.type === 'dm') return renderChatView(main);
  const sd = S.serverData[v.serverId];
  const ch = sd?.channels.find((c) => c.id === v.channelId);
  if (!ch) {
    main.innerHTML = `<header class="main-head">${mobileBtn()}</header><div class="empty" style="flex:1"><div class="art">${icon('hash')}</div><h3>No rooms here yet</h3>
      <p>${can(sd, P.MANAGE_CHANNELS) ? 'Create one to get the conversation started.' : 'Ask an admin to create one.'}</p>
      ${can(sd, P.MANAGE_CHANNELS) ? '<button class="btn primary" data-act="new-chan">Create a room</button>' : ''}</div>`;
    return;
  }
  if (ch.type === 'voice') return renderVoiceView(main, sd, ch);
  renderChatView(main);
}

// ---------- home / friends
function renderHome(main) {
  const pending = S.friends.filter((f) => f.type === 'incoming').length;
  const tabs = [['online', 'Online'], ['all', 'All'], ['pending', 'Pending'], ['blocked', 'Blocked']];
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">Friends</div>
      <div class="tabs" style="padding:0 0 0 8px">${tabs.map(([k, l]) => `<button class="tab ${S.homeTab === k ? 'active' : ''}" data-tab="${k}">${l}${k === 'pending' && pending ? `<span class="c">${pending}</span>` : ''}</button>`).join('')}</div>
      <div class="tools"><button class="btn ${S.homeTab === 'add' ? 'primary' : 'grad'}" data-tab="add">${icon('userPlus', 'sm')} Add friend</button></div></header>
    <div class="content"><div class="home" id="home"></div><aside class="active-now" id="active-now"></aside></div>`;
  renderHomeBody(); renderActiveNow();
}
function storiesBar() {
  const mine = S.stories.find((s) => s.user.id === S.me.id);
  let html = `<div class="stories"><div class="story" data-story="me"><div style="position:relative">${mine ? avatar(S.me, 62, { ring: mine.allSeen ? 'seen' : true }) : `<div style="padding:3px">${avatar(S.me, 62)}</div>`}
    <span class="add">${icon('plus', 'xs')}</span></div><span class="lbl muted">Your moment</span></div>`;
  for (const s of S.stories.filter((s) => s.user.id !== S.me.id))
    html += `<div class="story" data-story="${s.user.id}">${avatar(s.user, 62, { ring: s.allSeen ? 'seen' : true })}<span class="lbl">${esc(s.user.username)}</span></div>`;
  if (S.stories.filter((s) => s.user.id !== S.me.id).length === 0)
    html += `<div class="muted small" style="align-self:center;max-width:220px">Friends’ moments show up here for 24 hours.</div>`;
  return html + '</div>';
}
function renderHomeBody() {
  const el = $('#home'); if (!el) return;
  const tab = S.homeTab;
  let html = storiesBar();
  if (tab === 'add') {
    html += `<div class="add-friend"><h3>Add friend</h3><div class="muted">Add friends by their lumi username.</div>
      <form id="add-friend-form"><span class="muted">@</span><input name="u" placeholder="username" autocomplete="off" autofocus>
      <button class="btn primary" type="submit">Send request</button></form><div class="res" id="af-res"></div></div>
      <div class="empty"><div class="art">${icon('userPlus')}</div><h3>Find your people</h3><p>Share your username — <b>@${esc(S.me.username)}</b> — so friends can add you.</p>
      <button class="btn" data-act="copy-username">${icon('copy', 'sm')} Copy my username</button></div>`;
    el.innerHTML = html;
    const f = $('#add-friend-form');
    f.onsubmit = async (e) => {
      e.preventDefault(); const u = f.u.value.trim(); if (!u) return; const res = $('#af-res');
      try { await api('POST', '/api/friends/request', { username: u }); res.className = 'res ok'; res.textContent = `Success! Your friend request to @${u.replace(/^@/, '')} was sent.`; f.u.value = ''; await refreshFriends(); renderRail(); }
      catch (err) { res.className = 'res bad'; res.textContent = err.message; }
    };
    setTimeout(() => f.u.focus(), 0);
    return;
  }
  let list = S.friends;
  if (tab === 'online') list = list.filter((f) => f.type === 'friend' && isOnline(f.user.id));
  if (tab === 'all') list = list.filter((f) => f.type === 'friend');
  if (tab === 'pending') list = list.filter((f) => f.type === 'incoming' || f.type === 'outgoing');
  if (tab === 'blocked') list = list.filter((f) => f.type === 'blocked');
  list = [...list].sort((a, b) => (isOnline(b.user.id) - isOnline(a.user.id)) || a.user.displayName.localeCompare(b.user.displayName));
  const label = { online: 'Online', all: 'All friends', pending: 'Pending', blocked: 'Blocked' }[tab];
  if (!list.length) {
    const msgs = { online: ["No one's around right now", 'Your friends will show up here when they come online.'], all: ['No friends yet', 'Add someone by their username to get started.'],
      pending: ['No pending requests', "When someone adds you, you'll see it here."], blocked: ["You haven't blocked anyone", 'Blocked people can’t message or call you.'] }[tab];
    html += `<div class="empty"><div class="art">${icon(tab === 'blocked' ? 'block' : 'users')}</div><h3>${msgs[0]}</h3><p>${msgs[1]}</p>${tab !== 'blocked' ? '<button class="btn primary" data-tab="add">Add friend</button>' : ''}</div>`;
  } else {
    html += `<div class="friends-list"><div class="h">${label} — ${list.length}</div>`;
    for (const f of list) {
      const u = S.userCache[f.user.id] || f.user;
      const sub = f.type === 'incoming' ? 'Incoming friend request' : f.type === 'outgoing' ? 'Outgoing friend request' : f.type === 'blocked' ? 'Blocked' : (u.customStatus || (isOnline(u.id) ? 'Active now' : 'Offline'));
      let acts = '';
      if (f.type === 'friend') acts = `<button class="icon-btn" data-act="dm" data-tip="Message">${icon('chat', 'sm')}</button><button class="icon-btn" data-act="call" data-tip="Voice call">${icon('phone', 'sm')}</button><button class="icon-btn" data-act="fmore" data-tip="More">${icon('more', 'sm')}</button>`;
      if (f.type === 'incoming') acts = `<button class="icon-btn ok" data-act="accept" data-tip="Accept">${icon('check', 'sm')}</button><button class="icon-btn no" data-act="decline" data-tip="Ignore">${icon('x', 'sm')}</button>`;
      if (f.type === 'outgoing') acts = `<button class="icon-btn no" data-act="decline" data-tip="Cancel">${icon('x', 'sm')}</button>`;
      if (f.type === 'blocked') acts = `<button class="btn" data-act="unblock">Unblock</button>`;
      html += `<div class="friend" data-fid="${u.id}">${avatar(u, 48, { dot: f.type === 'friend' })}<div class="meta"><div class="n">${esc(u.displayName)}${roleBadge(u)} <span class="muted" style="font-weight:400">@${esc(u.username)}</span></div><div class="s">${esc(sub)}</div></div><div class="acts">${acts}</div></div>`;
    }
    html += '</div>';
  }
  el.innerHTML = html;
}
function renderActiveNow() {
  const el = $('#active-now'); if (!el) return;
  const friends = S.friends.filter((f) => f.type === 'friend' && isOnline(f.user.id)).map((f) => S.userCache[f.user.id] || f.user);
  const calls = S.dms.filter((d) => (S.voice[d.id] || []).length && Call.active?.channelId !== d.id);
  let html = '<h3>Around now</h3>';
  for (const d of calls) html += `<div class="active-card" data-dm="${d.id}"><div style="display:flex;gap:10px;align-items:center">${dmAvatar(d, 40)}<div><div class="bold">${esc(dmName(d))}</div><div class="small" style="color:var(--green)">● In a call — tap to join</div></div></div></div>`;
  if (!friends.length && !calls.length) html += `<div class="active-card" style="cursor:default;text-align:center"><div class="bold">It's quiet for now…</div><div class="muted small" style="margin-top:6px">When friends are online or start a call, you'll see them here.</div></div>`;
  for (const u of friends.slice(0, 12)) html += `<div class="active-card" data-user="${u.id}"><div style="display:flex;gap:10px;align-items:center">${avatar(u, 40, { dot: true })}<div style="min-width:0"><div class="bold">${esc(u.displayName)}</div><div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.customStatus || 'Online')}</div></div></div></div>`;
  el.innerHTML = html;
}

// ---------- voice channel view
function renderVoiceView(main, sd, ch) {
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">${icon('waves', 'sm')} ${esc(ch.name)}</div>
    <div class="tools">${can(sd, P.CREATE_INVITE) ? `<button class="icon-btn" data-act="invite" data-tip="Invite">${icon('userPlus', 'sm')}</button>` : ''}
    <button class="icon-btn ${S.showMembers ? 'active' : ''}" data-act="toggle-members" data-tip="Member list">${icon('users', 'sm')}</button></div></header>
    <div class="content"><div class="chat"><div id="stage-slot" style="flex:1;display:flex;flex-direction:column;min-height:0"></div></div><div id="right-slot" style="display:contents"></div></div>`;
  updateStage(); renderRight();
}

// ---------- chat view (DM, group, text channel)
function renderChatView(main) {
  const v = S.view, cid = v.channelId;
  let head = '', tools = '';
  const sd = currentServer();
  if (v.type === 'dm') {
    const dm = S.dms.find((d) => d.id === cid);
    const u = dm.type === 'dm' ? S.userCache[dm.recipients[0]?.id] || dm.recipients[0] : null;
    const sub = u ? (isOnline(u.id) ? 'Active now' : '@' + u.username) : `${dm.members.length} members`;
    head = `<div class="who" data-act="${u ? 'profile' : 'group-settings'}" ${u ? `data-user="${u.id}"` : ''}>${dmAvatar(dm, 40)}<div><div class="t">${esc(dmName(dm))}${u ? roleBadge(u) : ''}</div><div class="sub">${esc(sub)}</div></div></div>`;
    tools = `<button class="icon-btn" data-act="call-voice" data-tip="Start voice call">${icon('phone')}</button>
      <button class="icon-btn" data-act="call-video-start" data-tip="Start video call">${icon('video')}</button>
      <button class="icon-btn ${S.panel?.type === 'pins' ? 'active' : ''}" data-act="pins" data-tip="Pinned messages">${icon('pin', 'sm')}</button>
      ${dm.type === 'group' ? `<button class="icon-btn" data-act="add-to-group" data-tip="Add friends">${icon('userPlus', 'sm')}</button><button class="icon-btn ${S.showMembers ? 'active' : ''}" data-act="toggle-members" data-tip="Members">${icon('users', 'sm')}</button>` : ''}
      <input class="search" id="msg-search" placeholder="Search">`;
  } else {
    const ch = sd.channels.find((c) => c.id === cid);
    head = `<div class="t">${icon('room', 'sm')} ${esc(ch.name)}</div>${ch.topic ? `<div class="topic" data-tip="${esc(ch.topic)}">${esc(ch.topic)}</div>` : ''}`;
    tools = `<button class="icon-btn ${S.panel?.type === 'pins' ? 'active' : ''}" data-act="pins" data-tip="Pinned messages">${icon('pin', 'sm')}</button>
      <button class="icon-btn ${S.showMembers ? 'active' : ''}" data-act="toggle-members" data-tip="Member list">${icon('users', 'sm')}</button>
      <input class="search" id="msg-search" placeholder="Search">`;
  }
  main.innerHTML = `<header class="main-head">${mobileBtn()}${head}<div class="tools">${tools}</div></header>
    <div class="content"><div class="chat" id="chat">
      <div id="stage-slot"></div>
      <div class="messages" id="messages"><div class="spacer"></div></div>
      <div class="typing" id="typing"></div>
      <div class="composer-wrap" id="composer-wrap"></div>
    </div><div id="right-slot" style="display:contents"></div></div>`;
  const box = $('#messages');
  box.addEventListener('scroll', () => {
    S.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (box.scrollTop < 60 && S.messages[cid]?.hasMore && !S.messages[cid].loading) loadMore(cid);
  });
  box.addEventListener('load', () => { if (S.stick) box.scrollTop = box.scrollHeight; }, true);
  box.addEventListener('dblclick', onMsgDblClick);
  setupDrop($('#chat'));
  $('#msg-search').onkeydown = (e) => { if (e.key === 'Enter') searchMessages(e.target.value); if (e.key === 'Escape') { e.target.value = ''; S.panel = null; renderRight(); } };
  renderComposer(); updateStage(); renderRight(); renderTyping();
  S.stick = true;
  if (S.messages[cid]) { renderMessages({ bottom: true }); } else loadMessages(cid);
  markRead(cid);
}
async function loadMessages(cid) {
  S.messages[cid] = { list: [], hasMore: false, loading: true, loaded: false };
  renderMessages();
  try {
    const r = await api('GET', `/api/channels/${cid}/messages`);
    S.messages[cid] = { list: r.messages, hasMore: r.hasMore, loading: false, loaded: true };
    r.messages.forEach((m) => cacheUser(m.author));
    if (S.view.channelId === cid) renderMessages({ bottom: true });
  } catch (e) { toast(e.message, true); }
}
async function loadMore(cid) {
  const st = S.messages[cid]; if (!st || st.loading || !st.hasMore) return;
  st.loading = true;
  try {
    const r = await api('GET', `/api/channels/${cid}/messages?before=${st.list[0]?.createdAt || Date.now()}`);
    st.list = r.messages.concat(st.list); st.hasMore = r.hasMore;
    if (S.view.channelId === cid) renderMessages({ prepend: true });
  } finally { st.loading = false; }
}
function introHtml() {
  const v = S.view;
  if (v.type === 'dm') {
    const dm = S.dms.find((d) => d.id === v.dmId);
    const u = dm.type === 'dm' ? dm.recipients[0] : null;
    return `<div class="chat-intro">${dmAvatar(dm, 96)}<div class="big">${esc(dmName(dm))}</div>
      ${u ? `<div class="muted">@${esc(u.username)} · on lumi</div><div class="muted small">This is the beginning of your messages with ${esc(u.displayName)}.</div>
      <button class="btn" style="margin-top:8px" data-act="profile" data-user="${u.id}">View profile</button>` : `<div class="muted small">Welcome to the beginning of the group.</div>`}</div>`;
  }
  const sd = currentServer(); const ch = sd.channels.find((c) => c.id === v.channelId);
  return `<div class="chat-intro"><div class="hash">${icon('room')}</div><div class="big">Welcome to ${esc(ch.name)}!</div><div class="muted">This is the very beginning of ${esc(ch.name)}${ch.topic ? ' — ' + esc(ch.topic) : '.'}</div></div>`;
}
function renderMessages(opts = {}) {
  const box = $('#messages'); if (!box) return;
  const cid = S.view.channelId; const st = S.messages[cid];
  if (!st || !st.loaded) { box.innerHTML = '<div class="spacer"></div><div class="empty"><div class="muted">Loading…</div></div>'; return; }
  const prevH = box.scrollHeight, prevTop = box.scrollTop;
  const atBottom = S.stick !== false;
  const groups = []; let lastDay = null, g = null;
  for (const m of st.list) {
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) { groups.push({ day: m.createdAt }); lastDay = day; g = null; }
    if (g && g.author.id === m.author.id && m.createdAt - g.last < 5 * 60e3) { g.msgs.push(m); g.last = m.createdAt; }
    else { g = { author: m.author, msgs: [m], last: m.createdAt }; groups.push(g); }
  }
  let html = '<div class="spacer"></div>' + (st.hasMore ? `<button class="btn ghost load-more" data-act="load-more">Load earlier messages</button>` : introHtml());
  html += groups.map((g) => (g.day ? `<div class="day">${fmtDay(g.day)}</div>` : groupHtml(g))).join('');
  box.innerHTML = html;
  if (opts.bottom || atBottom) box.scrollTop = box.scrollHeight;
  else if (opts.prepend) box.scrollTop = box.scrollHeight - prevH + prevTop;
  else box.scrollTop = prevTop;
}
function groupHtml(g) {
  const me = g.author.id === S.me.id;
  const sd = currentServer();
  const dm = S.view.type === 'dm' ? S.dms.find((d) => d.id === S.view.dmId) : null;
  const showAuthor = !me && (sd || dm?.type === 'group');
  const mi = memberInfo(sd, g.author.id);
  const author = S.userCache[g.author.id] || g.author;
  const topRole = mi.roles[0];
  return `<div class="msg-group ${me ? 'me' : ''}">
    ${!me ? `<div class="gav" data-user="${author.id}">${avatar(author, 28)}</div>` : ''}
    <div class="stack">${showAuthor ? `<div class="author" data-user="${author.id}"><b style="${mi.color ? `color:${mi.color}` : ''}">${esc(mi.name)}</b>${roleBadge(author)}${mi.owner ? `<span style="color:var(--yellow)">${icon('crown', 'xs')}</span>` : ''}${topRole ? `<span class="role-tag" style="background:${esc(topRole.color)}">${esc(topRole.name)}</span>` : ''}<span>${fmtTime(g.msgs[0].createdAt)}</span></div>` : ''}
    ${g.msgs.map((m, i) => msgHtml(m, i === 0, i === g.msgs.length - 1)).join('')}</div></div>`;
}
function msgHtml(m, first, last) {
  const mentioned = m.author.id !== S.me.id && new RegExp(`(^|\\s)@(${S.me.username.replace('.', '\\.')}|everyone|here)\\b`, 'i').test(m.content);
  let att = '';
  if (m.attachment) {
    const a = m.attachment;
    if (a.type === 'image') att = `<div class="attach"><img src="${esc(a.url)}" alt="${esc(a.name || '')}" data-zoom></div>`;
    else if (a.type === 'video') att = `<div class="attach"><video src="${esc(a.url)}" controls preload="metadata"></video></div>`;
    else if (a.type === 'audio') att = `<div class="attach"><audio src="${esc(a.url)}" controls></audio></div>`;
    else att = `<div class="attach"><a class="file" href="${esc(a.url)}" target="_blank" download="${esc(a.name || 'file')}">${icon('file')}<span>${esc(a.name || 'file')}</span>${icon('back', 'sm').replace('class="i sm"', 'class="i sm" style="transform:rotate(-90deg)"')}</a></div>`;
  }
  const reply = m.reply ? `<div class="reply-ref" data-jump="${m.reply.id}"><span>${icon('reply', 'xs')} ${m.author.id === S.me.id ? 'You' : esc(m.author.displayName)} replied to ${m.reply.author?.id === S.me.id ? 'you' : esc(m.reply.author?.displayName || 'a message')}</span><div class="q">${esc(m.reply.content || (m.reply.attachmentType ? '📎 Attachment' : ''))}</div></div>` : '';
  const reacts = m.reactions.length ? `<div class="reacts">${m.reactions.map((r) => `<button class="react ${r.users.includes(S.me.id) ? 'mine' : ''}" data-react="${esc(r.emoji)}" data-tip="${esc(r.users.map((u) => S.userCache[u]?.displayName || 'someone').slice(0, 5).join(', '))}">${r.emoji}${r.users.length > 1 ? `<b>${r.users.length}</b>` : ''}</button>`).join('')}</div>` : '';
  return `<div class="msg ${first ? 'first' : ''} ${last ? 'last' : ''} ${mentioned ? 'mentioned' : ''}" data-mid="${m.id}">
    ${reply}${m.pinned ? `<div class="pinned-tag">${icon('pin', 'xs')} Pinned</div>` : ''}${att}
    ${m.content ? `<div class="bubble ${isJumbo(m.content) ? 'jumbo' : ''}">${md(m.content)}</div>` : ''}
    ${m.editedAt ? '<div class="edited">Edited</div>' : ''}${reacts}
    <div class="actions"><button data-act="react" data-tip="React">${icon('smile', 'sm')}</button><button data-act="reply" data-tip="Reply">${icon('reply', 'sm')}</button><button data-act="msg-more" data-tip="More">${icon('more', 'sm')}</button></div>
    <span class="time">${fmtTime(m.createdAt)}</span></div>`;
}
function findMsg(id) { for (const st of Object.values(S.messages)) { const m = st.list?.find((x) => x.id === id); if (m) return m; } return null; }
function upsertMessage(m) {
  const st = S.messages[m.channelId]; if (!st) return;
  const i = st.list.findIndex((x) => x.id === m.id);
  if (i >= 0) st.list[i] = m; else st.list.push(m);
}
function onMsgDblClick(e) {
  const b = e.target.closest('.bubble, .attach img'); if (!b) return;
  const msg = b.closest('.msg'); window.getSelection()?.removeAllRanges();
  const pop = h('<span class="heart-pop">✨</span>'); msg.appendChild(pop); setTimeout(() => pop.remove(), 800);
  api('POST', `/api/messages/${msg.dataset.mid}/reactions`, { emoji: '✨', force: 'add' }).catch((e) => toast(e.message, true));
}
function messageMenu(btn, m) {
  const mine = m.author.id === S.me.id;
  const sd = currentServer();
  const canManage = sd ? can(sd, P.MANAGE_MESSAGES) : false;
  const canPin = sd ? canManage : true;
  const el = btn.closest('.msg'); el.classList.add('menu-open');
  openMenu(btn, [
    { html: `<div class="quick-react">${QUICK.map((q) => `<button>${q}</button>`).join('')}</div>`, mount: (x) => x.querySelectorAll('button').forEach((b) => (b.onclick = () => { closeMenu(); react(m.id, b.textContent); })) },
    { label: 'Reply', icon: 'reply', onClick: () => startReply(m) },
    mine && m.content !== undefined && { label: 'Edit message', icon: 'edit', onClick: () => startEdit(m.id) },
    canPin && { label: m.pinned ? 'Unpin message' : 'Pin message', icon: 'pin', onClick: () => api('POST', `/api/messages/${m.id}/pin`).catch((e) => toast(e.message, true)) },
    m.content && { label: 'Copy text', icon: 'copy', onClick: () => copyText(m.content) },
    !mine && { label: 'View profile', icon: 'user', onClick: () => openProfile(m.author.id, S.view.serverId) },
    (mine || canManage) && 'sep',
    (mine || canManage) && { label: 'Delete message', icon: 'trash', danger: true, onClick: () => deleteMessage(m) },
  ], { onClose: () => el.classList.remove('menu-open') });
}
async function deleteMessage(m) {
  if (!(await confirmDialog('Delete message', 'Are you sure you want to delete this message? This can’t be undone.', 'Delete'))) return;
  try { await api('DELETE', `/api/messages/${m.id}`); } catch (e) { toast(e.message, true); }
}
function react(mid, emoji) { api('POST', `/api/messages/${mid}/reactions`, { emoji }).catch((e) => toast(e.message, true)); }
function startReply(m) { S.replyTo = m; renderComposerExtras(); $('#msg-input')?.focus(); }
function startEdit(mid) {
  const m = findMsg(mid); const el = $(`.msg[data-mid="${mid}"]`); if (!m || !el) return;
  const bubble = el.querySelector('.bubble'); if (!bubble) return;
  const ta = h(`<textarea class="textarea" style="min-height:44px;min-width:260px;border-radius:18px"></textarea>`); ta.value = m.content;
  bubble.replaceWith(ta);
  const hint = h(`<div class="small muted" style="margin:2px 10px">Enter to save · Esc to cancel</div>`); ta.after(hint);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.onkeydown = async (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); renderMessages(); }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); const v = ta.value;
      if (v === m.content) return renderMessages();
      if (!v.trim()) { renderMessages(); return deleteMessage(m); }
      try { const r = await api('PATCH', `/api/messages/${mid}`, { content: v }); upsertMessage(r.message); renderMessages(); } catch (err) { toast(err.message, true); }
    }
  };
}
function jumpTo(mid) {
  const el = $(`.msg[data-mid="${mid}"]`);
  if (!el) return toast('That message is further back — scroll up to load it.');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ---------- typing
function renderTyping() {
  const el = $('#typing'); if (!el) return;
  const m = S.typing[S.view.channelId];
  const ids = m ? [...m.keys()].filter((id) => id !== S.me.id) : [];
  if (!ids.length) return (el.innerHTML = '');
  const sd = currentServer();
  const names = ids.map((id) => memberInfo(sd, id).name);
  const text = names.length === 1 ? `<b>${esc(names[0])}</b> is typing` : names.length <= 3 ? `<b>${names.map(esc).join(', ')}</b> are typing` : 'Several people are typing';
  el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span>${text}…</span>`;
}

// ---------- composer
function renderComposer() {
  const wrap = $('#composer-wrap'); if (!wrap) return;
  const sd = currentServer(); const v = S.view;
  const allowed = sd ? can(sd, P.SEND_MESSAGES) : true;
  let ph = 'Message…';
  if (sd) ph = allowed ? `Message ${sd.channels.find((c) => c.id === v.channelId)?.name}` : 'You can’t send messages in this room';
  else { const dm = S.dms.find((d) => d.id === v.dmId); ph = `Message ${dmName(dm)}…`; }
  wrap.innerHTML = `<div id="composer-extras"></div><div class="composer ${allowed ? '' : 'disabled'}">
    <button class="icon-btn" data-act="emoji" data-tip="Emoji">${icon('smile')}</button>
    <textarea id="msg-input" rows="1" placeholder="${esc(ph)}" maxlength="4000"></textarea>
    <span id="composer-right" style="display:flex;align-items:center"></span></div>`;
  const ta = $('#msg-input');
  const draftKey = 'lumi.draft.' + v.channelId;
  ta.value = sessionStorage.getItem(draftKey) || '';
  let lastTyping = 0;
  ta.oninput = () => {
    autosize(ta); renderComposerRight(); sessionStorage.setItem(draftKey, ta.value);
    if (ta.value && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); socket.emit('typing', { channelId: v.channelId }); }
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    if (e.key === 'ArrowUp' && !ta.value) {
      const mine = (S.messages[v.channelId]?.list || []).filter((m) => m.author.id === S.me.id && m.content).pop();
      if (mine) { e.preventDefault(); startEdit(mine.id); }
    }
  };
  ta.onpaste = (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); attachFile(f); } };
  autosize(ta); renderComposerRight(); renderComposerExtras();
  if (matchMedia('(pointer:fine)').matches) ta.focus();
}
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; }
function renderComposerRight() {
  const el = $('#composer-right'); if (!el) return;
  const has = $('#msg-input').value.trim() || S.pending;
  el.innerHTML = has
    ? `<button class="send" data-act="send" data-tip="Send" ${S.pending?.uploading ? 'disabled' : ''}>${icon('arrowUp', 'sm')}</button>`
    : `<button class="icon-btn" data-act="attach" data-tip="Photo, video or file">${icon('image')}</button>`;
}
function renderComposerExtras() {
  const el = $('#composer-extras'); if (!el) return;
  let html = '';
  if (S.replyTo) html += `<div class="reply-bar">${icon('reply', 'sm')}<span class="q">Replying to <b>${esc(S.replyTo.author.displayName)}</b> — ${esc(S.replyTo.content || 'Attachment')}</span><button class="icon-btn" data-act="cancel-reply" style="width:28px;height:28px">${icon('x', 'sm')}</button></div>`;
  if (S.pending) {
    const p = S.pending;
    const prev = p.type === 'image' ? `<img src="${esc(p.preview)}">` : p.type === 'video' ? `<video src="${esc(p.preview)}"></video>` : `<div style="width:48px;height:48px;display:grid;place-items:center;background:var(--bg3);border-radius:10px">${icon('file')}</div>`;
    html += `<div class="pending">${prev}<span class="fname">${esc(p.name)}${p.uploading ? ' — uploading…' : ''}</span><button class="icon-btn" data-act="cancel-attach">${icon('x', 'sm')}</button></div>`;
  }
  el.innerHTML = html;
  $('.composer')?.classList.toggle('joined', !!html);
  renderComposerRight();
}
async function attachFile(file) {
  const sd = currentServer();
  if (sd && !can(sd, P.ATTACH_FILES)) return toast('You cannot attach files in this channel.', true);
  const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
  const p = S.pending = { name: file.name, type, preview: URL.createObjectURL(file), uploading: true };
  renderComposerExtras();
  try { p.uploaded = await uploadFile(file); p.uploading = false; if (S.pending === p) renderComposerExtras(); }
  catch (e) { toast(e.message, true); if (S.pending === p) { S.pending = null; renderComposerExtras(); } }
}
function setupDrop(el) {
  let depth = 0, ov = null;
  el.addEventListener('dragenter', (e) => { if (![...e.dataTransfer.types].includes('Files')) return; depth++; if (!ov) { ov = h('<div class="drop-overlay"><div>Drop to share</div></div>'); el.style.position = 'relative'; el.appendChild(ov); } });
  el.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; ov?.remove(); ov = null; } });
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; ov?.remove(); ov = null; const f = e.dataTransfer.files[0]; if (f) attachFile(f); });
}
async function sendMessage(override) {
  const ta = $('#msg-input'); const cid = S.view.channelId;
  const content = override ?? ta.value;
  if (!content.trim() && !S.pending) return;
  if (S.pending?.uploading) return toast('Hang on — still uploading.');
  const body = { content, replyTo: S.replyTo?.id, attachment: S.pending?.uploaded };
  if (override === undefined) { ta.value = ''; autosize(ta); sessionStorage.removeItem('lumi.draft.' + cid); }
  S.replyTo = null; S.pending = null; renderComposerExtras();
  S.stick = true;
  try { const r = await api('POST', `/api/channels/${cid}/messages`, body); upsertMessage(r.message); if (S.view.channelId === cid) renderMessages({ bottom: true }); bumpDM(r.message); }
  catch (e) { toast(e.message, true); if (override === undefined && !ta.value) ta.value = content; }
}
function bumpDM(m) {
  const d = S.dms.find((d) => d.id === m.channelId); if (!d) return;
  d.lastMessage = { content: m.content, authorId: m.author.id, createdAt: m.createdAt, attachmentType: m.attachment?.type };
  d.lastActivity = m.createdAt; S.dms.sort((a, b) => b.lastActivity - a.lastActivity);
  if (S.view.type !== 'server') renderSideBody();
}
let readTimer = null;
function markRead(cid) {
  const d = S.dms.find((d) => d.id === cid);
  if (d && d.unread) { d.unread = 0; renderRail(); renderSideBody(); updateTitle(); }
  const sd = currentServer();
  const c = sd?.channels.find((c) => c.id === cid);
  if (c && c.unread) { c.unread = 0; const s = S.servers.find((s) => s.id === sd.server.id); if (s) s.unread = sd.channels.reduce((a, c) => a + (c.unread || 0), 0); renderRail(); renderSideBody(); }
  clearTimeout(readTimer); readTimer = setTimeout(() => api('POST', `/api/channels/${cid}/read`).catch(() => {}), 400);
}

// ---------- right panel: members / pins / search
function renderRight() {
  const slot = $('#right-slot'); if (!slot) return;
  if (S.panel) {
    const p = S.panel;
    slot.innerHTML = `<div class="panel"><div class="panel-head"><span>${p.type === 'pins' ? 'Pinned' : `Results for “${esc(p.q)}”`}</span><button class="icon-btn" data-act="close-panel">${icon('x', 'sm')}</button></div>
      <div class="panel-body">${p.loading ? '<div class="muted" style="padding:12px">Loading…</div>' : p.items.length ? p.items.map((m) => `<div class="panel-item" data-jump="${m.id}"><div class="h">${avatar(m.author, 22)}<b>${esc(m.author.displayName)}</b><span class="muted small">${fmtDay(m.createdAt)} ${fmtTime(m.createdAt)}</span></div><div class="b">${m.content ? md(m.content) : '📎 Attachment'}</div></div>`).join('') : `<div class="empty" style="padding:40px 10px"><div class="art">${icon(p.type === 'pins' ? 'pin' : 'search')}</div><p>${p.type === 'pins' ? 'No pinned messages yet. Pin important stuff from the message menu.' : 'No messages matched.'}</p></div>`}</div></div>`;
    return;
  }
  const sd = currentServer();
  const dm = S.view.type === 'dm' ? S.dms.find((d) => d.id === S.view.dmId) : null;
  if (!S.showMembers || (!sd && dm?.type !== 'group')) return (slot.innerHTML = '');
  let html = '<aside class="members">';
  if (dm) {
    html += `<div class="grp">Members — ${dm.members.length}</div>` + dm.members.map((u) => memberRow(S.userCache[u.id] || u, null, dm.ownerId === u.id)).join('');
  } else {
    const roles = sd.roles.filter((r) => r.hoist && !r.isDefault);
    const placed = new Set(); const groups = [];
    for (const r of roles) {
      const ms = sd.members.filter((m) => !placed.has(m.user.id) && isOnline(m.user.id) && m.roleIds.includes(r.id));
      ms.forEach((m) => placed.add(m.user.id)); if (ms.length) groups.push([r.name, ms]);
    }
    const online = sd.members.filter((m) => !placed.has(m.user.id) && isOnline(m.user.id));
    const offline = sd.members.filter((m) => !isOnline(m.user.id));
    if (online.length) groups.push(['Here now', online]);
    if (offline.length) groups.push(['Away', offline]);
    for (const [name, ms] of groups) {
      ms.sort((a, b) => memberInfo(sd, a.user.id).name.localeCompare(memberInfo(sd, b.user.id).name));
      html += `<div class="grp">${esc(name)} — ${ms.length}</div>` + ms.map((m) => memberRow(S.userCache[m.user.id] || m.user, sd, sd.server.ownerId === m.user.id)).join('');
    }
  }
  slot.innerHTML = html + '</aside>';
}
function memberRow(u, sd, owner) {
  const mi = memberInfo(sd, u.id); const on = isOnline(u.id);
  const inVoice = sd && sd.channels.some((c) => c.type === 'voice' && (S.voice[c.id] || []).some((p) => p.userId === u.id));
  return `<div class="member ${on ? '' : 'off'}" data-user="${u.id}">${avatar(u, 34, { dot: true })}<div style="min-width:0"><div class="n"><span style="${mi.color ? `color:${mi.color}` : ''};overflow:hidden;text-overflow:ellipsis">${esc(mi.name)}</span>${roleBadge(u)}${owner ? `<span class="crown" data-tip="Owner">${icon('crown', 'xs')}</span>` : ''}</div>
    <div class="s">${inVoice ? `<span style="color:var(--green)">${icon('waves', 'xs')} In a lounge</span>` : esc(u.customStatus || '')}</div></div></div>`;
}
async function openPins() {
  if (S.panel?.type === 'pins') { S.panel = null; return renderAll(); }
  S.panel = { type: 'pins', loading: true, items: [] }; renderRight(); $('[data-act=pins]')?.classList.add('active');
  try { const r = await api('GET', `/api/channels/${S.view.channelId}/pins`); if (S.panel?.type === 'pins') { S.panel = { type: 'pins', items: r.messages }; renderRight(); } } catch (e) { toast(e.message, true); }
}
async function searchMessages(q) {
  q = q.trim(); if (!q) return;
  S.panel = { type: 'search', q, loading: true, items: [] }; renderRight();
  try { const r = await api('GET', `/api/channels/${S.view.channelId}/messages?q=${encodeURIComponent(q)}`); S.panel = { type: 'search', q, items: r.messages.reverse() }; renderRight(); } catch (e) { toast(e.message, true); }
}

// ---------- main click delegation
async function onMainClick(e) {
  const t = e.target.closest('[data-act],[data-tab],[data-user],[data-react],[data-jump],[data-zoom],[data-story],[data-fid],[data-dm]');
  if (!t) return;
  const act = t.dataset.act;
  const msgEl = t.closest('.msg'); const m = msgEl && findMsg(msgEl.dataset.mid);
  if (t.dataset.tab) { S.homeTab = t.dataset.tab; return renderHome($('#main')); }
  if (t.dataset.story) { return t.dataset.story === 'me' ? myStoryClick(t) : openStoryViewer(t.dataset.story); }
  if (t.dataset.zoom !== undefined) return lightbox(t.src);
  if (t.dataset.react && m) return react(m.id, t.dataset.react);
  if (t.dataset.jump) return jumpTo(t.dataset.jump);
  switch (act) {
    case 'drawer': return $('#app').classList.toggle('drawer');
    case 'send': return sendMessage();
    case 'send-heart': return sendMessage('✨');
    case 'attach': { const f = await pickFile('*/*'); if (f) attachFile(f); return; }
    case 'emoji': return emojiPicker(t, (em) => { const ta = $('#msg-input'); const s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, s) + em + ta.value.slice(ta.selectionEnd ?? s); ta.focus(); ta.setSelectionRange(s + em.length, s + em.length); ta.oninput(); }, { keepOpen: true });
    case 'cancel-reply': S.replyTo = null; return renderComposerExtras();
    case 'cancel-attach': S.pending = null; return renderComposerExtras();
    case 'react': return openMenu(t, [{ html: `<div class="quick-react">${QUICK.map((q) => `<button>${q}</button>`).join('')}</div>`, mount: (x) => x.querySelectorAll('button').forEach((b) => (b.onclick = () => { closeMenu(); react(m.id, b.textContent); })) },
      { html: `<div class="emoji-pick">${EMOJIS.map((e) => `<button>${e}</button>`).join('')}</div>`, mount: (x) => x.querySelectorAll('button').forEach((b) => (b.onclick = () => { closeMenu(); react(m.id, b.textContent); })) }]);
    case 'reply': return startReply(m);
    case 'msg-more': return messageMenu(t, m);
    case 'load-more': return loadMore(S.view.channelId);
    case 'pins': return openPins();
    case 'close-panel': S.panel = null; return renderRight();
    case 'toggle-members': S.showMembers = !S.showMembers; localStorage.setItem('lumi.members', S.showMembers ? '1' : '0'); S.panel = null; t.classList.toggle('active', S.showMembers); return renderRight();
    case 'invite': return openInvite(S.view.serverId);
    case 'new-chan': return openChannelModal(S.view.serverId);
    case 'call-voice': return joinCall(S.view.channelId, { video: false });
    case 'call-video-start': return joinCall(S.view.channelId, { video: true });
    case 'join-voice': return joinCall(S.view.channelId, { video: false });
    case 'join-video': return joinCall(S.view.channelId, { video: true });
    case 'add-to-group': return openNewGroup(S.view.dmId);
    case 'group-settings': return groupMenu(t);
    case 'copy-username': return copyText(S.me.username, 'Username copied');
  }
  const fidEl = e.target.closest('[data-fid]');
  if (fidEl) {
    const uid = fidEl.dataset.fid;
    if (act === 'dm') return openDM(uid);
    if (act === 'call') { const d = await openDM(uid); if (d) joinCall(d.id); return; }
    if (act === 'accept') { await api('POST', `/api/friends/${uid}/accept`).catch((e) => toast(e.message, true)); return; }
    if (act === 'decline') { await api('DELETE', `/api/friends/${uid}`).catch((e) => toast(e.message, true)); return; }
    if (act === 'unblock') { await api('DELETE', `/api/friends/${uid}/block`); return; }
    if (act === 'fmore') return friendMenu(t, uid);
    return openProfile(uid);
  }
  if (t.dataset.dm) return navigate('/channels/@me/' + t.dataset.dm);
  if (t.dataset.user) return openProfile(t.dataset.user, S.view.serverId);
}
function friendMenu(anchor, uid) {
  const u = S.userCache[uid];
  openMenu(anchor, [
    { label: 'Start video call', icon: 'video', onClick: async () => { const d = await openDM(uid, true); if (d) joinCall(d.id, { video: true }); } },
    { label: 'View profile', icon: 'user', onClick: () => openProfile(uid) },
    'sep',
    { label: 'Remove friend', icon: 'x', danger: true, onClick: async () => { if (await confirmDialog(`Remove '${u.displayName}'`, `Are you sure you want to remove <b>${esc(u.displayName)}</b> from your friends?`, 'Remove Friend')) api('DELETE', `/api/friends/${uid}`); } },
    { label: 'Block', icon: 'block', danger: true, onClick: () => blockUser(uid) },
  ], { align: 'right' });
}
async function blockUser(uid) {
  const u = S.userCache[uid];
  if (!(await confirmDialog(`Block @${u.username}?`, "They won't be able to message or call you, and they'll be removed from your friends.", 'Block'))) return;
  await api('POST', `/api/friends/${uid}/block`).catch((e) => toast(e.message, true));
}
async function openDM(uid, silent) {
  try {
    const r = await api('POST', '/api/dms', { userId: uid });
    const i = S.dms.findIndex((d) => d.id === r.dm.id);
    if (i >= 0) S.dms[i] = r.dm; else S.dms.unshift(r.dm);
    layers.slice().forEach((l) => l.close());
    navigate('/channels/@me/' + r.dm.id);
    return r.dm;
  } catch (e) { toast(e.message, true); }
}
function groupMenu(anchor) {
  const dm = S.dms.find((d) => d.id === S.view.dmId);
  openMenu(anchor, [
    { label: 'Rename group', icon: 'edit', onClick: async () => { const n = await promptDialog('Rename group', 'Group name', dm.name || ''); if (n !== null) api('PATCH', `/api/dms/${dm.id}`, { name: n }); } },
    { label: 'Change group photo', icon: 'image', onClick: async () => { const f = await pickFile(); if (!f) return; const u = await uploadFile(f); api('PATCH', `/api/dms/${dm.id}`, { icon: u.url }); } },
    { label: 'Add friends', icon: 'userPlus', onClick: () => openNewGroup(dm.id) },
    'sep',
    { label: 'Leave group', icon: 'logout', danger: true, onClick: async () => { if (await confirmDialog('Leave group', `Leave <b>${esc(dmName(dm))}</b>? You won't get its messages anymore.`, 'Leave')) { await api('DELETE', `/api/dms/${dm.id}`); S.dms = S.dms.filter((d) => d.id !== dm.id); navigate('/channels/@me'); } } },
  ]);
}
