// Automatic safety checks for lumi.
// Every uploaded image is checked on this server (nothing is sent anywhere) with a small
// nudity-detection model. Server names and descriptions are checked for sexual words.
const path = require('path');

let tf, model, loading, failed = false;
const MODEL_DIR = path.join(__dirname, '.nsfw-model');
// `node moderation.js extract` (run by npm install): unpack the small MobileNetV2 model from the
// nsfwjs package into plain files. This needs lots of memory once, so it happens at build time.
if (require.main === module && process.argv[2] === 'extract') {
  (async () => {
    const fs = require('fs');
    const mod = require(path.join(path.dirname(require.resolve('nsfwjs')), 'model_imports', 'mobilenet_v2.js'));
    let json = await (typeof mod.modelJson === 'function' ? mod.modelJson() : mod.modelJson); json = json.default || json;
    let w = await (typeof mod.weightBundles[0] === 'function' ? mod.weightBundles[0]() : mod.weightBundles[0]); w = w.default || w;
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    fs.writeFileSync(path.join(MODEL_DIR, 'model.json'), JSON.stringify(json));
    fs.writeFileSync(path.join(MODEL_DIR, 'weights.bin'), Buffer.from(w, 'base64'));
    console.log('Image safety model unpacked');
  })().catch((e) => { console.error('Could not unpack the image safety model:', e.message); });
}
const CLASSES = ['drawing', 'hentai', 'neutral', 'porn', 'sexy'];
// The model files (MobileNetV2 from nsfwjs, ~2.7 MB) are stored as plain files in nsfw-model/,
// which loads in a fraction of the memory the npm package's bundled copy needs.
function getModel() {
  if (model) return Promise.resolve(model);
  if (failed) return Promise.resolve(null);
  if (!loading) loading = (async () => {
    try {
      tf = require('@tensorflow/tfjs');
      tf.enableProdMode();
      const fs = require('fs'), dir = MODEL_DIR;
      if (!fs.existsSync(path.join(dir, 'weights.bin'))) throw new Error('model files missing (they are unpacked by npm install)');
      const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
      const bin = fs.readFileSync(path.join(dir, 'weights.bin'));
      model = await tf.loadLayersModel(tf.io.fromMemory({
        modelTopology: json.modelTopology, weightSpecs: json.weightsManifest[0].weights,
        weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) }));
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
    const probs = tf.tidy(() => m.predict(tf.tensor3d(new Uint8Array(data), [224, 224, 3]).toFloat().div(255).reshape([1, 224, 224, 3])));
    try {
      const vals = await probs.data(), out = {};
      CLASSES.forEach((c, i) => (out[c] = vals[i]));
      return out; // { porn, hentai, sexy, drawing, neutral }
    } finally { probs.dispose(); }
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
const ENABLED = process.env.NSFW_IMAGE_CHECK !== '0';
function worker() {
  if (!ENABLED) return null;
  if (child) return child;
  if (Date.now() < pausedUntil) return null;
  child = fork(__filename, ['worker'], { execArgv: ['--no-warnings', '--max-old-space-size=160'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
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
