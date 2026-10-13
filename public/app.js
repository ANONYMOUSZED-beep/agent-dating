import { analyzePerson, corpus, fmtNum } from './engine/analyze.js';
import { runDatingNight, rankAll, canMatch } from './engine/date.js';
import { llmDate } from './engine/llmdate.js';
import { SIGNALS } from './engine/taxonomy.js';

const KEY = 'agent-personals-v4';
const $ = s => document.querySelector(s);
const app = $('#app'), modal = $('#modal');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms / (window.__speed || 1)));
let S = null;

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
const avg = d => Math.round((d.scoreAB + d.scoreBA) / 2);

// The LLM profile (Groq) is primary; the keyword engine is the fallback and the scoring backbone.
const ruleEv = e => e ? [{ source: e.source, text: e.text }] : [];
const V = p => {
  const m = p.llm || {};
  return {
    ai: !!p.llm, tagline: m.tagline || p.archetype, summary: m.summary || p.summary,
    needs: m.needs?.length ? m.needs : p.needs.map(n => ({ label: n.label, why: n.why, evidence: ruleEv(n.evidence) })),
    hobbies: m.hobbies?.length ? m.hobbies : p.hobbies.map(h => ({ label: h.label, evidence: ruleEv(h.evidence.find(e => e.source.startsWith('Instagram')) || h.evidence[0]) })),
    interests: m.interests?.length ? m.interests : p.interests.map(i => ({ label: i.label, evidence: ruleEv(i.evidence[0]) })),
    qualities: m.qualities?.length ? m.qualities : p.offers.map(o => ({ label: o, evidence: [] })),
    watchouts: m.watchouts?.length ? m.watchouts : p.watchouts.map(o => ({ label: o, evidence: [] })),
    dealbreakers: m.dealbreakers || [], idealPartner: m.idealPartner || p.idealPartner,
    dateIdeas: m.dateIdeas?.length ? m.dateIdeas : p.dateIdeas.map(d => d.idea), voice: m.voice || p.commStyle.detail,
  };
};
async function callAgent(op, payload) {
  const r = await fetch('api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...payload }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `agent ${r.status}`); return j;
}

// ---------------- router ----------------
function route() {
  const [_, page, a, b] = location.hash.split('/');
  document.querySelectorAll('[data-nav]').forEach(n => n.classList.toggle('on', n.dataset.nav === (page || 'home') || (page === 'p' && n.dataset.nav === 'home') || (page === 'date' && n.dataset.nav === 'night')));
  const ed = $('#edition'); if (ed) ed.textContent = `${S.order.length} agents · ${S.dates.length} dates · ${S.dates.filter(d => d.mutual).length} matches`;
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
      <h1>Your agent reads you.<br/>Then it goes on <em>dates</em> for you.</h1>
      <p class="lede">Hand over a LinkedIn and a public Instagram. An agent studies both, writes the personal ad you'd never write yourself — what you need, what you do, what you think about — then meets ${ps.length - 1} other agents and reports back on who's worth your evening.</p>
      <div class="row"><a class="btn pri" href="#/night">Watch tonight's dates</a><a class="btn" href="#/rankings">Read the rankings</a></div>
      <div class="steps3"><div><b>Read</b>LinkedIn says what you think about. Instagram shows what you do.</div><div><b>Date</b>Each agent speaks only for its own person — two separate minds, one table.</div><div><b>Rank</b>Agents debrief, decide on second dates, and everyone gets a ranked list.</div></div>
    </div>
    <div class="coupon"><span class="scis">Place your ad</span>
      <h2 style="margin-bottom:4px">Create an agent</h2><div class="small mute">Two links. Nothing else is read.</div>
      <label for="li">LinkedIn profile URL</label><input id="li" placeholder="https://www.linkedin.com/in/…" autocomplete="off" />
      <label for="ig">Instagram profile URL (public)</label><input id="ig" placeholder="https://www.instagram.com/…" autocomplete="off" />
      <div class="row" style="gap:14px"><div class="sp"><label for="gd">This person is</label><select id="gd"><option value="">Detect from profile</option><option value="m">A man</option><option value="f">A woman</option></select></div>
      <div class="sp"><label for="sk">Looking for</label><select id="sk"><option value="">Opposite gender</option><option value="m">Men</option><option value="f">Women</option><option value="m,f">Everyone</option></select></div></div>
      <div class="row" style="margin-top:16px"><button class="btn red" id="add">Read this person</button><button class="btn sm" id="bulkT">Paste many</button></div>
      <div id="bulkBox" style="display:none;margin-top:10px"><textarea id="bulk" rows="5" placeholder="One person per line: <linkedin url> <instagram url>"></textarea><button class="btn sm" id="bulkGo" style="margin-top:8px">Add all</button></div>
      <div class="err" id="err"></div>
    </div>
  </section>
  <div class="secthead"><h2>The pool</h2><span class="mute small">${ps.length} people, each with an agent</span><span class="sp"></span><span class="small mute">${S.demo ? 'Pre-scraped edition' : 'Your edition'}</span><button class="btn sm" id="reset">Reset</button></div>
  <div class="ads">${ps.map(p => { const v = V(p); return `
    <a class="ad" href="#/p/${p.id}">${p.photo ? `<img class="ph" src="${esc(p.photo)}" alt="">` : ''}<div class="nm">${esc(p.name)}</div><div class="tg">${esc(v.tagline)}</div>
    <div class="seeks"><b>Seeks</b> ${esc((v.needs[0]?.label || '').toLowerCase())}${v.needs[1] ? '; ' + esc(v.needs[1].label.toLowerCase()) : ''}.</div></a>`; }).join('')}</div>`;
  $('#add').onclick = () => addPerson($('#li').value, $('#ig').value, { gender: $('#gd').value, seeks: $('#sk').value });
  $('#bulkT').onclick = () => { const b = $('#bulkBox'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; };
  $('#bulkGo').onclick = async () => {
    const lines = $('#bulk').value.split('\n').map(l => l.trim()).filter(Boolean);
    for (const l of lines) { const li = l.match(/\S*linkedin\.com\/in\/\S+/i)?.[0], ig = l.match(/\S*instagram\.com\/\S+/i)?.[0]; if (li && ig) await addPerson(li, ig, { bulk: true }); }
    closeModal(); route();
  };
  $('#reset').onclick = async () => { if (confirm('Reset to the pre-scraped edition? People you added will be removed.')) { localStorage.removeItem(KEY); await loadDemo(); route(); } };
}

// ---------------- add a person: scrape -> read -> profile ----------------
async function addPerson(li, ig, { bulk = false, gender = '', seeks = '' } = {}) {
  const err = $('#err'); if (err) err.textContent = '';
  if (!/linkedin\.com\/in\//i.test(li) || !/instagram\.com\/|^@?[\w.]+$/i.test(ig.trim())) { if (err) err.textContent = 'Paste a LinkedIn profile URL (linkedin.com/in/…) and an Instagram profile URL.'; return; }
  openModal(`<h3>Agent at work</h3><h2>Reading a new person</h2><div id="steps"></div><div class="scan" id="scan" style="display:none"></div><div class="counters" id="counters"></div><div id="mfoot" style="margin-top:16px"></div>`);
  const steps = $('#steps');
  const step = (txt) => { const d = document.createElement('div'); d.className = 'step'; d.innerHTML = `<span class="ic"><span class="spin"></span></span><span>${txt}</span>`; steps.appendChild(d); return { done: (t, ok = true) => { const ic = d.querySelector('.ic'); ic.className = 'ic ' + (ok ? 'ok' : 'no'); ic.textContent = ok ? '✓' : '×'; if (t) d.lastChild.innerHTML = t; } }; };
  const s1 = step(`Scraping LinkedIn <span class="mute small">${esc(li)}</span> and Instagram <span class="mute small">${esc(ig)}</span>…`);
  let raw;
  try {
    const r = await fetch('api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedin: li, instagram: ig }) });
    raw = await r.json(); if (!r.ok) throw new Error(raw.error || 'Scrape failed');
  } catch (e) { s1.done(`Scrape failed: ${esc(e.message)}`, false); $('#mfoot').innerHTML = `<button class="btn" onclick="document.getElementById('modal').classList.add('hidden')">Close</button>`; return; }
  s1.done(`Scraped <b>${esc(raw.linkedin.name)}</b> — LinkedIn: ${raw.linkedin.positions.length} roles${raw.linkedin.about ? ', about section' : ''} · Instagram @${esc(raw.instagram.username)}: ${fmtNum(raw.instagram.followers)} followers, ${raw.instagram.posts.length} posts`);
  await readAnimation(raw);
  const p = analyzePerson(raw); p.raw = raw;
  const s3 = step(`The reading agent (LLM on Groq) is writing ${esc(p.first)}'s profile from those units, citing each one…`);
  try { p.llm = await callAgent('profile', { raw, hints: { signals: [...p.hobbies, ...p.interests].map(x => x.label).join(', ') } }); s3.done(`<b>“${esc(p.llm.tagline)}”</b> — needs: ${p.llm.needs.slice(0, 3).map(n => esc(n.label.toLowerCase())).join('; ')} <span class="badge b-ai">${esc(p.llm.model)}</span>`); }
  catch (e) { s3.done(`LLM unavailable (${esc(e.message)}) — using the keyword engine's profile: <b>${esc(p.archetype)}</b>`, true); }
  p.gender = gender || p.llm?.gender || null; if (seeks) p.seeks = seeks.split(',');
  S.speed = S.speed.filter(d => d.a !== p.id && d.b !== p.id); S.dates = S.dates.filter(d => d.a !== p.id && d.b !== p.id); S.invites = S.invites.filter(i => i.from !== p.id && i.to !== p.id);
  S.people[p.id] = p; if (!S.order.includes(p.id)) S.order.unshift(p.id); S.demo = false;
  S.rankings = rankAll(pool(), S.speed, S.dates); save();
  if (bulk) return p;
  $('#mfoot').innerHTML = `<div class="row"><a class="btn pri" href="#/p/${p.id}" id="openP">Open ${esc(p.first)}'s profile</a><a class="btn red" href="#/night/${p.id}" id="goDate">Send ${esc(p.first)}'s agent on dates</a></div>`;
  $('#openP').onclick = closeModal; $('#goDate').onclick = closeModal;
  return p;
}
const KW = SIGNALS.flatMap(s => s.kw.filter(k => /[a-z]/i.test(k) && k.length > 3));
const KW_RE = new RegExp(`\\b(${KW.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
const highlight = t => esc(t).replace(KW_RE, '<mark>$1</mark>');
async function readAnimation(raw) {
  const scan = $('#scan'); if (!scan) return; scan.style.display = 'block';
  const units = corpus(raw), counters = $('#counters'); const found = {};
  const s = document.createElement('div'); s.className = 'step'; s.innerHTML = `<span class="ic"><span class="spin"></span></span><span>Splitting both profiles into ${units.length} text units; keyword pass over ${SIGNALS.length} signal families…</span>`; $('#steps').appendChild(s);
  for (let i = 0; i < units.length; i++) {
    const u = units[i]; const div = document.createElement('div'); div.innerHTML = `<span class="mute small">${esc(u.source)}</span> · ${highlight(u.text.slice(0, 180))}`; scan.prepend(div);
    for (const sg of SIGNALS) if (sg.kw.some(k => u.text.toLowerCase().includes(k.toLowerCase()))) found[sg.id] = (found[sg.id] || 0) + 1;
    if (i % 3 === 0) counters.innerHTML = Object.entries(found).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([id, n]) => `<span class="tag">${esc(SIGNALS.find(x => x.id === id).label)} · ${n}</span>`).join('');
    await sleep(Math.max(15, 2400 / units.length));
  }
  const ic = s.querySelector('.ic'); ic.className = 'ic ok'; ic.textContent = '✓';
}
function openModal(html) { modal.innerHTML = `<div class="mbox">${html}</div>`; modal.classList.remove('hidden'); }
function closeModal() { modal.classList.add('hidden'); }
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

// ---------------- profile ----------------
function bars(obj, labels) { return Object.entries(obj).map(([k, v]) => `<div class="trait"><span>${esc(labels?.[k] || k)}</span><div class="bar"><i style="width:${v}%"></i></div><span>${v}</span></div>`).join(''); }
const evHtml = list => (list || []).slice(0, 1).map(e => `<div class="ev"><span class="src">${esc(e.source)}${e.id ? ' · ' + esc(e.id) : ''}</span>“${esc(e.text)}”</div>`).join('');
const K = (n, t) => `<h3 class="kicker"><span class="no">${n}</span>${t}</h3>`;
const items = (list, withWhy = true) => list.map(x => `<div class="item"><div class="t">${esc(x.label)}</div>${withWhy && x.why ? `<div class="why">${esc(x.why)}</div>` : ''}${evHtml(x.evidence)}</div>`).join('');
function renderProfile(id) {
  const p = P(id), v = V(p), rk = (S.rankings[id] || []).slice(0, 5), myDates = S.dates.filter(d => d.a === id || d.b === id);
  const raw = p.raw;
  app.innerHTML = `
  <div class="phead">${av(p, 'lg')}<div>
    <h3>Personal ad no. ${S.order.indexOf(id) + 1}${v.ai ? ` · written by the reading agent` : ' · keyword engine'}</h3>
    <h1>${esc(p.name)}</h1><div class="tg">“${esc(v.tagline)}”</div><div class="mute">${esc(p.headline)}${p.location ? ' · ' + esc(p.location) : ''}</div>
    <div class="links" style="margin-top:10px"><a href="${esc(p.links.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a><a href="${esc(p.links.instagram)}" target="_blank" rel="noopener">Instagram @${esc(p.username)} ↗</a></div>
    <div class="stats num"><div><b>${fmtNum(p.stats.igFollowers)}</b>followers</div><div><b>${p.stats.postsRead}</b>posts read</div><div><b>${p.stats.units}</b>text units</div><div><b>${p.stats.words.toLocaleString()}</b>words</div><div><b>${myDates.length}</b>dates</div></div>
  </div><div style="display:flex;flex-direction:column;gap:8px"><a class="btn pri" href="#/rankings/${id}">${esc(p.first)}'s ranking</a><a class="btn" href="#/night/${id}">Send on new dates</a></div></div>
  <div class="cols">
    <div class="c7">
      <div class="sec">${K('01', "The agent's read")}<div class="read">${esc(v.summary)}</div></div>
      <div class="sec">${K('02', 'What they need in a partner')}${items(v.needs)}</div>
      <div class="sec">${K('03', 'Other qualities')}${items(v.qualities)}</div>
      <div class="sec">${K('04', 'Honest watch-outs')}${items(v.watchouts)}${v.dealbreakers.length ? `<div class="item"><div class="t">Dealbreakers</div><div class="why">${v.dealbreakers.map(esc).join(' · ')}</div></div>` : ''}</div>
    </div>
    <div class="c5">
      <div class="sec">${K('05', 'Hobbies — what they do')}${items(v.hobbies, false)}</div>
      <div class="sec">${K('06', 'Interests — what they think about')}${items(v.interests, false)}</div>
      <div class="sec">${K('07', 'Ideal partner')}<div class="serif" style="font-size:17px">${esc(v.idealPartner)}</div>
        <h3 style="margin-top:16px">First-date ideas</h3><ul class="clean">${v.dateIdeas.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
        <h3 style="margin-top:16px">How the agent will talk</h3><div class="small">${esc(v.voice)}</div></div>
      <div class="sec">${K('08', 'Top matches so far')}${rk.map((r, i) => `<a class="dcard" href="#/p/${r.id}">${av(P(r.id), 'sm')}<span class="dn">${i + 1}. ${esc(P(r.id).name)}</span><span class="sp"></span>${r.mutual ? '<span class="badge b-mut">match</span>' : ''}<b class="num">${r.fit}</b></a>`).join('') || '<span class="mute small">Not dated yet — send the agent out.</span>'}</div>
    </div>
    <div class="c12 sec">${K('09', `${esc(p.first)}'s dates`)}<div class="cols">${myDates.map(d => `<div class="c4">${dateCard(d)}</div>`).join('') || '<span class="mute c12">No dates yet.</span>'}</div></div>
    <div class="c6 sec">${K('10', 'Signal readout — keyword engine')}<div class="small mute" style="margin-bottom:8px">Deterministic pass used for scoring speed dates (relative to the pool).</div>${bars(p.traits)}<h3 style="margin-top:14px">Lifestyle</h3>${bars(p.lifestyle, { workIntensity: 'work intensity', activity: 'activity', social: 'social', travel: 'travel', familyFocus: 'family focus', publicLife: 'public life' })}</div>
    <div class="c6 sec">${K('11', 'Source text the agents read')}<div class="src-text">
      ${raw ? `<p><b>LinkedIn headline:</b> ${highlight(raw.linkedin.headline)}</p>${raw.linkedin.about ? `<p><b>LinkedIn about:</b> ${highlight(raw.linkedin.about.slice(0, 900))}</p>` : ''}<p><b>Instagram bio:</b> ${highlight(raw.instagram.bio)}</p>${raw.instagram.posts.map(x => `<p><b>Post${x.location ? ' · ' + esc(x.location) : ''}:</b> ${highlight(x.caption.slice(0, 400))}</p>`).join('')}` : '<span class="mute">Raw text not stored.</span>'}
    </div><h3 style="margin-top:14px">Reading log</h3><div class="log">${p.reading.map(r => `<div><span class="k">${esc(r.step)}</span> — ${esc(r.detail)}</div>`).join('')}${v.ai ? `<div><span class="k">LLM reading agent</span> — ${esc(p.llm.model)}, ${p.llm.units} numbered units, every claim cites unit ids</div>` : ''}</div></div>
  </div>`;
}
function dateCard(d) {
  const a = P(d.a), b = P(d.b); if (!a || !b) return '';
  return `<a class="dcard" href="#/date/${d.a}/${d.b}"><div class="pair">${av(a, 'sm')}${av(b, 'sm')}</div><div class="sp"><div class="dn">${esc(a.first)} & ${esc(b.first)}</div><div class="small mute">${esc(d.venue.idea)}</div></div><div style="text-align:right"><b class="num">${avg(d)}</b><div>${d.mutual ? '<span class="badge b-mut">match</span>' : '<span class="badge b-n">no 2nd date</span>'}</div></div></a>`;
}

// ---------------- dating night ----------------
function renderNight(focusId) {
  const focus = focusId && P(focusId);
  const ps = pool(), n = ps.length;
  app.innerHTML = `
  <div class="row" style="margin-bottom:18px;align-items:flex-end"><div><h3>${focus ? 'Special edition' : "Tonight's programme"}</h3><h1 style="margin:0">${focus ? `${esc(focus.first)}'s agent goes out` : 'Dating night'}</h1><div class="mute">${focus ? `Speed-dates all ${n - 1} agents, sends invitations, then goes on real conversations — every line generated live, one agent at a time.` : `${n} agents. Every compatible pair (by who each person is looking for) speed-dates, agents send invitations, accepted invitations become full conversations.`}</div></div><span class="sp"></span>
  <button class="btn ${focus ? 'red' : 'pri'}" id="run">${focus ? `Start ${esc(focus.first)}'s night` : S.nightRun ? 'Replay the night' : 'Start dating night'}</button></div>
  <div class="cols3">
    <div><div class="round" id="r1"><span class="n">I.</span><b>Speed dates</b><span class="sp"></span><span class="mute small num" id="c1"></span></div>
      <div class="matrix" id="mx" style="grid-template-columns:repeat(${n},1fr)">${ps.map(a => ps.map(b => `<i data-k="${a.id}|${b.id}" class="${canMatch(a, b) ? '' : 'x'}" title="${esc(a.first)} → ${esc(b.first)}"></i>`).join('')).join('')}</div>
      <div class="small mute" style="margin-top:8px">Row agent's score of the column person after a 90-second screen. Darker red = keener; hatched = not who they're looking for.</div></div>
    <div><div class="round" id="r2"><span class="n">II.</span><b>Invitations</b><span class="sp"></span><span class="mute small num" id="c2"></span></div><div class="feed" id="feed"></div></div>
    <div><div class="round" id="r3"><span class="n">III.</span><b>Dates</b><span class="sp"></span><span class="mute small num" id="c3"></span></div><div id="dl" style="max-height:380px;overflow:auto"></div></div>
  </div>
  <div id="live"></div>
  <div id="after" style="margin-top:20px"></div>`;
  const paintAll = () => {
    for (const d of S.speed) { cell(d.a, d.b, d.scoreAB); cell(d.b, d.a, d.scoreBA); }
    $('#c1').textContent = `${S.speed.length} screens`; $('#c2').textContent = `${S.invites.filter(i => i.accepted).length} of ${S.invites.length} accepted`; $('#c3').textContent = `${S.dates.length} dates · ${S.dates.filter(d => d.mutual).length} matches`;
    $('#feed').innerHTML = S.invites.slice(-16).reverse().map(i => `<div>${inviteHtml(i)}</div>`).join('');
    $('#dl').innerHTML = S.dates.map(d => dateCard(d)).join('');
    ['#r1', '#r2', '#r3'].forEach(r => $(r).classList.add('done'));
    $('#after').innerHTML = `<a class="btn pri" href="#/rankings">Read the rankings</a>`;
  };
  if (S.nightRun && !focus) paintAll();
  $('#run').onclick = () => runNight(focusId);
  if (focus && location.hash.includes('/night/')) setTimeout(() => runNight(focusId), 400);
}
function cell(a, b, v) { const el = document.querySelector(`[data-k="${a}|${b}"]`); if (el) { const t = Math.max(0, Math.min(1, (v - 50) / 42)) ** 1.3; el.style.background = `rgb(${Math.round(255 - t * 71)},${Math.round(253 - t * 203)},${Math.round(248 - t * 206)})`; } }
const inviteHtml = i => `${i.matchmaker ? '<span class="mute">Matchmaker pairs</span> ' : ''}<b>${esc(P(i.from)?.first)}</b>'s agent → <b>${esc(P(i.to)?.first)}</b> <span class="mute num">${i.score}</span> ${i.accepted ? '<span class="badge b-y">accepted</span>' : '<span class="badge b-n">declined</span>'}`;
let running = false;
async function runNight(focusId) {
  if (running) return; running = true; $('#run').disabled = true;
  const ps = pool(), byId = Object.fromEntries(ps.map(p => [p.id, p]));
  const prev = Object.fromEntries(S.dates.filter(d => d.llm).map(d => [[d.a, d.b].sort().join('|'), d]));
  if (focusId) { S.speed = S.speed.filter(d => d.a !== focusId && d.b !== focusId); S.dates = S.dates.filter(d => d.a !== focusId && d.b !== focusId); S.invites = S.invites.filter(i => i.from !== focusId && i.to !== focusId); }
  else { S.speed = []; S.dates = []; S.invites = []; document.querySelectorAll('#mx i').forEach(i => i.style.background = ''); }
  const total = focusId ? ps.filter(x => canMatch(P(focusId), x)).length : ps.reduce((n, a, i) => n + ps.slice(i + 1).filter(b => canMatch(a, b)).length, 0); let k = 0, inv = 0, acc = 0, nd = 0;
  $('#r1').classList.add('on');
  const feed = $('#feed'), dl = $('#dl'), queue = [];
  for (const e of runDatingNight(ps, { focusId, invites: focusId ? 2 : 1 })) {
    if (e.type === 'speed') { S.speed.push(e.date); cell(e.date.a, e.date.b, e.date.scoreAB); cell(e.date.b, e.date.a, e.date.scoreBA); k++; $('#c1').textContent = `${k}/${total}`; if (k % (focusId ? 1 : 6) === 0) await sleep(focusId ? 50 : 12); }
    if (e.type === 'invite') { if (!inv) { $('#r1').classList.replace('on', 'done'); $('#r2').classList.add('on'); } S.invites.push(e); inv++; if (e.accepted) acc++; $('#c2').textContent = `${acc} of ${inv} accepted`; const d = document.createElement('div'); d.innerHTML = inviteHtml(e); feed.prepend(d); await sleep(focusId ? 280 : 35); }
    if (e.type === 'date') queue.push(e.date);
  }
  $('#r2').classList.replace('on', 'done'); $('#r3').classList.add('on');
  const sv = (a, b) => { const s = S.speed.find(d => d.a === a && d.b === b); return s ? s.scoreAB : S.speed.find(d => d.a === b && d.b === a)?.scoreBA ?? 60; };
  for (const rd of queue) {
    let d = prev[[rd.a, rd.b].sort().join('|')];
    if (!d && focusId) {
      const A = byId[rd.a], B = byId[rd.b];
      $('#live').innerHTML = `<div class="livebox"><h3><span class="dot"></span>On a date now · ${esc(rd.venue.idea)}</h3><h2>${esc(A.first)}'s agent & ${esc(B.first)}'s agent</h2><div id="lines"></div></div>`;
      try {
        d = await llmDate(A, B, { venue: rd.venue, priorAB: sv(rd.a, rd.b), priorBA: sv(rd.b, rd.a), call: callAgent, onTurn: t => { const w = byId[t.speaker]; $('#lines')?.insertAdjacentHTML('beforeend', `<div class="ln"><b>${esc(w.first)}'s agent:</b> ${esc(t.text)}<span class="pt">private note to ${esc(w.first)}: ${esc(t.thought.text)} (${t.thought.delta >= 0 ? '+' : ''}${t.thought.delta})</span></div>`); } });
        $('#lines')?.insertAdjacentHTML('beforeend', `<div class="ln"><b>Debriefs:</b> ${esc(A.first)}'s agent ${d.scoreAB}/100 ${d.debriefA.secondDate ? 'wants a second date' : 'passes'} · ${esc(B.first)}'s agent ${d.scoreBA}/100 ${d.debriefB.secondDate ? 'wants a second date' : 'passes'}</div>`);
      } catch (e) { d = { ...rd, fallback: e.message }; $('#lines')?.insertAdjacentHTML('beforeend', `<div class="ln mute">LLM busy (${esc(e.message)}) — this date was played by the rule engine.</div>`); }
    }
    d = d || rd;
    S.dates.push(d); nd++; $('#c3').textContent = `${nd} dates`; dl.insertAdjacentHTML('afterbegin', dateCard(d)); save();
    await sleep(focusId ? 300 : 70);
  }
  ['#r1', '#r2', '#r3'].forEach(r => { $(r).classList.remove('on'); $(r).classList.add('done'); });
  S.rankings = rankAll(ps, S.speed, S.dates); S.nightRun = true; save();
  $('#c3').textContent = `${S.dates.length} dates · ${S.dates.filter(d => d.mutual).length} matches`;
  const mine = S.dates.filter(d => !focusId || d.a === focusId || d.b === focusId);
  const best = [...mine].sort((x, y) => (y.mutual - x.mutual) || (avg(y) - avg(x)))[0];
  $('#after').innerHTML = `<div class="row">${best ? `<a class="btn pri" href="#/date/${best.a}/${best.b}">Watch ${esc(P(best.a).first)} & ${esc(P(best.b).first)}</a>` : ''}<a class="btn" href="#/rankings${focusId ? '/' + focusId : ''}">${focusId ? esc(P(focusId).first) + "'s" : 'The'} rankings</a></div>`;
  running = false; $('#run').disabled = false;
}

// ---------------- date theater: a screenplay with private marginalia ----------------
async function renderDate(a, b) {
  const d = findDate(a, b) || null;
  if (!d) { app.innerHTML = `<div class="panel">These two agents haven't been on a full date. <a class="btn sm" href="#/night">Back</a></div>`; return; }
  const L = P(d.a), R = P(d.b);
  app.innerHTML = `
  <div class="row" style="margin-bottom:8px"><a class="btn sm" href="#/night">← Dating night</a><span class="sp"></span><span class="small mute">${d.llm ? 'Every line generated live by two separate LLM agents' : 'Rule-engine date'}</span><button class="btn sm" data-sp="1">1×</button><button class="btn sm" data-sp="2.5">2.5×</button><button class="btn sm" id="skip">Skip to end</button></div>
  <div class="venue">${esc(d.venue.idea)}</div>
  <div class="cast">
    <div class="who">${av(L)}<div><div class="nm">${esc(L.first)}'s agent</div><div class="small mute">for ${esc(L.name)}</div><div class="meter"><div class="bar"><i id="mL" style="width:50%"></i></div><span class="small mute num" id="vL">interest</span></div></div></div>
    <div class="x">&</div>
    <div class="who r">${av(R)}<div><div class="nm">${esc(R.first)}'s agent</div><div class="small mute">for ${esc(R.name)}</div><div class="meter" style="margin-left:auto"><div class="bar"><i id="mR" style="width:50%"></i></div><span class="small mute num" id="vR">interest</span></div></div></div>
  </div>
  <div class="script" id="chat"></div><div id="deb"></div>`;
  let skip = false; window.__speed = window.__speed || 1;
  document.querySelectorAll('[data-sp]').forEach(btn => btn.onclick = () => window.__speed = +btn.dataset.sp);
  $('#skip').onclick = () => skip = true;
  const chat = $('#chat'); let iL = 50, iR = 50;
  const token = location.hash;
  for (const t of d.turns) {
    if (location.hash !== token) return;
    const side = t.speaker === d.a ? 'l' : 'r', who = P(t.speaker);
    if (!skip) { const ty = document.createElement('div'); ty.className = 'typing'; ty.textContent = `${who.first}'s agent is thinking…`; chat.appendChild(ty); ty.scrollIntoView({ block: 'nearest' }); await sleep(Math.min(1700, 500 + t.text.length * 8)); ty.remove(); }
    chat.insertAdjacentHTML('beforeend', `<div class="line ${side}"><div class="spk">${esc(who.first)}'s agent${t.model ? ` <span class="m">· ${esc(t.model.split('/').pop())}</span>` : ''}</div><div class="tx">${esc(t.text)}</div></div>`);
    if (t.thought) {
      const by = P(t.thought.by), ts = t.thought.by === d.a ? 'l' : 'r';
      if (!skip) await sleep(400);
      chat.insertAdjacentHTML('beforeend', `<div class="note ${ts}"><span class="lab">Private note to ${esc(by.first)}</span>${esc(t.thought.text)}<span class="d ${t.thought.delta >= 0 ? 'pos' : 'neg'}">${t.thought.delta >= 0 ? '+' : ''}${t.thought.delta}</span></div>`);
      if (ts === 'l') iL = Math.max(5, Math.min(98, iL + t.thought.delta)); else iR = Math.max(5, Math.min(98, iR + t.thought.delta));
      $('#mL').style.width = iL + '%'; $('#mR').style.width = iR + '%';
    }
    chat.lastElementChild.scrollIntoView({ block: 'nearest', behavior: skip ? 'auto' : 'smooth' });
    if (!skip) await sleep(650);
  }
  $('#mL').style.width = d.scoreAB + '%'; $('#mR').style.width = d.scoreBA + '%'; $('#vL').textContent = `${d.scoreAB}/100`; $('#vR').textContent = `${d.scoreBA}/100`;
  const letter = (P_, deb) => `<div><h3>${esc(P_.first)}'s agent reports back ${deb.secondDate ? '<span class="badge b-y">wants a second date</span>' : '<span class="badge b-n">passes</span>'} <span class="num">· ${deb.score}/100</span></h3><div class="letter">${esc(deb.letter)}${deb.concerns?.length ? `<span class="sig">Concerns: ${deb.concerns.map(esc).join('; ')}</span>` : ''}</div></div>`;
  $('#deb').innerHTML = `<div class="verdict"><h3>The verdict</h3><h2>${d.mutual ? 'A match — both agents want a second date.' : 'No second date.'}</h2></div>
    <div class="letters">${letter(L, d.debriefA)}${letter(R, d.debriefB)}</div>
    <div class="row" style="margin-top:18px"><a class="btn" href="#/rankings/${L.id}">${esc(L.first)}'s ranking</a><a class="btn" href="#/rankings/${R.id}">${esc(R.first)}'s ranking</a></div>`;
  $('#deb').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------- rankings ----------------
function renderRankings(id) {
  const ps = pool(); const sel = (id && P(id)) ? id : null;
  const couples = S.dates.filter(d => d.mutual).sort((x, y) => avg(y) - avg(x)).slice(0, 10);
  const rows = sel ? (S.rankings[sel] || []) : [];
  app.innerHTML = `<h3>The rankings</h3><h1>${sel ? `Who fits ${esc(P(sel).first)} best` : 'Best couples of the night'}</h1><div class="mute" style="margin-bottom:18px;max-width:760px">Fit = 60% how much <i>their</i> agent rated the other person (after the date if they had one, otherwise after the speed screen) + 40% how much the other agent rated them back.</div>
  <div class="rk"><div class="plist">${ps.map(p => `<a href="#/rankings/${p.id}" class="${p.id === sel ? 'on' : ''}">${av(p, 'sm')}<span>${esc(p.name)}</span><span class="sp"></span><span class="small mute">${S.rankings[p.id]?.[0] ? esc(P(S.rankings[p.id][0].id)?.first) : ''}</span></a>`).join('')}</div>
  <div>${sel ? `<div class="row" style="margin-bottom:6px">${av(P(sel), 'md')}<div><div class="serif" style="font-size:20px">${esc(P(sel).name)}</div><div class="small mute">Seeks: ${V(P(sel)).needs.slice(0, 3).map(n => esc(n.label.toLowerCase())).join(' · ')}</div></div><span class="sp"></span><a class="btn sm" href="#/p/${sel}">Profile</a></div>
    <table class="ledger"><thead><tr><th>#</th><th></th><th>Person</th><th>Why</th><th style="text-align:right">Fit</th></tr></thead><tbody>
    ${rows.map((r, i) => { const o = P(r.id); if (!o) return ''; return `<tr><td class="pos">${i + 1}</td><td style="width:40px">${av(o, 'sm')}</td><td class="nmc"><a href="#/p/${o.id}">${esc(o.name)}</a><div class="small mute">${esc(V(o).tagline)}</div></td><td class="why">${esc(r.reason)}<div style="margin-top:4px">${r.dated ? `<a class="badge b-d" href="#/date/${sel}/${o.id}">read the date</a> ` : '<span class="badge b-n">speed screen only</span> '}${r.mutual ? '<span class="badge b-mut">mutual match</span> ' : ''}${r.secondDate ? '<span class="badge b-y">agent wants 2nd date</span>' : ''}</div></td><td class="fit num">${r.fit}<div class="small mute" style="font-family:var(--sans)">${r.mine} / ${r.theirs}</div></td></tr>`; }).join('')}</tbody></table>`
    : `<div>${couples.map(d => dateCard(d)).join('')}<p class="mute small">Pick a person on the left to see their full ranking.</p></div>`}</div></div>`;
}

// ---------------- how it works ----------------
function renderHow() {
  app.innerHTML = `<h3>Colophon</h3><h1>How it works</h1>
  <div class="pipe"><div><b>IN</b>LinkedIn + public Instagram URL</div><div><b>01</b>Scrape</div><div><b>02</b>Reading agent</div><div><b>03</b>Speed screens</div><div><b>04</b>Invitations</div><div><b>05</b>Two-agent dates</div><div><b>06</b>Debriefs & rankings</div></div>
  <div class="cols how">
  <div class="c6 sec"><h3><span class="no" style="color:var(--red)">01</span> Scraping — only two sources</h3><ul class="clean"><li><b>LinkedIn:</b> the public profile's schema.org JSON-LD (headline, about, roles, education, awards). Falls back to the Apify actor <code>harvestapi/linkedin-profile-scraper</code> when LinkedIn walls the server.</li><li><b>Instagram:</b> Apify <code>apify/instagram-profile-scraper</code> (bio, followers, latest posts with captions, hashtags, locations), with Instagram's public web endpoint as fallback. Private accounts are rejected.</li><li>No web search, no third-party bios.</li></ul></div>
  <div class="c6 sec"><h3><span class="no" style="color:var(--red)">02</span> The reading agent</h3><ul class="clean"><li>Both profiles become numbered evidence units (<code>L1</code> headline, <code>I4</code> an Instagram caption…).</li><li>An LLM on Groq (<code>gpt-oss-120b</code>, rotating to <code>gpt-oss-20b</code> / <code>qwen3</code> under rate limits) writes needs, hobbies, interests, qualities, watch-outs and dealbreakers — every claim must cite unit ids, which the site resolves back to the quote.</li><li>A deterministic keyword engine (${SIGNALS.length} signal families) runs alongside: it scores traits/lifestyle for fast screening and is the fallback if the LLM is unavailable.</li></ul></div>
  <div class="c6 sec"><h3><span class="no" style="color:var(--red)">03–05</span> The agents date</h3><ul class="clean"><li><b>Speed screens:</b> every compatible pair — each person has a gender and a “looking for” preference (default: opposite gender), and both sides must match — each agent scores the other against its own person's needs.</li><li><b>Invitations:</b> agents invite their favourites; an invite is accepted only if the inviter is in the invitee's own top 6 — rejection is real. A matchmaker pairs anyone left alone.</li><li><b>Dates:</b> six messages, alternating. Each message is a <i>separate</i> LLM call made as one agent, which sees only its own person's private dossier, the other person's public card and the transcript. Every message carries a private note and an interest change.</li></ul></div>
  <div class="c6 sec"><h3><span class="no" style="color:var(--red)">06</span> Debriefs & rankings</h3><ul class="clean"><li>After the date each agent, separately, writes a letter to its person, re-scores the fit and decides on a second date. Two yeses = a match.</li><li>Every person gets a full ranking: fit = 60% their agent's score + 40% reciprocity. Rankings are asymmetric — A can rank B first while B ranks A fifth.</li></ul></div>
  <div class="c12 sec"><h3>Try it</h3>Paste any LinkedIn + public Instagram on <a href="#/" style="border-bottom:1px solid">the pool</a> page. The new agent reads them, joins the pool, screens all ${pool().length - 1} others, goes on live dates and gets its own ranking.</div>
  </div>`;
}
init();
window.__app = { get S() { return S; }, addPerson, closeModal };
