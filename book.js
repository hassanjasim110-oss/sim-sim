// SIM SIM — THE BOOK: the world's facts from official sources (the notebook is the user's life; the lanes never mix).
// Lives in the `sources` folder as one Markdown file per topic:
//   front matter (id, title, about) · BASELINE (general rule) · DIFFERENCES (one row per state, each with URL + fetch date)
//   · SOURCE PAGES (saved official page text, each headed with its URL + fetch date)
// Plain code only: reading, saving, and checking that a page is official. The brain reads what this returns.
const fs = require('fs');
const path = require('path');

const SOURCES_DIR = path.join(__dirname, 'sources');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// ---- Is this an official page? Government and agency sites, or the named company's own site. ----
function hostOf(url) {
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : null; } catch (e) { return null; }
}
function isGovHost(host) {
  // .gov / .mil (federal, state, county, city), and the official state & local .us domains (e.g. state.tn.us, co.rutherford.tn.us)
  return /(^|\.)(gov|mil)$/.test(host) || /(^|\.)(state|co|ci|city|county|town|k12)\.[a-z]{2}\.us$/.test(host) || /\.[a-z]{2}\.us$/.test(host) && /(^|\.)(state|co|ci|city|county|town)\./.test(host);
}
// companyDomain: e.g. "amazon.com" when the question is about Amazon — then only amazon.com (and its subdomains) count.
function isOfficialUrl(url, companyDomain) {
  const host = hostOf(url);
  if (!host) return false;
  if (isGovHost(host)) return true;
  if (companyDomain) {
    const d = String(companyDomain).toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && (host === d || host.endsWith('.' + d));
  }
  return false;
}

// ---- Web page -> clean readable text (headings, lists and paragraphs kept) ----
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&sect;/g, '§').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
}
function htmlToText(html) {
  let h = String(html);
  const title = decodeEntities(((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim());
  const main = h.match(/<main[\s\S]*?<\/main>/i) || h.match(/<article[\s\S]*?<\/article>/i);
  if (main) h = main[0];
  h = h.replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<h([1-6])\b[^>]*>/gi, (m, n) => '\n\n' + '#'.repeat(Math.min(+n + 3, 6)) + ' ') // page headings start at ####, below the Book's own ## and ###
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|ul|ol|table|tr|blockquote)>/gi, '\n')
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(h).split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}

// Fetches an official page (refuses anything not official). Returns { url, title, text, fetched }.
async function fetchOfficialPage(url, companyDomain) {
  if (!isOfficialUrl(url, companyDomain)) throw new Error('not an official site');
  const get = () => fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  let r;
  try { r = await get(); } catch (e) { r = await get(); } // some government sites drop connections now and then: one retry
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (!isOfficialUrl(r.url || url, companyDomain)) throw new Error('redirected off the official site');
  if (!/html|text\/plain/i.test(r.headers.get('content-type') || '')) throw new Error('not a web page');
  const { title, text } = htmlToText(await r.text());
  if (text.length < 200) throw new Error('page had almost no text');
  return { url: r.url || url, title, text: text.slice(0, 60000), fetched: new Date().toISOString().slice(0, 10) };
}

// ---- Topic files ----
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'topic'; }

// Reads one topic file into parts. Rows: [{ state, cells: {...}, url, fetched }]; pages: [{ name, url, fetched, text }].
function parseTopic(md, file) {
  const fm = (md.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const meta = {};
  fm.split('\n').forEach(l => { const m = l.match(/^(\w+):\s*(.*)$/); if (m) meta[m[1]] = m[2].trim(); });
  const section = name => { const m = md.match(new RegExp('\\n## ' + name + '[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)')); return m ? m[1].trim() : ''; };
  const baseline = section('BASELINE');
  const rows = [];
  const table = section('DIFFERENCES').split('\n').filter(l => l.trim().startsWith('|'));
  if (table.length > 2) {
    const head = table[0].split('|').slice(1, -1).map(c => c.trim().toLowerCase());
    for (const line of table.slice(2)) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      const row = {};
      head.forEach((h, i) => { row[h] = cells[i] || ''; });
      if (row.state) rows.push({ state: row.state, cells: row, url: row['source url'] || '', fetched: row['fetched'] || '' });
    }
  }
  const pages = [];
  const pageRe = /\n### SOURCE PAGE: ([^\n]*)\nURL: ([^\n]*)\nFetched: ([^\n]*)\n(?:State: ([^\n]*)\n)?\n([\s\S]*?)(?=\n### SOURCE PAGE: |\n## |$)/g;
  let m;
  while ((m = pageRe.exec(md))) pages.push({ name: m[1].trim(), url: m[2].trim(), fetched: m[3].trim(), state: (m[4] || '').trim(), text: m[5].trim() });
  return { id: meta.id || path.basename(file, '.md'), title: meta.title || '', about: meta.about || '', file, baseline, rows, pages };
}

function listTopics() {
  let files = [];
  try { files = fs.readdirSync(SOURCES_DIR).filter(f => f.endsWith('.md')); } catch (e) {}
  return files.map(f => parseTopic(fs.readFileSync(path.join(SOURCES_DIR, f), 'utf8'), path.join(SOURCES_DIR, f))).filter(t => t.about);
}
function getTopic(id) { return listTopics().find(t => t.id === id) || null; }

// Saves a page found online (Book miss) as its own small topic file, so the next ask is instant.
function savePageTopic({ about, page, sourceName, state }) {
  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  let id = slug(about), n = 2;
  while (fs.existsSync(path.join(SOURCES_DIR, id + '.md'))) id = slug(about) + '-' + n++;
  const md = '---\nid: ' + id + '\ntitle: ' + sourceName + '\nabout: ' + about.replace(/\n/g, ' ') + '\n---\n\n' +
    '# ' + about + '\n\nSaved automatically when this was asked and the Book had no answer. Official page only.\n\n' +
    '## SOURCE PAGES\n\n### SOURCE PAGE: ' + sourceName + '\nURL: ' + page.url + '\nFetched: ' + page.fetched + '\n' +
    (state ? 'State: ' + state + '\n' : '') + '\n' + page.text + '\n';
  fs.writeFileSync(path.join(SOURCES_DIR, id + '.md'), md);
  return id;
}

module.exports = { SOURCES_DIR, isOfficialUrl, htmlToText, fetchOfficialPage, parseTopic, listTopics, getTopic, savePageTopic };
