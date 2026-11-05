// SIM SIM first-time setup (notebook pages 1 + 2), the theme painter, and the Profile view.
// The answers are saved on OUR server (POST /api/profile) in the user's notebook. No AI here.
(function () {
  const { GENDERS, STATES, COUNTRIES, DEFAULT_COUNTRY, LANGUAGES, DEFAULT_LANGUAGE, BOT_ROLES, THEMES, DEFAULT_THEME } = window.SIMSIM_DATA;
  const $ = id => document.getElementById(id);
  const GREETING = name => 'Hi ' + name + ", I'm Sim Sim. Say my name anytime — or type below, I'm listening.";

  let profile = null;      // the saved profile (null until loaded or created)
  let email = '';
  let editing = false;     // true when "Edit my basics" opened the pages
  let pickedGender = '';
  let pickedTheme = DEFAULT_THEME;

  // ---- Themes: paint the app from the themes table ----
  const VARS = {
    bg: '--bg', side: '--side', surface: '--surface', line: '--line', text: '--text', muted: '--muted', bubble: '--bubble',
    userBubble: '--user-bubble', simBubble: '--sim-bubble', accent: '--accent', accent2: '--accent2',
    accentText: '--accent-text', accentInk: '--accent-ink', primary1: '--primary-1', primary2: '--primary-2', onPrimary: '--on-primary'
  };
  // Optional, per-theme overrides (founder, 2026-11-04 — "Theme colors from Muse"): most themes don't set these, so
  // the CSS var() fallback (styles.css) quietly takes over — Design 7 and Midnight are byte-for-byte unchanged.
  // sendBg/sendInk: Muse's own Send button is a different color from its other primary buttons (a pale circle with
  // a near-black arrow, not solid blue with white). composerBg: Muse's dark composer is a shade lighter than its cards.
  const OPTIONAL_VARS = { sendBg: '--send-bg', sendInk: '--send-ink', composerBg: '--composer-bg' };
  function themeById(id) { return THEMES.find(t => t.id === id) || THEMES[0]; }
  function applyTheme(id) {
    const t = themeById(id), root = document.documentElement;
    for (const k in VARS) root.style.setProperty(VARS[k], t.v[k]);
    for (const k in OPTIONAL_VARS) {
      if (t.v[k]) root.style.setProperty(OPTIONAL_VARS[k], t.v[k]);
      else root.style.removeProperty(OPTIONAL_VARS[k]);   // not set for this theme: let the CSS fallback take over
    }
    root.toggleAttribute('data-dark', !!t.dark);
  }
  applyTheme(DEFAULT_THEME);

  // ---- Arrow keys move the choice inside a radio group (chips and theme cards) ----
  function radioKeys(group, pick) {
    group.addEventListener('keydown', e => {
      const items = [...group.querySelectorAll('[role="radio"]')], i = items.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = items[(i + step + items.length) % items.length];
      next.focus();
      pick(next);
    });
  }
  function paintRadios(group, isOn) {
    const items = [...group.querySelectorAll('[role="radio"]')];
    items.forEach(b => { b.setAttribute('aria-checked', String(isOn(b))); b.tabIndex = isOn(b) ? 0 : -1; });
    if (!items.some(isOn) && items[0]) items[0].tabIndex = 0;
  }

  // ---- Page 1: build the gender chips and the state list ----
  GENDERS.forEach(g => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio'); b.dataset.v = g; b.textContent = g;
    b.addEventListener('click', () => pickGender(g));
    $('gender').appendChild(b);
  });
  radioKeys($('gender'), b => pickGender(b.dataset.v));
  function pickGender(g) {
    pickedGender = g;
    paintRadios($('gender'), b => b.dataset.v === g);
    if (g) $('eGender').textContent = '';
  }

  // ---- The shared custom dropdown (founder, 2026-11-04 — "Pretty dropdowns + Country + Language"): one component,
  // used for State, Country and Language. A Design 7 card (not a native <select> popup): opens below the button,
  // fades + slides in, a live search box filters the list, arrow keys move, Enter picks, Esc/outside-click closes.
  function makeDropdown({ btn, valueEl, panel, search, list, items, getLabel, getKey, placeholder, onPick }) {
    let value = null, filtered = items, activeIdx = -1;
    function paintValue() {
      const picked = items.find(it => getKey(it) === value);
      valueEl.textContent = picked ? getLabel(picked) : placeholder;
      valueEl.classList.toggle('placeholder', !picked);
    }
    function paintActive() { [...list.children].forEach((row, i) => row.classList.toggle('dd-active', i === activeIdx)); }
    function renderList() {
      list.replaceChildren();
      if (!filtered.length) { const p = document.createElement('p'); p.className = 'dd-empty'; p.textContent = 'No matches.'; list.appendChild(p); activeIdx = -1; return; }
      filtered.forEach((it, i) => {
        const row = document.createElement('button');
        row.type = 'button'; row.className = 'dd-row'; row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(getKey(it) === value));
        row.innerHTML = '<svg class="dd-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg><span></span>';
        row.querySelector('span').textContent = getLabel(it);
        row.addEventListener('click', () => pick(it));
        row.addEventListener('mouseenter', () => { activeIdx = i; paintActive(); });
        list.appendChild(row);
      });
      activeIdx = filtered.findIndex(it => getKey(it) === value);
      if (activeIdx < 0) activeIdx = 0;
      paintActive();
    }
    function pick(it) { value = getKey(it); paintValue(); close(); btn.focus(); if (onPick) onPick(it); }
    function filter(q) {
      const term = q.trim().toLowerCase();
      filtered = term ? items.filter(it => getLabel(it).toLowerCase().includes(term)) : items;
      renderList();
    }
    function open() {
      if (!panel.hidden) return;
      filtered = items; search.value = ''; renderList();
      panel.hidden = false; btn.setAttribute('aria-expanded', 'true');
      search.focus();
    }
    function close() {
      if (panel.hidden) return;
      panel.hidden = true; btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', () => { if (panel.hidden) open(); else close(); });
    search.addEventListener('input', () => filter(search.value));
    search.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, filtered.length - 1); paintActive(); const r = list.children[activeIdx]; if (r) r.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); paintActive(); const r = list.children[activeIdx]; if (r) r.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIdx]) pick(filtered[activeIdx]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
    });
    document.addEventListener('click', e => { if (!panel.hidden && !btn.contains(e.target) && !panel.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden && (panel.contains(document.activeElement) || btn.contains(document.activeElement))) { close(); btn.focus(); } });
    paintValue();
    return {
      setValue(v) { value = v; paintValue(); },
      getValue() { return value; },
      close
    };
  }

  // Country (above State) and Language dropdowns are built once with the full lists; State's dropdown is rebuilt
  // with just the 50 states + DC (it never needs search across country names, so its own instance is simplest).
  const countryDd = makeDropdown({
    btn: $('countryBtn'), valueEl: $('countryValue'), panel: $('countryPanel'), search: $('countrySearch'), list: $('countryList'),
    items: COUNTRIES, getLabel: c => c, getKey: c => c, placeholder: 'Choose your country',
    onPick: c => { $('eCountry').textContent = ''; adaptStateField(c); }
  });
  const stateDd = makeDropdown({
    btn: $('stateBtn'), valueEl: $('stateValue'), panel: $('statePanel'), search: $('stateSearch'), list: $('stateList'),
    items: STATES, getLabel: s => s, getKey: s => s, placeholder: 'Choose your state',
    onPick: () => { $('eState').textContent = ''; }
  });
  const languageDd = makeDropdown({
    btn: $('languageBtn'), valueEl: $('languageValue'), panel: $('languagePanel'), search: $('languageSearch'), list: $('languageList'),
    items: LANGUAGES, getLabel: l => l.name, getKey: l => l.code, placeholder: 'Choose your language',
    onPick: () => { $('eLanguage').textContent = ''; }
  });
  languageDd.setValue(DEFAULT_LANGUAGE);   // "Default: English" — true for a brand-new setup, overwritten below when editing

  // STATE ADAPTS to Country (founder's rule): United States keeps the states-+-DC dropdown; any other country's
  // state/province/region becomes free text, optional. Switching never silently deletes a saved value — the
  // dropdown's current pick carries over into the text field, and vice versa when a typed value matches a real state.
  function adaptStateField(country) {
    const isUS = country === DEFAULT_COUNTRY;
    if (isUS) {
      const typed = $('stateText').value.trim();
      if (typed && STATES.includes(typed)) stateDd.setValue(typed);   // a carried-over match: select it
      $('stateLabel').textContent = 'STATE';
    } else {
      const picked = stateDd.getValue();
      if (picked && !$('stateText').value.trim()) $('stateText').value = picked;   // carry the dropdown's pick over
      $('stateLabel').textContent = 'STATE / PROVINCE / REGION';
    }
    $('stateDd').hidden = !isUS;
    $('stateText').hidden = isUS;
    if (!isUS) stateDd.close();
    $('eState').textContent = '';
  }

  // ---- Page 2: the theme gallery (every theme, for every user) ----
  THEMES.forEach(t => {
    const c = t.v, b = document.createElement('button');
    b.type = 'button'; b.className = 'th'; b.setAttribute('role', 'radio'); b.dataset.id = t.id;
    b.innerHTML =
      '<span class="ok" aria-hidden="true">✓</span>' +
      '<span class="mini" aria-hidden="true" style="background:' + c.bg + ';border-color:' + c.line + '">' +
        '<span class="mini-side" style="background:' + c.side + '"></span>' +
        '<span class="mini-chat">' +
          '<i class="mini-user" style="background:' + c.userBubble + '"></i>' +
          '<span class="mini-sim"><i class="mini-dot" style="background:linear-gradient(140deg,' + c.accent2 + ',' + c.accent + ')"></i>' +
            '<i class="mini-bub" style="background:' + c.simBubble + ';border-color:' + c.line + '"></i></span>' +
          '<i class="mini-bar" style="background:' + c.surface + ';border-color:' + c.line + '"><b style="background:' + c.accent + '"></b></i>' +
        '</span>' +
      '</span>' +
      '<span class="th-name"></span><small class="th-vibe"></small>' +
      '<span class="dots" aria-hidden="true"><span style="background:' + c.accent + '"></span><span style="background:' + c.userBubble +
        '"></span><span style="background:' + c.bg + '"></span></span>';
    b.querySelector('.th-name').textContent = t.name;
    b.querySelector('.th-vibe').textContent = t.vibe;
    b.setAttribute('aria-label', t.name + ', ' + t.vibe);
    b.addEventListener('click', () => pickTheme(t.id));
    $('themes').appendChild(b);
  });
  radioKeys($('themes'), b => pickTheme(b.dataset.id));
  function pickTheme(id) {
    pickedTheme = id;
    paintRadios($('themes'), b => b.dataset.id === id);
    applyTheme(id); // live preview: the page re-paints right away
  }

  // Bot avatars follow the names as you type.
  [['bot1', 'bot1Initial', 0], ['bot2', 'bot2Initial', 1]].forEach(([inp, av, i]) => {
    $(inp).addEventListener('input', () => {
      $(av).textContent = ($(inp).value.trim().charAt(0) || BOT_ROLES[i].role.charAt(0)).toUpperCase();
    });
  });

  // ---- Which screen is showing ----
  function showView(name) {
    $('setup').hidden = name !== 'setup';
    $('app').hidden = name !== 'app';
    if (name !== 'landing') $('landing').hidden = true;
    $('loadingScreen').hidden = true;   // first load is over — no more blank-white gap to cover
    window.scrollTo(0, 0);
  }
  function showPage(n) {
    $('setupP1').hidden = n !== 1;
    $('setupP2').hidden = n !== 2;
    window.scrollTo(0, 0);
    (n === 1 ? $('callName') : $('bot1')).focus({ preventScroll: true });
  }

  function currentCountry() { return countryDd.getValue(); }
  function currentState() { return $('stateDd').hidden ? $('stateText').value.trim() : (stateDd.getValue() || ''); }

  function showSetup(edit) {
    editing = edit;
    const p = edit ? profile : null;
    $('callName').value = p ? p.callName : '';
    pickGender(p ? p.gender : '');
    $('age').value = p ? p.age : '';
    const country = p ? (p.country || DEFAULT_COUNTRY) : null;   // existing users default to US; new users pick their own
    countryDd.setValue(country);
    $('stateText').value = '';
    stateDd.setValue(null);
    adaptStateField(country || DEFAULT_COUNTRY);   // no country picked yet (new user): the familiar US states dropdown shows first
    if (p) { if (country === DEFAULT_COUNTRY) stateDd.setValue(p.state); else $('stateText').value = p.state || ''; }
    languageDd.setValue(p ? (p.language || DEFAULT_LANGUAGE) : DEFAULT_LANGUAGE);   // Default: English, for everyone
    $('bot1').value = p ? p.botNames[0] : BOT_ROLES[0].role;
    $('bot2').value = p ? p.botNames[1] : BOT_ROLES[1].role;
    $('bot1').dispatchEvent(new Event('input'));
    $('bot2').dispatchEvent(new Event('input'));
    pickTheme(p ? p.themeId : DEFAULT_THEME);
    ['eCallName', 'eGender', 'eAge', 'eCountry', 'eState', 'eLanguage', 'eBots', 'eSave'].forEach(id => { $(id).textContent = ''; });
    $('cancelEdit').hidden = !edit;
    showView('setup');
    showPage(1);
  }

  // ---- Page 1 -> Page 2 ----
  $('continue').addEventListener('click', () => {
    const name = $('callName').value.trim(), age = $('age').value.trim();
    const country = currentCountry(), isUS = country === DEFAULT_COUNTRY;
    const checks = [
      ['eCallName', $('callName'), name ? '' : 'Tell me what to call you.'],
      ['eGender', $('gender').querySelector('[tabindex="0"]'), pickedGender ? '' : 'Pick one. "Prefer not to say" is fine.'],
      ['eAge', $('age'), /^\d+$/.test(age) && +age >= 5 && +age <= 120 ? '' : 'Enter your age as a whole number from 5 to 120, like 27.'],
      ['eCountry', $('countryBtn'), country ? '' : 'Choose your country.'],
      // Non-US: the state/province/region is free text and optional, never required.
      ['eState', $('stateBtn'), isUS && !stateDd.getValue() ? 'Choose your state.' : '']
    ];
    let first = null;
    checks.forEach(([err, field, msg]) => {
      $(err).textContent = msg;
      if (msg && !first) first = field;
    });
    if (first) { first.focus(); return; }
    showPage(2);
  });
  $('back').addEventListener('click', () => showPage(1));
  $('cancelEdit').addEventListener('click', () => {
    applyTheme(profile.themeId);   // undo the live preview
    showView('app');
  });

  // ---- Finish: save to the notebook ----
  $('finish').addEventListener('click', async () => {
    const botNames = [$('bot1').value, $('bot2').value].map(n => n.trim().replace(/\s+/g, ' '));
    if (!botNames.every(n => /^[A-Za-z0-9 ]{1,30}$/.test(n))) {
      $('eBots').textContent = 'Bot names can use 1 to 30 letters, numbers, or spaces.';
      return;
    }
    $('eBots').textContent = '';
    $('eSave').textContent = '';
    const btn = $('finish');
    btn.disabled = true;
    try {
      const r = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callName: $('callName').value.trim(), gender: pickedGender, age: Number($('age').value),
          country: currentCountry(), state: currentState(), language: languageDd.getValue() || DEFAULT_LANGUAGE,
          botNames, themeId: pickedTheme
        })
      });
      if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); return; }
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.profile) { $('eSave').textContent = data.error || 'That did not save. Please try again.'; return; }
      const firstTime = !editing;
      profile = data.profile;
      applyProfile(profile);
      showView('app');
      if (firstTime) {
        closeProfileView();
        window.SimSimChat.clear();
        window.SimSimChat.addSimText(GREETING(profile.callName));
        window.dispatchEvent(new Event('simsim:signedin'));
      } else {
        openProfileView();
      }
    } catch (e) {
      $('eSave').textContent = 'Could not reach the Sim Sim server. Is it still running?';
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Put the saved profile on screen ----
  function applyProfile(p) {
    applyTheme(p.themeId);
    $('whoName').textContent = p.callName;
    // One line, ellipsis-truncated (founder, 2026-11-01) — the old <wbr> after "@" was a DIFFERENT fix (a controlled
    // wrap point) that's exactly what made it wrap onto two lines; the CSS now truncates instead, so the full
    // address goes in as plain text and the title attribute still gives the full address on hover.
    $('whoEmail').textContent = email;
    $('whoEmail').title = email;
    $('meInitial').textContent = p.callName.charAt(0).toUpperCase();
    $('emptyTitle').textContent = 'Hi ' + p.callName;
    window.SimSimFace.apply(p);   // Sim Sim's face, everywhere at once (the name never changes)
    renderBasics();
  }

  // ---- Profile view (memory will live here in a later step) ----
  function renderBasics() {
    if (!profile) return;
    const p = profile, list = $('basicsList');
    const country = p.country || DEFAULT_COUNTRY;
    const stateLabel = country === DEFAULT_COUNTRY ? 'State' : 'State / Province / Region';
    const lang = LANGUAGES.find(l => l.code === (p.language || DEFAULT_LANGUAGE));
    const rows = [['Call me', p.callName], ['Gender', p.gender], ['Age', p.age], ['Country', country], [stateLabel, p.state || '—'],
      ['Language', lang ? lang.name : 'English'],
      [BOT_ROLES[0].role + ' bot', p.botNames[0]], [BOT_ROLES[1].role + ' bot', p.botNames[1]], ['Theme', themeById(p.themeId).name]];
    list.replaceChildren();
    rows.forEach(([k, v]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k; dd.textContent = v;
      list.append(dt, dd);
    });
  }
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');
  function openProfileView() {
    renderBasics();
    window.dispatchEvent(new Event('simsim:profileopen')); // memory.js loads the facts list
    $('thread').hidden = true;
    $('composer').hidden = true;
    $('profileView').hidden = false;
    $('profile').setAttribute('aria-pressed', 'true');
    chatRow.classList.remove('on');
    chatRow.removeAttribute('aria-current');
  }
  function closeProfileView() {
    $('profileView').hidden = true;
    $('thread').hidden = false;
    $('composer').hidden = false;
    $('profile').setAttribute('aria-pressed', 'false');
    chatRow.classList.add('on');
    chatRow.setAttribute('aria-current', 'page');
  }
  $('profile').addEventListener('click', () => { if (profile) openProfileView(); });
  chatRow.addEventListener('click', closeProfileView);
  $('newChat').addEventListener('click', closeProfileView);
  $('editBasics').addEventListener('click', () => showSetup(true));

  // ---- Called by sign-in (auth.js) once the server says you are signed in ----
  async function enter(signedInEmail) {
    email = signedInEmail;
    let r = null;
    try { r = await fetch('/api/profile', { cache: 'no-store' }); } catch (e) {}
    if (r && r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); return; }
    if (r && r.status === 404) { profile = null; window.SimSimFace.apply(null); showSetup(false); return; }
    const data = r && r.ok ? await r.json().catch(() => null) : null;
    profile = data && data.profile;
    if (profile) applyProfile(profile); // theme + names are set BEFORE the app is shown
    closeProfileView();
    showView('app');
    window.dispatchEvent(new Event('simsim:signedin'));
  }

  window.addEventListener('simsim:signedout', () => {
    profile = null;
    email = '';
    $('setup').hidden = true;
    closeProfileView();
    $('whoName').textContent = 'Profile';
    $('whoEmail').textContent = '';
    $('emptyTitle').textContent = 'Hi there';
    applyTheme(DEFAULT_THEME);
    window.SimSimFace.apply(null);   // signed out: the default mark, never the last user's face
  });

  window.SimSimSetup = {
    enter,
    callName: () => (profile ? profile.callName : ''),
    getProfile: () => profile,
    setProfile: p => { profile = p; applyProfile(p); },   // e.g. after renaming a bot in Group Chat
    showChat: () => {
      if (!$('profileView').hidden) closeProfileView();
      window.dispatchEvent(new Event('simsim:showchat')); // other views (Open loops) step aside too
    },
    // A reliable, idempotent open for the Action Layer (founder, 2026-11-01): never a toggle, and a no-op before the
    // profile has loaded (same guard the sidebar's own Profile button uses).
    openProfile: () => { if (profile) openProfileView(); },
    isProfileOpen: () => !$('profileView').hidden,
    // The user's chosen language code (e.g. "ur-PK"), for wake.js/app.js to give speech recognition — "en-US" before
    // a profile has loaded or when none was ever picked (founder, 2026-11-04 — "Pretty dropdowns + Country + Language").
    recognitionLang: () => (profile && profile.language) || DEFAULT_LANGUAGE
  };
})();
