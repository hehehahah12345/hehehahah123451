// The safe bridge: the HUD can only call these functions, nothing else on the computer.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, v) => fn(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('jarvis', {
  ask: (text, image) => ipcRenderer.invoke('ask', { text, image }),
  tts: (text) => ipcRenderer.invoke('tts', text),
  transcribe: (audio) => ipcRenderer.invoke('transcribe', audio),
  sttWarmup: () => ipcRenderer.invoke('stt-warmup'),
  wakeModel: () => ipcRenderer.invoke('wake-model'),
  specs: () => ipcRenderer.invoke('specs'),
  weather: () => ipcRenderer.invoke('weather'),
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
  setNotes: (notes) => ipcRenderer.invoke('notes-set', notes),
  setAwake: (on) => ipcRenderer.invoke('awake', on),
  windowAction: (a) => ipcRenderer.invoke('window', a),
  openUrl: (u) => ipcRenderer.invoke('open-url', u),
  cameraResult: (id, image) => ipcRenderer.send('camera-result', { id, image }),
  on: {
    say: on('say'), status: on('status'), timer: on('timer'), notes: on('notes'), skin: on('skin'),
    awake: on('awake'), live: on('live'), school: on('school'), ptt: on('ptt'), talkToggle: on('talk-toggle'),
    cameraScan: on('camera-scan'), openSettings: on('open-settings'), settings: on('settings'),
  },
});
