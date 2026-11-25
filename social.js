/* social: home feed, posts, daily spark, activity, communities directory, community overview */
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
      m.close(); toast(sid ? 'Shared with the community' : 'Posted');
      if (spark && S.spark) S.spark.answered = true;
      insertNewPost(post);
    } catch (e) { toast(e.message, true); busy = false; sync(); }
  };
}
function insertNewPost(post) {
  const sc = S.feed.scope;
  if (S.feed.loaded && !S.feed.posts.some((p) => p.id === post.id) && (sc === 'all' || (sc === 'friends' && !post.server) || (sc === 'communities' && post.server))) S.feed.posts.unshift(post);
  if (post.server && S.commPosts[post.server.id] && !S.commPosts[post.server.id].posts.some((p) => p.id === post.id)) S.commPosts[post.server.id].posts.unshift(post);
  if (S.view.type === 'feed') renderFeedList();
  if (S.view.overview && post.server?.id === S.view.serverId) renderCommPosts(post.server.id);
  if (S.view.type === 'feed') renderSpark();
}

// ------------------------------------------------------------------ home feed
function renderFeed(main) {
  const sc = S.feed.scope;
  const tab = (k, l) => `<button class="seg-b ${sc === k ? 'active' : ''}" data-pact="scope" data-scope="${k}">${l}</button>`;
  main.innerHTML = `${pageHead('Home', `<span class="muted small head-date">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>`)}
    <div class="page feed-page"><div class="feed-col">
      <section class="moments-card"><div class="card-h"><h3>Moments</h3><span class="muted small">Disappear after 24 hours</span></div>${storiesBar()}</section>
      <section class="spark" id="spark"></section>
      <button class="compose-card" data-pact="compose">${avatar(S.me, 40)}<span>Share an update with your friends…</span><span class="cc-ic">${icon('image', 'sm')}</span></button>
      <div class="seg" role="tablist">${tab('all', 'For you')}${tab('friends', 'Friends')}${tab('communities', 'Communities')}</div>
      <div class="feed-list" id="feed-list"></div>
    </div>
    <aside class="feed-side" id="feed-side"></aside></div>`;
  renderSpark(); renderFeedSide(); renderFeedList();
  if (!S.feed.loaded) loadFeed();
  if (!S.spark) api('GET', '/api/spark').then((r) => { S.spark = r; renderSpark(); }).catch(() => {});
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
    el.innerHTML = `<div class="empty-card">${icon(sc === 'communities' ? 'grid' : 'feed')}<h3>${sc === 'communities' ? 'No community updates yet' : 'Your feed is quiet'}</h3>
      <p>${sc === 'communities' ? 'Updates posted in your communities appear here.' : 'Posts from you and your friends appear here. Start things off with a post or answer today’s Spark.'}</p>
      <button class="btn primary" data-pact="compose">Write a post</button></div>`;
    return;
  }
  el.innerHTML = S.feed.posts.map(postCard).join('') + (S.feed.hasMore ? `<button class="btn ghost load-feed" data-pact="feed-more">${S.feed.loading ? 'Loading…' : 'Show more'}</button>` : '<div class="feed-end">You’re all caught up</div>');
}
function renderSpark() {
  const el = $('#spark'); if (!el) return;
  const d = S.spark; if (!d) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const hrs = Math.max(1, Math.round((d.spark.endsAt - Date.now()) / 3600000));
  const fr = d.friends || [];
  el.innerHTML = `<div class="spark-top"><span class="spark-badge">${icon('sparkle', 'xs')} Daily Spark</span><span class="muted small">New question in ${hrs}h</span></div>
    <p class="spark-q">${esc(d.spark.text)}</p>
    <div class="spark-foot"><div class="spark-who">${fr.length ? `<span class="stack">${fr.slice(0, 4).map((u) => avatar(u, 22)).join('')}</span><span>${fr.length === 1 ? `${esc(fr[0].displayName)} answered` : `${esc(fr[0].displayName)} and ${plural(fr.length - 1, 'friend')} answered`}</span>` : '<span>Be the first of your friends to answer.</span>'}</div>
    ${d.answered ? `<span class="spark-done">${icon('check', 'xs')} Answered</span>` : `<button class="btn primary sm" data-pact="spark">Answer</button>`}</div>`;
}
function renderFeedSide() {
  const el = $('#feed-side'); if (!el) return;
  const convos = S.dms.filter((d) => d.lastMessage).slice(0, 5);
  const friends = S.friends.filter((f) => f.type === 'friend').map((f) => S.userCache[f.user.id] || f.user).sort((a, b) => isOnline(b.id) - isOnline(a.id) || !!b.customStatus - !!a.customStatus);
  const online = friends.filter((u) => isOnline(u.id));
  const calls = S.dms.filter((d) => (S.voice[d.id] || []).length && Call.active?.channelId !== d.id);
  let html = '';
  if (calls.length) html += `<section class="side-card live"><h4>${icon('waves', 'xs')} Live now</h4>${calls.map((d) => `<div class="mini" data-dm="${d.id}">${dmAvatar(d, 32)}<div class="mm"><b>${esc(dmName(d))}</b><span class="live-txt">In a call · join</span></div></div>`).join('')}</section>`;
  html += `<section class="side-card"><h4>Recent conversations<a data-nav-link="/messages">See all</a></h4>${convos.length ? convos.map((d) => `<div class="mini ${d.unread ? 'unread' : ''}" data-dm="${d.id}">${dmAvatar(d, 36)}<div class="mm"><b>${esc(dmName(d))}</b><span>${d.lastMessage.authorId === S.me.id ? 'You: ' : ''}${esc(d.lastMessage.content || 'Attachment')}</span></div><div class="mx">${streakChip(d)}${d.unread ? `<span class="ucount">${d.unread}</span>` : `<span class="time">${ago(d.lastMessage.createdAt)}</span>`}</div></div>`).join('') : '<p class="muted small pad">No conversations yet.</p>'}</section>`;
  html += `<section class="side-card"><h4>Friends · ${online.length} online<a data-nav-link="/friends">Manage</a></h4>${friends.length ? `<div class="notes">${friends.slice(0, 8).map((u) => `<div class="note" data-user="${u.id}">${u.customStatus ? `<span class="bubble-note">${esc(u.customStatus)}</span>` : ''}${avatar(u, 44, { dot: true })}<span class="nn">${esc(u.displayName.split(' ')[0])}</span></div>`).join('')}</div>` : `<p class="muted small pad">Add friends to see what they’re up to.</p><button class="btn sm" data-nav-link="/friends" style="margin:0 14px 14px">Find friends</button>`}</section>`;
  html += `<section class="side-card"><h4>Your communities<a data-nav-link="/communities">Browse</a></h4>${S.servers.length ? S.servers.slice(0, 6).map((s) => `<div class="mini" data-pact="open-comm" data-sid="${s.id}">${commIcon(s, 32)}<div class="mm"><b>${esc(s.name)}</b><span>${plural(s.memberCount || 1, 'member')}</span></div>${s.unread ? `<span class="ucount">${s.unread > 99 ? '99+' : s.unread}</span>` : ''}</div>`).join('') : '<p class="muted small pad">You haven’t joined any communities yet.</p>'}</section>`;
  html += `<footer class="side-legal"><a href="/privacy" target="_blank">Privacy</a> · <a href="/terms" target="_blank">Terms</a> · lumi © ${new Date().getFullYear()}</footer>`;
  el.innerHTML = html;
}
document.addEventListener('click', (e) => { const t = e.target.closest('[data-nav-link]'); if (t) { e.preventDefault(); navigate(t.dataset.navLink); } });

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
  if (!items.length) html += `<div class="empty-card">${icon('bell')}<h3>Nothing new yet</h3><p>When people glow or reply to your posts, or join your communities, you’ll see it here.</p></div>`;
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

