// Opening apps, files and websites, plus media keys and volume.
// Each operating system does this differently, so there is one branch per system.
const { shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || ''), err: err ? String(stderr || err.message) : '' }));
  });
}
function detached(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
  p.on('error', () => {});
  p.unref();
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Walk a folder a few levels deep and collect files that pass a test.
function walk(dir, depth, test, out = [], limit = 4000) {
  if (depth < 0 || out.length > limit) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth - 1, test, out, limit);
    else if (test(e.name, full)) out.push(full);
  }
  return out;
}
function bestMatch(candidates, query, nameOf) {
  const q = norm(query);
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const n = norm(nameOf(c));
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80 - (n.length - q.length) * 0.1;
    else if (n.includes(q)) score = 60 - (n.length - q.length) * 0.1;
    else if (q.includes(n) && n.length > 3) score = 40;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// ---------- apps ----------
const WIN_ALIASES = {
  calculator: 'calc', notepad: 'notepad', paint: 'mspaint', explorer: 'explorer',
  'file explorer': 'explorer', files: 'explorer', settings: 'ms-settings:',
  'task manager': 'taskmgr', terminal: 'wt', 'command prompt': 'cmd',
  camera: 'microsoft.windows.camera:', store: 'ms-windows-store:',
};

async function openApp(name) {
  name = String(name || '').trim();
  if (!name) return { ok: false, message: 'No app name given.' };

  if (PLATFORM === 'win32') {
    const alias = WIN_ALIASES[name.toLowerCase()];
    if (alias) {
      if (alias.endsWith(':')) await shell.openExternal(alias); else detached('cmd', ['/c', 'start', '', alias]);
      return { ok: true, message: `Opened ${name}.` };
    }
    // Look through Start Menu shortcuts – that is where every installed app lives.
    const roots = [
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
      path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'),
      path.join(os.homedir(), 'Desktop'),
    ];
    const links = roots.flatMap((r) => walk(r, 3, (n) => /\.(lnk|url)$/i.test(n)));
    const hit = bestMatch(links, name, (p) => path.basename(p).replace(/\.(lnk|url)$/i, ''));
    if (hit) { await shell.openPath(hit); return { ok: true, message: `Opened ${path.basename(hit).replace(/\.(lnk|url)$/i, '')}.` }; }
    detached('cmd', ['/c', 'start', '', name]); // last try: let Windows find it
    return { ok: true, message: `Asked Windows to open ${name}.` };
  }

  if (PLATFORM === 'darwin') {
    const r = await run('open', ['-a', name]);
    if (r.ok) return { ok: true, message: `Opened ${name}.` };
    const apps = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')]
      .flatMap((d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.app')).map((f) => path.join(d, f)); } catch { return []; } });
    const hit = bestMatch(apps, name, (p) => path.basename(p, '.app'));
    if (hit) { await run('open', [hit]); return { ok: true, message: `Opened ${path.basename(hit, '.app')}.` }; }
    return { ok: false, message: `I couldn't find an app called ${name}.` };
  }

  // Linux: read the .desktop launchers
  const dirs = ['/usr/share/applications', '/var/lib/flatpak/exports/share/applications',
    path.join(os.homedir(), '.local/share/applications'), '/var/lib/snapd/desktop/applications'];
  const files = dirs.flatMap((d) => walk(d, 1, (n) => n.endsWith('.desktop')));
  const entries = files.map((f) => {
    const txt = (() => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } })();
    return { file: f, name: (txt.match(/^Name=(.*)$/m) || [])[1] || path.basename(f, '.desktop') };
  });
  const hit = bestMatch(entries, name, (e) => e.name);
  if (hit) { detached('gtk-launch', [path.basename(hit.file, '.desktop')]); return { ok: true, message: `Opened ${hit.name}.` }; }
  detached(name.toLowerCase(), []);
  return { ok: true, message: `Tried to start ${name}.` };
}

// ---------- websites ----------
async function openWebsite(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(url)) url = 'https://' + url;
    else url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
  }
  await shell.openExternal(url);
  return { ok: true, message: `Opened ${url}` };
}

