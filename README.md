# The Agent Personals

**Every person gets an AI agent. The agent reads only their LinkedIn and public Instagram, writes their dating profile, goes on real conversations with other people's agents, and ranks who fits them best.**

- 🎬 **Video (2:23, narrated):** https://youtu.be/LBCUsfpaGwg
- 🌐 **Live site:** https://agent-dating-ruddy.vercel.app — paste your own links
- 🧪 **Demo link (finished 29-person edition):** https://agent-dating-ruddy.vercel.app/?demo#/night

## What happens when you paste two links

1. **Scrape** (`lib/scrape.js`) — LinkedIn's public profile schema.org JSON-LD (fallback: Apify `harvestapi/linkedin-profile-scraper`); Instagram via Apify `apify/instagram-profile-scraper` (fallback: Instagram's public web endpoint). Private accounts are rejected. Nothing else is read.
2. **Read** — both profiles are split into numbered evidence units (`L1` headline, `I4` a caption…). The **reading agent** (LLM on Groq) writes the profile: needs in a partner, hobbies (what Instagram shows they *do*), interests (what LinkedIn shows they *think about*), qualities, watch-outs, dealbreakers, ideal partner, date ideas. Every claim must cite unit ids, which the site resolves back to the real quote. A deterministic keyword engine (37 signal families) runs alongside for scoring and as a fallback.
3. **Speed screens** — every pair, cheap and deterministic: each agent scores the other against *its own* person's needs.
4. **Invitations** — agents invite their favourites; an invite lands only if the inviter is in the invitee's own top 6. A matchmaker pairs anyone left alone.
5. **Dates** — six alternating messages. Each message is a **separate LLM call made as one agent**, which sees only its own person's private dossier, the other person's public card and the transcript. Every message carries a private note to its human and an interest change.
6. **Debriefs & rankings** — each agent separately writes a letter home, re-scores the fit and decides on a second date (two yeses = match). Each person's ranking: fit = 60% their agent's score + 40% reciprocity — asymmetric by design.

The repo ships with a finished edition of **29 real public figures** (official LinkedIn + public Instagram): 29 LLM profiles, 406 speed screens, 123 invitations, 23 LLM dates.

## Run locally

```bash
cat > .env <<'X'
APIFY_TOKEN=apify_api_xxx      # https://console.apify.com/settings/integrations
GROQ_API_KEY=gsk_xxx           # https://console.groq.com/keys
X
npm start                       # http://localhost:3000  (Node 18+, zero dependencies)
npm run build:demo              # rebuild the edition (LLM results cached in data/llm/)
```

Without `GROQ_API_KEY` everything still works on the rule engine.

## Tech stack

- **Scraping:** Apify actors + LinkedIn public JSON-LD via Node `fetch`.
- **LLM:** Groq (`openai/gpt-oss-120b`, rotating to `gpt-oss-20b` / `qwen3` on rate limits), JSON mode, server-side only (`lib/llm.js`, `api/agent.js`) so the key never reaches the browser.
- **Backend:** Node.js, zero dependencies, Vercel functions (`api/scrape.js`, `api/agent.js`).
- **Frontend:** vanilla JS SPA, no build step, state in `localStorage`. Editorial "personals column" design.
- **Video:** Playwright driving the real site, narration with Deepgram Aura-2 TTS, cut with ffmpeg.

## Files

| Path | What |
| --- | --- |
| `lib/scrape.js` | LinkedIn + Instagram scrapers (direct + Apify) and normalizers |
| `lib/llm.js` | Groq client with model rotation; reading agent, dating-agent turn, debrief prompts |
| `api/scrape.js`, `api/agent.js` | serverless endpoints |
| `public/engine/analyze.js` | keyword feature extractor / fallback profile |
| `public/engine/date.js` | speed screens, invitations, rule-engine dates, rankings |
| `public/engine/llmdate.js` | the two-agent LLM date loop (shared by browser and build script) |
| `public/app.js`, `public/styles.css` | the website |
| `data/people/*.json` | the 29 scraped people |
| `data/llm/` | cached LLM profiles and dates |
| `public/demo/demo.json` | the finished edition |

## Ethics note

Public figures' public profiles only. It's a simulation of compatibility — it does not infer relationship status, orientation or anything sensitive, and treats everyone as open to matching with everyone.
