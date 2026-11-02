// SIM SIM "Your pictures": the pictures Sim Sim MADE or EDITED for this user, newest first (a per-user index on OUR server).
// Uploads are never saved, so they are never here. Tap a tile for full size, Download, or Delete.
(function () {
  const $ = id => document.getElementById(id);
  const row = document.querySelector('.nav button[data-label="Your pictures"]');
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');
  let open = null;   // the picture shown full size
  let armed = null;

  async function call(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'That did not work. Please try again.');
    return d;
  }
  function when(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function render(list) {
    const grid = $('picturesGrid');
    grid.replaceChildren();
    $('picturesEmpty').hidden = list.length > 0;
    list.forEach(p => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pic-tile';
      b.setAttribute('aria-label', (p.kind === 'edited' ? 'Edited picture, ' : 'Picture, ') + when(p.createdAt));
      const img = document.createElement('img');
      img.src = p.url; img.alt = ''; img.loading = 'lazy';
      const cap = document.createElement('small');
      cap.textContent = (p.kind === 'edited' ? 'Edited · ' : '') + when(p.createdAt);
      b.append(img, cap);
      b.addEventListener('click', () => show(p));
      li.appendChild(b);
      grid.appendChild(li);
    });
  }
  async function load() {
    $('picturesErr').textContent = '';
    try { render((await call('/api/pictures')).pictures); }
    catch (e) { if (e.message !== 'signed out') $('picturesErr').textContent = e.message; }
  }

  // ---- Full size: Download / Delete (one confirm) / Close ----
  function show(p) {
    open = p;
    $('picFullImg').src = p.url;
    $('picFullImg').alt = p.kind === 'edited' ? 'A picture Sim Sim edited for you' : 'A picture Sim Sim made for you';
    $('picFullDate').textContent = (p.kind === 'edited' ? 'Edited ' : 'Made ') + when(p.createdAt);
    $('picDownload').href = p.url;
    $('picDownload').download = 'sim-sim-' + p.name;
    $('picFullErr').textContent = '';
    disarm();
    $('picViewer').hidden = false;
    $('picClose').focus();
  }
  function hide() { $('picViewer').hidden = true; open = null; disarm(); }
  function disarm() { clearTimeout(armed); armed = null; $('picDelete').textContent = 'Delete'; $('picDelete').classList.remove('armed'); }
  $('picClose').addEventListener('click', hide);
  $('picViewer').addEventListener('click', e => { if (e.target === $('picViewer')) hide(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('picViewer').hidden) hide(); });
  $('picDelete').addEventListener('click', async () => {
    if (!open) return;
    if (!armed) {   // first tap asks, second tap deletes
      $('picDelete').textContent = 'Tap again to delete';
      $('picDelete').classList.add('armed');
      armed = setTimeout(disarm, 5000);
      return;
    }
    disarm();
    try { await call('/api/pictures/delete', { name: open.name }); hide(); load(); }
    catch (e) { if (e.message !== 'signed out') $('picFullErr').textContent = e.message; }
  });

  // ---- Showing and hiding the view (inside the main area, like Chat history) ----
  function openView() {
    window.SimSimSetup.showChat();   // closes the other views
    $('thread').hidden = true;
    $('composer').hidden = true;
    $('picturesView').hidden = false;
    chatRow.classList.remove('on'); chatRow.removeAttribute('aria-current');
    row.classList.add('on'); row.setAttribute('aria-current', 'page');
    load();
  }
  function hideView(restoreChat) {
    if ($('picturesView').hidden) return;
    $('picturesView').hidden = true;
    hide();
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
  window.addEventListener('simsim:signedout', () => { $('picturesGrid').replaceChildren(); hideView(true); });
  window.SimSimPictures = { show: openView, isOpen: () => !$('picturesView').hidden };
})();
