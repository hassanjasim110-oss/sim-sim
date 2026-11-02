// SIM SIM's MOUTH: 10 designed voices (founder's roster, 2026-10-27), spoken through ElevenLabs' text-to-speech.
// Speech Decision B (amended by the founder 2026-10-27): Meta offers no text-to-speech, so ONLY the mouth is rented.
// The BRAIN stays Meta-only and the EARS stay Chrome. This file never thinks: it turns finished answer text into sound.
// VOICE_API_KEY is read from .env here, on the server only — never sent to the page, never logged, never in a response.
const fs = require('fs');
const path = require('path');

const VOICES_FILE = path.join(__dirname, 'voices.json');   // roster name -> ElevenLabs voice_id ("" until seeded)
const API = 'https://api.elevenlabs.io';
// The fast tier per ElevenLabs' docs (2026-10-30): eleven_flash_v2_5, ~100 ms, cost-effective. Override: VOICE_TTS_MODEL.
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const CHUNK_MAX = 1000;   // the page sends ~450-character chunks; anything longer is refused
const PREVIEW_LINE = "Hi, I'm Sim Sim — this is how I'll sound.";

// The roster — FINAL, verbatim (name, one-liner, design description). `name` stays the KEY everywhere (voices.json,
// settings.voice, DEFAULT_VOICE, synth()) — never shown to the user. `label` (founder, 2026-10-31) is what the user
// sees instead: the voice's character description, not a person's name.
const ROSTER = [
  { name: 'Noor', label: 'Warm & Friendly', line: 'warm, friendly, welcoming', description: 'A warm, friendly woman in her late twenties with a clear American accent. Her voice is smooth and mid-pitched with a natural smile in it, and she speaks at an easy, welcoming pace — like a kind friend who is always glad you called.' },
  { name: 'Zoya', label: 'Bright & Young', line: 'bright, energetic, young', description: 'A bright, energetic woman in her early twenties with a clear American accent. Her voice is light and slightly high-pitched with a sparkling, cheerful tone, and she speaks quickly and eagerly, like an excited friend with good news.' },
  { name: 'Amara', label: 'Calm & Soft', line: 'calm, slow, soft', description: 'A calm, gentle woman in her mid-thirties with a soft American accent. Her voice is low, smooth, and quietly soothing, and she speaks slowly and unhurriedly, like someone settling you in for the evening.' },
  { name: 'Rhea', label: 'Clear & Confident', line: 'clear, confident, professional', description: 'A confident, professional woman in her mid-thirties with a crisp American accent. Her voice is clear and mid-pitched with precise diction, and she speaks at a steady, assured pace — warm, but always on top of things.' },
  { name: 'Omar', label: 'Warm & Steady', line: 'warm, steady, friendly', description: 'A warm, steady man in his early thirties with a clear American accent. His voice is friendly and mid-low in pitch with a relaxed, grounded tone, and he speaks at an easy pace — like a dependable friend who never panics.' },
  { name: 'Kabir', label: 'Deep & Calm', line: 'deep, calm, mature', description: 'A deep, calm man in his late forties with a measured American accent. His voice is low and resonant with quiet authority, and he speaks slowly and deliberately, like a wise mentor thinking before he answers.' },
  { name: 'Leo', label: 'Upbeat & Playful', line: 'upbeat, quick, playful', description: "An upbeat, playful man in his mid-twenties with a bright American accent. His voice is light and mid-high in pitch with a grin in it, and he speaks quickly and cheerfully, like a fun friend who's always up for something." },
  { name: 'Marcus', label: 'Crisp & Formal', line: 'crisp, formal, newsreader-clear', description: 'A crisp, formal man in his early forties with a precise American accent. His voice is clear and mid-low with newsreader diction, and he speaks at an even, exact pace — every word clean, nothing wasted.' },
  { name: 'Sami', label: 'Soft & Gentle', line: 'soft, gentle, gender-neutral', description: 'A soft, gentle young adult with a neutral, mellow American voice. The pitch sits in the middle, the tone is quiet and kind, and they speak slowly and softly, like someone talking with you late at night so as not to wake the house.' },
  { name: 'Nova', label: 'Bright & Futuristic', line: 'bright neutral, a little futuristic', description: 'A bright, neutral young voice with a clean American accent and a subtle futuristic edge. The pitch is mid-range, the tone is clear and light with precise diction, and it speaks at a brisk, confident pace — modern and sharp, but never robotic.' }
];
const NAMES = ROSTER.map(v => v.name);
const DEFAULT_VOICE = 'Noor';
// Speaking speed (Settings): ElevenLabs' voice_settings.speed (allowed 0.7–1.2).
const SPEED = { slower: 0.85, normal: 1, faster: 1.15 };

const key = () => (process.env.VOICE_API_KEY || '').trim();
function ids() {
  try { return JSON.parse(fs.readFileSync(VOICES_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function writeIds(map) {
  fs.writeFileSync(VOICES_FILE + '.tmp', JSON.stringify(map, null, 2) + '\n');
  fs.renameSync(VOICES_FILE + '.tmp', VOICES_FILE);
}

// The true status for Settings: is the service connected, and which voices are set up.
function status(chosen) {
  const map = ids();
  return { connected: !!key(), chosen: NAMES.includes(chosen) ? chosen : DEFAULT_VOICE, preview: PREVIEW_LINE,
    voices: ROSTER.map(v => ({ name: v.name, label: v.label, line: v.line, ready: !!map[v.name] })) };
}

// One chunk of speech. Returns { audio: Buffer } or { fallback: 'not-connected' | 'not-set-up' | 'failed' }.
// A failure is logged here (never the key, never the words).
async function synth(text, voiceName, rate) {
  if (!key()) return { fallback: 'not-connected' };
  const name = NAMES.includes(voiceName) ? voiceName : DEFAULT_VOICE;
  const voiceId = ids()[name];
  if (!voiceId) return { fallback: 'not-set-up', voice: name };
  let r;
  try {
    r = await fetch(API + '/v1/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: (process.env.VOICE_TTS_MODEL || '').trim() || DEFAULT_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: SPEED[rate] || 1 } }),
      signal: AbortSignal.timeout(20000)
    });
  } catch (e) {
    console.error('[speak] the voice service could not be reached (' + (e.name === 'TimeoutError' ? 'timeout' : 'network') + ')');
    return { fallback: 'failed', voice: name };
  }
  if (!r.ok) {
    let why = '';
    try { const d = await r.json(); why = d && d.detail ? (d.detail.status || d.detail.message || '') : ''; } catch (e) {}
    console.error('[speak] the voice service said no: ' + r.status + (why ? ' ' + String(why).slice(0, 80) : ''));
    return { fallback: 'failed', voice: name };
  }
  const audio = Buffer.from(await r.arrayBuffer());
  if (!audio.length) { console.error('[speak] the voice service sent empty audio'); return { fallback: 'failed', voice: name }; }
  return { audio, voice: name, voiceId };
}

module.exports = { ROSTER, NAMES, DEFAULT_VOICE, PREVIEW_LINE, CHUNK_MAX, API, status, synth, ids, writeIds, key };
