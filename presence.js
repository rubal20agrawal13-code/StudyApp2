/* =====================================================
   PRESENCE (presence.js)  - load AFTER ep.js
   Sends a small "I am here" heartbeat to your Worker every 30 seconds
   while a user is signed in. The server marks a user Online only while
   a heartbeat is newer than 90 seconds. It sends NOTHING else about the
   user except: display name, username, class, board.
   Tab closed / sign-out -> an "offline" signal is sent.
   Crash / no internet / sleep -> no signal needed: the heartbeat simply expires.
   ===================================================== */
(function () {
  'use strict';
  if (window.__presence) return;
  window.__presence = true;
  if (typeof EP_API === 'undefined' || typeof firebase === 'undefined') return;

  const HEARTBEAT_MS = 30000;

  /* one id per browser tab; the server counts a user once however many tabs/devices they have */
  const device = (() => {
    const make = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    try {
      let d = sessionStorage.getItem('sa_device');
      if (!d) { d = make(); sessionStorage.setItem('sa_device', d); }
      return d;
    } catch (e) { return make(); }
  })();

  let timer = null, lastToken = null, sentSig = '', username = '', usernameFor = null;

  async function loadUsername(u) {
    if (usernameFor === u.uid) return;
    usernameFor = u.uid;
    try {
      const s = await firebase.firestore().collection('publicProfiles').doc(u.uid).get();
      username = s.exists && typeof s.data().username === 'string' ? s.data().username : '';
    } catch (e) { username = ''; }
  }

  function profileInfo() {
    const p = typeof aboutState === 'function' ? aboutState() : {};
    return {
      name: typeof data !== 'undefined' && data && data.studentName ? String(data.studentName).slice(0, 40) : 'Student',
      username,
      cls: typeof p.class === 'string' ? p.class : '',
      board: typeof p.board === 'string' ? p.board : ''
    };
  }

  async function beat() {
    const u = firebase.auth().currentUser;
    if (!u) return;
    try {
      await loadUsername(u);
      const idToken = await u.getIdToken();
      lastToken = idToken;
      const info = profileInfo(), sig = JSON.stringify(info);
      const body = { idToken, device };
      if (sig !== sentSig) body.profile = info;              // profile details are sent only when they change
      const r = await fetch(EP_API + '/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true
      });
      if (r.ok && body.profile) sentSig = sig;
    } catch (e) { /* offline or Worker down: the next beat tries again */ }
  }

  function sendOffline() {
    if (!lastToken) return;
    try {
      fetch(EP_API + '/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ idToken: lastToken, device, state: 'offline' })
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function startBeating() {
    stopBeating();
    beat();
    timer = setInterval(beat, HEARTBEAT_MS);
  }
  function stopBeating() { if (timer) { clearInterval(timer); timer = null; } }

  firebase.auth().onAuthStateChanged(u => {
    if (u) { sentSig = ''; startBeating(); }
    else { stopBeating(); sendOffline(); lastToken = null; username = ''; usernameFor = null; sentSig = ''; }
  });

  /* tab closed or page left */
  window.addEventListener('pagehide', sendOffline);
  /* tab visible again / page restored / internet back: say so immediately */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && firebase.auth().currentUser) beat(); });
  window.addEventListener('pageshow', e => { if (e.persisted && firebase.auth().currentUser) startBeating(); });
  window.addEventListener('online', () => { if (firebase.auth().currentUser) beat(); });
})();