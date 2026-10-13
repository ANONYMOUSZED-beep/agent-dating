# 💘 Agent Dating

**Every person is represented by an AI agent. The agents read the person's LinkedIn + Instagram, then date each other on their behalf — and rank who fits each person best.**

- Paste a LinkedIn URL + a public Instagram URL → the agent scrapes both, reads them and builds a **profile page** (needs, hobbies, interests, personality, lifestyle, values, love language, communication style, green flags, watch-outs, dating strategy) where every claim keeps the quote it came from.
- The agent joins the pool and **dates**: speed dates with every agent → sends invitations (which can be declined) → full multi-turn dates with private reasoning → a debrief letter to its person and a second-date decision.
- **Rankings**: for every person, every other person ranked by fit.

The repo ships with a finished example of **29 real people** (public figures with an official LinkedIn and a public Instagram), already scraped and run.

## How it works

```
LinkedIn URL + public Instagram URL
        │  lib/scrape.js
        ▼
 Scrape ── LinkedIn: public profile JSON-LD (schema.org Person) → fallback Apify harvestapi/linkedin-profile-scraper
        └─ Instagram: Apify apify/instagram-profile-scraper → fallback Instagram web_profile_info
        │  public/engine/analyze.js
        ▼
 Reading agent ── corpus of tagged text units (headline, about, roles, bio, each caption, hashtags, locations)
                  37 signal families, source-weighted (Instagram = what you DO, LinkedIn = what you THINK about)
                  → hobbies, interests, 9 traits, lifestyle, values, comm style, love language
                  → 3–5 relationship needs, green flags, watch-outs, ideal partner, dating strategy (all with evidence)
        │  public/engine/date.js
        ▼
 Dating harness ── Round 1: speed date every pair (each agent scores the other against ITS person's needs)
                   Round 2: each agent invites its top 3; invitee accepts only if inviter is in its top 6 (or ≥78)
                            matchmaker fallback so nobody is left without a date
                   Round 3: full date — venue from shared hobbies, quotes from each other's posts, each agent probes
                            its person's top-2 needs, honest answers incl. mismatches, watch-out check, a light moment,
                            private reasoning + interest delta on every turn, debrief letter, second-date decision
        ▼
 Rankings ── fit(A→B) = 0.6 · A's agent score of B + 0.4 · B's agent score of A
             agent score = 0.72 · (needs met 38% + shared interests 24% + values 22% + lifestyle 16%) + 0.28 · date chemistry
```

Agents are deterministic and explainable: same inputs → same dates, and every number traces back to quoted evidence from the two sources. Nothing besides LinkedIn and Instagram is used.

## Run locally

```bash
echo "APIFY_TOKEN=apify_api_xxx" > .env   # https://console.apify.com/settings/integrations
npm start                                 # http://localhost:3000  (Node 18+, zero dependencies)
```

Rebuild the 29-person example from the saved scrapes: `npm run build:demo`.

## Deploy (Vercel)

`vercel deploy` — `public/` is served statically, `api/scrape.js` is the serverless scraper. Set the `APIFY_TOKEN` environment variable.

## Tech stack

- **Scraping:** Apify (`apify/instagram-profile-scraper`, `harvestapi/linkedin-profile-scraper`) + LinkedIn public profile schema.org JSON-LD via Node `fetch`.
- **Backend:** Node.js, zero dependencies (`server.js` locally, `api/scrape.js` on Vercel).
- **Agents:** isomorphic ES modules (`public/engine/*`) — run in the browser for live dates, and in Node to build the demo.
- **Frontend:** vanilla JS SPA, no build step. State in `localStorage`.
- **Video:** recorded with Playwright driving the real site.

## Files

| Path | What |
| --- | --- |
| `lib/scrape.js` | LinkedIn + Instagram scrapers (direct + Apify) and normalizers |
| `api/scrape.js` | POST `{linkedin, instagram}` → scraped profile JSON |
| `public/engine/taxonomy.js` | signal families and tone vocabulary |
| `public/engine/analyze.js` | the reading agent → profile |
| `public/engine/date.js` | speed dates, invitations, full dates, debriefs, rankings |
| `public/app.js` | the website |
| `scripts/` | candidate verification, assembly, demo build |
| `data/people/*.json` | the 29 scraped people (LinkedIn + Instagram, public data) |
| `public/demo/demo.json` | the finished example (profiles, 406 speed dates, invites, dates, rankings) |

## Ethics note

The example uses public figures' public professional and social profiles only. It's a simulation of compatibility — it does not infer relationship status, orientation or anything sensitive, and treats everyone as open to matching with everyone.
