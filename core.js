/* core: helpers, icons, api, state, router, layers */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ icons
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  send: '<path d="M22 3 9.2 10.1"/><path d="M22 3l-7 18-3.8-8.9L2.5 8.3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  hangup: '<g transform="rotate(135 12 12)"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></g>',
  video: '<rect x="2" y="6" width="14" height="12" rx="3"/><path d="m16 10 6-4v12l-6-4"/>',
  videoOff: '<rect x="2" y="6" width="14" height="12" rx="3"/><path d="m16 10 6-4v12l-6-4M2 2l20 20"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>',
  micOff: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8M3 3l18 18"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
  headphonesOff: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3zM3 3l18 18"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  pin: '<path d="M12 17v5M9 10.8V4h6v6.8l3 3.2v2H6v-2z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  reply: '<path d="m9 14-5-5 5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  crown: '<path d="m2 6 4 12h12l4-12-6 5-4-7-4 7z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  chat: '<path d="M20.7 16.6A9.5 9.5 0 1 0 17 20.4l4.5 1.1z"/>',
  block: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  max: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="3"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m2 7 10 6 10-6"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  room: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"/><path d="M8.5 9h7M8.5 12.5h4"/>',
  waves: '<path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 6v12"/>',
  arrowUp: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  logo: '<path d="M7 19c0-7 2.3-11 5-11s5 4 5 11" stroke-width="2.6"/><circle cx="12" cy="4.5" r="2" fill="currentColor" stroke="none"/>',
  flame: '<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.9-2.9-6.2-4.3-9.4-.3 2.3-1.4 3.6-2.6 4.3C12.4 7 11 4.3 8.6 2c.3 4-3.6 6.6-3.6 11.2C5 18.9 7.6 22 12 22z"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  glow: '<path d="M12 2.5l2.1 5.6 5.9.4-4.6 3.8 1.5 5.8L12 14.9l-4.9 3.2 1.5-5.8L4 8.5l5.9-.4z"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-25 12 12)"/>',
  feed: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/>',
  hammer: '<path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9M17.6 15 22 10.6M20 12.5 11.5 4a3 3 0 0 0-4.2 0L6 5.3l12.7 12.7"/>',
};
const LOGO_MARK = '<svg class="mark" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 782 727"><path fill="currentColor" d="M762 342 759 342 741 352 712 364 670 376 635 383 630 383 624 385 529 400 500 407 480 415 462 425 442 440 425 457 411 475 396 502 387 526 381 552 381 559 380 560 380 571 379 572 380 606 381 607 382 621 386 636 386 640 397 675 408 701 411 705 412 705 413 696 422 663 434 633 443 615 455 595 469 575 483 558 513 528 536 509 558 493 609 462 701 415 728 397 741 385 753 369 759 356 762 346ZM386 24 384 22 383 23 382 32 378 47 369 71 361 88 347 113 320 150 289 182 265 202 251 212 213 236 188 250 148 270 146 270 90 297 60 315 52 321 37 336 32 343 24 359 20 379 24 378 41 366 66 353 86 345 109 338 147 330 153 330 154 329 160 329 161 328 167 328 182 325 189 325 190 324 197 324 198 323 230 320 238 318 245 318 285 310 313 299 327 291 346 277 373 249 385 232 393 218 401 200 406 185 411 161 413 129 412 128 412 113 411 112 409 92 400 58Z"/><path class="mk2" d="M39 412 39 414 58 411 86 411 87 412 102 413 127 419 130 421 133 421 148 427 170 438 189 450 205 462 222 477 243 499 258 517 277 543 313 600 334 638 354 677 355 681 357 683 352 652 350 646 348 626 347 625 345 571 346 570 347 545 348 544 348 537 349 536 351 519 357 493 365 469 358 456 343 435 318 410 301 397 282 385 252 371 219 362 202 361 201 360 174 360 173 361 163 361 162 362 144 364 106 375 73 390 56 400ZM441 42 443 62 445 69 446 90 447 91 447 111 448 112 447 151 446 152 446 163 445 164 445 173 444 174 442 194 434 227 429 239 429 244 439 261 451 277 480 306 493 316 512 328 537 340 554 346 572 350 601 352 602 351 623 350 638 347 678 335 719 318 721 316 723 316 747 304 749 301 721 301 720 300 711 300 710 299 698 298 673 292 643 281 609 263 594 253 570 234 537 200 509 163 474 106Z"/></svg>';
const POTION = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="1.6" width="6" height="2.6" rx="1.1" fill="#B98A5B"/><path d="M10 4.2h4v3.7a7 7 0 1 1-4 0z" fill="#EDE6FF" stroke="#743AFB" stroke-width="1.5"/><path d="M5.6 14.6a6.4 6.4 0 0 0 12.8 0z" class="mk2"/><circle cx="10.2" cy="16.4" r="1.1" fill="#fff" opacity=".85"/><circle cx="13.6" cy="18.2" r=".75" fill="#fff" opacity=".7"/><circle cx="12.6" cy="11.2" r=".7" class="mk2"/></svg>';
const SHIELD_BLUE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 3.8 5v6.2c0 5.2 3.5 9.6 8.2 11 4.7-1.4 8.2-5.8 8.2-11V5z" fill="#3B82F6"/><path d="m8.3 12.2 2.6 2.6 4.8-5.2" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function roleBadge(u) {
  const r = (u && (S.userCache[u.id]?.siteRole ?? u.siteRole)) || null;
  if (r === 'owner') return `<span class="rbadge" data-tip="lumi owner">${POTION}</span>`;
  if (r === 'admin') return `<span class="rbadge" data-tip="lumi admin">${SHIELD_BLUE}</span>`;
  return '';
}
const wordmark = (cls = '') => `<div class="wordmark ${cls}">${LOGO_MARK}<span>lumi</span></div>`;
const isSiteAdmin = () => S.me && (S.me.siteRole === 'owner' || S.me.siteRole === 'admin');
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ------------------------------------------------------------------ avatars
const PALETTE = ['#E8461C', '#1F7A5C', '#2B63E8', '#C98A00', '#B8215A', '#0E8A9E', '#7A5A2E', '#3D3D3D', '#D45D00', '#4F7A1F'];
function colorFor(id) { let x = 0; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[x % PALETTE.length]; }
function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || '').join('') || '?'; }
function avatar(u, size = 40, opts = {}) {
  if (!u) u = { id: '?', displayName: '?' };
  const inner = u.avatar ? `<img src="${esc(u.avatar)}" alt="" loading="lazy">` : `<div class="ph" style="--ph:${colorFor(u.id)}">${esc(initials(u.displayName || u.username))}</div>`;
  const dot = opts.dot ? `<span class="dot ${isOnline(u.id) ? '' : 'off'}"></span>` : '';
  const av = `<div class="av" style="width:${size}px;height:${size}px;font-size:${size}px" ${opts.speak ? `data-speak="${esc(u.id)}"` : ''}>${inner}${dot}</div>`;
  return opts.ring ? `<div class="ring ${opts.ring === 'seen' ? 'seen' : ''}" ${opts.speak ? `data-speak-ring="${esc(u.id)}"` : ''}>${av}</div>` : av;
}
function serverIcon(s) {
  return s.icon ? `<img src="${esc(s.icon)}" alt="">` : esc(initials(s.name).toUpperCase());
}

