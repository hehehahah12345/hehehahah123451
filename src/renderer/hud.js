// HUD logic: clock ring, widget cards, caption line, command bar, skins,
// all-night screen, camera scan and settings.
(() => {
  const J = window.jarvis;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let settings = {};

  // ---------------- caption ----------------
  let captionTimer = null;
  function caption(who, text, keep = false) {
    $('#caption-who').textContent = who;
    $('#caption-text').textContent = text;
    clearTimeout(captionTimer);
    if (!keep) captionTimer = setTimeout(() => { $('#caption-text').textContent = ''; }, 20000);
  }

  // ---------------- clock + ring ----------------
  const ticks = $('#ticks');
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, long = i % 5 === 0;
    const r1 = long ? 122 : 125, r2 = 131;
    ticks.insertAdjacentHTML('beforeend', `<line x1="${200 + Math.sin(a) * r1}" y1="${200 - Math.cos(a) * r1}" x2="${200 + Math.sin(a) * r2}" y2="${200 - Math.cos(a) * r2}" stroke-width="${long ? 2 : 1}"/>`);
  }
  const SEC_LEN = 2 * Math.PI * 118;
  function clock() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(d);
    const hm = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
    const ampm = (parts.find((p) => p.type === 'dayPeriod') || {}).value || '';
    const date = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    $('#clock-time').textContent = hm;
    $('#clock-sec').textContent = `${String(d.getSeconds()).padStart(2, '0')} ${ampm}`.trim();
    $('#clock-date').textContent = date;
    $('#sec-bar').style.strokeDashoffset = SEC_LEN * (1 - (d.getSeconds() + d.getMilliseconds() / 1000) / 60);
    $('#night-clock').textContent = hm;
    $('#night-date').textContent = date;
  }
  setInterval(clock, 250); clock();

  // ---------------- state (ring speed, label) ----------------
  const LABELS = { idle: 'STANDING BY', listening: 'LISTENING', transcribing: 'PROCESSING', thinking: 'THINKING', speaking: 'SPEAKING' };
  function setState(m) {
    document.body.classList.toggle('listening', m === 'listening');
    document.body.classList.toggle('thinking', m === 'thinking' || m === 'transcribing');
    document.body.classList.toggle('speaking', m === 'speaking');
    $('#state-label').textContent = LABELS[m] || m.toUpperCase();
    updateChips();
  }
  function updateChips() {
    const v = window.Voice.state;
    chip('#chip-mic', v.micReady ? 'MIC ON' : 'MIC OFF', v.micReady);
    chip('#chip-wake', !settings.wakeWord ? 'WAKE OFF' : v.wakeReady ? 'WAKE "JARVIS"' : 'WAKE …', settings.wakeWord && v.wakeReady);
    chip('#chip-voice', settings.elevenKeySet ? 'VOICE ELEVENLABS' : 'VOICE BUILT-IN', true);
  }
  function chip(sel, text, on) { const c = $(sel); c.textContent = text; c.classList.toggle('on', !!on); }

  // ---------------- asking JARVIS ----------------
  async function ask(text, image) {
    if (!text) return;
    caption('YOU', text, true);
    Voice.setThinking(true);
    let panels;
    try { panels = await J.ask(text, image); }
    finally { Voice.setThinking(false); }
    handlePanels(panels);
  }
  function handlePanels(panels) {
    const acks = panels.filter((p) => p.type === 'ack');
    const board = panels.filter((p) => p.type !== 'ack');
    if (board.length) {
      Board.show(board);
      const subj = board.find((p) => p.type === 'subject');
      caption('JARVIS', (subj && (subj.caption || subj.title)) || 'Here is what I found.', true);
    }
    for (const a of acks) { caption('JARVIS', a.say || a.text || ''); Voice.say(a.say || a.text); }
  }
  J.on.say((t) => { caption('JARVIS', t); Voice.say(t); });
  J.on.status((s) => { $('#state-label').textContent = s.toUpperCase(); });

  $('#command').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#command-input').value.trim();
    $('#command-input').value = '';
    ask(t);
  });
  $('#btn-mic').addEventListener('click', () => Voice.toggleTalk());
  J.on.ptt((down) => Voice.pushToTalk(down));
  J.on.talkToggle(() => Voice.toggleTalk());
  Voice.on('text', (t) => ask(t));
  Voice.on('state', setState);
  Voice.on('error', (m) => caption('SYSTEM', m));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#settings').hidden) $('#settings').hidden = true;
      else if (!$('#camera').hidden) camCancel();
      else if (Board.isOpen()) Board.hide();
      Voice.stopSpeaking();
    }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('#command-input').focus(); }
  });
  document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => J.windowAction(b.dataset.win)));

  // ---------------- skins ----------------
  function applySkin(s) { document.body.dataset.skin = s || 'arc'; }
  J.on.skin(applySkin);

  // ---------------- focus timer ----------------
  const RING = 2 * Math.PI * 52;
  let timer = null;
  function renderTimer() {
    if (!timer) return;
    const left = timer.running ? Math.max(0, timer.endsAt - Date.now()) : timer.remainingMs;
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    $('#timer-readout').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    $('#timer-bar').style.strokeDashoffset = RING * (1 - left / timer.totalMs);
    $('#timer-label').textContent = timer.label;
    $('#timer-toggle').textContent = timer.running ? 'Pause' : left >= timer.totalMs ? 'Start' : 'Resume';
  }
  J.on.timer((t) => { timer = t; renderTimer(); });
  setInterval(renderTimer, 500);
  document.querySelectorAll('[data-timer]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.timer;
    if (a === 'toggle') {
      const fresh = timer && !timer.running && timer.remainingMs >= timer.totalMs;
      J.timer(timer && timer.running ? { action: 'pause' } : fresh ? { action: 'start', minutes: timer.totalMs / 60000, label: timer.label } : { action: 'resume' });
    }
    else J.timer({ action: a, minutes: Number(b.dataset.min) || undefined });
  }));

  // ---------------- notes ----------------
  let notes = [];
  function renderNotes() {
    $('#notes-count').textContent = notes.length;
    $('#notes-list').innerHTML = notes.map((n, i) => `<li><span>${esc(n.text)}</span><button data-del="${i}" title="Remove">✕</button></li>`).join('') ||
      '<li><span style="color:var(--dim)">No notes. Say "Jarvis, note that…"</span></li>';
  }
  $('#notes-list').addEventListener('click', (e) => {
    const i = e.target.dataset.del;
    if (i != null) { notes.splice(Number(i), 1); J.setNotes(notes); renderNotes(); }
  });
  $('#notes-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#notes-input').value.trim();
    if (!t) return;
    notes.push({ text: t, at: Date.now() }); J.setNotes(notes); renderNotes();
    $('#notes-input').value = '';
  });
  J.on.notes((n) => { notes = n || []; renderNotes(); });

  // ---------------- systems (live) ----------------
  function meter(label, pct, text, hot) {
    const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
    return `<div class="meter"><b>${label}</b><div class="track"><div class="fill${hot ? ' hot' : ''}" style="width:${p}%"></div></div><span>${text}</span></div>`;
  }
  J.on.live((l) => {
    if (!l) return;
    const kb = (v) => (v == null ? '—' : v > 1024 ? (v / 1024).toFixed(1) + ' MB/s' : v + ' KB/s');
    $('#sys-meters').innerHTML =
      meter('CPU', l.cpu, l.cpu != null ? l.cpu + '%' : '—', l.cpu > 85) +
      meter('Memory', l.mem, l.memUsedGB != null ? `${l.memUsedGB}/${l.memTotalGB}G` : '—', l.mem > 85) +
      meter('Net ↓', l.netDownKBs != null ? Math.min(100, Math.log10(1 + l.netDownKBs) * 25) : 0, kb(l.netDownKBs)) +
      meter('Net ↑', l.netUpKBs != null ? Math.min(100, Math.log10(1 + l.netUpKBs) * 25) : 0, kb(l.netUpKBs)) +
      (l.battery ? meter('Battery', l.battery.percent, l.battery.percent + '%' + (l.battery.charging ? ' ⚡' : ''), l.battery.percent < 20 && !l.battery.charging) : '');
    $('#sys-temp').textContent = l.tempC != null ? `CPU ${l.tempC}°C` : 'temp n/a';
  });

  // ---------------- this computer ----------------
  async function loadSpecs() {
    const s = await J.specs();
    $('#pc-os').textContent = s.hostname || '';
    const rows = [
      ['OS', s.os],
      ['CPU', s.cpu && `${s.cpu.name} · ${s.cpu.cores}C/${s.cpu.threads}T${s.cpu.maxGHz ? ' · ' + s.cpu.maxGHz + ' GHz' : ''}`],
      ['Memory', s.memory && `${s.memory.totalGB} GB`],
      ['Graphics', (s.graphics || []).map((g) => g.name + (g.vramMB ? ` (${Math.round(g.vramMB / 1024 * 10) / 10} GB)` : '')).join(' · ')],
      ['Display', (s.displays || []).join(' · ')],
      ['Disk', (s.disks || []).slice(0, 3).map((d) => `${d.mount} ${d.usedGB}/${d.sizeGB} GB`).join(' · ')],
      ['Battery', typeof s.battery === 'string' ? s.battery : `${s.battery.percent}%${s.battery.charging ? ' charging' : ''}`],
      ['Network', s.network && `${s.network.type || ''} ${s.network.wifi?.ssid ? '“' + s.network.wifi.ssid + '”' : ''} ${s.network.ip || ''}`],
    ];
    $('#pc-specs').innerHTML = rows.filter((r) => r[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  }

  // ---------------- weather ----------------
  async function loadWeather() {
    const w = await J.weather();
    if (!w || w.error) { $('#wx-place').textContent = 'offline'; $('#wx-meta').textContent = w && /couldn/i.test(w.error) ? w.error : 'Weather unavailable right now.'; return; }
    $('#wx-place').textContent = w.place;
    $('#wx-temp').textContent = `${w.now.temp}${w.unit}`;
    $('#wx-meta').innerHTML = `<b>${esc(w.now.sky)}</b><br>Feels ${w.now.feels}° · Wind ${w.now.wind} · ${w.now.humidity}% RH`;
    $('#wx-days').innerHTML = w.days.map((d) => {
      const name = new Date(d.day + 'T12:00').toLocaleDateString([], { weekday: 'short' }).toUpperCase();
      return `<div><b>${name}</b>${d.hi}° / ${d.lo}°<br><small>${esc(d.sky)}${d.rain ? ' · ' + d.rain + '%' : ''}</small></div>`;
    }).join('');
  }

  // ---------------- school ----------------
  function when(iso) {
    const d = new Date(iso); if (isNaN(d)) return iso || '';
    const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 864e5);
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function renderSchool(data) {
    if (!data) return;
    $('#school-updated').textContent = data.updated ? 'updated ' + new Date(data.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not checked';
    const b = data.brightspace, c = data.classroom;
    let html = '';
    const due = [];
    if (b && b.signedIn) for (const course of b.courses) for (const d of course.due) due.push({ title: d.title, course: course.name, when: d.due, t: Date.parse(d.due) });
    if (c && c.signedIn) for (const t of c.todo) due.push({ title: t.title, course: t.course, when: t.due, t: Number.MAX_SAFE_INTEGER });
    due.sort((x, y) => x.t - y.t);
    html += '<div class="sub">Due soon</div>';
    html += due.slice(0, 8).map((d) => `<div class="row"><span>${esc(d.title)}<br><small style="color:var(--dim)">${esc(d.course)}</small></span><span class="when">${esc(isNaN(d.t) || d.t === Number.MAX_SAFE_INTEGER ? d.when : when(d.when))}</span></div>`).join('') ||
      '<div class="msg">Nothing due that I can see.</div>';
    if (b && b.signedIn && b.courses.length) {
      html += '<div class="sub">Courses</div>' + b.courses.map((x) => `<div class="row"><span>${esc(x.name)}</span><span class="grade">${esc(x.grade || '—')}</span></div>`).join('');
    }
    const need = [];
    if (!b || !b.signedIn) need.push('Brightspace');
    if (!c || !c.signedIn) need.push('Google Classroom');
    if (need.length) html += `<div class="msg">Not signed in to ${need.join(' and ')}. Use the sign-in buttons below — you log in yourself; JARVIS never sees your password.</div>`;
    $('#school-body').innerHTML = html;
  }
  J.on.school(renderSchool);
  document.querySelectorAll('[data-school]').forEach((btn) => btn.addEventListener('click', async () => {
    const a = btn.dataset.school;
    if (a === 'refresh') { $('#school-updated').textContent = 'checking…'; renderSchool(await J.school.refresh()); }
    else J.school.signIn(a);
  }));

  // ---------------- run all night ----------------
  let awake = false;
  J.on.awake((on) => {
    awake = on;
    document.body.classList.toggle('awake', on);
    chip('#chip-awake', on ? 'NO SLEEP' : 'SLEEP OK', on);
    $('#chip-awake').classList.toggle('hot', on);
    $('#night').hidden = !on;
  });
  $('#btn-awake').addEventListener('click', () => J.setAwake(!awake));
  $('#night-peek').addEventListener('click', () => { $('#night').hidden = true; });
  $('#night-off').addEventListener('click', () => J.setAwake(false));

  // ---------------- camera scan ----------------
  let camStream = null, camResolve = null, camCountdown = null;
  async function camera() {
    $('#camera').hidden = false;
    $('#cam-hint').textContent = 'Hold the object up to the camera';
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 } } });
    } catch { camClose(); caption('SYSTEM', 'No camera found, or camera access was blocked.'); return null; }
    $('#cam-video').srcObject = camStream;
    return new Promise((resolve) => {
      camResolve = resolve;
      let n = 5;
      $('#cam-count').textContent = n;
      camCountdown = setInterval(() => { n--; $('#cam-count').textContent = n > 0 ? n : ''; if (n <= 0) camCapture(); }, 1000);
    });
  }
  function camCapture() {
    const v = $('#cam-video');
    if (!camResolve || !v.videoWidth) return;
    const scale = Math.min(1, 1024 / v.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    const r = camResolve; camClose(); r(b64);
  }
  function camCancel() { const r = camResolve; camClose(); if (r) r(null); }
  function camClose() {
    clearInterval(camCountdown); camResolve = null;
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null; $('#camera').hidden = true; $('#cam-count').textContent = '';
  }
  $('#cam-capture').addEventListener('click', camCapture);
  $('#cam-cancel').addEventListener('click', camCancel);
  $('#btn-scan').addEventListener('click', async () => {
    const img = await camera();
    if (img) ask('Identify the object I am holding up to the camera and build a research board about it.', img);
  });
  J.on.cameraScan(async ({ id }) => J.cameraResult(id, await camera()));

  // ---------------- settings ----------------
  const form = $('#settings-form');
  function fillSettings() {
    for (const el of form.elements) {
      if (!el.name || el.type === 'password') continue;
      if (el.type === 'checkbox') el.checked = !!settings[el.name]; else if (settings[el.name] != null) el.value = settings[el.name];
    }
    $('#k-anthropic').textContent = settings.anthropicKeySet ? 'saved ✓' : 'not set — required';
    $('#k-eleven').textContent = settings.elevenKeySet ? 'saved ✓' : 'not set — using built-in voice';
  }
  function openSettings() { fillSettings(); $('#settings').hidden = false; }
  $('#btn-settings').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => { $('#settings').hidden = true; });
  J.on.openSettings(openSettings);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') patch[el.name] = el.checked;
      else if (el.type === 'password') { if (el.value.trim()) patch[el.name] = el.value.trim(); el.value = ''; }
      else if (el.type === 'number') patch[el.name] = Number(el.value);
      else patch[el.name] = el.value.trim();
    }
    settings = await J.settings.set(patch);
    applySkin(settings.skin);
    Voice.setWake(!!settings.wakeWord);
    updateChips();
    $('#settings').hidden = true;
    caption('SYSTEM', 'Settings saved.');
    loadWeather();
  });
  J.on.settings((s) => { settings = s; Voice.setWake(!!s.wakeWord); updateChips(); });
  $('#school-signout').addEventListener('click', async () => { await J.school.signOut(); caption('SYSTEM', 'Signed out of school sites on this app.'); });

  // ---------------- start ----------------
  (async () => {
    settings = await J.settings.get();
    applySkin(settings.skin);
    notes = settings.notes || []; renderNotes();
    timer = await J.timerGet(); renderTimer();
    renderSchool(await J.school.get());
    loadSpecs().catch(() => {});
    loadWeather().catch(() => {});
    setInterval(() => loadWeather().catch(() => {}), 20 * 60 * 1000);
    updateChips();
    if (!settings.anthropicKeySet) { caption('SYSTEM', 'Welcome. Paste your Claude API key in Settings to wake me up.', true); openSettings(); }
    await Voice.start({ wake: !!settings.wakeWord });
    updateChips();
  })();
})();
