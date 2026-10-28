// SIM SIM page logic. This file never holds the API key: it only talks to OUR server at /api/chat.
const $ = id => document.getElementById(id);
const col = $('col'), thread = $('thread'), input = $('input'), sendBtn = $('send'), micBtn = $('mic');

let busy = false;        // waiting for the brain
let chatId = 0;          // bumps on "New chat" so a late reply never lands in a fresh chat
let threadId = null;     // the saved thread this chat belongs to (Chat history); null = a new one starts with the next message
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

function addUser(text, pictureUrl) {
  const d = document.createElement('div');
  d.className = 'user';
  if (pictureUrl) {   // the picture shown in your own bubble (from this browser; the server does not keep it)
    const img = document.createElement('img');
    img.className = 'user-pic';
    img.src = pictureUrl;
    img.alt = 'Picture you shared';
    img.addEventListener('load', scrollDown);
    d.appendChild(img);
  }
  if (text) d.appendChild(document.createTextNode(text));
  col.appendChild(d);
  scrollDown();
}

// Adds a Sim Sim message with a typing indicator; returns the text slot to fill in later.
function addSim() {
  const d = document.createElement('div');
  d.className = 'msg';
  d.innerHTML = '<span class="avatar" aria-hidden="true">S</span><div class="body"><div class="name">Sim Sim</div>' +
    '<div class="txt"><span class="typing" aria-label="Sim Sim is thinking"><span></span><span></span><span></span></span></div></div>';
  col.appendChild(d);
  scrollDown();
  return d;
}

// ---- Sending ----
// THE one way the page talks to /api/chat (main chat and the Screen Watch mini chat both use it).
// extra: viaWake (wake-by-name), picture (a data URL: a shared picture or a screen snapshot), screen, circled (Freeze & Ask),
// thread ('new' or a saved thread id: the turn is saved to Chat history — the Screen Watch mini chat sends none)
async function postChat(text, extra) {
  const x = extra || {};
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ message: text }, x.viaWake ? { viaWake: true } : {}, x.picture ? { image: x.picture } : {},
      x.screen ? { screen: true } : {}, x.circled ? { circled: true } : {}, x.thread ? { thread: x.thread } : {}))
  });
  return { r, data: await r.json().catch(() => ({})) };
}

// opts.viaWake: the message came from wake-by-name (the server uses it for "good morning" briefings)
// opts.picture: { dataUrl, previewUrl } — a picture to show Sim Sim with this message (1-on-1 chat only)
async function send(text, opts) {
  if (window.SimSimGroup && window.SimSimGroup.isOpen()) { window.SimSimGroup.ask(text); return; } // Group Chat open: a group question
  // Watching the screen: spoken commands go to the mini chat ("Sim Sim, look at this" takes a fresh snapshot)
  if (opts && opts.viaWake && window.SimSimScreen && window.SimSimScreen.isWatching()) { window.SimSimScreen.voice(text); return; }
  if (busy) return;
  busy = true; sendBtn.disabled = true;
  const myChat = chatId;
  const picture = opts && opts.picture;
  stopSpeaking();
  hideEmpty();
  addUser(text, picture && picture.previewUrl);
  setPill('Thinking', 'busy');
  const msg = addSim(), slot = msg.querySelector('.txt');
  // Image lane: show a soft "Drawing…" placeholder (the server makes the real decision).
  if (window.SimSimImageIntent && window.SimSimImageIntent.imageRequest(text)) {
    slot.innerHTML = '<div class="drawing" aria-label="Sim Sim is drawing"><span>Drawing…</span></div>';
  }

  let reply = null, error = null, signedOut = false, turnId = null, memoryChanged = false, image = null, sources = null, guardian = null, loopsChanged = false;
  try {
    const { r, data } = await postChat(text, { viaWake: opts && opts.viaWake, picture: picture && picture.dataUrl, thread: threadId || 'new' });
    if (r.status === 401) signedOut = true;
    else if (r.ok && typeof data.reply === 'string') { reply = data.reply; turnId = data.turnId || null; memoryChanged = !!data.memoryChanged; image = data.image || null; sources = data.sources || null;
      guardian = data.guardian || null; loopsChanged = !!data.loopsChanged;
      if (data.threadId) { if (myChat === chatId) threadId = data.threadId; window.dispatchEvent(new Event('simsim:chatsaved')); }
      if (data.pictureNote) reply = data.pictureNote + '\n\n' + reply; }   // the picture could not be sent: say so plainly
    else error = data.error || 'Sim Sim could not get an answer.';
  } catch (e) {
    error = 'Could not reach the Sim Sim server. Is it still running?';
  }

  busy = false; sendBtn.disabled = false;
  if (signedOut) { window.dispatchEvent(new Event('simsim:needsignin')); return; } // back to the sign-in screen
  if (myChat !== chatId) { idle(); return; } // user started a new chat meanwhile
  if (reply !== null && image) {
    showImage(slot, image, reply);
    speak(reply);
  } else if (reply !== null) {
    if (guardian) {   // the deadline guardian's one gentle line comes first, as its own little message
      const g = addSim();
      g.querySelector('.txt').textContent = guardian;
      g.classList.add('guardian');
      col.insertBefore(g, msg);
    }
    slot.textContent = reply;
    if (sources && sources.length) addCitation(msg, sources);   // answers from the Book show where they came from
    scrollDown(); speak(guardian ? guardian + ' ' + reply : reply);
    if (loopsChanged) window.dispatchEvent(new Event('simsim:loopschanged'));
    if (turnId && window.SimSimMemory) window.SimSimMemory.learnFrom(turnId, msg);   // quiet "Remembered:" chips, if any
    if (memoryChanged && window.SimSimMemory) window.SimSimMemory.refreshIfOpen();
  }
  else { msg.classList.add('error'); slot.textContent = error; scrollDown(); idle(); }
}

