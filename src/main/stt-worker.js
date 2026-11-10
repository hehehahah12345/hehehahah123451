// Runs Whisper speech-to-text on this computer (no internet needed after the
// first download of the model, about 80 MB). Runs in a separate thread so the
// app never freezes while it is listening.
const { parentPort, workerData } = require('worker_threads');

let asr = null;
async function load() {
  if (asr) return asr;
  const { pipeline, env } = require('@huggingface/transformers');
  env.cacheDir = workerData.cacheDir;
  asr = await pipeline('automatic-speech-recognition', workerData.model, { dtype: 'q8' });
  return asr;
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'warmup') {
    try { await load(); parentPort.postMessage({ id: msg.id, ok: true }); }
    catch (e) { parentPort.postMessage({ id: msg.id, ok: false, error: String(e.message || e) }); }
    return;
  }
  if (msg.type === 'transcribe') {
    try {
      const model = await load();
      const out = await model(new Float32Array(msg.audio), { language: undefined, chunk_length_s: 30 });
      parentPort.postMessage({ id: msg.id, ok: true, text: String(out.text || '').trim() });
    } catch (e) {
      parentPort.postMessage({ id: msg.id, ok: false, error: String(e.message || e) });
    }
  }
});
