// Voice: wake word ("Jarvis"), recording your request, and speaking replies.
//
// - Wake word: a small offline speech model (Vosk) listens ONLY for the word
//   "Jarvis". Nothing is recorded or sent anywhere while it waits.
// - After the wake word (or while you hold the talk key) your request is
//   recorded until you stop talking, then turned into text on this computer
//   by Whisper.
// - Replies are spoken with ElevenLabs if you saved a key, otherwise with the
//   computer's built-in voice.
(() => {
  const RATE = 16000;
  const state = { mode: 'idle', wakeReady: false, wakeEnabled: true, micReady: false };
  const listeners = { text: () => {}, state: () => {}, error: () => {} };

  let ctx, source, proc, stream, recognizer = null;
  let rec = null;              // current recording { chunks, started, lastVoice, heardVoice, manual }
  const preroll = [];          // last ~0.6 s of audio, so the start of your sentence isn't cut off
  let noiseFloor = 0.008;

  function setMode(m) { state.mode = m; listeners.state(m); }

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
    return true;
  }

  async function initWake() {
    try {
      if (!window.Vosk) throw new Error('voice engine missing');
      const m = await window.jarvis.wakeModel();
      if (!m.ok) throw new Error('could not download wake-word model: ' + m.error);
      const model = await window.Vosk.createModel(m.url);
      recognizer = new model.KaldiRecognizer(RATE, JSON.stringify(['jarvis', 'hey jarvis', 'okay jarvis', '[unk]']));
      const hit = (t) => /\bjarvis\b/i.test(t || '');
      recognizer.on('partialresult', (msg) => { if (hit(msg.result.partial)) onWake(); });
      recognizer.on('result', (msg) => { if (hit(msg.result.text)) onWake(); });
      state.wakeReady = true;
      listeners.state(state.mode);
    } catch (e) {
      console.warn('Wake word unavailable:', e);
      listeners.error('Wake word unavailable (' + e.message + '). Use the talk key instead.');
    }
  }

  function rms(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }

  function onAudio(e) {
    const input = e.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input);
    const level = rms(copy);

    if (rec) {
      rec.chunks.push(copy);
      const now = performance.now();
      const speaking = level > Math.max(0.015, noiseFloor * 3);
      if (speaking) { rec.lastVoice = now; rec.heardVoice = true; }
      const elapsed = now - rec.started;
      if (!rec.manual) {
        const silentFor = now - rec.lastVoice;
        if ((rec.heardVoice && silentFor > 1300) || (!rec.heardVoice && elapsed > 5000) || elapsed > 15000) finishRecording();
      } else if (elapsed > 30000) finishRecording();
      return;
    }

    // not recording: learn the background noise level, keep pre-roll, feed the wake-word engine
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
    if (!res.ok) { listeners.error('Speech-to-text failed: ' + res.error); return; }
    // drop the wake word and filler Whisper sometimes adds
    const text = res.text.replace(/^\W*(hey |okay |ok )?jarvis\W*/i, '').replace(/\[(BLANK_AUDIO|.*?)\]/g, '').trim();
    if (text && !/^(you|thank you\.?|\.)$/i.test(text)) listeners.text(text);
  }

  // ---------- speaking ----------
  let audioEl = null;
  let speakQueue = Promise.resolve();
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    const prefs = [/Microsoft (Ryan|George|Thomas)/i, /Google UK English Male/i, /Daniel/i, /en-GB/i, /English.*(United Kingdom|UK)/i, /en[-_]US/i];
    for (const p of prefs) { const v = voices.find((x) => p.test(x.name) || p.test(x.lang)); if (v) return v; }
    return voices[0];
  }
  function speakBuiltIn(text) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(); if (v) u.voice = v;
      u.rate = 1.03; u.pitch = 0.95;
      u.onend = u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }
  async function speakNow(text) {
    setMode(state.mode === 'listening' ? 'listening' : 'speaking');
    try {
      const mp3 = await window.jarvis.tts(text);
      if (mp3 && mp3.byteLength) {
        listeners.voice && listeners.voice('elevenlabs');
        const url = URL.createObjectURL(new Blob([mp3], { type: 'audio/mpeg' }));
        audioEl = new Audio(url);
        await new Promise((resolve) => { audioEl.onended = audioEl.onerror = resolve; audioEl.play().catch(resolve); });
        URL.revokeObjectURL(url);
      } else {
        listeners.voice && listeners.voice('built-in');
        await speakBuiltIn(text);
      }
    } finally {
      audioEl = null;
      if (state.mode === 'speaking') setMode('idle');
    }
  }
  function say(text) {
    if (!text) return Promise.resolve();
    speakQueue = speakQueue.then(() => speakNow(text)).catch(() => {});
    return speakQueue;
  }
  function stopSpeaking() {
    try { speechSynthesis.cancel(); } catch {}
    if (audioEl) { audioEl.pause(); audioEl.onended && audioEl.onended(); }
  }

  window.Voice = {
    async start({ wake }) {
      state.wakeEnabled = wake;
      const ok = await initMic();
      if (ok) { setMode('idle'); if (wake) initWake(); }
      window.jarvis.sttWarmup().then((r) => { if (!r.ok) listeners.error('Speech-to-text model not ready: ' + r.error); });
      return ok;
    },
    setWake(on) { state.wakeEnabled = on; if (on && !state.wakeReady && state.micReady) initWake(); listeners.state(state.mode); },
    pushToTalk(down) { if (down) startRecording(true); else if (rec && rec.manual) finishRecording(); },
    toggleTalk() { if (rec) { rec.manual = true; finishRecording(); } else startRecording(true); },
    setThinking(on) { if (on) setMode('thinking'); else if (state.mode === 'thinking') setMode('idle'); },
    say, stopSpeaking,
    get state() { return state; },
    on(evt, fn) { listeners[evt] = fn; },
  };
})();
