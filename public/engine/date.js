// The dating harness. Each person is represented by an agent that only knows what it read
// (its own principal's profile) plus what the other agent says on the date.
// Round 1: speed dates (every pair). Round 2: invitations. Round 3: full dates with private reasoning + debriefs.
import { IDEAS_G, fmtNum } from './analyze.js';

// ---------- utilities ----------
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let a = hash(String(seed)); return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickR = (r, arr) => arr[Math.floor(r() * arr.length)];
const clip = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : s; };
const clamp01 = x => Math.max(0, Math.min(1, x));
const lc = s => s.charAt(0).toLowerCase() + s.slice(1);
const shortHead = p => clip((p.headline || '').split(/[|•·,;]| – | - /)[0], 60);

let USED = null; // per-date memory so an agent never repeats the same quote
function quote(P, ids, preferIG = true) {
  for (const id of [].concat(ids)) {
    const ev = (P.evidenceBank?.[id] || []).filter(x => !USED || !USED.has(x.text));
    const e = (preferIG && ev.find(x => x.source.startsWith('Instagram'))) || ev[0];
    if (e) { if (USED) USED.add(e.text); return { text: clip(e.text, 95), source: e.source, id }; }
  }
  return null;
}
const said = q => q ? `${q.source.startsWith('Instagram') ? 'posted' : 'wrote'} “${q.text}”` : '';

// ---------- what satisfies each need (0..1) ----------
const NEED_SAT = {
  pace: o => (0.55 * o.lifestyle.workIntensity + 0.45 * o.traits.drive) / 85,
  quality: o => (0.45 * o.traits.warmth + 0.3 * o.values.family + 0.25 * (100 - o.lifestyle.workIntensity)) / 70,
  adventure: o => (0.55 * o.lifestyle.travel + 0.45 * o.traits.adventure) / 60,
  active: o => o.lifestyle.activity / 65,
  depth: o => (0.6 * o.traits.depth + 0.4 * o.traits.warmth) / 70,
  mind: o => (0.55 * o.traits.curiosity + 0.45 * o.values.knowledge) / 75,
  family: o => o.values.family / 70,
  play: o => o.traits.playful / 55,
  spotlight: o => o.lifestyle.publicLife / 75,
  purpose: o => o.values.impact / 60,
  calm: o => (0.7 * o.traits.calm + 0.3 * (100 - o.traits.drive)) / 50,
  growth: o => o.values.growth / 65,
  faith: o => o.values.faith / 60,
  creative: o => (0.6 * o.values.creativity + 0.4 * o.traits.curiosity) / 70,
};
const GENERIC = new Set(['entrepreneurship', 'marketing', 'leadership', 'writing', 'selfgrowth']);

// ---------- assessment: how well does B fit A's needs (from A's agent's point of view) ----------
export function assess(A, B) {
  const needs = A.needs.map(n => ({ id: n.id, label: n.label, weight: n.weight, sat: clamp01(NEED_SAT[n.id](B)) }));
  const W = needs.reduce((a, n) => a + n.weight, 0) || 1;
  const needsMet = needs.reduce((a, n) => a + n.weight * n.sat, 0) / W;
  let dot = 0, na = 0, nb = 0; const shared = [];
  for (const id of Object.keys(A.signals)) {
    const w = GENERIC.has(id) ? 0.35 : 1, a = A.signals[id] * w, b = (B.signals[id] || 0) * w;
    dot += a * b; na += a * a; nb += b * b;
    if (A.signals[id] >= 35 && B.signals[id] >= 35) shared.push({ id, score: Math.min(A.signals[id], B.signals[id]) * w });
  }
  shared.sort((x, y) => y.score - x.score);
  const sharedSim = dot / (Math.sqrt(na * nb) || 1);
  const L = ['workIntensity', 'activity', 'social', 'travel', 'familyFocus'];
  const lifestyle = 1 - L.reduce((a, k) => a + Math.abs(A.lifestyle[k] - B.lifestyle[k]), 0) / (L.length * 100);
  const V = Object.keys(A.values); let vd = 0, va = 0, vb = 0;
  for (const k of V) { vd += A.values[k] * B.values[k]; va += A.values[k] ** 2; vb += B.values[k] ** 2; }
  const values = vd / (Math.sqrt(va * vb) || 1);
  const base = 0.38 * needsMet + 0.24 * sharedSim + 0.16 * lifestyle + 0.22 * values;
  return { base, needsMet, sharedSim, lifestyle, values, needs, shared: shared.slice(0, 5).map(s => s.id) };
}

