// SIM SIM timed reminders on the page (founder, 2026-10-30). Due reminders show as a Sim Sim message at the TOP of the chat,
// and every reminder that isn't done is listed in Open loops. Delivery is honest: this works while Sim Sim is open on this
// computer (the page checks every 15 seconds); nothing reaches a phone when the app is closed. A reminder is marked
// "shown" on the server only after it was really on screen (the chat visible, the tab in view).
(function () {
  const $ = id => document.getElementById(id);
  const chat = window.SimSimChat;
  let list = [], timer = null;

  async function call(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) throw new Error('signed out');
    return r.json().catch(() => ({}));
  }

  async function refresh() {
    let d;
    try { d = await call('/api/reminders'); } catch (e) { return; }
    if (!Array.isArray(d.reminders)) return;
    // the server's clock decides what is due (the page's clock may differ a little)
    const skew = Date.now() - d.now;
    list = d.reminders.map(r => Object.assign(r, { due: r.dueAt <= Date.now() - skew }));
    paintBar();
    paintList();
  }

  // ---- At the top of the chat: every due reminder that isn't done, until Done ----
  function paintBar() {
    const due = list.filter(r => r.due);
    const bar = $('remBar');
    bar.replaceChildren();
    bar.hidden = !due.length;
    due.forEach(r => {
      const m = document.createElement('div');
      m.className = 'msg rem-msg';
      m.innerHTML = '<span class="avatar" aria-hidden="true">S</span><div class="body"><div class="name">Sim Sim · Reminder</div><div class="txt"></div></div>';
      const txt = m.querySelector('.txt');
      txt.append(document.createTextNode('Reminder: ' + r.text + ' '));
      const when = document.createElement('small');
      when.textContent = '(' + r.when.replace(/^today at /, '') + ')';
      const done = document.createElement('button');
      done.type = 'button'; done.className = 'mini-btn on'; done.textContent = 'Done';
      done.addEventListener('click', () => markDone(r.id));
      txt.append(when, done);
      bar.append(m);
    });
    markShownIfSeen();
  }
  // "shown" only when it was really on screen: the chat column visible and this tab in view
  async function markShownIfSeen() {
    const fresh = list.filter(r => r.due && !r.shown);
    if (!fresh.length || $('thread').hidden || $('app').hidden || document.visibilityState !== 'visible') return;
    fresh.forEach(r => { r.shown = true; });
    try { await call('/api/reminders/shown', { ids: fresh.map(r => r.id) }); } catch (e) {}
    if (chat.speakOn()) chat.speak(fresh.map(r => 'Reminder: ' + r.text + '.').join(' '));
  }
  async function markDone(id) {
    try { await call('/api/reminders/done', { id }); } catch (e) {}
    refresh();
  }

  // ---- In Open loops: every reminder that isn't done, soonest first ----
  function paintList() {
    const ul = $('remList');
    ul.replaceChildren();
    $('remEmpty').hidden = list.length > 0;
    list.forEach(r => {
      const li = document.createElement('li');
      li.className = 'loop';
      const text = document.createElement('p');
      text.className = 'loop-text'; text.textContent = r.text;
      const meta = document.createElement('small');
      meta.className = 'loop-meta' + (r.due ? ' late' : '');
      meta.textContent = r.due ? 'Due — ' + r.when : r.when.charAt(0).toUpperCase() + r.when.slice(1);
      const done = document.createElement('button');
      done.type = 'button'; done.className = 'mini-btn'; done.textContent = 'Done';
      done.addEventListener('click', () => markDone(r.id));
      const words = document.createElement('div');
      words.append(text, meta);
      li.append(words, done);
      ul.append(li);
    });
  }

  function start() { clearInterval(timer); refresh(); timer = setInterval(refresh, 15000); }
  window.addEventListener('simsim:signedin', start);
  window.addEventListener('simsim:reminderschanged', refresh);
  window.addEventListener('simsim:signedout', () => { clearInterval(timer); list = []; paintBar(); paintList(); });
  document.addEventListener('visibilitychange', markShownIfSeen);
  new MutationObserver(markShownIfSeen).observe($('thread'), { attributes: true, attributeFilter: ['hidden'] });
  window.SimSimReminders = { refresh };
})();
