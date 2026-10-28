// SIM SIM Chat history on screen: the list of the user's saved 1-on-1 chats, newest first.
// The threads live in the user's own stored data on OUR server (data/chats.json). Opening one puts it back in the chat,
// and new messages continue that same thread. On sign-in, the most recent chat opens by itself.
(function () {
  const $ = id => document.getElementById(id);
  const chat = window.SimSimChat;
  const row = document.querySelector('.nav button[data-label="Chat history"]');
  const chatRow = document.querySelector('.nav button[data-label="Chat"]');

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
    if (isNaN(d)) return '';
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? 'Today, ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function render(list) {
    const ul = $('historyList');
    ul.replaceChildren();
    $('historyEmpty').hidden = list.length > 0;
    list.forEach(c => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-item' + (c.id === chat.threadId() ? ' current' : '');
      const title = document.createElement('span');
      title.className = 'chat-title';
      title.textContent = c.title;
      const meta = document.createElement('small');
      meta.className = 'chat-meta';
      meta.textContent = when(c.updatedAt) + ' · ' + c.count + (c.count === 1 ? ' message' : ' messages');
      b.append(title, meta);
      b.addEventListener('click', () => openChat(c.id));
      li.append(b);
      ul.appendChild(li);
    });
  }

  // Opening a saved chat: the server sends it back and makes it the conversation context again.
  async function openChat(id) {
    $('historyErr').textContent = '';
    try {
      const { chat: t } = await call('/api/chats/open', { id });
      hideView(true);
      chat.loadThread(t);
    } catch (e) { if (e.message !== 'signed out') $('historyErr').textContent = e.message; }
  }

  // ---- Showing and hiding the view (inside the main area, like Open loops) ----
  async function openView() {
    window.SimSimSetup.showChat();        // closes the other views
    $('thread').hidden = true;
    $('composer').hidden = true;
    $('historyView').hidden = false;
    chatRow.classList.remove('on'); chatRow.removeAttribute('aria-current');
    row.classList.add('on'); row.setAttribute('aria-current', 'page');
    $('historyErr').textContent = '';
    try { render((await call('/api/chats')).chats); }
    catch (e) { if (e.message !== 'signed out') $('historyErr').textContent = e.message; }
  }
  function hideView(restoreChat) {
    if ($('historyView').hidden) return;
    $('historyView').hidden = true;
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
  window.addEventListener('simsim:signedout', () => { $('historyList').replaceChildren(); hideView(true); });
  window.addEventListener('simsim:chatsaved', () => { if (!$('historyView').hidden) call('/api/chats').then(d => render(d.chats), () => {}); });

  // On sign-in: open the most recent chat, unless something is already on screen (e.g. the first greeting after setup).
  window.addEventListener('simsim:signedin', async () => {
    try {
      const { chats } = await call('/api/chats');
      if (chats.length && !chat.hasMessages() && !chat.threadId()) openChat(chats[0].id);
    } catch (e) {}
  });
})();
