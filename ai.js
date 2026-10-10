TITLES.ai = 'AI Teacher';

/* AI Teacher: talks to your Cloudflare Worker, which picks the best available Gemini model. */
const AI_URL = 'https://broad-wildflower-c63e.rubal20agrawal13.workers.dev';
const aiHistory = [];

function aiAdd(role, text) {
  const chat = $('#ai-chat');
  const m = h('div', { class: 'msg ' + (role === 'user' ? 'user' : 'bot'), text });
  chat.append(m);
  chat.scrollTop = chat.scrollHeight;
  return m;
}
aiAdd('bot', "Hi there! I'm your AI Teacher. Ask me any study doubt.");

const aiTidy = s => s.replace(/^\s*#+\s*/, '').replace(/^\s*[-*]\s+/, '• ').replace(/\*\*|__|`/g, '').trim();

function aiType(el, text, chat) {
  return new Promise(done => {
    const words = text.split(' ');
    let i = 0;
    (function step() {
      el.textContent = words.slice(0, ++i).join(' ');
      chat.scrollTop = chat.scrollHeight;
      if (i < words.length) setTimeout(step, 28); else done();
    })();
  });
}

async function aiShow(wait, reply) {
  const chat = $('#ai-chat');
  wait.replaceChildren();
  for (const line of String(reply).split('\n').map(aiTidy).filter(Boolean)) {
    const p = h('div', { class: 'ai-line' });
    wait.append(p);
    await aiType(p, line, chat);
  }
}

$('#ai-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('#ai-input'), q = input.value.trim();
  if (!q) return;
  input.value = '';
  aiAdd('user', q);
  aiHistory.push({ role: 'user', content: q });
  const wait = aiAdd('bot', '');
  wait.classList.add('thinking');
  'Thinking...'.split('').forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.setProperty('--i', i);
    wait.append(s);
  });
  $('#ai-send').disabled = true;
  try {
    const r = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: aiHistory.slice(-12) })
    });
    const d = await r.json();
    wait.classList.remove('thinking');
    if (!d.reply) throw new Error('empty');
    await aiShow(wait, d.reply);
    if (r.ok) aiHistory.push({ role: 'assistant', content: d.reply }); else aiHistory.pop();
  } catch (err) {
    wait.classList.remove('thinking');
    wait.textContent = 'Could not reach AI Teacher. Check your internet and try again.';
    aiHistory.pop();
  }
  $('#ai-send').disabled = false;
  $('#ai-chat').scrollTop = $('#ai-chat').scrollHeight;
});