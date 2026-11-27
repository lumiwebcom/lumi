// lumi: Feed, Daily Spark, Activity and streaks, styled to sit inside the classic layout.
S.feed = { scope: 'all', posts: [], loaded: false, loading: false, hasMore: false };
S.spark = null; S.openComments = new Set(); S.commentCache = {}; S.activityUnread = 0;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const streakChip = (d) => (d && d.streak >= 2 ? `<span class="streak" data-tip="${d.streak}-day streak">${icon('flame', 'xs')}${d.streak}</span>` : '');

// ---------- side nav entries (rendered under Friends in the home column)
function socialNavItems(v) {
  return `<div class="nav-item ${v.type === 'feed' ? 'active' : ''}" data-snav="/feed">
      <div style="width:48px;display:grid;place-items:center">${icon('feed')}</div><div class="meta"><div class="n bold">Feed</div></div></div>
    <div class="nav-item ${v.type === 'activity' ? 'active' : ''}" data-snav="/activity">
      <div style="width:48px;display:grid;place-items:center">${icon('bell')}</div><div class="meta"><div class="n bold">Activity</div></div>
      ${S.activityUnread ? `<span class="count">${S.activityUnread}</span>` : ''}</div>
    <div class="nav-item ${v.type === 'sparks' ? 'active' : ''}" data-snav="/sparks">
      <div style="width:48px;display:grid;place-items:center" class="sp-nav">${icon('gem')}</div><div class="meta"><div class="n bold">Sparks</div></div>${S.me?.sparks ? '' : '<span class="sp-new">$5.99</span>'}</div>
    ${window.lumiDesktop ? '' : `<a class="nav-item dl-nav" href="${PC_DOWNLOAD}" target="_blank" rel="noopener">
      <div style="width:48px;display:grid;place-items:center">${icon('download')}</div><div class="meta"><div class="n bold">Download app</div></div><span class="dl-os">Windows</span></a>`}`;
}

// ---------- post card
function postCard(p) {
  const a = S.userCache[p.author.id] || p.author; cacheUser(p.author);
  const open = S.openComments.has(p.id);
  const cmts = open && S.commentCache[p.id] ? S.commentCache[p.id] : p.comments;
  const likers = p.likers.filter((u) => u.id !== S.me.id);
  const likeLine = p.likes ? (p.liked ? (p.likes === 1 ? 'You glowed this' : `You and ${plural(p.likes - 1, 'other')} glowed this`)
    : likers.length ? `${esc(likers[0].displayName)}${p.likes > 1 ? ` and ${plural(p.likes - 1, 'other')}` : ''} glowed this` : '') : '';
  return `<article class="post" data-pid="${p.id}">
    <header class="post-head">
      <span data-user="${a.id}" style="cursor:pointer">${avatar(a, 40)}</span>
      <div class="meta"><div class="n"><b data-user="${a.id}">${esc(a.displayName)}</b>${roleBadge(a)}
        ${p.server ? `<span class="muted">in</span> <a class="srv-chip" data-pact="open-srv" data-sid="${p.server.id}">${esc(p.server.name)}</a>` : ''}</div>
        <div class="sub">@${esc(a.username)} · <span title="${esc(new Date(p.createdAt).toLocaleString())}">${ago(p.createdAt)}</span></div></div>
      ${p.canDelete ? `<button class="icon-btn" data-pact="del" data-tip="Delete post">${icon('trash', 'sm')}</button>` : ''}
    </header>
    ${p.spark ? `<div class="spark-tag">${icon('sparkle', 'xs')}<span>Daily Spark</span> ${esc(p.spark.text)}</div>` : ''}
    ${p.content ? `<div class="post-body">${md(p.content)}</div>` : ''}
    ${p.image ? `<div class="post-media"><img src="${esc(p.image)}" alt="" loading="lazy" data-zoom></div>` : ''}
    ${likeLine ? `<div class="post-likes">${likeLine}</div>` : ''}
    <footer class="post-acts">
      <button class="pa ${p.liked ? 'on' : ''}" data-pact="glow">${icon('glow', 'sm')}<span>${p.likes || 'Glow'}</span></button>
      <button class="pa" data-pact="comments">${icon('reply', 'sm')}<span>${p.commentCount ? (p.commentCount === 1 ? '1 reply' : `${p.commentCount} replies`) : 'Reply'}</span></button>
      ${p.author.id !== S.me.id ? `<button class="pa" data-pact="dm">${icon('send', 'sm')}<span>Message</span></button>` : ''}
    </footer>
    ${(cmts.length || open) ? `<div class="post-cmts">
      ${!open && p.commentCount > cmts.length ? `<button class="more-cmts" data-pact="comments">View all ${p.commentCount} replies</button>` : ''}
      ${cmts.map((c) => `<div class="cmt">${avatar(c.author, 28)}<div class="cb"><div class="ch"><b data-user="${c.author.id}">${esc(c.author.displayName)}</b><span>${ago(c.createdAt)}</span>${c.canDelete ? `<button class="cdel" data-pact="del-cmt" data-cid="${c.id}">Delete</button>` : ''}</div><div class="ct">${md(c.content)}</div></div></div>`).join('')}
      ${open ? `<form class="cmt-form">${avatar(S.me, 28)}<input name="c" placeholder="Write a reply…" maxlength="500" autocomplete="off"><button class="btn primary sm">Reply</button></form>` : ''}
    </div>` : ''}
  </article>`;
}
const findPost = (pid) => S.feed.posts.find((p) => p.id === pid);
function replacePost(post) {
  const i = S.feed.posts.findIndex((p) => p.id === post.id); if (i >= 0) S.feed.posts[i] = post;
  document.querySelectorAll(`.post[data-pid="${post.id}"]`).forEach((el) => {
    const f = el.querySelector('.cmt-form input'); const val = f?.value; const focused = document.activeElement === f;
    el.outerHTML = postCard(post);
    if (val || focused) { const n = $(`.post[data-pid="${post.id}"] .cmt-form input`); if (n) { n.value = val || ''; if (focused) n.focus(); } }
  });
}

