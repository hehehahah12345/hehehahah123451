// Voice: wake word ("Jarvis"), recording your request, and speaking replies.
//
// - Wake word: a small offline speech model (Vosk) listens ONLY for the word
//   "Jarvis". Nothing is recorded or sent anywhere while it waits.
// - After the wake word (or while you hold a talk key) your request is
//   recorded until you stop talking, then turned into text on this computer
//   by Whisper.
// - Replies are spoken with ElevenLabs if you saved a key, otherwise with the
//   computer's built-in voice.
(() => {
  const RATE = 16000;
  const state = { mode: 'idle', wakeReady: false, wakeLoading: false, wakeError: '', wakeEnabled: true, micReady: false, sttReady: false, sttError: '', engine: '' };
  const listeners = { text() {}, state() {}, error() {} };

  let ctx, source, proc, stream, recognizer = null;
  let rec = null;              // current recording { chunks, started, lastVoice, heardVoice, manual }
  const preroll = [];          // the last ~0.6 s of audio, so the start of your sentence isn't cut off
  let noiseFloor = 0.008;

  function setMode(m) { state.mode = m; listeners.state(m); }
  const changed = () => listeners.state(state.mode);

  async function initMic() {
    if (state.micReady) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { listeners.error('Microphone blocked or missing.'); return false; }
    ctx = new AudioContext({ sampleRate: RATE });
    source = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = onAudio;
    source.connect(proc);
    proc.connect(ctx.destination);
    state.micReady = true;
    changed();
    return true;
  }

  async function initWake() {
    if (state.wakeReady || state.wakeLoading) return;
    state.wakeLoading = true; state.wakeError = ''; changed();
    try {
      if (!window.Vosk) throw new Error('voice engine missing');
      const m = await window.jarvis.wakeModel();
      if (!m.ok) throw new Error('could not download the wake-word model (' + m.error + ')');
      const model = await window.Vosk.createModel(m.url);
      recognizer = new model.KaldiRecognizer(RATE, JSON.stringify(['jarvis', 'hey jarvis', 'okay jarvis', '[unk]']));
      const hit = (t) => /\bjarvis\b/i.test(t || '');
      recognizer.on('partialresult', (msg) => { if (hit(msg.result.partial)) onWake(); });
      recognizer.on('result', (msg) => { if (hit(msg.result.text)) onWake(); });
      state.wakeReady = true;
    } catch (e) {
      state.wakeError = e.message;
      listeners.error('Wake word unavailable: ' + e.message + '. Hold Space or Right Ctrl to talk instead.');
    } finally { state.wakeLoading = false; changed(); }
  }

  async function warmStt() {
    const r = await window.jarvis.sttWarmup();
    state.sttReady = !!r.ok; state.sttError = r.ok ? '' : r.error; changed();
    if (!r.ok) listeners.error('Speech recognition is not ready: ' + r.error);
  }

  function rms(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }

  function onAudio(e) {
    const copy = new Float32Array(e.inputBuffer.getChannelData(0));
    const level = rms(copy);

    if (rec) {
      rec.chunks.push(copy);
      const now = performance.now();
      if (level > Math.max(0.015, noiseFloor * 3)) { rec.lastVoice = now; rec.heardVoice = true; }
      const elapsed = now - rec.started;
      if (!rec.manual) {
        const silentFor = now - rec.lastVoice;
        if ((rec.heardVoice && silentFor > 1300) || (!rec.heardVoice && elapsed > 5000) || elapsed > 15000) finishRecording();
      } else if (elapsed > 30000) finishRecording();
      return;
    }

    // Not recording: learn the background noise level, keep pre-roll, feed the wake-word engine.
    noiseFloor = noiseFloor * 0.98 + Math.min(level, 0.05) * 0.02;
    preroll.push(copy);
    while (preroll.length > 5) preroll.shift();
    if (recognizer && state.wakeEnabled && state.mode === 'idle') {
      try { recognizer.acceptWaveform(e.inputBuffer); } catch {}
    }
  }

  let lastWake = 0;
  function onWake() {
    if (state.mode !== 'idle' || performance.now() - lastWake < 2000) return;
    lastWake = performance.now();
    startRecording(false);
  }

  async function startRecording(manual) {
    if (rec) return;
    if (!(await initMic())) return;
    if (ctx.state === 'suspended') await ctx.resume();
    stopSpeaking();
    rec = { chunks: [...preroll], started: performance.now(), lastVoice: performance.now(), heardVoice: false, manual };
    setMode('listening');
  }

  async function finishRecording() {
    if (!rec) return;
    const r = rec; rec = null;
    if (!r.heardVoice && !r.manual) { setMode('idle'); return; }
    setMode('transcribing');
    const total = r.chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Float32Array(total);
    let off = 0; for (const c of r.chunks) { audio.set(c, off); off += c.length; }
    const res = await window.jarvis.transcribe(audio);
    setMode('idle');
    if (!res.ok) { listeners.error('Speech recognition failed: ' + res.error); return; }
    state.sttReady = true;
    // Drop the wake word and the filler Whisper sometimes adds to silence.
    const text = res.text.replace(/^\W*(hey |okay |ok )?jarvis\W*/i, '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
    if (text && !/^(you|thank you\.?|thanks for watching!?|\.)$/i.test(text)) listeners.text(text);
  }

  // ---------- speaking ----------
  let audioEl = null, queue = Promise.resolve(), gen = 0;
  function builtInVoices() { return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); }
  function pickVoice(name) {
    const voices = speechSynthesis.getVoices();
    if (name) { const v = voices.find((x) => x.name === name); if (v) return v; }
    const prefs = [/Microsoft (Ryan|George|Thomas)/i, /Google UK English Male/i, /Daniel/i, /en-GB/i, /en[-_]US/i];
    for (const p of prefs) { const v = voices.find((x) => p.test(x.name) || p.test(x.lang)); if (v) return v; }
    return voices[0];
  }
  function speakBuiltIn(text, opts) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(opts.voiceName); if (v) u.voice = v;
      u.rate = opts.rate || 1; u.pitch = 0.95;
      u.onend = u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }
  async function speakNow(text, opts, myGen) {
    if (myGen !== gen) return;
    setMode(state.mode === 'listening' ? 'listening' : 'speaking');
    try {
      const mp3 = await window.jarvis.tts(text, opts.rate);
      if (myGen !== gen) return;
      if (mp3 && mp3.byteLength) {
        state.engine = 'ElevenLabs';
        const url = URL.createObjectURL(new Blob([mp3], { type: 'audio/mpeg' }));
        audioEl = new Audio(url);
        await new Promise((resolve) => { audioEl.onended = audioEl.onerror = resolve; audioEl.play().catch(resolve); });
        URL.revokeObjectURL(url);
      } else {
        state.engine = 'Built-in';
        await speakBuiltIn(text, opts);
      }
    } finally {
      audioEl = null;
      if (state.mode === 'speaking') setMode('idle');
    }
  }
  function say(text, opts = {}) {
    if (!text) return Promise.resolve();
    const myGen = gen;
    queue = queue.then(() => speakNow(text, opts, myGen)).catch(() => {});
    return queue;
  }
  function stopSpeaking() {
    gen++;
    try { speechSynthesis.cancel(); } catch {}
    if (audioEl) { audioEl.pause(); audioEl.onended && audioEl.onended(); }
    if (state.mode === 'speaking') setMode('idle');
  }

  window.Voice = {
    // Turn on the microphone, wake word and speech recognition.
    async start({ wake }) {
      state.wakeEnabled = !!wake;
      const ok = await initMic();
      if (ok && wake) initWake();
      warmStt();
      return ok;
    },
    setWake(on) { state.wakeEnabled = on; if (on && state.micReady) initWake(); changed(); },
    pushToTalk(down) { if (down) startRecording(true); else if (rec && rec.manual) finishRecording(); },
    toggleTalk() { if (rec) { rec.manual = true; finishRecording(); } else startRecording(true); },
    cancelRecording() { if (rec) { rec = null; setMode('idle'); } },
    say, stopSpeaking, builtInVoices,
    get state() { return state; },
    get listening() { return !!rec; },
    on(evt, fn) { listeners[evt] = fn; },
  };
})();