// ---------- dialogue library ----------
const LABEL = id => ({ running: 'running', fitness: 'training', yoga: 'yoga & meditation', outdoors: 'the outdoors', watersports: 'being on the water', racket: 'tennis & pickleball', travel: 'travel', food: 'food', wine: 'wine', reading: 'books', writing: 'writing', music: 'music', art: 'art & design', film: 'film & photography', sportsfan: 'sports', collecting: 'collecting', pets: 'animals', fashion: 'fashion', gaming: 'games', dance: 'a good party', entrepreneurship: 'building companies', investing: 'money & investing', tech: 'tech & AI', marketing: 'brands & media', leadership: 'leadership', psychology: 'psychology', wellbeing: 'wellbeing', selfgrowth: 'personal growth', speaking: 'the stage', podcast: 'podcasting', education: 'teaching', women: "women's empowerment", impact: 'giving back', spiritual: 'spirituality', family: 'family', friendship: 'friends', humor: 'humor' }[id] || id);

const Q = {
  pace: (A, B) => `${A.first} runs ${A.stats.roles > 3 ? `${A.stats.roles} things at once` : 'at full speed'} — ${shortHead(A)}. How does ${B.first} feel about a partner whose calendar is mostly work?`,
  quality: (A, B) => `When ${A.first} finally gets a night off, it's sacred. What does ${B.first} do with protected time together?`,
  adventure: (A, B) => `${A.first} would board a plane on 48 hours' notice. Would ${B.first}?`,
  active: (A, B) => `${A.first}'s ideal Saturday starts with ${LABEL(topActive(A))}. Is ${B.first} a training partner or a cheerleader?`,
  depth: (A, B) => `${A.first} gets bored by small talk fast. When did ${B.first} last have a conversation that changed their mind?`,
  mind: (A, B) => `${A.first} wants someone who can teach them something. What is ${B.first} obsessed with learning right now?`,
  family: (A, B) => `Family is everything to ${A.first}. Where does family sit for ${B.first}?`,
  play: (A, B) => `Important question: what's the last thing that made ${B.first} laugh out loud?`,
  spotlight: (A, B) => `${A.first} has ${fmtNum(A.stats.igFollowers)} people watching on Instagram. How would ${B.first} feel about a date ending up online?`,
  purpose: (A, B) => `${A.first} cares about ${LABEL(A.signals.women > A.signals.impact ? 'women' : 'impact')}. What would ${B.first} do if money didn't matter?`,
  calm: (A, B) => `${A.first} runs hot. How does ${B.first} switch off?`,
  growth: (A, B) => `${A.first} is always working on themselves. What is ${B.first} working on this year?`,
  faith: (A, B) => `What grounds ${B.first}? For ${A.first}, faith and gratitude are part of daily life.`,
  creative: (A, B) => `${A.first} makes things for a living. What has ${B.first} made lately that they're proud of?`,
};
function topActive(P) { return ['running', 'fitness', 'watersports', 'racket', 'yoga', 'outdoors'].sort((a, b) => P.signals[b] - P.signals[a])[0]; }
function topInterest(P) { return (P.interests.find(i => !GENERIC.has(i.id)) || P.interests[0] || P.hobbies[0] || { id: 'entrepreneurship' }).id; }

