/* calls: WebRTC mesh for DMs, group DMs and voice channels */
'use strict';

const Call = { active: null, tiles: new Map(), ring: null, meters: new Map(), meterTimer: null, timer: null };
function rtcConfig() { return { iceServers: S.config.iceServers || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] }; }
function audioConstraints() {
  const ns = S.settings.noiseSuppression !== false;
  return { echoCancellation: true, noiseSuppression: ns, autoGainControl: true, ...(S.settings.micId ? { deviceId: { ideal: S.settings.micId } } : {}) };
}
function videoConstraints() { return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...(S.settings.camId ? { deviceId: { ideal: S.settings.camId } } : {}) }; }
const currentVideoTrack = () => { const c = Call.active; return !c ? null : c.screen ? c.screenTrack : c.video ? c.camTrack : null; };

async function joinCall(channelId, { video = false } = {}) {
  if (Call.active?.channelId === channelId) { if (video && !Call.active.video) toggleVideo(); return; }
  if (!window.RTCPeerConnection || !navigator.mediaDevices) return toast('Calls need a modern browser over HTTPS (or localhost).', true);
  if (Call.active) leaveCall(true);
  stopRinging();
  let local;
  try { local = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: video ? videoConstraints() : false }); }
  catch {
    try { local = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() }); if (video) toast('Camera unavailable — joined with audio only'); }
    catch { local = new MediaStream(); toast('Microphone unavailable — you joined muted. Check browser permissions.', true); }
  }
  const c = Call.active = {
    channelId, local, audioTrack: local.getAudioTracks()[0] || null, camTrack: local.getVideoTracks()[0] || null, screenTrack: null,
    peers: new Map(), muted: !local.getAudioTracks().length || !!S.selfMute, deafened: !!S.selfDeaf, video: !!local.getVideoTracks().length, screen: false, startedAt: Date.now(),
  };
  if (c.audioTrack) c.audioTrack.enabled = !c.muted;
  socket.emit('voice:join', { channelId }, (res) => {
    if (!res || res.error) { toast(res?.error || 'Could not join', true); cleanupCall(); return renderCallUI(); }
    socket.emit('voice:update', { muted: c.muted, deafened: c.deafened, video: c.video, screen: false });
    for (const p of res.peers) createPeer(p.socketId, p.userId, true);
    playSound('join');
    renderCallUI();
    // 1:1 DM: give up if no one answers
    const dm = S.dms.find((d) => d.id === channelId);
    if (dm) setTimeout(() => { if (Call.active === c && (S.voice[channelId] || []).length <= 1) { toast('No answer'); leaveCall(); } }, 45000);
  });
  meterAdd('self', local, S.me.id);
  clearInterval(Call.timer);
  Call.timer = setInterval(() => { const el = $('#call-timer'); if (el && Call.active) { const s = Math.floor((Date.now() - Call.active.startedAt) / 1000); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; } }, 1000);
  renderCallUI();
}
function cleanupCall() {
  const c = Call.active; if (!c) return;
  for (const p of c.peers.values()) { try { p.pc.close(); } catch {} p.audioEl?.remove(); meterRemove(p.sid); }
  c.local.getTracks().forEach((t) => t.stop()); c.camTrack?.stop(); c.screenTrack?.stop();
  meterRemove('self');
  Call.tiles.forEach((t) => t.remove()); Call.tiles.clear();
  clearInterval(Call.timer);
  Call.active = null;
}
function leaveCall(silent) {
  if (!Call.active) return;
  socket.emit('voice:leave');
  cleanupCall();
  if (!silent) playSound('leave');
  renderCallUI();
}
function signal(to, data) { socket.emit('rtc:signal', { to, data }); }
function createPeer(sid, userId, initiator) {
  const c = Call.active; if (!c) return null;
  const pc = new RTCPeerConnection(rtcConfig());
  const peer = { sid, userId, pc, stream: new MediaStream(), polite: socket.id > sid, makingOffer: false, ignoreOffer: false, ready: false, queue: Promise.resolve(), audioEl: null };
  c.peers.set(sid, peer);
  pc.onicecandidate = (e) => { if (e.candidate) signal(sid, { candidate: e.candidate }); };
  pc.ontrack = (e) => {
    peer.stream.addTrack(e.track);
    if (e.track.kind === 'audio') {
      if (!peer.audioEl) { peer.audioEl = h('<audio autoplay playsinline></audio>'); $('#audio-sink').appendChild(peer.audioEl); }
      peer.audioEl.srcObject = new MediaStream(peer.stream.getAudioTracks());
      peer.audioEl.muted = c.deafened; peer.audioEl.play().catch(() => {});
      meterAdd(sid, peer.audioEl.srcObject, userId);
    }
    e.track.onunmute = () => renderCallUI();
    renderCallUI();
  };
  pc.onnegotiationneeded = async () => {
    try { peer.makingOffer = true; await pc.setLocalDescription(); signal(sid, { description: pc.localDescription }); }
    catch (err) { console.warn('negotiation', err); } finally { peer.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce?.(); renderCallUI(); };
  if (initiator) {
    pc.addTransceiver(c.audioTrack || 'audio', { direction: 'sendrecv' });
    pc.addTransceiver(currentVideoTrack() || 'video', { direction: 'sendrecv' });
    peer.ready = true;
  }
  return peer;
}
function onSignal({ from, userId, data }) {
  const c = Call.active; if (!c) return;
  const peer = c.peers.get(from) || createPeer(from, userId, false);
  peer.queue = peer.queue.then(async () => {
    const pc = peer.pc;
    try {
      if (data.description) {
        const collision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          if (!peer.ready) {
            for (const t of pc.getTransceivers()) {
              const kind = t.receiver.track.kind; t.direction = 'sendrecv';
              await t.sender.replaceTrack(kind === 'audio' ? c.audioTrack : currentVideoTrack());
            }
            peer.ready = true;
          }
          await pc.setLocalDescription();
          signal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) console.warn(e); }
      }
    } catch (e) { console.warn('signal error', e); }
  });
}
function onPeerLeft({ socketId }) {
  const c = Call.active; const p = c?.peers.get(socketId); if (!p) return;
  try { p.pc.close(); } catch {} p.audioEl?.remove(); meterRemove(socketId);
  c.peers.delete(socketId); Call.tiles.get(socketId)?.remove(); Call.tiles.delete(socketId);
  renderCallUI();
}
async function replaceSenders(kind, track) {
  for (const p of Call.active.peers.values()) {
    const t = p.pc.getTransceivers().find((t) => t.receiver.track.kind === kind);
    if (t) try { await t.sender.replaceTrack(track); } catch (e) { console.warn(e); }
  }
}
async function toggleMute() {
  const c = Call.active;
  if (!c) { S.selfMute = !S.selfMute; if (!S.selfMute) S.selfDeaf = false; return renderSideFoot(); }
  if (c.deafened && c.muted) { c.deafened = false; applyDeafen(); }
  if (!c.audioTrack) {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() }); c.audioTrack = s.getAudioTracks()[0]; c.local.addTrack(c.audioTrack); await replaceSenders('audio', c.audioTrack); meterAdd('self', c.local, S.me.id); }
    catch { return toast('Microphone access is blocked. Allow it in your browser settings.', true); }
  }
  c.muted = !c.muted; c.audioTrack.enabled = !c.muted; S.selfMute = c.muted;
  playSound(c.muted ? 'leave' : 'join');
  socket.emit('voice:update', { muted: c.muted, deafened: c.deafened }); renderCallUI();
}
function applyDeafen() { for (const p of Call.active.peers.values()) if (p.audioEl) p.audioEl.muted = Call.active.deafened; }
function toggleDeafen() {
  const c = Call.active;
  if (!c) { S.selfDeaf = !S.selfDeaf; if (S.selfDeaf) S.selfMute = true; return renderSideFoot(); }
  c.deafened = !c.deafened; S.selfDeaf = c.deafened;
  if (c.deafened && !c.muted) { c.muted = true; c._mutedByDeafen = true; }
  else if (!c.deafened && c._mutedByDeafen) { c.muted = false; c._mutedByDeafen = false; }
  if (c.audioTrack) c.audioTrack.enabled = !c.muted;
  applyDeafen();
  socket.emit('voice:update', { muted: c.muted, deafened: c.deafened }); renderCallUI();
}
async function toggleVideo() {
  const c = Call.active; if (!c) return;
  if (c.video) { c.camTrack?.stop(); c.camTrack = null; c.video = false; }
  else {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() }); c.camTrack = s.getVideoTracks()[0]; c.video = true; }
    catch { return toast('Camera unavailable. Check browser permissions.', true); }
  }
  await replaceSenders('video', currentVideoTrack());
  socket.emit('voice:update', { video: c.video }); renderCallUI();
}
async function toggleScreen() {
  const c = Call.active; if (!c) return;
  if (c.screen) return stopScreen();
  if (!navigator.mediaDevices.getDisplayMedia) return toast('Screen sharing is not supported on this device.', true);
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
    c.screenTrack = s.getVideoTracks()[0]; c.screen = true;
    c.screenTrack.onended = stopScreen;
    await replaceSenders('video', c.screenTrack);
    socket.emit('voice:update', { screen: true }); renderCallUI();
  } catch {}
}
async function stopScreen() {
  const c = Call.active; if (!c || !c.screen) return;
  c.screenTrack?.stop(); c.screenTrack = null; c.screen = false;
  await replaceSenders('video', currentVideoTrack());
  socket.emit('voice:update', { screen: false }); renderCallUI();
}

