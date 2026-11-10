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
5. **Add your Claude key.** The Settings panel opens by itself. Paste your Claude API key
   (from <https://console.anthropic.com> → API Keys), then click **Save keys**.
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
| Talk | Say **"Jarvis"**, then your request. Or **hold Space** (in the JARVIS window) or **hold Right Ctrl** (anywhere) while you talk. Or click the big ring or the mic icon. |
| Type | Type in the bar at the bottom and press Enter. Press `/` to jump to it. |
| Show or hide the HUD | **Ctrl+Alt+J**, or click the tray icon (next to the clock in your taskbar). |
| Talk with a shortcut (press, then press again to stop) | **Ctrl+Alt+Space** |
| Scan an object | Click the scan icon (the square with a circle) in the command bar, hold the object up, and wait for the 5-second countdown. Or say "Jarvis, what is this?" You can also attach, drag in or paste a photo. |
| Keep the computer awake | Click **All night**, or say "run all night". The screen dims to a slowly moving clock. Click the clock to turn it off. It also turns off by itself when you quit JARVIS. |
| Go back from a research board | Click **Home**. Drag panels by their top line. **+ Dig deeper** adds 3 more panels about one panel. **History** reopens old boards. Esc stops JARVIS mid-answer. |
| Quit for real | Click **Quit** at the top right, or right-click the tray icon and choose **Quit JARVIS**. (**Hide** only hides the window.) |

Things you can say:
- "Start a 25 minute timer for math", "pause the timer"
- "Note that the bio test is Friday", "read my notes"
- "Switch to the arc skin". The four skins are ice (blue/red), arc (cyan/gold), ember (orange) and ghost (green).
- "What graphics card do I have?", "how hot is my CPU?"
- "Open Spotify", "open my history essay", "open YouTube"
- "Pause the music", "next song", "volume to 30"
- "What's due this week?", "what's my grade in chemistry?"
- "Research black holes", "compare the iPhone and Pixel cameras"

When JARVIS has to look something up, it says "One moment." Then it builds a board panel by panel, and says one or two sentences with the headline.

In **Settings → Brain**, choose **Deep** (the default, Claude Opus 5.5) or **Fast** (Claude Sonnet 5.5, which answers almost at once).

### School (Brightspace and Google Classroom)

1. In the **School** card, click **Brightspace sign-in**. A window opens on tdsb.elearningontario.ca.
   **Sign in yourself**, the same way you would in a browser, then close the window.
2. Do the same with **Classroom sign-in**.

After that, JARVIS reads your courses, grades and due dates every 2 hours, and whenever you ask.
- JARVIS **never asks for, saves or types your password**. The school's own sign-in page handles it. JARVIS keeps only the "you're logged in" cookie, the same way a browser does, and keeps it in its own separate profile.
- If the school signs you out, the card says so. Sign in again.
- JARVIS does not try to get around any school login or block. If Google refuses to sign you in inside the app (Google sometimes blocks sign-in from app windows), Classroom will stay unavailable. That is Google's rule, and JARVIS leaves it alone.
- To remove the sign-ins, open **Settings → School → Sign out**.

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

The HUD is your original `jarvis-hud.html` (a copy is kept in `design/`). Its HTML and CSS are reused as they were. Only the parts the web page couldn't do were swapped for desktop features.

| File | What it does |
|---|---|
| `src/renderer/index.html`, `hud.css` | The HUD layout and the four skins (colours near the top of `hud.css`) |
| `src/renderer/hud.js` | Boards, panels, history, timer, notes, systems, weather, school, night screen, camera, settings |
| `src/renderer/voice.js` | Wake word, recording, speaking |
| `src/main/brain.js` | Claude's instructions, the panel format, and the tool list |
| `src/main/main.js` | Tray, hotkeys, stay-awake, weather, and what each tool actually does |
| `src/main/control.js` | Opening apps, files, websites, media keys, volume |
| `src/main/system.js` | Computer info |
| `src/main/school.js` | Brightspace and Classroom reader |

**Panel format** (same as your web version). Claude replies with one JSON object per line. The types are `subject`, `note`, `stat`, `list`, `steps`, `bars`, `table`, `warn` and `links`, plus `ack` for spoken-only replies:
```
{"t":"subject","title":"Mitochondria","kicker":"Cell biology","tagline":"The cell's power plant.","say":"Mitochondria make the cell's energy, Sir."}
{"t":"stat","value":"0.5–1 µm","label":"Typical size","detail":"About a hundredth of a hair's width."}
{"t":"bars","title":"...","unit":"USD","bars":[{"l":"8 GB","v":80},{"l":"4 GB","v":60}],"note":"..."}
{"t":"ack","say":"Timer started for 25 minutes, Sir."}
```

## Troubleshooting

- **"Wake word unavailable".** The wake-word model couldn't download. Check your internet and restart JARVIS. Hold-to-talk still works.
- **Hold-to-talk does nothing.** Use Ctrl+Alt+Space instead, or pick a different key in Settings. On a Mac, allow JARVIS under System Settings → Privacy & Security → **Accessibility** and **Input Monitoring**.
- **No temperature shown.** Many Windows PCs don't share CPU temperature with apps. The card says "temp n/a" when that happens.
- **Linux media keys.** Install `playerctl` (`sudo apt install playerctl`).
