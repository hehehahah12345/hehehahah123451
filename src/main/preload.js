// The safe bridge: the HUD can only call these functions, nothing else on the computer.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, v) => fn(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('jarvis', {
  ask: (text, image) => ipcRenderer.invoke('ask', { text, image }),
  expand: (args) => ipcRenderer.invoke('expand', args),
  cancel: () => ipcRenderer.invoke('cancel'),
  tts: (text, rate) => ipcRenderer.invoke('tts', text, rate),
  transcribe: (audio) => ipcRenderer.invoke('transcribe', audio),
  sttWarmup: () => ipcRenderer.invoke('stt-warmup'),
  wakeModel: () => ipcRenderer.invoke('wake-model'),
  specs: () => ipcRenderer.invoke('specs'),
  weather: (place) => ipcRenderer.invoke('weather', place),
  school: {
    get: () => ipcRenderer.invoke('school-get'),
    refresh: () => ipcRenderer.invoke('school-refresh'),
    signIn: (which) => ipcRenderer.invoke('school-signin', which),
    signOut: () => ipcRenderer.invoke('school-signout'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings-get'),
    set: (patch) => ipcRenderer.invoke('settings-set', patch),
  },
  timer: (cmd) => ipcRenderer.invoke('timer', cmd),
  timerGet: () => ipcRenderer.invoke('timer-get'),
  notesGet: () => ipcRenderer.invoke('notes-get'),
  setNotes: (text) => ipcRenderer.invoke('notes-set', text),
  setAwake: (on) => ipcRenderer.invoke('awake', on),
  awakeGet: () => ipcRenderer.invoke('awake-get'),
  windowAction: (a) => ipcRenderer.invoke('window', a),
  openUrl: (u) => ipcRenderer.invoke('open-url', u),
  cameraResult: (id, image) => ipcRenderer.send('camera-result', { id, image }),
  on: {
    askText: on('ask-text'), lookup: on('lookup'), timer: on('timer'), timerDone: on('timer-done'),
    notes: on('notes'), skin: on('skin'), awake: on('awake'), live: on('live'), school: on('school'),
    ptt: on('ptt'), talkToggle: on('talk-toggle'), cameraScan: on('camera-scan'),
    openSettings: on('open-settings'), settings: on('settings'),
  },
});
