/* modals: servers, invites, settings, roles, profiles, groups, stories */
'use strict';

// ------------------------------------------------------------------ create / join server
function openCreateServer(start = 'create') {
  const templates = [['default', 'users', 'Friends', 'A hangout for your group'], ['gaming', 'gamepad', 'Gaming', 'Squads, clips and voice'], ['study', 'book', 'Study group', 'Questions, notes and focus'], ['default', 'room', 'Something else', 'Start with the basics']];
  let tpl = 'default', iconUrl = null;
  const m = openModal({ title: start === 'join' ? 'Join a community' : 'Create a community', body: '<div id="cs"></div>' });
  const body = m.el.querySelector('#cs');
  const step1 = () => {
    m.el.querySelector('.modal-head span').textContent = 'Create a community';
    body.innerHTML = `<p class="muted" style="margin:0 0 16px">Pick a starting point. You can rename, add or remove anything later.</p>
      <div class="tpl-list">${templates.map(([k, ic, l, d], i) => `<button class="tpl" data-i="${i}"><span class="tpl-ic">${icon(ic, 'sm')}</span><span class="tpl-t"><b>${l}</b><span>${d}</span></span>${icon('chevron', 'sm').replace('class="i sm"', 'class="i sm tpl-go"')}</button>`).join('')}</div>
      <div class="or">or</div><button class="btn block lg" data-join>Join with an invite</button>`;
    body.querySelectorAll('.tpl').forEach((b) => (b.onclick = () => { tpl = templates[b.dataset.i][0]; step2(templates[b.dataset.i]); }));
    body.querySelector('[data-join]').onclick = joinStep;
  };
  const step2 = ([, , label]) => {
    m.el.querySelector('.modal-head span').textContent = 'Name your community';
    body.innerHTML = `<p class="muted" style="margin:0 0 18px;text-align:center">Add a name and an icon. You can change both later.</p>
      <div style="display:flex;justify-content:center;margin-bottom:18px"><div class="ring" style="cursor:pointer" id="cs-icon"><div class="av" style="width:88px;height:88px;font-size:88px;background:var(--bg3);color:var(--text2)"><div class="ph" style="--ph:var(--bg3);color:var(--text2);font-size:12px">${icon('image')}<br>Upload</div></div></div></div>
      <div class="field"><label>Community name</label><input class="input" id="cs-name" value="${esc(S.me.displayName)}'s ${esc(label === 'Friends' ? 'hangout' : label === 'Something else' ? 'place' : label.toLowerCase())}" maxlength="100" autofocus></div>
      <div style="display:flex;gap:8px;margin-top:20px"><button class="btn" data-back>Back</button><button class="btn grad" style="flex:1" data-create>Create</button></div>`;
    body.querySelector('#cs-icon').onclick = async () => {
      const f = await pickFile(); if (!f) return;
      try { iconUrl = (await uploadFile(f)).url; body.querySelector('#cs-icon .av').innerHTML = `<img src="${esc(iconUrl)}">`; } catch (e) { toast(e.message, true); }
    };
    body.querySelector('[data-back]').onclick = step1;
    const go = async () => {
      const name = body.querySelector('#cs-name').value.trim(); if (!name) return toast('Name your community', true);
      try {
        const d = await api('POST', '/api/servers', { name, icon: iconUrl, template: tpl });
        S.serverData[d.server.id] = d; S.servers.push({ id: d.server.id, name: d.server.name, icon: d.server.icon, unread: 0 });
        m.close(); navigate(`/channels/${d.server.id}`); setTimeout(() => openInvite(d.server.id), 400);
      } catch (e) { toast(e.message, true); }
    };
    body.querySelector('[data-create]').onclick = go;
    body.querySelector('#cs-name').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    setTimeout(() => body.querySelector('#cs-name').select(), 30);
  };
  const joinStep = () => {
    m.el.querySelector('.modal-head span').textContent = 'Join a community';
    body.innerHTML = `<p class="muted" style="margin:0 0 18px;text-align:center">Paste an invite link to join a community.</p>
      <div class="field"><label>Invite link</label><input class="input" id="js-code" placeholder="${location.origin}/invite/bEZthpx" autofocus></div>
      <p class="hint">Invites look like <b>bEZthpx</b> or <b>${location.host}/invite/bEZthpx</b></p>
      <div style="display:flex;gap:8px;margin-top:20px"><button class="btn" data-back>Back</button><button class="btn primary" style="flex:1" data-go>Join community</button></div>`;
    body.querySelector('[data-back]').onclick = step1;
    const go = () => { const raw = body.querySelector('#js-code').value.trim(); const code = raw.split('/').filter(Boolean).pop(); if (!code) return; m.close(); openInviteAccept(code); };
    body.querySelector('[data-go]').onclick = go;
    body.querySelector('#js-code').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    setTimeout(() => body.querySelector('#js-code').focus(), 30);
  };
  start === 'join' ? joinStep() : step1();
}

// ------------------------------------------------------------------ invites
async function openInvite(sid) {
  const sd = S.serverData[sid] || await loadServer(sid);
  if (!can(sd, P.CREATE_INVITE)) return toast("You don't have permission to invite people here.", true);
  let code = null, sent = new Set();
  const friends = S.friends.filter((f) => f.type === 'friend').map((f) => S.userCache[f.user.id] || f.user).filter((u) => !sd.members.some((m) => m.user.id === u.id));
  const m = openModal({ title: `Invite friends to ${sd.server.name}`, body: `
    <input class="input" id="inv-q" placeholder="Search for friends" style="margin-bottom:10px">
    <div id="inv-friends" style="max-height:240px;overflow-y:auto;margin:0 -6px 16px"></div>
    <div class="field" style="margin:0"><label>Or share an invite link</label>
    <div class="invite-link"><input id="inv-link" readonly value="Generating…"><button class="btn primary" data-copy>Copy</button></div></div>
    <p class="hint" id="inv-hint">Your invite link expires in 7 days. <button class="btn link" data-edit>Edit invite link.</button></p>` });
  const el = m.el;
  const make = async (opts = {}) => {
    try { const r = await api('POST', `/api/servers/${sid}/invites`, opts); code = r.code; el.querySelector('#inv-link').value = `${location.origin}/invite/${code}`; }
    catch (e) { toast(e.message, true); }
  };
  const renderFriends = () => {
    const q = el.querySelector('#inv-q').value.toLowerCase();
    const list = friends.filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.includes(q));
    el.querySelector('#inv-friends').innerHTML = list.length ? list.map((u) => `<div class="row-line" style="padding:8px 6px;border:0">${avatar(u, 38, { dot: true })}<div class="meta"><div class="bold">${esc(u.displayName)}</div><div class="small muted">@${esc(u.username)}</div></div>
      <button class="btn ${sent.has(u.id) ? '' : 'primary'}" data-send="${u.id}" ${sent.has(u.id) ? 'disabled' : ''}>${sent.has(u.id) ? 'Sent' : 'Invite'}</button></div>`).join('')
      : `<div class="muted small" style="padding:8px 6px">${friends.length ? 'No friends match.' : 'All your friends are already here — or add some friends first!'}</div>`;
    el.querySelectorAll('[data-send]').forEach((b) => (b.onclick = async () => {
      if (!code) await make();
      b.disabled = true;
      try {
        const d = await api('POST', '/api/dms', { userId: b.dataset.send });
        if (!S.dms.find((x) => x.id === d.dm.id)) S.dms.unshift(d.dm);
        await api('POST', `/api/channels/${d.dm.id}/messages`, { content: `Come hang out in **${sd.server.name}**! ${location.origin}/invite/${code}` });
        sent.add(b.dataset.send); renderFriends();
      } catch (e) { toast(e.message, true); b.disabled = false; }
    }));
  };
  el.querySelector('#inv-q').oninput = renderFriends; renderFriends();
  el.querySelector('[data-copy]').onclick = (e) => { copyText(el.querySelector('#inv-link').value, 'Invite link copied'); e.target.textContent = 'Copied'; e.target.classList.replace('primary', 'grad'); };
  el.querySelector('[data-edit]').onclick = () => {
    el.querySelector('#inv-hint').innerHTML = `<div style="display:flex;gap:8px;margin-top:8px"><select class="select" id="inv-exp"><option value="1">1 hour</option><option value="24">1 day</option><option value="168" selected>7 days</option><option value="0">Never</option></select>
      <select class="select" id="inv-max"><option value="0">No limit</option><option value="1">1 use</option><option value="5">5 uses</option><option value="10">10 uses</option><option value="25">25 uses</option><option value="100">100 uses</option></select>
      <button class="btn" data-regen>Generate</button></div>`;
    el.querySelector('[data-regen]').onclick = () => make({ expiresInHours: +el.querySelector('#inv-exp').value, maxUses: +el.querySelector('#inv-max').value }).then(() => toast('New invite link generated'));
  };
  make();
}
async function openInviteAccept(code) {
  let d;
  try { d = await api('GET', `/api/invites/${encodeURIComponent(code)}`); }
  catch (e) { return openModal({ title: 'Invite invalid', body: `<div class="empty" style="padding:20px"><div class="art">${icon('link')}</div><h3>This invite may be expired</h3><p>${esc(e.message)}</p></div>` }); }
  const s = d.server;
  const m = openModal({ title: null, body: `<div class="invite-card"><div class="ib" style="${s.banner ? `background-image:url('${esc(s.banner)}')` : ''}"></div>
    <div style="display:inline-block" class="ring"><div class="av" style="width:80px;height:80px;font-size:80px;border:4px solid var(--bg);box-sizing:content-box;border-radius:24px;overflow:hidden;background:var(--bg3);color:var(--text)">${s.icon ? `<img src="${esc(s.icon)}" style="border-radius:20px">` : `<div class="ph" style="border-radius:20px">${esc(initials(s.name))}</div>`}</div></div>
    <p class="muted" style="margin:12px 0 2px">${esc(d.inviter?.displayName || 'Someone')} invited you to join</p>
    <h2 style="margin:0">${esc(s.name)}</h2>${s.description ? `<p class="muted small" style="margin:6px 0 0">${esc(s.description)}</p>` : ''}
    <div class="counts"><span class="on">${s.onlineCount} Online</span><span>${s.memberCount} Members</span></div>
    <button class="btn grad block lg" data-accept>${d.alreadyMember ? 'Open community' : 'Join community'}</button></div>` });
  m.el.querySelector('[data-accept]').onclick = async () => {
    try {
      const sd = await api('POST', `/api/invites/${encodeURIComponent(code)}`);
      S.serverData[sd.server.id] = sd; sd.members.forEach((x) => cacheUser(x.user));
      if (!S.servers.find((x) => x.id === sd.server.id)) S.servers.push({ id: sd.server.id, name: sd.server.name, icon: sd.server.icon, unread: 0 });
      m.close(); navigate(`/channels/${sd.server.id}`); if (!d.alreadyMember) toast(`You joined ${sd.server.name}`);
    } catch (e) { toast(e.message, true); }
  };
}

