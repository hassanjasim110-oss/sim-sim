// SIM SIM Side chats (founder, 2026-10-29 — the Muse pattern): the user's own separate, named chats, listed in the sidebar
// under "Chat", newest activity first. "Chat" is the main conversation; every other saved 1-on-1 thread is a side chat.
// Each one keeps its own messages and context on OUR server (data/chats.json); what Sim Sim remembers (the notebook)
// is the user's, shared by the main Chat and every side chat. On sign-in, the main Chat opens by itself.
(function () {
  const $ = id => document.getElementById(id);
  const chat = window.SimSimChat;
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');
  let chats = [];   // the last list from the server: [{ id, kind, title, updatedAt, count }]

  async function call(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'That did not work. Please try again.');
    return d;
  }
  function err(text) { $('sideErr').textContent = text || ''; }
  async function refresh() {
    try {
      chats = (await call('/api/chats')).chats;
      render();
      // the open side chat's header follows its saved name (e.g. a "Skip" chat just named by its first message)
      const open = chats.find(c => c.id === chat.threadId());
      if (open && chat.kind() === 'side') chat.setTitle(open.title);
    }
    catch (e) { if (e.message !== 'signed out') err(e.message); }
  }

  // ---- The list ----
  function render() {
    const ul = $('sideList');
    ul.replaceChildren();
    const sides = chats.filter(c => c.kind === 'side' && c.named === true);
    $('sideEmpty').hidden = sides.length > 0;
    sides.forEach(c => ul.append(row(c)));
    paint();
  }
  function mini(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mini-btn' + (cls ? ' ' + cls : ''); b.textContent = label;
    b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    return b;
  }
  function row(c) {
    const li = document.createElement('li');
    li.className = 'sc-row';
    li.dataset.id = c.id;
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'sc-item';
    item.textContent = c.title;
    item.title = c.title;
    item.addEventListener('click', () => openChat(c.id));
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'sc-more';
    more.setAttribute('aria-label', 'Rename or delete ' + c.title);
    more.textContent = '⋯';
    const ctrl = document.createElement('div');
    ctrl.className = 'sc-ctrl';
    ctrl.hidden = true;
    const normal = () => ctrl.replaceChildren(
      mini('Rename', '', () => renaming(c, li, item, ctrl, normal)),
      mini('Export', '', () => exportChat(c)),
      mini('Delete', '', () => ctrl.replaceChildren(
        Object.assign(document.createElement('span'), { className: 'confirm-q', textContent: 'Delete this chat?' }),
        mini('Delete', 'danger-btn armed', () => remove(c)),
        mini('Cancel', '', normal))));
    more.addEventListener('click', e => {
      e.stopPropagation();
      const open = ctrl.hidden;
      document.querySelectorAll('.sc-ctrl').forEach(x => { x.hidden = true; });
      if (open) { normal(); ctrl.hidden = false; }
    });
    li.append(item, more, ctrl);
    return li;
  }

  // ---- Rename (the name sticks) and Delete (with a confirm) — the same server routes as before ----
  function renaming(c, li, item, ctrl, normal) {
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 60; input.value = c.title.slice(0, 60);   // an auto-title can be 61 (60 + "…")
    input.className = 'sc-rename';
    input.setAttribute('aria-label', 'New name for this side chat');
    const done = () => { input.remove(); item.hidden = false; normal(); ctrl.hidden = true; };
    const save = async () => {
      try {
        const d = await call('/api/chats/rename', { id: c.id, title: input.value });
        if (c.id === chat.threadId()) chat.setTitle(d.title);
        await refresh();
      } catch (e) { if (e.message !== 'signed out') err(e.message); }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') done(); });
    item.hidden = true;
    li.prepend(input);
    ctrl.replaceChildren(mini('Save', 'on', save), mini('Cancel', '', done));
    input.focus(); input.select();
  }
  // "Export chat" (founder, 2026-11-01 — "Journeys pack"): a plain-text download of this chat's own transcript — a
  // plain GET, never /api/chats/open, so it never switches the session's open conversation as a side effect.
  function exportChat(c) {
    const a = document.createElement('a');
    a.href = '/api/chats/export?id=' + encodeURIComponent(c.id);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  async function remove(c) {
    err('');
    try {
      const d = await call('/api/chats/delete', { id: c.id });
      if (d.wasOpen || c.id === chat.threadId()) { await refresh(); await goMain(); return; }   // it was open: back to the main Chat
      await refresh();
    } catch (e) { if (e.message !== 'signed out') err(e.message); }
  }

  // ---- Opening chats ----
  // A side chat (or the main thread): the server sends it back and makes it this session's conversation.
  async function openChat(id) {
    err('');
    try {
      const { chat: t } = await call('/api/chats/open', { id });
      window.SimSimSetup.showChat();   // closes Profile / Discussion / Open loops / …, back to the chat column
      chat.loadThread(t);
      await refresh();
    } catch (e) { if (e.message !== 'signed out') err(e.message); }
  }
  // The main Chat: its saved thread, or a fresh one if there is none yet.
  async function goMain() {
    const main = chats.find(c => c.kind === 'main');
    if (main) return openChat(main.id);
    chat.clear();
    fetch('/api/chat/reset', { method: 'POST' }).catch(() => {});
    paint();
  }

  // "+": one small inline step — "Name this side chat", then Create or Skip. Either way it opens at once, empty.
  $('sideAdd').addEventListener('click', () => {
    const f = $('sideNew');
    f.hidden = !f.hidden;
    err('');
    if (!f.hidden) { $('sideName').value = ''; $('sideName').focus(); }
  });
  async function create(title) {
    err('');
    try {
      const { chat: t } = await call('/api/chats/new', title ? { title } : {});
      $('sideNew').hidden = true;
      window.SimSimSetup.showChat();
      chat.loadThread(t);
      await refresh();
      $('input').focus();
    } catch (e) { if (e.message !== 'signed out') err(e.message); }
  }
  $('sideNew').addEventListener('submit', e => { e.preventDefault(); create($('sideName').value.trim()); });
  $('sideSkip').addEventListener('click', () => create(''));
  $('sideName').addEventListener('keydown', e => { if (e.key === 'Escape') { $('sideNew').hidden = true; $('sideAdd').focus(); } });

  // ---- Which row is lit: "Chat" for the main conversation, the side chat's own row while it is open ----
  function paint() {
    const shown = !$('thread').hidden;
    const side = shown && chat.kind() === 'side';
    document.querySelectorAll('.sc-item').forEach(b => {
      const on = side && b.parentElement.dataset.id === chat.threadId();
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (side && chatRow.classList.contains('on')) { chatRow.classList.remove('on'); chatRow.removeAttribute('aria-current'); }
    if (shown && !side && !chatRow.classList.contains('on')) { chatRow.classList.add('on'); chatRow.setAttribute('aria-current', 'page'); }
  }
  new MutationObserver(paint).observe($('thread'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(paint).observe(chatRow, { attributes: true, attributeFilter: ['class'] });

  // "Chat" in the sidebar: back to the main conversation (from a side chat, or from another view).
  chatRow.addEventListener('click', () => { if (chat.kind() === 'side') goMain(); });
  window.addEventListener('simsim:chatsaved', refresh);           // a new title, or newest activity first
  // Sim Sim deleted the open chat (the Action Layer): back to the main Chat, with its line shown there
  window.addEventListener('simsim:gomain', async e => {
    await refresh();
    await goMain();
    if (e.detail && e.detail.note) chat.addSimText(e.detail.note);
  });
  window.addEventListener('simsim:threadchanged', paint);         // New chat, a loaded thread
  window.addEventListener('simsim:signedout', () => { chats = []; $('sideList').replaceChildren(); $('sideNew').hidden = true; err(''); });
  document.addEventListener('click', e => { if (!e.target.closest('.sc-row')) document.querySelectorAll('.sc-ctrl').forEach(x => { x.hidden = true; }); });

  // ---- Global search (founder, 2026-10-30): the signed-in user's OWN chats — titles and messages ----
  // Typing waits a moment, then asks the server; a result opens its chat and scrolls to the message.
  let searchT = null, searchSeq = 0;
  function when2(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  async function runSearch() {
    const q = $('gSearch').value.trim(), ul = $('gResults'), mine = ++searchSeq;
    if (q.length < 2) { ul.hidden = true; ul.replaceChildren(); return; }
    let results = [];
    try { results = (await call('/api/chats/search?q=' + encodeURIComponent(q))).results; } catch (e) { return; }
    if (mine !== searchSeq) return;   // a newer search is on its way
    ul.replaceChildren();
    if (!results.length) ul.append(Object.assign(document.createElement('li'), { className: 'gs-none', textContent: 'Nothing found in your chats.' }));
    results.forEach(r => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'gs-item';
      const head = document.createElement('span');
      head.className = 'gs-head';
      const t = document.createElement('b'); t.textContent = r.kind === 'main' ? 'Chat' : r.title;
      const d = document.createElement('small'); d.textContent = when2(r.at);
      head.append(t, d);
      const sn = document.createElement('span');
      sn.className = 'gs-snip'; sn.textContent = (r.who ? r.who + ': ' : '') + r.snippet;
      b.append(head, sn);
      b.addEventListener('click', async () => {
        ul.hidden = true; $('gSearch').value = '';
        await openChat(r.threadId);
        const el = r.messageId && document.querySelector('#col [data-mid="' + CSS.escape(r.messageId) + '"]');
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('gs-flash'); setTimeout(() => el.classList.remove('gs-flash'), 2200); }
      });
      li.append(b);
      ul.append(li);
    });
    ul.hidden = false;
  }
  $('gSearch').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 250); });
  $('gSearch').addEventListener('keydown', e => { if (e.key === 'Escape') { $('gSearch').value = ''; $('gResults').hidden = true; } });
  document.addEventListener('click', e => { if (!e.target.closest('.gsearch')) $('gResults').hidden = true; });
  window.addEventListener('simsim:signedout', () => { $('gSearch').value = ''; $('gResults').hidden = true; $('gResults').replaceChildren(); });

  // On sign-in: the main Chat opens by itself, unless something is already on screen (e.g. the first greeting after setup).
  window.addEventListener('simsim:signedin', async () => {
    await refresh();
    const main = chats.find(c => c.kind === 'main');
    if (main && !chat.hasMessages() && !chat.threadId()) openChat(main.id);
  });
})();
