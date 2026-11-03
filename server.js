// SIM SIM server: serves the page from /public, keeps sign-in sessions, and talks to the Meta Model API.
// The API key lives ONLY here, read from the META_API_KEY environment variable (.env file).
// The Firebase service-account file is read from the path in FIREBASE_SERVICE_ACCOUNT_PATH.
// The browser never sees either.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* no .env file: fine, stub mode */ }

// A server-reachability safety net (founder, 2026-11-01): there is no process manager here (just "node server.js"),
// and until now nothing caught an error that escaped a request's own try/catch — so ONE bad request anywhere (even an
// unrelated, ordinary one like opening Your pictures) could crash the entire Node process with no auto-restart,
// making the server unreachable for EVERY user until someone noticed and restarted it by hand. These two handlers
// are the last line of defence: they log the error and let the process keep running, so a slow or failing request
// can only ever affect itself, never every other request on the server.
process.on('uncaughtException', e => console.error('[server] uncaught exception (the server kept running): ' + (e && e.stack || e)));
process.on('unhandledRejection', e => console.error('[server] unhandled rejection (the server kept running): ' + (e && e.stack || e)));

const PORT = Number(process.env.PORT) || 3000;
const META_URL = 'https://api.meta.ai/v1/chat/completions';
const META_MODEL = process.env.META_MODEL || 'muse-spark-1.3';
const memory = require('./memory.js'); // notebook rules: what the brain reads, learning, forgetting
const { imageRequest, subjectReply, editRequest, showLooksSubject } = require('./public/image-intent.js'); // image lane: is this a clear "make a picture" request?
const answers = require('./answers.js'); // the Answers Process: fast lane vs. precise (the Book + citations)
const loops = require('./loops.js');     // open loops: tasks stay open until the user says they're done
const briefing = require('./briefing.js'); // morning briefing: the user's own items, composed by the brain in one call
const group = require('./group.js');       // Group Chat: Sim Sim + the user's two bots (one Meta brain, three persona cards)
const settings = require('./settings.js'); // Settings: per-user preferences (each one is read by something real)
const vault = require('./vault.js');       // Saved logins: AES-256-GCM with VAULT_KEY; never to the brain or the notebook
const chats = require('./chats.js');       // saved 1-on-1 threads (the main Chat + side chats), per user in data/chats.json
const receipt = require('./receipt.js');   // "How I answered": measured time + the steps that actually ran (plain code)
const pictures = require('./pictures.js'); // "Your pictures": per-user index of the pictures Sim Sim made or edited
const browser = require('./browser.js');   // Sim Sim's browser (Part 1: EYES): a visible Chromium the Meta brain drives, read-only
const voice = require('./voice.js');       // the MOUTH: 10 designed voices via ElevenLabs TTS (the brain stays Meta-only)
const documents = require('./documents.js'); // the Document Lane: real PDF files (printed by Playwright's Chromium), per user
const websites = require('./websites.js'); // the Website Lane: a real, working HTML page (sibling of the Document Lane), per user
const reminders = require('./reminders.js'); // timed reminders: shown at the top of the chat when due (while the app is open)
const actions = require('./actions.js');     // the Action Layer: Sim Sim's hands in its own app, under the user's Permissions
const ARRIVED = Symbol('arrived');         // when a chat request arrived (set on the parsed body; JSON can't carry a Symbol)
const VOICE = Symbol('voice');             // a voice note's saved file + transcript (set by handleChat, never by the request body)
const INFLIGHT = Symbol('inflight');       // THIS request's own cancel token (set by handleChat, never by the request body) —
// sendReply checks this, not s.inflight directly, so a second concurrent request on the same session (another tab,
// or the Screen Watch mini chat running alongside the main chat) can never make this one read the WRONG token.
const VOICE_NO_TRANSCRIPT = '[voice note — no transcript]';
const VOICENOTES_DIR = path.join(__dirname, 'data', 'voicenotes');
const VOICE_MAX = 3 * 1024 * 1024;   // about three minutes of speech
const META_IMAGE_URL = 'https://api.meta.ai/v1/images/generations';
const META_IMAGE_MODEL = 'muse-image-1.0'; // Meta's own image model (Muse Image), confirmed on this account's model list
const IMAGE_FAIL = "I couldn't make that image right now.";
const IMAGE_ASK = 'Of course — what should it show?';
const META_EDIT_URL = 'https://api.meta.ai/v1/images/edits'; // the same Muse Image model, editing a given picture
const EDIT_FAIL = "I couldn't edit that photo right now.";
const EDIT_DONE = "Here's the edited picture.";
const EDIT_NO_PHOTO = "I don't have that photo in this chat anymore — attach it once and I'll keep it for the next edits.";
const IMAGE_ASK_WAIT = 5 * 60 * 1000; // how long "what should it show?" waits for the answer
const STUB_REPLY = 'Meta brain not connected yet.';
// Pending picture offer (founder, 2026-10-31): a bare confirmation of an offer Sim Sim's last reply made.
const PREVIEW_CONFIRM = /^(?:yes|yeah|yep|ok|okay|sure|do it|go ahead|make it|through (?:an? )?(?:image|picture)|as (?:an? )?(?:image|picture)|(?:in|with) (?:an? )?(?:image|picture)|image|picture|show me)[.! ]*$/i;
const OFFER_MARKERS = /(make a picture of|as an image|as a picture|want (?:it|this|that) as (?:an )?(?:image|picture)|show (?:it|this) (?:as|in) (?:an )?(?:image|picture))/i;
// The subject for a confirmed offer: the SHOW_LOOKS capture from the user's message that got the offer, else that message trimmed.
function subjectFrom(userMessage) {
  const s = showLooksSubject(typeof userMessage === 'string' ? userMessage : '');
  return s || (typeof userMessage === 'string' ? userMessage.trim().slice(0, 60) : '');
}
// "a prompt", "a copy button", "in a code block", "copyable", "as text": the user wants words to copy, not a picture.
const TEXT_DELIVERABLE = /\b(?:prompts?|copy ?button|code ?block|copyable|copy-?paste|in a (?:block|box)|as (?:plain )?text)\b/i;
// Voice-change / voice-preference asks (founder's end-check round 2, 2026-11-02): "change your voice to a
// different one" was round-1-fixed so it never became a PICTURE edit, but it still reached the Action Layer's
// set_voice tool, which always failed (no voices are seeded) — and the brain filled the gap with the tool's own
// error text (the full list of designed-voice labels), e.g. "Would you like Bright & Young, or another one from
// the list?" This intercepts the whole family of asks in code, before actions.mightAct or any brain/tool call —
// the ten designed voices must never be reachable from chat, in any wording. "voice note/command/memo/message" (an
// existing recording, not Sim Sim's own voice) is stripped first so those never match.
const VOICE_HONEST = "I speak with your device's voice — there's just the one for now. You can turn my speaking on or off in Settings → Voice.";
const VOICE_NOISE = /\bvoice\s*(?:notes?|commands?|memos?|messages?|calls?|chats?)\b/gi;
const VOICE_CHANGE_ASK = /\b(?:change|switch|pick|choose|set|get|try|use|want|have|another|different|new|list|options?|available)\b[^.?!]{0,20}\bvoices?\b|\bvoices?\b[^.?!]{0,20}\b(?:change|switch|different|another|new|list|options?|available)\b|\b(?:what|which)\b[^.?!]{0,15}\bvoices?\b|\bsounds? different\b/i;
function voiceChangeAsk(text) {
  return typeof text === 'string' && VOICE_CHANGE_ASK.test(text.replace(VOICE_NOISE, ''));
}
// A sane ceiling on the general Q&A lane (founder's end-check round 3, 2026-11-02): never an endless "Thinking…".
const CHAT_CEILING_MS = 45000;
const CHAT_STUCK_REPLY = 'That took too long — try again.';
// Races a promise against a timer. Never rejects: { value } on a real resolve, { error } on a real rejection,
// { timedOut: true } if the timer wins first — the original promise is left running, unobserved, afterward.
function raceOrTimeout(promise, ms) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({ timedOut: true }), ms);
    promise.then(value => { clearTimeout(t); resolve({ value }); }, error => { clearTimeout(t); resolve({ error }); });
  });
}
// "Delete all my chats": unambiguous phrasing ("all"/"every" + chats) is handled deterministically in code
// (founder's end-check round 2, 2026-11-02) — live-tested, the brain was calling delete_current_chat instead of
// delete_all_chats for this exact ask, so the card and the result were for the wrong (current) chat. Anything
// less clear ("delete this chat", "delete my chat") still goes to the brain's own tool choice, unchanged.
const DELETE_ALL_CHATS_ASK = /\b(?:delete|remove|erase|clear|wipe)\b[^.?!]{0,20}\b(?:all|every)\b[^.?!]{0,15}\bchats?\b/i;
const RENAME_TOO_LONG ='A chat name can be up to 60 characters — try a shorter one.';
// A rename ask with no name ("rename this chat"): asked in code, never sent to the brain — never a hang (founder, 2026-11-01).
const RENAME_ASK = 'What should I call it?';
const RENAME_ASK_WAIT = 5 * 60 * 1000;   // how long "What should I call it?" waits for the answer
const RENAME_CANCEL = /^(?:never ?mind|forget (?:it|that|about it)|cancel|no|nope|nah|nothing|stop|skip|not now|no thanks|leave it)\b/i;
// The next message after RENAME_ASK: the whole thing is the name, unless it cancels or is clearly a new question/command.
function renameNameReply(text) {
  if (typeof text !== 'string') return null;
  const n = cleanName(text);
  if (!n || n.split(' ').length > 12 || RENAME_CANCEL.test(n)) return null;
  if (/^(?:what|why|how|when|where|who|whose|which|is|are|was|were|do|does|did|can|could|would|will|should)\b/i.test(n)) return null;
  // A request or action ask ("make me a picture of…", "open Settings", "show me…", "tell me…") is never a chat
  // name — it's the next thing the user actually wants, not an answer to "What should I call it?" (founder's
  // end-check, 2026-11-01: a picture request got used as the new chat name). Anything already recognized
  // elsewhere as a picture, edit, document, website or app-action request cancels the pending rename instead,
  // so the message is handled normally.
  if (/^(?:make|create|open|show|tell|draw|build|set|turn|change|delete|remove|add|remind|call|play|start|stop|pause|rename|forget|find|search|browse|write|send|help|give|let'?s|please)\b/i.test(n)) return null;
  if (imageRequest(text) || editRequest(text) || documents.wantsDocument(text) || websites.wantsWebsite(text) || actions.mightAct(text)) return null;
  return n;
}
// Output cap for the small JSON steps (extractors). The model's hidden reasoning counts against it, so it needs room.
const SMALL_STEP_TOKENS = 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function sendJson(res, status, obj, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(obj));
}

// Reads a small JSON body. Returns the parsed object, or null after answering with an error.
// tooBig: what to say when the body is over the limit (a picture route says the PICTURE is too large, never the message).
async function readJson(req, res, limit = 16000, tooBig = 'That message is too long.') {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) { sendJson(res, 413, { error: tooBig }); return null; }
  }
  try { return JSON.parse(body) || {}; } catch (e) { sendJson(res, 400, { error: 'Bad request.' }); return null; }
}

// ---- Sign-in sessions ----
// Firebase proves who you are (email link); then our server keeps a simple session in memory.
// Restarting the server signs everyone out.
const COOKIE = 'simsim_session';
const sessions = new Map(); // random session id -> { uid, email, signedInAt }

let firebaseAuth = null;
function getFirebaseAuth() {
  if (firebaseAuth) return firebaseAuth;
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  // A hosted copy (the preview) can't read the founder's local secrets folder: FIREBASE_SERVICE_ACCOUNT_JSON, the
  // key's JSON pasted straight into an env var, is tried first. The laptop sets no such var, so it keeps reading
  // the file exactly as before (founder, 2026-10-31).
  const envJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  let account;
  if (envJson) {
    try { account = JSON.parse(envJson); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  } else {
    const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!file) throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is not set');
    account = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  firebaseAuth = getAuth(initializeApp({ credential: cert(account) }));
  return firebaseAuth;
}

// PREVIEW LOCK (founder, 2026-10-31): a temporary, server-only gate for a private online preview — NOT the public
// launch. Set ONLY on a hosted copy, never on the founder's laptop (.env there has no PREVIEW_ONLY_EMAIL). While
// set, exactly one email may hold a session; every other door — Firebase, the dev door, even test mode — is
// refused the same way. Unset, this is a no-op and behavior is byte-for-byte today's.
const PREVIEW_ONLY_EMAIL = (process.env.PREVIEW_ONLY_EMAIL || '').trim().toLowerCase();
const PREVIEW_LOCKED = 'This preview is private.';
function previewAllowed(email) {
  return !PREVIEW_ONLY_EMAIL || String(email || '').trim().toLowerCase() === PREVIEW_ONLY_EMAIL;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
// TEST MODE (workshop key, for our own testing only): SIMSIM_TEST_MODE=1 in .env, and nothing else, turns it on.
// Then every visitor is ONE built-in local user — no Firebase — and all per-user storage works normally under its id.
// It can never be switched on from the browser.
const TEST_MODE = process.env.SIMSIM_TEST_MODE === '1';
const TEST_SESSION = { uid: 'local-test-user', email: 'local-test-user@localhost', signedInAt: new Date().toISOString(), test: true };

// DEV DOOR (build phase only): SIMSIM_DEV_DOOR=1 in .env, and nothing else, turns it on.
// Then the landing card is just an email field: typing an email signs you in AS that email — no Firebase, nothing sent.
// Sign-in finds your account: an email that already has an account here (made through Firebase) opens THAT account.
// A brand-new email gets its own fresh account, keyed "dev-<email>".
const DEV_DOOR = process.env.SIMSIM_DEV_DOOR === '1';
const DEV_EMAIL = /^[^\s@\/\\:*?"<>|]+@[^\s@\/\\:*?"<>|]+\.[^\s@\/\\:*?"<>|.]{2,}$/; // something@something.something (and safe as a folder name)

// The stored account for this email: the Firebase-made account whose profile has this email, else the email's own dev drawer.
// Accounts are keyed by uid; the email is stored inside the profile, so only an account WITH a profile can be found by email.
function accountForEmail(email) {
  const all = readNotebooks();
  const found = Object.keys(all).filter(uid => !uid.startsWith('dev-') && uid !== TEST_SESSION.uid &&
    all[uid] && all[uid].profile && String(all[uid].profile.email || '').toLowerCase() === email)
    .sort((a, b) => String(all[a].profile.createdAt).localeCompare(String(all[b].profile.createdAt)));
  if (found.length > 1) console.log('[session] ' + found.length + ' accounts have this email; using the oldest one');
  return found[0] || 'dev-' + email;
}

function handleDevDoor(req, res) {
  if (!DEV_DOOR || TEST_MODE) { res.writeHead(404); return res.end(); }
  return readJson(req, res).then(data => {
    if (!data) return;
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (email.length > 254 || !DEV_EMAIL.test(email)) return sendJson(res, 400, { error: "That doesn't look like an email address." });
    if (!previewAllowed(email)) return sendJson(res, 401, { error: PREVIEW_LOCKED });   // the preview lock outranks the doors
    const old = readCookie(req, COOKIE);
    if (old) sessions.delete(old);
    const sid = crypto.randomBytes(32).toString('base64url');   // the same kind of session a verified sign-in gets
    sessions.set(sid, { uid: accountForEmail(email), email, signedInAt: new Date().toISOString(), dev: true });
    sendJson(res, 200, { ok: true, email }, { 'Set-Cookie': COOKIE + '=' + sid + '; HttpOnly; SameSite=Lax; Path=/' });
  });
}

// previewAllowed is checked again here, as a backstop, so a session created some other way (or kept from before the
// preview lock was turned on) can never read or do anything either — "no session is kept" for real, every request.
function getSession(req) {
  if (TEST_MODE) return previewAllowed(TEST_SESSION.email) ? TEST_SESSION : null;
  const sid = readCookie(req, COOKIE);
  const s = sid ? sessions.get(sid) || null : null;
  return s && previewAllowed(s.email) ? s : null;
}

async function handleSessionStart(req, res) {
  const data = await readJson(req, res);
  if (!data) return;
  if (typeof data.idToken !== 'string' || !data.idToken) return sendJson(res, 400, { error: 'Bad request.' });
  let auth;
  try { auth = getFirebaseAuth(); } catch (e) {
    console.error('[session] Firebase admin is not set up:', e.message);
    return sendJson(res, 500, { error: 'Sign-in is not set up on the server.' });
  }
  let user;
  try { user = await auth.verifyIdToken(data.idToken); } catch (e) {
    console.error('[session] sign-in token rejected:', e.code || 'unknown');
    return sendJson(res, 401, { error: 'not signed in' });
  }
  if (!user.email) return sendJson(res, 401, { error: 'not signed in' });
  if (!previewAllowed(user.email)) return sendJson(res, 401, { error: PREVIEW_LOCKED });   // the preview lock outranks every door
  const old = readCookie(req, COOKIE);
  if (old) sessions.delete(old);
  const sid = crypto.randomBytes(32).toString('base64url');
  sessions.set(sid, { uid: user.uid, email: user.email, signedInAt: new Date().toISOString() });
  sendJson(res, 200, { ok: true, email: user.email }, { 'Set-Cookie': COOKIE + '=' + sid + '; HttpOnly; SameSite=Lax; Path=/' });
}

function handleLogout(req, res) {
  const sid = readCookie(req, COOKIE);
  const s = sid ? sessions.get(sid) : null;
  if (s) browser.close(s.uid).catch(() => {});   // signing out closes that user's browser window
  if (sid) sessions.delete(sid);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': COOKIE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
}

// Ask Meta's brain. Returns the reply text, or throws an Error with a plain-words message.
// opts.effort: how hard it thinks ('low' for chat: quick answers for a voice assistant); opts.maxTokens: output cap.
// opts.tools: tool definitions (the browser); then the brain's whole message comes back ({ content, tool_calls? }).
async function askMeta(messages, key, opts = {}) {
  let r;
  try {
    r = await fetch(META_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({
        model: META_MODEL,
        reasoning_effort: opts.effort || 'low',
        messages
      }, opts.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}, opts.tools ? { tools: opts.tools } : {})),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'The Meta brain took too long to answer.' : 'Could not reach the Meta brain. Check the internet connection.');
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = data && data.error;
    console.error('[meta] error', r.status, err ? err.type + ': ' + err.message : '(no details)');
    const why = { 401: 'the API key was not accepted', 402: 'there is a billing problem on the Meta account', 403: 'this key is not allowed to use the model', 429: 'too many requests right now, try again in a moment' }[r.status] || 'error ' + r.status;
    throw new Error('The Meta brain said no: ' + why + '.');
  }
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  if (opts.raw && msg && (Array.isArray(msg.tool_calls) && msg.tool_calls.length || (typeof msg.content === 'string' && msg.content.trim()))) return msg;
  const text = msg && msg.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('The Meta brain sent back an empty answer.');
  return text.trim();
}

// ---- The notebook: one JSON file, one entry per user (keyed by the uid from the verified session) ----
const { GENDERS, STATES, THEMES, BOT_ROLES, FACES } = require('./public/notebook-data.js');
const DATA_DIR = path.join(__dirname, 'data');
const NOTEBOOKS = path.join(DATA_DIR, 'notebooks.json');

function readNotebooks() {
  try { return JSON.parse(fs.readFileSync(NOTEBOOKS, 'utf8')); } catch (e) { return {}; }
}
function writeNotebooks(all) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = NOTEBOOKS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, NOTEBOOKS); // write-then-swap, so a crash never leaves half a file
}

