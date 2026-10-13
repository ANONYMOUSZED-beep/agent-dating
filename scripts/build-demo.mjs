// Builds the finished example: scrape files -> rule features + LLM reading agent -> speed dates -> invites -> LLM two-agent dates -> rankings.
// LLM results are cached in data/llm so re-runs are free. Usage: node scripts/build-demo.mjs [--no-llm] [--invites 2]
import fs from 'fs';
import { analyzePerson } from '../public/engine/analyze.js';
import { runDatingNight, rankAll } from '../public/engine/date.js';
import { llmDate } from '../public/engine/llmdate.js';
for (const l of fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').split('\n') : []) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const { llmProfile, agentTurn, agentDebrief, hasLLM } = await import('../lib/llm.js');
const USE = hasLLM() && !process.argv.includes('--no-llm');
const INV = +(process.argv[process.argv.indexOf('--invites') + 1] || 1) || 1;
fs.mkdirSync('public/demo/img', { recursive: true }); fs.mkdirSync('data/llm/profiles', { recursive: true }); fs.mkdirSync('data/llm/dates', { recursive: true });
let tokens = 0;
async function pmap(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

const raws = fs.readdirSync('data/people').map(f => JSON.parse(fs.readFileSync('data/people/' + f)));
const people = await pmap(raws, 3, async raw => {
  const p = analyzePerson(raw);
  const img = `public/demo/img/${p.id}.jpg`;
  if (!fs.existsSync(img)) for (const u of [raw.linkedin.photo, raw.instagram.photo].filter(Boolean)) { try { const r = await fetch(u); if (r.ok) { fs.writeFileSync(img, Buffer.from(await r.arrayBuffer())); break; } } catch {} }
  if (fs.existsSync(img)) p.photo = `demo/img/${p.id}.jpg`;
  const cache = `data/llm/profiles/${p.id}.json`;
  if (fs.existsSync(cache)) p.llm = JSON.parse(fs.readFileSync(cache));
  else if (USE) {
    try { p.llm = await llmProfile(raw, { signals: [...p.hobbies, ...p.interests].map(x => x.label).join(', ') }); tokens += p.llm.usage; fs.writeFileSync(cache, JSON.stringify(p.llm)); console.log('profile', p.id, p.llm.model, p.llm.usage); }
    catch (e) { console.log('profile FAIL', p.id, e.message); }
  }
  p.raw = { linkedin: { ...raw.linkedin, photo: undefined }, instagram: { ...raw.instagram, photo: undefined, posts: raw.instagram.posts.map(x => ({ ...x, caption: x.caption.slice(0, 600) })) } };
  return p;
});
people.sort((a, b) => a.name.localeCompare(b.name));
const byId = Object.fromEntries(people.map(p => [p.id, p]));
const speed = [], ruleDates = [], invites = [];
for (const e of runDatingNight(people, { invites: INV })) { if (e.type === 'speed') speed.push(e.date); else if (e.type === 'date') ruleDates.push(e.date); else invites.push(e); }
const sv = (a, b) => { const s = speed.find(d => d.a === a && d.b === b); if (s) return s.scoreAB; return speed.find(d => d.a === b && d.b === a).scoreBA; };
const call = async (op, payload) => { const r = op === 'turn' ? await agentTurn(payload) : await agentDebrief(payload); tokens += r.usage || 0; return r; };
const dates = await pmap(ruleDates, 3, async rd => {
  const cache = `data/llm/dates/${rd.a}__${rd.b}.json`;
  if (fs.existsSync(cache)) {
    const d = JSON.parse(fs.readFileSync(cache));
    if (USE && process.argv.includes('--redebrief') && !d.rd2) { // re-run only the two debriefs with the current prompt
      const A = byId[d.a], B = byId[d.b], t = d.turns.map(({ speaker, text }) => ({ speaker, text }));
      const [x, y] = await Promise.all([call('debrief', { self: A, other: B, venue: d.venue.idea, turns: t, prior: sv(d.a, d.b) }), call('debrief', { self: B, other: A, venue: d.venue.idea, turns: t, prior: sv(d.b, d.a) })]);
      const deb = q => ({ score: q.score, secondDate: q.secondDate, letter: q.letter, highlights: q.highlights, concerns: q.concerns, model: q.model });
      Object.assign(d, { debriefA: deb(x), debriefB: deb(y), scoreAB: x.score, scoreBA: y.score, mutual: x.secondDate && y.secondDate, rd2: true });
      fs.writeFileSync(cache, JSON.stringify(d)); console.log('redebrief', d.a, d.b, d.scoreAB, d.scoreBA, d.mutual ? '♥' : '');
    }
    return d;
  }
  if (!USE) return rd;
  try {
    const d = await llmDate(byId[rd.a], byId[rd.b], { venue: rd.venue, priorAB: sv(rd.a, rd.b), priorBA: sv(rd.b, rd.a), call });
    fs.writeFileSync(cache, JSON.stringify(d)); console.log('date', rd.a, '×', rd.b, d.scoreAB, d.scoreBA, d.mutual ? '♥' : '', 'tokens so far', tokens);
    return d;
  } catch (e) { console.log('date FAIL (rule fallback)', rd.a, rd.b, e.message); return rd; }
});
const rankings = rankAll(people, speed, dates);
fs.writeFileSync('public/demo/demo.json', JSON.stringify({ builtAt: new Date().toISOString(), people, speed, invites, dates, rankings }));
console.log(`people ${people.length} (llm ${people.filter(p => p.llm).length}) · speed ${speed.length} · invites ${invites.length} (${invites.filter(i => i.accepted).length} accepted) · dates ${dates.length} (llm ${dates.filter(d => d.llm).length}) · mutual ${dates.filter(d => d.mutual).length} · tokens ${tokens}`);
