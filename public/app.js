// SIM SIM page logic. This file never holds the API key: it only talks to OUR server at /api/chat.
const $ = id => document.getElementById(id);
const col = $('col'), thread = $('thread'), input = $('input'), sendBtn = $('send'), micBtn = $('mic');

let busy = false;        // waiting for the brain
// While busy, Send IS Stop (founder, 2026-10-31): chatAbort cancels the in-flight request,
// activeMsg is the "typing" bubble to clear, activeUnwatch stops a browser task's live polling of it.
let chatAbort = null;
let activeMsg = null;
let activeUnwatch = () => {};
const SEND_ARROW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const STOP_SQUARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>';
function setChatBusy(onOff) {
  sendBtn.classList.toggle('is-stop', onOff);
  sendBtn.innerHTML = onOff ? STOP_SQUARE_ICON : SEND_ARROW_ICON;
  sendBtn.setAttribute('aria-label', onOff ? 'Stop' : 'Send');
  sendBtn.title = onOff ? 'Stop' : 'Send';
}
// Clicking Send while busy: abort the request, stop speaking, clear the typing bubble to "Stopped.",
// and tell the server (fire-and-forget) so a stopped turn is never saved, spoken or shown if it lands late.
function stopChat() {
  if (!busy) return;
  if (chatAbort) chatAbort.abort();
  stopSpeaking();
  activeUnwatch();
  activeUnwatch = () => {};
  if (pending && pending.msg === activeMsg) pending = null;   // deliberately stopped: the watchdog must never revive it
  if (activeMsg) {
    const slot = activeMsg.querySelector('.txt');
    if (slot) slot.innerHTML = '<small class="stopped-line">Stopped.</small>';
    activeMsg = null;
  }
  busy = false;
  chatAbort = null;
  setChatBusy(false);
  idle();
  fetch('/api/chat/stop', { method: 'POST' }).catch(() => {});
}
let chatId = 0;          // bumps on "New chat" so a late reply never lands in a fresh chat
let threadId = null;     // the saved thread this chat belongs to; null = a new main thread starts with the next message
let threadKind = 'main'; // 'main' (the Chat) or 'side' (a side chat the user made — history.js lists them)
let threadTitle = '';    // a side chat's name, shown in the header while it is open
let subjectNext = false; // Sim Sim just asked "what should it show?" — the next message may be drawn
let speaking = null;     // the utterance being spoken (kept so Chrome doesn't drop its "done" signal)

// ---- Status pill: Listening for Sim Sim / Awake / Thinking / Speaking (+ mic states from wake.js) ----
function setPill(text, look) {           // look: '' (green), 'busy', 'awake' or 'warn'
  $('pillText').textContent = text;
  ['busy', 'awake', 'warn'].forEach(c => $('pill').classList.toggle(c, c === look));
}
// Back to resting: wake.js picks the right words (listening, off, mic blocked…), then may resume the doorman.
function idle() {
  if (window.SimSimWake) window.SimSimWake.paintIdle(); else setPill('Listening for Sim Sim');
  window.dispatchEvent(new Event('simsim:voicefree'));
}

// ---- Messages ----
function scrollDown() { thread.scrollTop = thread.scrollHeight; }
function hideEmpty() { const e = $('empty'); if (e) e.hidden = true; }

// Message times, WhatsApp-style (founder, 2026-10-31; 1-on-1 chat only — Discussion never calls these).
// The viewer's own local clock, hour:minute + AM/PM. ms: a real timestamp (now, live; or a stored `at`, for history).
// No valid timestamp -> no time shown, ever (never invented).
function timeLabel(ms) {
  if (typeof ms !== 'number' || isNaN(ms)) return null;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
// The WhatsApp placement fix (founder, 2026-10-31): the time must land INSIDE the last line of actual text — the
// last <p> or <li> if the content has one (renderRich wraps every line of a Sim Sim answer in its own <p>) — so it
// shares that line's own inline flow and wraps with it. Appended as a plain sibling after a <p> it floated to the
// top of the next "row" with nothing to wrap around, which is what crowded the bubble's bottom border. A user
// bubble has no such wrapper (just the text node), so it falls through to the plain append — already correct.
function stampTime(el, ms) {
  const label = timeLabel(ms);
  if (!label) return;
  const t = document.createElement('small');
  t.className = 'msg-time';
  t.textContent = label;
  let target = el.lastElementChild;
  if (target && (target.tagName === 'UL' || target.tagName === 'OL')) target = target.lastElementChild;
  if (target && (target.tagName === 'P' || target.tagName === 'LI')) target.appendChild(t);
  else el.appendChild(t);
}
// Sim Sim's bubble: the time goes inside .txt (the bubble itself), added once the real content is in place.
function stampMsgTime(msg, ms) {
  const slot = msg.querySelector('.txt');
  if (slot) stampTime(slot, ms);
}

// quote: { who, text } — the message this one replies to (shown on top of the bubble; presentation only)
// voice: { src, transcript } — a voice note: an audio player, with what Sim Sim heard (or that it heard nothing) under it
// atMs: when this message was sent — now, for a message just typed; the stored `at`, for history (loadThread)
function addUser(text, pictureUrl, quote, voice, atMs) {
  const d = document.createElement('div');
  d.className = 'user';
  if (quote) d.appendChild(quoteBlock(quote));
  if (voice) {
    d.classList.add('voice-msg');
    const a = document.createElement('audio');
    a.controls = true; a.preload = 'metadata'; a.src = voice.src;
    a.setAttribute('aria-label', 'Your voice note');
    const cap = document.createElement('small');
    cap.className = 'vn-transcript';
    cap.textContent = voice.transcript ? '“' + voice.transcript + '”' : 'Voice note — no words were picked up';
    d.append(a, cap);
    stampTime(d, atMs);
    col.appendChild(d);
    addOptions(d, 'You', voice.transcript || 'Voice note');
    scrollDown();
    return d;
  }
  if (pictureUrl) {   // the picture shown in your own bubble (from this browser; the server does not keep it)
    const img = document.createElement('img');
    img.className = 'user-pic';
    img.src = pictureUrl;
    img.alt = 'Picture you shared';
    img.addEventListener('load', scrollDown);
    d.appendChild(img);
  }
  if (text) d.appendChild(document.createTextNode(text));
  stampTime(d, atMs);
  col.appendChild(d);
  addOptions(d, 'You', text);
  scrollDown();
  return d;
}

// The side option cluster on every chat message (reactions.js): React · Reply · More (Share, Copy, Delete).
// Reply and More work at once; React (and Delete on your own message) switch on when the message is saved and has its id.
function addOptions(el, who, text, pictureUrl) {
  if (!window.SimSimReact) return;
  window.SimSimReact.attach(el, { who, text: () => text, picture: pictureUrl ? () => pictureUrl : null, onReply: startReply });
}
function attachActions(el, tid, mid, reaction, mine) {
  if (!window.SimSimReact || !el._opts || !tid || !mid) return;
  const api = window.SimSimReact.post;
  el._opts.update({
    current: reaction || null,
    send: emoji => api('/api/chats/react', { threadId: tid, messageId: mid, emoji }),
    onDelete: mine ? () => api('/api/chats/delete-message', { threadId: tid, messageId: mid }) : null
  });
}

// ---- Reply: the chosen message rides above the composer, then on top of the sent bubble ----
// Presentation only: the quote is shown (and kept with the saved message for display) but never reaches the brain,
// the notebook or learning.
const QUOTE_SHOW = 140;
let replyTo = null;   // { who, text }
const cut = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
function quoteBlock(q) {
  const b = document.createElement('div');
  b.className = 'quote';
  const who = document.createElement('b');
  who.textContent = q.who === 'You' ? 'You' : q.who;
  const t = document.createElement('span');
  t.textContent = cut(q.text, QUOTE_SHOW);
  b.append(who, t);
  return b;
}
function startReply(who, text) {
  replyTo = { who, text: cut(text, 300) };
  $('replyWho').textContent = 'Replying to ' + (who === 'You' ? 'yourself' : who) + ': ';
  $('replyText').textContent = '“' + cut(text, QUOTE_SHOW) + '”';
  $('replyBar').hidden = false;
  input.focus();
}
function clearReply() {
  replyTo = null;
  $('replyBar').hidden = true;
}
$('replyCancel').addEventListener('click', () => { clearReply(); input.focus(); });

// ---- Answer formatting (founder, 2026-10-30): ``` fenced blocks become real code blocks, EACH with its own working Copy
// button; also `inline code`, **bold**, lists and line breaks. Safe by construction: the text only ever goes into
// textContent / text nodes — the brain's words are never put into the page as HTML. Display only: the saved text, the
// side menu's Copy and Share, and speech all use the original words. Shared by the 1-on-1 chat and Discussion.
function inline(parent, text) {
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|(?<![\w*])\*[^*\s][^*\n]*?\*(?![\w*]))/g;   // `code`, **bold**, *italic*
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
    const kind = m[0][0] === '`' ? 'code' : m[0].startsWith('**') ? 'strong' : 'em';
    const el = document.createElement(kind);
    el.textContent = kind === 'code' ? m[0].slice(1, -1) : kind === 'strong' ? m[0].slice(2, -2) : m[0].slice(1, -1);
    parent.append(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}
// Prose flows as paragraphs, separated by a blank line — the way chat apps render text (founder, 2026-11-01: this
// used to make a new <p> for every source line, so a paragraph the brain wrote across several unblanked lines
// (common — some answers join sentences with spaces on one line, others spread them over consecutive lines with
// no blank line between) rendered as one block per LINE instead of per paragraph: "one sentence per line".
// Consecutive plain lines are now joined (with a space) into ONE paragraph; a blank line is still what starts a
// new one. Lists, headings, and code blocks (handled by renderRich, not here) are unchanged.
function prose(slot, text) {
  let list = null, para = [];
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    inline(p, para.join(' '));
    slot.append(p);
    para = [];
  };
  text.split('\n').forEach(line => {
    const item = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const kind = item[1] ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== kind) { list = document.createElement(kind); if (item[1] && item[1] !== '1') list.start = Number(item[1]); slot.append(list); }
      const li = document.createElement('li'); inline(li, item[2]); list.append(li);
      return;
    }
    list = null;
    if (!line.trim()) {
      flushPara();
      if (slot.lastChild && slot.lastChild.className !== 'gap') slot.append(Object.assign(document.createElement('div'), { className: 'gap' }));
      return;
    }
    const h = line.match(/^\s*#{1,4}\s+(.*)$/);
    if (h) {
      flushPara();
      const p = document.createElement('p');
      const b = document.createElement('strong'); inline(b, h[1]); p.append(b);
      slot.append(p);
      return;
    }
    para.push(line.trim());
  });
  flushPara();
}
function codeBlock(code, lang) {
  const box = document.createElement('div');
  box.className = 'code-block';
  const head = document.createElement('div');
  head.className = 'code-head';
  const label = document.createElement('span');
  label.textContent = lang || 'text';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'code-copy'; btn.textContent = 'Copy';
  btn.setAttribute('aria-label', 'Copy this block');
  btn.addEventListener('click', async () => {
    const ok = window.SimSimReact ? await window.SimSimReact.copyText(code) : false;   // EXACTLY this block's text
    btn.textContent = ok ? 'Copied' : "Couldn't copy";
    clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
  });
  head.append(label, btn);
  const pre = document.createElement('pre');
  const c = document.createElement('code');
  c.textContent = code;
  pre.append(c);
  box.append(head, pre);
  return box;
}
function renderRich(slot, text) {
  slot.replaceChildren();
  slot.classList.add('rich');
  const fence = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
  let last = 0, m;
  while ((m = fence.exec(text))) {
    if (m.index > last) prose(slot, text.slice(last, m.index).replace(/^\n+|\n+$/g, ''));
    slot.append(codeBlock(m[2].replace(/\n$/, ''), m[1]));
    last = fence.lastIndex;
  }
  if (last < text.length) prose(slot, text.slice(last).replace(/^\n+|\n+$/g, ''));
  while (slot.firstChild && slot.firstChild.className === 'gap') slot.firstChild.remove();
  while (slot.lastChild && slot.lastChild.className === 'gap') slot.lastChild.remove();
}
// What is SPOKEN of a formatted answer: no symbols, and a block is not read out character by character.
function speakable(text) {
  return String(text).replace(/```[\s\S]*?(?:```|$)/g, ' I put it in a box you can copy. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\s][^*]*)\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^\s*#{1,4}\s+/gm, '').replace(/^\s*[-*•]\s+/gm, '');
}

