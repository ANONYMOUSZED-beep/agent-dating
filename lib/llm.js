// Groq LLM layer: the "brain" of each agent. Server-side only (the key never reaches the browser).
// Three models rotate so the free-tier per-model token limits stack; on 429 we hop to the next model.
const MODELS = (process.env.GROQ_MODELS || 'openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b').split(',');
const cool = {}; // model -> timestamp until which it is rate-limited
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function parseJSON(t) {
  t = String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 ? t.slice(a, b + 1) : t);
}
function waitFrom(res, body) {
  const h = res.headers.get('retry-after'); if (h && +h) return +h * 1000;
  const m = /try again in ([\d.]+)(ms|s|m)/i.exec(body || ''); if (m) return +m[1] * (m[2] === 'ms' ? 1 : m[2] === 'm' ? 60000 : 1000);
  return 8000;
}
export function hasLLM() { return !!process.env.GROQ_API_KEY; }

export async function chatJSON(messages, { max_tokens = 700, temperature = 0.8, maxWait = 20000, prefer } = {}) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  const order = prefer ? [prefer, ...MODELS.filter(m => m !== prefer)] : MODELS;
  const t0 = Date.now(); let lastErr;
  for (let attempt = 0; attempt < 40; attempt++) {
    const now = Date.now();
    const model = order.find(m => (cool[m] || 0) <= now);
    if (!model) {
      const wake = Math.min(...order.map(m => cool[m])) - now;
      if (Date.now() - t0 + wake > (+process.env.LLM_MAX_WAIT || maxWait)) throw new Error('rate-limited: ' + (lastErr?.message || ''));
      await sleep(wake + 50); continue;
    }
    const body = { model, messages, temperature, max_tokens, response_format: { type: 'json_object' } };
    if (model.startsWith('openai/')) body.reasoning_effort = 'low';
    let res, text;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      text = await res.text();
    } catch (e) { lastErr = e; cool[model] = Date.now() + 3000; continue; }
    if (res.status === 429 || res.status >= 500) { lastErr = new Error(`${model} ${res.status}`); cool[model] = Date.now() + Math.min(waitFrom(res, text), 65000); continue; }
    if (!res.ok) { lastErr = new Error(`${model} ${res.status}: ${clip(text, 200)}`); if (/json_validate_failed|output_parse/i.test(text)) continue; cool[model] = Date.now() + 60000; continue; }
    const j = JSON.parse(text);
    try { return { data: parseJSON(j.choices[0].message.content), model, usage: j.usage?.total_tokens || 0 }; }
    catch (e) { lastErr = e; continue; }
  }
  throw lastErr || new Error('LLM failed');
}

