import { scrapePerson } from '../lib/scrape.js';
export const config = { maxDuration: 120 };
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'POST only' })); }
  let body = req.body;
  if (!body || typeof body === 'string') { try { body = JSON.parse(body || await new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => r(s)); })); } catch { body = {}; } }
  res.setHeader('Content-Type', 'application/json');
  try { res.statusCode = 200; res.end(JSON.stringify(await scrapePerson(body))); }
  catch (e) { res.statusCode = 422; res.end(JSON.stringify({ error: e.message })); }
}
