// SIM SIM wake by name: continuous listening + THE DOORMAN.
// Ears = Chrome's built-in speech recognition (Chrome sends the audio to Google's speech service to get text).
// The DOORMAN below is plain local code: it checks each heard phrase for "Sim Sim".
// No name -> the words are dropped right here: never stored, never logged, never sent to our server or the brain.
// Name heard -> Sim Sim wakes and this same ear hands the request to the chat's ONE voice-capture flow (app.js,
// shared with the mic button): typed live into the question bar, sent after 3 seconds of quiet.
(function () {
  const $ = id => document.getElementById(id);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const chat = window.SimSimChat;

  // ---- THE DOORMAN ----
  // Google's recognizer writes the name many ways: "Sim Sim", "simsim", "Sim-Sim", "SIM sim", "seem seem", "sim sims"…
  // So every transcript (interim AND final) is squeezed — lowercase, no spaces, no punctuation — and searched
  // for these forms ANYWHERE in it ("hey Sim Sim, …" wakes too). Sim Sim's name is fixed: users cannot rename it.
  // "Simpson" / "Simson": how Google heard the founder's "Sim Sim" live (2026-10-30) — before this, that was dropped as
  // "no name", so nothing reached the question bar. ("simpsons" contains "simpson". "Samsung" stays OUT: too many false wakes.)
  const WAKE_FORMS = ['simsim', 'seemseem', 'simseem', 'seemsim', 'simpson', 'simson'];   // "simsims" contains "simsim"
  function words(raw) { return raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean); }
  // Returns null (no name: drop it), '' (just the name), or the words said after the name.
  function matchWake(raw) {
    const ws = words(raw);
    let joined = '';
    const owner = [];   // for each letter of the squeezed text: which word it came from
    ws.forEach((w, i) => { joined += w; for (let k = 0; k < w.length; k++) owner.push(i); });
    let at = -1, form = '';
    for (const f of WAKE_FORMS) { const i = joined.indexOf(f); if (i >= 0 && (at < 0 || i < at)) { at = i; form = f; } }
    if (at < 0) return null;
    let end = at + form.length;   // just past the name
    for (let more = true; more;) {   // "sim sim sim sim": a repeated name is still just the name
      more = false;
      for (const f of WAKE_FORMS) if (joined.startsWith(f, end)) { end += f.length; more = true; break; }
    }
    return ws.slice(owner[end - 1] + 1).join(' ');
  }

  // ---- State ----
  let listenOn = true;
  try { listenOn = localStorage.getItem('simsim-listen') !== 'off'; } catch (e) {}
  let rec = null, running = false, startedAt = 0, downSince = Date.now(), restartT = null;
  let failCount = 0, lastError = null;   // network-type trouble in a row (backs off; 8 in a row -> "Tap to listen")
  let needTap = false, blocked = false, permState = 'unknown', permKnown = false;
  let mode = 'idle';          // 'idle' (doorman on duty) or 'awake' (capturing the command)
  let cmdStart = 0, stripFirst = true;
  let firstRest = '';         // the words after the name in the wake phrase (kept if Chrome later re-writes the name)
  let carried = '', said = '';   // the request so far: from earlier recognizer sessions / in total
  let greeting = false, greetUtter = null;
  let greetT = null;
  // After the name alone, wait this long for words before saying "I'm here". The ear is paused while it speaks, so
  // a short wait (it was 0.7 s) made it deaf just as most people start their request — the founder's lost words.
  const GREET_WAIT_MS = 2500;
  let cooldownUntil = 0;
  let actx = null;

  function appOpen() { return !$('app').hidden; } // only inside the signed-in app, never on landing or setup
  // The ear keeps listening while the Sim Sim tab is open — also when Chrome is covered or minimized, or the screen
  // sleeps (Chrome then calls the page "hidden"; pausing there is what left the ear dead after a few idle minutes).
  function shouldListen() {
    return !!SR && permKnown && listenOn && !blocked && !needTap && appOpen() && !otherTabHasEar &&
      !greeting && !chat.isSpeaking() && !chat.isBusy() && !chat.isDictating();
  }

  // One ear per browser: the Sim Sim tab you looked at last listens; any other Sim Sim tab stays quiet
  // (otherwise two tabs would both wake and both answer).
  const ears = 'BroadcastChannel' in window ? new BroadcastChannel('simsim-ear') : null;
  let otherTabHasEar = false, takeOverT = null;
  function claimEar() { clearTimeout(takeOverT); otherTabHasEar = false; if (ears) ears.postMessage('mine'); }
  if (ears) ears.onmessage = e => {
    if (e.data === 'mine') { clearTimeout(takeOverT); otherTabHasEar = true; endAwake(); pauseRec(); paintIdle(); }
    // the listening tab closed: one remaining Sim Sim tab takes the ear (a short random wait, so two don't both)
    if (e.data === 'released' && otherTabHasEar) {
      clearTimeout(takeOverT);
      takeOverT = setTimeout(() => { if (otherTabHasEar) { claimEar(); resumeSoon(); } }, Math.random() * 400);
    }
  };
  window.addEventListener('pagehide', () => { if (ears && !otherTabHasEar) ears.postMessage('released'); });

  // ---- What the pill and caption say when nothing else is happening ----
  // The pill tells the TRUTH: "Listening" only while the recognizer is really running (Chrome said it started).
  // Chrome restarts it often; a gap shorter than GRACE_MS keeps the last words instead of flickering.
  const GRACE_MS = 1200;
  function paintIdle() {
    if (chat.capture.active()) return chat.setPill('Taking your request…', 'awake');   // after "Sim Sim" or the mic button
    if (!SR) return chat.setPill("This browser can't listen — Sim Sim works by typing here.", 'warn');
    if (!listenOn) return chat.setPill('Ready', '');
    if (blocked) return chat.setPill('Mic is blocked — click the mic icon in the address bar to allow it', 'warn');
    if (needTap) return chat.setPill('Tap to listen', 'warn');
    if (otherTabHasEar) return chat.setPill('Listening in another Sim Sim tab — tap to listen here', 'warn');
    if (running || Date.now() - downSince < GRACE_MS) return chat.setPill("Listening for 'Sim Sim'…", '');
    // starting, or about to start (the watchdog starts it within a second whenever it should be listening)
    if (rec || restartT || shouldListen()) return chat.setPill('Starting the mic…', '');
    chat.setPill('Tap to listen', 'warn');   // the ear is down and nothing will bring it back by itself: a click does
  }
  function pillTaken() { return $('pill').classList.contains('busy'); }   // "Thinking" / "Speaking" belong to the chat
  function captionText() {
    if (!SR) return "This browser can't listen — Sim Sim works by typing here.";
    return listenOn
      ? 'Say "Sim Sim" or press the mic. Chrome sends what the mic hears to Google to turn it into text.'
      : 'Press the mic to talk. Chrome sends what the mic hears to Google to turn it into text.';
  }
  function paintListen() {
    $('listenText').textContent = listenOn ? 'ON' : 'OFF';
    $('listen').setAttribute('aria-pressed', String(listenOn));
  }

  // ---- Listening engine: one continuous recognizer that keeps itself alive ----
  // Chrome stops recognition by itself (silence, a finished phrase, small errors). Every stop is caught in onend:
  //  - a plain stop            -> start again right away
  //  - no-speech / aborted / network and other trouble -> start again after ~500 ms, backing off if it repeats
  //  - not-allowed             -> stop; the pill says the mic is blocked (never a restart loop)
  //  - no microphone, or 8 failures in a row -> stop; the pill offers "Tap to listen"
  // A watchdog (below) also restarts the ear if anything ever leaves it down while it should be listening.
  function startRec() {
    clearTimeout(restartT); restartT = null;
    if (rec || !shouldListen()) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    // Listens in the user's chosen Language (Profile → Edit basics; founder, 2026-11-04 — "Pretty dropdowns +
    // Country + Language"), English before a profile has loaded or when none was ever picked.
    r.lang = window.SimSimSetup ? window.SimSimSetup.recognitionLang() : 'en-US';
    r.onstart = () => {
      if (rec !== r) return;
      running = true;
      if (!pillTaken()) paintIdle();
    };
    r.onresult = e => { if (rec === r) onResult(e); };
    r.onerror = e => {
      if (rec !== r) return;
      lastError = e.error;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        if (document.hidden && permState === 'granted') failCount++;      // refused only while out of sight: try again
        else if (permState === 'prompt') needTap = true; else blocked = true;   // dismissed the prompt vs. blocked
      } else if (e.error === 'audio-capture') {
        needTap = true;                                                   // no microphone right now: a tap tries again
        chat.caption('No microphone was found. Plug one in, then tap the pill to listen.', true);
      } else if (e.error === 'language-not-supported') {
        needTap = true;   // never fails silently, and never loops retrying a language the browser can't hear
        chat.caption("This browser can't listen in the language you picked. Pick a different one in Profile → Edit basics, or switch back to English.", true);
      } else if (e.error === 'no-speech') {
        failCount = 0;                                                    // the service works; it just heard nothing
      } else if (e.error !== 'aborted') {
        failCount++;                                                      // network and other trouble
      }
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      running = false;
      downSince = Date.now();
      if (failCount >= 8) needTap = true;   // it keeps failing: stop trying by itself, offer the tap
      if (blocked || needTap) { lastError = null; if (!pillTaken()) paintIdle(); return; }
      const wait = lastError ? Math.min(8000, 500 * Math.pow(2, Math.max(0, failCount - 1))) : 150;
      lastError = null;
      restartT = setTimeout(startRec, wait);
    };
    // a new session numbers its phrases from 0; the words already heard are carried, never lost
    if (mode === 'awake') { cmdStart = 0; stripFirst = false; carried = said; }
    rec = r;
    startedAt = Date.now();
    try { r.start(); } catch (e) { rec = null; failCount++; restartT = setTimeout(startRec, 1000); }
  }
  function pauseRec() {
    clearTimeout(restartT); restartT = null;
    if (!rec) return;
    const r = rec;
    rec = null;
    if (running) downSince = Date.now();
    running = false;
    r.onstart = r.onresult = r.onend = r.onerror = null;
    try { r.abort(); } catch (e) {}
  }
  function resumeSoon() { clearTimeout(restartT); restartT = setTimeout(startRec, 300); }

  // ---- The watchdog: once a second, make sure the ear is alive whenever it should be ----
  let quietFor = 0;
  setInterval(() => {
    if (!SR) return;
    // Chrome sometimes never sends "done" for a spoken reply; the app would think it is still talking and the ear
    // would never come back. If nothing is really playing for 3 seconds, clear it.
    const playing = (window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) || chat.designedSpeaking();   // a designed voice counts too
    quietFor = (chat.isSpeaking() || greeting) && !playing ? quietFor + 1000 : 0;
    if (quietFor >= 3000) {
      quietFor = 0;
      if (greeting) { greeting = false; greetUtter = null; }
      chat.stopSpeaking();   // -> idle -> "voicefree" -> listening resumes
    }
    // A start Chrome never confirmed: throw it away and try again.
    if (rec && !running && Date.now() - startedAt > 8000) {
      const r = rec;
      rec = null;
      r.onstart = r.onresult = r.onend = r.onerror = null;
      try { r.abort(); } catch (e) {}
      failCount++;
    }
    if (!rec && !restartT && shouldListen()) startRec();   // down, and nothing planned to bring it back: start now
    if (!pillTaken()) paintIdle();
  }, 1000);

  // Each result is checked for the name (or, while taking a request, handed to the question bar). The words are never
  // painted anywhere else on screen (founder, 2026-10-30: the old "Heard" line is gone).
  function onResult(e) {
    failCount = 0;
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
    firstRest = rest; carried = ''; said = '';
    if (!(window.SimSimGroup && window.SimSimGroup.isOpen())) window.SimSimSetup.showChat(); // in Group Chat, the command becomes a group question
    // the chat's capture flow owns the question bar, the 3-second send and the 8-second "said nothing" give-up
    chat.capture.start('wake', captureEnded);
    if (chat.speakOn()) chime();            // Speak answers OFF: no sound at all — the pill (and "I'm here") show it
    if (rest) updateCommand(results);       // "Sim Sim, tell me a joke" in one breath: already the request
    else greetT = setTimeout(greet, GREET_WAIT_MS);   // words follow the name? then no greeting at all
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
      if (mode === 'awake') chat.capture.waitMore();   // a fresh 8 seconds to start talking after "I'm here"
      startRec();
    };
    speechSynthesis.speak(u);
  }

  // The request so far, rebuilt from this session's results each time (never appended twice), without the name itself.
  function commandText(results) {
    const parts = [];
    for (let i = cmdStart; i < results.length; i++) {
      let t = results[i][0].transcript;
      if (i === cmdStart && stripFirst) {
        const r = matchWake(t);
        if (r !== null) firstRest = r;
        t = firstRest;   // Chrome re-wrote the name ("Simpson, tell…"): keep the words already heard after it, never the name
      }
      parts.push(t.trim());
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  // Awake: every result goes to the question bar through the chat's capture flow (which restarts its 3-second clock).
  function updateCommand(results) {
    const t = [carried, commandText(results)].filter(Boolean).join(' ');
    if (!t) return;   // only the name so far
    clearTimeout(greetT); greetT = null;
    said = t;
    chat.capture.words(t);
  }
  // The capture is over: sent (the reply comes next; the ear rests until it is done), or cancelled / nothing said
  // (the doorman starts a fresh session, so the words of this request are never matched for the name again).
  function captureEnded(reason) {
    if (mode !== 'awake') return;
    clearTimeout(greetT); greetT = null;
    mode = 'idle';
    carried = said = firstRest = '';
    cooldownUntil = Date.now() + 1500;
    pauseRec();
    if (reason !== 'sent') resumeSoon();
    paintIdle();
  }
  function endAwake() {
    if (mode === 'awake') chat.capture.end('away', 'wake');
  }

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
    // "Tap to listen": start the ear again (the very first start is also what makes Chrome ask for the mic)
    if (SR && listenOn && !running && mode !== 'awake' && !pillTaken()) {
      needTap = false; failCount = 0;
      claimEar();   // also moves the ear here from another Sim Sim tab
      pauseRec(); startRec(); paintIdle();
    }
  });

  window.addEventListener('simsim:speakstart', pauseRec);
  window.addEventListener('simsim:voicefree', () => {
    if (!chat.isBusy() && !chat.isSpeaking()) { cooldownUntil = Math.max(cooldownUntil, Date.now() + 1500); resumeSoon(); }
  });
  window.addEventListener('simsim:dictationstart', () => { endAwake(); pauseRec(); });
  window.addEventListener('simsim:dictationend', resumeSoon);
  window.addEventListener('simsim:signedout', () => { endAwake(); pauseRec(); });
  // Looking at this tab makes it THE listening tab; going out of sight does NOT stop the ear.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && appOpen()) { claimEar(); resumeSoon(); }
  });
  // The app screen appears after sign-in/setup and hides on sign-out or "Edit my basics".
  new MutationObserver(() => {
    if (appOpen()) {
      if (!document.hidden) claimEar();
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
    if (!document.hidden) claimEar();
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