// Adds a Sim Sim message with a typing indicator; returns the text slot to fill in later.
// name/pick: a Discussion pick written back into the main chat (founder, 2026-11-01) shows the BOT's name and a
// quiet "Discussion pick" mark, instead of the default "Sim Sim" — the only caller that ever passes these is loadThread.
function addSim(name, pick) {
  const d = document.createElement('div');
  d.className = 'msg';
  d.innerHTML = '<span class="avatar" aria-hidden="true">S</span><div class="body"><div class="name"></div>' +
    '<div class="txt"><span class="typing" aria-label="Sim Sim is thinking"><span></span><span></span><span></span></span></div></div>';
  const nameEl = d.querySelector('.name');
  nameEl.textContent = name || 'Sim Sim';
  if (pick) { const b = document.createElement('span'); b.className = 'pick-badge'; b.textContent = 'Discussion pick'; nameEl.append(' ', b); }
  col.appendChild(d);
  scrollDown();
  return d;
}

// ---- Sending ----
// THE one way the page talks to /api/chat (main chat and the Screen Watch mini chat both use it).
// extra: viaWake (wake-by-name), picture (a data URL: a shared picture or a screen snapshot), screen, circled (Freeze & Ask),
// thread ('new' or a saved thread id: the turn is saved to that chat — the Screen Watch mini chat sends none),
// quote (Reply: kept with the saved message for display only)
// The browser's own IANA timezone (e.g. "America/Boise"), sent with every chat so the brain can answer "what time
// is it" in the SAME clock the message bubbles already show (founder, 2026-10-31) — read once, never cached stale
// across a trip (DST, travel): Intl reports the current setting fresh each call.
function myTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; }
}
async function postChat(text, extra) {
  const x = extra || {};
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: x.signal,   // the main composer's Stop (Screen Watch and Discussion never pass one)
    body: JSON.stringify(Object.assign({ message: text, tz: myTimezone() }, x.viaWake ? { viaWake: true } : {}, x.picture ? { image: x.picture } : {},
      x.screen ? { screen: true } : {}, x.circled ? { circled: true } : {}, x.thread ? { thread: x.thread } : {}, x.quote ? { quote: x.quote } : {},
      x.voice ? { voice: x.voice } : {}))
  });
  return { r, data: await r.json().catch(() => ({})) };
}
// The live view must never show a failure the server didn't confirm, and never spin forever (founder's end-check,
// round 6, 2026-11-02, and round 6B, the same day: a true live-delivery bug, reproduced on Main-chat picture
// operations — the backend answered correctly, in seconds, and saved it; the open tab just never rendered it).
// Round 6's first attempt tied the ceiling to the ONE in-flight fetch's own await chain (racing it against a
// setTimeout inside send()'s own try/catch) — live re-verification showed that still sat past 60s with neither the
// try-again line nor a reconciled result, for the SECOND pair of messages in the same session; only a later,
// unrelated view of Main chat ever picked up the finished edit. Whatever made that specific await-chain unreliable
// a minute into a session (never fully pinned down — the server-side half was always correct), a watchdog tied to
// THAT SAME call's own lifecycle inherits the same risk. Round 6B decouples the two completely: a single global
// ticking check, independent of any one send() call's promise chain, watches whatever is pending by WALL-CLOCK time
// alone — it keeps working even if the original fetch, or the code awaiting it, never resolves at all.
const LIVE_CEILING_MS = 45000;
const STUCK_LINE = 'That took too long — try again.';
const WATCHDOG_TICK_MS = 5000;
async function fetchTail(tid) {
  try {
    const r = await fetch('/api/chats/tail?id=' + encodeURIComponent(tid), { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
// The one message currently waiting on a reply, watched by wall-clock time alone — never by anything tied to the
// fetch that started it. knownMids: every message id already on screen before this turn, so the user's own bubble
// (saved server-side with a real id it doesn't have yet) is never rendered a second time if reconciliation runs.
let pending = null;   // { msg, slot, sentAt, myChat, knownMids, stuck, reconciling }
// Ticks every WATCHDOG_TICK_MS AND on window focus (so coming back to the tab checks right away, not on the next
// scheduled tick) — not triggered by, or dependent on, the user doing anything else at all.
function checkPending() {
  if (!pending) return;
  const p = pending;
  if (!p.msg.isConnected || p.myChat !== chatId) { pending = null; return; }   // the view moved on: stop watching
  if (Date.now() - p.sentAt < LIVE_CEILING_MS) return;
  if (!p.stuck) {
    p.stuck = true;
    p.slot.textContent = STUCK_LINE;
    stampMsgTime(p.msg, Date.now());
    if (activeMsg === p.msg) { busy = false; chatAbort = null; setChatBusy(false); activeMsg = null; idle(); }
  }
  reconcileNow(p);
}
// A response the live channel dropped (or declared "stuck" too early) is still sitting in storage the moment the
// server finishes — reconciling means reading THAT, the same way a reload would, instead of ever guessing.
async function reconcileNow(p) {
  if (p.reconciling || pending !== p) return;   // one check at a time; also stops once something else resolves this
  p.reconciling = true;
  try {
    let tid = threadId;
    if (!tid) {   // a brand-new chat whose very first reply never landed: find it by kind (main vs a newly named side)
      try { const list = await fetch('/api/chats', { cache: 'no-store' }).then(r => r.json()); tid = (list.chats || []).find(c => c.kind === threadKind)?.id; }
      catch (e) {}
    }
    if (!tid || pending !== p) return;
    const t = await fetchTail(tid);
    if (!t || pending !== p) return;
    const fresh = t.messages.filter(m => !p.knownMids.has(m.id) && Date.parse(m.at) >= p.sentAt - 2000);
    if (!fresh.length || !p.msg.isConnected) return;
    p.msg.remove();
    fresh.forEach(m => renderSavedMessage(t, m));
    scrollDown();
    pending = null;
  } finally { p.reconciling = false; }
}
setInterval(checkPending, WATCHDOG_TICK_MS);
window.addEventListener('focus', checkPending);

// opts.viaWake: the message came from wake-by-name (the server uses it for "good morning" briefings)
// opts.picture: { dataUrl, previewUrl } — a picture to show Sim Sim with this message (1-on-1 chat only)
// opts.quote: { who, text } — the message this one replies to (Reply)
async function send(text, opts) {
  const quote = opts && opts.quote;
  if (window.SimSimGroup && window.SimSimGroup.isOpen()) { window.SimSimGroup.ask(text, quote); return; } // Group Chat open: a group question
  // Watching the screen: spoken commands go to the mini chat ("Sim Sim, look at this" takes a fresh snapshot)
  if (opts && opts.viaWake && window.SimSimScreen && window.SimSimScreen.isWatching()) { window.SimSimScreen.voice(text); return; }
  if (busy) return;
  busy = true; chatAbort = new AbortController(); setChatBusy(true);
  const myChat = chatId;
  const picture = opts && opts.picture;
  stopSpeaking();
  hideEmpty();
  cancelCards('Cancelled — you sent a new message.');   // the server drops the held action too: it never fires later
  const voiceNote = opts && opts.voiceNote;   // { dataUrl, url, transcript } — an existing voice note already in a thread
  const sentAt = Date.now();
  // Every message already on screen, before this turn's own two bubbles exist — reconcileNow()'s guide to what's
  // genuinely NEW if the live view has to fall back to reading storage directly.
  const knownMids = new Set([...col.querySelectorAll('[data-mid]')].map(e => e.dataset.mid));
  const you = voiceNote ? addUser('', null, quote, { src: voiceNote.url, transcript: voiceNote.transcript }, sentAt) : addUser(text, picture && picture.previewUrl, quote, null, sentAt);
  setPill('Thinking', 'busy');
  const msg = addSim(), slot = msg.querySelector('.txt');
  activeMsg = msg;
  // Image lane: show a soft "Drawing…" placeholder (the server makes the real decision) — for a request with a subject,
  // or for the answer to "what should it show?".
  const intent = window.SimSimImageIntent;
  // An edit (a change instruction with a picture attached or already in this chat) shows "Editing…".
  const editing = intent && intent.editRequest(text) && (picture || col.querySelector('.user-pic, .img-card img'));
  const drawing = !editing && intent && ((intent.imageRequest(text) || {}).subject || (subjectNext && intent.subjectReply(text)));
  subjectNext = false;
  if (editing || drawing) {
    const word = editing ? 'Editing' : 'Drawing';
    slot.innerHTML = '<div class="drawing" aria-label="Sim Sim is ' + word.toLowerCase() + '"><span>' + word + '…</span></div>';
  }
  // Watched by the global watchdog (checkPending/setInterval, above) from the moment the placeholder appears —
  // by wall-clock time alone, never by this call's own fetch settling. myPending is this turn's own identity:
  // if something else (the watchdog reconciling, or a newer message replacing it) has already resolved `pending`
  // by the time this call's own await comes back — however late — that result is a no-op below, never a double-render.
  const myPending = pending = { msg, slot, sentAt, myChat, knownMids, stuck: false, reconciling: false };

  let reply = null, error = null, signedOut = false, stopped = false, turnId = null, memoryChanged = false, image = null, sources = null, guardian = null, loopsChanged = false, receipt = null, saved = null, browsed = false, docFile = null, siteFile = null, effects = [], card = null;
  // a browser task narrates itself in this bubble ("Opening weather.gov…", with Stop) while it works
  const unwatch = window.SimSimBrowser ? window.SimSimBrowser.watch(slot) : () => {};
  activeUnwatch = unwatch;
  try {
    const { r, data } = await postChat(text, { viaWake: opts && opts.viaWake, picture: picture && picture.dataUrl, thread: threadId || 'new', quote,
      voice: voiceNote ? { audio: voiceNote.dataUrl, transcript: voiceNote.transcript } : null, signal: chatAbort.signal });
    if (r.status === 401) signedOut = true;
    else if (r.ok && typeof data.reply === 'string') { reply = data.reply; turnId = data.turnId || null; memoryChanged = !!data.memoryChanged; image = data.image || null; sources = data.sources || null; browsed = data.browser === true; docFile = data.document || null; siteFile = data.website || null;
      if (data.remindersChanged) window.dispatchEvent(new Event('simsim:reminderschanged'));   // a reminder was set: the lists update
      subjectNext = data.askSubject === true && myChat === chatId;
      receipt = data.receipt || null;
      if (data.threadId && data.messageIds) saved = { tid: data.threadId, ids: data.messageIds };
      guardian = data.guardian || null; loopsChanged = !!data.loopsChanged;
      if (data.threadId) { if (myChat === chatId) threadId = data.threadId; window.dispatchEvent(new Event('simsim:chatsaved')); }
      if (data.retitle && myChat === chatId) { setTitle(data.retitle); window.dispatchEvent(new Event('simsim:chatsaved')); }   // "name it Rasputin": the header AND the sidebar follow
      // the Action Layer: what Sim Sim did in the app rides the reply (effects), and a held action brings its allowance card
      effects = Array.isArray(data.effects) ? data.effects : [];
      card = data.pendingAction || null;
      if (myChat === chatId) markConverted(effects);   // before the sidebar refresh, so the header and the lit row follow
      if (data.pictureNote) reply = data.pictureNote + '\n\n' + reply; }   // the picture could not be sent: say so plainly
    else error = data.error || 'Sim Sim could not get an answer.';
  } catch (e) {
    if (e.name === 'AbortError') stopped = true;   // stopChat() already cleared the bubble and the busy state
    else error = 'Could not reach the Sim Sim server. Is it still running?';
  }

  unwatch();
  activeUnwatch = () => {};
  // Settled on this call's own fetch, not the watchdog: stop watching it here. If `pending` had already moved on
  // (the watchdog's reconcileNow() resolved it, or the user sent a newer message), this result is stale — never a
  // double-render, whatever it is, even a real, late success: the watchdog already rendered the true result
  // straight from storage, byte-identical to this one.
  const stale = pending !== myPending;
  if (!stale) pending = null;
  if (stopped) return;   // nothing left to show: the user's own Stop already did it
  if (stale) return;
  busy = false; chatAbort = null; setChatBusy(false); activeMsg = null;
  if (signedOut) { window.dispatchEvent(new Event('simsim:needsignin')); return; } // back to the sign-in screen
  if (myChat !== chatId) { idle(); return; } // user started a new chat meanwhile
  if (reply !== null && landAfterAction(effects, reply)) return;   // a new side chat / another chat opened, or this one deleted
  if (reply !== null) addOptions(msg, 'Sim Sim', reply, image && image.url);
  if (saved) { attachActions(you, saved.tid, saved.ids.user, null, true); attachActions(msg, saved.tid, saved.ids.reply, null, false); }
  if (reply !== null && image) {
    showImage(slot, image, reply);
    stampMsgTime(msg, Date.now());
    addReceipt(msg, receipt);
    speak(reply);
  } else if (reply !== null) {
    if (guardian) {   // the deadline guardian's one gentle line comes first, as its own little message
      const g = addSim();
      g.querySelector('.txt').textContent = guardian;
      g.classList.add('guardian');
      stampMsgTime(g, Date.now());
      col.insertBefore(g, msg);
      addOptions(g, 'Sim Sim', guardian);
    }
    renderRich(slot, reply);
    stampMsgTime(msg, Date.now());
    if (card) addActionCard(msg, card);       // "Sim Sim wants to: …" — Allow / Always allow / Not now
    applyEffects(effects);
    if (docFile) addDocument(msg, docFile);   // the real file: its card with Download (sent only once the file exists)
    if (siteFile) addWebsite(msg, siteFile);   // a real, working page: its card with Open/Download (sent only once the file exists)
    if (sources && sources.length) addCitation(msg, sources, browsed);   // answers from the Book (or Sim Sim's browser) show where they came from
    addReceipt(msg, receipt);
    scrollDown(); speak(guardian ? guardian + ' ' + reply : reply);
    if (loopsChanged) window.dispatchEvent(new Event('simsim:loopschanged'));
    if (turnId && window.SimSimMemory) window.SimSimMemory.learnFrom(turnId, msg);   // quiet "Remembered:" chips, if any
    if (memoryChanged && window.SimSimMemory) window.SimSimMemory.refreshIfOpen();
  }
  else { msg.classList.add('error'); slot.textContent = error || 'Sim Sim could not get an answer.'; scrollDown(); idle(); }
}

// ---- The Action Layer on the page: what Sim Sim did in the app (effects) and its allowance cards ----
// "make a side chat for this": the conversation itself is now a side chat — the user stays in it, under its name.
function markConverted(effects) {
  const c = effects.find(e => e.type === 'converted' && e.id === threadId);
  if (c) { threadKind = 'side'; setTitle(c.title); window.dispatchEvent(new Event('simsim:threadchanged')); }
  const r = effects.find(e => e.type === 'retitle' && e.id === threadId);
  if (r) setTitle(r.title);
}
// A new side chat / another chat opened: the page moves there, the line shown inside it. This chat deleted: back to the
// main Chat (history.js). Returns true when the page moved.
function landAfterAction(effects, reply) {
  const open = effects.find(e => e.type === 'openThread'), gone = effects.find(e => e.type === 'threadDeleted');
  if (!open && !gone) return false;
  if (open) { window.SimSimSetup.showChat(); loadThread(open.chat); addSimText(reply); }
  else window.dispatchEvent(new CustomEvent('simsim:gomain', { detail: { note: reply } }));
  speak(reply);
  applyEffects(effects.filter(e => e !== open && e !== gone));
  window.dispatchEvent(new Event('simsim:chatsaved'));   // the sidebar follows
  return true;
}
// Opening a view by ASKING (founder, 2026-11-01): calls the view's own module directly — never a simulated click on a
// nav button — because that used to be unreliable two ways: (1) Settings' button TOGGLES (open/close), so a blind
// click could close it instead of opening it if it was already open; (2) the sidebar's "Browser" row was removed in
// an earlier build, so that lookup by label silently found nothing and the Browser view never opened at all. Each
// opener below is idempotent (never closes what's already open) and reports isOpen() so the result can be verified.
const VIEW_OPENERS = {
  discussion: { open: () => window.SimSimGroup && window.SimSimGroup.show(), isOpen: () => !!window.SimSimGroup && window.SimSimGroup.isOpen() },
  briefing: { open: () => window.SimSimBriefing && window.SimSimBriefing.show(), isOpen: () => !!window.SimSimBriefing && window.SimSimBriefing.isOpen() },
  loops: { open: () => window.SimSimLoops && window.SimSimLoops.show(), isOpen: () => !!window.SimSimLoops && window.SimSimLoops.isOpen() },
  pictures: { open: () => window.SimSimPictures && window.SimSimPictures.show(), isOpen: () => !!window.SimSimPictures && window.SimSimPictures.isOpen() },
  browser: { open: () => window.SimSimBrowser && window.SimSimBrowser.open(), isOpen: () => !!window.SimSimBrowser && window.SimSimBrowser.isOpen() },
  settings: { open: () => window.SimSimSettings && window.SimSimSettings.show(), isOpen: () => !!window.SimSimSettings && window.SimSimSettings.isOpen() },
  profile: { open: () => window.SimSimSetup && window.SimSimSetup.openProfile && window.SimSimSetup.openProfile(), isOpen: () => !!window.SimSimSetup && window.SimSimSetup.isProfileOpen && window.SimSimSetup.isProfileOpen() }
};
// Opens the view, then checks it actually did — a view whose module hasn't finished loading yet (or any other miss)
// gets ONE retry, so the confirmation depends on the view really being shown, not just on the call being made.
function openAppView(view, retried) {
  const o = VIEW_OPENERS[view];
  if (!o) return;
  o.open();
  setTimeout(() => {
    if (!o.isOpen() && !retried) openAppView(view, true);
    else if (!o.isOpen()) console.warn('[view] "' + view + '" did not open after a retry');
  }, 200);
}
function applyEffects(effects) {
  effects.forEach(e => {
    if (e.type === 'profile' && window.SimSimSetup) window.SimSimSetup.setProfile(e.profile);   // theme + faces repaint everywhere
    if (e.type === 'settings') window.dispatchEvent(new CustomEvent('simsim:settingschanged', { detail: e.settings }));
    if (e.type === 'voices') window.dispatchEvent(new Event('simsim:voiceschanged'));
    if (e.type === 'permissions') window.dispatchEvent(new CustomEvent('simsim:permissionschanged', { detail: e.permissions }));
    if (e.type === 'loops') window.dispatchEvent(new Event('simsim:loopschanged'));
    if (e.type === 'memory' && window.SimSimMemory) window.SimSimMemory.refreshIfOpen();
    if (e.type === 'converted' || e.type === 'retitle') window.dispatchEvent(new Event('simsim:chatsaved'));
    if (e.type === 'view' && VIEW_OPENERS[e.view]) setTimeout(() => openAppView(e.view), 900);   // a moment to read the line first
  });
}
// The allowance card, inside the chat: "Sim Sim wants to: …" — Allow · Always allow <Group> · Not now (floor actions: no "Always").
function addActionCard(msg, card) {
  const box = document.createElement('div');
  box.className = 'act-card';
  const p = document.createElement('p');
  const lead = document.createElement('b'); lead.textContent = 'Sim Sim wants to: ';
  p.append(lead, document.createTextNode(card.text));
  const row = document.createElement('div');
  row.className = 'act-btns';
  const btn = (label, choice, cls) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label;
    b.addEventListener('click', () => decide(box, card, choice, label));
    return b;
  };
  row.append(btn('Allow', 'allow', 'btn-primary'));
  if (!card.floor) row.append(btn('Always allow ' + card.groupName, 'always', 'ghost-btn'));
  row.append(btn('Not now', 'deny', 'textlink'));
  const note = document.createElement('small');
  note.className = 'act-note';
  note.textContent = card.floor ? "This one always asks — it can't be turned off." : 'Change what Sim Sim may do in Settings → Permissions.';
  box.append(p, row, note);
  msg.querySelector('.txt').after(box);
  scrollDown();
}
function closeCard(box, text) {
  box.classList.add('decided');
  box.querySelectorAll('button').forEach(b => { b.disabled = true; });
  box.querySelector('.act-note').textContent = text;
}
function cancelCards(text) { col.querySelectorAll('.act-card:not(.decided)').forEach(b => closeCard(b, text)); }
async function decide(box, card, choice, label) {
  if (box.classList.contains('decided')) return;
  closeCard(box, choice === 'deny' ? 'You chose Not now.' : 'You chose ' + label + '.');
  const myChat = chatId;
  setPill('Thinking', 'busy');
  let d = null, err = null;
  try {
    const r = await fetch('/api/actions/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: card.id, choice }) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); return; }
    d = await r.json().catch(() => ({}));
    if (!r.ok) err = d.error || 'That did not work. Please try again.';
  } catch (e) { err = 'Could not reach the Sim Sim server. Is it still running?'; }
  if (myChat !== chatId) { idle(); return; }
  if (err) { box.querySelector('.act-note').textContent = err; idle(); return; }
  const effects = Array.isArray(d.effects) ? d.effects : [];
  markConverted(effects);
  if (landAfterAction(effects, d.reply)) return;
  const msg = addSim(), slot = msg.querySelector('.txt');
  renderRich(slot, d.reply);
  if (d.pendingAction) addActionCard(msg, d.pendingAction);
  addReceipt(msg, d.receipt);
  addOptions(msg, 'Sim Sim', d.reply);
  if (d.threadId && d.messageId) attachActions(msg, d.threadId, d.messageId, null, false);
  applyEffects(effects);
  scrollDown(); speak(d.reply);
}

// The citation card: the official source(s) a precise answer came from, with the date the Book fetched them.
// browsed: the pages came from Sim Sim's own browser — their links open THERE (the Browser panel), never in the user's Chrome.
function addCitation(msg, sources, browsed) {
  const card = document.createElement('div');
  card.className = 'cite';
  const lbl = document.createElement('div');
  lbl.className = 'lbl';
  lbl.textContent = sources.length > 1 ? 'Sources' : 'Source';
  card.appendChild(lbl);
  sources.forEach(s => {
    const row = document.createElement('div');
    row.className = 'cite-row';
    const a = document.createElement('a');
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener';
    if (browsed && window.SimSimBrowser) window.SimSimBrowser.inSimSim(a, s.url);
    a.textContent = s.name;
    const d = new Date(s.fetched + 'T12:00:00');
    const when = document.createElement('small');
    when.textContent = 'Fetched ' + (isNaN(d) ? s.fetched : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    row.append(a, when);
    card.appendChild(row);
  });
  msg.querySelector('.body').appendChild(card);
}

// Answer footer: the timing ONLY (founder, 2026-10-31 — "How I answered" removed, the timing stays).
// Visual only: speak() never reads it.
function receiptFooter(receipt) {
  if (!receipt || typeof receipt.ms !== 'number') return null;
  const el = document.createElement('div');
  el.className = 'receipt-line';
  el.textContent = 'Answered in ' + (receipt.ms < 100 ? 'under 0.1s' : (receipt.ms / 1000).toFixed(1) + 's');
  return el;
}
function addReceipt(msg, r) {
  const el = receiptFooter(r);
  if (el) msg.querySelector('.body').appendChild(el);
}
// No-op: memory.js still calls this after learning from a turn. There is no steps UI to add to any more
// (the "How I answered" toggle/body is gone), but the call must stay harmless so the loop-chip code after it still runs.
function addReceiptSteps() {}

// A PDF Sim Sim made (the Document Lane): title, size, and a Download button. The file is served only to its owner.
function addDocument(msg, doc) {
  if (!doc || typeof doc.url !== 'string' || !/^\/api\/documents\/[\w-]+\.pdf$/.test(doc.url)) return;
  // (Open shows it in Sim Sim's full view; Download saves it)
  const card = document.createElement('div');
  card.className = 'doc-card';
  const icon = document.createElement('span');
  icon.className = 'doc-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = 'PDF';
  const info = document.createElement('div');
  info.className = 'doc-info';
  const title = document.createElement('b');
  title.textContent = doc.title + '.pdf';
  const size = document.createElement('small');
  size.textContent = doc.bytes >= 1048576 ? (doc.bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(doc.bytes / 1024)) + ' KB';
  info.append(title, size);
  const dl = document.createElement('a');
  dl.className = 'mini-btn'; dl.href = doc.url; dl.textContent = 'Download';
  dl.download = (doc.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document') + '.pdf';
  // Open: the PDF's pages inside Sim Sim (the browser's own PDF reader, on the owner-only address), no download first
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'mini-btn on'; open.textContent = 'Open';
  open.addEventListener('click', () => window.SimSimMedia && window.SimSimMedia.open({ kind: 'pdf', url: doc.url + '?view=1', title: doc.title + '.pdf', download: { url: doc.url, name: dl.download } }));
  card.append(icon, info, open, dl);
  msg.querySelector('.body').appendChild(card);
}

// A real, working web page Sim Sim made (the Website Lane): title, size, Open (the sandboxed viewer) and Download.
// The file is served only to its owner; opened directly it still carries the sandbox CSP header (server.js).
function addWebsite(msg, site) {
  if (!site || typeof site.url !== 'string' || !/^\/api\/websites\/[\w-]+\.html$/.test(site.url)) return;
  const card = document.createElement('div');
  card.className = 'doc-card';
  const icon = document.createElement('span');
  icon.className = 'doc-icon web'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = 'WEB';
  const info = document.createElement('div');
  info.className = 'doc-info';
  const title = document.createElement('b');
  title.textContent = site.title;
  const size = document.createElement('small');
  size.textContent = site.bytes >= 1048576 ? (site.bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(site.bytes / 1024)) + ' KB';
  info.append(title, size);
  const dl = document.createElement('a');
  dl.className = 'mini-btn'; dl.href = site.url + '?dl=1'; dl.textContent = 'Download';
  dl.download = (site.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'website') + '.html';
  // Open: the real page, sandboxed, inside Sim Sim's full view — it scrolls and its buttons work, cut off from the app
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'mini-btn on'; open.textContent = 'Open';
  open.addEventListener('click', () => window.SimSimMedia && window.SimSimMedia.open({ kind: 'website', url: site.url, title: site.title, download: { url: dl.href, name: dl.download } }));
  card.append(icon, info, open, dl);
  msg.querySelector('.body').appendChild(card);
}

// A picture from Muse Image, in a card, with our one-line caption and a Download button.
function showImage(slot, image, line) {
  const card = document.createElement('figure');
  card.className = 'img-card';
  const img = document.createElement('img');
  img.src = image.url;
  img.alt = 'Picture of ' + image.subject;
  img.addEventListener('load', scrollDown);
  img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('p'), { className: 'img-gone', textContent: 'This picture was deleted.' })); });
  const cap = document.createElement('figcaption');
  cap.textContent = line;
  const dl = document.createElement('a');
  dl.className = 'mini-btn';
  dl.href = image.url;
  dl.download = 'sim-sim-' + (image.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'picture') + '.png';
  dl.textContent = 'Download';
  // tapping the picture OPENS it full size inside Sim Sim (media.js), with Download and Close
  img.className = 'img-open';
  img.tabIndex = 0;
  img.setAttribute('role', 'button');
  img.setAttribute('aria-label', 'Open the picture full size');
  const openFull = () => window.SimSimMedia && window.SimSimMedia.open({ kind: 'image', url: image.url, title: 'Picture of ' + image.subject, download: { url: image.url, name: dl.download } });
  img.addEventListener('click', openFull);
  img.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFull(); } });
  const row = document.createElement('div');
  row.className = 'img-row';
  row.append(cap, dl);
  card.append(img, row);
  slot.replaceChildren(card);
  scrollDown();
}

