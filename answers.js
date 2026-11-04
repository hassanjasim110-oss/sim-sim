// SIM SIM — THE ANSWERS PROCESS (server side, for every chat message after the image lane and forget commands).
// The rule (founder, 2026-10-27): answer the way Muse answers — ANSWER FIRST, verify what matters, never invent.
//   1. CLASSIFY (Meta brain, tiny JSON call): does the answer hang on high-stakes specifics? Plus the question made standalone.
//   2. Everything else -> the answer lane: notebook + identity -> brain. Every question gets a real answer.
//   3. High-stakes specifics -> the same real answer, but each specific is checked: the Book first, then official pages
//      online (saved into the Book). Backed specifics are cited; a specific that can't be verified is NOT invented —
//      the answer says so in plain words and tells the user how to check. There is no refusal line any more.
// Every word of every answer is written by the Meta brain; the Book and web pages are only what it reads.
const book = require('./book.js');
const memory = require('./memory.js');

// Output cap for the small routing step. The model's hidden reasoning counts against it, so it needs room.
const SMALL_STEP_TOKENS = 4000;

// ---- THE PROFESSIONAL ANSWER STANDARD + DELIVERABLE RULES (founder, 2026-10-30: "answers like professional and Muse
// Wonder", no cheap answers). Added to every answer this file writes. The page renders ``` fenced blocks as real code blocks,
// each with its own working Copy button (public/app.js renderRich) — that is the ONLY copy button the brain may mention. ----
const STANDARD = '\n\nTHE ANSWER STANDARD (a competent professional assistant):' +
  '\n- A substantive question gets a COMPLETE answer: full sentences, the actual substance, organized when it has parts (one short lead line,' +
  ' then the parts as a list or steps). No shorthand, no one-line brush-off for a real question, and never a question back instead of the deliverable.' +
  '\n- Small talk and greetings stay short and natural. The standard is completeness where there is substance, not length everywhere.' +
  '\n- Tone: confident, plain, warm. Never gushing, no filler openers ("Sure thing!") and no filler sign-off questions ("Want a different style?").' +
  '\n- Never coach the user to rephrase a request into a "magic sentence" for an action the app can perform — app commands are handled by' +
  ' code; if an action truly cannot be done, say so plainly. Never claim an app action happened unless the app confirmed it.' +
  ' You have hands in this app (tools) — "I only reply inside this chat", "I don\'t have the controls", "I can\'t make a side chat from here",' +
  ' and "use the button and tell me there" are all BANNED and false; call the tool instead.' +
  '\n- Formatting the page shows: **bold**, `inline code`, lists ("- " or "1. "), and ``` fenced blocks.' +
  '\n\nDELIVERABLES THE USER WILL COPY:' +
  '\n- FIRST decide what the prompt is FOR. If its goal is a PICTURE (an image to make — even when the user says it is "for Claude"), it is an' +
  ' IMAGE PROMPT (rule below), not a work order.' +
  '\n- A prompt for Claude (or any AI) to DO work / a work order: at most 2 short lines, then ONE ``` fenced block holding the WHOLE prompt, built on four' +
  ' parts in this order, each with a short label: THE JOB (one line) / WHAT IT NEEDS TO KNOW / WHAT NOT TO DO / HOW YOU\'LL KNOW IT\'S DONE.' +
  ' A revision re-issues the whole updated block.' +
  '\n- An image prompt (a description for an image maker): one short lead line, then ONE ``` fenced block with a polished, complete descriptive' +
  ' prompt of about 60–120 words in flowing prose — the subject, the setting, the key details (pose, action, colors, textures), the lighting,' +
  ' the camera/composition, and the style and mood. Complete on the first try. Never a bare fragment, never just a quoted sentence in plain text,' +
  ' never the four work-order labels.' +
  '\n- "Give it / give me that / with a copy button / in a block" about a TEXT you gave: re-issue THAT text inside a ``` fenced block. Never a picture' +
  ' unless the user asked for a picture.' +
  '\n- The app puts a Copy button on every ``` fenced block automatically. Never claim a copy button, box or any other on-screen control unless you' +
  ' just put the text in a ``` fenced block; you cannot create buttons — only place text in a block.' +
  '\n- If the user asks to SEE how something looks, that is a picture request, not a writing task. Never answer it by telling the user to re-ask with' +
  ' an exact sentence, and never repeat such an instruction. If you offered a picture and the user confirms, code handles the making — say nothing' +
  ' that asks them to ask again.';

