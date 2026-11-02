// SIM SIM's browser on the page (Part 1: EYES): the Browser panel — the live screenshot of the real browser window,
// its address and tabs, every action Sim Sim took (in plain words), Stop — and the "Opening…" line inside a chat answer
// while a browser task runs. The browser itself runs on OUR server's machine (browser.js there); this file only shows it.
(function () {
  const $ = id => document.getElementById(id);
  const chat = window.SimSimChat;
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');

  async function call(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'That did not work. Please try again.');
    return d;
  }
  const stopTask = () => call('/api/browser/stop', {}).catch(() => {});

  // A page Sim Sim browsed opens in SIM SIM's browser (this panel) — never in the user's own Chrome (founder, 2026-10-30).
  async function openUrl(url) {
    openView();
    $('brErr').textContent = '';
    $('brStatus').textContent = 'Opening…';
    try { await call('/api/browser/open', { url }); } catch (e) { if (e.message !== 'signed out') $('brErr').textContent = e.message; }
    refresh();
  }
  // a link that opens in Sim Sim's browser
  function inSimSim(a, url) {
    a.href = url;
    a.removeAttribute('target');
    a.title = 'Open in Sim Sim\'s browser';
    a.addEventListener('click', e => { e.preventDefault(); openUrl(url); });
    return a;
  }

  // ---- Inside the chat: while a browser task runs, the answer bubble narrates it ("Opening weather.gov…") with Stop ----
  // Returns a function that ends the watching (called when the answer arrives).
  function watch(slot) {
    let on = true, t = null;
    const tick = async () => {
      if (!on) return;
      try {
        const st = await call('/api/browser/state');
        if (on && st.running) {
          let box = slot.querySelector('.br-live-wrap');
          if (!box) {   // the live line + Stop, and the page itself, right here in the chat (Sim Sim's screen, like Muse)
            box = document.createElement('div');
            box.className = 'br-live-wrap';
            const row = document.createElement('div');
            row.className = 'br-live';
            const line = document.createElement('span');
            const stop = document.createElement('button');
            stop.type = 'button'; stop.className = 'mini-btn'; stop.textContent = 'Stop';
            stop.addEventListener('click', () => { stop.disabled = true; stop.textContent = 'Stopping…'; stopTask(); });
            row.append(line, stop);
            const shot = document.createElement('img');
            shot.className = 'br-live-shot'; shot.alt = "What Sim Sim's browser is showing"; shot.hidden = true;
            shot.addEventListener('click', openView);
            box.append(row, shot);
            slot.replaceChildren(box);
          }
          const last = st.log[st.log.length - 1];
          box.querySelector('span').textContent = last ? last.text : 'Working in the browser…';
          const shot = box.querySelector('img');
          if (st.open && st.shotAt && shot.dataset.at !== String(st.shotAt)) { shot.dataset.at = st.shotAt; shot.src = '/api/browser/shot?t=' + st.shotAt; shot.hidden = false; }
        }
      } catch (e) {}
      if (on) t = setTimeout(tick, 700);
    };
    t = setTimeout(tick, 500);
    return () => { on = false; clearTimeout(t); };
  }

  // ---- The Browser panel ----
  let poll = null, lastShot = -1, lastShotLoad = 0;
  async function refresh() {
    let st;
    try { st = await call('/api/browser/state'); } catch (e) { return; }
    $('brStop').hidden = !st.running;
    $('brClose').hidden = !st.open || st.running;
    $('brStatus').textContent = st.running ? 'Working…' : st.open ? (st.url && st.url !== 'about:blank' ? st.url : 'Open') : 'Closed';
    $('brStatus').title = st.url || '';
    // tabs
    const tabs = $('brTabs');
    tabs.replaceChildren();
    (st.tabs || []).forEach(t => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'br-tab' + (t.current ? ' on' : '');
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t.current));
      b.textContent = (t.title || t.url || 'New tab').slice(0, 40);
      b.title = t.url;
      b.addEventListener('click', async () => { try { await call('/api/browser/tab', { index: t.i }); refresh(); } catch (e) {} });
      tabs.append(b);
    });
    // the picture: new after every action; while idle, a fresh look every few seconds (the user may scroll the window)
    const img = $('brShot');
    if (st.open && (st.shotAt !== lastShot || Date.now() - lastShotLoad > 3000)) {
      lastShot = st.shotAt; lastShotLoad = Date.now();
      img.src = '/api/browser/shot?t=' + Date.now();
    }
    img.hidden = !st.open; $('brEmpty').hidden = st.open;
    // the action log, newest last
    const log = $('brLog');
    log.replaceChildren();
    (st.log || []).forEach(l => {
      const li = document.createElement('li');
      const when = document.createElement('small');
      when.textContent = new Date(l.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      li.append(when, document.createTextNode(' ' + l.text));
      if (l.url && /^https?:\/\//i.test(l.url)) {
        const a = inSimSim(document.createElement('a'), l.url);
        a.textContent = l.url.length > 70 ? l.url.slice(0, 69) + '…' : l.url;
        li.append(document.createElement('br'), a);
      }
      log.append(li);
    });
  }
  $('brForm').addEventListener('submit', async e => {
    e.preventDefault();
    const url = $('brUrl').value.trim();
    if (!url) return;
    $('brErr').textContent = '';
    $('brStatus').textContent = 'Opening…';
    try { await call('/api/browser/open', { url }); $('brUrl').value = ''; }
    catch (err) { if (err.message !== 'signed out') $('brErr').textContent = err.message; }
    refresh();
  });
  $('brStop').addEventListener('click', () => { stopTask().then(refresh); });
  $('brClose').addEventListener('click', () => { call('/api/browser/close', {}).catch(() => {}).then(refresh); });

  function openView() {
    window.SimSimSetup.showChat();      // closes the other views
    $('thread').hidden = true;
    $('composer').hidden = true;
    $('browserView').hidden = false;
    chatRow.classList.remove('on'); chatRow.removeAttribute('aria-current');
    $('brErr').textContent = '';
    refresh();
    clearInterval(poll);
    poll = setInterval(refresh, 1000);
  }
  function hideView(restoreChat) {
    if ($('browserView').hidden) return;
    clearInterval(poll); poll = null;
    $('browserView').hidden = true;
    if (restoreChat) {
      $('thread').hidden = false; $('composer').hidden = false;
      chatRow.classList.add('on'); chatRow.setAttribute('aria-current', 'page');
    }
  }
  chatRow.addEventListener('click', () => hideView(true));
  $('newChat').addEventListener('click', () => hideView(true));
  window.addEventListener('simsim:profileopen', () => hideView(false));
  window.addEventListener('simsim:showchat', () => hideView(true));
  window.addEventListener('simsim:signedout', () => { hideView(true); $('brLog').replaceChildren(); $('brTabs').replaceChildren(); });

  window.SimSimBrowser = { watch, open: openView, openUrl, inSimSim, isOpen: () => !$('browserView').hidden };
})();
