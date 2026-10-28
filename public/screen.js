// SIM SIM Screen Watch + Freeze & Ask. Sim Sim SEES the screen the user chooses to share — it never clicks or types.
// Frames live only in this page's memory: one latest frame, overwritten every few seconds, gone when watching stops.
// A frame reaches the brain ONLY through one of three doors: "Sim Sim, look at this" (voice), the Look button,
// or a message typed in the mini chat — each sends ONE fresh snapshot through the same /api/chat picture path as Vision.
// While watching, the mini chat floats in Chrome's Document Picture-in-Picture window (the SAME nodes are moved there);
// without that API it stays as the in-page panel.
(function () {
  const $ = id => document.getElementById(id);
  const chat = window.SimSimChat;
  // Direct handles to the panel's own nodes: they keep working when the nodes move into the floating window.
  const E = {
    panel: $('screenPanel'), head: $('spHead'), stop: $('spStop'), float: $('spFloat'), thread: $('spThread'),
    form: $('spForm'), input: $('spInput'), look: $('spLook'),
    freezeBtn: $('freezeBtn'), layer: $('freezeLayer'), canvas: $('flCanvas'), clear: $('flClear'), close: $('flClose'),
    video: $('screenVideo'), watchBtn: $('watchBtn')
  };
  const LOOP_MS = 5000;          // the capture loop refreshes the latest frame every 5 seconds (it never calls the brain)
  const MAX_EDGE = 1280;         // frames are scaled to at most 1280px on the long edge…
  const JPEG_Q = 0.7;            // …and sent as JPEG at quality 0.7
  const LOOK = /\blook at (this|that|it|my screen|the screen)\b/i;
  const FRAME_FAIL = "I couldn't read that frame — try Look again.";
  let stream = null, grabber = null, loop = null, busy = false, holdT = null, pip = null;
  const frame = document.createElement('canvas');   // the ONE latest frame
  let frozen = null;                                 // { base: canvas copy of the frozen frame, drawn: boolean }

  // ---- Frames: scaled to 1280px on the long edge. Grabbed straight from the shared track (works even when this tab
  //      is in the background), with the hidden video as a fallback. ----
  function scaleInto(src, w, h) {
    const s = Math.min(1, MAX_EDGE / Math.max(w, h));
    frame.width = Math.round(w * s);
    frame.height = Math.round(h * s);
    frame.getContext('2d').drawImage(src, 0, 0, frame.width, frame.height);
  }
  async function capture() {
    if (!stream) return false;
    if (grabber) {
      try { const bmp = await grabber.grabFrame(); scaleInto(bmp, bmp.width, bmp.height); bmp.close(); return true; } catch (e) { /* fall back */ }
    }
    if (!E.video.videoWidth) return false;
    scaleInto(E.video, E.video.videoWidth, E.video.videoHeight);
    return true;
  }
  const snapshot = c => c.toDataURL('image/jpeg', JPEG_Q);
  const fitInput = chat.composer(E.input, E.form);   // Enter sends, Shift+Enter makes a new line (same rule as the main chat)

  // ---- Start / stop. The user picks the tab, window or screen EVERY time (Chrome's own picker). ----
  async function start() {
    if (stream) return;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (e) {
      stream = null;
      chat.caption('No screen shared.', true);   // cancelled or refused: normal chat carries on
      return;
    }
    const track = stream.getVideoTracks()[0];
    grabber = window.ImageCapture ? new ImageCapture(track) : null;
    E.video.srcObject = stream;
    try { await E.video.play(); } catch (e) {}
    track.addEventListener('ended', stop);   // the browser's own "Stop sharing" ends everything too
    loop = setInterval(capture, LOOP_MS);
    setTimeout(capture, 600);
    E.panel.hidden = false;
    E.freezeBtn.hidden = false;
    E.watchBtn.setAttribute('aria-pressed', 'true');
    note("I'm watching. Ask me about what you see — or hold my button to freeze the screen and circle something.");
    note('Tip: to keep working in other apps while I watch, share your whole screen or another window (not this tab) — then you can minimize Chrome and this panel stays up.');
    if (!(await popOut())) { E.float.hidden = !('documentPictureInPicture' in window); E.input.focus(); }
  }
  function stop() {
    clearInterval(loop); loop = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; grabber = null;
    E.video.srcObject = null;
    frame.width = frame.height = 0;   // no frame is kept
    unfreeze();
    if (pip) pip.close();             // closing the floating window brings the nodes home (see popOut)
    E.panel.hidden = true;
    E.freezeBtn.hidden = true;
    E.float.hidden = true;
    E.thread.replaceChildren();       // the snapshots shown in the mini chat go too
    E.watchBtn.setAttribute('aria-pressed', 'false');
  }
  E.watchBtn.addEventListener('click', () => (stream ? stop() : start()));
  E.stop.addEventListener('click', stop);
  window.addEventListener('simsim:signedout', stop);

  // ---- The floating window (Document Picture-in-Picture): stays above other windows and apps while Chrome runs ----
  async function popOut() {
    if (pip || !('documentPictureInPicture' in window)) return false;
    try { pip = await documentPictureInPicture.requestWindow({ width: 380, height: 640 }); }
    catch (e) { pip = null; return false; }   // e.g. Chrome wants a fresh click first: the "Float" button does it
    const d = pip.document;
    d.title = 'Sim Sim is watching';
    document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {   // same look: the app's own styles and theme
      const n = d.createElement('link'); n.rel = 'stylesheet'; n.href = l.href; d.head.append(n);
    });
    d.documentElement.setAttribute('style', document.documentElement.getAttribute('style') || '');
    ['data-dark', 'data-text'].forEach(a => { if (document.documentElement.hasAttribute(a)) d.documentElement.setAttribute(a, document.documentElement.getAttribute(a)); });
    d.body.className = 'in-pip';
    E.head.insertBefore(E.freezeBtn, E.stop);   // the hold-to-freeze button rides in the panel's header
    E.panel.insertBefore(E.layer, E.thread);     // the frozen frame shows inside the panel, above the thread
    d.body.append(E.panel);                      // the SAME nodes move — no second copy of the panel
    E.float.hidden = true;
    pip.addEventListener('pagehide', () => {     // the window closed (Stop, its own ✕, or Chrome closing)
      document.body.append(E.panel, E.layer, E.freezeBtn);
      pip = null;
      E.float.hidden = !stream;
    }, { once: true });
    E.input.focus();
    return true;
  }
  E.float.addEventListener('click', popOut);

  // ---- The mini chat ----
  function scroll() { E.thread.scrollTop = E.thread.scrollHeight; }
  function el(tag, cls) { const n = E.thread.ownerDocument.createElement(tag); if (cls) n.className = cls; return n; }
  function note(text) {
    const p = el('p', 'sp-note');
    p.textContent = text;
    E.thread.appendChild(p);
    scroll();
  }
  function mine(text, snap) {
    const d = el('div', 'user');
    if (snap) { const i = el('img', 'sp-snap'); i.src = snap; i.alt = 'Snapshot Sim Sim looked at'; d.append(i); }
    if (text) d.append(E.thread.ownerDocument.createTextNode(text));
    E.thread.appendChild(d);
    scroll();
  }
  function simMsg() {
    const d = el('div', 'msg');
    d.innerHTML = '<span class="avatar" aria-hidden="true">S</span><div class="body"><div class="txt"><span class="typing"><span></span><span></span><span></span></span></div></div>';
    E.thread.appendChild(d);
    scroll();
    return d;
  }

  // One action = at most one brain call. withSnapshot: a fresh frame (or the frozen, circled one) rides the question.
  async function ask(text, withSnapshot) {
    if (busy) return;
    busy = true;
    let snap = null, circled = false;
    if (withSnapshot) {
      if (frozen) { snap = snapshot(E.canvas); circled = frozen.drawn; }
      else if (await capture()) snap = snapshot(frame);
      else { busy = false; note("I can't see the screen yet — give it a second and try again."); return; }
    }
    const question = text || (circled ? 'What is this?' : "What's on my screen right now?");
    mine(text || 'Look', snap);
    const m = simMsg(), slot = m.querySelector('.txt');
    chat.setPill('Thinking', 'busy');
    let spoke = false;
    try {
      const { r, data } = await chat.postChat(question, snap ? { picture: snap, screen: true, circled } : {});
      if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); return; }
      if (r.ok && typeof data.reply === 'string' && !(snap && data.pictureNote)) {
        slot.textContent = data.reply;
        chat.speak(data.reply);
        spoke = true;
        if (data.turnId && window.SimSimMemory) window.SimSimMemory.learnFrom(data.turnId, m);   // learns from WORDS only
      } else {
        m.classList.add('error');
        // never a size or server error about the user's own message — one plain line about the frame instead
        slot.textContent = snap ? FRAME_FAIL : (data.error || 'Sim Sim could not get an answer.');
      }
    } catch (e) {
      m.classList.add('error');
      slot.textContent = snap ? FRAME_FAIL : 'Could not reach the Sim Sim server. Is it still running?';
    } finally {
      busy = false;
      if (!spoke) chat.idle();
      scroll();
    }
  }
  // Every message typed in the mini chat carries a FRESH snapshot.
  E.form.addEventListener('submit', e => {
    e.preventDefault();
    const text = E.input.value.trim();
    if (!text) return;
    E.input.value = '';
    fitInput();
    ask(text, true);
  });
  E.look.addEventListener('click', () => { const t = E.input.value.trim(); E.input.value = ''; fitInput(); ask(t, true); });
  // Voice while watching: "Sim Sim, look at this" (or anything while frozen) brings a snapshot; other commands are words only.
  function voice(text) { ask(text, frozen !== null || LOOK.test(text)); }

  // ---- Freeze & Ask: HOLD the Sim Sim button -> the frame freezes -> circle the part you mean -> ask ----
  E.freezeBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    clearTimeout(holdT);
    holdT = setTimeout(() => { holdT = null; freeze(); }, 350);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => E.freezeBtn.addEventListener(ev, () => {
    if (holdT) { clearTimeout(holdT); holdT = null; if (!frozen) note('Hold my button to freeze the screen, then circle what you mean.'); }
  }));

  async function freeze() {
    if (!(await capture())) { note("I can't see the screen yet — give it a second and try again."); return; }
    E.canvas.width = frame.width; E.canvas.height = frame.height;
    E.canvas.getContext('2d').drawImage(frame, 0, 0);
    const base = document.createElement('canvas');   // kept only to "Clear circle"
    base.width = frame.width; base.height = frame.height;
    base.getContext('2d').drawImage(frame, 0, 0);
    frozen = { base, drawn: false };
    E.layer.hidden = false;   // the live share keeps going behind the freeze
    E.input.placeholder = 'Ask about the circled part…';
    E.input.focus();
  }
  function unfreeze() {
    frozen = null;
    E.layer.hidden = true;
    E.canvas.width = E.canvas.height = 0;
    E.input.placeholder = 'Ask about your screen…';
  }
  E.close.addEventListener('click', unfreeze);
  E.clear.addEventListener('click', () => {
    if (!frozen) return;
    E.canvas.getContext('2d').drawImage(frozen.base, 0, 0);
    frozen.drawn = false;
  });

  // Drawing the circle (mouse or touch). The red stroke is part of the picture that is sent.
  let drawing = false;
  function point(e) {
    const r = E.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * E.canvas.width / r.width, y: (e.clientY - r.top) * E.canvas.height / r.height };
  }
  E.canvas.addEventListener('pointerdown', e => {
    if (!frozen) return;
    const ctx = E.canvas.getContext('2d'), p = point(e);
    ctx.strokeStyle = '#ff2d2d';   // the pen is set FIRST, so the circle is always red and bold
    ctx.lineWidth = Math.max(5, E.canvas.width / 200);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    drawing = true;
    try { E.canvas.setPointerCapture(e.pointerId); } catch (err) { /* keep drawing even without capture */ }
  });
  E.canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const ctx = E.canvas.getContext('2d'), p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    frozen.drawn = true;
  });
  ['pointerup', 'pointercancel'].forEach(ev => E.canvas.addEventListener(ev, () => { drawing = false; }));

  // ---- In the page (no floating window), the mini chat can be dragged like a picture-in-picture player ----
  let drag = null;
  E.head.addEventListener('pointerdown', e => {
    if (pip || e.target.closest('button')) return;
    const p = E.panel.getBoundingClientRect();
    drag = { dx: e.clientX - p.left, dy: e.clientY - p.top };
    try { E.head.setPointerCapture(e.pointerId); } catch (err) {}
  });
  E.head.addEventListener('pointermove', e => {
    if (!drag) return;
    const x = Math.min(Math.max(0, e.clientX - drag.dx), innerWidth - E.panel.offsetWidth);
    const y = Math.min(Math.max(0, e.clientY - drag.dy), innerHeight - E.panel.offsetHeight);
    E.panel.style.left = x + 'px'; E.panel.style.top = y + 'px';
    E.panel.style.right = 'auto'; E.panel.style.bottom = 'auto';
  });
  ['pointerup', 'pointercancel'].forEach(ev => E.head.addEventListener(ev, () => { drag = null; }));

  window.SimSimScreen = { isWatching: () => !!stream, voice, stop, isFloating: () => !!pip };
})();
