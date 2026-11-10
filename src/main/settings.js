// Settings live in a small JSON file in the app's private data folder.
// API keys are stored separately and encrypted with the operating system's
// keychain (Electron safeStorage), so they are never saved as plain text.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  model: 'claude-opus-5-5',
  effort: 'low',            // low = fastest replies; raise to "medium" for deeper answers
  skin: 'ice',          // ice, arc, ember or ghost
  depth: 'default',     // 'quick' = fastest answers
  units: 'metric',
  wakeWord: true,
  // Macs usually have no right Control key, so hold Right Option there instead.
  pushToTalkKey: process.platform === 'darwin' ? 'RightAlt' : 'RightCtrl',
  toggleHudShortcut: 'CommandOrControl+Alt+J',
  // Cmd+Option+Space opens Finder search on a Mac, so use Cmd+Shift+Space there.
  talkShortcut: process.platform === 'darwin' ? 'CommandOrControl+Shift+Space' : 'CommandOrControl+Alt+Space',
  startWithComputer: true,
  schoolRefreshMinutes: 120,
  elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
  notes: '',
  voice: true,          // speak replies out loud
  rate: 1.05,           // speaking speed
  sfx: true,            // interface sounds
  place: 'toronto',     // weather card: toronto or caledon
};
const SECRET_KEYS = ['anthropicKey', 'elevenKey'];

let cache = null;
const dir = () => app.getPath('userData');
const file = (n) => path.join(dir(), n);

function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writeJSON(name, data) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2));
}

function load() {
  if (!cache) cache = { ...DEFAULTS, ...readJSON('settings.json', {}) };
  return cache;
}
function get(key) { return load()[key]; }
function all() {
  const s = { ...load() };
  for (const k of SECRET_KEYS) s[k + 'Set'] = !!getSecret(k);
  return s;
}
function set(patch) {
  const s = load();
  for (const [k, v] of Object.entries(patch)) {
    if (SECRET_KEYS.includes(k)) { if (v) setSecret(k, v); continue; }
    s[k] = v;
  }
  writeJSON('settings.json', s);
  return all();
}

function getSecret(k) {
  if (k === 'anthropicKey' && process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const secrets = readJSON('secrets.json', {});
  if (!secrets[k]) return '';
  try {
    const buf = Buffer.from(secrets[k], 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch { return ''; }
}
function setSecret(k, value) {
  const secrets = readJSON('secrets.json', {});
  const enc = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
  secrets[k] = enc.toString('base64');
  writeJSON('secrets.json', secrets);
}

module.exports = { get, set, all, getSecret, readJSON, writeJSON };
