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
    user_notebook: memory.newestFirst(facts).slice(0, 50).map(f => f.text),
    extracts: extracts.map(e => ({ id: e.id, kind: e.kind, text: e.text.slice(0, 24000) }))
  };
  const out = parseJson(await askOrEmpty(ask, [{ role: 'system', content: memory.identityLines() + '\n\n' + COMPOSE_RULES },
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
async function answer({ ask, searchWeb, message, history, profile, facts, loops }) {
  const topics = book.listTopics();
  const route = await classify(ask, message, history, profile, topics);

  // 2. The answer lane: notebook + identity -> brain. Every question gets a real answer.
  const plainAnswer = async () => ask([
    { role: 'system', content: memory.buildChatSystem(profile, facts, loops || []) },
    ...history.slice(-6),
    { role: 'user', content: message }
  ]);
  if (route.lane === 'fast') return { lane: 'fast', reply: await plainAnswer() };

  // 3. High-stakes specifics: the same real answer, with each specific checked. a) notebook first (state, dates).
  const state = profile ? profile.state : '';
  // b) the Book.
  const topic = topics.find(t => t.id === route.topic) || null;
  const ex = bookExtracts(topic, state);
  let done = ex.length ? await compose(ask, route.question, profile, facts, ex) : null;
  if (done && done.verified) return finish('book', topic, ex, done);
  // c) not backed by the Book: official pages online (Meta web search finds candidates; our code checks and fetches them).
  const pages = await findOfficialPages(searchWeb, route.question, state, route.company_domain);
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
      return finish(withWeb.used.length ? 'web' : 'knowledge', topic, all, withWeb);
    }
  }
  // d) nothing official to check against: still a real answer — with any unverified specific said plainly, never invented.
  if (!done) done = await compose(ask, route.question, profile, facts, []);
  if (done) return finish(done.used.length ? 'book' : 'knowledge', topic, ex, done);
  return { lane: 'fast', reply: await plainAnswer() };   // the composing step failed: answer anyway (same honesty rules)
}

function finish(from, topic, extracts, done) {
  let reply = done.answer;
  const onlyBaseline = done.used.includes('baseline') && !done.used.some(id => id.startsWith('row:') || id.startsWith('page:') || id.startsWith('web:'));
  if (onlyBaseline && !reply.includes(BASELINE_LINE)) reply = reply.replace(/\s*$/, '') + ' ' + BASELINE_LINE;
  return { lane: 'precise', from, reply, sources: citations(topic, extracts, done.used) };
}

module.exports = { answer, BASELINE_LINE, bookExtracts, citations };
