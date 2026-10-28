// SIM SIM Group Chat: one question, three answers (Sim Sim + the user's two bots), the user picks the best.
// All three are the ONE Meta brain on our server (three calls, three persona cards). Nothing is spoken before the pick.
(function () {
  const $ = id => document.getElementById(id);
  const chat = window.SimSimChat;
  const row = document.querySelector('.nav button[data-label="Discussion"]');
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');
  const MEMBERS = ['simsim', 'bot1', 'bot2'];
  const ROLE = { simsim: 'your main AI', bot1: 'facts & sources', bot2: 'another angle' };
  // ---- Reveal pacing (delivery only: the three brain calls still run at once). Tune here. ----
  // Each answer lands at the LATER of: when its call finished, or its slot (the previous answer + a gap + "typing" time
  // that grows a little with length). A finished answer is never held longer than HOLD_MAX_MS.
  const PACE = {
    FIRST_MS: 1200,       // Sim Sim's typing bubble shows at least this long after the question
    GAP_MS: 2000,         // the next member lands about 2 seconds after the previous one…
    PER_CHAR_MS: 1.5,     // …plus a little per character (a longer answer "took longer to type")…
    TYPE_MAX_MS: 1000,    // …capped, so each gap stays about 2 to 3 seconds
    HOLD_MAX_MS: 8000     // never hold a ready answer longer than this
  };
  let busy = false;       // true while the three brain calls are running (the reveal may still be playing after)
  const turns = [];   // { qid, cards: { member: element }, answers: { member: data }, pick, locked, expanded: Set }

  function profile() { return window.SimSimSetup.getProfile() || {}; }
  function nameOf(m) {
    if (m === 'simsim') return 'Sim Sim';   // fixed: Sim Sim has no rename anywhere
    const names = profile().botNames || ['Researcher', 'Challenger'];
    return m === 'bot1' ? names[0] : names[1];
  }
  function avatar(m, name) {
    const a = document.createElement('span');
    a.className = m === 'simsim' ? 'avatar' : 'avatar bot ' + (m === 'bot1' ? 'b1' : 'b2');
    a.setAttribute('aria-hidden', 'true');
    a.textContent = (name || nameOf(m)).charAt(0).toUpperCase();
    return a;
  }
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || 'That did not work.'); e.data = d; throw e; }
    return d;
  }

  // ---- The team header: three members, roles, rename for the two bots, pick counts ----
  function renderTeam() {
    const box = $('teamMembers');
    box.replaceChildren();
    MEMBERS.forEach(m => {
      const card = document.createElement('div');
      card.className = 'tm';
      const who = document.createElement('div');
      who.className = 'tm-who';
      if (m === 'simsim') {
        const b = document.createElement('b');
        b.textContent = 'Sim Sim';
        who.append(b);
      } else {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tm-name';
        b.textContent = nameOf(m);
        b.title = 'Rename ' + nameOf(m);
        b.setAttribute('aria-label', 'Rename ' + nameOf(m));
        b.addEventListener('click', () => startRename(m, who));
        who.append(b);
      }
      const role = document.createElement('small');
      role.textContent = ROLE[m];
      who.append(role);
      card.append(avatar(m), who);
      box.append(card);
    });
    const t = Object.assign({ simsim: 0, bot1: 0, bot2: 0 }, profile().taste);
    $('teamCounts').textContent = 'Your picks so far: Sim Sim ' + t.simsim + ' · ' + nameOf('bot1') + ' ' + t.bot1 + ' · ' + nameOf('bot2') + ' ' + t.bot2;
  }
  function startRename(m, who) {
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 30; input.value = nameOf(m);
    input.setAttribute('aria-label', 'New name for ' + nameOf(m));
    const err = document.createElement('small');
    err.className = 'err';
    const save = async () => {
      const names = [...(profile().botNames || ['Researcher', 'Challenger'])];
      names[m === 'bot1' ? 0 : 1] = input.value.trim().replace(/\s+/g, ' ');
      try { const d = await post('/api/profile/bots', { botNames: names }); window.SimSimSetup.setProfile(d.profile); renderTeam(); }
      catch (e) { err.textContent = e.message; }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') renderTeam(); });
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'mini-btn on'; ok.textContent = 'Save';
    ok.addEventListener('click', save);
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'mini-btn'; no.textContent = 'Cancel';
    no.addEventListener('click', renderTeam);
    const rowEl = document.createElement('div');
    rowEl.className = 'tm-rename';
    rowEl.append(input, ok, no);
    who.replaceChildren(rowEl, err);
    input.focus(); input.select();
  }

  // ---- One group question ----
  function scrollDown() { $('gthread').scrollTop = $('gthread').scrollHeight; }

  function memberCard(m) {
    const d = document.createElement('div');
    d.className = 'msg gmsg';
    d.dataset.member = m;
    const body = document.createElement('div');
    body.className = 'body';
    const head = document.createElement('div');
    head.className = 'name';
    head.innerHTML = '<b></b> <small></small><span class="pick-badge" hidden>Your pick</span>';
    head.querySelector('b').textContent = nameOf(m);
    head.querySelector('small').textContent = '· ' + ROLE[m];
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'fold-line';
    fold.hidden = true;
    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.innerHTML = '<span class="typing" aria-hidden="true"><span></span><span></span><span></span></span><small class="typing-who"></small>';
    txt.querySelector('.typing-who').textContent = nameOf(m) + ' is typing…';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'mini-btn pick-btn';
    pick.textContent = 'Pick this one';
    pick.hidden = true;
    body.append(head, fold, txt, pick);
    d.append(avatar(m), body);
    return d;
  }

  async function ask(text) {
    if (busy) return;
    busy = true;
    turns.forEach(flush);   // an earlier round still revealing: show the rest of it now — never make him wait for theatre
    // the earlier pick locks now (the server locks it when this question arrives)
    turns.forEach(t => { t.locked = true; paintTurn(t); });
    $('gPrivacy').hidden = true;
    const qid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    const turn = { qid, cards: {}, answers: {}, pick: null, locked: false, expanded: new Set(), revealing: true, flushing: false, wake: null, speakAfter: null };
    turns.push(turn);
    const you = document.createElement('div');
    you.className = 'user';
    you.textContent = text;
    $('gcol').append(you);
    MEMBERS.forEach(m => { turn.cards[m] = memberCard(m); });
    const asked = Date.now();
    chat.setPill('Thinking', 'busy');

    // exactly three calls — one per member, in parallel; each result keeps the time it was ready
    const results = MEMBERS.map(m => post('/api/group/answer', { qid, question: text, member: m }).then(
      d => { if (d.locked) applyLock(d.locked); return { d, at: Date.now() }; },
      e => { if (e.data && e.data.locked) applyLock(e.data.locked); return { e, at: Date.now() }; }));
    reveal(turn, results, asked);
    await Promise.all(results);
    busy = false;
    if (!turn.revealing && !chat.isSpeaking()) chat.idle();
  }

  // The reveal: one member at a time, in a fixed order, each after its own "is typing…" bubble.
  async function reveal(turn, results, asked) {
    let prev = asked;   // when the previous answer landed (the question itself, for Sim Sim)
    for (let i = 0; i < MEMBERS.length; i++) {
      const m = MEMBERS[i], card = turn.cards[m];
      if (!card.isConnected) { $('gcol').append(card); scrollDown(); }   // "<name> is typing…"
      const r = await results[i];
      if (!turn.flushing) {
        const typing = Math.min((r.d ? r.d.text.length : 0) * PACE.PER_CHAR_MS, PACE.TYPE_MAX_MS);
        const slot = prev + (i === 0 ? PACE.FIRST_MS : PACE.GAP_MS) + typing;
        const at = Math.min(Math.max(r.at, slot), r.at + PACE.HOLD_MAX_MS);
        await new Promise(done => { const t = setTimeout(done, Math.max(0, at - Date.now())); turn.wake = () => { clearTimeout(t); done(); }; });
        turn.wake = null;
      }
      land(turn, m, r);
      prev = Date.now();
    }
    turn.revealing = false;
    if (turn.speakAfter && turn.pick === turn.speakAfter) { chat.stopSpeaking(); chat.speak(turn.answers[turn.pick].text); }
    else if (!chat.isSpeaking() && !busy) chat.idle();
  }
  // Show the rest of a round at once (a new question, or signing out): every remaining card goes in now, in order.
  function flush(turn) {
    if (!turn.revealing) return;
    turn.flushing = true;
    MEMBERS.forEach(m => { if (!turn.cards[m].isConnected) $('gcol').append(turn.cards[m]); });
    if (turn.wake) turn.wake();
  }
  // One answer lands: its words, its sources, and its "Pick this one" button.
  function land(turn, m, r) {
    const card = turn.cards[m], txt = card.querySelector('.txt');
    if (r.d) {
      turn.answers[m] = r.d;
      card.querySelector('.name b').textContent = r.d.name;
      txt.textContent = r.d.text;
      if (r.d.sources && r.d.sources.length) chat.addCitation(card, r.d.sources);
      card.querySelector('.pick-btn').onclick = () => pickIt(turn, m);
    } else {
      card.classList.add('error');
      txt.textContent = r.e.message === 'signed out' ? '' : 'This answer could not come through.';
    }
    paintTurn(turn);
    scrollDown();
  }

  // ---- Picking: switch freely until the next question; then it is locked ----
  async function pickIt(turn, m) {
    if (turn.locked || turn.pick === m) return;
    try { await post('/api/group/pick', { qid: turn.qid, member: m }); }
    catch (e) { return; }
    turn.pick = m;
    turn.expanded.clear();
    paintTurn(turn);
    chat.stopSpeaking();
    // Speak ON: only the PICKED answer is ever spoken — and never during the reveal (a pick then speaks when it ends)
    if (turn.revealing) turn.speakAfter = m;
    else chat.speak(turn.answers[m].text);
  }
  function paintTurn(turn) {
    MEMBERS.forEach(m => {
      const card = turn.cards[m];
      if (!card) return;
      const picked = turn.pick === m, folded = !!turn.pick && !picked && !turn.expanded.has(m);
      card.classList.toggle('picked', picked);
      card.classList.toggle('folded', folded);
      card.querySelector('.pick-badge').hidden = !picked;
      const fold = card.querySelector('.fold-line');
      fold.hidden = !turn.pick || picked;
      fold.textContent = folded ? 'Answer from ' + (turn.answers[m] ? turn.answers[m].name : nameOf(m)) + ' — not picked · tap to view' : 'Hide this answer';
      fold.onclick = () => { if (turn.expanded.has(m)) turn.expanded.delete(m); else turn.expanded.add(m); paintTurn(turn); };
      const btn = card.querySelector('.pick-btn');
      btn.hidden = turn.locked || picked || !turn.answers[m];
    });
  }

  // The previous pick was locked on the server: show what it taught (chips) and the new counts.
  function applyLock(l) {
    const turn = turns.find(t => t.qid === l.qid);
    const card = turn && turn.cards[l.member];
    if (card) {
      if (l.learned && l.learned.length && window.SimSimMemory) window.SimSimMemory.showChips(card, l.learned);
      if (l.loops && l.loops.length && window.SimSimLoops) window.SimSimLoops.showChips(card, l.loops);
    }
    if (l.loops && l.loops.length) window.dispatchEvent(new Event('simsim:loopschanged'));
    if (l.learned && l.learned.length && window.SimSimMemory) window.SimSimMemory.refreshIfOpen();
    if (l.taste) { const p = profile(); p.taste = l.taste; renderTeam(); }
  }

  // ---- Showing and hiding the view (the composer and mic stay; they send group questions here) ----
  function openView() {
    window.SimSimSetup.showChat();      // closes Profile / Open loops / Briefing
    $('thread').hidden = true;
    $('groupView').hidden = false;
    chatRow.classList.remove('on'); chatRow.removeAttribute('aria-current');
    row.classList.add('on'); row.setAttribute('aria-current', 'page');
    renderTeam();
    $('gPrivacy').hidden = turns.length > 0;
    $('input').placeholder = 'Ask your team…';
    $('attach').hidden = true;   // pictures and Screen Watch are for the 1-on-1 chat only
    $('watchBtn').hidden = true;
    $('attachRemove').click();
    $('input').focus();
  }
  function hideView(restoreChat) {
    if ($('groupView').hidden) return;
    $('groupView').hidden = true;
    row.classList.remove('on'); row.removeAttribute('aria-current');
    $('input').placeholder = 'Talk or type to Sim Sim…';
    $('attach').hidden = false;
    $('watchBtn').hidden = false;
    if (restoreChat) {
      $('thread').hidden = false; $('composer').hidden = false;
      chatRow.classList.add('on'); chatRow.setAttribute('aria-current', 'page');
    }
  }
  row.addEventListener('click', openView);
  chatRow.addEventListener('click', () => hideView(true));
  $('newChat').addEventListener('click', () => hideView(true));
  window.addEventListener('simsim:profileopen', () => hideView(false));
  window.addEventListener('simsim:showchat', () => hideView(true));
  window.addEventListener('simsim:signedout', () => {
    turns.forEach(flush);
    turns.length = 0;
    $('gcol').querySelectorAll('.user, .msg').forEach(el => el.remove());
    $('gPrivacy').hidden = false;
    hideView(true);
  });

  window.SimSimGroup = { ask, isOpen: () => !$('groupView').hidden };
})();
