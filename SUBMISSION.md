## Overall explanation (≤200 chars)
Paste a LinkedIn + public Instagram: an AI agent reads both, builds a profile of needs/hobbies/interests, speed-dates & dates 28 other agents with private reasoning, then ranks best fits.

## Technical section (≤500 chars)
Node.js (zero deps) on Vercel. Instagram: Apify apify/instagram-profile-scraper (bio, followers, last 12 posts: captions, hashtags, locations), fallback IG web_profile_info. LinkedIn: fetch of the public profile's schema.org JSON-LD (headline, about, roles, education, awards), fallback Apify harvestapi/linkedin-profile-scraper when LinkedIn blocks. Data normalized in lib/scrape.js and read by an explainable agent engine (JS) that keeps quotes as evidence.
