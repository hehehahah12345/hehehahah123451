// Text-to-speech with ElevenLabs when a key is saved. If not, the HUD uses the
// computer's built-in voice instead (that part happens in the HUD itself).
const settings = require('./settings');

async function speak(text, rate) {
  const key = settings.getSecret('elevenKey');
  if (!key || !text) return null;
  const voice = settings.get('elevenVoiceId') || 'JBFqnCBsd6RMkjVDRZzb';
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5',
        voice_settings: { speed: Math.max(0.7, Math.min(1.2, Number(rate) || 1)) } }),
    });
    if (!res.ok) { console.warn('ElevenLabs error', res.status); return null; }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.warn('ElevenLabs failed', e.message);
    return null;
  }
}
module.exports = { speak };
