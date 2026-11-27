// ------------------------------------------------------------------ Chess (native, with online + friends multiplayer)
// Original implementation: standard rules engine + board UI + real-time play over the app's socket.
const Chess = { view: 'menu', game: null, waiting: null, bound: false, sel: null, legalFor: null, lastMove: null, flip: false };

// ---- pieces (original drawn SVG so they render identically everywhere and never vanish) ------------------
const CH_SVG = {
  p: '<path d="M22.5 8.5a5 5 0 0 0-2.3 9.4c-2.6 1.5-4.4 4.3-4.4 7.6 0 2.6 1.1 4.9 2.9 6.5-3.2 1.6-5.4 4.6-5.4 8.2h18.4c0-3.6-2.2-6.6-5.4-8.2 1.8-1.6 2.9-3.9 2.9-6.5 0-3.3-1.8-6.1-4.4-7.6A5 5 0 0 0 22.5 8.5z"/>',
  r: '<path d="M12 40v-3l2.5-2.5V22H12v-9h5v3h3.5v-3H25v3h3.5v-3h5v9H31v12.5L33 37v3z"/>',
  n: '<path d="M18 11c1.8-2 5.2-2.2 7.2-.4 1 .9 3.5 2.2 5.7 4.6 3 3.3 4.6 7.9 4.6 14.3V40H13.5v-3.5c0-6 1.5-9.8 4.8-13.2 1.4-1.4 2-2.2 2-3.3 0-.8-.6-1.4-1.6-1.4-1.3 0-2.3 1.2-3.2 2.6-1 1.5-2.4 2.3-3.9 2-1.6-.3-2.3-1.9-1.8-3.4.8-2.3 3.4-4.8 6.2-6.4-.6-1-.5-2.2.2-3zM20 18.5a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z"/>',
  b: '<path d="M22.5 7.5a2.4 2.4 0 0 0-1 4.6c-3.6 1.8-6.2 5.6-6.2 10 0 3 1.3 5.6 3.3 7.3-2.9 1.5-4.9 4.5-4.9 7.9h16.6c0-3.4-2-6.4-4.9-7.9 2-1.7 3.3-4.3 3.3-7.3 0-4.4-2.6-8.2-6.2-10a2.4 2.4 0 0 0-1-4.6zM19.5 20h6M22.5 17v6"/>',
  q: '<path d="M9 16.5a2.3 2.3 0 1 0 0-.1zM18 13.5a2.3 2.3 0 1 0 0-.1zM22.5 11a2.4 2.4 0 1 0 0-.1zM27 13.5a2.3 2.3 0 1 0 0-.1zM36 16.5a2.3 2.3 0 1 0 0-.1z"/><path d="M11 20l-1.5-4 4.5 4.5 3.5-7.5 4.5 9 4.5-9 3.5 7.5 4.5-4.5-1.5 4 2 13.5c-3 1.3-6.6 2-10.5 2s-7.5-.7-10.5-2z"/><path d="M13 40c0-3.5 4-5.5 9.5-5.5S32 36.5 32 40z"/>',
  k: '<path d="M21.1 5h2.8v3.1h3.1v2.8h-3.1V14h-2.8v-3.1H18V8.1h3.1z"/><path d="M22.5 15a3 3 0 0 0-2.5 4.7c-3.5 1.4-5.8 4.7-5.8 9 0 .6 0 1.2.1 1.8h16.4c.1-.6.1-1.2.1-1.8 0-4.3-2.3-7.6-5.8-9A3 3 0 0 0 22.5 15z"/><path d="M13 40c0-3.5 4-5.5 9.5-5.5S32 36.5 32 40z"/>',
};
const pieceSVG = (t, cls) => `<svg viewBox="0 0 45 45" class="pc-svg ${cls || ''}">${CH_SVG[t]}</svg>`;
const chInside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const chOpp = (c) => (c === 'w' ? 'b' : 'w');
function chStart() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let c = 0; c < 8; c++) { b[0][c] = { t: back[c], c: 'b' }; b[1][c] = { t: 'p', c: 'b' }; b[6][c] = { t: 'p', c: 'w' }; b[7][c] = { t: back[c], c: 'w' }; }
  return { board: b, turn: 'w', castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: null };
}
function chClone(s) { return { board: s.board.map((row) => row.map((p) => (p ? { ...p } : null))), turn: s.turn, castle: { ...s.castle }, ep: s.ep ? [...s.ep] : null }; }
function chAttacked(b, R, C, by) {
  const pr = by === 'w' ? R + 1 : R - 1;
  for (const pc of [C - 1, C + 1]) if (chInside(pr, pc)) { const p = b[pr][pc]; if (p && p.c === by && p.t === 'p') return true; }
  for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) { const r = R + dr, c = C + dc; if (chInside(r, c)) { const p = b[r][c]; if (p && p.c === by && p.t === 'n') return true; } }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const r = R + dr, c = C + dc; if (chInside(r, c)) { const p = b[r][c]; if (p && p.c === by && p.t === 'k') return true; } }
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { let r = R + dr, c = C + dc; while (chInside(r, c)) { const p = b[r][c]; if (p) { if (p.c === by && (p.t === 'b' || p.t === 'q')) return true; break; } r += dr; c += dc; } }
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { let r = R + dr, c = C + dc; while (chInside(r, c)) { const p = b[r][c]; if (p) { if (p.c === by && (p.t === 'r' || p.t === 'q')) return true; break; } r += dr; c += dc; } }
  return false;
}
function chKing(b, color) { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = b[r][c]; if (p && p.t === 'k' && p.c === color) return [r, c]; } return null; }
function chPseudo(s, color) {
  const b = s.board, moves = [];
  const add = (fr, fc, tr, tc, ex) => moves.push({ from: [fr, fc], to: [tr, tc], ...ex });
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = b[r][c]; if (!p || p.c !== color) continue;
    if (p.t === 'p') {
      const dir = color === 'w' ? -1 : 1, startRow = color === 'w' ? 6 : 1, promoRow = color === 'w' ? 0 : 7;
      if (chInside(r + dir, c) && !b[r + dir][c]) {
        if (r + dir === promoRow) for (const pr of ['q', 'r', 'b', 'n']) add(r, c, r + dir, c, { promo: pr }); else add(r, c, r + dir, c, {});
        if (r === startRow && !b[r + 2 * dir][c]) add(r, c, r + 2 * dir, c, { double: true });
      }
      for (const dc of [-1, 1]) {
        const tr = r + dir, tc = c + dc; if (!chInside(tr, tc)) continue; const q = b[tr][tc];
        if (q && q.c === chOpp(color)) { if (tr === promoRow) for (const pr of ['q', 'r', 'b', 'n']) add(r, c, tr, tc, { promo: pr }); else add(r, c, tr, tc, {}); }
        else if (s.ep && s.ep[0] === tr && s.ep[1] === tc) add(r, c, tr, tc, { ep: true });
      }
    } else if (p.t === 'n') {
      for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) { const tr = r + dr, tc = c + dc; if (chInside(tr, tc) && (!b[tr][tc] || b[tr][tc].c !== color)) add(r, c, tr, tc, {}); }
    } else if (p.t === 'k') {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const tr = r + dr, tc = c + dc; if (chInside(tr, tc) && (!b[tr][tc] || b[tr][tc].c !== color)) add(r, c, tr, tc, {}); }
      const row = color === 'w' ? 7 : 0;
      if (r === row && c === 4) {
        const kS = color === 'w' ? s.castle.wK : s.castle.bK, qS = color === 'w' ? s.castle.wQ : s.castle.bQ, o = chOpp(color);
        if (kS && !b[row][5] && !b[row][6] && b[row][7] && b[row][7].t === 'r' && b[row][7].c === color && !chAttacked(b, row, 4, o) && !chAttacked(b, row, 5, o) && !chAttacked(b, row, 6, o)) add(r, c, row, 6, { castle: 'K' });
        if (qS && !b[row][3] && !b[row][2] && !b[row][1] && b[row][0] && b[row][0].t === 'r' && b[row][0].c === color && !chAttacked(b, row, 4, o) && !chAttacked(b, row, 3, o) && !chAttacked(b, row, 2, o)) add(r, c, row, 2, { castle: 'Q' });
      }
    } else {
      const dirs = p.t === 'b' ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : p.t === 'r' ? [[-1, 0], [1, 0], [0, -1], [0, 1]] : [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) { let tr = r + dr, tc = c + dc; while (chInside(tr, tc)) { const q = b[tr][tc]; if (!q) add(r, c, tr, tc, {}); else { if (q.c !== color) add(r, c, tr, tc, {}); break; } tr += dr; tc += dc; } }
    }
  }
  return moves;
}
function chApply(s, m) {
  const n = chClone(s), b = n.board, [fr, fc] = m.from, [tr, tc] = m.to, p = b[fr][fc];
  n.ep = null;
  b[tr][tc] = p; b[fr][fc] = null;
  if (m.promo) b[tr][tc] = { t: m.promo, c: p.c };
  if (m.ep) b[fr][tc] = null;
  if (m.double) n.ep = [(fr + tr) / 2, fc];
  if (m.castle === 'K') { b[fr][5] = b[fr][7]; b[fr][7] = null; }
  if (m.castle === 'Q') { b[fr][3] = b[fr][0]; b[fr][0] = null; }
  if (p.t === 'k') { if (p.c === 'w') { n.castle.wK = n.castle.wQ = false; } else { n.castle.bK = n.castle.bQ = false; } }
  if (fr === 7 && fc === 0) n.castle.wQ = false; if (fr === 7 && fc === 7) n.castle.wK = false;
  if (fr === 0 && fc === 0) n.castle.bQ = false; if (fr === 0 && fc === 7) n.castle.bK = false;
  if (tr === 7 && tc === 0) n.castle.wQ = false; if (tr === 7 && tc === 7) n.castle.wK = false;
  if (tr === 0 && tc === 0) n.castle.bQ = false; if (tr === 0 && tc === 7) n.castle.bK = false;
  n.turn = chOpp(s.turn);
  return n;
}
function chLegal(s) {
  const color = s.turn, out = [];
  for (const m of chPseudo(s, color)) { const n = chApply(s, m); const kp = chKing(n.board, color); if (kp && !chAttacked(n.board, kp[0], kp[1], chOpp(color))) out.push(m); }
  return out;
}
const chInCheck = (s, color) => { const kp = chKing(s.board, color); return kp ? chAttacked(s.board, kp[0], kp[1], chOpp(color)) : false; };
function chStatus(s) { const moves = chLegal(s); const chk = chInCheck(s, s.turn); if (!moves.length) return chk ? 'checkmate' : 'stalemate'; return chk ? 'check' : 'ongoing'; }

