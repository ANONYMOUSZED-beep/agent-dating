import { analyzePerson, corpus, fmtNum, REF } from './engine/analyze.js';
import { runDatingNight, rankAll, assess } from './engine/date.js';
import { SIGNALS } from './engine/taxonomy.js';

const KEY = 'agentic-dating-v2';
const $ = s => document.querySelector(s);
const app = $('#app'), modal = $('#modal');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms / (window.__speed || 1)));
let S = null; // { people:{}, order:[], speed:[], invites:[], dates:[], rankings:{} }

// ---------------- state ----------------
async function loadDemo() {
  const d = await (await fetch('demo/demo.json')).json();
  S = { people: Object.fromEntries(d.people.map(p => [p.id, p])), order: d.people.map(p => p.id), speed: d.speed, invites: d.invites, dates: d.dates, rankings: d.rankings, nightRun: true, demo: true };
  save();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* quota — keep in memory */ } }
async function init() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
  if (!S || !S.order?.length || new URLSearchParams(location.search).has('demo')) await loadDemo();
  window.addEventListener('hashchange', route); route();
}
const P = id => S.people[id];
const pool = () => S.order.map(P).filter(Boolean);
const av = (p, cls = '') => p.photo ? `<img class="av ${cls}" src="${esc(p.photo)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'av ${cls}',textContent:'${esc(p.first[0])}'}))">` : `<span class="av ${cls}">${esc(p.first[0])}</span>`;
const findDate = (a, b) => S.dates.find(d => (d.a === a && d.b === b) || (d.a === b && d.b === a));

// ---------------- router ----------------
function route() {
  const [_, page, a, b] = location.hash.split('/');
  document.querySelectorAll('[data-nav]').forEach(n => n.classList.toggle('on', n.dataset.nav === (page || 'home') || (page === 'p' && n.dataset.nav === 'home') || (page === 'date' && n.dataset.nav === 'night')));
  window.scrollTo(0, 0);
  if (page === 'p' && P(a)) return renderProfile(a);
  if (page === 'night') return renderNight(a);
  if (page === 'date' && P(a) && P(b)) return renderDate(a, b);
  if (page === 'rankings') return renderRankings(a);
  if (page === 'how') return renderHow();
  return renderHome();
}

