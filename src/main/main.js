// JARVIS main process: windows, system tray, hotkeys, and the bridge between
// the HUD (what you see) and the computer (tools, voice, school, Claude).
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, powerSaveBlocker,
  protocol, net, nativeImage, Notification, session, dialog } = require('electron');
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

// The HUD is served from app://jarvis/ so the voice engine can load its files safely.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let hud = null, tray = null, awakeId = null, quitting = false;
let liveTimer = null;

// ---------------- focus timer (kept here so it keeps running when the HUD is hidden) ----
const timerState = { label: 'Focus', totalMs: 25 * 60e3, remainingMs: 25 * 60e3, running: false, endsAt: null };
let timerTick = null;
function timerSnapshot() {
  const t = { ...timerState };
  if (t.running) t.remainingMs = Math.max(0, t.endsAt - Date.now());
  return t;
}
function timerCommand({ action, minutes, label }) {
  clearTimeout(timerTick);
  if (action === 'start') {
    const ms = Math.max(1, Number(minutes) || 25) * 60e3;
    Object.assign(timerState, { label: label || 'Focus', totalMs: ms, remainingMs: ms, running: true, endsAt: Date.now() + ms });
  } else if (action === 'pause' && timerState.running) {
    Object.assign(timerState, { remainingMs: Math.max(0, timerState.endsAt - Date.now()), running: false, endsAt: null });
  } else if (action === 'resume' && !timerState.running && timerState.remainingMs > 0) {
    Object.assign(timerState, { running: true, endsAt: Date.now() + timerState.remainingMs });
  } else if (action === 'stop') {
    Object.assign(timerState, { running: false, endsAt: null, remainingMs: timerState.totalMs });
  }
  if (timerState.running) {
    timerTick = setTimeout(() => {
      Object.assign(timerState, { running: false, remainingMs: 0, endsAt: null });
      send('timer', timerSnapshot());
      send('say', `Your ${timerState.label} timer is done.`);
      if (Notification.isSupported()) new Notification({ title: 'JARVIS', body: `${timerState.label} timer finished.` }).show();
    }, timerState.endsAt - Date.now());
  }
  send('timer', timerSnapshot());
  return timerSnapshot();
}

// ---------------- stay awake ----------------
function setAwake(on) {
  if (on && awakeId == null) awakeId = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && awakeId != null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
  send('awake', awakeId != null);
  buildTrayMenu();
  return awakeId != null;
}

// ---------------- weather (Open-Meteo, free, no key) ----------------
const WX = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
async function weather(city) {
  city = city || settings.get('city') || 'Toronto';
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`)).json();
  const p = g.results && g.results[0];
  if (!p) return { error: `Couldn't find ${city}` };
  const imperial = settings.get('units') === 'imperial';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=4&timezone=auto' +
    (imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '');
  const w = await (await fetch(url)).json();
  return {
    place: `${p.name}${p.admin1 ? ', ' + p.admin1 : ''}`, unit: imperial ? '°F' : '°C',
    now: { temp: Math.round(w.current.temperature_2m), feels: Math.round(w.current.apparent_temperature),
      sky: WX[w.current.weather_code] || '—', wind: Math.round(w.current.wind_speed_10m), humidity: w.current.relative_humidity_2m },
    days: w.daily.time.map((d, i) => ({ day: d, sky: WX[w.daily.weather_code[i]] || '—',
      hi: Math.round(w.daily.temperature_2m_max[i]), lo: Math.round(w.daily.temperature_2m_min[i]), rain: w.daily.precipitation_probability_max[i] })),
  };
}

// ---------------- camera (asks the HUD to take a photo) ----------------
let camWaiters = new Map(), camId = 1;
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

