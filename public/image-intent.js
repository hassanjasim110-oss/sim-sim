// SIM SIM image lane: is this message a request to CREATE a picture? Plain code, no AI.
// Shared by the server (which decides) and the page (which shows "Drawing…" right away).
// The rule (founder, 2026-10-28): a CREATION word anywhere + a PICTURE word anywhere is a request, in any polite or question shape.
// Talk ABOUT pictures stays normal chat: "what is in this picture?", "show me the picture from before", "take a picture".
(function (root) {
  const CREATE = 'make|draw|create|generate|paint|sketch|show|give|design|render|illustrate';
  const PIC = "pictures?|images?|photos?|drawings?|paintings?|illustrations?|artwork|art|pics?|portraits?";
  // A picture word only counts when it ends the request or is followed by what the picture shows:
  // "a dog image", "a picture of…", "an image with…" — not "a picture frame", "an art history summary".
  const PIC_RE = new RegExp("\\b(?:" + PIC + ")\\b(?=\\s*$|\\s*,|\\s+(?:of|showing|depicting|about|with|that shows|which shows|for|please|in|on|now)\\b)", 'i');
  const CREATE_RE = new RegExp('\\b(?:' + CREATE + ')\\b', 'i');
  // Polite openers: "please", "can you", "Sim Sim, could you", "I'd like you to"…
  const LEAD = "^(?:(?:hey|hi|ok|okay|please|sim\\s*sim)[,\\s]+)*" +
    "(?:(?:can|could|would|will) you\\s+|i(?:'d| would) like (?:you )?to\\s+|i want (?:you )?to\\s+)?(?:please\\s+)?";
  // "draw me a dragon", "could you draw a cat?", "paint a sunset", "draw something"
  const BARE_DRAW = new RegExp(LEAD + '(?:draw|sketch|paint)\\s+(?:(?:me|us)\\s+)?((?:an?|some|the|something|anything)\\b.*)$', 'i');
  // "image of a sunset", "a picture of my cat in space" (the whole message is the request)
  const BARE_OF = new RegExp("^(?:(?:an?|one)\\s+)?(?:[\\w'-]+\\s+){0,3}?(?:image|picture|photo|drawing|painting|illustration|sketch|portrait)\\s+of\\s+(.+)$", 'i');
  // Not a request to draw — checked on the whole message:
  const NOT = [
    /^(?:what|why|how|when|where|who|whose|which|is|are|was|were|do|does|did|has|have|should)\b/i,  // a question ABOUT pictures
    /\b(?:don'?t|do not|never|stop|no more)\b/i,                                                   // "don't make a picture"
    /^(?:i|we|he|she|they|it)\b(?!\s+(?:want|would|need)\b|'d\b)/i,                                // statements ("I made a picture of…")
    /^(?:i'm|i've|i'll|we're|it's|there's)\b/i
  ];
  // …and on the request part only (up to the picture word), so a subject like "an open field" can't block a draw:
  const NOT_HEAD = [
    /\b(?:take|took|taking|snap|snapped|capture|send|sent|upload|uploaded|attach|attached|save|saved|edit|crop|resize|delete|share|shared|open|look at)\b/i, // camera, Screen Watch, files
    /\bshow(?:ed|ing)?\s+(?:you|him|her|them)\b/i,                                                 // "I want to show you a photo…"
    new RegExp("\\b(?:the|this|that|these|those|my|your|our|his|her|their|its|last|previous|same|other)\\s+(?:[\\w'-]+\\s+)?(?:" + PIC + ")\\b", 'i') // an existing picture
  ];
  // Words that are not a subject on their own: "make me a picture", "draw something nice".
  const FILLER = new Set(('a an the some one another new me us you for it this that something anything please just nice cool good great ' +
    'cute pretty quick simple random whatever thing stuff kind sort of ok okay yes yeah yep sure thanks hi hello').split(' '));

  // "Show me how X looks" asks to SEE, not to read a description (founder, 2026-10-31).
  const SHOW_LOOKS = [
    /\bshow me how (.+?) (?:is )?(?:gonna |going to )?look(?:s| like)?[?.! ]*$/i,
    /\bshow me what (.+?) looks? like[?.! ]*$/i,
    /\bwhat does (.+?) look like[?.! ]*$/i,
    /\bhow (?:is|does) (.+?) (?:gonna |going to )?look[?.! ]*$/i,
    /\bcan you show me how (.+?) (?:is )?(?:gonna |going to )?look(?:s| like)?[?.! ]*$/i
  ];

  function tidy(text) {
    return text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[\s.!?]+$/, '');
  }
  // The subject keeps its own words ("a husky in the snow"); only request scaffolding is cut off the ends.
  function clean(subject) {
    let s = subject.trim();
    let before;
    do {
      before = s;
      s = s.replace(/[\s,]+(?:please|thanks|thank you|for me|for us|now|right now)$/i, '')
        .replace(/^(?:me|us|for me|for us|please|just|of)[\s,]+/i, '').trim();
    } while (s !== before);
    return s.replace(/[\s,.!?]+$/, '').slice(0, 120);
  }
  function meaningful(subject) {
    return subject.toLowerCase().split(/[^\w'-]+/).some(w => w && !FILLER.has(w));
  }
  function result(subject) {
    const s = clean(subject || '');
    return s && meaningful(s) ? { subject: s } : { needsSubject: true };
  }

  // Returns { subject } for a picture request that says what to show, { needsSubject: true } for one that doesn't yet,
  // otherwise null (normal chat).
  function imageRequest(text) {
    if (typeof text !== 'string') return null;
    const t = tidy(text);
    if (!t) return null;
    for (const re of SHOW_LOOKS) {
      const m = t.match(re);
      if (m) return result(m[1]);
    }
    if (NOT.some(re => re.test(t))) return null;
    const pic = t.match(PIC_RE), create = t.match(CREATE_RE);
    const head = pic ? t.slice(0, pic.index + pic[0].length) : t;
    if (NOT_HEAD.some(re => re.test(head))) return null;
    if (pic && create) {
      const after = t.slice(pic.index + pic[0].length);
      // "…picture of X" / "…image showing X" / "…art with X": X is the subject
      const of = after.match(/^\s*(?:of|showing|depicting|about|with|that shows|which shows)\s+(.+)$/i);
      if (of) return result(of[1]);
      // "make a dog image": the words between the creation word and the picture word…
      const from = create.index < pic.index ? create.index + create[0].length : 0;
      const between = t.slice(from, pic.index).replace(new RegExp(LEAD, 'i'), '').replace(CREATE_RE, '')
        .replace(/^\s*(?:(?:me|us|you)\s+)?(?:(?:an?|some|one|another|new)\s+)?/i, '');
      // …plus a style or place after it ("in watercolor", "on the beach"); "for my mom", ", please" are not the subject
      const rest = /^\s*(?:in|on)\s/i.test(after) ? clean(after) : '';
      return result((between.trim() + (rest ? ' ' + rest : '')).trim());
    }
    let m = t.match(BARE_DRAW);
    if (m) return result(m[1]);
    m = t.match(BARE_OF);
    // "a picture of my trip is on my phone" is a statement, not a request
    if (m && !/\b(?:is|are|was|were)\b/i.test(m[1])) return result(m[1]);
    return null;
  }

  // After Sim Sim asked "what should it show?": the reply IS the subject, unless it cancels or is clearly a new question.
  // Returns the subject, or null to let the message flow on as normal chat.
  function subjectReply(text) {
    if (typeof text !== 'string') return null;
    const t = tidy(text);
    if (!t || t.split(' ').length > 30) return null;
    if (/^(?:never ?mind|forget (?:it|that|about it)|cancel|no|nope|nah|nothing|stop|skip|not now|no thanks|leave it)\b/i.test(t)) return null;
    if (/^(?:what|why|how|when|where|who|whose|which|is|are|was|were|do|does|did|can|could|would|will|should|tell|explain|remind|add|remember|good morning)\b/i.test(t)) return null;
    const s = clean(t.replace(/^(?:(?:um+|uh+|hmm+|ok|okay|well|maybe|how about|let'?s do|let'?s go with|make it|do|draw|a picture of|an image of)[,\s]+)+/i, ''));
    return s && meaningful(s) ? s : null;
  }

  // Photo editing (founder, 2026-10-29): is this a CHANGE instruction for a picture? Verb-led only:
  // "add a dog here", "remove the lamp", "make it real", "turn it into a painting", "can you put a hat on him?".
  // When in doubt it is NOT an edit — a question about a photo goes to Vision; changing a photo on a guess is the one unforgivable error.
  const EDIT_LEAD = new RegExp(LEAD + "(?:(?:now|then|also|and|ok now)[,\\s]+)?" +
    "(?:add|remove|delete|erase|change|replace|put|place|move|swap|insert|take (?:out|away)|get rid of|" +
    "(?:make|turn|give|paint|color|colour) (?:it|this|that|them|him|her|the|everything|his|her|their))\\b\\s*(.*)$", 'i');
  // "take the kid out of the photo", "get him out of the picture", "take her out"
  const TAKE_OUT = new RegExp(LEAD + "(?:(?:now|then|also|and)[,\\s]+)?(?:take|get)\\s+(?:(?:him|her|them)\\s+(?:out|away)\\b|.+?\\s+out of (?:the|this|that|my) (?:picture|photo|image|pic|shot|frame)\\b)", 'i');
  // Plain life admin is never a photo edit: "add milk to my list", "change my name", "move my meeting", "add eggs to groceries".
  const NOT_EDIT = new RegExp('\\b(?:list|lists|loops?|tasks?|to-?dos?|calendar|reminders?|notebook|notes?|memory|schedule|agenda|meeting|appointment|deadline|' +
    'grocer(?:y|ies)|shopping|cart|contacts?|playlist|budget|expenses?|errands?|chores?|today|tonight|tomorrow|yesterday|' +
    'monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|o\'clock|\\d+\\s*(?:am|pm))\\b|' +
    '\\bmy (?:name|email|password|settings?|theme|voice|briefing|profile|account|age|state)\\b', 'i');

  function editRequest(text) {
    if (typeof text !== 'string') return false;
    const t = tidy(text);
    if (!t || /^(?:what|why|how|when|where|who|whose|which|is|are|was|were|do|does|did|has|have|should)\b/i.test(t)) return false;
    if (NOT_EDIT.test(t)) return false;
    if (TAKE_OUT.test(t)) return true;
    const m = t.match(EDIT_LEAD);
    // the change has to say something: "add a dog", "make it real" — not a bare "delete that"
    return !!m && meaningful(m[1].replace(/\b(?:here|there|it|this|that|please)\b/gi, ' '));
  }

  // Used by the pending-picture-offer flow (server, 2026-10-31): the SHOW_LOOKS subject from the user's
  // ORIGINAL message that got the offer, so a later bare confirmation ("yes", "through image") can be made.
  function showLooksSubject(text) {
    if (typeof text !== 'string') return null;
    const t = tidy(text);
    for (const re of SHOW_LOOKS) {
      const m = t.match(re);
      if (m) return clean(m[1]);
    }
    return null;
  }

  const api = { imageRequest, subjectReply, editRequest, showLooksSubject };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimSimImageIntent = api;
})(this);
