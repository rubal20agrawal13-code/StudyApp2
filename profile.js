/* =====================================================
   STUDENT PROFILE CENTER  (profile.js)
   Opens when the top-right profile picture is clicked.
   ===================================================== */
(function () {
  'use strict';
  if (window.__profileCenter) return;          // never run twice
  window.__profileCenter = true;

  const page = $('#page-profile');
  if (!page) return;                           // index.html edit missing

  const AVATARS = ['🦁', '🐯', '🦊', '🐼', '🦉', '🐬', '🚀', '🎓', '📚', '⚡', '🔥', '🌟', '🧠', '🎯', '🏆', '🎨'];
  const CLASSES = ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'];
  const BOARDS = ['CBSE', 'ICSE', 'State Board', 'Other'];
  const STREAMS = ['Science (PCM)', 'Science (PCB)', 'Commerce', 'Arts'];
  const LIMITS = { fullName: 60, displayName: 40, school: 60, bio: 200, favSubject: 40, learningGoals: 200, examGoals: 120 };
  const PHOTO_SIZE = 256, MAX_PHOTO_MB = 8;

  const st = { editing: false, baseline: null, busy: false, sync: 'idle', pending: null, cam: null };
  const F = {};                                // form controls by name

  TITLES.profile = 'Student Profile';

  /* ---------- small helpers ---------- */
  const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const initialOf = name => ((name || 'S').trim()[0] || 'S').toUpperCase();

  function validAvatar(a) {
    if (a && a.type === 'emoji' && AVATARS.includes(a.value)) return { type: 'emoji', value: a.value };
    if (a && a.type === 'photo' && typeof a.data === 'string' && a.data.length < 200000 &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(a.data)) return { type: 'photo', data: a.data };
    return { type: 'initial' };
  }

  function sanitize(c) {
    c = c || {};
    return {
      fullName: str(c.fullName, LIMITS.fullName),
      displayName: str(c.displayName, LIMITS.displayName) || 'Student',
      school: str(c.school, LIMITS.school), bio: str(c.bio, LIMITS.bio),
      class: str(c.class, 30), stream: str(c.stream, 30), board: str(c.board, 30),
      favSubject: str(c.favSubject, LIMITS.favSubject),
      learningGoals: str(c.learningGoals, LIMITS.learningGoals),
      examGoals: str(c.examGoals, LIMITS.examGoals),
      avatar: validAvatar(c.avatar)
    };
  }

  /* ---------- the saved profile (kept inside the existing data object) ---------- */
  function current() {
    const p = aboutState();
    const name = typeof data.studentName === 'string' && data.studentName ? data.studentName : 'Student';
    return sanitize({
      fullName: p.fullName || (name !== 'Student' ? name : ''), displayName: name,
      school: p.school, bio: p.about, class: p.class, stream: p.stream, board: p.board,
      favSubject: p.favSubject, learningGoals: p.learningGoals, examGoals: p.goal, avatar: p.avatar
    });
  }
  function applyLocal(v) {
    const p = aboutState();
    data.studentName = v.displayName;
    p.fullName = v.fullName; p.school = v.school; p.about = v.bio;
    p.class = v.class; p.stream = v.stream; p.board = v.board;
    p.favSubject = v.favSubject; p.learningGoals = v.learningGoals; p.goal = v.examGoals;
    p.avatar = v.avatar;
    saveData();
  }

  /* ---------- cloud (Firestore) - only used if Firestore is added; otherwise device only ---------- */
  function cloudRef() {
    try {
      const u = typeof auth !== 'undefined' ? auth.currentUser : null;
      if (!u || typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') return null;
      return firebase.firestore().collection('users').doc(u.uid);
    } catch (e) { return null; }
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) =>
    setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);
  function friendly(e) {
    const c = (e && e.code) || '';
    if (c === 'permission-denied') return 'Your account is not allowed to save here. Check the Firestore rules in Firebase.';
    if (c === 'timeout' || c === 'unavailable') return 'Could not reach the server. Check your internet and try again.';
    return 'Could not save your profile. Please try again.';
  }
  /* Saves everything. Local copy is updated ONLY after the save worked. */
  async function persist(v) {
    const ref = cloudRef();
    if (!ref) { applyLocal(v); st.sync = 'off'; refreshStatus(); return { ok: true, where: 'device' }; }
    try {
      await withTimeout(ref.set({ profile: v, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
        { mergeFields: ['profile', 'updatedAt'] }), 12000);
    } catch (e) {
      console.error('Profile save failed:', e);
      return { ok: false, error: friendly(e) };
    }
    applyLocal(v); st.sync = 'ok'; refreshStatus();
    return { ok: true, where: 'cloud' };
  }
  async function loadCloud() {
    const ref = cloudRef();
    if (!ref) { st.sync = 'off'; refreshStatus(); return; }
    st.sync = 'loading'; refreshStatus();
    try {
      const snap = await withTimeout(ref.get(), 10000);
      const d = snap.exists ? snap.data() : null;
      st.sync = 'ok';
      if (d && d.profile && !st.editing) { applyLocal(sanitize(d.profile)); renderAll(); }
    } catch (e) {
      console.error('Profile load failed:', e);
      st.sync = e && e.code === 'permission-denied' ? 'denied' : 'error';
    }
    refreshStatus();
  }

  /* ---------- show the picture everywhere ---------- */
  function paintAvatar(el, av, initial) {
    if (!el) return;
    el.classList.remove('has-photo'); el.style.backgroundImage = '';
    if (av.type === 'photo') { el.textContent = ''; el.style.backgroundImage = 'url("' + av.data + '")'; el.classList.add('has-photo'); }
    else if (av.type === 'emoji') el.textContent = av.value;
    else el.textContent = initial;
  }
  /* Other features (e.g. a leaderboard) can call this to show a student's picture. */
  window.paintProfileAvatar = paintAvatar;

  window.profileSync = function () {
    if (typeof data === 'undefined' || !data) return;
    const v = current(), ini = initialOf(v.displayName);
    ['#profile-btn', '#side-avatar', '#ov-avatar', '#pf-avatar'].forEach(s => paintAvatar($(s), v.avatar, ini));
    refreshHero(v);
    if (!st.editing) fillForm(v);
  };

  /* ---------- build the page once ---------- */
  function field(name, label, control, o = {}) {
    control.id = 'pf-' + name; control.name = name;
    control.setAttribute('aria-describedby', 'pf-err-' + name);
    F[name] = control;
    return h('label', { class: 'field pf-field', for: 'pf-' + name },
      h('span', {}, label, o.required ? h('b', { class: 'pf-req', text: ' *', 'aria-hidden': 'true' }) : null),
      control, h('small', { class: 'pf-err', id: 'pf-err-' + name, role: 'alert' }));
  }
  const txt = name => h('input', { type: 'text', maxlength: LIMITS[name], autocomplete: 'off' });
  const area = name => h('textarea', { rows: 3, maxlength: LIMITS[name] });

  const avatarEl = h('div', { id: 'pf-avatar', class: 'avatar pf-avatar', role: 'img', 'aria-label': 'Profile picture' });
  const nameEl = h('h2', { id: 'pf-name' }), metaEl = h('p', { class: 'muted', id: 'pf-meta' });
  const bioEl = h('p', { class: 'pf-bio', id: 'pf-bio' });
  const syncEl = h('p', { class: 'pf-sync small', id: 'pf-sync', role: 'status' });
  const editBtn = h('button', { type: 'button', class: 'btn primary', id: 'pf-edit', text: 'Edit Profile', onclick: startEdit });
  const picBtn = h('button', { type: 'button', class: 'btn', id: 'pf-pic', text: 'Change Profile Picture', onclick: openPicker });

  const hero = h('div', { class: 'card pf-hero' }, avatarEl,
    h('div', { class: 'pf-id grow' }, nameEl, metaEl, bioEl, syncEl, h('div', { class: 'pf-actions' }, editBtn, picBtn)));

  const classSel = h('select', {}), streamSel = h('select', {}), boardSel = h('select', {});
  const subjList = h('datalist', { id: 'pf-subjects' });
  const favInput = h('input', { type: 'text', maxlength: LIMITS.favSubject, autocomplete: 'off', list: 'pf-subjects' });

  const personal = h('section', { class: 'card pf-card' }, h('h3', { text: 'Personal Information' }),
    h('div', { class: 'pf-grid' },
      field('fullName', 'Full name', txt('fullName'), { required: true }),
      field('displayName', 'Display name', txt('displayName'), { required: true }),
      field('school', 'School name (optional)', txt('school')),
      field('bio', 'Short bio (optional)', area('bio'))));

  const academic = h('section', { class: 'card pf-card' }, h('h3', { text: 'Academic Information' }),
    h('div', { class: 'pf-grid' },
      field('class', 'Current class', classSel, { required: true }),
      field('stream', 'Stream (Class 11-12)', streamSel, { required: true }),
      field('board', 'Board', boardSel, { required: true }),
      field('favSubject', 'Favourite subject', favInput), subjList,
      field('learningGoals', 'Learning goals', area('learningGoals')),
      field('examGoals', 'Exam preparation goals (optional)', area('examGoals'))));

  const emailEl = h('p', { class: 'pf-email', id: 'pf-email' }), provEl = h('p', { class: 'muted small', id: 'pf-prov' });
  const account = h('section', { class: 'card pf-card pf-account' }, h('h3', { text: 'Account Information' }),
    h('span', { class: 'muted small', text: 'Email (read-only)' }), emailEl, provEl,
    h('p', { class: 'muted small', text: 'Your email comes from your sign-in provider, so it cannot be changed here. Passwords are never shown.' }));

  const msg = h('p', { class: 'pf-msg', id: 'pf-msg', role: 'status', 'aria-live': 'polite' });
  const cancelBtn = h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: cancel });
  const saveBtn = h('button', { type: 'submit', class: 'btn primary', text: 'Save Changes' });
  const bar = h('div', { class: 'pf-bar', id: 'pf-bar', hidden: true }, msg, h('div', { class: 'pf-bar-btns' }, cancelBtn, saveBtn));

  const fs = h('fieldset', { class: 'pf-fs', disabled: true }, h('div', { class: 'pf-cols' }, personal, academic));
  const form = h('form', { id: 'pf-form', class: 'pf-form', novalidate: true, onsubmit: e => { e.preventDefault(); save(); } },
    fs, account, bar);
  form.addEventListener('input', updateBar);
  form.addEventListener('change', () => { syncStream(); updateBar(); });

  const back = h('div', { class: 'pf-top' },
    h('button', { type: 'button', class: 'btn pf-back', text: '← Back to Dashboard', onclick: () => go('overview') }));

  fill(page, back, hero, form);

  /* ---------- filling and reading the form ---------- */
  function setSelect(sel, value, list, placeholder) {
    const items = list.concat(value && !list.includes(value) ? [value] : []);
    sel.replaceChildren(h('option', { value: '', text: placeholder }), ...items.map(o => h('option', { value: o, text: o })));
    sel.value = value || '';
  }
  function syncStream() { F.stream.closest('.pf-field').hidden = classNumber(F.class.value) < 11; }
  function clearErrors() {
    Object.keys(F).forEach(k => { const e = $('#pf-err-' + k); if (e) e.textContent = ''; F[k].removeAttribute('aria-invalid'); });
  }
  function fillForm(v) {
    F.fullName.value = v.fullName; F.displayName.value = v.displayName; F.school.value = v.school; F.bio.value = v.bio;
    setSelect(F.class, v.class, CLASSES, 'Select class');
    setSelect(F.stream, v.stream, STREAMS, 'Select stream');
    setSelect(F.board, v.board, BOARDS, 'Select board');
    F.favSubject.value = v.favSubject; F.learningGoals.value = v.learningGoals; F.examGoals.value = v.examGoals;
    subjList.replaceChildren(...((typeof data !== 'undefined' && data && data.subjects) || []).map(s => h('option', { value: s.name })));
    syncStream(); clearErrors();
    const u = typeof auth !== 'undefined' ? auth.currentUser : null;
    emailEl.textContent = (u && u.email) || 'Not available';
    const pid = u && u.providerData && u.providerData[0] && u.providerData[0].providerId;
    provEl.textContent = pid ? 'Sign-in method: ' + (pid === 'google.com' ? 'Google' : pid === 'password' ? 'Email and password' : pid) : '';
  }
  function read() {
    const g = n => str(F[n].value, LIMITS[n] || 30);
    const cls = g('class');
    return sanitize({
      fullName: g('fullName'), displayName: g('displayName'), school: g('school'), bio: g('bio'),
      class: cls, stream: classNumber(cls) >= 11 ? g('stream') : '', board: g('board'),
      favSubject: g('favSubject'), learningGoals: g('learningGoals'), examGoals: g('examGoals'),
      avatar: current().avatar
    });
  }
  function validate(v) {
    const e = {};
    if (!v.fullName) e.fullName = 'Enter your full name.';
    else if (v.fullName.length < 2) e.fullName = 'Full name is too short.';
    const dn = str(F.displayName.value, LIMITS.displayName);
    if (!dn) e.displayName = 'Enter the name you want to be called.';
    if (!v.class) e.class = 'Choose your class.';
    if (v.class && classNumber(v.class) >= 11 && !v.stream) e.stream = 'Choose your stream for Class 11-12.';
    if (!v.board) e.board = 'Choose your board.';
    return e;
  }
  function showErrors(errs) {
    clearErrors();
    Object.keys(errs).forEach(k => { $('#pf-err-' + k).textContent = errs[k]; F[k].setAttribute('aria-invalid', 'true'); });
  }
  const isDirty = () => st.editing && st.baseline && !same(read(), st.baseline);

  /* ---------- hero + status text ---------- */
  function refreshHero(v) {
    nameEl.textContent = v.fullName || v.displayName;
    metaEl.textContent = [v.class, v.board].filter(Boolean).join(' • ') || 'Add your class and board';
    bioEl.textContent = v.bio; bioEl.hidden = !v.bio;
    refreshStatus();
  }
  function refreshStatus() {
    const t = {
      loading: 'Syncing your profile…', ok: '☁ Saved to your account',
      off: 'Saved on this device only.',
      denied: 'Cloud sync is blocked by your Firestore rules.',
      error: 'Could not reach cloud sync. Showing what is saved on this device.', idle: ''
    };
    syncEl.textContent = t[st.sync] || ''; syncEl.dataset.state = st.sync;
  }
  function setMsg(text, kind) { msg.textContent = text; msg.dataset.kind = kind || ''; }
  function updateBar() { if (st.editing && !st.busy) setMsg(isDirty() ? 'You have unsaved changes.' : '', 'info'); }
  function busy(b) {
    st.busy = b; saveBtn.disabled = b; cancelBtn.disabled = b; fs.disabled = b || !st.editing;
    saveBtn.textContent = b ? 'Saving…' : 'Save Changes'; form.setAttribute('aria-busy', String(b));
  }

  /* ---------- edit / cancel / save ---------- */
  function startEdit() {
    if (st.editing) { F.fullName.focus(); return; }
    st.editing = true; fillForm(current()); st.baseline = read();
    fs.disabled = false; bar.hidden = false; form.classList.add('editing'); setMsg('', '');
    editBtn.setAttribute('aria-pressed', 'true');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    F.fullName.focus({ preventScroll: true });
  }
  function exitEdit() {
    st.editing = false; st.baseline = null; busy(false);
    fs.disabled = true; bar.hidden = true; form.classList.remove('editing'); setMsg('', '');
    editBtn.setAttribute('aria-pressed', 'false');
    if (typeof data !== 'undefined' && data) fillForm(current());
  }
  function cancel() {
    if (isDirty()) confirmBox('Discard changes?', 'Your edits will be lost.', 'Discard', exitEdit);
    else exitEdit();
  }
  async function save() {
    if (st.busy || !st.editing) return;
    const v = read(), errs = validate(v);
    showErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) { setMsg('Please fix the highlighted fields.', 'err'); F[first].focus(); return; }
    const old = current();
    busy(true); setMsg('Saving…', 'info');
    const r = await persist(v);
    busy(false);
    if (!r.ok) { setMsg(r.error, 'err'); return; }      // nothing was saved: stay in edit mode
    exitEdit(); renderAll();
    toast(r.where === 'cloud' ? 'Profile saved' : 'Saved on this device only');
    suggestSubjects(old, v);
  }
  /* same behaviour the old "About Me" card had: offer subjects for the new class */
  function suggestSubjects(old, v) {
    if (typeof subjectsFor !== 'function') return;
    const list = subjectsFor(v.class, v.stream);
    if (!list || (old.class === v.class && old.stream === v.stream)) return;
    if (data.subjects.map(s => s.name).join('|') === list.join('|')) return;
    confirmBox('Update your subjects?', 'Set your subjects for ' + v.class + (v.stream ? ' (' + v.stream + ')' : '') + ': ' + list.join(', ') +
      '. Progress in matching subjects is kept. Other subjects are removed, and your tasks stay.', 'Update subjects', () => applySubjects(list));
  }

  /* ---------- do not lose unsaved edits ---------- */
  window.profileLeaveGuard = function (target) {
    if (target === 'profile' || !page.classList.contains('active')) return true;
    if (!st.editing) return true;
    if (!isDirty()) { exitEdit(); return true; }
    confirmBox('Leave without saving?', 'You have unsaved changes to your profile. If you leave now, they will be lost.',
      'Discard changes', () => { exitEdit(); go(target); });
    return false;
  };
  window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- profile picture picker ---------- */
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      img.src = url;
    });
  }
  function toSquareJpeg(src, sw, sh) {
    const c = document.createElement('canvas'); c.width = c.height = PHOTO_SIZE;
    const ctx = c.getContext('2d'), s = Math.min(sw, sh);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    ctx.drawImage(src, (sw - s) / 2, (sh - s) / 2, s, s, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    return c.toDataURL('image/jpeg', 0.85);
  }
  function stopCamera() { if (st.cam) { st.cam.getTracks().forEach(t => t.stop()); st.cam = null; } }
  const modalEl = $('#modal');
  if (modalEl) new MutationObserver(() => { if (modalEl.hidden) stopCamera(); }).observe(modalEl, { attributes: true, attributeFilter: ['hidden'] });

  function openPicker() {
    const saved = current(), ini = initialOf(saved.displayName);
    st.pending = saved.avatar;
    const preview = h('div', { class: 'avatar pf-prev', role: 'img', 'aria-label': 'Preview of your new picture' });
    const note = h('p', { class: 'pf-msg pf-picknote', role: 'status', 'aria-live': 'polite' });
    const useBtn = h('button', { type: 'button', class: 'btn primary', text: 'Use this picture' });
    const tiles = [{ type: 'initial' }].concat(AVATARS.map(e => ({ type: 'emoji', value: e })));
    const grid = h('div', { class: 'pf-avgrid', role: 'group', 'aria-label': 'Choose an avatar' }, tiles.map(a =>
      h('button', {
        type: 'button', class: 'pf-av', 'aria-label': a.type === 'initial' ? 'Use my initial' : 'Avatar ' + a.value,
        text: a.type === 'initial' ? ini : a.value, onclick: () => setPending(a)
      })));
    function setPending(a) {
      st.pending = a; note.textContent = ''; note.dataset.kind = '';
      paintAvatar(preview, a, ini);
      useBtn.disabled = same(a, saved.avatar);
      [...grid.children].forEach((b, i) => b.setAttribute('aria-pressed', String(same(tiles[i], a))));
    }
   async function onFile(file) {
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { note.textContent = 'Please choose a JPG, PNG or WebP image.'; note.dataset.kind = 'err'; return; }
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) { note.textContent = 'That image is too large (max ' + MAX_PHOTO_MB + ' MB).'; note.dataset.kind = 'err'; return; }
      note.textContent = 'Preparing your photo…'; note.dataset.kind = 'info';
      try { const img = await loadImage(file); setPending({ type: 'photo', data: toSquareJpeg(img, img.naturalWidth, img.naturalHeight) }); }
      catch (e) { note.textContent = 'That file could not be read as an image.'; note.dataset.kind = 'err'; }
    }
    const pick = (accept, capture) => {
      const inp = h('input', { type: 'file', accept, hidden: true });
      if (capture) inp.setAttribute('capture', 'user');
      inp.addEventListener('change', () => { onFile(inp.files[0]); inp.remove(); });
      body.append(inp); inp.click();
    };
    const video = h('video', { class: 'pf-video', autoplay: true, playsinline: true });
    video.muted = true;
    const camBox = h('div', { class: 'pf-cam', hidden: true }, video,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', text: 'Cancel camera', onclick: closeCam }),
        h('button', { type: 'button', class: 'btn primary', text: 'Capture', onclick: () => {
          if (!video.videoWidth) return;
          setPending({ type: 'photo', data: toSquareJpeg(video, video.videoWidth, video.videoHeight) }); closeCam();
        } })));
    const sources = h('div', { class: 'pf-sources' },
      h('button', { type: 'button', class: 'btn', text: '⬆ Upload Photo', onclick: () => pick('image/png,image/jpeg,image/webp') }),
      h('button', { type: 'button', class: 'btn', text: '📷 Take a Photo', onclick: openCam }),
      h('button', { type: 'button', class: 'btn', text: '🖼 Choose From Gallery', onclick: () => pick('image/*') }));
    function closeCam() { stopCamera(); camBox.hidden = true; sources.hidden = false; grid.hidden = false; }
    async function openCam() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        note.textContent = 'The camera is not available here. Opening your camera app instead.'; note.dataset.kind = 'info'; pick('image/*', true); return;
      }
      try { st.cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }); }
      catch (e) { note.textContent = 'Camera access was blocked. Allow the camera for this site, or upload a photo instead.'; note.dataset.kind = 'err'; return; }
      video.srcObject = st.cam; camBox.hidden = false; sources.hidden = true; grid.hidden = true; note.textContent = '';
    }
    useBtn.addEventListener('click', async () => {
      useBtn.disabled = true; useBtn.textContent = 'Saving…';
      const v = current(); v.avatar = st.pending;
      const r = await persist(v);
      if (!r.ok) { note.textContent = r.error; note.dataset.kind = 'err'; useBtn.disabled = false; useBtn.textContent = 'Use this picture'; return; }
      closeModal(); renderAll();
      toast(r.where === 'cloud' ? 'Profile picture updated' : 'Picture saved on this device only');
    });
    const body = h('div', { class: 'pf-picker' }, preview, note, grid, camBox, sources,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: closeModal }), useBtn));
    openModal('Change Profile Picture', body);
    setPending(saved.avatar);
  }

  /* ---------- start up ---------- */
  fillForm(sanitize({}));        // empty but valid; real values arrive with profileSync()
  if (typeof auth !== 'undefined') {
    auth.onAuthStateChanged(u => { exitEdit(); if (u) loadCloud(); else { st.sync = 'idle'; refreshStatus(); } });
  }
})();