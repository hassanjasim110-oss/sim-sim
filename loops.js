// SIM SIM open loops: the follow-through engine's rules (plain code).
// A loop stays open until the USER says it is done. Nothing here ever closes or deletes a loop on its own.
const crypto = require('crypto');

const MAX_NEW_PER_MESSAGE = 2;
const GUARDIAN_DAYS = 2; // due within 2 days, due today, or overdue

// ---- Dates: always the server's local calendar day, as 'YYYY-MM-DD' ----
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function today() { return ymd(new Date()); }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
function daysUntil(dateStr, from = today()) { return Math.round((new Date(dateStr + 'T12:00:00') - new Date(from + 'T12:00:00')) / 86400000); }
function validYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(new Date(s + 'T12:00:00')) === s; }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// The user's own words for a due date -> a real date, or null when it can't be read. Never guesses.
function resolveDue(phrase, from = today()) {
  if (typeof phrase !== 'string') return null;
  let p = phrase.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\b(by|on|before|until|due|this coming|this|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!p) return null;
  if (validYmd(p)) return p;
  if (/^(today|tonight|this evening|end of (the )?day)$/.test(p)) return from;
  if (/^tomorrow( night| morning| evening)?$/.test(p)) return addDays(from, 1);
  if (/^day after tomorrow$/.test(p)) return addDays(from, 2);
  if (/^(next week|in a week)$/.test(p)) return addDays(from, 7);
  let m = p.match(/^in (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (day|days|week|weeks)$/);
  if (m) { const n = NUMBERS[m[1]] || Number(m[1]); return addDays(from, m[2].startsWith('week') ? n * 7 : n); }
  if (/^end of (the )?month$/.test(p)) { const d = new Date(from + 'T12:00:00'); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)); }
  m = p.match(/^(next )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*$/);
  if (m) {
    const want = WEEKDAYS.findIndex(w => w.startsWith(m[2].slice(0, 3)));
    const now = new Date(from + 'T12:00:00').getDay();
    let diff = (want - now + 7) % 7;
    if (m[1] && diff === 0) diff = 7;
    return addDays(from, diff);
  }
  // "november 18", "nov 18th", "18 november", "november 18 2026"
  m = p.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/) || p.match(/^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)(?: (\d{4}))?$/);
  if (m) {
    const [mon, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const mi = MONTHS.indexOf(mon.slice(0, 3));
    if (mi >= 0) return withYear(mi + 1, Number(day), m[3], from);
  }
  // "11/18", "11/18/2026"
  m = p.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) return withYear(Number(m[1]), Number(m[2]), m[3] && (m[3].length === 2 ? '20' + m[3] : m[3]), from);
  return null;
}
// No year given: this year, unless that date is long gone (then next year).
function withYear(month, day, year, from) {
  const y = year ? Number(year) : Number(from.slice(0, 4));
  let s = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  if (!validYmd(s)) return null;
  if (!year && daysUntil(s, from) < -60) s = (y + 1) + s.slice(4);
  return validYmd(s) ? s : null;
}

// ---- Lists ----
function openSorted(loops) {
  // soonest due first; loops with dates before loops without; no-date loops in the order they were made
  return loops.filter(l => l.status === 'open').sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
function closedSorted(loops) { return loops.filter(l => l.status === 'done').sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt))); }

function newLoop(text, dueDate) {
  return { id: 'l_' + crypto.randomBytes(6).toString('hex'), text, dueDate: dueDate || null, createdAt: new Date().toISOString(), status: 'open', closedAt: null };
}
function close(loop) { loop.status = 'done'; loop.closedAt = new Date().toISOString(); }

function cleanText(t) {
  const s = typeof t === 'string' ? t.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '') : '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Words for matching ("calling the landlord" ~ "Call the landlord") ----
