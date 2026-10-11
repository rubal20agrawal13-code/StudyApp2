/* =====================================================
   ADMIN: USER MANAGEMENT  (admin.js)  - load AFTER presence.js
   Owner-only. The real protection is on the Worker (it checks your
   Firebase UID against OWNER_UID). This file only DRAWS what the Worker
   returns: for anyone else the Worker answers 403, so this page never
   gets data and the menu item is never even created.
   ===================================================== */
(function () {
  'use strict';
  if (window.__adminPage) return;
  window.__adminPage = true;

  const page = $('#page-admin');
  const nav = $('#nav');
  if (!page || !nav || typeof EP_API === 'undefined' || typeof firebase === 'undefined') return;

  const POLL_MS = 15000;
  TITLES.admin = 'User Management';

  document.head.appendChild(h('style', { id: 'admin-css', text: `
.ad-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px;margin-bottom:18px}
.ad-stats .card{margin:0}
.ad-tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.ad-tools input,.ad-tools select{padding:11px 14px;border-radius:12px;background:var(--card);border:1px solid var(--border)}
.ad-tools input{flex:1;min-width:200px}
.ad-note{margin:0 0 14px;font-size:.85rem}
.ad-list{display:flex;flex-direction:column;gap:10px}
.ad-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:16px;background:rgba(17,24,39,.75);border:1px solid var(--border)}
.ad-dot{flex:none;width:12px;height:12px;border-radius:50%;background:#6B7280}
.ad-dot.on{background:#22C55E;box-shadow:0 0 0 4px rgba(34,197,94,.18),0 0 10px rgba(34,197,94,.7)}
.ad-meta{display:flex;flex-direction:column;gap:1px;min-width:0}
.ad-meta strong,.ad-meta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-right{margin-left:auto;text-align:right;display:flex;flex-direction:column;gap:1px;flex:none}
.ad-on{color:#4ADE80;font-weight:600}
.ad-off{color:#9CA3AF;font-weight:600}
.ad-err{color:#FCA5A5}
@media(max-width:640px){.ad-row{flex-wrap:wrap}.ad-right{margin-left:26px;text-align:left}}
` }));

  /* ---------- state ---------- */
  let isOwner = false, navBtn = null, snap = null, err = '', loading = false, query = '', filter = 'all';
  let timer = null, inflight = false, seq = 0, updatedAt = null;

  /* ---------- page skeleton (built once) ---------- */
  const statsBox = h('div', { class: 'ad-stats', 'aria-live': 'polite' });
  const search = h('input', { type: 'search', placeholder: 'Search by name or username', autocomplete: 'off', maxlength: 30, 'aria-label': 'Search users' });
  const sel = h('select', { 'aria-label': 'Filter by status' },
    h('option', { value: 'all', text: 'All users' }), h('option', { value: 'online', text: 'Online' }), h('option', { value: 'offline', text: 'Offline' }));
  search.addEventListener('input', () => { query = search.value; drawList(); });
  sel.addEventListener('change', () => { filter = sel.value; drawList(); });
  const noteEl = h('p', { class: 'muted ad-note' });
  const listBox = h('div', { class: 'ad-list', 'aria-live': 'polite' });
  const retryBtn = h('button', { type: 'button', class: 'btn', text: 'Refresh now', onclick: () => load(true) });

  fill(page,
    h('div', { class: 'head' }, h('div', {}, h('h2', { text: 'User Management' }),
      h('p', { class: 'muted', text: 'Private. Only you can see this page.' }))),
    statsBox,
    h('div', { class: 'ad-tools' }, search, sel, retryBtn),
    noteEl, listBox);

  /* ---------- helpers ---------- */
  function ago(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return 'less than a minute ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const hr = Math.floor(m / 60);
    if (hr < 24) return hr + ' h ago';
    const d = Math.floor(hr / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  async function api(path) {
    const u = firebase.auth().currentUser;
    if (!u) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
    const idToken = await u.getIdToken();
    const r = await fetch(EP_API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }), cache: 'no-store'
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw Object.assign(new Error((j && j.error) || 'Request failed.'), { status: r.status });
    return j;
  }

  /* ---------- drawing ---------- */
  function drawStats() {
    if (!snap) {
      fill(statsBox, statCard('Total Registered Users', '\u2014', ''), statCard('Online Now', '\u2014', ''), statCard('Offline', '\u2014', ''));
      return;
    }
    fill(statsBox,
      statCard('Total Registered Users', String(snap.total), 'unique accounts'),
      statCard('Online Now', String(snap.online), 'heartbeat in the last ' + Math.round(snap.timeoutMs / 1000) + ' s'),
      statCard('Offline', String(snap.offline), 'no live heartbeat'));
  }

  function drawList() {
    if (loading && !snap) { fill(listBox, h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Loading users\u2026' }))); return; }
    if (err && !snap) {
      fill(listBox, h('div', { class: 'card' }, h('p', { class: 'ad-err', role: 'alert', text: err }),
        h('button', { type: 'button', class: 'btn', text: 'Try again', onclick: () => load(true) })));
      return;
    }
    if (!snap) return;
    noteEl.textContent = (err ? 'Could not refresh: ' + err + ' Showing the last data. ' : '') +
      'Online = live heartbeat in the last ' + Math.round(snap.timeoutMs / 1000) + ' s. "Last seen" is approximate.' +
      (updatedAt ? ' Updated ' + updatedAt.toLocaleTimeString() + '.' : '') +
      (snap.truncated ? ' Showing the first ' + snap.users.length + ' users.' : '');
    if (!snap.users.length) {
      fill(listBox, empty('No registered users yet', 'Users appear here after they open the site with this update.'));
      return;
    }
    const q = query.trim().toLowerCase().replace(/^@/, '');
    const rows = snap.users.filter(u =>
      (filter === 'all' || (filter === 'online') === u.online) &&
      (!q || (u.name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)));
    if (!rows.length) { fill(listBox, empty('No users found', 'Try a different search or filter.')); return; }
    fill(listBox, rows.map(u => {
      const cb = [u.cls, u.board].filter(Boolean).join(' \u2022 ');
      const last = u.online ? 'Online now' : (u.lastSeen > 0 ? 'Last seen ~' + ago(snap.serverTime - u.lastSeen) : 'Last seen unknown');
      return h('div', { class: 'ad-row' },
        h('span', { class: 'ad-dot' + (u.online ? ' on' : ''), role: 'img', 'aria-label': u.online ? 'Online' : 'Offline' }),
        h('div', { class: 'ad-meta' },
          h('strong', { text: u.name || 'Student' }),
          h('span', { class: 'muted small', text: u.username ? '@' + u.username : 'No username yet' }),
          h('span', { class: 'small', text: cb || 'Class and board not added' })),
        h('div', { class: 'ad-right' },
          h('span', { class: u.online ? 'ad-on' : 'ad-off', text: u.online ? 'Online' : 'Offline' }),
          h('span', { class: 'muted small', text: last })));
    }));
  }

  /* ---------- loading + automatic refresh ---------- */
  async function load(showSpinner) {
    if (!isOwner || inflight) return;
    inflight = true;
    const my = ++seq;
    if (showSpinner && !snap) { loading = true; drawList(); }
    try {
      const j = await api('/admin/users');
      if (my !== seq || !isOwner) return;
      snap = j; err = ''; updatedAt = new Date();
    } catch (e) {
      if (my !== seq) return;
      if (e.status === 403) { becomeNotOwner(); return; }
      console.error(e);
      err = e.status === 401 ? 'Please sign in again.' : 'Could not load users. Check your connection and try again.';
    } finally {
      inflight = false; loading = false;
    }
    drawStats(); drawList();
  }
  function startPolling() {
    stopPolling();
    load(true);
    timer = setInterval(() => { if (!document.hidden) load(false); }, POLL_MS);
  }
  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) load(false); });

  /* ---------- owner check + menu item ---------- */
  function showOwner() {
    if (isOwner) return;
    isOwner = true;
    navBtn = h('button', { type: 'button', 'data-page': 'admin' },
      h('span', { class: 'ic', text: '\uD83D\uDEE1\uFE0F' }), h('span', { class: 'lb', text: 'Admin' }));
    navBtn.addEventListener('click', () => go('admin'));
    nav.appendChild(navBtn);
    drawStats(); drawList();
    if (typeof moveBubble === 'function') moveBubble();
  }
  function becomeNotOwner() {
    isOwner = false; seq++; stopPolling();
    snap = null; err = ''; updatedAt = null; query = ''; filter = 'all'; search.value = ''; sel.value = 'all';
    if (navBtn) { navBtn.remove(); navBtn = null; }
    drawStats(); noteEl.textContent = ''; fill(listBox);
    if (page.classList.contains('active')) go('overview');
  }

  async function check() {
    try {
      const j = await api('/admin/check');
      if (j && j.owner === true) showOwner(); else becomeNotOwner();
    } catch (e) { becomeNotOwner(); }
  }

  /* start / stop polling when the admin page is opened / left */
  (function () {
    const originalGo = go;
    go = function (pageName) {
      originalGo.apply(this, arguments);
      if (pageName === 'admin' && page.classList.contains('active') && isOwner) startPolling();
      else stopPolling();
    };
  })();

  firebase.auth().onAuthStateChanged(u => { if (u) check(); else becomeNotOwner(); });
})();