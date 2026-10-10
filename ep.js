/* =====================================================
   EP (Effort Points) - website part
   The server (ep-worker.js) is the only place EP is really added.
   This file shows the balance, sends mission-completion claims, and draws the leaderboard.
   ===================================================== */
TITLES.leaderboard = 'Leaderboard';

const EP_API = 'https://studyapp-ep.rubal20agrawal13.workers.dev';   // address of your EP Worker
const LB_REFRESH_MS = 10000;                            // leaderboard refreshes every 10 seconds while open

const epChip = $('#ep-chip'), epCountEl = $('#ep-count'), lbBox = $('#lb-box');
let epFlushing = false, epRetry = null, epStarted = false, epShown = null;
let lbTimer = null, lbSeq = 0, lbLast = null, lbState = 'loading', lbErr = '';

/* ---------- balance ---------- */
/* Shown balance = last balance the server confirmed + rewards still waiting to be sent. */
function epTotal() {
  if (typeof data === 'undefined' || !data) return 0;
  const base = typeof data.epBase === 'number' ? data.epBase : (Number(data.xp) || 0);
  const waiting = (data.epQueue || []).reduce((s, q) => s + (Number(q.ep) || 0), 0);
  return base + waiting;
}
function epRenderChip(animate) {
  if (!epCountEl) return;
  const n = epTotal();
  epCountEl.textContent = n.toLocaleString();
  if (epChip) {
    epChip.setAttribute('aria-label', 'You have ' + n + ' Effort Points. Open leaderboard');
    if (animate && epShown !== null && n > epShown) { epChip.classList.remove('pop'); void epChip.offsetWidth; epChip.classList.add('pop'); }
  }
  epShown = n;
  if (typeof data !== 'undefined' && data) data.xp = n;     // keeps older code that reads data.xp working
}
function epSetBase(n) {
  data.epBase = n;
  saveData();
  epRenderChip(true);
  const mp = $('#page-missions');
  if (mp && mp.classList.contains('active') && typeof renderMissions === 'function') renderMissions();
}

/* ---------- talking to the server ---------- */
async function epCall(path, extra) {
  if (typeof auth === 'undefined' || !auth.currentUser) throw Object.assign(new Error('signin'), { status: 401 });
  if (EP_API.indexOf('YOUR-EP-WORKER') >= 0) throw Object.assign(new Error('Set your Worker address in ep.js (the EP_API line).'), { status: 0 });
  if (!/^https:\/\//i.test(EP_API)) throw Object.assign(new Error('EP_API must start with https:// . Right now it is: ' + EP_API), { status: 0 });
  if (/github\.io/i.test(EP_API)) throw Object.assign(new Error('EP_API points to your GitHub site. It must be your Cloudflare Worker address (ends in workers.dev).'), { status: 0 });
  const idToken = await auth.currentUser.getIdToken();
  let r;
  try {
    r = await fetch(EP_API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ idToken, name: data.studentName }, extra || {}))
    });
  } catch (e) {
    throw Object.assign(new Error('Could not reach the Worker. Check the EP_API address, and that ALLOWED_ORIGIN is exactly your site address with no slash.'), { status: 0 });
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((d.error || 'Server error') + ' (code ' + r.status + ') from ' + new URL(EP_API + path, location.href).href), { status: r.status });
  return d;
}

/* ---------- mission rewards ---------- */
/* Called by completeMission() exactly once per mission. Three safety layers:
   1) the mission's own done/rewarded flags  2) the claim id is queued only once  3) the server ignores repeat claim ids */
function epAward(m) {
  const st = missionState();
  const claimId = st.date + ':' + m.id;
  data.epQueue = Array.isArray(data.epQueue) ? data.epQueue : [];
  data.epDone = Array.isArray(data.epDone) ? data.epDone : [];
  if (data.epDone.includes(claimId) || data.epQueue.some(q => q.claimId === claimId)) return;   // already sent or already waiting
  data.epQueue.push({ claimId, difficulty: m.difficulty, ep: Number(DIFF_XP[m.difficulty]) || 0 });
  saveData();
  epRenderChip(true);
  epFlush();
}

function epDone(claimId) {            // remember finished claim ids so they can never be queued again
  data.epDone = (Array.isArray(data.epDone) ? data.epDone : []).concat(claimId).slice(-200);
}

async function epFlush() {
  if (epFlushing || !epStarted || typeof data === 'undefined' || !data) return;
  if (!Array.isArray(data.epQueue) || !data.epQueue.length) return;
  epFlushing = true;
  try {
    while (data.epQueue.length) {
      const q = data.epQueue[0];
      let res;
      try {
        res = await epCall('/claim', { claimId: q.claimId, difficulty: q.difficulty });
      } catch (e) {
        if (e.status === 400) { epDone(data.epQueue.shift().claimId); saveData(); epRenderChip(); continue; }   // server says this claim can never be valid: drop it
        throw e;                                                                                // network / sign-in / server trouble: keep it and retry later
      }
      epDone(data.epQueue.shift().claimId);
      epSetBase(res.ep);
      if (res.reason === 'daily_cap') toast('Daily EP limit reached. Come back tomorrow!');
      lbRefreshSoon();
    }
  } catch (e) {
    clearTimeout(epRetry);
    epRetry = setTimeout(epFlush, 30000);
  }
  epFlushing = false;
}
window.addEventListener('online', epFlush);