// The citation card: the official source(s) a precise answer came from, with the date the Book fetched them.
function addCitation(msg, sources) {
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
    a.textContent = s.name;
    const d = new Date(s.fetched + 'T12:00:00');
    const when = document.createElement('small');
    when.textContent = 'Fetched ' + (isNaN(d) ? s.fetched : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    row.append(a, when);
    card.appendChild(row);
  });
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
  const cap = document.createElement('figcaption');
  cap.textContent = line;
  const dl = document.createElement('a');
  dl.className = 'mini-btn';
  dl.href = image.url;
  dl.download = 'sim-sim-' + (image.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'picture') + '.png';
  dl.textContent = 'Download';
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
  const text = input.value.trim();
  if ((!text && !attached) || busy) return;
  if (dictation) dictation.stop();
  input.value = '';
  fitInput();
  const picture = attached;
  clearAttachment(false);
  send(text, picture ? { picture } : undefined);
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

// Speaks the reply with the browser's built-in voice, one sentence at a time
// (Chrome can cut off long single utterances). force: speak even when Speak answers is OFF ("Read it to me").
function speak(text, force) {
  if ((!speakOn && !force) || !window.speechSynthesis) { idle(); return; }
  speechSynthesis.cancel();
  const parts = (text.match(/[^.!?\n]+[.!?]*/g) || [text]).map(p => p.trim()).filter(Boolean);
  if (!parts.length) { idle(); return; }
  window.dispatchEvent(new Event('simsim:speakstart')); // the doorman pauses so it never hears Sim Sim's own voice
  setPill('Speaking', 'busy');
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    u.rate = speechRate;
    if (i === parts.length - 1) {
      speaking = u;
      u.onend = u.onerror = () => { if (speaking === u) { speaking = null; if (!busy) idle(); } };
    }
    speechSynthesis.speak(u);
  });
}
function stopSpeaking() {
  speaking = null;
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (!busy) idle();
}

// ---- Microphone: push-to-talk (Chrome's built-in speech recognition) ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const CAP = 'Press the mic to talk. Chrome sends what the mic hears to Google to turn it into text.';
let dictation = null, capTimer = null;

function baseCaption() {
  if (!SR) return 'Voice needs Chrome';
  return window.SimSimWake ? window.SimSimWake.captionText() : CAP;
}
function caption(text, temporary) {
  clearTimeout(capTimer);
  $('cap').textContent = text;
  if (temporary) capTimer = setTimeout(() => { $('cap').textContent = baseCaption(); }, 6000);
}

