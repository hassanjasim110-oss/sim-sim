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

const PORT = Number(process.env.PORT) || 3000;
const META_URL = 'https://api.meta.ai/v1/chat/completions';
const META_MODEL = process.env.META_MODEL || 'muse-spark-1.3';
const memory = require('./memory.js'); // notebook rules: what the brain reads, learning, forgetting
const { imageRequest } = require('./public/image-intent.js'); // image lane: is this a clear "make a picture" request?
const answers = require('./answers.js'); // the Answers Process: fast lane vs. precise (the Book + citations)
const loops = require('./loops.js');     // open loops: tasks stay open until the user says they're done
const briefing = require('./briefing.js'); // morning briefing: the user's own items, composed by the brain in one call
const group = require('./group.js');       // Group Chat: Sim Sim + the user's two bots (one Meta brain, three persona cards)
const settings = require('./settings.js'); // Settings: per-user preferences (each one is read by something real)
const vault = require('./vault.js');       // Saved logins: AES-256-GCM with VAULT_KEY; never to the brain or the notebook
const chats = require('./chats.js');       // Chat history: every 1-on-1 thread, saved per user in data/chats.json
const META_IMAGE_URL = 'https://api.meta.ai/v1/images/generations';
const META_IMAGE_MODEL = 'muse-image-1.0'; // Meta's own image model (Muse Image), confirmed on this account's model list
const IMAGE_FAIL = "I couldn't make that image right now.";
const STUB_REPLY = 'Meta brain not connected yet.';
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
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!file) throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is not set');
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const account = JSON.parse(fs.readFileSync(file, 'utf8'));
  firebaseAuth = getAuth(initializeApp({ credential: cert(account) }));
  return firebaseAuth;
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
    const old = readCookie(req, COOKIE);
    if (old) sessions.delete(old);
    const sid = crypto.randomBytes(32).toString('base64url');   // the same kind of session a verified sign-in gets
    sessions.set(sid, { uid: accountForEmail(email), email, signedInAt: new Date().toISOString(), dev: true });
    sendJson(res, 200, { ok: true, email }, { 'Set-Cookie': COOKIE + '=' + sid + '; HttpOnly; SameSite=Lax; Path=/' });
  });
}

function getSession(req) {
  if (TEST_MODE) return TEST_SESSION;
  const sid = readCookie(req, COOKIE);
  return sid ? sessions.get(sid) || null : null;
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
  const old = readCookie(req, COOKIE);
  if (old) sessions.delete(old);
  const sid = crypto.randomBytes(32).toString('base64url');
  sessions.set(sid, { uid: user.uid, email: user.email, signedInAt: new Date().toISOString() });
  sendJson(res, 200, { ok: true, email: user.email }, { 'Set-Cookie': COOKIE + '=' + sid + '; HttpOnly; SameSite=Lax; Path=/' });
}

function handleLogout(req, res) {
  const sid = readCookie(req, COOKIE);
  if (sid) sessions.delete(sid);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': COOKIE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
}

// Ask Meta's brain. Returns the reply text, or throws an Error with a plain-words message.
// opts.effort: how hard it thinks ('low' for chat: quick answers for a voice assistant); opts.maxTokens: output cap.
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
      }, opts.maxTokens ? { max_completion_tokens: opts.maxTokens } : {})),
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
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('The Meta brain sent back an empty answer.');
  return text.trim();
}

// ---- The notebook: one JSON file, one entry per user (keyed by the uid from the verified session) ----
const { GENDERS, STATES, THEMES, BOT_ROLES } = require('./public/notebook-data.js');
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
  }, book.profile && book.profile.taste ? { taste: book.profile.taste } : {}); // keep the Group Chat pick counts
  if (!Array.isArray(book.facts)) book.facts = [];
  all[s.uid] = book;
  writeNotebooks(all);
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
async function makeImage(prompt, key) {
  const call = () => fetch(META_IMAGE_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: META_IMAGE_MODEL, prompt, n: 1, response_format: 'b64_json', output_format: 'png' }),
    signal: AbortSignal.timeout(120000)
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
  const s = subject.replace(/\bmy\b/gi, 'your').replace(/\bmine\b/gi, 'yours').replace(/\bme\b/gi, 'you').replace(/\bour\b/gi, 'your').replace(/\bus\b/gi, 'you');
  return /^your\b/i.test(s) ? "Here's " + s + ' you asked for.' : "Here's the " + s + ' you asked for.';
}

