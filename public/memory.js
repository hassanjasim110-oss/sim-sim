// SIM SIM memory on screen: the quiet "Remembered:" chips under replies, and the list in the Profile view.
// The facts themselves live in the user's notebook on OUR server — never in browser storage.
(function () {
  const $ = id => document.getElementById(id);
  let facts = [];
  let editingId = null;

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'That did not work. Please try again.');
    return data;
  }

  // ---- Chips under a reply ----
  function showChips(msgEl, learned) {
    const body = msgEl.querySelector('.body');
    if (!body) return;
    learned.forEach(f => {
      const chip = document.createElement('div');
      chip.className = 'mem-chip';
      const text = document.createElement('span');
      text.textContent = 'Remembered: ' + f.text;
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = 'Undo';
      undo.setAttribute('aria-label', 'Undo — forget: ' + f.text);
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        try {
          await post('/api/facts/delete', { id: f.id });
          chip.classList.add('gone');
          text.textContent = 'Forgotten.';
          undo.remove();
          refreshIfOpen();
        } catch (e) { undo.disabled = false; }
      });
      chip.append(text, undo);
      body.appendChild(chip);
    });
    const thread = $('thread');
    thread.scrollTop = thread.scrollHeight;
  }

  // Called by app.js after a reply is on screen: the server runs its one extraction call for that turn.
  async function learnFrom(turnId, msgEl) {
    try {
      const data = await post('/api/chat/learn', { turnId });
      if (data.learned && data.learned.length) { showChips(msgEl, data.learned); refreshIfOpen(); }
      if (data.receiptSteps && data.receiptSteps.length && window.SimSimChat) window.SimSimChat.addReceiptSteps(msgEl, data.receiptSteps);
      if (data.loops && data.loops.length && window.SimSimLoops) {   // "Loop opened:" chips + the live badge
        window.SimSimLoops.showChips(msgEl, data.loops);
        window.dispatchEvent(new Event('simsim:loopschanged'));
      }
    } catch (e) { /* learning is quiet: a failed extraction never disturbs the chat */ }
  }

  // ---- "What Sim Sim remembers" in the Profile view ----
  function refreshIfOpen() { if (!$('profileView').hidden) load(); }

  async function load() {
    $('memErr').textContent = '';
    try {
      const r = await fetch('/api/facts', { cache: 'no-store' });
      if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); return; }
      facts = (await r.json()).facts || [];
      render();
    } catch (e) { $('memErr').textContent = 'Could not load what Sim Sim remembers. Is the server running?'; }
  }

  function when(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function button(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    const list = $('factList');
    list.replaceChildren();
    $('memEmpty').hidden = facts.length > 0;
    $('forgetRow').hidden = facts.length === 0;
    askForgetAll(false);
    facts.forEach(f => {
      const li = document.createElement('li');
      li.className = 'fact';
      const main = document.createElement('div');
      main.className = 'fact-main';
      const actions = document.createElement('div');
      actions.className = 'fact-actions';

      if (editingId === f.id) {
        const input = document.createElement('input');
        input.type = 'text'; input.value = f.text; input.maxLength = 300;
        input.setAttribute('aria-label', 'Edit this memory');
        const save = async () => {
          try { facts = (await post('/api/facts/update', { id: f.id, text: input.value })).facts; editingId = null; render(); }
          catch (e) { $('memErr').textContent = e.message; }
        };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { editingId = null; render(); }
        });
        main.append(input);
        actions.append(button('Save', 'mini-btn on', save), button('Cancel', 'mini-btn', () => { editingId = null; render(); }));
        setTimeout(() => input.focus(), 0);
      } else {
        const text = document.createElement('p');
        text.className = 'fact-text';
        text.textContent = f.text;
        main.append(text);
        actions.append(
          button('Edit', 'mini-btn', () => { editingId = f.id; $('memErr').textContent = ''; render(); }),
          button('Delete', 'mini-btn', async () => {
            try { facts = (await post('/api/facts/delete', { id: f.id })).facts; render(); }
            catch (e) { $('memErr').textContent = e.message; }
          })
        );
      }
      const meta = document.createElement('small');
      meta.className = 'fact-meta';
      meta.textContent = f.category + ' · learned ' + when(f.createdAt);
      main.append(meta);
      li.append(main, actions);
      list.appendChild(li);
    });
  }

  // "Forget everything" asks once before clearing (facts only — the basics stay).
  function askForgetAll(on) {
    $('forgetAsk').hidden = !on;
    $('forgetAsk').textContent = on ? 'Forget all ' + facts.length + ' facts? Your basics stay.' : '';
    $('forgetAll').hidden = on;
    $('forgetCancel').hidden = !on;
    $('forgetYes').hidden = !on;
    if (on) $('forgetCancel').focus();
  }
  $('forgetAll').addEventListener('click', () => askForgetAll(true));
  $('forgetCancel').addEventListener('click', () => { askForgetAll(false); $('forgetAll').focus(); });
  $('forgetYes').addEventListener('click', async () => {
    try { facts = (await post('/api/facts/clear')).facts; render(); }
    catch (e) { $('memErr').textContent = e.message; }
  });

  window.addEventListener('simsim:profileopen', () => { editingId = null; load(); });
  window.addEventListener('simsim:signedout', () => { facts = []; editingId = null; $('factList').replaceChildren(); });

  window.SimSimMemory = { learnFrom, refreshIfOpen, showChips };
})();
