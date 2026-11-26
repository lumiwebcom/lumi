// ------------------------------------------------------------------ GIF picker
// A panel above the message box: categories to browse, search, favorites. Clicking a GIF sends it.
const GIF_URL = /^https:\/\/([a-z0-9-]+\.)*(klipy\.com|klipy\.co|giphy\.com)\/\S+\.(gif|webp)(\?\S*)?$/i;
const isGifMsg = (text) => GIF_URL.test((text || '').trim());
const Gif = { open: false, view: 'home', q: '', page: 1, items: [], more: false, loading: false, home: null, favs: null };

async function loadGifFavs() { try { Gif.favs = (await api('GET', '/api/gifs/favorites')).items; } catch { Gif.favs = []; } }
const isGifFav = (url) => !!Gif.favs?.some((f) => f.url === url);
async function toggleGifFav(g) {
  if (!Gif.favs) await loadGifFavs();
  const on = !isGifFav(g.url);
  try {
    if (on) { await api('PUT', '/api/gifs/favorites', { url: g.url, preview: g.preview || g.url, w: g.w, h: g.h }); Gif.favs.unshift({ url: g.url, preview: g.preview || g.url, w: g.w, h: g.h }); }
    else { await api('DELETE', '/api/gifs/favorites?url=' + encodeURIComponent(g.url)); Gif.favs = Gif.favs.filter((f) => f.url !== g.url); }
    toast(on ? 'Added to favorite GIFs' : 'Removed from favorite GIFs');
  } catch (e) { toast(e.message, true); }
  return on;
}

// how a GIF looks inside a message
function gifMessageHtml(url) {
  return `<div class="gif-msg"><img src="${esc(url)}" alt="GIF" loading="lazy" referrerpolicy="no-referrer">
    <button class="gif-fav ${isGifFav(url) ? 'on' : ''}" data-giffav="${esc(url)}" data-tip="Favorite">${icon('star', 'sm')}</button></div>`;
}
document.addEventListener('click', async (e) => {
  // with "Show GIFs in chat" off, a GIF shows as a small link that opens it
  const hid = document.documentElement.classList.contains('hide-gifs') && e.target.closest('.gif-msg');
  if (hid) { const img = hid.querySelector('img'); if (img) window.open(img.src, '_blank', 'noopener'); return; }
  const b = e.target.closest('[data-giffav]'); if (!b) return;
  e.stopPropagation();
  const on = await toggleGifFav({ url: b.dataset.giffav });
  document.querySelectorAll(`[data-giffav="${CSS.escape(b.dataset.giffav)}"]`).forEach((x) => x.classList.toggle('on', on));
}, true);

function closeGifPicker() {
  Gif.open = false; $('#gif-panel')?.remove();
  document.removeEventListener('mousedown', gifOutside, true); document.removeEventListener('keydown', gifEsc, true);
  $('[data-act=gif]')?.classList.remove('on');
}
function gifOutside(e) { if (!e.target.closest('#gif-panel, [data-act=gif]')) closeGifPicker(); }
function gifEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); Gif.view !== 'home' ? gifGo('home') : closeGifPicker(); } }

async function toggleGifPicker() {
  if (Gif.open) return closeGifPicker();
  const wrap = $('#composer-wrap'); if (!wrap) return;
  Gif.open = true; Gif.view = 'home'; Gif.q = '';
  const el = h(`<div id="gif-panel" class="gif-panel">
    <div class="gp-top"><button class="icon-btn gp-back" hidden data-gp="back">${icon('back', 'sm')}</button>
      <label class="gp-search">${icon('search', 'sm')}<input id="gp-q" placeholder="Search GIFs" autocomplete="off" maxlength="60"></label>
      <button class="icon-btn" data-gp="close">${icon('x', 'sm')}</button></div>
    <div class="gp-body" id="gp-body"></div></div>`);
  wrap.appendChild(el);
  $('[data-act=gif]')?.classList.add('on');
  document.addEventListener('mousedown', gifOutside, true); document.addEventListener('keydown', gifEsc, true);
  const inp = el.querySelector('#gp-q');
  let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(() => { const q = inp.value.trim(); q ? gifGo('search', q) : gifGo('home'); }, 300); };
  el.querySelector('[data-gp=close]').onclick = closeGifPicker;
  el.querySelector('[data-gp=back]').onclick = () => { inp.value = ''; gifGo('home'); };
  el.querySelector('#gp-body').onscroll = (e) => { const b = e.target; if (b.scrollTop + b.clientHeight > b.scrollHeight - 300) gifMore(); };
  if (matchMedia('(pointer:fine)').matches) inp.focus();
  if (!Gif.favs) loadGifFavs();
  gifGo('home');
}