async function answerImage(s, req, message, subject) {
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return { reply: STUB_REPLY, stub: true }; // STUB RULE: no other AI, ever
  let png;
  try { png = await makeImage(message, key); }
  catch (e) {
    console.error('[image] ' + new Date().toLocaleTimeString() + ' failed: ' + e.message); // never the prompt
    return { reply: IMAGE_FAIL };
  }
  const dir = path.join(IMAGES_DIR, s.uid);
  fs.mkdirSync(dir, { recursive: true });
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex') + '.png';
  fs.writeFileSync(path.join(dir, name), png);
  console.log('[image] ' + new Date().toLocaleTimeString() + ' drawn (' + Math.round(png.length / 1024) + ' KB)');
  return { reply: imageLine(subject), image: { url: '/api/images/' + name, subject } };
}

// Serves a saved picture — only from the signed-in user's own folder.
function serveImage(req, res) {
  const s = getSession(req);
  if (!s) { res.writeHead(401); return res.end(); }
  const name = req.url.slice('/api/images/'.length).split('?')[0];
  if (!/^[\w-]+\.png$/.test(name)) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(IMAGES_DIR, s.uid, name), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' });
    res.end(data);
  });
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
    return forgotLine(forgetIds(s.uid, [...new Set(picks)]));
  }
  return null;
}

function answerForget(s, f, facts) {
  if (f.all) {
    if (!facts.length) return "There's nothing in my notebook to forget yet.";
    s.pending = { type: 'forgetAll', at: Date.now() };
    return 'Forget all ' + facts.length + ' facts? Say yes to confirm';
  }
  if (!f.query) return 'Tell me what to forget — for example, "forget my sister\'s birthday".';
  const hits = memory.matchFacts(facts, f.query);
  if (!hits.length) return "I don't have anything like that in my notebook.";
  if (hits.length === 1) return forgotLine(forgetIds(s.uid, [hits[0].id]));
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
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  // room for one picture of up to 5 MB (base64 is about a third bigger); the picture rides in its own field, data.image
  const data = await readJson(req, res, 7500000, PICTURE_TOO_LARGE);
  if (!data) return;
  const picture = parsePicture(data.image);
  if (picture && picture.error) return sendJson(res, picture.status || 400, { error: picture.error });
  // the words limit measures the WORDS only — the picture never counts against it
  let message = typeof data.message === 'string' ? data.message.trim().slice(0, MESSAGE_MAX) : '';
  if (!message && !picture) return sendJson(res, 400, { error: 'Empty message.' });
  console.log('[chat] ' + new Date().toLocaleTimeString() + ' message received (' + message.length + ' characters' +
    (picture ? ' + a picture, ' + picture.kb + ' KB' : '') + ')'); // never the words, never the picture

  // With a picture, the message is a question about it: it goes straight to the brain with the picture
  // (no drawing lane, no commands, no briefing).
  if (picture) return answerChat(req, res, s, data, message, picture);

  // Image lane FIRST: a clear "make a picture" request goes to Muse Image — no text-brain call,
  // and it is never learned from (it returns before the memory step).
  const img = imageRequest(message);
  if (img) {
    s.pending = null;
    return sendReply(res, s, data, message, null, await answerImage(s, req, message, img.subject));
  }

  // Read first: this user's own notebook (profile + facts), by the uid from the verified session.
  const book = bookFor(readNotebooks(), s.uid);

  // Follow-ups ("which one?"), done-phrases and forget commands are handled here, without the brain.
  const pendingReply = answerPending(s, message);
  if (pendingReply) return sendReply(res, s, data, message, null, { reply: pendingReply, memoryChanged: true, loopsChanged: true });
  const done = loops.parseDone(message);
  if (done) {
    const doneReply = answerDone(s, done.task, loops.openSorted(book.loops));
    if (doneReply) return sendReply(res, s, data, message, null, { reply: doneReply, loopsChanged: true });
  }
  const forget = memory.parseForget(message);
  if (forget) return sendReply(res, s, data, message, null, { reply: answerForget(s, forget, book.facts), memoryChanged: true });

  // Morning briefing in chat: "what's my morning briefing?", or "good morning" as the first wake command of the day.
  let wantBriefing = briefing.asksForBriefing(message);
  const briefingOn = settings.settingsOf(book).briefingOn; // Settings > Briefing & loops
  if (data.viaWake === true) {
    const all = readNotebooks(), b = bookFor(all, s.uid), day = loops.today();
    if (briefingOn && b.wakeDay !== day && briefing.isGoodMorning(message)) wantBriefing = true;
    b.wakeDay = day; // remembers that today's first wake command has happened
    writeNotebooks(all);
  }
  if (wantBriefing && !briefingOn) return sendReply(res, s, data, message, null, { reply: BRIEFING_OFF });
  if (wantBriefing) {
    let text;
    try { text = (await briefingFor(s.uid, loops.today(), false)).text; }
    catch (e) { return sendJson(res, 502, { error: e.message }); }
    s.history = s.history || [];
    s.history.push({ role: 'user', content: message }, { role: 'assistant', content: text });
    return sendReply(res, s, data, message, null, { reply: text, briefing: true });
  }

  return answerChat(req, res, s, data, message, null);
}

