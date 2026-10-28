// SIM SIM wake by name: continuous listening + THE DOORMAN.
// Ears = Chrome's built-in speech recognition (Chrome sends the audio to Google's speech service to get text).
// The DOORMAN below is plain local code: it checks each heard phrase for "Sim Sim".
// No name -> the words are dropped right here: never stored, never logged, never sent to our server or the brain.
// Name heard -> Sim Sim wakes, and only the NEXT sentence goes to /api/chat as a normal message.
(function () {
  const $ = id => document.getElementById(id);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const chat = window.SimSimChat;

  // ---- THE DOORMAN ----
  function norm(s) {
    return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  }
  const NAME = 'sim sim'; // fixed: users cannot rename Sim Sim
  const WAKE_LIST = [...new Set([NAME, NAME.replace(/ /g, ''), NAME + ' ' + NAME, 'seem seem', 'sim seem', 'seem sim'])]
    .sort((a, b) => b.length - a.length); // longest first, so "sim sim sim sim" wins over "sim sim"
  // Returns null (no name: drop it), '' (just the name), or the words said after the name.
  function matchWake(raw) {
    const t = norm(raw);
    if (!t) return null;
    for (const w of WAKE_LIST) {
      if (t === w) return '';
      if (t.startsWith(w + ' ')) return t.slice(w.length + 1);
    }
    return null;
  }

  // ---- State ----
  let listenOn = true;
  try { listenOn = localStorage.getItem('simsim-listen') !== 'off'; } catch (e) {}
  let rec = null, restartT = null, errCount = 0;
  let needTap = false, blocked = false, permState = 'unknown', permKnown = false;
  let mode = 'idle';          // 'idle' (doorman on duty) or 'awake' (capturing the command)
  let cmdStart = 0, stripFirst = true;
  let greeting = false, greetUtter = null;
  let silenceT = null, giveUpT = null, greetT = null;
  let cooldownUntil = 0;
  let actx = null;

  function appOpen() { return !$('app').hidden; } // only inside the signed-in app, never on landing or setup
  function shouldListen() {
    return !!SR && permKnown && listenOn && !blocked && !needTap && appOpen() && !document.hidden &&
      !greeting && !chat.isSpeaking() && !chat.isDictating();
  }

  // ---- What the pill and caption say when nothing else is happening ----
  function paintIdle() {
    if (mode === 'awake') return chat.setPill('Awake', 'awake');
    if (!SR) return chat.setPill('Voice needs Chrome', 'warn');
    if (!listenOn) return chat.setPill('Ready', '');
    if (blocked) return chat.setPill('Mic is blocked — click the lock icon in the address bar to allow', 'warn');
    if (needTap) return chat.setPill('Tap to let Sim Sim listen', 'warn');
    chat.setPill('Listening for Sim Sim', '');
  }
  function captionText() {
    if (!SR) return 'Voice needs Chrome';
    return listenOn
      ? 'Say "Sim Sim" or press the mic. Chrome sends what the mic hears to Google to turn it into text.'
      : 'Press the mic to talk. Chrome sends what the mic hears to Google to turn it into text.';
  }
  function paintListen() {
    $('listenText').textContent = listenOn ? 'ON' : 'OFF';
    $('listen').setAttribute('aria-pressed', String(listenOn));
  }

  // ---- Listening engine: one continuous recognizer, restarted forever while allowed ----
  function startRec() {
    clearTimeout(restartT);
    if (rec || !shouldListen()) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.onresult = onResult;
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        if (permState === 'prompt') needTap = true; else blocked = true;   // dismissed the prompt vs. blocked
        paintIdle();
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        errCount++;   // real trouble (network, no mic): back off a little each time
      }
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      const wait = errCount ? Math.min(2000, 300 * Math.pow(2, errCount - 1)) : 300;
      restartT = setTimeout(startRec, wait);   // Chrome stops by itself now and then: start again
    };
    if (mode === 'awake') { cmdStart = 0; stripFirst = false; } // a new session numbers its phrases from 0
    rec = r;
    try { r.start(); } catch (e) { rec = null; errCount++; restartT = setTimeout(startRec, 1000); }
  }
  function pauseRec() {
    clearTimeout(restartT);
    if (!rec) return;
    const r = rec;
    rec = null;
    r.onresult = r.onend = r.onerror = null;
    try { r.abort(); } catch (e) {}
  }
  function resumeSoon() { clearTimeout(restartT); restartT = setTimeout(startRec, 300); }

  function onResult(e) {
    errCount = 0;
    if (chat.isBusy() || chat.isSpeaking()) return;     // a reply is on its way: nothing to do
    if (mode === 'awake') { updateCommand(e.results); return; }
    if (Date.now() < cooldownUntil) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const rest = matchWake(e.results[i][0].transcript);
      if (rest !== null) { wake(e.results, i, rest); return; }
    }
    // No name heard: nothing is kept. The words are simply dropped here.
  }

  // ---- Wake sequence ----
  function wake(results, i, rest) {
    mode = 'awake';
    cmdStart = i;
    stripFirst = true;
    if (!(window.SimSimGroup && window.SimSimGroup.isOpen())) window.SimSimSetup.showChat(); // in Group Chat, the command becomes a group question
    paintIdle();
    if (chat.speakOn()) chime();            // Speak answers OFF: no sound at all — the awake pill (and "I'm here") show it
    giveUpT = setTimeout(endAwake, 8000);   // said nothing? quietly go back to listening
    if (rest) updateCommand(results);       // "Sim Sim, what time is it" in one breath: already the command
    else greetT = setTimeout(greet, 700);   // wait a beat: if words follow the name, skip the greeting
  }

  function greet() {
    greetT = null;
    if (mode !== 'awake') return;
    const name = window.SimSimSetup.callName();
    const line = name ? "I'm here, " + name + '.' : "I'm here.";
    if (!chat.speakOn() || !window.speechSynthesis) { chat.addSimText(line); return; }   // Speak OFF: a quiet bubble
    pauseRec();               // don't hear our own greeting
    greeting = true;
    const u = new SpeechSynthesisUtterance(line);
    u.rate = chat.rate();     // Settings > Voice > Speaking speed
    greetUtter = u;           // kept so Chrome doesn't drop its "done" signal
    u.onend = u.onerror = ev => {
      if (greetUtter !== u) return;
      greetUtter = null;
      greeting = false;
      if (ev.type === 'error' && ev.error === 'not-allowed') chat.addSimText(line);   // Chrome blocked the voice: show it instead
      if (mode === 'awake') { clearTimeout(giveUpT); giveUpT = setTimeout(endAwake, 8000); }
      startRec();
    };
    speechSynthesis.speak(u);
  }

  function commandText(results) {
    const parts = [];
    for (let i = cmdStart; i < results.length; i++) {
      let t = results[i][0].transcript;
      if (i === cmdStart && stripFirst) { const r = matchWake(t); t = r === null ? '' : r; }
      parts.push(t.trim());
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  function updateCommand(results) {
    const t = commandText(results);
    if (!t) return;
    clearTimeout(greetT); greetT = null;
    clearTimeout(giveUpT);
    clearTimeout(silenceT);
    showLive(t);
    if (results[results.length - 1].isFinal) sendCommand(t);
    else silenceT = setTimeout(() => sendCommand(t), 1200);   // ~1.2s of quiet ends the command
  }
  function sendCommand(t) {
    if (mode !== 'awake') return;
    clearTimers();
    mode = 'idle';
    pauseRec();
    hideLive();
    $('input').value = ''; chat.fitInput();
    cooldownUntil = Date.now() + 1500;
    chat.send(t, { viaWake: true });   // the same flow as typing it (flagged, for the "good morning" briefing)
  }
  function endAwake() {
    if (mode !== 'awake') return;
    clearTimers();
    mode = 'idle';
    hideLive();
    $('input').value = ''; chat.fitInput();
    paintIdle();
  }
  function clearTimers() {
    [silenceT, giveUpT, greetT].forEach(clearTimeout);
    silenceT = giveUpT = greetT = null;
  }
  function showLive(t) { $('live').hidden = false; $('liveText').textContent = t; $('input').value = t; chat.fitInput(); }
  function hideLive() { $('live').hidden = true; $('liveText').textContent = ''; }

  // A soft two-tone chime, made on the spot (no audio file).
  function chime() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      [[660, 0], [880, 0.13]].forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.07, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
        o.connect(g).connect(actx.destination);
        o.start(t + d); o.stop(t + d + 0.3);
      });
    } catch (e) {}
  }

  // Chrome only lets a page make sound after one click on it. Until then, say so on the caption line.
  function needsClickForVoice() {
    return chat.speakOn() && navigator.userActivation && !navigator.userActivation.hasBeenActive;
  }
  function unlockSound() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) {}
    chat.caption(captionText());
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlockSound, { once: true, capture: true }));

  // ---- Controls ----
  $('listen').addEventListener('click', () => {
    listenOn = !listenOn;
    try { localStorage.setItem('simsim-listen', listenOn ? 'on' : 'off'); } catch (e) {}
    paintListen();
    chat.caption(captionText());
    if (listenOn) startRec(); else { endAwake(); pauseRec(); }
    paintIdle();
  });
  $('pill').addEventListener('click', () => {
    if (blocked) { $('micHelp').hidden = !$('micHelp').hidden; return; }
    if (needTap) { needTap = false; paintIdle(); startRec(); }   // this first start makes Chrome ask for the mic
  });

  // Typing while awake: the typed message wins, the wake ends quietly.
  $('form').addEventListener('submit', () => { if (mode === 'awake') endAwake(); });

  window.addEventListener('simsim:speakstart', pauseRec);
  window.addEventListener('simsim:voicefree', () => {
    if (!chat.isBusy() && !chat.isSpeaking()) { cooldownUntil = Math.max(cooldownUntil, Date.now() + 1500); resumeSoon(); }
  });
  window.addEventListener('simsim:dictationstart', () => { endAwake(); pauseRec(); });
  window.addEventListener('simsim:dictationend', resumeSoon);
  window.addEventListener('simsim:signedout', () => { endAwake(); pauseRec(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { endAwake(); pauseRec(); } else resumeSoon();
  });
  // The app screen appears after sign-in/setup and hides on sign-out or "Edit my basics".
  new MutationObserver(() => {
    if (appOpen()) {
      resumeSoon();
      if (needsClickForVoice()) chat.caption('Click anywhere once so Sim Sim can answer out loud.');
    } else { endAwake(); pauseRec(); }
  }).observe($('app'), { attributes: true, attributeFilter: ['hidden'] });

  // ---- Start: check the mic permission first, so Chrome never pops a prompt by surprise ----
  async function init() {
    window.SimSimWake = { paintIdle, captionText };
    paintListen();
    chat.caption(captionText());
    if (!SR) { $('listen').hidden = true; paintIdle(); return; }
    try {
      const p = await navigator.permissions.query({ name: 'microphone' });
      const apply = () => {
        permKnown = true;
        permState = p.state;
        blocked = p.state === 'denied';
        needTap = p.state === 'prompt';
        if (!blocked) $('micHelp').hidden = true;
        if (blocked || needTap) { endAwake(); pauseRec(); }
        paintIdle();
        startRec();
      };
      apply();
      p.onchange = apply;     // re-allowing the mic recovers listening without a reload
    } catch (e) {
      permKnown = true;
      needTap = true;
      paintIdle();
    }
  }
  init();
})();