// ------------------------------------------------------------------ speaking detection (local, for every stream)
function meterAdd(key, stream, userId) {
  meterRemove(key);
  if (!stream.getAudioTracks().length) return;
  try {
    const src = ac().createMediaStreamSource(stream); const an = ac().createAnalyser(); an.fftSize = 512; src.connect(an);
    Call.meters.set(key, { an, userId, buf: new Uint8Array(an.fftSize), speaking: false, src });
  } catch {}
  if (!Call.meterTimer) Call.meterTimer = setInterval(meterTick, 120);
}
function meterRemove(key) { const m = Call.meters.get(key); if (m) { try { m.src.disconnect(); } catch {} Call.meters.delete(key); setSpeaking(m.userId, false, key); } if (!Call.meters.size) { clearInterval(Call.meterTimer); Call.meterTimer = null; } }
function meterTick() {
  for (const [key, m] of Call.meters) {
    m.an.getByteTimeDomainData(m.buf); let s = 0; for (const v of m.buf) s += (v - 128) ** 2;
    const rms = Math.sqrt(s / m.buf.length);
    const muted = key === 'self' ? Call.active?.muted : (S.voice[Call.active?.channelId] || []).find((p) => p.socketId === key)?.muted;
    const speaking = !muted && rms > 4;
    if (speaking !== m.speaking) { m.speaking = speaking; setSpeaking(m.userId, speaking, key); }
  }
}
function setSpeaking(uid, on, key) {
  $$(`[data-speak-ring="${uid}"]`).forEach((el) => { el.classList.toggle('speaking', on); el.classList.toggle('seen', !on); });
  Call.tiles.get(key === 'self' ? socket.id : key)?.classList.toggle('speaking', on);
}

