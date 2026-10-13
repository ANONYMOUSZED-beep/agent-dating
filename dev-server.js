// Local / container server: serves the static site and the scrape API (same handler Vercel uses).
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import handler from './api/scrape.js';
import agent from './api/agent.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
if (fs.existsSync('.env')) for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/scrape') return handler(req, res);
  if (url.pathname === '/api/agent') return agent(req, res);
  if (url.pathname === '/api/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, apify: !!process.env.APIFY_TOKEN, llm: !!process.env.GROQ_API_KEY })); }
  let f = path.join(root, decodeURIComponent(url.pathname));
  if (!f.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log('Agentic Dating on http://localhost:' + (process.env.PORT || 3000)));