// ---------- 1. The reading agent ----------
// Numbered evidence units so every claim the model makes can be traced back to a real line.
export function dossier(raw, { maxPosts = 12 } = {}) {
  const li = raw.linkedin, ig = raw.instagram, units = [];
  const add = (src, text, n) => { text = clip(text, n); if (text) units.push({ id: (src.startsWith('LinkedIn') ? 'L' : 'I') + (units.filter(u => u.src.startsWith(src.slice(0, 8))).length + 1), src, text }); };
  add('LinkedIn headline', li.headline, 220);
  add('LinkedIn about', li.about, 900);
  (li.positions || []).slice(0, 6).forEach(p => add('LinkedIn role', [p.title, p.company].filter(Boolean).join(' at ') + (p.description ? ' — ' + p.description : ''), 160));
  (li.education || []).slice(0, 2).forEach(e => add('LinkedIn education', [e.school, e.description].filter(Boolean).join(' — '), 120));
  (li.awards || []).slice(0, 3).forEach(a => add('LinkedIn award', a, 120));
  (li.posts || []).slice(0, 3).forEach(p => add('LinkedIn post', p, 220));
  add('Instagram bio', [ig.bio, ig.category].filter(Boolean).join(' · '), 260);
  (ig.posts || []).slice(0, maxPosts).forEach(p => add('Instagram post' + (p.location ? ' @ ' + p.location : ''), p.caption || (p.hashtags || []).map(h => '#' + h).join(' '), 230));
  return units;
}
const SYS_READ = `You are a perceptive, warm, slightly wry matchmaker's research agent. You read ONLY a person's LinkedIn and Instagram (given as numbered units) and write their dating profile. Rules: every claim must cite unit ids from the input; infer the person behind the brand (Instagram shows what they DO, LinkedIn what they THINK about); be specific, not generic — no "passionate about growth" filler; no invented facts — a hobby must be visibly shown in a unit, never guessed; plain, human language. Respond with JSON only.`;
export async function llmProfile(raw, hints = {}) {
  const units = dossier(raw);
  const name = raw.linkedin.name || raw.instagram.fullName;
  const user = `Person: ${name}. Instagram @${raw.instagram.username}, ${raw.instagram.followers} followers.
${hints.signals ? `A keyword pre-scan flagged: ${hints.signals}.\n` : ''}UNITS:
${units.map(u => `[${u.id}] (${u.src}) ${u.text}`).join('\n')}

Return JSON:
{"tagline": "6-10 word personals-column headline about them as a partner, witty not cheesy",
 "summary": "3 sentences: who they are when the camera is off, as an agent would brief a matchmaker",
 "needs": [{"label":"what they need in a partner (3-7 words)","why":"one sentence reasoning","evidence":["ids"]}] (exactly 4, most important first),
 "hobbies": [{"label":"something they actually do","evidence":["ids"]}] (3-5),
 "interests": [{"label":"topic they think about","evidence":["ids"]}] (3-5),
 "qualities": [{"label":"a personal quality","why":"short","evidence":["ids"]}] (4),
 "watchouts": [{"label":"honest friction a partner should know","why":"short","evidence":["ids"]}] (2),
 "dealbreakers": ["2 short things that would not work for them"],
 "idealPartner": "one sentence",
 "dateIdeas": ["3 specific first-date ideas rooted in their hobbies"],
 "voice": "how their agent should talk on dates: 1 sentence on tone (e.g. blunt, playful, earnest)"}`;
  const { data, model, usage } = await chatJSON([{ role: 'system', content: SYS_READ }, { role: 'user', content: user }], { max_tokens: 1600, temperature: 0.6, maxWait: 45000 });
  const byId = Object.fromEntries(units.map(u => [u.id, u]));
  const ev = arr => (Array.isArray(arr) ? arr : []).map(id => byId[String(id).replace(/[\[\]\s]/g, '')]).filter(Boolean).slice(0, 2).map(u => ({ id: u.id, source: u.src, text: clip(u.text, 170) }));
  const fix = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).map(x => typeof x === 'string' ? { label: x, evidence: [] } : { ...x, evidence: ev(x.evidence) });
  return {
    model, usage, units: units.length,
    tagline: clip(data.tagline, 90), summary: clip(data.summary, 700),
    needs: fix(data.needs, 4), hobbies: fix(data.hobbies, 5), interests: fix(data.interests, 5), qualities: fix(data.qualities, 4), watchouts: fix(data.watchouts, 2),
    dealbreakers: (data.dealbreakers || []).slice(0, 2).map(s => clip(s, 120)), idealPartner: clip(data.idealPartner, 240),
    dateIdeas: (data.dateIdeas || []).slice(0, 3).map(s => clip(s, 140)), voice: clip(data.voice, 200),
  };
}

// ---------- 2. The dating agents ----------
// Each agent call sees ONLY its own principal's private dossier + the other person's public card + the transcript.
const L = (x) => (x || []).map(y => y.label || y).filter(Boolean);
export function privateBrief(p) {
  const m = p.llm || {};
  const quotes = [...(m.hobbies || []), ...(m.needs || []), ...(m.qualities || [])].flatMap(x => x.evidence || []).slice(0, 6).map(e => `- (${e.source}) "${clip(e.text, 140)}"`);
  return `${p.name} — ${p.headline}
Agent's read: ${m.summary || p.summary}
Needs in a partner: ${(m.needs?.length ? m.needs.map(n => `${n.label} (${clip(n.why, 90)})`) : p.needs.map(n => n.label)).join('; ')}
Does for fun: ${(L(m.hobbies).length ? L(m.hobbies) : L(p.hobbies)).join(', ')}
Thinks about: ${(L(m.interests).length ? L(m.interests) : L(p.interests)).join(', ')}
Qualities: ${L(m.qualities).join(', ') || L(p.offers).join(', ')}
Honest watch-outs: ${L(m.watchouts).join(', ') || p.watchouts.join('; ')}
Dealbreakers: ${(m.dealbreakers || []).join('; ') || 'none noted'}
Real lines from their profiles:
${quotes.join('\n')}`;
}
export function publicCard(p) {
  const m = p.llm || {};
  return `${p.name} — ${p.headline}. ${m.tagline || p.archetype}. Publicly into: ${(L(m.hobbies).length ? L(m.hobbies) : L(p.hobbies)).slice(0, 4).join(', ')}; talks about ${(L(m.interests).length ? L(m.interests) : L(p.interests)).slice(0, 3).join(', ')}.`;
}
const fmtTranscript = (turns, me, names) => turns.length ? turns.map(t => `${t.speaker === me ? 'YOU' : names[t.speaker] + "'s agent"}: ${t.text}`).join('\n') : '(nothing yet — you speak first)';