// ------------------------------------------------------------------ time
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function fmtDay(ts) {
  const d = new Date(ts), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd'; return Math.floor(s / 604800) + 'w';
}

// ------------------------------------------------------------------ api
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = r.status; throw e; }
  return data;
}
async function uploadFile(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Files can be up to 25 MB.');
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Upload failed');
  return d;
}
function pickFile(accept = 'image/*') {
  return new Promise((res) => {
    const i = h(`<input type="file" accept="${accept}" style="display:none">`);
    i.onchange = () => { res(i.files[0] || null); i.remove(); };
    document.body.appendChild(i); i.click();
  });
}

// ------------------------------------------------------------------ permissions (mirror server)
const P = { ADMINISTRATOR: 1, MANAGE_SERVER: 2, MANAGE_CHANNELS: 4, MANAGE_ROLES: 8, KICK_MEMBERS: 16, BAN_MEMBERS: 32,
  MANAGE_MESSAGES: 64, CREATE_INVITE: 128, SEND_MESSAGES: 256, CONNECT: 512, ATTACH_FILES: 1024, MANAGE_NICKNAMES: 2048 };
const PERM_INFO = [
  ['ADMINISTRATOR', 'Administrator', 'Every permission, and bypasses all restrictions. Grant carefully.'],
  ['MANAGE_SERVER', 'Manage Orbit', 'Change the orbit name, icon, banner and description, and view invites.'],
  ['MANAGE_CHANNELS', 'Manage Rooms', 'Create, edit and delete rooms and lounges.'],
  ['MANAGE_ROLES', 'Manage Roles', 'Create and edit roles below their highest role, and assign them.'],
  ['KICK_MEMBERS', 'Kick Members', 'Remove members from the orbit. They can rejoin with an invite.'],
  ['BAN_MEMBERS', 'Ban Members', 'Permanently remove members and block them from rejoining.'],
  ['MANAGE_MESSAGES', 'Manage Messages', "Delete and pin other members' messages."],
  ['MANAGE_NICKNAMES', 'Manage Nicknames', "Change other members' nicknames."],
  ['CREATE_INVITE', 'Create Invite', 'Invite new people to this orbit.'],
  ['SEND_MESSAGES', 'Send Messages', 'Send messages in rooms.'],
  ['ATTACH_FILES', 'Attach Files', 'Upload photos, videos and files.'],
  ['CONNECT', 'Join Lounges', 'Join voice and video lounges.'],
];
const can = (sd, flag) => sd && (sd.myPermissions & flag) === flag;

