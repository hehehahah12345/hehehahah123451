// THE BRAIN: every request goes to Claude, which can use the tools below.
// Claude answers in the HUD's panel format: one JSON object per line.
const Anthropic = require('@anthropic-ai/sdk');
const settings = require('./settings');

const SKINS = ['arc', 'mark', 'stealth', 'emerald'];

const SYSTEM = `You are JARVIS, a calm, witty personal assistant for a high school student in Toronto (TDSB). You run on their own computer and control a sci-fi heads-up display (HUD).

OUTPUT FORMAT — your final answer is ONLY lines of JSON, one object per line, no other text, no code fences.
Allowed line types:
{"type":"ack","say":"..."}  – a short spoken reply (1–2 sentences). Use this alone for quick things: confirmations, timers, opening apps, small talk, simple facts.
{"type":"subject","title":"...","subtitle":"...","caption":"one-line summary shown under the HUD"}  – the centre panel of a research board. Always the first line of a board.
{"type":"note","title":"...","text":"..."}
{"type":"stat","label":"...","value":"...","unit":"..."}
{"type":"list","title":"...","items":["...","..."]}
{"type":"steps","title":"...","items":["...","..."]}
{"type":"bars","title":"...","items":[{"label":"...","value":42,"max":100}]}
{"type":"table","title":"...","columns":["..."],"rows":[["..."]]}
{"type":"warn","title":"...","text":"..."}
{"type":"links","title":"...","items":[{"label":"...","url":"https://..."}]}

WHEN TO BUILD A BOARD: when asked to research, explain, compare, identify a scanned object, show grades/due dates, or show computer specs. A board is one "subject" line followed by 3–8 panels. Keep every panel short and scannable (a HUD, not an essay). Board text is NOT read aloud, so do not add an ack to a board.
For quick commands, reply with a single ack line only.

TOOLS: use them instead of guessing. Use web_search for anything current or factual you are not sure about. Use school for grades, courses and due dates. Use computer_info for hardware questions. Use camera_scan when asked to look at / scan / identify something held up to the camera. Never claim you did something a tool did not confirm.

SAFETY: never ask for, store or type passwords. If school data says "not signed in", tell the student to use "School sign-in" in the tray menu. Help with learning; do not write graded work for them to hand in as their own — explain and guide instead.`;

function clientTools() {
  return [
    {
      name: 'timer',
      description: 'Start, pause, resume or stop the focus timer shown on the HUD.',
      input_schema: { type: 'object', properties: {
        action: { type: 'string', enum: ['start', 'pause', 'resume', 'stop'] },
        minutes: { type: 'number', description: 'Length for start (default 25).' },
        label: { type: 'string', description: 'What the timer is for, e.g. "Math homework".' },
      }, required: ['action'] },
    },
    {
      name: 'notes',
      description: "Read or change the student's notes card.",
      input_schema: { type: 'object', properties: {
        action: { type: 'string', enum: ['add', 'list', 'remove', 'clear'] },
        text: { type: 'string', description: 'Note text for add.' },
        index: { type: 'integer', description: '1-based note number for remove.' },
      }, required: ['action'] },
    },
    {
      name: 'skin',
      description: 'Change the HUD colour skin. arc = cyan, mark = red and gold, stealth = white on black, emerald = green.',
      input_schema: { type: 'object', properties: { skin: { type: 'string', enum: SKINS } }, required: ['skin'] },
    },
    {
      name: 'computer_info',
      description: 'Exact hardware and live status of this computer: CPU, memory, graphics, disks, temperatures, battery, network.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'stay_awake',
      description: 'Turn "run all night" mode on or off. On = the computer will not sleep and the HUD shows a dim clock.',
      input_schema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
    },
    {
      name: 'open_app',
      description: 'Open an installed application by name, e.g. "Spotify", "Chrome", "Calculator", "Word".',
      input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    {
      name: 'open_website',
      description: 'Open a website in the default browser. Accepts a URL, a domain, or search words.',
      input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
    {
      name: 'open_file',
      description: 'Open a file or folder by name (searches Desktop, Documents, Downloads, Pictures, Music, Videos) or by full path.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      name: 'media',
      description: 'Press a media key: play/pause, next, previous, volume up/down, mute.',
      input_schema: { type: 'object', properties: {
        action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'volume_up', 'volume_down', 'mute'] },
        steps: { type: 'integer', description: 'For volume up/down: how many 2% steps (default 5).' },
      }, required: ['action'] },
    },
    {
      name: 'set_volume',
      description: 'Set the system volume to an exact percentage.',
      input_schema: { type: 'object', properties: { percent: { type: 'number' } }, required: ['percent'] },
    },
    {
      name: 'school',
      description: "Read the student's courses, grades and due dates from Brightspace and Google Classroom. Use refresh=true to re-read the sites now (slower).",
      input_schema: { type: 'object', properties: { refresh: { type: 'boolean' } } },
    },
    {
      name: 'weather',
      description: 'Current weather and the next days for the city set in settings (or another city).',
      input_schema: { type: 'object', properties: { city: { type: 'string' } } },
    },
    {
      name: 'camera_scan',
      description: 'Open the webcam, wait for the student to hold an object up, take a photo and return it so you can identify it.',
      input_schema: { type: 'object', properties: {} },
    },
  ];
}