// ---- Message boxes (main chat, Discussion, Screen Watch mini chat): the SAME rule everywhere ----
// Enter alone sends; Shift+Enter makes a new line. The box is one line when empty and grows with the text
// up to its CSS max-height, then scrolls inside. Returns fit(), to call after the text is changed by code.
function composer(box, form) {
  const fit = () => {
    box.style.height = 'auto';
    if (!box.offsetWidth) { box.style.height = ''; return; }   // hidden right now: back to one line, measured when shown
    box.style.height = box.scrollHeight + box.offsetHeight - box.clientHeight + 'px';
    // a scrollbar only once the text is taller than the box's max height (never for a line or two)
    box.style.overflowY = box.scrollHeight > parseFloat(getComputedStyle(box).maxHeight) ? 'auto' : 'hidden';
  };
  box.addEventListener('input', fit);
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  return fit;
}
const fitInput = composer(input, $('form'));

$('form').addEventListener('submit', e => {
  e.preventDefault();
  // While busy, Send IS Stop (founder, 2026-10-31): a real click on the button stops it; Enter (no submitter) is inert.
  if (busy) { if (e.submitter === sendBtn) stopChat(); return; }
  const text = input.value.trim();
  if (!text && !attached) return;
  const viaWake = sendViaWake;
  captureEnd('sent', null, MAIN_BOX);   // pressing Send during a voice capture: the capture is over (the auto-send ended it already)
  input.value = '';
  fitInput();
  const picture = attached, quote = replyTo;
  clearAttachment(false);
  clearReply();
  send(text, picture || quote || viaWake ? { picture, quote, viaWake } : undefined);
});

