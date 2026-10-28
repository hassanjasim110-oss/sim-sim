// SIM SIM morning briefing view: today's composed briefing + the raw items it was built from.
// The items come from the user's own notebook on OUR server; the words come from the Meta brain (one call per day, cached).
(function () {
  const $ = id => document.getElementById(id);
  const row = document.querySelector('.nav button[data-label="Morning briefing"]');
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');
  const chat = window.SimSimChat;
  let current = null;     // { text, items, ... } on screen
  let reading = false;    // "Read it to me" is speaking
  let loadId = 0;

  // The user's local date, so "today" and the day-cache follow their own calendar.
  function localDate() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function longDate(ymd) {
    return new Date(ymd + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function shortDate(ymd) {
    return new Date(ymd + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---- Read it to me (works even with Speak answers OFF; tap again to stop) ----
  function paintRead() {
    $('briefRead').textContent = reading ? 'Stop reading' : 'Read it to me';
    $('briefRead').setAttribute('aria-pressed', String(reading));
  }
  function read(force) {
    if (!current || !current.text) return;
    chat.speak(current.text, force);
    reading = chat.isSpeaking();
    paintRead();
  }
  function stopReading() {
    if (reading) chat.stopSpeaking();
    reading = false;
    paintRead();
  }
  window.addEventListener('simsim:voicefree', () => { if (reading && !chat.isSpeaking()) { reading = false; paintRead(); } });
  $('briefRead').addEventListener('click', () => (reading ? stopReading() : read(true)));

  // ---- Showing the briefing ----
  function section(title, rows) {
    if (!rows.length) return null;   // an empty section is skipped entirely
    const box = document.createElement('section');
    box.className = 'brief-section';
    const h = document.createElement('h3');
    h.textContent = title;
    const ul = document.createElement('ul');
    rows.forEach(([text, meta]) => {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.textContent = text;
      li.append(t);
      if (meta) { const m = document.createElement('small'); m.textContent = meta; li.append(m); }
      ul.append(li);
    });
    box.append(h, ul);
    return box;
  }
  function render(b) {
    current = b;
    $('briefHello').textContent = b.greeting;
    $('briefDate').textContent = longDate(b.date);
    $('briefText').textContent = b.text;
    const items = b.items || { loops: [], comingUp: [], remember: [] };
    const parts = [
      section('Your open loops', items.loops.map(l => [l.text, l.dueDate ? shortDate(l.dueDate) + ' · ' + l.due : 'no due date'])),
      section('Coming up', items.comingUp.map(c => [c.text, shortDate(c.date) + ' · ' + c.when])),
      section('Remember', items.remember.map(r => [r.text, '']))
    ].filter(Boolean);
    $('briefItems').replaceChildren(...parts);
  }

  async function load(force) {
    const my = ++loadId;
    stopReading();
    $('briefErr').textContent = '';
    // never show an older briefing as today's while waiting
    if (!current || current.date !== localDate() || force) {
      $('briefText').textContent = '';
      $('briefItems').replaceChildren();
      $('briefWait').hidden = false;
    }
    $('briefRefresh').disabled = true;
    try {
      const r = force
        ? await fetch('/api/briefing/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: localDate() }) })
        : await fetch('/api/briefing?date=' + localDate(), { cache: 'no-store' });
      if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); return null; }
      const b = await r.json().catch(() => ({}));
      if (my !== loadId) return null;
      if (!r.ok) { $('briefErr').textContent = b.error || 'The briefing could not be made right now.'; return null; }
      render(b);
      return b;
    } catch (e) {
      if (my === loadId) $('briefErr').textContent = 'Could not reach the Sim Sim server. Is it still running?';
      return null;
    } finally {
      if (my === loadId) { $('briefWait').hidden = true; $('briefRefresh').disabled = false; }
    }
  }
  $('briefRefresh').addEventListener('click', async () => { await load(true); });

  // ---- Opening and closing the view (inside the main area, like Profile and Open loops) ----
  async function openView() {
    window.SimSimSetup.showChat();      // closes Profile / Open loops if open
    $('thread').hidden = true;
    $('composer').hidden = true;
    $('briefView').hidden = false;
    chatRow.classList.remove('on'); chatRow.removeAttribute('aria-current');
    row.classList.add('on'); row.setAttribute('aria-current', 'page');
    if (current) render(current);
    const b = await load(false);
    if (b && !$('briefView').hidden && chat.speakOn()) read(false);   // Speak ON: read it once per open
  }
  function hideView(restoreChat) {
    if ($('briefView').hidden) return;
    stopReading();
    loadId++;
    $('briefView').hidden = true;
    row.classList.remove('on'); row.removeAttribute('aria-current');
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
  window.addEventListener('simsim:signedout', () => { current = null; hideView(true); });
})();
