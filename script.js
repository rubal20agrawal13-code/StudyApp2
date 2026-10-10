'use strict';

/* =====================================================
   1. STORAGE  (all data lives in ONE localStorage key)
   ===================================================== */
let KEY = 'studyAppData';
let data;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function defaults() {
  return {
    tasks: [],
    subjects: ['Mathematics', 'Science', 'English', 'Hindi', 'SST', 'Sanskrit']
      .map(n => ({ id: uid(), name: n, progress: 0 })),
    goals: [], events: [], resources: [], focusSessions: [], notifs: [],
  };
}

function loadData() {
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) { data = null; }
  const d = defaults();
  if (!data || typeof data !== 'object') data = d;
  for (const k in d) if (!(k in data)) data[k] = d[k];
}

function saveData() { localStorage.setItem(KEY, JSON.stringify(data)); }

/* =====================================================
   2. HELPERS  (h() builds elements safely with textContent)
   ===================================================== */
const $ = s => document.querySelector(s);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EVENT_TYPES = ['Exam', 'Homework', 'School', 'Coaching', 'Other'];
const pad = n => String(n).padStart(2, '0');
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(c => {
    if (c == null || c === false) return;
    e.append(c.nodeType ? c : document.createTextNode(c));
  });
  return e;
}
function fill(el, ...kids) { el.replaceChildren(...kids.flat().filter(Boolean)); }
function dkey(d = new Date()) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function empty(title, sub) { return h('div', { class: 'empty' }, h('strong', { text: title }), h('span', { text: sub })); }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function prettyDate(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---- stats helpers used in several places ---- */
function taskStats() {
  const total = data.tasks.length, done = data.tasks.filter(t => t.completed).length;
  return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
}
function todayMinutes() { return data.focusSessions.filter(f => f.date === dkey()).reduce((a, f) => a + f.minutes, 0); }
function totalMinutes() { return data.focusSessions.reduce((a, f) => a + f.minutes, 0); }
function weekMinutes() {
  const out = [0, 0, 0, 0, 0, 0, 0], now = new Date();
  const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const keys = out.map((_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return dkey(d); });
  data.focusSessions.forEach(f => { const i = keys.indexOf(f.date); if (i >= 0) out[i] += f.minutes; });
  return out;
}
/* Streak: a day counts if a task was completed OR a focus session finished */
function streak() {
  const s = new Set();
  data.tasks.forEach(t => t.completedAt && s.add(dkey(new Date(t.completedAt))));
  data.focusSessions.forEach(f => s.add(f.date));
  const d = new Date();
  if (!s.has(dkey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (s.has(dkey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function barChart(vals, labels, suffix = 'm') {
  const max = Math.max(...vals, 1);
  return h('div', { class: 'bars', role: 'img', 'aria-label': 'Bar chart: ' + labels.map((l, i) => l + ' ' + vals[i] + suffix).join(', ') },
    vals.map((v, i) => h('div', { class: 'bar-col' },
      h('span', { class: 'bar-val', text: v ? v + suffix : '' }),
      h('div', { class: 'bar' }, v ? h('i', { style: 'height:' + (v / max * 100) + '%' }) : null),
      h('span', { class: 'bar-lbl', text: labels[i] }))));
}
function statCard(label, value, sub) {
  return h('div', { class: 'card stat' }, h('span', { class: 'muted small', text: label }), h('strong', { text: value }), h('span', { class: 'muted small', text: sub }));
}

/* =====================================================
   3. NAVIGATION
   ===================================================== */
const TITLES = { overview: 'Overview', missions: 'Missions', subjects: 'Subjects', tasks: 'Tasks', planner: 'Planner', goals: 'Goals', focus: 'Focus', analytics: 'Analytics', resources: 'Resources', settings: 'Settings' };

function go(page) {
  if (window.profileLeaveGuard && !window.profileLeaveGuard(page)) return;
  document.querySelectorAll('.page').forEach(s => s.classList.toggle('active', s.id === 'page-' + page));
  document.querySelectorAll('#nav button').forEach(b => {
    const on = b.dataset.page === page;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#page-title').textContent = TITLES[page];
  moveBubble();
  document.body.classList.remove('drawer');
  renderAll();
  window.scrollTo(0, 0);
}

/* =====================================================
   4. MODAL SYSTEM
   ===================================================== */
let lastFocus = null;

function openModal(title, content) {
  lastFocus = document.activeElement;
  $('#modal-title').textContent = title;
  fill($('#modal-body'), content);
  $('#modal').hidden = false;
  ($('#modal-body').querySelector('input,select,button') || $('#modal-close')).focus();
}
function closeModal() {
  $('#modal').hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
/* Generic form modal. onSave(values) may return an error string to block saving. */
function openForm(title, fields, onSave, label = 'Save') {
  const err = h('p', { class: 'error', role: 'alert' });
  const inputs = {};
  const rows = fields.map(f => {
    const id = 'f-' + f.name;
    const inp = f.type === 'select'
      ? h('select', { id }, f.options.map(o => h('option', { value: o, text: o, selected: o === f.value })))
      : h('input', { id, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', min: f.min, max: f.max });
    inputs[f.name] = inp;
    return h('label', { class: 'field', for: id }, h('span', { text: f.label }), inp);
  });
  const form = h('form', {
    onsubmit: e => {
      e.preventDefault();
      const v = {};
      for (const f of fields) {
        v[f.name] = inputs[f.name].value.trim();
        if (f.required && !v[f.name]) { err.textContent = f.label + ' is required.'; inputs[f.name].focus(); return; }
      }
      const problem = onSave(v);
      if (problem) { err.textContent = problem; return; }
      saveData(); closeModal(); renderAll();
    }
  }, rows, err, h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn', onclick: closeModal, text: 'Cancel' }),
    h('button', { type: 'submit', class: 'btn primary', text: label })));
  openModal(title, form);
}
function confirmBox(title, message, yesLabel, onYes) {
  openModal(title, h('div', {}, h('p', { class: 'muted', text: message }), h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: closeModal, text: 'Cancel' }),
    h('button', { class: 'btn danger', onclick: () => { closeModal(); onYes(); }, text: yesLabel }))));
}

/* =====================================================
   5. TASKS
   ===================================================== */
let taskFilter = 'all';

function addTaskForm() {
  const subs = data.subjects.map(s => s.name);
  openForm('Add Task', [
    { name: 'name', label: 'Task Name', required: true, placeholder: 'e.g. Revise Biology chapter 2' },
    { name: 'subject', label: 'Subject', type: 'select', options: subs.length ? subs : ['General'] },
    { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'], value: 'Medium' }
  ], v => {
    data.tasks.unshift({ id: uid(), name: v.name, subject: v.subject, priority: v.priority, completed: false, createdAt: Date.now(), completedAt: null });
  }, 'Save Task');
}
function toggleTask(id) {
  const t = data.tasks.find(x => x.id === id); if (!t) return;
  t.completed = !t.completed;
  t.completedAt = t.completed ? Date.now() : null;
  if (t.completed) {
    pushNotif('Task completed: ' + t.name);
    const st = streak();
    if ([3, 7, 14, 30].includes(st)) pushNotif('🔥 ' + st + '-day study streak!', 'streak-' + st);
  }
  saveData(); renderAll();
}
function deleteTask(id) { data.tasks = data.tasks.filter(t => t.id !== id); saveData(); renderAll(); }

function taskCard(t) {
  return h('div', { class: 'task' + (t.completed ? ' done' : '') },
    h('button', { class: 'check', role: 'checkbox', 'aria-checked': String(t.completed), 'aria-label': (t.completed ? 'Mark as not done: ' : 'Complete: ') + t.name, onclick: () => toggleTask(t.id), text: t.completed ? '✓' : '' }),
    h('div', { class: 'grow' }, h('div', { class: 't-name', text: t.name }), h('div', { class: 'muted small', text: t.subject + (t.completed ? ' — Completed' : '') })),
    h('span', { class: 'pill ' + t.priority.toLowerCase(), text: t.priority }),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Delete task ' + t.name, onclick: () => deleteTask(t.id), text: '🗑' }));
}
function renderTasks() {
  const list = data.tasks.filter(t => taskFilter === 'all' || (taskFilter === 'active' ? !t.completed : t.completed));
  fill($('#task-list'), list.length ? list.map(taskCard) : empty('No tasks yet', 'Create your first task to get started.'));
  document.querySelectorAll('#task-filters button').forEach(b => b.classList.toggle('active', b.dataset.f === taskFilter));
}

/* =====================================================
   6. OVERVIEW
   ===================================================== */
let ovWeekOffset = 0, ovDay = dkey();
const PRIO = { High: 3, Medium: 2, Low: 1 };
const OV_QUICK = [['📚', 'Subjects', 'subjects'], ['📅', 'Planner', 'planner'], ['⏱', 'Focus', 'focus'], ['🎓', 'AI Teacher', 'ai']];

function ovWeekStart(off) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + off * 7);
  return d;
}
function ovClock() {
  const now = new Date(), d = $('#ov-date'), t = $('#ov-time');
  if (d) d.textContent = now.toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' });
  if (t) t.textContent = now.toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' });
}
setInterval(ovClock, 30000);

/* donut ring: task completion */
function ovDonut(pct) {
  const R = 38, C = 2 * Math.PI * R;
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'ov-donut', role: 'img', 'aria-label': 'Task completion ' + pct + '%' });
  const defs = svgEl('defs', {}), lg = svgEl('linearGradient', { id: 'ovGrad', x1: 0, y1: 0, x2: 1, y2: 1 });
  lg.append(svgEl('stop', { offset: '0%', 'stop-color': '#F472B6' }), svgEl('stop', { offset: '50%', 'stop-color': '#A78BFA' }), svgEl('stop', { offset: '100%', 'stop-color': '#06B6D4' }));
  defs.append(lg);
  const g = svgEl('g', { transform: 'rotate(-90 50 50)' });
  g.append(svgEl('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'rgba(255,255,255,.08)', 'stroke-width': 10 }));
  if (pct > 0) g.append(svgEl('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'url(#ovGrad)', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-dasharray': (pct / 100 * C) + ' ' + C }));
  svg.append(defs, g,
    svgEl('text', { x: 50, y: 53, 'text-anchor': 'middle', class: 'ov-donut-num' }, pct + '%'),
    svgEl('text', { x: 50, y: 65, 'text-anchor': 'middle', class: 'ov-donut-sub' }, 'tasks done'));
  return svg;
}

/* smooth area/line chart: focus minutes Mon-Sun */
function ovLine(vals) {
  const W = 300, H = 118, L = 26, T = 8, B = 22, R = 8, iw = W - L - R, ih = H - T - B;
  const top = Math.max(30, Math.ceil(Math.max(...vals) / 30) * 30);
  const pts = vals.map((v, i) => [L + iw * i / (vals.length - 1), T + ih - v / top * ih]);
  let d = 'M' + pts[0][0] + ' ' + pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2;
    d += ' C' + cx + ' ' + y0 + ' ' + cx + ' ' + y1 + ' ' + x1 + ' ' + y1;
  }
  const base = T + ih, area = d + ' L' + pts[pts.length - 1][0] + ' ' + base + ' L' + pts[0][0] + ' ' + base + ' Z';
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'ov-line', role: 'img', 'aria-label': 'Focus minutes this week: ' + DAYS.map((n, i) => n + ' ' + vals[i]).join(', ') });
  const defs = svgEl('defs', {}), ag = svgEl('linearGradient', { id: 'ovArea', x1: 0, y1: 0, x2: 0, y2: 1 });
  ag.append(svgEl('stop', { offset: '0%', 'stop-color': '#8B5CF6', 'stop-opacity': '.55' }), svgEl('stop', { offset: '100%', 'stop-color': '#8B5CF6', 'stop-opacity': '0' }));
  defs.append(ag); svg.append(defs);
  [0, .5, 1].forEach(f => {
    const y = T + ih - f * ih;
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'rgba(255,255,255,.08)', 'stroke-width': 1 }),
      svgEl('text', { x: L - 5, y: y + 3, 'text-anchor': 'end' }, String(Math.round(top * f))));
  });
  svg.append(svgEl('path', { d: area, fill: 'url(#ovArea)' }),
    svgEl('path', { d, fill: 'none', stroke: '#A78BFA', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  const todayIdx = (new Date().getDay() + 6) % 7;
  pts.forEach((p, i) => {
    const c = svgEl('circle', { cx: p[0], cy: p[1], r: i === todayIdx && ovWeekOffset === 0 ? 4 : 2.5, fill: i === todayIdx && ovWeekOffset === 0 ? '#fff' : '#A78BFA', stroke: '#7C3AED', 'stroke-width': 1.5 });
    c.append(svgEl('title', {}, DAYS[i] + ': ' + vals[i] + ' min'));
    svg.append(c, svgEl('text', { x: p[0], y: H - 6, 'text-anchor': 'middle' }, DAYS[i]));
  });
  return svg;
}

function ovSummary(s) {
  const w = weekMinutes(), total = w.reduce((a, b) => a + b, 0);
  const subs = data.subjects, avg = subs.length ? Math.round(subs.reduce((a, x) => a + (x.progress || 0), 0) / subs.length) : 0;
  const st = streak();
  const legend = [
    ['#A78BFA', 'Tasks done', s.done + ' / ' + s.total],
    ['#EDE7D3', 'Focus today', todayMinutes() + ' min'],
    ['#F59E0B', 'Streak', st + (st === 1 ? ' day' : ' days')],
    ['#22C55E', 'Subjects avg', avg + '%']
  ];
  fill($('#ov-summary'),
    h('div', { class: 'card-top' }, h('h3', { text: 'My Overview' }), h('button', { class: 'ov-link', text: 'Analytics ›', onclick: () => go('analytics') })),
    h('div', { class: 'ov-sumrow' }, ovDonut(s.pct),
      h('ul', { class: 'ov-legend' }, legend.map(([c, l, v]) => h('li', {}, h('i', { style: 'background:' + c }), h('span', { text: l }), h('strong', { text: v }))))),
    h('div', { class: 'ov-linehead' }, h('strong', { text: 'Weekly Focus' }), h('span', { class: 'muted small', text: total + ' min this week' })),
    ovLine(w));
}

function ovSubjects() {
  const subs = data.subjects.slice().sort((a, b) => (b.progress || 0) - (a.progress || 0)).slice(0, 4);
  fill($('#ov-subjects'),
    h('div', { class: 'card-top' }, h('h3', { text: 'Subject Progress' }), h('button', { class: 'ov-link', text: 'View all ›', onclick: () => go('subjects') })),
    subs.length
      ? h('div', { class: 'ov-subs' }, subs.map(x => h('div', {},
          h('div', { class: 'ov-sub-top' }, h('span', { text: x.name }), h('strong', { text: (x.progress || 0) + '%' })),
          h('div', { class: 'ov-track', role: 'progressbar', 'aria-label': x.name + ' progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': x.progress || 0 },
            h('i', { style: 'width:' + (x.progress || 0) + '%' })))))
      : empty('No subjects yet', 'Add subjects to track your progress.'));
}

function ovCalendar() {
  const start = ovWeekStart(ovWeekOffset), today = dkey();
  const days = DAYS.map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDay = {}; data.events.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const fmt = d => d.toLocaleDateString('default', { day: 'numeric', month: 'short' });
  const shift = n => { ovWeekOffset += n; ovDay = ovWeekOffset === 0 ? dkey() : dkey(ovWeekStart(ovWeekOffset)); renderOverview(); };

  const strip = h('div', { class: 'ov-days', role: 'group', 'aria-label': 'Days of the week' }, days.map((d, i) => {
    const k = dkey(d);
    return h('button', {
      class: 'ov-day' + (k === ovDay ? ' sel' : '') + (k === today ? ' today' : ''), 'aria-pressed': String(k === ovDay),
      'aria-label': d.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long' }), onclick: () => { ovDay = k; renderOverview(); }
    }, h('small', { text: DAYS[i] }), h('strong', { text: String(d.getDate()) }), h('i', { class: 'dot' + (byDay[k] ? ' on' : '') }));
  }));

  const [y, m, dd] = ovDay.split('-').map(Number);
  const dayLbl = new Date(y, m - 1, dd).toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'short' });
  const evs = byDay[ovDay] || [];
  const mins = data.focusSessions.filter(f => f.date === ovDay).reduce((a, f) => a + f.minutes, 0);
  const blocks = evs.map(e => h('div', { class: 'ov-block ' + (e.type || 'Other').toLowerCase() },
    h('div', { class: 'grow' }, h('strong', { text: e.name }), h('span', { class: 'muted small', text: e.type || 'Other' }))));
  if (mins) blocks.push(h('div', { class: 'ov-block focus' }, h('div', { class: 'grow' }, h('strong', { text: 'Focus time' }), h('span', { class: 'muted small', text: mins + ' min studied' }))));

  const up = upcomingEvents().filter(e => e.date !== ovDay).slice(0, 3);
  fill($('#ov-calendar'),
    h('div', { class: 'card-top' }, h('h3', { text: 'Weekly Calendar' }),
      h('div', { class: 'ov-nav' },
        ovWeekOffset !== 0 ? h('button', { class: 'ov-link', text: 'Today', onclick: () => { ovWeekOffset = 0; ovDay = dkey(); renderOverview(); } }) : null,
        h('button', { class: 'icon-btn sm', 'aria-label': 'Previous week', text: '‹', onclick: () => shift(-1) }),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Next week', text: '›', onclick: () => shift(1) }))),
    h('p', { class: 'muted small ov-range', text: fmt(days[0]) + ' – ' + fmt(days[6]) }),
    strip,
    h('div', { class: 'ov-dayhead' }, h('strong', { text: dayLbl }), h('button', { class: 'btn ov-add', text: '+ Event', onclick: () => addEventForm(ovDay) })),
    blocks.length ? h('div', {}, blocks) : h('div', { class: 'ov-none', text: 'Nothing planned for this day.' }),
    up.length ? h('div', {}, h('h4', { class: 'ov-next-h', text: 'Coming up' }), h('div', { class: 'list' }, up.map(e => eventRow(e, false)))) : null);
}

function ovTasks() {
  const today = dkey();
  const pending = data.tasks.filter(t => !t.completed).sort((a, b) => (PRIO[b.priority] || 0) - (PRIO[a.priority] || 0) || (b.createdAt || 0) - (a.createdAt || 0));
  const doneToday = data.tasks.filter(t => t.completed && t.completedAt && dkey(new Date(t.completedAt)) === today);
  const list = pending.concat(doneToday).slice(0, 5);
  fill($('#ov-tasks'),
    h('div', { class: 'card-top' }, h('h3', { text: 'Upcoming Tasks' }),
      h('div', { class: 'ov-nav' }, h('button', { class: 'ov-link', text: 'View all ›', onclick: () => go('tasks') }), h('button', { class: 'btn ov-add', text: '+ Add', onclick: addTaskForm }))),
    list.length
      ? h('div', { class: 'ov-tasks' }, list.map(t => h('div', { class: 'ov-task' + (t.completed ? ' done' : '') },
          h('button', { class: 'ov-check', role: 'checkbox', 'aria-checked': String(t.completed), 'aria-label': (t.completed ? 'Mark as not done: ' : 'Complete: ') + t.name, onclick: () => toggleTask(t.id), text: t.completed ? '✓' : '' }),
          h('div', { class: 'grow' }, h('div', { class: 't-name', text: t.name }), h('div', { class: 'muted small', text: t.subject })),
          h('span', { class: 'pill ' + (t.completed ? 'done' : (t.priority || 'Medium').toLowerCase()), text: t.completed ? 'Done' : (t.priority || 'Medium') }))))
      : empty('No tasks yet', 'Create your first task to get started.'));
}

function ovQuick() {
  fill($('#ov-quick'), h('h3', { text: 'Quick Access' }),
    h('div', { class: 'ov-quick' }, OV_QUICK.map(([ic, lb, pg]) => h('button', { class: 'ov-q', onclick: () => go(pg) }, h('span', { class: 'ov-q-ic', text: ic }), h('span', { text: lb })))));
}

function renderOverview() {
  if (!$('#ov-summary')) return;
  const s = taskStats(), name = data.studentName || 'Student', p = data.profile || {};
  $('#greet').textContent = 'Welcome back, ' + name + '!';
  $('#ov-sub').textContent = [p.class, p.stream, p.school].filter(Boolean).join(' · ') || "Here's your study overview.";
  $('#ov-avatar').textContent = (name[0] || 'S').toUpperCase();
  ovClock();
  ovSummary(s); ovSubjects(); ovCalendar(); ovTasks(); ovQuick();
}
/* =====================================================
   7. SUBJECTS
   ===================================================== */
function addSubjectForm() {
  openForm('Add Subject', [
    { name: 'name', label: 'Name', required: true },
    { name: 'progress', label: 'Progress %', type: 'number', min: 0, max: 100, value: 0 }
  ], v => {
    if (data.subjects.some(s => s.name.toLowerCase() === v.name.toLowerCase())) return 'That subject already exists.';
    data.subjects.push({ id: uid(), name: v.name, progress: clamp(Number(v.progress) || 0, 0, 100) });
  });
}
function renderSubjects() {
  if (!data.subjects.length) return fill($('#subject-grid'), empty('No subjects yet', 'Add your first subject to start tracking.'));
  fill($('#subject-grid'), data.subjects.map(s => {
    const mine = data.tasks.filter(t => t.subject === s.name);
    const done = mine.filter(t => t.completed).length;
    const pct = h('strong', { text: s.progress + '%' });
    const bar = h('i', { style: 'width:' + s.progress + '%' });
    return h('div', { class: 'card' },
      h('div', { class: 'card-top' }, h('h3', { text: s.name }), pct),
      h('div', { class: 'progress' }, bar),
      h('input', {
        type: 'range', min: 0, max: 100, value: s.progress, 'aria-label': 'Progress for ' + s.name,
        oninput: e => { pct.textContent = e.target.value + '%'; bar.style.width = e.target.value + '%'; },
        onchange: e => { s.progress = Number(e.target.value); saveData(); renderAll(); }
      }),
      h('p', { class: 'muted small', text: mine.length + ' tasks · ' + done + ' completed' }),
      h('div', { class: 'card-actions' }, h('button', {
        class: 'btn danger', 'aria-label': 'Delete subject ' + s.name, text: 'Delete',
        onclick: () => confirmBox('Delete subject?', 'Delete "' + s.name + '"? Its tasks will stay.', 'Delete', () => { data.subjects = data.subjects.filter(x => x.id !== s.id); saveData(); renderAll(); })
      })));
  }));
}

/* =====================================================
   8. GOALS
   ===================================================== */
function addGoalForm() {
  openForm('Add Goal', [
    { name: 'name', label: 'Goal Name', required: true, placeholder: 'e.g. Complete Maths chapters' },
    { name: 'target', label: 'Target Number', type: 'number', min: 1, required: true, value: 10 }
  ], v => {
    const target = Math.floor(Number(v.target));
    if (!(target >= 1)) return 'Target must be 1 or more.';
    data.goals.push({ id: uid(), name: v.name, target, current: 0 });
  });
}
function changeGoal(g, delta) {
  g.current = clamp(g.current + delta, 0, g.target);
  if (delta > 0 && g.current >= g.target) pushNotif('Goal reached: ' + g.name, 'goal-' + g.id);
  saveData(); renderAll();
}
function renderGoals() {
  if (!data.goals.length) return fill($('#goal-grid'), empty('No goals yet', 'Set a goal and start making progress.'));
  fill($('#goal-grid'), data.goals.map(g => {
    const pct = Math.round(g.current / g.target * 100);
    return h('div', { class: 'card' },
      h('div', { class: 'card-top' }, h('h3', { text: g.name }), h('strong', { text: pct + '%' })),
      h('div', { class: 'progress' }, h('i', { style: 'width:' + pct + '%' })),
      h('p', { class: 'muted small', text: g.current + ' of ' + g.target + (g.current >= g.target ? ' — Goal reached!' : '') }),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn', 'aria-label': 'Decrease ' + g.name, text: '−', onclick: () => changeGoal(g, -1) }),
        h('button', { class: 'btn primary', 'aria-label': 'Increase ' + g.name, text: '+1', onclick: () => changeGoal(g, 1) }),
        h('button', { class: 'btn danger', text: 'Delete', 'aria-label': 'Delete goal ' + g.name, onclick: () => { data.goals = data.goals.filter(x => x.id !== g.id); saveData(); renderAll(); } })));
  }));
}

/* =====================================================
   9. PLANNER (events)
   ===================================================== */
function addEventForm(date) {
  openForm('Add Event', [
    { name: 'name', label: 'Event Name', required: true },
    { name: 'date', label: 'Date', type: 'date', required: true, value: date || dkey() },
    { name: 'type', label: 'Type', type: 'select', options: EVENT_TYPES }
  ], v => { data.events.push({ id: uid(), name: v.name, date: v.date, type: v.type }); });
}
function upcomingEvents() { return data.events.filter(e => e.date >= dkey()).sort((a, b) => a.date.localeCompare(b.date)); }
function eventRow(e, deletable = true) {
  return h('div', { class: 'row-item' },
    h('div', { class: 'grow' }, h('div', { text: e.name }), h('div', { class: 'muted small', text: prettyDate(e.date) })),
    h('span', { class: 'pill ' + e.type.toLowerCase(), text: e.type }),
    deletable ? h('button', { class: 'icon-btn sm', 'aria-label': 'Delete event ' + e.name, text: '🗑', onclick: () => { data.events = data.events.filter(x => x.id !== e.id); saveData(); renderAll(); } }) : null);
}

/* =====================================================
   10. CALENDAR
   ===================================================== */
let cal = new Date(); cal.setDate(1);

function renderCalendar() {
  const y = cal.getFullYear(), m = cal.getMonth();
  $('#cal-title').textContent = cal.toLocaleString('default', { month: 'long', year: 'numeric' });
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => h('div', { class: 'dow', text: d }));
  for (let i = 0; i < first; i++) cells.push(h('div', { class: 'day blank' }));
  for (let d = 1; d <= days; d++) {
    const k = y + '-' + pad(m + 1) + '-' + pad(d);
    const evs = data.events.filter(e => e.date === k);
    cells.push(h('button', {
      class: 'day' + (k === dkey() ? ' today' : ''),
      'aria-label': prettyDate(k) + (evs.length ? ', ' + evs.length + ' events' : '') + '. Add event',
      onclick: () => addEventForm(k)
    }, h('span', { text: d }),
      evs.slice(0, 2).map(e => h('em', { class: 'ev ' + e.type.toLowerCase(), text: e.name, title: e.type + ': ' + e.name })),
      evs.length > 2 ? h('em', { class: 'ev', text: '+' + (evs.length - 2) + ' more' }) : null));
  }
  fill($('#cal-grid'), cells);
  const all = [...data.events].sort((a, b) => a.date.localeCompare(b.date));
  fill($('#event-list'), all.length ? all.map(e => eventRow(e)) : empty('No events yet', 'Add exams, homework and classes to your planner.'));
}

/* =====================================================
   11. RESOURCES
   ===================================================== */
function normUrl(u) {
  u = u.trim(); if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
  try {
    const x = new URL(u);
    return (['http:', 'https:'].includes(x.protocol) && x.hostname.includes('.')) ? x.href : null;
  } catch (e) { return null; }
}
function addResourceForm() {
  openForm('Add Resource', [
    { name: 'name', label: 'Resource Name', required: true, placeholder: 'e.g. NCERT' },
    { name: 'url', label: 'URL', required: true, placeholder: 'ncert.nic.in' }
  ], v => {
    const url = normUrl(v.url);
    if (!url) return 'Enter a valid web address, like ncert.nic.in';
    data.resources.push({ id: uid(), name: v.name, url });
  });
}
function renderResources() {
  if (!data.resources.length) return fill($('#resource-grid'), empty('No resources yet', 'Save useful study links here.'));
  fill($('#resource-grid'), data.resources.map(r => h('div', { class: 'card' },
    h('h3', { text: r.name }), h('p', { class: 'res-url', text: r.url }),
    h('div', { class: 'card-actions' },
      h('a', { class: 'btn primary', href: r.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open', style: 'text-decoration:none' }),
      h('button', { class: 'btn danger', text: 'Delete', 'aria-label': 'Delete resource ' + r.name, onclick: () => { data.resources = data.resources.filter(x => x.id !== r.id); saveData(); renderAll(); } })))));
}

/* =====================================================
   12. FOCUS TIMER  (uses end timestamps so it stays accurate)
   ===================================================== */
const CIRC = 565.5;
const T = { total: 25 * 60, left: 25 * 60, status: 'Ready', endAt: 0, tick: null };
const fmt = s => pad(Math.floor(s / 60)) + ':' + pad(s % 60);

function setDuration(min) {
  if (T.status === 'Focusing') return toast('Pause the timer before changing the length.');
  min = clamp(Math.floor(min), 1, 240);
  T.total = T.left = min * 60; T.status = 'Ready';
  renderFocus();
}
function startTimer() {
  if (T.status === 'Focusing') return;
  if (T.left <= 0) T.left = T.total;
  T.endAt = Date.now() + T.left * 1000;
  T.status = 'Focusing';
  clearInterval(T.tick); T.tick = setInterval(tick, 250);
  renderFocus();
}
function pauseTimer() {
  if (T.status !== 'Focusing') return;
  clearInterval(T.tick);
  T.left = Math.max(0, Math.round((T.endAt - Date.now()) / 1000));
  T.status = 'Paused'; renderFocus();
}
function resetTimer() { clearInterval(T.tick); T.left = T.total; T.status = 'Ready'; renderFocus(); }
function tick() {
  T.left = Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000));
  if (T.left <= 0) finishTimer(); else renderFocus();
}
function finishTimer() {
  clearInterval(T.tick);
  T.left = 0; T.status = 'Completed';
  const min = Math.round(T.total / 60);
  data.focusSessions.push({ id: uid(), date: dkey(), minutes: min, subject: $('#focus-subject').value || 'General', at: Date.now() });
  pushNotif('Focus session complete: ' + min + ' min');
  saveData(); renderAll();
  openModal('Session complete', h('div', {}, h('p', { text: 'Nice work! You focused for ' + min + ' minutes.' }),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeModal, text: 'Done' }))));
}
function renderFocusSubjects() {
  const sel = $('#focus-subject'), cur = sel.value;
  const names = data.subjects.map(s => s.name);
  fill(sel, (names.length ? names : ['General']).map(n => h('option', { value: n, text: n })));
  if (names.includes(cur)) sel.value = cur;
}
const RING_STOPS = [[1,[21,128,61]],[.8,[34,197,94]],[.6,[163,230,53]],[.4,[245,158,11]],[.25,[249,115,22]],[.12,[248,113,113]],[0,[220,38,38]]];
function ringColor(f) {
  f = Math.max(0, Math.min(1, f));
  for (let i = 0; i < RING_STOPS.length - 1; i++) {
    const [a, ca] = RING_STOPS[i], [b, cb] = RING_STOPS[i + 1];
    if (f <= a && f >= b) { const t = (a - f) / (a - b); return 'rgb(' + ca.map((v, k) => Math.round(v + (cb[k] - v) * t)).join(',') + ')'; }
  }
  return 'rgb(220,38,38)';
}
function renderFocus() {
  $('#time').textContent = fmt(T.left);
  $('#status').textContent = T.status;
  $('#ring-fg').style.strokeDashoffset = String(CIRC * (1 - T.left / T.total));
  document.querySelector('.ring').style.setProperty('--ringc', ringColor(T.total ? T.left / T.total : 1));
  $('#t-start').disabled = T.status === 'Focusing';
  $('#t-pause').disabled = T.status !== 'Focusing';
  $('#t-start').textContent = T.status === 'Paused' ? 'Resume' : 'Start';
  document.querySelectorAll('#durations button').forEach(b => b.classList.toggle('active', Number(b.dataset.min) * 60 === T.total));
  document.title = T.status === 'Focusing' ? fmt(T.left) + ' · StudyApp' : 'StudyApp';
}

/* =====================================================
   13. ANALYTICS
   ===================================================== */
let anRange = '7', anDonutMode = 'tasks', anMetric = 'focus', reportOffset = 0;
const AN_RANGES = [['7', '7 days'], ['30', '30 days'], ['year', 'This year'], ['all', 'All time']];
const AN_COLORS = ['#D4AF37', '#F6E7B0', '#22C55E', '#C97B3C', '#8FA3B8', '#6B6455'];
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* small segmented control */
function seg(options, current, onPick, label) {
  return h('div', { class: 'an-seg', role: 'group', 'aria-label': label }, options.map(([v, t]) =>
    h('button', { class: v === current ? 'active' : '', 'aria-pressed': String(v === current), text: t, onclick: () => onPick(v) })));
}

/* time buckets for the chosen range */
function anBuckets(range) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const out = [];
  if (range === '7' || range === '30') {
    const n = Number(range);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      out.push({ label: n === 7 ? DAYS[(d.getDay() + 6) % 7] : d.getDate() + ' ' + HEAT_MONTHS[d.getMonth()], from: dkey(d), to: dkey(d) });
    }
    return out;
  }
  let start, end;
  if (range === 'year') { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear(), 11, 31); }
  else {
    const keys = data.focusSessions.map(f => f.date).concat(data.tasks.filter(t => t.completedAt).map(t => dkey(new Date(t.completedAt)))).sort();
    const [y, m] = (keys[0] || dkey(now)).split('-').map(Number);
    start = new Date(y, m - 1, 1); end = now;
    const minStart = new Date(now.getFullYear(), now.getMonth() - 5, 1), maxStart = new Date(now.getFullYear(), now.getMonth() - 23, 1);
    if (start > minStart) start = minStart;
    if (start < maxStart) start = maxStart;
  }
  for (const d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    const y = d.getFullYear(), m = d.getMonth();
    out.push({ label: HEAT_MONTHS[m] + (range === 'all' && m === 0 ? " '" + String(y).slice(2) : ''), from: y + '-' + pad(m + 1) + '-01', to: y + '-' + pad(m + 1) + '-31' });
  }
  return out;
}
function anSum(map, lo, hi) {
  const r = { minutes: 0, tasks: 0, sessions: 0, days: 0 };
  for (const k in map) {
    if (k < lo || k > hi) continue;
    const a = map[k]; r.minutes += a.minutes; r.tasks += a.tasks; r.sessions += a.sessions;
    if (heatScore(a) > 0) r.days++;
  }
  return r;
}
function anDelta(cur, prev) {
  if (!prev) return cur ? 'new this period' : 'no activity yet';
  const p = Math.round((cur - prev) / prev * 100);
  return (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% vs previous';
}
function anSubjectMinutes(lo, hi) {
  const m = {};
  data.focusSessions.forEach(f => { if (f.date >= lo && f.date <= hi) { const n = f.subject || 'General'; m[n] = (m[n] || 0) + f.minutes; } });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
function shortHours(m) { return m >= 60 ? (m / 60).toFixed(1).replace(/\.0$/, '') + 'h' : m + 'm'; }

/* multi-slice ring */
function anRing(slices, big, small, aria) {
  const R = 38, C = 2 * Math.PI * R, total = slices.reduce((a, s) => a + s.value, 0), used = slices.filter(s => s.value > 0).length;
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'ov-donut', role: 'img', 'aria-label': aria });
  const g = svgEl('g', { transform: 'rotate(-90 50 50)' });
  g.append(svgEl('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'rgba(255,255,255,.08)', 'stroke-width': 10 }));
  let off = 0;
  if (total) slices.forEach(s => {
    if (!s.value) return;
    const len = s.value / total * C, draw = used > 1 && len > 3 ? len - 1.5 : len;
    const c = svgEl('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: s.color, 'stroke-width': 10, 'stroke-dasharray': draw + ' ' + (C - draw), 'stroke-dashoffset': -off });
    c.append(svgEl('title', {}, s.label + ': ' + s.text));
    g.append(c); off += len;
  });
  svg.append(g, svgEl('text', { x: 50, y: 53, 'text-anchor': 'middle', class: 'ov-donut-num' }, big), svgEl('text', { x: 50, y: 65, 'text-anchor': 'middle', class: 'ov-donut-sub' }, small));
  return svg;
}

/* smooth area chart for any number of points */
function anLine(vals, labels, unit) {
  const W = 320, H = 150, L = 30, T = 8, B = 22, Rr = 8, iw = W - L - Rr, ih = H - T - B, n = vals.length;
  const mx = Math.max(0, ...vals);
  const steps = unit === 'min' ? [30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3000, 6000, 12000] : [4, 8, 12, 20, 40, 80, 120, 200, 400, 800];
  const top = steps.find(s => s >= mx) || Math.ceil(mx / 100) * 100;
  const px = i => L + (n > 1 ? iw * i / (n - 1) : iw / 2), py = v => T + ih - v / top * ih;
  const pts = vals.map((v, i) => [px(i), py(v)]);
  let d = 'M' + pts[0][0] + ' ' + pts[0][1];
  for (let i = 1; i < n; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += ' C' + cx + ' ' + y0 + ' ' + cx + ' ' + y1 + ' ' + x1 + ' ' + y1; }
  const base = T + ih;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'ov-line', role: 'img', 'aria-label': (unit === 'min' ? 'Focus minutes' : 'Tasks completed') + ' over time' });
  const defs = svgEl('defs', {}), ag = svgEl('linearGradient', { id: 'anArea', x1: 0, y1: 0, x2: 0, y2: 1 });
  ag.append(svgEl('stop', { offset: '0%', 'stop-color': '#8B5CF6', 'stop-opacity': '.55' }), svgEl('stop', { offset: '100%', 'stop-color': '#8B5CF6', 'stop-opacity': '0' }));
  defs.append(ag); svg.append(defs);
  [0, .5, 1].forEach(f => {
    const y = T + ih - f * ih;
    svg.append(svgEl('line', { x1: L, x2: W - Rr, y1: y, y2: y, stroke: 'rgba(255,255,255,.08)', 'stroke-width': 1 }), svgEl('text', { x: L - 5, y: y + 3, 'text-anchor': 'end' }, String(Math.round(top * f))));
  });
  svg.append(svgEl('path', { d: d + ' L' + pts[n - 1][0] + ' ' + base + ' L' + pts[0][0] + ' ' + base + ' Z', fill: 'url(#anArea)' }),
    svgEl('path', { d, fill: 'none', stroke: '#A78BFA', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  const step = Math.ceil(n / 7), unitTxt = unit === 'min' ? ' min' : (' task' + 's');
  pts.forEach((p, i) => {
    if (n <= 14) svg.append(svgEl('circle', { cx: p[0], cy: p[1], r: 3, fill: '#A78BFA', stroke: '#7C3AED', 'stroke-width': 1.5 }));
    const hit = svgEl('circle', { cx: p[0], cy: p[1], r: 5, fill: '#000', 'fill-opacity': 0 });
    hit.append(svgEl('title', {}, labels[i] + ': ' + vals[i] + unitTxt)); svg.append(hit);
    if ((n - 1 - i) % step === 0) svg.append(svgEl('text', { x: p[0], y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle' }, labels[i]));
  });
  return svg;
}

function renderAnalytics() {
  if (!$('#an-hero')) return;
  const s = taskStats(), map = activityMap(), now = new Date(); now.setHours(0, 0, 0, 0);
  const buckets = anBuckets(anRange);
  const lo = anRange === 'all' ? '0000-00-00' : buckets[0].from, hi = anRange === 'all' ? dkey(now) : buckets[buckets.length - 1].to;
  const tot = anSum(map, lo, hi);
  const numeric = anRange === '7' || anRange === '30', n = Number(anRange);
  let prev = { minutes: 0, tasks: 0 };
  if (numeric) {
    const to = new Date(now); to.setDate(now.getDate() - n);
    const from = new Date(now); from.setDate(now.getDate() - (2 * n - 1));
    prev = anSum(map, dkey(from), dkey(to));
  }
  const subjMin = anSubjectMinutes(lo, hi);
  const spanDays = anRange === 'all' ? null : (numeric ? n : Math.round((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1);

  /* range switch */
  fill($('#an-range'), seg(AN_RANGES, anRange, v => { anRange = v; renderAnalytics(); }, 'Time range'));

  /* KPI cards */
  fill($('#an-stats'),
    statCard('Focus time', fmtMin(tot.minutes), numeric ? anDelta(tot.minutes, prev.minutes) : tot.sessions + (tot.sessions === 1 ? ' session' : ' sessions')),
    statCard('Sessions', String(tot.sessions), tot.sessions ? 'avg ' + Math.round(tot.minutes / tot.sessions) + ' min each' : 'none yet'),
    statCard('Tasks done', String(tot.tasks), numeric ? anDelta(tot.tasks, prev.tasks) : 'completed'),
    statCard('Completion rate', s.pct + '%', s.done + ' of ' + s.total + ' tasks'),
    statCard('Active days', String(tot.days), spanDays ? 'of ' + spanDays + ' days' : 'all time'),
    statCard('Daily average', fmtMin(tot.days ? Math.round(tot.minutes / tot.days) : 0), 'per active day'),
    statCard('Current streak', streak() + (streak() === 1 ? ' day' : ' days'), 'longest ' + longestStreak(map)),
    statCard('Top subject', subjMin.length ? subjMin[0][0] : '—', subjMin.length ? fmtMin(subjMin[0][1]) : 'no focus yet'));

  /* hero: ring + trend */
  let slices, big, small;
  if (anDonutMode === 'tasks') {
    slices = [{ label: 'Completed', value: s.done, color: '#22C55E', text: s.done + ' tasks' }, { label: 'Pending', value: s.total - s.done, color: '#8B5CF6', text: (s.total - s.done) + ' tasks' }];
    big = s.pct + '%'; small = 'completed';
  } else if (anDonutMode === 'subjects') {
    const top = subjMin.slice(0, 5), rest = subjMin.slice(5).reduce((a, x) => a + x[1], 0);
    slices = top.map(([nm, v], i) => ({ label: nm, value: v, color: AN_COLORS[i], text: fmtMin(v) }));
    if (rest) slices.push({ label: 'Other', value: rest, color: AN_COLORS[5], text: fmtMin(rest) });
    big = shortHours(tot.minutes); small = 'focused';
  } else {
    slices = ['High', 'Medium', 'Low'].map((p, i) => { const c = data.tasks.filter(t => (t.priority || 'Medium') === p).length; return { label: p, value: c, color: ['#EF4444', '#F59E0B', '#22C55E'][i], text: c + (c === 1 ? ' task' : ' tasks') }; });
    big = String(s.total); small = 'tasks';
  }
  const hasSlices = slices.some(x => x.value > 0);
  const legend = hasSlices
    ? slices.filter(x => x.value > 0).map(x => h('li', {}, h('i', { style: 'background:' + x.color }), h('span', { text: x.label }), h('strong', { text: x.text })))
    : [h('li', {}, h('span', { text: anDonutMode === 'subjects' ? 'No focus sessions in this range' : 'No tasks yet' }))];

  const vals = buckets.map(b => { const r = anSum(map, b.from, b.to); return anMetric === 'focus' ? r.minutes : r.tasks; });
  const trendTotal = vals.reduce((a, b) => a + b, 0);
  fill($('#an-hero'), h('div', { class: 'an-heroin' },
    h('div', {},
      h('div', { class: 'card-top' }, h('h3', { text: 'Breakdown' }),
        seg([['tasks', 'Tasks'], ['subjects', 'Subjects'], ['priority', 'Priority']], anDonutMode, v => { anDonutMode = v; renderAnalytics(); }, 'Breakdown type')),
      h('div', { class: 'ov-sumrow' }, anRing(slices, big, small, 'Breakdown by ' + anDonutMode), h('ul', { class: 'ov-legend' }, legend))),
    h('div', {},
      h('div', { class: 'card-top' }, h('h3', { text: 'Trend' }),
        seg([['focus', 'Focus'], ['tasks', 'Tasks']], anMetric, v => { anMetric = v; renderAnalytics(); }, 'Trend metric')),
      h('p', { class: 'muted small an-trendtotal', text: anMetric === 'focus' ? fmtMin(trendTotal) + ' focused in this range' : trendTotal + ' tasks completed in this range' }),
      anLine(vals, buckets.map(b => b.label), anMetric === 'focus' ? 'min' : 'tasks'))));

  /* focus by subject */
  const subTotal = subjMin.reduce((a, x) => a + x[1], 0), subTop = subjMin.slice(0, 6);
  fill($('#an-subjects'),
    h('div', { class: 'card-top' }, h('h3', { text: 'Focus by Subject' }), h('span', { class: 'muted small', text: fmtMin(subTotal) })),
    subTop.length
      ? h('div', { class: 'ov-subs' }, subTop.map(([nm, v]) => h('div', {},
          h('div', { class: 'ov-sub-top' }, h('span', { text: nm }), h('strong', { text: fmtMin(v) + ' · ' + Math.round(v / subTotal * 100) + '%' })),
          h('div', { class: 'ov-track', role: 'progressbar', 'aria-label': nm, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(v / subjMin[0][1] * 100) }, h('i', { style: 'width:' + Math.round(v / subjMin[0][1] * 100) + '%' })))))
      : empty('No focus sessions yet', 'Finish a focus session to see your subjects here.'));

  /* best day of week */
  const wd = [0, 0, 0, 0, 0, 0, 0];
  for (const k in map) { if (k < lo || k > hi) continue; const [y, m, dd] = k.split('-').map(Number); wd[(new Date(y, m - 1, dd).getDay() + 6) % 7] += map[k].minutes; }
  const wdMax = Math.max(...wd), wdBest = wd.indexOf(wdMax);
  fill($('#an-weekday'),
    h('div', { class: 'card-top' }, h('h3', { text: 'Best Day of the Week' })),
    wdMax ? h('div', {}, h('p', { class: 'an-insight', text: 'Most productive: ' + FULL_DAYS[wdBest] + ' · ' + fmtMin(wdMax) }), barChart(wd, DAYS)) : empty('No focus sessions yet', 'Finish a focus session to see your best day.'));

  /* task completion by subject (all time) */
  const subs = [...new Set(data.tasks.map(t => t.subject))];
  fill($('#an-tasks'),
    h('div', { class: 'card-top' }, h('h3', { text: 'Task Completion by Subject' }), h('span', { class: 'muted small', text: 'all time' })),
    subs.length ? h('div', { class: 'ov-subs' }, subs.map(nm => {
      const all = data.tasks.filter(t => t.subject === nm), done = all.filter(t => t.completed).length, pct = Math.round(done / all.length * 100);
      return h('div', {}, h('div', { class: 'ov-sub-top' }, h('span', { text: nm }), h('strong', { text: done + '/' + all.length + ' · ' + pct + '%' })),
        h('div', { class: 'ov-track' }, h('i', { style: 'width:' + pct + '%' })));
    })) : empty('No task data yet', 'Add tasks to see completion by subject.'));

  /* goals */
  fill($('#an-goals'),
    h('div', { class: 'card-top' }, h('h3', { text: 'Goals' }), h('button', { class: 'ov-link', text: 'Manage ›', onclick: () => go('goals') })),
    data.goals.length ? h('div', { class: 'ov-subs' }, data.goals.map(g => {
      const pct = Math.round(clamp(g.current / g.target, 0, 1) * 100);
      return h('div', {}, h('div', { class: 'ov-sub-top' }, h('span', { text: g.name }), h('strong', { text: g.current + '/' + g.target + ' · ' + pct + '%' })),
        h('div', { class: 'ov-track' }, h('i', { style: 'width:' + pct + '%' })));
    })) : empty('No goals yet', 'Set a goal to track it here.'));
}

/* ---------- Personal records ---------- */
function renderRecords() {
  const el = $('#records'); if (!el) return;
  const map = activityMap(), days = Object.keys(map).filter(k => heatScore(map[k]) > 0);
  if (!days.length) return fill(el, empty('No records yet', 'Finish a focus session or complete a task to set your first record.'));
  const bestOf = f => days.reduce((b, k) => (f(map[k]) > f(map[b]) ? k : b), days[0]);
  const longest = data.focusSessions.reduce((b, f) => (b && b.minutes >= f.minutes ? b : f), null);
  const bestMin = bestOf(a => a.minutes), bestTask = bestOf(a => a.tasks);
  const weeks = {};
  days.forEach(k => { const [y, m, d] = k.split('-').map(Number), dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); const wk = dkey(dt); weeks[wk] = (weeks[wk] || 0) + map[k].minutes; });
  const bestWeek = Object.keys(weeks).reduce((b, k) => (b && weeks[b] >= weeks[k] ? b : k), null);
  const ls = longestStreak(map);
  fill(el, h('div', { class: 'heat-stats' },
    statCard('Longest session', longest ? fmtMin(longest.minutes) : '—', longest ? prettyDate(longest.date) : 'no sessions yet'),
    statCard('Best focus day', fmtMin(map[bestMin].minutes), prettyDate(bestMin)),
    statCard('Most tasks in a day', String(map[bestTask].tasks), map[bestTask].tasks ? prettyDate(bestTask) : 'none yet'),
    statCard('Longest streak', ls + (ls === 1 ? ' day' : ' days'), 'all time'),
    statCard('Best week', bestWeek ? fmtMin(weeks[bestWeek]) : '—', bestWeek ? 'week of ' + prettyDate(bestWeek) : 'none yet'),
    statCard('Total sessions', String(data.focusSessions.length), fmtMin(totalMinutes()) + ' overall')));
}

/* ---------- Weekly report ---------- */
function renderWeeklyReport() {
  const el = $('#weekly-report'); if (!el) return;
  const map = activityMap(), mon = ovWeekStart(reportOffset), sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const pmon = new Date(mon); pmon.setDate(mon.getDate() - 7); const psun = new Date(mon); psun.setDate(mon.getDate() - 1);
  const fmt = d => d.toLocaleDateString('default', { day: 'numeric', month: 'short' });
  $('#report-range').textContent = reportOffset === 0 ? 'This week' : fmt(mon) + ' – ' + fmt(sun);
  $('#report-prev').disabled = reportOffset <= -52; $('#report-next').disabled = reportOffset >= 0;
  const cur = anSum(map, dkey(mon), dkey(sun)), prv = anSum(map, dkey(pmon), dkey(psun));
  const vals = DAYS.map((_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); const a = map[dkey(d)]; return a ? a.minutes : 0; });
  const subj = anSubjectMinutes(dkey(mon), dkey(sun)), best = Math.max(...vals);
  if (!cur.minutes && !cur.tasks) return fill(el, empty('Nothing this week', 'No focus sessions or completed tasks in this week.'));
  fill(el,
    h('div', { class: 'heat-stats' },
      statCard('Focus time', fmtMin(cur.minutes), anDelta(cur.minutes, prv.minutes)),
      statCard('Sessions', String(cur.sessions), 'this week'),
      statCard('Tasks done', String(cur.tasks), anDelta(cur.tasks, prv.tasks)),
      statCard('Active days', cur.days + ' / 7', subj.length ? 'top: ' + subj[0][0] : 'no focus yet')),
    best ? h('p', { class: 'an-insight', text: 'Best day: ' + FULL_DAYS[vals.indexOf(best)] + ' · ' + fmtMin(best) }) : null,
    barChart(vals, DAYS));
}
const repPrev = $('#report-prev'), repNext = $('#report-next');
if (repPrev) repPrev.addEventListener('click', () => { reportOffset--; renderWeeklyReport(); });
if (repNext) repNext.addEventListener('click', () => { if (reportOffset < 0) { reportOffset++; renderWeeklyReport(); } });

/* =====================================================
   14. SEARCH
   ===================================================== */
function searchAll(q) {
  q = q.toLowerCase(); const r = [];
  const has = s => s.toLowerCase().includes(q);
  data.tasks.forEach(t => (has(t.name) || has(t.subject)) && r.push({ type: 'Task', label: t.name, page: 'tasks' }));
  data.subjects.forEach(s => has(s.name) && r.push({ type: 'Subject', label: s.name, page: 'subjects' }));
  data.goals.forEach(g => has(g.name) && r.push({ type: 'Goal', label: g.name, page: 'goals' }));
  data.resources.forEach(x => has(x.name) && r.push({ type: 'Resource', label: x.name, page: 'resources' }));
  data.events.forEach(e => has(e.name) && r.push({ type: 'Event', label: e.name, page: 'planner' }));
  return r.slice(0, 12);
}
function runSearch() {
  const q = $('#search').value.trim(), box = $('#search-results');
  if (!q) { box.hidden = true; return; }
  const res = searchAll(q);
  fill(box, res.length ? res.map(r => h('button', { onclick: () => { box.hidden = true; $('#search').value = ''; go(r.page); } },
    h('span', { text: r.label }), h('span', { class: 'muted small', text: r.type }))) : h('p', { text: 'No results found.' }));
  box.hidden = false;
}  
/* =====================================================
   15. NOTIFICATIONS
   ===================================================== */
function pushNotif(text, key) {
  if (key && data.notifs.some(n => n.key === key)) return;   // no duplicates
  data.notifs.unshift({ id: uid(), text, at: Date.now(), read: false, gone: false, key: key || null });
  data.notifs = data.notifs.slice(0, 60);
  saveData(); renderChrome();
}
function unreadCount() { return data.notifs.filter(n => !n.gone && !n.read).length; }
function timeAgo(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return m + ' min ago';
  const hr = Math.floor(m / 60);
  return hr < 24 ? hr + ' h ago' : Math.floor(hr / 24) + ' d ago';
}
/* Runs when the app opens: pending tasks, today's events, tomorrow's events */
function checkReminders() {
  const today = dkey(), tm = new Date(); tm.setDate(tm.getDate() + 1);
  const open = data.tasks.filter(t => !t.completed).length;
  if (open) pushNotif(open + ' task' + (open > 1 ? 's' : '') + ' still pending', 'pending-' + today);
  data.events.filter(e => e.date === today).forEach(e => pushNotif('Today: ' + e.name + ' (' + e.type + ')', 'ev-' + e.id + '-today'));
  data.events.filter(e => e.date === dkey(tm)).forEach(e => pushNotif(e.type === 'Exam' ? 'Exam tomorrow: ' + e.name : 'Tomorrow: ' + e.name, 'ev-' + e.id + '-tm'));
}
function openNotifications() {
  data.notifs.forEach(n => { n.read = true; });
  saveData(); renderChrome();
  const body = h('div', {});
  function draw() {
    const items = data.notifs.filter(n => !n.gone);
    fill(body,
      items.length ? items.map(n => h('div', { class: 'notif' },
        h('div', { class: 'grow' }, h('div', { text: n.text }), h('div', { class: 'muted small', text: timeAgo(n.at) })),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Dismiss notification', text: '✕', onclick: () => { n.gone = true; saveData(); draw(); } })))
        : empty("You're all caught up", 'New notifications will show up here.'),
      items.length ? h('div', { class: 'actions' }, h('button', { class: 'btn', text: 'Clear all', onclick: () => { data.notifs.forEach(x => { x.gone = true; }); saveData(); draw(); } })) : null);
  }
  draw();
  openModal('Notifications', body);
}
/* =====================================================
   16. PROFILE
   ===================================================== */
function openProfile() { go('profile'); }

/* =====================================================
   17. SETTINGS
   ===================================================== */
function saveName(v) {
  data.studentName = v.trim().slice(0, 40) || 'Student';
  saveData(); renderAll(); toast('Name saved');
}
function clearAll() {
  confirmBox('Clear all data?', 'Are you sure you want to delete all StudyApp data? This cannot be undone.', 'Delete Everything', () => {
    localStorage.removeItem(KEY);
    loadData(); saveData(); resetTimer(); go('overview'); toast('All data cleared');
  });
}

/* =====================================================
   18. RENDERING
   ===================================================== */
function renderChrome() {
  const initial = (data.studentName[0] || 'S').toUpperCase();
  $('#profile-btn').textContent = initial; $('#side-avatar').textContent = initial;
  $('#side-name').textContent = data.studentName;
 const unread = unreadCount(); $('#notif-count').textContent = unread ? String(unread) : '';
}
function renderAll() {
  renderOverview(); renderSubjects(); renderTasks(); renderCalendar(); renderGoals();
  renderFocusSubjects(); renderFocus(); renderAnalytics(); renderResources(); renderChrome();
  renderMissions();
  renderHeatmap();
  renderRecords(); renderWeeklyReport();
  renderSubjectPie();
  renderAbout();
  if (window.profileSync) window.profileSync();
}

/* =====================================================
   19. INITIALIZATION
   ===================================================== */
function init() {
  loadData(); saveData();

  document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('#add-task').addEventListener('click', addTaskForm);
  $('#add-subject').addEventListener('click', addSubjectForm);
  $('#add-goal').addEventListener('click', addGoalForm);
  $('#add-event').addEventListener('click', () => addEventForm());
  $('#add-resource').addEventListener('click', addResourceForm);
  document.querySelectorAll('#task-filters button').forEach(b => b.addEventListener('click', () => { taskFilter = b.dataset.f; renderTasks(); }));
  $('#cal-prev').addEventListener('click', () => { cal.setMonth(cal.getMonth() - 1); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { cal.setMonth(cal.getMonth() + 1); renderCalendar(); });

  $('#t-start').addEventListener('click', startTimer);
  $('#t-pause').addEventListener('click', pauseTimer);
  $('#t-reset').addEventListener('click', resetTimer);
  document.querySelectorAll('#durations button').forEach(b => b.addEventListener('click', () => setDuration(Number(b.dataset.min))));
  $('#custom-set').addEventListener('click', () => {
    const v = Number($('#custom-min').value);
    if (!(v >= 1)) return toast('Enter minutes between 1 and 240.');
    setDuration(v);
  });

  $('#search').addEventListener('input', runSearch);
  $('#search').addEventListener('focus', runSearch);
  document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#search-results').hidden = true; });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); $('#search-results').hidden = true; document.body.classList.remove('drawer'); }
  });

  $('#notif-btn').addEventListener('click', openNotifications);
  $('#profile-btn').addEventListener('click', openProfile);
  $('#sidebar-profile').addEventListener('click', openProfile);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('drawer'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('drawer'));

  $('#clear-data').addEventListener('click', clearAll);

  go('overview');
  checkReminders();
}
/* ===== SLIDING NAV BUBBLE ===== */
let bubbleY = null;
function moveBubble() {
  const nav = $('#nav'), b = $('#nav-bubble'), a = nav && nav.querySelector('button.active');
  if (!a || !b) return;
  const n = nav.getBoundingClientRect(), r = a.getBoundingClientRect();
  const x = r.left - n.left, y = r.top - n.top;
  b.style.width = r.width + 'px';
  b.style.height = r.height + 'px';
  if (bubbleY !== null && bubbleY !== y) {
    b.animate(
      [{ transform: 'translate(' + x + 'px,' + bubbleY + 'px)' }, { transform: 'translate(' + x + 'px,' + y + 'px)' }],
      { duration: 280, easing: 'cubic-bezier(.32,.72,0,1)' }
    );
  }
  b.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  bubbleY = y;
}
window.addEventListener('resize', () => { bubbleY = null; moveBubble(); });
window.addEventListener('load', () => { bubbleY = null; moveBubble(); });
/* =====================================================
   AI DAILY MISSIONS
   ===================================================== */
const DIFF_XP = { Easy: 10, Medium: 20, Hard: 30 };
let missionBusy = false;

function missionState() {
  if (!data.missions || typeof data.missions !== 'object') data.missions = { date: '', list: [], refreshes: 0 };
  if (typeof data.xp !== 'number') data.xp = 0;
  return data.missions;
}
function pendingTasksSorted() {
  const rank = { High: 0, Medium: 1, Low: 2 };
  return data.tasks.filter(t => !t.completed).sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 8);
}
function upcomingExams() {
  return data.events.filter(e => e.type === 'Exam' && e.date >= dkey()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
}
function daysUntil(k) {
  const [y, m, d] = k.split('-').map(Number), t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}

/* Build one clean mission object. XP always comes from difficulty, never from the AI. */
function mkMission(o) {
  const diff = DIFF_XP[o.difficulty] ? o.difficulty : 'Medium';
  return {
    id: uid(), title: String(o.title || 'Study mission').slice(0, 80), desc: String(o.desc || '').slice(0, 160),
    type: o.type, taskId: o.taskId || null, minutes: o.minutes || 0, count: o.count || 0,
    subject: o.subject ? String(o.subject).slice(0, 30) : '', difficulty: diff, xp: DIFF_XP[diff], done: false, rewarded: false
  };
}
/* Check what the AI sent before we trust it */
function cleanAI(arr, tasks) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  arr.slice(0, 5).forEach(m => {
    if (!m || typeof m.title !== 'string' || !m.title.trim()) return;
    const type = ['task', 'focus', 'tasks', 'manual'].includes(m.type) ? m.type : 'manual';
    const o = { title: m.title, desc: m.desc, subject: m.subject, difficulty: m.difficulty, type };
    if (type === 'task') {
      const t = tasks[Number(m.taskIndex)];
      if (t) o.taskId = t.id; else o.type = 'manual';
    }
    if (type === 'focus') o.minutes = clamp(Math.round(Number(m.minutes)) || 25, 10, 90);
    if (type === 'tasks') o.count = clamp(Math.round(Number(m.count)) || 2, 1, 5);
    out.push(mkMission(o));
  });
  return out.length >= 3 ? out : null;
}
/* Used when the AI is unavailable */
function fallbackMissions() {
  const list = [], tasks = pendingTasksSorted(), exams = upcomingExams();
  tasks.slice(0, 2).forEach(t => list.push(mkMission({ title: 'Finish: ' + t.name, desc: 'Complete this pending ' + t.subject + ' task.', type: 'task', taskId: t.id, subject: t.subject, difficulty: t.priority === 'High' ? 'Hard' : 'Medium' })));
  if (exams.length) list.push(mkMission({ title: 'Revise for ' + exams[0].name, desc: 'Exam in ' + daysUntil(exams[0].date) + ' day(s). Do a focused revision session.', type: 'focus', minutes: 30, difficulty: 'Hard' }));
  else list.push(mkMission({ title: 'Focus for 25 minutes', desc: 'Finish one session on the Focus page.', type: 'focus', minutes: 25, difficulty: 'Medium' }));
  list.push(mkMission({ title: 'Solve 10 practice questions', desc: 'Pick any subject and solve 10 questions.', type: 'manual', difficulty: 'Medium' }));
  list.push(mkMission({ title: "Revise yesterday's mistakes", desc: 'Go through the questions you got wrong yesterday.', type: 'manual', difficulty: 'Easy' }));
  return list.slice(0, 5);
}

async function generateMissions(force) {
  if (missionBusy) return;
  const st = missionState();
  missionBusy = true; renderMissions();
  const tasks = pendingTasksSorted(), exams = upcomingExams();
  let list = null;
  try {
    if (typeof AI_URL === 'undefined') throw new Error('AI is not available');
    const prompt = 'Create 4 daily study missions for a school student. Reply with ONLY a JSON array and no other text. '
      + 'Each item: {"title":"short","desc":"one sentence","type":"task|focus|tasks|manual","taskIndex":0,"minutes":25,"count":2,"subject":"name","difficulty":"Easy|Medium|Hard"}. '
      + 'Rules: type "task" means finish the pending task with that taskIndex from the list below; "focus" means study for N minutes (10-90); "tasks" means complete N tasks (1-5); '
      + '"manual" is for things like "Solve 10 questions" or "Revise yesterday\'s mistakes". Include at least one manual mission. '
      + 'Pending tasks: ' + (tasks.map((t, i) => i + ': ' + t.name + ' (' + t.subject + ', ' + t.priority + ')').join('; ') || 'none') + '. '
      + 'Upcoming exams: ' + (exams.map(e => e.name + ' in ' + daysUntil(e.date) + ' days').join('; ') || 'none') + '. '
      + 'Subjects: ' + data.subjects.map(s => s.name + ' ' + s.progress + '%').join(', ') + '.';
    const r = await fetch(AI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    const txt = String(d.reply || ''), a = txt.indexOf('['), b = txt.lastIndexOf(']');
    if (a >= 0 && b > a) list = cleanAI(JSON.parse(txt.slice(a, b + 1)), tasks);
  } catch (e) { console.warn('Mission AI failed, using fallback', e); }
  const prev = st.date === dkey() ? (st.refreshes || 0) : 0;
  st.date = dkey();
  st.list = list || fallbackMissions();
  st.source = list ? 'ai' : 'fallback';
  st.refreshes = force ? prev + 1 : 0;
  missionBusy = false;
  saveData(); renderMissions();
}

function completeMission(m) {
  if (m.done || m.rewarded) return;        // XP is paid only once
  m.done = true; m.rewarded = true;
  if (typeof epAward === 'function') epAward(m); else data.xp = (data.xp || 0) + m.xp;
  if (typeof pushNotif === 'function') pushNotif('Mission complete: ' + m.title + ' (+' + m.ep + ' EP)', 'mission-' + m.id);
}
function checkMissions() {
  const st = missionState(); let changed = false;
  const doneToday = data.tasks.filter(t => t.completed && t.completedAt && dkey(new Date(t.completedAt)) === dkey()).length;
  st.list.forEach(m => {
    if (m.done) return;
    let ok = false;
    if (m.type === 'task') { const t = data.tasks.find(x => x.id === m.taskId); ok = !!(t && t.completed); }
    else if (m.type === 'focus') ok = todayMinutes() >= m.minutes;
    else if (m.type === 'tasks') ok = doneToday >= m.count;
    if (ok) { completeMission(m); changed = true; }
  });
  return changed;
}
function missionProgress(m) {
  if (m.type === 'task') return 'Complete this task in Tasks';
  if (m.type === 'focus') return Math.min(todayMinutes(), m.minutes) + ' / ' + m.minutes + ' min focused today';
  if (m.type === 'tasks') {
    const n = data.tasks.filter(t => t.completed && t.completedAt && dkey(new Date(t.completedAt)) === dkey()).length;
    return Math.min(n, m.count) + ' / ' + m.count + ' tasks done today';
  }
  return 'Tap Mark done when finished';
}
function missionAction(m) {
  if (m.done) return null;
  if (m.type === 'focus') return h('button', { class: 'btn', text: 'Start Focus', onclick: () => go('focus') });
  if (m.type === 'task' || m.type === 'tasks') return h('button', { class: 'btn', text: 'Open Tasks', onclick: () => go('tasks') });
  return h('button', {
    class: 'btn primary', text: 'Mark done',
    onclick: () => confirmBox('Mark as done?', 'Only mark this mission done if you really finished it.', 'Yes, I did it', () => { completeMission(m); saveData(); renderAll(); })
  });
}
function missionCard(m) {
  const cls = { Easy: 'low', Medium: 'medium', Hard: 'high' }[m.difficulty];
  return h('div', { class: 'mission' + (m.done ? ' done' : '') },
    h('div', { class: 'm-top' }, h('span', { class: 'pill ' + cls, text: m.difficulty }), h('span', { class: 'm-xp', text: '+' + m.xp + ' EP' })),
    h('h3', { text: m.title }),
    h('p', { class: 'muted small', text: m.desc }),
    m.subject ? h('p', { class: 'muted small', text: 'Subject: ' + m.subject }) : null,
    h('div', { class: 'm-foot' }, h('span', { class: 'm-status', text: m.done ? '✓ Completed' : missionProgress(m) }), missionAction(m)));
}
function missionLoading() {
  const d = h('div', { class: 'thinking', role: 'status' });
  'Building your missions...'.split('').forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? '\u00A0' : ch;
    s.style.setProperty('--i', i);
    d.append(s);
  });
  return h('div', { class: 'empty' }, d);
}
function renderMissions() {
  const el = $('#mission-body'); if (!el) return;
  const st = missionState();
  const onPage = $('#page-missions').classList.contains('active');
  if (onPage && st.date !== dkey() && !missionBusy) { generateMissions(false); return; }   // new day: make fresh missions
  const fresh = st.date === dkey();
  const rb = $('#mission-refresh');
  const left = fresh ? 2 - (st.refreshes || 0) : 2;
  rb.textContent = 'New missions (' + left + ' left)';
  rb.disabled = missionBusy || !fresh || left <= 0 || st.list.some(m => m.done);
  if (missionBusy) return fill(el, missionLoading());
  if (!fresh || !st.list.length) return fill(el, empty('No missions yet', "Open this page to get today's missions."));
  if (checkMissions()) saveData();
  const total = st.list.length, done = st.list.filter(m => m.done).length;
  const ep = typeof epTotal === 'function' ? epTotal() : data.xp;
const lvl = Math.floor(ep / 100) + 1, into = ep % 100;
  fill(el,
    h('div', { class: 'card xp-card' },
      h('div', {}, h('div', { class: 'xp-level', text: 'Level ' + lvl }), h('div', { class: 'muted small', text: data.ep + ' EP total' })),
      h('div', { class: 'grow' },
        h('div', { class: 'card-top' }, h('span', { text: 'Today: ' + done + ' / ' + total + ' missions' }), h('span', { class: 'muted small', text: into + ' / 100 EP to next level' })),
        h('div', { class: 'progress' }, h('i', { style: 'width:' + (total ? done / total * 100 : 0) + '%' })))),
    h('div', { class: 'mission-grid' }, st.list.map(missionCard)),
    st.source === 'fallback' ? h('p', { class: 'muted small', text: 'AI was unavailable, so these are default missions based on your tasks.' }) : null);
}
$('#mission-refresh').addEventListener('click', () => {
  const st = missionState();
  if (st.list.some(m => m.done)) return toast('You can only refresh before completing a mission.');
  if ((st.refreshes || 0) >= 2) return toast('No refreshes left today.');
  generateMissions(true);
});
/* =====================================================
   STUDY HEATMAP
   ===================================================== */
let heatYear = new Date().getFullYear();
const HEAT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CELL = 17;   // 14px square + 3px gap

/* Real activity per day: completed tasks + focus sessions */
function activityMap() {
  const map = {};
  const get = k => map[k] || (map[k] = { tasks: 0, minutes: 0, sessions: 0 });
  data.tasks.forEach(t => { if (t.completed && t.completedAt) get(dkey(new Date(t.completedAt))).tasks++; });
  data.focusSessions.forEach(f => { const a = get(f.date); a.minutes += f.minutes; a.sessions++; });
  return map;
}
const heatScore = a => a ? a.minutes + a.tasks * 10 : 0;
function heatLevel(a) {
  const s = heatScore(a);
  if (!s) return 0;
  if (s < 20) return 1;
  if (s < 45) return 2;
  if (s < 90) return 3;
  return 4;
}
function longestStreak(map) {
  const days = Object.keys(map).filter(k => heatScore(map[k]) > 0).sort();
  let best = 0, run = 0, prev = null;
  days.forEach(k => {
    if (prev) {
      const [y, m, d] = prev.split('-').map(Number);
      run = dkey(new Date(y, m - 1, d + 1)) === k ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run); prev = k;
  });
  return best;
}
function sumRange(map, from, to) {
  let tasks = 0, minutes = 0, days = 0;
  Object.keys(map).forEach(k => {
    if (k < from || k > to) return;
    const a = map[k];
    tasks += a.tasks; minutes += a.minutes;
    if (heatScore(a) > 0) days++;
  });
  return { tasks, minutes, days };
}
function fmtMin(m) { return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'; }

function renderHeatmap() {
  const el = $('#heatmap'); if (!el) return;
  const now = new Date(), map = activityMap(), today = dkey(now), thisYear = now.getFullYear();
  $('#heat-year').textContent = heatYear;
  $('#heat-prev').disabled = heatYear <= thisYear - 5;
  $('#heat-next').disabled = heatYear >= thisYear;

  const hasData = Object.keys(map).some(k => heatScore(map[k]) > 0);
  const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const wk = sumRange(map, dkey(mon), dkey(sun));
  const mk = thisYear + '-' + pad(now.getMonth() + 1);
  const mo = sumRange(map, mk + '-01', mk + '-31');
  const yr = sumRange(map, heatYear + '-01-01', heatYear + '-12-31');
  const cur = streak(), best = longestStreak(map);
  const stats = h('div', { class: 'heat-stats' },
    statCard('Current streak', cur + (cur === 1 ? ' day' : ' days'), 'in a row'),
    statCard('Longest streak', best + (best === 1 ? ' day' : ' days'), 'all time'),
    statCard('Active days', String(yr.days), 'in ' + heatYear),
    statCard('Total study time', fmtMin(totalMinutes()), 'from focus sessions'),
    statCard('This week', fmtMin(wk.minutes), wk.tasks + ' tasks · ' + wk.days + ' active days'),
    statCard('This month', fmtMin(mo.minutes), mo.tasks + ' tasks · ' + mo.days + ' active days'));

  const jan1 = new Date(heatYear, 0, 1), lead = jan1.getDay();
  const totalDays = Math.round((new Date(heatYear, 11, 31) - jan1) / 86400000) + 1;
  const cols = Math.ceil((lead + totalDays) / 7);
  const detail = h('p', { class: 'heat-detail muted', role: 'status', 'aria-live': 'polite', text: 'Tap a square to see that day.' });
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'heat-cell out' }));
  for (let i = 0; i < totalDays; i++) {
    const k = dkey(new Date(heatYear, 0, 1 + i)), a = map[k];
    const label = prettyDate(k) + ': ' + (a && heatScore(a) > 0 ? a.tasks + (a.tasks === 1 ? ' task' : ' tasks') + ', ' + a.minutes + ' min focus' : 'No activity');
    cells.push(h('div', {
      class: 'heat-cell l' + heatLevel(a) + (k === today ? ' today' : ''),
      title: label, 'aria-label': label, onclick: () => { detail.textContent = label; }
    }));
  }
  const months = h('div', { class: 'heat-months', style: 'width:' + cols * CELL + 'px' });
  HEAT_MONTHS.forEach((name, m) => {
    const doy = Math.round((new Date(heatYear, m, 1) - jan1) / 86400000);
    months.append(h('span', { text: name, style: 'left:' + Math.floor((lead + doy) / 7) * CELL + 'px' }));
  });
  const grid = h('div', { class: 'heat-grid', role: 'group', 'aria-label': 'Study activity for ' + heatYear }, cells);
  const wrap = h('div', { class: 'heat-wrap' }, h('div', { class: 'heat-inner' }, months, grid));
  const dayLabels = h('div', { class: 'heat-days', 'aria-hidden': 'true' }, ['', 'Mon', '', 'Wed', '', 'Fri', ''].map(t => h('span', { text: t })));
  const legend = h('div', { class: 'heat-legend', 'aria-hidden': 'true' }, 'Less',
    [0, 1, 2, 3, 4].map(n => h('div', { class: 'heat-cell l' + n })), 'More');

  fill(el,
    hasData ? null : empty('No study activity yet', 'Complete a task or a focus session to light up your first square.'),
    stats, h('div', { class: 'heat-body' }, dayLabels, wrap), legend, detail);

  if (heatYear === thisYear) {
    const doy = Math.round((new Date(thisYear, now.getMonth(), now.getDate()) - jan1) / 86400000);
    wrap.scrollLeft = Math.max(0, Math.floor((lead + doy) / 7) * CELL - wrap.clientWidth + 80);
  }
}
const heatPrev = $('#heat-prev'), heatNext = $('#heat-next');
if (heatPrev) heatPrev.addEventListener('click', () => { heatYear--; renderHeatmap(); });
if (heatNext) heatNext.addEventListener('click', () => { heatYear++; renderHeatmap(); });
/* =====================================================
   SUBJECT PIE CHART
   ===================================================== */
const PIE_COLORS = ['#8B5CF6', '#06B6D4', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#3B82F6', '#14B8A6', '#A78BFA', '#F97316'];

function svgEl(tag, attrs, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
function renderSubjectPie() {
  const el = $('#subject-pie'); if (!el) return;
  const subs = data.subjects;
  if (!subs.length) return fill(el, empty('No subjects yet', 'Add subjects to see your progress chart.'));
  const total = subs.reduce((a, s) => a + s.progress, 0);
  if (!total) return fill(el, empty('No progress yet', 'Move a subject slider below to see your chart.'));
  const R = 38, C = 2 * Math.PI * R, avg = Math.round(total / subs.length);
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'pie-svg', role: 'img', 'aria-label': 'Subject progress: ' + subs.map(s => s.name + ' ' + s.progress + '%').join(', ') });
  const g = svgEl('g', { transform: 'rotate(-90 50 50)' });
  g.append(svgEl('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'rgba(255,255,255,.06)', 'stroke-width': 16 }));
  let offset = 0;
  subs.forEach((s, i) => {
    if (!s.progress) return;
    const len = s.progress / total * C, draw = len > 4 ? len - 1.6 : len;
    const c = svgEl('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: PIE_COLORS[i % PIE_COLORS.length], 'stroke-width': 16, 'stroke-dasharray': draw + ' ' + (C - draw), 'stroke-dashoffset': -offset });
    c.append(svgEl('title', {}, s.name + ': ' + s.progress + '%'));
    g.append(c);
    offset += len;
  });
  svg.append(g,
    svgEl('text', { x: 50, y: 52, 'text-anchor': 'middle', class: 'pie-center' }, avg + '%'),
    svgEl('text', { x: 50, y: 62, 'text-anchor': 'middle', class: 'pie-sub' }, 'average'));
  const legend = h('ul', { class: 'pie-legend' }, subs.map((s, i) =>
    h('li', {}, h('i', { style: 'background:' + PIE_COLORS[i % PIE_COLORS.length] }), h('span', { text: s.name }), h('strong', { text: s.progress + '%' }))));
  fill(el, h('div', { class: 'pie-wrap' }, svg, legend));
}

/* =====================================================
   ABOUT ME  (class decides the subject list)
   ===================================================== */
const STREAM_SUBJECTS = {
  'Science (PCM)': ['Physics', 'Chemistry', 'Mathematics', 'English', 'Computer Science'],
  'Science (PCB)': ['Physics', 'Chemistry', 'Biology', 'English', 'Physical Education'],
  'Commerce': ['Accountancy', 'Business Studies', 'Economics', 'English', 'Mathematics'],
  'Arts': ['History', 'Political Science', 'Geography', 'English', 'Economics']
};
function aboutState() {
  if (!data.profile || typeof data.profile !== 'object') data.profile = { class: '', stream: '', board: '', school: '', medium: '', goal: '', hours: '', about: '' };
  return data.profile;
}
function classNumber(c) { return parseInt(String(c || '').replace(/\D/g, ''), 10) || 0; }
function subjectsFor(cls, stream) {
  const n = classNumber(cls);
  if (!n) return null;
  if (n <= 5) return ['Mathematics', 'EVS', 'English', 'Hindi', 'General Knowledge'];
  if (n <= 10) return ['Mathematics', 'Science', 'English', 'Hindi', 'SST', 'Sanskrit'];
  return STREAM_SUBJECTS[stream] || null;
}
function syncStream() { $('#stream-wrap').hidden = classNumber($('#ab-class').value) < 11; }
function renderAbout() {
  if (!$('#ab-class')) return;
  const a = document.activeElement;
  if (a && a.closest && a.closest('#about-card')) return;   // do not overwrite while typing
  const p = aboutState();
  $('#ab-class').value = p.class; $('#ab-stream').value = p.stream; $('#ab-board').value = p.board;
  $('#ab-school').value = p.school; $('#ab-medium').value = p.medium; $('#ab-goal').value = p.goal;
  $('#ab-hours').value = p.hours; $('#ab-about').value = p.about;
  syncStream();
}
function applySubjects(list) {
  const old = data.subjects;
  data.subjects = list.map(n => old.find(s => s.name.toLowerCase() === n.toLowerCase()) || { id: uid(), name: n, progress: 0 });
  saveData(); renderAll(); toast('Subjects updated for your class');
}
function saveAbout() {
  const p = aboutState(), oldClass = p.class, oldStream = p.stream;
  p.class = $('#ab-class').value;
  p.stream = classNumber(p.class) >= 11 ? $('#ab-stream').value : '';
  p.board = $('#ab-board').value;
  p.school = $('#ab-school').value.trim().slice(0, 60);
  p.medium = $('#ab-medium').value;
  p.goal = $('#ab-goal').value.trim().slice(0, 80);
  const hrs = parseFloat($('#ab-hours').value);
  p.hours = isNaN(hrs) ? '' : clamp(hrs, 0, 16);
  p.about = $('#ab-about').value.trim().slice(0, 200);
  saveData();
  const list = subjectsFor(p.class, p.stream);
  const changed = oldClass !== p.class || oldStream !== p.stream;
  if (classNumber(p.class) >= 11 && !p.stream) { toast('Details saved. Pick a stream to set your subjects.'); return; }
  if (list && changed && data.subjects.map(s => s.name).join('|') !== list.join('|')) {
    confirmBox('Update your subjects?', 'Set your subjects for ' + p.class + (p.stream ? ' (' + p.stream + ')' : '') + ': ' + list.join(', ') + '. Progress in matching subjects is kept. Other subjects are removed, and your tasks stay.', 'Update subjects', () => applySubjects(list));
  } else toast('Details saved');
}
const abClass = $('#ab-class'), abSave = $('#save-about');
if (abClass) abClass.addEventListener('change', syncStream);
if (abSave) abSave.addEventListener('click', saveAbout);