// ---- Showing Sim Sim a picture (attach button, paste, or drag onto the chat) ----
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PICTURE_MAX = 5 * 1024 * 1024;
let attached = null;   // { dataUrl, previewUrl }

function attachError(text) {
  $('attachErr').textContent = text;
  $('attachErr').hidden = !text;
}
function clearAttachment(revoke) {
  if (attached && revoke) URL.revokeObjectURL(attached.previewUrl);
  attached = null;
  $('attachPreview').hidden = true;
  $('attachThumb').removeAttribute('src');
  $('attachFile').value = '';
}
function attachPicture(file) {
  attachError('');
  if (!file) return;
  if (!PICTURE_TYPES.includes(file.type)) { attachError('Sim Sim can look at PNG, JPEG or WebP pictures.'); return; }
  if (file.size > PICTURE_MAX) { attachError('That picture is too large — try a smaller one.'); return; }   // nothing is sent
  const reader = new FileReader();
  reader.onload = () => {
    clearAttachment(true);
    attached = { dataUrl: reader.result, previewUrl: URL.createObjectURL(file) };
    $('attachThumb').src = attached.previewUrl;
    $('attachName').textContent = file.name || 'Pasted picture';
    $('attachPreview').hidden = false;
    input.focus();
  };
  reader.readAsDataURL(file);
}
function chatIsOpen() { return !$('app').hidden && !$('thread').hidden && !(window.SimSimGroup && window.SimSimGroup.isOpen()); }