export async function agentTurn({ self, other, venue, turns, index, total }) {
  const names = { [self.id]: self.first, [other.id]: other.first };
  const last = index >= total - 2;
  const sys = `You are the personal dating agent of ${self.name}. Tonight you are on a date with ${other.first}'s agent at: ${venue}. Agents speak FOR their humans in third person ("${self.first} would…", "Does ${other.first}…?").
You know ${self.first} intimately — this private dossier came only from their LinkedIn and Instagram:
${privateBrief(self)}
Agent voice: ${self.llm?.voice || 'warm, direct, a little funny'}.
About ${other.first} you only know their public card: ${publicCard(other)}
Your job: find out honestly whether ${other.first} is right for ${self.first}. Probe ${self.first}'s top needs, share real specifics (cite things from the dossier), react to what the other agent actually said, be charming and human, never sycophantic, never invent facts beyond the dossier. Sound like a real conversation, not a press release: vary how you start sentences (don't open with "${self.first} would…" every time), ask one concrete question, allow a joke, and if something worries you about fit, say it kindly. 1-3 sentences, under 60 words. JSON only.`;
  const user = `Transcript so far:\n${fmtTranscript(turns, self.id, names)}\n\nWrite your next message (message ${index + 1} of ${total}).${last ? ' This is your last message: wrap up and hint honestly whether you want a second date.' : ''}
Return {"say":"your message","thought":"private note to ${self.first} about what you just learned, max 18 words","interest":integer from -10 to 10 (how this exchange changed your interest)}`;
  const { data, model, usage } = await chatJSON([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 500, temperature: 0.9 });
  return { speaker: self.id, text: clip(data.say, 600), thought: { by: self.id, text: clip(data.thought, 200), delta: Math.max(-10, Math.min(10, Math.round(+data.interest || 0))) }, model, usage };
}

export async function agentDebrief({ self, other, venue, turns, prior }) {
  const names = { [self.id]: self.first, [other.id]: other.first };
  const sys = `You are ${self.name}'s dating agent. You just came back from a date with ${other.first}'s agent at ${venue}. Your principal's dossier:\n${privateBrief(self)}\nYou did not date ${other.first} yourself: you met ${other.first}'s AGENT, who spoke on ${other.first}'s behalf, and now you report back to ${self.first}. Be honest — your loyalty is to ${self.first}, not to being nice. Be selective: ${self.first} has very few free evenings, so a second date is only for a genuinely strong fit — good agents say yes to roughly one date in three. A pleasant conversation with shared work topics is not enough; look for fit with ${self.first}'s needs and life outside work. JSON only.`;
  const user = `Transcript:\n${fmtTranscript(turns, self.id, names)}\n\nBefore the date, a quick compatibility screen scored ${other.first} ${prior}/100 for ${self.first}; adjust it based on what actually happened.
Return {"score":integer 0-100 (fit of ${other.first} for ${self.first}),"secondDate":boolean,"letter":"your report to ${self.first}, max 70 words, addressed to ${self.first} (Dear ${self.first}, …), refers to ${other.first} by name, cites something specific their agent said, ends with your recommendation","highlights":["max 2 short"],"concerns":["max 2 short"]}`;
  const { data, model, usage } = await chatJSON([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 500, temperature: 0.5 });
  return { score: Math.max(1, Math.min(99, Math.round(+data.score || prior))), secondDate: !!data.secondDate, letter: clip(data.letter, 600), highlights: (data.highlights || []).slice(0, 2).map(s => clip(s, 80)), concerns: (data.concerns || []).slice(0, 2).map(s => clip(s, 80)), model, usage };
}