// ---------- files ----------
async function openFile(query) {
  query = String(query || '').trim();
  if (!query) return { ok: false, message: 'No file name given.' };
  const expanded = query.replace(/^~(?=$|[\\/])/, os.homedir());
  if (path.isAbsolute(expanded) && fs.existsSync(expanded)) {
    const err = await shell.openPath(expanded);
    return err ? { ok: false, message: err } : { ok: true, message: `Opened ${expanded}` };
  }
  const home = os.homedir();
  const folders = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'OneDrive']
    .map((f) => path.join(home, f));
  const named = folders.find((f) => norm(path.basename(f)) === norm(query));
  if (named && fs.existsSync(named)) { await shell.openPath(named); return { ok: true, message: `Opened your ${path.basename(named)} folder.` }; }
  const files = folders.flatMap((f) => walk(f, 4, () => true));
  const hit = bestMatch(files, query, (p) => path.basename(p).replace(/\.[^.]+$/, ''));
  if (!hit) return { ok: false, message: `I couldn't find a file matching "${query}" in Desktop, Documents or Downloads.` };
  const err = await shell.openPath(hit);
  return err ? { ok: false, message: err } : { ok: true, message: `Opened ${hit}` };
}

// ---------- media + volume ----------
// Windows virtual key codes for the media keys.
const WIN_KEYS = { play_pause: 179, next: 176, previous: 177, volume_up: 175, volume_down: 174, mute: 173 };

function winPressKeys(code, times = 1) {
  const script = `$w=New-Object -ComObject WScript.Shell; for($i=0;$i -lt ${times};$i++){ $w.SendKeys([char]${code}) }`;
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

async function media(action, steps = 5) {
  steps = Math.max(1, Math.min(50, Number(steps) || 5));
  if (PLATFORM === 'win32') {
    const code = WIN_KEYS[action];
    if (!code) return { ok: false, message: `Unknown media action ${action}` };
    // each volume key press is 2%
    await winPressKeys(code, action.startsWith('volume') ? steps : 1);
    return { ok: true, message: `Done: ${action.replace('_', ' ')}.` };
  }
  if (PLATFORM === 'darwin') {
    const vol = { volume_up: `set volume output volume ((output volume of (get volume settings)) + ${steps * 2})`,
      volume_down: `set volume output volume ((output volume of (get volume settings)) - ${steps * 2})`,
      mute: 'set volume output muted (not (output muted of (get volume settings)))' }[action];
    if (vol) { await run('osascript', ['-e', vol]); return { ok: true, message: 'Done.' }; }
    const verb = { play_pause: 'playpause', next: 'next track', previous: 'previous track' }[action];
    for (const appName of ['Spotify', 'Music']) {
      await run('osascript', ['-e', `if application "${appName}" is running then tell application "${appName}" to ${verb}`]);
    }
    return { ok: true, message: 'Done.' };
  }
  // Linux
  const pl = { play_pause: 'play-pause', next: 'next', previous: 'previous' }[action];
  if (pl) { const r = await run('playerctl', [pl]); return r.ok ? { ok: true, message: 'Done.' } : { ok: false, message: 'Install "playerctl" to control media on Linux.' }; }
  const pa = { volume_up: `+${steps * 2}%`, volume_down: `-${steps * 2}%` }[action];
  const r = pa ? await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', pa]) : await run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', 'toggle']);
  return r.ok ? { ok: true, message: 'Done.' } : { ok: false, message: r.err };
}

async function setVolume(percent) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent))));
  if (PLATFORM === 'win32') {
    // Windows has no simple "set volume to X" command, so: all the way down, then up in 2% steps.
    await winPressKeys(WIN_KEYS.volume_down, 50);
    if (p > 0) await winPressKeys(WIN_KEYS.volume_up, Math.round(p / 2));
  } else if (PLATFORM === 'darwin') {
    await run('osascript', ['-e', `set volume output volume ${p}`]);
  } else {
    await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${p}%`]);
  }
  return { ok: true, message: `Volume set to ${p} percent.` };
}

module.exports = { openApp, openWebsite, openFile, media, setVolume };