$('attach').addEventListener('click', () => $('attachFile').click());
$('attachFile').addEventListener('change', () => attachPicture($('attachFile').files[0]));
$('attachRemove').addEventListener('click', () => { clearAttachment(true); attachError(''); input.focus(); });
document.addEventListener('paste', e => {
  if (!chatIsOpen()) return;
  const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (item) { e.preventDefault(); attachPicture(item.getAsFile()); }
});
const dropZone = document.querySelector('.main');
dropZone.addEventListener('dragover', e => { if (chatIsOpen() && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dropZone.classList.add('dropping'); } });
dropZone.addEventListener('dragleave', e => { if (e.target === dropZone || !dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dropping'); });
dropZone.addEventListener('drop', e => {
  dropZone.classList.remove('dropping');
  if (!chatIsOpen()) return;
  const file = [...(e.dataTransfer ? e.dataTransfer.files : [])][0];
  if (file) { e.preventDefault(); attachPicture(file); }
});

// ---- Speak answers ON/OFF: ONE source of truth, the user's settings on OUR server (settings.speakAnswers) ----
// settings.js loads it at sign-in (applySpeak); the top bar and Settings both change it (setSpeak), and it follows the account.
let speakOn = true;   // the default until the account's setting arrives

function paintSpeak() {
  $('speakText').textContent = speakOn ? 'ON' : 'OFF';
  $('speak').setAttribute('aria-pressed', String(speakOn));
}
function applySpeak(on) {
  speakOn = !!on;
  paintSpeak();
  if (!speakOn) stopSpeaking();
  window.dispatchEvent(new Event('simsim:speakchanged'));
}
async function setSpeak(on) {
  const before = speakOn;
  applySpeak(on);
  try {
    const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speakAnswers: speakOn }) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); return; }
    if (!r.ok) throw new Error('not saved');
  } catch (e) {
    applySpeak(before);   // not saved: show the value that is really stored
    caption('Speak answers could not be saved. Please try again.', true);
  }
}
$('speak').addEventListener('click', () => setSpeak(!speakOn));

