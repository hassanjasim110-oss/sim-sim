// SIM SIM saved 1-on-1 chats: every thread, saved per user in data/chats.json (survives sign-outs and restarts).
// Keyed by the uid from the verified session, so a user only ever reads their own threads.
// Pictures are never saved — a turn that had one keeps only a "picture shared" marker. Discussion threads are not here.
// Each thread has a kind (founder, 2026-10-29 — the Muse pattern): 'main' = THE Chat (one per user), 'side' = a side chat
// the user made (listed under "Side chats"). What Sim Sim remembers (the notebook) is per user, shared by all of them.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'chats.json');
const TITLE_MAX = 60;
const CONTEXT = 12;   // the last messages loaded back into the conversation context when a thread is opened
const SECRET_NOTE = '[Not saved — this message looked like a password or secret.]';
const UNNAMED = 'New side chat';   // a side chat made with "Skip": named from its first message

// Threads saved before side chats existed have no kind. The first time they are read: the most recent one stays the
// main Chat, every other one becomes a side chat — nothing is lost or renamed. (A user's threads only ever gain a kind.)
function ensureKinds(list) {
  const missing = list.filter(t => !t.kind);
  if (!missing.length) return false;
  missing.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const hasMain = list.some(t => t.kind === 'main');
  missing.forEach((t, i) => { t.kind = i === 0 && !hasMain ? 'main' : 'side'; });
  return true;
}
function readAll() {
  let all;
  try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
  let changed = false;
  for (const uid in all) if (Array.isArray(all[uid]) && ensureKinds(all[uid])) changed = true;
  if (changed) writeAll(all);   // the migration is saved once
  return all;
}
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

