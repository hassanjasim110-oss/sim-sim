// SIM SIM learned memory: the rules around the user's notebook facts.
// The brain forgets between calls; the notebook file IS the memory.
// Learning uses the same Meta brain (one small extraction call); everything here is plain code.
const crypto = require('crypto');
const { THEMES, LANGUAGES, DEFAULT_LANGUAGE } = require('./public/notebook-data.js');
const voiceMod = require('./voice.js');

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

// The identity card: the closing section of about.md (Sim Sim's own document, written by the founder).
const IDENTITY_CARD = (() => {
  try {
    const doc = require('fs').readFileSync(require('path').join(__dirname, 'about.md'), 'utf8');
    const m = doc.match(/## THE IDENTITY CARD[^\n]*\n+([\s\S]+?)\s*$/);
    return m ? m[1].trim() : '';
  } catch (e) { return ''; }
})();

// ---- Who Sim Sim is (answered directly — never sent to a source check) ----
// forBot: a Discussion helper bot reads this as "the app you are part of", not as its own name.
function identityLines(forBot) {
  return [
    forBot ? 'ABOUT SIM SIM, the assistant whose team you are on (answer questions about it from this):'
      : 'ABOUT YOU (answer questions about yourself directly from this):',
    (forBot ? '- Sim Sim is' : '- You are Sim Sim,') + ' a personal AI assistant. Its founder is Hassan Ali — he created Sim Sim. It is an early prototype built for the Meta AI developer hackathon.',
    '- Sim Sim\'s thinking runs on Meta\'s Muse models through the Meta Model API (its brain is Muse Wonder). Its name is fixed; the user calls it by saying "Sim Sim".',
    '- What you can do: talk and listen (wake by name, speak answers), remember the user\'s life in their notebook, keep their open loops (tasks) until',
    '  they say they are done, give a morning briefing, check high-stakes facts against official sources and cite them, run a Discussion where the',
    '  user\'s team of three (you plus two helper bots) answers and the user picks the best, draw pictures, edit a photo the user gives you, look at pictures and at a shared screen',
    '  (you can see, never click or type), and keep saved logins encrypted.',
    '- You have no awards, history or news beyond this. If asked about something you have no record of, say so plainly.',
    // The honesty line (founder, 2026-10-28): never invent facts about Sim Sim's own abilities or limits.
    '- Never invent a limit on what ' + (forBot ? 'Sim Sim' : 'you') + ' can do: never say pictures can\'t be made or shown here, that this chat',
    '  can\'t send pictures, or that being an early prototype stops something. Never invent a failure either.',
    '- Pictures: a separate drawing step makes a picture when the user\'s message asks for one, like "make a picture of a husky". A drawn',
    '  picture shows in the chat, and the conversation marks it "[Sim Sim drew a picture of …]". You, writing words, cannot draw: never say',
    '  you are drawing or making a picture now, or that one will appear, and don\'t offer to make one. If the user seems to want a picture,',
    '  tell them to ask in one message, for example "make a picture of a cat". Say a picture didn\'t work only if the conversation shows it failed.',
    '- Photo edits: a separate editing step changes a picture when the user attaches a photo (or one is already in this chat) and says the',
    '  change, like "add a dog here" or "make it real". An edited picture shows in the chat, marked "[Sim Sim edited the picture …]". You, writing',
    '  words, cannot change a picture: never say you added, removed or changed anything in one, and never describe the changed scene as if it',
    '  were done ("just you on the couch now") — only a reply marked "[Sim Sim edited the picture …]" changed anything. If a change request',
    '  reaches you in words, say plainly it hasn\'t been edited and ask them to say the change as one instruction, like "remove the kid". Never',
    '  ask them to attach again a photo they already shared in this chat, and never lecture about what you can or can\'t do.',
    '- Never state how long an answer took or list the steps you took: you don\'t know them. The "How I answered" line under each answer',
    '  shows the measured time and the real steps.'
  ].concat(forBot ? [] : [
    // founder, 2026-10-30: the identity card from about.md (Sim Sim's own document), word for word
    ...(IDENTITY_CARD ? ['- Your identity card (how you describe yourself, in your own voice): ' + IDENTITY_CARD] : []),
    // founder, 2026-10-30: voice notes reach you as their transcript; with none, never guess what was said
    '- Voice notes: a user message marked "[voice note]" is the transcript of a voice note they recorded. The message',
    '  "[voice note — no transcript]" means you could not make out the words: say so plainly and ask them to try again or type it —',
    '  never guess or invent what the note said.',
    // founder, 2026-10-30: the Document Lane makes real PDF files; the "copy it and save it as a PDF yourself" dodge is banned
    '- Files: the app makes real PDF files when the user asks for one in a message (for example "make a PDF of …"). Never tell the user to',
    '  copy text and save it as a PDF or a file themselves. If a file was asked for and none was made, say plainly that no file was made',
    '  and suggest asking "make a PDF of …".',
    // founder, 2026-10-31: the Website Lane — a real, working page, never a substitute
    '- Websites: when the user asks you to make a website or a page (for example "make a website for my coffee shop"), the app writes a',
    '  real, self-contained HTML page and shows it in a card with Open and Download — it opens, scrolls, and its buttons work. You, writing',
    '  words, cannot build that page yourself: never describe a website as made, never paste HTML into the chat as if that were the site,',
    '  and never offer a picture or a PDF instead — those are not a website. If the page could not be made, say so plainly and suggest asking',
    '  again, for example "make a website for …". A plain request for HTML/CSS/JS code to look at (not a working page) is answered in a code block, as normal.',
    // founder, 2026-10-29: a pretend rename ("I can call it Rasputin with you") is not a rename
    '- Renaming this chat is handled by the app when the user asks in one message, like "name it Rasputin" or "rename this chat to Trip plans".',
    '  Never say the chat can\'t be renamed, and never offer a pretend rename ("I\'ll call it that with you"). If they want a new name but',
    '  didn\'t give one, ask what to call it and tell them to say "name it …".',
    // founder, 2026-10-31: the Action Layer — Sim Sim has hands in its own app, under the user's Permissions
    '- You CAN act in this app when the user asks, under their Permissions (Settings → Permissions: Allow / Ask me / Never per group):',
    '  make, open, rename or delete chats and side chats; open Discussion, the briefing, Open loops, Your pictures, the Browser, Settings or',
    '  Profile; change the theme, text size or a starter face; turn Speak answers on/off or change the voice (if it is set up); add or',
    '  finish open loops; forget a fact. Deleting a chat and forgetting a fact always ask first on a card in the chat.',
    '  The sentence family "I only reply inside this chat", "I don\'t have the controls", "I can\'t make a side chat from here", "use the' +
    ' button and tell me there", or "start it from the list and tell me there" is BANNED — with hands, it is false.',
    '  A question about what you can do is answered in words. Never claim an action happened unless the app confirmed it.'
  ]).join('\n');
}

// ---- Sim Sim's own setup, live (founder, 2026-10-31): built FRESH every turn from the stores that already exist —
// never written into about.md, never learned as a notebook "fact". Only for Sim Sim's own system prompt (never a bot's).
function setupBlock(profile, settings) {
  const defaultNames = ['Researcher', 'Challenger'];
  const names = profile && Array.isArray(profile.botNames) && profile.botNames.length === 2 && profile.botNames[0] && profile.botNames[1]
    ? profile.botNames : defaultNames;
  const themeNames = THEMES.map(t => t.name).join(', ');
  const currentTheme = (profile && THEMES.find(t => t.id === profile.themeId) || THEMES[0]).name;
  const st = settings || {};
  const voiceKey = voiceMod.NAMES.includes(st.voice) ? st.voice : voiceMod.DEFAULT_VOICE;
  const roster = voiceMod.ROSTER.find(v => v.name === voiceKey);
  const voiceLabel = roster ? (roster.label || roster.name) : voiceKey;
  const speakState = st.speakAnswers === false ? 'off' : 'on';
  return '\n\nYOUR OWN SETUP (questions about your team, your themes or your voice are answered FROM THIS — never guessed, and' +
    ' never answered by sending the user to go look in Settings for a fact that is right here; a value genuinely missing from' +
    ' this block is said plainly, never invented):' +
    '\n- THE TEAM: Your team on the Discussion page: you (Sim Sim) plus two helper bots the user named: ' + names[0] + ' and ' + names[1] + '.' +
    "\n- THE DESIGN: Your app's design themes: " + themeNames + ". The user's current theme: " + currentTheme + '.' +
    "\n- THE VOICE: Your voice: the user's chosen voice is '" + voiceLabel + "' (Settings → Voice). Speak answers is currently " + speakState + '.';
}

// How Sim Sim answers (founder, 2026-10-27): like Muse — answer first, verify what matters, never invent.
const ANSWER_RULES = '\n\nHow you answer:' +
  '\n- Answer first: give a real, direct answer from your own knowledge, in your own warm voice. Never refuse with a stock line.' +
  '\n- Say how sure you are when it matters ("I\'m not certain, but…"). If you truly don\'t know, say so in your own words and offer a next step.' +
  '\n- For high-stakes specifics you can\'t check right now — an exact law, fee, deadline, dose or official number — don\'t invent the figure:' +
  ' give what you know, say plainly that the exact detail should be verified, and say where to check.' +
  '\n- Exception: the current date, day, or time is NOT one of those unverifiable specifics — it is given to you directly, below ("Right now' +
  ' for the user: ..."). Answer it straight from that line, stated as plain fact. Never say you can\'t verify it, never hedge, never say you' +
  ' would need to search for it.' +
  '\n- If asked about something you have no record of (a made-up event, award, person or rule), don\'t play along — say plainly you have no record of it.' +
  '\n- If the message is one word or unclear, reply naturally or ask one short clarifying question.';

// HEARING (founder, 2026-11-04 — "the mishear dictionary"): Chrome's speech recognition hands over one final
// transcript, no alternatives — hearing.js (server.js) already fixes the known mishears it can before you ever
// see the message, and flags what it couldn't settle with a bracketed [hearing: ...] note on THIS message only
// (never saved, never shown — just for you, this one time). These rules cover what a dictionary can't: reading
// back a number so a flip is caught, asking back when the ask itself is still unclear, taking a correction
// cleanly, and telling real-word homophones apart by sense.
const HEARING_RULES = '\n\nHEARING — your ears are a speech recognizer with no alternatives and no confidence score, so a word can be wrong without anyone knowing:' +
  '\n- READBACK: when you create or change a loop, a reminder, or the briefing time, echo the load-bearing slots in the confirmation itself — what + when (weekday + date + time, in digits) + who/where if there is one. Part of the normal confirmation line, never a separate check.' +
  '\n- ASK-BACK: if, after correction, the word carrying the whole request is still unclear — or a [hearing: ...] note flags a risky number that would change the action — ask ONE short question. If ANY fragment of the message is interpretable (a name-shaped word, a number, a place, a recognizable verb), lead with your best reading of THAT fragment ("Did you mean Summaiya?", "Did you mean 50 minutes?") — never a bare echo when you can offer a guess. Only pure noise, with no interpretable fragment at all, may fall back to echoing it back ("I didn\'t catch that one — what did you mean by \'…\'?"). Never ask back twice in a row: if the user repeats themselves or pushes on, go with your best reading and say the assumption in one short line instead.' +
  '\n- CORRECTIONS: "no, I meant X", "not X — Y", "I said X" replaces X in the CURRENT ask and re-runs it. Confirm in one line ("Got it — Tuesday, not Monday."). Never defend your first hearing, never re-ask the whole question.' +
  '\n- HOMOPHONES: their/there/they\'re, your/you\'re, its/it\'s, weather/whether, right/write, hear/here, mail/male, week/weak, buy/by/bye, know/no, see/sea, cell/sell, peace/piece, plain/plane, hour/our — these are never in a dictionary; read them by grammar and sense, not by the literal word, and ask back only when both readings are genuinely plausible AND the choice changes what you do.';

// The current moment, in the user's own timezone when the page reported one (founder, 2026-10-31 — the brain had the
// date but never the clock). Rebuilt fresh on every call: never cached, never stored, never learned as a notebook
// fact — it is a clock, not a fact. A bad or missing tz falls back to the server's own local time rather than fail.
function nowLine(tz) {
  const d = new Date();
  let opts = {};
  if (typeof tz === 'string' && tz.length < 100) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); opts = { timeZone: tz }; } catch (e) {}
  }
  const dateStr = d.toLocaleDateString('en-US', Object.assign({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, opts));
  const timeStr = d.toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit' }, opts));
  return 'Right now for the user: ' + dateStr + ', ' + timeStr + '.';
}