// ------------------------------------------------------------------ UI
function renderCallUI() {
  renderSideFoot();
  if (S.view.type === 'server') renderSideBody(); else renderSideBody();
  renderRail();
  updateStage();
}
function updateStage() {
  const slot = $('#stage-slot'); if (!slot) return;
  const cid = S.view.channelId; const parts = S.voice[cid] || [];
  const inCall = Call.active?.channelId === cid;
  const dm = S.view.type === 'dm' ? S.dms.find((d) => d.id === cid) : null;
  const sd = currentServer(); const ch = sd?.channels.find((c) => c.id === cid);
  const isVoiceChan = ch?.type === 'voice';
  if (!inCall) {
    Call.tiles.forEach((t) => t.remove());
    if (isVoiceChan) {
      slot.innerHTML = `<div class="join-voice"><div style="display:flex">${parts.slice(0, 6).map((p, i) => `<div style="margin-left:${i ? -14 : 0}px">${avatar(p.user, 64, { ring: true })}</div>`).join('') || `<div class="hash" style="width:96px;height:96px;border-radius:50%;background:var(--ig);color:#fff;display:grid;place-items:center">${icon('waves').replace('class="i "', 'class="i" style="width:44px;height:44px"')}</div>`}</div>
        <h2>${esc(ch.name)}</h2><div class="muted">${parts.length ? `${parts.map((p) => esc(memberInfo(sd, p.userId).name)).slice(0, 3).join(', ')}${parts.length > 3 ? ` and ${parts.length - 3} more` : ''} ${parts.length === 1 ? 'is' : 'are'} hanging out` : 'It’s quiet in here. Pull up a seat!'}</div>
        <div style="display:flex;gap:10px;margin-top:6px">${can(sd, P.CONNECT) ? `<button class="btn grad lg" data-act="join-voice">${icon('waves', 'sm')} Join lounge</button><button class="btn lg" data-act="join-video">${icon('video', 'sm')} Join with video</button>` : '<div class="muted">You can’t join this lounge.</div>'}</div></div>`;
    } else if (dm && parts.length) {
      slot.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--ig-soft);border-bottom:1px solid var(--border2)">
        <div style="display:flex">${parts.map((p, i) => `<div style="margin-left:${i ? -8 : 0}px">${avatar(p.user, 30)}</div>`).join('')}</div>
        <div style="flex:1"><b>Call in progress</b><div class="small muted">${parts.map((p) => esc(p.user.displayName)).join(', ')}</div></div>
        <button class="btn" data-act="join-voice" style="background:var(--green);color:#fff">${icon('phone', 'sm')} Join</button><button class="btn" data-act="join-video">${icon('video', 'sm')}</button></div>`;
    } else slot.innerHTML = '';
    return;
  }
  let stage = slot.querySelector('.stage');
  if (!stage || stage.dataset.cid !== cid) {
    const title = dm ? dmName(dm) : ch?.name;
    slot.innerHTML = `<div class="stage ${isVoiceChan ? 'full' : 'dm'}" data-cid="${cid}"><div class="stage-top"><span>${esc(title || '')}</span><span id="call-timer" class="small" style="opacity:.75">0:00</span></div>
      <div class="grid" id="call-grid"></div><div class="controls" id="call-controls"></div></div>`;
    stage = slot.querySelector('.stage');
    stage.querySelector('#call-controls').addEventListener('click', onCallControl);
    stage.querySelector('#call-grid').addEventListener('dblclick', (e) => { const t = e.target.closest('.tile'); if (!t) return; const on = !t.classList.contains('focus'); $$('.tile.focus').forEach((x) => x.classList.remove('focus')); t.classList.toggle('focus', on); });
  }
  const c = Call.active;
  stage.querySelector('#call-controls').innerHTML = `
    <button class="ctrl ${c.muted ? 'off' : ''}" data-c="mute" data-tip="${c.muted ? 'Unmute' : 'Mute'}">${icon(c.muted ? 'micOff' : 'mic')}</button>
    <button class="ctrl ${c.video ? 'on' : ''}" data-c="video" data-tip="${c.video ? 'Turn off camera' : 'Turn on camera'}">${icon(c.video ? 'video' : 'videoOff')}</button>
    <button class="ctrl ${c.screen ? 'on' : ''}" data-c="screen" data-tip="${c.screen ? 'Stop sharing' : 'Share your screen'}">${icon('screen')}</button>
    <button class="ctrl ${c.deafened ? 'off' : ''}" data-c="deafen" data-tip="${c.deafened ? 'Undeafen' : 'Deafen'}">${icon(c.deafened ? 'headphonesOff' : 'headphones')}</button>
    <button class="ctrl leave" data-c="leave" data-tip="Leave call">${icon('hangup')}</button>`;
  const grid = stage.querySelector('#call-grid');
  const others = parts.filter((p) => p.socketId !== socket.id);
  if (dm && dm.type === 'dm' && !others.length) {
    Call.tiles.forEach((t) => t.remove());
    const u = S.userCache[dm.recipients[0]?.id] || dm.recipients[0];
    grid.className = 'grid one';
    grid.innerHTML = `<div class="calling">${avatar(u, 110, { ring: true })}<div style="font-size:20px;font-weight:700">${esc(u?.displayName || '')}</div><div style="opacity:.7">Calling…</div></div>`;
    return;
  }
  grid.querySelector('.calling')?.remove();
  const list = parts.length ? parts : [{ socketId: socket.id, userId: S.me.id, user: S.me, muted: c.muted, video: c.video, screen: c.screen }];
  const keys = new Set(list.map((p) => p.socketId));
  for (const [k, el] of Call.tiles) if (!keys.has(k)) { el.remove(); Call.tiles.delete(k); }
  grid.className = 'grid' + (list.length === 1 ? ' one' : '');
  for (const p of list) {
    const self = p.socketId === socket.id;
    let tile = Call.tiles.get(p.socketId);
    const u = S.userCache[p.userId] || p.user;
    if (!tile) {
      tile = h(`<div class="tile ${self ? 'self' : ''}"><div class="bgblur"></div><div class="tile-av"></div><video autoplay playsinline muted></video><div class="lbl"></div></div>`);
      Call.tiles.set(p.socketId, tile);
    }
    const st = self ? { muted: c.muted, deafened: c.deafened, video: c.video, screen: c.screen } : p;
    const showVideo = !!(st.video || st.screen);
    tile.classList.toggle('has-video', showVideo); tile.classList.toggle('screen', !!st.screen);
    tile.querySelector('.bgblur').style.backgroundImage = u?.avatar ? `url('${u.avatar}')` : `linear-gradient(135deg, ${colorFor(p.userId)}, #222)`;
    const avHtml = avatar(u, 84, { ring: 'seen', speak: true });
    if (tile.querySelector('.tile-av').dataset.uid !== p.userId) { tile.querySelector('.tile-av').innerHTML = avHtml; tile.querySelector('.tile-av').dataset.uid = p.userId; }
    const v = tile.querySelector('video');
    let src = null;
    if (showVideo) {
      if (self) { const vt = currentVideoTrack(); if (vt) { if (!v._track || v._track !== vt) { v._track = vt; v.srcObject = new MediaStream([vt]); } src = v.srcObject; } }
      else { const peer = c.peers.get(p.socketId); if (peer && v.srcObject !== peer.stream) v.srcObject = peer.stream; src = v.srcObject; }
    }
    if (!src && v.srcObject) { v.srcObject = null; v._track = null; }
    v.play?.().catch(() => {});
    const peer = c.peers.get(p.socketId);
    const conn = !self && peer && !['connected', 'completed'].includes(peer.pc.connectionState) ? ` <span style="opacity:.6;font-weight:400">connecting…</span>` : '';
    tile.querySelector('.lbl').innerHTML = `${st.muted ? `<span class="mic-off">${icon('micOff', 'xs')}</span>` : ''}${st.deafened ? icon('headphonesOff', 'xs') : ''}${esc(self ? 'You' : memberInfo(sd, p.userId).name)}${st.screen ? ' <span class="live" style="background:var(--red);padding:0 5px;border-radius:4px;font-size:10px">LIVE</span>' : ''}${conn}`;
    if (tile.parentNode !== grid) grid.appendChild(tile);
  }
  // keep self last
  const selfTile = Call.tiles.get(socket.id); if (selfTile && list.length > 1) grid.appendChild(selfTile);
}
function onCallControl(e) {
  const b = e.target.closest('[data-c]'); if (!b) return;
  ({ mute: toggleMute, video: toggleVideo, screen: toggleScreen, deafen: toggleDeafen, leave: () => leaveCall() })[b.dataset.c]();
}

// ------------------------------------------------------------------ ringing
function onRing({ channelId, caller, type }) {
  if (Call.active?.channelId === channelId) return;
  stopRinging();
  cacheUser(caller);
  const dm = S.dms.find((d) => d.id === channelId);
  const el = h(`<div class="incoming">${avatar(caller, 88, { ring: true })}<div class="n">${esc(dm && dm.type === 'group' ? dmName(dm) : caller.displayName)}</div>
    <div class="s">${type === 'group' ? `${esc(caller.displayName)} started a group call` : 'Incoming call…'}</div>
    <div class="btns"><button class="decline" data-tip="Decline">${icon('hangup')}</button><button class="accept" data-tip="Accept">${icon('phone')}</button><button class="accept" data-v data-tip="Accept with video">${icon('video')}</button></div></div>`);
  document.body.appendChild(el);
  const ringLoop = setInterval(() => playSound('ring'), 2200); playSound('ring');
  const timeout = setTimeout(stopRinging, 35000);
  Call.ring = { channelId, el, stop: () => { clearInterval(ringLoop); clearTimeout(timeout); el.remove(); } };
  el.querySelector('.decline').onclick = () => { socket.emit('call:decline', { channelId }); stopRinging(); };
  el.querySelectorAll('.accept').forEach((b) => (b.onclick = async () => {
    stopRinging();
    if (!S.dms.find((d) => d.id === channelId)) await refreshDMs();
    navigate('/channels/@me/' + channelId); joinCall(channelId, { video: b.hasAttribute('data-v') });
  }));
  notify(`${caller.displayName} is calling`, 'Tap to answer', () => navigate('/channels/@me/' + channelId));
}
function stopRinging(cid) { if (!Call.ring || (cid && Call.ring.channelId !== cid)) return; Call.ring.stop(); Call.ring = null; }