// ---------------- home ----------------
function renderHome() {
  const ps = pool();
  app.innerHTML = `
  <section class="hero">
    <div>
      <h1>Every person gets an <span class="grad">agent</span>.<br/>The agents date.</h1>
      <p>Paste a LinkedIn and a public Instagram. An agent reads both, writes a profile — needs, hobbies, interests, personality — then goes speed-dating and on real dates with ${ps.length} other agents, and ranks who fits you best.</p>
      <div class="row"><a class="btn pri" href="#/night">▶ Watch the dating night</a><a class="btn" href="#/rankings">See rankings</a></div>
    </div>
    <div class="panel addform">
      <h2>Create an agent</h2>
      <label>LinkedIn profile URL</label><input id="li" placeholder="https://www.linkedin.com/in/…" autocomplete="off" />
      <label>Instagram profile URL (public)</label><input id="ig" placeholder="https://www.instagram.com/…" autocomplete="off" />
      <div class="row" style="margin-top:14px"><button class="btn pri" id="add">Create agent & read profile</button><button class="btn sm" id="bulkT">Bulk paste</button></div>
      <div id="bulkBox" class="hidden" style="display:none;margin-top:10px"><textarea id="bulk" rows="5" placeholder="One person per line: <linkedin url> <instagram url>"></textarea><button class="btn sm" id="bulkGo" style="margin-top:8px">Add all</button></div>
      <div class="err" id="err"></div>
    </div>
  </section>
  <div class="row" style="margin-bottom:12px"><h2 style="margin:0">The pool · ${ps.length} people</h2><span class="sp"></span>
    <span class="small mute">${S.demo ? 'Pre-scraped example loaded' : 'Custom pool'}</span><button class="btn sm" id="reset">Reset to example</button></div>
  <div class="grid">${ps.map(p => `
    <a class="card" href="#/p/${p.id}"><div class="top2">${av(p)}<div><div class="nm">${esc(p.name)}</div><div class="ar">${esc(p.archetype)}</div></div></div>
    <div class="chips">${p.hobbies.slice(0, 3).map(h => `<span class="chip">${esc(h.label)}</span>`).join('')}</div></a>`).join('')}</div>`;
  $('#add').onclick = () => addPerson($('#li').value, $('#ig').value);
  $('#bulkT').onclick = () => { const b = $('#bulkBox'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; };
  $('#bulkGo').onclick = async () => {
    const lines = $('#bulk').value.split('\n').map(l => l.trim()).filter(Boolean);
    for (const l of lines) { const li = l.match(/\S*linkedin\.com\/in\/\S+/i)?.[0], ig = l.match(/\S*instagram\.com\/\S+/i)?.[0]; if (li && ig) await addPerson(li, ig, { bulk: true }); }
    closeModal(); route();
  };
  $('#reset').onclick = async () => { if (confirm('Reset to the pre-scraped example? People you added will be removed.')) { localStorage.removeItem(KEY); await loadDemo(); route(); } };
}

// ---------------- add a person: scrape -> read -> profile ----------------
async function addPerson(li, ig, { bulk = false } = {}) {
  const err = $('#err'); if (err) err.textContent = '';
  if (!/linkedin\.com\/in\//i.test(li) || !/instagram\.com\/|^@?[\w.]+$/i.test(ig.trim())) { if (err) err.textContent = 'Paste a LinkedIn profile URL (linkedin.com/in/…) and an Instagram profile URL.'; return; }
  openModal(`<h2>🤖 Your agent is reading…</h2><div id="steps"></div><div class="scan hidden" id="scan" style="display:none"></div><div class="counters" id="counters"></div><div id="mfoot" style="margin-top:14px"></div>`);
  const steps = $('#steps');
  const step = (txt) => { const d = document.createElement('div'); d.className = 'step'; d.innerHTML = `<span class="ic"><span class="spin"></span></span><span>${txt}</span>`; steps.appendChild(d); return { done: (t, ok = true) => { d.querySelector('.ic').innerHTML = ok ? '✅' : '❌'; if (t) d.lastChild.innerHTML = t; } }; };
  const s1 = step(`Scraping LinkedIn <span class="mute small">${esc(li)}</span> and Instagram <span class="mute small">${esc(ig)}</span> via Apify…`);
  let raw;
  try {
    const r = await fetch('api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedin: li, instagram: ig }) });
    raw = await r.json(); if (!r.ok) throw new Error(raw.error || 'Scrape failed');
  } catch (e) { s1.done(`Scrape failed: ${esc(e.message)}`, false); $('#mfoot').innerHTML = `<button class="btn" onclick="document.getElementById('modal').classList.add('hidden')">Close</button>`; return; }
  s1.done(`Scraped <b>${esc(raw.linkedin.name)}</b> — LinkedIn: ${raw.linkedin.positions.length} positions, ${raw.linkedin.about ? 'about section' : 'no about'} · Instagram: @${esc(raw.instagram.username)}, ${fmtNum(raw.instagram.followers)} followers, ${raw.instagram.posts.length} posts`);
  await readAnimation(raw);
  const p = analyzePerson(raw); p.raw = raw;
  const s3 = step('Writing the profile: needs, hobbies, interests, traits…'); await sleep(600);
  s3.done(`Profile ready: <b>${esc(p.archetype)}</b> · needs: ${p.needs.slice(0, 3).map(n => esc(n.label.toLowerCase())).join('; ')}`);
  // replace if exists
  S.speed = S.speed.filter(d => d.a !== p.id && d.b !== p.id); S.dates = S.dates.filter(d => d.a !== p.id && d.b !== p.id); S.invites = S.invites.filter(i => i.from !== p.id && i.to !== p.id);
  S.people[p.id] = p; if (!S.order.includes(p.id)) S.order.unshift(p.id); S.demo = false;
  S.rankings = rankAll(pool(), S.speed, S.dates); save();
  if (bulk) return p;
  $('#mfoot').innerHTML = `<div class="row"><a class="btn pri" href="#/p/${p.id}" id="openP">Open ${esc(p.first)}'s profile →</a><a class="btn" href="#/night/${p.id}" id="goDate">Send ${esc(p.first)}'s agent on dates 💘</a></div>`;
  $('#openP').onclick = closeModal; $('#goDate').onclick = closeModal;
  return p;
}
const KW = SIGNALS.flatMap(s => s.kw.filter(k => /[a-z]/i.test(k) && k.length > 3).map(k => k));
const KW_RE = new RegExp(`\\b(${KW.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
const highlight = t => esc(t).replace(KW_RE, '<mark>$1</mark>');
async function readAnimation(raw) {
  const scan = $('#scan'); if (!scan) return; scan.style.display = 'block';
  const units = corpus(raw), counters = $('#counters'); const found = {};
  const s = document.createElement('div'); s.className = 'step'; s.innerHTML = `<span class="ic"><span class="spin"></span></span><span>Reading ${units.length} text units from both profiles…</span>`; $('#steps').appendChild(s);
  for (let i = 0; i < units.length; i++) {
    const u = units[i]; const div = document.createElement('div'); div.innerHTML = `<span class="mute small">${esc(u.source)}</span> · ${highlight(u.text.slice(0, 180))}`; scan.prepend(div);
    for (const sg of SIGNALS) if (sg.kw.some(k => u.text.toLowerCase().includes(k.toLowerCase()))) found[sg.id] = (found[sg.id] || 0) + 1;
    if (i % 3 === 0) counters.innerHTML = Object.entries(found).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([id, n]) => `<span class="chip v">${esc(SIGNALS.find(x => x.id === id).label)} · ${n}</span>`).join('');
    await sleep(Math.max(15, 2600 / units.length));
  }
  s.querySelector('.ic').innerHTML = '✅';
}
function openModal(html) { modal.innerHTML = `<div class="mbox">${html}</div>`; modal.classList.remove('hidden'); }
function closeModal() { modal.classList.add('hidden'); }
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

// ---------------- profile ----------------
function bars(obj, labels) { return Object.entries(obj).map(([k, v]) => `<div class="trait"><span>${esc(labels?.[k] || k)}</span><div class="bar"><i style="width:${v}%"></i></div><span>${v}</span></div>`).join(''); }
const evHtml = e => e ? `<div class="ev"><span class="src">${esc(e.source)}</span>“${esc(e.text)}”</div>` : '';
function renderProfile(id) {
  const p = P(id), rk = (S.rankings[id] || []).slice(0, 5), myDates = S.dates.filter(d => d.a === id || d.b === id);
  const raw = p.raw;
  app.innerHTML = `
  <div class="phead">${av(p, 'lg')}<div class="sp">
    <h1>${esc(p.name)}</h1><div class="arch">${esc(p.archetype)}</div><div class="mute">${esc(p.headline)}${p.location ? ' · ' + esc(p.location) : ''}</div>
    <div class="links" style="margin-top:8px"><a href="${esc(p.links.linkedin)}" target="_blank" rel="noopener">in LinkedIn ↗</a><a href="${esc(p.links.instagram)}" target="_blank" rel="noopener">◎ Instagram @${esc(p.username)} ↗</a></div>
    <div class="stats"><div><b>${fmtNum(p.stats.igFollowers)}</b>Instagram followers</div><div><b>${p.stats.postsRead}</b>posts read</div><div><b>${p.stats.units}</b>text units</div><div><b>${p.stats.words.toLocaleString()}</b>words analyzed</div><div><b>${myDates.length}</b>dates</div></div>
  </div><div class="row"><a class="btn pri" href="#/rankings/${id}">${esc(p.first)}'s ranking →</a><a class="btn" href="#/night/${id}">Send on new dates</a></div></div>
  <div class="pgrid">
    <div class="panel c12"><h3>🤖 The agent's read</h3><div class="read">${esc(p.summary)}</div></div>
    <div class="panel c6"><h3>❤️ Needs in a partner</h3>${p.needs.map(n => `<div class="need"><div class="row"><span class="t">${esc(n.label)}</span><span class="sp"></span><span class="small mute">${n.weight}</span></div><div class="bar"><i style="width:${n.weight}%"></i></div><div class="why">${esc(n.why)}</div>${evHtml(n.evidence)}</div>`).join('')}</div>
    <div class="panel c6"><h3>🎯 Hobbies — what they do</h3>${p.hobbies.map(h => `<div class="hob"><div class="row"><b>${esc(h.label)}</b><span class="small mute">${h.score}</span></div>${evHtml(h.evidence.find(e => e.source.startsWith('Instagram')) || h.evidence[0])}</div>`).join('') || '<span class="mute">Almost no leisure in public data — the agent flags them as work-first.</span>'}</div>
    <div class="panel c4"><h3>💡 Interests — what they think about</h3><div class="chips">${p.interests.map(i => `<span class="chip p" title="${esc(i.evidence[0]?.text || '')}">${esc(i.label)} · ${i.score}</span>`).join('')}</div>
      <h3 style="margin-top:18px">💬 Communication style</h3><b>${esc(p.commStyle.label)}</b><div class="small mute">${esc(p.commStyle.detail)}</div>
      <h3 style="margin-top:18px">💌 Love language (inferred)</h3><b>${esc(p.loveLanguage.primary)}</b> <span class="mute">then ${esc(p.loveLanguage.secondary)}</span><div class="small mute">${esc(p.loveLanguage.why)}</div></div>
    <div class="panel c4"><h3>🧠 Personality</h3>${bars(p.traits)}<div class="small mute" style="margin-top:6px">Archetype uses traits relative to the pool average.</div></div>
    <div class="panel c4"><h3>🏡 Lifestyle</h3>${bars(p.lifestyle, { workIntensity: 'work intensity', activity: 'activity', social: 'social', travel: 'travel', familyFocus: 'family focus', publicLife: 'public life' })}<h3 style="margin-top:16px">⚖️ Values</h3>${bars(Object.fromEntries(Object.entries(p.values).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)))}</div>
    <div class="panel c4"><h3>✅ What they bring</h3><ul class="clean">${p.offers.map(o => `<li>${esc(o)}</li>`).join('')}</ul><h3 style="margin-top:16px">⚠️ Watch-outs</h3><ul class="clean">${p.watchouts.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>
    <div class="panel c4"><h3>🔎 Ideal partner</h3><div>${esc(p.idealPartner)}</div><h3 style="margin-top:16px">🗺️ Agent's dating strategy</h3><ul class="clean small">${p.datingStrategy.openers.map(o => `<li>${esc(o)}</li>`).join('')}${p.datingStrategy.mustAsk.map(o => `<li><b>Ask:</b> ${esc(o)}</li>`).join('')}</ul></div>
    <div class="panel c4"><h3>🍷 Date ideas</h3><ul class="clean">${p.dateIdeas.map(d => `<li>${esc(d.idea)}</li>`).join('') || '<li>Dinner somewhere quiet</li>'}</ul>
      <h3 style="margin-top:16px">🏆 Top matches</h3>${rk.map((r, i) => `<a class="row" style="margin:6px 0" href="#/p/${r.id}">${av(P(r.id), 'sm')}<span>${i + 1}. ${esc(P(r.id).name)}</span><span class="sp"></span><b>${r.fit}</b>${r.mutual ? '<span class="badge b-mut">♥</span>' : ''}</a>`).join('') || '<span class="mute small">Not dated yet — send the agent out.</span>'}</div>
    <div class="panel c6"><h3>🔬 How the agent read ${esc(p.first)}</h3><div class="log">${p.reading.map(r => `<div><span class="k">▸ ${esc(r.step)}</span><br/>${esc(r.detail)}</div>`).join('')}</div></div>
    <div class="panel c6"><h3>📄 Source text (keywords the agent matched are highlighted)</h3><div class="src-text">
      ${raw ? `<p><b>LinkedIn headline:</b> ${highlight(raw.linkedin.headline)}</p>${raw.linkedin.about ? `<p><b>LinkedIn about:</b> ${highlight(raw.linkedin.about.slice(0, 900))}</p>` : ''}<p><b>Instagram bio:</b> ${highlight(raw.instagram.bio)}</p>${raw.instagram.posts.map(x => `<p><b>Post${x.location ? ' · ' + esc(x.location) : ''}:</b> ${highlight(x.caption.slice(0, 400))}</p>`).join('')}` : '<span class="mute">Raw text not stored.</span>'}
    </div></div>
    <div class="panel c12"><h3>📅 ${esc(p.first)}'s dates</h3><div class="grid">${myDates.map(d => dateCard(d, id)).join('') || '<span class="mute">No dates yet.</span>'}</div></div>
  </div>`;
}
function dateCard(d, perspective) {
  const a = P(d.a), b = P(d.b); if (!a || !b) return '';
  return `<a class="dcard" href="#/date/${d.a}/${d.b}"><div class="pair">${av(a, 'sm')}${av(b, 'sm')}</div><div class="sp"><div style="font-weight:600;font-size:14px">${esc(a.first)} × ${esc(b.first)}</div><div class="small mute">${esc(d.venue.idea)}</div></div><div style="text-align:right"><b>${Math.round((d.scoreAB + d.scoreBA) / 2)}</b><div>${d.mutual ? '<span class="badge b-mut">♥ match</span>' : '<span class="badge b-n">no 2nd</span>'}</div></div></a>`;
}

// ---------------- dating night ----------------
function renderNight(focusId) {
  const focus = focusId && P(focusId);
  const ps = pool(), n = ps.length;
  app.innerHTML = `
  <div class="row" style="margin-bottom:14px"><div><h1 style="font-size:36px">${focus ? `${esc(focus.first)}'s agent goes dating` : 'Dating night'}</h1><div class="mute">${focus ? `Speed-dates every agent in the pool, invites its favourites, and goes on full dates.` : `${n} agents · every pair speed-dates · agents send invitations · accepted invitations become full dates.`}</div></div><span class="sp"></span>
  <button class="btn pri" id="run">${focus ? `▶ Start ${esc(focus.first)}'s dates` : S.nightRun ? '↻ Replay the night' : '▶ Start dating night'}</button></div>
  <div class="pgrid">
    <div class="panel c4"><div class="round" id="r1"><span class="n">1</span><b>Speed dating</b><span class="sp"></span><span class="mute small" id="c1"></span></div>
      <div class="matrix" id="mx" style="grid-template-columns:repeat(${n},1fr)">${ps.map(a => ps.map(b => `<i data-k="${a.id}|${b.id}"></i>`).join('')).join('')}</div>
      <div class="small mute" style="margin-top:8px">Each cell = how much the row's agent liked the column's agent after a 90-second speed date.</div></div>
    <div class="panel c4"><div class="round" id="r2"><span class="n">2</span><b>Invitations</b><span class="sp"></span><span class="mute small" id="c2"></span></div><div class="feed" id="feed"></div></div>
    <div class="panel c4"><div class="round" id="r3"><span class="n">3</span><b>Full dates</b><span class="sp"></span><span class="mute small" id="c3"></span></div><div id="dl" style="display:flex;flex-direction:column;gap:8px;max-height:380px;overflow:auto"></div></div>
  </div>
  <div id="after" style="margin-top:18px"></div>`;
  const paintAll = () => {
    for (const d of S.speed) { cell(d.a, d.b, d.scoreAB); cell(d.b, d.a, d.scoreBA); }
    $('#c1').textContent = `${S.speed.length} speed dates`; $('#c2').textContent = `${S.invites.filter(i => i.accepted).length}/${S.invites.length} accepted`; $('#c3').textContent = `${S.dates.length} dates · ${S.dates.filter(d => d.mutual).length} ♥`;
    $('#feed').innerHTML = S.invites.slice(-14).map(inviteHtml).reverse().join('');
    $('#dl').innerHTML = S.dates.map(d => dateCard(d)).join('');
    ['#r1', '#r2', '#r3'].forEach(r => $(r).classList.add('done'));
    $('#after').innerHTML = `<a class="btn pri" href="#/rankings">See the rankings →</a>`;
  };
  if (S.nightRun && !focus) paintAll();
  $('#run').onclick = () => runNight(focusId);
  if (focus && location.hash.includes('/night/')) setTimeout(() => runNight(focusId), 400);
}
function cell(a, b, v) { const el = document.querySelector(`[data-k="${a}|${b}"]`); if (el) el.style.background = `hsl(${330 - (v - 30) * 1.4},85%,${18 + v * 0.45}%)`; }
const inviteHtml = i => `<div>${i.matchmaker ? '🧭 Matchmaker pairs' : '💌'} <b>${esc(P(i.from)?.first)}</b>'s agent → <b>${esc(P(i.to)?.first)}</b> <span class="mute">(${i.score})</span> ${i.accepted ? '<span class="badge b-y">accepted</span>' : '<span class="badge b-n">declined</span>'}</div>`;
let running = false;
async function runNight(focusId) {
  if (running) return; running = true; $('#run').disabled = true;
  const ps = pool();
  if (focusId) { S.speed = S.speed.filter(d => d.a !== focusId && d.b !== focusId); S.dates = S.dates.filter(d => d.a !== focusId && d.b !== focusId); S.invites = S.invites.filter(i => i.from !== focusId && i.to !== focusId); }
  else { S.speed = []; S.dates = []; S.invites = []; document.querySelectorAll('#mx i').forEach(i => i.style.background = ''); }
  const total = focusId ? ps.length - 1 : ps.length * (ps.length - 1) / 2; let k = 0, inv = 0, acc = 0, nd = 0;
  $('#r1').classList.add('on');
  const gen = runDatingNight(ps, { focusId });
  const feed = $('#feed'), dl = $('#dl');
  for (const e of gen) {
    if (e.type === 'speed') { S.speed.push(e.date); cell(e.date.a, e.date.b, e.date.scoreAB); cell(e.date.b, e.date.a, e.date.scoreBA); k++; $('#c1').textContent = `${k}/${total}`; if (k % (focusId ? 1 : 6) === 0) await sleep(focusId ? 60 : 12); }
    if (e.type === 'invite') { if (!inv) { $('#r1').classList.replace('on', 'done'); $('#r2').classList.add('on'); } S.invites.push(e); inv++; if (e.accepted) acc++; $('#c2').textContent = `${acc}/${inv} accepted`; const d = document.createElement('div'); d.innerHTML = inviteHtml(e).slice(5, -6); feed.prepend(d); await sleep(focusId ? 300 : 35); }
    if (e.type === 'date') { if (!nd) { $('#r2').classList.replace('on', 'done'); $('#r3').classList.add('on'); } S.dates.push(e.date); nd++; $('#c3').textContent = `${nd} dates`; dl.insertAdjacentHTML('afterbegin', dateCard(e.date)); await sleep(focusId ? 350 : 90); }
  }
  ['#r1', '#r2', '#r3'].forEach(r => { $(r).classList.remove('on'); $(r).classList.add('done'); });
  S.rankings = rankAll(ps, S.speed, S.dates); S.nightRun = true; save();
  $('#c3').textContent = `${S.dates.length} dates · ${S.dates.filter(d => d.mutual).length} ♥`;
  const best = focusId ? S.dates.filter(d => d.a === focusId || d.b === focusId).sort((x, y) => (y.scoreAB + y.scoreBA) - (x.scoreAB + x.scoreBA))[0] : S.dates.filter(d => d.mutual).sort((x, y) => (y.scoreAB + y.scoreBA) - (x.scoreAB + x.scoreBA))[0];
  $('#after').innerHTML = `<div class="row">${best ? `<a class="btn pri" href="#/date/${best.a}/${best.b}">▶ Watch the best date: ${esc(P(best.a).first)} × ${esc(P(best.b).first)}</a>` : ''}<a class="btn" href="#/rankings${focusId ? '/' + focusId : ''}">See ${focusId ? esc(P(focusId).first) + "'s" : 'the'} rankings →</a></div>`;
  running = false; $('#run').disabled = false;
}

// ---------------- date theater ----------------
async function renderDate(a, b) {
  const d = findDate(a, b) || null; const A = P(a), B = P(b);
  if (!d) { app.innerHTML = `<div class="panel">These two agents haven't been on a full date. <a class="btn sm" href="#/night">Back</a></div>`; return; }
  const L = P(d.a), R = P(d.b);
  app.innerHTML = `
  <div class="row" style="margin-bottom:6px"><a class="btn sm" href="#/night">← Dating night</a><span class="sp"></span><span class="small mute">Speed</span><button class="btn sm" data-sp="1">1×</button><button class="btn sm" data-sp="2.5">2.5×</button><button class="btn sm" id="skip">Skip to end</button></div>
  <div class="venue">📍 <b>${esc(d.venue.idea)}</b> · ${d.venue.why === 'shared' ? 'chosen because they share it' : `${esc(L.first)}'s pick`}</div>
  <div class="theater">
    <div class="side">${av(L, 'lg')}<h2 style="margin:8px 0 0">${esc(L.first)}'s agent</h2><div class="small mute">on behalf of ${esc(L.name)}</div><div class="meter"><div class="small mute">${esc(L.first)}'s agent's interest</div><div class="bar" style="height:12px"><i id="mL" style="width:50%"></i></div><b id="vL">—</b></div></div>
    <div class="chat panel" id="chat"></div>
    <div class="side">${av(R, 'lg')}<h2 style="margin:8px 0 0">${esc(R.first)}'s agent</h2><div class="small mute">on behalf of ${esc(R.name)}</div><div class="meter"><div class="small mute">${esc(R.first)}'s agent's interest</div><div class="bar" style="height:12px"><i id="mR" style="width:50%"></i></div><b id="vR">—</b></div></div>
  </div><div id="deb" style="margin-top:18px"></div>`;
  let skip = false; window.__speed = window.__speed || 1;
  document.querySelectorAll('[data-sp]').forEach(btn => btn.onclick = () => window.__speed = +btn.dataset.sp);
  $('#skip').onclick = () => skip = true;
  const chat = $('#chat'); let iL = 50, iR = 50;
  const token = location.hash;
  for (const t of d.turns) {
    if (location.hash !== token) return;
    const side = t.speaker === d.a ? 'l' : 'r', who = P(t.speaker);
    if (!skip) { const ty = document.createElement('div'); ty.className = `typing ${side}`; ty.textContent = `${who.first}'s agent is typing…`; chat.appendChild(ty); ty.scrollIntoView({ block: 'nearest' }); await sleep(Math.min(1800, 500 + t.text.length * 12)); ty.remove(); }
    chat.insertAdjacentHTML('beforeend', `<div class="bub ${side}"><div class="who">${esc(who.first)}'s agent</div>${esc(t.text)}</div>`);
    if (t.thought) {
      const by = P(t.thought.by), ts = t.thought.by === d.a ? 'l' : 'r';
      if (!skip) await sleep(450);
      chat.insertAdjacentHTML('beforeend', `<div class="thought ${ts}">🔒 ${esc(by.first)}'s agent (private): ${esc(t.thought.text)}<span class="d ${t.thought.delta >= 0 ? 'pos' : 'neg'}">${t.thought.delta >= 0 ? '+' : ''}${t.thought.delta}</span></div>`);
      if (ts === 'l') iL = Math.max(5, Math.min(98, iL + t.thought.delta)); else iR = Math.max(5, Math.min(98, iR + t.thought.delta));
      $('#mL').style.width = iL + '%'; $('#mR').style.width = iR + '%';
    }
    chat.lastElementChild.scrollIntoView({ block: 'nearest', behavior: skip ? 'auto' : 'smooth' });
    if (!skip) await sleep(700);
  }
  $('#mL').style.width = d.scoreAB + '%'; $('#mR').style.width = d.scoreBA + '%'; $('#vL').textContent = d.scoreAB + '/100'; $('#vR').textContent = d.scoreBA + '/100';
  $('#deb').innerHTML = `<h2>${d.mutual ? '💘 It\'s a match — both agents want a second date' : '💔 No second date'}</h2><div class="pgrid">
    <div class="c6"><h3>${esc(L.first)}'s agent → ${esc(L.first)} ${d.debriefA.secondDate ? '<span class="badge b-y">wants 2nd date</span>' : '<span class="badge b-n">passes</span>'}</h3><div class="letter">${esc(d.debriefA.letter)}</div></div>
    <div class="c6"><h3>${esc(R.first)}'s agent → ${esc(R.first)} ${d.debriefB.secondDate ? '<span class="badge b-y">wants 2nd date</span>' : '<span class="badge b-n">passes</span>'}</h3><div class="letter">${esc(d.debriefB.letter)}</div></div></div>
    <div class="row" style="margin-top:14px"><a class="btn" href="#/rankings/${L.id}">${esc(L.first)}'s ranking</a><a class="btn" href="#/rankings/${R.id}">${esc(R.first)}'s ranking</a></div>`;
  $('#deb').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------- rankings ----------------
function renderRankings(id) {
  const ps = pool(); const sel = (id && P(id)) ? id : null;
  const couples = S.dates.filter(d => d.mutual).sort((x, y) => (y.scoreAB + y.scoreBA) - (x.scoreAB + x.scoreBA)).slice(0, 8);
  const rows = sel ? (S.rankings[sel] || []) : [];
  app.innerHTML = `<h1 style="font-size:36px">Rankings</h1><div class="mute" style="margin-bottom:16px">For every person: who fits them best. Fit = 60% how much <i>their</i> agent liked the other person (needs met, shared interests, lifestyle, values, date chemistry) + 40% how much the other agent liked them back.</div>
  <div class="rk"><div class="panel plist">${ps.map(p => `<a href="#/rankings/${p.id}" class="${p.id === sel ? 'on' : ''}">${av(p, 'sm')}<span>${esc(p.name)}</span><span class="sp"></span><span class="small mute">${S.rankings[p.id]?.[0] ? esc(P(S.rankings[p.id][0].id)?.first) : ''}</span></a>`).join('')}</div>
  <div>${sel ? `<div class="row" style="margin-bottom:12px">${av(P(sel), 'md')}<div><h2 style="margin:0">Who fits ${esc(P(sel).name)} best</h2><div class="small mute">Needs: ${P(sel).needs.slice(0, 3).map(n => esc(n.label.toLowerCase())).join(' · ')}</div></div><span class="sp"></span><a class="btn sm" href="#/p/${sel}">Profile</a></div>
    ${rows.map((r, i) => { const o = P(r.id); if (!o) return ''; return `<div class="rrow"><div class="pos">${i + 1}</div>${av(o)}<div><a href="#/p/${o.id}"><b>${esc(o.name)}</b></a> <span class="small ar" style="color:var(--pink)">${esc(o.archetype)}</span><div class="small mute">${esc(r.reason)}</div><div class="row" style="gap:6px;margin-top:4px">${r.dated ? `<a class="badge b-d" href="#/date/${sel}/${o.id}">▶ watch date</a>` : '<span class="badge" style="background:#221d30;color:#8f86a8">speed date only</span>'}${r.mutual ? '<span class="badge b-mut">♥ mutual</span>' : ''}${r.secondDate ? '<span class="badge b-y">their agent wants 2nd date</span>' : ''}</div></div><div><div class="fitn">${r.fit}<span class="small mute">/100</span></div><div class="bar"><i style="width:${r.fit}%"></i></div><div class="small mute" style="text-align:right">liked ${r.mine} · liked back ${r.theirs}</div></div></div>`; }).join('')}`
    : `<div class="panel"><h2>💘 Best couples of the night</h2>${couples.map(d => dateCard(d)).join('<div style="height:8px"></div>')}<p class="mute small">Pick a person on the left to see their full ranking.</p></div>`}</div></div>`;
}

// ---------------- how it works ----------------
function renderHow() {
  app.innerHTML = `<h1 style="font-size:36px">How it works</h1>
  <div class="pipe" style="margin:14px 0 22px"><div>LinkedIn URL + public Instagram URL</div><span>→</span><div>Scrape (Apify + public JSON-LD)</div><span>→</span><div>Reading agent → profile</div><span>→</span><div>Speed dates (all pairs)</div><span>→</span><div>Invitations</div><span>→</span><div>Full dates + debriefs</div><span>→</span><div>Rankings</div></div>
  <div class="pgrid how">
  <div class="panel c6"><h3>1 · Scraping — only two sources</h3><ul class="clean"><li><b>LinkedIn:</b> the public profile page's schema.org JSON-LD (name, headline, about, roles, education, awards, followers). If LinkedIn blocks the server, falls back to the Apify actor <code>harvestapi/linkedin-profile-scraper</code>.</li><li><b>Instagram:</b> Apify <code>apify/instagram-profile-scraper</code> (bio, category, followers, last 12 posts with captions, hashtags, locations). Private profiles are rejected.</li><li>Nothing else is used — no web search, no third-party bios.</li></ul></div>
  <div class="panel c6"><h3>2 · The reading agent</h3><ul class="clean"><li>Splits both profiles into tagged text units (headline, about, roles, bio, each caption, hashtags, locations) with source weights — Instagram counts more for hobbies (what you do), LinkedIn more for interests (what you think about).</li><li>Matches ${SIGNALS.length} signal families and keeps the exact quote as evidence for every claim.</li><li>Scores 9 personality traits, lifestyle, values, communication style and love language; infers 3–5 <b>relationship needs</b>, green flags, watch-outs and a dating strategy.</li></ul></div>
  <div class="panel c6"><h3>3 · The agents date</h3><ul class="clean"><li><b>Speed dates:</b> every pair meets; each agent privately scores the other against its own principal's needs.</li><li><b>Invitations:</b> each agent invites its top 3. The other agent only accepts if the inviter is in its own top 6 (or a strong score) — rejection is real.</li><li><b>Full dates:</b> a venue chosen from shared hobbies, then a multi-turn conversation: real quotes from each other's posts, each agent probing its principal's top needs, honest answers (including mismatches), a candid watch-out check and a lighter moment. Every turn carries a private reasoning note and an interest delta.</li><li><b>Debrief:</b> each agent writes a letter to its person and decides on a second date. Both yes = ♥ match.</li></ul></div>
  <div class="panel c6"><h3>4 · Rankings</h3><ul class="clean"><li>For every person, every other person is ranked by fit = 60% their own agent's score + 40% reciprocity.</li><li>Scores blend needs met (38%), shared interests (24%), values (22%), lifestyle (16%) and on-date chemistry.</li><li>Rankings are asymmetric: A can rank B first while B ranks A fifth.</li></ul></div>
  <div class="panel c12"><h3>Try it</h3>Paste any LinkedIn + public Instagram on the <a href="#/" style="color:var(--pink)">People</a> page. The new agent joins the pool, speed-dates all ${pool().length - 1} others, goes on dates and gets its own ranking — and appears in everyone else's.</div>
  </div>`;
}
init();
window.__app = { get S() { return S; }, addPerson, closeModal };