async function gifGo(view, q = '') {
  Gif.view = view; Gif.q = q; Gif.page = 1; Gif.items = []; Gif.more = false;
  const panel = $('#gif-panel'); if (!panel) return;
  panel.querySelector('.gp-back').hidden = view === 'home';
  const inp = panel.querySelector('#gp-q');
  if (view === 'trending' || view === 'favorites') inp.value = '';
  if (view === 'search' && document.activeElement !== inp) inp.value = q;
  inp.placeholder = view === 'favorites' ? 'Favorites' : view === 'trending' ? 'Trending' : 'Search GIFs';
  const body = panel.querySelector('#gp-body'); body.scrollTop = 0;
  if (view === 'home') return gifHome(body);
  if (view === 'favorites') { if (!Gif.favs) await loadGifFavs(); Gif.items = Gif.favs.map((f) => ({ ...f })); return gifGrid(body); }
  body.innerHTML = gifSkeleton();
  await gifMore(true);
}
async function gifMore(first) {
  if (Gif.loading || (!first && !Gif.more) || !['search', 'trending'].includes(Gif.view)) return;
  Gif.loading = true; const view = Gif.view, q = Gif.q;
  try {
    const r = await api('GET', `/api/gifs/search?q=${encodeURIComponent(view === 'trending' ? '' : q)}&page=${Gif.page}`);
    if (Gif.view !== view || Gif.q !== q) return;
    Gif.items.push(...r.items); Gif.more = r.more; Gif.page++;
    gifGrid($('#gp-body'));
  } catch (e) { const b = $('#gp-body'); if (b && !Gif.items.length) b.innerHTML = `<div class="gp-empty">${esc(e.message)}</div>`; }
  finally { Gif.loading = false; }
}
const gifSkeleton = () => `<div class="gp-grid">${[0, 1].map(() => `<div class="gp-col">${[120, 90, 150, 100].map((hh) => `<div class="gp-sk" style="height:${hh}px"></div>`).join('')}</div>`).join('')}</div>`;

async function gifHome(body) {
  const tile = (key, label, img, cls = '') => `<button class="gp-tile ${cls}" data-gp-go="${esc(key)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span>${label}</span></button>`;
  const draw = () => {
    const hm = Gif.home;
    const favImg = Gif.favs?.[0]?.preview || hm?.favPreview;
    let html = `<div class="gp-tiles">${tile('favorites', `${icon('star', 'sm')} Favorites`, favImg, 'fav')}`;
    if (hm?.enabled) html += tile('trending', `${icon('trend', 'sm')} Trending`, hm.trending) + hm.categories.map((c) => tile('q:' + c.term, esc(c.term), c.preview)).join('');
    html += '</div>';
    if (hm && !hm.enabled) html += `<div class="gp-note">${icon('info', 'sm')}<div>GIF search isn’t switched on yet. ${S.me.siteRole === 'owner' ? 'Add a free <b>GIPHY_API_KEY</b> in Render to turn it on.' : 'Your favorite GIFs still work.'}</div></div>`;
    if (!hm) html += `<div class="gp-tiles">${Array.from({ length: 6 }, () => '<div class="gp-sk" style="height:96px"></div>').join('')}</div>`;
    body.innerHTML = html;
    body.querySelectorAll('[data-gp-go]').forEach((b) => (b.onclick = () => { const k = b.dataset.gpGo; k.startsWith('q:') ? gifGo('search', k.slice(2)) : gifGo(k); }));
  };
  draw();
  if (!Gif.home || Date.now() - Gif.home.at > 30 * 60_000) {
    try { Gif.home = { ...(await api('GET', '/api/gifs/home')), at: Date.now() }; } catch { Gif.home = { enabled: false, categories: [], at: Date.now() }; }
    if (Gif.view === 'home' && $('#gp-body') === body) draw();
  }
}
function gifGrid(body) {
  if (!body) return;
  if (!Gif.items.length) { body.innerHTML = `<div class="gp-empty">${Gif.view === 'favorites' ? `${icon('star')}<div>No favorites yet. Tap the star on any GIF to save it here.</div>` : 'No GIFs found. Try another word.'}</div>`; return; }
  // two columns, each GIF goes in whichever column is shorter
  const cols = [[], []], hs = [0, 0];
  Gif.items.forEach((g, i) => { const c = hs[0] <= hs[1] ? 0 : 1; cols[c].push(i); hs[c] += (g.h || 1) / (g.w || 1); });
  body.innerHTML = `<div class="gp-grid">${cols.map((col) => `<div class="gp-col">${col.map((i) => { const g = Gif.items[i]; return `<div class="gp-gif" data-gi="${i}" style="aspect-ratio:${g.w || 1}/${g.h || 1}" title="${esc(g.title || '')}"><img src="${esc(g.preview || g.url)}" alt="" loading="lazy" referrerpolicy="no-referrer"><button class="gif-fav ${isGifFav(g.url) ? 'on' : ''}" data-star="${i}" data-tip="Favorite">${icon('star', 'sm')}</button></div>`; }).join('')}</div>`).join('')}</div>${Gif.more ? '<div class="gp-loading">Loading more…</div>' : ''}`;
  body.querySelectorAll('[data-star]').forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); const on = await toggleGifFav(Gif.items[b.dataset.star]); b.classList.toggle('on', on); if (Gif.view === 'favorites' && !on) { Gif.items.splice(+b.dataset.star, 1); gifGrid(body); } }));
  body.querySelectorAll('[data-gi]').forEach((d) => (d.onclick = () => sendGif(Gif.items[d.dataset.gi])));
  if (Gif.more && body.scrollHeight <= body.clientHeight + 40) gifMore();
}
function sendGif(g) {
  if (!g) return;
  closeGifPicker();
  sendMessage(g.url);
}
