/* =====================================================
   STUDY ROOMS - Stage 1: friends | Stage 2: create/join | Stage 3: room page (voice, chat, focus, subjects)
   File: rooms.js  (load AFTER auth.js and profile.js)
   ===================================================== */
(function () {
  'use strict';
  if (window.__studyRooms) return;
  window.__studyRooms = true;

  const page = $('#page-rooms');
  if (!page) return;                              // index.html edit missing
  if (typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') {
    fill(page, h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Study Rooms needs the Firestore script line in index.html.' })));
    return;
  }

  TITLES.rooms = 'Study Rooms';
 const db = firebase.firestore();
  const ts = () => firebase.firestore.FieldValue.serverTimestamp();
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let me = null, myProfile = null, view = 'loading', errorText = '', unsubs = [], pushTimer = null, renderToken = 0;
  const cache = new Map();                        // uid -> public profile
  const st = { friends: [], incoming: [], outgoing: [], rooms: [] };
  const MAX_MEMBERS = 20;
  let openId = null, openSeen = false;            // room currently opened (its code)

  /* ---------- helpers ---------- */
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ini = n => ((n || 'S').trim()[0] || 'S').toUpperCase();
  function errText(e) {
    const c = e && e.code;
    if (c === 'permission-denied') return 'Not allowed. Make sure the Firestore rules from the guide are published.';
    if (c === 'unavailable') return 'No connection. Check your internet and try again.';
    if (c === 'failed-precondition') return 'Firestore is not set up yet. Create the database in Firebase first.';
    return (e && !c && e.message) ? e.message : 'Something went wrong. Please try again.';
  }
  function makeCode() {
    const a = new Uint32Array(8); crypto.getRandomValues(a);
    return Array.from(a, n => CODE_CHARS[n % CODE_CHARS.length]).join('');
  }
  function myAvatar() {
    const a = typeof aboutState === 'function' ? aboutState().avatar : null;
    return a && (a.type === 'emoji' || a.type === 'photo' || a.type === 'initial') ? a : { type: 'initial' };
  }
  const myName = () => ((data && typeof data.studentName === 'string' && data.studentName.trim()) || 'Student').slice(0, 40);
  function paint(el, av, initial) {
    if (window.paintProfileAvatar) window.paintProfileAvatar(el, av || { type: 'initial' }, initial);
    else el.textContent = initial;
  }
  async function getProfile(uid) {
    if (cache.has(uid)) return cache.get(uid);
    try {
      const s = await db.collection('publicProfiles').doc(uid).get();
      const p = s.exists ? s.data() : null;
      cache.set(uid, p); return p;
    } catch (e) { return null; }
  }
  const btn = (label, fn, cls) => h('button', { type: 'button', class: cls || 'btn rm-sm', text: label, onclick: fn });
  async function act(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { console.error(e); toast(errText(e)); }
  }

  /* ---------- keep my public name + picture up to date ---------- */
  async function pushProfile() {
    if (!me || !myProfile) return;
    const d = myName(), a = myAvatar();
    if (d === myProfile.displayName && same(a, myProfile.avatar)) return;
    await db.collection('publicProfiles').doc(me.uid).update({ displayName: d, avatar: a, updatedAt: ts() });
    myProfile.displayName = d; myProfile.avatar = a; cache.set(me.uid, myProfile);
    draw();
  }
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushProfile().catch(e => console.error('Profile sync failed', e)), 1500);
  }
  const prevSync = window.profileSync;
  window.profileSync = function () { if (prevSync) prevSync.apply(this, arguments); schedulePush(); };

  /* ---------- claim a username + friend code (once) ---------- */
  async function claimUsername(raw) {
    const name = raw.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(name)) throw new Error('Use 3-20 letters, numbers or underscores.');
    for (let i = 0; i < 5; i++) {
      const code = makeCode();
      try {
        await db.runTransaction(async tx => {
          const uRef = db.collection('usernames').doc(name);
          const cRef = db.collection('friendCodes').doc(code);
          const pRef = db.collection('publicProfiles').doc(me.uid);
          const [u, c, p] = await Promise.all([tx.get(uRef), tx.get(cRef), tx.get(pRef)]);
          if (p.exists) throw new Error('You already have a Study ID.');
          if (u.exists) throw new Error('That username is taken. Try another.');
          if (c.exists) throw Object.assign(new Error('retry'), { retry: true });
          tx.set(uRef, { uid: me.uid });
          tx.set(cRef, { uid: me.uid });
          tx.set(pRef, { uid: me.uid, username: name, friendCode: code, displayName: myName(), avatar: myAvatar(), updatedAt: ts() });
        });
        return;
      } catch (e) { if (!e.retry) throw e; }
    }
    throw new Error('Could not create a friend code. Please try again.');
  }

  /* ---------- live friend data ---------- */
  function stop() { unsubs.forEach(f => f()); unsubs = []; st.friends = []; st.incoming = []; st.outgoing = []; st.rooms = []; }
  function listen() {
    stop();
    const bad = e => { console.error(e); view = 'error'; errorText = errText(e); draw(); };
    unsubs.push(db.collection('friendships').where('members', 'array-contains', me.uid).onSnapshot(s => {
      st.friends = s.docs.map(d => ({ id: d.id, other: d.data().members.find(x => x !== me.uid) })); refresh();
    }, bad));
    unsubs.push(db.collection('friendRequests').where('to', '==', me.uid).onSnapshot(s => {
      st.incoming = s.docs.map(d => ({ id: d.id, uid: d.data().from })); refresh();
    }, bad));
    unsubs.push(db.collection('friendRequests').where('from', '==', me.uid).onSnapshot(s => {
      st.outgoing = s.docs.map(d => ({ id: d.id, uid: d.data().to })); refresh();
    }, bad));
    unsubs.push(db.collection('rooms').where('members', 'array-contains', me.uid).onSnapshot(s => {
      st.rooms = s.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
      refresh();
    }, bad));
  }
  async function refresh() {
    const tok = ++renderToken;
    const ids = [...new Set([...st.friends.map(x => x.other), ...st.incoming.map(x => x.uid), ...st.outgoing.map(x => x.uid),
      ...st.rooms.flatMap(r => r.members || [])])];
    await Promise.all(ids.map(getProfile));
    if (tok === renderToken) draw();
  }

  /* ---------- friend actions ---------- */
  async function lookup(col, key) { const s = await db.collection(col).doc(key).get(); return s.exists ? s.data().uid : null; }
  async function findStudent(q) {
    q = q.replace(/^@/, '').trim();
    let uid = null;
    if (/^[A-Za-z2-9]{8}$/.test(q)) uid = await lookup('friendCodes', q.toUpperCase());
    if (!uid && /^[A-Za-z0-9_]{3,20}$/.test(q)) uid = await lookup('usernames', q.toLowerCase());
    if (!uid) return null;
    const profile = await getProfile(uid);
    return profile ? { uid, profile } : null;
  }
  const accept = r => act(async () => {
    const [a, b] = [me.uid, r.uid].sort();
    const batch = db.batch();
    batch.set(db.collection('friendships').doc(a + '_' + b), { members: [a, b], createdAt: ts() });
    batch.delete(db.collection('friendRequests').doc(r.id));
    await batch.commit();
  }, 'Friend added');
  const dropRequest = (r, msg) => act(() => db.collection('friendRequests').doc(r.id).delete(), msg);
  const removeFriend = f => {
    const p = cache.get(f.other);
    confirmBox('Remove friend?', (p ? p.displayName : 'This student') + ' will be removed from your friends list.', 'Remove',
      () => act(() => db.collection('friendships').doc(f.id).delete(), 'Friend removed'));
  };

  /* ---------- page layout (built once) ---------- */
  const topBox = h('div');
  const addInput = h('input', { type: 'text', id: 'rm-find', placeholder: 'Username or friend code', autocomplete: 'off', maxlength: 30 });
  const addMsg = h('p', { class: 'rm-note', role: 'status' });
  const addBtn = h('button', { type: 'button', class: 'btn primary', text: 'Send request', onclick: onAdd });
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } });
  const say = (t, k) => { addMsg.textContent = t; addMsg.dataset.kind = k || ''; };
  const addCard = h('section', { class: 'card rm-card', hidden: true },
    h('h3', { text: 'Add Friends' }),
    h('p', { class: 'muted small', text: 'Ask your friend for their username or 8-letter friend code.' }),
    h('div', { class: 'rm-find' }, addInput, addBtn), addMsg);
  const reqBox = h('section', { class: 'card rm-card', hidden: true });
  const friendsBox = h('section', { class: 'card rm-card', hidden: true });
  /* ---------- rooms: build the card once so typing is never lost ---------- */
  const roomsBox = h('section', { class: 'card rm-card', hidden: true });
  const rmName = h('input', { type: 'text', placeholder: 'Room name, e.g. Physics revision', maxlength: 40, autocomplete: 'off' });
  const rmCode = h('input', { type: 'text', placeholder: '8-letter room code', maxlength: 12, autocomplete: 'off' });
  const rmMsg = h('p', { class: 'rm-note', role: 'status' });
  const sayRoom = (t, k) => { rmMsg.textContent = t; rmMsg.dataset.kind = k || ''; };
  const createBtn = h('button', { type: 'button', class: 'btn primary', text: 'Create', onclick: onCreateRoom });
  const joinBtn = h('button', { type: 'button', class: 'btn primary', text: 'Join', onclick: onJoinRoom });
  const createForm = h('div', { class: 'rm-find', hidden: true }, rmName, createBtn);
  const joinForm = h('div', { class: 'rm-find', hidden: true }, rmCode, joinBtn);
  rmName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onCreateRoom(); } });
  rmCode.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onJoinRoom(); } });
  const roomList = h('div');
  const roomHome = h('div', {},
    h('h3', { text: 'My Study Rooms' }),
    h('p', { class: 'muted small', text: 'Create a room and share its code, or join a friend\u2019s room with their code. Inside a room you get a shared focus timer, group chat, shared subjects and voice chat.' }),
    h('div', { class: 'rm-soon' },
      btn('Create a Room', () => showForm('create'), 'btn'),
      btn('Join a Room', () => showForm('join'), 'btn')),
    createForm, joinForm, rmMsg, roomList);
  const roomDetail = h('div', { hidden: true });
  fill(roomsBox, roomHome, roomDetail);

  function showForm(which) {
    const wasOpen = which === 'create' ? !createForm.hidden : !joinForm.hidden;
    createForm.hidden = joinForm.hidden = true; sayRoom('');
    if (wasOpen) return;
    const f = which === 'create' ? createForm : joinForm;
    f.hidden = false;
    (which === 'create' ? rmName : rmCode).focus();
  }

  /* ---------- room actions ---------- */
  async function createRoom(name) {
    for (let i = 0; i < 5; i++) {
      const code = makeCode(), ref = db.collection('rooms').doc(code);
      try {
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (snap.exists) throw Object.assign(new Error('retry'), { retry: true });
          tx.set(ref, { name, code, ownerUid: me.uid, members: [me.uid], createdAt: ts() });
        });
        return code;
      } catch (e) { if (!e.retry) throw e; }
    }
    throw new Error('Could not create a room code. Please try again.');
  }
  async function onCreateRoom() {
    const name = rmName.value.trim().replace(/\s+/g, ' ');
    if (!name) { sayRoom('Give your room a name.', 'err'); return; }
    createBtn.disabled = true; sayRoom('Creating\u2026', 'info');
    try {
      const code = await createRoom(name);
      rmName.value = ''; createForm.hidden = true; sayRoom('');
      toast('Room created'); openRoom(code);
    } catch (e) { console.error(e); sayRoom(errText(e), 'err'); }
    finally { createBtn.disabled = false; }
  }
  async function onJoinRoom() {
    const code = rmCode.value.replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) { sayRoom('A room code is 8 letters and numbers.', 'err'); return; }
    joinBtn.disabled = true; sayRoom('Looking for the room\u2026', 'info');
    try {
      const ref = db.collection('rooms').doc(code), snap = await ref.get();
      if (!snap.exists) { sayRoom('No room found with that code.', 'err'); return; }
      const r = snap.data();
      if (r.members.includes(me.uid)) { rmCode.value = ''; joinForm.hidden = true; sayRoom(''); openRoom(code); return; }
      if (r.members.length >= MAX_MEMBERS) { sayRoom('That room is full.', 'err'); return; }
      await ref.update({ members: firebase.firestore.FieldValue.arrayUnion(me.uid) });
      rmCode.value = ''; joinForm.hidden = true; sayRoom('');
      toast('Joined ' + r.name); openRoom(code);
    } catch (e) { console.error(e); sayRoom(errText(e), 'err'); }
    finally { joinBtn.disabled = false; }
  }
  const leaveRoom = r => confirmBox('Leave room?', 'You will leave \u201c' + r.name + '\u201d. You can rejoin later with the room code.', 'Leave',
    () => act(async () => {
      openId = null; drawRooms();
      await db.collection('rooms').doc(r.id).update({ members: firebase.firestore.FieldValue.arrayRemove(me.uid) });
    }, 'You left the room'));
  const deleteRoom = r => confirmBox('Delete room?', '\u201c' + r.name + '\u201d will be deleted for everyone in it.', 'Delete',
    () => act(async () => { openId = null; drawRooms(); await db.collection('rooms').doc(r.id).delete(); }, 'Room deleted'));
  const kickMember = (r, uid) => {
    const p = cache.get(uid);
    confirmBox('Remove member?', (p ? p.displayName : 'This student') + ' will be removed from the room.', 'Remove',
      () => act(() => db.collection('rooms').doc(r.id).update({ members: firebase.firestore.FieldValue.arrayRemove(uid) }), 'Member removed'));
  };
  const copyText = (t, okMsg) => {
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast(okMsg), () => toast('Could not copy'));
    else toast('Copy not supported here');
  };

  fill(page, h('div', { class: 'rm-head' }, h('h2', { text: 'Study Rooms' }),
    h('p', { class: 'muted', text: 'Study together with friends.' })), topBox, roomsBox, addCard, reqBox, friendsBox);

  async function onAdd() {
    const q = addInput.value.trim();
    if (!q) { say('Type a username or friend code.', 'err'); return; }
    addBtn.disabled = true; say('Searching…', 'info');
    try {
      const found = await findStudent(q);
      if (!found) { say('No student found. Check the spelling.', 'err'); return; }
      if (found.uid === me.uid) { say('That is your own ID.', 'err'); return; }
      if (st.friends.some(f => f.other === found.uid)) { say('You are already friends.', 'err'); return; }
      if (st.outgoing.some(r => r.uid === found.uid)) { say('Request already sent.', 'err'); return; }
      if (st.incoming.some(r => r.uid === found.uid)) { say(found.profile.displayName + ' already sent you a request. Accept it below.', 'info'); return; }
      await db.collection('friendRequests').doc(me.uid + '_' + found.uid)
        .set({ from: me.uid, to: found.uid, status: 'pending', createdAt: ts() });
      addInput.value = ''; say('Request sent to ' + found.profile.displayName + '.', 'ok');
    } catch (e) { console.error(e); say(errText(e), 'err'); }
    finally { addBtn.disabled = false; }
  }

  /* ---------- drawing ---------- */
  function person(uid, actions) {
    const p = cache.get(uid), name = p ? p.displayName : 'Unknown student';
    const av = h('span', { class: 'avatar rm-av' });
    paint(av, p && p.avatar, ini(name));
    return h('div', { class: 'rm-row' }, av,
      h('div', { class: 'grow' }, h('strong', { text: name }), h('div', { class: 'muted small', text: p ? '@' + p.username : '' })),
      h('div', { class: 'rm-acts' }, actions));
  }
  function setupCard() {
    const inp = h('input', { type: 'text', placeholder: 'e.g. rahul_study', maxlength: 20, autocomplete: 'off' });
    const msg = h('p', { class: 'rm-note', role: 'status' });
    const go1 = h('button', { type: 'button', class: 'btn primary', text: 'Create my Study ID' });
    const submit = async () => {
      go1.disabled = true; msg.textContent = 'Creating…'; msg.dataset.kind = 'info';
      try { await claimUsername(inp.value); await start(me); }
      catch (e) { console.error(e); msg.textContent = errText(e); msg.dataset.kind = 'err'; go1.disabled = false; }
    };
    go1.addEventListener('click', submit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return h('section', { class: 'card rm-card' }, h('h3', { text: 'Choose your Study ID' }),
      h('p', { class: 'muted small', text: 'Friends find you with this username. It cannot be changed later. Your email is never shown.' }),
      h('div', { class: 'rm-find' }, inp, go1), msg);
  }
  function idCard() {
    const av = h('span', { class: 'avatar rm-av rm-av-lg' });
    paint(av, myProfile.avatar, ini(myProfile.displayName));
    return h('section', { class: 'card rm-card rm-id' }, av,
      h('div', { class: 'grow' }, h('strong', { text: myProfile.displayName }),
        h('div', { class: 'muted small', text: '@' + myProfile.username }),
        h('div', { class: 'rm-code' }, h('span', { class: 'muted small', text: 'Friend code' }), h('b', { text: myProfile.friendCode }))),
      btn('Copy code', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(myProfile.friendCode).then(() => toast('Friend code copied'), () => toast('Could not copy'));
        else toast('Copy not supported here');
      }));
  }
  function roomRow(r) {
    const isOwner = r.ownerUid === me.uid;
    return h('div', { class: 'rm-row' },
      h('div', { class: 'grow' },
        h('strong', { text: r.name }),
        h('div', { class: 'muted small', text: r.members.length + (r.members.length === 1 ? ' member' : ' members') + (isOwner ? ' \u00b7 You are the owner' : '') })),
      h('div', { class: 'rm-acts' }, btn('Open', () => openRoom(r.id), 'btn primary rm-sm')));
  }
  /* =====================================================
     ROOM PAGE  (Stage 3: focus timer, chat, subjects, voice)
     ===================================================== */
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
  let space = null;
  function closeSpace() { if (space) { space.destroy(); space = null; } }
  const fmtClock = sec => pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  function beep() {
    try {
      const A = window.AudioContext || window.webkitAudioContext, c = new A(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.15;
      o.start(); setTimeout(() => { o.stop(); c.close(); }, 700);
    } catch (e) { /* no sound */ }
  }

  function makeSpace(r0) {
    let room = r0, tab = 'focus', msgs = [], destroyed = false;
    const code = r0.id;
    const col = n => db.collection('rooms').doc(code).collection(n);
    const subs = [], timers = [];
    const nameOf = uid => uid === me.uid ? 'You' : ((cache.get(uid) || {}).displayName || 'Student');

    /* ----- header ----- */
    const title = h('h3', { class: 'rm-rtitle' });
    const sub = h('div', { class: 'muted small' });
    const header = h('div', { class: 'rm-rhead' },
      btn('\u2190 Back', () => { openId = null; drawRooms(); }, 'btn rm-sm'),
      h('div', { class: 'grow' }, title, sub),
      h('div', { class: 'rm-code' }, h('b', { text: code }), btn('Copy code', () => copyText(code, 'Room code copied'))));

    /* ----- tabs ----- */
    const tabDefs = [['focus', '\u23F1 Focus'], ['chat', '\uD83D\uDCAC Chat'], ['subjects', '\uD83D\uDCDA Subjects'], ['members', '\uD83D\uDC65 Members']];
    const panels = {};
    tabDefs.forEach(([k]) => { panels[k] = h('div', { class: 'rm-panel', hidden: k !== tab }); });
    const tabBar = h('div', { class: 'rm-tabs' });
    function drawTabs() {
      fill(tabBar, tabDefs.map(([k, label]) => h('button', { type: 'button', class: 'rm-tab' + (k === tab ? ' on' : ''), text: label,
        onclick: () => { tab = k; drawTabs(); if (k === 'chat') chatList.scrollTop = chatList.scrollHeight; } })));
      Object.keys(panels).forEach(k => { panels[k].hidden = k !== tab; });
    }

    /* =================== FOCUS (shared timer) =================== */
    const fs = { status: 'idle', mode: 'focus', durationSec: 1500, endsAt: 0, remainingSec: 1500, subject: '', byUid: '', byName: '' };
    let sel = 'focus:25', doneFor = 0;
    const focusRef = col('focus').doc('current');
    const clock = h('div', { class: 'rm-clock', text: '25:00' });
    const fMeta = h('p', { class: 'muted small rm-fmeta' });
    const preset = h('select', { class: 'rm-select' },
      [['focus:25', 'Focus \u00b7 25 min'], ['focus:45', 'Focus \u00b7 45 min'], ['focus:60', 'Focus \u00b7 60 min'], ['break:5', 'Short break \u00b7 5 min'], ['break:15', 'Long break \u00b7 15 min']]
        .map(([v, l]) => h('option', { value: v, text: l })));
    preset.addEventListener('change', () => { sel = preset.value; renderFocus(); });
    const fSubject = h('input', { type: 'text', list: 'rm-subj-' + code, placeholder: 'Subject (optional)', maxlength: 40, autocomplete: 'off' });
    const subjList = h('datalist', { id: 'rm-subj-' + code });
    const fActs = h('div', { class: 'rm-acts rm-factions' });
    const remaining = () => fs.status === 'running' ? Math.max(0, Math.round((fs.endsAt - Date.now()) / 1000)) : fs.remainingSec;
    const pushFocus = patch => act(() => focusRef.set(Object.assign({}, fs, patch, { byUid: me.uid, byName: myName(), updatedAt: ts() })));
    const startFocus = () => {
      const [mode, min] = sel.split(':'), dur = Number(min) * 60;
      pushFocus({ status: 'running', mode, durationSec: dur, remainingSec: dur, endsAt: Date.now() + dur * 1000, subject: mode === 'focus' ? fSubject.value.trim().slice(0, 40) : '' });
    };
    const pauseFocus = () => pushFocus({ status: 'paused', remainingSec: remaining() });
    const resumeFocus = () => pushFocus({ status: 'running', endsAt: Date.now() + fs.remainingSec * 1000 });
    const resetFocus = () => pushFocus({ status: 'idle', remainingSec: fs.durationSec, endsAt: 0 });
    function tickFocus() {
      const idle = fs.status === 'idle';
      const rem = idle ? Number(sel.split(':')[1]) * 60 : remaining();
      clock.textContent = fmtClock(rem);
      if (fs.status === 'running' && rem <= 0 && doneFor !== fs.endsAt) {
        doneFor = fs.endsAt; toast(fs.mode === 'break' ? 'Break is over!' : 'Focus session complete!'); beep(); renderFocus();
      }
    }
    function renderFocus() {
      const idle = fs.status === 'idle', finished = fs.status === 'running' && remaining() <= 0;
      clock.dataset.mode = idle ? 'idle' : fs.mode;
      const who = fs.byUid === me.uid ? 'you' : (fs.byName || 'a friend');
      fMeta.textContent = idle ? 'Pick a time and press Start. Everyone in the room sees the same timer.'
        : (fs.mode === 'break' ? 'Break' : 'Focus') + (fs.subject ? ' \u00b7 ' + fs.subject : '') + ' \u00b7 started by ' + who +
          (fs.status === 'paused' ? ' \u00b7 paused' : finished ? ' \u00b7 finished' : '');
      preset.disabled = fSubject.disabled = !idle;
      fill(fActs, idle ? btn('\u25B6 Start', startFocus, 'btn primary') : [
        finished ? null : fs.status === 'running' ? btn('\u23F8 Pause', pauseFocus, 'btn') : btn('\u25B6 Resume', resumeFocus, 'btn primary'),
        btn(finished ? 'New session' : 'Reset', resetFocus, 'btn')]);
      tickFocus();
    }
    subs.push(focusRef.onSnapshot(s => {
      if (s.exists) Object.assign(fs, s.data());
      else Object.assign(fs, { status: 'idle', endsAt: 0 });
      renderFocus();
    }, e => console.error(e)));
    fill(panels.focus, h('div', { class: 'rm-focus' }, clock, fMeta,
      h('div', { class: 'rm-find rm-fsetup' }, preset, fSubject), fActs, subjList));

    /* =================== CHAT =================== */
    const chatList = h('div', { class: 'rm-chat' });
    const chatInput = h('input', { type: 'text', placeholder: 'Message the room\u2026', maxlength: 500, autocomplete: 'off' });
    function sendChat() {
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      col('messages').add({ from: me.uid, text, createdAt: ts() })
        .catch(e => { console.error(e); toast(errText(e)); if (!chatInput.value) chatInput.value = text; });
    }
    chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
    function renderChat() {
      const stick = chatList.scrollTop + chatList.clientHeight >= chatList.scrollHeight - 40;
      fill(chatList, msgs.length ? msgs.map(m => {
        const mine = m.from === me.uid, d = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : new Date();
        return h('div', { class: 'rm-msg' + (mine ? ' me' : '') },
          h('div', { class: 'rm-mhead' }, h('strong', { text: nameOf(m.from) }), h('span', { class: 'muted small', text: pad(d.getHours()) + ':' + pad(d.getMinutes()) })),
          h('div', { class: 'rm-mtext', text: m.text }));
      }) : h('p', { class: 'muted small', text: 'No messages yet. Say hi \uD83D\uDC4B' }));
      if (stick) chatList.scrollTop = chatList.scrollHeight;
    }
    subs.push(col('messages').orderBy('createdAt', 'desc').limit(100).onSnapshot(s => {
      msgs = s.docs.map(d => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' }))).reverse();
      renderChat();
      const unknown = [...new Set(msgs.map(m => m.from))].filter(u => !cache.has(u));
      if (unknown.length) Promise.all(unknown.map(getProfile)).then(() => { if (!destroyed) renderChat(); });
    }, e => console.error(e)));
    fill(panels.chat, chatList, h('div', { class: 'rm-find rm-chatbar' }, chatInput, btn('Send', sendChat, 'btn primary')));

    /* =================== SUBJECTS (shared list) =================== */
    const iSubject = h('input', { type: 'text', list: 'rm-subj-' + code, placeholder: 'Subject, e.g. Physics', maxlength: 40, autocomplete: 'off' });
    const iText = h('input', { type: 'text', placeholder: 'Task or topic, e.g. Chapter 3 numericals', maxlength: 120, autocomplete: 'off' });
    const itemList = h('div');
    function addItem() {
      const text = iText.value.trim(), subject = iSubject.value.trim() || 'General';
      if (!text) { toast('Type a task first'); return; }
      iText.value = ''; iText.focus();
      act(() => col('items').add({ text, subject, done: false, by: me.uid, createdAt: ts() }));
    }
    iText.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
    function renderItems(items) {
      const groups = new Map();
      items.forEach(it => { if (!groups.has(it.subject)) groups.set(it.subject, []); groups.get(it.subject).push(it); });
      fill(subjList, [...groups.keys()].map(k => h('option', { value: k })));
      fill(itemList, groups.size ? [...groups].map(([subj, list]) => h('div', { class: 'rm-group' },
        h('div', { class: 'rm-ghead' }, h('strong', { text: subj }), h('span', { class: 'muted small', text: list.filter(x => x.done).length + '/' + list.length + ' done' })),
        list.map(it => h('div', { class: 'rm-item' + (it.done ? ' done' : '') },
          h('input', { type: 'checkbox', checked: !!it.done, 'aria-label': 'Done', onchange: () => act(() => col('items').doc(it.id).update({ done: !it.done })) }),
          h('div', { class: 'grow' }, h('span', { text: it.text }), h('div', { class: 'muted small', text: 'added by ' + nameOf(it.by) })),
          btn('\u2715', () => act(() => col('items').doc(it.id).delete()), 'btn rm-sm'))))
      ) : h('p', { class: 'muted small', text: 'Nothing here yet. Add a subject and tasks everyone in the room can tick off.' }));
    }
    subs.push(col('items').orderBy('createdAt').onSnapshot(s => {
      renderItems(s.docs.map(d => Object.assign({ id: d.id }, d.data())));
    }, e => console.error(e)));
    fill(panels.subjects,
      h('p', { class: 'muted small', text: 'Shared with everyone in this room.' }),
      h('div', { class: 'rm-find' }, iSubject, iText, btn('Add', addItem, 'btn primary')), itemList);

    /* =================== MEMBERS =================== */
    const memberBox = h('div');
    let memberSig = '';
    function renderMembers() {
      const isOwner = room.ownerUid === me.uid;
      const list = [...room.members].sort((a, b) => (a === room.ownerUid ? -1 : b === room.ownerUid ? 1 : 0));
      fill(memberBox, h('h3', { text: 'Members (' + room.members.length + '/' + MAX_MEMBERS + ')' }),
        list.map(uid => person(uid, [
          voice.present.has(uid) ? h('span', { text: voice.present.get(uid).muted ? '\uD83D\uDD07' : '\uD83D\uDD0A', title: 'In voice chat' }) : null,
          uid === room.ownerUid ? h('span', { class: 'muted small', text: 'Owner' }) : null,
          uid === me.uid ? h('span', { class: 'muted small', text: 'You' }) : null,
          isOwner && uid !== me.uid ? btn('Remove', () => kickMember(room, uid)) : null
        ])),
        h('div', { class: 'rm-soon' }, isOwner ? btn('Delete room', () => deleteRoom(room), 'btn danger') : btn('Leave room', () => leaveRoom(room), 'btn danger')));
    }
    fill(panels.members, memberBox);

    /* =================== VOICE (WebRTC, signalled through Firestore) =================== */
    const voice = { on: false, muted: false, stream: null, peers: new Map(), raw: new Map(), present: new Map(), early: new Map(), beatTimer: null, sigUnsub: null, chain: Promise.resolve(), session: '' };
    const audioBox = h('div', { hidden: true });
    const voiceInfo = h('div', { class: 'grow muted small' });
    const voiceActs = h('div', { class: 'rm-acts' });
    const voiceBar = h('div', { class: 'rm-voice' }, h('span', { text: '\uD83C\uDF99\uFE0F' }), voiceInfo, voiceActs, audioBox);

    function renderVoice() {
      const ids = [...voice.present.keys()];
      voiceInfo.textContent = ids.length ? 'In voice: ' + ids.map(nameOf).join(', ') : 'Voice chat is empty. Join to talk with your room.';
      fill(voiceActs, voice.on
        ? [btn(voice.muted ? '\uD83D\uDD07 Unmute' : '\uD83C\uDFA4 Mute', toggleMute, 'btn rm-sm'), btn('Leave voice', leaveVoice, 'btn danger rm-sm')]
        : btn('\uD83C\uDF99\uFE0F Join voice', joinVoice, 'btn primary rm-sm'));
    }
    const sendSignal = (to, kind, payload) =>
      col('signals').add({ from: me.uid, to, kind, payload: JSON.stringify(payload), createdAt: ts() });

    function dropPeer(uid) {
      const p = voice.peers.get(uid);
      if (!p) return;
      voice.peers.delete(uid);
      try { p.pc.close(); } catch (e) { /* already closed */ }
      p.audio.srcObject = null; p.audio.remove();
    }
    function makePeer(uid, session) {
      dropPeer(uid);
      const pc = new RTCPeerConnection(ICE);
      const audio = h('audio', { autoplay: true, playsinline: true });
      audio.autoplay = true; audioBox.append(audio);
      const peer = { pc, audio, session, created: Date.now(), remoteSet: false, queue: [] };
      voice.stream.getTracks().forEach(t => pc.addTrack(t, voice.stream));
      pc.ontrack = e => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
      pc.onicecandidate = e => { if (e.candidate) sendSignal(uid, 'ice', e.candidate.toJSON()).catch(() => {}); };
      pc.onconnectionstatechange = () => {
        if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && voice.peers.get(uid) === peer) dropPeer(uid);
      };
      voice.peers.set(uid, peer);
      return peer;
    }
    async function connectTo(uid, session) {
      const peer = makePeer(uid, session);
      try {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        await sendSignal(uid, 'offer', { type: offer.type, sdp: offer.sdp });
      } catch (e) { console.error('Voice offer failed', e); dropPeer(uid); }
    }
    async function flushIce(peer) {
      peer.remoteSet = true;
      for (const c of peer.queue.splice(0)) { try { await peer.pc.addIceCandidate(c); } catch (e) { /* ignore */ } }
    }
    async function handleSignal(sig) {
      let payload; try { payload = JSON.parse(sig.payload); } catch (e) { return; }
      if (!voice.on) return;
      if (sig.kind === 'offer') {
        const peer = makePeer(sig.from, (voice.present.get(sig.from) || {}).session || null);
        await peer.pc.setRemoteDescription(payload);
        peer.queue.push(...(voice.early.get(sig.from) || [])); voice.early.delete(sig.from);
        await flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await sendSignal(sig.from, 'answer', { type: answer.type, sdp: answer.sdp });
      } else if (sig.kind === 'answer') {
        const peer = voice.peers.get(sig.from);
        if (peer && !peer.remoteSet) { await peer.pc.setRemoteDescription(payload); await flushIce(peer); }
      } else if (sig.kind === 'ice') {
        const peer = voice.peers.get(sig.from);
        if (peer && peer.remoteSet) { try { await peer.pc.addIceCandidate(payload); } catch (e) { /* ignore */ } }
        else if (peer) peer.queue.push(payload);
        else voice.early.set(sig.from, [...(voice.early.get(sig.from) || []), payload]);
      }
    }
    function onSignals(snap) {
      snap.docChanges().forEach(ch => {
        if (ch.type !== 'added') return;
        const sig = ch.doc.data();
        ch.doc.ref.delete().catch(() => {});
        voice.chain = voice.chain.then(() => handleSignal(sig)).catch(e => console.error('Voice signal failed', e));
      });
    }
    // the person with the bigger id always makes the offer, so two people never offer at the same time
    function syncPeers() {
      if (!voice.on) return;
      voice.present.forEach((v, uid) => {
        if (uid === me.uid) return;
        const peer = voice.peers.get(uid);
        if (peer && !peer.session) peer.session = v.session;
        if (peer && peer.session !== v.session) dropPeer(uid);
        if (!voice.peers.has(uid) && me.uid > uid) connectTo(uid, v.session);
      });
      [...voice.peers].forEach(([uid, p]) => { if (!voice.present.has(uid) && Date.now() - p.created > 10000) dropPeer(uid); });
    }
    function recomputeVoice() {
      const now = Date.now();
      voice.present = new Map();
      voice.raw.forEach((v, uid) => { if (uid === me.uid ? voice.on : now - (v.beat || 0) < 90000) voice.present.set(uid, v); });
      syncPeers();
      const sig = JSON.stringify([...voice.present].map(([u, v]) => [u, !!v.muted, voice.on]));
      renderVoice();
      if (sig !== memberSig) { memberSig = sig; renderMembers(); }
    }
    async function joinVoice() {
      if (voice.on) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof RTCPeerConnection === 'undefined') {
        toast('Voice needs a modern browser opened over https.'); return;
      }
      try {
        voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (e) { console.error(e); toast('Microphone blocked. Allow microphone access and try again.'); return; }
      try {
        voice.session = Math.random().toString(36).slice(2, 10);
        voice.on = true; voice.muted = false;
        const old = await col('signals').where('to', '==', me.uid).get();
        await Promise.all(old.docs.map(d => d.ref.delete().catch(() => {})));
        await col('voice').doc(me.uid).set({ uid: me.uid, session: voice.session, beat: Date.now(), muted: false });
        voice.beatTimer = setInterval(() => col('voice').doc(me.uid).update({ beat: Date.now() }).catch(() => {}), 20000);
        voice.sigUnsub = col('signals').where('to', '==', me.uid).onSnapshot(onSignals, e => console.error(e));
        recomputeVoice();
      } catch (e) { console.error(e); toast(errText(e)); leaveVoice(); }
    }
    function leaveVoice() {
      if (!voice.on && !voice.stream) return;
      voice.on = false; voice.muted = false;
      clearInterval(voice.beatTimer); voice.beatTimer = null;
      if (voice.sigUnsub) { voice.sigUnsub(); voice.sigUnsub = null; }
      [...voice.peers.keys()].forEach(dropPeer);
      if (voice.stream) { voice.stream.getTracks().forEach(t => t.stop()); voice.stream = null; }
      col('voice').doc(me.uid).delete().catch(() => {});
      recomputeVoice();
    }
    function toggleMute() {
      if (!voice.stream) return;
      voice.muted = !voice.muted;
      voice.stream.getAudioTracks().forEach(t => { t.enabled = !voice.muted; });
      col('voice').doc(me.uid).update({ muted: voice.muted }).catch(() => {});
      renderVoice();
    }
    subs.push(col('voice').onSnapshot(s => {
      voice.raw = new Map(s.docs.map(d => [d.id, d.data()]));
      if (!voice.on && voice.raw.has(me.uid)) col('voice').doc(me.uid).delete().catch(() => {});   // leftover from a closed tab
      recomputeVoice();
    }, e => console.error(e)));
    const onHide = () => leaveVoice();
    window.addEventListener('pagehide', onHide);

    /* ----- assemble ----- */
    timers.push(setInterval(tickFocus, 500), setInterval(recomputeVoice, 15000));
    drawTabs(); renderFocus(); renderChat(); renderItems([]); renderVoice();
    const el = h('div', { class: 'rm-space' }, header, voiceBar, tabBar, panels.focus, panels.chat, panels.subjects, panels.members);

    return {
      id: code, el,
      update(r) {
        room = r;
        title.textContent = r.name;
        sub.textContent = r.members.length + (r.members.length === 1 ? ' member' : ' members') + (r.ownerUid === me.uid ? ' \u00b7 You are the owner' : '');
        renderMembers(); renderVoice(); renderChat();
      },
      destroy() {
        destroyed = true;
        leaveVoice();
        subs.forEach(f => f()); timers.forEach(clearInterval);
        window.removeEventListener('pagehide', onHide);
      }
    };
  }

  function openRoom(id) { openId = id; openSeen = false; drawRooms(); }
  function drawRooms() {
    if (view !== 'ok') return;
    const r = openId && st.rooms.find(x => x.id === openId);
    if (r) openSeen = true;
    else if (openId && openSeen) { openId = null; openSeen = false; toast('You are no longer in that room'); }
    roomHome.hidden = !!r; roomDetail.hidden = !r;
    if (!r) {
      closeSpace();
      fill(roomList, st.rooms.length ? st.rooms.map(roomRow) : h('p', { class: 'muted small', text: 'You are not in any room yet. Create one or join with a code.' }));
      return;
    }
    if (!space || space.id !== r.id) { closeSpace(); space = makeSpace(r); fill(roomDetail, space.el); }
    space.update(r);
  }

  function draw() {
    const ok = view === 'ok';
    addCard.hidden = reqBox.hidden = friendsBox.hidden = roomsBox.hidden = !ok;
    if (view === 'loading') { fill(topBox, h('div', { class: 'card rm-card' }, h('p', { class: 'muted', text: 'Loading…' }))); return; }
    if (view === 'error') {
      fill(topBox, h('div', { class: 'card rm-card' }, h('p', { class: 'rm-note', 'data-kind': 'err', text: errorText }), btn('Try again', () => start(me), 'btn')));
      return;
    }
    if (view === 'setup') { fill(topBox, setupCard()); return; }
    fill(topBox, idCard());
    drawRooms();
    const reqRows = [
      ...st.incoming.map(r => person(r.uid, [btn('Accept', () => accept(r), 'btn primary rm-sm'), btn('Decline', () => dropRequest(r, 'Request declined'))])),
      ...st.outgoing.map(r => person(r.uid, [h('span', { class: 'muted small', text: 'Sent' }), btn('Cancel', () => dropRequest(r, 'Request cancelled'))]))
    ];
    fill(reqBox, h('h3', { text: 'Friend Requests' }), reqRows.length ? reqRows : h('p', { class: 'muted small', text: 'No pending requests.' }));
    fill(friendsBox, h('h3', { text: 'Friends List (' + st.friends.length + ')' }),
      st.friends.length ? st.friends.map(f => person(f.other, [btn('Remove', () => removeFriend(f))])) : h('p', { class: 'muted small', text: 'No friends yet. Add one with a username or friend code.' }));
  }

  /* ---------- start / sign-out ---------- */
  async function start(u) {
    closeSpace(); stop(); cache.clear(); myProfile = null; openId = null; me = u || null;
    if (!me) { view = 'loading'; return; }
    view = 'loading'; draw();
    try {
      const s = await db.collection('publicProfiles').doc(me.uid).get();
      if (s.exists) { myProfile = s.data(); cache.set(me.uid, myProfile); view = 'ok'; listen(); schedulePush(); }
      else view = 'setup';
    } catch (e) { console.error(e); view = 'error'; errorText = errText(e); }
    draw();
  }
  firebase.auth().onAuthStateChanged(u => { start(u); });
})();