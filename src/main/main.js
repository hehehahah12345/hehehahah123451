// JARVIS main process: windows, system tray, hotkeys, and the bridge between
// the HUD (what you see) and the computer (tools, voice, school, Claude).
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, powerSaveBlocker,
  protocol, net, nativeImage, Notification, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const settings = require('./settings');
const system = require('./system');
const control = require('./control');
const school = require('./school');
const brain = require('./brain');
const tts = require('./tts');
const stt = require('./stt');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// The HUD is served from app://jarvis/ so the voice engine and fonts load safely.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let hud = null, tray = null, awakeId = null, awakeSince = 0, quitting = false;
let liveTimer = null;

function send(channel, payload) {
  if (hud && !hud.isDestroyed()) hud.webContents.send(channel, payload);
}

// ---------------- focus timer (kept here so it keeps running when the HUD is hidden) ----
const timerState = { label: '', totalMs: 25 * 60e3, remainingMs: 25 * 60e3, running: false, endsAt: null };
let timerTick = null;
function timerSnapshot() {
  const t = { ...timerState };
  if (t.running) t.remainingMs = Math.max(0, t.endsAt - Date.now());
  return t;
}
function timerCommand({ action, minutes, label }) {
  clearTimeout(timerTick);
  const ms = Math.max(0.1, Math.min(600, Number(minutes) || 25)) * 60e3;
  if (action === 'set') {
    Object.assign(timerState, { label: '', totalMs: ms, remainingMs: ms, running: false, endsAt: null });
  } else if (action === 'start') {
    Object.assign(timerState, { label: label || '', totalMs: ms, remainingMs: ms, running: true, endsAt: Date.now() + ms });
  } else if (action === 'pause' && timerState.running) {
    Object.assign(timerState, { remainingMs: Math.max(0, timerState.endsAt - Date.now()), running: false, endsAt: null });
  } else if (action === 'resume' && !timerState.running && timerState.remainingMs > 0) {
    Object.assign(timerState, { running: true, endsAt: Date.now() + timerState.remainingMs });
  } else if (action === 'reset' || action === 'stop') {
    Object.assign(timerState, { running: false, endsAt: null, remainingMs: timerState.totalMs, label: '' });
  }
  if (timerState.running) {
    timerTick = setTimeout(() => {
      const label = timerState.label;
      Object.assign(timerState, { running: false, remainingMs: timerState.totalMs, endsAt: null, label: '' });
      send('timer', timerSnapshot());
      send('timer-done', label);
      if (Notification.isSupported()) new Notification({ title: 'JARVIS', body: `${label ? label + ' timer' : 'Timer'} finished.` }).show();
    }, timerState.endsAt - Date.now());
  }
  send('timer', timerSnapshot());
  return timerSnapshot();
}