// Answers B's agent gives, by how well B actually fits (hi / mid / lo). Agents are instructed to be honest.
const ANS = {
  pace: { hi: (B, q) => `Honestly? ${B.first} gets it — they're ${shortHead(B)}. Two builders who respect each other's calendars beats one person waiting at home.`, mid: B => `${B.first} works hard too, but guards their evenings. They'd want a few non-negotiable nights a week.`, lo: (B, q, A) => `I'll be straight with you: ${B.first} would want more of ${A.first} than a shared calendar invite. That could be friction.` },
  quality: { hi: (B, q) => `Phones down is ${B.first}'s default with people they love${q ? ` — they ${said(q)}` : ''}.`, mid: B => `${B.first} would love that, but their own schedule is packed — it would need to be planned, not hoped for.`, lo: B => `${B.first} is in a heavy build phase. Protected time would be rare, not weekly.` },
  adventure: { hi: (B, q) => `Instantly. ${B.first} ${q ? said(q) : 'lives out of a carry-on'} — passport's always in the bag.`, mid: B => `For the right trip, yes — with a little notice and a good reason.`, lo: B => `${B.first} is more of a home-base person. A 48-hour-notice trip would stress them out.` },
  active: { hi: (B, q) => `Training partner, no question — ${B.first} ${q ? said(q) : 'trains most mornings'}.`, mid: B => `A cheerleader who'd join the occasional run if brunch is involved.`, lo: B => `Cheerleader. With snacks. At the finish line. ${B.first} doesn't train much.` },
  depth: { hi: (B, q) => `${B.first} lives for those conversations${q ? ` — they ${said(q)}` : ''}.`, mid: B => `${B.first} goes deep once they trust you. It takes a dinner or two.`, lo: B => `${B.first} is more of a doer than a processor — they'd rather show than talk about feelings.` },
  mind: { hi: (B, q) => `Right now? ${cap(LABEL(topInterest(B)))}${q ? `. They ${said(q)}` : ''}. They'd happily teach — and argue.`, mid: B => `${cap(LABEL(topInterest(B)))}. They're a learner, though more practical than academic.`, lo: B => `${B.first} learns by doing more than reading — expect stories, not citations.` },
  family: { hi: (B, q) => `At the very top${q ? `. ${B.first} ${said(q)}` : ''}.`, mid: B => `It matters a lot, though most of what ${B.first} shares publicly is about work.`, lo: B => `I can't promise a match there — family barely shows up in what ${B.first} shares. I'd rather flag it now.` },
  play: { hi: (B, q) => `${B.first}'s captions are basically stand-up${q ? ` — they ${said(q)}` : ''}.`, mid: B => `They have a dry sense of humor that shows up once they relax.`, lo: B => `${B.first} is more earnest than funny — warm, but not the class clown.` },
  spotlight: { hi: B => `${B.first} has ${fmtNum(B.stats.igFollowers)} followers of their own — the cameras won't faze them.`, mid: B => `They're public too, but they'd want a few things kept off the internet.`, lo: B => `That would be new for ${B.first}. They'd want the relationship kept private for a while.` },
  purpose: { hi: (B, q) => `What they already do: ${q ? `${B.first} ${said(q)}` : 'giving back is core to them'}.`, mid: B => `Probably ${LABEL(topInterest(B))} — but for the joy of it, not a cause.`, lo: B => `Truthfully, impact work isn't central for ${B.first} right now.` },
  calm: { hi: (B, q) => `${B.first} is the calm one in most rooms${q ? ` — they ${said(q)}` : ''}.`, mid: B => `With ${LABEL((B.hobbies[0] || { id: 'travel' }).id)} — that's their off-switch.`, lo: B => `Honestly, ${B.first} runs hot too. Two engines, no brakes — fun, but risky.` },
  growth: { hi: (B, q) => `${B.first} ${q ? said(q) : 'is in a big growth year'}. They'd love someone to level up with.`, mid: B => `Mostly their business — personal growth is more of a side quest.`, lo: B => `${B.first} is pretty settled in who they are; they're not chasing self-improvement.` },
  faith: { hi: (B, q) => `Same for ${B.first}${q ? ` — they ${said(q)}` : ''}.`, mid: B => `Gratitude more than religion, but they'd respect it deeply.`, lo: B => `${B.first} doesn't talk about faith publicly, so I'll mark that as unknown.` },
  creative: { hi: (B, q) => `${q ? `They ${said(q)}` : `${B.first} creates constantly`} — so yes, they'll value ${''}what you make.`, mid: B => `They're more of a creative consumer than a maker, but a great audience.`, lo: B => `${B.first} is more spreadsheet than sketchbook — they'd admire it, not share it.` },
};
const NEED_EVIDENCE = { quality: ['family', 'friendship'], adventure: ['travel', 'outdoors', 'watersports'], active: ['running', 'fitness', 'watersports', 'racket', 'yoga'], depth: ['psychology', 'wellbeing', 'spiritual'], mind: ['reading', 'psychology', 'tech', 'education'], family: ['family'], play: ['humor', 'dance'], purpose: ['impact', 'women'], calm: ['yoga', 'wellbeing', 'outdoors'], growth: ['selfgrowth'], faith: ['spiritual'], creative: ['art', 'writing', 'music', 'film'] };
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
const level = s => s >= 0.62 ? 'hi' : s >= 0.38 ? 'mid' : 'lo';