// Speaking speed (Settings > Voice): the browser voice's rate.
const RATES = { slower: 0.85, normal: 1, faster: 1.2 };
let speechRate = 1;
function setRate(name) { speechRate = RATES[name] || 1; }

// ---- THE ONE SPEAK LANE (every spoken surface: chat answers, the Discussion pick, the briefing, Screen Watch) ----
// Designed voice (founder's roster, through OUR server's /api/speak — the ElevenLabs key never reaches this page):
// the text is split at sentence ends into ~450-character chunks, and chunk N+1 is fetched while chunk N plays, so a long
// answer speaks fully, in order, without gaps. If the voice service isn't connected, the voice isn't set up, or a call
// fails, the REST is spoken by the browser's built-in voice — and the caption says so once. Never pretends otherwise.
// force: speak even when Speak answers is OFF ("Read it to me").
const CHUNK_CHARS = 450;
let voiceStatus = null;   // from /api/voices (settings.js): { connected, chosen, voices: [{ name, ready }] }
let speakRun = 0, player = null, fallbackSaid = false;
function setVoiceStatus(st) { voiceStatus = st; }
function designedReady() {
  const v = voiceStatus && voiceStatus.connected && voiceStatus.voices.find(x => x.name === voiceStatus.chosen);
  return !!(v && v.ready);
}
function chunksOf(text) {
  const sentences = (String(text).match(/[^.!?\n]+[.!?]*[\s"')\]]*|\n+/g) || [text]).map(p => p.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  sentences.forEach(s => {
    while (s.length > CHUNK_CHARS) {   // one very long sentence: cut at the last space that fits
      const cut = s.lastIndexOf(' ', CHUNK_CHARS) > 100 ? s.lastIndexOf(' ', CHUNK_CHARS) : CHUNK_CHARS;
      if (cur) { out.push(cur); cur = ''; }
      out.push(s.slice(0, cut).trim()); s = s.slice(cut).trim();
    }
    if (cur && (cur + ' ' + s).length > CHUNK_CHARS) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
  });
  if (cur) out.push(cur);
  return out;
}
// One chunk from the designed voice: an object URL for the audio, or null (with the honest reason told once).
async function fetchChunk(text, part, voiceName) {
  try {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ text, part }, voiceName ? { voice: voiceName } : {})) });
    if (r.ok) { const b = await r.blob(); if (b.size) return URL.createObjectURL(b); }
    const d = await r.json().catch(() => ({}));
    tellFallback(d.fallback);
  } catch (e) { tellFallback('failed'); }
  return null;
}
function tellFallback(reason) {
  if (fallbackSaid) return;
  fallbackSaid = true;
  caption(reason === 'not-connected' ? "Speaking with your device's voice — the voice service isn't connected yet."
    : reason === 'not-set-up' ? "Speaking with your device's voice — this voice isn't set up yet."
    : "Speaking with your device's voice — the designed voice didn't answer this time.", true);
}
function playUrl(url, run) {
  return new Promise(done => {
    if (run !== speakRun) { URL.revokeObjectURL(url); return done(false); }
    const a = new Audio(url);
    player = a;
    const end = ok => { URL.revokeObjectURL(url); if (player === a) player = null; done(ok); };
    a.onended = () => end(true);
    a.onerror = () => end(false);
    a.play().catch(() => end(false));   // e.g. Chrome wants one click on the page before it plays sound
  });
}
function speak(text, force, voiceName) {
  if (!speakOn && !force) { idle(); return; }
  const chunks = chunksOf(speakable(text));
  if (!chunks.length) { idle(); return; }
  stopSound();
  const run = ++speakRun;
  speaking = { run };
  window.dispatchEvent(new Event('simsim:speakstart')); // the doorman pauses so it never hears Sim Sim's own voice
  setPill('Speaking', 'busy');
  const finish = () => { if (speakRun === run) { speaking = null; if (!busy) idle(); } };
  if (!designedReady() && !voiceName) { if (voiceStatus) tellFallback(voiceStatus.connected ? 'not-set-up' : 'not-connected'); browserSpeak(chunks, run, finish); return; }
  (async () => {
    let next = fetchChunk(chunks[0], 1, voiceName);
    for (let i = 0; i < chunks.length; i++) {
      const url = await next;
      if (run !== speakRun) { if (url) URL.revokeObjectURL(url); return; }
      if (!url) { browserSpeak(chunks.slice(i), run, finish); return; }   // the rest in the device's voice
      next = i + 1 < chunks.length ? fetchChunk(chunks[i + 1], i + 2, voiceName) : null;   // fetched while this one plays
      const ok = await playUrl(url, run);
      if (run !== speakRun) return;
      if (!ok) { if (next) next.then(u => u && URL.revokeObjectURL(u)); tellFallback('failed'); browserSpeak(chunks.slice(i), run, finish); return; }
    }
    finish();
  })();
}
// The browser's built-in voice, one sentence at a time (Chrome can cut off long single utterances).
function browserSpeak(chunks, run, finish) {
  if (!window.speechSynthesis) { finish(); return; }
  const parts = chunks.join(' ').match(/[^.!?\n]+[.!?]*/g) || chunks;
  const list = parts.map(p => p.trim()).filter(Boolean);
  if (!list.length) { finish(); return; }
  list.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.rate = speechRate;
    if (i === list.length - 1) { speaking = u; u.onend = u.onerror = () => { if (speaking === u && speakRun === run) { speaking = null; if (!busy) idle(); } }; }
    speechSynthesis.speak(u);
  });
}
function stopSound() {
  speakRun++;
  if (player) { player.pause(); player = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
}
function stopSpeaking() {
  speaking = null;
  stopSound();
  if (!busy) idle();
}

// ---- Voice capture: ONE flow for the mic button AND the wake word (founder, 2026-10-29) ----
// Whoever is hearing the words — the mic button's recognizer below, or the doorman's in wake.js after "Sim Sim" — hands the
// words said so far to captureWords(). They are typed live into the question bar, after anything already typed there.
// 3 seconds with no new words -> the question bar is sent through the Send button's own path, once.
// Typing or editing in the box, pressing Stop (the mic button), opening another view or signing out cancels the auto-send;
// the words stay in the box for the user to fix and send. No words at all within 8 seconds -> the capture ends quietly.
// The same flow serves every question bar with a mic — a "voice box": the main composer, and the Screen Watch mini chat.
const CAPTURE_QUIET_MS = 3000;
const CAPTURE_NOTHING_MS = 8000;
let cap = null;            // { via: 'wake' | 'mic', box, base, heard, quietT, nothingT, placeholder, onEnd(reason) }
let sendViaWake = false;   // set only while an auto-send from the wake word goes through the form
// box: { input, form, fit, mic, say(text) } — say: where a mic problem is told (the main caption line by default)
const MAIN_BOX = { input, form: $('form'), fit: () => fitInput(), mic: micBtn, say: t => caption(t, true) };

function captureStart(via, onEnd, box) {
  if (cap) captureEnd('replaced');
  const b = box || MAIN_BOX;
  const typed = b.input.value.replace(/\s+$/, '');
  cap = { via, box: b, base: typed ? typed + ' ' : '', heard: false, quietT: null, nothingT: null, placeholder: b.input.placeholder, onEnd };
  cap.nothingT = setTimeout(() => captureEnd('nothing'), CAPTURE_NOTHING_MS);
  b.input.placeholder = 'Listening… speak now';
  b.mic.setAttribute('aria-pressed', 'true');
  b.mic.setAttribute('aria-label', 'Stop');
  b.mic.title = 'Stop (the words stay in the box)';
  b.form.classList.add('capturing');                       // the question bar itself shows it is taking the request
  if (window.SimSimWake) window.SimSimWake.paintIdle();   // "Taking your request…"
}
// text: ALL the words of this request so far (rebuilt by the hearer each time — never appended piece by piece)
function captureWords(text) {
  if (!cap) return;
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  cap.heard = true;
  clearTimeout(cap.nothingT);
  cap.box.input.value = cap.base + t;
  // tell anything listening on the box that its text changed (the box resizes; extensions see it). This event is not
  // trusted, so the "user edited it -> cancel the auto-send" rule in voiceBox() ignores it.
  cap.box.input.dispatchEvent(new Event('input', { bubbles: true }));
  cap.box.fit();
  clearTimeout(cap.quietT);   // every new piece of speech restarts the 3 seconds
  cap.quietT = setTimeout(captureSend, CAPTURE_QUIET_MS);
}
// Nothing heard yet, and Sim Sim just said "I'm here": give the user a fresh 8 seconds.
function captureWaitMore() {
  if (!cap || cap.heard) return;
  clearTimeout(cap.nothingT);
  cap.nothingT = setTimeout(() => captureEnd('nothing'), CAPTURE_NOTHING_MS);
}
// reason: 'sent', 'nothing', 'edited', 'stopped', 'away', 'signedout', 'replaced', 'error'.
// via / box: end it only if it is that hearer's, or that question bar's.
function captureEnd(reason, via, box) {
  if (!cap || (via && cap.via !== via) || (box && cap.box !== box)) return;
  const c = cap, b = c.box;
  cap = null;
  clearTimeout(c.quietT); clearTimeout(c.nothingT);
  b.input.placeholder = c.placeholder;
  b.mic.setAttribute('aria-pressed', 'false');
  b.mic.setAttribute('aria-label', 'Talk');
  b.mic.title = '';
  b.form.classList.remove('capturing');
  if (c.onEnd) c.onEnd(reason);   // the hearer stops first, so it never hears the answer
  if (reason !== 'sent' && !busy) idle();
}
function captureSend() {
  if (!cap) return;
  const via = cap.via, b = cap.box;
  captureEnd('sent');
  if (!b.input.value.trim()) return;
  sendViaWake = via === 'wake';   // the server uses it for the "good morning" briefing; Screen Watch routes on it
  b.form.requestSubmit();         // the SAME path as pressing that bar's Send
  sendViaWake = false;
}

// ---- Microphone button: push-to-talk (Chrome's built-in speech recognition) — a hearer for the capture above ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const CAP = 'Press the mic to talk. Chrome sends what the mic hears to Google to turn it into text.';
let dictation = null, capTimer = null;   // dictation: the mic button's recognizer while it is listening

// Gives a question bar its voice: its mic button dictates into it (live words, 3-second auto-send), and typing in it
// cancels a pending auto-send. Used by the main composer and the Screen Watch mini chat.
function voiceBox(box) {
  // The user typed, pasted or deleted in the box: never send while they are correcting it.
  // (Only real key/paste input counts — the words we type in by code fire no input event.)
  box.input.addEventListener('input', e => { if (cap && cap.box === box && e.isTrusted) captureEnd('edited'); });
  if (!SR) { box.mic.hidden = true; return; }
  box.mic.addEventListener('click', () => {
    if (cap) { const b = cap.box; captureEnd('stopped'); b.input.focus(); return; }   // Stop: the words stay, nothing is sent
    window.dispatchEvent(new Event('simsim:dictationstart')); // the doorman steps aside: never two mics at once
    stopSpeaking();                                // don't let the mic hear Sim Sim's own voice
    captureStart('mic', reason => stopMic(reason, box), box);
    listenMic('');
  });
}

function baseCaption() {
  if (!SR) return "This browser can't listen — Sim Sim works by typing here.";
  return window.SimSimWake ? window.SimSimWake.captionText() : CAP;
}
function caption(text, temporary) {
  clearTimeout(capTimer);
  $('cap').textContent = text;
  if (temporary) capTimer = setTimeout(() => { $('cap').textContent = baseCaption(); }, 6000);
}

caption(SR ? baseCaption() : "This browser can't listen — Sim Sim works by typing here.");
voiceBox(MAIN_BOX);
// One continuous recognizer for the mic button. carried: words heard before Chrome restarted it mid-request.
function listenMic(carried) {
  const r = new SR();
  r.lang = navigator.language || 'en-US';
  r.continuous = true;        // a pause mid-sentence must not end the request; the 3-second rule does
  r.interimResults = true;
  r.said = '';
  r.onresult = e => {
    if (dictation !== r) return;
    const parts = [];
    for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript.trim());   // rebuilt from ALL results
    r.said = parts.join(' ');
    captureWords(carried + ' ' + r.said);
  };
  r.onerror = e => {
    if (dictation !== r) return;
    if (e.error === 'no-speech' || e.error === 'aborted') return;   // Chrome just stops; onend listens again
    r.failed = true;
    const say = cap ? cap.box.say : MAIN_BOX.say;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
      say('The mic is blocked. Click the icon at the left of the address bar, set Microphone to Allow, then reload.');
    else if (e.error === 'audio-capture') say('No microphone was found.');
    else say('The mic stopped (' + e.error + '). Try again.');
  };
  r.onend = () => {
    if (dictation !== r) return;
    dictation = null;
    // Chrome stopped by itself in the middle of the request: keep every word and listen on (the timers still run).
    // After a real failure it doesn't listen again — words already in the box are still sent after 3 seconds.
    if (cap && cap.via === 'mic' && !r.failed) { listenMic((carried + ' ' + r.said).trim()); return; }
    if (cap && cap.via === 'mic' && !cap.heard) captureEnd('error');
  };
  try { r.start(); dictation = r; }
  catch (e) { (cap ? cap.box.say : MAIN_BOX.say)('The mic could not start. Try again.'); captureEnd('error'); }
}
// The capture ended (sent, stopped, edited…): the mic button's recognizer stops, and the doorman may listen again.
function stopMic(reason, box) {
  if (dictation) {
    const r = dictation;
    dictation = null;
    r.onresult = r.onerror = r.onend = null;
    try { r.abort(); } catch (e) {}
  }
  if (reason === 'nothing') box.say("I didn't hear anything. Press the mic and try again.");
  if (reason !== 'sent') box.input.focus();
  window.dispatchEvent(new Event('simsim:dictationend'));
}

