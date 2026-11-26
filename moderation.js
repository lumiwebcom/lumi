// Automatic safety checks for lumi.
// Every uploaded image is checked on this server (nothing is sent anywhere) with a small
// nudity-detection model. Server names and descriptions are checked for sexual words.
const path = require('path');

let tf, model, loading, failed = false;
function getModel() {
  if (model) return Promise.resolve(model);
  if (failed) return Promise.resolve(null);
  if (!loading) loading = (async () => {
    try {
      tf = require('@tensorflow/tfjs');
      tf.enableProdMode();
      const base = path.dirname(require.resolve('nsfwjs'));
      const core = require(path.join(base, 'core.js'));
      const { MobileNetV2Model } = require(path.join(base, 'models', 'mobilenet_v2.js'));
      const log = console.log; console.log = () => {}; // the model prints a hosting tip on load
      try { model = await core.load('MobileNetV2', { modelDefinitions: [MobileNetV2Model] }); } finally { console.log = log; }
      console.log('  Image safety check: ready');
      return model;
    } catch (e) {
      failed = true;
      console.error('  Image safety check could not start:', e.message);
      return null;
    }
  })();
  return loading;
}

// one image at a time, so a burst of uploads can't run the server out of memory
let queue = Promise.resolve();
function scanImage(file) {
  const run = queue.then(async () => {
    const m = await getModel();
    if (!m) return null;
    const sharp = require('sharp');
    const { data } = await sharp(file, { animated: false, limitInputPixels: 60e6 })
      .rotate().flatten({ background: '#ffffff' }).resize(224, 224, { fit: 'fill' }).removeAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const t = tf.tensor3d(new Uint8Array(data), [224, 224, 3]);
    try {
      const out = {};
      for (const p of await m.classify(t, 5)) out[p.className.toLowerCase()] = p.probability;
      return out; // { porn, hentai, sexy, drawing, neutral }
    } finally { t.dispose(); }
  });
  queue = run.catch(() => {});
  return run;
}
// how sure the model is that an image shows nudity or sex (0 to 1)
const nsfwScore = (s) => (s ? (s.porn || 0) + (s.hentai || 0) : 0);

const NSFW_TEXT = /\b(porn\w*|p0rn\w*|nsfw|nudes?|nudity|naked|hentai|xxx+|onlyfans|only\s*fans|r34|rule\s*34|sex|sexy|sexting|horny|boobs?|tits|titties|dick\s*pics?|cum|nsfl|erotic\w*|fetish\w*|lewd)\b|(^|\W)18\s*\+/i;
const isNsfwText = (...parts) => parts.some((p) => typeof p === 'string' && NSFW_TEXT.test(p));

// ---- The model runs in its own small process. If it ever runs out of memory or crashes,
// only that process dies: the main lumi server keeps running.
if (require.main === module && process.argv[2] === 'worker') {
  getModel().then((m) => process.send({ ready: !!m }));
  process.on('message', async ({ id, file }) => {
    try { process.send({ id, scores: await scanImage(file) }); } catch (e) { process.send({ id, error: e.message }); }
  });
  process.on('disconnect', () => process.exit(0));
}
const { fork } = require('child_process');
let child = null, seq = 0, crashes = 0, pausedUntil = 0;
const waiting = new Map();
const ENABLED = process.env.NSFW_IMAGE_CHECK === '1'; // off until it fits in the server's memory
function worker() {
  if (!ENABLED) return null;
  if (child) return child;
  if (Date.now() < pausedUntil) return null;
  child = fork(__filename, ['worker'], { execArgv: ['--no-warnings', '--max-old-space-size=320'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  child.on('message', (m) => {
    if ('ready' in m) { if (m.ready) crashes = 0; return; }
    const w = waiting.get(m.id); if (!w) return;
    waiting.delete(m.id); clearTimeout(w.timer);
    m.error ? w.reject(new Error(m.error)) : w.resolve(m.scores);
  });
  child.on('exit', (code) => {
    child = null;
    for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error('image check stopped')); }
    waiting.clear();
    if (code) {
      crashes++;
      console.error(`  Image safety check stopped (code ${code}); lumi is fine.`);
      if (crashes >= 3) { pausedUntil = Date.now() + 30 * 60_000; crashes = 0; console.error('  Image safety check paused for 30 minutes after repeated crashes.'); }
    }
  });
  return child;
}
// scan an image in the worker; resolves null if the check isn't available right now
function checkImage(file) {
  const w = worker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('image check timed out')); }, 45_000);
    waiting.set(id, { resolve, reject, timer });
    w.send({ id, file });
  });
}
const warmUp = () => worker();

module.exports = { checkImage, warmUp, nsfwScore, isNsfwText };
