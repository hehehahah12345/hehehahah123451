// School reader.
//
// How it works, in plain words:
// - JARVIS keeps its own private browser profile (called "persist:school").
// - You open the sign-in window once and log in to Brightspace and Google
//   Classroom YOURSELF, like in any browser. JARVIS never sees, saves or types
//   your password – the school's own login page handles that.
// - Afterwards, JARVIS opens those same pages invisibly and reads what is shown
//   to you (courses, grades, due dates). If the school logs you out, it just
//   tells you to sign in again. It never tries to get around a login or block.
const { BrowserWindow, session, shell } = require('electron');
const settings = require('./settings');

const PARTITION = 'persist:school';
const BRIGHTSPACE = 'https://tdsb.elearningontario.ca';
const CLASSROOM = 'https://classroom.google.com';

let data = settings.readJSON('school.json', { updated: null, brightspace: null, classroom: null });
let timer = null;
let busy = null;
let onUpdate = () => {};

function schoolSession() { return session.fromPartition(PARTITION); }

function setup(updateCallback) {
  onUpdate = updateCallback;
  const ses = schoolSession();
  // The school profile never needs camera/mic/location etc.
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  schedule();
}

function schedule() {
  clearInterval(timer);
  const mins = Math.max(15, Number(settings.get('schoolRefreshMinutes')) || 120);
  timer = setInterval(() => refresh().catch(() => {}), mins * 60 * 1000);
  setTimeout(() => refresh().catch(() => {}), 20 * 1000); // shortly after start-up
}

// Visible window where the student signs in themselves.
function openSignIn(which = 'brightspace') {
  const url = which === 'classroom' ? CLASSROOM : BRIGHTSPACE + '/d2l/home';
  const win = new BrowserWindow({
    width: 1100, height: 800, title: `Sign in – ${which === 'classroom' ? 'Google Classroom' : 'Brightspace'}`,
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    // pop-ups used by sign-in stay inside the school profile
    return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: PARTITION, sandbox: true } } };
  });
  win.loadURL(url);
  win.on('closed', () => refresh().catch(() => {}));
  return { ok: true, message: 'Sign-in window opened. Log in yourself, then close it.' };
}

// Load a page invisibly in the school profile and run a read-only script on it.
async function readPage(url, script, waitMs = 0) {
  const win = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } });
  try {
    await win.loadURL(url);
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    const finalUrl = win.webContents.getURL();
    const result = await win.webContents.executeJavaScript(script, true);
    return { finalUrl, result };
  } finally {
    win.destroy();
  }
}

// ---------- Brightspace ----------
// Brightspace pages get their data from Brightspace's own web API. Because you
// are signed in, the page is allowed to ask it for YOUR courses and grades.
const BRIGHTSPACE_SCRIPT = `(async () => {
  if (/\\/d2l\\/login|login\\.microsoftonline|accounts\\.google/.test(location.href)) return { signedIn: false };
  const j = async (u) => { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) throw new Error(r.status); return r.json(); };
  let lp = '1.30', le = '1.67';
  try {
    const v = await j('/d2l/api/versions/');
    lp = (v.find(x => x.ProductCode === 'lp') || {}).LatestVersion || lp;
    le = (v.find(x => x.ProductCode === 'le') || {}).LatestVersion || le;
  } catch (e) { return { signedIn: false }; }
  const enr = await j('/d2l/api/lp/' + lp + '/enrollments/myenrollments/?orgUnitTypeId=3');
  const now = Date.now(), soon = now + 1000 * 60 * 60 * 24 * 45;
  const courses = [];
  for (const item of (enr.Items || [])) {
    if (item.Access && item.Access.CanAccess === false) continue;
    if (item.Access && item.Access.IsActive === false) continue;
    const ou = item.OrgUnit.Id;
    const c = { id: ou, name: item.OrgUnit.Name, code: item.OrgUnit.Code, grade: null, grades: [], due: [] };
    try { const fg = await j('/d2l/api/le/' + le + '/' + ou + '/grades/final/values/myGradeValue'); c.grade = fg && (fg.DisplayedGrade || null); } catch (e) {}
    try {
      const gv = await j('/d2l/api/le/' + le + '/' + ou + '/grades/values/myGradeValues/');
      c.grades = (gv || []).slice(0, 25).map(g => ({ name: g.GradeObjectName, grade: g.DisplayedGrade,
        points: g.PointsDenominator ? (g.PointsNumerator + '/' + g.PointsDenominator) : null }));
    } catch (e) {}
    try {
      const folders = await j('/d2l/api/le/' + le + '/' + ou + '/dropbox/folders/');
      for (const f of folders || []) if (f.DueDate) { const t = Date.parse(f.DueDate); if (t > now - 864e5 && t < soon) c.due.push({ title: f.Name, due: f.DueDate, kind: 'assignment' }); }
    } catch (e) {}
    try {
      const q = await j('/d2l/api/le/' + le + '/' + ou + '/quizzes/');
      for (const z of (q.Objects || [])) if (z.DueDate) { const t = Date.parse(z.DueDate); if (t > now - 864e5 && t < soon) c.due.push({ title: z.Name, due: z.DueDate, kind: 'quiz' }); }
    } catch (e) {}
    courses.push(c);
  }
  return { signedIn: true, courses };
})()`;