const SERVER_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
];

// Tools that mean "this will take a moment" → JARVIS says "One moment." once.
const SLOW_TOOLS = new Set(['web_search', 'web_fetch', 'school', 'camera_scan', 'computer_info', 'weather']);

let history = [];
let lastAsk = 0;

function parsePanels(text) {
  const panels = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^```(json)?$/, '');
    if (!line.startsWith('{')) continue;
    try { const obj = JSON.parse(line); if (obj && obj.type) panels.push(obj); } catch {}
  }
  if (!panels.length && text && text.trim()) panels.push({ type: 'ack', say: text.trim().slice(0, 400) });
  return panels;
}

/**
 * Ask JARVIS something.
 * @param {string} text  what the student said or typed
 * @param {object} ctx   { runTool(name, input) -> {content, isError}, onSlow(), onStatus(text), image? }
 */
async function ask(text, ctx) {
  const key = settings.getSecret('anthropicKey');
  if (!key) return [{ type: 'ack', say: 'I need a Claude API key first. Open Settings and paste it in.' }];
  const client = new Anthropic({ apiKey: key });

  // Start a fresh conversation after 15 quiet minutes or 30 turns, to keep it quick and cheap.
  if (Date.now() - lastAsk > 15 * 60 * 1000 || history.length > 60) history = [];
  lastAsk = Date.now();

  const now = new Date();
  const userContent = [];
  if (ctx.image) userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: ctx.image } });
  userContent.push({ type: 'text', text: `[${now.toLocaleString('en-CA', { dateStyle: 'full', timeStyle: 'short' })}] ${text}` });
  history.push({ role: 'user', content: userContent });

  let saidOneMoment = !!ctx.image;
  if (ctx.image) ctx.onSlow();
  const tools = [...clientTools(), ...SERVER_TOOLS];
  // Stable prompt + tool list first, so Claude can cache them and answer faster.
  const system = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];

  for (let turn = 0; turn < 12; turn++) {
    const stream = client.beta.messages.stream({
      model: settings.get('model') || 'claude-opus-5-5',
      max_tokens: 16000,
      system,
      tools,
      messages: history,
      output_config: { effort: settings.get('effort') || 'low' },
      // If Claude declines for a safety reason, let the API retry on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    stream.on('streamEvent', (ev) => {
      if (ev.type === 'content_block_start') {
        const b = ev.content_block;
        const name = b && (b.type === 'tool_use' || b.type === 'server_tool_use') ? b.name : null;
        if (name && SLOW_TOOLS.has(name) && !saidOneMoment) { saidOneMoment = true; ctx.onSlow(); }
        if (name) ctx.onStatus(name.replace(/_/g, ' '));
      }
    });
    const msg = await stream.finalMessage();
    history.push({ role: 'assistant', content: msg.content });

    if (msg.stop_reason === 'refusal') {
      history = [];
      return [{ type: 'ack', say: "Sorry, I can't help with that one." }];
    }
    if (msg.stop_reason === 'pause_turn') continue;
    if (msg.stop_reason === 'tool_use') {
      const calls = msg.content.filter((b) => b.type === 'tool_use');
      const results = await Promise.all(calls.map(async (c) => {
        let r;
        try { r = await ctx.runTool(c.name, c.input || {}); }
        catch (e) { r = { content: 'Error: ' + (e.message || e), isError: true }; }
        return { type: 'tool_result', tool_use_id: c.id, content: r.content, is_error: !!r.isError };
      }));
      history.push({ role: 'user', content: results });
      continue;
    }
    const textOut = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (msg.stop_reason === 'max_tokens' && !textOut) return [{ type: 'ack', say: 'That answer ran too long. Try asking for less.' }];
    return parsePanels(textOut);
  }
  return [{ type: 'ack', say: 'That took too many steps. Try asking a simpler way.' }];
}

function reset() { history = []; }

module.exports = { ask, reset, SKINS, parsePanels };
