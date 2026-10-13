// Builds the finished 29-person example: analyze every scraped person, run the full dating night, rank everyone.
import fs from 'fs';
import { analyzePerson } from '../public/engine/analyze.js';
import { runDatingNight, rankAll } from '../public/engine/date.js';
fs.mkdirSync('public/demo/img', { recursive: true });
const raws = fs.readdirSync('data/people').map(f => JSON.parse(fs.readFileSync('data/people/' + f)));
const people = [];
for (const raw of raws) {
  const p = analyzePerson(raw);
  const img = `public/demo/img/${p.id}.jpg`;
  if (!fs.existsSync(img)) for (const u of [raw.linkedin.photo, raw.instagram.photo].filter(Boolean)) {
    try { const r = await fetch(u); if (r.ok) { fs.writeFileSync(img, Buffer.from(await r.arrayBuffer())); break; } } catch {}
  }
  if (fs.existsSync(img)) p.photo = `demo/img/${p.id}.jpg`;
  p.raw = { linkedin: { ...raw.linkedin, photo: undefined }, instagram: { ...raw.instagram, photo: undefined, posts: raw.instagram.posts.map(x => ({ ...x, caption: x.caption.slice(0, 600) })) } };
  people.push(p);
}
people.sort((a, b) => a.name.localeCompare(b.name));
const speed = [], dates = [], invites = [];
for (const e of runDatingNight(people)) { if (e.type === 'speed') speed.push(e.date); else if (e.type === 'date') dates.push(e.date); else invites.push(e); }
const rankings = rankAll(people, speed, dates);
fs.writeFileSync('public/demo/demo.json', JSON.stringify({ builtAt: new Date().toISOString(), people, speed, invites, dates, rankings }));
console.log(`people ${people.length} · speed dates ${speed.length} · invites ${invites.length} (${invites.filter(i => i.accepted).length} accepted) · full dates ${dates.length} · mutual ${dates.filter(d => d.mutual).length}`);
console.log('photos', fs.readdirSync('public/demo/img').length, 'size', Math.round(fs.statSync('public/demo/demo.json').size / 1024) + 'KB');