// Checks the six setup answers. Returns { profile } or { error } in plain words.
function cleanProfile(d) {
  const callName = typeof d.callName === 'string' ? d.callName.replace(/[\u0000-\u001f]/g, '').trim() : '';
  if (callName.length < 1 || callName.length > 40) return { error: 'Tell me what to call you (1 to 40 characters).' };
  if (!GENDERS.includes(d.gender)) return { error: 'Pick a gender option.' };
  const age = Number(d.age);
  if (!Number.isInteger(age) || age < 5 || age > 120) return { error: 'Enter your age as a whole number from 5 to 120.' };
  if (!STATES.includes(d.state)) return { error: 'Choose your state.' };
  if (!Array.isArray(d.botNames) || d.botNames.length !== BOT_ROLES.length) return { error: 'Name both helper bots.' };
  const botNames = d.botNames.map(n => typeof n === 'string' ? n.trim().replace(/\s+/g, ' ') : '');
  if (!botNames.every(n => /^[A-Za-z0-9 ]{1,30}$/.test(n))) return { error: 'Bot names use 1 to 30 letters, numbers, or spaces.' };
  if (!THEMES.some(t => t.id === d.themeId)) return { error: 'Pick a theme.' };
  return { profile: { callName, gender: d.gender, age, state: d.state, botNames, themeId: d.themeId } };
}

async function handleProfileSave(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const { profile, error } = cleanProfile(data);
  if (error) return sendJson(res, 400, { error });
  const all = readNotebooks();
  const book = all[s.uid] || { profile: null, facts: [] };
  book.profile = Object.assign(profile, {
    email: s.email,
    createdAt: (book.profile && book.profile.createdAt) || new Date().toISOString()
  }, book.profile && book.profile.taste ? { taste: book.profile.taste } : {}, // keep the Group Chat pick counts
  book.profile && book.profile.face ? { face: book.profile.face } : {},       // and Sim Sim's face
  book.profile && book.profile.botFaces ? { botFaces: book.profile.botFaces } : {});   // and the two Discussion bots' faces
  if (!Array.isArray(book.facts)) book.facts = [];
  // Round 3 retired (deleted) a notebook fact that conflicted with a newly-saved Basics value — a real memory
  // ("Moved to Tennessee on October 19, 2026") vanished silently after a state edit. Founder's end-check, round 6,
  // 2026-11-02: editing Basics must NEVER delete, hide or rewrite a memory fact — book.facts is untouched here now.
  // Precedence (the Basics field wins when the two disagree) happens at ANSWER time only, via the Memory rules in
  // memory.buildChatSystem — the fact stays exactly as the user typed it in "What Sim Sim remembers."
  all[s.uid] = book;
  writeNotebooks(all);
  s.history = [];   // the next answer must come from the fresh profile/notebook, never an earlier turn in this chat
  sendJson(res, 200, { ok: true, profile: book.profile });
}

function handleProfileGet(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const book = readNotebooks()[s.uid];
  if (!book || !book.profile) return sendJson(res, 404, { error: 'no profile' });
  sendJson(res, 200, { profile: book.profile });
}

// ---- Image lane: Meta's Muse Image model draws; it never thinks or answers ----
const IMAGES_DIR = path.join(DATA_DIR, 'images');

// One image from Muse Image. Returns the PNG bytes, or throws (the caller says one honest sentence).
function makeImage(prompt, key) {
  return imageCall(META_IMAGE_URL, { model: META_IMAGE_MODEL, prompt, n: 1, response_format: 'b64_json', output_format: 'png' }, key);
}
// One edited image: the same model, given the source picture as a data URL plus the user's own words.
// (Proven 2026-10-29: this JSON shape edits the real picture. The multipart "image" upload is silently IGNORED — never use it.)
function editImage(prompt, sourceDataUrl, key) {
  return imageCall(META_EDIT_URL, { model: META_IMAGE_MODEL, prompt, n: 1, response_format: 'b64_json', output_format: 'png',
    images: [{ image_url: sourceDataUrl }] }, key);
}
async function imageCall(url, body, key) {
  const call = () => fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150000)
  });
  let r;
  try { r = await call(); }
  catch (e) { r = await call(); } // one automatic retry, for a network error only
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = data && data.error;
    throw new Error('HTTP ' + r.status + (err ? ' ' + (err.code || err.type) : ''));
  }
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (typeof b64 !== 'string' || !b64) throw new Error('no image in the answer');
  return Buffer.from(b64, 'base64');
}

// "Here's the monkey you asked for." / "Here's your dog you asked for." (composed by our code, not the brain)
function imageLine(subject) {
  const s = subject.replace(/^(?:an?|the|some|one)\s+/i, '').replace(/\bmy\b/gi, 'your').replace(/\bmine\b/gi, 'yours').replace(/\bme\b/gi, 'you').replace(/\bour\b/gi, 'your').replace(/\bus\b/gi, 'you');
  return /^your\b/i.test(s) ? "Here's " + s + ' you asked for.' : "Here's the " + s + ' you asked for.';
}

async function answerImage(s, req, message, subject) {
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return { reply: STUB_REPLY, stub: true }; // STUB RULE: no other AI, ever
  let png;
  try { png = await makeImage(subject, key); } // the subject ("a husky in the snow"), not the whole sentence
  catch (e) {
    console.error('[image] ' + new Date().toLocaleTimeString() + ' failed: ' + e.message); // never the prompt
    return { reply: IMAGE_FAIL };
  }
  const name = saveImage(s, png);
  pictures.add(s.uid, name, 'made');   // "Your pictures"
  console.log('[image] ' + new Date().toLocaleTimeString() + ' drawn (' + Math.round(png.length / 1024) + ' KB)');
  return { reply: imageLine(subject), image: { url: '/api/images/' + name, subject } };
}

// A made or edited picture goes into the user's own folder; returns its file name.
// prefix 'face-' marks Sim Sim's face pictures, which live in Settings and never in "Your pictures".
function saveImage(s, png, prefix) {
  const dir = path.join(IMAGES_DIR, s.uid);
  fs.mkdirSync(dir, { recursive: true });
  const name = (prefix || '') + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex') + '.png';
  fs.writeFileSync(path.join(dir, name), png);
  return name;
}

// Draws, then tells the short conversation context what happened (words only), so the brain never
// guesses about its own pictures: it either drew one or the honest IMAGE_FAIL line was said.
async function drawReply(req, res, s, data, message, subject) {
  const out = await answerImage(s, req, message, subject);
  if (out.image && isMainChat(data)) s.currentImage = { file: out.image.url.split('/').pop() };
  out.process = out.stub ? { stub: true } : { usedMake: out.image ? true : 'failed' };
  rememberTurn(s, message, out.image ? '[Sim Sim drew a picture of ' + subject + ' and it is showing in this chat.] ' + out.reply : out.reply);
  sendReply(res, s, data, message, null, out);
  if (out.image && out.threadId) pictures.setThread(s.uid, out.image.url.split('/').pop(), out.threadId);
}

// ---- Edit lane: change a real picture — an upload, or this chat's CURRENT image (the newest picture in it) ----
// s.currentImage is { dataUrl } for an upload (kept in this session's memory only, never written to disk)
// or { file } for a picture Sim Sim made or edited (already in the user's own folder).
// Only the main 1-on-1 chat edits: the Screen Watch mini chat sends no thread, so its snapshots never become a current image.
function isMainChat(data) { return typeof data.thread === 'string' && data.screen !== true; }

function currentImageUrl(s) {
  const c = s.currentImage;
  if (!c) return null;
  if (c.dataUrl) return c.dataUrl;
  if (!/^[\w-]+\.png$/.test(c.file)) { s.currentImage = null; return null; }   // the same name rule serveImage uses
  try { return 'data:image/png;base64,' + fs.readFileSync(path.join(IMAGES_DIR, s.uid, c.file)).toString('base64'); }
  catch (e) { s.currentImage = null; return null; }
}
// A thread's own most recent picture — made or attached, any age: a match that was Sim Sim's own work (an upload
// can never be restored; its bytes were never kept) becomes the slot; anything else (including the newest picture
// being an upload) means there is nothing to restore. The ONE place this is decided — used on every chat open AND
// on every edit ask (founder, 2026-11-01), so the two can never disagree.
function latestImageIn(t) {
  const last = t.messages.slice().reverse().find(m => m.image || m.picture);
  return last && last.image && typeof last.image.url === 'string' ? { file: last.image.url.split('/').pop() } : null;
}

async function answerEdit(s, data, message, picture) {
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return { reply: STUB_REPLY, stub: true }; // STUB RULE: no other AI, ever
  if (picture) s.currentImage = { dataUrl: picture.dataUrl };   // the upload is the newest picture, even if the edit fails
  let source = currentImageUrl(s);
  // Restoration is unconditional (founder, 2026-11-01 — "Picture slot: verify and harden"): whatever left the slot
  // empty for THIS chat — a reload, a long-stale session, the page's own "reopen the main chat" step not having
  // finished yet (it sends 'new' until it has) — the chat the ask is actually for is read fresh for its own most
  // recent picture before giving up. A bare 'new' falls back to the thread this session was last known to be in,
  // since that is what 'new' means here before the page's own reopen call lands. Never guessed: a thread that
  // genuinely has no picture (or no thread at all yet) still gets the honest EDIT_NO_PHOTO line, exactly as before.
  if (!source && !picture) {
    const threadId = typeof data.thread === 'string' && data.thread !== 'new' ? data.thread : s.openThread;
    const t = typeof threadId === 'string' ? chats.get(s.uid, threadId) : null;
    if (t) { s.currentImage = latestImageIn(t); source = currentImageUrl(s); }
  }
  if (!source) return { reply: EDIT_NO_PHOTO };   // the slot is empty (new chat, server restart, sign-out): say so, once
  let png;
  try { png = await editImage(message, source, key); }   // the user's own words are the instruction
  catch (e) {
    console.error('[edit] ' + new Date().toLocaleTimeString() + ' failed: ' + e.message); // never the words, never the picture
    return { reply: EDIT_FAIL };
  }
  const name = saveImage(s, png);
  pictures.add(s.uid, name, 'edited');   // "Your pictures"
  s.currentImage = { file: name };   // "make it real" next refines THIS result
  console.log('[edit] ' + new Date().toLocaleTimeString() + ' edited (' + Math.round(png.length / 1024) + ' KB)');
  return { reply: EDIT_DONE, image: { url: '/api/images/' + name, subject: 'edited picture' } };
}

async function editReply(req, res, s, data, message, picture) {
  const out = await answerEdit(s, data, message, picture);
  const which = picture ? 'upload' : 'current';
  out.process = out.stub ? { stub: true } : { usedEdit: out.image ? which : out.reply === EDIT_NO_PHOTO ? 'nophoto' : which + '-failed' };
  rememberTurn(s, (picture ? '[shared a picture] ' : '') + message,
    out.image ? '[Sim Sim edited the picture as asked; the edited picture is showing in this chat.] ' + out.reply : out.reply);
  sendReply(res, s, data, message, picture, out);
  if (out.image && out.threadId) pictures.setThread(s.uid, out.image.url.split('/').pop(), out.threadId);
}

function rememberTurn(s, message, reply) {
  s.history = s.history || [];
  s.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
  if (s.history.length > 12) s.history.splice(0, s.history.length - 12);
}

// Serves a saved picture — only from the signed-in user's own folder.
function serveImage(req, res) {
  const s = getSession(req);
  if (!s) { res.writeHead(401); return res.end(); }
  const name = req.url.slice('/api/images/'.length).split('?')[0];
  if (!IMAGE_NAME.test(name)) { res.writeHead(404); return res.end(); }
  const file = path.join(IMAGES_DIR, s.uid, name);
  // "no-cache": the browser asks again every time, so a picture is only ever shown to the account that owns it —
  // even on a shared browser after switching accounts. A saved picture never changes, so the answer is usually a quick 304.
  const tag = '"' + name + '"';
  if (req.headers['if-none-match'] === tag && fs.existsSync(file)) { res.writeHead(304, { ETag: tag, 'Cache-Control': 'private, no-cache' }); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': IMAGE_TYPES[path.extname(name)], 'Cache-Control': 'private, no-cache', ETag: tag });
    res.end(data);
  });
}
// Made and edited pictures are .png; an uploaded face keeps its own checked format.
const IMAGE_NAME = /^[\w-]+\.(?:png|jpg|webp)$/;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

// ---- Sim Sim's face (founder, 2026-10-29) and the two Discussion bots' faces (2026-10-31): how they LOOK, per user.
// Never their names. The same route serves all three; { bot: 0|1 } picks a bot's slot in profile.botFaces. ----
// Stored on the profile as face: { kind: 'gallery', ref: <starter id> } or { kind: 'upload'|'made', ref: '/api/images/<name>' }.
// No face = the default "S" mark. Never in the notebook, never learned from, never sent to the brain.
const FACE_FRAMING = ', as a friendly avatar portrait: one character, face centered, simple plain background';

// An /api/images/<name> URL that exists in THIS user's own folder, or null.
function ownImageRef(uid, ref) {
  const m = typeof ref === 'string' && ref.match(/^\/api\/images\/([\w-]+\.(?:png|jpg|webp))$/);
  return m && fs.existsSync(path.join(IMAGES_DIR, uid, m[1])) ? ref : null;
}

// bot: 0 or 1 = a Discussion bot's face (profile.botFaces, aligned with botNames); null = Sim Sim's own face. face null = default.
// (The Settings face route and the Action Layer's set_face both write through here.)
function putFace(profile, bot, face) {
  if (bot === null) { if (face) profile.face = face; else delete profile.face; return; }
  const faces = Array.isArray(profile.botFaces) ? profile.botFaces.slice(0, 2) : [null, null];
  while (faces.length < 2) faces.push(null);
  faces[bot] = face || null;
  if (faces.some(Boolean)) profile.botFaces = faces; else delete profile.botFaces;
}
async function handleFace(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res, 7500000, PICTURE_TOO_LARGE);   // room for one uploaded picture of up to 5 MB
  if (!data) return;
  let face;
  if (data.kind === 'default') face = null;
  else if (data.kind === 'gallery') {
    if (!FACES.some(f => f.id === data.id)) return sendJson(res, 400, { error: 'Pick one of the faces shown.' });
    face = { kind: 'gallery', ref: data.id };
  } else if (data.kind === 'upload') {
    const pic = parsePicture(data.image);   // the same checks as every shared picture: real PNG/JPEG/WebP bytes, up to 5 MB
    if (!pic) return sendJson(res, 400, { error: 'Choose a picture first.' });
    if (pic.error) return sendJson(res, pic.status || 400, { error: pic.error });
    const m = pic.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    const dir = path.join(IMAGES_DIR, s.uid);
    fs.mkdirSync(dir, { recursive: true });
    const name = 'face-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'));
    face = { kind: 'upload', ref: '/api/images/' + name };
  } else if (data.kind === 'made') {
    const ref = ownImageRef(s.uid, data.ref);   // only a picture made for THIS user
    if (!ref) return sendJson(res, 400, { error: "I couldn't find that picture — try making it again." });
    face = { kind: 'made', ref };
  } else return sendJson(res, 400, { error: 'Bad request.' });
  const all = readNotebooks(), b = bookFor(all, s.uid);
  if (!b.profile) return sendJson(res, 404, { error: 'no profile' });
  const bot = data.bot === 0 || data.bot === 1 ? data.bot : null;
  putFace(b.profile, bot, face);
  writeNotebooks(all);
  console.log('[face] ' + new Date().toLocaleTimeString() + ' set' + (bot === null ? '' : ' (bot ' + (bot + 1) + ')') + ': ' + (face ? face.kind : 'default'));
  sendJson(res, 200, { profile: b.profile });
}

// "Make one": the make lane draws a face from the user's words. It returns a PREVIEW only — nothing is set until
// the user taps "Use this face" (POST /api/face { kind: 'made', ref }).
async function handleFaceMake(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const words = typeof data.description === 'string' ? data.description.replace(/[\u0000-\u001f]/g, ' ').trim().replace(/\s+/g, ' ') : '';
  if (words.length < 3 || words.length > 200) return sendJson(res, 400, { error: 'Describe the face in 3 to 200 characters.' });
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return sendJson(res, 503, { error: STUB_REPLY });   // STUB RULE: no other AI, ever
  let png;
  try { png = await makeImage(words + FACE_FRAMING, key); }
  catch (e) {
    console.error('[face] ' + new Date().toLocaleTimeString() + ' make failed: ' + e.message);   // never the words
    return sendJson(res, 502, { error: "I couldn't make that face right now. Try again in a moment." });
  }
  const name = saveImage(s, png, 'face-');
  console.log('[face] ' + new Date().toLocaleTimeString() + ' preview made (' + Math.round(png.length / 1024) + ' KB)');
  sendJson(res, 200, { preview: { url: '/api/images/' + name } });
}

// The signed-in user's notebook (created empty if needed).
function bookFor(all, uid) {
  const book = all[uid] || { profile: null, facts: [] };
  if (!Array.isArray(book.facts)) book.facts = [];
  if (!Array.isArray(book.loops)) book.loops = [];
  all[uid] = book;
  return book;
}

// ---- Open loops: closing (plain code — only ever on the user's word) ----
function closeIds(uid, ids) {
  const all = readNotebooks(), book = bookFor(all, uid);
  const closed = book.loops.filter(l => ids.includes(l.id) && l.status === 'open');
  closed.forEach(loops.close);
  writeNotebooks(all);
  return closed;
}
function closedLine(closed) {
  if (!closed.length) return 'That one is already closed.';
  return 'Done — I closed ' + closed.map(l => "'" + l.text + "'").join(' and ') + '.';
}
function askWhichLoop(s, candidates, intro) {
  s.pending = { type: 'loopPick', ids: candidates.map(l => l.id), at: Date.now() };   // never guess-close
  if (candidates.length === 1) return intro + " Do you mean '" + candidates[0].text + "'? Say yes to close it.";
  return intro + ' ' + candidates.map((l, i) => (i + 1) + ") '" + l.text + "'").join('  ') + '. Which one is done? Say the number or its name.';
}
// A done-phrase: close the ONE clear match, otherwise ask. Returns the reply, or null when there is nothing to close.
function answerDone(s, task, open) {
  if (!open.length) return null; // nothing open: treat it as normal chat
  if (!task) return askWhichLoop(s, open, 'Nice!');
  const hits = loops.matchLoops(open, task);
  if (hits.length === 1) return closedLine(closeIds(s.uid, [hits[0].id]));
  if (hits.length > 1) return askWhichLoop(s, hits, 'A few loops match that:');
  return askWhichLoop(s, open, "I couldn't find that in your open loops. They are:");
}

