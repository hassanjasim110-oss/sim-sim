// SIM SIM — the Document Lane (founder, 2026-10-30): Sim Sim makes REAL PDF files, the way Muse makes documents.
// The Meta brain writes the content as structure (title + sections); THIS file turns it into a clean print page — every
// word ESCAPED, never raw HTML — and prints it to PDF with the already-authorized Playwright Chromium (page.pdf, A4).
// Files live in data/documents/<user>/ and are served only to their owner. No PDF library, no new packages.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'data', 'documents');
const NAME_OK = /^[a-z0-9-]{1,60}-[a-f0-9]{8}\.pdf$/;

// Fires ONLY on an explicit file ask ("make a PDF", "as a file", "a document I can download", "PDF file").
// An ordinary list or question stays a normal chat answer.
const FILE_ASK = /\bpdfs?\b|\b(?:as|into|in) an? (?:file|document|doc)\b|\b(?:document|doc|guide|list|file|handout|sheet|checklist)\b[^.?!]{0,40}\b(?:i can |to )?download\b|\bdownload(?:able)? (?:file|document|doc|version|copy)\b|\b(?:make|create|give|turn|put|save|export)\b[^.?!]{0,30}\b(?:a|an|into|as) (?:\w+ ){0,2}(?:file|document)\b/i;
const NOT_A_FILE = /\b(?:what is|what's|how do i (?:open|read|edit|merge|sign|compress)|convert (?:this|my)|read (?:this|my|the)|open (?:this|my|the))\b[^.?!]*\bpdf\b/i;
function wantsDocument(message) {
  const t = String(message || '');
  return FILE_ASK.test(t) && !NOT_A_FILE.test(t);
}

// What the brain is asked for: ONLY JSON, plain text in every field.
const WRITE_RULES = '\n\nYOU ARE WRITING A DOCUMENT THAT WILL BECOME A REAL PDF FILE for the user to download. Write the complete, professional' +
  ' content they asked for (every list they asked for, fully). Reply with ONLY this JSON, nothing else:' +
  '\n{"title": "a short title", "summary": "one or two short sentences telling the user what the document holds",' +
  ' "sections": [{"heading": "a heading", "paragraphs": ["plain sentences"], "bullets": ["an item"], "steps": ["a numbered step"]}]}' +
  '\nUse "bullets" for lists, "steps" for ordered steps, "paragraphs" for prose; leave out what a section does not need.' +
  ' Plain text in every field: no markdown — no #, no **, no backticks, no leading "- " or "1.".';

function parseDoc(raw) {
  if (typeof raw !== 'string') return null;
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let d;
  try { d = JSON.parse(raw.slice(a, b + 1)); } catch (e) { return null; }
  // belt and braces: any markdown the brain slipped in is removed, so no "##" or "**" ever reaches the PDF
  const clean = s => String(s == null ? '' : s).replace(/\*\*([^*]*)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*#{1,6}\s*/, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\*/g, '').trim();
  const list = v => (Array.isArray(v) ? v : []).map(clean).filter(Boolean).slice(0, 80);
  const sections = (Array.isArray(d.sections) ? d.sections : []).slice(0, 40).map(s => ({
    heading: clean(s && s.heading).slice(0, 160), paragraphs: list(s && s.paragraphs), bullets: list(s && s.bullets), steps: list(s && s.steps)
  })).filter(s => s.heading || s.paragraphs.length || s.bullets.length || s.steps.length);
  const title = clean(d.title).slice(0, 120);
  if (!title || !sections.length) return null;
  return { title, summary: clean(d.summary).slice(0, 400), sections };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function html(doc) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const body = doc.sections.map(s =>
    (s.heading ? '<h2>' + esc(s.heading) + '</h2>' : '') +
    s.paragraphs.map(p => '<p>' + esc(p) + '</p>').join('') +
    (s.bullets.length ? '<ul>' + s.bullets.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>' : '') +
    (s.steps.length ? '<ol>' + s.steps.map(i => '<li>' + esc(i) + '</li>').join('') + '</ol>' : '')
  ).join('\n');
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(doc.title) + '</title><style>' +
    'body{font-family:Georgia,"Times New Roman",serif;font-size:11.5pt;line-height:1.55;color:#1f1d1b;margin:0}' +
    'h1{font-family:"Segoe UI",Arial,sans-serif;font-size:22pt;margin:0 0 4pt;color:#7a2e0e}' +
    '.date{font-family:"Segoe UI",Arial,sans-serif;font-size:9.5pt;color:#7d6a5b;margin:0 0 18pt;padding-bottom:10pt;border-bottom:1.5pt solid #efe2d3}' +
    'h2{font-family:"Segoe UI",Arial,sans-serif;font-size:14pt;margin:18pt 0 6pt;color:#2a211b;break-after:avoid}' +
    'p{margin:0 0 8pt}ul,ol{margin:0 0 10pt;padding-left:20pt}li{margin:0 0 4pt;break-inside:avoid}' +
    '</style></head><body><h1>' + esc(doc.title) + '</h1><p class="date">Made by Sim Sim · ' + esc(today) + '</p>\n' + body + '</body></html>';
}

function dirOf(uid) { return path.join(ROOT, String(uid).replace(/[^\w.@-]/g, '_')); }

// Prints the document to PDF. Returns { name, bytes } ONLY after the file exists on disk with non-zero size; else throws.
async function makePdf(uid, doc) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html(doc), { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '22mm', bottom: '22mm', left: '20mm', right: '20mm' } });
    const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';
    const name = slug + '-' + crypto.randomBytes(4).toString('hex') + '.pdf';
    const dir = dirOf(uid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), pdf);
    const bytes = fs.statSync(path.join(dir, name)).size;
    if (!bytes) throw new Error('the PDF came out empty');
    return { name, bytes };
  } finally { await browser.close().catch(() => {}); }
}

// The owner's file, or null (a bad name, or another user's file, is simply not found).
function fileFor(uid, name) {
  if (typeof name !== 'string' || !NAME_OK.test(name)) return null;
  const p = path.join(dirOf(uid), name);
  return fs.existsSync(p) ? p : null;
}

function removeAll(uid) { fs.rmSync(dirOf(uid), { recursive: true, force: true }); }

module.exports = { wantsDocument, WRITE_RULES, parseDoc, makePdf, fileFor, removeAll };