function answerNeed(needId, A, B) {
  const s = clamp01(NEED_SAT[needId](B)), lv = level(s);
  const q = quote(B, NEED_EVIDENCE[needId] || []);
  return { text: ANS[needId][lv](B, q, A), sat: s, level: lv };
}

function venueFor(A, B, assessAB) {
  const sharedHobby = assessAB.shared.find(id => IDEAS_G[id]);
  if (sharedHobby) return { id: sharedHobby, idea: IDEAS_G[sharedHobby], why: 'shared' };
  const a = A.hobbies.find(h => IDEAS_G[h.id]);
  if (a) return { id: a.id, idea: IDEAS_G[a.id], why: 'host' };
  return { id: 'food', idea: IDEAS_G.food, why: 'default' };
}

// ---------- Round 1: speed date (every pair) ----------
export function speedDate(A, B) {
  const r = rng(`speed:${A.id}:${B.id}`);
  const ab = assess(A, B), ba = assess(B, A);
  const topic = ab.shared[0] || topInterest(B);
  const qa = quote(B, topic);
  const turns = [
    { speaker: A.id, text: qa ? `Hi! I'm ${A.first}'s agent. Saw ${B.first} ${said(qa)} — ${A.signals[topic] >= 35 ? `${A.first} is into ${LABEL(topic)} too.` : `tell me more?`}` : `Hi! I'm ${A.first}'s agent. 90 seconds — tell me what ${B.first} is about.` },
    { speaker: B.id, text: `${B.first} is ${shortHead(B) ? `${lc(shortHead(B))}` : 'a builder'}, but off the clock it's ${(B.hobbies.slice(0, 2).map(h => LABEL(h.id)).join(' and ')) || 'mostly work, honestly'}. Quick one: ${lc(Q[B.needs[0].id](B, A).replace(/^.*?\. /, ''))}` },
    { speaker: A.id, text: answerNeed(B.needs[0].id, B, A).text },
  ];
  const noise = () => (r() - 0.5) * 8;
  const scoreAB = Math.round(Math.max(5, Math.min(97, ab.base * 100 + noise())));
  const scoreBA = Math.round(Math.max(5, Math.min(97, ba.base * 100 + noise())));
  return { a: A.id, b: B.id, turns, scoreAB, scoreBA, shared: ab.shared.slice(0, 3) };
}

