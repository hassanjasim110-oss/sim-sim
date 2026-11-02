// SIM SIM — seed the 10 designed voices (one-time; safe to run again).
// Uses ElevenLabs' voice design API (docs checked 2026-10-30): for each roster voice WITHOUT an id in voices.json,
//   1) POST /v1/text-to-voice/design { voice_description }  -> previews[].generated_voice_id
//   2) POST /v1/text-to-voice { voice_name, voice_description, generated_voice_id } -> voice_id  (saved to voices.json)
// Voices that already have an id are skipped. The key (VOICE_API_KEY in .env) is never printed.
//
//   node scripts/seed-voices.js             design + save every voice that has no id yet
//   node scripts/seed-voices.js --list      print the 10 descriptions as a checklist (to make them in the ElevenLabs website)
//   node scripts/seed-voices.js --import Noor=<id> Zoya=<id> …    write ids you made in the website into voices.json
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (e) { /* no .env yet */ }
const voice = require('../voice.js');

const args = process.argv.slice(2);
const mode = args[0] === '--list' ? 'list' : args[0] === '--import' ? 'import' : 'design';

function checklist() {
  console.log('\nThe 10 Sim Sim voices — in the ElevenLabs website: Voices -> Add a new voice -> Voice Design. Paste each description,');
  console.log('pick the preview you like, save it with the name shown, then copy its Voice ID.\n');
  voice.ROSTER.forEach((v, i) => console.log((i + 1) + '. ' + v.name + ' — ' + v.line + '\n   "' + v.description + '"\n'));
  console.log('Then: node scripts/seed-voices.js --import Noor=<id> Zoya=<id> Amara=<id> … (any you made)\n');
}

if (mode === 'list') { checklist(); process.exit(0); }

if (!voice.key()) {
  console.log('VOICE_API_KEY is not set yet. First:');
  console.log('  1. Sign up at https://elevenlabs.io and open your profile -> API Keys.');
  console.log('  2. Create a key that can use Text to Speech and create Voices.');
  console.log('  3. Add one line to the .env file in the SIM SIM folder:  VOICE_API_KEY=<your key>');
  console.log('  4. Run this again:  node scripts/seed-voices.js');
  process.exit(1);
}

const map = Object.assign(Object.fromEntries(voice.NAMES.map(n => [n, ''])), voice.ids());

if (mode === 'import') {
  let n = 0;
  for (const a of args.slice(1)) {
    const m = a.match(/^([A-Za-z]+)=([A-Za-z0-9]{10,64})$/);
    if (!m || !voice.NAMES.includes(m[1])) { console.log('Skipped "' + a + '" — use Name=VoiceID with a roster name.'); continue; }
    map[m[1]] = m[2]; n++;
  }
  voice.writeIds(map);
  console.log('Saved ' + n + ' voice id(s). Seeded now: ' + voice.NAMES.filter(x => map[x]).length + ' of 10.');
  process.exit(0);
}

async function api(pathname, body) {
  const r = await fetch(voice.API + pathname, {
    method: 'POST', headers: { 'xi-api-key': voice.key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    const det = d && d.detail;
    throw new Error('ElevenLabs said ' + r.status + (det ? ': ' + (det.message || det.status || JSON.stringify(det)).slice(0, 200) : ''));
  }
  return d;
}

(async () => {
  const todo = voice.ROSTER.filter(v => !map[v.name]);
  if (!todo.length) { console.log('All 10 voices already have an id. Nothing to do.'); return; }
  console.log('Designing ' + todo.length + ' voice(s) (skipping ' + (10 - todo.length) + ' that already have an id)…');
  let made = 0;
  for (const v of todo) {
    try {
      process.stdout.write(v.name + ': designing… ');
      const design = await api('/v1/text-to-voice/design', { voice_description: v.description, auto_generate_text: true, model_id: 'eleven_multilingual_ttv_v2' });
      const pick = design && design.previews && design.previews[0];
      if (!pick || !pick.generated_voice_id) throw new Error('no preview came back');
      process.stdout.write('saving… ');
      const saved = await api('/v1/text-to-voice', { voice_name: 'Sim Sim — ' + v.name, voice_description: v.description, generated_voice_id: pick.generated_voice_id,
        labels: { app: 'sim-sim', roster: v.name } });
      if (!saved || !saved.voice_id) throw new Error('no voice_id came back');
      map[v.name] = saved.voice_id;
      voice.writeIds(map);   // saved after each one, so a stop halfway keeps what was made
      made++;
      console.log('done (' + saved.voice_id + ')');
    } catch (e) {
      console.log('NOT made — ' + e.message);
    }
  }
  const seeded = voice.NAMES.filter(x => map[x]).length;
  console.log('\nSeeded now: ' + seeded + ' of 10.' + (seeded < 10 ? ' Run this again to retry the rest, or make them in the website: node scripts/seed-voices.js --list' : ''));
})();
