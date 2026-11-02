// SIM SIM's browser — Part 1 of 4: EYES (founder, 2026-10-29: "exact like it works on Muse").
// A real Chromium (Playwright) that lives INSIDE Sim Sim (founder, 2026-10-30): it runs without a window of its own on the
// desktop, and the Browser panel in the app IS its screen (live screenshot, address, tabs, log). It is a separate
// instance with its own profile folder per user (data/browser/<user>/: that user's cookies only) — it never opens, reads
// or touches the user's own Chrome or its profile. The Meta brain drives it through READ-ONLY tools — search, open,
// read, screenshot, tabs, back/forward/reload. There is no click, type or submit in Part 1, and downloads are off.
// Only http/https pages ever open. The brain stays Meta-only: this file never calls any AI; server.js hands it `ask`.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'data', 'browser');
const MAX_STEPS = 25;                 // browser actions per task
const MAX_TASK_MS = 4 * 60 * 1000;    // a task finishes with what it has after 4 minutes
const READ_MAX = 12000;               // characters of page text handed to the brain per read
const NAV_TIMEOUT = 25000;
const LOG_MAX = 60;

let engine = null;   // loaded on first use, so the app starts even before Playwright is installed
function chromium() { if (!engine) engine = require('playwright').chromium; return engine; }

// "example.com/x" -> "https://example.com/x". Anything that isn't http(s) is refused (file:, chrome:, javascript: …).
function safeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch (e) { return null; }
}
function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- One user's browser ----
const users = new Map();   // uid -> Session
class Session {
  constructor(uid) {
    this.uid = uid;
    this.dir = path.join(ROOT, String(uid).replace(/[^\w.@-]/g, '_'));
    this.ctx = null; this.starting = null;
    this.pages = []; this.current = 0;
    this.log = []; this.seq = 0;
    this.task = null;                 // { id, running, stopped, stopWaiters }
    this.shot = null; this.shotAt = 0;
  }
  async ensure() {
    if (this.ctx) return;
    if (!this.starting) this.starting = (async () => {
      fs.mkdirSync(this.dir, { recursive: true });
      // A window from an earlier run of Sim Sim still holds this profile (Chromium keeps it locked): a second one
      // would just hand over to it and close. Say so plainly instead.
      try { const fd = fs.openSync(path.join(this.dir, 'lockfile'), 'r+'); fs.closeSync(fd); }
      catch (e) { if (e.code === 'EBUSY' || e.code === 'EPERM') throw new Error('PROFILE_IN_USE'); }
      // headless: no desktop window (it showed up next to the user's own Chrome and looked like it). channel 'chromium':
      // Playwright's own full Chromium in its new headless mode — never the user's installed Chrome.
      const ctx = await chromium().launchPersistentContext(this.dir, {
        headless: true, channel: 'chromium', acceptDownloads: false, viewport: { width: 1280, height: 800 },
        args: ['--no-first-run', '--no-default-browser-check']
      });
      ctx.on('page', p => this.track(p));
      ctx.on('close', () => {   // the window was closed (by the user, sign-out, or Chrome itself): start fresh next time
        console.log('[browser] window closed');
        if (users.get(this.uid) === this) users.delete(this.uid);
        this.ctx = null; this.pages = [];
      });
      this.ctx = ctx;
      ctx.pages().forEach(p => this.track(p));
      if (!this.pages.length) await ctx.newPage();
      this.current = 0;
    })().finally(() => { this.starting = null; });
    await this.starting;
  }
  track(p) {
    if (this.pages.includes(p)) return;
    this.pages.push(p);
    p.on('close', () => {
      console.log('[browser] a tab closed');
      const i = this.pages.indexOf(p);
      if (i < 0) return;
      this.pages.splice(i, 1);
      if (this.current >= this.pages.length) this.current = Math.max(0, this.pages.length - 1);
    });
    // a page may only ever show http/https (a site can't send the browser to file:// or similar)
    p.on('framenavigated', f => {
      if (f === p.mainFrame() && !/^(https?:|about:blank|chrome-error:)/.test(f.url())) p.goto('about:blank').catch(() => {});
    });
  }
  page() { return this.pages[this.current] || null; }
  note(text, url) {
    this.log.push({ n: ++this.seq, at: Date.now(), text, url: url || null });
    if (this.log.length > LOG_MAX) this.log.shift();
  }
  async refreshShot() {
    const p = this.page();
    if (!p) return;
    try { this.shot = await p.screenshot({ type: 'jpeg', quality: 60 }); this.shotAt = Date.now(); } catch (e) {}
  }
  async tabsInfo() {
    return Promise.all(this.pages.map(async (p, i) => ({ i, title: await p.title().catch(() => '') || host(p.url()), url: p.url(), current: i === this.current })));
  }
  async close() {
    const ctx = this.ctx;
    this.stop();
    users.delete(this.uid);
    this.ctx = null;
    if (ctx) await ctx.close().catch(() => {});
  }
  // STOP: the running task halts now — the action in progress is abandoned and the page stops loading.
  stop() {
    const t = this.task;
    if (!t || !t.running) return false;
    t.stopped = true;
    t.stopWaiters.forEach(f => f());
    const p = this.page();
    if (p) p.evaluate(() => window.stop()).catch(() => {});
    return true;
  }
}
function session(uid) { let s = users.get(uid); if (!s) { s = new Session(uid); users.set(uid, s); } return s; }
function existing(uid) { const s = users.get(uid); return s && s.ctx ? s : null; }

