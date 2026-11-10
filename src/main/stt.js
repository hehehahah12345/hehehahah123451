const { Worker } = require('worker_threads');
const path = require('path');
const { app } = require('electron');

let worker = null, nextId = 1;
const pending = new Map();

function start() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'stt-worker.js'), {
    workerData: { cacheDir: path.join(app.getPath('userData'), 'models'), model: 'Xenova/whisper-base.en' },
  });
  worker.on('message', (m) => { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } });
  worker.on('error', (e) => { for (const p of pending.values()) p({ ok: false, error: String(e) }); pending.clear(); worker = null; });
  return worker;
}
function call(msg, transfer) {
  const w = start();
  const id = nextId++;
  return new Promise((resolve) => { pending.set(id, resolve); w.postMessage({ ...msg, id }, transfer); });
}

const warmup = () => call({ type: 'warmup' });
// audio: Float32Array of 16 kHz mono samples
async function transcribe(audio) {
  const buf = new Float32Array(audio).buffer;
  return call({ type: 'transcribe', audio: buf }, [buf]);
}
function stop() { if (worker) worker.terminate(); worker = null; }

module.exports = { warmup, transcribe, stop };
