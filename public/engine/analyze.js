// The reading agent: turns a LinkedIn + Instagram scrape into a dating profile.
// Deterministic and explainable: every claim keeps the evidence (quote + source) that produced it.
import { SIGNALS, TONE } from './taxonomy.js';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mk = kw => /[a-z0-9]/i.test(kw) ? new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(kw)}(?=$|[^\\p{L}\\p{N}])`, 'iu') : { test: s => s.includes(kw) };
const COMPILED = SIGNALS.map(s => ({ ...s, re: s.kw.map(mk) }));
const TONE_RE = Object.fromEntries(Object.entries(TONE).map(([k, v]) => [k, v.map(mk)]));
const sat = (x, k) => Math.round(100 * (1 - Math.exp(-Math.max(0, x) / k)));
const clamp = (x, a = 4, b = 98) => Math.max(a, Math.min(b, Math.round(x)));
export const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n || 0);
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const sentences = t => clean(t).split(/(?<=[.!?…])\s+|\s[•|·]\s|\n/).map(x => x.trim()).filter(x => x.length > 3);
function snippet(sentence, max = 150) { const s = clean(sentence); return s.length > max ? s.slice(0, max - 1).replace(/\s\S*$/, '') + '…' : s; }

export function slugId(name) { return clean(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// Build the list of text units the agent reads, each tagged with its source and weight.
export function corpus(raw) {
  const li = raw.linkedin, ig = raw.instagram, U = [];
  const add = (text, source, weight, url) => { if (clean(text)) U.push({ text: clean(text), source, weight, url }); };
  add(li.headline, 'LinkedIn headline', 2, li.url);
  sentences(li.about).forEach(s => add(s, 'LinkedIn about', 1.2, li.url));
  (li.jobTitles || []).forEach(t => add(t, 'LinkedIn role', 0.8, li.url));
  (li.positions || []).forEach(p => { add([p.title, p.company].filter(Boolean).join(' at '), 'LinkedIn experience', 0.6, li.url); sentences(p.description).slice(0, 6).forEach(s => add(s, `LinkedIn · ${p.company || 'experience'}`, 0.6, li.url)); });
  (li.education || []).forEach(e => add([e.school, e.description].filter(Boolean).join(' — '), 'LinkedIn education', 0.5, li.url));
  (li.awards || []).forEach(a => add(a, 'LinkedIn award', 0.5, li.url));
  (li.skills || []).forEach(a => add(a, 'LinkedIn skill', 0.3, li.url));
  (li.posts || []).forEach(p => add(snippet(p, 400), 'LinkedIn post', 0.8, li.url));
  sentences(ig.bio).forEach(s => add(s, 'Instagram bio', 2, ig.url));
  if (ig.category) add(ig.category, 'Instagram category', 1, ig.url);
  (ig.posts || []).forEach((p, i) => {
    const cap = clean(p.caption);
    sentences(cap).slice(0, 8).forEach(s => add(s, `Instagram post${p.location ? ' · ' + p.location : ''}`, 1, p.url || ig.url));
    if (p.location) add(p.location, 'Instagram post location', 1, p.url || ig.url);
    (p.hashtags || []).forEach(h => add('#' + h, 'Instagram hashtag', 0.7, p.url || ig.url));
  });
  return U;
}

export function analyzePerson(raw) {
  const li = raw.linkedin, ig = raw.instagram;
  const name = clean(li.name || ig.fullName);
  const first = name.split(' ')[0];
  const units = corpus(raw);
  const words = units.reduce((n, u) => n + u.text.split(/\s+/).length, 0);

  // 1) Signal extraction with evidence
  const signals = {};
  for (const s of COMPILED) {
    let raw = 0; const ev = [];
    for (const u of units) {
      if (s.re.some(r => r.test(u.text))) {
        raw += u.weight * (s.kind === 'hobby' && u.source.startsWith('LinkedIn') ? 0.4 : 1);
        if (ev.length < 6 && !ev.some(e => e.text === u.text)) ev.push({ source: u.source, text: snippet(u.text), url: u.url });
      }
    }
    const igHits = ev.filter(e => e.source.startsWith('Instagram')).length;
    signals[s.id] = { id: s.id, label: s.label, kind: s.kind, raw, score: sat(raw, s.kind === 'interest' ? 6 : 3.2), ig: igHits, evidence: ev, fx: s.fx };
  }

  // 2) Tone & traits
  const tone = Object.fromEntries(Object.keys(TONE_RE).map(k => [k, 0]));
  for (const u of units) for (const [k, res] of Object.entries(TONE_RE)) if (res.some(r => r.test(u.text))) tone[k] += u.weight;
  const followers = Math.max(ig.followers || 0, li.followers || 0);
  const roles = new Set([...(li.jobTitles || []), ...(li.positions || []).map(p => p.company)].filter(Boolean)).size;
  const founderish = (li.jobTitles || []).concat(li.headline || '').filter(t => /founder|ceo|chair|owner|partner|president|investor/i.test(t)).length;
  const T = { drive: 0, warmth: 0, curiosity: 0, depth: 0, calm: 0, adventure: 0, social: 0, playful: 0, discipline: 0, active: 0 };
  for (const s of Object.values(signals)) for (const [k, v] of Object.entries(s.fx || {})) T[k] = (T[k] || 0) + v * s.score / 100;
  for (const k of Object.keys(tone)) T[k] += tone[k] * 0.22;
  T.drive += Math.min(6, founderish * 0.6) + Math.min(3, roles * 0.15);
  T.social += Math.max(0, Math.log10(followers + 1) - 4) * 0.5;
  const traits = {
    drive: clamp(sat(T.drive, 7)), warmth: clamp(sat(T.warmth, 6)), curiosity: clamp(sat(T.curiosity, 6)), depth: clamp(sat(T.depth, 6)),
    calm: clamp(sat(T.calm, 4)), adventure: clamp(sat(T.adventure, 4)), social: clamp(sat(T.social, 7)), playful: clamp(sat(T.playful, 3.5)), discipline: clamp(sat(T.discipline, 4)),
  };
  const sc = id => signals[id].score;
  const lifestyle = {
    workIntensity: clamp(0.6 * traits.drive + 0.4 * Math.min(100, roles * 7)),
    activity: clamp(Math.max(sc('running'), sc('fitness'), sc('watersports'), 0.8 * sc('racket'), 0.6 * sc('yoga'), 0.4 * sc('outdoors'))),
    social: traits.social, travel: clamp(sc('travel')), familyFocus: clamp(sc('family')),
    publicLife: clamp(Math.max(0, (Math.log10(followers + 1) - 3) * 24)),
  };
  const values = {
    family: sc('family'), growth: sc('selfgrowth'), impact: clamp(Math.max(sc('impact'), 0.8 * sc('women')), 0), wealth: sc('investing'),
    health: clamp(Math.max(sc('wellbeing'), 0.7 * sc('fitness'), 0.7 * sc('running')), 0), faith: sc('spiritual'),
    creativity: clamp(Math.max(sc('art'), sc('writing') * 0.8, sc('music'), sc('film') * 0.8), 0), adventure: clamp(Math.max(sc('travel'), sc('outdoors'), sc('watersports')), 0),
    knowledge: clamp(Math.max(sc('psychology'), sc('reading'), sc('education') * 0.8, sc('tech') * 0.7), 0),
  };

  const hobbies = Object.values(signals).filter(s => s.kind === 'hobby' && s.score >= 25).sort((a, b) => (b.score + b.ig * 4) - (a.score + a.ig * 4)).slice(0, 7);
  const interests = Object.values(signals).filter(s => s.kind === 'interest' && s.score >= 25).sort((a, b) => b.score - a.score).slice(0, 7);
  const ev1 = id => signals[id].evidence[0];

  // 3) Relationship needs (what this person needs from a partner), each with a reason
  const titles = [...new Set((li.jobTitles || []).filter(Boolean))].slice(0, 3).join(', ');
  const N = [
    { id: 'pace', label: 'A partner who can keep pace with an all-in career', s: lifestyle.workIntensity, why: `${roles} roles on LinkedIn${titles ? ` (${titles})` : ''} — work is a big part of ${first}'s identity.`, ev: { source: 'LinkedIn headline', text: snippet(li.headline || titles) } },
    { id: 'quality', label: 'Protected, phones-down quality time', s: Math.min(lifestyle.workIntensity, 0.5 * traits.warmth + 0.5 * values.family) + 8, why: `High workload plus visible warmth toward the people close to them — time is the scarce resource.`, ev: ev1('family') || ev1('friendship') },
    { id: 'adventure', label: 'A co-adventurer who says yes to the trip', s: 0.6 * lifestyle.travel + 0.4 * traits.adventure, why: `Instagram is full of movement — ${signals.travel.ig} recent posts mention places or trips.`, ev: ev1('travel') || ev1('outdoors') },
    { id: 'active', label: 'Someone who shares an active lifestyle', s: lifestyle.activity, why: `Training shows up in their own posts, not just their bio.`, ev: ev1('running') || ev1('fitness') || ev1('watersports') || ev1('racket') },
    { id: 'depth', label: 'Emotional depth and honest conversations', s: traits.depth, why: `Writes about meaning, feelings and inner life — small talk won't hold them.`, ev: ev1('psychology') || ev1('wellbeing') || ev1('spiritual') },
    { id: 'mind', label: 'Intellectual sparring — someone who can teach them something', s: 0.5 * traits.curiosity + 0.5 * values.knowledge, why: `Ideas, research and books are recurring topics.`, ev: ev1('reading') || ev1('psychology') || ev1('tech') || ev1('education') },
    { id: 'family', label: 'A family-first partner', s: values.family, why: `Family appears repeatedly across both profiles.`, ev: ev1('family') },
    { id: 'play', label: 'Lightness — someone who makes them laugh', s: traits.playful, why: `Their own captions are playful; humor is part of how they connect.`, ev: ev1('humor') || ev1('dance') },
    { id: 'spotlight', label: 'Someone at ease with a very public life', s: lifestyle.publicLife * 0.7, why: `${fmtNum(followers)} followers across LinkedIn + Instagram — dates may be photographed, partners get noticed.`, ev: { source: 'Instagram', text: `@${ig.username} · ${fmtNum(ig.followers)} Instagram followers · ${fmtNum(li.followers)} on LinkedIn` } },
    { id: 'purpose', label: 'Shared purpose beyond the pay-check', s: values.impact, why: `Talks about giving back and changing things for others.`, ev: ev1('impact') || ev1('women') },
    { id: 'calm', label: 'A grounding, calm presence', s: 0.8 * Math.max(0, (traits.drive + traits.social) / 2 - traits.calm / 3), why: `Runs hot — lots of output, lots of people. A steady partner balances that.`, ev: null },
    { id: 'growth', label: 'A partner committed to growing together', s: values.growth, why: `Self-improvement and mindset are core themes.`, ev: ev1('selfgrowth') },
    { id: 'faith', label: 'Spiritual alignment', s: values.faith * 0.9, why: `Faith, gratitude or spirituality comes up in their own words.`, ev: ev1('spiritual') },
    { id: 'creative', label: 'Appreciation for creative work', s: values.creativity, why: `Creative output (design, writing, music, film) is part of who they are.`, ev: ev1('art') || ev1('writing') || ev1('music') || ev1('film') },
  ];
  const needs = N.filter(n => n.s >= 30).sort((a, b) => b.s - a.s).slice(0, 5).map(n => ({ id: n.id, label: n.label, why: n.why, weight: Math.round(n.s), evidence: n.ev || null }));
  if (needs.length < 3) for (const n of N.sort((a, b) => b.s - a.s)) if (!needs.find(x => x.id === n.id) && needs.length < 3) needs.push({ id: n.id, label: n.label, why: n.why, weight: Math.round(n.s), evidence: n.ev || null });

  // 4) Style, love language, archetype
  const caps = (ig.posts || []).map(p => clean(p.caption)).filter(Boolean);
  const avgLen = caps.length ? caps.reduce((a, c) => a + c.length, 0) / caps.length : 0;
  const emoji = caps.join(' ').match(/\p{Extended_Pictographic}/gu)?.length || 0;
  const qs = caps.filter(c => c.includes('?')).length, ex = (caps.join(' ').match(/!/g) || []).length;
  const commStyle = avgLen > 600 ? { label: 'Long-form storyteller', detail: `Average caption is ${Math.round(avgLen)} characters — they explain, they don't just post.` }
    : emoji / Math.max(1, caps.length) > 3 || ex > caps.length * 1.5 ? { label: 'High-energy & expressive', detail: `${emoji} emoji and ${ex} exclamation marks across ${caps.length} captions.` }
    : qs >= caps.length / 3 ? { label: 'Curious question-asker', detail: `${qs} of ${caps.length} captions ask the audience a question.` }
    : avgLen < 120 ? { label: 'Short & punchy', detail: `Captions average ${Math.round(avgLen)} characters — they let the picture talk.` }
    : { label: 'Warm & conversational', detail: `Mid-length captions (${Math.round(avgLen)} chars) written like a note to friends.` };
  const allText = units.map(u => u.text).join(' \n ').toLowerCase();
  const count = arr => arr.reduce((n, w) => n + (allText.split(w).length - 1), 0);
  const LL = [
    ['Words of affirmation', count(['proud of', 'thank you', 'grateful', 'you are', "you're", 'believe in', 'love you', 'so proud'])],
    ['Quality time', count(['together', 'time with', 'weekend', 'date night', 'family time', 'with my', 'moments'])],
    ['Acts of service', count(['help', 'support', 'serve', 'cook for', 'take care', 'show up for'])],
    ['Gifts & gestures', count(['gift', 'surprise', 'flowers', 'present for'])],
    ['Physical touch', count(['hug', 'kiss', 'cuddle', 'hold hands'])],
  ].sort((a, b) => b[1] - a[1]);
  const loveLanguage = { primary: LL[0][0], secondary: LL[1][0], why: `Most frequent relationship language in their posts: "${LL[0][0].toLowerCase()}" (${LL[0][1]} cues), then "${LL[1][0].toLowerCase()}" (${LL[1][1]}).` };
  const topT = Object.entries(traits).sort((a, b) => (b[1] - REF[b[0]]) - (a[1] - REF[a[0]])).map(x => x[0]);
  const ARCH = { 'drive+social': 'The Spotlight Builder', 'drive+discipline': 'The Relentless Operator', 'drive+warmth': 'The Big-Hearted Hustler', 'drive+curiosity': 'The Restless Idea Machine', 'drive+adventure': 'The Adventurer-Founder', 'drive+depth': 'The Purpose-Driven Builder', 'drive+playful': 'The Fun-Loving Dealmaker', 'drive+calm': 'The Steady Captain',
    'warmth+social': 'The Connector', 'warmth+depth': 'The Warm Deep-Diver', 'warmth+curiosity': 'The Generous Mind', 'warmth+playful': 'The Sunshine Friend', 'curiosity+depth': 'The Thoughtful Explorer', 'depth+calm': 'The Grounded Sage', 'adventure+social': 'The Globe-Trotting Host', 'adventure+curiosity': 'The Curious Wanderer', 'social+playful': 'The Life of the Party', 'discipline+warmth': 'The Devoted Achiever', 'curiosity+social': 'The Professional Conversationalist', 'depth+social': 'The Stage Philosopher', 'adventure+warmth': 'The Open-Hearted Explorer', 'playful+discipline': 'The Joyful Grinder', 'curiosity+playful': 'The Playful Mind', 'calm+playful': 'The Easygoing Soul', 'adventure+playful': 'The Thrill-Seeker', 'discipline+social': 'The Disciplined Performer', 'calm+warmth': 'The Gentle Anchor', 'calm+curiosity': 'The Quiet Learner', 'adventure+discipline': 'The Expedition Leader', 'calm+discipline': 'The Monk-Mode Achiever', 'curiosity+discipline': 'The Systematic Learner', 'depth+discipline': 'The Devoted Seeker', 'adventure+calm': 'The Free Spirit', 'adventure+depth': 'The Soulful Explorer', 'calm+social': 'The Gracious Host', 'depth+playful': 'The Funny Philosopher', 'social+warmth': 'The Connector', 'calm+drive': 'The Steady Captain', 'playful+warmth': 'The Sunshine Friend', 'playful+social': 'The Life of the Party', 'depth+warmth': 'The Warm Deep-Diver' };
  const key = [topT[0], topT[1]].join('+'), rkey = [topT[1], topT[0]].join('+');
  const archetype = ARCH[key] || ARCH[rkey] || `The ${cap(topT[0])}-${cap(topT[1])} Type`;

  const OFFERS = { drive: 'Brings momentum — will champion a partner\'s ambitions like their own', warmth: 'Openly affectionate and generous with praise', curiosity: 'Endlessly curious — always asks the second question', depth: 'Comfortable with real, emotional conversations', calm: 'A steady, unhurried presence', adventure: 'Says yes to spontaneous plans', social: 'Comes with a big, lively social world', playful: 'Doesn\'t take themselves too seriously', discipline: 'Reliable — shows up when they say they will' };
  const offers = topT.slice(0, 3).map(t => OFFERS[t]);
  const watchouts = [];
  if (lifestyle.workIntensity > 75) watchouts.push('Calendar risk: dates will get moved around launches and travel');
  if (lifestyle.publicLife > 70) watchouts.push('Lives in public — a partner must be OK with an audience');
  if (traits.drive > 80 && traits.calm < 35) watchouts.push('Rarely in off-mode; may need a nudge to rest');
  if (traits.social > 80) watchouts.push('An introverted partner may feel outnumbered by their world');
  if (traits.playful < 25) watchouts.push('Can read as intense or serious at first');
  if (traits.depth > 75 && traits.playful < 40) watchouts.push('Wants depth fast — light, flirty small talk may fall flat');
  if (!watchouts.length) watchouts.push('Few red flags in public data — the agent will probe values in person');

  const IDEAS = IDEAS_G; const _unused = { running: 'a sunrise 5K and flat whites after', fitness: 'a partner workout, then smoothies', yoga: 'sunrise yoga and a long breakfast', outdoors: 'a sunset hike with a picnic at the top', watersports: 'an afternoon on a sailboat', racket: 'a pickleball doubles grudge match', travel: 'tapas while planning a dream trip', food: 'a chef\'s-counter tasting menu', wine: 'a candle-lit natural-wine bar', reading: 'a bookstore crawl, each picking a book for the other', writing: 'a writers\' café, swapping first drafts', music: 'a tiny jazz club', art: 'a late-night museum opening', film: 'an indie-cinema double feature', sportsfan: 'courtside seats at a game', collecting: 'a Saturday flea-market treasure hunt', pets: 'a dog-park walk and coffee', fashion: 'vintage-store shopping', gaming: 'an arcade bar', dance: 'a salsa night' };
  const dateIdeas = hobbies.slice(0, 4).map(h => ({ hobby: h.id, idea: IDEAS[h.id] })).filter(x => x.idea);
  const ll = li.location ? ` in ${li.location.split(',')[0]}` : '';
  const head = li.headline ? li.headline.replace(/\s+/g, ' ') : titles;
  const summary = `On LinkedIn, ${name} leads with “${snippet(head, 110)}”${ll}${roles > 1 ? `, across ${roles} roles` : ''}. ` +
    `Instagram (@${ig.username}, ${fmtNum(ig.followers)} followers, ${caps.length} recent posts read) shows the off-duty side: ${hobbies.slice(0, 3).map(h => h.label.toLowerCase()).join(', ') || 'mostly work, very little leisure'}. ` +
    `Writing voice: ${commStyle.label.toLowerCase()}. Compared with the rest of the pool they stand out for ${topT[0]} and ${topT[1]}. ` +
    `The agent's read: ${archetype.replace(/^The /, 'a ').toLowerCase()} who most needs ${needs[0]?.label.toLowerCase().replace(/^an? /, 'a ').replace(/^someone /, 'someone ')}.`;
  const idealPartner = `Someone who offers ${needs.slice(0, 3).map(n => n.label.toLowerCase().replace(/^(a|an) /, '').replace(/^someone who /, '')).join('; ')}.`;
  const datingStrategy = {
    openers: [...hobbies.slice(0, 2), ...interests.slice(0, 1)].map(h => `Open on ${h.label.toLowerCase()} — "${h.evidence[0]?.text}"`),
    mustAsk: needs.slice(0, 3).map(n => QUESTION_HINT[n.id]),
    avoid: watchouts.slice(0, 2),
  };

  const reading = [
    { step: 'Fetched LinkedIn public profile', source: 'LinkedIn', detail: `${name} · ${snippet(head, 80)} · ${(li.positions || []).length} positions · ${sentences(li.about).length} about-sentences · via ${li.source}` },
    { step: 'Fetched Instagram public profile', source: 'Instagram', detail: `@${ig.username} · ${fmtNum(ig.followers)} followers · ${caps.length} recent captions · via ${ig.source}` },
    { step: 'Read every text unit', source: 'Agent', detail: `${units.length} units · ${words.toLocaleString()} words scanned against ${SIGNALS.length} signal families` },
    { step: 'Found hobbies (what they do)', source: 'Agent', detail: hobbies.map(h => `${h.label} ${h.score}`).join(' · ') || 'none above threshold' },
    { step: 'Found interests (what they think about)', source: 'Agent', detail: interests.map(h => `${h.label} ${h.score}`).join(' · ') },
    { step: 'Scored personality traits', source: 'Agent', detail: Object.entries(traits).map(([k, v]) => `${k} ${v}`).join(' · ') },
    { step: 'Inferred relationship needs', source: 'Agent', detail: needs.map(n => n.label).join(' · ') },
  ];

  return {
    id: slugId(name), name, first, photo: li.photo || '', headline: head, location: li.location || '',
    links: { linkedin: li.url, instagram: ig.url }, username: ig.username,
    stats: { igFollowers: ig.followers || 0, liFollowers: li.followers || 0, postsRead: caps.length, units: units.length, words, roles },
    archetype, summary, commStyle, loveLanguage, traits, lifestyle, values, needs, offers, watchouts, idealPartner, datingStrategy, dateIdeas,
    hobbies: hobbies.map(pick), interests: interests.map(pick), signals: Object.fromEntries(Object.values(signals).map(s => [s.id, s.score])),
    evidenceBank: Object.fromEntries(Object.values(signals).filter(s => s.evidence.length).map(s => [s.id, s.evidence.slice(0, 3)])),
    reading, sources: { linkedin: li.source, instagram: ig.source }, analyzedAt: new Date().toISOString(),
  };
}
// Pool averages: traits are ranked relative to the other profiles the agent has read
export const REF = { drive: 62, warmth: 60, curiosity: 66, depth: 45, calm: 20, adventure: 22, social: 62, playful: 30, discipline: 25 };
export const IDEAS_G = { running: 'a sunrise 5K and flat whites after', fitness: 'a partner workout, then smoothies', yoga: 'sunrise yoga and a long breakfast', outdoors: 'a sunset hike with a picnic at the top', watersports: 'an afternoon on a sailboat', racket: 'a pickleball doubles grudge match', travel: 'tapas while planning a dream trip', food: "a chef's-counter tasting menu", wine: 'a candle-lit natural-wine bar', reading: 'a bookstore crawl, each picking a book for the other', writing: "a writers' café, swapping first drafts", music: 'a tiny jazz club', art: 'a late-night museum opening', film: 'an indie-cinema double feature', sportsfan: 'courtside seats at a game', collecting: 'a Saturday flea-market treasure hunt', pets: 'a dog-park walk and coffee', fashion: 'vintage-store shopping', gaming: 'an arcade bar', dance: 'a salsa night' };
const pick = s => ({ id: s.id, label: s.label, score: s.score, evidence: s.evidence.slice(0, 3) });
const cap = s => s[0].toUpperCase() + s.slice(1);
export const DATE_IDEAS = IDEAS_G;
export const QUESTION_HINT = {
  pace: 'How do they feel about a partner whose calendar is mostly work?', quality: 'What does protected time together look like for them?',
  adventure: 'Would they board a plane on 48 hours\' notice?', active: 'Do they want a training partner or a cheerleader?',
  depth: 'When did they last have a conversation that changed their mind?', mind: 'What are they obsessed with learning right now?',
  family: 'Where does family sit in their priorities?', play: 'What\'s the last thing that made them laugh out loud?',
  spotlight: 'How do they feel about being photographed on a date?', purpose: 'What would they do if money didn\'t matter?',
  calm: 'How do they switch off?', growth: 'What are they working on in themselves this year?', faith: 'What grounds them spiritually?',
  creative: 'What have they made recently that they\'re proud of?',
};
