// SIM SIM full view (founder, 2026-10-30): ONE overlay that OPENS media inside Sim Sim — a picture full size, a PDF's pages
// (the browser's own PDF reader), a video that plays — with Download and Close. Esc or a click outside the media closes it.
// It only ever shows the user's own media through the existing owner-only addresses (/api/images, /api/documents, …).
(function () {
  const $ = id => document.getElementById(id);
  let back = null;   // where the keyboard focus returns on close

  // item: { kind: 'image' | 'pdf' | 'video', url, title, download?: { url, name } }
  function open(item) {
    const stage = $('mvStage');
    stage.replaceChildren();
    let el;
    if (item.kind === 'image') {
      el = document.createElement('img');
      el.src = item.url; el.alt = item.title || 'Picture';
    } else if (item.kind === 'pdf') {
      el = document.createElement('iframe');
      el.src = item.url; el.title = item.title || 'Document';
    } else if (item.kind === 'website') {
      // A page Sim Sim made runs HERE, sandboxed: its own scripts work, but it can never reach this app, its
      // cookies, or its storage — no allow-same-origin, no allow-top-navigation (founder, 2026-10-31).
      el = document.createElement('iframe');
      el.src = item.url; el.title = item.title || 'Website';
      el.setAttribute('sandbox', 'allow-scripts');
    } else if (item.kind === 'video') {
      el = document.createElement('video');
      el.src = item.url; el.controls = true; el.playsInline = true; el.preload = 'metadata';
    } else return;
    el.className = 'mv-media mv-' + item.kind;
    stage.append(el);
    $('mvTitle').textContent = item.title || '';
    const d = item.download || { url: item.url, name: '' };
    $('mvDownload').href = d.url;
    if (d.name) $('mvDownload').download = d.name; else $('mvDownload').setAttribute('download', '');
    back = document.activeElement;
    $('mediaView').hidden = false;
    $('mvClose').focus();
  }
  function close() {
    if ($('mediaView').hidden) return;
    $('mediaView').hidden = true;
    $('mvStage').replaceChildren();   // stops a playing video, frees the PDF
    if (back && back.focus) back.focus();
    back = null;
  }
  $('mvClose').addEventListener('click', close);
  $('mediaView').addEventListener('click', e => { if (e.target === $('mediaView') || e.target === $('mvStage')) close(); });   // outside the media
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('mediaView').hidden) { e.stopPropagation(); close(); } }, true);
  window.addEventListener('simsim:signedout', close);

  // An inline video player that really plays (any video the app shows in a message), with a "full view" button.
  function videoPlayer(url, title) {
    const box = document.createElement('div');
    box.className = 'mv-inline';
    const v = document.createElement('video');
    v.src = url; v.controls = true; v.playsInline = true; v.preload = 'metadata';
    const full = document.createElement('button');
    full.type = 'button'; full.className = 'mini-btn'; full.textContent = 'Full view';
    full.addEventListener('click', () => { v.pause(); open({ kind: 'video', url, title }); });
    box.append(v, full);
    return box;
  }

  window.SimSimMedia = { open, close, videoPlayer, isOpen: () => !$('mediaView').hidden };
})();