// ---------- feed page
function renderFeed(main) {
  const tabs = [['all', 'For you'], ['friends', 'Friends'], ['orbits', 'Servers']];
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">${icon('feed')} Feed</div>
      <div class="tabs" style="padding:0 0 0 8px">${tabs.map(([k, l]) => `<button class="tab ${S.feed.scope === k ? 'active' : ''}" data-pact="scope" data-scope="${k}">${l}</button>`).join('')}</div>
    </header>
    <div class="content"><div class="home feed-page"><div class="feed-col">
      <form class="feed-composer" id="feed-composer">${avatar(S.me, 40)}<div class="fc-main">
        <textarea name="t" rows="1" maxlength="2000" placeholder="What’s happening, ${esc(S.me.displayName.split(' ')[0])}?"></textarea>
        <div class="fc-prev" hidden></div>
        <div class="fc-foot"><select name="sid"><option value="">Friends</option>${S.servers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
          <button type="button" class="icon-btn" data-pact="img" data-tip="Add photo">${icon('image', 'sm')}</button><span style="flex:1"></span>
          <button class="btn primary sm" type="submit">Post</button></div></div></form>
      <section class="spark" id="spark" hidden></section>
      <div id="feed-list"></div>
    </div></div><aside class="active-now" id="active-now"></aside></div>`;
  wireComposer($('#feed-composer'));
  renderActiveNow(); renderSpark(); loadSpark();
  if (!S.feed.loaded) loadFeed(); else renderFeedList();
}
function renderFeedSide() { if (S.view.type === 'feed') renderActiveNow(); }
function wireComposer(form) {
  if (!form) return; let img = null;
  const ta = form.t, prev = form.querySelector('.fc-prev');
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'; };
  form.querySelector('[data-pact=img]').onclick = async (e) => {
    e.stopPropagation(); const f = await pickFile('image/*'); if (!f) return;
    prev.hidden = false; prev.innerHTML = '<span class="muted small">Uploading…</span>';
    try { img = (await uploadFile(f)).url; prev.innerHTML = `<img src="${esc(img)}" alt=""><button type="button" class="icon-btn">${icon('x', 'sm')}</button>`; prev.querySelector('button').onclick = () => { img = null; prev.hidden = true; prev.innerHTML = ''; }; }
    catch (err) { toast(err.message, true); prev.hidden = true; }
  };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); };
  form.onsubmit = async (e) => {
    e.preventDefault(); const content = ta.value.trim(); if (!content && !img) return;
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    try { const { post } = await api('POST', '/api/posts', { content, image: img, serverId: form.sid.value || null }); ta.value = ''; ta.oninput(); img = null; prev.hidden = true; prev.innerHTML = ''; insertNewPost(post); }
    catch (err) { toast(err.message, true); }
    b.disabled = false;
  };
}
function insertNewPost(post) { if (S.feed.posts.some((p) => p.id === post.id)) return; S.feed.posts.unshift(post); renderFeedList(); }
async function loadFeed(more = false) {
  if (S.feed.loading) return; S.feed.loading = true; const sc = S.feed.scope;
  if (!more) renderFeedList();
  try {
    const last = S.feed.posts[S.feed.posts.length - 1];
    const r = await api('GET', `/api/feed?scope=${sc}${more && last ? '&before=' + last.createdAt : ''}`);
    if (S.feed.scope === sc) { S.feed.posts = more ? [...S.feed.posts, ...r.posts] : r.posts; S.feed.hasMore = r.posts.length === 20; S.feed.loaded = true; }
  } catch (e) { toast(e.message, true); }
  S.feed.loading = false; renderFeedList();
}
function renderFeedList() {
  const el = $('#feed-list'); if (!el) return;
  if (!S.feed.loaded) { el.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">Loading…</div>'; return; }
  if (!S.feed.posts.length) {
    el.innerHTML = `<div class="empty"><div class="art">${icon('feed')}</div><h3>Nothing here yet</h3><p>${S.feed.scope === 'orbits' ? 'Posts shared to your servers show up here.' : 'Posts from you and your friends show up here.'}</p></div>`;
    return;
  }
  el.innerHTML = S.feed.posts.map(postCard).join('') + (S.feed.hasMore ? `<button class="btn load-feed" data-pact="feed-more">${S.feed.loading ? 'Loading…' : 'Show more'}</button>` : '<div class="feed-end">You’re all caught up</div>');
}

// ---------- daily spark
async function loadSpark() { try { S.spark = await api('GET', '/api/spark'); renderSpark(); } catch {} }
function renderSpark() {
  const el = $('#spark'); if (!el) return;
  const d = S.spark; if (!d) { el.hidden = true; return; }
  el.hidden = false; const fr = d.friends || [];
  el.innerHTML = `<div class="spark-top">${icon('sparkle', 'xs')} Daily Spark</div>
    <div class="spark-q">${esc(d.spark.text)}</div>
    ${d.answered ? `<div class="spark-done">${icon('check', 'xs')} You answered today.${fr.length ? ` ${esc(fr[0].displayName)}${fr.length > 1 ? ` and ${plural(fr.length - 1, 'other')}` : ''} answered too.` : ''}</div>`
      : `<form class="spark-form" id="spark-form"><input name="a" maxlength="500" placeholder="Your answer…" autocomplete="off"><button class="btn primary sm">Answer</button></form>`}`;
  el.querySelector('#spark-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = e.target.a.value.trim(); if (!v) return; e.target.querySelector('button').disabled = true;
    try { const { post } = await api('POST', '/api/posts', { content: v, spark: true }); S.spark.answered = true; insertNewPost(post); renderSpark(); }
    catch (err) { toast(err.message, true); e.target.querySelector('button').disabled = false; }
  });
}

// ---------- activity page
async function renderActivity(main) {
  S.activityUnread = 0; if (S.view.type !== 'server') renderSideBody();
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">${icon('bell')} Activity</div></header>
    <div class="content"><div class="home feed-page"><div class="feed-col" id="act-list"><div class="muted small" style="padding:20px;text-align:center">Loading…</div></div></div></div>`;
  let items = [];
  try { items = (await api('GET', '/api/activity')).items; } catch (e) { toast(e.message, true); }
  if (S.view.type !== 'activity') return;
  const verb = { glow: 'glowed your post', reply: 'replied to your post', join: 'joined' };
  const el = $('#act-list'); if (!el) return;
  if (!items.length) { el.innerHTML = `<div class="empty"><div class="art">${icon('bell')}</div><h3>Nothing new yet</h3><p>When people glow or reply to your posts, or join your servers, it shows up here.</p></div>`; return; }
  let html = '', last = '';
  for (const it of items) {
    const day = fmtDay(it.createdAt); if (day !== last) { html += `<div class="act-day">${day}</div>`; last = day; }
    html += `<div class="nav-item act-row" data-pact="act-go" ${it.postId ? `data-post="${it.postId}"` : ''} ${it.serverId ? `data-sid="${it.serverId}"` : ''}>
      ${avatar(it.from, 40)}<div class="meta"><div class="n"><b>${esc(it.from.displayName)}</b> ${verb[it.kind]}${it.kind === 'join' ? ` <b>${esc(it.snippet)}</b>` : ''}</div>
      ${it.kind !== 'join' && it.snippet ? `<div class="sub">“${esc(it.snippet)}”</div>` : ''}</div><span class="muted small">${ago(it.createdAt)}</span></div>`;
  }
  el.innerHTML = html;
}

// ---------- interactions
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-snav]'); if (nav) return navigate(nav.dataset.snav);
  const t = e.target.closest('[data-pact]'); if (!t) return;
  const act = t.dataset.pact, card = t.closest('.post'), p = card ? findPost(card.dataset.pid) : null;
  try {
    if (act === 'scope') { S.feed.scope = t.dataset.scope; S.feed.loaded = false; S.feed.posts = []; document.querySelectorAll('[data-pact=scope]').forEach((b) => b.classList.toggle('active', b === t)); return loadFeed(); }
    if (act === 'feed-more') return loadFeed(true);
    if (act === 'open-srv') return navigate('/channels/' + t.dataset.sid);
    if (act === 'act-go') { if (t.dataset.sid && !t.dataset.post) return navigate('/channels/' + t.dataset.sid); if (t.dataset.post) return openPostView(t.dataset.post); return; }
    if (!p) return;
    if (act === 'glow') { const r = await api('POST', `/api/posts/${p.id}/like`); replacePost(r.post); card.querySelector('[data-pact=glow]')?.classList.add('pop'); }
    else if (act === 'comments') {
      if (S.openComments.has(p.id) && !t.classList.contains('more-cmts')) { S.openComments.delete(p.id); return replacePost(p); }
      S.openComments.add(p.id); const r = await api('GET', `/api/posts/${p.id}/comments`); S.commentCache[p.id] = r.comments; replacePost(p);
      $(`.post[data-pid="${p.id}"] .cmt-form input`)?.focus();
    } else if (act === 'dm') { const d = await api('POST', '/api/dms', { userId: p.author.id }); if (!S.dms.find((x) => x.id === d.dm.id)) S.dms.unshift(d.dm); navigate('/channels/@me/' + d.dm.id); }
    else if (act === 'del') { if (!confirm('Delete this post?')) return; await api('DELETE', `/api/posts/${p.id}`); S.feed.posts = S.feed.posts.filter((x) => x.id !== p.id); renderFeedList(); }
    else if (act === 'del-cmt') { await api('DELETE', `/api/comments/${t.dataset.cid}`); const r = await api('GET', `/api/posts/${p.id}`); if (S.commentCache[p.id]) S.commentCache[p.id] = S.commentCache[p.id].filter((c) => c.id !== t.dataset.cid); replacePost(r.post); }
  } catch (err) { toast(err.message, true); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('.cmt-form'); if (!f) return; e.preventDefault();
  const p = findPost(f.closest('.post').dataset.pid); const v = f.c.value.trim(); if (!p || !v) return;
  try { const r = await api('POST', `/api/posts/${p.id}/comments`, { content: v }); f.c.value = ''; S.openComments.add(p.id); S.commentCache[p.id] = (await api('GET', `/api/posts/${p.id}/comments`)).comments; replacePost(r.post); }
  catch (err) { toast(err.message, true); }
});
async function openPostView(pid) {
  try {
    const { post } = await api('GET', `/api/posts/${pid}`);
    if (!findPost(pid)) S.feed.posts.push(post);
    const m = openModal({ title: 'Post', body: `<div class="feed-col">${postCard(post)}</div>` }); m.el.classList.add('post-modal');
  } catch (e) { toast(e.message, true); }
}

