// A real two-agent date: every message is a separate LLM call made "as" one agent.
// Agent A's call sees A's private dossier + B's public card + the transcript; never B's private notes.
// `call(op, payload)` is injected: the browser POSTs to /api/agent, the build script calls Groq directly.
export const TURNS = 6;
export async function llmDate(A, B, { venue, priorAB, priorBA, call, onTurn = () => {}, turns: total = TURNS }) {
  const slim = p => ({ id: p.id, name: p.name, first: p.first, headline: p.headline, summary: p.summary, archetype: p.archetype, needs: p.needs, hobbies: p.hobbies, interests: p.interests, offers: p.offers, watchouts: p.watchouts, llm: p.llm });
  const a = slim(A), b = slim(B), turns = [];
  for (let i = 0; i < total; i++) {
    const [self, other] = i % 2 === 0 ? [a, b] : [b, a];
    const t = await call('turn', { self, other, venue: venue.idea, turns: turns.map(({ speaker, text }) => ({ speaker, text })), index: i, total });
    turns.push(t); onTurn(t, i);
  }
  const [dA, dB] = await Promise.all([
    call('debrief', { self: a, other: b, venue: venue.idea, turns: turns.map(({ speaker, text }) => ({ speaker, text })), prior: priorAB }),
    call('debrief', { self: b, other: a, venue: venue.idea, turns: turns.map(({ speaker, text }) => ({ speaker, text })), prior: priorBA }),
  ]);
  const deb = d => ({ score: d.score, secondDate: d.secondDate, letter: d.letter, highlights: d.highlights, concerns: d.concerns, model: d.model });
  return { a: A.id, b: B.id, venue, turns: turns.map(t => ({ speaker: t.speaker, text: t.text, thought: t.thought, model: t.model })), debriefA: deb(dA), debriefB: deb(dB), scoreAB: dA.score, scoreBA: dB.score, mutual: dA.secondDate && dB.secondDate, llm: true };
}