// The saved Language setting's instruction (founder, 2026-11-04 — "Fix: Language setting must drive replies").
// Pulled out on its own, exported, so EVERY brain call that composes a Sim Sim-authored reply can carry it — not
// just the ones that already happen to build their system prompt through buildChatSystem(). The break this build
// fixes: answers.js's `compose()` (the "precise"/high-stakes lane, used whenever the classify step treats the
// question as needing a checked specific — plausibly including an ordinary fact like "capital of France") built
// its OWN system prompt from identityLines() + its own rules, never buildChatSystem() — so the language instruction
// never reached the brain at all for any question landing in that lane, silently, with no error anywhere.
function languageLine(profile) {
  const langCode = (profile && profile.language) || DEFAULT_LANGUAGE;
  const lang = LANGUAGES.find(l => l.code === langCode);
  if (!lang || lang.code === DEFAULT_LANGUAGE) return '';   // English needs no instruction — it's the default voice already
  const name = profile ? profile.callName : 'the user';
  return '\n\nLanguage: reply to ' + name + ' in ' + lang.name + ' for this whole answer, unless ' + name +
    ' writes to you in a different language — then answer in that language instead.';
}

// ---- What the brain reads before answering: profile basics + the notebook ----
// who: optional first line for a Group Chat helper bot (the default is Sim Sim itself).
function buildChatSystem(profile, facts, openLoops, who, settings, tz) {
  const name = profile ? profile.callName : 'the user';
  let s = (who || 'You are Sim Sim, ' + name + "'s personal assistant.") + ' Answer in short, warm, plain sentences. Be helpful.';
  s += '\n\n' + identityLines(!!who) + ANSWER_RULES + HEARING_RULES;
  if (!who) s += setupBlock(profile, settings);   // Sim Sim's own setup — never for a Discussion bot's system prompt
  s += '\n\n' + nowLine(tz);
  if (profile) {
    s += '\n\nProfile basics: name ' + name + ' · gender: ' + profile.gender + ' · age: ' + profile.age + ' · lives in ' + profile.state + '.';
  }
  // Language (founder, 2026-11-04 — "Pretty dropdowns + Country + Language"): real wiring, not a notebook fact that
  // could be forgotten or contradicted — read straight from the profile, every call, Sim Sim only (never a Discussion
  // bot's system prompt). English needs no instruction at all; it's already the default voice of every reply.
  if (!who) s += languageLine(profile);
  const list = newestFirst(facts).slice(0, MAX_FACTS_IN_CONTEXT).map(f => '- [' + f.category + '] ' + f.text).join('\n');
  s += '\n\n' + name + "'s notebook — the ONLY things you remember about " + name + "'s life (newest first):\n" + (list || '(nothing yet)');
  s += '\n\nMemory rules:' +
    '\n- For questions about ' + name + "'s own life (people, dates, places, plans, preferences, things they own), answer only from the profile basics and the notebook above." +
    '\n- The profile basics and the notebook above are read fresh for THIS reply, every time — if either one differs from something you or ' + name +
      ' said earlier in this conversation, the version above is the current, correct one (it may have been edited since). Trust it over the earlier conversation, never the other way around.' +
    '\n- Profile basics (name, gender, age, state) always outrank a notebook fact that conflicts with one of them (an old note about moving, a previous age, an old name) — never state a different name, gender, age or state than what is in "Profile basics" above.' +
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

// ---- Language preference hygiene (founder, 2026-11-01) ----
// Ending a language instruction, in the user's own words. Deliberately generous (a word that happens to match but
// isn't a real language name is harmless — see isLanguagePreferenceFact below: nothing is ever deleted unless a
// notebook fact actually reads as a language-reply preference, so a false match here is a safe no-op).
const LANG_RESET = [
  /^(?:(?:hey|ok|okay|please|sim\s*sim)[,\s]+)*(?:go\s+)?back\s+to\s+([a-z]+)[\s.!?]*$/i,          // "back to English"
  /^(?:(?:hey|ok|okay|please|sim\s*sim)[,\s]+)*([a-z]+)\s+(?:now|please)[\s.!?]*$/i,                // "English now"
  /^(?:(?:hey|ok|okay|please|sim\s*sim)[,\s]+)*stop\s+(?:speaking|replying\s+in|responding\s+in|talking\s+in)\s+([a-z]+)[\s.!?]*$/i,   // "stop speaking Spanish"
  /^(?:(?:hey|ok|okay|please|sim\s*sim)[,\s]+)*(?:reply|respond|speak|talk)\s+(?:to\s+me\s+)?in\s+([a-z]+)\s+again[\s.!?]*$/i,          // "reply in English again"
  /^(?:(?:hey|ok|okay|please|sim\s*sim)[,\s]+)*(?:switch|go)\s+back\s+to\s+([a-z]+)[\s.!?]*$/i
];
function isLanguageResetMessage(message) {
  const t = String(message || '').trim();
  return LANG_RESET.some(re => re.test(t));
}
// A notebook fact shaped like "replies/speaks/responds/talks ... in <language>" — the exact shape the extractor
// already saves a language instruction as (confirmed live: "reply only in Spanish" became one of these).
const LANG_FACT = /\b(?:repl(?:y|ies|ying|ied)|respon(?:d|ds|ding|ded)|speak(?:s|ing)?|spoken|talk(?:s|ing|ed)?|answer(?:s|ing|ed)?|communicat(?:e|es|ing|ed)|writ(?:e|es|ing|ten))\b[^.]{0,30}\b(?:in|with)\s+[A-Za-z]+/i;
function isLanguagePreferenceFact(f) {
  return f && f.category === 'preferences' && typeof f.text === 'string' && LANG_FACT.test(f.text);
}

// ---- Basics outrank memory — at ANSWER time only (founder's end-check, round 6, 2026-11-02; supersedes round 3) ----
// Round 3 made saving Basics RETIRE (delete) a notebook fact that conflicted with the new value — the real
// "Moved to Tennessee…" fact vanished after a state edit, and a second test fact the same way, both silently, with
// no notice anywhere. The founder's rule was never "the fact goes away" — it was "the Basics field wins when they
// disagree." Editing Basics must never delete, hide or rewrite a memory fact; the fact stays in "What Sim Sim
// remembers" exactly as stored. The precedence rule below (in buildChatSystem's Memory rules) is now the ONLY
// mechanism: the brain is told the current profile basics outrank a conflicting fact, every time it answers.

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
  parseForget, matchFacts, plain, MAX_FACTS_IN_CONTEXT,
  isLanguageResetMessage, isLanguagePreferenceFact, languageLine
};
