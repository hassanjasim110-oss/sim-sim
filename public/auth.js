// SIM SIM sign-in: Firebase email link (passwordless).
// Firebase only proves who you are; our server then keeps the session (httpOnly cookie).
// Nothing here thinks or answers — that is the Meta brain's job, on the server.
import { firebaseConfig } from './firebase-config.js';

const FIREBASE = 'https://www.gstatic.com/firebasejs/12.19.0/';
const EMAIL_KEY = 'simSimEmailForSignIn';
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const $ = id => document.getElementById(id);

// The landing hero's video — the ONE place its source is set (founder, 2026-11-01). Empty by default: no <video>
// element is ever created, so there is no dead player and no "Unable to play media" anywhere on the page. Set
// this to a real file's URL to show it; it plays muted, looping, with its own first frame as the poster.
const LANDING_VIDEO_URL = '';
function buildHeroVideo() {
  const slot = $('heroMedia');
  if (!slot || !LANDING_VIDEO_URL) return;
  const v = document.createElement('video');
  v.src = LANDING_VIDEO_URL;
  v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
  v.setAttribute('aria-hidden', 'true');
  slot.replaceChildren(v);
  slot.hidden = false;
}
buildHeroVideo();

let fb = null, auth = null;   // Firebase auth module + instance (null if it failed to load)
let countdown = null;

// ---- small helpers ----
function store(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (e) {}
}
function stored(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function cleanUrl() {
  history.replaceState(null, '', location.pathname + location.hash);
}
async function getSession() {
  try {
    const r = await fetch('/api/session', { cache: 'no-store' });
    return await r.json();
  } catch (e) { return { signedIn: false }; }
}

// Firebase error codes -> one friendly sentence. Codes are never shown to the user.
function friendly(code) {
  switch (code) {
    case 'auth/invalid-email': return 'That email looks incomplete — check it and try again';
    case 'auth/missing-email': return 'That email looks incomplete — check it and try again';
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code': return 'This sign-in link has expired or was already used. Ask for a fresh one and it will work.';
    case 'auth/network-request-failed': return "We couldn't reach the sign-in service. Check your internet connection and try again.";
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded': return 'Too many sign-in emails just now. Wait a few minutes, then try again.';
    case 'auth/user-disabled': return 'This account has been switched off.';
    case 'auth/operation-not-allowed': return 'Email sign-in is not switched on yet in Firebase.';
    case 'auth/unauthorized-continue-uri':
    case 'auth/unauthorized-domain': return "This web address isn't allowed to sign in yet.";
    case 'sdk': return "We couldn't load sign-in. Check your internet connection and refresh the page.";
    default: return 'Something went wrong. Please try again.';
  }
}

// ---- what is on screen ----
// Signed in: setup.js loads the notebook, then shows setup (new user) or the themed app.
function showApp(email) {
  window.SimSimSetup.enter(email);
}
function showLanding() {
  $('app').hidden = true;
  $('setup').hidden = true;
  $('landing').hidden = false;
  $('loadingScreen').hidden = true;   // first load is over — no more blank-white gap to cover
  window.dispatchEvent(new Event('simsim:signedout'));
}
function showState(name) {
  document.querySelectorAll('#signinCard .state').forEach(s => { s.hidden = s.dataset.state !== name; });
  if (name !== 'inbox') clearInterval(countdown);
}
let devDoor = false; // the server's .env turned on the build-phase "type an email, you're in" door
function showForm() {
  if (devDoor) { showState('dev'); $('devErr').textContent = ''; return; }
  showState('form');
  $('emailErr').textContent = '';
}
function showError(code, signedInEmail, message) {
  $('errText').textContent = message || friendly(code);
  $('errBtn').textContent = signedInEmail ? 'Go to Sim Sim' : 'Back to sign in';
  $('errBtn').onclick = () => {
    if (signedInEmail) showApp(signedInEmail);
    else { showForm(); $('email').focus(); }
  };
  showState('error');
}
function toCard() {
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('signinCard').scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
  const input = !$('emailForm').closest('.state').hidden ? $('email') : !$('devForm').closest('.state').hidden ? $('devEmail') : null;
  setTimeout(() => (input || $('signinCard')).focus({ preventScroll: true }), smooth ? 450 : 0);
}

// ---- B) send the link ----
async function sendLink(email) {
  if (!fb) throw { code: 'sdk' };
  await fb.sendSignInLinkToEmail(auth, email, { url: location.origin + '/', handleCodeInApp: true });
  store(EMAIL_KEY, email);
}

function startCountdown() {
  const b = $('resend');
  let n = 60;
  b.disabled = true;
  b.textContent = 'Resend in ' + n + 's';
  clearInterval(countdown);
  countdown = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(countdown); b.disabled = false; b.textContent = 'Resend link'; }
    else b.textContent = 'Resend in ' + n + 's';
  }, 1000);
}