// ---- Forgetting (plain code, no brain call) ----
const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|confirm|do it|go ahead)\b/i;
const NO = /^(no|nope|nah|cancel|stop|don'?t|keep)\b/i;
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// Which of the listed choices did the user pick? Positions only from a real number ("2", "the second one",
// "number two") — never from a stray "one" ("the bank one" is a name, not choice 1). Returns ids, maybe empty.
function pickedByPosition(t, ids) {
  const s = t.toLowerCase().trim().replace(/[.!?]+$/, '');
  const alone = s.match(/^(?:number |no\.? |#)?(\d+|one|two|three|four|five|six)$/);
  const picks = [];
  if (alone) picks.push(NUMBER_WORDS[alone[1]] || Number(alone[1]));
  for (const m of s.matchAll(/\b(\d+|first|second|third|fourth|fifth|sixth)\b/g)) picks.push(ORDINALS[m[1]] || Number(m[1]));
  return [...new Set(picks)].map(n => ids[n - 1]).filter(Boolean);
}

function forgetIds(uid, ids) {
  const all = readNotebooks(), book = bookFor(all, uid);
  const gone = book.facts.filter(f => ids.includes(f.id));
  book.facts = book.facts.filter(f => !ids.includes(f.id));
  writeNotebooks(all);
  return gone;
}
function forgotLine(gone) {
  if (!gone.length) return "That's already gone from my notebook.";
  if (gone.length === 1) return 'Done — I forgot: ' + memory.plain(gone[0].text) + '.';
  return 'Done — I forgot ' + gone.length + ' things: ' + gone.map(f => memory.plain(f.text)).join('; ') + '.';
}

// A reply to an earlier "are you sure?" / "which one?". Returns the reply, or null to treat the message normally.
function answerPending(s, message) {
  const p = s.pending;
  s.pending = null;
  if (!p || Date.now() - p.at > 2 * 60 * 1000) return null;
  const t = message.trim();
  if (p.type === 'forgetAll') {
    if (YES.test(t)) {
      const all = readNotebooks(), book = bookFor(all, s.uid), n = book.facts.length;
      book.facts = [];          // facts only: the profile basics stay
      writeNotebooks(all);
      return 'Done — I forgot all ' + n + ' things you told me. Your basics are still saved.';
    }
    if (NO.test(t)) return 'Okay — I kept everything.';
    return null;
  }
  if (p.type === 'loopPick') {
    if (NO.test(t)) return 'Okay — I left them open.';
    let picks = [];
    if (p.ids.length === 1 && YES.test(t)) picks = p.ids;
    else if (/\b(all|both|every|each)\b/i.test(t)) picks = p.ids;
    else {
      picks = pickedByPosition(t, p.ids);
      if (!picks.length) {   // or they named it: "the bank one"
        const open = bookFor(readNotebooks(), s.uid).loops.filter(l => p.ids.includes(l.id) && l.status === 'open');
        const hits = loops.matchLoops(open, t);
        if (hits.length === 1) picks = [hits[0].id];
      }
    }
    if (!picks.length) return null;
    if (actions.decision(permissionsOf(s.uid), 'complete_loop') !== 'allow') return { action: 'complete_loop', args: { ids: [...new Set(picks)] } };
    return closedLine(closeIds(s.uid, [...new Set(picks)]));
  }
  if (p.type === 'forgetPick') {
    if (NO.test(t)) return 'Okay — I kept them.';
    let picks = [];
    if (/\b(all|both|every|each)\b/i.test(t)) picks = p.ids;
    else {
      picks = pickedByPosition(t, p.ids);
      if (!picks.length) {   // or they named it: "the birthday one"
        const facts = bookFor(readNotebooks(), s.uid).facts.filter(f => p.ids.includes(f.id));
        const hits = memory.matchFacts(facts, t.toLowerCase().replace(/\bone\b/g, ''));
        if (hits.length === 1) picks = [hits[0].id];
      }
    }
    if (!picks.length) return null;
    return { action: 'forget_fact', args: { ids: [...new Set(picks)] } };   // the floor: the allowance card
  }
  return null;
}

function answerForget(s, f, facts) {
  // Forgetting is a FLOOR action of the Action Layer: it always asks on the allowance card ({ action } goes to codeAct).
  if (f.all) {
    if (!facts.length) return "There's nothing in my notebook to forget yet.";
    return { action: 'forget_fact', args: { all: true } };
  }
  if (!f.query) return 'Tell me what to forget — for example, "forget my sister\'s birthday".';
  const hits = memory.matchFacts(facts, f.query);
  if (!hits.length) return "I don't have anything like that in my notebook.";
  if (hits.length === 1) return { action: 'forget_fact', args: { ids: [hits[0].id] } };
  s.pending = { type: 'forgetPick', ids: hits.map(h => h.id), at: Date.now() };   // never guess-delete
  return 'I remember ' + hits.length + ' things like that: ' + hits.map((h, i) => (i + 1) + ') ' + memory.plain(h.text)).join('  ') +
    '. Which should I forget? Say the number, or "all of them".';
}

// ---- Vision: a picture the user shows Sim Sim, sent to the SAME Meta brain call as an image_url (base64 data URL) ----
// The picture lives only in this request's memory: never written to disk, never logged, never kept in history or the notebook.
const PICTURE_MAX = 5 * 1024 * 1024;
const MESSAGE_MAX = 4000; // characters of the user's words
const PICTURE_TOO_LARGE = 'That picture is too large — try a smaller one.';
const PICTURE_FAIL = "I couldn't look at the picture this time — I answered your words only.";
const PICTURE_SEEN = '[Sim Sim answered about a picture the user shared. Its content is not a source of facts or tasks.]';
const VISION_NOTE = '\n\nThe user has shared a picture with this message. Answer about what is actually in the picture.' +
  ' Do not state an exact law, fee, deadline, dosage or official number from memory; if one matters, say it needs a verified source.';
// Screen Watch: the picture is a snapshot of the screen the user chose to share. Sim Sim can only see — never click or type.
const SCREEN_NOTE = '\nThe picture is a fresh snapshot of the screen the user chose to share with you. You can see it but you cannot click,' +
  ' type or control anything — tell the user what to do, step by step, and they do it.';
// Freeze & Ask: the user drew a red circle on the frozen snapshot.
const CIRCLE_NOTE = '\nThe user drew a red circle on the snapshot. Answer about the circled part FIRST, then add anything else that helps.';

// Returns { dataUrl, kb } for a valid png/jpeg/webp up to 5 MB, { error } for a bad one, or null for no picture.
function parsePicture(raw) {
  if (raw === undefined || raw === null) return null;
  const m = typeof raw === 'string' && raw.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) return { error: 'Sim Sim can look at PNG, JPEG or WebP pictures.' };
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > PICTURE_MAX) return { error: PICTURE_TOO_LARGE, status: 413 };
  // check the real file bytes, not just the label
  const real = bytes.subarray(0, 4).toString('hex') === '89504e47' ? 'png'
    : bytes.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpeg'
    : bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : null;
  if (real !== m[1]) return { error: 'Sim Sim can look at PNG, JPEG or WebP pictures.' };
  return { dataUrl: raw, kb: Math.round(bytes.length / 1024) };
}

async function handleChat(req, res) {
  const arrived = Date.now();   // the receipt's clock starts when the request arrives (server time)
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  // room for one picture of up to 5 MB (base64 is about a third bigger); the picture rides in its own field, data.image
  const data = await readJson(req, res, 7500000, PICTURE_TOO_LARGE);
  if (!data) return;
  data[ARRIVED] = arrived;   // a Symbol key: a request body can never set it
  // Send-becomes-Stop (founder, 2026-10-31): this turn can be cancelled by POST /api/chat/stop while it is running.
  // Main chat only (the only composer with a Stop button) — never the Screen Watch mini chat, which shares this same
  // handler but has nothing to do with s.inflight, so it can never overwrite the main chat's own cancel token.
  if (isMainChat(data)) { const inflight = { cancelled: false }; data[INFLIGHT] = inflight; s.inflight = inflight; }
  const picture = parsePicture(data.image);
  if (picture && picture.error) return sendJson(res, picture.status || 400, { error: picture.error });
  // the words limit measures the WORDS only — the picture never counts against it
  let message = typeof data.message === 'string' ? data.message.trim().slice(0, MESSAGE_MAX) : '';
  // A voice note (1-on-1 chat only): the audio is saved for this user; the brain gets the note's TRANSCRIPT (Chrome's own
  // recognition during the recording) — or an honest "no transcript" marker, and must never invent what it said.
  if (data.voice !== undefined && data.voice !== null) {
    if (!isMainChat(data) || picture) return sendJson(res, 400, { error: 'Voice notes are for the main chat.' });
    const vn = saveVoiceNote(s.uid, data.voice);
    if (vn.error) return sendJson(res, vn.status || 400, { error: vn.error });
    message = vn.transcript || VOICE_NO_TRANSCRIPT;
    data[VOICE] = vn;
  }
  if (!message && !picture) return sendJson(res, 400, { error: 'Empty message.' });
  // Any new message instead of a choice CANCELS a held action (an allowance card): it never fires later in the background.
  if (s.pendingAction) { s.pendingAction = null; console.log('[actions] a held action was cancelled by a new message'); }
  console.log('[chat] ' + new Date().toLocaleTimeString() + ' message received (' + message.length + ' characters' +
    (picture ? ' + a picture, ' + picture.kb + ' KB' : '') + ')'); // never the words, never the picture
  // A message for a saved thread this session isn't in (e.g. after a server restart, or another tab switched chats):
  // step into THAT thread first, so one chat's conversation never answers inside another.
  if (typeof data.thread === 'string' && data.thread !== 'new' && data.thread !== s.openThread && data.screen !== true) {
    const t = chats.get(s.uid, data.thread);
    if (t) enterThread(s, t);
  }

  // Language preference hygiene (founder, 2026-11-01): a language instruction ("reply in Spanish") is already
  // learned as an ordinary preference fact by the extractor — that half worked. Ending it ("back to English",
  // "English now", "stop speaking Spanish") never un-learned it: the extractor only ever adds or updates a fact,
  // it has no "remove" op, so the stale preference survived until deleted by hand. Fixed in code, deterministically,
  // and before the reply below is composed — so the reply itself is in the right language this same turn, not the
  // next one. A message that doesn't match, or a notebook with no such fact, is a safe no-op either way.
  if (!memory.looksSecret(message) && memory.isLanguageResetMessage(message)) {
    const all = readNotebooks(), b = bookFor(all, s.uid);
    const before = b.facts.length;
    b.facts = b.facts.filter(f => !memory.isLanguagePreferenceFact(f));
    if (b.facts.length !== before) writeNotebooks(all);
  }

  // Voice-change / voice-preference asks: ONE honest line, in code, before anything else — never the picture
  // lane (even with a picture attached this turn or already in the chat) and never the Action Layer's set_voice
  // tool (round 2 end-check, 2026-11-02).
  if (isMainChat(data) && !memory.looksSecret(message) && voiceChangeAsk(message)) {
    s.pending = null;
    rememberTurn(s, message, VOICE_HONEST);
    return sendReply(res, s, data, message, null, { reply: VOICE_HONEST,
      process: { command: "Answered about Sim Sim's voice with a fixed honest line (no brain call, no tool attempted)" } });
  }

  // With a picture: a verb-led CHANGE instruction ("add a dog here") edits it; anything else — above all a question —
  // goes straight to the brain with the picture (Vision). When in doubt it is Vision: never change a photo on a guess.
  if (picture) {
    if (isMainChat(data) && message && editRequest(message)) return editReply(req, res, s, data, message, picture);
    if (isMainChat(data)) s.currentImage = { dataUrl: picture.dataUrl };   // the newest picture in this chat
    return answerChat(req, res, s, data, message, picture);
  }

  // Sim Sim asked "What should I call it?" (a rename ask with no name given): the very next message is the name,
  // unless it cancels or is clearly a new question/command — handled entirely in code, so this can never reach the
  // brain or hang on an LLM call (founder, 2026-11-01 — the old path sent a nameless rename ask to the Action Layer's
  // brain tool, which sometimes guessed a name instead of asking, or took two sequential brain calls to answer).
  if (s.pending && s.pending.type === 'renameChat') {
    const p = s.pending;
    s.pending = null;   // one answer only: a cancel or a new question lets the message flow on normally
    const n = Date.now() - p.at <= RENAME_ASK_WAIT ? renameNameReply(message) : null;
    if (n) {
      if (n.length > chats.TITLE_MAX) {
        rememberTurn(s, message, RENAME_TOO_LONG);
        return sendReply(res, s, data, message, null, { reply: RENAME_TOO_LONG,
          process: { command: "Read your answer as a chat name, but it was too long (no brain call)" } });
      }
      const reply = "Done — this chat is now '" + n + "'.";
      rememberTurn(s, message, reply);
      return sendReply(res, s, data, message, null, { reply, retitle: n,
        process: { command: "Renamed this chat with Sim Sim's own code (no brain call)" } });
    }
  }

  // Rename by asking: "name it Rasputin" renames THIS chat (a side chat's name in the list), in code — never a pretend
  // rename by the brain. With no name given ("rename this chat"), Sim Sim asks what to call it in code (above handles
  // the answer next turn) — a nameless rename ask never reaches the brain, so it can never hang on an LLM call.
  const rename = isMainChat(data) && !memory.looksSecret(message) ? chats.renameRequest(message) : null;
  if (rename) {
    s.pending = null;
    if (rename.tooLong) {
      rememberTurn(s, message, RENAME_TOO_LONG);
      return sendReply(res, s, data, message, null, { reply: RENAME_TOO_LONG,
        process: { command: "Read your message as a chat rename, but the name was too long (no brain call)" } });
    }
    if (!rename.title) {
      s.pending = { type: 'renameChat', at: Date.now() };
      rememberTurn(s, message, RENAME_ASK);
      return sendReply(res, s, data, message, null, { reply: RENAME_ASK,
        process: { command: "Read your message as a chat rename with no name yet — asked what to call it (no brain call)" } });
    }
    const reply = "Done — this chat is now '" + rename.title + "'.";
    rememberTurn(s, message, reply);
    return sendReply(res, s, data, message, null, { reply, retitle: rename.title,
      process: { command: "Renamed this chat with Sim Sim's own code (no brain call)" } });
  }

  // "Make a side chat" by asking: done in code, before the brain — never a pretend creation, never a coached rephrase.
  const side = isMainChat(data) && !memory.looksSecret(message) ? chats.sideChatRequest(message) : null;
  if (side) return sideChatReply(res, s, data, message, side);

  // A timed reminder ("remind me in 20 minutes to stretch", "remind me at 7 pm to call the store"): our code reads the time
  // and confirms exactly what it understood. No time in the message -> it flows on as usual (it may become an open loop).
  const rem = isMainChat(data) && !memory.looksSecret(message) ? reminders.parse(message) : null;
  if (rem) {
    s.pending = null;
    const item = reminders.add(s.uid, rem);
    const all = readNotebooks(), b = bookFor(all, s.uid);
    if (b.briefing) { b.briefing = null; writeNotebooks(all); }   // today's briefing is remade with it next time
    const reply = reminders.confirmLine(item);
    rememberTurn(s, message, reply);
    console.log('[reminders] set one, due in ' + Math.round((item.dueAt - Date.now()) / 60000) + ' min');   // never the words
    return sendReply(res, s, data, message, null, { reply, remindersChanged: true,
      process: { command: "Set a reminder with Sim Sim's own code (no brain call) — it shows when Sim Sim is open on this computer" } });
  }

  // "How long did that take?" / "how do you answer questions?": answered by code from the stored receipt or the fixed
  // process text — never the brain, which can't know its own timing.
  if (isMainChat(data) && receipt.asksAboutLast(message)) {
    return sendReply(res, s, data, message, null, { reply: receipt.lastAnswerLine(s.lastAnswer), aboutReceipt: true });
  }
  if (isMainChat(data) && receipt.asksProcess(message)) {
    rememberTurn(s, message, receipt.PROCESS_TEXT);
    return sendReply(res, s, data, message, null, { reply: receipt.PROCESS_TEXT,
      process: { command: "Answered from Sim Sim's fixed description of its own process (no brain call)" } });
  }

  // "Delete all my chats": done in code, before the brain ever picks a tool — never a guess between this one
  // chat and every chat (round 2 end-check, 2026-11-02). Still goes through the same Permissions/floor card
  // (codeAct -> tryAction -> planAction's 'delete_all_chats' case): this only fixes WHICH action runs, not whether
  // it asks first.
  if (isMainChat(data) && !memory.looksSecret(message) && DELETE_ALL_CHATS_ASK.test(message) && !(s.pending && s.pending.type === 'imageSubject')) {
    s.pending = null;
    return codeAct(res, s, data, message, 'delete_all_chats', {});
  }

  // "Open the browser view": done in code, never left to the brain's tool-calling (round 4 end-check, 2026-11-02).
  // Found by comparison with a working ask ("open my open loops"): that one also just relies on the Action Layer's
  // brain call to pick open_view, and when the brain doesn't call ANY tool on its first turn, actionLane returns
  // false and the message falls through — for "browser" specifically, straight into browser.wantsBrowser's own
  // BROWSER_WORD match ("the browser" in "open the browser view"), which starts a SEPARATE browser-TASK brain call
  // (browserReply) with its own system prompt. That call, given nothing concrete to navigate to, just talked back
  // ("Okay — opening the Browser for you.") — a real reply, but from a lane that never pushes a view-opening effect,
  // so the panel never appeared. This intercept makes the one phrasing that means "show me the panel" (as opposed
  // to "open the browser AND go to weather.gov", left alone, below) a guaranteed codeAct call: the reply is built
  // directly from the action's own result, so it can never be sent before the effect that opens the view.
  const OPEN_BROWSER_VIEW = /^(?:(?:hey|hi|ok|okay|please|sim\s*sim)[,\s]+)*(?:(?:can|could|would|will) you\s+|i(?:'d| would) like (?:you )?to\s+|i want (?:you )?to\s+)?(?:please\s+)?(?:open|show(?: me)?|see|look at|pull up|bring up)\s+(?:the|my|your)?\s*(?:sim\s*sim'?s?\s*)?browser(?:\s+(?:view|panel|screen|tab))?[.!? ]*$/i;
  if (isMainChat(data) && !memory.looksSecret(message) && OPEN_BROWSER_VIEW.test(message) && !(s.pending && s.pending.type === 'imageSubject')) {
    s.pending = null;
    return codeAct(res, s, data, message, 'open_view', { view: 'browser' });
  }

  // The Action Layer: a message that names something in the app with a doing-word gets the brain WITH its tools
  // (side chats, screens, theme, faces, voice, loops, forgetting…), under the user's Permissions. No tool called -> it flows on.
  if (isMainChat(data) && actions.mightAct(message) && !(s.pending && s.pending.type === 'imageSubject')) {
    if (await actionLane(req, res, s, data, message)) return;
  }

  // Sim Sim's browser: a web address to open, a web search, tab words, or — while it is open — "this page".
  if (isMainChat(data) && !(s.pending && s.pending.type === 'imageSubject') && browser.wantsBrowser(message, s.uid)) {
    s.pending = null;
    return browserReply(req, res, s, data, message);
  }

  // The Website Lane: an explicit "make me a website" ask gets a REAL, working HTML page — never a picture, a PDF,
  // or a code dump pretending to be one. Checked before the Document Lane (website asks never carry "file"/"PDF" words).
  if (isMainChat(data) && !(s.pending && s.pending.type === 'imageSubject') && websites.wantsWebsite(message)) {
    s.pending = null;
    return websiteReply(req, res, s, data, message);
  }

  // The Document Lane: an explicit file ask ("make a PDF", "as a file", "a list I can download") gets a REAL PDF.
  if (isMainChat(data) && !(s.pending && s.pending.type === 'imageSubject') && documents.wantsDocument(message)) {
    s.pending = null;
    return documentReply(req, res, s, data, message);
  }

  // No picture attached, but a change instruction: edit this chat's current image ("make it real", "remove the kid").
  // Never the brain: it can't change a picture, so it must never get the chance to describe one as changed.
  // An empty slot gets the one honest attach-once line (answerEdit).
  // A request for TEXT to copy ("give me a prompt for an image of…", "give it with a copy button") is never a picture to make
  // or edit — it goes to the brain, which writes the text in a block (founder, 2026-10-30). The picture lanes themselves are unchanged.
  const wantsText = TEXT_DELIVERABLE.test(message);
  if (isMainChat(data) && !wantsText && editRequest(message) && !(s.pending && s.pending.type === 'imageSubject') &&
    !loops.parseDone(message) && !memory.parseForget(message)) {
    s.pending = null;
    return editReply(req, res, s, data, message, null);
  }

  // Pending picture offer (founder, 2026-10-31): if Sim Sim's last reply offered a picture and the user
  // confirms in any words, CODE makes it with the subject from that conversation. The user never re-asks.
  if (s.pendingPicture) {
    const pendingPic = s.pendingPicture;
    s.pendingPicture = null;   // an offer is answered by the very next message, or it lapses
    if (PREVIEW_CONFIRM.test(String(message).trim())) {
      return drawReply(req, res, s, data, message, pendingPic.subject);
    }
  }

  // Image lane FIRST: a "make a picture" request goes to Muse Image — no text-brain call,
  // and it is never learned from (it returns before the memory step).
  const img = wantsText ? null : imageRequest(message);
  if (img && img.subject) {
    s.pending = null;
    return drawReply(req, res, s, data, message, img.subject);
  }
  if (img) {   // a picture request with no subject yet: ask, and the next message is the subject
    s.pending = { type: 'imageSubject', at: Date.now() };
    rememberTurn(s, message, IMAGE_ASK);
    return sendReply(res, s, data, message, null, { reply: IMAGE_ASK, askSubject: true,
      process: { command: 'Read your message as a request to make a picture, with no subject yet — asked what it should show (no brain call)' } });
  }
  if (s.pending && s.pending.type === 'imageSubject') {
    const p = s.pending;
    s.pending = null;   // one answer only: a cancel or a new question lets the message flow on normally
    const subject = Date.now() - p.at <= IMAGE_ASK_WAIT ? subjectReply(message) : null;
    if (subject && !loops.parseDone(message) && !memory.parseForget(message) && !briefing.asksForBriefing(message)) {
      return drawReply(req, res, s, data, message, subject);
    }
  }

  // Read first: this user's own notebook (profile + facts), by the uid from the verified session.
  const book = bookFor(readNotebooks(), s.uid);

  // Follow-ups ("which one?"), done-phrases and forget commands are handled here, without the brain.
  const pendingReply = answerPending(s, message);
  if (pendingReply && pendingReply.action) return codeAct(res, s, data, message, pendingReply.action, pendingReply.args);
  if (pendingReply) return sendReply(res, s, data, message, null, { reply: pendingReply, memoryChanged: true, loopsChanged: true,
    process: { command: "Answered your follow-up with Sim Sim's own code (no brain call)" } });
  const done = loops.parseDone(message);
  if (done) {
    // Memory & loops set to Ask or Never: the done-phrase goes through the Action Layer (card / refusal) instead
    if (actions.decision(permissionsOf(s.uid), 'complete_loop') !== 'allow' && loops.openSorted(book.loops).length)
      return codeAct(res, s, data, message, 'complete_loop', { match: done.task });
    const doneReply = answerDone(s, done.task, loops.openSorted(book.loops));
    if (doneReply) return sendReply(res, s, data, message, null, { reply: doneReply, loopsChanged: true,
      process: { command: "Checked your open loops with Sim Sim's own code (no brain call)" } });
  }
  const forget = memory.parseForget(message);
  const forgetOut = forget ? answerForget(s, forget, book.facts) : null;
  if (forgetOut && forgetOut.action) return codeAct(res, s, data, message, forgetOut.action, forgetOut.args);
  if (forget) return sendReply(res, s, data, message, null, { reply: forgetOut, memoryChanged: true,
    process: { command: "Handled your forget request in your notebook with Sim Sim's own code (no brain call)" } });

  // Morning briefing in chat: "what's my morning briefing?", or "good morning" as the first wake command of the day.
  let wantBriefing = briefing.asksForBriefing(message);
  const briefingOn = settings.settingsOf(book).briefingOn; // Settings > Briefing & loops
  if (data.viaWake === true) {
    const all = readNotebooks(), b = bookFor(all, s.uid), day = loops.today();
    if (briefingOn && b.wakeDay !== day && briefing.isGoodMorning(message)) wantBriefing = true;
    b.wakeDay = day; // remembers that today's first wake command has happened
    writeNotebooks(all);
  }
  if (wantBriefing && !briefingOn) return sendReply(res, s, data, message, null, { reply: BRIEFING_OFF,
    process: { command: "Your morning briefing is turned off in Settings — answered by Sim Sim's own code" } });
  if (wantBriefing) {
    let text;
    try { text = (await briefingFor(s.uid, loops.today(), false)).text; }
    catch (e) { return sendJson(res, 502, { error: e.message }); }
    s.history = s.history || [];
    s.history.push({ role: 'user', content: message }, { role: 'assistant', content: text });
    return sendReply(res, s, data, message, null, { reply: text, briefing: true,
      process: { command: 'Put together your morning briefing from your notebook and open loops' } });
  }

  return answerChat(req, res, s, data, message, null);
}

// Send becomes Stop (founder, 2026-10-31): the composer's Stop click lands here. If a browser task is running for
// this user, its own stop is called too (the same one the panel's Stop button uses) — a no-op if none is running.
async function handleChatStop(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  if (s.inflight) s.inflight.cancelled = true;
  try { browser.stop(s.uid); } catch (e) {}
  sendJson(res, 200, { ok: true });
}

// Every answered 1-on-1 turn goes into the user's saved thread (Chat history) before the reply is sent.
// data.thread: 'new' or a thread id from the main chat. The Screen Watch mini chat sends none, so it is not saved.
// It is also where the "How I answered" receipt is made: out.process (route facts) -> answerTimeMs + plain-word steps.
function sendReply(res, s, data, message, picture, out) {
  // Stopped (founder, 2026-10-31): the user cancelled this turn — it must never be saved, shown or spoken.
  // The Meta call may already have finished server-side; Stop only guarantees the answer never lands.
  // Checked on data[INFLIGHT] — THIS request's own token — never s.inflight directly: a second concurrent request
  // on the same session (another tab) reassigns s.inflight to ITS OWN token, and must never cancel this one too.
  const inflight = data[INFLIGHT];
  if (inflight && inflight.cancelled) { if (s.inflight === inflight) s.inflight = null; try { res.end(); } catch (e) {} return; }
  if (s.inflight === inflight) s.inflight = null;
  const ms = Date.now() - data[ARRIVED];   // reply ready: server time since the request arrived
  const proc = out.process;
  const willSave = typeof out.reply === 'string' && typeof data.thread === 'string' && data.thread.length <= 40;
  if (proc) {
    if (willSave) proc.savedChat = true;
    out.answerTimeMs = ms;
    out.receipt = { ms, steps: receipt.steps(proc) };
  }
  if (willSave) {
    try {
      const saved = chats.saveTurn(s.uid, data.thread, {
        message, picture: picture ? (data.screen === true ? 'screen' : 'picture') : null, secret: memory.looksSecret(message), quote: cleanQuote(data.quote),
        voice: data[VOICE] || null
      }, out);
      out.threadId = saved.threadId;
      out.messageIds = saved.messageIds;   // for reactions and delete on the page
      s.openThread = saved.threadId;       // the thread this conversation's context belongs to
    } catch (e) {
      console.error('[chats] could not save this turn: ' + e.message);
      if (proc) { proc.savedChat = false; out.receipt.steps = receipt.steps(proc); }   // never list a step that didn't happen
    }
  }
  // the last answer's receipt, for "how long did that take?" (memory only; never the brain's context)
  if (out.receipt && isMainChat(data)) s.lastAnswer = { ms, steps: out.receipt.steps, turnId: out.turnId || null };
  // Pending picture offer (founder, 2026-10-31): this reply offered a picture — the very next message may just confirm it.
  if (isMainChat(data) && typeof out.reply === 'string' && OFFER_MARKERS.test(out.reply)) {
    s.pendingPicture = { subject: subjectFrom(message), at: Date.now() };
  }
  sendJson(res, 200, out);
}

// Reply: the quoted message, kept with the saved user message for DISPLAY only — never the brain's context, the notebook
// or learning. A quote that looks like a password or secret is not kept.
function cleanQuote(q) {
  if (!q || typeof q.who !== 'string' || typeof q.text !== 'string') return null;
  const tidy = (t, n) => t.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const who = tidy(q.who, 40), text = tidy(q.text, 300);
  if (!who || !text || memory.looksSecret(text)) return null;
  return { who, text };
}

// The answer itself (with or without a picture), then the guardian, the short history and the learn step.
async function answerChat(req, res, s, data, message, picture) {
  const book = bookFor(readNotebooks(), s.uid);
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return sendReply(res, s, data, message, picture, { reply: STUB_REPLY, stub: true, process: { stub: true } }); // STUB RULE: no other AI, ever

  let result, pictureNote = null;
  const proc = {};   // receipt facts: only what actually runs below
  s.history = s.history || [];
  if (picture) {
    // ONE brain call: the words and the picture together, in the model's image input format.
    const openLoops = loops.openSorted(book.loops).slice(0, 20);
    try {
      const reply = await askMeta([
        { role: 'system', content: memory.buildChatSystem(book.profile, book.facts, openLoops, null, settings.settingsOf(book), data.tz) + VISION_NOTE +
          (data.screen === true ? SCREEN_NOTE : '') + (data.circled === true ? CIRCLE_NOTE : '') },
        ...s.history.slice(-6),
        { role: 'user', content: [{ type: 'text', text: message || 'What does this picture show?' }, { type: 'image_url', image_url: { url: picture.dataUrl } }] }
      ], key);
      result = { lane: 'picture', reply };
      Object.assign(proc, { usedNotebook: Math.min(book.facts.length, memory.MAX_FACTS_IN_CONTEXT), openLoops: openLoops.length, usedVision: true, wrote: true });
    } catch (e) {
      console.error('[chat] picture call failed: ' + e.message);
      if (!message) return sendReply(res, s, data, message, picture, { reply: PICTURE_FAIL, pictureFailed: true, process: { usedVision: 'failed' } });
      pictureNote = PICTURE_FAIL;   // the typed words still get an answer, below
      proc.usedVision = 'failed';
    }
  }
  // The Answers Process: general -> fast lane; precise -> notebook, the Book, official web, or an honest "no source".
  if (!result) {
    // A sane ceiling (founder's end-check, round 3, 2026-11-02): this lane can chain several Meta calls (classify,
    // the Book, a web search, compose), each with its OWN up-to-60s budget — a slow moment on any one of them could
    // leave the user looking at "Thinking…" for minutes with no reply and no error until they gave up and hit Stop.
    // One overall 45s deadline on the whole lane means the chat always gets an answer, even a plain one. On a
    // timeout the underlying call is left running, unobserved — harmless, the same "Stop only guarantees the answer
    // never lands" pattern already used elsewhere — it just never gets to reply with whatever it eventually returns.
    const race = await raceOrTimeout(answers.answer({
      ask: (messages, opts) => askMeta(messages, key, opts),
      searchWeb: prompt => searchWebUrls(prompt, key),
      message, history: s.history, profile: book.profile, facts: book.facts, loops: loops.openSorted(book.loops).slice(0, 20),
      settings: settings.settingsOf(book), tz: data.tz
    }), CHAT_CEILING_MS);
    if (race.timedOut) {
      return sendReply(res, s, data, message, picture, { reply: CHAT_STUCK_REPLY,
        process: { command: 'The brain took longer than 45s to answer — ended with a plain reply instead of waiting' } });
    }
    if (race.error) return sendJson(res, 502, { error: race.error.message });
    result = race.value;
    Object.assign(proc, result.trace, { wrote: true });
  }
  const reply = result.reply;

  // Deadline guardian: one gentle line before the answer, at most once per day per loop (stamped in the notebook).
  const fresh = readNotebooks(), freshBook = bookFor(fresh, s.uid);
  const guardian = settings.settingsOf(freshBook).loopRemindersOn ? loops.guardianLine(freshBook) : null; // Settings > open-loop reminders
  if (guardian) writeNotebooks(fresh);
  console.log('[answer] ' + result.lane + (result.from ? ' (' + result.from + ')' : '') + (result.sources ? ', sources: ' + result.sources.length : ''));
  // the short conversation context keeps words only — the picture itself is not kept
  const shared = picture ? (data.screen === true ? '[shared a screen snapshot] ' : '[shared a picture] ') : data[VOICE] ? '[voice note] ' : '';
  s.history.push({ role: 'user', content: shared + message }, { role: 'assistant', content: reply });
  if (s.history.length > 12) s.history.splice(0, s.history.length - 12); // a short memory of this conversation only

  // Worth learning from? Then the page asks for the (separate) extraction step with this turn id.
  // A picture turn learns from the user's WORDS only: the extractors never see the picture or the answer about it.
  let turnId;
  if (memory.wordCount(message) >= 4 && !memory.looksSecret(message)) {
    turnId = crypto.randomBytes(9).toString('base64url');
    s.turns = s.turns || new Map();
    s.turns.set(turnId, { message, reply: picture && result.lane === 'picture' ? PICTURE_SEEN : reply, at: Date.now() });
    for (const [id, t] of s.turns) if (s.turns.size > 20 || Date.now() - t.at > 10 * 60 * 1000) s.turns.delete(id);
  }
  const out = { reply };
  if (pictureNote) out.pictureNote = pictureNote;
  if (guardian) out.guardian = guardian;
  if (turnId) out.turnId = turnId;
  if (result.sources && result.sources.length) out.sources = result.sources; // the citation card (Book answers only)
  if (guardian) proc.guardian = true;
  out.process = proc;
  sendReply(res, s, data, message, picture, out);
}

// ---- The Document Lane (documents.js): the brain writes the document as structure, our code prints it to a real PDF ----
// Honesty: the card is sent ONLY after the file exists on disk with non-zero size; otherwise one plain line, nothing claimed.
const DOC_FAIL = "I couldn't make that file right now.";
async function documentReply(req, res, s, data, message) {
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return sendReply(res, s, data, message, null, { reply: STUB_REPLY, stub: true, process: { stub: true } }); // STUB RULE
  const book = bookFor(readNotebooks(), s.uid);
  s.history = s.history || [];
  let doc = null, file = null;
  try {
    const raw = await askMeta([
      { role: 'system', content: memory.buildChatSystem(book.profile, book.facts, loops.openSorted(book.loops).slice(0, 20), null, settings.settingsOf(book), data.tz) + documents.WRITE_RULES },
      ...s.history.slice(-6),
      { role: 'user', content: message }
    ], key, { maxTokens: 12000 });
    doc = documents.parseDoc(raw);
    if (!doc) throw new Error('the document came back in a shape I could not read');
    file = await documents.makePdf(s.uid, doc);
  } catch (e) {
    console.error('[document] failed: ' + e.message);
    return sendReply(res, s, data, message, null, { reply: DOC_FAIL, process: { usedDocument: 'failed' } });
  }
  console.log('[document] made a PDF (' + file.bytes + ' bytes, ' + doc.sections.length + ' sections)');   // never the words
  const reply = doc.summary || 'Here is your document.';
  s.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply + ' [Sim Sim made a PDF document: "' + doc.title + '".]' });
  if (s.history.length > 12) s.history.splice(0, s.history.length - 12);
  sendReply(res, s, data, message, null, { reply,
    document: { title: doc.title, name: file.name, bytes: file.bytes, url: '/api/documents/' + file.name },
    process: { usedNotebook: Math.min(book.facts.length, memory.MAX_FACTS_IN_CONTEXT), usedDocument: { title: doc.title }, wrote: true } });
}

