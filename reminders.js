// SIM SIM timed reminders (founder, 2026-10-30): "remind me at 7 pm to call the store" / "remind me in 20 minutes to stretch".
// Our code reads the time (no guessing by the brain), stores { text, dueAt } per user in data/reminders.json, and Sim Sim
// confirms the exact time it understood. DELIVERY IS HONEST: a due reminder shows at the top of the chat (and in the next
// briefing) when Sim Sim is open on this computer — it cannot reach a phone while the app is closed. A reminder is marked
// "shown" only after the page has actually put it on screen.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'reminders.json');
function readAll() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function writeAll(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}

const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45, half: 0.5 };
const UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
const IN_RE = /\bin\s+(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty-five|half an?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b/i;
const AT_RE = /\b(?:at|by)\s+(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?)(?=$|[\s,.!?])/i;

// Reads a reminder from a message. Returns { text, dueAt (ms) } or null (not a timed reminder — it flows on as usual).
function parse(message, now = new Date()) {
  const t = String(message || '').trim();
  const m = t.match(/^(?:(?:hey|ok|okay)\s+)?(?:sim[\s-]?sim\s*[,!.:]?\s*)?(?:(?:please|can you|could you|will you)\s+)*remind me\b\s*(.*)$/i);
  if (!m) return null;
  let rest = m[1], dueAt = null;
  const tomorrow = /\btomorrow\b/i.test(rest), tonight = /\btonight\b/i.test(rest);
  const inM = rest.match(IN_RE);
  if (inM) {
    const n = /^half/i.test(inM[1]) ? 0.5 : WORDNUM[inM[1].toLowerCase()] !== undefined ? WORDNUM[inM[1].toLowerCase()] : Number(inM[1]);
    const unit = inM[2][0].toLowerCase() === 's' ? 's' : inM[2][0].toLowerCase() === 'm' ? 'm' : inM[2][0].toLowerCase() === 'h' ? 'h' : 'd';
    dueAt = now.getTime() + n * UNIT_MS[unit];
    rest = rest.replace(inM[0], ' ');
  } else {
    const atM = rest.match(AT_RE);
    if (!atM) return null;
    let h, min = 0;
    if (/^noon$/i.test(atM[1])) h = 12; else if (/^midnight$/i.test(atM[1])) h = 0;
    else {
      h = Number(atM[2]); min = atM[3] ? Number(atM[3]) : 0;
      if (h > 23 || min > 59) return null;
      const ap = (atM[4] || '').toLowerCase().replace(/[.\s]/g, '');
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (!ap && tonight && h < 12) h += 12;
      if (!ap && h <= 12) {   // no am/pm: the next time this clock reading comes round
        const d = new Date(now); d.setHours(h, min, 0, 0);
        if (!tomorrow && d <= now && h < 12) h += 12;
      }
    }
    const d = new Date(now); d.setHours(h, min, 0, 0);
    if (tomorrow || d <= now) d.setDate(d.getDate() + 1);
    dueAt = d.getTime();
    rest = rest.replace(atM[0], ' ');
  }
  const text = rest.replace(/\b(?:tomorrow|tonight|today)\b/gi, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:to|that|about|i need to|i have to|i should)\s+/i, '').replace(/^(?:to)\s+/i, '').replace(/[\s.!?]+$/, '').trim();
  return { text: text || 'your reminder', dueAt };
}

// "today at 7:00 PM" / "tomorrow at 9:00 AM" / "on Friday, Nov 7 at 9:00 AM"
function whenWords(dueAt, now = new Date()) {
  const d = new Date(dueAt);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - day0) / 86400000);
  if (days === 0) return 'today at ' + time;
  if (days === 1) return 'tomorrow at ' + time;
  return 'on ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' at ' + time;
}
function confirmLine(r) { return "I'll remind you " + whenWords(r.dueAt) + ' to ' + r.text.replace(/^to\s+/i, '') + '.'; }

function add(uid, r) {
  const all = readAll(), list = all[uid] = all[uid] || [];
  const item = { id: crypto.randomBytes(6).toString('hex'), text: r.text.slice(0, 200), dueAt: r.dueAt, createdAt: Date.now(), shownAt: null, doneAt: null };
  list.push(item);
  writeAll(all);
  return item;
}
// Not done yet, soonest first (due ones included, with whether they have been shown).
function open(uid) { return (readAll()[uid] || []).filter(r => !r.doneAt).sort((a, b) => a.dueAt - b.dueAt); }
function update(uid, ids, change) {
  const all = readAll(), list = all[uid] || [];
  let n = 0;
  list.forEach(r => { if (ids.includes(r.id)) { change(r); n++; } });
  if (n) writeAll(all);
  return n;
}
const markShown = (uid, ids) => update(uid, ids, r => { if (!r.shownAt) r.shownAt = Date.now(); });
const markDone = (uid, ids) => update(uid, ids, r => { r.doneAt = Date.now(); });
// For the briefing: what is due today or already due and not done.
function forBriefing(uid, now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return open(uid).filter(r => r.dueAt <= end.getTime()).map(r => ({ text: r.text, when: r.dueAt <= now.getTime() ? 'due now' : whenWords(r.dueAt, now) }));
}
function removeAll(uid) { const all = readAll(); if (all[uid]) { delete all[uid]; writeAll(all); } }

module.exports = { parse, confirmLine, whenWords, add, open, markShown, markDone, forBriefing, removeAll };