// ---- socket wiring ---------------------------------------------------------
function chessBind() {
  if (Chess.bound || typeof socket === 'undefined' || !socket) return;
  Chess.bound = true;
  socket.on('chess:start', ({ gameId, color, opponent }) => {
    Chess.waiting = null;
    Chess.game = { id: gameId, color, opponent, state: chStart(), over: null, mode: 'online' };
    Chess.flip = color === 'b'; Chess.sel = null; Chess.lastMove = null;
    Chess.view = 'game';
    if (S.view.type === 'chess') renderMain();
  });
  socket.on('chess:move', ({ gameId, move }) => {
    const g = Chess.game; if (!g || g.id !== gameId || g.over) return;
    g.state = chApply(g.state, move); Chess.lastMove = move; Chess.sel = null;
    checkEnd(g);
    if (S.view.type === 'chess') renderMain();
  });
  socket.on('chess:over', ({ gameId, result, winner }) => {
    const g = Chess.game; if (!g || g.id !== gameId) return;
    g.over = result === 'left' ? 'Opponent left — you win' : result === 'resign' ? (winner === S.me.id ? 'Opponent resigned — you win' : 'You resigned') : result;
    if (S.view.type === 'chess') renderMain();
  });
  socket.on('chess:opponent-left', () => {
    const g = Chess.game; if (!g || g.over) return; g.over = 'Opponent left — you win';
    if (S.view.type === 'chess') renderMain();
  });
}
function checkEnd(g) {
  const st = chStatus(g.state);
  if (st === 'checkmate') g.over = g.state.turn === g.color ? 'Checkmate — you lost' : 'Checkmate — you win!';
  else if (st === 'stalemate') g.over = 'Stalemate — it’s a draw';
}