// ---- The Website Lane (websites.js): the brain writes ONE complete, self-contained HTML page; our code saves it as
// the file itself (no printing step) and serves it only to its owner. Honesty: the card is sent ONLY after the file
// exists on disk with non-zero size; a failure never falls back to a picture, a PDF, or a code dump pretending to be one.
const SITE_FAIL = "I couldn't make that website right now.";
async function websiteReply(req, res, s, data, message) {
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return sendReply(res, s, data, message, null, { reply: STUB_REPLY, stub: true, process: { stub: true } }); // STUB RULE
  const book = bookFor(readNotebooks(), s.uid);
  s.history = s.history || [];
  let site = null, file = null;
  try {
    const raw = await askMeta([
      { role: 'system', content: memory.buildChatSystem(book.profile, book.facts, loops.openSorted(book.loops).slice(0, 20), null, settings.settingsOf(book), data.tz) + websites.WRITE_RULES },
      ...s.history.slice(-6),
      { role: 'user', content: message }
    ], key, { maxTokens: 16000 });
    site = websites.parsePage(raw);
    if (!site) throw new Error('the page came back in a shape I could not read');
    file = websites.savePage(s.uid, site.title, site.html);
  } catch (e) {
    console.error('[website] failed: ' + e.message);
    return sendReply(res, s, data, message, null, { reply: SITE_FAIL, process: { usedWebsite: 'failed' } });
  }
  console.log('[website] made a page (' + file.bytes + ' bytes)');   // never the words, never the page
  const reply = site.description || 'Here is your website — open it to see it live.';
  s.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply + ' [Sim Sim made a website: "' + site.title + '" and it is showing in this chat.]' });
  if (s.history.length > 12) s.history.splice(0, s.history.length - 12);
  sendReply(res, s, data, message, null, { reply,
    website: { title: site.title, name: file.name, bytes: file.bytes, url: '/api/websites/' + file.name },
    process: { usedNotebook: Math.min(book.facts.length, memory.MAX_FACTS_IN_CONTEXT), usedWebsite: { title: site.title }, wrote: true } });
}
// ---- Voice notes: saved per user in data/voicenotes/<user>/, served ONLY to their owner ----
const VOICE_TYPES = { webm: 'audio/webm', ogg: 'audio/ogg', mp4: 'audio/mp4' };
function voiceDir(uid) { return path.join(VOICENOTES_DIR, String(uid).replace(/[^\w.@-]/g, '_')); }
function saveVoiceNote(uid, v) {
  const m = v && typeof v.audio === 'string' && v.audio.match(/^data:audio\/(webm|ogg|mp4)(?:;codecs=[\w.,]+)?;base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) return { error: "That voice note couldn't be read." };
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) return { error: 'That voice note was empty.' };
  if (bytes.length > VOICE_MAX) return { error: 'That voice note is too long — keep it under about three minutes.', status: 413 };
  const name = crypto.randomBytes(10).toString('hex') + '.' + m[1];
  fs.mkdirSync(voiceDir(uid), { recursive: true });
  fs.writeFileSync(path.join(voiceDir(uid), name), bytes);
  const transcript = typeof v.transcript === 'string' ? v.transcript.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX) : '';
  console.log('[voice note] saved (' + Math.round(bytes.length / 1024) + ' KB, ' + (transcript ? 'with' : 'no') + ' transcript)');   // never the words
  return { name, transcript };
}
function handleVoiceNoteFile(req, res, name) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const m = String(name).match(/^[a-f0-9]{20}\.(webm|ogg|mp4)$/);
  const file = m && path.join(voiceDir(s.uid), name);
  if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: "I couldn't find that voice note." });
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': VOICE_TYPES[m[1]], 'Content-Length': buf.length, 'Cache-Control': 'private, no-store' });
  res.end(buf);
}