// ---------- Round 3: full date ----------
export function fullDate(A, B) {
  const r = rng(`date:${A.id}:${B.id}`); USED = new Set();
  const ab = assess(A, B), ba = assess(B, A);
  const venue = venueFor(A, B, ab);
  const turns = []; let chemA = 0, chemB = 0; // chemistry as perceived by A's agent / B's agent
  const say = (who, text, thought) => turns.push({ speaker: who.id, text, thought: thought || null });
  const think = (by, text, delta) => ({ by: by.id, text, delta: Math.round(delta) });

  // 1. arrival
  const vq = quote(B, venue.id);
  say(A, `Hi, I'm ${A.first}'s agent. I booked ${venue.idea} — ${venue.why === 'shared' ? `${A.first} and ${B.first} are both into ${LABEL(venue.id)}` : `it's ${A.first}'s favourite thing, and I wanted ${B.first} to see that side`}.`);
  const bLikes = (B.signals[venue.id] || 0) >= 35;
  const d0 = bLikes ? 8 : B.traits.curiosity > 60 ? 2 : -3; chemB += d0;
  say(B, bLikes ? `Perfect pick. ${B.first} ${vq ? said(vq) : `loves ${LABEL(venue.id)}`} — you did your homework.` : `Bold choice — ${B.first} isn't really a ${LABEL(venue.id)} person, but ${B.traits.curiosity > 60 ? "they're curious, so let's go" : "let's see"}.`,
    think(B, bLikes ? `Venue fits ${B.first} (${LABEL(venue.id)}).` : `Venue isn't ${B.first}'s thing.`, d0));

  // 2. shared-interest conversation with real evidence
  const topics = ab.shared.filter(id => id !== venue.id).slice(0, 2);
  if (!topics.length) topics.push(topInterest(B));
  for (const t of topics) {
    const qb = quote(B, t), qa = quote(A, t);
    say(A, qb ? `I read that ${B.first} ${said(qb)} ${pickR(r, ['What\'s the story there?', 'How did that happen?', 'Is that a big part of their life?'])}` : `What does ${B.first} think about ${LABEL(t)}?`);
    const both = (A.signals[t] || 0) >= 35;
    const d = both ? 7 + r() * 4 : 1;
    chemA += d; chemB += both ? 5 : 1;
    say(B, `${pickR(r, ['Huge part.', 'Honestly, a lot.', 'It started small and took over.'])} ${B.first} ${B.signals[t] >= 60 ? `talks about ${LABEL(t)} constantly` : `is getting deeper into ${LABEL(t)}`}. ${qa ? `And I saw ${A.first} ${said(qa)} — so I think you know the feeling.` : `What about ${A.first}?`}`,
      think(A, both ? `Real overlap on ${LABEL(t)} — not just a keyword match.` : `${LABEL(t)} is theirs, not ours.`, d));
  }

  // 3. each agent probes its principal's top two needs; the other answers honestly
  const probe = (asker, responder, need, chemKey) => {
    say(asker, Q[need.id](asker, responder));
    const ans = answerNeed(need.id, asker, responder);
    const delta = ans.level === 'hi' ? 6 + need.weight / 20 : ans.level === 'mid' ? 0 : -9 - need.weight / 15;
    if (chemKey === 'A') chemA += delta; else chemB += delta;
    say(responder, ans.text, think(asker, `${ans.level === 'hi' ? '✓' : ans.level === 'mid' ? '≈' : '✗'} “${need.label}” — ${ans.level === 'hi' ? `exactly what ${asker.first} needs` : ans.level === 'mid' ? 'partial fit, worth testing' : 'a real mismatch, noting it'}.`, delta));
    return ans;
  };
  const resultsA = [probe(A, B, A.needs[0], 'A')];
  const resultsB = [probe(B, A, B.needs[0], 'B')];
  if (A.needs[1]) resultsA.push(probe(A, B, A.needs[1], 'A'));
  if (B.needs[1]) resultsB.push(probe(B, A, B.needs[1], 'B'));

  // 4. candid watch-out check
  const wo = B.watchouts[0];
  if (wo && !/Few red flags/.test(wo)) {
    say(A, `Honest question, agent to agent: my read on ${B.first} is “${lc(wo)}”. Fair?`);
    const fair = B.traits.depth > 50 || B.traits.warmth > 65;
    const d = fair ? 4 : -2; chemA += d;
    say(B, fair ? `Fair — and ${B.first} would say so themselves. They'd want a partner who calls it out kindly.` : `Partly. It's the public version — in private it's softer than it looks.`, think(A, fair ? 'Self-aware answer. Good sign.' : 'Slightly defensive. Minor flag.', d));
  }

  // 5. a lighter moment
  const playful = Math.max(A.traits.playful, B.traits.playful);
  if (playful > 40) {
    const h = (A.hobbies[0] || { id: 'travel' }).id;
    say(B, pickR(r, [`Okay, lightning round: would ${A.first} rather give up ${LABEL(h)} or coffee for a year?`, `Settle this: who would win at ${LABEL((B.hobbies[0] || { id: 'travel' }).id)} — ${A.first} or ${B.first}?`, `Most embarrassing thing ${A.first} has ever posted? Don't worry, I've already read them all.`]));
    const d = A.traits.playful > 35 ? 6 : 1; chemB += d;
    say(A, A.traits.playful > 35 ? pickR(r, ['Coffee. Obviously. Don\'t tell anyone.', `${B.first}, easily — but ${A.first} would demand a rematch.`, 'I plead the fifth. Next question.']) : `Ha — ${A.first} would take that question very seriously.`, think(B, A.traits.playful > 35 ? 'They play along. Fun energy.' : 'A bit literal, but sweet.', d));
  }

  // 6. close — each agent decides on its principal's behalf
  const chem = (c) => clamp01(0.35 + c / 90);
  const scoreAB = Math.round(Math.max(5, Math.min(98, 100 * (0.72 * ab.base + 0.28 * chem(chemA)) + (r() - 0.5) * 4)));
  const scoreBA = Math.round(Math.max(5, Math.min(98, 100 * (0.72 * ba.base + 0.28 * chem(chemB)) + (r() - 0.5) * 4)));
  const deal = res => res.some(x => x.level === 'lo');
  const yesA = scoreAB >= (deal(resultsA) ? 88 : 80), yesB = scoreBA >= (deal(resultsB) ? 88 : 80);
  const idea2 = (ab.shared.find(id => IDEAS_G[id] && id !== venue.id) && IDEAS_G[ab.shared.find(id => IDEAS_G[id] && id !== venue.id)]) || (B.dateIdeas.find(d => d.hobby !== venue.id)?.idea) || 'dinner somewhere quiet';
  say(A, yesA ? `This went well. I'd like to set up a second date — maybe ${idea2}?` : `This was lovely, and I'll be honest with ${A.first} about it: great people, maybe not the right fit.`);
  say(B, yesB ? (yesA ? `Yes. ${B.first} is in. Let's sync calendars before they fill up.` : `For what it's worth, I'd have said yes.`) : (yesA ? `I appreciate that. I need to be honest with ${B.first} too — I don't think the needs line up.` : `Agreed. Respect to ${A.first}.`));

  const debrief = (P, O, mine, score, yes, chemV) => {
    const hits = mine.filter(x => x.ans.level === 'hi').map(x => x.need.label.toLowerCase());
    const miss = mine.filter(x => x.ans.level === 'lo').map(x => x.need.label.toLowerCase());
    const sh = (P === A ? ab : ba).shared.slice(0, 2).map(LABEL);
    return {
      score, secondDate: yes, chemistry: Math.round(chem(chemV) * 100),
      letter: `${P.first}, I went out with ${O.first}'s agent (${venue.idea}). ${sh.length ? `You share ${sh.join(' and ')}. ` : ''}` +
        `${hits.length ? `What worked: ${hits.join('; ')}. ` : ''}${miss.length ? `What worries me: ${miss.join('; ')}. ` : 'No dealbreakers came up. '}` +
        `${yes ? `I said yes to a second date — ${score}/100.` : `I'm passing, kindly — ${score}/100.`}`,
    };
  };
  return {
    a: A.id, b: B.id, venue, turns,
    debriefA: debrief(A, B, A.needs.slice(0, 2).map((n, i) => ({ need: n, ans: resultsA[i] })), scoreAB, yesA, chemA),
    debriefB: debrief(B, A, B.needs.slice(0, 2).map((n, i) => ({ need: n, ans: resultsB[i] })), scoreBA, yesB, chemB),
    scoreAB, scoreBA, mutual: yesA && yesB,
  };
}

