// SIM SIM morning briefing: built ONLY from the user's own stored items (open loops, dated facts, remembered facts).
// Our code gathers the items; the Meta brain writes the words in ONE call; nothing else goes in — no weather, news or events.
const loops = require('./loops.js');
const memory = require('./memory.js');

const CLEAR_DAY = 'Nothing due — a clear day.';
const EMPTY = "Nothing on your plate yet — tell me what you're working on and I'll keep track.";
const WINDOW_DAYS = 7;

// ---- Calm due wording ----
function dueWords(due, today) {
  const n = loops.daysUntil(due, today);
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  if (n > 1) return 'due in ' + n + ' days';
  return -n + (n === -1 ? ' day overdue' : ' days overdue');
}
function niceDate(ymd) {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ---- A date written inside a fact ("Ayesha's birthday is March 3") -> its next date, or null (never guessed) ----
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dateInFact(text, today) {
  const t = text.toLowerCase();
  let month, day, year, m;
  if ((m = t.match(new RegExp('\\b' + MONTH_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?')))) [month, day, year] = [MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2], m[3]];
  else if ((m = t.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MONTH_RE + '\\b(?:,?\\s+(\\d{4}))?')))) [month, day, year] = [MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1], m[3]];
  else if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) [year, month, day] = [m[1], +m[2], +m[3]];
  else if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/))) [month, day, year] = [+m[1], +m[2], m[3]];
  else return null;
  const make = y => y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  if (year) return loops.validYmd(make(year)) ? make(year) : null;
  // no year: a yearly date (a birthday) — its next time, today or later
  const y = Number(today.slice(0, 4));
  let d = make(y);
  if (!loops.validYmd(d)) return null;
  if (loops.daysUntil(d, today) < 0) d = make(y + 1);
  return loops.validYmd(d) ? d : null;
}

// ---- The three sections, gathered by our code (never by the brain) ----
function gather(book, today) {
  const openLoops = loops.openSorted(book.loops || []).map(l => ({ text: l.text, dueDate: l.dueDate, due: l.dueDate ? dueWords(l.dueDate, today) : null }));
  const facts = book.facts || [];
  const comingUp = facts.filter(f => f.category === 'dates')
    .map(f => ({ f, date: dateInFact(f.text, today) }))
    .filter(x => x.date && loops.daysUntil(x.date, today) >= 0 && loops.daysUntil(x.date, today) <= WINDOW_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(x => ({ id: x.f.id, text: x.f.text, date: x.date, when: dueWords(x.date, today).replace(/^due /, '') }));
  const shown = new Set(comingUp.map(c => c.id));
  // REMEMBER: up to 3, most recently learned or updated; dated facts belong to COMING UP (only when they are near)
  const remember = memory.newestFirst(facts).filter(f => f.category !== 'dates' && !shown.has(f.id)).slice(0, 3).map(f => ({ id: f.id, text: f.text }));
  return { loops: openLoops, comingUp: comingUp.map(({ id, ...rest }) => rest), remember: remember.map(r => ({ text: r.text })) };
}
function isEmpty(items) { return !items.loops.length && !items.comingUp.length && !items.remember.length; }

// ---- ONE brain call writes the words, from the handed items only ----
const RULES = [
  "You write Sim Sim's short spoken morning briefing. Reply with the briefing text only: plain sentences, no headings, no lists, no markdown.",
  'Use ONLY the items given to you. Never add weather, news, traffic, holidays, events, people, names, dates, numbers or tasks that are not in the items.',
  'Never change a date, a name or a due fact. Use the due wording exactly as given ("due today", "due tomorrow", "2 days overdue").',
  'Shape: greet the user by name first, then roughly one or two short sentences per section, in this order: open loops, coming up, remember.',
  'Skip any section that has no items. Mention due-today and overdue loops gently and early — calm and kind, never alarming, never scolding.',
  'Warm, plain, comfy sentences, like a friend reading out a note. Turn the items into natural speech ("your cat is called Mango",',
  '"paying the water bill is 2 days overdue"), but keep every name, date and due wording exactly. Begin with "Good morning, <name>".'
].join('\n');

async function compose(ask, name, todayLabel, items) {
  const payload = {
    user_name: name,
    today: todayLabel,
    open_loops: items.loops.map(l => (l.due ? { task: l.text, due: l.due } : { task: l.text, due: 'no due date' })),
    coming_up: items.comingUp.map(c => ({ fact: c.text, when: c.when })),
    remember: items.remember.map(r => r.text)
  };
  const extra = items.loops.length ? '' : '\nThere are no open loops: for the loops part say exactly this sentence: "' + CLEAR_DAY + '"';
  let text = (await ask([{ role: 'system', content: RULES + extra }, { role: 'user', content: JSON.stringify(payload) }], { effort: 'low' })).trim();
  if (!items.loops.length && !text.includes(CLEAR_DAY)) {   // the exact sentence is required: put it right after the greeting
    const cut = text.search(/[.!?](\s|$)/);
    text = cut >= 0 ? text.slice(0, cut + 1) + ' ' + CLEAR_DAY + text.slice(cut + 1) : text + ' ' + CLEAR_DAY;
  }
  return text;
}

// ---- Today's briefing: from the day-cache, or freshly made (and cached, stamped with the user's date) ----
// Returns { date, text, items, fresh }. key = '' means the stub (nothing is composed or cached).
async function todays({ book, today, todayLabel, key, ask, force }) {
  const name = book.profile ? book.profile.callName : 'there';
  if (!key) return { date: today, text: 'Meta brain not connected yet.', items: gather(book, today), fresh: false, stub: true };
  if (!force && book.briefing && book.briefing.date === today) return { date: today, text: book.briefing.text, items: book.briefing.items, fresh: false };
  const items = gather(book, today);
  const text = isEmpty(items)
    ? 'Good morning, ' + name + '. ' + EMPTY   // a brand-new account: no brain call, nothing that could be invented
    : await compose(ask, name, todayLabel, items);
  book.briefing = { date: today, text, items, generatedAt: new Date().toISOString() };
  return { date: today, text, items, fresh: true };
}

// "what's my morning briefing?", "give me my briefing", "brief me" (plain code)
function asksForBriefing(message) {
  const t = message.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/^(?:(?:hey|hi|ok|okay|please|sim\s*sim)[,\s]+)+/, '');
  return /^(?:what'?s|what is|give me|read me|tell me|play|can i (?:have|get)|could i (?:have|get)|i'?d like|show me)?\s*(?:my |the |today'?s |this morning'?s )?(?:morning )?briefing(?: for today| please| today)?$/.test(t) ||
    /^brief me(?: for today| please)?$/.test(t);
}
function isGoodMorning(message) {
  return /^(?:(?:hey|hi|ok|okay|sim\s*sim)[,\s]+)*good morning(?:[,\s]+(?:sim\s*sim))?$/i.test(message.trim().replace(/[.!?]+$/, ''));
}

module.exports = { todays, gather, dateInFact, dueWords, niceDate, asksForBriefing, isGoodMorning, CLEAR_DAY, EMPTY };
