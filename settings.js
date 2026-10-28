// SIM SIM Settings: the per-user preferences stored in the user's notebook (book.settings).
// Every setting here is REAL: something in the app reads it (see READERS), or it is stored and named as "no reader yet".
const DEFAULTS = {
  textSize: 'comfortable',   // READER: the page (chat text size)
  speechRate: 'normal',      // READER: the page (browser voice speed)
  speakAnswers: true,        // READER: the page — every place Sim Sim speaks (chat, wake reply, Discussion pick, briefing, Screen Watch)
  briefingOn: true,          // READER: server — morning briefing view, "what's my briefing?", and "good morning" by wake
  briefingTime: '07:00',     // NO READER YET: stored for a later scheduled briefing (nothing is scheduled or pushed today)
  loopRemindersOn: true,     // READER: server — the deadline guardian's once-a-day heads-up line
  picksConsent: false        // NO READER: consent flag only ("let my picks help improve Sim Sim for everyone")
};
const CHOICES = { textSize: ['comfortable', 'large'], speechRate: ['slower', 'normal', 'faster'] };

function settingsOf(book) { return Object.assign({}, DEFAULTS, book && book.settings); }

// Checks a partial update. Returns { changes } or { error } in plain words.
function clean(data) {
  const changes = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!(k in DEFAULTS)) continue;
    if (CHOICES[k]) { if (!CHOICES[k].includes(v)) return { error: 'That choice is not available.' }; changes[k] = v; }
    else if (typeof DEFAULTS[k] === 'boolean') { if (typeof v !== 'boolean') return { error: 'That switch needs on or off.' }; changes[k] = v; }
    else if (k === 'briefingTime') { if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return { error: 'Pick a time like 07:00.' }; changes[k] = v; }
  }
  return { changes };
}

module.exports = { DEFAULTS, settingsOf, clean };