// ---- Timed reminders (reminders.js): the page asks for them, shows due ones, and only then marks them shown ----
async function handleReminders(req, res, what) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  if (what === 'list') return sendJson(res, 200, { now: Date.now(), reminders: reminders.open(s.uid).map(r => ({ id: r.id, text: r.text, dueAt: r.dueAt, shown: !!r.shownAt, when: reminders.whenWords(r.dueAt) })) });
  const data = await readJson(req, res);
  if (!data) return;
  const ids = (Array.isArray(data.ids) ? data.ids : [data.id]).filter(x => typeof x === 'string').slice(0, 50);
  const n = what === 'shown' ? reminders.markShown(s.uid, ids) : reminders.markDone(s.uid, ids);
  sendJson(res, n ? 200 : 404, { ok: !!n });
}
// A document file: ONLY its owner (by the signed-in uid) can get it; anyone else gets "not found".
// ?view=1: shown INSIDE Sim Sim's full view (inline); otherwise a download. Same owner-only check either way.
function handleDocumentFile(req, res, name, view) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const file = documents.fileFor(s.uid, decodeURIComponent(name));
  if (!file) return sendJson(res, 404, { error: "I couldn't find that document." });
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Cache-Control': 'private, no-store',
    'Content-Disposition': (view ? 'inline' : 'attachment') + '; filename="' + path.basename(file).replace(/-[a-f0-9]{8}\.pdf$/, '.pdf') + '"' });
  res.end(buf);
}
// A website page: ONLY its owner can get it; anyone else gets "not found" (the same locked response as the document route).
// Default: inline, so the Open card's iframe can render it. ?dl=1: a download, saving the .html file (the Download button).
// Content-Security-Policy: sandbox allow-scripts on EVERY response here — the page may run its own scripts, but even opened
// directly (not just in the app's iframe) it is cut off from this origin, its cookies, and its storage.
function handleWebsiteFile(req, res, name, download) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const file = websites.fileFor(s.uid, decodeURIComponent(name));
  if (!file) return sendJson(res, 404, { error: "I couldn't find that website." });
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'private, no-store',
    'Content-Security-Policy': 'sandbox allow-scripts',
    'Content-Disposition': (download ? 'attachment' : 'inline') + '; filename="' + path.basename(file).replace(/-[a-f0-9]{8}\.html$/, '.html') + '"' });
  res.end(buf);
}

// ---- Sim Sim's browser (Part 1: EYES) ----
// The Meta brain drives a visible Chromium with read-only tools (browser.js), at most 25 steps. It answers ONLY from
// pages it opened in this task; their links come back as the citation card and in the receipt. Stop halts it.
const BROWSER_BUSY = "I'm still working on the last browser task — press Stop if you want me to drop it.";
const BROWSER_STOPPED = 'Okay — I stopped. The browser is paused right where it was.';
async function browserReply(req, res, s, data, message) {
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return sendReply(res, s, data, message, null, { reply: STUB_REPLY, stub: true, process: { stub: true } }); // STUB RULE
  const book = bookFor(readNotebooks(), s.uid);
  s.history = s.history || [];
  let out;
  try {
    out = await browser.runTask(s.uid, {
      system: memory.buildChatSystem(book.profile, book.facts, loops.openSorted(book.loops).slice(0, 20)),
      history: s.history.slice(-6), message,
      ask: (messages, tools) => askMeta(messages, key, tools ? { tools, raw: true } : { raw: true })
    });
  } catch (e) {
    console.error('[browser] task failed: ' + e.message);
    // say which part failed: the Meta brain (its own plain message), or the browser engine — never blame the wrong one
    if (/Meta brain/.test(e.message)) return sendReply(res, s, data, message, null, { reply: e.message + ' I stopped the browser task.', process: { browser: { failed: 'brain' } } });
    const why = /Executable doesn't exist|Cannot find module 'playwright'/.test(e.message) ? " — the browser engine isn't installed on this computer"
      : e.message === 'PROFILE_IN_USE' ? " — Sim Sim's browser from an earlier run is still running. Restart Sim Sim, then ask again" : '';
    return sendReply(res, s, data, message, null, { reply: "I couldn't use the browser just now" + why + '.', process: { browser: { failed: true } } });
  }
  if (out.busy) return sendReply(res, s, data, message, null, { reply: BROWSER_BUSY, process: { command: 'A browser task was already running — nothing new was started' } });
  const reply = out.stopped ? BROWSER_STOPPED : out.reply || "I opened the pages but couldn't put an answer together — have a look in the Browser panel.";
  console.log('[browser] task ' + (out.stopped ? 'stopped' : 'done') + ': ' + out.steps + ' steps, ' + out.pages.length + ' pages');
  s.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
  if (s.history.length > 12) s.history.splice(0, s.history.length - 12);
  const today = new Date().toISOString().slice(0, 10);
  const result = { reply, browser: true, process: { browser: { pages: out.pages, shots: out.shots, steps: out.steps, stopped: out.stopped }, wrote: !out.stopped } };
  if (!out.stopped && out.pages.length) result.sources = out.pages.map(p => ({ name: p.name, url: p.url, fetched: today }));   // the links it read
  sendReply(res, s, data, message, null, result);
}
async function handleBrowserApi(req, res, what) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  if (what === 'state') return sendJson(res, 200, await browser.state(s.uid));
  if (what === 'shot') {
    const buf = await browser.shot(s.uid);
    if (!buf) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    return res.end(buf);
  }
  const data = await readJson(req, res);
  if (!data) return;
  if (what === 'stop') return sendJson(res, 200, { ok: true, stopped: browser.stop(s.uid) });
  if (what === 'close') { await browser.close(s.uid); return sendJson(res, 200, { ok: true }); }
  if (what === 'open') {
    if (!browser.safeUrl(data.url)) return sendJson(res, 400, { error: 'Only http and https web addresses can be opened.' });
    try { return sendJson(res, 200, { ok: true, result: await browser.userOpen(s.uid, data.url) }); }
    catch (e) { console.error('[browser] open failed: ' + e.message); return sendJson(res, 502, { error: "The browser couldn't open that." }); }
  }
  if (what === 'tab') return sendJson(res, (await browser.userTab(s.uid, Number(data.index))) ? 200 : 404, { ok: true });
  sendJson(res, 404, { error: 'Not found.' });
}

// "New chat": forget the short conversation context (not the notebook).
function handleChatReset(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  resetConversation(s);
  sendJson(res, 200, { ok: true });
}
function resetConversation(s) {
  s.history = [];
  s.pending = null;
  s.currentImage = null;   // a new chat has no picture to edit yet
  s.lastAnswer = null;     // …and no answer to time yet
  s.openThread = null;
  s.pendingAction = null;  // an allowance card never outlives its chat
}

// ---- Chat furniture (founder, 2026-10-29): reactions, delete your own message, rename/delete a thread ----
// All of it only ever touches the signed-in user's OWN threads (chats.js looks them up by uid).
const REACTION = e => e === null || e === '' || chats.REACTIONS.includes(e);

async function handleChatReact(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  if (!REACTION(data.emoji)) return sendJson(res, 400, { error: 'Pick one of the reactions shown.' });
  const t = typeof data.threadId === 'string' && typeof data.messageId === 'string' ? chats.react(s.uid, data.threadId, data.messageId, data.emoji || null) : null;
  if (!t) return sendJson(res, 404, { error: "I couldn't find that message." });
  sendJson(res, 200, { ok: true, emoji: data.emoji || null });   // a reaction is display only: never context, notebook or learning
}

async function handleChatDeleteMessage(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const done = typeof data.threadId === 'string' && typeof data.messageId === 'string' ? chats.deleteMessage(s.uid, data.threadId, data.messageId) : null;
  if (!done) return sendJson(res, 404, { error: "I couldn't find that message." });
  // Sim Sim forgets it now too: the live context is rebuilt from the thread without it (and without the answer to it),
  // and a not-yet-learned turn with those words is dropped, so it is never learned from.
  if (s.openThread === data.threadId) s.history = chats.contextOf(done.thread);
  else if (Array.isArray(s.history)) s.history = s.history.filter(h => !(h.role === 'user' && h.content.endsWith(done.deleted.text)));
  if (s.turns) for (const [id, t] of s.turns) if (t.message === done.deleted.text) s.turns.delete(id);
  console.log('[chats] a message was deleted');
  sendJson(res, 200, { ok: true });
}

async function handleChatRename(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const title = typeof data.title === 'string' ? data.title.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (title.length < 1 || title.length > 60) return sendJson(res, 400, { error: 'A chat name is 1 to 60 characters.' });
  const t = typeof data.id === 'string' ? chats.rename(s.uid, data.id, title) : null;
  if (!t) return sendJson(res, 404, { error: "I couldn't find that chat." });
  sendJson(res, 200, { ok: true, title: t.title });
}

async function handleChatDelete(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  if (typeof data.id !== 'string' || !chats.remove(s.uid, data.id)) return sendJson(res, 404, { error: "I couldn't find that chat." });
  const wasOpen = s.openThread === data.id;
  if (wasOpen) resetConversation(s);   // the open chat is gone: start clean
  sendJson(res, 200, { ok: true, wasOpen });
}

// A plain-text download of one chat (sidebar ⋯ menu "Export chat"; founder, 2026-11-01 — "Journeys pack"). Read-only —
// unlike /api/chats/open, it never makes the chat this session's open conversation, so exporting one chat never
// disturbs whichever chat is actually on screen.
function handleChatExport(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  const ex = typeof id === 'string' ? chats.exportText(s.uid, id) : null;
  if (!ex) return sendJson(res, 404, { error: "I couldn't find that chat." });
  const slug = ex.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chat';
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="' + slug + '.txt"' });
  res.end(ex.text);
}

// Settings → Data controls → "Delete all chats" (founder, 2026-11-01): the middle option between deleting one chat and
// "Forget everything" — chats only, nothing else erased. Direct, like the single-chat delete above (the confirm sheet is
// the UI's own step, not an allowance card); the in-chat ask ("delete all my chats") goes through the Action Layer's
// always-asks floor instead (planAction's 'delete_all_chats' case), so it is never this route.
function handleChatsDeleteAll(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const n = chats.list(s.uid).length;
  chats.removeAll(s.uid);
  resetConversation(s);
  console.log('[chats] a user deleted all their chats (' + n + ')');
  sendJson(res, 200, { ok: true, count: n });
}

// Discussion: one reaction per answer, kept with the round. NOT a pick: no preference log, no taste count, no context.
async function handleGroupReact(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  if (!REACTION(data.emoji)) return sendJson(res, 400, { error: 'Pick one of the reactions shown.' });
  const turn = groupState(s).turns.get(data.qid);
  if (!turn || !group.MEMBERS.includes(data.member) || !turn.answers[data.member]) return sendJson(res, 404, { error: 'That answer is not here.' });
  turn.reactions = turn.reactions || {};
  if (data.emoji) turn.reactions[data.member] = data.emoji; else delete turn.reactions[data.member];
  sendJson(res, 200, { ok: true, emoji: data.emoji || null });
}

// ---- "Your pictures": what Sim Sim made or edited for this user, newest first ----
function handlePictures(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const book = bookFor(readNotebooks(), s.uid);
  const face = book.profile && book.profile.face && typeof book.profile.face.ref === 'string' ? book.profile.face.ref.split('/').pop() : null;
  const threads = chats.list(s.uid).map(c => chats.get(s.uid, c.id)).filter(Boolean);
  const items = pictures.list(s.uid, IMAGES_DIR, threads, name => name === face);
  sendJson(res, 200, { pictures: items.map(p => ({ url: '/api/images/' + p.name, name: p.name, createdAt: p.createdAt, kind: p.kind, threadId: p.threadId })) });
}
async function handlePictureDelete(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const book = bookFor(readNotebooks(), s.uid);
  if (book.profile && book.profile.face && book.profile.face.ref === '/api/images/' + data.name)
    return sendJson(res, 409, { error: "That picture is Sim Sim's face — change the face in Settings first." });
  if (typeof data.name !== 'string' || !pictures.remove(s.uid, IMAGES_DIR, data.name)) return sendJson(res, 404, { error: "I couldn't find that picture." });
  if (s.currentImage && s.currentImage.file === data.name) s.currentImage = null;   // nothing left to edit
  console.log('[pictures] a picture was deleted');
  sendJson(res, 200, { ok: true });
}

// ---- Saved 1-on-1 threads (the main Chat and the side chats): only ever the signed-in user's own ----
function handleChatsList(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  sendJson(res, 200, { chats: chats.list(s.uid) });
}
// Opening a thread: send it back in full, and make its last messages the conversation context, so it can be continued.
async function handleChatOpen(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const t = typeof data.id === 'string' ? chats.get(s.uid, data.id) : null;
  if (!t) return sendJson(res, 404, { error: "I couldn't find that chat." });
  enterThread(s, t);
  sendJson(res, 200, { chat: chats.withNamed(t) });
}
// A read-only look at a thread's own saved messages, with none of handleChatOpen's side effects (it never changes
// which thread this session is "in"). Used only to reconcile a live view that may have dropped a completed answer
// (founder's end-check, round 6, 2026-11-02): the live channel showed nothing, or a false failure, while the
// server had already finished and saved the real turn — this is how the page catches up without a full reload.
function handleChatTail(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  const t = typeof id === 'string' ? chats.get(s.uid, id) : null;
  if (!t) return sendJson(res, 404, { error: "I couldn't find that chat." });
  sendJson(res, 200, { id: t.id, messages: t.messages });
}
// This session is now in thread t (the main Chat or a side chat): its OWN context, current picture and last receipt.
// Nothing from another thread's conversation comes along. (The notebook is per user and shared by all of them.)
function enterThread(s, t) {
  s.history = chats.contextOf(t);
  s.pending = null;
  s.openThread = t.id;
  // its newest picture becomes the current image — if Sim Sim made or edited it (uploads are never kept, so those can't be edited later)
  s.currentImage = latestImageIn(t);
  // its last answer's saved receipt (display data) answers "how long did that take?"
  const lastReply = t.messages.slice().reverse().find(m => m.role === 'assistant' && !m.guardian && !m.aboutReceipt);
  s.lastAnswer = lastReply && lastReply.receipt ? { ms: lastReply.receipt.ms, steps: lastReply.receipt.steps, turnId: null } : null;
}
// "Make a side chat" asked in the chat (founder, 2026-10-31): read by code (never the brain), then done as an ACTION of the
// Action Layer — so the user's Chats permission governs it (allow: done at once · ask: the allowance card · never: refused).
// - "for this", no topic mid-conversation, or a topic this conversation is already about: convert_this_chat_to_side.
// - A new topic, or nothing to convert yet: create_side_chat (the page moves into the new, empty chat).
function sideChatReply(res, s, data, message, side) {
  s.pending = null;
  const line = reply => { rememberTurn(s, message, reply);
    return sendReply(res, s, data, message, null, { reply, process: { command: "Read your message as a side chat request with Sim Sim's own code (no brain call)" } }); };
  if (side.tooLong) return line(RENAME_TOO_LONG);
  const here = data.thread !== 'new' ? chats.get(s.uid, data.thread) : null;
  if (here && here.messages.length && (!side.topic || chats.topicInThread(here, side.topic))) {
    if (here.kind === 'side') return line("This already is a side chat — '" + here.title + "'.");
    return codeAct(res, s, data, message, 'convert_this_chat_to_side', { name: side.topic });
  }
  return codeAct(res, s, data, message, 'create_side_chat', { name: side.topic });
}

