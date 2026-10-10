TITLES.cards = 'Flashcards Daily News';
const fcBox = $('#cards-box');
const WIKI = 'https://en.wikipedia.org/api/rest_v1/';
const fcDay = () => new Date().toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long' });
const fcMix = a => a.slice().sort(() => Math.random() - 0.5);
const fcGet = u => fetch(u, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
const fcClean = s => new DOMParser().parseFromString(String(s), 'text/html').body.textContent.trim();
const fcShort = s => String(s).split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');

let fcIdx = 0, fcBusy = false, fcTimer = null;
const fcReduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fcHead(right) {
  return h('div', { class: 'head' },
    h('div', { class: 'muted', text: "Today's facts · " + fcDay() }),
    h('div', { class: 'fc-meta' }, right,
      h('button', { class: 'btn', text: 'Refresh facts', onclick: () => { fcIdx = 0; fcLoad(true); } })));
}

function fcSlide(c, pos) {
  const el = h('button', {
    class: 'fc-slide fc-s' + pos, type: 'button',
    'aria-hidden': pos ? 'true' : null, tabindex: pos ? '-1' : null,
    'aria-label': 'Next card'
  },
    h('span', { class: 'pill other', text: c.cat }),
    h('h3', { text: c.title }),
    h('p', { class: 'muted', text: c.text }),
    h('span', { class: 'fc-hint muted small', text: 'Tap for next card' }));
  el.addEventListener('click', () => { if (el.classList.contains('fc-s0')) fcNext(); });
  return el;
}

function fcNext() {
  if (fcBusy) return;
  const stack = document.getElementById('fc-stack');
  const cur = stack && stack.querySelector('.fc-s0');
  if (!cur) return;
  fcBusy = true;
  const cards = data.dailyFacts.cards, n = cards.length;
  const [, nxt, third] = [...stack.querySelectorAll('.fc-slide')].reverse();
  cur.classList.add('out');
  if (nxt) { nxt.className = 'fc-slide fc-s0'; nxt.removeAttribute('aria-hidden'); nxt.tabIndex = 0; }
  if (third) third.className = 'fc-slide fc-s1';
  fcIdx++;
  if (cards[fcIdx + 2]) stack.prepend(fcSlide(cards[fcIdx + 2], 2));
  const cnt = document.querySelector('.fc-count');
  if (cnt && fcIdx < n) cnt.textContent = (fcIdx + 1) + ' of ' + n;
  fcTimer = setTimeout(() => {
    cur.remove(); fcBusy = false;
    if (fcIdx >= n) fcShow();
  }, fcReduce() ? 0 : 450);
}

function fcShow(msg) {
  clearTimeout(fcTimer); fcBusy = false;
  const cards = data.dailyFacts.cards, n = cards.length;
  if (fcIdx >= n) {
    return fill(fcBox, fcHead(null),
      h('div', { class: 'card fc-done' },
        h('div', { class: 'fc-done-ic', text: '🎉' }),
        h('h3', { text: 'All done!' }),
        h('p', { class: 'muted', text: "You've gone through all " + n + ' cards today.' }),
        h('button', { class: 'btn primary', text: 'Restart', onclick: () => { fcIdx = 0; fcShow(); } })));
  }
  const stack = h('div', { class: 'fc-stack', id: 'fc-stack' });
  for (let p = Math.min(2, n - fcIdx - 1); p >= 0; p--) stack.append(fcSlide(cards[fcIdx + p], p));
  fill(fcBox,
    fcHead(h('strong', { class: 'fc-count', 'aria-live': 'polite', text: (fcIdx + 1) + ' of ' + n })),
    msg ? h('p', { class: 'error', text: msg }) : null,
    stack);
}

async function fcLoad(force) {
  try {
  const f = data.dailyFacts;
  if (!force && f && f.date === dkey() && f.cards && f.cards.length) return fcShow();
  fill(fcBox, h('p', { class: 'muted', text: "Getting today's facts..." }));
  const seen = new Set(data.factHistory || []);
  const now = new Date(), y = now.getFullYear(), mm = pad(now.getMonth() + 1), dd = pad(now.getDate());
  const [feat, day, ...rand] = await Promise.all([
    fcGet(WIKI + 'feed/featured/' + y + '/' + mm + '/' + dd),
    fcGet(WIKI + 'feed/onthisday/events/' + mm + '/' + dd),
    ...[1, 2, 3, 4, 5].map(() => fcGet(WIKI + 'page/random/summary'))
  ]);
  const list = [], keys = new Set();
  const add = (cat, title, text) => {
    title = fcClean(title); text = fcClean(text);
    if (!title || text.length < 25 || keys.has(title) || seen.has(title)) return;
    keys.add(title); list.push({ cat, title, text });
  };
  ((feat && feat.news) || []).slice(0, 4).forEach(n => {
    if (list.filter(c => c.cat === 'In the news').length < 2) add('In the news', 'News today', n.story);
  });
  fcMix((day && day.events) || []).forEach(e => {
    if (list.filter(c => c.cat === 'On this day').length < 3) add('On this day', 'In the year ' + e.year, e.text);
  });
  rand.forEach(p => {
    if (p && p.extract && list.filter(c => c.cat === 'Did you know').length < 3) add('Did you know', p.title, fcShort(p.extract));
  });
  if (!list.length) {
    if (f && f.cards && f.cards.length) return fcShow('Could not get new facts. Showing your last ones.');
    fill(fcBox, h('p', { class: 'error', text: 'Could not load facts. Check your internet.' }),
      h('button', { class: 'btn primary', text: 'Try again', onclick: () => fcLoad(true) }));
    return;
  }
  data.factHistory = list.map(c => c.title).concat(data.factHistory || []).slice(0, 80);
  data.dailyFacts = { date: dkey(), cards: list.slice(0, 8) };
  saveData();
  fcShow();
} catch (e) {
    fill(fcBox, h('p', { class: 'error', text: 'Error: ' + e.message }));
  }
}

document.querySelectorAll('#nav button[data-page="cards"]').forEach(b => b.addEventListener('click', () => { fcIdx = 0; fcLoad(false); }));
if (document.querySelector('#cards-box')) {
  const t = setInterval(() => {
    if (typeof data !== 'undefined' && data) { clearInterval(t); fcLoad(false); }
  }, 300);
}