// Scraping layer. Two sources only: a LinkedIn public profile and a public Instagram profile.
// Strategy: LinkedIn -> direct fetch of the public profile (schema.org JSON-LD) -> Apify actor fallback.
//           Instagram -> Apify `apify/instagram-profile-scraper` -> direct web_profile_info fallback.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const APIFY = 'https://api.apify.com/v2/acts';
const IG_ACTOR = process.env.APIFY_INSTAGRAM_ACTOR || 'apify~instagram-profile-scraper';
const LI_ACTOR = process.env.APIFY_LINKEDIN_ACTOR || 'harvestapi~linkedin-profile-scraper';

const decode = (s = '') => String(s)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/[ \t]+/g, ' ').trim();

export function parseLinkedInUrl(input) {
  const m = String(input || '').trim().match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) throw new Error('Not a LinkedIn profile URL (expected linkedin.com/in/<handle>)');
  const slug = decodeURIComponent(m[1]).replace(/\/$/, '');
  return { slug, url: `https://www.linkedin.com/in/${slug}` };
}
export function parseInstagramUrl(input) {
  const s = String(input || '').trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i) || s.match(/^@?([A-Za-z0-9._]{1,30})$/);
  if (!m || ['p', 'reel', 'explore', 'stories'].includes(m[1].toLowerCase())) throw new Error('Not an Instagram profile URL (expected instagram.com/<username>)');
  return { username: m[1].toLowerCase(), url: `https://www.instagram.com/${m[1].toLowerCase()}/` };
}

