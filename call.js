/* calls: WebRTC mesh for DMs, group DMs and voice channels */
'use strict';

const Call = { active: null, tiles: new Map(), ring: null, meters: new Map(), meterTimer: null, timer: null };
function rtcConfig() { return { iceServers: S.config.iceServers || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] }; }
function audioConstraints() {
  const ns = S.settings.noiseSuppression !== false;
  return { echoCancellation: S.settings.echoCancel !== false, noiseSuppression: ns, autoGainControl: S.settings.autoGain !== false, ...(S.settings.micId ? { deviceId: { ideal: S.settings.micId } } : {}) };
}
function videoConstraints() { return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...(S.settings.camId ? { deviceId: { ideal: S.settings.camId } } : {}) }; }
const currentVideoTrack = () => { const c = Call.active; return !c ? null : c.screen ? c.screenTrack : c.video ? c.camTrack : null; };

async function joinCall(channelId, { video = false } = {}) {
  if (Call.active?.channelId === channelId) { if (video && !Call.active.video) toggleVideo(); return; }
  if (!window.RTCPeerConnection || !navigator.mediaDevices) return toast('Calls need a modern browser over HTTPS (or localhost).', true);
  if (Call.active) leaveCall(true);
  stopRinging();
  try { S.config = await api('GET', '/api/config'); } catch {}
  let local;
  try { local = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: video ? videoConstraints() : false }); }
  catch {
    try { local = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() }); if (video) toast('Camera unavailable — joined with audio only'); }
    catch { local = new MediaStream(); toast('Microphone unavailable — you joined muted. Check browser permissions.', true); }
  }
  const c = Call.active = {
    channelId, local, audioTrack: local.getAudioTracks()[0] || null, camTrack: local.getVideoTracks()[0] || null, screenTrack: null,
    peers: new Map(), muted: !local.getAudioTracks().length || !!S.selfMute || !!S.settings.joinMuted, deafened: !!S.selfDeaf, video: !!local.getVideoTracks().length, screen: false, startedAt: Date.now(),
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
function callConnectionLost() {
  const c = Call.active; if (!c || c.reconnecting) return;
  c.reconnecting = true; renderCallUI();
  toast('Connection hiccup, reconnecting your call…');
  clearTimeout(c.giveUpT);
  c.giveUpT = setTimeout(() => { if (Call.active === c && c.reconnecting) { cleanupCall(); renderCallUI(); toast('Connection lost. You left the call.', true); } }, 30000);
}
function rejoinCall() {
  const c = Call.active; if (!c) return;
  // our old socket is gone, so every peer connection tied to it is dead: rebuild them on the new socket
  for (const [sid, p] of c.peers) { try { p.pc.close(); } catch {} dropAudio(p); meterRemove(sid); Call.tiles.get(sid)?.remove(); Call.tiles.delete(sid); }
  c.peers.clear();
  Call.tiles.forEach((t) => t.remove()); Call.tiles.clear(); Call.focusSid = null;
  socket.emit('voice:join', { channelId: c.channelId, rejoin: true }, (res) => {
    if (Call.active !== c) return;
    if (!res || res.error) { clearTimeout(c.giveUpT); cleanupCall(); renderCallUI(); return toast(res?.error || 'Could not rejoin the call', true); }
    c.reconnecting = false; clearTimeout(c.giveUpT);
    socket.emit('voice:update', { muted: c.muted, deafened: c.deafened, video: c.video, screen: c.screen });
    for (const p of res.peers) createPeer(p.socketId, p.userId, true);
    toast('Reconnected');
    renderCallUI();
  });
}
function cleanupCall() {
  const c = Call.active; if (!c) return;
  clearTimeout(c.giveUpT);
  for (const p of c.peers.values()) { try { p.pc.close(); } catch {} dropAudio(p); meterRemove(p.sid); }
  c.local.getTracks().forEach((t) => t.stop()); c.camTrack?.stop(); c.screenTrack?.stop(); c.screenAudio?.stop();
  meterRemove('self');
  Call.tiles.forEach((t) => t.remove()); Call.tiles.clear(); Call.focusSid = null;
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
  const peer = { sid, userId, pc, stream: new MediaStream(), polite: socket.id > sid, makingOffer: false, ignoreOffer: false, ready: false, queue: Promise.resolve() };
  c.peers.set(sid, peer);
  pc.onicecandidate = (e) => { if (e.candidate) signal(sid, { candidate: e.candidate }); };
  pc.ontrack = (e) => {
    peer.stream.addTrack(e.track);
    if (e.track.kind === 'audio') {
      // the first audio slot is their mic, the second is the sound from their screen share
      const slot = pc.getTransceivers().filter((t) => t.receiver.track.kind === 'audio').indexOf(e.transceiver) === 1 ? 'screen' : 'mic';
      const o = playTrack(peer, e.track, slot);
      if (slot === 'mic') meterAdd(sid, o.el.srcObject, userId);
    }
    e.track.onunmute = () => renderCallUI();
    renderCallUI();
  };
  pc.onnegotiationneeded = async () => {
    try { peer.makingOffer = true; await pc.setLocalDescription(); signal(sid, { description: pc.localDescription }); }
    catch (err) { console.warn('negotiation', err); } finally { peer.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      if (!peer.restarted) { peer.restarted = true; pc.restartIce?.(); }
      else if (!Call.warnedRelay) {
        Call.warnedRelay = true;
        toast(S.config.iceServers?.some((s) => String(s.urls).includes('turn')) ? 'Couldn’t connect the call. Check your internet and try again.' : 'Couldn’t connect the call: your networks are blocking a direct connection. The site owner needs to add a TURN relay (see README).', true);
      }
    }
    renderCallUI();
  };
  if (initiator) {
    pc.addTransceiver(c.audioTrack || 'audio', { direction: 'sendrecv' });
    pc.addTransceiver(currentVideoTrack() || 'video', { direction: 'sendrecv' });
    pc.addTransceiver(c.screenAudio || 'audio', { direction: 'sendrecv' });
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
            let audios = 0;
            for (const t of pc.getTransceivers()) {
              const kind = t.receiver.track.kind; t.direction = 'sendrecv';
              await t.sender.replaceTrack(kind === 'audio' ? (audios++ === 0 ? c.audioTrack : c.screenAudio || null) : currentVideoTrack());
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
  try { p.pc.close(); } catch {} dropAudio(p); meterRemove(socketId);
  c.peers.delete(socketId); Call.tiles.get(socketId)?.remove(); Call.tiles.delete(socketId);
  renderCallUI();
}
async function replaceScreenAudio(track) {
  for (const p of Call.active.peers.values()) {
    const t = p.pc.getTransceivers().filter((t) => t.receiver.track.kind === 'audio')[1];
    if (t) try { await t.sender.replaceTrack(track); } catch (e) { console.warn(e); }
  }
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
function applyDeafen() { applyVolumes(); }
// ---- per-person volume and mute, kept on this device
let VolPrefs = {}; try { VolPrefs = JSON.parse(localStorage.getItem('lumi.vol') || '{}'); } catch {}
const volOf = (uid) => VolPrefs[uid] || {};
function setVol(uid, patch) {
  VolPrefs[uid] = { ...volOf(uid), ...patch };
  try { localStorage.setItem('lumi.vol', JSON.stringify(VolPrefs)); } catch {}
  applyVolumes();
  if ('m' in patch) { renderCallUI(); if (S.view.type === 'server') renderSideBody(); }
}
let audioCtx = null;
function getAudioCtx() {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); } catch { audioCtx = null; }
  return audioCtx;
}
// play someone's audio through a volume knob that can go up to 200%
function playTrack(peer, track, slot) {
  const k = slot + 'Out'; let o = peer[k];
  if (!o) { o = peer[k] = { el: h('<audio autoplay playsinline></audio>') }; $('#audio-sink').appendChild(o.el); }
  o.el.srcObject = new MediaStream([track]);
  const ctx = getAudioCtx();
  if (ctx) {
    try { o.src?.disconnect(); o.gain ||= ctx.createGain(); o.gain.connect(ctx.destination); o.src = ctx.createMediaStreamSource(o.el.srcObject); o.src.connect(o.gain); o.web = true; } catch { o.web = false; }
  }
  o.el.play().catch(() => {});
  applyVolumes();
  return o;
}
function dropAudio(p) { for (const k of ['micOut', 'screenOut']) { const o = p[k]; if (!o) continue; try { o.src?.disconnect(); o.gain?.disconnect(); } catch {} o.el.remove(); p[k] = null; } }
function applyVolumes() {
  const c = Call.active; if (!c) return;
  for (const p of c.peers.values()) {
    const pr = volOf(p.userId);
    for (const [slot, vk, mk] of [['mic', 'v', 'm'], ['screen', 'sv', 'sm']]) {
      const o = p[slot + 'Out']; if (!o) continue;
      const vol = c.deafened || pr[mk] ? 0 : (pr[vk] ?? 1);
      if (o.web) { o.el.muted = true; o.gain.gain.value = vol; } else { o.el.muted = vol === 0; o.el.volume = Math.min(1, vol); }
    }
  }
}
// menu rows: volume sliders and mute buttons for someone (their voice, and their stream if they're sharing)
function volumeItems(uid) {
  if (!uid || uid === S.me?.id || typeof Call === 'undefined') return [];
  const part = Object.values(S.voice || {}).flat().find((p) => p.userId === uid);
  const inMyCall = Call.active && [...Call.active.peers.values()].some((p) => p.userId === uid);
  if (!part && !inMyCall) return [];
  const pr = volOf(uid);
  const slider = (label, key) => {
    const v = Math.round((pr[key] ?? 1) * 100);
    return { html: `<div class="menu-vol"><div class="mv-top"><span>${label}</span><b>${v}%</b></div><input type="range" min="0" max="200" step="5" value="${v}"></div>`,
      mount: (el) => { const r = el.querySelector('input'), b = el.querySelector('b'); r.oninput = () => { b.textContent = r.value + '%'; setVol(uid, { [key]: r.value / 100 }); }; el.onclick = (e) => e.stopPropagation(); } };
  };
  const items = ['sep', slider('User volume', 'v'), { label: pr.m ? 'Unmute' : 'Mute', icon: pr.m ? 'mic' : 'micOff', onClick: () => setVol(uid, { m: !pr.m }) }];
  if (part?.screen) items.push('sep', slider('Stream volume', 'sv'), { label: pr.sm ? 'Unmute stream' : 'Mute stream', icon: pr.sm ? 'volume' : 'volumeOff', onClick: () => setVol(uid, { sm: !pr.sm }) });
  return items;
}
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
    // sound: only from a shared tab, never the whole computer's sound and never lumi's own audio,
    // otherwise everyone in the call would hear themselves back through the stream.
    // The desktop app can only capture the whole computer's sound, so it shares no sound.
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } },
      audio: window.lumiDesktop ? false : { restrictOwnAudio: true, echoCancellation: true, suppressLocalAudioPlayback: false },
      systemAudio: 'exclude', selfBrowserSurface: 'exclude', restrictOwnAudio: true });
    c.screenTrack = s.getVideoTracks()[0]; c.screen = true;
    c.screenAudio = s.getAudioTracks()[0] || null; // sound from the shared tab, if the browser offers it
    const surface = c.screenTrack.getSettings?.().displaySurface;
    if (c.screenAudio && surface && surface !== 'browser') { c.screenAudio.stop(); c.screenAudio = null; } // a whole screen or window: its sound would include the call
    c.screenTrack.onended = stopScreen;
    await replaceSenders('video', c.screenTrack);
    if (c.screenAudio) await replaceScreenAudio(c.screenAudio);
    socket.emit('voice:update', { screen: true }); renderCallUI();
  } catch {}
}
async function stopScreen() {
  const c = Call.active; if (!c || !c.screen) return;
  c.screenTrack?.stop(); c.screenTrack = null; c.screen = false;
  if (c.screenAudio) { c.screenAudio.stop(); c.screenAudio = null; await replaceScreenAudio(null); }
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
    // click a tile (e.g. someone's screen share) to zoom it to fill the stage; click again to zoom back out
    stage.querySelector('#call-grid').addEventListener('click', (e) => {
      const t = e.target.closest('.tile'); if (!t) return;
      const key = [...Call.tiles.entries()].find(([, el]) => el === t)?.[0];
      Call.focusSid = Call.focusSid === key ? null : key;
      updateStage();
    });
  }
  const c = Call.active;
  stage.querySelector('#call-controls').innerHTML = `
    <button class="ctrl ${c.muted ? 'off' : ''}" data-c="mute" data-tip="${c.muted ? 'Unmute' : 'Mute'}">${icon(c.muted ? 'micOff' : 'mic')}</button>
    <button class="ctrl ${c.video ? 'on' : ''}" data-c="video" data-tip="${c.video ? 'Turn off camera' : 'Turn on camera'}">${icon(c.video ? 'video' : 'videoOff')}</button>
    ${navigator.mediaDevices?.getDisplayMedia ? `<button class="ctrl ${c.screen ? 'on' : ''}" data-c="screen" data-tip="${c.screen ? 'Stop sharing' : 'Share your screen'}">${icon('screen')}</button>` : ''}
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
    tile.classList.toggle('has-video', showVideo); tile.classList.toggle('screen', !!st.screen); tile.dataset.uid = p.userId;
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
    const youMuted = !self && volOf(p.userId).m && !st.muted;
    tile.querySelector('.lbl').innerHTML = `${st.muted ? `<span class="mic-off">${icon('micOff', 'xs')}</span>` : ''}${youMuted ? `<span class="you-muted" data-tip="You muted them">${icon('micOff', 'xs')}</span>` : ''}${st.deafened ? icon('headphonesOff', 'xs') : ''}${esc(self ? 'You' : memberInfo(sd, p.userId).name)}${st.screen ? ' <span class="live" style="background:var(--red);padding:0 5px;border-radius:4px;font-size:10px">LIVE</span>' : ''}${conn}`;
    if (tile.parentNode !== grid) grid.appendChild(tile);
  }
  // keep self last
  const selfTile = Call.tiles.get(socket.id); if (selfTile && list.length > 1) grid.appendChild(selfTile);
  if (Call.focusSid && !Call.tiles.has(Call.focusSid)) Call.focusSid = null;
  for (const [k, el] of Call.tiles) el.classList.toggle('focus', k === Call.focusSid);
  grid.classList.toggle('has-focus', !!Call.focusSid);
  grid.closest('.stage')?.classList.toggle('zoomed', !!Call.focusSid);
  if (Call.focusSid) { const f = Call.tiles.get(Call.focusSid); if (f && grid.firstChild !== f) grid.prepend(f); }
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