// ---- Questions about Sim Sim itself (founder, 2026-10-30): answered FROM about.md, Sim Sim's own document ----
// What it is, who made it, how any part of it works, what it can or can't do. Only these calls carry the document;
// every other question is untouched (no document, no extra cost).
const ABOUT_FILE = require('path').join(__dirname, 'about.md');
const YOU = '(?:you|u|sim\\s?-?sim)';
const ABOUT_SELF = [
  new RegExp('\\b(?:who|what)\\s+(?:are|r)\\s+' + YOU + '\\b', 'i'),
  new RegExp('\\bwho\\s+(?:made|created|built|designed|owns|founded|programmed|coded|invented)\\s+' + YOU + '\\b', 'i'),
  new RegExp('\\bhow\\s+(?:do|does|did|are)\\s+' + YOU + '\\s+(?:work|think|run|remember|hear|listen|learn|answer|see|know|get made|built|made)\\b', 'i'),
  new RegExp('\\b(?:your|sim\\s?-?sim\'?s)\\s+(?:brain|model|models|memory|notebook|founder|creator|maker|code|ears|voice|privacy|abilities|features|limits|senses)\\b', 'i'),
  new RegExp('\\bwhat\\s+(?:can|can\'t|cannot|can not)\\s+' + YOU + '\\s+do\\b', 'i'),
  new RegExp('\\bcan\\s+' + YOU + '\\s+(?:click|type|control|move|press|tap|see|hear|watch|look at|remember|browse|draw|edit)\\b', 'i'),
  new RegExp('\\b(?:are|r)\\s+' + YOU + '\\s+(?:an? )?(?:ai|bot|robot|human|real|person|chatgpt|claude|gemini|llama|muse)\\b', 'i'),
  new RegExp('\\b(?:lines? of code|tell me about yourself|about yourself|what (?:ai|model|llm) (?:are|do) ' + YOU + ')\\b', 'i')
];
function aboutSelf(message) { return ABOUT_SELF.some(r => r.test(String(message || ''))); }

