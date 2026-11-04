// SIM SIM — the mishear dictionary (founder, 2026-11-04). Chrome's speech recognition hands over ONE final
// transcript — no alternatives, no confidence score — so when it mishears ("Sim Sim" heard as "Simpson"), nothing
// downstream ever knows unless this catches it first. `correct()` runs on every message in server.js's handleChat,
// right after the message text is assembled (voice transcript or typed) and before any routing/lane runs. The
// corrected text is what gets saved and shown — what the user meant is what the chat shows.
//
// correct(message, knownSpellings) -> { text, swaps, risky }
//   text   — the corrected message (the SAVED and SHOWN text).
//   swaps  — [{ from, to }] every hard swap actually applied (never a risky item — those are never swapped).
//   risky  — [{ word, note }] an ambiguous teen/ty number left untouched, with the note to hand the brain.
// knownSpellings (optional Set or array of strings, case-insensitive): a raw phrase already saved, verbatim, in
// the user's own profile or notebook is left alone — a saved spelling always wins over the dictionary's guess.
//
// Kind 3 (brain-only homophones — their/there/they're, your/you're, etc.) has NO dictionary entry here at all:
// there is nothing to swap, since both spellings are real words and only grammar/sense can tell them apart. That
// one lives entirely in memory.js's HEARING_RULES, read by the brain on every call.
'use strict';

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---- Safeguards: a swap must never fire inside quoted/verbatim text, code, a URL, an email, or a filename ----
function protectedSpans(text) {
  const spans = [];
  const push = m => { if (m) spans.push([m.index, m.index + m[0].length]); };
  for (const m of text.matchAll(/```[\s\S]*?```/g)) push(m);           // fenced code
  for (const m of text.matchAll(/`[^`]+`/g)) push(m);                   // inline code
  for (const m of text.matchAll(/"[^"]*"|“[^”]*”|'[^']{2,}'/g)) push(m);   // quoted spans — "the word the user is asking about"
  for (const m of text.matchAll(/\bhttps?:\/\/\S+/gi)) push(m);         // URLs
  for (const m of text.matchAll(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g)) push(m);   // emails
  for (const m of text.matchAll(/\b[\w-]+\.(?:js|ts|py|json|html?|css|png|jpe?g|webp|gif|svg|pdf|docx?|xlsx?|pptx?|txt|md|csv|mp4|webm|mov)\b/gi)) push(m); // filenames
  // "write/say/read/type/print ... exactly ...:" — everything from there to the end of the message is verbatim
  const exactly = text.match(/\b(?:write|say|read|type|print)\b[^.!?\n]{0,20}\bexactly\b\s*:?\s*/i);
  if (exactly) spans.push([exactly.index + exactly[0].length, text.length]);
  return spans;
}
function isProtected(idx, len, spans) {
  const end = idx + len;
  return spans.some(([a, b]) => idx < b && end > a);
}

// ---- Kind 1, §1: the assistant's own name — swapped ONLY when it reads as addressing Sim Sim, never as the
// topic. "hey Sim" keeps its greeting (Chrome sometimes drops the second "Sim"); every other entry is itself a
// full mishear of "Sim Sim". ----
const NAME_MAP = new Map([
  ['hey sim', 'hey Sim Sim'],
  ['simpsons', 'Sim Sim'], ['simpson', 'Sim Sim'], ['sim some', 'Sim Sim'], ['simsun', 'Sim Sim'],
  ['simson', 'Sim Sim'], ['sam sim', 'Sim Sim'], ['sim sam', 'Sim Sim'], ['seems sim', 'Sim Sim'], ['sinsim', 'Sim Sim']
]);
// Topic, not address — the founder's own two examples: "tell me about The Simpsons" and "what does Simpson mean".
// A heuristic, not real grammar: anything NOT matching one of these stays an address (the common case — Sim Sim is
// usually spoken TO, not about), so this only has to catch the "talking about it" shape, not every edge case.
const TOPIC_BEFORE = /\b(?:the|about|regarding|like|called|named|is|was|does|did|do)\s*$/i;
const TOPIC_AFTER = /^\s*(?:mean|means|family|episode|episodes|character|characters|show|cartoon|season|seasons)\b/i;
function isTopic(fullString, start, end) {
  return TOPIC_BEFORE.test(fullString.slice(Math.max(0, start - 24), start)) || TOPIC_AFTER.test(fullString.slice(end, end + 24));
}

// ---- Kind 1, §2: Sim Sim's own features ----
const FEATURE_MAP = new Map([
  ['screen wash', 'Screen Watch'],
  ['mourning briefing', 'Morning briefing'], ['morning breathing', 'Morning briefing'],
  ['open lube', 'open loops'], ['open ups', 'open loops'],
  ['dis cushion', 'Discussion'],
  ['your pitchers', 'Your pictures'],
  ['pair missions', 'Permissions'],
  ['myla', 'Mila'], ['milla', 'Mila'], ['meela', 'Mila']
]);

// ---- Kind 1, §3: Hassan's world — names, places, brands. A few entries are explicitly context-only in the
// founder's own ask (job context, project context, tech context, person's name) — those few get a light context
// check so an ordinary word ("a boss told me", "I heard snoring") isn't rewritten; the rest are unusual enough as
// phrases that a plain swap is the right call, same as the project's existing dictionary-style corrections
// elsewhere (wake.js's WAKE_FORMS is the same kind of plain phrase match). ----
const WORLD_MAP = new Map([
  ['su maya', 'Summaiya'], ['sumaya', 'Summaiya'], ['sue maya', 'Summaiya'],
  ['a boss', 'Abbas'], ['a bas', 'Abbas'],
  ['it rat', 'Itrat'], ['eat rat', 'Itrat'],
  ['smear na', 'Smyrna'], ['smir na', 'Smyrna'],
  ['la verne', 'La Vergne'], ['la vern', 'La Vergne'], ['la burn', 'La Vergne'],
  ["murphy's borough", 'Murfreesboro'],
  ['twice dailies', 'Twice Daily'], ['twice day lee', 'Twice Daily'],
  ['try star', 'Tri Star'],
  ['pay loss city', 'Paylocity'],
  ['door dash', 'DoorDash'],
  ['ven mo', 'Venmo'],
  ['kava', 'CAVA'],
  ['snores', 'Snurs'], ['sners', 'Snurs'],
  ['cere bull valley', 'Cerebral Valley'],
  ['pork bun', 'Porkbun'],
  ['meda', 'Meta'],
  ['mews', 'Muse'],
  ['clod', 'Claude'], ['clawed', 'Claude'],
  ['get hub', 'GitHub'],
  ['tail scale', 'Tailscale'],
  ['local host', 'localhost'],
  ['super base', 'Supabase'],
  ['cloud flare', 'Cloudflare'],
  ['fire base', 'Firebase'],
  ['rep lit', 'Replit']
]);
// "(job context)" / "(project context)" / "(tech context)" / "(model/API context)" / "(build context)" entries:
// fire only when the rest of the MESSAGE also carries a plain signal of that context — cheap and conservative,
// not real NLU. "a boss"/"a bas" ("as a person's name"): fires only right after a verb a name would follow.
const TECH_GUARDED = new Set(['kava', 'snores', 'sners', 'meda', 'mews', 'clod', 'clawed']);
const TECH_CONTEXT = /\b(?:api|code|coding|github|repo|app|model|models|project|build|building|deploy|server|claude|meta|muse|sim\s*sim|key|auth|database|bug|feature|prompt|hackathon|job|interview|work|working)\b/i;
function hasTechContext(fullString) { return TECH_CONTEXT.test(fullString); }
const PERSON_GUARDED = new Set(['a boss', 'a bas']);
const PERSON_VERB_BEFORE = /\b(?:message|messaged|text|texted|tell|told|call|called|ask|asked|remind|reminded|invite|invited|and|with|is|was)\s*$/i;
function hasPersonContext(fullString, start) { return PERSON_VERB_BEFORE.test(fullString.slice(Math.max(0, start - 20), start)); }

// ---- Kind 1, §4: number-phrase repairs — ONLY inside a clear number phrase. "tree" is narrower still (clock
// times only, per the founder's ask); "oh" fires only between two other number-ish tokens ("five oh five"),
// a scoped-down reading of the "long numbers" example that stops short of merging a full H:MM time, which this
// build leaves out as untested and out of scope. ----
const DIGIT_WORDS = { ate: '8', won: '1', to: '2', too: '2', for: '4' };
const NUMBER_WORD_SET = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']);
function textBefore(fullString, idx) { return fullString.slice(Math.max(0, idx - 24), idx); }
function textAfter(fullString, idx) { return fullString.slice(idx, idx + 24); }
const LEFT_NUM_TRIGGER = /\b(?:in|at|by|remind\s+me)\s*$/i;
const DOLLAR_BEFORE = /\$\s*$/;
const RIGHT_NUM_TRIGGER = /^\s*(?:minutes?|hours?|dollars?|cents?|pm|am|o'?clock|percent)\b/i;
function numberContextOk(fullString, idx, len) {
  return LEFT_NUM_TRIGGER.test(textBefore(fullString, idx)) || DOLLAR_BEFORE.test(textBefore(fullString, idx)) ||
    RIGHT_NUM_TRIGGER.test(textAfter(fullString, idx + len));
}
const LEFT_CLOCK_TRIGGER = /\b(?:at|remind\s+me)\s*$/i;
const RIGHT_CLOCK_TRIGGER = /^\s*(?:pm|am|o'?clock)\b/i;
function clockContextOk(fullString, idx, len) {
  return LEFT_CLOCK_TRIGGER.test(textBefore(fullString, idx)) || RIGHT_CLOCK_TRIGGER.test(textAfter(fullString, idx + len));
}
function neighborWord(text) {
  const m = text.match(/^[^a-z0-9]*([a-z']+|\d+)/i);
  return m ? m[1].toLowerCase() : '';
}
function isNumberish(w) { return NUMBER_WORD_SET.has(w) || /^\d+$/.test(w); }
// "oh" fires only when the word right before AND the word right after are both number-ish ("five oh five") —
// a scoped-down reading of "inside times and long numbers" (see the file header note on the full H:MM merge).
function ohContextOk(fullString, idx, len) {
  const beforeWord = (textBefore(fullString, idx).match(/([a-z0-9']+)\s*$/i) || [, ''])[1].toLowerCase();
  const afterWord = neighborWord(textAfter(fullString, idx + len));
  return isNumberish(beforeWord) && isNumberish(afterWord);
}

// ---- Kind 2: risky teen/ty pairs — NEVER hard-swapped, only flagged for the brain ----
const RISKY_PARTNER = {
  fifteen: 'fifty', fifty: 'fifteen', sixteen: 'sixty', sixty: 'sixteen',
  seventeen: 'seventy', seventy: 'seventeen', eighteen: 'eighty', eighty: 'eighteen',
  nineteen: 'ninety', ninety: 'nineteen'
};
const TEEN_FORM = { fifteen: 'fifteen', fifty: 'fifteen', sixteen: 'sixteen', sixty: 'sixteen', seventeen: 'seventeen', seventy: 'seventeen', eighteen: 'eighteen', eighty: 'eighteen', nineteen: 'nineteen', ninety: 'nineteen' };

// ---- The combined pass: ONE regex alternation, ONE String.replace() over the ORIGINAL text, so every match's
// offset is always relative to the real, untouched message — never thrown off by an earlier replacement in the
// same pass (sequential independent passes would drift as the string's length changes). ----
let COMBINED_RE = null;
function buildCombinedRegex() {
  if (COMBINED_RE) return COMBINED_RE;
  const phrases = [...NAME_MAP.keys(), ...FEATURE_MAP.keys(), ...WORLD_MAP.keys()];
  const words = [...Object.keys(DIGIT_WORDS), 'tree', 'oh', ...Object.keys(RISKY_PARTNER)];
  const all = [...phrases, ...words].sort((a, b) => b.length - a.length);
  const source = all.map(p => escapeRegExp(p).replace(/\\?\s+/g, '\\s+')).join('|');
  COMBINED_RE = new RegExp('\\b(?:' + source + ')\\b', 'gi');
  return COMBINED_RE;
}

function correct(message, knownSpellings) {
  if (typeof message !== 'string' || !message) return { text: typeof message === 'string' ? message : '', swaps: [], risky: [] };
  const spans = protectedSpans(message);
  // A raw mishear phrase that already appears, verbatim, somewhere in the user's own saved profile/notebook text
  // (not necessarily AS its own fact — a fact mentioning it is enough) means they've typed it that way before;
  // their own spelling wins, so it's checked as a SUBSTRING of everything known, not an exact-entry match.
  const knownList = (knownSpellings instanceof Set ? [...knownSpellings] : Array.isArray(knownSpellings) ? knownSpellings : [])
    .map(s => String(s).toLowerCase());
  const knownBlob = '\n' + knownList.join('\n') + '\n';
  const swaps = [];
  const riskySeen = new Set();
  const risky = [];
  const regex = buildCombinedRegex();
  const text = message.replace(regex, (match, offset, fullString) => {
    if (isProtected(offset, match.length, spans)) return match;
    const lower = match.toLowerCase().replace(/\s+/g, ' ');
    // "the saved spelling wins" is a Kind-1-§3 safeguard only (Hassan's world — names, places, brands): a PERSON
    // can have more than one legitimate spelling, so a name they've already typed their own way should stand. The
    // assistant's own name and its own feature names have no such ambiguity — there is no alternate "saved
    // spelling" of Sim Sim or Screen Watch, so this check must never reach §1/§2, where it could otherwise suppress
    // a real correction just because an OLD, still-misheard note happens to contain the same mishaired words
    // (exactly how an earlier build's own test facts could keep "Simpson" or "screen wash" from ever correcting).

    if (RISKY_PARTNER[lower]) {
      if (!riskySeen.has(lower)) {
        riskySeen.add(lower);
        const teen = TEEN_FORM[lower], ty = RISKY_PARTNER[teen];
        risky.push({ word: match, note: 'the word "' + match + '" could be ' + teen + ' or ' + ty + ' — if it carries the action, read it back in digits' });
      }
      return match;
    }
    if (NAME_MAP.has(lower)) {
      if (isTopic(fullString, offset, offset + match.length)) return match;
      const to = NAME_MAP.get(lower);
      swaps.push({ from: match, to });
      return to;
    }
    if (FEATURE_MAP.has(lower)) {
      const to = FEATURE_MAP.get(lower);
      swaps.push({ from: match, to });
      return to;
    }
    if (WORLD_MAP.has(lower)) {
      if (knownBlob.includes(lower)) return match;   // the user's own saved spelling wins — never overridden
      if (TECH_GUARDED.has(lower) && !hasTechContext(fullString)) return match;
      if (PERSON_GUARDED.has(lower) && !hasPersonContext(fullString, offset)) return match;
      const to = WORLD_MAP.get(lower);
      swaps.push({ from: match, to });
      return to;
    }
    if (lower === 'tree') {
      if (!clockContextOk(fullString, offset, match.length)) return match;
      swaps.push({ from: match, to: '3' });
      return '3';
    }
    if (Object.prototype.hasOwnProperty.call(DIGIT_WORDS, lower)) {
      if (!numberContextOk(fullString, offset, match.length)) return match;
      const to = DIGIT_WORDS[lower];
      swaps.push({ from: match, to });
      return to;
    }
    if (lower === 'oh') {
      if (!ohContextOk(fullString, offset, match.length)) return match;
      swaps.push({ from: match, to: '0' });
      return '0';
    }
    return match;
  });
  return { text, swaps, risky };
}

module.exports = { correct };