// Every answered 1-on-1 turn goes into the user's saved thread (Chat history) before the reply is sent.
// data.thread: 'new' or a thread id from the main chat. The Screen Watch mini chat sends none, so it is not saved.
function sendReply(res, s, data, message, picture, out) {
  if (typeof out.reply === 'string' && typeof data.thread === 'string' && data.thread.length <= 40) {
    try {
      out.threadId = chats.saveTurn(s.uid, data.thread, {
        message, picture: picture ? (data.screen === true ? 'screen' : 'picture') : null, secret: memory.looksSecret(message)
      }, out);
    } catch (e) { console.error('[chats] could not save this turn: ' + e.message); }
  }
  sendJson(res, 200, out);
}

// The answer itself (with or without a picture), then the guardian, the short history and the learn step.
async function answerChat(req, res, s, data, message, picture) {
  const book = bookFor(readNotebooks(), s.uid);
  const key = (process.env.META_API_KEY || '').trim();
  if (!key) return sendReply(res, s, data, message, picture, { reply: STUB_REPLY, stub: true }); // STUB RULE: no other AI, ever

  let result, pictureNote = null;
  s.history = s.history || [];
  if (picture) {
    // ONE brain call: the words and the picture together, in the model's image input format.
    const openLoops = loops.openSorted(book.loops).slice(0, 20);
    try {
      const reply = await askMeta([
        { role: 'system', content: memory.buildChatSystem(book.profile, book.facts, openLoops) + VISION_NOTE +
          (data.screen === true ? SCREEN_NOTE : '') + (data.circled === true ? CIRCLE_NOTE : '') },
        ...s.history.slice(-6),
        { role: 'user', content: [{ type: 'text', text: message || 'What does this picture show?' }, { type: 'image_url', image_url: { url: picture.dataUrl } }] }
      ], key);
      result = { lane: 'picture', reply };
    } catch (e) {
      console.error('[chat] picture call failed: ' + e.message);
      if (!message) return sendReply(res, s, data, message, picture, { reply: PICTURE_FAIL, pictureFailed: true });
      pictureNote = PICTURE_FAIL;   // the typed words still get an answer, below
    }
  }
  // The Answers Process: general -> fast lane; precise -> notebook, the Book, official web, or an honest "no source".
  if (!result) {
    try {
      result = await answers.answer({
        ask: (messages, opts) => askMeta(messages, key, opts),
        searchWeb: prompt => searchWebUrls(prompt, key),
        message, history: s.history, profile: book.profile, facts: book.facts, loops: loops.openSorted(book.loops).slice(0, 20)
      });
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }
  const reply = result.reply;

  // Deadline guardian: one gentle line before the answer, at most once per day per loop (stamped in the notebook).
  const fresh = readNotebooks(), freshBook = bookFor(fresh, s.uid);
  const guardian = settings.settingsOf(freshBook).loopRemindersOn ? loops.guardianLine(freshBook) : null; // Settings > open-loop reminders
  if (guardian) writeNotebooks(fresh);
  console.log('[answer] ' + result.lane + (result.from ? ' (' + result.from + ')' : '') + (result.sources ? ', sources: ' + result.sources.length : ''));
  // the short conversation context keeps words only — the picture itself is not kept
  const shared = picture ? (data.screen === true ? '[shared a screen snapshot] ' : '[shared a picture] ') : '';
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
  sendReply(res, s, data, message, picture, out);
}

// "New chat": forget the short conversation context (not the notebook).
function handleChatReset(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  s.history = [];
  s.pending = null;
  sendJson(res, 200, { ok: true });
}

// ---- Chat history: the user's own saved 1-on-1 threads ----
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
  s.history = chats.contextOf(t);
  s.pending = null;
  sendJson(res, 200, { chat: t });
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
  sendJson(res, 200, { learned, loops: loopChanges });
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

// The pick locks when the next question arrives: training log + taste counts + the standard write-back.
async function lockTurn(s, turn, key) {
  turn.locked = true;
  if (!turn.pick) return null;
  const all = readNotebooks(), b = bookFor(all, s.uid);
  const entry = {
    at: new Date().toISOString(), topic: group.topicTag(turn.question), question: turn.question,
    answers: group.MEMBERS.filter(m => turn.answers[m]).map(m => ({ member: m, name: turn.answers[m].name, text: turn.answers[m].text })),
    picked: turn.pick, pickedName: turn.answers[turn.pick].name
  };
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch (e) {}
  (prefs[s.uid] = prefs[s.uid] || []).push(entry);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PREFS + '.tmp', JSON.stringify(prefs, null, 2));
  fs.renameSync(PREFS + '.tmp', PREFS);
  if (b.profile) {
    b.profile.taste = Object.assign({ simsim: 0, bot1: 0, bot2: 0 }, b.profile.taste);
    b.profile.taste[turn.pick]++;
  }
  writeNotebooks(all);
  console.log('[group] pick locked: ' + turn.pick);

  // The picked answer now counts like a normal Sim Sim answer: facts -> notebook, tasks -> open loops.
  let learned = [], loopChanges = [];
  if (key && memory.wordCount(turn.question) >= 4 && !memory.looksSecret(turn.question + ' ' + entry.answers.map(a => a.text).join(' '))) {
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
    turn = { qid, question, answers: {}, pending: {}, pick: null, locked: false, history: groupHistory(g) };
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
  sendJson(res, 200, { member, name: a.name, role: group.ROLES[member], text: a.text, sources: a.sources, locked: lockWork ? await lockWork : null });
}

async function handleGroupPick(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { error: 'not signed in' });
  const data = await readJson(req, res);
  if (!data) return;
  const turn = groupState(s).turns.get(data.qid);
  if (!turn || !group.MEMBERS.includes(data.member) || !turn.answers[data.member]) return sendJson(res, 400, { error: 'That answer is not here.' });
  if (turn.locked) return sendJson(res, 409, { error: 'That pick is locked.' });
  turn.pick = data.member; // can switch freely until the next question
  sendJson(res, 200, { ok: true, qid: turn.qid, member: turn.pick });
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
  const result = await briefing.todays({ book, today, todayLabel: dateLabel(today), key, ask: (m, o) => askMeta(m, key, o), force });
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
    text: result.text, items: result.items, stub: !!result.stub
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
    book.settings = Object.assign(settings.settingsOf(book), changes);
    writeNotebooks(all);
  }
  sendJson(res, 200, { settings: settings.settingsOf(book), profile: book.profile, vaultReady: !!vault.key() });
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
  s.history = []; s.pending = null; s.turns = new Map(); s.group = null;
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
  sendJson(res, 200, { facts: memory.newestFirst(book.facts) });
}