$('emailForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('email').value.trim();
  const err = $('emailErr'), btn = $('sendLink');
  if (!EMAIL_OK.test(email)) { err.textContent = 'That email looks incomplete — check it and try again'; $('email').focus(); return; }
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await sendLink(email);
    $('sentTo').textContent = email;
    $('resendErr').textContent = '';
    showState('inbox');
    startCountdown();
  } catch (x) {
    err.textContent = friendly(x && x.code);
  } finally {
    btn.disabled = false; btn.textContent = 'Email me my sign-in link';
  }
});

$('resend').addEventListener('click', async () => {
  const email = $('sentTo').textContent;
  $('resend').disabled = true;
  $('resendErr').textContent = '';
  try { await sendLink(email); startCountdown(); }
  catch (x) { $('resendErr').textContent = friendly(x && x.code); $('resend').disabled = false; $('resend').textContent = 'Resend link'; }
});

$('different').addEventListener('click', () => {
  store(EMAIL_KEY, null);
  $('email').value = '';
  showForm();
  $('email').focus();
});

$('topSignIn').addEventListener('click', toCard);
$('footSignIn').addEventListener('click', toCard);

// ---- C) back from the email link: finish signing in ----
async function finishSignIn(email) {
  showState('working');
  try {
    const cred = await fb.signInWithEmailLink(auth, email, location.href);
    const idToken = await cred.user.getIdToken();
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    const data = await r.json().catch(() => ({}));
    // The preview lock (founder, 2026-10-31; only when PREVIEW_ONLY_EMAIL is set on a hosted copy) sends its own
    // plain message — shown as-is, instead of the generic friendly() fallback. Any other failure is unchanged.
    if (!r.ok || !data.ok) throw { code: 'server', message: data.error === 'This preview is private.' ? data.error : null };
    store(EMAIL_KEY, null);
    cleanUrl();
    showApp(data.email);
  } catch (x) {
    cleanUrl(); // a refresh must never re-run the link
    const s = await getSession();
    showError(x && x.code, s.signedIn ? s.email : null, x && x.code === 'server' ? x.message : null);
  }
}

$('confirmForm').addEventListener('submit', e => {
  e.preventDefault();
  const email = $('confirmEmail').value.trim();
  if (!EMAIL_OK.test(email)) { $('confirmErr').textContent = 'That email looks incomplete — check it and try again'; return; }
  $('confirmErr').textContent = '';
  finishSignIn(email);
});

