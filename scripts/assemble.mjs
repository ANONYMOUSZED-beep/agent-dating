// Assemble raw scrapes (LinkedIn public JSON-LD or Apify HarvestAPI + Apify Instagram) into data/people/*.json
import fs from 'fs';
import { parseLinkedInHtml, normalizeApifyInstagram } from '../lib/scrape.js';
import * as S from '../lib/scrape.js';
const ig = [...JSON.parse(fs.readFileSync('data/raw/ig_apify.json')), ...JSON.parse(fs.readFileSync('data/raw/ig_apify2.json'))];
const liApify = JSON.parse(fs.readFileSync('data/raw/li_apify.json')).filter(x => x.firstName);
const pairs = [...JSON.parse(fs.readFileSync('scripts/people.json')), ['emmagrede', 'emmagrede'], ['jamiekernlima', 'jamiekernlima'], ['ryanserhant', 'ryanserhant'], ['aliabdaal', 'aliabdaal'], ['codiesanchez', 'codiesanchez']];
let n = 0;
for (const [li, igu] of pairs) {
  const g = ig.find(x => x.username?.toLowerCase() === igu && !x.error && !x.private);
  if (!g) { console.log('skip (ig)', igu); continue; }
  let L;
  const url = `https://www.linkedin.com/in/${li}`;
  if (fs.existsSync(`data/raw/li_${li}.html`)) L = parseLinkedInHtml(fs.readFileSync(`data/raw/li_${li}.html`, 'utf8'), url);
  else { const a = liApify.find(x => x.publicIdentifier === li); if (!a) { console.log('skip (li)', li); continue; } L = S.normalizeApifyLinkedInExport(a, url); }
  const person = { linkedin: L, instagram: normalizeApifyInstagram(g, `https://www.instagram.com/${igu}/`), scrapedAt: new Date().toISOString() };
  fs.writeFileSync(`data/people/${li}.json`, JSON.stringify(person, null, 1)); n++;
  console.log(n, L.name, '|', L.headline.slice(0, 50), '|', L.positions.length, 'pos |', person.instagram.posts.length, 'posts |', L.source);
}
