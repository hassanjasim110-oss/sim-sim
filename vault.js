// SIM SIM Saved logins (the vault). Each entry is encrypted with AES-256-GCM using VAULT_KEY from .env (base64, 32 bytes).
// The whole entry (site, username, password) is one encrypted blob, tied to its owner and id, so the file has nothing readable.
// HARD RULES: vault data never enters the notebook or memory, is never sent to the brain, and passwords never appear in
// a list response, a log line or an error message. Demo scope: store + show + delete. No auto sign-in.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'vault.json');

// The key, or null when VAULT_KEY is missing or not 32 bytes (then the vault answers "vault not set up").
function key() {
  const raw = (process.env.VAULT_KEY || '').trim();
  if (!raw) return null;
  const k = Buffer.from(raw, 'base64');
  return k.length === 32 ? k : null;
}

function readAll() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; } }
function writeAll(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}

// The owner and entry id are bound into the encryption (AAD): an entry can't be moved to another user and still open.
function seal(k, uid, id, entry) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  c.setAAD(Buffer.from(uid + '|' + id));
  const ct = Buffer.concat([c.update(JSON.stringify(entry), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function open(k, uid, rec) {
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(rec.iv, 'base64'));
  d.setAAD(Buffer.from(uid + '|' + rec.id));
  d.setAuthTag(Buffer.from(rec.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(rec.ct, 'base64')), d.final()]).toString('utf8'));
}

// Site + username only — never the password.
function list(uid) {
  const k = key();
  if (!k) return null;
  return (readAll()[uid] || []).map(rec => {
    try { const e = open(k, uid, rec); return { id: rec.id, site: e.site, username: e.username, createdAt: rec.createdAt }; }
    catch (err) { return { id: rec.id, site: '(cannot be opened with the current VAULT_KEY)', username: '', createdAt: rec.createdAt, locked: true }; }
  });
}

function add(uid, site, username, password) {
  const k = key();
  if (!k) return null;
  const id = 'v_' + crypto.randomBytes(8).toString('hex');
  const all = readAll();
  (all[uid] = all[uid] || []).push(Object.assign({ id, createdAt: new Date().toISOString() }, seal(k, uid, id, { site, username, password })));
  writeAll(all);
  return id;
}

// ONE password, for ONE entry (a separate call per reveal). Returns the password, or null.
function reveal(uid, id) {
  const k = key();
  if (!k) return null;
  const rec = (readAll()[uid] || []).find(r => r.id === id);
  if (!rec) return null;
  try { return open(k, uid, rec).password; } catch (e) { return null; }
}

function remove(uid, id) {
  const all = readAll();
  const before = (all[uid] || []).length;
  all[uid] = (all[uid] || []).filter(r => r.id !== id);
  writeAll(all);
  return all[uid].length < before;
}

module.exports = { key, list, add, reveal, remove };