// ---- The tools (read-only) ----
const TOOLS = [
  { name: 'browser_search', description: 'Search the web in the browser. Opens a search results page and returns the results (title, link, snippet).',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'browser_open', description: 'Open a web page (http or https) in the current tab.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'browser_read', description: "Read the current tab's page: its title, address and readable text.",
    parameters: { type: 'object', properties: {} } },
  { name: 'browser_screenshot', description: 'Take a screenshot of the current tab so you can SEE the page (layout, pictures, what is visible).',
    parameters: { type: 'object', properties: {} } },
  { name: 'browser_tabs', description: 'Manage tabs. action: list | new (optionally with url) | switch (index) | close (index, or the current tab).',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'new', 'switch', 'close'] }, url: { type: 'string' }, index: { type: 'integer' } }, required: ['action'] } },
  { name: 'browser_back', description: 'Go back in the current tab.', parameters: { type: 'object', properties: {} } },
  { name: 'browser_forward', description: 'Go forward in the current tab.', parameters: { type: 'object', properties: {} } },
  { name: 'browser_reload', description: 'Reload the current tab.', parameters: { type: 'object', properties: {} } }
].map(f => ({ type: 'function', function: f }));

// Opens url in page p. Returns a plain-words result for the brain (never invented: a failure says so).
async function go(s, p, url, how) {
  const safe = safeUrl(url);
  if (!safe) return 'Not opened: only http and https web addresses can be opened.';
  s.note((how || 'Opening') + ' ' + host(safe) + '…', safe);
  try {
    const r = await p.goto(safe, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await p.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    const status = r ? r.status() : 0;
    const title = await p.title().catch(() => '');
    if (status >= 400) { s.note('The page answered with an error (' + status + ')', p.url()); return 'The page did not load properly: the site answered with error ' + status + ' at ' + p.url() + '.'; }
    s.note('Opened: ' + (title || host(p.url())), p.url());
    return 'Opened "' + (title || p.url()) + '" at ' + p.url() + '.';
  } catch (e) {
    s.note("Couldn't open " + host(safe), safe);
    return 'The page failed to load (' + String(e.message).split('\n')[0].slice(0, 120) + ').';
  }
}

// Search results as text: Bing first; DuckDuckGo's plain page if Bing shows none (a consent or bot page, say).
async function search(s, p, query) {
  s.note('Searching for "' + query.slice(0, 80) + '"…');
  const engines = [
    { url: 'https://www.bing.com/search?q=' + encodeURIComponent(query), read: () => [...document.querySelectorAll('li.b_algo')].map(li => {
      const a = li.querySelector('h2 a');
      let href = a ? a.href : '';
      try {   // Bing wraps links: /ck/a?…&u=a1<base64 url>
        const u = new URL(href);
        if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/') && (u.searchParams.get('u') || '').startsWith('a1'))
          href = atob(u.searchParams.get('u').slice(2).replace(/-/g, '+').replace(/_/g, '/'));
      } catch (e) {}
      const sn = li.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, p');
      return { title: a ? a.innerText.trim() : '', url: href, snippet: sn ? sn.innerText.trim() : '' };
    }) },
    { url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), read: () => [...document.querySelectorAll('.result')].map(r => {
      const a = r.querySelector('.result__a');
      let href = a ? a.href : '';
      try { const u = new URL(href); if (u.searchParams.get('uddg')) href = u.searchParams.get('uddg'); } catch (e) {}
      const sn = r.querySelector('.result__snippet');
      return { title: a ? a.innerText.trim() : '', url: href, snippet: sn ? sn.innerText.trim() : '' };
    }) }
  ];
  for (const en of engines) {
    try {
      await p.goto(en.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await p.waitForLoadState('load', { timeout: 4000 }).catch(() => {});
      const list = (await p.evaluate(en.read)).filter(r => r.title && /^https?:/.test(r.url)).slice(0, 8);
      if (list.length) {
        s.note('Found ' + list.length + ' results on ' + host(en.url), p.url());
        return 'Search results for "' + query + '":\n' + list.map((r, i) => (i + 1) + '. ' + r.title + '\n   ' + r.url + (r.snippet ? '\n   ' + r.snippet.slice(0, 240) : '')).join('\n');
      }
    } catch (e) { /* try the next engine */ }
  }
  s.note('The search returned no readable results');
  return 'The search did not return any readable results (the search page may have been blocked).';
}

async function readPage(s, p) {
  s.note('Reading ' + host(p.url()) + '…', p.url());
  try {
    const out = await p.evaluate(() => {
      const root = document.querySelector('main, article, [role="main"]') || document.body;
      return { title: document.title, text: root ? root.innerText : '' };
    });
    const text = out.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return 'The page at ' + p.url() + ' has no readable text (it may be mostly pictures — a screenshot can show it).';
    return 'Page: "' + out.title + '" at ' + p.url() + '\n\n' + text.slice(0, READ_MAX) + (text.length > READ_MAX ? '\n\n[…the page goes on]' : '');
  } catch (e) { return "Couldn't read this page (" + String(e.message).split('\n')[0].slice(0, 120) + ').'; }
}

// Runs one tool call. Returns { text, image? (data URL for the brain to see) }.
async function runTool(s, name, args, used) {
  let p = s.page();
  if (!p) { await s.ctx.newPage(); s.current = s.pages.length - 1; p = s.page(); }
  const remember = () => { const u = p.url(); if (/^https?:/.test(u) && !used.some(x => x.url === u)) used.push({ url: u, name: host(u) }); };
  switch (name) {
    case 'browser_search': return { text: await search(s, p, String(args.query || '').slice(0, 300)) };
    case 'browser_open': { const t = await go(s, p, args.url); return { text: t }; }
    case 'browser_read': { const t = await readPage(s, p); remember(); p.title().then(tt => { const u = used.find(x => x.url === p.url()); if (u && tt) u.name = tt.slice(0, 80); }).catch(() => {}); return { text: t }; }
    case 'browser_screenshot': {
      s.note('Taking a screenshot of ' + host(p.url()), p.url());
      const buf = await p.screenshot({ type: 'jpeg', quality: 70 });
      remember();
      used.shots = (used.shots || 0) + 1;
      return { text: 'Screenshot taken of ' + p.url() + ' — it is attached in the next message.', image: 'data:image/jpeg;base64,' + buf.toString('base64') };
    }
    case 'browser_tabs': {
      const a = args.action;
      if (a === 'new') {
        const np = await s.ctx.newPage();
        s.track(np);   // the 'page' event may not have run yet
        s.current = s.pages.indexOf(np);
        s.note('Opened a new tab');
        if (args.url) return { text: (await go(s, np, args.url)) + ' (in a new tab, now the current tab #' + s.current + ')' };
        return { text: 'New empty tab #' + s.current + ' is now the current tab.' };
      }
      if (a === 'switch') {
        const i = Number(args.index);
        if (!Number.isInteger(i) || !s.pages[i]) return { text: 'There is no tab #' + args.index + '.' };
        s.current = i;
        await s.pages[i].bringToFront().catch(() => {});
        s.note('Switched to tab ' + (i + 1) + ': ' + (await s.pages[i].title().catch(() => '') || host(s.pages[i].url())), s.pages[i].url());
        return { text: 'Switched to tab #' + i + ' (' + s.pages[i].url() + ').' };
      }
      if (a === 'close') {
        const i = Number.isInteger(args.index) ? args.index : s.current;
        if (!s.pages[i]) return { text: 'There is no tab #' + args.index + '.' };
        if (s.pages.length === 1) return { text: "That is the only tab, so it stays open." };
        await s.pages[i].close().catch(() => {});
        s.note('Closed a tab');
        return { text: 'Closed tab #' + i + '. The current tab is now #' + s.current + '.' };
      }
      const tabs = await s.tabsInfo();
      return { text: 'Tabs (index: title — address):\n' + tabs.map(t => '#' + t.i + (t.current ? ' (current)' : '') + ': ' + t.title + ' — ' + t.url).join('\n') };
    }
    case 'browser_back': s.note('Going back'); await p.goBack({ timeout: NAV_TIMEOUT }).catch(() => {}); return { text: 'Now at ' + p.url() + '.' };
    case 'browser_forward': s.note('Going forward'); await p.goForward({ timeout: NAV_TIMEOUT }).catch(() => {}); return { text: 'Now at ' + p.url() + '.' };
    case 'browser_reload': s.note('Reloading the page'); await p.reload({ timeout: NAV_TIMEOUT }).catch(() => {}); return { text: 'Reloaded ' + p.url() + '.' };
    default: return { text: 'There is no tool called ' + name + '.' };
  }
}

const RULES = '\n\nYOU ARE USING A REAL WEB BROWSER (your own, inside Sim Sim — the user watches it in the Browser panel) through tools, for this task:' +
  '\n- You can search, open pages, read them, take screenshots, and open/switch/close tabs. You CANNOT click, type into, or submit anything on a page yet.' +
  ' If the task needs that, say plainly that you can only look and read for now.' +
  '\n- Use browser_read to get a page\'s text. Use browser_screenshot when the question is about what is visible on the page or how it looks.' +
  '\n- "This page" / "what\'s on the page" / "what am I looking at" means the CURRENT tab (shown below): take a browser_screenshot of it first — do not search again.' +
  '\n- To open a site in a new tab use browser_tabs with action "new" and its url. Tab numbers come from browser_tabs "list".' +
  '\n- Answer ONLY from pages you actually opened and read (or screenshots you took) in this task. Never invent page content.' +
  ' If a page fails to load, blocks you or shows a check you can\'t pass, say so plainly.' +
  '\n- End with the answer itself (no tool call). Keep it short and warm, and name the page(s) it comes from — their links are shown to the user.';

// One browser task: the Meta brain (through `ask`) picks tools, this file runs them, until it answers or is stopped.
// ask(messages, tools|null) -> the brain's message { content, tool_calls? }. Returns { reply, pages, shots, stopped, steps }.
async function runTask(uid, { system, history, message, ask }) {
  const s = session(uid);
  if (s.task && s.task.running) return { busy: true };
  const task = s.task = { id: Date.now(), running: true, stopped: false, stopWaiters: [] };
  const stopped = new Promise(r => task.stopWaiters.push(r));
  const used = [];
  let steps = 0, reply = '';
  try {
    s.note('Starting: ' + message.slice(0, 100));
    await s.ensure();
    await s.refreshShot();
    // where the browser is right now, so "this page" means the page the user can see
    const tabs = await s.tabsInfo();
    const now = tabs.some(t => /^https?:/.test(t.url))
      ? '\n\nTHE BROWSER RIGHT NOW (tab index: title — address):\n' + tabs.map(t => '#' + t.i + (t.current ? ' (current)' : '') + ': ' + t.title + ' — ' + t.url).join('\n')
      : '\n\nTHE BROWSER RIGHT NOW: an empty tab.';
    const messages = [{ role: 'system', content: system + RULES + now }, ...history, { role: 'user', content: message }];
    const started = Date.now();
    while (!task.stopped) {
      const out = steps >= MAX_STEPS || Date.now() - started > MAX_TASK_MS;
      if (out) messages.push({ role: 'user', content: '[The browser step limit is reached. Answer now from what you have read, and say plainly if it is incomplete.]' });
      const msg = await Promise.race([ask(messages, out ? null : TOOLS), stopped.then(() => null)]);
      if (!msg || task.stopped) break;
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (!calls.length || out) { reply = (msg.content || '').trim(); break; }
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      const images = [];
      for (const c of calls) {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) {}
        let res = { text: 'This action was skipped: the task was stopped.' };
        if (!task.stopped && steps < MAX_STEPS) {
          steps++;
          res = await Promise.race([runTool(s, c.function.name, args, used).catch(e => ({ text: 'That action failed: ' + String(e.message).split('\n')[0].slice(0, 120) })),
            stopped.then(() => ({ text: 'Stopped by the user.' }))]);
          await s.refreshShot();
        }
        messages.push({ role: 'tool', tool_call_id: c.id, content: res.text });
        if (res.image) images.push(res.image);
      }
      if (images.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'Screenshot of the current tab:' }, ...images.map(u => ({ type: 'image_url', image_url: { url: u } }))] });
    }
  } finally {
    task.running = false;
    s.note(task.stopped ? 'Stopped by you' : 'Done');
    s.refreshShot();
  }
  return { reply, pages: used.map(u => ({ name: u.name, url: u.url })), shots: used.shots || 0, stopped: task.stopped, steps };
}