// ---- Questions about the current date, day or time (founder, 2026-11-01) ----
// The live clock line (memory.buildChatSystem's nowLine) is already in every chat system prompt — the defect was that
// the CLASSIFY step below reads "current time" as a "live/local fact" and routes it to the Book/web-search lane, which
// has no topic for "what time is it" and ends with a slow search and "I won't guess". These never reach classify at all.
const ASKS_NOW = [
  /\bwhat\s+time\s+(?:is\s+it|do\s+you\s+have|does\s+(?:your\s+)?clock\s+say)\b/i,
  /\bwhat(?:'s| is)\s+the\s+(?:current\s+|exact\s+)*time\b(?!\s*(?:zone|in|for|to|of|at))/i,
  /\bcurrent\s+time\b(?!\s*zone)/i,
  /\btime\s+is\s+it\b/i,
  /\bwhat\s+day\s+(?:is\s+it|is\s+today)\b/i,
  /\bwhat\s+day\s+of\s+the\s+week\s+is\s+it\b/i,
  /\bwhat(?:'s| is)\s+(?:the\s+)?(?:date|day)\s+today\b/i,
  /\bwhat(?:'s| is)\s+today'?s\s+date\b/i,
  /\btoday'?s\s+date\b/i,
  /\bwhat(?:'s| is)\s+the\s+date\b(?!\s*(?:of|for|to))/i
];
function asksCurrentMoment(message) { return ASKS_NOW.some(r => r.test(String(message || ''))); }
const ABOUT_RULES = '\n\nTHIS QUESTION IS ABOUT YOU. Below is your own document — the ONLY source about yourself. Answer from it, in your own natural' +
  ' words (warm and plain — a real answer, not a one-liner when the question is broad). If the document does not cover the question,' +
  " say plainly that you don't have that written down. Never invent details about yourself beyond this document." +
  // the ears honesty rule (founder, 2026-10-24): wherever listening is described, the Google part is said
  ' Whenever you describe how you hear or listen, always include the honest line from the document: Chrome sends what the' +
  " microphone hears to Google's speech servers to turn it into text.\n\n" +
  '===== YOUR DOCUMENT =====\n';
const COMPOSE_FACTS = 50; // notebook facts the composing step reads
const BASELINE_LINE = "That's the general rule — your state's rule may differ.";

function parseJson(content) {
  if (typeof content !== 'string') return null;
  const a = content.indexOf('{'), b = content.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(content.slice(a, b + 1)); } catch (e) { return null; }
}
// An empty brain reply on a routing/composing step means "nothing usable" (careful lane / not verified), not a crash.
async function askOrEmpty(ask, messages, opts) {
  try { return await ask(messages, opts); }
  catch (e) { if (/empty answer/i.test(e.message)) return ''; throw e; }
}

function historyText(history) {
  return history.slice(-6).map(h => (h.role === 'user' ? 'User: ' : 'Sim Sim: ') + h.content.slice(0, 500)).join('\n');
}

// ---- 1. CLASSIFY ----
const ROUTER_RULES = [
  'You route messages for Sim Sim, a personal assistant. Reply with JSON only, in exactly this shape:',
  '{"lane":"fast"|"precise","question":"...","topic":"...","company_domain":""}',
  '- question: the latest user message rewritten as ONE standalone question, using the recent conversation to resolve words like "it", "there", "that".',
  '- lane "precise" ONLY when a good answer hangs on a high-stakes specific that should be checked against a reliable source: laws and official',
  "  rules; taxes and money rules; health specifics (doses, medical thresholds); deadlines and fees; documents and immigration; workers' rights;",
  '  marketplace and platform policies; live or local facts (hours, prices, current conditions).',
  '- lane "fast" for everything else: general knowledge, opinions, explanations, how-to, recommendations, creative writing, everyday chat,',
  '  one-word or unclear messages, questions about Sim Sim itself (who are you, who made you, who is your founder, what can you do),',
  '  and questions about the user\'s own life that their notebook answers (their people, birthdays, plans, tasks, open loops, personal deadlines).',
  '- topic: the id of the ONE Book topic below that covers the question, or "none".',
  '- company_domain: if the question is about one specific company or organization\'s own policy, its official website domain (e.g. "amazon.com"); otherwise "".'
].join('\n');

async function classify(ask, message, history, profile, topics) {
  const payload = {
    recent_conversation: historyText(history) || '(none)',
    user_state: profile ? profile.state : '',
    book_topics: topics.map(t => ({ id: t.id, about: t.about })),
    latest_message: message
  };
  const out = parseJson(await askOrEmpty(ask, [{ role: 'system', content: ROUTER_RULES }, { role: 'user', content: JSON.stringify(payload) }], { effort: 'minimal', maxTokens: SMALL_STEP_TOKENS }));
  if (!out || (out.lane !== 'fast' && out.lane !== 'precise')) return { lane: 'precise', question: message, topic: 'none', company_domain: '' }; // unsure -> the careful lane
  return {
    lane: out.lane,
    question: typeof out.question === 'string' && out.question.trim() ? out.question.trim() : message,
    topic: typeof out.topic === 'string' ? out.topic : 'none',
    company_domain: typeof out.company_domain === 'string' ? out.company_domain.trim() : ''
  };
}

// ---- 3b. What the Book holds for this question and this user's state ----
function bookExtracts(topic, state) {
  if (!topic) return [];
  const ex = [];
  const row = topic.rows.find(r => r.state.toLowerCase() === String(state || '').toLowerCase());
  if (topic.baseline) ex.push({ id: 'baseline', kind: 'baseline (general rule, not any one state)', text: topic.baseline });
  if (row) {
    const cells = Object.entries(row.cells).filter(([k]) => !['source url', 'fetched'].includes(k)).map(([k, v]) => k + ': ' + v).join('\n');
    ex.push({ id: 'row:' + row.state, kind: row.state + ' row (official ' + row.state + ' pages)', text: cells, state: row.state });
  }
  topic.pages.forEach((p, i) => {
    // a state's own pages only count for a user in that state; pages with no state are general
    if (!p.state || p.state.toLowerCase() === String(state || '').toLowerCase()) ex.push({ id: 'page:' + i, kind: 'official source page: ' + p.name, text: p.text, page: p });
  });
  return ex;
}

// ---- 3e. COMPOSE: answer first; specifics only from sources; unverified specifics said plainly, never invented ----
const COMPOSE_RULES = [
  "You write Sim Sim's answer to a question where some details are high-stakes (laws, official rules, taxes, money rules, health specifics,",
  'deadlines, fees, documents, immigration, workers\' rights, platform policies, live or local facts). Reply with JSON only:',
  '{"answer":"...","used":["extract id", ...],"verified":true|false}',
  'Rules:',
  '- ANSWER FIRST: always give a real, helpful answer in Sim Sim\'s warm, plain voice. Use your own knowledge for the general parts.',
  '- High-stakes SPECIFICS (exact numbers, dates, deadlines, fees, amounts, legal rules, office names): state one as fact ONLY when an extract',
  '  below says it, and list those extract ids in "used". Never stretch a fact about one thing to a different thing.',
  '- If a specific the user needs is NOT in the extracts: do NOT invent it or guess a number. Say plainly, in natural words, that you could',
  '  not verify that exact detail, and tell them how to check it (which official office or website). You may still give clearly hedged general',
  '  context ("it is usually set by the county", "most states give about a month") as long as you say it is not verified for them.',
  '- Personal date math IS allowed: a date from the user (message or notebook) plus a period stated in an extract; give the date with its year.',
  '- If you rely on the "baseline" extract and not on a state row or that state\'s own page, present it as the general rule only.',
  '- If the question asks for the general or nationwide rule (not one state\'s rule), use only the "baseline" extract for specifics.',
  '- Say how sure you are when it matters. If the question is about something you have no record of (a made-up event, award or rule),',
  '  say plainly that you have no record of it — never play along.',
  '- verified = true only if every high-stakes specific you stated comes from the extracts.',
  '- 1 to 4 short plain sentences. Address the user by name once at most. No links in the text.'
].join('\n');

async function compose(ask, question, profile, facts, extracts) {
  const payload = {
    today: new Date().toISOString().slice(0, 10),
    question,
    user: profile ? { name: profile.callName, state: profile.state } : null,
    user_notebook: memory.newestFirst(facts).slice(0, COMPOSE_FACTS).map(f => f.text),
    extracts: extracts.map(e => ({ id: e.id, kind: e.kind, text: e.text.slice(0, 24000) }))
  };
  const out = parseJson(await askOrEmpty(ask, [{ role: 'system', content: memory.identityLines() + '\n\n' + COMPOSE_RULES + memory.languageLine(profile) },
    { role: 'user', content: JSON.stringify(payload) }], { effort: 'low' }));
  if (!out || typeof out.answer !== 'string' || !out.answer.trim()) return null;
  const known = new Set(extracts.map(e => e.id));
  const used = (Array.isArray(out.used) ? out.used : []).filter(id => known.has(id));
  return { answer: out.answer.trim(), used, verified: out.verified === true && used.length > 0 };
}

// ---- 3c. Book miss: find an OFFICIAL page online (Meta web search finds candidates; our code checks and fetches) ----
function cleanUrl(u) {
  try {
    const x = new URL(u);
    [...x.searchParams.keys()].forEach(k => { if (/^(ref|utm_|fbclid|gclid)/i.test(k)) x.searchParams.delete(k); });
    x.hash = '';
    return x.toString();
  } catch (e) { return null; }
}
async function findOfficialPages(searchWeb, question, state, companyDomain) {
  const where = companyDomain ? 'the official website of ' + companyDomain : 'official government websites (.gov or official state/county sites)';
  const urls = await searchWeb('Find the page on ' + where + ' that directly answers this question' + (state ? ' for someone in ' + state : '') +
    ': ' + question + ' Only official sources — no news, blogs, forums or answer sites.');
  const seen = new Set(), picked = [];
  for (const raw of urls) {
    const u = cleanUrl(raw);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    if (!book.isOfficialUrl(u, companyDomain) || /\/search\b|[?&]search/i.test(u)) continue; // not confirmed official -> not found
    picked.push(u);
    if (picked.length >= 3) break;
  }
  const pages = [];
  for (const u of picked) {
    try { pages.push(await book.fetchOfficialPage(u, companyDomain)); } catch (e) { /* unreachable or not a page: skip */ }
  }
  return pages;
}

// ---- Citation card: which official sources the answer stands on ----
function citations(topic, extracts, used) {
  const out = [], seen = new Set();
  const add = (name, url, fetched) => { if (url && !seen.has(url)) { seen.add(url); out.push({ name, url, fetched }); } };
  for (const id of used) {
    const e = extracts.find(x => x.id === id);
    if (!e) continue;
    if (e.page) add(e.page.name, e.page.url, e.page.fetched);
    else if (id === 'baseline' && topic) {
      const m = topic.baseline.match(/Source:\s*([^·\n]+)·\s*(https?:\/\/\S+)\s*·\s*Fetched\s*([0-9-]+)/i);
      if (m) add(m[1].trim(), m[2].trim(), m[3].trim());
    } else if (id.startsWith('row:') && topic) {
      const row = topic.rows.find(r => 'row:' + r.state === id);
      (row ? row.url.split(/\s*;\s*/) : []).forEach(u => {
        const p = topic.pages.find(pg => pg.url === u);
        add(p ? p.name : u, u, row.fetched);
      });
    }
  }
  return out;
}

// ---- The whole process ----
// ask(messages, opts) -> text from the Meta brain; searchWeb(prompt) -> candidate URLs from Meta's web search.
// The result also carries `trace`: facts about what actually ran, for the "How I answered" receipt (receipt.js). Never sent to the brain.
async function answer({ ask, searchWeb, message, history, profile, facts, loops, settings, tz }) {
  // A question about Sim Sim itself: straight to the answer lane with its own document (no source check, no web search).
  if (aboutSelf(message)) {
    let doc = '';
    try { doc = require('fs').readFileSync(ABOUT_FILE, 'utf8'); } catch (e) { console.error('[answers] about.md could not be read'); }
    if (doc) {
      const trace = { sorted: 'plain', usedNotebook: Math.min(facts.length, memory.MAX_FACTS_IN_CONTEXT), openLoops: (loops || []).length };
      const reply = await ask([
        { role: 'system', content: memory.buildChatSystem(profile, facts, loops || [], null, settings, tz) + STANDARD + ABOUT_RULES + doc },
        ...history.slice(-6),
        { role: 'user', content: message }
      ]);
      return { lane: 'fast', from: 'about', reply, trace };
    }
  }
  // A question about the current date, day or time: answered directly from the live clock line already in the
  // system prompt — never classified, never sent to the Book or a web search, never hedged.
  if (asksCurrentMoment(message)) {
    const trace = { sorted: 'plain', usedNotebook: Math.min(facts.length, memory.MAX_FACTS_IN_CONTEXT), openLoops: (loops || []).length };
    const reply = await ask([
      { role: 'system', content: memory.buildChatSystem(profile, facts, loops || [], null, settings, tz) + STANDARD },
      ...history.slice(-6),
      { role: 'user', content: message }
    ]);
    return { lane: 'fast', from: 'now', reply, trace };
  }
  const topics = book.listTopics();
  const route = await classify(ask, message, history, profile, topics);
  const trace = { sorted: route.lane === 'fast' ? 'plain' : 'checked' };

  // 2. The answer lane: notebook + identity -> brain. Every question gets a real answer.
  const plainAnswer = async () => {
    trace.usedNotebook = Math.min(facts.length, memory.MAX_FACTS_IN_CONTEXT);
    trace.openLoops = (loops || []).length;
    return ask([
      { role: 'system', content: memory.buildChatSystem(profile, facts, loops || [], null, settings, tz) + STANDARD },
      ...history.slice(-6),
      { role: 'user', content: message }
    ]);
  };
  if (route.lane === 'fast') return { lane: 'fast', reply: await plainAnswer(), trace };

  // 3. High-stakes specifics: the same real answer, with each specific checked. a) notebook first (state, dates).
  const state = profile ? profile.state : '';
  // b) the Book.
  const topic = topics.find(t => t.id === route.topic) || null;
  const ex = bookExtracts(topic, state);
  trace.bookChecked = ex.length > 0;
  if (topic) trace.bookTopic = topic.title || topic.about;
  let done = ex.length ? await compose(ask, route.question, profile, facts, ex) : null;
  if (done && done.verified) return finish('book', topic, ex, done, trace, facts);
  // c) not backed by the Book: official pages online (Meta web search finds candidates; our code checks and fetches them).
  const pages = await findOfficialPages(searchWeb, route.question, state, route.company_domain);
  trace.webSearched = pages.length;
  console.log('[book] specifics not in the Book: ' + pages.length + ' official page(s) found online'); // never the question
  if (pages.length) {
    const webEx = pages.map((p, i) => ({ id: 'web:' + i, kind: 'official source page: ' + (p.title || p.url), text: p.text,
      page: { name: p.title || p.url, url: p.url, fetched: p.fetched }, raw: p }));
    const all = ex.concat(webEx);
    const withWeb = await compose(ask, route.question, profile, facts, all);
    if (withWeb) {
      for (const id of withWeb.used) {   // official pages the answer stands on go into the Book
        const e = webEx.find(x => x.id === id);
        if (e) book.savePageTopic({ about: route.question, page: e.raw, sourceName: e.page.name, state: '' });
      }
      return finish(withWeb.used.length ? 'web' : 'knowledge', topic, all, withWeb, trace, facts);
    }
  }
  // d) nothing official to check against: still a real answer — with any unverified specific said plainly, never invented.
  if (!done) done = await compose(ask, route.question, profile, facts, []);
  if (done) return finish(done.used.length ? 'book' : 'knowledge', topic, ex, done, trace, facts);
  return { lane: 'fast', reply: await plainAnswer(), trace };   // the composing step failed: answer anyway (same honesty rules)
}

function finish(from, topic, extracts, done, trace, facts) {
  let reply = done.answer;
  const onlyBaseline = done.used.includes('baseline') && !done.used.some(id => id.startsWith('row:') || id.startsWith('page:') || id.startsWith('web:'));
  if (onlyBaseline && !reply.includes(BASELINE_LINE)) reply = reply.replace(/\s*$/, '') + ' ' + BASELINE_LINE;
  trace.usedNotebook = Math.min(facts.length, COMPOSE_FACTS);
  trace.usedBook = citations(topic, extracts, done.used.filter(id => !id.startsWith('web:'))).map(s => ({ name: s.name, url: s.url }));
  trace.usedWeb = citations(topic, extracts, done.used.filter(id => id.startsWith('web:'))).map(s => ({ name: s.name, url: s.url }));
  trace.unverified = !done.verified;
  return { lane: 'precise', from, reply, sources: citations(topic, extracts, done.used), trace };
}

module.exports = { answer, BASELINE_LINE, bookExtracts, citations };
