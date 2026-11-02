// SIM SIM message options (founder, 2026-10-29 — the Muse pattern): a small cluster BESIDE every message, there from the start,
// never hidden until tapped: React · Reply · More (Share · Copy · Delete on your own 1-on-1 messages).
// A reaction is ONE emoji per message and display only: never a pick, never the brain's context, never in the notebook or learning.
// Share and Copy only ever run when the user taps them; nothing leaves the page by itself.
(function () {
  const EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
  const ICON = {
    react: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
    reply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l-5 5 5 5"/><path d="M5 12h9a5 5 0 0 1 5 5v1"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01"/></svg>',
    pick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
  };

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.dispatchEvent(new Event('simsim:needsignin')); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'That did not work.');
    return d;
  }

  // ONE popover open at a time (the emoji row or the More menu). A click elsewhere or Escape closes it.
  let open = null;   // { pop, btn, box, el }
  function closePop() {
    if (!open) return;
    open.pop.hidden = true;
    open.btn.setAttribute('aria-expanded', 'false');
    open.el.classList.remove('opts-open');
    open = null;
  }
  document.addEventListener('click', e => { if (open && !open.box.contains(e.target)) closePop(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { const b = open.btn; closePop(); b.focus(); } });

  // A small note beside the cluster ("Copied"), gone after a moment.
  function note(box, text) {
    let n = box.querySelector('.opts-note');
    if (!n) { n = document.createElement('span'); n.className = 'opts-note'; n.setAttribute('role', 'status'); box.append(n); }
    n.textContent = text;
    clearTimeout(n._t);
    n._t = setTimeout(() => n.remove(), 2500);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* older browser or blocked: the textarea way */ }
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  // Share: the browser's own share sheet where there is one; otherwise a copy, ready to paste anywhere.
  // A picture Sim Sim made or edited is shared as the image file where the browser can; otherwise its address is copied.
  async function share(box, o) {
    const pic = o.picture ? o.picture() : null;
    if (pic) {
      if (navigator.share && navigator.canShare) {
        try {
          const blob = await (await fetch(pic)).blob();
          const file = new File([blob], 'sim-sim-picture.' + ((blob.type.split('/')[1] || 'png').split('+')[0].replace('jpeg', 'jpg')), { type: blob.type || 'image/png' });
          if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
        } catch (e) { if (e.name === 'AbortError') return; }   // closed the sheet: nothing else to do
      }
      note(box, await copyText(new URL(pic, location.href).href) ? 'Copied — ready to share' : "Couldn't copy that");
      return;
    }
    const text = o.text();
    if (navigator.share) {
      try { await navigator.share({ text }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    note(box, await copyText(text) ? 'Copied — ready to share' : "Couldn't copy that");
  }

  function iconBtn(kind, label) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt opt-' + kind;
    b.innerHTML = ICON[kind];
    b.setAttribute('aria-label', label); b.title = label;
    return b;
  }

  // el: a .user bubble or a .msg card. o: {
  //   who: 'Sim Sim' | 'You' | a bot's name (for Reply), text() -> the message's words, picture()? -> a made/edited picture's address,
  //   onReply(who, text)?, current?, send?(emoji|null) -> Promise, onDelete?() -> Promise,
  //   pick?: { active, picked, onPick() -> Promise } — Discussion answers only: a quiet Pick control, same row, same weight }
  // Returns { update(more) }: React and Delete switch on once the message is saved and has an id.
  function attach(el, o) {
    if (el._opts) { el._opts.update(o); return el._opts; }
    const user = el.classList.contains('user');
    let current = o.current || null;

    const box = document.createElement('div');
    box.className = 'opts';
    box.setAttribute('role', 'toolbar');
    box.setAttribute('aria-label', 'Message options');

    const reactBtn = iconBtn('react', 'React'), replyBtn = iconBtn('reply', 'Reply'), pickBtn = iconBtn('pick', 'Pick this answer'), moreBtn = iconBtn('more', 'More options');
    reactBtn.setAttribute('aria-haspopup', 'true'); moreBtn.setAttribute('aria-haspopup', 'menu');
    pickBtn.classList.add('opt-pick'); pickBtn.setAttribute('aria-pressed', 'false');
    const reactPop = document.createElement('div');
    reactPop.className = 'opts-pop react-pop';
    reactPop.setAttribute('role', 'group'); reactPop.setAttribute('aria-label', 'Reactions');
    const morePop = document.createElement('div');
    morePop.className = 'opts-pop more-pop';
    morePop.setAttribute('role', 'menu');
    reactPop.hidden = morePop.hidden = true;
    box.append(reactBtn, replyBtn, pickBtn, moreBtn, reactPop, morePop);

    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'react-chip';
    chip.title = 'Your reaction — tap to remove it';
    chip.addEventListener('click', e => { e.stopPropagation(); set(current); });   // the same emoji again removes it

    function toggle(pop, btn) {
      const was = open && open.pop === pop;
      closePop();
      if (was) return;
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      el.classList.add('opts-open');   // lifts this message above the next one, so the popover is never covered
      // open upward when there is no room below (the last messages sit just above the composer)
      const scroller = el.closest('.thread, .gthread');
      pop.classList.remove('up');
      if (scroller && pop.getBoundingClientRect().bottom > scroller.getBoundingClientRect().bottom - 8) pop.classList.add('up');
      open = { pop, btn, box, el };
      const first = pop.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
    reactBtn.addEventListener('click', e => { e.stopPropagation(); toggle(reactPop, reactBtn); });
    moreBtn.addEventListener('click', e => { e.stopPropagation(); menu(); toggle(morePop, moreBtn); });
    replyBtn.addEventListener('click', e => { e.stopPropagation(); closePop(); if (o.onReply) o.onReply(o.who, o.text()); });
    pickBtn.addEventListener('click', async e => {
      e.stopPropagation(); closePop();
      if (!o.pick || !o.pick.active || o.pick.picked || pickBtn.disabled) return;
      pickBtn.disabled = true;
      try { await o.pick.onPick(); } finally { pickBtn.disabled = false; }
    });

    function emojiRow() {
      reactPop.replaceChildren();
      EMOJI.forEach(x => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = x;
        b.setAttribute('aria-label', 'React ' + x);
        b.setAttribute('aria-pressed', String(current === x));
        b.addEventListener('click', ev => { ev.stopPropagation(); set(x); });
        reactPop.append(b);
      });
    }
    function item(label, cls, onClick) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'opts-item' + (cls ? ' ' + cls : ''); b.textContent = label;
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', ev => { ev.stopPropagation(); onClick(); });
      return b;
    }
    // More: Share · Copy · Delete (Delete only on the user's OWN saved 1-on-1 messages)
    function menu() {
      morePop.replaceChildren(
        item('Share', '', () => { closePop(); share(box, o); }),
        item('Copy', '', async () => { closePop(); note(box, await copyText(o.text()) ? 'Copied' : "Couldn't copy that"); }));
      if (o.onDelete) morePop.append(item('Delete', 'danger', confirmDelete));
    }
    // One light confirm: "Delete this message? Delete / Cancel"
    function confirmDelete() {
      const q = document.createElement('p');
      q.className = 'opts-q'; q.textContent = 'Delete this message?';
      const yes = item('Delete', 'danger', async () => {
        try { await o.onDelete(); closePop(); el.remove(); }
        catch (err) { if (err.message !== 'signed out') q.textContent = err.message; }
      });
      const no = item('Cancel', '', () => { menu(); morePop.querySelector('button').focus(); });
      morePop.replaceChildren(q, yes, no);
      yes.focus();
    }
    async function set(x) {
      if (!o.send) return;
      const next = current === x ? null : x;
      try { await o.send(next); current = next; paint(); closePop(); }
      catch (err) { /* nothing changed: the chip shows what is really saved */ }
    }
    function paint() {
      reactBtn.hidden = !o.send;   // a message that isn't saved (yet) can't hold a reaction
      chip.textContent = current || '';
      chip.hidden = !current;
      chip.setAttribute('aria-label', current ? 'Your reaction ' + current + ' — tap to remove' : '');
      el.classList.toggle('has-react', !!current);
      emojiRow();
      // The quiet Pick control (Discussion answers only — founder, 2026-11-01): same row, same weight as React/Reply/More.
      pickBtn.hidden = !o.pick;
      if (o.pick) {
        pickBtn.classList.toggle('on', !!o.pick.picked);
        pickBtn.setAttribute('aria-pressed', String(!!o.pick.picked));
        pickBtn.title = o.pick.picked ? 'Your pick' : 'Pick this answer';
        pickBtn.setAttribute('aria-label', o.pick.picked ? 'Your pick' : 'Pick this answer');
        pickBtn.disabled = !o.pick.active;
      }
    }

    // beside the bubble: a user bubble holds it (placed on its left); a Sim Sim / Discussion card gets it as a third column
    el.append(box);
    const txt = user ? null : el.querySelector('.txt');
    if (txt) txt.after(chip); else el.append(chip);   // the chip sits right under the bubble
    paint();

    const handle = {
      update(more) {
        Object.assign(o, more);
        if ('current' in more) current = more.current || null;
        paint();
      }
    };
    el._opts = handle;
    return handle;
  }

  window.SimSimReact = { attach, post, EMOJI, copyText };
})();