// ======== THE ACTION LAYER (founder, 2026-10-31): Sim Sim's hands in its own app, under the user's Permissions ========
// actions.js holds the registry, groups, floor and the brain's rules; the executors are here (they use the server's stores).
const permissionsOf = uid => settings.settingsOf(bookFor(readNotebooks(), uid)).permissions;
const actionCtx = data => ({ threadId: typeof data.thread === 'string' && data.thread !== 'new' ? data.thread : null });
const cleanName = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^["'“‘](.*)["'”’]$/, '$1') : '';
const NAME_TOO_LONG = 'A chat name can be up to 60 characters.';

// Checks one action and resolves what it means RIGHT NOW (no side effects). Returns { error } (plain words; nothing runs) or
// { text: the plain-words line for the allowance card, run: async () => { ok, detail (receipt/brain), say (user line), effects } }.
function planAction(s, name, args, ctx) {
  args = args || {};
  const uid = s.uid;
  const here = () => ctx.threadId ? chats.get(uid, ctx.threadId) : null;
  const book = () => bookFor(readNotebooks(), uid);
  const saveSettings = change => { const all = readNotebooks(), b = bookFor(all, uid); b.settings = Object.assign(settings.settingsOf(b), change); writeNotebooks(all); return settings.settingsOf(b); };
  const saveProfile = edit => { const all = readNotebooks(), b = bookFor(all, uid); if (!b.profile) throw new Error('there is no profile yet'); edit(b.profile); writeNotebooks(all); return b.profile; };
  switch (name) {
    case 'create_side_chat': {
      const n = cleanName(args.name);
      if (n.length > chats.TITLE_MAX) return { error: NAME_TOO_LONG };
      return { text: 'Make a new side chat' + (n ? " called '" + n + "'" : ''), run: async () => {
        const t = chats.createSide(uid, n);
        enterThread(s, t);
        return { ok: true, detail: "Created side chat '" + t.title + "'", say: "Done — you're in your new side chat" + (n ? " '" + t.title + "'." : '.'), effects: [{ type: 'openThread', chat: chats.withNamed(t) }] };
      } };
    }
    case 'convert_this_chat_to_side': {
      const t = here(), n = cleanName(args.name);
      if (!t || !t.messages.length) return { error: "This chat has no messages yet, so there's nothing to turn into a side chat (a new side chat can be made instead)." };
      if (t.kind === 'side') return { error: "This already is a side chat — '" + t.title + "'." };
      if (n.length > chats.TITLE_MAX) return { error: NAME_TOO_LONG };
      return { text: "Turn this conversation into the side chat '" + (n || t.title) + "'", run: async () => {
        const t2 = chats.toSide(uid, t.id, n);
        if (!t2) throw new Error('that chat is gone');
        return { ok: true, detail: "Made this conversation the side chat '" + t2.title + "'", say: "Done — this conversation is now the side chat '" + t2.title + "'.",
          effects: [{ type: 'converted', id: t2.id, title: t2.title }] };
      } };
    }
    case 'rename_current_chat': {
      const t = here(), n = cleanName(args.name);
      if (!n) return { error: 'No name was given.' };
      if (n.length > chats.TITLE_MAX) return { error: NAME_TOO_LONG };
      if (!t) return { error: "This chat isn't saved yet — after its first message it can be named." };
      return { text: "Rename this chat to '" + n + "'", run: async () => {
        const t2 = chats.rename(uid, t.id, n);
        if (!t2) throw new Error('that chat is gone');
        return { ok: true, detail: "Renamed this chat '" + t2.title + "'", say: "Done — this chat is now '" + t2.title + "'.", effects: [{ type: 'retitle', id: t2.id, title: t2.title }] };
      } };
    }
    case 'open_chat': {
      const q = cleanName(args.threadTitle).toLowerCase(), list = chats.list(uid);
      let hits = /^(?:the )?(?:main )?chat$|^main$/.test(q) ? list.filter(c => c.kind === 'main') : list.filter(c => c.title.toLowerCase() === q);
      if (!hits.length && q) hits = list.filter(c => c.title.toLowerCase().includes(q));
      if (!hits.length) return { error: "There's no chat called '" + cleanName(args.threadTitle) + "'." };
      if (hits.length > 1) return { error: 'Several chats match: ' + hits.slice(0, 5).map(c => "'" + c.title + "'").join(', ') + ' — ask which one.' };
      const title = hits[0].kind === 'main' ? 'Chat' : hits[0].title;
      return { text: "Open the chat '" + title + "'", run: async () => {
        const t = chats.get(uid, hits[0].id);
        if (!t) throw new Error('that chat is gone');
        enterThread(s, t);
        return { ok: true, detail: "Opened the chat '" + title + "'", say: "Here's '" + title + "'.", effects: [{ type: 'openThread', chat: chats.withNamed(t) }] };
      } };
    }
    case 'delete_current_chat': {
      const t = here();
      if (!t) return { error: "This chat isn't saved yet, so there's nothing to delete." };
      const title = t.kind === 'main' ? 'this chat' : "'" + t.title + "'";
      return { text: 'Delete ' + title + " — it can't be undone", run: async () => {
        if (!chats.remove(uid, t.id)) throw new Error('that chat is gone');
        if (s.openThread === t.id || ctx.threadId === t.id) resetConversation(s);
        return { ok: true, detail: 'Deleted ' + title, say: 'Done — I deleted ' + title + '.', effects: [{ type: 'threadDeleted', id: t.id }] };
      } };
    }
    case 'delete_all_chats': {
      const n = chats.list(uid).length;
      if (!n) return { error: "There are no chats to delete yet." };
      // Same true scope as the Data Controls confirm sheet (public/settings.js confirmDeleteAllChats), worded
      // exactly the same way here (founder's end-check, 2026-11-01: this card wrongly said "Delete this chat").
      return { text: 'Delete all chats? This removes every chat, including the Main chat history. Your memories, open loops, reminders and settings stay.', run: async () => {
        chats.removeAll(uid);
        resetConversation(s);
        return { ok: true, detail: 'Deleted all ' + n + ' chat' + (n === 1 ? '' : 's'),
          say: 'Done — I deleted all ' + n + ' chat' + (n === 1 ? '' : 's') + '.', effects: [{ type: 'threadDeleted', all: true }] };
      } };
    }
    case 'open_view': {
      // Generous matching (round 3 end-check, 2026-11-02): "open the browser view" let the brain pass "browser
      // view" instead of the bare enum value. A strict exact-match silently failed the tool (no effect, no view
      // opened) while the brain's own wrap-up reply still said "Opened the Browser," since nothing told it otherwise
      // — the brain can only claim what a result confirms, and an error result says the opposite, but it composed
      // the final line itself and got it wrong. Stripping filler words first, then falling back to a match against
      // the view's own display name, means the tool actually succeeds for the phrasing a user would really say.
      const raw = String(args.view || '').toLowerCase().trim();
      const q = raw.replace(/\b(?:the|my|your|our|a|an)\b/g, ' ').replace(/\b(?:view|screen|panel|page|tab)\b/g, ' ').replace(/\s+/g, ' ').trim();
      const v = actions.VIEWS.find(x => x === raw || x === q) ||
        actions.VIEWS.find(x => q && actions.VIEW_NAMES[x].toLowerCase().replace(/^the\s+/, '').includes(q));
      if (!v) return { error: 'There is no screen called ' + (args.view || 'that') + '.' };
      return { text: 'Open ' + actions.VIEW_NAMES[v], run: async () =>
        ({ ok: true, detail: 'Opened ' + actions.VIEW_NAMES[v], say: 'Opening ' + actions.VIEW_NAMES[v] + '.', effects: [{ type: 'view', view: v }] }) };
    }
    case 'set_theme': {
      const q = String(args.theme || '').toLowerCase().replace(/\b(?:theme|mode)\b/g, '').trim();
      const t = THEMES.find(x => x.id === q || x.name.toLowerCase() === q) || THEMES.find(x => q && x.name.toLowerCase().includes(q))
        || (/^dark$/.test(q) ? THEMES.find(x => x.dark) : /^(?:light|default)$/.test(q) ? THEMES[0] : null);
      if (!t) return { error: "There's no theme called '" + (args.theme || '') + "'. The themes are: " + THEMES.map(x => x.name).join(', ') + '.' };
      return { text: 'Change the theme to ' + t.name, run: async () => {
        const p = saveProfile(pr => { pr.themeId = t.id; });
        return { ok: true, detail: 'Changed the theme to ' + t.name, say: 'Done — the theme is ' + t.name + ' now.', effects: [{ type: 'profile', profile: p }] };
      } };
    }
    case 'set_text_size': {
      const q = String(args.size || '').toLowerCase();
      const size = /^(?:large|larger|big|bigger)$/.test(q) ? 'large' : /^(?:comfortable|normal|regular|smaller|small|default)$/.test(q) ? 'comfortable' : null;
      if (!size) return { error: 'The text size can be Comfortable or Large.' };
      return { text: 'Change the text size to ' + (size === 'large' ? 'Large' : 'Comfortable'), run: async () => {
        const st = saveSettings({ textSize: size });
        return { ok: true, detail: 'Changed the text size to ' + (size === 'large' ? 'Large' : 'Comfortable'), say: 'Done — the text size is ' + (size === 'large' ? 'Large' : 'Comfortable') + ' now.', effects: [{ type: 'settings', settings: st }] };
      } };
    }
    case 'set_face': {
      const seat = { sim: null, bot1: 0, bot2: 1 }[args.seat];
      if (seat === undefined) return { error: 'The faces are Sim Sim\'s, and the two Discussion bots\' (bot1, bot2).' };
      const g = String(args.gallery || '').toLowerCase();
      const f = FACES.find(x => x.id === g || x.name.toLowerCase() === g);
      if (g !== 'default' && !f) return { error: "There's no starter face called '" + (args.gallery || '') + "'. The starter faces are: " + FACES.map(x => x.name).join(', ') + '. Uploading or making a new face is done in Settings.' };
      const p0 = book().profile || {};
      const whose = seat === null ? 'Sim Sim' : ((p0.botNames || [])[seat] || ['Researcher', 'Challenger'][seat]);
      const label = f ? f.name : 'the default face';
      return { text: "Set " + whose + "'s face to " + label, run: async () => {
        const p = saveProfile(pr => putFace(pr, seat, f ? { kind: 'gallery', ref: f.id } : null));
        return { ok: true, detail: "Set " + whose + "'s face to " + label, say: 'Done — ' + whose + ' has ' + label + ' now.', effects: [{ type: 'profile', profile: p }] };
      } };
    }
    case 'set_speak_answers': {
      if (typeof args.on !== 'boolean') return { error: 'Say on or off.' };
      return { text: 'Turn Speak answers ' + (args.on ? 'on' : 'off'), run: async () => {
        const st = saveSettings({ speakAnswers: args.on });
        return { ok: true, detail: 'Turned Speak answers ' + (args.on ? 'on' : 'off'), say: 'Done — Speak answers is ' + (args.on ? 'on' : 'off') + '.', effects: [{ type: 'settings', settings: st }] };
      } };
    }
    case 'set_voice': {
      // `n` is the internal key (stored in settings.voice); every string the user sees or hears uses its `label`
      // instead (founder, 2026-10-31 — voices are labeled by description, never by a person's name).
      const n = voice.NAMES.find(x => x.toLowerCase() === String(args.name || '').toLowerCase().trim());
      const labelOf = key => (voice.ROSTER.find(v => v.name === key) || {}).label || key;
      if (!n) return { error: "There's no voice called '" + (args.name || '') + "'. The voices are: " + voice.ROSTER.map(v => v.label).join(', ') + '.' };
      const st0 = voice.status(n);
      if (!st0.connected) return { error: "The voice service isn't connected yet, so the voice can't be switched — Sim Sim speaks with the device's voice for now." };
      if (!st0.voices.find(v => v.name === n).ready) return { error: labelOf(n) + " isn't set up yet, so Sim Sim can't speak as " + labelOf(n) + '.' };
      return { text: "Change Sim Sim's voice to " + labelOf(n), run: async () => {
        const st = saveSettings({ voice: n });
        return { ok: true, detail: 'Changed the voice to ' + labelOf(n), say: 'Done — I speak as ' + labelOf(n) + ' now.', effects: [{ type: 'settings', settings: st }, { type: 'voices' }] };
      } };
    }
    case 'set_briefing_enabled': {
      if (typeof args.on !== 'boolean') return { error: 'Say on or off.' };
      return { text: 'Turn the morning briefing ' + (args.on ? 'on' : 'off'), run: async () => {
        saveSettings({ briefingOn: args.on });
        const confirmed = settings.settingsOf(bookFor(readNotebooks(), uid)).briefingOn;   // read the setting back from disk
        if (confirmed !== args.on) return { ok: false, detail: "The setting didn't save", say: "That didn't save — try again." };
        return { ok: true, detail: 'Turned the morning briefing ' + (args.on ? 'on' : 'off'),
          say: 'Done — the morning briefing is ' + (args.on ? 'on' : 'off') + ' now.',
          effects: [{ type: 'settings', settings: settings.settingsOf(bookFor(readNotebooks(), uid)) }] };
      } };
    }
    case 'set_briefing_time': {
      const time = settings.parseTimeOfDay(args.time);
      if (!time) return { error: "I couldn't read that as a time — try something like '7am' or '7:30 AM'." };
      const nice = settings.niceTime(time);
      return { text: 'Set the morning briefing time to ' + nice, run: async () => {
        saveSettings({ briefingTime: time });
        const confirmed = settings.settingsOf(bookFor(readNotebooks(), uid)).briefingTime;   // read the setting back from disk
        if (confirmed !== time) return { ok: false, detail: "The setting didn't save", say: "That didn't save — try again." };
        return { ok: true, detail: 'Set the morning briefing time to ' + nice, say: 'Done — your morning briefing is set for ' + nice + ' now.',
          effects: [{ type: 'settings', settings: settings.settingsOf(bookFor(readNotebooks(), uid)) }] };
      } };
    }
    case 'add_loop': {
      const text = loops.cleanText(args.text);
      if (text.length < 1 || text.length > 200) return { error: 'The task needs 1 to 200 characters.' };
      return { text: "Add '" + text + "' to your open loops", run: async () => {
        const all = readNotebooks(), b = bookFor(all, uid);
        b.loops.push(loops.newLoop(text, null));
        writeNotebooks(all);
        return { ok: true, detail: "Added '" + text + "' to your open loops", say: "Done — '" + text + "' is in your open loops.", effects: [{ type: 'loops' }] };
      } };
    }
    case 'complete_loop': {
      const open = loops.openSorted(book().loops);
      const hits = Array.isArray(args.ids) ? open.filter(l => args.ids.includes(l.id)) : loops.matchLoops(open, String(args.match || ''));
      if (!hits.length) return { error: open.length ? 'No open loop matches that. The open loops are: ' + open.slice(0, 8).map(l => "'" + l.text + "'").join(', ') + '.' : 'There are no open loops.' };
      if (hits.length > 1 && !Array.isArray(args.ids)) return { error: 'Several open loops match: ' + hits.slice(0, 6).map(l => "'" + l.text + "'").join(', ') + ' — ask which one.' };
      const names = hits.map(l => "'" + l.text + "'").join(' and ');
      return { text: 'Mark ' + names + ' done', run: async () => {
        const closed = closeIds(uid, hits.map(l => l.id));
        if (!closed.length) return { ok: false, detail: 'That one is already closed', say: 'That one is already closed.' };
        return { ok: true, detail: 'Closed ' + names, say: closedLine(closed), effects: [{ type: 'loops' }] };
      } };
    }
    case 'forget_fact': {
      const facts = book().facts;
      let hits;
      if (args.all) hits = facts;
      else if (Array.isArray(args.ids)) hits = facts.filter(f => args.ids.includes(f.id));
      else {
        hits = memory.matchFacts(facts, memory.parseForget('forget ' + String(args.match || '')).query || '');
        if (hits.length > 1) return { error: 'Several facts match: ' + hits.slice(0, 6).map(f => "'" + memory.plain(f.text) + "'").join(', ') + ' — ask which one.' };
      }
      if (!hits.length) return { error: args.all ? "There's nothing in the notebook to forget yet." : "There's nothing like that in the notebook." };
      const what = args.all ? 'all ' + hits.length + ' facts in your notebook' : hits.map(f => "'" + memory.plain(f.text) + "'").join(' and ');
      return { text: 'Forget ' + what, run: async () => {
        const gone = forgetIds(uid, hits.map(f => f.id));
        if (!gone.length) return { ok: false, detail: "That's already gone from the notebook", say: "That's already gone from my notebook." };
        return { ok: true, detail: 'Forgot ' + what, say: args.all ? 'Done — I forgot all ' + gone.length + ' things you told me. Your basics are still saved.' : forgotLine(gone), effects: [{ type: 'memory' }] };
      } };
    }
    default: return { error: 'There is no action called ' + name + '.' };
  }
}

// One action through the Permissions: never -> refused BEFORE it runs · ask (or a floor action) -> held as THE pending action
// and an allowance card is shown · allow -> runs now. state collects the receipt lines and the page effects.
async function tryAction(s, name, args, ctx, state, source) {
  const group = actions.groupOf(name);
  if (!group) return { ok: false, detail: 'There is no action called ' + name };
  const groupName = actions.GROUPS[group].name;
  const d = actions.decision(permissionsOf(s.uid), name);
  if (d === 'never') {
    state.actions.push('Did not run an action: ' + groupName + ' is set to "Never" in Settings → Permissions');
    return { ok: false, blocked: 'permission', detail: groupName + ' is set to "Never" in Settings → Permissions', group: groupName };
  }
  const plan = planAction(s, name, args, ctx);
  if (plan.error) { state.actions.push("Couldn't do it: " + plan.error.replace(/\.$/, '')); return { ok: false, detail: plan.error, say: plan.error }; }
  if (d === 'ask') {
    const floor = actions.FLOOR.has(name);
    s.pendingAction = { id: crypto.randomBytes(8).toString('hex'), name, group, groupName, floor, text: plan.text, run: plan.run, source, threadId: ctx.threadId, at: Date.now() };
    state.actions.push('Asked for your OK before: ' + plan.text);
    return { pending: true, card: { id: s.pendingAction.id, text: plan.text, group, groupName, floor } };
  }
  return runPlanned(plan, state);
}
async function runPlanned(plan, state) {
  let r;
  try { r = await plan.run(); }
  catch (e) { console.error('[actions] failed: ' + e.message); r = { ok: false, detail: "It didn't work (" + String(e.message).split('\n')[0].slice(0, 120) + ')', say: "That didn't work — " + String(e.message).split('\n')[0].slice(0, 120) + '.' }; }
  state.actions.push(r.ok ? r.detail : 'Tried: ' + plan.text + " — it didn't work");
  if (r.effects) state.effects.push(...r.effects);
  return r;
}
// What the brain is told about a result (never the page effects).
const forBrain = r => JSON.stringify(r.pending ? { pending: true, waiting_for: 'the user to tap Allow or Not now on the card' }
  : r.blocked ? { ok: false, blocked: 'permission', detail: r.detail } : r.denied ? { ok: false, denied: true } : { ok: !!r.ok, detail: r.detail });

// The brain's tool loop for the 1-on-1 chat — the browser's pattern (browser.js runTask), with these tools, at most 3 actions.
// first: the brain's first message (already asked). Returns { reply } or { pending: card } (the loop is held for the user).
async function actionLoop(s, key, messages, ctx, state, first) {
  let msg = first;
  for (let rounds = 0; rounds < 6; rounds++) {
    if (!msg) msg = await askMeta(messages, key, state.used < 3 ? { tools: actions.TOOLS, raw: true } : { raw: true });
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (!calls.length) return { reply: (msg.content || '').trim() };
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) {}
      let r;
      if (state.used >= 3) r = { ok: false, detail: 'Not done: at most 3 actions per message' };
      else { state.used++; r = await tryAction(s, c.function.name, args, ctx, state, 'brain'); }
      if (r.pending) {   // held for the user's choice: the rest of this batch does not run
        s.pendingAction.brain = { messages, callId: c.id, rest: calls.slice(i + 1).map(x => x.id), used: state.used };
        return { pending: r.card };
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: forBrain(r) });
    }
    msg = null;
  }
  return { reply: '' };
}
// The plain line shown with an allowance card.
// card.text already ends with its own punctuation for the delete-all card (two full sentences); never double it.
const askLine = card => 'Before I do this, I need your OK: ' + card.text + (/[.!?]$/.test(card.text) ? '' : '.');
const leavesThread = effects => effects.some(e => e.type === 'openThread' || e.type === 'threadDeleted');

// A code-read command (the side chat ask, forget, done) done as an action. The reply is written by code.
async function codeAct(res, s, data, message, name, args) {
  const state = { used: 1, actions: [], effects: [] };
  const r = await tryAction(s, name, args, actionCtx(data), state, 'code');
  const reply = r.pending ? askLine(r.card) : r.blocked ? "I can't do that — " + r.group + ' is set to "Never" in Settings → Permissions. You can change it there.' : (r.say || r.detail);
  return actionReply(res, s, data, message, reply, state, r.pending ? r.card : null);
}
// Sends the reply of an action turn: the effects ride it, the receipt lists what actually ran. A turn that moved the user to
// another chat (or deleted this one) is saved nowhere — the page shows the line inside where the user landed.
function actionReply(res, s, data, message, reply, state, card) {
  const away = leavesThread(state.effects);
  if (!away) rememberTurn(s, message, reply);
  const out = { reply, effects: state.effects, process: { actions: state.actions } };
  if (card) out.pendingAction = card;
  return sendReply(res, s, away ? Object.assign({}, data, { thread: undefined }) : data, message, null, out);
}

