// SIM SIM open loops on screen: the Open loops view, the live sidebar badge, and the quiet "Loop opened:" chips.
// The loops themselves live in the user's notebook on OUR server. Only the user closes a loop: Done here, or "done with …" in chat.
(function () {
  const $ = id => document.getElementById(id);
  const row = document.querySelector('.nav button[data-label="Open loops"]');
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');
  const badge = row.querySelector('.badge');
  let data = { today: '', open: [], closed: [] };

  async function call(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'That did not work. Please try again.');
    return d;
  }

  // ---- Live badge: OPEN loops only ----
  function paintBadge() {
    const n = data.open.length;
    badge.textContent = String(n);
    badge.setAttribute('aria-label', n + ' open');
  }
  async function refresh() {
    try { data = await call('/api/loops'); paintBadge(); if (!$('loopsView').hidden) render(); } catch (e) {}
  }

  // ---- Calm labels ----
  function days(due) { return Math.round((new Date(due + 'T12:00:00') - new Date(data.today + 'T12:00:00')) / 86400000); }
  function dueLabel(due) {
    const n = days(due);
    if (n === 0) return 'Due today';
    if (n === 1) return 'Due tomorrow';
    if (n > 1) return 'Due in ' + n + ' days';
    return 'Overdue by ' + -n + (n === -1 ? ' day' : ' days');
  }
  function nice(dateStr) {
    const d = new Date(dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function render() {
    const list = $('loopList');
    list.replaceChildren();
    $('loopEmpty').hidden = data.open.length > 0;
    data.open.forEach(l => {
      const li = document.createElement('li');
      li.className = 'loop';
      const main = document.createElement('div');
      main.className = 'loop-main';
      const text = document.createElement('p');
      text.className = 'loop-text';
      text.textContent = l.text;
      main.append(text);
      if (l.dueDate) {
        const meta = document.createElement('small');
        meta.className = 'loop-meta' + (days(l.dueDate) < 0 ? ' late' : '');
        meta.textContent = nice(l.dueDate) + ' · ' + dueLabel(l.dueDate);
        main.append(meta);
      }
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'mini-btn';
      done.textContent = 'Done';
      done.setAttribute('aria-label', 'Done: ' + l.text);
      done.addEventListener('click', async () => {
        done.disabled = true;
        try { data = await call('/api/loops/done', { id: l.id }); paintBadge(); render(); }
        catch (e) { done.disabled = false; $('loopErr').textContent = e.message; }
      });
      li.append(main, done);
      list.appendChild(li);
    });
    // Closed: folded by default
    $('closedBox').hidden = data.closed.length === 0;
    $('closedCount').textContent = String(data.closed.length);
    const cl = $('closedList');
    cl.replaceChildren();
    data.closed.forEach(l => {
      const li = document.createElement('li');
      li.className = 'loop closed';
      const main = document.createElement('div');
      main.className = 'loop-main';
      const text = document.createElement('p');
      text.className = 'loop-text';
      text.textContent = l.text;
      const meta = document.createElement('small');
      meta.className = 'loop-meta';
      meta.textContent = 'Closed ' + nice(l.closedAt);
      main.append(text, meta);
      li.append(main);
      cl.appendChild(li);
    });
  }

  // ---- Manual add (no AI) ----
  $('loopAdd').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('loopText').value.trim();
    $('loopErr').textContent = '';
    if (!text) { $('loopErr').textContent = 'Write what you have to do first.'; $('loopText').focus(); return; }
    try {
      data = await call('/api/loops/add', { text, dueDate: $('loopDate').value || null });
      $('loopText').value = ''; $('loopDate').value = '';
      paintBadge(); render(); $('loopText').focus();
    } catch (err) { $('loopErr').textContent = err.message; }
  });

  // ---- Showing and hiding the view (inside the main area, like Profile) ----
  function openView() {
    window.SimSimSetup.showChat();        // closes Profile if it is open
    $('thread').hidden = true;
    $('composer').hidden = true;
    $('loopsView').hidden = false;
    chatRow.classList.remove('on'); chatRow.removeAttribute('aria-current');
    row.classList.add('on'); row.setAttribute('aria-current', 'page');
    $('loopErr').textContent = '';
    render();
    refresh();
  }
  function hideView(restoreChat) {
    if ($('loopsView').hidden) return;
    $('loopsView').hidden = true;
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

  // ---- Chips under a reply when a loop was opened from chat ----
  function showChips(msgEl, changes) {
    const body = msgEl.querySelector('.body');
    if (!body) return;
    changes.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'mem-chip loop-chip';
      const t = document.createElement('span');
      t.textContent = (c.change === 'updated' ? 'Loop updated: ' : 'Loop opened: ') + c.text + (c.dueDate ? ' — ' + nice(c.dueDate) : '');
      chip.append(t);
      body.appendChild(chip);
    });
    $('thread').scrollTop = $('thread').scrollHeight;
  }

  window.addEventListener('simsim:signedin', refresh);
  window.addEventListener('simsim:loopschanged', refresh);
  window.addEventListener('simsim:signedout', () => { data = { today: '', open: [], closed: [] }; paintBadge(); hideView(true); });

  window.SimSimLoops = { showChips, refresh };
})();