// ---- What the Browser panel shows ----
async function state(uid) {
  const s = existing(uid);
  if (!s) return { open: false, log: (users.get(uid) || { log: [] }).log.slice(-30) };
  const p = s.page();
  return {
    open: true, url: p ? p.url() : '', title: p ? await p.title().catch(() => '') : '',
    tabs: await s.tabsInfo(), log: s.log.slice(-30), running: !!(s.task && s.task.running), shotAt: s.shotAt
  };
}
async function shot(uid) {
  const s = existing(uid);
  if (!s) return null;
  if (!s.task || !s.task.running) await s.refreshShot();   // the user may have scrolled or clicked in the window
  return s.shot;
}
// The user, from the panel: open a page / switch tab (their own actions, logged as theirs).
async function userOpen(uid, url) {
  const s = session(uid);
  await s.ensure();
  if (!s.page()) { await s.ctx.newPage(); s.current = s.pages.length - 1; }
  const r = await go(s, s.page(), url, 'You opened');
  await s.refreshShot();
  return r;
}
async function userTab(uid, i) {
  const s = existing(uid);
  if (!s || !s.pages[i]) return false;
  s.current = i;
  await s.pages[i].bringToFront().catch(() => {});
  s.note('You switched to tab ' + (i + 1), s.pages[i].url());
  await s.refreshShot();
  return true;
}
function stop(uid) { const s = users.get(uid); return s ? s.stop() : false; }
// The server is shutting down: close every user's window, so none is left holding its profile.
function closeAll() { return Promise.all([...users.values()].map(s => s.close())); }
async function close(uid) { const s = users.get(uid); if (s) await s.close(); }
function isOpen(uid) { return !!existing(uid); }