// The brain with hands: only for a message that names something in the app and has a doing-word (actions.mightAct).
// If the brain calls no tool, it was not an action ask: returns false and the message flows on to the usual lanes.
async function actionLane(req, res, s, data, message) {
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return false;
  const book = bookFor(readNotebooks(), s.uid);
  const ctx = actionCtx(data);
  const t = ctx.threadId ? chats.get(s.uid, ctx.threadId) : null;
  const sides = chats.list(s.uid).filter(c => c.kind === 'side').slice(0, 12).map(c => "'" + c.title + "'");
  const now = '\n\nTHE APP RIGHT NOW: the user is in ' + (t ? (t.kind === 'side' ? "the side chat '" + t.title + "'" : "the main Chat ('" + t.title + "')") + ', ' + t.messages.length + ' messages' : 'a new, empty main Chat') +
    '. Side chats: ' + (sides.join(', ') || 'none') + '. Starter faces: ' + FACES.map(f => f.id).join(', ') + '. Themes: ' + THEMES.map(x => x.name).join(', ') + '.';
  const messages = [{ role: 'system', content: memory.buildChatSystem(book.profile, book.facts, loops.openSorted(book.loops).slice(0, 20), null, undefined, data.tz) + actions.RULES + now },
    ...(s.history || []).slice(-6), { role: 'user', content: message }];
  let first;
  try { first = await askMeta(messages, key, { tools: actions.TOOLS, raw: true }); }
  catch (e) { console.error('[actions] the brain call failed: ' + e.message); return false; }   // the usual lanes answer instead
  if (!Array.isArray(first.tool_calls) || !first.tool_calls.length) return false;
  s.pending = null;
  const state = { used: 0, actions: [], effects: [] };
  let out;
  try { out = await actionLoop(s, key, messages, ctx, state, first); }
  catch (e) { console.error('[actions] the brain stopped mid-task: ' + e.message); out = { reply: '' }; }
  let reply;
  if (out.pending) reply = askLine(out.pending);
  else reply = out.reply || (state.actions.length ? 'Here is what happened: ' + state.actions.join('; ') + '.' : "I couldn't finish that — the Meta brain stopped answering.");
  console.log('[actions] ' + new Date().toLocaleTimeString() + ' ' + state.actions.length + ' action step(s)' + (out.pending ? ', waiting for the user' : ''));
  actionReply(res, s, data, message, reply, state, out.pending || null);
  return true;
}

// The user's choice on an allowance card: allow | always | deny. Only THE pending action of this session, by its id —
// a card whose action was cancelled (the user sent another message, or changed chats) answers 409 and nothing runs.
async function handleActionDecide(req, res) {
  const arrived = Date.now();
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const p = s.pendingAction;
  if (!p || p.id !== data.id) return sendJson(res, 409, { error: 'That request was cancelled — ask again if you still want it.' });
  if (!['allow', 'always', 'deny'].includes(data.choice)) return sendJson(res, 400, { error: 'Bad request.' });
  s.pendingAction = null;
  const state = { used: p.brain ? p.brain.used : 1, actions: [], effects: [] };
  if (data.choice === 'always' && !p.floor) {
    const all = readNotebooks(), b = bookFor(all, s.uid), st = settings.settingsOf(b);
    st.permissions[p.group] = 'allow';
    b.settings = st;
    writeNotebooks(all);
    state.actions.push('You chose "Always allow ' + p.groupName + '" — it is set to Allow now');
    state.effects.push({ type: 'permissions', permissions: st.permissions });
  }
  let r;
  if (data.choice === 'deny') { r = { ok: false, denied: true }; state.actions.push('You chose "Not now": ' + p.text + ' — not done'); }
  else r = await runPlanned({ text: p.text, run: p.run }, state);
  let reply, card = null;
  if (p.brain) {   // the brain hears the result and confirms from it (it may ask for one more action)
    const key = (process.env.META_API_KEY || '').trim();
    const messages = p.brain.messages;
    messages.push({ role: 'tool', tool_call_id: p.brain.callId, content: forBrain(r) });
    p.brain.rest.forEach(id => messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify({ ok: false, detail: 'Not run: one action at a time — the user can ask again' }) }));
    let out;
    try { out = await actionLoop(s, key, messages, { threadId: p.threadId }, state, null); } catch (e) { out = { reply: '' }; }
    if (out.pending) { card = out.pending; reply = askLine(card); }
    else reply = out.reply || (r.denied ? 'Okay — I left it as it is.' : r.say || r.detail);
  } else reply = r.denied ? 'Okay — I left it as it is.' : (r.say || r.detail);
  const ms = Date.now() - arrived;
  const out = { reply, effects: state.effects, answerTimeMs: ms, receipt: { ms, steps: receipt.steps({ actions: state.actions }) } };
  if (card) out.pendingAction = card;
  if (!leavesThread(state.effects)) {
    s.history = s.history || [];
    s.history.push({ role: 'assistant', content: reply });
    if (p.threadId) { const id = chats.addReply(s.uid, p.threadId, reply, out.receipt); if (id) { out.threadId = p.threadId; out.messageId = id; } }
  }
  console.log('[actions] ' + new Date().toLocaleTimeString() + ' card: ' + data.choice + (r.ok ? ' (done)' : ''));
  sendJson(res, 200, out);
}
// "+" under Side chats: a new empty side chat, opened at once. title: what the user typed, or none (Skip).
async function handleChatNew(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const title = typeof data.title === 'string' ? data.title.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (title.length > chats.TITLE_MAX) return sendJson(res, 400, { error: 'A chat name is 1 to 60 characters.' });
  const t = chats.createSide(s.uid, title);
  enterThread(s, t);
  sendJson(res, 200, { chat: chats.withNamed(t) });
}

// Meta's own web search (Responses API) — used ONLY to find candidate page addresses for the Book.
// Its written text is thrown away; our code checks each address is official and reads the page itself.
async function searchWebUrls(prompt, key) {
  const r = await fetch('https://api.meta.ai/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: META_MODEL, input: prompt, tools: [{ type: 'web_search' }], include: ['web_search_call.results'], reasoning: { effort: 'low' } }),
    signal: AbortSignal.timeout(60000)
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) { console.error('[search] failed: HTTP ' + r.status); return []; }
  const cited = [], found = [];
  for (const item of data.output || []) {
    if (item.type === 'message') for (const c of item.content || []) for (const a of c.annotations || []) if (a.url) cited.push(a.url);
    if (item.type === 'web_search_call') {
      if (item.action && item.action.url) cited.push(item.action.url);
      for (const x of item.results || []) if (x.url) found.push(x.url);
    }
  }
  return [...cited, ...found]; // pages it actually opened or cited first
}

// ---- Learning: per eligible message, ONE small memory extraction call + ONE small loop extraction call (same Meta brain) ----
async function handleLearn(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const turn = s.turns && s.turns.get(data.turnId);
  if (!turn) return sendJson(res, 200, { learned: [], loops: [] });
  s.turns.delete(data.turnId); // each turn is learned from once, at most
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return sendJson(res, 200, { learned: [], loops: [] });

  const before = bookFor(readNotebooks(), s.uid);
  const quiet = label => e => { console.error('[learn] ' + label + ' extraction skipped:', e.message); return null; };
  const [factsOut, loopsOut] = await Promise.all([
    askMeta(memory.buildExtractorMessages(before.profile, before.facts, turn.message, turn.reply), key, { effort: 'minimal', maxTokens: SMALL_STEP_TOKENS }).catch(quiet('memory')),
    askMeta(loops.buildExtractorMessages(loops.openSorted(before.loops), turn.message, turn.reply), key, { effort: 'minimal', maxTokens: SMALL_STEP_TOKENS }).catch(quiet('loop'))
  ]);
  const all = readNotebooks(), book = bookFor(all, s.uid); // fresh read: the user may have changed things meanwhile
  const learned = factsOut ? memory.applyOps(book, memory.parseOps(factsOut, book.facts)) : [];
  const loopChanges = loopsOut ? loops.applyExtraction(book, loopsOut) : [];
  if (learned.length || loopChanges.length) writeNotebooks(all);
  // the receipt's last steps: what was actually learned from this turn (counts only)
  const receiptSteps = receipt.steps({ savedMemory: learned.length, savedLoops: loopChanges.length });
  if (receiptSteps.length && s.lastAnswer && s.lastAnswer.turnId === data.turnId) s.lastAnswer.steps = s.lastAnswer.steps.concat(receiptSteps);
  sendJson(res, 200, { learned, loops: loopChanges, receiptSteps });
}

// ---- Group Chat ----
// One question = exactly THREE brain calls: the page calls /api/group/answer once per member, all in parallel.
// Each call gets the question, the notebook and this group's earlier turns — never the other members' answers.
const PREFS = path.join(DATA_DIR, 'preferences.json');

function groupState(s) {
  s.group = s.group || { turns: new Map() };
  return s.group;
}
// Earlier turns as conversation: the question and the answer the user picked (unpicked answers are left out).
function groupHistory(g) {
  const h = [];
  for (const t of g.turns.values()) {
    if (!t.pick || !t.answers[t.pick]) continue;
    h.push({ role: 'user', content: t.question }, { role: 'assistant', content: t.answers[t.pick].text });
  }
  return h.slice(-6);
}

// A Discussion pick is recorded IMMEDIATELY (founder, 2026-11-01 — "Discussion picks: make picking real": the
// standing design always said the user picks ONE answer and it trains the team, but the counter and the write-back
// used to wait for the NEXT question to arrive, which read as "nothing happened" when a pick was the last thing the
// user did in a session). The training log (preferences.json) and the taste counter both update now, and the
// picked answer is written into the user's MAIN chat as a reply from that bot, marked as the Discussion pick.
// Switching the pick for the SAME question (still allowed until the next question locks it) undoes the old count
// and removes the old write-back first, so a question is never written back twice and the counts never drift.
function recordPick(s, turn, member) {
  const uid = s.uid;
  if (turn.pick === member) return { taste: (bookFor(readNotebooks(), uid).profile || {}).taste || null };   // already this pick
  const prev = turn.pick, prevWriteBack = turn.writeBack;
  if (prev && prevWriteBack) {
    const all = readNotebooks(), b = bookFor(all, uid);
    if (b.profile && b.profile.taste && b.profile.taste[prev] > 0) { b.profile.taste[prev]--; writeNotebooks(all); }
    chats.removeReply(uid, prevWriteBack.threadId, prevWriteBack.messageId);
  }
  const removedLive = prevWriteBack || null;   // so the page can take the OLD write-back bubble off screen too, live
  turn.pick = member;
  turn.writeBack = null;
  const all = readNotebooks(), b = bookFor(all, uid);
  if (b.profile) {
    b.profile.taste = Object.assign({ simsim: 0, bot1: 0, bot2: 0 }, b.profile.taste);
    b.profile.taste[member]++;
  }
  writeNotebooks(all);
  // The training record (data/preferences.json): always kept per user; "let my picks help improve the bots" in
  // Data Controls governs any use of this BEYOND the user's own app, unchanged by this build.
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch (e) {}
  (prefs[uid] = prefs[uid] || []).push({
    at: new Date().toISOString(), topic: group.topicTag(turn.question), question: turn.question,
    answers: group.MEMBERS.filter(m => turn.answers[m]).map(m => ({ member: m, name: turn.answers[m].name, text: turn.answers[m].text })),
    picked: member, pickedName: turn.answers[member].name
  });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PREFS + '.tmp', JSON.stringify(prefs, null, 2));
  fs.renameSync(PREFS + '.tmp', PREFS);
  // The write-back: the picked answer, into the main chat, marked as the Discussion pick.
  const mt = chats.mainThread(uid);
  const name = turn.answers[member].name, text = turn.answers[member].text;
  const mid = chats.addDiscussionPick(uid, mt.id, text, name);
  turn.writeBack = mid ? { threadId: mt.id, messageId: mid, name, text } : null;
  console.log('[group] pick recorded: ' + member);
  // The Main chat page needs this to show the write-back live, without a reload (round 6 end-check, 2026-11-02) —
  // switching to Main chat is a pure visibility toggle, it never re-fetches, so this is the only way it finds out.
  return { taste: (bookFor(readNotebooks(), uid).profile || {}).taste || null, writeBack: turn.writeBack, removed: removedLive };
}

// The pick locks when the next question arrives: just the picked-answer learning (facts -> notebook, tasks -> open
// loops) now — the counter and the write-back already happened the moment the pick was made, above.
async function lockTurn(s, turn, key) {
  turn.locked = true;
  if (!turn.pick) return null;
  const answers = group.MEMBERS.filter(m => turn.answers[m]).map(m => ({ member: m, name: turn.answers[m].name, text: turn.answers[m].text }));
  console.log('[group] pick locked: ' + turn.pick);

  // The picked answer now counts like a normal Sim Sim answer: facts -> notebook, tasks -> open loops.
  let learned = [], loopChanges = [];
  if (key && memory.wordCount(turn.question) >= 4 && !memory.looksSecret(turn.question + ' ' + answers.map(a => a.text).join(' '))) {
    const before = bookFor(readNotebooks(), s.uid), picked = turn.answers[turn.pick].text;
    const quiet = () => null;
    const [factsOut, loopsOut] = await Promise.all([
      askMeta(memory.buildExtractorMessages(before.profile, before.facts, turn.question, picked, true), key, { effort: 'minimal', maxTokens: SMALL_STEP_TOKENS }).catch(quiet),
      askMeta(loops.buildExtractorMessages(loops.openSorted(before.loops), turn.question, picked, true), key, { effort: 'minimal', maxTokens: SMALL_STEP_TOKENS }).catch(quiet)
    ]);
    const all2 = readNotebooks(), b2 = bookFor(all2, s.uid);
    learned = factsOut ? memory.applyOps(b2, memory.parseOps(factsOut, b2.facts)) : [];
    loopChanges = loopsOut ? loops.applyExtraction(b2, loopsOut) : [];
    if (learned.length || loopChanges.length) writeNotebooks(all2);
  }
  return { qid: turn.qid, member: turn.pick, learned, loops: loopChanges, taste: (bookFor(readNotebooks(), s.uid).profile || {}).taste || null };
}

async function handleGroupAnswer(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const { qid, member } = data;
  const question = typeof data.question === 'string' ? data.question.trim().slice(0, 4000) : '';
  if (!group.MEMBERS.includes(member) || typeof qid !== 'string' || !/^[\w-]{8,64}$/.test(qid) || !question)
    return sendJson(res, 400, { error: 'Bad request.' });
  const key = (process.env.META_API_KEY || '').trim();
  const g = groupState(s);
  const b = bookFor(readNotebooks(), s.uid);
  const name = group.memberName(b.profile, member);

  let turn = g.turns.get(qid), lockWork = null;
  if (!turn) {   // the first of the three calls opens the turn and locks the earlier pick
    for (const t of g.turns.values()) if (!t.locked) lockWork = lockTurn(s, t, key).catch(e => { console.error('[group] lock failed:', e.message); return null; });
    // Every new question is pickable (founder's end-check, round 6, 2026-11-02 — the "every NEW question's three
    // answers are pickable" rule, replacing the 2026-10-29 small-talk filter). Diagnosed first: the "lock" the
    // founder saw was never turn.locked leaking across questions — a fresh turn object is created right here,
    // every time, always with its own locked:false — it was this very call's own PICK_RUBRIC classifier (a tiny,
    // separate brain call) correctly-or-incorrectly scoring a round as not worth a pick, or failing/returning an
    // unclear answer, either of which disabled all three buttons for that one round by DESIGN at the time. That
    // classifier call (group.buildPickCall/parsePick) is no longer used to gate anything.
    turn = { qid, question, answers: {}, pending: {}, pick: null, writeBack: null, locked: false, history: groupHistory(g), pickable: true };
    g.turns.set(qid, turn);
    if (g.turns.size > 30) g.turns.delete(g.turns.keys().next().value);
    console.log('[group] question received (' + question.length + ' characters)'); // never the words
  }
  if (turn.question !== question) return sendJson(res, 400, { error: 'Bad request.' });

  // each member answers once per question: a repeat call gets the same answer, never a new brain call
  if (!turn.answers[member]) {
    turn.pending[member] = turn.pending[member] || (async () => {
      if (!key) return { text: STUB_REPLY, sources: [] }; // STUB RULE
      // the facts member's Book pages: matched on this question plus the one before it (follow-ups like "do I keep my old one?")
      const prevQ = (turn.history.filter(h => h.role === 'user').pop() || {}).content || '';
      const extracts = member === 'bot1' ? group.bookFor(question + ' ' + prevQ, b.profile ? b.profile.state : '') : [];
      const raw = await askMeta(group.buildCall(member, b.profile, b.facts, loops.openSorted(b.loops).slice(0, 20), turn.history, question, extracts), key);
      return member === 'bot1' ? group.finishFacts(raw, extracts) : { text: raw, sources: [] };
    })();
    try {
      const out = await turn.pending[member];
      turn.answers[member] = Object.assign({ name }, out);
      console.log('[group] ' + member + ' answered' + (out.sources && out.sources.length ? ' (with ' + out.sources.length + ' source)' : ''));
    } catch (e) {
      delete turn.pending[member];
      return sendJson(res, 502, { member, error: e.message, locked: lockWork ? await lockWork : null });
    }
  }
  const a = turn.answers[member];
  sendJson(res, 200, { member, name: a.name, role: group.ROLES[member], text: a.text, sources: a.sources, pickable: turn.pickable,
    locked: lockWork ? await lockWork : null });
}

async function handleGroupPick(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const turn = groupState(s).turns.get(data.qid);
  if (!turn || !group.MEMBERS.includes(data.member) || !turn.answers[data.member]) return sendJson(res, 400, { error: 'That answer is not here.' });
  if (!turn.pickable) return sendJson(res, 409, { error: 'This round has no pick.' });   // small talk: nothing to pick, log or count
  if (turn.locked) return sendJson(res, 409, { error: 'That pick is locked.' });
  const result = recordPick(s, turn, data.member);   // can switch freely until the next question — each switch re-records
  sendJson(res, 200, { ok: true, qid: turn.qid, member: turn.pick, taste: result.taste, writeBack: result.writeBack || null, removed: result.removed || null });
}

// This session's Discussion rounds (kept in session memory), so a page reload puts them back exactly: the question,
// ALL answers (unpicked ones too — they stay on screen, faded), the pick and the reactions. Display only.
function handleGroupRounds(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const rounds = [...groupState(s).turns.values()].map(t => ({
    qid: t.qid, question: t.question, pick: t.pick, locked: t.locked, pickable: t.pickable, reactions: t.reactions || {},
    answers: group.MEMBERS.filter(m => t.answers[m]).map(m => ({ member: m, name: t.answers[m].name, text: t.answers[m].text, sources: t.answers[m].sources || [] }))
  }));
  sendJson(res, 200, { rounds });
}

// Rename the two helper bots (Sim Sim's name is fixed and has no rename anywhere).
async function handleBotNames(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const names = Array.isArray(data.botNames) && data.botNames.length === 2 ? data.botNames.map(n => typeof n === 'string' ? n.trim().replace(/\s+/g, ' ') : '') : [];
  if (names.length !== 2 || !names.every(n => /^[A-Za-z0-9 ]{1,30}$/.test(n))) return sendJson(res, 400, { error: 'Bot names use 1 to 30 letters, numbers, or spaces.' });
  const all = readNotebooks(), b = bookFor(all, s.uid);
  if (!b.profile) return sendJson(res, 404, { error: 'no profile' });
  b.profile.botNames = names;
  writeNotebooks(all);
  sendJson(res, 200, { profile: b.profile });
}