const STOP = new Set(('a an the my his her their our your me i you it its that this to for on of in at is was are be and or with ' +
  'about please just now already all sim simsim done finished complete completed mark loop task thing one').split(' '));
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
function words(s) {
  return s.toLowerCase().replace(/['’]s\b/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).map(stem);
}
function sameTask(a, b) { const x = words(a).join(' '), y = words(b).join(' '); return !!x && x === y; }

// Open loops that best match what the user named. Several equally good -> the caller asks which.
function matchLoops(open, query) {
  const q = [...new Set(words(query))];
  if (!q.length) return [];
  let best = 0, hits = [];
  for (const l of open) {
    const lw = new Set(words(l.text));
    const score = q.reduce((sum, x, i) => sum + (lw.has(x) ? (i === q.length - 1 ? 1.5 : 1) : 0), 0);
    if (score > best) { best = score; hits = [l]; } else if (score === best && score > 0) hits.push(l);
  }
  return best > 0 ? hits : [];
}

// ---- Done-phrases (plain code, checked before anything else in chat) ----
// Returns null (not a done-phrase) or { task } — task is '' for "that's done" (no task named).
function parseDone(message) {
  let t = message.trim().replace(/^(?:(?:hey|ok|okay|so|well|yes|yeah|sim\s*sim)[,\s]+)+/i, '').replace(/[\s.!]+$/, '').trim();
  let m;
  if (/^(?:that'?s|that is|it'?s|it is|this is|all) (?:done|finished|complete|completed|taken care of)$/i.test(t) || /^done$/i.test(t)) return { task: '' };
  if ((m = t.match(/^(?:i'?m |i am |we'?re )?(?:all )?(?:done|finished) with (.+)$/i))) return { task: m[1] };
  if ((m = t.match(/^(?:please )?(?:mark|check off|cross off|tick off|close) (.+?)(?: (?:as )?(?:done|complete|completed|finished))?$/i)) && !/^(?:it|that|this)$/i.test(m[1])) return { task: m[1] };
  if (/^(?:please )?(?:mark|close) (?:it|that|this)(?: (?:as )?(?:done|complete|completed|finished))?$/i.test(t)) return { task: '' };
  if ((m = t.match(/^(?:i )?(?:finished|completed) (.+)$/i))) return { task: m[1] };
  if ((m = t.match(/^(.+?) (?:is|are) (?:done|finished|complete|completed|taken care of)$/i)) && !/^(?:it|that|this|everything)$/i.test(m[1])) return { task: m[1] };
  return null;
}

// ---- The loop extractor (one small Meta call; returns JSON operations) ----
const EXTRACTOR_RULES = [
  "You keep the user's list of OPEN LOOPS — their own unfinished tasks and commitments. Reply with JSON only, no other text:",
  '{"ops":[{"op":"add","text":"...","due":"..."},{"op":"update","id":"l_...","due":"..."}]}',
  'Reply {"ops":[]} when there is nothing to add.',
  'Rules:',
  '- Add a loop ONLY when the user states their OWN task, commitment or reminder: "I have to…", "I need to…", "Remind me to…",',
  '  "Don\'t let me forget…", or a clear deadline they own ("My rent is due Friday").',
  '- Never from questions (e.g. "When is my rent due?" is a question, not a task), general chat, opinions, temporary states,',
  '  or tasks that belong to other people. The assistant reply is context only, never a source of loops.',
  '- text: the task, short, in the user\'s words, starting with a verb when possible ("Renew my license", "Pay rent"). Put no date in the text.',
  '- due: copy the user\'s OWN words for when it is due ("November 18", "Friday", "tomorrow", "next week") only if they gave one. Never invent a date. Otherwise "".',
  '- If an open loop below is the same task, do NOT add it again. Use "update" with its id ONLY when the user gave a new due date.',
  '- At most 2 ops.'
].join('\n');

// picked: Group Chat — the reply is the answer the USER picked; its clear action items for the user count as their tasks.
function buildExtractorMessages(open, message, reply, picked) {
  const rules = picked
    ? EXTRACTOR_RULES.replace('or tasks that belong to other people. The assistant reply is context only, never a source of loops.',
      'or tasks that belong to other people. The assistant reply is the answer the user PICKED as theirs in Group Chat: a clear action it\n' +
      '  tells the user to do (an instruction or a plan step — not an option, an idea, or "you could") counts as the user\'s own task,\n' +
      '  EVEN WHEN the user\'s message was a question. Take the 1–2 most important such steps. Never take steps from anything but this picked answer.')
    : EXTRACTOR_RULES;
  return [
    { role: 'system', content: rules },
    { role: 'user', content: JSON.stringify({ open_loops: open.map(l => ({ id: l.id, text: l.text, due: l.dueDate })), user_message: message, assistant_reply: reply }) }
  ];
}

// Applies the extractor's answer to a notebook. Returns what changed (for the "Loop opened" chips).
function applyExtraction(book, content) {
  const a = typeof content === 'string' ? content.indexOf('{') : -1, b = a >= 0 ? content.lastIndexOf('}') : -1;
  let ops = [];
  try { ops = a >= 0 && b > a ? JSON.parse(content.slice(a, b + 1)).ops : []; } catch (e) { ops = []; }
  if (!Array.isArray(ops)) return [];
  const changed = [];
  for (const op of ops.slice(0, MAX_NEW_PER_MESSAGE)) {
    if (!op || typeof op !== 'object') continue;
    const due = resolveDue(op.due);
    if (op.op === 'update') {
      const l = book.loops.find(x => x.id === op.id && x.status === 'open');
      if (l && due && l.dueDate !== due) { l.dueDate = due; changed.push({ id: l.id, text: l.text, dueDate: due, change: 'updated' }); }
    } else if (op.op === 'add') {
      const text = cleanText(op.text);
      if (text.length < 2 || text.length > 200) continue;
      const twin = book.loops.find(x => x.status === 'open' && sameTask(x.text, text));
      if (twin) {   // never two of the same open task; a new date updates it
        if (due && twin.dueDate !== due) { twin.dueDate = due; changed.push({ id: twin.id, text: twin.text, dueDate: due, change: 'updated' }); }
        continue;
      }
      const l = newLoop(text, due);
      book.loops.push(l);
      changed.push({ id: l.id, text: l.text, dueDate: l.dueDate, change: 'opened' });
    }
  }
  return changed;
}

// ---- Deadline guardian: one gentle line, once per day per loop ----
function dueWords(due, from) {
  const n = daysUntil(due, from);
  if (n === 0) return 'is due today';
  if (n === 1) return 'is due tomorrow';
  if (n > 1) return 'is due in ' + n + ' days';
  return 'is overdue by ' + -n + (n === -1 ? ' day' : ' days');
}
// Returns the line to say (or null) and stamps the loops as mentioned today. The caller saves the notebook.
function guardianLine(book, from = today()) {
  book.guardian = book.guardian || {};
  const open = openSorted(book.loops);
  for (const id of Object.keys(book.guardian)) if (!open.some(l => l.id === id)) delete book.guardian[id]; // tidy: closed loops
  const due = open.filter(l => l.dueDate && daysUntil(l.dueDate, from) <= GUARDIAN_DAYS && book.guardian[l.id] !== from);
  if (!due.length) return null;
  due.forEach(l => { book.guardian[l.id] = from; });
  const named = due.slice(0, 3).map(l => "'" + l.text + "' " + dueWords(l.dueDate, from));
  let line = 'Quick heads-up: ' + (named.length > 1 ? named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1] : named[0]) + '.';
  if (due.length > 3) line = line.replace(/\.$/, '') + ' …and ' + (due.length - 3) + ' more in Open loops.';
  return line;
}

module.exports = {
  today, daysUntil, validYmd, resolveDue, openSorted, closedSorted, newLoop, close, cleanText,
  matchLoops, parseDone, buildExtractorMessages, applyExtraction, guardianLine
};