// ------------------------------------------------------------------ state
const S = {
  me: null, config: {}, servers: [], dms: [], friends: [], stories: [],
  serverData: {},     // serverId -> detail
  messages: {},       // channelId -> { list, hasMore, loading }
  typing: {},         // channelId -> Map(userId -> timeout)
  voice: {},          // channelId -> participants[]
  presence: {},       // userId -> bool
  userCache: {},      // userId -> public user
  view: { type: 'home' },
  homeTab: 'online',
  showMembers: localStorage.getItem('lumi.members') ? localStorage.getItem('lumi.members') !== '0' : innerWidth > 1000,
  panel: null,
  replyTo: null, pending: null,
  lastChannel: JSON.parse(localStorage.getItem('lumi.lastChannel') || '{}'),
  settings: Object.assign({ sounds: true, notifications: false, theme: 'system' }, JSON.parse(localStorage.getItem('lumi.settings') || '{}')),
};
function saveSettings() { localStorage.setItem('lumi.settings', JSON.stringify(S.settings)); }
function isOnline(uid) { if (S.me && uid === S.me.id) return true; return !!S.presence[uid]; }
function cacheUser(u) { if (!u) return u; S.userCache[u.id] = { ...(S.userCache[u.id] || {}), ...u }; if (u.online !== undefined) S.presence[u.id] = u.online; return u; }
function applyTheme() {
  const t = S.settings.theme;
  document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  localStorage.setItem('lumi.theme', t);
  $('meta[name=theme-color]').content = document.documentElement.dataset.theme === 'dark' ? '#000000' : '#ffffff';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ------------------------------------------------------------------ toasts / layers / menus
function toast(msg, err = false) {
  const t = h(`<div class="toast ${err ? 'err' : ''}">${esc(msg)}</div>`);
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3600);
}
const layers = [];
function openModal({ title = '', body = '', foot = '', cls = '', onMount, onClose, back }) {
  const ov = h(`<div class="overlay"><div class="modal ${cls}" role="dialog">
    ${title !== null ? `<div class="modal-head">${back ? `<button class="icon-btn back" data-back>${icon('back')}</button>` : ''}<span>${esc(title)}</span><button class="icon-btn" data-close>${icon('x')}</button></div>` : ''}
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`);
  const m = { el: ov.firstElementChild, ov, close() { ov.remove(); const i = layers.indexOf(m); if (i >= 0) layers.splice(i, 1); onClose?.(); } };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) m.close(); });
  ov.querySelector('[data-close]')?.addEventListener('click', () => m.close());
  if (back) ov.querySelector('[data-back]').addEventListener('click', back);
  $('#layers').appendChild(ov); layers.push(m);
  onMount?.(m.el, m);
  setTimeout(() => m.el.querySelector('[autofocus]')?.focus(), 30);
  return m;
}
function confirmDialog(title, text, okLabel = 'Confirm', danger = true) {
  return new Promise((res) => {
    let done = false;
    const m = openModal({ title, body: `<p style="margin:0;line-height:1.5">${text}</p>`,
      foot: `<button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>`,
      onClose: () => { if (!done) res(false); } });
    m.el.querySelector('[data-no]').onclick = () => m.close();
    m.el.querySelector('[data-ok]').onclick = () => { done = true; m.close(); res(true); };
  });
}
function promptDialog(title, label, value = '', okLabel = 'Save') {
  return new Promise((res) => {
    let done = false;
    const m = openModal({ title, body: `<div class="field"><label>${esc(label)}</label><input class="input" autofocus value="${esc(value)}"></div>`,
      foot: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button>`,
      onClose: () => { if (!done) res(null); } });
    const inp = m.el.querySelector('input');
    const ok = () => { done = true; m.close(); res(inp.value); };
    m.el.querySelector('[data-no]').onclick = () => m.close();
    m.el.querySelector('[data-ok]').onclick = ok;
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  });
}
let openMenuEl = null;
function closeMenu() { openMenuEl?.remove(); openMenuEl?._onClose?.(); openMenuEl = null; }
function openMenu(anchor, items, opts = {}) {
  closeMenu();
  const m = h(`<div class="menu"></div>`);
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { m.appendChild(h('<hr>')); continue; }
    if (it.html) { const el = h(it.html); m.appendChild(el); it.mount?.(el); continue; }
    const b = h(`<button class="${it.danger ? 'dz' : ''}"><span>${esc(it.label)}</span>${it.icon ? icon(it.icon, 'sm') : ''}</button>`);
    b.onclick = (e) => { e.stopPropagation(); closeMenu(); it.onClick?.(); };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = opts.align === 'right' ? r.right - mw : r.left; let y = r.bottom + 6;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  x = Math.max(8, Math.min(x, innerWidth - mw - 8));
  m.style.left = x + 'px'; m.style.top = y + 'px';
  m._onClose = opts.onClose; openMenuEl = m;
  return m;
}
document.addEventListener('mousedown', (e) => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (openMenuEl) return closeMenu();
  if ($('.lightbox')) return $('.lightbox').remove();
  if ($('.sv')) return closeStoryViewer?.();
  if (layers.length) return layers[layers.length - 1].close();
  if (S.replyTo || S.editing) { S.replyTo = null; renderComposerExtras?.(); }
});
// tooltips
let tipEl = null;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  tipEl?.remove(); tipEl = null;
  if (!t) return;
  tipEl = h(`<div class="tip">${esc(t.dataset.tip)}</div>`); document.body.appendChild(tipEl);
  const r = t.getBoundingClientRect();
  if (t.closest('.rail')) { tipEl.style.left = r.right + 12 + 'px'; tipEl.style.top = r.top + r.height / 2 - tipEl.offsetHeight / 2 + 'px'; }
  else { tipEl.style.left = Math.max(8, r.left + r.width / 2 - tipEl.offsetWidth / 2) + 'px'; tipEl.style.top = r.top - tipEl.offsetHeight - 8 + 'px'; }
});
function lightbox(src) { const l = h(`<div class="lightbox"><img src="${esc(src)}"></div>`); l.onclick = () => l.remove(); document.body.appendChild(l); }
async function copyText(t, msg = 'Copied') { try { await navigator.clipboard.writeText(t); toast(msg); } catch { prompt('Copy this:', t); } }

// ------------------------------------------------------------------ sounds (WebAudio, no assets)
let actx = null;
function ac() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; }
function tone(freq, start, dur, vol = 0.08, type = 'sine') {
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq; o.connect(g); g.connect(c.destination);
  const t = c.currentTime + start; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
function playSound(kind) {
  if (!S.settings.sounds) return;
  try {
    if (kind === 'message') { tone(880, 0, .12); tone(1320, .08, .18); }
    if (kind === 'join') { tone(523, 0, .12); tone(784, .1, .16); }
    if (kind === 'leave') { tone(784, 0, .12); tone(523, .1, .16); }
    if (kind === 'ring') { for (let i = 0; i < 2; i++) { tone(660, i * .4, .3, .1, 'triangle'); tone(880, i * .4 + .15, .3, .08, 'triangle'); } }
  } catch {}
}
function notify(title, body, onClick) {
  if (!S.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  const n = new Notification(title, { body, icon: '/favicon.ico', silent: true });
  n.onclick = () => { window.focus(); onClick?.(); n.close(); };
}

// ------------------------------------------------------------------ markdown-lite
function md(text) {
  const codes = [];
  let s = esc(text);
  s = s.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_, c) => { codes.push(`<pre><code>${c.replace(/^\n/, '')}</code></pre>`); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(`<code>${c}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
       .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<i>$2</i>').replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
       .replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" onclick="this.classList.add(\'shown\')">$1</span>');
  s = s.replace(/(^|\s)@(everyone|here|[a-z0-9_.]{2,24})\b/gi, (m, pre, name) => `${pre}<span class="mention">@${name}</span>`);
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
  return s;
}
function isJumbo(text) {
  const t = (text || '').trim(); if (!t || t.length > 24) return false;
  return /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u.test(t);
}
const QUICK = ['✨', '❤️', '😂', '😮', '😢', '😡', '👍', '🔥', '🎉'];
const EMOJIS = ['😀','😁','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳','😏','🙃','😉','🤔','🫠','😴','😭','😱','😤','😡','🤯','🥺','😬','🙌','👏','👍','👎','🙏','💪','👀','🫶','❤️','🧡','💛','💚','💙','💜','🖤','💔','✨','🔥','💯','🎉','🎊','🎁','🌈','☀️','🌙','⭐','🍕','🍔','🍿','☕','🍻','🎮','🎧','🎵','📸','💻','🚀','⚡','✅','❌'];
function emojiPicker(anchor, onPick, opts) {
  openMenu(anchor, [{ html: `<div class="emoji-pick">${EMOJIS.map((e) => `<button>${e}</button>`).join('')}</div>`,
    mount: (el) => el.querySelectorAll('button').forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); onPick(b.textContent); if (!opts?.keepOpen) closeMenu(); })) }], opts);
}

// ------------------------------------------------------------------ router
function parseRoute(p = location.pathname) {
  let m;
  if ((m = p.match(/^\/invite\/([\w-]+)/))) return { type: 'invite', code: m[1] };
  if ((m = p.match(/^\/channels\/@me\/([\w-]+)/))) return { type: 'dm', dmId: m[1] };
  if ((m = p.match(/^\/channels\/([\w-]+)(?:\/([\w-]+))?/)) && m[1] !== '@me') return { type: 'server', serverId: m[1], channelId: m[2] || null };
  if (p.startsWith('/messages')) return { type: 'messages' };
  if (p.startsWith('/friends')) return { type: 'home' };
  if (p.startsWith('/activity')) return { type: 'activity' };
  if (p.startsWith('/orbits') || p.startsWith('/communities')) return { type: 'orbits' };
  return { type: 'feed' };
}
function navigate(path, replace = false) {
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  route();
}
window.addEventListener('popstate', () => route());