// ---- E) sign out (also used when the server says "not signed in") ----
async function signOutEverywhere() {
  try { if (fb) await fb.signOut(auth); } catch (e) {}
  try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
  store(EMAIL_KEY, null);
  $('email').value = '';
  showForm();
  showLanding();
  window.scrollTo(0, 0);
}
// Switch email confirm (founder, 2026-11-01; narrowed 2026-11-01 — "Journeys pack"): ONLY the dev door's "Switch
// email" still confirms first (a stray tap mid-test would otherwise lose whatever test session was in progress).
// Log out — the real, everyday sign-out, however it's reached (the sidebar button or Settings) — is now ONE tap,
// no confirm: ending a session is harmless (signing back in is just as easy), so a speed bump there was friction,
// not safety. An automatic sign-out (the server saying "not signed in", or a flow that already confirmed its own
// destructive step — "Forget everything") still skips this and calls signOutEverywhere directly.
function confirmSignOut() {
  if ($('signOutConfirm')) return;
  const box = document.createElement('div');
  box.id = 'signOutConfirm';
  box.className = 'confirm-overlay';
  const card = document.createElement('div');
  card.className = 'confirm-card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'signOutConfirmMsg');
  const msg = document.createElement('p');
  msg.id = 'signOutConfirmMsg';
  msg.textContent = "Switch email? You'll be signed out and can sign in with a different email.";
  const row = document.createElement('div');
  row.className = 'confirm-btns';
  const yes = document.createElement('button');
  yes.type = 'button'; yes.className = 'btn-primary'; yes.textContent = 'Switch email';
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
  yes.addEventListener('click', () => { close(); signOutEverywhere(); });
  no.addEventListener('click', close);
  yes.focus();
}
// "Switch email" (dev door only) still confirms; "Log out" (everyone else) ends the session at once.
$('signOut').addEventListener('click', () => {
  if ($('signOut').textContent === 'Switch email') confirmSignOut();
  else signOutEverywhere();
});
window.addEventListener('simsim:needsignin', signOutEverywhere);
window.SimSimAuth = { signOutDirect: signOutEverywhere, confirmSignOut };

// ---- Test mode (switched on ONLY by the server's .env; the page just reads what /api/session says) ----
// A safety label that is never hidden, and no Sign out (there is no real session to end).
function markTestMode() {
  document.querySelectorAll('[data-test-pill]').forEach(p => { p.hidden = false; });
  $('signOut').hidden = true;
}

// ---- Dev door (build phase only; switched on ONLY by the server's .env) ----
// One email field: the server starts a normal session for that email. Nothing is sent, nothing is checked but the shape.
const DEV_EMAIL = /^[^\s@\/\\:*?"<>|]+@[^\s@\/\\:*?"<>|]+\.[^\s@\/\\:*?"<>|.]{2,}$/;
function markDevDoor() {
  devDoor = true;
  $('signOut').textContent = 'Switch email';
}
$('devForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('devEmail').value.trim();
  if (!DEV_EMAIL.test(email)) { $('devErr').textContent = "That doesn't look like an email address."; $('devEmail').focus(); return; }
  $('devErr').textContent = '';
  $('devEnter').disabled = true;
  try {
    const r = await fetch('/api/dev-door', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) { $('devErr').textContent = data.error || 'That did not work. Please try again.'; return; }
    $('devEmail').value = '';
    showApp(data.email);
  } catch (x) {
    $('devErr').textContent = 'Could not reach the Sim Sim server. Is it still running?';
  } finally {
    $('devEnter').disabled = false;
  }
});

// ---- On every page load ----
async function boot() {
  const session = getSession(); // ask the server in parallel while Firebase loads
  try {
    const [appMod, authMod] = await Promise.all([import(FIREBASE + 'firebase-app.js'), import(FIREBASE + 'firebase-auth.js')]);
    fb = authMod;
    auth = authMod.getAuth(appMod.initializeApp(firebaseConfig));
  } catch (e) {
    fb = auth = null;
  }

  // FIRST: did we arrive from the email link?
  if (fb && fb.isSignInWithEmailLink(auth, location.href)) {
    showLanding();
    const email = stored(EMAIL_KEY);
    if (email) finishSignIn(email);
    else { showState('confirm'); $('confirmEmail').focus(); }
    toCard();
    return;
  }

  const s = await session;
  if (s.testMode) markTestMode();
  if (s.devDoor) markDevDoor();
  if (s.signedIn) return showApp(s.email);
  showLanding();
  if (devDoor) { showForm(); return; }   // the email-only card, no Firebase needed
  if (!fb) { $('emailErr').textContent = friendly('sdk'); return; }
  const pending = stored(EMAIL_KEY);
  if (pending) $('email').value = pending;
}

boot();
