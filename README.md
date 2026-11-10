# JARVIS

A personal assistant for your computer with a sci-fi heads-up display (HUD).
It listens for "Jarvis", talks back, shows research boards, reads your school
sites, and can keep your computer awake all night.

---

## Set up (about 10 minutes, once)

1. **Install Node.js** (the "LTS" version) from <https://nodejs.org>. Use the normal installer and click Next through it.
2. **Download this project.** On GitHub, click **Code → Download ZIP**, then unzip it somewhere easy, such as your Documents folder.
3. **Open a terminal in that folder.**
   - Windows: open the folder, click the address bar, type `cmd`, press Enter.
   - Mac: right-click the folder and choose **New Terminal at Folder**.
4. **Install and start.** Type these two commands (the first one takes a few minutes):
   ```
   npm install
   npm start
   ```
5. **Add your Claude key.** The Settings window opens by itself. Paste your Claude API key
   (from <https://console.anthropic.com> → API Keys), then click **Save**.
   You can also paste an ElevenLabs key here if you want a better voice.

The first time you talk to JARVIS, it downloads two small speech models (about 120 MB).
After that, speech recognition runs on your computer and works without internet.

**Optional: make a real installed app** so JARVIS starts with your computer:
`npm run dist`. This puts an installer in the `dist` folder. Run it.
"Start with the computer" only works for the installed app, not for `npm start`.

---

## How to use it

| To do this | Do this |
|---|---|
| Talk | Say **"Jarvis"**, then your request. Or **hold Right Ctrl** while you talk. Or click the ● button. |
| Type | Type in the bar at the bottom and press Enter. Press `/` to jump to it. |
| Show or hide the HUD | **Ctrl+Alt+J**, or click the tray icon (next to the clock in your taskbar). |
| Talk with a shortcut (press, then press again to stop) | **Ctrl+Alt+Space** |
| Scan an object | Click **SCAN**, hold the object up, and wait for the 5-second countdown. Or say "Jarvis, what is this?" |
| Keep the computer awake | Click **NIGHT**, or say "run all night". The screen dims to a clock. It turns off by itself when you quit JARVIS. |
| Go back from a research board | Click **◂ HOME** or press Esc. You can drag the panels around. |
| Quit for real | Use the ✕ button at the top right, or right-click the tray icon and choose **Quit JARVIS**. (Closing the window only hides it.) |

Things you can say:
- "Start a 25 minute timer for math", "pause the timer"
- "Note that the bio test is Friday", "read my notes"
- "Switch to the red skin". The four skins are arc (cyan), mark (red/gold), stealth (white) and emerald (green).
- "What graphics card do I have?", "how hot is my CPU?"
- "Open Spotify", "open my history essay", "open YouTube"
- "Pause the music", "next song", "volume to 30"
- "What's due this week?", "what's my grade in chemistry?"
- "Research black holes", "compare the iPhone and Pixel cameras"

When JARVIS has to look something up, it says "One moment." and then shows a board.
It does not read the board out loud.

### School (Brightspace and Google Classroom)

1. In the **School** card, click **Brightspace sign-in**. A window opens on tdsb.elearningontario.ca.
   **Sign in yourself**, the same way you would in a browser, then close the window.
2. Do the same with **Classroom sign-in**.

After that, JARVIS reads your courses, grades and due dates every 2 hours, and whenever you ask.
- JARVIS **never asks for, saves or types your password**. The school's own sign-in page handles it. JARVIS keeps only the "you're logged in" cookie, the same way a browser does, and keeps it in its own separate profile.
- If the school signs you out, the card says so. Sign in again.
- JARVIS does not try to get around any school login or block. If Google refuses to sign you in inside the app (Google sometimes blocks sign-in from app windows), Classroom will stay unavailable. That is Google's rule, and JARVIS leaves it alone.
- To remove the sign-ins, open **Settings → Sign out of school sites**.

---

## Why it's built this way

- **Electron (desktop app made from web pages).** It runs a web page as a real app, so the HUD design stays HTML and CSS. It can also do the things a browser can't: tray icon, global hotkeys, blocking sleep, opening apps, and reading hardware info.
- **Claude is the brain.** Every request goes to Claude with a set of tools: timer, notes, skin, computer info, stay awake, open app/website/file, media keys, volume, school, weather, camera scan, plus web search. Claude decides which tools to use and answers in the HUD's panel format. The default model is Claude Opus 5.5 with "low" effort, which keeps replies fast. Use "medium" for deeper answers. You can change both in Settings.
- **Wake word with Vosk.** A tiny offline model listens only for the word "Jarvis". Nothing leaves your computer until you've said it.
- **Speech-to-text with Whisper.** It runs on your computer, in the background, so the app doesn't freeze.
- **Voice.** ElevenLabs if you add a key. Otherwise your computer's built-in voice (free).
- **Weather from Open-Meteo.** It's free and needs no key. Set your city in Settings.
- **Your keys are encrypted** with your computer's own password storage. They are not saved as plain text.

**Cost:** Claude and ElevenLabs charge per use. A quick command costs a fraction of a cent. A research board with web searches costs a few cents. Check usage at console.anthropic.com.

---

## Files (if you want to change things)

| File | What it does |
|---|---|
| `src/renderer/index.html`, `hud.css` | The HUD layout and the four skins (colours at the top of `hud.css`) |
| `src/renderer/hud.js` | Clock, cards, caption, command bar, night screen, camera, settings |
| `src/renderer/board.js` | Research board: one renderer per panel type |
| `src/renderer/voice.js` | Wake word, recording, speaking |
| `src/main/brain.js` | Claude's instructions and tool list |
| `src/main/main.js` | Tray, hotkeys, stay-awake, and what each tool actually does |
| `src/main/control.js` | Opening apps, files, websites, media keys, volume |
| `src/main/system.js` | Computer info |
| `src/main/school.js` | Brightspace and Classroom reader |

**Panel format.** Claude replies with one JSON object per line:
`subject`, `note`, `stat`, `list`, `steps`, `bars`, `table`, `warn`, `links`, plus `ack`, which is spoken only. Example:
```
{"type":"subject","title":"Mitochondria","subtitle":"Cell organelle","caption":"The cell's power plant"}
{"type":"stat","label":"Size","value":"0.5–1","unit":"µm"}
{"type":"ack","say":"Timer started for 25 minutes."}
```

## Troubleshooting

- **"Wake word unavailable".** The wake-word model couldn't download. Check your internet and restart JARVIS. Hold-to-talk still works.
- **Hold-to-talk does nothing.** Use Ctrl+Alt+Space instead, or pick a different key in Settings. On a Mac, allow JARVIS under System Settings → Privacy & Security → **Accessibility** and **Input Monitoring**.
- **No temperature shown.** Many Windows PCs don't share CPU temperature with apps. The card says "temp n/a" when that happens.
- **Linux media keys.** Install `playerctl` (`sudo apt install playerctl`).
