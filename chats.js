// SIM SIM Chat history: every 1-on-1 chat thread, saved per user in data/chats.json (survives sign-outs and restarts).
// Keyed by the uid from the verified session, so a user only ever reads their own threads.
// Pictures are never saved — a turn that had one keeps only a "picture shared" marker. Discussion threads are not here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'chats.json');
const TITLE_MAX = 60;
const CONTEXT = 12;   // the last messages loaded back into the conversation context when a thread is opened
const SECRET_NOTE = '[Not saved — this message looked like a password or secret.]';

function readAll() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; } }
function writeAll(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);   // write-then-swap, so a crash never leaves half a file
}

// The thread title is the user's FIRST message, cut at a word near 60 characters.
function titleFrom(message, picture) {
  const t = message.replace(/\s+/g, ' ').trim();
  if (!t) return picture === 'screen' ? 'Screen snapshot' : 'Shared a picture';
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX), sp = cut.lastIndexOf(' ');
  return (sp > 30 ? cut.slice(0, sp) : cut) + '…';
}

// Saves one answered turn into the user's thread. threadId: an id from this user's list, or 'new'.
// user: { message, picture: null | 'picture' | 'screen', secret }; out: the reply the page gets.
// Returns the thread id the turn went into.
function saveTurn(uid, threadId, user, out) {
  const all = readAll(), list = all[uid] = all[uid] || [];
  const now = new Date().toISOString();
  let t = list.find(x => x.id === threadId);
  if (!t) {
    t = { id: crypto.randomBytes(9).toString('base64url'), title: user.secret ? 'Chat' : titleFrom(user.message, user.picture), createdAt: now, updatedAt: now, messages: [] };
    list.push(t);
  }
  const mine = { role: 'user', text: user.secret ? SECRET_NOTE : user.message, at: now };
  if (user.picture) mine.picture = user.picture;
  t.messages.push(mine);
  if (out.guardian) t.messages.push({ role: 'assistant', text: out.guardian, guardian: true, at: now });
  const reply = { role: 'assistant', text: user.secret ? SECRET_NOTE : (out.pictureNote ? out.pictureNote + '\n\n' : '') + out.reply, at: now };
  if (out.image) reply.image = out.image;
  if (out.sources && out.sources.length) reply.sources = out.sources;
  t.messages.push(reply);
  t.updatedAt = now;
  writeAll(all);
  return t.id;
}

// Newest first: id, title and dates only.
function list(uid) {
  return (readAll()[uid] || []).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(t => ({ id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt, count: t.messages.length }));
}

function get(uid, id) { return (readAll()[uid] || []).find(t => t.id === id) || null; }

// The conversation context for continuing a thread: its last messages, words only.
function contextOf(t) {
  return t.messages.filter(m => !m.guardian).slice(-CONTEXT).map(m => ({
    role: m.role,
    content: (m.picture ? (m.picture === 'screen' ? '[shared a screen snapshot] ' : '[shared a picture] ') : '') + m.text
  }));
}

function removeAll(uid) {
  const all = readAll();
  if (!all[uid]) return;
  delete all[uid];
  writeAll(all);
}

module.exports = { saveTurn, list, get, contextOf, removeAll, titleFrom };
