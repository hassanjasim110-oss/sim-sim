// SIM SIM Settings: the per-user preferences stored in the user's notebook (book.settings).
// Every setting here is REAL: something in the app reads it (see READERS), or it is stored and named as "no reader yet".
const DEFAULTS = {
  textSize: 'comfortable',   // READER: the page (chat text size)
  speechRate: 'normal',      // READER: the page (browser voice speed)
  speakAnswers: true,        // READER: the page — every place Sim Sim speaks (chat, wake reply, Discussion pick, briefing, Screen Watch)
  voice: 'Noor',             // READER: server — /api/speak speaks in this designed voice (voice.js roster)
  briefingOn: true,          // READER: server — morning briefing view, "what's my briefing?", and "good morning" by wake
  briefingTime: '07:00',     // NO READER YET: stored for a later scheduled briefing (nothing is scheduled or pushed today)
  loopRemindersOn: true,     // READER: server — the deadline guardian's once-a-day heads-up line
  picksConsent: false,       // NO READER: consent flag only ("let my picks help improve Sim Sim for everyone")
  // READER: server — the Action Layer (actions.js): what Sim Sim may do in the app, per group: allow | ask | never
  // (founder's defaults 2026-10-31: all allow; the floor actions in actions.js ask no matter what)
  permissions: { chats: 'allow', views: 'allow', appearance: 'allow', voice: 'allow', memory: 'allow' }
};
const CHOICES = { textSize: ['comfortable', 'large'], speechRate: ['slower', 'normal', 'faster'], voice: require('./voice.js').NAMES };
const PERMISSION = ['allow', 'ask', 'never'];

function settingsOf(book) {
  const s = Object.assign({}, DEFAULTS, book && book.settings);
  s.permissions = Object.assign({}, DEFAULTS.permissions, book && book.settings && book.settings.permissions);   // a partial store never loses a group
  return s;
}

// Checks a partial update. Returns { changes } or { error } in plain words.
function clean(data) {
  const changes = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!(k in DEFAULTS)) continue;
    if (k === 'permissions') {   // { group: 'allow' | 'ask' | 'never' } for one or more groups; merged into the stored ones
      if (!v || typeof v !== 'object') return { error: 'That choice is not available.' };
      const p = {};
      for (const [g, c] of Object.entries(v)) {
        if (!(g in DEFAULTS.permissions) || !PERMISSION.includes(c)) return { error: 'That choice is not available.' };
        p[g] = c;
      }
      changes.permissions = p;
    }
    else if (CHOICES[k]) { if (!CHOICES[k].includes(v)) return { error: 'That choice is not available.' }; changes[k] = v; }
    else if (typeof DEFAULTS[k] === 'boolean') { if (typeof v !== 'boolean') return { error: 'That switch needs on or off.' }; changes[k] = v; }
    else if (k === 'briefingTime') { if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return { error: 'Pick a time like 07:00.' }; changes[k] = v; }
  }
  return { changes };
}

// Parses a plain time-of-day phrase ("7am", "7:30 AM", "19:00", "noon", "midnight") into "HH:MM" (24h), or null
// when it can't be read (founder, 2026-11-01: the chat ask "send my morning briefing at 7 AM" needs this to set
// the real briefingTime setting, the same one Settings → Briefing & loops shows and the scheduler reads).
function parseTimeOfDay(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^noon$/.test(t)) return '12:00';
  if (/^midnight$/.test(t)) return '00:00';
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?$/);
  if (!m) return null;
  let h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  const ap = (m[3] || '').replace(/[.\s]/g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}
// "07:00" -> "7:00 AM", for a plain-words confirmation.
function niceTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

module.exports = { DEFAULTS, settingsOf, clean, parseTimeOfDay, niceTime };