// ---------------- stay awake (all night) ----------------
function setAwake(on) {
  if (on && awakeId == null) { awakeId = powerSaveBlocker.start('prevent-display-sleep'); awakeSince = Date.now(); }
  if (!on && awakeId != null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
  const state = { on: awakeId != null, since: awakeSince };
  send('awake', state);
  buildTrayMenu();
  return state;
}

// ---------------- weather (Open-Meteo, free, no key) ----------------
const PLACES = { toronto: 'Toronto, Ontario', caledon: 'Caledon, Ontario' };
const WX = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
async function weather(place) {
  const key = String(place || settings.get('place') || 'toronto').toLowerCase();
  const query = /caledon/.test(key) ? 'Caledon' : /toronto/.test(key) ? 'Toronto' : place;
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(query)}`)).json();
  const p = (g.results || []).find((r) => /caledon|toronto/i.test(query) ? r.admin1 === 'Ontario' : true) || (g.results || [])[0];
  if (!p) return { error: `No place found called ${place}` };
  const imperial = settings.get('units') === 'imperial';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum,rain_sum&forecast_days=8&timezone=auto' +
    (imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '');
  const w = await (await fetch(url)).json();
  const u = imperial ? '°F' : '°C', wu = imperial ? 'mph' : 'km/h';
  return {
    source: 'Open-Meteo', place: `${p.name}${p.admin1 ? ', ' + p.admin1 : ''}`, short: p.name,
    now: { temp: Math.round(w.current.temperature_2m) + '°', feels: Math.round(w.current.apparent_temperature) + '°',
      phrase: WX[w.current.weather_code] || '—', wind: `${Math.round(w.current.wind_speed_10m)} ${wu}`,
      gusts: `${Math.round(w.current.wind_gusts_10m)} ${wu}`, humidity: w.current.relative_humidity_2m + '%', unit: u },
    days: w.daily.time.map((d, i) => ({
      date: d, dow: new Date(d + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short' }),
      phrase: WX[w.daily.weather_code[i]] || '—', hi: Math.round(w.daily.temperature_2m_max[i]) + '°', lo: Math.round(w.daily.temperature_2m_min[i]) + '°',
      pop: w.daily.precipitation_probability_max[i], snowCm: w.daily.snowfall_sum[i], rainMm: w.daily.rain_sum[i],
    })),
  };
}

// ---------------- camera (asks the HUD to take a photo) ----------------
const camWaiters = new Map(); let camId = 1;
function cameraScan() {
  showHud();
  const id = camId++;
  return new Promise((resolve) => {
    camWaiters.set(id, resolve);
    send('camera-scan', { id });
    setTimeout(() => { if (camWaiters.has(id)) { camWaiters.delete(id); resolve(null); } }, 60e3);
  });
}
ipcMain.on('camera-result', (_e, { id, image }) => {
  const r = camWaiters.get(id);
  if (r) { camWaiters.delete(id); r(image || null); }
});

// ---------------- notes (plain text, shared by the notes card and Claude) ----------------
function getNotes() { const n = settings.get('notes'); return typeof n === 'string' ? n : ''; }
function setNotes(text) { settings.set({ notes: String(text || '') }); }

// ---------------- tools Claude can use ----------------
const asText = (obj) => ({ content: typeof obj === 'string' ? obj : JSON.stringify(obj) });
async function runTool(name, input) {
  switch (name) {
    case 'start_timer': {
      const m = Number(input.minutes);
      if (!(m > 0 && m <= 600)) return { content: 'minutes must be between 0 and 600', isError: true };
      timerCommand({ action: 'start', minutes: m, label: String(input.label || '').slice(0, 30) });
      return asText(`Timer started for ${m} minutes`);
    }
    case 'stop_timer': return asText(timerCommand({ action: input.action || 'reset' }));
    case 'add_note': {
      const t = String(input.text || '').trim().slice(0, 300);
      if (!t) return { content: 'text is empty', isError: true };
      const cur = getNotes().trim();
      setNotes((cur ? cur + '\n' : '') + '• ' + t);
      send('notes', getNotes());
      return asText('Note saved');
    }
    case 'read_notes': return asText(getNotes().slice(0, 4000) || '(no notes yet)');
    case 'set_skin': {
      if (!brain.SKINS.includes(input.skin)) return { content: 'skin must be one of ' + brain.SKINS.join(', '), isError: true };
      settings.set({ skin: input.skin }); send('skin', input.skin);
      return asText('Skin set to ' + input.skin);
    }
    case 'get_computer_specs': return asText({ specs: await system.specs(), live: await system.live() });
    case 'set_stay_awake': return asText(setAwake(!!input.on).on ? 'All-night mode is on. Sleep is blocked until it is turned off or JARVIS quits.' : 'All-night mode is off');
    case 'open_app': return asText(await control.openApp(input.name));
    case 'open_website': return asText(await control.openWebsite(input.url));
    case 'open_file': return asText(await control.openFile(input.query));
    case 'media': return asText(await control.media(input.action, input.steps));
    case 'set_volume': return asText(await control.setVolume(input.percent));
    case 'get_school': {
      if (input.refresh || !school.get().updated) await school.refresh();
      return asText(school.summary());
    }
    case 'get_weather': return asText(await weather(input.place));
    case 'camera_scan': {
      const img = await cameraScan();
      if (!img) return { content: 'The camera scan was cancelled or no camera was found.', isError: true };
      return { content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } },
        { type: 'text', text: 'Photo from the webcam. Identify the main object being held up.' },
      ] };
    }
    default: return { content: `Unknown tool ${name}`, isError: true };
  }
}

// ---------------- windows ----------------
function createHud() {
  hud = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 620,
    backgroundColor: '#060a13', frame: false, show: false, title: 'JARVIS',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  hud.loadURL('app://jarvis/hud/index.html');
  hud.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) hud.show(); });
  hud.on('close', (e) => { if (!quitting) { e.preventDefault(); hud.hide(); } });
  // Links open in the normal browser, never inside the HUD.
  hud.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) control.openWebsite(url); return { action: 'deny' }; });
  hud.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); control.openWebsite(url); } });
}
function showHud() { if (!hud) return; hud.show(); hud.focus(); }
function toggleHud() { if (!hud) return; if (hud.isVisible() && hud.isFocused()) hud.hide(); else showHud(); }

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide HUD', accelerator: settings.get('toggleHudShortcut'), click: toggleHud },
    { type: 'separator' },
    { label: 'Run all night (no sleep)', type: 'checkbox', checked: awakeId != null, click: (i) => setAwake(i.checked) },
    { label: 'Listen for "Jarvis"', type: 'checkbox', checked: !!settings.get('wakeWord'),
      click: (i) => { settings.set({ wakeWord: i.checked }); send('settings', settings.all()); } },
    { type: 'separator' },
    { label: 'School sign-in: Brightspace', click: () => school.openSignIn('brightspace') },
    { label: 'School sign-in: Google Classroom', click: () => school.openSignIn('classroom') },
    { label: 'Refresh school now', click: () => school.refresh() },
    { type: 'separator' },
    { label: 'Settings…', click: () => { showHud(); send('open-settings'); } },
    { label: 'Quit JARVIS', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray@2x.png'));
  const size = process.platform === 'win32' ? 16 : 22;
  tray = new Tray(img.resize({ width: size, height: size }));
  tray.setToolTip('JARVIS');
  tray.on('click', toggleHud);
  buildTrayMenu();
}

// ---------------- hotkeys ----------------
let uiohook = null, pttDown = false;
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const reg = (acc, fn) => { try { if (acc && !globalShortcut.register(acc, fn)) console.warn('Shortcut taken:', acc); } catch (e) { console.warn(e.message); } };
  reg(settings.get('toggleHudShortcut'), toggleHud);
  reg(settings.get('talkShortcut'), () => { showHud(); send('talk-toggle'); }); // press once to talk, again to send

  // Hold-to-talk needs to know when a key is RELEASED, which normal shortcuts can't do.
  // uiohook-napi watches the keyboard globally, and JARVIS only reacts to this one key.
  try {
    if (!uiohook) {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      const aliases = { RightCtrl: 'CtrlRight', RightAlt: 'AltRight', RightShift: 'ShiftRight' };
      const code = () => UiohookKey[aliases[settings.get('pushToTalkKey')] || settings.get('pushToTalkKey')];
      uIOhook.on('keydown', (e) => { if (e.keycode === code() && !pttDown) { pttDown = true; send('ptt', true); } });
      uIOhook.on('keyup', (e) => { if (e.keycode === code() && pttDown) { pttDown = false; send('ptt', false); } });
      uIOhook.start();
      uiohook = uIOhook;
    }
  } catch (e) {
    console.warn('Hold-to-talk unavailable, use the talk shortcut instead:', e.message);
  }
}

// ---------------- start with the computer ----------------
function applyAutoStart() {
  const on = !!settings.get('startWithComputer');
  if (!app.isPackaged) return; // only for the installed app, not while testing with "npm start"
  if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'jarvis.desktop');
    if (on) {
      fs.mkdirSync(dir, { recursive: true });
      const exe = process.env.APPIMAGE || process.execPath;
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=JARVIS\nExec="${exe}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    } else if (fs.existsSync(file)) fs.unlinkSync(file);
  } else {
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, args: ['--hidden'] });
  }
}

// ---------------- IPC from the HUD ----------------
let asking = false;
function errorLine(e) {
  if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) return null;
  const msg = e.status === 401 ? 'My Claude API key was rejected, Sir. Please check it in Settings.'
    : e.status === 429 ? "I'm being rate limited, Sir. Give it a minute."
    : e.status === 529 || e.status >= 500 ? 'Claude is busy right now. Try again shortly.'
    : /fetch|network|ENOTFOUND|ECONN|Connection/i.test(String(e.message)) ? "I can't reach the internet right now, Sir."
    : 'Something went wrong: ' + String(e.message || e).slice(0, 160);
  return JSON.stringify({ t: 'ack', say: msg });
}
ipcMain.handle('ask', async (_e, { text, image }) => {
  if (asking) return { text: '', busy: true };
  asking = true;
  try {
    const out = await brain.ask(text, {
      image, runTool,
      onLookup: (what) => send('lookup', what),
      onText: (d) => send('ask-text', d),
    });
    return { text: out };
  } catch (e) {
    const line = errorLine(e);
    return line ? { text: line, error: true } : { text: '', cancelled: true };
  } finally { asking = false; }
});
ipcMain.handle('expand', async (_e, args) => {
  if (asking) return { text: '', busy: true };
  asking = true;
  try { return { text: await brain.expand(args, { onText: (d) => send('ask-text', d) }) }; }
  catch (e) { const line = errorLine(e); return line ? { text: line, error: true } : { text: '', cancelled: true }; }
  finally { asking = false; }
});
ipcMain.handle('cancel', async () => brain.cancel());
ipcMain.handle('tts', async (_e, text, rate) => tts.speak(text, rate));
ipcMain.handle('transcribe', async (_e, audio) => stt.transcribe(audio));
ipcMain.handle('stt-warmup', async () => stt.warmup());
ipcMain.handle('specs', async () => system.specs());
ipcMain.handle('weather', async (_e, place) => { try { return await weather(place); } catch (e) { return { error: e.message }; } });
ipcMain.handle('school-get', async () => school.get());
ipcMain.handle('school-refresh', async () => school.refresh());
ipcMain.handle('school-signin', async (_e, which) => school.openSignIn(which));
ipcMain.handle('school-signout', async () => school.signOut());
ipcMain.handle('settings-get', async () => settings.all());
ipcMain.handle('settings-set', async (_e, patch) => {
  const s = settings.set(patch);
  if ('skin' in patch) send('skin', s.skin);
  if ('schoolRefreshMinutes' in patch) school.schedule();
  if ('startWithComputer' in patch) applyAutoStart();
  if ('toggleHudShortcut' in patch || 'talkShortcut' in patch) registerHotkeys();
  buildTrayMenu();
  return s;
});
ipcMain.handle('timer', async (_e, cmd) => timerCommand(cmd));
ipcMain.handle('timer-get', async () => timerSnapshot());
ipcMain.handle('notes-get', async () => getNotes());
ipcMain.handle('notes-set', async (_e, text) => { setNotes(text); return true; });
ipcMain.handle('awake', async (_e, on) => setAwake(!!on));
ipcMain.handle('awake-get', async () => ({ on: awakeId != null, since: awakeSince }));
ipcMain.handle('window', async (_e, action) => {
  if (action === 'hide') hud.hide();
  if (action === 'minimize') hud.minimize();
  if (action === 'fullscreen') hud.setFullScreen(!hud.isFullScreen());
  if (action === 'quit') { quitting = true; app.quit(); }
});
ipcMain.handle('open-url', async (_e, url) => control.openWebsite(url));

// Download the small wake-word model once (about 40 MB) into the app's data folder.
const VOSK_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
ipcMain.handle('wake-model', async () => {
  const dir = path.join(app.getPath('userData'), 'models');
  const file = path.join(dir, 'vosk-small-en.tar.gz');
  const url = 'app://jarvis/models/vosk-small-en.tar.gz';
  if (fs.existsSync(file) && fs.statSync(file).size > 1e6) return { ok: true, url };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const res = await fetch(VOSK_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fs.writeFileSync(file + '.part', Buffer.from(await res.arrayBuffer()));
    fs.renameSync(file + '.part', file);
    return { ok: true, url };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------------- start-up ----------------
app.on('second-instance', showHud);
app.whenReady().then(async () => {
  // app://jarvis/hud/* = the HUD, lib/* = wake-word engine, fonts/* = bundled fonts, models/* = downloaded models
  const map = {
    hud: path.join(__dirname, '..', 'renderer'),
    lib: path.join(ROOT, 'node_modules', 'vosk-browser', 'dist'),
    fonts: path.join(ROOT, 'node_modules', '@fontsource'),
    models: path.join(app.getPath('userData'), 'models'),
  };
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const [, area, ...rest] = decodeURIComponent(u.pathname).split('/');
    const base = map[area];
    const file = base && path.normalize(path.join(base, ...rest));
    if (!file || !file.startsWith(base + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // The HUD may use the microphone and camera; nothing else.
  const allowed = ['media', 'notifications', 'fullscreen'];
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.includes(perm));

  createHud();
  createTray();
  registerHotkeys();
  applyAutoStart();
  school.setup((data) => send('school', data));

  liveTimer = setInterval(async () => {
    if (hud && hud.isVisible()) send('live', await system.live().catch(() => null));
  }, 3000);
});

app.on('window-all-closed', (e) => e.preventDefault()); // stay in the tray
app.on('before-quit', () => {
  quitting = true;
  setAwake(false); // "run all night" always switches off when JARVIS exits
  globalShortcut.unregisterAll();
  clearInterval(liveTimer);
  try { uiohook && uiohook.stop(); } catch {}
  stt.stop();
});