// ---------------- tools Claude can use ----------------
const asText = (obj) => ({ content: typeof obj === 'string' ? obj : JSON.stringify(obj) });
async function runTool(name, input) {
  switch (name) {
    case 'timer': return asText(timerCommand(input));
    case 'notes': {
      let notes = settings.get('notes') || [];
      if (input.action === 'add' && input.text) notes = [...notes, { text: String(input.text), at: Date.now() }];
      if (input.action === 'remove') notes = notes.filter((_, i) => i !== Number(input.index) - 1);
      if (input.action === 'clear') notes = [];
      settings.set({ notes });
      send('notes', notes);
      return asText({ notes: notes.map((n, i) => `${i + 1}. ${n.text}`) });
    }
    case 'skin': {
      if (!brain.SKINS.includes(input.skin)) return { content: 'Unknown skin', isError: true };
      settings.set({ skin: input.skin }); send('skin', input.skin);
      return asText(`Skin changed to ${input.skin}.`);
    }
    case 'computer_info': return asText({ specs: await system.specs(), live: await system.live() });
    case 'stay_awake': return asText({ awake: setAwake(!!input.on) });
    case 'open_app': return asText(await control.openApp(input.name));
    case 'open_website': return asText(await control.openWebsite(input.url));
    case 'open_file': return asText(await control.openFile(input.query));
    case 'media': return asText(await control.media(input.action, input.steps));
    case 'set_volume': return asText(await control.setVolume(input.percent));
    case 'school': {
      if (input.refresh) await school.refresh();
      return asText(school.summary());
    }
    case 'weather': return asText(await weather(input.city));
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
function send(channel, payload) {
  if (hud && !hud.isDestroyed()) hud.webContents.send(channel, payload);
}
function createHud() {
  hud = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: '#02060a', frame: false, show: false, title: 'JARVIS',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  hud.loadURL('app://jarvis/hud/index.html');
  hud.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) hud.show(); });
  hud.on('close', (e) => { if (!quitting) { e.preventDefault(); hud.hide(); } });
  // Links inside panels open in the normal browser.
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
  const img = nativeImage.createFromPath(path.join(ASSETS, process.platform === 'darwin' ? 'tray.png' : 'tray@2x.png'));
  tray = new Tray(img.resize({ width: process.platform === 'win32' ? 16 : 22, height: process.platform === 'win32' ? 16 : 22 }));
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
  reg(settings.get('talkShortcut'), () => { showHud(); send('talk-toggle'); }); // press once to talk, press again to stop

  // Hold-to-talk needs to know when a key is RELEASED, which normal shortcuts can't do.
  // uiohook-napi listens to the keyboard globally (only for this one key).
  try {
    if (!uiohook) {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      const aliases = { RightCtrl: 'CtrlRight', RightAlt: 'AltRight', RightShift: 'ShiftRight', LeftCtrl: 'Ctrl', LeftAlt: 'Alt' };
      const keyName = () => aliases[settings.get('pushToTalkKey')] || settings.get('pushToTalkKey');
      uIOhook.on('keydown', (e) => {
        if (e.keycode === UiohookKey[keyName()] && !pttDown) { pttDown = true; send('ptt', true); }
      });
      uIOhook.on('keyup', (e) => {
        if (e.keycode === UiohookKey[keyName()] && pttDown) { pttDown = false; send('ptt', false); }
      });
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
ipcMain.handle('ask', async (_e, { text, image }) => {
  if (asking) return [{ type: 'ack', say: 'One thing at a time — still working on the last request.' }];
  asking = true;
  try {
    return await brain.ask(text, {
      image,
      runTool,
      onSlow: () => send('say', 'One moment.'),
      onStatus: (s) => send('status', s),
    });
  } catch (e) {
    brain.reset();
    const msg = e.status === 401 ? 'My Claude API key was rejected. Please check it in Settings.'
      : e.status === 429 ? "I'm being rate limited. Give me a minute."
      : e.status === 529 || e.status >= 500 ? 'Claude is busy right now. Try again shortly.'
      : /fetch|network|ENOTFOUND|ECONN/i.test(String(e.message)) ? "I can't reach the internet right now."
      : 'Something went wrong: ' + String(e.message || e).slice(0, 160);
    return [{ type: 'ack', say: msg }];
  } finally { asking = false; }
});
ipcMain.handle('tts', async (_e, text) => tts.speak(text));
ipcMain.handle('transcribe', async (_e, audio) => stt.transcribe(audio));
ipcMain.handle('stt-warmup', async () => stt.warmup());
ipcMain.handle('specs', async () => system.specs());
ipcMain.handle('weather', async () => { try { return await weather(); } catch (e) { return { error: e.message }; } });
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
ipcMain.handle('notes-set', async (_e, notes) => { settings.set({ notes }); return notes; });
ipcMain.handle('awake', async (_e, on) => setAwake(!!on));
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
  if (fs.existsSync(file) && fs.statSync(file).size > 1e6) return { ok: true, url: 'app://jarvis/models/vosk-small-en.tar.gz' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const res = await fetch(VOSK_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fs.writeFileSync(file + '.part', Buffer.from(await res.arrayBuffer()));
    fs.renameSync(file + '.part', file);
    return { ok: true, url: 'app://jarvis/models/vosk-small-en.tar.gz' };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------------- start-up ----------------
app.on('second-instance', showHud);
app.whenReady().then(async () => {
  // Serve: app://jarvis/hud/* (the HUD), app://jarvis/lib/* (voice engine), app://jarvis/models/* (downloaded models)
  const map = {
    hud: path.join(__dirname, '..', 'renderer'),
    lib: path.join(ROOT, 'node_modules', 'vosk-browser', 'dist'),
    models: path.join(app.getPath('userData'), 'models'),
  };
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const [, area, ...rest] = decodeURIComponent(u.pathname).split('/');
    const base = map[area];
    const file = base && path.normalize(path.join(base, ...rest));
    if (!file || !file.startsWith(base)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // The HUD may use the microphone and camera; nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'notifications', 'fullscreen'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'notifications', 'fullscreen'].includes(perm));

  createHud();
  createTray();
  registerHotkeys();
  applyAutoStart();
  school.setup((data) => send('school', data));

  liveTimer = setInterval(async () => {
    if (hud && hud.isVisible()) send('live', await system.live().catch(() => null));
  }, 2000);
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
