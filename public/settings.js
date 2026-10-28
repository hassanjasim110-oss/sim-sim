// SIM SIM Settings view. Every control here is REAL: it reads and writes a stored value that the app uses.
// Settings live on OUR server, per user (/api/settings) — Speak answers too. The theme lives in the profile
// (one source of truth with setup and Profile) and is saved through the profile route.
(function () {
  const $ = id => document.getElementById(id);
  const chat = window.SimSimChat;
  const { THEMES } = window.SIMSIM_DATA;
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');
  let current = null;   // { settings, profile, vaultReady }

  async function call(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || 'That did not work. Please try again.'); e.status = r.status; throw e; }
    return d;
  }

  // ---- Applying settings everywhere (on sign-in, and on every change) ----
  function apply(s) {
    document.documentElement.dataset.text = s.textSize;   // chat text size
    chat.setRate(s.speechRate);                            // browser voice speed
    chat.applySpeak(s.speakAnswers);                       // every place Sim Sim speaks
  }
  // Speak answers used to live in this browser only (localStorage "simsim-speak"). That old value wins ONCE:
  // it is written to the server store, then the old drawer is deleted. From then on the server store rules.
  function oldSpeak() { try { return localStorage.getItem('simsim-speak'); } catch (e) { return null; } }
  async function loadAndApply() {
    try {
      current = await call('/api/settings');
      const old = oldSpeak();
      if (old === 'on' || old === 'off') current = await call('/api/settings', { speakAnswers: old === 'on' });
      if (old !== null) { try { localStorage.removeItem('simsim-speak'); } catch (e) {} }
      apply(current.settings);
    } catch (e) {}
  }
  window.addEventListener('simsim:signedin', loadAndApply);
  window.addEventListener('simsim:signedout', () => {
    current = null;
    apply({ textSize: 'comfortable', speechRate: 'normal', speakAnswers: true });
    hideView(true);
  });

  async function save(change) {
    $('setErr').textContent = '';
    try {
      current = await call('/api/settings', change);
      apply(current.settings);
      paint();
    } catch (e) { $('setErr').textContent = e.message; paint(); }
  }
  // The theme is part of the profile: saved through the SAME route setup uses (POST /api/profile).
  async function saveTheme(themeId) {
    $('setErr').textContent = '';
    const p = window.SimSimSetup.getProfile();
    if (!p) return;
    try {
      const d = await call('/api/profile', { callName: p.callName, gender: p.gender, age: p.age, state: p.state, botNames: p.botNames, themeId });
      window.SimSimSetup.setProfile(d.profile);   // repaint + Profile view, everywhere
      current.profile = d.profile;
      paint();
    } catch (e) { $('setErr').textContent = e.message; paint(); }
  }

  // ---- Painting the controls from the stored values ----
  function seg(id, value) {
    document.querySelectorAll('#' + id + ' [role="radio"]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === value)));
  }
  function sw(id, on) { $(id).setAttribute('aria-checked', String(!!on)); }
  function paint() {
    if (!current) return;
    const s = current.settings, p = current.profile || {};
    document.querySelectorAll('#setThemes [role="radio"]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.id === p.themeId)));
    seg('setText', s.textSize);
    seg('setRate', s.speechRate);
    sw('setSpeak', chat.speakOn());
    sw('setBriefOn', s.briefingOn);
    sw('setReminders', s.loopRemindersOn);
    sw('setConsent', s.picksConsent);
    $('setName').textContent = p.callName || 'Your account';
    $('setWho').textContent = $('whoEmail').title || $('whoEmail').textContent || '';
    $('setSignOut').textContent = $('signOut').textContent;   // "Sign out" (or "Switch email" with the dev door)
    $('setSignOut').closest('.set-row').hidden = $('signOut').hidden;   // test mode: no session to end
  }

  // Theme cards: the same 8 themes and ids as setup.
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'set-theme'; b.setAttribute('role', 'radio'); b.dataset.id = t.id;
    b.innerHTML = '<span class="dots" aria-hidden="true"><span style="background:' + t.v.accent + '"></span><span style="background:' + t.v.userBubble +
      '"></span><span style="background:' + t.v.bg + '"></span></span><b></b><small></small>';
    b.querySelector('b').textContent = t.name;
    b.querySelector('small').textContent = t.vibe;
    b.addEventListener('click', () => saveTheme(t.id));
    $('setThemes').appendChild(b);
  });
  document.querySelectorAll('#setText [role="radio"]').forEach(b => b.addEventListener('click', () => save({ textSize: b.dataset.v })));
  document.querySelectorAll('#setRate [role="radio"]').forEach(b => b.addEventListener('click', () => save({ speechRate: b.dataset.v })));
  $('setSpeak').addEventListener('click', () => { chat.setSpeak(!chat.speakOn()); paint(); });
  window.addEventListener('simsim:speakchanged', paint);
  $('setBriefOn').addEventListener('click', () => save({ briefingOn: !current.settings.briefingOn }));
  $('setReminders').addEventListener('click', () => save({ loopRemindersOn: !current.settings.loopRemindersOn }));
  $('setConsent').addEventListener('click', () => save({ picksConsent: !current.settings.picksConsent }));
  $('setSignOut').addEventListener('click', () => $('signOut').click());

  // ---- Data controls ----
  async function loadFacts() {
    try {
      const facts = (await call('/api/facts')).facts || [];
      const list = $('setFacts');
      list.replaceChildren();
      $('setFactsEmpty').hidden = facts.length > 0;
      facts.forEach(f => {
        const li = document.createElement('li');
        li.className = 'fact';
        const main = document.createElement('div');
        main.className = 'fact-main';
        const t = document.createElement('p'); t.className = 'fact-text'; t.textContent = f.text;
        const m = document.createElement('small'); m.className = 'fact-meta'; m.textContent = f.category;
        main.append(t, m);
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'mini-btn'; del.textContent = 'Delete';
        del.addEventListener('click', async () => { try { await call('/api/facts/delete', { id: f.id }); loadFacts(); } catch (e) { $('setErr').textContent = e.message; } });
        li.append(main, del);
        list.appendChild(li);
      });
    } catch (e) {}
  }

  // Forget everything: two steps — the button turns into "Are you sure? Tap again to erase".
  let eraseArmed = null;
  $('setErase').addEventListener('click', async () => {
    const b = $('setErase');
    if (!eraseArmed) {
      b.textContent = 'Are you sure? Tap again to erase';
      b.classList.add('armed');
      eraseArmed = setTimeout(() => { eraseArmed = null; b.textContent = 'Forget everything'; b.classList.remove('armed'); }, 6000);
      return;
    }
    clearTimeout(eraseArmed); eraseArmed = null;
    b.textContent = 'Forget everything'; b.classList.remove('armed');
    try {
      await call('/api/data/erase', { confirm: 'erase' });
      window.SimSimChat.clear();
      hideView(true);
      if (!$('signOut').hidden) $('signOut').click();          // back to the signed-out landing page
      else window.SimSimSetup.enter($('whoEmail').title || '');   // test mode has no session to end: setup, like a new account
    } catch (e) { $('setErr').textContent = e.message; }
  });

  // ---- Saved logins (the vault): site + username listed; ONE password revealed per tap ----
  function renderVault(entries) {
    const list = $('vaultList');
    list.replaceChildren();
    $('vaultEmpty').hidden = entries.length > 0;
    entries.forEach(v => {
      const li = document.createElement('li');
      li.className = 'fact vault-item';
      const main = document.createElement('div');
      main.className = 'fact-main';
      const t = document.createElement('p'); t.className = 'fact-text'; t.textContent = v.site;
      const u = document.createElement('small'); u.className = 'fact-meta'; u.textContent = v.username;
      const pw = document.createElement('code'); pw.className = 'vault-pw'; pw.hidden = true;
      main.append(t, u, pw);
      const show = document.createElement('button');
      show.type = 'button'; show.className = 'mini-btn'; show.textContent = 'Show';
      show.addEventListener('click', async () => {
        if (!pw.hidden) { pw.hidden = true; pw.textContent = ''; show.textContent = 'Show'; return; }
        try { pw.textContent = (await call('/api/vault/reveal', { id: v.id })).password; pw.hidden = false; show.textContent = 'Hide'; }
        catch (e) { $('vaultErr').textContent = e.message; }
      });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'mini-btn'; del.textContent = 'Delete';
      let armed = null;
      del.addEventListener('click', async () => {
        if (!armed) { del.textContent = 'Tap again to delete'; armed = setTimeout(() => { armed = null; del.textContent = 'Delete'; }, 5000); return; }
        clearTimeout(armed);
        try { renderVault((await call('/api/vault/delete', { id: v.id })).entries); } catch (e) { $('vaultErr').textContent = e.message; }
      });
      const actions = document.createElement('div');
      actions.className = 'fact-actions';
      actions.append(show, del);
      li.append(main, actions);
      list.appendChild(li);
    });
  }
  async function loadVault() {
    $('vaultErr').textContent = '';
    try { const d = await call('/api/vault'); $('vaultOff').hidden = true; $('vaultOn').hidden = false; renderVault(d.entries); }
    catch (e) { if (e.status === 503) { $('vaultOff').hidden = false; $('vaultOn').hidden = true; } }
  }
  $('vaultAdd').addEventListener('submit', async e => {
    e.preventDefault();
    $('vaultErr').textContent = '';
    try {
      const d = await call('/api/vault/add', { site: $('vSite').value, username: $('vUser').value, password: $('vPass').value });
      $('vSite').value = ''; $('vUser').value = ''; $('vPass').value = '';
      renderVault(d.entries);
    } catch (err) { $('vaultErr').textContent = err.message; }
  });

  // ---- Showing and hiding the view (inside the main area, like Profile) ----
  // Back returns to where the user was: Profile, or the sidebar row that was open (Chat, Discussion, …).
  let cameFrom = null;
  function whereNow() {
    if (!$('profileView').hidden) return $('profile');
    return document.querySelector('.nav button.on') || chatRow;
  }
  function goBack() { const to = cameFrom || chatRow; cameFrom = null; to.click(); }
  async function openView() {
    if (!$('settingsView').hidden) { goBack(); return; }   // the gear again: back where you were
    cameFrom = whereNow();
    window.SimSimSetup.showChat();   // closes the other views
    $('thread').hidden = true;
    $('composer').hidden = true;
    $('settingsView').hidden = false;
    chatRow.classList.remove('on'); chatRow.removeAttribute('aria-current');
    $('openSettings').classList.add('on');
    await loadAndApply();
    paint();
    loadFacts();
    loadVault();
  }
  function hideView(restoreChat) {
    if ($('settingsView').hidden) return;
    $('settingsView').hidden = true;
    $('openSettings').classList.remove('on');
    $('vaultList').replaceChildren();   // no revealed password stays on screen
    if (restoreChat) {
      $('thread').hidden = false; $('composer').hidden = false;
      chatRow.classList.add('on'); chatRow.setAttribute('aria-current', 'page');
    }
  }
  $('openSettings').addEventListener('click', openView);
  $('setBack').addEventListener('click', goBack);
  chatRow.addEventListener('click', () => hideView(true));
  $('newChat').addEventListener('click', () => hideView(true));
  window.addEventListener('simsim:profileopen', () => hideView(false));
  window.addEventListener('simsim:showchat', () => hideView(true));   // other views open via "show chat" first
})();