// ---------- Google Classroom ----------
// Classroom has no simple page API, so JARVIS reads the visible text of your
// "To-do" page and class list. If Google changes their page, this may need updating.
const CLASSROOM_SCRIPT = `(async () => {
  if (/accounts\\.google\\.com/.test(location.href)) return { signedIn: false };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 20 && !document.querySelector('a[href*="/c/"]'); i++) await wait(500);
  const seen = new Set(), todo = [];
  for (const a of document.querySelectorAll('a[href*="/a/"], a[href*="/details"]')) {
    const lines = (a.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length || seen.has(a.href)) continue;
    seen.add(a.href);
    todo.push({ title: lines[0], course: lines[1] || '', due: lines.find(l => /due|today|tomorrow|mon|tue|wed|thu|fri|sat|sun|\\d{1,2}:\\d{2}/i.test(l) && l !== lines[0]) || '', url: a.href });
  }
  return { signedIn: true, todo: todo.slice(0, 40) };
})()`;

const CLASSES_SCRIPT = `(async () => {
  if (/accounts\\.google\\.com/.test(location.href)) return { signedIn: false };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 20 && !document.querySelector('a[href*="/c/"]'); i++) await wait(500);
  const names = new Map();
  for (const a of document.querySelectorAll('a[href*="/c/"]')) {
    const id = (a.href.match(/\\/c\\/([^/?#]+)/) || [])[1];
    const t = (a.innerText || '').split('\\n')[0].trim();
    if (id && t && !names.has(id) && t.length < 80) names.set(id, t);
  }
  return { signedIn: true, classes: [...names.values()] };
})()`;

async function refreshBrightspace() {
  try {
    const { result } = await readPage(BRIGHTSPACE + '/d2l/home', BRIGHTSPACE_SCRIPT);
    return result;
  } catch (e) { return { signedIn: false, error: String(e.message || e) }; }
}
async function refreshClassroom() {
  try {
    const todo = await readPage(CLASSROOM + '/u/0/a/not-turned-in/all', CLASSROOM_SCRIPT, 1500);
    if (!todo.result?.signedIn) return { signedIn: false };
    const classes = await readPage(CLASSROOM + '/u/0/h', CLASSES_SCRIPT, 1500);
    return { signedIn: true, todo: todo.result.todo, classes: classes.result?.classes || [] };
  } catch (e) { return { signedIn: false, error: String(e.message || e) }; }
}

async function refresh() {
  if (busy) return busy;
  busy = (async () => {
    const [b, c] = await Promise.all([refreshBrightspace(), refreshClassroom()]);
    data = { updated: new Date().toISOString(), brightspace: b, classroom: c };
    settings.writeJSON('school.json', data);
    onUpdate(data);
    return data;
  })().finally(() => { busy = null; });
  return busy;
}

function get() { return data; }

// Short version for Claude so the request stays small.
function summary() {
  const out = { updated: data.updated };
  const b = data.brightspace;
  out.brightspace = !b ? 'not checked yet' : !b.signedIn ? 'not signed in – open School sign-in from the tray menu' :
    b.courses.map((c) => ({ course: c.name, grade: c.grade, recentGrades: c.grades.slice(-6), due: c.due }));
  const c = data.classroom;
  out.classroom = !c ? 'not checked yet' : !c.signedIn ? 'not signed in – open Classroom sign-in from the tray menu' :
    { classes: c.classes, todo: c.todo.map(({ url, ...t }) => t) };
  return out;
}

async function signOut() {
  await schoolSession().clearStorageData();
  data = { updated: null, brightspace: null, classroom: null };
  settings.writeJSON('school.json', data);
  onUpdate(data);
}

module.exports = { setup, openSignIn, refresh, get, summary, schedule, signOut, openInBrowser: (u) => shell.openExternal(u) };
