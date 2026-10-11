/* =====================================================
   FRIENDS PAGE  (friends.js)
   Standalone Friends list, friend profiles and friend analytics.
   Load AFTER rooms.js in index.html.
   - Friend list + friend requests: real "friendships" / "friendRequests" collections (same ones Study Rooms uses)
   - A new friend request also shows in the notification bell
   - Name / @username / picture: real "publicProfiles" collection (same one Study Rooms uses)
   - Class / board / school + study stats: new "friendStats" collection
     (each student's app publishes ONLY their own numbers there;
      Firestore rules let only their real friends read it)
   ===================================================== */
(function () {
  'use strict';
  if (window.__friendsPage) return;                 // never run twice
  window.__friendsPage = true;

  const page = $('#page-friends');
  if (!page) return;                                // index.html edit missing
  if (typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') {
    fill(page, h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Friends needs the Firestore script line in index.html.' })));
    return;
  }

  TITLES.friends = 'Friends';
  const db = firebase.firestore();
  const ts = () => firebase.firestore.FieldValue.serverTimestamp();
  const NA = 'No data available';

  /* ---------- styles (uses your existing colour variables) ---------- */
  document.head.appendChild(h('style', { id: 'friends-css', text: `
.fr-top{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.fr-count{display:flex;flex-direction:column;min-width:90px}
.fr-count strong{font-size:2rem;line-height:1.1}
.fr-search{flex:1;min-width:200px}
.fr-search input{width:100%;padding:11px 14px;border-radius:12px;background:var(--card);border:1px solid var(--border)}
.fr-note{margin:0 0 14px;padding:10px 14px;border-radius:12px;border:1px solid rgba(245,158,11,.5);background:rgba(245,158,11,.1);color:#FCD34D;font-size:.9rem}
.fr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.fr-list>.empty,.fr-list>.card{grid-column:1/-1}
.fr-card{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:16px;border-radius:18px;background:rgba(17,24,39,.75);border:1px solid var(--border);transition:transform .2s,border-color .2s}
.fr-card:hover{transform:translateY(-2px);border-color:rgba(124,58,237,.45)}
.fr-meta{display:flex;flex-direction:column;gap:1px;min-width:0}
.fr-meta strong,.fr-meta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fr-view{font-size:.8rem;font-weight:600;color:#C4B5FD;white-space:nowrap}
.fr-av{width:48px;height:48px;font-size:1.25rem}
.fr-av.big{width:84px;height:84px;font-size:2.2rem}
.fr-av.has-photo{background-size:cover;background-position:center}
.fr-hero{display:flex;gap:20px;align-items:center;flex-wrap:wrap}
.fr-details{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:18px}
.fr-detail{padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--border);min-width:0}
.fr-detail span{display:block;font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.fr-detail strong{display:block;overflow-wrap:anywhere}
.fr-sec{margin:22px 0 12px;font-size:1.15rem}
.fr-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-bottom:18px}
.fr-stats .card{margin:0}
.fr-stats .stat strong{font-size:1.6rem}
.fr-stats .stat.na strong{font-size:1rem;font-weight:600}
.fr-back{margin-bottom:16px}
.fr-req{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border);flex-wrap:wrap}
.fr-req .card-actions{margin:0 0 0 auto}
.fr-err{color:#FCA5A5}
@media(max-width:640px){.fr-list{grid-template-columns:1fr}.fr-view{display:none}}
` }));

  /* ---------- state ---------- */
  let me = null, unsubs = [], friends = [], incoming = [], outgoing = [], loaded = false, errorMsg = '', statsDenied = false;
  let query = '', openUid = null, profErr = '', listTok = 0, profTok = 0;
  const pub = new Map(), stats = new Map();         // uid -> document data (or null)

  /* ---------- helpers ---------- */
  const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const ini = n => ((n || 'S').trim()[0] || 'S').toUpperCase();
  const btn = (label, fn, cls) => h('button', { type: 'button', class: cls || 'btn', text: label, onclick: fn });
  const num = x => (typeof x === 'number' && isFinite(x) ? x : null);
  function errText(e) {
    const c = e && e.code;
    if (c === 'permission-denied') return 'Not allowed. Publish the new Firestore rules for friendStats first.';
    if (c === 'unavailable') return 'No connection. Check your internet and try again.';
    return 'Something went wrong. Please try again.';
  }
  function fmtMin(m) {
    m = Math.round(m);
    if (m < 60) return m + ' min';
    const hh = Math.floor(m / 60), mm = m % 60;
    return hh + 'h' + (mm ? ' ' + mm + 'm' : '');
  }
  function paint(el, av, initial) {
    if (window.paintProfileAvatar) window.paintProfileAvatar(el, av || { type: 'initial' }, initial);
    else el.textContent = initial;
  }

  /* =====================================================
     PART 1 - publish MY OWN numbers so my friends can see them
     ===================================================== */
  let pubTimer = null, lastPub = '', remote, remoteFor = null;

  /* mission counter: starts from the missions already finished, then goes up by 1 per finished mission */
  function missionBaseline() {
    if (typeof data === 'undefined' || !data) return;
    if (typeof data.missionsDone !== 'number') {
      data.missionsDone = (Array.isArray(data.epDone) ? data.epDone.length : 0) + (Array.isArray(data.epQueue) ? data.epQueue.length : 0);
    }
  }

  function buildStats() {
    if (typeof data === 'undefined' || !data || !Array.isArray(data.focusSessions)) return null;
    missionBaseline();
    const daily = {};
    for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() - i); daily[dkey(d)] = 0; }
    data.focusSessions.forEach(f => { if (f && f.date in daily) daily[f.date] += Number(f.minutes) || 0; });

    const act = new Set();
    (data.tasks || []).forEach(t => t.completedAt && act.add(dkey(new Date(t.completedAt))));
    data.focusSessions.forEach(f => act.add(f.date));
    const n = typeof streak === 'function' ? streak() : 0;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const streakEnd = n > 0 ? (act.has(dkey()) ? dkey() : dkey(y)) : '';

    return {
      totalMin: typeof totalMinutes === 'function' ? totalMinutes() : 0,
      daily, streak: n, streakEnd,
      goalsDone: (data.goals || []).filter(g => g.target > 0 && g.current >= g.target).length,
      missionsDone: num(data.missionsDone),
      ep: num(data.epBase),
      asOf: dkey()
    };
  }

  async function publish() {
    const u = firebase.auth().currentUser, s = buildStats();
    if (!u || !s) return;
    const p = typeof aboutState === 'function' ? aboutState() : {};
    const ref = db.collection('friendStats').doc(u.uid);
    if (remoteFor !== u.uid) {                      // look at what is already shared (once per sign-in)
      const snap = await ref.get();
      remote = snap.exists ? snap.data() : null; remoteFor = u.uid;
    }
    const doc = { uid: u.uid, cls: str(p.class, 30), board: str(p.board, 30), school: str(p.school, 60), updatedAt: ts() };
    /* a fresh/empty device must never wipe stats that were already shared from another device */
    const keepRemote = !!(remote && num(remote.totalMin) !== null && remote.totalMin > s.totalMin);
    if (!keepRemote) Object.assign(doc, s);
    const sig = JSON.stringify([doc.cls, doc.board, doc.school, keepRemote ? null : s]);
    if (sig === lastPub) return;
    await ref.set(doc, { merge: true });
    lastPub = sig;
    if (!keepRemote) remote = Object.assign({}, remote, s);
  }
  function schedulePublish() {
    clearTimeout(pubTimer);
    pubTimer = setTimeout(() => publish().catch(e => console.error('Friend stats sync failed', e)), 4000);
  }
window.resetFriendStats = async function () {
    const u = firebase.auth().currentUser;
    if (!u) return;
    await db.collection('friendStats').doc(u.uid).delete();
    remote = null; remoteFor = null; lastPub = '';
  };

  /* publish whenever the app saves (study session, task, goal, mission, profile ...) */
  if (typeof saveData === 'function') {
    const origSave = saveData;
    saveData = function () { const r = origSave.apply(this, arguments); schedulePublish(); return r; };
  }
  /* count finished missions (existing mission code is not changed) */
  if (typeof completeMission === 'function') {
    const origComplete = completeMission;
    completeMission = function (m) {
      missionBaseline();
      const was = !!(m && (m.done || m.rewarded));
      const r = origComplete.apply(this, arguments);
      if (m && !was && m.done) { data.missionsDone = (Number(data.missionsDone) || 0) + 1; saveData(); }
      return r;
    };
  }

  /* =====================================================
     PART 2 - read friends (real database only)
     ===================================================== */
  async function getPub(uid) {
    if (pub.has(uid)) return pub.get(uid);
    try {
      const s = await db.collection('publicProfiles').doc(uid).get();
      const p = s.exists ? s.data() : null;
      pub.set(uid, p); return p;
    } catch (e) { return null; }
  }
  async function getStats(uid, force) {
    if (!force && stats.has(uid)) return stats.get(uid);
    const s = await db.collection('friendStats').doc(uid).get();
    const d = s.exists ? s.data() : null;
    stats.set(uid, d); return d;
  }
  const markDenied = e => { if (e && e.code === 'permission-denied') statsDenied = true; return null; };

  function start(u) {
    unsubs.forEach(f => f()); unsubs = [];
    friends = []; incoming = []; outgoing = []; pub.clear(); stats.clear(); loaded = false; errorMsg = ''; statsDenied = false;
    remote = undefined; remoteFor = null; lastPub = '';
    me = u || null;
    showList(); drawList(); drawRequests();
    if (!me) return;
    const myUid = me.uid;
    unsubs.push(db.collection('friendships').where('members', 'array-contains', myUid).onSnapshot(async s => {
      friends = s.docs.map(d => ({ id: d.id, other: (d.data().members || []).find(x => x !== myUid) })).filter(f => f.other);
      const tok = ++listTok;
      await Promise.all(friends.map(f => Promise.all([getPub(f.other), getStats(f.other).catch(markDenied)])));
      if (tok !== listTok) return;
      loaded = true; errorMsg = '';
      drawList();
      if (openUid) {
        if (friends.some(f => f.other === openUid)) drawProfile();
        else { toast('This friend was removed'); showList(); }
      }
    }, e => { console.error(e); errorMsg = errText(e); loaded = true; drawList(); }));

    /* friend requests: shown on this page, and a new one also goes to the notification bell */
    unsubs.push(db.collection('friendRequests').where('to', '==', myUid).onSnapshot(async s => {
      incoming = s.docs.map(d => ({ id: d.id, uid: d.data().from }));
      await Promise.all(incoming.map(r => getPub(r.uid)));
      drawRequests();
      incoming.forEach(r => {
        const p = pub.get(r.uid);
        if (typeof pushNotif === 'function') pushNotif('New friend request from ' + (p ? p.displayName + ' (@' + p.username + ')' : 'a student'), 'friendreq-' + r.id);
      });
    }, e => console.error(e)));
    unsubs.push(db.collection('friendRequests').where('from', '==', myUid).onSnapshot(async s => {
      outgoing = s.docs.map(d => ({ id: d.id, uid: d.data().to }));
      await Promise.all(outgoing.map(r => getPub(r.uid)));
      drawRequests();
    }, e => console.error(e)));
    missionBaseline();
    schedulePublish();
  }

  /* =====================================================
     PART 3 - the page
     ===================================================== */
  const countEl = h('div', { class: 'fr-count' });
  const searchIn = h('input', { type: 'search', id: 'fr-search', placeholder: 'Search by name or username', autocomplete: 'off', maxlength: 30, 'aria-label': 'Search friends' });
  searchIn.addEventListener('input', () => { query = searchIn.value; drawList(); });
  const noteEl = h('p', { class: 'fr-note', role: 'status', hidden: true, text: 'Class, board, school and study stats cannot be read yet. Publish the new Firestore rules (friendStats).' });
  const reqBox = h('div', { class: 'card', hidden: true });
  const listBox = h('div', { class: 'fr-list', 'aria-live': 'polite' });
  const listView = h('div', {},
    h('div', { class: 'card fr-top' }, countEl, h('div', { class: 'fr-search' }, searchIn)),
    noteEl, reqBox, listBox);
  const profBox = h('div');
  const profView = h('div', { hidden: true },
    h('button', { type: 'button', class: 'btn fr-back', text: '\u2190 Back to Friends', onclick: () => showList() }), profBox);

  fill(page,
    h('div', { class: 'head' }, h('div', {}, h('h2', { text: 'Friends' }), h('p', { class: 'muted', text: 'See your friends and how they are studying.' }))),
    listView, profView);

  /* ---------- friend requests ---------- */
  const reqFail = e => { console.error(e); toast(e && e.code === 'permission-denied' ? 'Not allowed.' : 'Something went wrong. Please try again.'); };
  function acceptReq(r) {
    const [a, b] = [me.uid, r.uid].sort();
    const batch = db.batch();
    batch.set(db.collection('friendships').doc(a + '_' + b), { members: [a, b], createdAt: ts() });
    batch.delete(db.collection('friendRequests').doc(r.id));
    batch.commit().then(() => toast('Friend added')).catch(reqFail);
  }
  const dropReq = (r, msg) => db.collection('friendRequests').doc(r.id).delete().then(() => toast(msg)).catch(reqFail);
  function reqRow(r, incomingKind) {
    const p = pub.get(r.uid), name = p ? p.displayName : 'Student';
    const av = h('span', { class: 'avatar fr-av' });
    paint(av, p && p.avatar, ini(name));
    return h('div', { class: 'fr-req' }, av,
      h('div', { class: 'grow fr-meta' }, h('strong', { text: name }), h('span', { class: 'muted small', text: p ? '@' + p.username : '' })),
      h('div', { class: 'card-actions' }, incomingKind
        ? [btn('Accept', () => acceptReq(r), 'btn primary'), btn('Decline', () => dropReq(r, 'Request declined'))]
        : [h('span', { class: 'muted small', text: 'Sent' }), btn('Cancel', () => dropReq(r, 'Request cancelled'))]));
  }
  function drawRequests() {
    reqBox.hidden = !me;
    if (!me) return;
    const rows = [...incoming.map(r => reqRow(r, true)), ...outgoing.map(r => reqRow(r, false))];
    fill(reqBox, h('h3', { text: 'Friend Requests' + (incoming.length ? ' (' + incoming.length + ')' : '') }),
      rows.length ? rows : h('p', { class: 'muted small', text: 'No pending requests.' }));
  }

  function showList() {
    openUid = null; profTok++; profErr = '';
    profView.hidden = true; listView.hidden = false;
  }

  function card(r) {
    const name = r.p ? r.p.displayName : 'Student';
    const av = h('span', { class: 'avatar fr-av' });
    paint(av, r.p && r.p.avatar, ini(name));
    const cb = [r.s && r.s.cls, r.s && r.s.board].filter(Boolean).join(' \u2022 ');
    return h('button', { type: 'button', class: 'fr-card', 'aria-label': 'View profile of ' + name, onclick: () => openProfile(r.f.other) },
      av,
      h('span', { class: 'grow fr-meta' },
        h('strong', { text: name }),
        h('span', { class: 'muted small', text: r.p ? '@' + r.p.username : '' }),
        h('span', { class: 'small', text: cb || 'Class and board not added' }),
        h('span', { class: 'muted small', text: (r.s && r.s.school) || 'School not added' })),
      h('span', { class: 'fr-view', text: 'View Profile' }));
  }

  function drawList() {
    noteEl.hidden = !statsDenied;
    fill(countEl, h('strong', { text: String(friends.length) }), h('span', { class: 'muted small', text: 'Total friends' }));
    if (!me) { fill(listBox, empty('Sign in to see your friends', '')); return; }
    if (!loaded) { fill(listBox, h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Loading friends\u2026' }))); return; }
    if (errorMsg) {
      fill(listBox, h('div', { class: 'card' }, h('p', { class: 'fr-err', role: 'alert', text: errorMsg }),
        h('button', { type: 'button', class: 'btn', text: 'Try again', onclick: () => start(me) })));
      return;
    }
    if (!friends.length) {
      fill(listBox, h('div', { class: 'card' }, empty('No friends yet', 'Add friends in Study Rooms with their username or friend code.'),
        h('div', { class: 'card-actions', style: 'justify-content:center' }, h('button', { type: 'button', class: 'btn primary', text: 'Go to Study Rooms', onclick: () => go('rooms') }))));
      return;
    }
    const q = query.trim().toLowerCase().replace(/^@/, '');
    const rows = friends.map(f => ({ f, p: pub.get(f.other), s: stats.get(f.other) }))
      .filter(r => !q || (r.p && ((r.p.displayName || '').toLowerCase().includes(q) || (r.p.username || '').toLowerCase().includes(q))))
      .sort((a, b) => ((a.p && a.p.displayName) || '').localeCompare((b.p && b.p.displayName) || ''));
    fill(listBox, rows.length ? rows.map(card) : empty('No friends found', 'Try a different name or username.'));
  }

  /* ---------- friend profile ---------- */
  async function openProfile(uid) {
    if (!friends.some(f => f.other === uid)) return;          // only real friends
    openUid = uid; profErr = '';
    listView.hidden = true; profView.hidden = false;
    window.scrollTo(0, 0);
    fill(profBox, h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Loading profile\u2026' })));
    const tok = ++profTok;
    await getPub(uid);
    let err = '';
    try { await getStats(uid, true); } catch (e) { console.error(e); err = errText(e); }
    if (tok !== profTok || openUid !== uid) return;
    profErr = err;
    drawProfile();
  }

  function last7(s) {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const v = s && s.daily ? num(s.daily[dkey(d)]) : null;
      out.push({ label: d.toLocaleDateString('default', { weekday: 'short' }), min: v === null ? 0 : v });
    }
    return out;
  }
  function stat(label, value, sub) {
    const c = statCard(label, value === null ? NA : value, value === null ? '' : sub);
    if (value === null) c.classList.add('na');
    return c;
  }

  function drawProfile() {
    const f = friends.find(x => x.other === openUid);
    if (!f) return;
    const p = pub.get(openUid) || null, s = stats.get(openUid) || null;
    const name = p ? p.displayName : 'Student';
    const handle = p ? '@' + p.username : '';
    const av = h('span', { class: 'avatar fr-av big' });
    paint(av, p && p.avatar, ini(name));
    const detail = (k, v) => h('div', { class: 'fr-detail' }, h('span', { text: k }), h('strong', { text: v || 'Not added' }));

    const head = h('div', { class: 'card' },
      h('div', { class: 'fr-hero' }, av, h('div', {}, h('h3', { text: name }), h('p', { class: 'muted', text: handle }))),
      h('div', { class: 'fr-details' },
        detail('Name', name), detail('Username', handle),
        detail('Class', s && s.cls), detail('Board', s && s.board), detail('School', s && s.school)));

    /* analytics: ONLY from this friend's own friendStats document */
    const days = last7(s);
    const todayKey = dkey(), y = new Date(); y.setDate(y.getDate() - 1);
    const hasTotal = s && num(s.totalMin) !== null;
    const weekTotal = days.reduce((a, d) => a + d.min, 0);
    const todayMin = days[6].min;
    let streakVal = null;
    if (s && num(s.streak) !== null) streakVal = (s.streak > 0 && s.streakEnd >= dkey(y)) ? s.streak : 0;
    const upd = s && s.updatedAt && s.updatedAt.toDate ? 'Updated ' + prettyDate(dkey(s.updatedAt.toDate())) : '';

    const cards = h('div', { class: 'fr-stats' },
      stat('Total study time', hasTotal ? fmtMin(s.totalMin) : null, 'all time'),
      stat('Study time today', s ? fmtMin(todayMin) : null, prettyDate(todayKey)),
      stat('Weekly study time', s ? fmtMin(weekTotal) : null, 'last 7 days'),
      stat('Current streak', streakVal === null ? null : streakVal + (streakVal === 1 ? ' day' : ' days'), 'days in a row'),
      stat('Completed missions', s && num(s.missionsDone) !== null ? String(s.missionsDone) : null, 'missions finished'),
      stat('Completed goals', s && num(s.goalsDone) !== null ? String(s.goalsDone) : null, 'goals reached'),
      stat('Total EP', s && num(s.ep) !== null ? s.ep.toLocaleString() : null, 'Effort Points'));

    const chart = h('div', { class: 'card' },
      h('div', { class: 'card-top' }, h('h3', { text: 'Daily study activity' }), h('span', { class: 'muted small', text: 'Last 7 days' })),
      s ? barChart(days.map(d => d.min), days.map(d => d.label)) : empty(NA, 'Nothing to chart yet.'));

    const notes = [];
    if (profErr) notes.push(h('div', { class: 'card' }, h('p', { class: 'fr-err', role: 'alert', text: profErr })));
    else if (!s) notes.push(h('p', { class: 'muted small', text: name + ' has not shared study stats yet. They appear after ' + name + ' opens StudyApp with this update.' }));
    else if (upd) notes.push(h('p', { class: 'muted small', text: upd }));

    const remove = h('div', { class: 'card-actions' },
      h('button', { type: 'button', class: 'btn danger', text: 'Remove friend', onclick: () => confirmBox('Remove friend?', name + ' will be removed from your friends list.', 'Remove', () => {
        db.collection('friendships').doc(f.id).delete()
          .then(() => { toast('Friend removed'); showList(); })
          .catch(e => { console.error(e); toast(errText(e)); });
      }) }));

    fill(profBox, head, h('h3', { class: 'fr-sec', text: 'Analytics' }), cards, chart, notes, remove);
  }

  /* ---------- hooks (same pattern ep.js uses) ---------- */
  (function () {
    const originalGo = go;
    go = function (pageName) {
      originalGo.apply(this, arguments);
      if (pageName === 'friends' && page.classList.contains('active')) {
        showList();
        if (me && friends.length) {                  // refresh friends' numbers each time the page opens
          Promise.all(friends.map(f => getStats(f.other, true).catch(markDenied))).then(() => { if (!openUid) drawList(); });
        }
        drawList();
      }
    };
  })();

  firebase.auth().onAuthStateChanged(u => start(u));
})();