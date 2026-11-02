// SIM SIM — the Website Lane (founder, 2026-10-31): Sim Sim hands over a REAL web page, the way Muse and Claude do —
// sibling of the Document Lane. ONE brain call returns a complete, self-contained HTML page (no external URLs for
// anything); this file validates it, saves it, and serves it only to its owner. No new packages, no printing step —
// the page IS the file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'data', 'websites');
const NAME_OK = /^[a-z0-9-]{1,60}-[a-f0-9]{8}\.html$/;

// Fires ONLY on an explicit "make me a website" ask — never on a code-help ask ("write me the HTML for a contact
// form", "show me code for a navbar": no CREATE word here, so they fall through untouched) and never when a picture
// word is anywhere in the message ("make a picture of a website" stays the picture lane).
const CREATE = 'make|build|create|design|put together|set up|whip up|spin up|code up|develop';
const WEBSITE_WORD = 'websites?|web ?pages?|landing pages?|home ?pages?';
const WEBSITE_ASK = new RegExp('\\b(?:' + CREATE + ')\\b[^.?!]{0,80}\\b(?:' + WEBSITE_WORD + ')\\b', 'i');
const PIC_WORD = /\b(?:pictures?|images?|photos?|drawings?|paintings?|illustrations?|artwork|art|pics?|portraits?)\b/i;
const NOT_A_WEBSITE = /\b(?:what is|what's|how do i|how does|how to|why)\b[^.?!]*\bweb\s?pages?\b|\b(?:what is|what's|how do i|how does|how to|why)\b[^.?!]*\bwebsites?\b/i;
function wantsWebsite(message) {
  const t = String(message || '');
  return WEBSITE_ASK.test(t) && !PIC_WORD.test(t) && !NOT_A_WEBSITE.test(t);
}

// What the brain is asked for: ONLY the finished page, nothing else.
const WRITE_RULES = '\n\nYOU ARE WRITING A REAL, WORKING WEBSITE PAGE the user will open and use — not a description or a picture of one.' +
  ' Reply with ONLY the finished page: no explanation before or after it, no markdown fences.' +
  '\n- Start the reply with <!doctype html>. ONE file: all CSS inside a single <style> tag, all JavaScript inside a single <script> tag.' +
  '\n- SELF-CONTAINED: no external URLs for stylesheets, scripts, fonts, or images — it must work fully offline, opened alone. Build every' +
  ' visual with CSS, inline SVG, and emoji only — never an <img> or any url() pointing at the web.' +
  '\n- Write real content for what the user asked for (the business or topic they named, from the conversation). Where the ask implies it,' +
  ' include at least one WORKING interactive element — a tab that switches, a button that does something, a small form with a confirmation' +
  ' message — a real page, not a poster.' +
  '\n- Include <title>a short name for the site</title> and <meta name="description" content="one short sentence saying what the page holds">.';

// Validates and extracts { title, description, html } from the brain's raw reply, or null when it is not a real page.
// Robust to a stray ```html fence or a sentence of commentary around it; the saved file is the page itself, never that.
function parsePage(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim();
  if (!t) return null;
  const fence = t.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```$/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!doctype\b|<html\b/i);
  if (start < 0) return null;
  const closeAt = t.toLowerCase().lastIndexOf('</html>');
  if (closeAt < start) return null;
  const html = t.slice(start, closeAt + '</html>'.length).trim();
  if (!html) return null;
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleM ? titleM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  if (!title) {
    const hM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    title = hM ? hM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  }
  const descM = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  const description = descM ? descM[1].replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  return { title: (title || 'Website').slice(0, 120), description, html };
}

function dirOf(uid) { return path.join(ROOT, String(uid).replace(/[^\w.@-]/g, '_')); }

// Saves the page. Returns { name, bytes } ONLY after the file exists on disk with non-zero size; else throws.
function savePage(uid, title, html) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'website';
  const name = slug + '-' + crypto.randomBytes(4).toString('hex') + '.html';
  const dir = dirOf(uid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), html, 'utf8');
  const bytes = fs.statSync(path.join(dir, name)).size;
  if (!bytes) throw new Error('the page came out empty');
  return { name, bytes };
}

// The owner's file, or null (a bad name, or another user's file, is simply not found).
function fileFor(uid, name) {
  if (typeof name !== 'string' || !NAME_OK.test(name)) return null;
  const p = path.join(dirOf(uid), name);
  return fs.existsSync(p) ? p : null;
}

function removeAll(uid) { fs.rmSync(dirOf(uid), { recursive: true, force: true }); }

module.exports = { wantsWebsite, WRITE_RULES, parsePage, savePage, fileFor, removeAll };