// ---- views -----------------------------------------------------------------
function renderChess(main) {
  chessBind();
  const head = `<header class="main-head">${mobileBtn()}<div class="t">${icon('gamepad', 'sm')} Chess</div></header>`;
  if (Chess.view === 'waiting') return renderChessWaiting(main, head);
  if (Chess.view === 'game' && Chess.game) return renderChessGame(main, head);
  return renderChessMenu(main, head);
}
function renderChessMenu(main, head) {
  const row = (ch, pc, h, d) => `<button class="cm-card" data-ch="${ch}"><span class="cm-ic">${pieceSVG(pc, 'wp')}</span><span class="cm-txt"><span class="cm-h">${h}</span><span class="cm-d">${d}</span></span><span class="cm-go">${icon('chevron', 'sm')}</span></button>`;
  main.innerHTML = `${head}<div class="content chess-wrap"><div class="chess-menu">
    <div class="cm-hero">
      <div class="cm-hero-board">${[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => `<i class="${(r + c) % 2 ? 'd' : 'l'}"></i>`).join('')).join('')}</div>
      <div class="cm-hero-txt"><div class="cm-title">Chess</div><p class="cm-sub">Play a quick match, challenge a friend with a code, or pass-and-play on one device.</p></div>
    </div>
    <div class="cm-cards">
      ${row('online', 'n', 'Play online', 'Get matched with someone else on lumi')}
      ${row('friend', 'q', 'Play a friend', 'Create a table and share the code')}
      ${row('join', 'r', 'Join with a code', 'Enter a friend’s table code')}
      ${row('local', 'k', 'Pass &amp; play', 'Two players on this device')}
    </div>
    <button class="btn ghost cm-back" data-go-arcade>${icon('back', 'sm')} Back to Activities</button>
  </div></div>`;
  main.querySelector('[data-go-arcade]').onclick = () => navigate('/arcade');
  main.querySelectorAll('[data-ch]').forEach((b) => (b.onclick = () => chessAction(b.dataset.ch)));
}
function renderChessWaiting(main, head) {
  const w = Chess.waiting || {};
  main.innerHTML = `${head}<div class="content chess-wrap"><div class="chess-menu">
    <div class="cm-title">${w.code ? 'Your table is ready' : 'Finding an opponent'}</div>
    <div class="cw-spin"><div class="gl-spin"></div></div>
    ${w.code ? `<p class="cm-sub">Share this code with your friend. The game starts the moment they join.</p>
      <div class="cw-code">${w.code.split('').map((d) => `<span>${d}</span>`).join('')}</div>` : `<p class="cm-sub">Waiting for another player to join… hang tight.</p>`}
    <button class="btn ghost cm-back" data-cancel>${icon('x', 'sm')} Cancel</button>
  </div></div>`;
  main.querySelector('[data-cancel]').onclick = () => { try { socket.emit('chess:cancel'); } catch {} Chess.waiting = null; Chess.view = 'menu'; renderMain(); };
}
function renderChessGame(main, head) {
  const g = Chess.game, me = g.color, myTurn = !g.over && g.state.turn === me && g.mode !== 'local';
  const localTurn = g.mode === 'local' && !g.over;
  const turnTxt = g.over ? g.over : (g.mode === 'local' ? `${g.state.turn === 'w' ? 'White' : 'Black'} to move` : (g.state.turn === me ? 'Your move' : `${g.opponent ? esc(g.opponent.displayName) : 'Opponent'}’s move`));
  const chk = !g.over && chInCheck(g.state, g.state.turn);
  const oppName = g.mode === 'local' ? 'Black' : (g.opponent ? esc(g.opponent.displayName) : 'Opponent');
  const meName = g.mode === 'local' ? 'White' : esc(S.me.displayName);
  main.innerHTML = `${head}<div class="content chess-wrap"><div class="chess-game">
    <div class="cg-bar"><div class="cg-player">${g.mode === 'local' ? '' : avatarHTML(g.opponent, 28)}<span>${oppName}</span></div>
      <div class="cg-turn ${chk ? 'check' : ''} ${g.over ? 'over' : ''}">${chk && !g.over ? 'Check! ' : ''}${turnTxt}</div></div>
    <div class="cg-boardwrap"><div class="cg-board" id="cg-board"></div></div>
    <div class="cg-bar"><div class="cg-player">${g.mode === 'local' ? '' : avatarHTML(S.me, 28)}<span>${meName}${g.mode === 'local' ? '' : ' (you)'}</span></div>
      <div class="cg-actions">
        ${g.over ? `<button class="btn primary" data-new>${icon('gamepad', 'sm')} New game</button>` : `<button class="btn danger" data-resign>${g.mode === 'local' ? 'End game' : 'Resign'}</button>`}
      </div></div>
  </div></div>`;
  drawBoard(main.querySelector('#cg-board'));
  const resign = main.querySelector('[data-resign]');
  if (resign) resign.onclick = () => {
    if (g.mode === 'local') { Chess.game = null; Chess.view = 'menu'; return renderMain(); }
    confirmDialog('Resign this game?', 'Your opponent wins. You can start a new game after.', 'Resign').then((ok) => {
      if (!ok) return; try { socket.emit('chess:resign', { gameId: g.id }); } catch {}
      g.over = 'You resigned'; renderMain();
    });
  };
  const nw = main.querySelector('[data-new]'); if (nw) nw.onclick = () => { Chess.game = null; Chess.view = 'menu'; renderMain(); };
}
function avatarHTML(u, size) {
  if (!u) return '';
  if (u.avatar) return `<img class="cg-av" style="width:${size}px;height:${size}px" src="${esc(u.avatar)}" alt="">`;
  const initial = esc((u.displayName || '?')[0] || '?').toUpperCase();
  return `<span class="cg-av cg-av-txt" style="width:${size}px;height:${size}px;background:${esc(u.accent || '#6d4aff')}">${initial}</span>`;
}
function drawBoard(el) {
  const g = Chess.game, s = g.state, flip = Chess.flip;
  const rows = flip ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const cols = flip ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  let h = '';
  for (const r of rows) for (const c of cols) {
    const dark = (r + c) % 2 === 1, p = s.board[r][c];
    const isSel = Chess.sel && Chess.sel[0] === r && Chess.sel[1] === c;
    const isTarget = Chess.legalFor && Chess.legalFor.some((m) => m.to[0] === r && m.to[1] === c);
    const isLast = Chess.lastMove && ((Chess.lastMove.from[0] === r && Chess.lastMove.from[1] === c) || (Chess.lastMove.to[0] === r && Chess.lastMove.to[1] === c));
    const inChk = p && p.t === 'k' && chInCheck(s, p.c) && p.c === s.turn;
    h += `<div class="cg-sq ${dark ? 'dark' : 'light'}${isSel ? ' sel' : ''}${isLast ? ' last' : ''}${inChk ? ' chk' : ''}" data-r="${r}" data-c="${c}">
      ${p ? pieceSVG(p.t, p.c === 'w' ? 'wp' : 'bp') : ''}
      ${isTarget ? `<span class="cg-dot ${p ? 'cap' : ''}"></span>` : ''}</div>`;
  }
  el.innerHTML = h;
  el.querySelectorAll('.cg-sq').forEach((sq) => (sq.onclick = () => onSquare(+sq.dataset.r, +sq.dataset.c)));
}
function onSquare(r, c) {
  const g = Chess.game, s = g.state;
  if (g.over) return;
  const mover = g.state.turn;
  const canControl = g.mode === 'local' || mover === g.color;
  if (!canControl) return;
  // clicking a legal target?
  if (Chess.sel && Chess.legalFor) {
    const opts = Chess.legalFor.filter((m) => m.to[0] === r && m.to[1] === c);
    if (opts.length) {
      if (opts.length > 1 && opts[0].promo) return choosePromo(opts);
      return doMove(opts[0]);
    }
  }
  const p = s.board[r][c];
  if (p && p.c === mover) { Chess.sel = [r, c]; Chess.legalFor = chLegal(s).filter((m) => m.from[0] === r && m.from[1] === c); }
  else { Chess.sel = null; Chess.legalFor = null; }
  drawBoard(document.querySelector('#cg-board'));
}
function doMove(move) {
  const g = Chess.game;
  g.state = chApply(g.state, move); Chess.lastMove = move; Chess.sel = null; Chess.legalFor = null;
  if (g.mode !== 'local') { try { socket.emit('chess:move', { gameId: g.id, move }); } catch {} Chess.flip = g.color === 'b'; }
  checkEnd(g);
  renderMain();
}
function choosePromo(opts) {
  const color = Chess.game.state.turn;
  const m = openModal({ title: 'Promote to', cls: 'promo-modal', body: `<div class="promo-row">${['q', 'r', 'b', 'n'].map((t) => `<button class="promo-pc" data-p="${t}">${pieceSVG(t, color === 'w' ? 'wp' : 'bp')}</button>`).join('')}</div>` });
  m.el.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { m.close(); doMove(opts.find((o) => o.promo === b.dataset.p)); }));
}
function chessAction(kind) {
  if (kind === 'local') { Chess.game = { id: 'local', color: 'w', opponent: null, state: chStart(), over: null, mode: 'local' }; Chess.flip = false; Chess.sel = null; Chess.lastMove = null; Chess.view = 'game'; return renderMain(); }
  chessBind();
  if (typeof socket === 'undefined' || !socket || !socket.connected) return toast('Connecting… try again in a moment.', true);
  if (kind === 'online') {
    socket.emit('chess:find', { mode: 'online' }, (res) => { if (res && res.error) return toast(res.error, true); });
    Chess.waiting = { mode: 'online' }; Chess.view = 'waiting'; renderMain();
  } else if (kind === 'friend') {
    socket.emit('chess:find', { mode: 'create' }, (res) => {
      if (res && res.error) return toast(res.error, true);
      Chess.waiting = { mode: 'friend', code: res.code }; Chess.view = 'waiting'; renderMain();
    });
  } else if (kind === 'join') {
    promptDialog('Join a table', 'Enter your friend’s 4-digit table code.', '', 'Join').then((code) => {
      if (!code) return;
      socket.emit('chess:find', { mode: 'join', code: code.trim() }, (res) => {
        if (res && res.error) return toast(res.error, true);
        Chess.waiting = { mode: 'join' }; Chess.view = 'waiting'; renderMain();
      });
    });
  }
}
function renderChessSide(el) { el.innerHTML = `<div class="side-section">Activities</div><button class="side-game" data-go-arcade>${icon('back', 'sm')} <span>All activities</span></button>`;
  el.querySelector('[data-go-arcade]').onclick = () => navigate('/arcade'); }