// ------------------------------------------------------------------ channels
function openChannelModal(sid, cid = null, type = 'text', catId = null) {
  const sd = S.serverData[sid]; const ch = cid ? sd.channels.find((c) => c.id === cid) : null;
  if (ch) { type = ch.type; catId = ch.categoryId; }
  const cats = [...(sd.categories || [])].sort((a, b) => a.position - b.position);
  const PH = { text: 'e.g. Memes', board: 'e.g. Ideas & plans', gallery: 'e.g. Photos', voice: 'e.g. Chill zone' };
  const m = openModal({ title: ch ? `Edit ${ROOM_TYPES[type].label.toLowerCase()}` : 'Add a room', body: `
    <div class="ch-tabs"><button class="sel" data-chtab="general">General</button><button data-chtab="privacy">${icon('lock', 'xs')} Privacy</button></div>
    <div data-chpane="general">
    ${ch ? '' : `<div class="field"><label>What kind of room?</label><div class="choice-grid room-kinds">
      ${['text', 'board', 'gallery', 'voice'].map((k) => `<button class="choice ${type === k ? 'sel' : ''}" data-type="${k}">${icon(ROOM_TYPES[k].icon)}<div><div>${ROOM_TYPES[k].label}</div><div class="small muted" style="font-weight:400">${ROOM_TYPES[k].desc}</div></div></button>`).join('')}</div></div>`}
    <div class="field"><label>Name</label><input class="input" id="ch-name" value="${esc(ch?.name || '')}" placeholder="${PH[type]}" maxlength="100" autofocus></div>
    <div class="field" id="topic-field" ${type === 'voice' ? 'style="display:none"' : ''}><label>Topic</label><textarea class="textarea" id="ch-topic" maxlength="300" placeholder="What’s this room for?">${esc(ch?.topic || '')}</textarea></div>
    ${cats.length ? `<div class="field"><label>Section</label><select class="select" id="ch-cat"><option value="">No section</option>${cats.map((c) => `<option value="${c.id}" ${c.id === catId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
    </div>
    <div data-chpane="privacy" hidden>
    <p class="muted small" style="margin:0 0 6px">“Admins” means the community owner and anyone with a role that has the Administrator permission.</p>
    <div class="perm" id="lock-field" ${type === 'voice' ? 'style="display:none"' : ''}><div><div class="bold">Only admins can post</div><div class="d">Only admins can send messages here. Everyone else can still read and react. Good for announcements and rules.</div></div><label class="switch"><input type="checkbox" id="ch-lock" ${ch?.locked ? 'checked' : ''}><span></span></label></div>
    <div class="perm"><div><div class="bold">Only admins can see</div><div class="d">Hide this room from everyone except admins. Nobody else can see it, read it, post in it${type === 'voice' ? ', or join it' : ''}. Good for staff chat.</div></div><label class="switch"><input type="checkbox" id="ch-admin" ${ch?.adminOnly ? 'checked' : ''}><span></span></label></div>
    </div>`,
    foot: `${ch ? `<button class="btn danger" data-del style="margin-right:auto">${icon('trash', 'sm')} Delete</button>` : ''}<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${ch ? 'Save' : 'Create'}</button>` });
  const el = m.el;
  el.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => { type = b.dataset.type; el.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('sel', x === b)); el.querySelector('#topic-field').style.display = type === 'voice' ? 'none' : ''; el.querySelector('#lock-field').style.display = type === 'voice' ? 'none' : ''; el.querySelector('#ch-name').placeholder = PH[type]; }));
  el.querySelectorAll('[data-chtab]').forEach((b) => (b.onclick = () => {
    el.querySelectorAll('[data-chtab]').forEach((x) => x.classList.toggle('sel', x === b));
    el.querySelectorAll('[data-chpane]').forEach((p) => (p.hidden = p.dataset.chpane !== b.dataset.chtab));
  }));
  el.querySelector('[data-cancel]').onclick = () => m.close();
  const save = async () => {
    const name = el.querySelector('#ch-name').value.trim() || ({ text: 'New room', board: 'Board', gallery: 'Gallery', voice: 'Lounge' })[type]; const topic = el.querySelector('#ch-topic').value;
    try {
      const categoryId = el.querySelector('#ch-cat')?.value || null;
      const locked = el.querySelector('#ch-lock').checked, adminOnly = el.querySelector('#ch-admin').checked;
      if (ch) await api('PATCH', `/api/channels/${ch.id}`, { name, topic, categoryId, locked, adminOnly });
      else await api('POST', `/api/servers/${sid}/channels`, { name, type, topic, categoryId, locked, adminOnly });
      m.close(); await loadServer(sid); renderAll();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelector('[data-save]').onclick = save;
  el.querySelector('#ch-name').onkeydown = (e) => { if (e.key === 'Enter') save(); };
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete', `Delete <b>${esc(ch.name)}</b>? This can't be undone.`, 'Delete'))) return;
    try { await api('DELETE', `/api/channels/${ch.id}`); m.close(); } catch (e) { toast(e.message, true); }
  });
}
async function editNickname(sid, uid) {
  const sd = S.serverData[sid]; const mem = sd.members.find((m) => m.user.id === uid);
  const v = await promptDialog(uid === S.me.id ? 'Edit my community profile' : 'Change nickname', 'Nickname (leave blank to reset)', mem?.nickname || '');
  if (v === null) return;
  try { await api('PATCH', `/api/servers/${sid}/members/${uid === S.me.id ? '@me' : uid}`, { nickname: v }); } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------------ server settings
async function openServerSettings(sid, tab) {
  let sd = await loadServer(sid);
  const owner = sd.server.ownerId === S.me.id;
  const tabs = [
    can(sd, P.MANAGE_SERVER) && ['overview', 'Overview', 'settings'],
    can(sd, P.MANAGE_ROLES) && ['roles', 'Roles', 'shield'],
    ['members', 'Members', 'users'],
    can(sd, P.MANAGE_SERVER) && ['invites', 'Invites', 'link'],
    can(sd, P.MANAGE_SERVER) && ['access', 'Access', 'compass'],
    can(sd, P.BAN_MEMBERS) && ['bans', 'Bans', 'hammer'],
  ].filter(Boolean);
  tab = tab || tabs[0][0];
  const m = openModal({ title: sd.server.name, cls: 'wide', body: `<nav class="settings-nav"><div class="lbl">${esc(sd.server.name)}</div>
    ${tabs.map(([k, l, i]) => `<button data-tab="${k}">${icon(i, 'sm')} ${l}</button>`).join('')}
    ${owner ? `<div class="lbl" style="margin-top:12px">Danger zone</div><button data-tab="delete" class="dz">${icon('trash', 'sm')} Delete community</button>` : ''}</nav><div class="settings-pane" id="ss-pane"></div>` });
  const pane = m.el.querySelector('#ss-pane');
  const show = async (t) => {
    tab = t; m.el.querySelectorAll('.settings-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    sd = S.serverData[sid];
    ({ overview: ssOverview, roles: ssRoles, members: ssMembers, invites: ssInvites, access: ssAccess, bans: ssBans, delete: ssDelete })[t](pane, sid, m);
  };
  m.el.querySelectorAll('.settings-nav [data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
  m.refresh = () => show(tab);
  S.openServerSettings = m; m.sid = sid;
  const oc = m.close; m.close = () => { S.openServerSettings = null; oc(); };
  show(tab);
}
function ssOverview(pane, sid) {
  const sd = S.serverData[sid]; const s = { ...sd.server };
  const owner = s.ownerId === S.me.id;
  pane.innerHTML = `<h2>Overview</h2>
    <div class="banner-up" id="ss-banner" style="${s.banner ? `background-image:url('${esc(s.banner)}')` : ''}"></div>
    <div class="upload-av"><div class="ring"><div class="av" id="ss-icon" style="width:88px;height:88px;font-size:88px;border:3px solid var(--bg);box-sizing:content-box;background:var(--bg3);color:var(--text)">${s.icon ? `<img src="${esc(s.icon)}">` : `<div class="ph">${esc(initials(s.name))}</div>`}</div></div>
      <div><div class="bold">Community icon</div><div class="hint">We recommend at least 512×512.</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-up-icon>Upload image</button>${s.icon ? '<button class="btn ghost" data-rm-icon>Remove</button>' : ''}</div></div></div>
    <div class="field"><label>Community name</label><input class="input" id="ss-name" value="${esc(s.name)}" maxlength="100"></div>
    <div class="field"><label>Description</label><textarea class="textarea" id="ss-desc" maxlength="300" placeholder="What’s this community about?">${esc(s.description || '')}</textarea></div>
    <div class="field"><label>Welcome note</label><textarea class="textarea" id="ss-welcome" maxlength="1000" placeholder="Shown at the top of the Lobby: rules, where to start, anything new people should know.">${esc(s.welcome || '')}</textarea></div>
    ${owner ? `<div class="field"><label>Transfer ownership</label><select class="select" id="ss-owner">${sd.members.map((m) => `<option value="${m.user.id}" ${m.user.id === s.ownerId ? 'selected' : ''}>${esc(m.user.displayName)} (@${esc(m.user.username)})</option>`).join('')}</select><div class="hint">The new owner gets full control. You'll keep your roles.</div></div>` : ''}
    <div class="save-bar"><span>Careful — you have unsaved changes!</span><button class="btn ghost" data-reset>Reset</button><button class="btn primary" data-save>Save changes</button></div>`;
  const bar = pane.querySelector('.save-bar'); bar.style.visibility = 'hidden';
  const dirty = () => (bar.style.visibility = 'visible');
  pane.querySelectorAll('input,textarea,select').forEach((i) => (i.oninput = dirty));
  pane.querySelector('[data-up-icon]').onclick = async () => { const f = await pickFile(); if (!f) return; try { s.icon = (await uploadFile(f)).url; pane.querySelector('#ss-icon').innerHTML = `<img src="${esc(s.icon)}">`; dirty(); } catch (e) { toast(e.message, true); } };
  pane.querySelector('[data-rm-icon]')?.addEventListener('click', () => { s.icon = null; pane.querySelector('#ss-icon').innerHTML = `<div class="ph">${esc(initials(s.name))}</div>`; dirty(); });
  pane.querySelector('#ss-banner').onclick = async () => { const f = await pickFile(); if (!f) return; try { s.banner = (await uploadFile(f)).url; pane.querySelector('#ss-banner').style.backgroundImage = `url('${s.banner}')`; dirty(); } catch (e) { toast(e.message, true); } };
  pane.querySelector('[data-reset]').onclick = () => ssOverview(pane, sid);
  pane.querySelector('[data-save]').onclick = async () => {
    const body = { name: pane.querySelector('#ss-name').value, description: pane.querySelector('#ss-desc').value, welcome: pane.querySelector('#ss-welcome').value, icon: s.icon, banner: s.banner };
    const newOwner = pane.querySelector('#ss-owner')?.value;
    if (newOwner && newOwner !== s.ownerId) {
      if (!(await confirmDialog('Transfer ownership', 'You will no longer be the owner of this community. This cannot be undone by you.', 'Transfer'))) return;
      body.ownerId = newOwner;
    }
    try { const d = await api('PATCH', `/api/servers/${sid}`, body); S.serverData[sid] = d; toast('Saved'); bar.style.visibility = 'hidden'; await loadServer(sid); renderAll(); } catch (e) { toast(e.message, true); }
  };
}
const ROLE_COLORS = ['#7C5CFF', '#DB4F9A', '#0EA5A0', '#3B82F6', '#2ecc71', '#1abc9c', '#f5b400', '#fa7e1e', '#ed4956', '#8e8e8e', '#e91e63', '#607d8b'];
function ssRoles(pane, sid, modal, selected) {
  const sd = S.serverData[sid];
  const roles = [...sd.roles].sort((a, b) => b.position - a.position);
  selected = selected || roles.find((r) => !r.isDefault)?.id || roles[0].id;
  const r = roles.find((x) => x.id === selected) || roles[0];
  const editable = r.isDefault || r.position < sd.myTopPosition;
  const counts = Object.fromEntries(roles.map((x) => [x.id, x.isDefault ? sd.members.length : sd.members.filter((m) => m.roleIds.includes(x.id)).length]));
  pane.innerHTML = `<h2>Roles</h2><p class="muted" style="margin:-8px 0 18px">Use roles to group members and grant permissions. Members show the color of their highest role.</p>
    <div class="roles-layout"><div class="roles-list"><button class="btn primary" data-new style="margin-bottom:8px">${icon('plus', 'sm')} Create role</button>
      ${roles.map((x) => `<div class="role-row ${x.id === r.id ? 'active' : ''}" data-role="${x.id}"><span class="role-dot" style="background:${esc(x.color)}"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(x.name)}</span><span class="small muted">${counts[x.id]}</span></div>`).join('')}</div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><h4 style="margin:0;flex:1">Edit role — ${esc(r.name)}</h4>
        ${!r.isDefault && editable ? `<button class="icon-btn" data-move="up" data-tip="Move up">${icon('up', 'sm')}</button><button class="icon-btn" data-move="down" data-tip="Move down">${icon('chevron', 'sm')}</button>` : ''}</div>
      ${!editable ? `<div class="hint" style="margin-bottom:12px;color:var(--red)">This role is at or above your highest role, so you can't edit it.</div>` : ''}
      <fieldset style="border:0;padding:0;margin:0" ${editable ? '' : 'disabled'}>
      ${r.isDefault ? '<p class="hint">@everyone applies to all members. Set the baseline permissions here.</p>' : `
        <div class="field"><label>Role name</label><input class="input" id="r-name" value="${esc(r.name)}" maxlength="50"></div>
        <div class="field"><label>Role color</label><div style="display:flex;gap:10px;align-items:center"><input type="color" id="r-color" value="${esc(r.color)}" style="width:48px;height:40px;border:0;background:none;padding:0;cursor:pointer">
          <div class="swatches">${ROLE_COLORS.map((c) => `<span class="swatch ${c === r.color ? 'sel' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div></div></div>
        <div class="perm"><div><div class="bold">Display separately</div><div class="d">Show members with this role in their own group in the member list.</div></div><label class="switch"><input type="checkbox" id="r-hoist" ${r.hoist ? 'checked' : ''}><span></span></label></div>`}
      <h4>Permissions</h4>
      ${PERM_INFO.map(([k, l, d]) => { const bit = P[k]; const mine = (sd.myPermissions & bit) === bit; return `<div class="perm"><div><div class="bold">${l}</div><div class="d">${d}</div></div><label class="switch"><input type="checkbox" data-perm="${bit}" ${(r.permissions & bit) ? 'checked' : ''} ${mine ? '' : 'disabled'}><span></span></label></div>`; }).join('')}
      ${!r.isDefault ? `<h4>Members with this role</h4><div id="r-members"></div>` : ''}
      </fieldset>
      <div class="save-bar"><span>${editable ? '' : ''}</span>${!r.isDefault && editable ? `<button class="btn danger" data-del style="margin-right:auto">${icon('trash', 'sm')} Delete role</button>` : ''}<button class="btn primary" data-save ${editable ? '' : 'disabled'}>Save changes</button></div>
    </div></div>`;
  pane.querySelectorAll('[data-role]').forEach((el) => (el.onclick = () => ssRoles(pane, sid, modal, el.dataset.role)));
  pane.querySelector('[data-new]').onclick = async () => {
    try { const d = await api('POST', `/api/servers/${sid}/roles`, { name: 'new role', color: ROLE_COLORS[Math.floor(Math.random() * 9)] }); S.serverData[sid] = d;
      const newest = d.roles.filter((x) => !x.isDefault && !sd.roles.some((o) => o.id === x.id))[0]; ssRoles(pane, sid, modal, newest?.id); } catch (e) { toast(e.message, true); }
  };
  pane.querySelectorAll('.swatch').forEach((s) => (s.onclick = () => { pane.querySelector('#r-color').value = s.dataset.c; pane.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('sel', x === s)); }));
  pane.querySelectorAll('[data-move]').forEach((b) => (b.onclick = async () => {
    const nonDefault = roles.filter((x) => !x.isDefault).sort((a, b) => a.position - b.position);
    const idx = nonDefault.findIndex((x) => x.id === r.id);
    const target = b.dataset.move === 'up' ? idx + 2 : idx;
    if (target < 1 || target > nonDefault.length) return;
    try { S.serverData[sid] = await api('PATCH', `/api/roles/${r.id}`, { position: target }); ssRoles(pane, sid, modal, r.id); } catch (e) { toast(e.message, true); }
  }));
  pane.querySelector('[data-save]').onclick = async () => {
    let perms = 0; pane.querySelectorAll('[data-perm]').forEach((c) => { if (c.checked) perms |= +c.dataset.perm; });
    const body = { permissions: perms };
    if (!r.isDefault) Object.assign(body, { name: pane.querySelector('#r-name').value, color: pane.querySelector('#r-color').value, hoist: pane.querySelector('#r-hoist').checked });
    try { S.serverData[sid] = await api('PATCH', `/api/roles/${r.id}`, body); toast('Role saved'); ssRoles(pane, sid, modal, r.id); renderAll(); } catch (e) { toast(e.message, true); }
  };
  pane.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete role', `Delete the role <b>${esc(r.name)}</b>? Members will lose it immediately.`, 'Delete'))) return;
    try { S.serverData[sid] = await api('DELETE', `/api/roles/${r.id}`); ssRoles(pane, sid, modal); renderAll(); } catch (e) { toast(e.message, true); }
  });
  // members with this role
  const rm = pane.querySelector('#r-members');
  if (rm) {
    const holders = sd.members.filter((m) => m.roleIds.includes(r.id));
    const others = sd.members.filter((m) => !m.roleIds.includes(r.id));
    rm.innerHTML = `${holders.map((m) => `<div class="row-line">${avatar(m.user, 32)}<div class="meta"><div class="bold">${esc(memberInfo(sd, m.user.id).name)}</div><div class="small muted">@${esc(m.user.username)}</div></div>${editable ? `<button class="btn ghost" data-unassign="${m.user.id}">Remove</button>` : ''}</div>`).join('') || '<div class="muted small">No one has this role yet.</div>'}
      ${editable && others.length ? `<button class="btn" style="margin-top:10px" data-assign>${icon('plus', 'sm')} Add members</button>` : ''}`;
    const setRoles = async (uid, add) => {
      const mem = sd.members.find((m) => m.user.id === uid);
      const ids = add ? [...mem.roleIds, r.id] : mem.roleIds.filter((x) => x !== r.id);
      try { await api('PATCH', `/api/servers/${sid}/members/${uid}`, { roleIds: ids }); await loadServer(sid); ssRoles(pane, sid, modal, r.id); } catch (e) { toast(e.message, true); }
    };
    rm.querySelectorAll('[data-unassign]').forEach((b) => (b.onclick = () => setRoles(b.dataset.unassign, false)));
    rm.querySelector('[data-assign]')?.addEventListener('click', (e) => openMenu(e.currentTarget, others.slice(0, 30).map((m) => ({ label: memberInfo(sd, m.user.id).name, onClick: () => setRoles(m.user.id, true) }))));
  }
}
function ssMembers(pane, sid) {
  const sd = S.serverData[sid];
  const assignable = sd.roles.filter((r) => !r.isDefault && r.position < sd.myTopPosition).sort((a, b) => b.position - a.position);
  pane.innerHTML = `<h2>Members — ${sd.members.length}</h2><input class="input" id="sm-q" placeholder="Search members" style="margin-bottom:12px"><div id="sm-list"></div>`;
  const draw = () => {
    const q = pane.querySelector('#sm-q').value.toLowerCase();
    const list = sd.members.filter((m) => !q || m.user.displayName.toLowerCase().includes(q) || m.user.username.includes(q) || (m.nickname || '').toLowerCase().includes(q));
    pane.querySelector('#sm-list').innerHTML = list.map((m) => {
      const mi = memberInfo(sd, m.user.id); const isOwner = sd.server.ownerId === m.user.id;
      return `<div class="row-line" data-uid="${m.user.id}">${avatar(m.user, 40, { dot: true })}<div class="meta"><div class="bold" style="${mi.color ? `color:${mi.color}` : ''}">${esc(mi.name)} ${isOwner ? `<span style="color:var(--yellow)" data-tip="Owner">${icon('crown', 'xs')}</span>` : ''}</div>
        <div class="small muted">@${esc(m.user.username)} · joined ${new Date(m.joinedAt).toLocaleDateString()}</div>
        <div style="margin-top:4px">${mi.roles.map((r) => `<span class="role-chip"><span class="role-dot" style="background:${esc(r.color)};width:9px;height:9px"></span>${esc(r.name)}${can(sd, P.MANAGE_ROLES) && r.position < sd.myTopPosition ? `<button data-rmrole="${r.id}">${icon('x', 'xs')}</button>` : ''}</span>`).join('')}
        ${can(sd, P.MANAGE_ROLES) && assignable.length ? `<button class="role-chip" data-addrole style="cursor:pointer">${icon('plus', 'xs')} Role</button>` : ''}</div></div>
        <button class="icon-btn" data-mmore>${icon('more', 'sm')}</button></div>`;
    }).join('');
    pane.querySelectorAll('[data-uid]').forEach((row) => {
      const uid = row.dataset.uid; const mem = sd.members.find((m) => m.user.id === uid);
      const setRoles = async (ids) => { try { await api('PATCH', `/api/servers/${sid}/members/${uid}`, { roleIds: ids }); await loadServer(sid); ssMembers(pane, sid); renderAll(); } catch (e) { toast(e.message, true); } };
      row.querySelectorAll('[data-rmrole]').forEach((b) => (b.onclick = () => setRoles(mem.roleIds.filter((x) => x !== b.dataset.rmrole))));
      row.querySelector('[data-addrole]')?.addEventListener('click', (e) => openMenu(e.currentTarget, assignable.map((r) => ({
        html: `<button><span style="display:flex;gap:8px;align-items:center"><span class="role-dot" style="background:${esc(r.color)}"></span>${esc(r.name)}</span>${mem.roleIds.includes(r.id) ? icon('check', 'sm') : ''}</button>`,
        mount: (el) => (el.onclick = () => { closeMenu(); setRoles(mem.roleIds.includes(r.id) ? mem.roleIds.filter((x) => x !== r.id) : [...mem.roleIds, r.id]); }) }))));
      row.querySelector('[data-mmore]').onclick = (e) => memberModMenu(e.currentTarget, sid, uid, () => ssMembers(pane, sid));
    });
  };
  pane.querySelector('#sm-q').oninput = draw; draw();
}
function memberModMenu(anchor, sid, uid, after) {
  const sd = S.serverData[sid]; const u = S.userCache[uid];
  const isOwner = sd.server.ownerId === uid, me = uid === S.me.id;
  openMenu(anchor, [
    { label: 'View profile', icon: 'user', onClick: () => openProfile(uid, sid) },
    !me && { label: 'Message', icon: 'chat', onClick: () => openDM(uid) },
    (me || can(sd, P.MANAGE_NICKNAMES)) && { label: 'Change nickname', icon: 'edit', onClick: () => editNickname(sid, uid).then(() => setTimeout(after, 300)) },
    !me && !isOwner && (can(sd, P.KICK_MEMBERS) || can(sd, P.BAN_MEMBERS)) && 'sep',
    !me && !isOwner && can(sd, P.KICK_MEMBERS) && { label: `Kick ${u.displayName}`, icon: 'logout', danger: true, onClick: async () => {
      if (!(await confirmDialog(`Kick ${u.displayName}`, `They'll be removed from <b>${esc(sd.server.name)}</b> but can rejoin with a new invite.`, 'Kick'))) return;
      try { await api('DELETE', `/api/servers/${sid}/members/${uid}`); toast(`${u.displayName} was kicked`); await loadServer(sid); after?.(); } catch (e) { toast(e.message, true); } } },
    !me && !isOwner && can(sd, P.BAN_MEMBERS) && { label: `Ban ${u.displayName}`, icon: 'hammer', danger: true, onClick: async () => {
      const reason = await promptDialog(`Ban ${u.displayName}`, 'Reason (optional)', '', 'Ban'); if (reason === null) return;
      try { await api('POST', `/api/servers/${sid}/bans/${uid}`, { reason }); toast(`${u.displayName} was banned`); await loadServer(sid); after?.(); } catch (e) { toast(e.message, true); } } },
  ]);
}
async function ssInvites(pane, sid) {
  pane.innerHTML = `<h2>Invites</h2><div class="muted">Loading…</div>`;
  const draw = async () => {
    const r = await api('GET', `/api/servers/${sid}/invites`);
    pane.innerHTML = `<h2>Invites</h2><button class="btn grad" data-new style="margin-bottom:14px">${icon('link', 'sm')} Create invite link</button>
      ${r.invites.length ? r.invites.map((i) => `<div class="row-line">${avatar(i.creator, 32)}<div class="meta"><div class="bold" style="font-family:ui-monospace,monospace">${esc(i.code)}</div>
        <div class="small muted">by ${esc(i.creator?.displayName || '?')} · ${i.uses}${i.max_uses ? '/' + i.max_uses : ''} uses · ${i.expires_at ? (i.expires_at < Date.now() ? 'expired' : 'expires ' + new Date(i.expires_at).toLocaleString()) : 'never expires'}</div></div>
        <button class="icon-btn" data-copy="${esc(i.code)}" data-tip="Copy link">${icon('copy', 'sm')}</button><button class="icon-btn danger" data-revoke="${esc(i.code)}" data-tip="Revoke">${icon('trash', 'sm')}</button></div>`).join('') : '<div class="muted">No active invites. Create one to bring people in.</div>'}`;
    pane.querySelector('[data-new]').onclick = () => openInvite(sid);
    pane.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyText(`${location.origin}/invite/${b.dataset.copy}`, 'Invite link copied')));
    pane.querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => { await api('DELETE', `/api/invites/${b.dataset.revoke}`); draw(); }));
  };
  draw().catch((e) => toast(e.message, true));
}
async function ssBans(pane, sid) {
  const r = await api('GET', `/api/servers/${sid}/bans`);
  pane.innerHTML = `<h2>Bans — ${r.bans.length}</h2>${r.bans.length ? r.bans.map((b) => `<div class="row-line">${avatar(b.user, 36)}<div class="meta"><div class="bold">${esc(b.user?.displayName)}</div><div class="small muted">${esc(b.reason || 'No reason given')}</div></div><button class="btn" data-unban="${b.user?.id}">Revoke ban</button></div>`).join('') : '<div class="empty"><div class="art">' + icon('hammer') + '</div><h3>No bans</h3><p>Banned members show up here.</p></div>'}`;
  pane.querySelectorAll('[data-unban]').forEach((b) => (b.onclick = async () => { await api('DELETE', `/api/servers/${sid}/bans/${b.dataset.unban}`); ssBans(pane, sid); }));
}
function ssDelete(pane, sid, modal) {
  const sd = S.serverData[sid];
  pane.innerHTML = `<h2 style="color:var(--red)">Delete '${esc(sd.server.name)}'</h2><p>This permanently deletes the community, its rooms, boards, galleries, lounges, messages, roles and invites. <b>This can't be undone.</b></p>
    <div class="field"><label>Type the community name to confirm</label><input class="input" id="del-name" placeholder="${esc(sd.server.name)}"></div><button class="btn danger" data-del disabled>Delete community</button>`;
  const inp = pane.querySelector('#del-name'), btn = pane.querySelector('[data-del]');
  inp.oninput = () => (btn.disabled = inp.value !== sd.server.name);
  btn.onclick = async () => { try { await api('DELETE', `/api/servers/${sid}`); modal.close(); removeServerLocal(sid); toast('Community deleted'); } catch (e) { toast(e.message, true); } };
}