if (!SR) {
  micBtn.hidden = true;
  caption('Voice needs Chrome');
} else {
  caption(baseCaption());
  micBtn.addEventListener('click', () => {
    if (dictation) { dictation.stop(); return; }   // second press stops
    window.dispatchEvent(new Event('simsim:dictationstart')); // the doorman steps aside: never two mics at once
    stopSpeaking();                                // don't let the mic hear Sim Sim's own voice
    const base = input.value.trim() ? input.value.trim() + ' ' : '';
    const r = new SR();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.onresult = e => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = base + t.trim();
      fitInput();
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
        caption('The mic is blocked. Click the icon at the left of the address bar, set Microphone to Allow, then reload.', true);
      else if (e.error === 'no-speech') caption("I didn't hear anything. Press the mic and try again.", true);
      else if (e.error === 'audio-capture') caption('No microphone was found.', true);
      else if (e.error !== 'aborted') caption('The mic stopped (' + e.error + '). Try again.', true);
    };
    r.onend = () => {
      dictation = null;
      micBtn.setAttribute('aria-pressed', 'false');
      micBtn.setAttribute('aria-label', 'Talk');
      input.placeholder = 'Talk or type to Sim Sim…';
      input.focus();
      window.dispatchEvent(new Event('simsim:dictationend'));
    };
    try {
      r.start();
      dictation = r;
      micBtn.setAttribute('aria-pressed', 'true');
      micBtn.setAttribute('aria-label', 'Stop talking');
      input.placeholder = 'Listening… speak now';
    } catch (e) {
      caption('The mic could not start. Try again.', true);
      window.dispatchEvent(new Event('simsim:dictationend'));
    }
  });
}

// ---- Sidebar ----
let noteTimer = null;
function navNote(text) {
  clearTimeout(noteTimer);
  $('navNote').textContent = text;
  if (text) noteTimer = setTimeout(() => { $('navNote').textContent = ''; }, 4000);
}
document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => {
  const label = b.dataset.label;
  navNote(['Chat', 'Chat history', 'Discussion', 'Morning briefing', 'Open loops'].includes(label) ? '' : label + ' is coming in a later step.');
}));

function clearChat() {
  chatId++;
  threadId = null;
  stopSpeaking();
  if (dictation) dictation.stop();
  col.querySelectorAll('.user, .msg').forEach(el => el.remove());
  $('empty').hidden = false;
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
  addSim().querySelector('.txt').textContent = text;
  scrollDown();
}

// A saved thread from Chat history, put back on screen exactly as it was (nothing is spoken).
// New messages then go on into the SAME thread.
function loadThread(t) {
  clearChat();
  threadId = t.id;
  hideEmpty();
  t.messages.forEach(m => {
    if (m.role === 'user') {
      addUser(m.picture ? (m.picture === 'screen' ? '[Screen snapshot — not saved] ' : '[Picture — not saved] ') + m.text : m.text);
      return;
    }
    const msg = addSim(), slot = msg.querySelector('.txt');
    if (m.guardian) msg.classList.add('guardian');
    if (m.image) showImage(slot, m.image, m.text);
    else slot.textContent = m.text;
    if (m.sources && m.sources.length) addCitation(msg, m.sources);
  });
  scrollDown();
}

// Sign-in (auth.js) and setup (setup.js) tell us when the app is shown or hidden.
window.addEventListener('simsim:signedin', () => input.focus());
window.addEventListener('simsim:signedout', () => {
  clearChat();
  navNote('');
});
window.SimSimChat = {
  clear: clearChat, addSimText, send, postChat, setPill, caption, speak, stopSpeaking, idle, addCitation, setSpeak, applySpeak, setRate, loadThread,
  composer, fitInput,
  threadId: () => threadId,
  hasMessages: () => !!col.querySelector('.user, .msg'),
  speakOn: () => speakOn,
  rate: () => speechRate,
  isBusy: () => busy,
  isSpeaking: () => !!speaking,
  isDictating: () => !!dictation
};

// ---- Start ----
paintSpeak();
idle();
input.focus();