// ---------- realtime
function socialSocket(socket) {
  socket.on('post:new', async ({ id }) => { if (!S.feed.loaded || findPost(id)) return; try { const { post } = await api('GET', '/api/posts/' + id); if (S.feed.scope === 'all' || (S.feed.scope === 'orbits') === !!post.server) insertNewPost(post); } catch {} });
  socket.on('post:update', async ({ id }) => { if (!findPost(id)) return; try { const { post } = await api('GET', '/api/posts/' + id); replacePost(post); } catch {} });
  socket.on('post:delete', ({ id }) => { S.feed.posts = S.feed.posts.filter((p) => p.id !== id); document.querySelectorAll(`.post[data-pid="${id}"]`).forEach((el) => el.remove()); });
  socket.on('activity:new', ({ kind, from } = {}) => { if (from) toast(`${from.displayName} ${kind === 'glow' ? 'glowed your post' : 'replied to your post'}`); if (S.view.type === 'activity') return renderActivity($('#main')); S.activityUnread++; if (S.view.type !== 'server') renderSideBody(); });
}
function refreshMomentsUI() { if (S.view.type === 'home' && typeof svState !== 'undefined' && !svState) renderHomeBody(); }

// ================= Stargaze: browse public spaces =================
S.star = { q: '', list: null, loading: false };
function renderStargazeSide() {
  const top = $('#side-top'), body = $('#side-body'); if (!top || !body) return;
  if (!$('#sg-q')) {
    top.innerHTML = `<div class="side-head"><div class="title">Stargaze</div></div>
      <div class="side-search"><input id="sg-q" placeholder="Search communities" autocomplete="off" value="${esc(S.star.q)}"></div>`;
    let t; $('#sg-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.star.q = e.target.value.trim(); loadStargaze(); }, 250); };
  }
  body.innerHTML = `<div class="nav-item sg-cat active" data-sg-all><div class="sg-ci">${icon('compass', 'sm')}</div><div class="meta"><div class="n">All communities</div></div></div>
    <div class="sg-side-foot"><button class="btn block" data-sg-invite>${icon('link', 'sm')} Join with an invite</button></div>`;
}
function renderStargaze(main) {
  if (!S.tasks || S.tasks.tasks.some((t) => t.id === 'stargaze' && !t.done)) api('POST', '/api/tasks/ping', { event: 'stargaze' }).catch(() => {});
  $('#side-top') && ($('#side-top').innerHTML = '');
  renderStargazeSide();
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">${icon('compass')} Stargaze</div></header>
    <div class="content"><div class="home sg-page">
      <div id="sg-list"></div>
    </div></div>`;
  loadStargaze();
}
async function loadStargaze() {
  S.star.loading = true; renderStargazeList();
  try {
    const r = await api('GET', `/api/discover?q=${encodeURIComponent(S.star.q)}`);
    S.star.list = r.servers;
  } catch (e) { toast(e.message, true); S.star.list = S.star.list || []; }
  S.star.loading = false; renderStargazeList();
}
const fmtCount = (n) => n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : n.toLocaleString();
function sgCard(s) {
  const c = colorFor(s.id);
  return `<article class="sg-card" data-sg-open="${s.id}" style="--c:${c}">
    <div class="sg-banner" style="${s.banner ? `background-image:url('${esc(s.banner)}')` : ''}">${s.featured ? `<span class="sg-feat">${icon('sparkle', 'xs')} lumi pick</span>` : ''}</div>
    <div class="sg-icon">${s.icon ? `<img src="${esc(s.icon)}" alt="">` : esc(initials(s.name).toUpperCase())}</div>
    <div class="sg-body"><h3>${esc(s.name)}</h3><p>${esc(s.description || 'No description yet.')}</p>
      <div class="sg-meta"><span class="on"><i></i>${fmtCount(s.onlineCount)} online</span><span><i></i>${fmtCount(s.memberCount)} ${s.memberCount === 1 ? 'member' : 'members'}</span>${s.category ? `<span class="sg-tag">${esc(s.category)}</span>` : ''}</div>
      <button class="btn ${s.joined ? '' : 'primary'} sm sg-join" data-sg-join="${s.id}">${s.joined ? 'Open' : 'Join'}</button></div>
  </article>`;
}
function renderStargazeList() {
  const el = $('#sg-list'); if (!el) return;
  const L = S.star.list;
  if (!L) { el.innerHTML = '<div class="muted small" style="padding:30px;text-align:center">Loading…</div>'; return; }
  const title = S.star.q ? `Results for “${esc(S.star.q)}”` : 'All communities';
  const head = `<div class="sg-top"><h2>${title}</h2><span>${L.length} ${L.length === 1 ? 'community' : 'communities'}</span></div>
    ${S.star.q ? '' : '<p class="sg-note">Communities show up here once they have 1,000 members and turn it on in Community settings › Access.</p>'}`;
  if (!L.length) {
    el.innerHTML = `${head}<div class="empty"><div class="art">${icon('compass')}</div><h3>No communities here yet</h3><p>${S.star.q ? 'Try a different search.' : 'Communities show up here once they reach 1,000 members and turn on Stargaze in their settings.'}</p></div>`;
    return;
  }
  const feat = !S.star.q ? L.filter((s) => s.featured) : [];
  const rest = feat.length ? L.filter((s) => !s.featured) : L;
  el.innerHTML = head + `<div class="sg-grid">${[...feat, ...rest].map(sgCard).join('')}</div>`;
}
// lumi owners and admins: right-click a community on Stargaze
function stargazeMenu(anchor, id) {
  const s = (S.star.list || []).find((x) => x.id === id); if (!s) return;
  const mine = s.owner?.id === S.me.id, protectedOwner = s.owner?.siteRole === 'owner' && S.me.siteRole !== 'owner';
  openMenu(anchor, [
    { label: s.joined ? 'Open' : 'Join', icon: s.joined ? 'home' : 'userPlus', onClick: () => joinFromStargaze(id) },
    !protectedOwner && 'sep',
    !protectedOwner && { label: 'Take off Stargaze', icon: 'eyeOff', danger: true, onClick: () => unlistFromStargaze(s) },
    !protectedOwner && !mine && { label: 'Ban community', icon: 'hammer', danger: true, onClick: () => banServer(s, () => { S.star.list = S.star.list.filter((x) => x.id !== id); renderStargazeList(); }) },
  ]);
}
function unlistFromStargaze(s, after) {
  const m = openModal({ title: `Take ${s.name} off Stargaze?`, body: `<p class="muted" style="margin:0 0 14px">It disappears from Stargaze and can’t be listed again until a lumi owner or admin allows it. The community itself keeps working. The owner gets a DM from lumi with your reason.</p>
    <div class="field"><label>Reason (optional)</label><input class="input" id="ul-reason" maxlength="200" placeholder="e.g. misleading description, spam"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" data-cancel>Cancel</button><button class="btn danger" data-go>${icon('eyeOff', 'sm')} Take off Stargaze</button></div>` });
  m.el.querySelector('[data-cancel]').onclick = () => m.close();
  m.el.querySelector('[data-go]').onclick = async () => {
    try {
      await api('POST', `/api/admin/servers/${s.id}/unlist`, { reason: m.el.querySelector('#ul-reason').value });
      m.close(); toast(`${s.name} was taken off Stargaze`);
      if (S.star?.list) { S.star.list = S.star.list.filter((x) => x.id !== s.id); renderStargazeList(); }
      after?.();
    } catch (e) { toast(e.message, true); }
  };
}
async function joinFromStargaze(id) {
  const s = (S.star.list || []).find((x) => x.id === id);
  if (s?.joined || S.servers.find((x) => x.id === id)) return navigate('/channels/' + id);
  try {
    const sd = await api('POST', `/api/discover/${id}/join`);
    S.serverData[sd.server.id] = sd; sd.members.forEach((x) => cacheUser(x.user));
    if (!S.servers.find((x) => x.id === sd.server.id)) S.servers.push({ id: sd.server.id, name: sd.server.name, icon: sd.server.icon, unread: 0 });
    toast(`Welcome to ${sd.server.name}!`); navigate('/channels/' + sd.server.id);
  } catch (e) { toast(e.message, true); }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sg-all]')) { S.star.q = ''; const i = $('#sg-q'); if (i) i.value = ''; return loadStargaze(); }
  if (e.target.closest('[data-sg-invite]')) return openCreateServer('join');
  const j = e.target.closest('[data-sg-join]'); if (j) { e.stopPropagation(); return joinFromStargaze(j.dataset.sgJoin); }
  const o = e.target.closest('[data-sg-open]'); if (o) return joinFromStargaze(o.dataset.sgOpen);
});

