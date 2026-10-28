// SIM SIM image lane: is this message a clear request to CREATE a picture? Plain code, no AI.
// Shared by the server (which decides) and the page (which shows "Drawing…" right away).
// Anything not clearly a request stays normal chat: "what is an image?" and "tell me about monkey pictures" are chat.
(function (root) {
  const VERBS = 'make|draw|create|generate|paint|sketch|design|render|illustrate';
  const NOUNS = 'images?|pictures?|pics?|photos?|drawings?|paintings?|illustrations?|sketch(?:es)?|portraits?|artwork';
  const ONE = 'image|picture|photo|drawing|painting|illustration|sketch|portrait';
  // Polite openers are fine: "please", "can you", "Sim Sim, could you", "I'd like you to"…
  const LEAD = "^(?:(?:hey|hi|ok|okay|please|sim\\s*sim)[,\\s]+)*" +
    "(?:(?:can|could|would|will) you\\s+|i(?:'d| would) like (?:you )?to\\s+|i want (?:you )?to\\s+)?(?:please\\s+)?";
  const PATTERNS = [
    // "make an image of a monkey", "create a watercolor picture of a fox", "draw me a picture of…"
    new RegExp(LEAD + '(?:' + VERBS + ')(?:\\s+(?:me|us))?\\s+(?:[\\w\'-]+\\s+){0,4}?(?:' + NOUNS + ')\\s+of\\s+(.+)$', 'i'),
    // "draw me a dragon"
    new RegExp(LEAD + 'draw\\s+(?:me|us)\\s+(.+)$', 'i'),
    // "draw a dragon"
    new RegExp(LEAD + 'draw\\s+(?:an?|some|the)\\s+(.+)$', 'i')
  ];
  // "image of a sunset", "a picture of my cat in space" (the whole message is the request)
  const BARE = new RegExp('^(?:(?:an?|one)\\s+)?(?:[\\w\'-]+\\s+){0,3}?(?:' + ONE + ')\\s+of\\s+(.+)$', 'i');

  function clean(subject) {
    return subject.trim().replace(/^(?:an?|the|some|one)\s+/i, '').replace(/[\s,]+please$/i, '').slice(0, 120);
  }

  // Returns { subject } for a clear image request, otherwise null.
  function imageRequest(text) {
    if (typeof text !== 'string') return null;
    const t = text.trim().replace(/[\s.!?]+$/, '');
    if (!t) return null;
    for (const re of PATTERNS) {
      const m = t.match(re);
      if (m && m[1].trim()) return { subject: clean(m[1]) };
    }
    const m = t.match(BARE);
    // "a picture of my trip is on my phone" is a statement, not a request
    if (m && m[1].trim() && !(/\b(is|are|was|were)\b/i.test(m[1]) && !/\b(that|which|who)\b/i.test(m[1]))) return { subject: clean(m[1]) };
    return null;
  }

  const api = { imageRequest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimSimImageIntent = api;
})(this);
