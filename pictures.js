// SIM SIM "Your pictures": a per-user index of the pictures Sim Sim MADE or EDITED (data/pictures.json).
// Written by the make and edit lanes when a picture is created. Uploads are never saved, so they are never here;
// Sim Sim's face pictures live in Settings, not here. Keyed by the uid from the verified session: a user only sees their own.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'pictures.json');
const NAME = /^[\w-]+\.png$/;

function readAll() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; } }
function writeAll(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);   // write-then-swap, so a crash never leaves half a file
}
function mine(all, uid) { return (all[uid] = all[uid] || { backfilled: false, items: [] }); }

// kind: 'made' | 'edited'
function add(uid, name, kind) {
  const all = readAll(), u = mine(all, uid);
  if (!u.items.some(x => x.name === name)) u.items.push({ name, createdAt: new Date().toISOString(), threadId: null, kind });
  writeAll(all);
}
function setThread(uid, name, threadId) {
  const all = readAll(), row = mine(all, uid).items.find(x => x.name === name);
  if (row && !row.threadId) { row.threadId = threadId; writeAll(all); }
}

// Newest first. The first time a user opens the gallery, pictures already in their own folder are indexed too
// (made before this index existed): an "edited" reply in their chats marks an edit; the rest count as made.
// skip(name) -> true for files that are not gallery pictures (e.g. the current face).
function list(uid, imagesDir, threads, skip) {
  const all = readAll(), u = mine(all, uid);
  let changed = false;
  if (!u.backfilled) {
    const fromChats = {};
    threads.forEach(t => t.messages.forEach(m => {
      if (m.image && typeof m.image.url === 'string') fromChats[m.image.url.split('/').pop()] = { threadId: t.id, kind: m.image.subject === 'edited picture' ? 'edited' : 'made' };
    }));
    let files = [];
    try { files = fs.readdirSync(path.join(imagesDir, uid)); } catch (e) {}
    files.filter(f => NAME.test(f) && !f.startsWith('face-') && !skip(f) && !u.items.some(x => x.name === f)).forEach(f => {
      const seen = fromChats[f] || { threadId: null, kind: 'made' };
      u.items.push({ name: f, createdAt: fs.statSync(path.join(imagesDir, uid, f)).mtime.toISOString(), threadId: seen.threadId, kind: seen.kind });
    });
    u.backfilled = true;
    changed = true;
  }
  const before = u.items.length;   // a file that is gone leaves the index too
  u.items = u.items.filter(x => fs.existsSync(path.join(imagesDir, uid, x.name)));
  if (changed || u.items.length !== before) writeAll(all);
  return u.items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Removes the file and its row — only from THIS user's index and folder.
function remove(uid, imagesDir, name) {
  if (!NAME.test(name)) return false;
  const all = readAll(), u = mine(all, uid), i = u.items.findIndex(x => x.name === name);
  if (i < 0) return false;
  u.items.splice(i, 1);
  writeAll(all);
  try { fs.unlinkSync(path.join(imagesDir, uid, name)); } catch (e) {}
  return true;
}

function removeAll(uid) {
  const all = readAll();
  if (!all[uid]) return;
  delete all[uid];
  writeAll(all);
}

module.exports = { add, setThread, list, remove, removeAll };