function serveFile(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const fail = () => { if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' }); };
  if (req.url === '/api/chat' && req.method === 'POST') return handleChat(req, res).catch(fail);
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
  if (req.url === '/api/loops' && req.method === 'GET') return handleLoops(req, res, 'list').catch(fail);
  if (req.url === '/api/group/answer' && req.method === 'POST') return handleGroupAnswer(req, res).catch(fail);
  if (req.url === '/api/group/pick' && req.method === 'POST') return handleGroupPick(req, res).catch(fail);
  if (req.url === '/api/profile/bots' && req.method === 'POST') return handleBotNames(req, res).catch(fail);
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

server.listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('SIM SIM is running at ' + url);
  console.log(process.env.META_API_KEY ? 'Brain: Meta Model API (' + META_MODEL + ')' : 'Brain: NOT connected (no META_API_KEY) - replies are the stub sentence');
  if (TEST_MODE) console.log('*** TEST MODE ON - no sign-in: every visitor is local-test-user. Remove SIMSIM_TEST_MODE=1 from .env to turn it off. ***');
  if (TEST_MODE && DEV_DOOR) console.log('(SIMSIM_DEV_DOOR=1 is ignored while test mode is on.)');
  if (DEV_DOOR && !TEST_MODE) console.log('*** DEV DOOR ON - type any email to enter, no verification. Remove SIMSIM_DEV_DOOR=1 from .env to turn it off. ***');
  else if (!TEST_MODE) console.log(process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? 'Sign-in: Firebase email link' : 'Sign-in: NOT set up (no FIREBASE_SERVICE_ACCOUNT_PATH)');
  console.log('Press Ctrl+C to stop.');
  if (!process.argv.includes('--no-open')) openChrome(url);
});