// ------------------------------------------------------------------ profile
async function openProfile(uid, serverId) {
  let d;
  try { d = await api('GET', `/api/users/${uid}`); } catch (e) { return toast(e.message, true); }
  const u = cacheUser(d.user); const me = uid === S.me.id;
  const sd = serverId ? S.serverData[serverId] : null;
  const mem = sd?.members.find((m) => m.user.id === uid);
  const mi = memberInfo(sd, uid);
  const canRoles = sd && mem && can(sd, P.MANAGE_ROLES);
  const assignable = sd ? sd.roles.filter((r) => !r.isDefault && r.position < sd.myTopPosition).sort((a, b) => b.position - a.position) : [];
  const rel = d.relationship;
  let acts = '';
  if (me) acts = `<button class="btn" data-edit>${icon('edit', 'sm')} Edit profile</button>`;
  else {
    if (rel === 'friend') acts = `<button class="btn primary" data-msg>${icon('chat', 'sm')} Message</button><button class="btn" data-call>${icon('phone', 'sm')}</button><button class="btn" data-vcall>${icon('video', 'sm')}</button>`;
    else if (rel === 'incoming') acts = `<button class="btn primary" data-accept>Accept request</button><button class="btn" data-msg>Message</button>`;
    else if (rel === 'outgoing') acts = `<button class="btn" disabled>Request sent</button><button class="btn" data-msg>Message</button>`;
    else if (rel === 'blocked') acts = `<button class="btn" data-unblock>Unblock</button>`;
    else acts = `<button class="btn grad" data-add>${icon('userPlus', 'sm')} Add friend</button><button class="btn" data-msg>Message</button>`;
    if (rel !== 'blocked') acts += `<button class="btn" data-more style="flex:0 0 auto">${icon('more', 'sm')}</button>`;
  }
  const m = openModal({ title: null, cls: 'profile', body: `
    <div class="pbanner" style="${u.banner ? `background-image:url('${esc(u.banner)}')` : u.accent ? `background:${esc(u.accent)}` : ''}"></div>
    <div class="pav">${avatar(u, 92, { ring: true, dot: true })}</div>
    <div class="pbody"><div class="pname"><span class="${u.sparks ? 'nm-plate' : ''}"><span ${nameAttrs(u)}>${esc(d.nickname || mem?.nickname || u.displayName)}</span></span>${roleBadge(u)}${sparkMark(u)}</div><div class="puser">@${esc(u.username)}${d.nickname || mem?.nickname ? ` · ${esc(u.displayName)}` : ''}${d.nickname ? ' <span class="nick-note" data-tip="Your nickname for them. Only you see it.">nickname</span>' : ''}</div>
      ${sd && mem ? `<div class="p-level">${lvlChip(mem.xp, { long: true })}<span class="muted small">${mem.xp} xp in ${esc(sd.server.name)}</span></div>` : ''}
      ${u.customStatus ? `<div class="pstatus">${esc(u.customStatus)}</div>` : ''}
      ${u.bio ? `<div class="psec"><h5>About me</h5><div style="white-space:pre-wrap">${esc(u.bio)}</div></div>` : ''}
      ${badgesRow(d.badges)}
      <div class="psec"><h5>Member since</h5><div>${new Date(d.memberSince).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}${mem ? ` · joined ${esc(sd.server.name)} ${new Date(mem.joinedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</div></div>
      ${sd && mem ? `<div class="psec"><h5>Roles</h5><div>${mi.roles.map((r) => `<span class="role-chip"><span class="role-dot" style="background:${esc(r.color)};width:9px;height:9px"></span>${esc(r.name)}${canRoles && r.position < sd.myTopPosition ? `<button data-rmrole="${r.id}">${icon('x', 'xs')}</button>` : ''}</span>`).join('') || (canRoles ? '' : '<span class="muted small">No roles</span>')}
        ${canRoles && assignable.length ? `<button class="role-chip" data-addrole style="cursor:pointer">${icon('plus', 'xs')} Add role</button>` : ''}</div></div>` : ''}
      ${!me && d.mutualServers.length ? `<div class="psec"><h5>Communities in common — ${d.mutualServers.length}</h5><div class="mutual">${d.mutualServers.map((s) => `<span>${esc(s.name)}</span>`).join('')}</div></div>` : ''}
      <div class="pacts">${acts}</div></div>` });
  const el = m.el;
  el.querySelector('[data-edit]')?.addEventListener('click', () => { m.close(); openUserSettings('profile'); });
  el.querySelector('[data-msg]')?.addEventListener('click', () => { m.close(); openDM(uid); });
  el.querySelector('[data-call]')?.addEventListener('click', async () => { m.close(); const dm = await openDM(uid); if (dm) joinCall(dm.id); });
  el.querySelector('[data-vcall]')?.addEventListener('click', async () => { m.close(); const dm = await openDM(uid); if (dm) joinCall(dm.id, { video: true }); });
  el.querySelector('[data-add]')?.addEventListener('click', async (e) => { try { await api('POST', '/api/friends/request', { username: u.username }); e.target.closest('button').outerHTML = '<button class="btn" disabled>Request sent</button>'; } catch (err) { toast(err.message, true); } });
  el.querySelector('[data-accept]')?.addEventListener('click', async () => { await api('POST', `/api/friends/${uid}/accept`); m.close(); openProfile(uid, serverId); });
  el.querySelector('[data-unblock]')?.addEventListener('click', async () => { await api('DELETE', `/api/friends/${uid}/block`); m.close(); openProfile(uid, serverId); });
  el.querySelector('[data-more]')?.addEventListener('click', (e) => openMenu(e.currentTarget, [
    rel === 'friend' && { label: d.nickname ? 'Change nickname' : 'Give a nickname', icon: 'edit', onClick: () => { m.close(); setNickname(uid); } },
    rel === 'friend' && { label: 'Remove friend', icon: 'x', danger: true, onClick: async () => { await api('DELETE', `/api/friends/${uid}`); m.close(); } },
    { label: 'Block', icon: 'block', danger: true, onClick: () => { m.close(); blockUser(uid); } },
    sd && mem && 'sep',
    ...(sd && mem ? [{ label: 'Community actions…', icon: 'shield', onClick: () => memberModMenu(e.target, serverId, uid, () => m.close()) }] : []),
    { label: 'Copy username', icon: 'copy', onClick: () => copyText('@' + u.username) },
  ]));
  const setRoles = async (ids) => { try { await api('PATCH', `/api/servers/${serverId}/members/${uid}`, { roleIds: ids }); await loadServer(serverId); m.close(); openProfile(uid, serverId); renderAll(); } catch (e) { toast(e.message, true); } };
  el.querySelectorAll('[data-rmrole]').forEach((b) => (b.onclick = () => setRoles(mem.roleIds.filter((x) => x !== b.dataset.rmrole))));
  el.querySelector('[data-addrole]')?.addEventListener('click', (e) => openMenu(e.currentTarget, assignable.filter((r) => !mem.roleIds.includes(r.id)).map((r) => ({
    html: `<button><span style="display:flex;gap:8px;align-items:center"><span class="role-dot" style="background:${esc(r.color)}"></span>${esc(r.name)}</span></button>`,
    mount: (x) => (x.onclick = () => { closeMenu(); setRoles([...mem.roleIds, r.id]); }) }))));
}

// ------------------------------------------------------------------ user settings
function openUserSettings(tab = 'profile') {
  const tabs = [['profile', 'Edit profile', 'user'], ['account', 'Account', 'lock'], ['devices', 'Devices', 'screen'], ['appearance', 'Appearance', 'moon'], ['chat', 'Chat', 'chat'], ['sparks', 'Sparks', 'gem'], ['notifications', 'Notifications', 'bell'], ['voice', 'Voice & video', 'mic']];
  const m = openModal({ title: 'Settings', cls: 'wide', body: `<nav class="settings-nav"><div class="lbl">User settings</div>${tabs.map(([k, l, i]) => `<button data-tab="${k}">${icon(i, 'sm')} ${l}</button>`).join('')}
    <div class="lbl" style="margin-top:12px"></div><button data-tab="logout" class="dz">${icon('logout', 'sm')} Log out</button></nav><div class="settings-pane" id="us-pane"></div>` });
  const pane = m.el.querySelector('#us-pane');
  const show = (t) => {
    if (t === 'logout') return logout();
    if (t === 'sparks') { m.close(); return navigate('/sparks'); }
    m.el.querySelectorAll('.settings-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    ({ profile: usProfile, account: usAccount, devices: usDevices, appearance: usAppearance, chat: usChat, notifications: usNotifications, voice: usVoice })[t](pane, m);
  };
  m.el.querySelectorAll('.settings-nav [data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
  show(tab);
}
function usProfile(pane) {
  const u = { ...S.me };
  pane.innerHTML = `<h2>Edit profile</h2>
    <div class="banner-up" id="up-banner" style="${u.banner ? `background-image:url('${esc(u.banner)}')` : `background:${esc(u.accent || '#d62976')}`}"></div>
    <div class="upload-av"><div id="up-av">${avatar(u, 88, { ring: true })}</div><div><div class="bold">${esc(u.displayName)}</div><div class="muted">@${esc(u.username)}</div>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn primary" data-av>Change photo</button>${u.avatar ? '<button class="btn ghost" data-rmav>Remove</button>' : ''}</div></div></div>
    <div class="field"><label>Name</label><input class="input" id="p-name" value="${esc(u.displayName)}" maxlength="32"></div>
    <div class="field"><label>Username</label><input class="input" id="p-user" value="${esc(u.username)}" maxlength="24"><div class="hint">Letters, numbers, underscores and periods. Friends add you with this.</div></div>
    <div class="field"><label>Status</label><input class="input" id="p-status" value="${esc(u.customStatus || '')}" maxlength="80" placeholder="What are you up to?"></div>
    <div class="field"><label>Bio</label><textarea class="textarea" id="p-bio" maxlength="190" placeholder="Tell people a bit about yourself">${esc(u.bio || '')}</textarea><div class="hint" id="bio-count">${(u.bio || '').length} / 190</div></div>
    <div class="save-bar"><span></span><button class="btn primary" data-save>Save</button></div>`;
  pane.querySelector('#p-bio').oninput = (e) => (pane.querySelector('#bio-count').textContent = `${e.target.value.length} / 190`);
  pane.querySelector('[data-av]').onclick = async () => { const f = await pickFile(); if (!f) return; try { u.avatar = (await uploadFile(f)).url; pane.querySelector('#up-av').innerHTML = avatar(u, 88, { ring: true }); } catch (e) { toast(e.message, true); } };
  pane.querySelector('[data-rmav]')?.addEventListener('click', () => { u.avatar = null; pane.querySelector('#up-av').innerHTML = avatar(u, 88, { ring: true }); });
  pane.querySelector('#up-banner').onclick = async () => { const f = await pickFile(); if (!f) return; try { u.banner = (await uploadFile(f)).url; pane.querySelector('#up-banner').style.background = `url('${u.banner}') center/cover`; } catch (e) { toast(e.message, true); } };
  pane.querySelector('[data-save]').onclick = async () => {
    try {
      const r = await api('PATCH', '/api/me', { displayName: pane.querySelector('#p-name').value, username: pane.querySelector('#p-user').value, customStatus: pane.querySelector('#p-status').value,
        bio: pane.querySelector('#p-bio').value, avatar: u.avatar, banner: u.banner, accent: u.accent });
      S.me = { ...S.me, ...r.user }; cacheUser(r.user); toast('Profile saved'); renderAll(); usProfile(pane);
    } catch (e) { toast(e.message, true); }
  };
}
function usAccount(pane) {
  pane.innerHTML = `<h2>Account</h2>
    <div class="row-line"><div class="meta"><div class="bold">Email</div><div class="muted">${esc(S.me.email || '—')}</div></div></div>
    <div class="row-line"><div class="meta"><div class="bold">Username</div><div class="muted">@${esc(S.me.username)}</div></div></div>
    <h4>${S.me.hasPassword ? 'Change password' : 'Set a password'}</h4>
    ${S.me.hasPassword ? '<div class="field"><label>Current password</label><input class="input" type="password" id="pw-cur" autocomplete="current-password"></div>' : '<p class="hint">You signed up with Google. Set a password to also log in with your email.</p>'}
    <div class="field"><label>New password</label><input class="input" type="password" id="pw-new" autocomplete="new-password" minlength="8"></div>
    <button class="btn primary" data-pw>Update password</button>`;
  pane.querySelector('[data-pw]').onclick = async () => {
    try { await api('POST', '/api/me/password', { current: pane.querySelector('#pw-cur')?.value, next: pane.querySelector('#pw-new').value }); S.me.hasPassword = true; toast('Password updated'); usAccount(pane); } catch (e) { toast(e.message, true); }
  };
}
function usAppearance(pane) {
  pane.innerHTML = `<h2>Appearance</h2><h4>Theme</h4><div class="choice-grid" style="grid-template-columns:repeat(3,1fr)">
    ${[['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['system', 'screen', 'Match my device']].map(([k, e, l]) => `<button class="choice ${S.settings.theme === k ? 'sel' : ''}" data-theme="${k}">${icon(e, 'sm')}${l}</button>`).join('')}</div>
    ${sparksAppearance()}`;
  pane.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => { S.settings.theme = b.dataset.theme; saveSettings(); applyTheme(); usAppearance(pane); }));
  wireSparksAppearance(pane, () => usAppearance(pane));
}
// a row with a label, a description and an on/off switch, saved to settings[key]
const setSwitch = (key, title, desc, def = true) => `<div class="perm"><div><div class="bold">${title}</div><div class="d">${desc}</div></div><label class="switch"><input type="checkbox" data-set="${key}" data-def="${def ? 1 : 0}" ${(S.settings[key] ?? def) ? 'checked' : ''}><span></span></label></div>`;
function wireSwitches(pane, after) {
  pane.querySelectorAll('[data-set]').forEach((i) => (i.onchange = () => { S.settings[i.dataset.set] = i.checked; saveSettings(); applyChatPrefs(); after?.(i.dataset.set); }));
}
function usChat(pane) {
  const size = S.settings.textSize || 'md';
  pane.innerHTML = `<h2>Chat</h2>
    <h4>Message text size</h4><div class="choice-grid" style="grid-template-columns:repeat(4,1fr)">
      ${[['sm', 'Small'], ['md', 'Default'], ['lg', 'Large'], ['xl', 'Extra large']].map(([k, l]) => `<button class="choice ${size === k ? 'sel' : ''}" data-size="${k}"><span class="ts-demo ts-${k}">Aa</span>${l}</button>`).join('')}</div>
    <h4>Messages</h4>
    ${setSwitch('enterSends', 'Enter sends the message', 'Turn off to make Enter start a new line. Then send with Ctrl+Enter (⌘+Enter on Mac).')}
    ${setSwitch('compact', 'Compact mode', 'Fit more messages on screen with tighter spacing.', false)}
    ${setSwitch('clock24', '24-hour clock', 'Show times like 18:30 instead of 6:30 PM.', false)}
    ${setSwitch('showGifs', 'Show GIFs in chat', 'Turn off to show a small “GIF” link instead of playing GIFs.')}
    <h4>Privacy</h4>
    ${setSwitch('showTyping', 'Show when I’m typing', 'Let others see “typing…” while you write a message.')}
    <h4>Accessibility</h4>
    ${setSwitch('reduceMotion', 'Reduce motion', 'Turn off most animations and transitions.', false)}`;
  pane.querySelectorAll('[data-size]').forEach((b) => (b.onclick = () => { S.settings.textSize = b.dataset.size; saveSettings(); applyChatPrefs(); usChat(pane); }));
  wireSwitches(pane, (k) => { if (k === 'clock24') { try { renderMessages(); } catch {} } });
}
function usNotifications(pane) {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  pane.innerHTML = `<h2>Notifications</h2>
    <div class="perm"><div><div class="bold">Desktop notifications</div><div class="d">Get notified about DMs and @mentions when Lumi isn't focused.${perm === 'denied' ? ' <b>Blocked in your browser settings.</b>' : ''}</div></div><label class="switch"><input type="checkbox" id="n-desk" ${S.settings.notifications && perm === 'granted' ? 'checked' : ''} ${perm === 'denied' || perm === 'unsupported' ? 'disabled' : ''}><span></span></label></div>
    <div class="perm"><div><div class="bold">Sounds</div><div class="d">Play sounds for new messages, calls, and joining voice.</div></div><label class="switch"><input type="checkbox" id="n-snd" ${S.settings.sounds ? 'checked' : ''}><span></span></label></div>
    ${setSwitch('notifPreview', 'Show message text', 'Include what the message says in desktop notifications. Turn off for privacy.')}`;
  wireSwitches(pane);
  pane.querySelector('#n-desk').onchange = async (e) => {
    if (e.target.checked && Notification.permission !== 'granted') { const p = await Notification.requestPermission(); if (p !== 'granted') { e.target.checked = false; return; } }
    S.settings.notifications = e.target.checked; saveSettings();
  };
  pane.querySelector('#n-snd').onchange = (e) => { S.settings.sounds = e.target.checked; saveSettings(); if (e.target.checked) playSound('message'); };
}
async function usVoice(pane) {
  pane.innerHTML = `<h2>Voice & video</h2><div class="muted">Loading devices…</div>`;
  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
  const opts = (kind, sel) => devs.filter((d) => d.kind === kind).map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === sel ? 'selected' : ''}>${esc(d.label || `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${i + 1}`)}</option>`).join('');
  pane.innerHTML = `<h2>Voice & video</h2>
    <div class="field"><label>Microphone</label><select class="select" id="v-mic"><option value="">Default</option>${opts('audioinput', S.settings.micId)}</select></div>
    <div class="field"><label>Camera</label><select class="select" id="v-cam"><option value="">Default</option>${opts('videoinput', S.settings.camId)}</select></div>
    ${setSwitch('echoCancel', 'Echo cancellation', 'Stop others from hearing themselves through your speakers.')}
    ${setSwitch('autoGain', 'Automatic volume', 'Keep your mic at a steady volume.')}
    ${setSwitch('joinMuted', 'Join calls muted', 'Your mic starts off when you join a call or lounge.', false)}
    <div class="perm"><div><div class="bold">Noise suppression</div><div class="d">Filter background noise from your mic.</div></div><label class="switch"><input type="checkbox" id="v-ns" ${S.settings.noiseSuppression !== false ? 'checked' : ''}><span></span></label></div>
    <h4>Mic test</h4><button class="btn" data-test>Let's check</button><div style="height:8px;border-radius:4px;background:var(--bg3);margin-top:10px;overflow:hidden"><div id="v-meter" style="height:100%;width:0;background:var(--ig);transition:width .08s"></div></div>
    <p class="hint">Device names appear after you allow microphone/camera access once.</p>`;
  pane.querySelector('#v-mic').onchange = (e) => { S.settings.micId = e.target.value; saveSettings(); };
  pane.querySelector('#v-cam').onchange = (e) => { S.settings.camId = e.target.value; saveSettings(); };
  pane.querySelector('#v-ns').onchange = (e) => { S.settings.noiseSuppression = e.target.checked; saveSettings(); };
  wireSwitches(pane);
  pane.querySelector('[data-test]').onclick = async (e) => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
      const an = ac().createAnalyser(); ac().createMediaStreamSource(st).connect(an); const buf = new Uint8Array(an.fftSize);
      e.target.textContent = 'Listening… (5s)';
      const end = Date.now() + 5000;
      const tick = () => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += (v - 128) ** 2; const lvl = Math.min(100, Math.sqrt(s / buf.length) * 4); const el = $('#v-meter'); if (el) el.style.width = lvl + '%'; if (Date.now() < end && el) requestAnimationFrame(tick); else { st.getTracks().forEach((t) => t.stop()); e.target.textContent = "Let's check"; if (el) el.style.width = 0; } };
      tick();
    } catch { toast('Could not access microphone', true); }
  };
}
async function logout() {
  if (!(await confirmDialog('Log out', 'Are you sure you want to log out?', 'Log out'))) return;
  if (Call.active) leaveCall();
  await api('POST', '/api/auth/logout'); location.href = '/';
}

// ------------------------------------------------------------------ groups
function openNewGroup(addToDm) {
  const dm = addToDm ? S.dms.find((d) => d.id === addToDm) : null;
  const friends = S.friends.filter((f) => f.type === 'friend').map((f) => S.userCache[f.user.id] || f.user).filter((u) => !dm || !dm.members.some((m) => m.id === u.id));
  const sel = new Set();
  const m = openModal({ title: dm ? 'Add friends' : 'New message', body: `
    <input class="input" id="g-q" placeholder="Search friends" autofocus>
    <div id="g-sel" style="margin:8px 0;min-height:10px"></div>
    <div id="g-list" style="max-height:320px;overflow-y:auto;margin:0 -6px"></div>
    ${dm ? '' : '<div class="field" id="g-name-f" style="margin-top:12px;display:none"><label>Group name (optional)</label><input class="input" id="g-name" maxlength="60"></div>'}`,
    foot: `<button class="btn primary block" data-go disabled>${dm ? 'Add' : 'Chat'}</button>` });
  const el = m.el;
  const draw = () => {
    const q = el.querySelector('#g-q').value.toLowerCase();
    el.querySelector('#g-sel').innerHTML = [...sel].map((id) => `<span class="role-chip">${esc(S.userCache[id].displayName)}<button data-un="${id}">${icon('x', 'xs')}</button></span>`).join('');
    el.querySelector('#g-list').innerHTML = friends.filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.includes(q)).map((u) => `<label class="row-line" style="padding:8px 6px;border:0;cursor:pointer">${avatar(u, 40)}<div class="meta"><div class="bold">${esc(u.displayName)}</div><div class="small muted">@${esc(u.username)}</div></div><input type="checkbox" data-id="${u.id}" ${sel.has(u.id) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--blue)"></label>`).join('') || '<div class="muted small" style="padding:8px">No friends to add yet.</div>';
    el.querySelectorAll('[data-id]').forEach((c) => (c.onchange = () => { c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); draw(); }));
    el.querySelectorAll('[data-un]').forEach((b) => (b.onclick = () => { sel.delete(b.dataset.un); draw(); }));
    el.querySelector('[data-go]').disabled = !sel.size;
    const nf = el.querySelector('#g-name-f'); if (nf) nf.style.display = sel.size > 1 ? '' : 'none';
  };
  el.querySelector('#g-q').oninput = draw; draw();
  el.querySelector('[data-go]').onclick = async () => {
    try {
      if (dm) { await api('PATCH', `/api/dms/${dm.id}`, { addUserIds: [...sel] }); m.close(); return; }
      if (sel.size === 1) { m.close(); return openDM([...sel][0]); }
      const r = await api('POST', '/api/dms/group', { userIds: [...sel], name: el.querySelector('#g-name').value });
      if (!S.dms.find((d) => d.id === r.dm.id)) S.dms.unshift(r.dm);
      m.close(); navigate('/channels/@me/' + r.dm.id);
    } catch (e) { toast(e.message, true); }
  };
}

// ------------------------------------------------------------------ stories
const STORY_BGS = ['ink', 'violet', 'clay', 'moss', 'sea', 'paper'];
const STORY_FONTS = [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']];
// stored as "color" or "color.font" (old moments only have the color)
const storyCls = (v) => { const [b, f] = String(v || 'ink').split('.'); return `bg-${esc(b)} sf-${esc(f || 'sans')}`; };
function myStoryClick(anchor) {
  const mine = S.stories.find((s) => s.user.id === S.me.id);
  if (!mine) return openStoryCompose();
  openMenu(anchor, [{ label: 'View your moment', icon: 'sparkle', onClick: () => openStoryViewer(S.me.id) }, { label: 'Add a moment', icon: 'plus', onClick: openStoryCompose }]);
}
function openStoryCompose() {
  let bg = 'ink', font = 'sans', image = null;
  const PH = 'Start typing below';
  const m = openModal({ title: 'New moment', cls: 'story-compose', body: `
    <div class="preview ${storyCls(bg)}" id="st-prev"><span id="st-txt" class="ph">${PH}</span></div>
    <div class="st-tools">
      <div class="bgs">${STORY_BGS.map((b) => `<button class="bg-${b} ${b === bg ? 'sel' : ''}" data-bg="${b}" data-tip="${b[0].toUpperCase() + b.slice(1)}"></button>`).join('')}</div>
      <div class="st-fonts">${STORY_FONTS.map(([k, l]) => `<button class="sf-${k} ${k === font ? 'sel' : ''}" data-font="${k}">${l}</button>`).join('')}</div>
      <button class="icon-btn" data-photo data-tip="Add photo">${icon('image')}</button>
    </div>
    <textarea class="textarea" id="st-in" maxlength="280" placeholder="What's on your mind?" autofocus></textarea>
    <p class="hint">Moments disappear after 24 hours and only your friends can see them.</p>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-share>Share moment</button>` });
  const el = m.el, prev = el.querySelector('#st-prev'), txt = el.querySelector('#st-txt');
  const paint = () => { prev.className = 'preview ' + storyCls(bg + '.' + font); };
  el.querySelector('#st-in').oninput = (e) => { const v = e.target.value; txt.textContent = v || PH; txt.classList.toggle('ph', !v); txt.classList.toggle('long', v.length > 120); };
  el.querySelectorAll('[data-bg]').forEach((b) => (b.onclick = () => { bg = b.dataset.bg; paint(); el.querySelectorAll('[data-bg]').forEach((x) => x.classList.toggle('sel', x === b)); }));
  el.querySelectorAll('[data-font]').forEach((b) => (b.onclick = () => { font = b.dataset.font; paint(); el.querySelectorAll('[data-font]').forEach((x) => x.classList.toggle('sel', x === b)); }));
  el.querySelector('[data-photo]').onclick = async () => { const f = await pickFile(); if (!f) return; try { image = (await uploadFile(f)).url; el.querySelector('#st-prev img')?.remove(); prev.prepend(h(`<img src="${esc(image)}">`)); } catch (e) { toast(e.message, true); } };
  el.querySelector('[data-cancel]').onclick = () => m.close();
  el.querySelector('[data-share]').onclick = async () => {
    try { await api('POST', '/api/stories', { text: el.querySelector('#st-in').value, bg: font === 'sans' ? bg : bg + '.' + font, image }); m.close(); toast('Moment shared'); await refreshStories(); if (S.view.type === 'home') renderHomeBody(); } catch (e) { toast(e.message, true); }
  };
}
let svState = null;
function openStoryViewer(uid) {
  const order = S.stories; let ui = order.findIndex((s) => s.user.id === uid); if (ui < 0) return;
  let ii = order[ui].items.findIndex((i) => !i.seen); if (ii < 0) ii = 0;
  const root = h('<div class="sv"></div>'); document.body.appendChild(root);
  let timer = null, startAt = 0, paused = false, elapsed = 0; const DUR = 5000;
  const draw = () => {
    const grp = order[ui], it = grp.items[ii];
    const mine = grp.user.id === S.me.id;
    root.innerHTML = `<button class="icon-btn x" data-x>${icon('x')}</button><div class="card ${storyCls(it.bg)}${(it.text || '').length > 120 ? ' long' : ''}">
      <div class="bars">${grp.items.map((_, i) => `<i><b style="width:${i < ii ? 100 : 0}%"></b></i>`).join('')}</div>
      <div class="top">${avatar(grp.user, 32)}<span>${esc(grp.user.username)}</span><span class="t">${ago(it.createdAt)}</span><span class="sp"></span>
        ${mine ? `<span class="t">${icon('users', 'xs')} ${it.views || 0}</span><button class="icon-btn" data-del>${icon('trash', 'sm')}</button>` : ''}</div>
      <div class="body">${it.image ? `<img src="${esc(it.image)}">${it.text ? `<span class="cap">${esc(it.text)}</span>` : ''}` : esc(it.text)}</div>
      <div class="nav l" data-prev></div><div class="nav r" data-next></div>
      ${mine ? '' : `<div class="reply"><input placeholder="Reply to ${esc(grp.user.displayName)}…" id="sv-reply"><button class="icon-btn" data-heart>${icon('heart')}</button><button class="icon-btn" data-send>${icon('send')}</button></div>`}</div>`;
    if (!it.seen && !mine) { it.seen = true; api('POST', `/api/stories/${it.id}/view`).catch(() => {}); grp.allSeen = grp.items.every((x) => x.seen); }
    elapsed = 0; startAt = performance.now(); paused = false;
    root.querySelector('[data-x]').onclick = closeStoryViewer;
    root.querySelector('[data-prev]').onclick = prev; root.querySelector('[data-next]').onclick = next;
    const inp = root.querySelector('#sv-reply');
    if (inp) {
      inp.onfocus = () => (paused = true); inp.onblur = () => { paused = false; startAt = performance.now() - elapsed; };
      const send = async (text) => { if (!text.trim()) return; try { const d = await api('POST', '/api/dms', { userId: grp.user.id }); if (!S.dms.find((x) => x.id === d.dm.id)) S.dms.unshift(d.dm);
        await api('POST', `/api/channels/${d.dm.id}/messages`, { content: `↩️ Replied to your moment${it.text ? ` “${it.text.slice(0, 60)}”` : ''}:\n${text}` }); toast('Reply sent'); inp.value = ''; inp.blur(); } catch (e) { toast(e.message, true); } };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') send(inp.value); if (e.key === 'Escape') inp.blur(); };
      root.querySelector('[data-send]').onclick = () => send(inp.value);
      root.querySelector('[data-heart]').onclick = () => send('❤️');
    }
    root.querySelector('[data-del]')?.addEventListener('click', async () => { paused = true; if (await confirmDialog('Delete moment?', 'This moment will be removed for everyone.', 'Delete')) { await api('DELETE', `/api/stories/${it.id}`); await refreshStories(); closeStoryViewer(); if (S.view.type === 'home') renderHomeBody(); } else { paused = false; startAt = performance.now() - elapsed; } });
  };
  const next = () => { const g = order[ui]; if (ii < g.items.length - 1) ii++; else if (ui < order.length - 1) { ui++; ii = 0; } else return closeStoryViewer(); draw(); };
  const prev = () => { if (ii > 0) ii--; else if (ui > 0) { ui--; ii = 0; } draw(); };
  const loop = (t) => {
    if (!root.isConnected) return;
    if (!paused) { elapsed = t - startAt; const bar = root.querySelectorAll('.bars b')[ii]; if (bar) bar.style.width = Math.min(100, (elapsed / DUR) * 100) + '%'; if (elapsed >= DUR) next(); }
    else startAt = t - elapsed;
    timer = requestAnimationFrame(loop);
  };
  const key = (e) => { if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
  document.addEventListener('keydown', key);
  svState = { root, stop: () => { cancelAnimationFrame(timer); document.removeEventListener('keydown', key); } };
  draw(); timer = requestAnimationFrame(loop);
}
function closeStoryViewer() { if (!svState) return; svState.stop(); svState.root.remove(); svState = null; if (S.view.type === 'home') renderHomeBody(); }

// ------------------------------------------------------------------ categories
function openCategoryModal(sid, catId = null) {
  const sd = S.serverData[sid];
  const cats = [...(sd.categories || [])].sort((a, b) => a.position - b.position);
  const cat = catId ? cats.find((c) => c.id === catId) : null;
  const idx = cat ? cats.indexOf(cat) : -1;
  const m = openModal({ title: cat ? 'Edit section' : 'New section', body: `
    <div class="field"><label>Section name</label><input class="input" id="cat-name" value="${esc(cat?.name || '')}" placeholder="e.g. Gaming" maxlength="60" autofocus></div>
    ${cat ? `<div class="field"><label>Order</label><div style="display:flex;gap:8px"><button class="btn" data-move="up" ${idx <= 0 ? 'disabled' : ''}>${icon('up', 'sm')} Move up</button><button class="btn" data-move="down" ${idx >= cats.length - 1 ? 'disabled' : ''}>${icon('chevron', 'sm')} Move down</button></div></div>
      <p class="hint">Deleting a section keeps its rooms — they move to the top of the list.</p>` : '<p class="hint">After creating it, use the + next to the section to add rooms, or move existing ones in from their settings.</p>'}`,
    foot: `${cat ? `<button class="btn danger" data-del style="margin-right:auto">${icon('trash', 'sm')} Delete</button>` : ''}<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${cat ? 'Save' : 'Create section'}</button>` });
  const el = m.el;
  const refresh = async () => { await loadServer(sid); renderAll(); };
  el.querySelector('[data-cancel]').onclick = () => m.close();
  const save = async () => {
    const name = el.querySelector('#cat-name').value.trim(); if (!name) return toast('Give it a name', true);
    try { if (cat) await api('PATCH', `/api/categories/${cat.id}`, { name }); else await api('POST', `/api/servers/${sid}/categories`, { name }); m.close(); refresh(); } catch (e) { toast(e.message, true); }
  };
  el.querySelector('[data-save]').onclick = save;
  el.querySelector('#cat-name').onkeydown = (e) => { if (e.key === 'Enter') save(); };
  el.querySelectorAll('[data-move]').forEach((b) => (b.onclick = async () => { try { await api('PATCH', `/api/categories/${cat.id}`, { move: b.dataset.move }); m.close(); await refresh(); openCategoryModal(sid, cat.id); } catch (e) { toast(e.message, true); } }));
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete section', `Delete <b>${esc(cat.name)}</b>? Its rooms are kept.`, 'Delete'))) return;
    try { await api('DELETE', `/api/categories/${cat.id}`); m.close(); refresh(); } catch (e) { toast(e.message, true); }
  });
}

// ------------------------------------------------------------------ site admin panel (owner + admins)
const BAN_LENGTHS = [[60, '1 hour'], [1440, '1 day'], [4320, '3 days'], [10080, '1 week'], [43200, '30 days'], [0, 'Permanent'], ['custom', 'Custom']];
function banDialog(u) {
  return new Promise((resolve) => {
    let pick = 1440, done = false;
    const m = openModal({ title: `Ban @${u.username}`, cls: 'ban-modal', body: `
      <div class="field"><label>How long?</label><div class="ban-lens">${BAN_LENGTHS.map(([v, l]) => `<button type="button" data-len="${v}" class="${v === pick ? 'sel' : ''}">${l}</button>`).join('')}</div>
        <div class="ban-custom" hidden><input class="input" type="number" min="1" step="1" value="2" id="bn-n"><select class="input" id="bn-u"><option value="60">hours</option><option value="1440" selected>days</option><option value="10080">weeks</option><option value="1">minutes</option></select></div>
        <div class="hint" id="bn-end"></div></div>
      <div class="field"><label>Reason <span class="muted" style="font-weight:400">(optional, they will see it)</span></label><input class="input" id="bn-r" maxlength="200" placeholder="e.g. Spamming invites"></div>`,
      foot: `<button class="btn" data-x>Cancel</button><button class="btn danger" data-ok>${icon('hammer', 'sm')} Ban</button>`,
      onClose: () => { if (!done) resolve(null); } });
    const el = m.el;
    const minutes = () => pick === 'custom' ? Math.round(Number(el.querySelector('#bn-n').value) * Number(el.querySelector('#bn-u').value)) : pick;
    const upd = () => { const n = minutes(); el.querySelector('#bn-end').textContent = pick === 0 ? 'They stay banned until someone unbans them.' : n > 0 ? `Ban ends ${fmtBanEnd(Date.now() + n * 60000)} (in ${fmtBanLeft(n * 60000)}).` : 'Enter a length.'; el.querySelector('[data-ok]').disabled = pick !== 0 && !(n > 0); };
    el.querySelectorAll('[data-len]').forEach((b) => (b.onclick = () => { pick = b.dataset.len === 'custom' ? 'custom' : Number(b.dataset.len); el.querySelectorAll('[data-len]').forEach((x) => x.classList.toggle('sel', x === b)); el.querySelector('.ban-custom').hidden = pick !== 'custom'; upd(); }));
    el.querySelector('#bn-n').oninput = upd; el.querySelector('#bn-u').onchange = upd; upd();
    el.querySelector('[data-x]').onclick = () => m.close();
    el.querySelector('[data-ok]').onclick = () => { done = true; resolve({ minutes: minutes() || null, reason: el.querySelector('#bn-r').value.trim() }); m.close(); };
  });
}
function openAdminPanel() {
  if (!isSiteAdmin()) return;
  const owner = S.me.siteRole === 'owner';
  let filter = 'all';
  const m = openModal({ title: 'Admin panel', cls: 'wide admin-modal', body: `<nav class="settings-nav"><div class="lbl">lumi</div>
      <button data-f="all" class="active">${icon('users', 'sm')} Everyone</button>
      <button data-f="banned">${icon('hammer', 'sm')} Banned</button>
      <button data-f="owners">${POTION.replace('<svg', '<svg class="i sm"')} Owners</button>
      <button data-f="admins">${SHIELD_BLUE.replace('<svg', '<svg class="i sm"')} Owners & admins</button>
      ${owner ? `<button data-f="sparks">${icon('gem', 'sm')} Sparks</button><button data-reset-tasks>${icon('glow', 'sm')} New tasks for everyone</button>` : ''}
      <div class="lbl" style="margin-top:14px">You are</div><div style="padding:4px 12px;display:flex;align-items:center;gap:6px;font-weight:600">${owner ? POTION.replace('<svg', '<svg style="width:18px;height:18px"') + ' Owner' : SHIELD_BLUE.replace('<svg', '<svg style="width:18px;height:18px"') + ' Admin'}</div></nav>
    <div class="settings-pane"><h2 id="ap-title">Everyone</h2><input class="input" id="ap-q" placeholder="Search by name or username${owner ? ' or email' : ''}" autocomplete="off" style="margin-bottom:6px"><div class="hint" id="ap-count" style="margin-bottom:10px"></div><div id="ap-list"></div><div id="ap-sparks" hidden></div></div>` });
  const el = m.el;
  let timer;
  const load = async () => {
    const sp = filter === 'sparks';
    ['#ap-q', '#ap-count', '#ap-list'].forEach((s) => el.querySelector(s).hidden = sp); el.querySelector('#ap-sparks').hidden = !sp;
    if (sp) return adminSparksPane(el.querySelector('#ap-sparks'), load);
    const q = el.querySelector('#ap-q').value;
    let r; try { r = await api('GET', `/api/admin/users?q=${encodeURIComponent(q)}&filter=${filter}`); } catch (e) { return toast(e.message, true); }
    el.querySelector('#ap-count').textContent = `${r.total} accounts · ${r.bannedCount} banned${r.users.length === 100 ? ' · showing first 100 matches' : ''}`;
    el.querySelector('#ap-list').innerHTML = r.users.map((u) => {
      cacheUser(u);
      const me = u.id === S.me.id;
      const canBan = !me && u.siteRole !== 'owner' && (owner || u.siteRole !== 'admin');
      const acts = [];
      if (owner && !u.siteRole && !u.bannedAt) acts.push(`<button class="btn ${u.sparksUntil ? 'sp-has' : ''}" data-give-sparks="${u.id}" data-tip="${u.sparksUntil ? 'Has Sparks' : 'Give Sparks'}">${icon('gem', 'sm')}</button>`);
      if (u.bannedAt) acts.push(`<button class="btn" data-unban="${u.id}">Unban</button>`);
      else if (canBan) acts.push(`<button class="btn danger" data-ban="${u.id}">${icon('hammer', 'sm')} Ban</button>`);
      const role = u.siteRole || 'member';
      if (u.primary) acts.unshift(`<span class="role-pill owner">${POTION.replace('<svg', '<svg style="width:14px;height:14px"')} Main owner</span>`);
      else if (owner && !me && (role !== 'owner' || r.viewerPrimary) && !u.bannedAt)
        acts.unshift(`<label class="role-pick r-${role}" data-tip="lumi role"><select data-role="${u.id}">
          <option value="member" ${role === 'member' ? 'selected' : ''}>Member</option>
          <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
          ${r.viewerPrimary ? `<option value="owner" ${role === 'owner' ? 'selected' : ''}>Owner</option>` : ''}</select></label>`);
      else if (role !== 'member') acts.unshift(`<span class="role-pill ${role}">${role === 'owner' ? 'Owner' : 'Admin'}</span>`);
      return `<div class="row-line ${u.bannedAt ? 'is-banned' : ''}">${avatar(u, 42)}<div class="meta">
        <div class="bold">${esc(u.displayName)}${roleBadge(u)} <span class="muted" style="font-weight:400">@${esc(u.username)}</span>${me ? ' <span class="small muted">(you)</span>' : ''}</div>
        <div class="small muted">${u.email ? esc(u.email) + ' · ' : ''}joined ${new Date(u.createdAt).toLocaleDateString()}${u.bannedAt ? ` · <span class="ban-tag">${u.bannedUntil ? `banned · ${fmtBanLeft(u.bannedUntil - Date.now())} left (ends ${esc(fmtBanEnd(u.bannedUntil))})` : 'banned permanently'}${u.banReason ? ' — ' + esc(u.banReason) : ''}</span>` : ''}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${acts.join('')}</div></div>`;
    }).join('') || '<div class="empty" style="padding:30px"><p>No one matches.</p></div>';
    const act = async (fn) => { try { await fn(); load(); } catch (e) { toast(e.message, true); } };
    el.querySelectorAll('[data-ban]').forEach((b) => (b.onclick = async () => {
      const u = S.userCache[b.dataset.ban];
      const r = await banDialog(u); if (!r) return;
      act(async () => { await api('POST', `/api/admin/users/${u.id}/ban`, r); toast(`@${u.username} was banned ${r.minutes ? 'for ' + fmtBanLeft(r.minutes * 60000) : 'permanently'}`); });
    }));
    el.querySelectorAll('[data-give-sparks]').forEach((b) => (b.onclick = () => giveSparksMenu(b, r.users.find((x) => x.id === b.dataset.giveSparks), load)));
    el.querySelectorAll('[data-unban]').forEach((b) => (b.onclick = () => act(async () => { await api('DELETE', `/api/admin/users/${b.dataset.unban}/ban`); toast('Unbanned'); })));
    el.querySelectorAll('[data-role]').forEach((sel) => (sel.onchange = async () => {
      const u = S.userCache[sel.dataset.role], to = sel.value, from = u.siteRole || 'member';
      const text = { owner: `Owners have every power: the admin panel, banning anyone except other owners, and listing their communities on Stargaze without the 1,000-member minimum.`, admin: 'Admins can open this panel, search everyone, and ban or unban regular members.', member: `@${u.username} will lose their ${from} powers.` }[to];
      if (!(await confirmDialog(`Make @${u.username} ${to === 'member' ? 'a regular member' : to === 'admin' ? 'an admin' : 'an owner'}?`, text, 'Change role', to === 'member'))) { sel.value = from; return; }
      act(async () => { await api('POST', `/api/admin/users/${u.id}/role`, { role: to }); toast(`@${u.username} is now ${to === 'member' ? 'a member' : to === 'admin' ? 'an admin' : 'an owner'}`); });
    }));
    el.querySelectorAll('[data-admin]').forEach((b) => (b.onclick = async () => {
      const u = S.userCache[b.dataset.admin];
      if (!(await confirmDialog(`Make @${u.username} an admin?`, 'Admins can open this panel, search everyone, and ban or unban regular users. Only you can add or remove admins.', 'Make admin', false))) return;
      act(async () => { await api('POST', `/api/admin/users/${u.id}/admin`); toast(`@${u.username} is now an admin`); });
    }));
    el.querySelectorAll('[data-unadmin]').forEach((b) => (b.onclick = () => act(async () => { await api('DELETE', `/api/admin/users/${b.dataset.unadmin}/admin`); toast('Admin removed'); })));
  };
  el.querySelector('#ap-q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 220); };
  el.querySelector('[data-reset-tasks]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('New tasks for everyone?', 'Everyone gets a fresh set of 3 daily tasks right now, even if they already finished today’s. Progress on today’s unfinished tasks is cleared.', 'Give new tasks', false))) return;
    try { await api('POST', '/api/admin/reset-tasks'); toast('Everyone has new tasks'); } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
    filter = b.dataset.f; el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('active', x === b));
    el.querySelector('#ap-title').textContent = { all: 'Everyone', banned: 'Banned', owners: 'Owners', admins: 'Owners & admins', sparks: 'Sparks' }[filter]; load();
  }));
  load();
}
