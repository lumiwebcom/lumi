/* communities: lobby, boards, galleries, levels & ranks */
'use strict';

// ------------------------------------------------------------------ room types
const ROOM_TYPES = {
  text: { icon: 'room', label: 'Chat room', short: 'Chat', desc: 'Messages, photos and files' },
  board: { icon: 'board', label: 'Board', short: 'Board', desc: 'Threads with titles, each with its own replies' },
  gallery: { icon: 'gallery', label: 'Gallery', short: 'Gallery', desc: 'A wall of photos and videos with comments' },
  voice: { icon: 'waves', label: 'Lounge', short: 'Lounge', desc: 'Drop-in voice and video' },
};
const isChatRoom = (c) => c && c.type !== 'voice';
// rooms can be locked so only the owner and Administrator roles can post
const canPost = (sd, c) => can(sd, P.SEND_MESSAGES) && (!c?.locked || can(sd, P.ADMINISTRATOR));
const lockTag = (c) => (c?.locked ? `<span class="lock-tag" data-tip="Only admins can post">${icon('lock', 'xs')}</span>` : '');
const roomIcon = (c, cls = 'sm') => icon((ROOM_TYPES[c?.type] || ROOM_TYPES.text).icon, cls);

// ------------------------------------------------------------------ levels (mirror of the server)
const levelOf = (xp) => Math.floor((Math.sqrt(1 + (4 * (xp || 0)) / 25) - 1) / 2);
const xpFor = (lvl) => 25 * lvl * (lvl + 1);
const RANKS = [[15, 'Legend', 'legend'], [8, 'Veteran', 'veteran'], [3, 'Regular', 'regular'], [0, 'Newcomer', 'newcomer']];
const rankOf = (lvl) => RANKS.find(([min]) => lvl >= min);
const replies = (n) => `${n} ${n === 1 ? 'reply' : 'replies'}`;
function lvlChip(xp, opts = {}) {
  const l = levelOf(xp), r = rankOf(l);
  if (!l && !opts.long) return ''; // newcomers at level 0 don't get a chip
  return `<span class="lvl r-${r[2]}" data-tip="${r[1]} · level ${l}">${opts.long ? `${r[1]} · ` : ''}${l}</span>`;
}
const memberXp = (sd, uid) => sd?.members.find((m) => m.user.id === uid)?.xp || 0;

// ------------------------------------------------------------------ side panel: community card + lobby link
function communityHead(sd) {
  const s = sd.server, online = sd.members.filter((m) => isOnline(m.user.id)).length;
  const b = s.banner;
  return `<div class="cm-head" data-act="server-menu">
    <div class="cm-banner" style="${b ? `background-image:url('${esc(b)}')` : `--c:${colorFor(s.id)}`}"></div>
    <div class="cm-id"><div class="cm-icon" style="--c:${colorFor(s.id)}">${serverIcon(s)}</div>
      <div class="cm-meta"><div class="row"><span class="name">${esc(s.name)}</span>${icon('chevron', 'sm')}</div>
      <div class="cm-counts"><span><i class="on"></i>${online} online</span><span>${plural(sd.members.length, 'member')}</span></div></div></div></div>`;
}
function lobbyNavItem(sd) {
  return `<div class="nav-item chan lobby-link ${S.view.channelId === 'lobby' ? 'active' : ''}" data-chan="lobby">${icon('home', 'sm')}<span class="n" style="flex:1">Lobby</span></div>`;
}

