// SIM SIM — Sim Sim's face (founder, 2026-10-29): how the assistant LOOKS, chosen per user. Never its name:
// "Sim Sim" is fixed, and nothing here (or anywhere) renames it.
// One source of truth: profile.face on OUR server. One change paints every Sim Sim avatar at once —
// a CSS variable (--sim-face) plus a class on <html>; styles.css does the rest.
// The two Discussion bots (founder, 2026-10-31) use the SAME system, one slot each in profile.botFaces (--bot1-face / --bot2-face).
// Settings shows ONE "Faces" card (founder, 2026-10-31): a switch picks WHOSE face (Sim Sim · bot 1 · bot 2) and one set of
// choices below edits that seat only.
(function () {
  const $ = id => document.getElementById(id);
  const { FACES } = window.SIMSIM_DATA;
  const root = document.documentElement;
  const PICTURE_MAX = 5 * 1024 * 1024, PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const BOT_DEFAULT_NAMES = ['Researcher', 'Challenger'];
  let profile = null;    // the signed-in user's profile, as last applied
  let seat = 'sim';      // whose face the card is editing: 'sim', 0 (bot 1) or 1 (bot 2)
  let preview = null;    // a made face waiting for "Use this face" — nothing is set until then
  let lastWords = '';
  let gen = 0;           // bumps when the switch moves, so a face still being made never lands on the other seat

  function urlOf(face) {
    if (!face) return null;
    if (face.kind === 'gallery' && FACES.some(f => f.id === face.ref)) return '/faces/' + face.ref + '.svg';
    if ((face.kind === 'upload' || face.kind === 'made') && /^\/api\/images\/[\w-]+\.(?:png|jpg|webp)$/.test(face.ref)) return face.ref;
    return null;
  }
  const botNames = () => (profile && Array.isArray(profile.botNames)) ? profile.botNames : BOT_DEFAULT_NAMES;
  const botName = i => botNames()[i] || BOT_DEFAULT_NAMES[i];
  const faceOf = s => s === 'sim' ? profile && profile.face : profile && Array.isArray(profile.botFaces) ? profile.botFaces[s] : null;

  // Called with the signed-in user's profile (setup.js), or null when signed out: every seat back to its default.
  function apply(p) {
    profile = p;
    const url = urlOf(p && p.face);
    if (url) { root.style.setProperty('--sim-face', 'url("' + url + '")'); root.classList.add('has-face'); }
    else { root.style.removeProperty('--sim-face'); root.classList.remove('has-face'); }
    [0, 1].forEach(i => {
      const u = urlOf(faceOf(i)), n = i + 1;
      if (u) { root.style.setProperty('--bot' + n + '-face', 'url("' + u + '")'); root.classList.add('has-bot' + n + '-face'); }
      else { root.style.removeProperty('--bot' + n + '-face'); root.classList.remove('has-bot' + n + '-face'); }
      $('faceSeat' + n).textContent = botName(i);
    });
    if (!p) choose('sim');
    paintCard();
  }

  // ---- The card: the switch, then the switched-to seat's face and its choices ----
  function paintCard() {
    document.querySelectorAll('#faceSwitch [role="radio"]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.seat === String(seat))));
    const av = $('faceNowAvatar');
    if (seat === 'sim') {
      av.className = 'avatar big'; av.textContent = 'S';
      $('faceNowName').textContent = "Sim Sim's face";
      $('faceNowNote').textContent = 'Only the face changes. The name is always Sim Sim.';
    } else {
      av.className = 'avatar bot big b' + (seat + 1); av.textContent = botName(seat)[0];
      $('faceNowName').textContent = botName(seat) + "'s face";
      $('faceNowNote').textContent = 'Only the face changes. The name is set in Discussion.';
    }
    const face = faceOf(seat);
    $('faceDefault').hidden = !urlOf(face);
    document.querySelectorAll('#faceGallery [role="radio"]').forEach(b =>
      b.setAttribute('aria-checked', String(!!face && face.kind === 'gallery' && face.ref === b.dataset.id)));
  }
  function choose(s) {
    if (s === seat) return;
    seat = s; gen++;
    preview = null; $('facePreview').hidden = true;   // a preview belongs to the seat it was made for
    say('');
    paintCard();
  }
  document.querySelectorAll('#faceSwitch [role="radio"]').forEach(b =>
    b.addEventListener('click', () => choose(b.dataset.seat === 'sim' ? 'sim' : Number(b.dataset.seat))));
  $('faceSwitch').addEventListener('keydown', e => {   // arrow keys move the switch, like the other radio groups
    const order = ['sim', 0, 1], step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = order[(order.indexOf(seat) + step + 3) % 3];
    choose(next);
    document.querySelector('#faceSwitch [data-seat="' + next + '"]').focus();
  });

  async function call(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'That did not work. Please try again.');
    return d;
  }
  function say(text, isError) { $('faceStatus').textContent = isError ? '' : text; $('faceErr').textContent = isError ? text : ''; }
  const doneLine = s => s === 'sim' ? 'Done — that face is Sim Sim now.' : 'Done — that face is ' + botName(s) + "'s now.";

  // Saves the choice for the switched-to seat (no bot = Sim Sim's face); the profile that comes back repaints every avatar.
  async function setFace(body, done) {
    const s = seat;
    say('Saving…');
    try {
      const d = await call('/api/face', s === 'sim' ? body : Object.assign({ bot: s }, body));
      window.SimSimSetup.setProfile(d.profile);
      say(typeof done === 'function' ? done(s) : done);
    } catch (e) { if (e.message !== 'signed out') say(e.message, true); }
  }

  // ---- Gallery: picking one applies it at once ----
  FACES.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'face-pick'; b.setAttribute('role', 'radio'); b.dataset.id = f.id;
    b.setAttribute('aria-checked', 'false');
    const img = document.createElement('img');
    img.src = '/faces/' + f.id + '.svg'; img.alt = '';
    const name = document.createElement('small');
    name.textContent = f.name;
    b.append(img, name);
    b.addEventListener('click', () => setFace({ kind: 'gallery', id: f.id }, doneLine));
    $('faceGallery').appendChild(b);
  });
  $('faceDefault').addEventListener('click', () => setFace({ kind: 'default' }, 'Back to the default face.'));

  // ---- Upload: the same picture checks as everywhere (PNG/JPEG/WebP, up to 5 MB; the server checks the real bytes) ----
  $('faceUploadBtn').addEventListener('click', () => $('faceFile').click());
  $('faceFile').addEventListener('change', () => {
    const file = $('faceFile').files[0];
    $('faceFile').value = '';
    if (!file) return;
    if (!PICTURE_TYPES.includes(file.type)) return say('Sim Sim can use PNG, JPEG or WebP pictures.', true);
    if (file.size > PICTURE_MAX) return say('That picture is too large — try a smaller one.', true);
    const reader = new FileReader();
    reader.onload = () => setFace({ kind: 'upload', image: reader.result }, s => s === 'sim' ? 'Done — your picture is Sim Sim\'s face now.' : 'Done — your picture is ' + botName(s) + "'s face now.");
    reader.readAsDataURL(file);
  });

  // ---- Make one: words -> the make lane -> a PREVIEW -> Use this face / Try again / Cancel ----
  async function make(words) {
    const mine = gen;
    lastWords = words;
    preview = null;
    $('facePreview').hidden = true;
    $('faceMakeBtn').disabled = true; $('faceAgain').disabled = true;
    say('Making the face… this takes about 10 seconds.');
    try {
      const d = await call('/api/face/make', { description: words });
      if (mine !== gen) return;   // the switch moved meanwhile: this face was for the other seat
      preview = d.preview.url;
      $('facePreviewImg').src = preview;
      $('facePreview').hidden = false;
      say('Here it is. Nothing changes until you tap "Use this face".');
    } catch (e) { if (e.message !== 'signed out' && mine === gen) say(e.message, true); }
    finally { $('faceMakeBtn').disabled = false; $('faceAgain').disabled = false; }
  }
  $('faceMake').addEventListener('submit', e => {
    e.preventDefault();
    const words = $('faceWords').value.trim();
    if (words.length < 3) return say('Describe the face in a few words first.', true);
    make(words);
  });
  $('faceAgain').addEventListener('click', () => { if (lastWords) make(lastWords); });
  $('faceCancel').addEventListener('click', () => {
    preview = null;
    $('facePreview').hidden = true;
    say('Kept the face it had.');
  });
  $('faceUse').addEventListener('click', async () => {
    if (!preview) return;
    const ref = preview;
    await setFace({ kind: 'made', ref }, doneLine);
    if (!$('faceErr').textContent) { preview = null; $('facePreview').hidden = true; }
  });

  // ---- Reachable from the Profile view too (it opens on Sim Sim's stop) ----
  $('changeFace').addEventListener('click', () => {
    choose('sim');
    $('openSettings').click();
    setTimeout(() => { $('setFace').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('setFace').focus({ preventScroll: true }); }, 60);
  });

  window.SimSimFace = { apply };
})();