// ---- When does a chat message go to the browser? (plain code, before the answer lane) ----
// A web address with an opening verb, an explicit web search, tab words, or — while the browser is open — words about
// "this page / the site / the tab", going back/forward/reloading.
const DOMAIN = /(?:^|[\s(])(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|io|co|us|uk|ai|app|dev|info|tv|me|news|ca|de)(?:\/\S*)?(?=$|[\s),.!?])/i;
const OPEN_VERB = /\b(open|go to|visit|load|pull up|bring up|navigate to|browse|check out|look at|show me|read)\b/i;
const SEARCH = /^(?:(?:hey|ok|okay)\s+)?(?:sim[\s-]?sim\s*[,!.:]?\s*)?(?:(?:please|can you|could you|would you|will you|go and|go)\s+)*(?:search|google|bing)\b|\b(?:search|look (?:it |this |that )?up|find)\b.*\b(?:online|on the web|on the internet|on google|on bing|in (?:the|your) browser)\b/i;
const TABS = /\b(?:new tab|another tab|second tab|(?:switch|go|change)(?: back)? to (?:the )?(?:\w+ )?tab|close (?:the |this |that |that )?(?:\w+ )?tab|(?:what|which) tabs|list (?:the |my )?tabs|tab (?:one|two|three|\d))\b/i;
const BROWSER_WORD = /\b(?:your browser|the browser|sim sim'?s browser|browse the web|in a browser)\b/i;
const ON_PAGE = /\b(?:this|the|that|current) (?:page|site|website|web ?page|tab|article|result|link)\b|\b(?:go back|go forward|reload|refresh the page)\b|\bopen (?:the )?(?:best|first|top|second|third) (?:result|link|one)\b/i;
// well-known sites said by name, without ".com" ("open wikipedia", "go to youtube")
const SITE_NAME = /\b(?:open|go to|visit|pull up|bring up|load)\s+(?:up\s+)?(?:the\s+)?(?:wikipedia|youtube|google|amazon|reddit|ebay|walmart|imdb|github|linkedin|facebook|instagram|espn|cnn|bbc|nytimes|yahoo|bing|duckduckgo)\b/i;
function wantsBrowser(message, uid) {
  const t = String(message || '');
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t) && !/https?:\/\//.test(t)) return false;   // an email address is not a website
  if (DOMAIN.test(t) && OPEN_VERB.test(t)) return true;
  if (SITE_NAME.test(t)) return true;
  if (SEARCH.test(t) || TABS.test(t) || BROWSER_WORD.test(t)) return true;
  return isOpen(uid) && ON_PAGE.test(t);
}

module.exports = { runTask, wantsBrowser, state, shot, stop, close, closeAll, userOpen, userTab, isOpen, safeUrl, MAX_STEPS };