async function apifyRun(actor, input, token, timeoutSec = 120) {
  const r = await fetch(`${APIFY}/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSec}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Apify ${actor} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ---------- LinkedIn ----------
export function parseLinkedInHtml(html, url) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
  const graph = blocks.flatMap(b => b['@graph'] || [b]);
  const p = graph.find(x => x['@type'] === 'Person');
  if (!p) throw new Error('LinkedIn returned no public profile data (auth wall)');
  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
  const headline = title.replace(/\s*\|\s*LinkedIn\s*$/, '').split(' - ').slice(1).join(' - ').trim();
  const arr = v => (Array.isArray(v) ? v : v ? [v] : []);
  const posts = graph.filter(x => /Article|SocialMediaPosting|DiscussionForumPosting/.test(x['@type'] || ''))
    .map(x => decode(x.articleBody || x.headline || x.name || '')).filter(Boolean).slice(0, 10);
  const activity = [...html.matchAll(/class="[^"]*(?:main-feed-activity-card__commentary|base-main-card__title)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|h3|div)>/g)]
    .map(m => decode(m[1])).filter(t => t.length > 20).slice(0, 10);
  return {
    source: 'linkedin-public-jsonld', url,
    name: decode(p.name), headline, about: decode(p.description || ''),
    location: p.address?.addressLocality || '', country: p.address?.addressCountry || '',
    photo: p.image?.contentUrl || '',
    jobTitles: arr(p.jobTitle).map(decode),
    positions: arr(p.worksFor).map(o => ({ company: decode(o.name), title: '', description: decode(o.member?.description || ''), start: o.member?.startDate || '', end: o.member?.endDate || '' })),
    education: arr(p.alumniOf).map(o => ({ school: decode(o.name), description: decode(o.member?.description || '') })),
    awards: arr(p.awards).map(decode), languages: arr(p.knowsLanguage).map(l => decode(l.name || l)),
    followers: p.interactionStatistic?.userInteractionCount || 0,
    posts: [...new Set([...posts, ...activity])].slice(0, 12),
  };
}

function normalizeApifyLinkedIn(d, url) {
  const exp = d.experiences || d.experience || d.positions || [];
  const edu = d.educations || d.education || [];
  return {
    source: 'apify-linkedin', url,
    name: d.fullName || [d.firstName, d.lastName].filter(Boolean).join(' '),
    headline: d.headline || d.occupation || '', about: d.about || d.summary || '',
    location: d.addressWithCountry || d.location?.linkedinText || d.location || d.geoLocationName || '', country: d.addressCountryOnly || '',
    photo: d.profilePic || d.profilePicHighQuality || d.photo || d.profilePicture?.url || '',
    jobTitles: exp.map(e => e.title || e.position).filter(Boolean),
    positions: exp.map(e => ({ company: e.subtitle?.split('·')[0]?.trim() || e.companyName || e.company || '', title: e.title || e.position || '', description: e.description || (e.subComponents || []).flatMap(s => (s.description || []).map(x => x.text || '')).join(' ') || '', start: e.startDate || '', end: e.endDate || '' })),
    education: edu.map(e => ({ school: e.title || e.schoolName || e.school || '', description: e.subtitle || e.degree || '' })),
    awards: (d.honorsAndAwards || []).map(a => a.title || a), languages: (d.languages || []).map(l => l.title || l.name || l),
    skills: (d.skills || []).map(s => s.title || s.name || s).slice(0, 30),
    followers: d.followers || d.followerCount || 0,
    posts: (d.updates || d.posts || []).map(p => p.postText || p.text || '').filter(Boolean).slice(0, 12),
  };
}

export async function scrapeLinkedIn(input, { token = process.env.APIFY_TOKEN } = {}) {
  const { url } = parseLinkedInUrl(input);
  const errors = [];
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' }, redirect: 'follow' });
    if (r.ok) return parseLinkedInHtml(await r.text(), url);
    errors.push(`direct HTTP ${r.status}`);
  } catch (e) { errors.push('direct: ' + e.message); }
  if (token) {
    try {
      const items = await apifyRun(LI_ACTOR, { profileScraperMode: 'Profile details no email ($4 per 1k)', queries: [url] }, token);
      if (items?.[0] && !items[0].error && (items[0].firstName || items[0].fullName)) return normalizeApifyLinkedIn(items[0], url);
      errors.push('apify: empty result');
    } catch (e) { errors.push(e.message); }
  }
  throw new Error('LinkedIn scrape failed: ' + errors.join('; '));
}

// ---------- Instagram ----------
export function normalizeApifyInstagram(d, url) {
  if (d.private) throw new Error('This Instagram profile is private — only public profiles are supported');
  return {
    source: 'apify-instagram', url: url || `https://www.instagram.com/${d.username}/`,
    username: d.username, fullName: d.fullName || '', bio: d.biography || '', category: d.businessCategoryName || '',
    externalUrl: d.externalUrl || '', followers: d.followersCount || 0, following: d.followsCount || 0, postsCount: d.postsCount || 0,
    verified: !!d.verified, private: !!d.private, photo: d.profilePicUrlHD || d.profilePicUrl || '',
    posts: (d.latestPosts || []).map(p => ({ caption: p.caption || '', hashtags: p.hashtags || [], likes: p.likesCount || 0, comments: p.commentsCount || 0, type: p.type || '', location: p.locationName || '', timestamp: p.timestamp || '', url: p.url || '' })),
  };
}
function normalizeDirectInstagram(u, url) {
  if (u.is_private) throw new Error('This Instagram profile is private — only public profiles are supported');
  return {
    source: 'instagram-web-profile-info', url, username: u.username, fullName: u.full_name || '', bio: u.biography || '',
    category: u.category_name || '', externalUrl: u.external_url || '', followers: u.edge_followed_by?.count || 0, following: u.edge_follow?.count || 0,
    postsCount: u.edge_owner_to_timeline_media?.count || 0, verified: !!u.is_verified, private: !!u.is_private, photo: u.profile_pic_url_hd || '',
    posts: (u.edge_owner_to_timeline_media?.edges || []).map(({ node: n }) => {
      const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
      return { caption, hashtags: (caption.match(/#[\p{L}\d_]+/gu) || []).map(h => h.slice(1)), likes: n.edge_liked_by?.count || 0, comments: n.edge_media_to_comment?.count || 0, type: n.is_video ? 'Video' : 'Image', location: n.location?.name || '', timestamp: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : '', url: `https://www.instagram.com/p/${n.shortcode}/` };
    }),
  };
}

export async function scrapeInstagram(input, { token = process.env.APIFY_TOKEN } = {}) {
  const { username, url } = parseInstagramUrl(input);
  const errors = [];
  if (token) {
    try {
      const items = await apifyRun(IG_ACTOR, { usernames: [username] }, token);
      const d = items?.find(i => i.username?.toLowerCase() === username) || items?.[0];
      if (d && !d.error) return normalizeApifyInstagram(d, url);
      errors.push('apify: ' + (d?.error || d?.errorDescription || 'profile not found'));
    } catch (e) { if (/private/.test(e.message)) throw e; errors.push(e.message); }
  }
  try {
    const r = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`, { headers: { 'x-ig-app-id': '936619743392459', 'User-Agent': UA } });
    if (r.ok) { const u = (await r.json())?.data?.user; if (u) return normalizeDirectInstagram(u, url); errors.push('direct: not found'); }
    else errors.push(`direct HTTP ${r.status}`);
  } catch (e) { if (/private/.test(e.message)) throw e; errors.push('direct: ' + e.message); }
  throw new Error('Instagram scrape failed: ' + errors.join('; '));
}

export async function scrapePerson({ linkedin, instagram }, opts) {
  const [li, ig] = await Promise.allSettled([scrapeLinkedIn(linkedin, opts), scrapeInstagram(instagram, opts)]);
  if (li.status === 'rejected') throw new Error(li.reason.message);
  if (ig.status === 'rejected') throw new Error(ig.reason.message);
  return { linkedin: li.value, instagram: ig.value, scrapedAt: new Date().toISOString() };
}
export const normalizeApifyLinkedInExport = (d, url) => normalizeApifyLinkedIn(d, url);
