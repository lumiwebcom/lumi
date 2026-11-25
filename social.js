/* social: home feed, posts, daily spark, activity, orbits directory, orbit overview */
'use strict';

S.feed = { scope: 'all', posts: [], loaded: false, hasMore: false, loading: false };
S.commPosts = {};
S.openComments = new Set();
S.commentCache = {};
S.activityUnread = 0;

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pageHead = (title, extra = '') => `<header class="main-head page-head">${mobileBtn()}<div class="t">${title}</div><div class="tools">${extra}</div></header>`;

// ------------------------------------------------------------------ post card
function postCard(p) {
  const a = S.userCache[p.author.id] || p.author; cacheUser(p.author);
  const open = S.openComments.has(p.id);
  const cmts = open && S.commentCache[p.id] ? S.commentCache[p.id] : p.comments;
  const likers = p.likers.filter((u) => u.id !== S.me.id);
  const likeLine = p.likes ? (p.liked ? (p.likes === 1 ? 'You glowed this' : `You and ${plural(p.likes - 1, 'other')} glowed this`)
    : likers.length ? `${esc(likers[0].displayName)}${p.likes > 1 ? ` and ${plural(p.likes - 1, 'other')}` : ''} glowed this` : '') : '';
  return `<article class="post" data-pid="${p.id}">
    <header class="post-head">
      <span data-user="${a.id}" class="post-av">${avatar(a, 40)}</span>
      <div class="meta"><div class="n"><b data-user="${a.id}">${esc(a.displayName)}</b>${roleBadge(a)}
        ${p.server ? `<span class="in">in</span><a class="comm-chip" data-pact="open-comm" data-sid="${p.server.id}">${commIcon(p.server, 16)}${esc(p.server.name)}</a>` : ''}</div>
        <div class="sub">@${esc(a.username)} · <time title="${esc(new Date(p.createdAt).toLocaleString())}">${ago(p.createdAt)}</time></div></div>
      ${p.canDelete ? `<button class="icon-btn" data-pact="more" data-tip="More">${icon('more', 'sm')}</button>` : ''}
    </header>
    ${p.spark ? `<div class="spark-tag">${icon('sparkle', 'xs')}<span>Daily Spark</span><q>${esc(p.spark.text)}</q></div>` : ''}
    ${p.content ? `<div class="post-body">${md(p.content)}</div>` : ''}
    ${p.image ? `<div class="post-media"><img src="${esc(p.image)}" alt="" loading="lazy" data-zoom></div>` : ''}
    ${likeLine ? `<div class="post-likes">${likers.slice(0, 3).map((u) => avatar(u, 18)).join('')}<span>${likeLine}</span></div>` : ''}
    <footer class="post-acts">
      <button class="pa ${p.liked ? 'on' : ''}" data-pact="glow">${icon('glow', 'sm')}<span>${p.likes ? p.likes : 'Glow'}</span></button>
      <button class="pa ${open ? 'on-soft' : ''}" data-pact="comments">${icon('reply', 'sm')}<span>${p.commentCount ? plural(p.commentCount, 'reply').replace('replys', 'replies') : 'Reply'}</span></button>
      ${p.author.id !== S.me.id ? `<button class="pa" data-pact="dm">${icon('send', 'sm')}<span>Message</span></button>` : ''}
    </footer>
    ${(cmts.length || open) ? `<div class="post-cmts">
      ${!open && p.commentCount > cmts.length ? `<button class="more-cmts" data-pact="comments">View all ${p.commentCount} replies</button>` : ''}
      ${cmts.map((c) => `<div class="cmt">${avatar(c.author, 28)}<div class="cb"><div class="ch"><b data-user="${c.author.id}">${esc(c.author.displayName)}</b><span>${ago(c.createdAt)}</span>${c.canDelete ? `<button class="cdel" data-pact="del-cmt" data-cid="${c.id}">Delete</button>` : ''}</div><div class="ct">${md(c.content)}</div></div></div>`).join('')}
      ${open ? `<form class="cmt-form" data-pact-form="reply">${avatar(S.me, 28)}<input name="c" placeholder="Write a reply…" maxlength="500" autocomplete="off"><button class="btn sm primary">Reply</button></form>` : ''}
    </div>` : ''}
  </article>`;
}
function findPost(pid) {
  return S.feed.posts.find((p) => p.id === pid) || Object.values(S.commPosts).flatMap((c) => c.posts).find((p) => p.id === pid);
}
function replacePost(post) {
  for (const list of [S.feed.posts, ...Object.values(S.commPosts).map((c) => c.posts)]) { const i = list.findIndex((p) => p.id === post.id); if (i >= 0) list[i] = post; }
  document.querySelectorAll(`.post[data-pid="${post.id}"]`).forEach((el) => {
    const f = el.querySelector('.cmt-form input'); const v = f?.value; const focused = document.activeElement === f;
    el.outerHTML = postCard(post);
    if (v || focused) { const n = $(`.post[data-pid="${post.id}"] .cmt-form input`); if (n) { n.value = v || ''; if (focused) n.focus(); } }
  });
}
function removePost(pid) {
  S.feed.posts = S.feed.posts.filter((p) => p.id !== pid);
  for (const c of Object.values(S.commPosts)) c.posts = c.posts.filter((p) => p.id !== pid);
  document.querySelectorAll(`.post[data-pid="${pid}"]`).forEach((el) => el.remove());
}
async function refreshPost(pid) {
  try {
    const { post } = await api('GET', '/api/posts/' + pid); replacePost(post);
    if (S.openComments.has(pid)) await loadComments(pid);
  } catch (e) { if (e.status === 404) removePost(pid); }
}
async function loadComments(pid) {
  const r = await api('GET', `/api/posts/${pid}/comments`); S.commentCache[pid] = r.comments;
  const p = findPost(pid); if (p) replacePost(p);
}
async function onPostAction(t, e) {
  const el = t.closest('[data-pid]'); const pid = el?.dataset.pid; const p = pid && findPost(pid);
  const act = t.dataset.pact;
  if (act === 'open-comm') return navigate('/channels/' + t.dataset.sid);
  if (act === 'compose') return openPostComposer({ serverId: t.dataset.sid || null });
  if (act === 'spark') return openPostComposer({ spark: true });
  if (act === 'scope') { S.feed.scope = t.dataset.scope; S.feed.loaded = false; return renderFeed($('#main')); }
  if (act === 'feed-more') return loadFeed(true);
  if (act === 'comm-more') return loadCommPosts(t.dataset.sid, true);
  if (act === 'act-go') { if (t.dataset.sid) return navigate('/channels/' + t.dataset.sid); if (t.dataset.post) return openPostView(t.dataset.post); return; }
  if (!p) return;
  if (act === 'glow') {
    p.liked = !p.liked; p.likes += p.liked ? 1 : -1; replacePost(p);
    if (p.liked) { const b = $(`.post[data-pid="${pid}"] [data-pact=glow]`); b?.classList.add('pop'); }
    try { const r = await api('POST', `/api/posts/${pid}/like`); replacePost(r.post); } catch (err) { toast(err.message, true); }
    return;
  }
  if (act === 'comments') {
    if (S.openComments.has(pid) && t.classList.contains('pa')) { S.openComments.delete(pid); return replacePost(p); }
    S.openComments.add(pid); replacePost(p); $(`.post[data-pid="${pid}"] .cmt-form input`)?.focus();
    return loadComments(pid).catch((err) => toast(err.message, true));
  }
  if (act === 'dm') return openDM(p.author.id);
  if (act === 'del-cmt') { try { await api('DELETE', '/api/comments/' + t.dataset.cid); await loadComments(pid); } catch (err) { toast(err.message, true); } return; }
  if (act === 'more') return openMenu(t, [
    { label: 'Copy text', icon: 'copy', onClick: () => copyText(p.content || '') },
    p.canDelete && { label: 'Delete post', icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirmDialog('Delete post?', 'This post and its replies will be removed for everyone.', 'Delete'))) return;
      try { await api('DELETE', '/api/posts/' + pid); removePost(pid); toast('Post deleted'); } catch (err) { toast(err.message, true); } } },
  ], { align: 'right' });
}
document.addEventListener('click', (e) => { const t = e.target.closest('[data-pact]'); if (t && !t.closest('.menu')) { e.preventDefault(); onPostAction(t, e); } });
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-pact-form="reply"]'); if (!f) return; e.preventDefault();
  const pid = f.closest('[data-pid]').dataset.pid; const v = f.c.value.trim(); if (!v) return;
  f.c.value = ''; f.querySelector('button').disabled = true;
  try { const r = await api('POST', `/api/posts/${pid}/comments`, { content: v }); replacePost(r.post); await loadComments(pid); $(`.post[data-pid="${pid}"] .cmt-form input`)?.focus(); }
  catch (err) { toast(err.message, true); f.c.value = v; }
  finally { const b = $(`.post[data-pid="${pid}"] .cmt-form button`); if (b) b.disabled = false; }
});
async function openPostView(pid) {
  try {
    const { post } = await api('GET', '/api/posts/' + pid);
    S.openComments.add(pid); S.feed.posts.some((p) => p.id === pid) || (S.commPosts._single = { posts: [post] });
    const m = openModal({ title: 'Post', cls: 'post-modal', body: `<div class="feed-list">${postCard(post)}</div>`, onClose: () => { delete S.commPosts._single; } });
    await loadComments(pid); m.el.querySelector('.cmt-form input')?.focus();
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------------ composer
function openPostComposer({ serverId = null, spark = false } = {}) {
  let image = null, busy = false;
  const sp = spark ? S.spark?.spark : null;
  const opts = `<option value="">Friends</option>` + S.servers.map((s) => `<option value="${s.id}" ${s.id === serverId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const m = openModal({
    title: spark ? 'Answer today’s Spark' : 'New post', cls: 'composer-modal',
    body: `${sp ? `<div class="spark-tag big">${icon('sparkle', 'xs')}<span>Daily Spark</span><q>${esc(sp.text)}</q></div>` : ''}
      <div class="pc-row">${avatar(S.me, 40)}<div class="pc-main">
        <div class="pc-who"><b>${esc(S.me.displayName)}</b>
          ${spark ? '<span class="aud-fixed">Friends</span>' : `<label class="aud">${icon('users', 'xs')}<select id="pc-aud">${opts}</select>${icon('chevron', 'xs')}</label>`}</div>
        <textarea id="pc-text" maxlength="1000" placeholder="${spark ? 'Your answer…' : 'What’s happening?'}" autofocus></textarea>
        <div id="pc-img"></div></div></div>`,
    foot: `<button class="icon-btn" data-img data-tip="Add a photo">${icon('image', 'sm')}</button><span class="pc-count" id="pc-count">0 / 1000</span><span style="flex:1"></span>
      <button class="btn" data-cancel>Cancel</button><button class="btn primary" data-post disabled>Post</button>`,
  });
  const ta = m.el.querySelector('#pc-text'), postBtn = m.el.querySelector('[data-post]');
  const sync = () => { m.el.querySelector('#pc-count').textContent = `${ta.value.length} / 1000`; postBtn.disabled = busy || (!ta.value.trim() && !image); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; };
  ta.oninput = sync;
  m.el.querySelector('[data-cancel]').onclick = () => m.close();
  m.el.querySelector('[data-img]').onclick = async () => {
    const f = await pickFile('image/*'); if (!f) return;
    const slot = m.el.querySelector('#pc-img'); slot.innerHTML = '<div class="pc-up">Uploading…</div>'; busy = true; sync();
    try { const r = await uploadFile(f); image = r.url; slot.innerHTML = `<div class="pc-prev"><img src="${esc(image)}" alt=""><button class="icon-btn" data-rm>${icon('x', 'sm')}</button></div>`; slot.querySelector('[data-rm]').onclick = () => { image = null; slot.innerHTML = ''; sync(); }; }
    catch (e) { slot.innerHTML = ''; toast(e.message, true); }
    busy = false; sync();
  };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !postBtn.disabled) postBtn.click(); };
  postBtn.onclick = async () => {
    busy = true; sync();
    const sid = spark ? null : (m.el.querySelector('#pc-aud')?.value || null);
    try {
      const { post } = await api('POST', '/api/posts', { content: ta.value, image, serverId: sid, spark });
      m.close(); toast(sid ? 'Shared with the orbit' : 'Posted');
      if (spark && S.spark) S.spark.answered = true;
      insertNewPost(post);
    } catch (e) { toast(e.message, true); busy = false; sync(); }
  };
}
function insertNewPost(post) {
  const sc = S.feed.scope;
  if (S.feed.loaded && !S.feed.posts.some((p) => p.id === post.id) && (sc === 'all' || (sc === 'friends' && !post.server) || (sc === 'orbits' && post.server))) S.feed.posts.unshift(post);
  if (post.server && S.commPosts[post.server.id] && !S.commPosts[post.server.id].posts.some((p) => p.id === post.id)) S.commPosts[post.server.id].posts.unshift(post);
  if (S.view.type === 'feed') renderFeedList();
  if (S.view.overview && post.server?.id === S.view.serverId) renderCommPosts(post.server.id);
  if (S.view.type === 'feed') renderSpark();
}

// ------------------------------------------------------------------ home feed
function greet() { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
function aroundStrip() {
  const friends = S.friends.filter((f) => f.type === 'friend').map((f) => S.userCache[f.user.id] || f.user);
  const dmLive = S.dms.filter((d) => (S.voice[d.id] || []).length && Call.active?.channelId !== d.id);
  const lounges = []; for (const sd of Object.values(S.serverData)) for (const c of sd.channels) if (c.type === 'voice' && (S.voice[c.id] || []).length && Call.active?.channelId !== c.id) lounges.push({ sd, c });
  const on = friends.filter((u) => isOnline(u.id)).sort((a, b) => !!b.customStatus - !!a.customStatus);
  let html = '';
  for (const d of dmLive) html += `<div class="pal live" data-dm="${d.id}">${dmAvatar(d, 56)}<b>${esc(dmName(d))}</b><span class="pl-s">In a call</span><span class="pl-go">Drop in →</span></div>`;
  for (const { sd, c } of lounges) html += `<div class="pal live orb" data-lounge="${c.id}" data-sid="${sd.server.id}" style="--c:${colorFor(sd.server.id)}"><span class="pl-flag">${esc(initials(sd.server.name).toUpperCase())}</span><b>${esc(c.name)}</b><span class="pl-s">${plural(S.voice[c.id].length, 'person')} in ${esc(sd.server.name)}</span><span class="pl-go">Drop in →</span></div>`;
  for (const u of on) html += `<div class="pal" data-user="${u.id}">${u.customStatus ? `<span class="pl-note">${esc(u.customStatus)}</span>` : ''}${avatar(u, 56, { dot: true })}<b>${esc(u.displayName.split(' ')[0])}</b><span class="pl-s">${u.customStatus ? 'Online' : 'Around now'}</span></div>`;
  if (html) html += `<div class="pal add" data-nav-link="/friends"><span class="plus">${icon('userPlus', 'sm')}</span>Add people</div>`;
  if (!html) html = `<div class="around-empty">Nobody’s around right now. <a data-nav-link="/friends">Find people</a> or <button class="linkish" data-pact="compose">post something</button> to get things going.</div>`;
  return { html, count: on.length, live: dmLive.length + lounges.length };
}
function renderFeed(main) {
  const sc = S.feed.scope;
  const tab = (k, l) => `<button class="ftab ${sc === k ? 'active' : ''}" data-pact="scope" data-scope="${k}">${l}</button>`;
  const ar = aroundStrip(); const unread = S.dms.reduce((a, d) => a + d.unread, 0);
  const bits = [ar.count ? `${plural(ar.count, 'friend')} around` : '', ar.live ? `${ar.live} live` : '', unread ? `${plural(unread, 'unread message')}` : ''].filter(Boolean);
  main.innerHTML = `<div class="page now">
    <header class="now-hero"><span class="kicker">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      <h1>${greet()}, ${esc(S.me.displayName.split(' ')[0])}.</h1><p>${bits.length ? bits.join(' · ') : 'Here’s what’s happening with your people.'}</p></header>
    <section class="around"><div class="sec-k">Around now</div><div class="around-row" id="around">${ar.html}</div></section>
    <div class="now-grid"><div class="now-main">
      <form class="inline-post" id="now-post">${avatar(S.me, 40)}<div class="ip-body"><textarea name="t" rows="1" maxlength="1000" placeholder="What’s on your mind, ${esc(S.me.displayName.split(' ')[0])}?"></textarea>
        <div class="ip-img" id="ip-img"></div>
        <div class="ip-foot"><label class="ip-aud">To <select name="aud"><option value="">Friends</option>${S.servers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <button type="button" class="icon-btn" data-ip-img data-tip="Add a photo">${icon('image', 'sm')}</button><span style="flex:1"></span><button class="btn primary sm" type="submit" disabled>Post</button></div></div></form>
      <section class="spark" id="spark"></section>
      <section class="moments"><div class="sec-k">Moments <span>· gone in 24h</span></div>${storiesBar()}</section>
      <div class="ftabs">${tab('all', 'Everything')}${tab('friends', 'Friends')}${tab('orbits', 'Orbits')}</div>
      <div class="feed-list" id="feed-list"></div>
    </div><aside class="now-side" id="feed-side"></aside></div></div>`;
  wireInlinePost(main.querySelector('#now-post'));
  main.querySelectorAll('[data-lounge]').forEach((x) => (x.onclick = () => { navigate(`/channels/${x.dataset.sid}/${x.dataset.lounge}`); joinCall(x.dataset.lounge); }));
  renderSpark(); renderFeedSide(); renderFeedList();
  if (!S.feed.loaded) loadFeed();
  if (!S.spark) api('GET', '/api/spark').then((r) => { S.spark = r; renderSpark(); }).catch(() => {});
}
function wireInlinePost(f, fixedSid) {
  let image = null, busy = false; const ta = f.querySelector('textarea'), btn = f.querySelector('[type=submit]');
  const sync = () => { btn.disabled = busy || (!ta.value.trim() && !image); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'; f.classList.toggle('open', document.activeElement === ta || !!ta.value || !!image); };
  ta.oninput = sync; ta.onfocus = sync; ta.onblur = () => setTimeout(sync, 150);
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !btn.disabled) f.requestSubmit(); };
  f.querySelector('[data-ip-img]').onclick = async () => {
    const file = await pickFile('image/*'); if (!file) return; const slot = f.querySelector('.ip-img'); slot.textContent = 'Uploading…'; busy = true; sync();
    try { image = (await uploadFile(file)).url; slot.innerHTML = `<div class="pc-prev"><img src="${esc(image)}" alt=""><button type="button" class="icon-btn">${icon('x', 'sm')}</button></div>`; slot.querySelector('button').onclick = () => { image = null; slot.innerHTML = ''; sync(); }; }
    catch (e) { slot.innerHTML = ''; toast(e.message, true); }
    busy = false; sync();
  };
  f.onsubmit = async (e) => {
    e.preventDefault(); if (btn.disabled) return; busy = true; sync();
    try {
      const { post } = await api('POST', '/api/posts', { content: ta.value, image, serverId: fixedSid || f.aud?.value || null });
      ta.value = ''; image = null; f.querySelector('.ip-img').innerHTML = ''; toast('Posted'); insertNewPost(post);
    } catch (err) { toast(err.message, true); }
    busy = false; sync();
  };
}
async function loadFeed(more = false) {
  if (S.feed.loading) return; S.feed.loading = true; const sc = S.feed.scope;
  if (!more) renderFeedList();
  try {
    const before = more && S.feed.posts.length ? S.feed.posts[S.feed.posts.length - 1].createdAt : '';
    const r = await api('GET', `/api/feed?scope=${sc}${before ? '&before=' + before : ''}`);
    if (S.feed.scope !== sc) return;
    S.feed.posts = more ? [...S.feed.posts, ...r.posts] : r.posts; S.feed.hasMore = r.posts.length === 20; S.feed.loaded = true;
  } catch (e) { toast(e.message, true); }
  S.feed.loading = false; renderFeedList();
}
function renderFeedList() {
  const el = $('#feed-list'); if (!el) return;
  if (!S.feed.loaded) { el.innerHTML = [1, 2].map(() => `<div class="post skel"><div class="sk-h"><i class="sk-av"></i><div><i class="sk-l w40"></i><i class="sk-l w25"></i></div></div><i class="sk-l"></i><i class="sk-l w70"></i></div>`).join(''); return; }
  if (!S.feed.posts.length) {
    const sc = S.feed.scope;
    el.innerHTML = `<div class="empty-card">${icon(sc === 'orbits' ? 'grid' : 'feed')}<h3>${sc === 'orbits' ? 'No orbit updates yet' : 'Your feed is quiet'}</h3>
      <p>${sc === 'orbits' ? 'Updates posted in your orbits appear here.' : 'Posts from you and your friends appear here. Start things off with a post or answer today’s Spark.'}</p>
      <button class="btn primary" data-pact="compose">Write a post</button></div>`;
    return;
  }
  el.innerHTML = S.feed.posts.map(postCard).join('') + (S.feed.hasMore ? `<button class="btn ghost load-feed" data-pact="feed-more">${S.feed.loading ? 'Loading…' : 'Show more'}</button>` : '<div class="feed-end">You’re all caught up</div>');
}
function renderSpark() {
  const el = $('#spark'); if (!el) return;
  const d = S.spark; if (!d) { el.hidden = true; return; }
  el.hidden = false;
  const hrs = Math.max(1, Math.round((d.spark.endsAt - Date.now()) / 3600000)); const fr = d.friends || [];
  el.innerHTML = `<div class="spark-top"><span class="spark-badge">${icon('sparkle', 'xs')} Today’s Spark</span><span class="spark-t">${hrs}h left</span></div>
    <p class="spark-q">${esc(d.spark.text)}</p>
    ${d.answered ? `<div class="spark-done">${icon('check', 'xs')} You answered. ${fr.length ? `${plural(fr.length, 'friend')} did too. Their answers are in your feed.` : 'Your friends will see it in their feed.'}</div>`
      : `<form class="spark-form" id="spark-form"><input name="a" maxlength="500" placeholder="Your answer…" autocomplete="off"><button class="btn sm">Answer</button></form>`}
    ${fr.length ? `<div class="spark-who"><span class="stack">${fr.slice(0, 5).map((u) => avatar(u, 22)).join('')}</span>${esc(fr[0].displayName)}${fr.length > 1 ? ` and ${plural(fr.length - 1, 'other')}` : ''} answered</div>` : ''}`;
  el.querySelector('#spark-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = e.target.a.value.trim(); if (!v) return; e.target.querySelector('button').disabled = true;
    try { const { post } = await api('POST', '/api/posts', { content: v, spark: true }); S.spark.answered = true; insertNewPost(post); renderSpark(); }
    catch (err) { toast(err.message, true); e.target.querySelector('button').disabled = false; }
  });
}
function renderFeedSide() {
  const el = $('#feed-side'); if (!el) return;
  const ar = $('#around'); if (ar) { ar.innerHTML = aroundStrip().html; ar.querySelectorAll('[data-lounge]').forEach((x) => (x.onclick = () => { navigate(`/channels/${x.dataset.sid}/${x.dataset.lounge}`); joinCall(x.dataset.lounge); })); }
  const convos = S.dms.filter((d) => d.lastMessage).slice(0, 6);
  let html = `<section class="idx"><div class="sec-k">Chats <a data-nav-link="/messages">All →</a></div>${convos.length ? convos.map((d) => `<div class="idx-row ${d.unread ? 'unread' : ''}" data-dm="${d.id}">${dmAvatar(d, 34)}<div class="ir-m"><b>${esc(dmName(d))}</b><span>${d.lastMessage.authorId === S.me.id ? 'You: ' : ''}${esc(d.lastMessage.content || 'Attachment')}</span></div><div class="ir-x">${streakChip(d)}${d.unread ? `<span class="ucount">${d.unread}</span>` : `<span class="time">${ago(d.lastMessage.createdAt)}</span>`}</div></div>`).join('') : '<p class="idx-empty">No chats yet.</p>'}</section>`;
  html += `<section class="idx"><div class="sec-k">Your orbits <a data-nav-link="/orbits">All →</a></div>${S.servers.length ? S.servers.slice(0, 6).map((s) => `<div class="idx-row" data-pact="open-comm" data-sid="${s.id}"><span class="flag" style="--c:${colorFor(s.id)}">${s.icon ? `<img src="${esc(s.icon)}" alt="">` : esc(initials(s.name).toUpperCase())}</span><div class="ir-m"><b>${esc(s.name)}</b><span>${plural(s.memberCount || 1, 'member')}</span></div>${s.unread ? `<span class="ucount">${s.unread > 99 ? '99+' : s.unread}</span>` : ''}</div>`).join('') : '<p class="idx-empty">You’re not in any orbits yet. <button class="linkish" data-act-c2="create">Start one</button></p>'}</section>
    <footer class="side-legal"><a href="/privacy" target="_blank">Privacy</a> · <a href="/terms" target="_blank">Terms</a> · lumi © ${new Date().getFullYear()}</footer>`;
  el.innerHTML = html;
  el.querySelector('[data-act-c2]')?.addEventListener('click', () => openCreateServer());
}
// ------------------------------------------------------------------ activity
async function renderActivity(main) {
  S.activityUnread = 0; renderRail();
  main.innerHTML = `${pageHead('Activity')}<div class="page narrow"><div id="act-list"><div class="list-card"><div class="muted pad">Loading…</div></div></div></div>`;
  let items = [];
  try { items = (await api('GET', '/api/activity')).items; } catch (e) { toast(e.message, true); }
  if (S.view.type !== 'activity') return;
  const reqs = S.friends.filter((f) => f.type === 'incoming');
  const verb = { glow: 'glowed your post', reply: 'replied to your post', join: 'joined' };
  let html = '';
  if (reqs.length) html += `<h5 class="list-h">Friend requests</h5><div class="list-card">${reqs.map((f) => `<div class="act-row" data-fid="${f.user.id}">${avatar(f.user, 40)}<div class="ar"><b>${esc(f.user.displayName)}</b> <span class="muted">@${esc(f.user.username)}</span><div class="muted small">wants to be friends</div></div>
    <button class="btn sm primary" data-act="accept">Accept</button><button class="btn sm" data-act="decline">Ignore</button></div>`).join('')}</div>`;
  html += `<h5 class="list-h">Recent</h5>`;
  if (!items.length) html += `<div class="empty-card">${icon('bell')}<h3>Nothing new yet</h3><p>When people glow or reply to your posts, or join your orbits, you’ll see it here.</p></div>`;
  else {
    let last = '';
    html += '<div class="list-card">';
    for (const it of items) {
      const day = fmtDay(it.createdAt); if (day !== last) { html += `<div class="act-day">${day}</div>`; last = day; }
      const ic = it.kind === 'glow' ? 'glow' : it.kind === 'reply' ? 'reply' : 'userPlus';
      html += `<div class="act-row clickable" data-pact="act-go" ${it.postId ? `data-post="${it.postId}"` : ''} ${it.serverId ? `data-sid="${it.serverId}"` : ''}>
        <span class="act-av">${avatar(it.from, 40)}<span class="act-ic k-${it.kind}">${icon(ic, 'xs')}</span></span>
        <div class="ar"><div><b>${esc(it.from.displayName)}</b> ${verb[it.kind]}${it.kind === 'join' ? ` <b>${esc(it.snippet)}</b>` : ''}</div>${it.kind !== 'join' && it.snippet ? `<div class="snip">“${esc(it.snippet)}”</div>` : ''}</div>
        <span class="time">${ago(it.createdAt)}</span></div>`;
    }
    html += '</div>';
  }
  $('#act-list').innerHTML = html;
}

// ------------------------------------------------------------------ orbits directory
function orbFlag(s, size = 52) { return `<span class="flag" style="--c:${colorFor(s.id)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px">${s.icon ? `<img src="${esc(s.icon)}" alt="">` : esc(initials(s.name).toUpperCase())}</span>`; }
function renderCommunities(main) {
  const liveIn = (sid) => { const sd = S.serverData[sid]; return sd ? sd.channels.reduce((a, c) => a + (S.voice[c.id] || []).length, 0) : 0; };
  main.innerHTML = `<div class="page orbits">
    <header class="page-hero"><span class="kicker">${plural(S.servers.length, 'orbit')}</span><h1>Orbits</h1>
      <p>Orbits are small worlds for your groups: rooms to talk in, lounges to hang out in, and a board for updates.</p>
      <div class="hero-acts"><button class="btn primary" data-act-c="create">${icon('plus', 'sm')} Start an orbit</button><button class="btn" data-act-c="join">${icon('link', 'sm')} Join with an invite</button></div></header>
    ${S.servers.length ? `<ol class="orbit-index">${S.servers.map((s, i) => { const lv = liveIn(s.id); return `<li class="orb-row" data-pact="open-comm" data-sid="${s.id}" style="--c:${colorFor(s.id)}">
      <span class="orb-n">${String(i + 1).padStart(2, '0')}</span>${orbFlag(s, 56)}
      <div class="orb-main"><h3>${esc(s.name)}</h3><p>${esc(s.description || 'No description yet.')}</p></div>
      <div class="orb-meta"><span>${plural(s.memberCount || 1, 'member')}</span>${s.ownerId === S.me.id ? '<span>You run this</span>' : ''}${lv ? `<span class="live-txt">● ${lv} in a lounge</span>` : ''}</div>
      ${s.unread ? `<span class="orb-new">${s.unread > 99 ? '99+' : s.unread} new</span>` : '<span></span>'}<span class="orb-go">→</span></li>`; }).join('')}</ol>`
      : `<div class="empty-block"><h3>No orbits yet</h3><p>Start one for your friends, team, class or club, or join one with an invite link.</p></div>`}
  </div>`;
  main.querySelectorAll('[data-act-c]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openCreateServer(b.dataset.actC === 'join' ? 'join' : 'create'); }));
}
// ------------------------------------------------------------------ orbit overview
function renderCommunityOverview(main) {
  const sd = S.serverData[S.view.serverId]; if (!sd) return;
  const sv = sd.server, sid = sv.id;
  const online = sd.members.filter((m) => isOnline(m.user.id));
  const texts = sd.channels.filter((c) => c.type === 'text'), voices = sd.channels.filter((c) => c.type === 'voice');
  const manage = can(sd, P.MANAGE_SERVER) || can(sd, P.MANAGE_ROLES) || can(sd, P.KICK_MEMBERS) || can(sd, P.BAN_MEMBERS);
  main.innerHTML = `<header class="main-head orb-head">${mobileBtn()}<div class="t">${esc(sv.name)}</div><div class="tools">${can(sd, P.CREATE_INVITE) ? `<button class="btn sm" data-act="invite">${icon('userPlus', 'xs')} Invite</button>` : ''}${manage ? `<button class="btn sm" data-ov="settings">${icon('settings', 'xs')} Settings</button>` : ''}<button class="icon-btn" data-ov="menu">${icon('more', 'sm')}</button></div></header>
    <div class="page orbit-page">
      <section class="orb-hero" style="--c:${colorFor(sid)};${sv.banner ? `--img:url('${esc(sv.banner)}')` : ''}">
        <div class="oh-in">${orbFlag(sv, 72)}<div class="oh-txt"><span class="kicker">Orbit · since ${new Date(sv.createdAt || Date.now()).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span><h1>${esc(sv.name)}</h1>
          <p>${esc(sv.description || 'Pick a room on the left to join the conversation.')}</p></div></div>
        <div class="oh-stats"><div><b>${sd.members.length}</b>members</div><div><b class="on">${online.length}</b>online</div><div><b>${texts.length}</b>rooms</div><div><b>${voices.length}</b>lounges</div></div>
      </section>
      <div class="orb-cols"><div class="orb-main-col">
        <div class="sec-k">Board · updates from members</div>
        ${can(sd, P.SEND_MESSAGES) ? `<form class="inline-post" id="orb-post">${avatar(S.me, 36)}<div class="ip-body"><textarea name="t" rows="1" maxlength="1000" placeholder="Post an update to ${esc(sv.name)}…"></textarea><div class="ip-img"></div>
          <div class="ip-foot"><button type="button" class="icon-btn" data-ip-img data-tip="Add a photo">${icon('image', 'sm')}</button><span style="flex:1"></span><button class="btn primary sm" type="submit" disabled>Post</button></div></div></form>` : ''}
        <div class="feed-list" id="comm-posts"></div>
      </div><aside class="orb-side" id="comm-pulse"><div class="sec-k">Pulse</div><p class="idx-empty">Loading…</p></aside></div></div>`;
  main.querySelector('[data-ov=settings]')?.addEventListener('click', () => openServerSettings(sid));
  main.querySelector('[data-ov=menu]').addEventListener('click', (e) => serverMenu(sid, e.currentTarget));
  const f = main.querySelector('#orb-post'); if (f) wireInlinePost(f, sid);
  renderCommPosts(sid); loadCommPosts(sid); loadPulse(sid);
}
async function loadCommPosts(sid, more = false) {
  const st = S.commPosts[sid] ||= { posts: [], loaded: false, hasMore: false };
  if (st.loading) return; st.loading = true;
  try {
    const before = more && st.posts.length ? st.posts[st.posts.length - 1].createdAt : '';
    const r = await api('GET', `/api/feed?scope=server:${sid}${before ? '&before=' + before : ''}`);
    st.posts = more ? [...st.posts, ...r.posts] : r.posts; st.hasMore = r.posts.length === 20; st.loaded = true;
  } catch (e) { toast(e.message, true); }
  st.loading = false; renderCommPosts(sid);
}
function renderCommPosts(sid) {
  const el = $('#comm-posts'); if (!el || S.view.serverId !== sid) return;
  const st = S.commPosts[sid];
  if (!st?.loaded) { el.innerHTML = `<div class="post skel"><div class="sk-h"><i class="sk-av"></i><div><i class="sk-l w40"></i><i class="sk-l w25"></i></div></div><i class="sk-l"></i></div>`; return; }
  el.innerHTML = st.posts.length ? st.posts.map(postCard).join('') + (st.hasMore ? `<button class="btn ghost load-feed" data-pact="comm-more" data-sid="${sid}">Show more</button>` : '')
    : `<div class="empty-card">${icon('feed')}<h3>No updates yet</h3><p>Post announcements, plans, or highlights here. Everyone in the orbit will see them on their Home feed.</p></div>`;
}
async function loadPulse(sid) {
  let d; try { d = await api('GET', `/api/servers/${sid}/pulse`); } catch { return; }
  const el = $('#comm-pulse'); if (!el || S.view.serverId !== sid) return;
  const sd = S.serverData[sid]; const online = sd.members.filter((m) => isOnline(m.user.id));
  const max = Math.max(1, ...d.days);
  const days = d.days.map((n, i) => { const dt = new Date(Date.now() - (6 - i) * 86400000); return `<div class="bar" data-tip="${n} messages · ${dt.toLocaleDateString([], { weekday: 'short' })}"><i style="height:${Math.max(4, Math.round((n / max) * 100))}%"></i><span>${dt.toLocaleDateString([], { weekday: 'narrow' })}</span></div>`; }).join('');
  const lounges = sd.channels.filter((c) => c.type === 'voice' && (S.voice[c.id] || []).length);
  el.innerHTML = `<section class="side-card"><h4>Pulse <span class="muted small">last 7 days</span></h4>
      <div class="kpis"><div><b>${d.msgsToday}</b><span>messages today</span></div><div><b>${d.msgsWeek}</b><span>this week</span></div><div><b>${d.newMembers}</b><span>new members</span></div></div>
      <div class="bars">${days}</div></section>
    ${lounges.length ? `<section class="side-card live"><h4>${icon('waves', 'xs')} Lounges live</h4>${lounges.map((c) => `<div class="mini" data-chan-go="${c.id}"><span class="cicon sq">${icon('waves', 'xs')}</span><div class="mm"><b>${esc(c.name)}</b><span class="live-txt">${plural(S.voice[c.id].length, 'person')} hanging out</span></div></div>`).join('')}</section>` : ''}
    <section class="side-card"><h4>Busiest rooms</h4>${d.rooms.length ? d.rooms.map((r) => `<div class="mini" data-chan-go="${r.id}"><span class="cicon sq">${icon('room', 'xs')}</span><div class="mm"><b>${esc(r.name)}</b><span>${r.count ? `${plural(r.count, 'message')}${r.last ? ' · ' + ago(r.last) : ''}` : 'Quiet this week'}</span></div></div>`).join('') : '<p class="muted small pad">No rooms yet.</p>'}</section>
    <section class="side-card"><h4>Most active</h4>${d.active.length ? d.active.map((a, i) => `<div class="mini" data-user="${a.user.id}"><span class="rank">${i + 1}</span>${avatar(a.user, 30)}<div class="mm"><b>${esc(memberInfo(sd, a.user.id).name)}</b><span>${plural(a.count, 'message')}</span></div></div>`).join('') : '<p class="muted small pad">No messages this week yet.</p>'}</section>
    <section class="side-card"><h4>Online now · ${online.length}</h4><div class="av-wall">${online.slice(0, 24).map((m) => `<span data-user="${m.user.id}" data-tip="${esc(memberInfo(sd, m.user.id).name)}">${avatar(S.userCache[m.user.id] || m.user, 32, { dot: true })}</span>`).join('') || '<p class="muted small">No one is online.</p>'}</div></section>`;
  el.querySelectorAll('[data-chan-go]').forEach((x) => (x.onclick = () => { const c = sd.channels.find((c) => c.id === x.dataset.chanGo); navigate(`/channels/${sid}/${c.id}`); if (c.type === 'voice' && Call.active?.channelId !== c.id) joinCall(c.id); }));
}

// ------------------------------------------------------------------ messages index
function renderMessagesHome(main) {
  const friends = S.friends.filter((f) => f.type === 'friend').map((f) => S.userCache[f.user.id] || f.user).sort((a, b) => isOnline(b.id) - isOnline(a.id));
  main.innerHTML = `<div class="page chats-home"><header class="page-hero"><span class="kicker">Chats</span><h1>Say something.</h1><p>Pick a conversation, message a friend directly, or start a group chat.</p>
    <div class="hero-acts"><button class="btn primary" data-act-m="new">${icon('users', 'sm')} New group chat</button></div></header>
    ${friends.length ? `<div class="sec-k">Message a friend</div><div class="quick-people">${friends.slice(0, 12).map((u) => `<button class="qp" data-qp="${u.id}">${avatar(u, 48, { dot: true })}<b>${esc(u.displayName.split(' ')[0])}</b><span>${esc(u.customStatus || (isOnline(u.id) ? 'Online' : '@' + u.username))}</span></button>`).join('')}</div>` : `<div class="empty-block"><h3>No friends yet</h3><p>Add people by username from the People tab, then come back to chat.</p></div>`}</div>`;
  main.querySelector('[data-act-m]').onclick = () => openNewGroup();
  main.querySelectorAll('[data-qp]').forEach((b) => (b.onclick = () => openDM(b.dataset.qp)));
}
// ------------------------------------------------------------------ realtime hooks
function socialSocket(sock) {
  sock.on('post:new', async ({ id, serverId }) => {
    const onFeed = S.view.type === 'feed' && S.feed.loaded, onComm = S.view.overview && S.view.serverId === serverId;
    if (!onFeed && !onComm && !(S.feed.loaded)) return;
    try { const { post } = await api('GET', '/api/posts/' + id); insertNewPost(post); } catch {}
  });
  sock.on('post:update', ({ id }) => { if (findPost(id)) refreshPost(id); });
  sock.on('post:delete', ({ id }) => removePost(id));
  sock.on('activity:new', ({ kind, from }) => {
    S.activityUnread = (S.activityUnread || 0) + 1;
    if (S.view.type === 'activity') renderActivity($('#main')); else renderRail();
    if (from) toast(`${from.displayName} ${kind === 'glow' ? 'glowed your post' : 'replied to your post'}`);
  });
}
function refreshMomentsUI() { if (S.view.type !== 'feed' || svState) return; const st = $('.moments-card .stories'); if (st) st.outerHTML = storiesBar(); }