// ------------------------------------------------------------------ communities directory
function renderCommunities(main) {
  main.innerHTML = `${pageHead('Communities', `<button class="btn sm" data-act-c="join">${icon('link', 'xs')} Join with invite</button><button class="btn sm primary" data-act-c="create">${icon('plus', 'xs')} Create</button>`)}
    <div class="page"><p class="page-intro">Your communities are places for your groups, with rooms to chat, lounges to hang out in, and an updates board for news.</p>
    <div class="comm-grid">${S.servers.map((s) => `<article class="comm-card" data-pact="open-comm" data-sid="${s.id}">
      <div class="cc-cover" style="--c:${colorFor(s.id)};${s.banner ? `background-image:url('${esc(s.banner)}')` : ''}"></div>
      <div class="cc-body">${commIcon(s, 52)}<h3>${esc(s.name)}</h3><p>${esc(s.description || 'A community on lumi.')}</p>
      <div class="cc-meta"><span>${icon('users', 'xs')} ${plural(s.memberCount || 1, 'member')}</span>${s.ownerId === S.me.id ? '<span class="own">Owner</span>' : ''}${s.unread ? `<span class="new">${s.unread > 99 ? '99+' : s.unread} new</span>` : ''}</div></div></article>`).join('')}
      <article class="comm-card add" data-act-c="create"><div class="cc-add">${icon('plus')}</div><h3>Start a community</h3><p>Bring your friends, team, or club together.</p></article>
    </div></div>`;
  main.querySelectorAll('[data-act-c]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openCreateServer(b.dataset.actC === 'join' ? 'join' : 'create'); }));
}

// ------------------------------------------------------------------ community overview
function renderCommunityOverview(main) {
  const sd = S.serverData[S.view.serverId]; if (!sd) return;
  const sv = sd.server, sid = sv.id;
  const online = sd.members.filter((m) => isOnline(m.user.id));
  const texts = sd.channels.filter((c) => c.type === 'text'), voices = sd.channels.filter((c) => c.type === 'voice');
  const manage = can(sd, P.MANAGE_SERVER) || can(sd, P.MANAGE_ROLES) || can(sd, P.KICK_MEMBERS) || can(sd, P.BAN_MEMBERS);
  main.innerHTML = `${pageHead(`${esc(sv.name)}`, `${can(sd, P.CREATE_INVITE) ? `<button class="btn sm" data-act="invite">${icon('userPlus', 'xs')} Invite</button>` : ''}`)}
    <div class="page comm-page">
      <section class="comm-hero">
        <div class="ch-cover" style="--c:${colorFor(sid)};${sv.banner ? `background-image:url('${esc(sv.banner)}')` : ''}"></div>
        <div class="ch-row">${commIcon(sv, 84)}
          <div class="ch-meta"><h1>${esc(sv.name)}</h1><p>${esc(sv.description || 'Welcome! This is the home of the community. Check the rooms on the left to join the conversation.')}</p>
            <div class="ch-stats"><span><b>${sd.members.length}</b> ${sd.members.length === 1 ? 'member' : 'members'}</span><span class="on"><i></i><b>${online.length}</b> online</span><span><b>${texts.length}</b> ${texts.length === 1 ? 'room' : 'rooms'}</span><span><b>${voices.length}</b> ${voices.length === 1 ? 'lounge' : 'lounges'}</span><span>Since ${new Date(sv.createdAt || Date.now()).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span></div></div>
          <div class="ch-acts">${manage ? `<button class="btn sm" data-ov="settings">${icon('settings', 'xs')} Settings</button>` : ''}<button class="icon-btn" data-ov="menu">${icon('more', 'sm')}</button></div></div>
      </section>
      <div class="comm-cols">
        <div class="comm-main">
          <div class="sec-h"><h2>Updates</h2><span class="muted small">News and posts from members</span></div>
          ${can(sd, P.SEND_MESSAGES) ? `<button class="compose-card" data-pact="compose" data-sid="${sid}">${avatar(S.me, 36)}<span>Share an update with ${esc(sv.name)}…</span><span class="cc-ic">${icon('image', 'sm')}</span></button>` : ''}
          <div class="feed-list" id="comm-posts"></div>
        </div>
        <aside class="comm-side" id="comm-pulse"><section class="side-card"><h4>Pulse</h4><p class="muted small pad">Loading…</p></section></aside>
      </div></div>`;
  main.querySelector('[data-ov=settings]')?.addEventListener('click', () => openServerSettings(sid));
  main.querySelector('[data-ov=menu]').addEventListener('click', (e) => serverMenu(sid, e.currentTarget));
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
    : `<div class="empty-card">${icon('feed')}<h3>No updates yet</h3><p>Post announcements, plans, or highlights here. Everyone in the community will see them on their Home feed.</p></div>`;
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
  main.innerHTML = `${pageHead('Messages')}<div class="empty-pane"><div class="empty-card">${icon('chat')}<h3>Your conversations</h3>
    <p>Pick a conversation on the left, or start a new one with a friend or a group.</p><button class="btn primary" data-act-m="new">${icon('edit', 'xs')} New message</button></div></div>`;
  main.querySelector('[data-act-m]').onclick = () => openNewGroup();
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
