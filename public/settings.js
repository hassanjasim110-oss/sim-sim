// SIM SIM Settings view. Every control here is REAL: it reads and writes a stored value that the app uses.
// Settings live on OUR server, per user (/api/settings) — Speak answers too. The theme lives in the profile
// (one source of truth with setup and Profile) and is saved through the profile route.
(function () {
  const $ = id => document.getElementById(id);
  const chat = window.SimSimChat;
  const { THEMES } = window.SIMSIM_DATA;
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');
  let current = null;   // { settings, profile, vaultReady }

  // Contact support (founder, 2026-11-01 — "Journeys pack"): ONE constant, shipped EMPTY on purpose. While it's
  // empty, the "Contact support" row in Help & Support never renders — no fake address, no placeholder text shown
  // to users. The founder fills this in to turn the row on.
  const SUPPORT_EMAIL = '';
  if (SUPPORT_EMAIL) {
    $('setContactLine').textContent = 'Questions or problems? Email us at ' + SUPPORT_EMAIL + '.';
    $('setContact').hidden = false;
  }

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
    loadVoices();
  }

  // ---- Sim Sim's voice: the dormant ElevenLabs roster stays wired up server-side (GET /api/voices, the Action
  // Layer's set_voice tool) so a chosen designed voice still plays if one is ever set up — but the Settings UI
  // no longer lists the ten voices or a "Hear it" per voice (founder's end-check, 2026-11-01): with none seeded,
  // showing a picker that always falls back to the device voice read as broken, not finished. ----
  let voices = null;   // /api/voices: { connected, chosen, preview, voices: [{ name, label, line, ready }] }
  async function loadVoices() {
    try { voices = await call('/api/voices'); chat.setVoiceStatus(voices); } catch (e) {}
  }
  window.addEventListener('simsim:signedin', loadAndApply);
  window.addEventListener('simsim:signedout', () => {
    current = null;
    voices = null; chat.setVoiceStatus(null);   // the next account's voice is its own
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
      const d = await call('/api/profile', { callName: p.callName, gender: p.gender, age: p.age, country: p.country, state: p.state, language: p.language, botNames: p.botNames, themeId });
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
    $('setBriefTime').value = s.briefingTime || '07:00';
    $('setBriefNote').textContent = 'Your briefing is ready by ' + niceTimeLabel(s.briefingTime) + ' when you open Sim Sim.';
    sw('setReminders', s.loopRemindersOn);
    sw('setConsent', s.picksConsent);
    $('setName').textContent = p.callName || 'Your account';
    $('setWho').textContent = $('whoEmail').title || $('whoEmail').textContent || '';
    $('setSignOut').textContent = $('signOut').textContent;   // "Log out" (or "Switch email" with the dev door)
    $('setSignOut').closest('.set-row').hidden = $('signOut').hidden;   // test mode: no session to end
    paintPerms();
  }

  // ---- Permissions (the Action Layer): each group with its action list and Allow / Ask me / Never; the floor list ----
  const PERM_CHOICES = [['allow', 'Allow'], ['ask', 'Ask me'], ['never', 'Never']];
  function paintPerms() {
    if (!current || !current.actions) return;
    const perms = current.settings.permissions || {}, list = $('permList');
    list.replaceChildren();
    Object.entries(current.actions.groups).forEach(([g, info]) => {
      const row = document.createElement('div');
      row.className = 'set-row perm-row';
      const label = document.createElement('span');
      label.textContent = info.name;
      const does = document.createElement('small');
      does.textContent = info.does.join(' · ');
      label.append(does);
      const seg = document.createElement('div');
      seg.className = 'seg'; seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', info.name);
      seg.dataset.group = g;
      PERM_CHOICES.forEach(([v, name]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = v; b.textContent = name;
        b.setAttribute('aria-checked', String((perms[g] || 'allow') === v));
        b.addEventListener('click', () => save({ permissions: { [g]: v } }));   // effective at once (the server reads it per action)
        seg.append(b);
      });
      row.append(label, seg);
      list.append(row);
    });
    $('permFloor').replaceChildren(...current.actions.floor.map(t => Object.assign(document.createElement('li'), { textContent: t })));
  }
  window.addEventListener('simsim:permissionschanged', e => { if (current) { current.settings.permissions = e.detail; paintPerms(); } });
  // Sim Sim changed a setting from the chat (text size, Speak answers, voice): apply it here too
  window.addEventListener('simsim:settingschanged', e => { if (current) current.settings = e.detail; apply(e.detail); paint(); });
  window.addEventListener('simsim:voiceschanged', loadVoices);

  // Theme cards: the same themes and ids as setup (Design 7 — the default — plus the original 8).
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
  function niceTimeLabel(hhmm) {
    const [h, m] = (hhmm || '07:00').split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  $('setBriefOn').addEventListener('click', () => save({ briefingOn: !current.settings.briefingOn }));
  // The real briefing-time setting (founder, 2026-11-01): stored per user, read by the chat ask ("send my morning
  // briefing at 7 AM") and by the server when it decides the briefing is ready for the day.
  $('setBriefTime').addEventListener('change', () => { if ($('setBriefTime').value) save({ briefingTime: $('setBriefTime').value }); });
  $('setReminders').addEventListener('click', () => save({ loopRemindersOn: !current.settings.loopRemindersOn }));
  $('setConsent').addEventListener('click', () => save({ picksConsent: !current.settings.picksConsent }));
  // Log out (everyday case): one tap, no confirm. Switch email (dev door only — this button mirrors the sidebar
  // one's text) still confirms, so a stray tap mid-test doesn't lose a test session (founder, 2026-11-01).
  $('setSignOut').addEventListener('click', () => {
    if ($('setSignOut').textContent === 'Switch email') window.SimSimAuth.confirmSignOut();
    else window.SimSimAuth.signOutDirect();
  });

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

  // Delete all chats (founder, 2026-11-01): the middle option between deleting chats one by one and Forget everything,
  // which also erases memory/loops/reminders. A confirm sheet (not the tap-twice pattern below, which is for the much
  // bigger action) states the exact, narrower scope before anything runs.
  function confirmDeleteAllChats() {
    if ($('deleteChatsConfirm')) return;
    const box = document.createElement('div');
    box.id = 'deleteChatsConfirm';
    box.className = 'confirm-overlay';
    const card = document.createElement('div');
    card.className = 'confirm-card';
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'deleteChatsMsg');
    const msg = document.createElement('p');
    msg.id = 'deleteChatsMsg';
    msg.textContent = 'Delete all chats? This removes every chat, including the Main chat history. Your memories, open loops, reminders and settings stay.';
    const row = document.createElement('div');
    row.className = 'confirm-btns';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'mini-btn danger-btn'; yes.textContent = 'Delete all chats';
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'textlink'; no.textContent = 'Cancel';
    row.append(yes, no);
    card.append(msg, row);
    box.append(card);
    document.body.append(box);
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', e => { if (e.target === box) close(); });
    no.addEventListener('click', close);
    yes.addEventListener('click', async () => {
      close();
      try {
        await call('/api/chats/delete-all', {});
        // The user stays signed in; only the chats are gone — land back on a fresh Main chat, sidebar refreshed.
        window.dispatchEvent(new Event('simsim:chatsaved'));
        window.dispatchEvent(new CustomEvent('simsim:gomain', { detail: {} }));
        hideView();
      } catch (e) { $('setErr').textContent = e.message; }
    });
    yes.focus();
  }
  $('setDeleteChats').addEventListener('click', confirmDeleteAllChats);

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
      if (!$('signOut').hidden) window.SimSimAuth.signOutDirect();   // already confirmed above ("erase"): no second confirm
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

  // ---- Settings as a pop-out modal (founder's design, decided 2026-10-31; built 2026-11-01) ----
  // It overlays the chat — nothing behind it is hidden, navigated or scrolled, so closing needs no restore step
  // (that's the whole point of a modal over a view-swap). The rail is built once, from the SAME ten sections
  // already in the markup (data-sec on each .set-sec); only the container is new — every control inside keeps
  // its exact existing id and wiring.
  const SECTIONS = [
    ['account', 'Account', '<path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'],
    ['appearance', 'Appearance', '<path d="M4 7h9M4 12h15M4 17h6"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'],
    ['voice', 'Voice', '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>'],
    ['brief', 'Briefing & loops', '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/>'],
    ['perms', 'Permissions', '<path d="M12 3l7 4v5c0 5-3.3 7.8-7 9-3.7-1.2-7-4-7-9V7z"/>'],
    ['data', 'Data controls', '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'],
    ['vault', 'Saved logins', '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>'],
    ['help', 'Help & support', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.3 2.4c-.9.3-1.3 1-1.3 2.1"/><path d="M12 17h.01"/>'],
    ['legal', 'Legal', '<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/>']
  ];
  const LOGOUT_ICON = '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>';
  let activeSection = SECTIONS[0][0];

  function railRow(id, label, icon, extraClass) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rail-row' + (extraClass ? ' ' + extraClass : '');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg><span></span>';
    b.querySelector('span').textContent = label;
    return b;
  }
  function buildRail() {
    const rail = $('settingsRail');
    rail.replaceChildren();
    SECTIONS.forEach(([id, label, icon]) => {
      const b = railRow(id, label, icon);
      b.dataset.sec = id;
      b.setAttribute('aria-current', String(id === activeSection));
      b.addEventListener('click', () => showSection(id));
      rail.append(b);
    });
    const logout = railRow('logout', 'Log out', LOGOUT_ICON, 'rail-logout');
    logout.addEventListener('click', () => window.SimSimAuth.signOutDirect());   // one tap, no confirm (2026-11-01)
    rail.append(logout);
  }
  // Shows ONLY this section in the right pane; every other one is the existing .set-sec CSS's display:none.
  // Phone width: also slides the right pane over the rail (section-open) — harmless on desktop, where both
  // the rail and the pane are always shown side by side regardless of this class.
  function showSection(id) {
    activeSection = id;
    document.querySelectorAll('#settingsSections .set-sec').forEach(sec => sec.classList.toggle('active', sec.dataset.sec === id));
    document.querySelectorAll('#settingsRail .rail-row[data-sec]').forEach(b => { const on = b.dataset.sec === id; b.classList.toggle('on', on); b.setAttribute('aria-current', String(on)); });
    const found = SECTIONS.find(s => s[0] === id);
    $('setTitle').textContent = found ? found[1] : 'Settings';
    $('settingsCard').classList.add('section-open');
  }
  $('setSectionBack').addEventListener('click', () => $('settingsCard').classList.remove('section-open'));

  // ---- Opening and closing ----
  async function openView() {
    if (!$('settingsView').hidden) return;   // already open
    $('settingsView').hidden = false;
    $('openSettings').classList.add('on');
    if (!$('settingsRail').children.length) buildRail();
    showSection(activeSection);
    await loadAndApply();
    paint();
    loadFacts();
    loadVault();
  }
  function hideView() {
    if ($('settingsView').hidden) return;
    $('settingsView').hidden = true;
    $('openSettings').classList.remove('on');
    $('settingsCard').classList.remove('section-open');   // next open starts at the section list again, on phone
    $('vaultList').replaceChildren();   // no revealed password stays on screen
  }
  $('openSettings').addEventListener('click', openView);
  $('setBack').addEventListener('click', hideView);                 // the X, top-right
  $('setBackdrop').addEventListener('click', hideView);              // clicking the dimmed backdrop
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('settingsView').hidden) hideView(); });
  chatRow.addEventListener('click', hideView);
  $('newChat').addEventListener('click', hideView);
  window.addEventListener('simsim:profileopen', hideView);
  window.addEventListener('simsim:showchat', hideView);   // other views open via "show chat" first
  // A reliable, idempotent open for the Action Layer (founder, 2026-11-01): openView() used to TOGGLE; now it is
  // a modal, so opening it again (the gear, or "open Settings" in chat) just leaves it open — show() always opens.
  // One group's current allow|ask|never, for client-only gates (Camera/Gallery) that have no Action-Layer tool to
  // carry the check server-side. Defaults to 'allow' before settings have loaded, matching the server's own default.
  function permissionFor(group) { return (current && current.settings.permissions && current.settings.permissions[group]) || 'allow'; }
  // "Always allow <group>": flips one group to 'allow' and saves it, whether or not the Settings view is open.
  function alwaysAllow(group) { return save({ permissions: { [group]: 'allow' } }); }
  window.SimSimSettings = { show: openView, isOpen: () => !$('settingsView').hidden, permissionFor, alwaysAllow };
})();