// ---------- the whole night ----------
export function* runDatingNight(pool, { invites = 3, focusId = null } = {}) {
  const speed = {};
  const ids = pool.map(p => p.id);
  const byId = Object.fromEntries(pool.map(p => [p.id, p]));
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    if (focusId && pool[i].id !== focusId && pool[j].id !== focusId) continue;
    const s = speedDate(pool[i], pool[j]); speed[`${s.a}|${s.b}`] = s;
    yield { type: 'speed', date: s };
  }
  const sv = (a, b) => { const s = speed[`${a}|${b}`]; if (s) return s.scoreAB; const t = speed[`${b}|${a}`]; return t ? t.scoreBA : null; };
  const pairs = new Map();
  for (const a of ids) {
    if (focusId && a !== focusId) continue;
    const ranked = ids.filter(b => b !== a && sv(a, b) != null).sort((x, y) => sv(a, y) - sv(a, x));
    let sent = 0;
    for (const b of ranked) {
      if (sent >= invites) break;
      const theirTop = ids.filter(c => c !== b && sv(b, c) != null).sort((x, y) => sv(b, y) - sv(b, x)).slice(0, 6);
      const accepted = theirTop.includes(a) || sv(b, a) >= 78;
      yield { type: 'invite', from: a, to: b, accepted, score: sv(a, b) };
      if (accepted) { const k = [a, b].sort().join('|'); if (!pairs.has(k)) pairs.set(k, [a, b]); sent++; }
    }
  }
  // Matchmaker fallback: anyone left without a date gets their best mutual speed-date match.
  const dated = new Set([...pairs.values()].flat());
  for (const a of ids) {
    if (dated.has(a) || (focusId && a !== focusId)) continue;
    const best = ids.filter(b => b !== a && sv(a, b) != null).sort((x, y) => Math.min(sv(a, y), sv(y, a)) - Math.min(sv(a, x), sv(x, a)))[0];
    if (best) { pairs.set([a, best].sort().join('|'), [a, best]); dated.add(a); dated.add(best); yield { type: 'invite', from: a, to: best, accepted: true, score: sv(a, best), matchmaker: true }; }
  }
  for (const [a, b] of pairs.values()) yield { type: 'date', date: fullDate(byId[a], byId[b]) };
}