// ---- Sidebar ----
let noteTimer = null;
function navNote(text) {
  clearTimeout(noteTimer);
  $('navNote').textContent = text;
  if (text) noteTimer = setTimeout(() => { $('navNote').textContent = ''; }, 4000);
}
document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => {
  captureEnd('away');   // moving to another view never sends a half-said request
  const label = b.dataset.label;
  navNote(['Chat', 'Browser', 'Your pictures', 'Discussion', 'Morning briefing', 'Open loops'].includes(label) ? '' : label + ' is coming in a later step.');
}));

// ---- The header: names whichever view is actually open (founder, 2026-11-01 — it used to say "Main chat" over
// every view). A side chat's own name shows while that side chat is on screen, exactly as before. ----
const VIEW_TITLES = { settingsView: 'Settings', groupView: 'Discussion', loopsView: 'Open loops', picturesView: 'Your pictures', briefView: 'Morning briefing', profileView: 'Profile' };
function paintTitle() {
  const openView = Object.keys(VIEW_TITLES).find(id => !$(id).hidden);
  if (openView) { $('chatTitle').textContent = VIEW_TITLES[openView]; $('chatTitle').classList.remove('side-title'); return; }
  const side = threadKind === 'side' && !thread.hidden;
  $('chatTitle').textContent = side ? threadTitle || 'Side chat' : 'Main chat';
  $('chatTitle').classList.toggle('side-title', side);
}
function setTitle(title) { threadTitle = title; paintTitle(); }
new MutationObserver(paintTitle).observe(thread, { attributes: true, attributeFilter: ['hidden'] });
Object.keys(VIEW_TITLES).forEach(id => new MutationObserver(paintTitle).observe($(id), { attributes: true, attributeFilter: ['hidden'] }));

