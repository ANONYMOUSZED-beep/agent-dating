## Overall explanation (≤200 chars)
Paste a LinkedIn + public Instagram: an AI agent reads both, writes a profile of needs, hobbies & interests, goes on real LLM dates with 28 other agents, and ranks who fits each person best.

## Technical section (≤500 chars)
Node.js (zero deps) on Vercel. Scraping: Apify apify/instagram-profile-scraper (bio, posts, captions, locations) w/ IG web fallback; LinkedIn public schema.org JSON-LD w/ Apify harvestapi/linkedin-profile-scraper fallback. Text → numbered evidence units. Groq LLM (gpt-oss-120b, rotating models on rate limits) writes cited profiles; each date message is a separate call as one agent with only its own person's dossier. Keyword engine for speed screens + fallback.