export function rankAll(pool, speedDates, fullDates) {
  const get = (map, a, b) => { const d = map[`${a}|${b}`]; if (d) return [d.scoreAB, d.scoreBA, d]; const e = map[`${b}|${a}`]; return e ? [e.scoreBA, e.scoreAB, e] : null; };
  const S = Object.fromEntries(speedDates.map(d => [`${d.a}|${d.b}`, d]));
  const F = Object.fromEntries(fullDates.map(d => [`${d.a}|${d.b}`, d]));
  const out = {};
  for (const A of pool) {
    const rows = [];
    for (const B of pool) {
      if (A.id === B.id) continue;
      const f = get(F, A.id, B.id), s = get(S, A.id, B.id);
      if (!f && !s) continue;
      const [mine, theirs, d] = f || s;
      const fit = Math.round(0.6 * mine + 0.4 * theirs - (f ? 0 : 3));
      const as = assess(A, B);
      const met = as.needs.filter(n => n.sat >= 0.62).map(n => n.label.toLowerCase());
      const reason = [as.shared.slice(0, 2).map(LABEL).join(' + ') && `shares ${as.shared.slice(0, 2).map(LABEL).join(' + ')}`, met[0] && `meets “${met[0]}”`].filter(Boolean).join(' · ') || 'complementary lifestyles';
      const mySecond = f ? (d.a === A.id ? d.debriefA.secondDate : d.debriefB.secondDate) : null;
      rows.push({ id: B.id, fit, mine, theirs, dated: !!f, mutual: f ? d.mutual : false, secondDate: mySecond, reason });
    }
    rows.sort((x, y) => y.fit - x.fit);
    out[A.id] = rows;
  }
  return out;
}