// Empties the chat column. The next message starts a fresh MAIN thread (New chat), unless a thread is loaded after it.
function clearChat() {
  chatId++; subjectNext = false;
  pending = null;   // a new chat means nothing from the old one is still worth watching
  threadId = null;
  threadKind = 'main'; threadTitle = '';
  paintTitle();
  window.dispatchEvent(new Event('simsim:threadchanged'));
  stopSpeaking();
  captureEnd('away');   // New chat, sign-out, opening a saved chat: a voice capture in progress is cancelled, never sent
  col.querySelectorAll('.user, .msg').forEach(el => el.remove());
  $('empty').hidden = false;
  clearReply();
  input.value = '';
  fitInput();
  if (!busy) idle();
}
$('newChat').addEventListener('click', () => {
  clearChat();
  fetch('/api/chat/reset', { method: 'POST' }).catch(() => {}); // the server forgets this conversation's context (not the notebook)
  input.focus();
});

// A fixed (non-brain) message from Sim Sim, e.g. the first greeting after setup.
function addSimText(text) {
  hideEmpty();
  const msg = addSim();
  msg.querySelector('.txt').textContent = text;
  addOptions(msg, 'Sim Sim', text);
  scrollDown();
}

// A Discussion pick's write-back, shown in the Main chat the moment it happens — never only on a reload
// (founder's end-check, round 6, 2026-11-02): switching to Main chat is a pure visibility toggle (showChat()
// just un-hides #thread/#composer); it was never re-fetching the thread, so a pick made while looking at
// Discussion sat unseen in storage until the next full page load. Mirrors loadThread's own per-message
// rendering for a discussionPick message exactly, so the live bubble and a reloaded one are indistinguishable.
function addDiscussionPickMessage(wb) {
  if (threadKind !== 'main' || !wb) return;   // only the thread actually on screen; a side chat's own pick (if any) shows on its own reload
  if (!threadId) threadId = wb.threadId;      // a brand-new session's first-ever message might be this pick
  hideEmpty();
  const msg = addSim(wb.name, true), slot = msg.querySelector('.txt');
  msg.dataset.mid = wb.messageId;
  renderRich(slot, wb.text);
  stampMsgTime(msg, Date.now());
  addOptions(msg, wb.name, wb.text);
  attachActions(msg, wb.threadId, wb.messageId, null, false);
  scrollDown();
}
// Switching a Discussion pick removes the OLD write-back bubble and adds the NEW one, live, in one call — the
// same pair of things recordPick just did on the server (chats.removeReply, then chats.addDiscussionPick).
function applyDiscussionPickWriteBack(result) {
  if (result && result.removed && threadKind === 'main') {
    const old = col.querySelector('.msg[data-mid="' + result.removed.messageId + '"]');
    if (old) old.remove();
  }
  if (result && result.writeBack) addDiscussionPickMessage(result.writeBack);
}

// One saved message, exactly as a reloaded thread renders it — used by loadThread (every message) AND by
// reconcile() below (just the one new message a dropped live render missed). Returns the message's own node.
function renderSavedMessage(t, m) {
  const at = Date.parse(m.at);   // this message's real send time, stored on the server — never today's
  if (m.role === 'user') {
    const u = m.voice && /^[a-f0-9]{20}\.(webm|ogg|mp4)$/.test(m.voice.name)
      ? addUser('', null, m.quote, { src: '/api/voicenotes/' + m.voice.name, transcript: m.voice.transcript ? m.text : '' }, at)
      : addUser(m.picture ? (m.picture === 'screen' ? '[Screen snapshot — not saved] ' : '[Picture — not saved] ') + m.text : m.text, null, m.quote, null, at);
    attachActions(u, t.id, m.id, m.reaction, true);
    u.dataset.mid = m.id;   // search can scroll to this message
    return u;
  }
  const msg = addSim(m.discussionPick ? m.discussionPick.name : null, !!m.discussionPick), slot = msg.querySelector('.txt');
  msg.dataset.mid = m.id;
  if (m.guardian) msg.classList.add('guardian');
  if (m.image) showImage(slot, m.image, m.text);
  else if (m.guardian) slot.textContent = m.text;
  else renderRich(slot, m.text);
  stampMsgTime(msg, at);
  if (m.document) addDocument(msg, m.document);
  if (m.website) addWebsite(msg, m.website);
  if (m.sources && m.sources.length) addCitation(msg, m.sources, m.browser === true);
  if (m.receipt) addReceipt(msg, m.receipt);
  addOptions(msg, m.discussionPick ? m.discussionPick.name : 'Sim Sim', m.text, m.image && m.image.url);
  if (!m.guardian) attachActions(msg, t.id, m.id, m.reaction, false);
  return msg;
}
// A saved thread (the main Chat or a side chat), put back on screen exactly as it was (nothing is spoken).
// New messages then go on into the SAME thread. An empty side chat shows the usual empty greeting.
function loadThread(t) {
  clearChat();
  threadId = t.id;
  threadKind = t.kind === 'side' ? 'side' : 'main';
  setTitle(t.title || '');
  window.dispatchEvent(new Event('simsim:threadchanged'));
  if (t.messages.length) hideEmpty();
  t.messages.forEach(m => renderSavedMessage(t, m));
  scrollDown();
}

// Sign-in (auth.js) and setup (setup.js) tell us when the app is shown or hidden.
window.addEventListener('simsim:signedin', () => input.focus());
window.addEventListener('simsim:signedout', () => {
  captureEnd('signedout');
  clearChat();
  navNote('');
});
window.addEventListener('simsim:profileopen', () => captureEnd('away'));
window.SimSimChat = {
  clear: clearChat, addSimText, applyDiscussionPickWriteBack, send, postChat, setPill, caption, speak, stopSpeaking, idle, addCitation, addReceiptSteps, setSpeak, applySpeak, setRate, loadThread,
  composer, fitInput, startReply, clearReply, quoteBlock, renderRich,
  threadId: () => threadId,
  kind: () => threadKind,
  setTitle,
  hasMessages: () => !!col.querySelector('.user, .msg'),
  speakOn: () => speakOn,
  rate: () => speechRate,
  isBusy: () => busy,
  isSpeaking: () => !!speaking,
  designedSpeaking: () => !!(speaking && speaking.run),   // a designed voice is fetching or playing (not the browser voice)
  setVoiceStatus,
  // the mic button's recognizer, or a voice note being recorded: either way the wake ear stays off (one recognizer at a time)
  isDictating: () => !!dictation || !!(window.SimSimVoiceNote && window.SimSimVoiceNote.isRecording()),
  // the one voice-capture flow (wake.js hands its words here after "Sim Sim")
  capture: {
    start: captureStart, words: captureWords, waitMore: captureWaitMore, end: captureEnd,
    active: () => !!cap, via: () => (cap ? cap.via : null)
  },
  voiceBox   // gives another question bar (the Screen Watch mini chat) the same mic + auto-send
};

// ---- Start ----
paintSpeak();
idle();
input.focus();