// ---- Morning briefing: today's (from the day-cache, or made fresh in ONE brain call and cached) ----
function dateLabel(ymd) {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
async function briefingFor(uid, today, force) {
  const key = (process.env.META_API_KEY || '').trim();
  const book = bookFor(readNotebooks(), uid);
  book.reminders = reminders.forBriefing(uid);   // reminders due today (or already due) go into the briefing too
  const briefingTime = settings.settingsOf(book).briefingTime;
  const result = await briefing.todays({ book, today, todayLabel: dateLabel(today), key, ask: (m, o) => askMeta(m, key, o), force, briefingTime, now: new Date() });
  delete book.reminders;
  if (result.fresh) {   // fresh read before saving: the user may have changed things while the brain was writing
    const all = readNotebooks();
    bookFor(all, uid).briefing = book.briefing;
    writeNotebooks(all);
    console.log('[briefing] ' + (force ? 'refreshed' : 'made') + ' for ' + today);
  }
  return result;
}
async function handleBriefing(req, res, force) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = force ? await readJson(req, res) : { date: new URL(req.url, 'http://x').searchParams.get('date') };
  if (!data) return;
  // the user's local date (from the page), trusted only if it is within a day of the server's
  const today = typeof data.date === 'string' && loops.validYmd(data.date) && Math.abs(loops.daysUntil(data.date)) <= 1 ? data.date : loops.today();
  const book = bookFor(readNotebooks(), s.uid);
  const greeting = 'Good morning, ' + (book.profile ? book.profile.callName : 'there');
  if (!settings.settingsOf(book).briefingOn) {   // turned off in Settings: no brain call, nothing composed
    return sendJson(res, 200, { date: today, dateLabel: dateLabel(today), greeting, text: BRIEFING_OFF, items: { loops: [], comingUp: [], remember: [] }, off: true });
  }
  let result;
  try { result = await briefingFor(s.uid, today, force); }
  catch (e) { return sendJson(res, 502, { error: e.message }); }
  sendJson(res, 200, {
    date: today, dateLabel: dateLabel(today), greeting,
    text: result.text, items: result.items, stub: !!result.stub,
    notReady: !!result.notReady, readyAt: result.readyAt || null
  });
}

// ---- Settings (per user, in the notebook) ----
const BRIEFING_OFF = 'Your morning briefing is turned off. You can turn it back on in Settings.';

async function handleSettings(req, res, save) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = save ? await readJson(req, res) : {};
  if (!data) return;
  const all = readNotebooks(), book = bookFor(all, s.uid);
  if (save) {
    if (data.themeId !== undefined) {   // the theme lives in the profile: one source of truth with setup and Profile
      if (!book.profile) return sendJson(res, 404, { error: 'no profile' });
      if (!THEMES.some(t => t.id === data.themeId)) return sendJson(res, 400, { error: 'Pick a theme.' });
      book.profile.themeId = data.themeId;
    }
    const { changes, error } = settings.clean(data);
    if (error) return sendJson(res, 400, { error });
    const before = settings.settingsOf(book);
    if (changes.permissions) changes.permissions = Object.assign(before.permissions, changes.permissions);   // one group at a time
    book.settings = Object.assign(before, changes);
    writeNotebooks(all);
  }
  sendJson(res, 200, { settings: settings.settingsOf(book), profile: book.profile, vaultReady: !!vault.key(),
    actions: { groups: actions.GROUPS, floor: actions.FLOOR_LIST } });   // Settings → Permissions lists exactly these
}

// ---- The MOUTH (voice.js): Sim Sim's 10 designed voices through ElevenLabs. The page sends finished answer text in
// ~450-character chunks; each comes back as audio in the user's chosen voice. No key, no voice id, or a failed call ->
// 503 with the honest reason, and the page speaks with the browser's own voice instead (never pretending otherwise).
async function handleSpeak(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text || text.length > voice.CHUNK_MAX) return sendJson(res, 400, { error: 'Send one short piece of text at a time.' });
  const set = settings.settingsOf(bookFor(readNotebooks(), s.uid));
  const name = typeof data.voice === 'string' && voice.NAMES.includes(data.voice) ? data.voice : set.voice;   // "Hear it" names one
  const out = await voice.synth(text, name, set.speechRate);
  if (out.fallback) return sendJson(res, 503, { fallback: out.fallback, voice: out.voice || name });
  console.log('[speak] ' + out.voice + ' (' + out.voiceId + '): ' + text.length + ' characters' + (data.part ? ', part ' + data.part : ''));   // never the words
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': out.audio.length, 'Cache-Control': 'no-store', 'X-Voice': out.voice });
  res.end(out.audio);
}
function handleVoices(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  sendJson(res, 200, voice.status(settings.settingsOf(bookFor(readNotebooks(), s.uid)).voice));
}

// ---- Data controls: download everything, or forget everything ----
function handleExport(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const book = bookFor(readNotebooks(), s.uid);
  let prefs = [];
  try { prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8'))[s.uid] || []; } catch (e) {}
  const out = {
    exportedAt: new Date().toISOString(),
    account: { email: s.email },
    profile: book.profile, settings: settings.settingsOf(book),
    notebook: { learnedFacts: book.facts }, openLoops: book.loops, morningBriefing: book.briefing || null,
    discussionPicks: prefs,
    chatHistory: chats.list(s.uid).map(c => chats.get(s.uid, c.id)),
    note: 'Saved logins are not included in this file (passwords never leave the vault in bulk). Saved pictures stay in data/images on the Sim Sim server.'
  };
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="sim-sim-my-data-' + loops.today() + '.json"' });
  res.end(JSON.stringify(out, null, 2));
}
async function handleErase(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  if (data.confirm !== 'erase') return sendJson(res, 400, { error: 'Confirm first.' });
  const all = readNotebooks();
  delete all[s.uid];               // profile, notebook (learned memory), open loops, settings, briefing — all gone
  writeNotebooks(all);
  try {
    const prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8'));
    if (prefs[s.uid]) { delete prefs[s.uid]; fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 2)); }
  } catch (e) {}
  chats.removeAll(s.uid);          // Chat history too
  pictures.removeAll(s.uid);       // and the "Your pictures" index (the files stay, as the copy says)
  resetConversation(s); s.turns = new Map(); s.group = null;
  console.log('[data] a user erased their data');
  sendJson(res, 200, { ok: true });
}

// ---- Saved logins (the vault): owner-only, never to the brain, passwords never listed or logged ----
const VAULT_OFF = 'vault not set up';
async function handleVault(req, res, action) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = action === 'list' ? {} : await readJson(req, res);
  if (!data) return;
  if (!vault.key()) return sendJson(res, 503, { error: VAULT_OFF, ready: false });
  if (action === 'add') {
    const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '');
    const site = clip(data.site, 200), username = clip(data.username, 200);
    const password = typeof data.password === 'string' ? data.password.slice(0, 500) : '';
    if (!site || !username || !password) return sendJson(res, 400, { error: 'Fill in the site, the username and the password.' });
    vault.add(s.uid, site, username, password);
  } else if (action === 'reveal') {
    const pw = vault.reveal(s.uid, data.id);
    if (pw === null) return sendJson(res, 404, { error: 'That login could not be opened.' });
    return sendJson(res, 200, { password: pw });   // ONE password, on request
  } else if (action === 'delete') {
    vault.remove(s.uid, data.id);
  }
  sendJson(res, 200, { ready: true, entries: vault.list(s.uid) });   // site + username only
}

// ---- The Open loops view (GET /api/loops is also the data path the morning briefing reads) ----
async function handleLoops(req, res, action) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = action === 'list' ? {} : await readJson(req, res);
  if (!data) return;
  if (action === 'add') {   // manual add: no AI
    const text = loops.cleanText(data.text);
    const due = typeof data.dueDate === 'string' && data.dueDate ? data.dueDate : null;
    if (text.length < 1 || text.length > 200) return sendJson(res, 400, { error: 'Write the task in 1 to 200 characters.' });
    if (due && !loops.validYmd(due)) return sendJson(res, 400, { error: 'That date does not look right.' });
    const all = readNotebooks(), book = bookFor(all, s.uid);
    book.loops.push(loops.newLoop(text, due));
    writeNotebooks(all);
  } else if (action === 'done') {   // the user tapped Done
    closeIds(s.uid, [data.id]);
  }
  const book = bookFor(readNotebooks(), s.uid);
  sendJson(res, 200, { today: loops.today(), open: loops.openSorted(book.loops), closed: loops.closedSorted(book.loops) });
}

// ---- The Profile view's memory list ----
async function handleFacts(req, res, action) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = action === 'list' ? {} : await readJson(req, res);
  if (!data) return;
  const all = readNotebooks(), book = bookFor(all, s.uid);
  if (action === 'update') {
    const f = book.facts.find(x => x.id === data.id);
    const text = typeof data.text === 'string' ? data.text.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!f) return sendJson(res, 404, { error: 'That memory is already gone.' });
    if (text.length < 1 || text.length > 300) return sendJson(res, 400, { error: 'Keep it between 1 and 300 characters.' });
    if (memory.looksSecret(text)) return sendJson(res, 400, { error: "Sim Sim doesn't keep passwords, codes or numbers like that." });
    f.text = text;
    f.updatedAt = new Date().toISOString();
    writeNotebooks(all);
  } else if (action === 'delete') {
    book.facts = book.facts.filter(x => x.id !== data.id);
    writeNotebooks(all);
  } else if (action === 'clear') {
    book.facts = [];          // facts only: the profile basics stay
    writeNotebooks(all);
  }
  // An edited/deleted/cleared fact must win right away (founder's end-check, round 3, 2026-11-02): the notebook
  // itself was always saved correctly, but a stale answer from earlier in this same chat ("your favorite soup is
  // lentil") was still sitting in s.history, and the brain kept it consistent with its own prior turn instead of
  // the freshly-edited notebook. Clearing it means the very next answer is built only from the system prompt's
  // current notebook, never an old assistant turn that now disagrees with it.
  if (action !== 'list') s.history = [];
  sendJson(res, 200, { facts: memory.newestFirst(book.facts) });
}

function serveFile(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    // no-store, not just no-cache (round 4 end-check, 2026-11-02): no-cache still permits Chrome's back/forward
    // cache to serve an old in-memory copy of the page without ever asking the server — a real way a fix already
    // on disk could still look "not live" to whoever is testing. no-store rules that out for every static file.
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const fail = () => { if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' }); };
  // A handful of routes below call a plain (non-async) handler with no .catch — a synchronous throw in any of them
  // used to escape this callback entirely and crash the whole process (see the uncaughtException/unhandledRejection
  // net near the top of this file). This try/catch is the same defence at the one place every route passes through,
  // so a bad request on ANY route ends as a normal 500 for that request, never a dead server for everyone else.
  try {
  if (req.url === '/api/chat' && req.method === 'POST') return handleChat(req, res).catch(fail);
  if (req.url === '/api/chat/stop' && req.method === 'POST') return handleChatStop(req, res).catch(fail);
  if (req.url === '/api/session' && req.method === 'POST') return handleSessionStart(req, res).catch(fail);
  if (req.url === '/api/session' && req.method === 'GET') {
    const s = getSession(req);
    const out = s ? { signedIn: true, email: s.email } : { signedIn: false };
    if (TEST_MODE) out.testMode = true; // the page shows the "Test mode" marker and hides Sign out
    else if (DEV_DOOR) out.devDoor = true; // the page shows the email-only card and the "Dev door" marker
    return sendJson(res, 200, out);
  }
  if (req.url === '/api/dev-door' && req.method === 'POST') return handleDevDoor(req, res).catch(fail);
  if (req.url === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
  if (req.url === '/api/profile' && req.method === 'GET') return handleProfileGet(req, res);
  if (req.url === '/api/profile' && req.method === 'POST') return handleProfileSave(req, res).catch(fail);
  if (req.url === '/api/chat/learn' && req.method === 'POST') return handleLearn(req, res).catch(fail);
  if (req.url === '/api/chat/reset' && req.method === 'POST') return handleChatReset(req, res);
  if (req.url === '/api/chats' && req.method === 'GET') return handleChatsList(req, res);
  if (req.url === '/api/chats/open' && req.method === 'POST') return handleChatOpen(req, res).catch(fail);
  if (req.url.startsWith('/api/chats/tail?') && req.method === 'GET') return handleChatTail(req, res);
  if (req.url === '/api/chats/new' && req.method === 'POST') return handleChatNew(req, res).catch(fail);
  if (req.url === '/api/actions/decide' && req.method === 'POST') return handleActionDecide(req, res).catch(fail);
  if (req.url === '/api/chats/react' && req.method === 'POST') return handleChatReact(req, res).catch(fail);
  if (req.url === '/api/chats/delete-message' && req.method === 'POST') return handleChatDeleteMessage(req, res).catch(fail);
  if (req.url === '/api/chats/rename' && req.method === 'POST') return handleChatRename(req, res).catch(fail);
  if (req.url === '/api/chats/delete' && req.method === 'POST') return handleChatDelete(req, res).catch(fail);
  if (req.url === '/api/chats/delete-all' && req.method === 'POST') return handleChatsDeleteAll(req, res);
  if (req.url.startsWith('/api/chats/export?') && req.method === 'GET') return handleChatExport(req, res);
  if (req.url === '/api/group/react' && req.method === 'POST') return handleGroupReact(req, res).catch(fail);
  if (req.url === '/api/pictures' && req.method === 'GET') return handlePictures(req, res);
  if (req.url === '/api/pictures/delete' && req.method === 'POST') return handlePictureDelete(req, res).catch(fail);
  if (req.url === '/api/loops' && req.method === 'GET') return handleLoops(req, res, 'list').catch(fail);
  if (req.url === '/api/group/answer' && req.method === 'POST') return handleGroupAnswer(req, res).catch(fail);
  if (req.url === '/api/group/pick' && req.method === 'POST') return handleGroupPick(req, res).catch(fail);
  if (req.url === '/api/group/rounds' && req.method === 'GET') return handleGroupRounds(req, res);
  const bm = req.url.match(/^\/api\/browser\/(state|shot|stop|close|open|tab)(?:\?.*)?$/);
  if (bm && (req.method === 'GET') === (bm[1] === 'state' || bm[1] === 'shot')) return handleBrowserApi(req, res, bm[1]).catch(fail);
  if (req.url === '/api/profile/bots' && req.method === 'POST') return handleBotNames(req, res).catch(fail);
  if (req.url === '/api/face' && req.method === 'POST') return handleFace(req, res).catch(fail);
  if (req.url === '/api/face/make' && req.method === 'POST') return handleFaceMake(req, res).catch(fail);
  if (req.url.startsWith('/api/chats/search?') && req.method === 'GET') {   // global search: the signed-in user's own chats only
    const s = getSession(req);
    if (!s) return sendJson(res, 401, { error: 'not signed in' });
    return sendJson(res, 200, { results: chats.search(s.uid, new URL(req.url, 'http://x').searchParams.get('q')) });
  }
  if (req.url === '/api/reminders' && req.method === 'GET') return handleReminders(req, res, 'list').catch(fail);
  if (req.url === '/api/reminders/shown' && req.method === 'POST') return handleReminders(req, res, 'shown').catch(fail);
  if (req.url === '/api/reminders/done' && req.method === 'POST') return handleReminders(req, res, 'done').catch(fail);
  const vnm = req.method === 'GET' && req.url.match(/^\/api\/voicenotes\/([^/?]+)$/);
  if (vnm) return handleVoiceNoteFile(req, res, vnm[1]);
  const docm = req.method === 'GET' && req.url.match(/^\/api\/documents\/([^/?]+)(\?view=1)?$/);
  if (docm) return handleDocumentFile(req, res, docm[1], !!docm[2]);
  const sitem = req.method === 'GET' && req.url.match(/^\/api\/websites\/([^/?]+)(\?dl=1)?$/);
  if (sitem) return handleWebsiteFile(req, res, sitem[1], !!sitem[2]);
  if (req.url === '/api/speak' && req.method === 'POST') return handleSpeak(req, res).catch(fail);
  if (req.url === '/api/voices' && req.method === 'GET') return handleVoices(req, res);
  if (req.url === '/api/settings' && req.method === 'GET') return handleSettings(req, res, false).catch(fail);
  if (req.url === '/api/settings' && req.method === 'POST') return handleSettings(req, res, true).catch(fail);
  if (req.url === '/api/data/export' && req.method === 'GET') return handleExport(req, res);
  if (req.url === '/api/data/erase' && req.method === 'POST') return handleErase(req, res).catch(fail);
  if (req.url === '/api/vault' && req.method === 'GET') return handleVault(req, res, 'list').catch(fail);
  if (req.url === '/api/vault/add' && req.method === 'POST') return handleVault(req, res, 'add').catch(fail);
  if (req.url === '/api/vault/reveal' && req.method === 'POST') return handleVault(req, res, 'reveal').catch(fail);
  if (req.url === '/api/vault/delete' && req.method === 'POST') return handleVault(req, res, 'delete').catch(fail);
  if (req.url.split('?')[0] === '/api/briefing' && req.method === 'GET') return handleBriefing(req, res, false).catch(fail);
  if (req.url === '/api/briefing/refresh' && req.method === 'POST') return handleBriefing(req, res, true).catch(fail);
  if (req.url === '/api/loops/add' && req.method === 'POST') return handleLoops(req, res, 'add').catch(fail);
  if (req.url === '/api/loops/done' && req.method === 'POST') return handleLoops(req, res, 'done').catch(fail);
  if (req.url.startsWith('/api/images/') && req.method === 'GET') return serveImage(req, res);
  if (req.url === '/api/facts' && req.method === 'GET') return handleFacts(req, res, 'list').catch(fail);
  if (req.url === '/api/facts/update' && req.method === 'POST') return handleFacts(req, res, 'update').catch(fail);
  if (req.url === '/api/facts/delete' && req.method === 'POST') return handleFacts(req, res, 'delete').catch(fail);
  if (req.url === '/api/facts/clear' && req.method === 'POST') return handleFacts(req, res, 'clear').catch(fail);
  if (req.method === 'GET') return serveFile(req, res);
  res.writeHead(405); res.end();
  } catch (e) {
    console.error('[server] request handler threw (the server kept running): ' + e.message);
    fail();
  }
});

// Open the app in Chrome (maximized) so it fills the whole window.
function openChrome(url) {
  const chrome = [
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
  ].find(p => fs.existsSync(p));
  if (chrome) spawn(chrome, ['--new-window', '--start-maximized', url], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is already in use, so this SIM SIM did NOT start.');
    console.error('An older SIM SIM is probably still running (often in another terminal) and still serving OLD code.');
    console.error('Fix: go to that terminal and press Ctrl+C (or close it), then run npm.cmd start again.');
  }
  else console.error(e.message);
  process.exit(1);
});

// Ctrl+C (or a stop signal): close Sim Sim's browser windows first, so none is left behind holding a user's profile.
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => {
  Promise.race([browser.closeAll(), new Promise(r => setTimeout(r, 3000))]).finally(() => process.exit(0));
}));

server.listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('SIM SIM is running at ' + url);
  console.log(process.env.META_API_KEY ? 'Brain: Meta Model API (' + META_MODEL + ')' : 'Brain: NOT connected (no META_API_KEY) - replies are the stub sentence');
  console.log('Doors: dev door ' + (DEV_DOOR ? 'on' : 'off') + ' · preview lock ' + (PREVIEW_ONLY_EMAIL ? 'set' : 'unset') + '.');
  if (TEST_MODE) console.log('*** TEST MODE ON - no sign-in: every visitor is local-test-user. Remove SIMSIM_TEST_MODE=1 from .env to turn it off. ***');
  if (TEST_MODE && DEV_DOOR) console.log('(SIMSIM_DEV_DOOR=1 is ignored while test mode is on.)');
  if (DEV_DOOR && !TEST_MODE) console.log('*** DEV DOOR ON - type any email to enter, no verification. Remove SIMSIM_DEV_DOOR=1 from .env to turn it off. ***');
  else if (!TEST_MODE) console.log(process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? 'Sign-in: Firebase email link' : 'Sign-in: NOT set up (no FIREBASE_SERVICE_ACCOUNT_PATH)');
  console.log('Press Ctrl+C to stop.');
  if (!process.argv.includes('--no-open')) openChrome(url);
});