// ---- Space settings › Access
async function ssAccess(pane, sid) {
  pane.innerHTML = '<h2>Access</h2><div class="muted">Loading…</div>';
  let st; try { st = await api('GET', `/api/servers/${sid}/discovery`); } catch (e) { pane.innerHTML = `<h2>Access</h2><p class="err">${esc(e.message)}</p>`; return; }
  const sd = S.serverData[sid]; const hasDesc = !!String(sd?.server?.description || '').trim();
  const pct = Math.min(100, Math.round((st.memberCount / st.minimum) * 100));
  const locked = !st.eligible && !st.enabled;
  pane.innerHTML = `<h2>Access</h2>
    <div class="acc-card ${st.enabled ? 'on' : ''}">
      <div class="acc-top"><div class="acc-ic">${icon('compass')}</div>
        <div class="acc-t"><b>List on Stargaze</b><span>Anyone on lumi can find this community on Stargaze and join without an invite.</span></div>
        <label class="switch"><input type="checkbox" id="acc-on" ${st.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''}><span></span></label></div>
      ${st.exempt ? `<div class="acc-perk">${st.viaSparks ? icon('gem', 'sm') : POTION.replace('<svg', '<svg style="width:16px;height:16px"')} ${st.viaSparks ? 'The owner has Sparks' : 'This community is run by a lumi owner'}, so the ${st.minimum.toLocaleString()}-member minimum doesn't apply.</div>`
        : `<div class="acc-req"><div class="acc-req-h"><span>Members</span><b>${st.memberCount.toLocaleString()} / ${st.minimum.toLocaleString()}</b></div>
          <div class="acc-bar"><i style="width:${pct}%"></i></div>
          <div class="hint">${st.eligible ? 'This community meets the member minimum.' : `Communities need at least ${st.minimum.toLocaleString()} members to go on Stargaze. ${(st.minimum - st.memberCount).toLocaleString()} to go.`}</div></div>`}
      ${!hasDesc ? `<div class="hint" style="margin-top:10px">Add a description in <a data-acc-go="overview">Overview</a> first, so people know what your community is about.</div>` : ''}
    </div>
    <div class="field" style="margin-top:20px"><label>Genre</label>
      <form class="acc-genre" id="acc-genre"><input class="input" name="g" maxlength="24" placeholder="e.g. Indie games, Lo-fi, Study group" value="${esc(st.category || '')}" autocomplete="off"><button class="btn" type="submit">Save</button></form>
      <div class="hint" style="margin-top:8px">A few words that describe your community. Shown on its Stargaze card and used in search.</div></div>`;
  const save = async (body) => {
    try { st = await api('PUT', `/api/servers/${sid}/discovery`, body); toast('category' in body ? 'Genre saved' : st.enabled ? 'Listed on Stargaze' : 'Removed from Stargaze'); }
    catch (e) { toast(e.message, true); }
    ssAccess(pane, sid);
  };
  pane.querySelector('#acc-on').onchange = (e) => save({ enabled: e.target.checked });
  pane.querySelector('#acc-genre').onsubmit = (e) => { e.preventDefault(); save({ category: e.target.g.value.trim() }); };
  pane.querySelector('[data-acc-go]')?.addEventListener('click', () => S.openServerSettings?.el.querySelector('[data-tab="overview"]')?.click());
}

// ------------------------------------------------------------------ Activities (Lumi Arcade)
const arcadeSoon = () => `<div class="arcade-cab"><div class="arcade-screen">
      <div class="ac-title">LUMI<span>ARCADE</span></div>
      <div class="ac-sub">loading the fun</div>
      <div class="ac-dots"><i></i><i></i><i></i><i></i></div>
      <div class="ac-coin">INSERT COIN</div>
      <div class="ac-soon">&#9656; coming soon &#9666;</div>
    </div></div>`;
const priceTag = (c) => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
async function renderArcade(main) {
  main.innerHTML = `<header class="main-head">${mobileBtn()}<div class="t">${icon('gamepad', 'sm')} Activities</div></header>
    <div class="content arcade-wrap" id="arcade-body"><div class="arcade-cab"><div class="arcade-screen"><div class="ac-title">LUMI<span>ARCADE</span></div><div class="ac-sub">loading…</div><div class="ac-dots"><i></i><i></i><i></i><i></i></div></div></div></div>`;
  let r; try { r = await api('GET', '/api/games'); } catch { r = { games: [] }; }
  S.arcade = r;
  if (S.view.type === 'arcade') renderSideBody(); // the sidebar list rendered before this fetch finished
  const body = main.querySelector('#arcade-body'); if (!body) return;
  body.classList.add('arcade-grid-wrap');
  const chessCard = `<button class="game-card builtin" data-builtin="chess" style="--gc:#2bb3a3">
      <div class="gc-art chess-art"><span class="ca-pieces">♜♞♝♛♚</span></div>
      <div class="gc-name">Chess</div><div class="gc-tag">Online · Free</div></button>`;
  body.innerHTML = `<div class="arcade-grid">${chessCard}${r.games.map((g, i) => `
    <button class="game-card ${g.playable ? '' : 'locked'}" data-game="${g.id}" style="--gc:${['#6d4aff', '#e0558e', '#2bb3a3', '#f2a23c', '#4a9dff', '#b06dff'][i % 6]}">
      <div class="gc-art${g.thumb ? ' has-thumb' : ''}"${g.thumb ? ` style="background-image:url('${esc(g.thumb)}')"` : ''}>${g.thumb ? '' : icon('gamepad')}${g.playable ? '' : `<span class="gc-lock">${icon('lock', 'sm')}</span>`}</div>
      <div class="gc-name">${esc(g.title)}</div>
      <div class="gc-tag">${g.price ? (g.playable ? 'Sparks' : priceTag(g.price)) : 'Free'}</div>
    </button>`).join('')}</div>`;
  body.querySelector('[data-builtin="chess"]').onclick = () => navigate('/chess');
  body.querySelectorAll('[data-game]').forEach((b) => (b.onclick = () => openGame(r.games.find((x) => x.id === b.dataset.game), r)));
}
function openGame(g, r) {
  if (!g) return;
  if (!g.playable) {
    const lm = openModal({ title: g.title, cls: 'game-lock-modal', body: `<div style="text-align:center;padding:6px 4px 2px">
      <div class="gl-badge">${icon('lock')}</div>
      <p style="margin:12px 0 4px;font-weight:700;font-size:16px">${esc(g.title)} costs ${priceTag(g.price)}</p>
      <p class="muted" style="margin:0 0 16px">It’s free with Sparks, or pay once${r.venmo ? ` with Venmo (<b>@${esc(r.venmo)}</b>)` : ''}.</p>
      <button class="btn primary" data-sparks>${icon('gem', 'sm')} Get Sparks — all games free</button></div>` });
    lm.el.querySelector('[data-sparks]').onclick = () => { lm.close(); navigate('/sparks'); };
    return;
  }
  // Uploaded games are served same-origin and strictly sandboxed; URL games are embedded from their own
  // site (a different origin), so allow-same-origin is safe there and lets the game use its own storage.
  const src = g.url ? esc(g.url) : `/play/${g.id}`;
  const sandbox = g.url ? 'allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-modals allow-popups'
    : 'allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups';
  // URL games are embedded from another site; many sites refuse to be framed and show blank, so always
  // offer an "open in new tab" escape and a fallback note if nothing renders.
  const openBtn = g.url ? `<a class="game-open" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${icon('link', 'sm')} Open in new tab</a>` : '';
  const m = openModal({ title: g.title, cls: 'game-modal wide', body: `<div class="game-stage">
    <div class="game-loading" id="game-loading"><div class="gl-spin"></div><div class="gl-txt">Loading ${esc(g.title)}…</div></div>
    ${openBtn}
    <iframe class="game-frame" id="game-frame" src="${src}" title="${esc(g.title)}" allow="fullscreen; autoplay; gamepad" sandbox="${sandbox}"></iframe>
    <div class="game-blocked" id="game-blocked" hidden><p>This game didn’t load. The site may not allow being embedded.</p>
      ${g.url ? `<a class="btn primary" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${icon('link', 'sm')} Open in a new tab</a>` : ''}</div></div>` });
  m.el.classList.add('game-playing');
  const fr = m.el.querySelector('#game-frame'), ld = m.el.querySelector('#game-loading'), blocked = m.el.querySelector('#game-blocked');
  let loaded = false;
  const done = () => { loaded = true; if (ld) ld.remove(); fr.classList.add('ready'); };
  fr.addEventListener('load', done);
  setTimeout(done, 8000); // never leave the spinner stuck if the load event is missed
  // For URL games, if the frame never fires load (blocked), surface the fallback.
  if (g.url) setTimeout(() => { if (!loaded) { if (ld) ld.remove(); if (blocked) blocked.hidden = false; } }, 6000);
  const onMsg = (ev) => { if (ev.data && ev.data.__lumiGame && ev.data.error) console.warn('[game:' + g.title + ']', ev.data.error); };
  window.addEventListener('message', onMsg);
  const iv = setInterval(() => { if (!document.body.contains(m.el)) { window.removeEventListener('message', onMsg); clearInterval(iv); } }, 2000);
}
function renderArcadeSide(el) {
  const r = S.arcade;
  const list = r && r.games.length
    ? r.games.map((g) => `<button class="side-game" data-game="${g.id}">${icon('gamepad', 'sm')} <span>${esc(g.title)}</span>${g.price ? `<span class="sg-tag">${g.playable ? '★' : priceTag(g.price)}</span>` : ''}</button>`).join('')
    : `<div class="arcade-side-soon">${icon('gamepad', 'sm')} Coming soon</div>`;
  el.innerHTML = `<div class="side-section">Games</div>${list}`;
  el.querySelectorAll('[data-game]').forEach((b) => (b.onclick = () => openGame(r.games.find((x) => x.id === b.dataset.game), r)));
}