// ------------------------------------------------------------------ lobby
async function renderLobby(main, sd) {
  const s = sd.server, sid = s.id;
  const manage = can(sd, P.MANAGE_SERVER);
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">${icon('home', 'sm')} Lobby</div>
    <div class="tools">${can(sd, P.CREATE_INVITE) ? `<button class="btn primary sm" data-act="invite">${icon('userPlus', 'sm')} Invite</button>` : ''}</div></header>
    <div class="content"><div class="lobby" id="lobby"><div class="muted" style="padding:24px">Loading…</div></div></div>`;
  let pulse = S.pulse?.[sid];
  const paint = () => {
    const el = $('#lobby'); if (!el || S.view.channelId !== 'lobby' || S.view.serverId !== sid) return;
    const p = pulse || { msgsWeek: 0, rooms: [], newest: [], threads: [], photos: [], active: [] };
    const online = sd.members.filter((m) => isOnline(m.user.id)).length;
    const myXp = memberXp(sd, S.me.id), myLvl = levelOf(myXp), myRank = rankOf(myLvl);
    const into = myXp - xpFor(myLvl), span = xpFor(myLvl + 1) - xpFor(myLvl);
    const top = [...sd.members].filter((m) => m.xp > 0).sort((a, b) => b.xp - a.xp).slice(0, 5);
    const lounges = sd.channels.filter((c) => c.type === 'voice' && (S.voice[c.id] || []).length);
    const chan = (id) => sd.channels.find((c) => c.id === id);
    el.innerHTML = `
      <section class="lb-hero">
        <div class="lb-cover" style="${s.banner ? `background-image:url('${esc(s.banner)}')` : `--c:${colorFor(sid)}`}"></div>
        <div class="lb-idrow"><div class="lb-icon" style="--c:${colorFor(sid)}">${serverIcon(s)}</div>
          <div class="lb-title"><h1>${esc(s.name)}</h1>${s.description ? `<p>${esc(s.description)}</p>` : ''}
          <div class="lb-stats"><span><i class="on"></i><b>${online}</b> online</span><span><b>${sd.members.length}</b> ${sd.members.length === 1 ? 'member' : 'members'}</span><span><b>${p.msgsWeek}</b> messages this week</span><span>since ${new Date(s.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span></div></div></div>
      </section>
      <div class="lb-grid">
        <div class="lb-col">
          <section class="lb-card welcome">
            <div class="lb-h"><span>Welcome</span>${manage ? `<button class="btn ghost sm" data-act="edit-welcome">${icon('edit', 'xs')} ${s.welcome ? 'Edit' : 'Write one'}</button>` : ''}</div>
            ${s.welcome ? `<div class="lb-welcome">${md(s.welcome)}</div>` : `<p class="muted">${manage ? 'Write a welcome note: the rules, what this place is about, where to start. Everyone sees it here when they arrive.' : 'Make yourself at home. Say hi in one of the rooms!'}</p>`}
          </section>
          ${p.threads.length ? `<section class="lb-card"><div class="lb-h"><span>Latest on the boards</span></div>
            ${p.threads.map((t) => `<button class="lb-thread" data-open-thread="${t.id}" data-chan-id="${t.channelId}">${avatar(t.author, 32)}<div class="m"><b>${esc(t.title)}</b>
              <span class="muted small">${esc(memberInfo(sd, t.author.id).name)} in ${esc(chan(t.channelId)?.name || 'a board')} · ${replies(t.replyCount)} · ${ago(t.lastReplyAt || t.createdAt)}</span></div></button>`).join('')}</section>` : ''}
          ${p.photos.length ? `<section class="lb-card"><div class="lb-h"><span>From the gallery</span></div><div class="lb-photos">
            ${p.photos.map((m) => `<button class="lb-photo" data-open-photo="${m.id}" data-chan-id="${m.channelId}"><img src="${esc(m.attachment.url)}" alt="" loading="lazy"></button>`).join('')}</div></section>` : ''}
          <section class="lb-card"><div class="lb-h"><span>Rooms</span></div>
            ${sd.channels.filter(isChatRoom).sort((a, b) => a.position - b.position).map((c) => { const r = p.rooms.find((x) => x.id === c.id);
              return `<button class="lb-room" data-goto="${c.id}">${roomIcon(c)}<div class="m"><b>${esc(c.name)}</b><span class="muted small">${esc(c.topic || ROOM_TYPES[c.type].desc)}</span></div>
              <span class="muted small">${r && r.count ? `${r.count} this week` : ''}</span>${c.unread ? '<span class="unread-dot"></span>' : ''}</button>`; }).join('') || '<p class="muted">No rooms yet.</p>'}
          </section>
        </div>
        <div class="lb-col side">
          <section class="lb-card standing"><div class="lb-h"><span>Your standing</span></div>
            <div class="st-row"><div class="st-lvl r-${myRank[2]}">${myLvl}</div><div><b>${myRank[1]}</b><div class="muted small">Level ${myLvl} · ${myXp} xp</div></div></div>
            <div class="xpbar"><i style="width:${Math.max(3, Math.round((into / span) * 100))}%"></i></div>
            <div class="muted small">${span - into} xp to level ${myLvl + 1}. Chat in rooms and hang out in lounges to level up.</div>
          </section>
          <section class="lb-card"><div class="lb-h"><span>Top members</span></div>
            ${top.length ? top.map((m, i) => `<div class="lb-person" data-user="${m.user.id}"><span class="pos">${i + 1}</span>${avatar(S.userCache[m.user.id] || m.user, 30)}<span class="nm">${esc(memberInfo(sd, m.user.id).name)}</span>${lvlChip(m.xp)}</div>`).join('')
              : '<p class="muted small">No one has levelled up yet. Be the first.</p>'}
          </section>
          ${lounges.length ? `<section class="lb-card"><div class="lb-h"><span>In the lounges</span></div>
            ${lounges.map((c) => `<button class="lb-room" data-goto="${c.id}">${icon('waves', 'sm')}<div class="m"><b>${esc(c.name)}</b><span class="lb-faces">${(S.voice[c.id] || []).slice(0, 6).map((x) => avatar(x.user, 22)).join('')}</span></div><span class="small" style="color:var(--green)">Join</span></button>`).join('')}</section>` : ''}
          ${p.newest.length ? `<section class="lb-card"><div class="lb-h"><span>New faces</span></div>
            ${p.newest.map((n) => `<div class="lb-person" data-user="${n.user.id}">${avatar(n.user, 30)}<span class="nm">${esc(memberInfo(sd, n.user.id).name)}</span><span class="muted small">${ago(n.joinedAt)}</span></div>`).join('')}</section>` : ''}
        </div>
      </div>`;
  };
  paint();
  try { pulse = await api('GET', `/api/servers/${sid}/pulse`); (S.pulse ||= {})[sid] = pulse; pulse.newest.forEach((n) => cacheUser(n.user)); paint(); } catch {}
}
async function editWelcome(sid) {
  const sd = S.serverData[sid];
  const m = openModal({ title: 'Welcome note', body: `<p class="muted" style="margin:0 0 12px">Shown at the top of the Lobby. Markdown works: **bold**, *italics*, links.</p>
    <textarea class="textarea" id="wl-text" maxlength="1000" style="min-height:180px" placeholder="Hey, welcome in! A few things to know…">${esc(sd.server.welcome || '')}</textarea>`,
    foot: '<button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>Save</button>' });
  m.el.querySelector('[data-no]').onclick = () => m.close();
  m.el.querySelector('[data-ok]').onclick = async () => {
    try { await api('PATCH', `/api/servers/${sid}`, { welcome: m.el.querySelector('#wl-text').value }); m.close(); await loadServer(sid); renderMain(); toast('Welcome note saved'); } catch (e) { toast(e.message, true); }
  };
}

// ------------------------------------------------------------------ boards & galleries share the main area
function renderRoomView(main, sd, ch) {
  const isBoard = ch.type === 'board';
  const th = S.thread && S.thread.channelId === ch.id ? S.thread : null;
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">${roomIcon(ch)} ${esc(ch.name)}<span class="type-chip">${ROOM_TYPES[ch.type].short}</span>${lockTag(ch)}</div>${ch.topic ? `<div class="topic" data-tip="${esc(ch.topic)}">${esc(ch.topic)}</div>` : ''}
    <div class="tools">${canPost(sd, ch) ? `<button class="btn primary sm" data-act="${isBoard ? 'new-thread' : 'new-photo'}">${icon(isBoard ? 'edit' : 'image', 'sm')} ${isBoard ? 'New thread' : 'Share a photo'}</button>` : ''}
      <button class="icon-btn ${S.showMembers ? 'active' : ''}" data-act="toggle-members" data-tip="Member list">${icon('users', 'sm')}</button></div></header>
    <div class="content"><div class="room-scroll" id="room-body"></div><div id="right-slot" style="display:contents"></div></div>`;
  renderRight();
  if (th) return renderThread();
  if (!S.messages[ch.id]?.loaded) loadRoomPosts(ch.id); else renderRoomBody();
  markRead(ch.id);
}
async function loadRoomPosts(cid, more) {
  const st = S.messages[cid];
  if (more && (!st || st.loading)) return;
  if (!more) S.messages[cid] = { list: [], hasMore: false, loading: true, loaded: false };
  else st.loading = true;
  renderRoomBody();
  try {
    const before = more ? Math.min(...st.list.map((m) => m.createdAt)) : '';
    const r = await api('GET', `/api/channels/${cid}/messages${before ? `?before=${before}` : ''}`);
    r.messages.forEach((m) => cacheUser(m.author));
    const cur = S.messages[cid];
    cur.list = more ? r.messages.concat(cur.list) : r.messages; cur.hasMore = r.hasMore; cur.loading = false; cur.loaded = true;
    renderRoomBody();
  } catch (e) { toast(e.message, true); }
}
function renderRoomBody() {
  const el = $('#room-body'); if (!el) return;
  const sd = currentServer(); const ch = sd?.channels.find((c) => c.id === S.view.channelId); if (!ch) return;
  const st = S.messages[ch.id];
  if (!st || !st.loaded) { el.innerHTML = '<div class="muted" style="padding:24px">Loading…</div>'; return; }
  const more = st.hasMore ? `<button class="btn ghost load-more" data-act="room-more">Load older</button>` : '';
  if (ch.type === 'board') {
    const list = [...st.list].sort((a, b) => (b.lastReplyAt || b.createdAt) - (a.lastReplyAt || a.createdAt));
    el.innerHTML = list.length ? `<div class="board">${list.map((t) => threadCard(sd, t)).join('')}${more}</div>`
      : `<div class="empty"><div class="art">${icon('board')}</div><h3>No threads yet</h3><p>Boards keep conversations tidy: every topic gets a title and its own replies.</p>${canPost(sd, ch) ? '<button class="btn primary" data-act="new-thread">Start the first thread</button>' : ''}</div>`;
  } else {
    const list = [...st.list].reverse();
    el.innerHTML = list.length ? `<div class="gallery">${list.map((m) => photoTile(sd, m)).join('')}</div>${more}`
      : `<div class="empty"><div class="art">${icon('gallery')}</div><h3>The wall is empty</h3><p>Share photos and clips. Everyone can react and comment on each one.</p>${canPost(sd, ch) ? '<button class="btn primary" data-act="new-photo">Share the first one</button>' : ''}</div>`;
  }
}
function threadCard(sd, t) {
  const a = S.userCache[t.author.id] || t.author;
  const preview = (t.content || '').replace(/\s+/g, ' ').slice(0, 180);
  const reacts = t.reactions.reduce((n, r) => n + r.users.length, 0);
  return `<article class="thread-card ${t.pinned ? 'pinned' : ''}" data-open-thread="${t.id}">
    <div class="tc-main"><h3>${t.pinned ? `<span class="pin">${icon('pin', 'xs')}</span>` : ''}${esc(t.title || 'Untitled')}</h3>${preview ? `<p>${esc(preview)}</p>` : ''}
      <div class="tc-by">${avatar(a, 20)}<b>${esc(memberInfo(sd, a.id).name)}</b><span>${ago(t.createdAt)}</span></div></div>
    ${t.attachment?.type === 'image' ? `<img class="tc-img" src="${esc(t.attachment.url)}" alt="" loading="lazy">` : ''}
    <div class="tc-stats"><span>${icon('reply', 'xs')} ${t.replyCount}</span>${reacts ? `<span>${icon('smile', 'xs')} ${reacts}</span>` : ''}<span class="muted">${t.lastReplyAt ? 'active ' + ago(t.lastReplyAt) : ''}</span></div></article>`;
}
function photoTile(sd, m) {
  const a = S.userCache[m.author.id] || m.author;
  const reacts = m.reactions.reduce((n, r) => n + r.users.length, 0);
  const media = m.attachment?.type === 'video' ? `<video src="${esc(m.attachment.url)}" muted preload="metadata"></video><span class="vid">${icon('video', 'xs')}</span>` : `<img src="${esc(m.attachment?.url || '')}" alt="" loading="lazy">`;
  return `<figure class="tile-ph" data-open-photo="${m.id}">${media}
    <figcaption>${avatar(a, 22)}<span class="nm">${esc(memberInfo(sd, a.id).name)}</span><span class="ct">${reacts ? `${icon('smile', 'xs')}${reacts}` : ''}${m.replyCount ? `${icon('reply', 'xs')}${m.replyCount}` : ''}</span></figcaption></figure>`;
}

// ------------------------------------------------------------------ thread view (boards) / photo view (galleries)
async function openThread(tid, cid) {
  S.thread = { id: tid, channelId: cid, data: null };
  if (S.view.channelId !== cid) navigate(`/channels/${S.view.serverId}/${cid}`); // the room view sees S.thread and opens it
  else renderThread();
  try { S.thread.data = await api('GET', `/api/threads/${tid}`); S.thread.data.replies.forEach((m) => cacheUser(m.author)); if (S.thread?.id === tid) renderThread(); }
  catch (e) { toast(e.message, true); S.thread = null; renderMain(); }
}
function replyRow(sd, m) {
  const a = S.userCache[m.author.id] || m.author;
  const att = m.attachment ? (m.attachment.type === 'image' ? `<div class="attach"><img src="${esc(m.attachment.url)}" data-zoom></div>` : `<div class="attach"><a class="file" href="${esc(m.attachment.url)}" target="_blank">${icon('file')}<span>${esc(m.attachment.name || 'file')}</span></a></div>`) : '';
  return `<div class="t-reply" data-mid="${m.id}">${avatar(a, 34)}<div class="b"><div class="h"><b data-user="${a.id}" ${nameAttrs(a)}>${esc(memberInfo(sd, a.id).name)}</b>${roleBadge(a)}${sd ? lvlChip(memberXp(sd, a.id)) : ''}<span>${fmtDay(m.createdAt)} ${fmtTime(m.createdAt)}</span>
    ${(m.author.id === S.me.id || can(sd, P.MANAGE_MESSAGES)) ? `<button class="t-del" data-del-reply="${m.id}" data-tip="Delete">${icon('trash', 'xs')}</button>` : ''}</div>
    ${m.content ? `<div class="c">${md(m.content)}</div>` : ''}${att}</div></div>`;
}
function renderThread() {
  const el = $('#room-body'); const th = S.thread; if (!el || !th) return;
  const sd = currentServer();
  const d = th.data;
  if (!d) { el.innerHTML = '<div class="muted" style="padding:24px">Loading…</div>'; return; }
  const t = d.thread, a = S.userCache[t.author.id] || t.author;
  const mine = t.author.id === S.me.id, mod = can(sd, P.MANAGE_MESSAGES);
  const ch = sd.channels.find((c) => c.id === t.channelId);
  el.innerHTML = `<div class="thread">
    <button class="btn ghost sm back" data-act="close-thread">${icon('back', 'sm')} All ${ch?.type === 'gallery' ? 'photos' : 'threads'}</button>
    <article class="t-op">
      ${t.title ? `<h2>${esc(t.title)}</h2>` : ''}
      <div class="t-by">${avatar(a, 36)}<div><b data-user="${a.id}" ${nameAttrs(a)}>${esc(memberInfo(sd, a.id).name)}</b>${roleBadge(a)} ${lvlChip(memberXp(sd, a.id))}<div class="muted small">${fmtDay(t.createdAt)} ${fmtTime(t.createdAt)}${t.editedAt ? ' · edited' : ''}</div></div>
        <span style="flex:1"></span>${mod ? `<button class="icon-btn" data-act="pin-thread" data-tip="${t.pinned ? 'Unpin' : 'Pin to top'}">${icon('pin', 'sm')}</button>` : ''}${mine || mod ? `<button class="icon-btn danger" data-act="del-thread" data-tip="Delete">${icon('trash', 'sm')}</button>` : ''}</div>
      ${t.attachment ? (t.attachment.type === 'video' ? `<video class="t-media" src="${esc(t.attachment.url)}" controls></video>` : t.attachment.type === 'image' ? `<img class="t-media" src="${esc(t.attachment.url)}" data-zoom>` : `<a class="file" href="${esc(t.attachment.url)}" target="_blank">${icon('file')}<span>${esc(t.attachment.name || 'file')}</span></a>`) : ''}
      ${t.content ? `<div class="t-body">${md(t.content)}</div>` : ''}
      <div class="t-reacts">${t.reactions.map((r) => `<button class="react ${r.users.includes(S.me.id) ? 'mine' : ''}" data-treact="${esc(r.emoji)}">${r.emoji}<b>${r.users.length}</b></button>`).join('')}
        <button class="react add" data-act="thread-react" data-tip="React">${icon('smile', 'sm')}</button></div>
    </article>
    <div class="t-count">${d.replies.length ? replies(d.replies.length) : 'No replies yet'}</div>
    <div class="t-replies">${d.replies.map((m) => replyRow(sd, m)).join('')}</div>
    ${canPost(sd, ch) ? `<form class="t-compose" id="t-compose"><textarea id="t-input" rows="1" maxlength="4000" placeholder="Write a reply…"></textarea><button class="btn primary" type="submit">Reply</button></form>` : ''}
  </div>`;
  const f = $('#t-compose');
  if (f) {
    const ta = $('#t-input');
    ta.oninput = () => autosize(ta);
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async (e) => {
      e.preventDefault(); const content = ta.value.trim(); if (!content) return;
      ta.value = ''; autosize(ta);
      try { const r = await api('POST', `/api/channels/${t.channelId}/messages`, { content, threadId: t.id }); addThreadReply(r.message); } catch (err) { toast(err.message, true); ta.value = content; }
    };
  }
}
function addThreadReply(m) {
  const d = S.thread?.data; if (!d || d.thread.id !== m.threadId) return;
  if (!d.replies.some((x) => x.id === m.id)) d.replies.push(m);
  const keep = $('#t-input')?.value; const focused = document.activeElement?.id === 't-input';
  renderThread();
  const ta = $('#t-input'); if (ta) { ta.value = keep || ''; if (focused) ta.focus(); }
  const sc = $('#room-body'); if (sc && m.author.id === S.me.id) sc.scrollTop = sc.scrollHeight;
}
// photos open in the same thread view: picture on top, comments below
const openPhoto = (mid, cid) => openThread(mid, cid);

// ------------------------------------------------------------------ composers
function openNewThread(sid, cid) {
  let att = null;
  const m = openModal({ title: 'New thread', body: `<div class="field"><label>Title</label><input class="input" id="nt-title" maxlength="120" placeholder="What’s it about?" autofocus></div>
    <div class="field"><label>Post</label><textarea class="textarea" id="nt-body" maxlength="4000" style="min-height:140px" placeholder="Add details, a question, a plan…"></textarea></div>
    <div id="nt-att" class="muted small"></div>`,
    foot: `<button class="btn" data-attach style="margin-right:auto">${icon('image', 'sm')} Add image</button><button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>Post thread</button>` });
  const el = m.el;
  el.querySelector('[data-no]').onclick = () => m.close();
  el.querySelector('[data-attach]').onclick = async () => {
    const f = await pickFile('image/*,video/*'); if (!f) return;
    el.querySelector('#nt-att').textContent = 'Uploading…';
    try { att = await uploadFile(f); el.querySelector('#nt-att').textContent = 'Attached: ' + att.name; } catch (e) { el.querySelector('#nt-att').textContent = ''; toast(e.message, true); }
  };
  el.querySelector('[data-ok]').onclick = async () => {
    const title = el.querySelector('#nt-title').value.trim(); if (!title) return toast('Give your thread a title', true);
    try { const r = await api('POST', `/api/channels/${cid}/messages`, { title, content: el.querySelector('#nt-body').value, attachment: att }); m.close(); upsertRoomPost(r.message); openThread(r.message.id, cid); }
    catch (e) { toast(e.message, true); }
  };
}
async function openNewPhoto(sid, cid) {
  const f = await pickFile('image/*,video/*'); if (!f) return;
  const url = URL.createObjectURL(f); let up = null, failed = false;
  const isVid = f.type.startsWith('video/');
  const m = openModal({ title: 'Share to the gallery', body: `<div class="np-prev">${isVid ? `<video src="${url}" controls></video>` : `<img src="${url}">`}</div>
    <div class="field" style="margin-top:12px"><label>Caption</label><input class="input" id="np-cap" maxlength="500" placeholder="Say something about it (optional)" autofocus></div>`,
    foot: '<button class="btn" data-no>Cancel</button><button class="btn primary" data-ok disabled>Uploading…</button>' });
  const ok = m.el.querySelector('[data-ok]');
  m.el.querySelector('[data-no]').onclick = () => m.close();
  uploadFile(f).then((u) => { up = u; ok.disabled = false; ok.textContent = 'Share'; }, (e) => { failed = true; toast(e.message, true); m.close(); });
  ok.onclick = async () => {
    if (!up || failed) return;
    try { const r = await api('POST', `/api/channels/${cid}/messages`, { content: m.el.querySelector('#np-cap').value, attachment: up }); m.close(); upsertRoomPost(r.message); }
    catch (e) { toast(e.message, true); }
  };
}
function upsertRoomPost(m) {
  const st = S.messages[m.channelId]; if (!st) return;
  const i = st.list.findIndex((x) => x.id === m.id);
  if (i >= 0) st.list[i] = m; else st.list.push(m);
  if (S.view.channelId === m.channelId && !S.thread) renderRoomBody();
}

// ------------------------------------------------------------------ realtime: called from main.js
function communityOnMessage(m) {
  if (m.threadId) { if (S.thread?.id === m.threadId) addThreadReply(m); return true; }
  const sd = currentServer(); const ch = sd?.channels.find((c) => c.id === m.channelId);
  if (ch && (ch.type === 'board' || ch.type === 'gallery')) { upsertRoomPost(m); return true; }
  return false;
}
function communityOnUpdate(m) {
  if (S.thread?.data) {
    if (S.thread.data.thread.id === m.id) { S.thread.data.thread = m; renderThread(); }
    else { const i = S.thread.data.replies.findIndex((x) => x.id === m.id); if (i >= 0) { S.thread.data.replies[i] = m; renderThread(); } }
  }
  if (!m.threadId) upsertRoomPost(m);
}
function communityOnDelete({ id, channelId, threadId }) {
  if (threadId && S.thread?.data?.thread.id === threadId) { S.thread.data.replies = S.thread.data.replies.filter((x) => x.id !== id); renderThread(); return; }
  if (S.thread?.id === id) { S.thread = null; if (S.view.channelId === channelId) { renderMain(); toast('That thread was deleted'); } }
  const st = S.messages[channelId]; if (st) st.list = st.list.filter((x) => x.id !== id);
  if (S.view.channelId === channelId && !S.thread) renderRoomBody();
}
function onXp({ serverId, userId, xp }) {
  const sd = S.serverData[serverId]; const mem = sd?.members.find((m) => m.user.id === userId); if (!mem) return;
  mem.xp = xp;
  if (S.view.serverId === serverId) { if (S.view.channelId === 'lobby') renderMain(); else renderRight(); }
}
function onLevelUp({ serverId, level, rank }) {
  const name = S.serverData[serverId]?.server.name || S.servers.find((s) => s.id === serverId)?.name || 'a community';
  toast(`Level ${level} in ${name}${level === 3 || level === 8 || level === 15 ? ` — you’re now a ${rank}!` : '!'}`);
}

// ------------------------------------------------------------------ clicks inside rooms and the lobby
async function communityClick(e) {
  const t = e.target.closest('[data-open-thread],[data-open-photo],[data-goto],[data-treact],[data-del-reply],[data-act]'); if (!t) return false;
  const sid = S.view.serverId, sd = currentServer(); if (!sd) return false;
  if (t.dataset.openThread) { openThread(t.dataset.openThread, t.dataset.chanId || S.view.channelId); return true; }
  if (t.dataset.openPhoto) { openPhoto(t.dataset.openPhoto, t.dataset.chanId || S.view.channelId); return true; }
  if (t.dataset.goto) { const c = sd.channels.find((x) => x.id === t.dataset.goto); navigate(`/channels/${sid}/${c.id}`); if (c.type === 'voice' && Call.active?.channelId !== c.id) joinCall(c.id); return true; }
  if (t.dataset.treact) { react(S.thread.id, t.dataset.treact); return true; }
  if (t.dataset.delReply) { if (await confirmDialog('Delete reply', 'Delete this reply? This can’t be undone.', 'Delete')) api('DELETE', `/api/messages/${t.dataset.delReply}`).catch((err) => toast(err.message, true)); return true; }
  switch (t.dataset.act) {
    case 'new-thread': openNewThread(sid, S.view.channelId); return true;
    case 'new-photo': openNewPhoto(sid, S.view.channelId); return true;
    case 'room-more': loadRoomPosts(S.view.channelId, true); return true;
    case 'close-thread': S.thread = null; renderMain(); return true;
    case 'edit-welcome': editWelcome(sid); return true;
    case 'thread-react': openMenu(t, [{ html: `<div class="quick-react">${QUICK.map((q) => `<button>${q}</button>`).join('')}</div>`, mount: (x) => x.querySelectorAll('button').forEach((b) => (b.onclick = () => { closeMenu(); react(S.thread.id, b.textContent); })) }]); return true;
    case 'pin-thread': api('POST', `/api/messages/${S.thread.id}/pin`).catch((err) => toast(err.message, true)); return true;
    case 'del-thread': {
      const ch = sd.channels.find((c) => c.id === S.thread.channelId);
      if (!(await confirmDialog(ch?.type === 'gallery' ? 'Delete post' : 'Delete thread', 'This deletes it and every reply. This can’t be undone.', 'Delete'))) return true;
      try { await api('DELETE', `/api/messages/${S.thread.id}`); S.thread = null; renderMain(); } catch (err) { toast(err.message, true); }
      return true;
    }
  }
  return false;
}