/* ---------- start / stop with sign-in ---------- */
async function epStart(tries = 0) {
  if (typeof data === 'undefined' || !data) { if (tries < 20) setTimeout(() => epStart(tries + 1), 250); return; }
  epStarted = true;
  if (typeof data.epLegacy !== 'number') data.epLegacy = Number(data.xp) || 0;   // old local XP, remembered before anything changes it
  epRenderChip();
  try {
    const first = !data.epSynced;
    const res = await epCall('/sync', first ? { legacy: data.epLegacy } : {});
    data.epSynced = true;
    epSetBase(res.ep);
  } catch (e) { /* offline: the cached balance stays on screen */ }
  epFlush();
}
function epReset() {
  epStarted = false; epShown = null; lbStop();
  if (epCountEl) epCountEl.textContent = '0';
}

/* ---------- leaderboard page ---------- */
function lbRow(r) {
  const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank;
  return h('li', { class: 'lb-row' + (r.rank <= 3 ? ' r' + r.rank : '') + (r.me ? ' lb-me' : ''), 'aria-current': r.me ? 'true' : null },
    h('span', { class: 'lb-rank', text: String(medal) }),
    h('span', { class: 'lb-name' }, r.name, r.me ? h('span', { class: 'lb-you', text: 'You' }) : null),
    h('span', { class: 'lb-ep' }, r.ep.toLocaleString(), h('small', { text: 'EP' })));
}
function lbRender() {
  if (!lbBox) return;
  const top = h('div', { class: 'lb-top' },
    h('strong', { text: lbLast ? lbLast.total + (lbLast.total === 1 ? ' player' : ' players') : 'Global leaderboard' }),
    h('span', { class: 'lb-live' }, h('i'), 'Live'));
  let body;
  if (lbState === 'loading') {
    body = h('div', { class: 'lb-list', role: 'status', 'aria-label': 'Loading leaderboard' }, [1, 2, 3, 4, 5].map(() => h('div', { class: 'lb-skel' })));
  } else if (lbState === 'error') {
    body = h('div', { class: 'lb-err', role: 'alert' },
      h('strong', { text: "Couldn't load the leaderboard" }),
      h('span', { class: 'muted small', text: lbErr || 'Check your internet connection and try again.' }),
      h('button', { class: 'btn primary', type: 'button', text: 'Try again', onclick: () => { lbState = 'loading'; lbRender(); lbLoad(); } }));
  } else if (!lbLast || !lbLast.rows.length) {
    body = empty('No players yet', 'Complete a mission to earn EP and be the first on the leaderboard.');
  } else {
    const rows = lbLast.rows.map(lbRow);
    const mine = lbLast.me;
    if (mine && !lbLast.rows.some(r => r.me)) {
      rows.push(h('li', { class: 'lb-gap', 'aria-hidden': 'true', text: '...' }));
      rows.push(lbRow({ rank: mine.rank, name: mine.name, ep: mine.ep, me: true }));
    }
    body = h('ol', { class: 'lb-list' }, rows);
  }
  fill(lbBox, h('div', { class: 'card lb-card' }, top, body));
}
async function lbLoad() {
  const seq = ++lbSeq;
  try {
    const d = await epCall('/leaderboard');
    if (seq !== lbSeq) return;
    lbLast = d; lbState = 'ready';
    if (d.me && typeof d.me.ep === 'number' && !(data.epQueue || []).length && d.me.ep !== data.epBase) epSetBase(d.me.ep);
  } catch (e) {
    if (seq !== lbSeq) return;
    lbErr = e.message || '';
    if (!lbLast) lbState = 'error';     // keep showing the old list if a refresh fails
  }
  lbRender();
}
function lbStart() {
  lbStop();
  lbState = lbLast ? 'ready' : 'loading';
  lbRender(); lbLoad();
  lbTimer = setInterval(() => { if (!document.hidden) lbLoad(); }, LB_REFRESH_MS);
}
function lbStop() { clearInterval(lbTimer); lbTimer = null; }
function lbRefreshSoon() { const p = $('#page-leaderboard'); if (p && p.classList.contains('active')) lbLoad(); }

/* open/close hooks on your existing go() navigation (no change to script.js needed) */
(function () {
  const originalGo = go;
  go = function (page) {
    originalGo.apply(this, arguments);
    epRenderChip();
    if (page === 'leaderboard') lbStart(); else lbStop();
  };
})();
if (epChip) epChip.addEventListener('click', () => go('leaderboard'));

if (typeof auth !== 'undefined') {
  auth.onAuthStateChanged(user => { if (user) epStart(); else epReset(); });
}