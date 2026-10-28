// SIM SIM learned memory: the rules around the user's notebook facts.
// The brain forgets between calls; the notebook file IS the memory.
// Learning uses the same Meta brain (one small extraction call); everything here is plain code.
const crypto = require('crypto');

const CATEGORIES = ['people', 'dates', 'places', 'preferences', 'possessions', 'plans'];
const MAX_FACTS_IN_CONTEXT = 100;
const MAX_NEW_PER_MESSAGE = 3;

// ---- Secrets are never learned, stored, or repeated ----
const SECRET_WORDS = /\b(pass ?words?|passcodes?|passwd|pins?|pin codes?|cvv|ssn|social security|credit cards?|debit cards?|card numbers?|account numbers?|routing numbers?|bank accounts?|iban|api keys?|secret keys?|access tokens?|private keys?|passports?|driver'?s? licen[cs]e numbers?|security codes?|one[- ]time codes?|otp|2fa|verification codes?)\b/i;
const CODE_WITH_DIGITS = /\bcodes?\b[^.?!]{0,25}\d/i;
const CARD_LIKE = /\b(?:\d[ -]?){12,19}\b/;
function looksSecret(text) {
  return SECRET_WORDS.test(text) || CODE_WITH_DIGITS.test(text) || CARD_LIKE.test(text);
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function newFactId() {
  return 'f_' + crypto.randomBytes(6).toString('hex');
}

function newestFirst(facts) {
  return [...facts].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// ---- Who Sim Sim is (answered directly — never sent to a source check) ----
// forBot: a Discussion helper bot reads this as "the app you are part of", not as its own name.
function identityLines(forBot) {
  return [
    forBot ? 'ABOUT SIM SIM, the assistant whose team you are on (answer questions about it from this):'
      : 'ABOUT YOU (answer questions about yourself directly from this):',
    (forBot ? '- Sim Sim is' : '- You are Sim Sim,') + ' a personal AI assistant. Its founder is Hassan Ali — he created Sim Sim. It is an early prototype built for the Meta AI developer hackathon.',
    '- Sim Sim runs on Meta\'s Muse model. Its name is fixed; the user calls it by saying "Sim Sim".',
    '- What you can do: talk and listen (wake by name, speak answers), remember the user\'s life in their notebook, keep their open loops (tasks) until',
    '  they say they are done, give a morning briefing, check high-stakes facts against official sources and cite them, run a Discussion where the',
    '  user\'s team of three (you plus two helper bots) answers and the user picks the best, draw pictures, look at pictures and at a shared screen',
    '  (you can see, never click or type), and keep saved logins encrypted.',
    '- You have no awards, history or news beyond this. If asked about something you have no record of, say so plainly.'
  ].join('\n');
}

// How Sim Sim answers (founder, 2026-10-27): like Muse — answer first, verify what matters, never invent.
const ANSWER_RULES = '\n\nHow you answer:' +
  '\n- Answer first: give a real, direct answer from your own knowledge, in your own warm voice. Never refuse with a stock line.' +
  '\n- Say how sure you are when it matters ("I\'m not certain, but…"). If you truly don\'t know, say so in your own words and offer a next step.' +
  '\n- For high-stakes specifics you can\'t check right now — an exact law, fee, deadline, dose or official number — don\'t invent the figure:' +
  ' give what you know, say plainly that the exact detail should be verified, and say where to check.' +
  '\n- If asked about something you have no record of (a made-up event, award, person or rule), don\'t play along — say plainly you have no record of it.' +
  '\n- If the message is one word or unclear, reply naturally or ask one short clarifying question.';

// ---- What the brain reads before answering: profile basics + the notebook ----
// who: optional first line for a Group Chat helper bot (the default is Sim Sim itself).
function buildChatSystem(profile, facts, openLoops, who) {
  const name = profile ? profile.callName : 'the user';
  let s = (who || 'You are Sim Sim, ' + name + "'s personal assistant.") + ' Answer in short, warm, plain sentences. Be helpful.';
  s += '\n\n' + identityLines(!!who) + ANSWER_RULES;
  const d = new Date();
  s += '\n\nToday is ' + d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '.';
  if (profile) {
    s += '\n\nProfile basics: name ' + name + ' · gender: ' + profile.gender + ' · age: ' + profile.age + ' · lives in ' + profile.state + '.';
  }
  const list = newestFirst(facts).slice(0, MAX_FACTS_IN_CONTEXT).map(f => '- [' + f.category + '] ' + f.text).join('\n');
  s += '\n\n' + name + "'s notebook — the ONLY things you remember about " + name + "'s life (newest first):\n" + (list || '(nothing yet)');
  s += '\n\nMemory rules:' +
    '\n- For questions about ' + name + "'s own life (people, dates, places, plans, preferences, things they own), answer only from the profile basics and the notebook above." +
    '\n- If the answer is not there, say plainly that ' + name + " hasn't told you that yet. Never invent or guess a name, date, place or detail to sound like you remember. A false memory is worse than no memory." +
    '\n- Never repeat back, and never promise to keep, passwords, codes, PINs, card or account numbers, government IDs, or keys. If ' + name + " shares one, gently say you don't keep secrets like that." +
    "\n- Saving to the notebook happens separately — don't announce what you are saving.";
  if (openLoops) {
    const loopList = openLoops.map(l => '- ' + l.text + (l.dueDate ? ' (due ' + l.dueDate + ')' : '')).join('\n');
    s += '\n\n' + name + "'s OPEN LOOPS — things " + name + ' still has to do (soonest due first):\n' + (loopList || '(none — the list is clear)') +
      '\n\nLoop rules:' +
      '\n- When asked what they still have to do (their tasks, to-dos, deadlines), answer only from the open loops above, listing exactly those.' +
      ' If there are none, say: "Nothing — your list is clear." Never invent a task, a date or a loop.' +
      "\n- A loop closes only when " + name + " says it is done. Never say a task is done or closed unless they said so." +
      "\n- Keeping the list happens separately — don't announce that you added something to it.";
  }
  return s;
}

// ---- The extractor: one small Meta call that returns notebook operations as JSON ----
const EXTRACTOR_RULES = [
  'You keep a personal notebook of durable facts about the user. Reply with JSON only, no other text, in exactly this shape:',
  '{"ops":[{"op":"add","text":"...","category":"people|dates|places|preferences|possessions|plans"},{"op":"update","id":"f_...","text":"..."}]}',
  'Reply {"ops":[]} when there is nothing to learn.',
  'Rules:',
  '- Learn only DURABLE facts the user states about their own life that will still be true next week.',
  '- Learn from the user message only. The assistant reply is context, never a source of facts.',
  '- Never learn: questions, one-off requests, temporary states (tired, the weather, mood today), opinions about the assistant, or the profile basics (name, gender, age, state) — those are stored separately.',
  '- Never learn the user\'s tasks, to-dos, reminders or things they "have to"/"need to" do — those are kept separately as open loops.',
  '- Never learn secrets in any form: passwords, codes, PINs, card or account numbers, government IDs, API keys. If the message contains one, reply {"ops":[]}.',
  '- If a notebook fact already says the same thing, or the user corrects it, use "update" with that fact\'s id. Never add a second version of a fact.',
  '- At most 3 ops. Write each fact as one short plain sentence about the user, like "Sister\'s name is Ayesha" or "Ayesha\'s birthday is March 3". Keep names, dates and numbers exactly as the user said them. Never start a fact with "User" (write "Lives near Smyrna Lake", not "User lives near Smyrna Lake").',
  '- category must be one of: people, dates (birthdays, deadlines, appointments), places, preferences, possessions, plans.'
].join('\n');

// picked: Group Chat — the reply is the answer the USER picked, so facts about the user in it may be learned too.
function buildExtractorMessages(profile, facts, message, reply, picked) {
  const payload = {
    profile_basics: profile ? { name: profile.callName, gender: profile.gender, age: profile.age, state: profile.state } : null,
    notebook: newestFirst(facts).slice(0, MAX_FACTS_IN_CONTEXT).map(f => ({ id: f.id, text: f.text, category: f.category })),
    user_message: message,
    assistant_reply: reply
  };
  const rules = picked
    ? EXTRACTOR_RULES.replace('- Learn from the user message only. The assistant reply is context, never a source of facts.',
      '- Learn from the user message and from the assistant reply, which is the answer the user PICKED in Group Chat — but only durable facts about the user\'s own life.')
    : EXTRACTOR_RULES;
  return [
    { role: 'system', content: rules },
    { role: 'user', content: JSON.stringify(payload) }
  ];
}

// Turns the extractor's answer into checked operations. Anything odd is dropped.
function parseOps(content, facts) {
  if (typeof content !== 'string') return [];
  const start = content.indexOf('{'), end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed;
  try { parsed = JSON.parse(content.slice(start, end + 1)); } catch (e) { return []; }
  const ops = Array.isArray(parsed && parsed.ops) ? parsed.ops : [];
  const ids = new Set(facts.map(f => f.id));
  const out = [];
  for (const op of ops) {
    if (out.length >= MAX_NEW_PER_MESSAGE) break;
    if (!op || typeof op.text !== 'string') continue;
    const text = op.text.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 200 || looksSecret(text)) continue;
    if (op.op === 'update' && ids.has(op.id)) out.push({ op: 'update', id: op.id, text });
    else if (op.op === 'add' && CATEGORIES.includes(op.category)) out.push({ op: 'add', text, category: op.category });
  }
  return out;
}

function sameText(a, b) {
  const n = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return n(a) === n(b);
}

// Applies checked operations to a notebook. Returns what changed (for the "Remembered" chips).
function applyOps(book, ops) {
  const now = new Date().toISOString();
  const learned = [];
  for (const op of ops) {
    if (op.op === 'update') {
      const f = book.facts.find(x => x.id === op.id);
      if (!f) continue;
      if (f.text !== op.text) { f.text = op.text; f.updatedAt = now; learned.push({ id: f.id, text: f.text, change: 'updated' }); }
    } else {
      const twin = book.facts.find(x => sameText(x.text, op.text));
      if (twin) continue; // already known: never two versions
      const f = { id: newFactId(), text: op.text, category: op.category, source: 'chat', createdAt: now, updatedAt: now };
      book.facts.push(f);
      learned.push({ id: f.id, text: f.text, change: 'added' });
    }
  }
  return learned;
}

// ---- Forgetting by voice or text ----
const STOP = new Set(('a an the my his her their our your me i you it its that this these those about please of to for on in at is was are be ' +
  'and or what where when who how which do did does sim simsim thing things stuff just now again').split(' '));
const ALL_WORDS = new Set('everything all know told fact facts thing things about me you it of have ve that remember remembered'.split(' '));

function words(s) {
  return s.toLowerCase().replace(/['’]s\b/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(Boolean).map(w => (w.length > 3 ? w.replace(/s$/, '') : w));
}

// Returns null (not a forget command), { all: true }, or { query } (may be '' when it's unclear what to forget).
function parseForget(message) {
  const m = message.trim().match(/^(?:(?:hey|ok|okay|please|sim\s*sim)[,\s]+)*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?forget\b[\s,:-]*(.*?)[\s.!?]*$/i);
  if (!m) return null;
  const rest = m[1].replace(/\bplease\b/gi, '').trim();
  const w = words(rest);
  if ((w.includes('everything') || w.includes('all')) && w.every(x => ALL_WORDS.has(x) || STOP.has(x))) return { all: true };
  return { query: w.filter(x => !STOP.has(x)).join(' ') };
}

// Facts with the most query words in them. Several equally good -> the caller asks which.
// The last word counts a bit more: it is usually the thing itself ("my sister's BIRTHDAY", "my dog's NAME").
function matchFacts(facts, query) {
  const q = [...new Set(query.split(' ').filter(Boolean))];
  if (!q.length) return [];
  let best = 0, hits = [];
  for (const f of facts) {
    const fw = new Set(words(f.text + ' ' + f.category));
    const score = q.reduce((sum, x, i) => sum + (fw.has(x) ? (i === q.length - 1 ? 1.5 : 1) : 0), 0);
    if (score > best) { best = score; hits = [f]; } else if (score === best && score > 0) hits.push(f);
  }
  return best > 0 ? hits : [];
}

function plain(text) {
  return text.replace(/[.!?]+$/, ''); // keep names' capitals exactly as stored
}

module.exports = {
  CATEGORIES, looksSecret, wordCount, newFactId, newestFirst,
  identityLines, buildChatSystem, buildExtractorMessages, parseOps, applyOps,
  parseForget, matchFacts, plain
};