// Rename by asking (founder, 2026-10-29): "name it Rasputin", "rename this chat to Trip plans", "call this chat X",
// "change this chat's name to X". The WHOLE message must be the instruction (after "Sim Sim," / "please" / "can you").
// Returns { title } (exactly as typed), { tooLong: true }, { title: null } when the rename VERB matched but no name
// followed ("rename this chat") — the caller asks what to call it, in code, rather than sending it to the brain — or
// plain null when the message isn't a rename ask at all (founder, 2026-11-01: a nameless rename ask used to fall through
// to the brain's action tools, which sometimes hung or guessed instead of asking; it never reaches the brain now).
const RENAME_OPEN = /^(?:(?:hey|hi|ok|okay)\s+)?(?:sim[\s-]?sim\s*[,!.:]?\s*)?(?:(?:please|pls|kindly|can you|could you|would you|will you)\s+)*/i;
const THIS_CHAT = '(?:this|the|our) (?:chat|thread|conversation)';
const RENAME_VERB = new RegExp('^(?:' + [
  'name (?:it|' + THIS_CHAT + ')',
  're-?name (?:' + THIS_CHAT + '|it|this)',   // "this chat" before plain "this"
  'call ' + THIS_CHAT,
  '(?:change|set) ' + THIS_CHAT + '(?:\'s|’s)? (?:name|title)',
  '(?:change|set) the (?:name|title) of ' + THIS_CHAT
].join('|') + ')(?=[\\s:,.!?"\'“‘]|$)\\s*[:,]?\\s*(?:(?:to|as)\\b\\s*)?', 'i');
function renameRequest(message) {
  const t = String(message || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  const rest = t.replace(RENAME_OPEN, '');
  const m = rest.match(RENAME_VERB);
  if (!m) return null;
  const name = rest.slice(m[0].length)
    .replace(/[\s,]*\bplease\b[\s.!?]*$/i, '')     // "… please"
    .replace(/[\s.!?]+$/, '')                      // end punctuation
    .replace(/^["'“‘](.*)["'”’]$/, '$1')           // 'quoted' or "quoted"
    .trim();
  if (!name) return { title: null };   // the verb matched ("rename this chat") but no name followed
  if (name.length > TITLE_MAX) return { tooLong: true };
  return { title: name };
}

// "Make a side chat" by asking (founder, 2026-10-31): "lets make an side chat for this", "make me a side chat for my
// shredded plan", "create a side chat about homework", "start a side chat". The WHOLE message must be the ask.
// Returns null, or { topic } — topic: the name words ("Shredded plan"), '' for none / "for this", or tooLong.
const SIDE_ASK = new RegExp('^(?:(?:let\'?s|let us|i want to|i\'d like to|i would like to|we should|go ahead and)\\s+)?' +
  '(?:make|create|start|open|begin|add|set up|spin up|new)(?:\\s+(?:me|us))?\\s+(?:a|an|another|one|new|a new)?\\s*side[\\s-]?chat' +
  '(?:\\s+(?:for|about|on|called|named)\\b\\s*(.*))?$', 'i');
const THIS_ONE = /^(?:this|it|that|this (?:one|chat|thread|conversation|topic)|what we(?:'re| are) (?:talking|doing)(?: about)?)$/i;
function sideChatRequest(message) {
  const t = String(message || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(RENAME_OPEN, '').replace(/[\s,]*\bplease\b[\s.!?]*$/i, '').replace(/[\s.!?]+$/, '');
  const m = t.match(SIDE_ASK);
  if (!m) return null;
  let topic = (m[1] || '').replace(/^["'“‘](.*)["'”’]$/, '$1').trim();
  if (THIS_ONE.test(topic)) topic = '';
  topic = topic.replace(/^(?:my|the|our)\s+/i, '');
  if (topic.length > TITLE_MAX) return { tooLong: true };
  return { topic: topic ? topic[0].toUpperCase() + topic.slice(1) : '' };
}
// Does the named topic point at THIS conversation? Yes when one of its real words (not a generic one like "plan") was
// already said in the thread — "my shredded plan" while talking about a shredded plan. Plain code, never the brain.
const GENERIC = new Set(['plan', 'plans', 'chat', 'chats', 'side', 'stuff', 'things', 'thing', 'ideas', 'idea', 'notes', 'note',
  'project', 'topic', 'conversation', 'this', 'that', 'with', 'about', 'some', 'more', 'other', 'another', 'new', 'list']);
function topicInThread(t, topic) {
  const text = t.messages.map(m => typeof m.text === 'string' && m.text !== SECRET_NOTE ? m.text : '').join(' ').toLowerCase();
  return topic.toLowerCase().split(/[^a-z0-9']+/).filter(w => w.length >= 4 && !GENERIC.has(w))
    .some(w => new RegExp('\\b' + (w.length > 5 ? w.slice(0, 5) : w)).test(text));
}
// The conversation itself becomes a side chat (nothing copied): the Chat row then starts a fresh main thread.
function toSide(uid, id, title) {
  return update(uid, id, t => { t.kind = 'side'; if (title) { t.title = title; t.titleSet = true; } });
}

// Every message has a stable id (for reactions and delete). Older messages get one the first time their thread is read.
const newId = () => crypto.randomBytes(6).toString('base64url');
function ensureIds(t) {
  let added = false;
  t.messages.forEach(m => { if (!m.id) { m.id = newId(); added = true; } });
  return added;
}

// Saves one answered turn into the user's thread. threadId: an id from this user's list, or 'new'.
// user: { message, picture: null | 'picture' | 'screen', secret, quote: null | { who, text } }; out: the reply the page gets
// (out.retitle: the chat was renamed by asking — the name sticks, like a Chat history rename).
// Returns { threadId, messageIds: { user, reply } }.
function saveTurn(uid, threadId, user, out) {
  const all = readAll(), list = all[uid] = all[uid] || [];
  const now = new Date().toISOString();
  let t = list.find(x => x.id === threadId);
  if (!t) {
    // 'new' from the Chat (after "New chat"): a fresh MAIN thread. The previous main conversation stays, as a side chat.
    list.forEach(x => { if (x.kind === 'main') x.kind = 'side'; });
    t = { id: crypto.randomBytes(9).toString('base64url'), kind: 'main', title: user.secret ? 'Chat' : titleFrom(user.message, user.picture), createdAt: now, updatedAt: now, messages: [] };
    list.push(t);
  } else if (!t.titleSet && !t.messages.length) {
    t.title = user.secret ? 'Chat' : titleFrom(user.message, user.picture);   // a side chat made with "Skip": its first message names it
  }
  ensureIds(t);
  if (out.retitle && !user.secret) { t.title = out.retitle; t.titleSet = true; }
  const mine = { id: newId(), role: 'user', text: user.secret ? SECRET_NOTE : user.message, at: now };
  if (user.picture) mine.picture = user.picture;
  if (user.quote && !user.secret) mine.quote = user.quote;   // Reply: display only, never restored as context
  if (user.voice) mine.voice = { name: user.voice.name, transcript: !!user.voice.transcript };   // the audio is a file, referenced here
  if (out.aboutReceipt) mine.aboutReceipt = true;   // "how long did that take?" — display only, never restored as context
  t.messages.push(mine);
  if (out.guardian) t.messages.push({ id: newId(), role: 'assistant', text: out.guardian, guardian: true, at: now });
  const reply = { id: newId(), role: 'assistant', text: user.secret ? SECRET_NOTE : (out.pictureNote ? out.pictureNote + '\n\n' : '') + out.reply, at: now };
  if (out.image) reply.image = out.image;
  if (out.sources && out.sources.length) reply.sources = out.sources;
  if (out.browser) reply.browser = true;
  if (out.document) reply.document = out.document;   // its card (title, size, the owner-only download address)              // its links are pages Sim Sim's own browser read (they open there)
  if (out.website) reply.website = out.website;     // its card (title, size, the owner-only address) — a real, working HTML page
  if (out.receipt) reply.receipt = out.receipt;     // "How I answered": display only, never restored as context
  if (out.aboutReceipt) reply.aboutReceipt = true;
  t.messages.push(reply);
  t.updatedAt = now;
  writeAll(all);
  return { threadId: t.id, messageIds: { user: mine.id, reply: reply.id } };
}

// The Action Layer: Sim Sim's answer after the user tapped Allow / Not now on an allowance card — one assistant message
// appended to the thread the card was in. Returns its id, or null if that thread is gone.
function addReply(uid, threadId, text, receipt) {
  const t = update(uid, threadId, t => {
    const m = { id: newId(), role: 'assistant', text, at: new Date().toISOString() };
    if (receipt) m.receipt = receipt;
    t.messages.push(m);
    t.updatedAt = m.at;
  });
  return t ? t.messages[t.messages.length - 1].id : null;
}

// The user's main Chat thread — creates an empty one if there isn't one yet (founder, 2026-11-01: a Discussion pick
// writes back into THIS thread even for a user who has never sent a 1-on-1 message).
function mainThread(uid) {
  const all = readAll(), list = all[uid] = all[uid] || [];
  let t = list.find(x => x.kind === 'main');
  if (!t) {
    const now = new Date().toISOString();
    t = { id: crypto.randomBytes(9).toString('base64url'), kind: 'main', title: 'Chat', createdAt: now, updatedAt: now, messages: [] };
    list.push(t);
    writeAll(all);
  }
  return t;
}
// A Discussion pick, written into the main chat as a reply from that bot (founder, 2026-11-01 — "Discussion picks:
// make picking real"). Marked `discussionPick` so the page can show whose answer it was and label it as the pick.
function addDiscussionPick(uid, threadId, text, name) {
  const t = update(uid, threadId, t => {
    const m = { id: newId(), role: 'assistant', text, at: new Date().toISOString(), discussionPick: { name } };
    t.messages.push(m);
    t.updatedAt = m.at;
  });
  return t ? t.messages[t.messages.length - 1].id : null;
}
// Removes one assistant-role reply by id — used only when the user switches their Discussion pick to a different
// answer for the same question: the old write-back is removed first, so a question is never written back twice.
function removeReply(uid, threadId, messageId) {
  return !!update(uid, threadId, t => {
    const i = t.messages.findIndex(x => x.id === messageId && x.role === 'assistant');
    if (i < 0) return false;
    t.messages.splice(i, 1);
  });
}

// `named` = the user gave this chat its name (typed at creation or renamed later); an auto-title from the first
// message does NOT count. ONE place computes it — every endpoint that hands a FULL thread to the page for
// display (new, open, the Action Layer's openThread effect…) decorates it with this, so the sidebar's idea of
// "named" is never stale (founder, 2026-10-31 correction: handleChatNew/handleChatOpen sent the raw thread
// without it, so a side chat named at creation — or by the in-chat "make a side chat" command — needed a full
// page reload before the sidebar would show it).
function withNamed(t) {
  return t && Object.assign({}, t, { named: t.titleSet === true });
}

// Newest first: id, kind, title and dates only. The page lists only named side chats (founder, 2026-10-31);
// unnamed threads stay stored and searchable — they are simply not listed.
function list(uid) {
  return (readAll()[uid] || []).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(t => ({ id: t.id, kind: t.kind, title: t.title, named: t.titleSet === true, createdAt: t.createdAt, updatedAt: t.updatedAt, count: t.messages.length }));
}

// Global search (founder, 2026-10-30): ONLY this user's threads — titles and message text. Newest first, up to 30 hits:
// { threadId, title, kind, messageId?, snippet, at }. A "not saved" secret note is never matched.
function search(uid, query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (q.length < 2) return [];
  const snip = (text, i) => {
    const a = Math.max(0, i - 50), b = Math.min(text.length, i + q.length + 70);
    return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : '');
  };
  const hits = [];
  for (const t of (readAll()[uid] || [])) {
    const ti = t.title.toLowerCase().indexOf(q);
    if (ti >= 0) hits.push({ threadId: t.id, title: t.title, kind: t.kind, snippet: t.title, at: t.updatedAt });
    for (const m of t.messages) {
      if (typeof m.text !== 'string' || m.text === SECRET_NOTE) continue;
      const i = m.text.toLowerCase().indexOf(q);
      if (i >= 0) hits.push({ threadId: t.id, title: t.title, kind: t.kind, messageId: m.id, snippet: snip(m.text, i), at: m.at || t.updatedAt, who: m.role === 'user' ? 'You' : 'Sim Sim' });
    }
  }
  return hits.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 30);
}

// "+" under Side chats: a new, empty side chat. A typed name sticks; no name -> its first message names it.
function createSide(uid, title) {
  const all = readAll(), list = all[uid] = all[uid] || [];
  const now = new Date().toISOString();
  const t = { id: crypto.randomBytes(9).toString('base64url'), kind: 'side', title: title || UNNAMED, createdAt: now, updatedAt: now, messages: [] };
  if (title) t.titleSet = true;
  list.push(t);
  writeAll(all);
  return t;
}

function get(uid, id) {
  const all = readAll(), t = (all[uid] || []).find(x => x.id === id) || null;
  if (t && ensureIds(t)) writeAll(all);
  return t;
}

// Runs change(thread) on one of THIS user's threads and saves it. Returns the thread, or null if it isn't theirs.
function update(uid, id, change) {
  const all = readAll(), t = (all[uid] || []).find(x => x.id === id);
  if (!t) return null;
  ensureIds(t);
  if (change(t) === false) return null;
  writeAll(all);
  return t;
}

// ONE reaction per message (emoji, or null to remove). Display only: never part of the context, the notebook or learning.
const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
function react(uid, threadId, messageId, emoji) {
  return update(uid, threadId, t => {
    const m = t.messages.find(x => x.id === messageId);
    if (!m) return false;
    if (emoji) m.reaction = emoji; else delete m.reaction;
  });
}

// Deletes one of the USER's own messages. The answer to it stays on screen but leaves the context too
// (it may repeat the deleted words), so after a delete Sim Sim has no knowledge of the deleted text.
function deleteMessage(uid, threadId, messageId) {
  let deleted = null;
  const t = update(uid, threadId, t => {
    const i = t.messages.findIndex(x => x.id === messageId && x.role === 'user');
    if (i < 0) return false;
    deleted = t.messages.splice(i, 1)[0];
    for (let j = i; j < t.messages.length && t.messages[j].role !== 'user'; j++) t.messages[j].afterDeleted = true;
    // an auto-title made from the deleted words goes too (a title the user typed stays)
    if (!t.titleSet && t.title === titleFrom(deleted.text, deleted.picture)) {
      const next = t.messages.find(m => m.role === 'user' && m.text !== SECRET_NOTE);
      t.title = next ? titleFrom(next.text, next.picture) : 'Chat';
    }
  });
  return t ? { thread: t, deleted } : null;
}

// A title the user typed sticks: the auto-title (first message) only ever names a NEW thread.
function rename(uid, id, title) {
  return update(uid, id, t => { t.title = title; t.titleSet = true; });
}

function remove(uid, id) {
  const all = readAll(), list = all[uid] || [], i = list.findIndex(x => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  writeAll(all);
  return true;
}

// The conversation context for continuing a thread: its last messages, words only.
// Never in it: guardian lines, receipt questions, answers to deleted messages, reactions, Reply quotes.
function contextOf(t) {
  return t.messages.filter(m => !m.guardian && !m.aboutReceipt && !m.afterDeleted).slice(-CONTEXT).map(m => ({
    role: m.role,
    content: (m.picture ? (m.picture === 'screen' ? '[shared a screen snapshot] ' : '[shared a picture] ') : m.voice ? '[voice note] ' : '') +
      (m.image ? '[Sim Sim drew this picture and it is showing in this chat.] ' : '') + m.text +
      (m.document ? ' [Sim Sim made a PDF document: "' + m.document.title + '".]' : '') +
      (m.website ? ' [Sim Sim made a website: "' + m.website.title + '" and it is showing in this chat.]' : '')
  }));
}

// Plain-text export (founder, 2026-11-01 — "Journeys pack"): the whole conversation, in order, as a downloadable
// .txt — never the notebook, never the brain's context. A Discussion-pick write-back (discussionPick.name) is
// labeled with that bot's own name, not "Sim Sim" — the one place an export needs more than two names.
function exportText(uid, id) {
  const t = get(uid, id);
  if (!t) return null;
  const title = t.kind === 'main' ? 'Main chat' : t.title;
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const lines = t.messages.map(m => (m.role === 'user' ? 'You' : (m.discussionPick && m.discussionPick.name) || 'Sim Sim') + ': ' + m.text);
  return { title, text: title + '\n' + date + '\n\n' + lines.join('\n\n') };
}

function removeAll(uid) {
  const all = readAll();
  if (!all[uid]) return;
  delete all[uid];
  writeAll(all);
}

module.exports = { saveTurn, list, get, contextOf, removeAll, titleFrom, react, deleteMessage, rename, remove, renameRequest, createSide, sideChatRequest, topicInThread, toSide, addReply, mainThread, addDiscussionPick, removeReply, search, exportText, REACTIONS, TITLE_MAX, withNamed };
