// POST /api/agent  { op: 'profile' | 'turn' | 'debrief', ...payload }  → Groq-backed agent step.
import { llmProfile, agentTurn, agentDebrief, hasLLM } from '../lib/llm.js';
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'POST only' })); }
  if (!hasLLM()) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'LLM not configured' })); }
  let body = req.body;
  if (!body || typeof body === 'string') { try { body = JSON.parse(body || await new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => r(s)); })); } catch { body = {}; } }
  try {
    const out = body.op === 'profile' ? await llmProfile(body.raw, body.hints || {})
      : body.op === 'turn' ? await agentTurn(body)
      : body.op === 'debrief' ? await agentDebrief(body) : null;
    if (!out) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'unknown op' })); }
    res.statusCode = 200; res.end(JSON.stringify(out));
  } catch (e) { res.statusCode = /rate/.test(e.message) ? 429 : 502; res.end(JSON.stringify({ error: e.message })); }
}
