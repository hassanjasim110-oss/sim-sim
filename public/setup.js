// SIM SIM first-time setup (notebook pages 1 + 2), the theme painter, and the Profile view.
// The answers are saved on OUR server (POST /api/profile) in the user's notebook. No AI here.
(function () {
  const { GENDERS, STATES, BOT_ROLES, THEMES, DEFAULT_THEME } = window.SIMSIM_DATA;
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
  function themeById(id) { return THEMES.find(t => t.id === id) || THEMES[0]; }
  function applyTheme(id) {
    const t = themeById(id), root = document.documentElement;
    for (const k in VARS) root.style.setProperty(VARS[k], t.v[k]);
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

  STATES.forEach(s => { const o = document.createElement('option'); o.value = o.textContent = s; $('state').appendChild(o); });

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

  function showSetup(edit) {
    editing = edit;
    const p = edit ? profile : null;
    $('callName').value = p ? p.callName : '';
    pickGender(p ? p.gender : '');
    $('age').value = p ? p.age : '';
    $('state').value = p ? p.state : '';
    $('bot1').value = p ? p.botNames[0] : BOT_ROLES[0].role;
    $('bot2').value = p ? p.botNames[1] : BOT_ROLES[1].role;
    $('bot1').dispatchEvent(new Event('input'));
    $('bot2').dispatchEvent(new Event('input'));
    pickTheme(p ? p.themeId : DEFAULT_THEME);
    ['eCallName', 'eGender', 'eAge', 'eState', 'eBots', 'eSave'].forEach(id => { $(id).textContent = ''; });
    $('cancelEdit').hidden = !edit;
    showView('setup');
    showPage(1);
  }

  // ---- Page 1 -> Page 2 ----
  $('continue').addEventListener('click', () => {
    const name = $('callName').value.trim(), age = $('age').value.trim();
    const checks = [
      ['eCallName', 'callName', name ? '' : 'Tell me what to call you.'],
      ['eGender', null, pickedGender ? '' : 'Pick one. "Prefer not to say" is fine.'],
      ['eAge', 'age', /^\d+$/.test(age) && +age >= 5 && +age <= 120 ? '' : 'Enter your age as a whole number from 5 to 120, like 27.'],
      ['eState', 'state', $('state').value ? '' : 'Choose your state.']
    ];
    let first = null;
    checks.forEach(([err, field, msg]) => {
      $(err).textContent = msg;
      if (msg && !first) first = field ? $(field) : $('gender').querySelector('[tabindex="0"]');
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
          state: $('state').value, botNames, themeId: pickedTheme
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
    const rows = [['Call me', p.callName], ['Gender', p.gender], ['Age', p.age], ['State', p.state],
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
    isProfileOpen: () => !$('profileView').hidden
  };
})();
