# VibeSwap Q2 2026 Tactical Playbook

**Faraday1, JARVIS — March 2026**

---

> Supplementary to `marketing-strategy-2026.md` and `partnership-framework-2026.md`.
> This is not strategy. This is execution. Dates, names, numbers.

---

## Current State (March 14, 2026)

| Asset | Status |
|-------|--------|
| Base mainnet | **LIVE** |
| Smart contracts | 342 |
| Solidity test files | 371 |
| Frontend components | 401 |
| CKB Rust SDK modules | 73 (15,155 tests) |
| Total commits | 1,684 |
| Research papers | 55 |
| JARVIS Telegram bot | Autonomous, live |
| CKB/Nervos integration | In progress |
| Tim Cotten (CRPC) | Talking to Shaw (ElizaOS), speaking EthDC April 16 |
| Anthropic rate limit request | **SUBMITTED** (2026-03-14) |
| VC funding | None. Bootstrapped. |
| Team | 1 founder + 1 AI + 6 contributors |
| GitHub | github.com/WGlynn/VibeSwap |
| Vercel | frontend-jade-five-87.vercel.app |
| Twitter/X | Integration spec written, pending deployment |
| Marketing materials | 221 files ready (tweets, grants, Reddit, pitch deck, BD toolkit) |

---

## 1. April 2026 Actions

### Week 1 (March 31 — April 6): EthDC Pre-Heat

| Day | Task | Owner | Deliverable |
|-----|------|-------|-------------|
| Mon Mar 31 | Finalize JARVIS Twitter integration (see `docs/twitter.md`) | Will/Freedom | `jarvis-bot/src/twitter.js` live, posting to @VibeSwap |
| Tue Apr 1 | Publish thread: "What is VibeSwap? (for humans)" — 10-tweet explainer | Fate/JARVIS | Twitter thread, pin to profile |
| Wed Apr 2 | Publish Reddit post to r/ethereum: "How batch auctions eliminate MEV" | Catto | Expand `docs/reddit-posts/r-ethereum-mev-problem.md` |
| Thu Apr 3 | DM 5 crypto podcasters pitching Will as guest (Bankless, The Defiant, Unchained, ZK Podcast, Epicenter) | Freedom | 5 outreach DMs sent |
| Fri Apr 4 | Create "VibeSwap in 60 seconds" video — screen recording of a batch auction settling | Will | Upload to YouTube + Twitter clip |
| Sat-Sun | JARVIS autonomous posting: 2 shower-thought tweets per day, engage with MEV-related threads | Fate/JARVIS | 4 tweets |

### Week 2 (April 7 — April 13): EthDC Week Minus One

| Day | Task | Owner | Deliverable |
|-----|------|-------|-------------|
| Mon Apr 7 | Publish Medium article: "Why Every DEX Trade Robs You (And How to Fix It)" | Will | Medium + Mirror cross-post |
| Tue Apr 8 | Twitter thread: "Tim Cotten built CRPC. We built VibeSwap. Here's what happens when they meet." — tease EthDC talk | Fate/JARVIS | Thread |
| Wed Apr 9 | Submit VibeSwap to DeFi Llama listing (if not already listed) | John Paul | DeFi Llama PR submitted |
| Thu Apr 10 | Reddit post to r/defi: "No VC funding. No pre-mine. 200 smart contracts. Here's what we built." | Catto | Reddit post |
| Fri Apr 11 | Coordinate with Tim Cotten: confirm VibeSwap mention in EthDC talk, prepare co-branded slide if appropriate | Freedom/Tim | Slide or talking points shared |
| Sat-Sun | JARVIS engagement: reply to every EthDC-related tweet mentioning MEV, batch auctions, or fair ordering | JARVIS | 10+ replies |

### Week 3 (April 14 — April 20): EthDC Week

| Day | Task | Owner | Deliverable |
|-----|------|-------|-------------|
| Mon Apr 14 | Twitter thread: "5 things to watch at EthDC this week (and why batch auctions matter)" | Fate/JARVIS | Thread |
| Tue Apr 15 | Pre-event tweet: "Tomorrow @TimCotten talks CRPC at EthDC. VibeSwap is where CRPC meets DeFi." | Fate | Tweet with event link |
| **Wed Apr 16** | **TIM COTTEN ETHDC TALK** — Live-tweet key moments, quote-tweet Tim, engage every reply | Fate + JARVIS + Karma | 15+ tweets during/after talk |
| Wed Apr 16 | Post-talk Twitter thread: "What Tim just showed at EthDC and what it means for VibeSwap" | Fate/Will | Thread within 2 hours of talk |
| Thu Apr 17 | Reddit post to r/CryptoCurrency: recap of EthDC talk + VibeSwap connection | Catto | Reddit post |
| Fri Apr 18 | Follow up with every new Twitter follower from EthDC week — DM top 10 with personal note | Freedom | 10 DMs |
| Sat-Sun | Telegram community AMA: "Ask JARVIS Anything" — let the AI field questions for 2 hours | Karma/JARVIS | Telegram event |

### Week 4 (April 21 — April 27): Post-EthDC Momentum

| Day | Task | Owner | Deliverable |
|-----|------|-------|-------------|
| Mon Apr 21 | Publish blog post: "EthDC Recap: CRPC, Batch Auctions, and the Future of Fair DeFi" | Will | Medium + Mirror |
| Tue Apr 22 | Outreach to Shaw (ElizaOS) — direct message referencing Tim's intro, propose VibeSwap x ElizaOS integration | Freedom | DM or email sent |
| Wed Apr 23 | Twitter thread: "JARVIS wrote 200 smart contracts. Here's what an AI co-founder actually does." | Fate/JARVIS | Thread |
| Thu Apr 24 | Submit grant application to Base Ecosystem Fund (see May actions for more grants) | John Paul | Application submitted |
| Fri Apr 25 | Reddit post to r/ethereum: "We built an AI co-founder that writes Solidity. AMA." | Catto | Reddit AMA post |
| Sat-Sun | Weekly metrics review — document Twitter followers, Telegram members, GitHub stars | Karma | Metrics logged |

### April Targets

| Metric | Start (Mar 31) | Target (Apr 30) |
|--------|----------------|-----------------|
| Twitter followers | Current | +500 |
| Telegram members | Current | +100 |
| GitHub stars | Current | +50 |
| Medium article views | 0 | 2,000 |
| Reddit post karma (total) | 0 | 500 |
| Podcast pitches sent | 0 | 5 |
| Partnership outreach emails | 0 | 10 |

---

## 2. May 2026 Actions

### Hackathon Submissions

| Hackathon | Deadline (est.) | Track | Submission |
|-----------|----------------|-------|------------|
| ETHGlobal Brussels | May 2026 (TBC) | DeFi Infrastructure | VibeSwap batch auction SDK — let any protocol add MEV-free trading |
| Base Buildathon | Ongoing | DeFi on Base | VibeSwap as reference MEV-free DEX on Base |
| Nervos CKB Hackathon | TBC | DeFi + Cell Model | CKB integration — batch auctions using cell model |
| LayerZero Bounties | Ongoing | Cross-chain | Omnichain batch auction demo — trade across chains in one batch |

**Hackathon Strategy**: Don't build new projects. Package existing VibeSwap components as standalone tools. The 200+ contracts ARE the submission — wrap them in clean SDK interfaces.

### Grant Applications

| Grant Program | Amount (est.) | Proposal Focus | Submit By |
|---------------|---------------|----------------|-----------|
| Base Ecosystem Fund | $25-100K | MEV-free trading infrastructure on Base | April 24 |
| LayerZero Grants | $10-50K | Omnichain batch auction reference implementation | May 5 |
| Nervos/CKB Grants | $10-50K | Cell model integration for commit-reveal auctions | May 12 |
| Optimism RetroPGF | Variable | Public good: open-source MEV elimination | May round (TBC) |
| Ethereum Foundation | $50-100K | Batch auction mechanism design research | May 19 |
| Gitcoin Grants | Community-funded | VibeSwap as public good infrastructure | Next round |

**Grant Strategy**: Lead with mechanism design research angle. VibeSwap is not just a DEX — it's an open-source public good for MEV elimination. Frame every application around the public benefit.

### Content Calendar — May

| Week | Medium/Mirror | Twitter (10/week target) | Reddit (2/week) | Telegram |
|------|---------------|--------------------------|-----------------|----------|
| May 1-4 | "Shapley Values: How VibeSwap Distributes Rewards Using Game Theory" | 3 threads + 7 engagement tweets | r/ethereum: Shapley explainer / r/defi: Monthly update | Dev update |
| May 5-11 | "LayerZero V2 + Batch Auctions = Omnichain MEV Protection" | 3 threads + 7 engagement | r/CryptoCurrency: LayerZero integration / r/ethdev: Technical deep dive | AMA #2 |
| May 12-18 | (none — focus on hackathon submission) | 2 threads + 8 engagement | r/NervosNetwork: CKB integration / r/defi: Hackathon update | Hackathon livestream |
| May 19-25 | "Cooperative Capitalism: Why Self-Interest Should Serve the Collective" | 3 threads + 7 engagement | r/ethereum: Philosophy post / r/CryptoTechnology: Technical comparison | Community vote |
| May 26-31 | "The AI Co-Founder Experiment: 3 Months of JARVIS Building VibeSwap" | 2 threads + 8 engagement | r/artificial: AI co-founder story / r/defi: Monthly recap | Monthly digest |

### May Targets

| Metric | Start (May 1) | Target (May 31) |
|--------|---------------|-----------------|
| Twitter followers | Apr baseline + 500 | +1,000 cumulative |
| Telegram members | Apr baseline + 100 | +250 cumulative |
| GitHub stars | Apr baseline + 50 | +150 cumulative |
| Grant applications submitted | 1 | 5 |
| Hackathon submissions | 0 | 2 |
| Podcast appearances | 0 | 1 |

---

## 3. June 2026 Actions

### Partnership Announcements

By June, the following partnerships should be in active negotiation or announced:

| Partner | Integration Type | Target Announcement | Status (as of Mar 13) |
|---------|-----------------|---------------------|----------------------|
| ElizaOS / Shaw | AI agent integration — ElizaOS agents can execute MEV-free trades via VibeSwap | June 2-6 | Tim Cotten introducing (warm lead) |
| LayerZero | Official ecosystem partner — featured in LZ documentation | June 9-13 | Cold — outreach in April |
| Nervos/CKB | Technical integration — batch auctions on cell model | June 16-20 | Active development |
| Base/Coinbase | Ecosystem listing — featured on Base ecosystem page | June 23-27 | Grant application in April |

**Announcement Cadence**: One partnership announcement per week in June. Each gets: Twitter thread, Medium article, Telegram announcement, Reddit post. Stagger for maximum sustained attention.

### Developer Documentation Push

| Deliverable | Target Date | Purpose |
|-------------|-------------|---------|
| SDK documentation site (GitBook or Docusaurus) | June 2 | Developers can integrate VibeSwap batch auctions into their protocols |
| Smart contract API reference | June 9 | Every public function documented with NatSpec |
| "Build Your First MEV-Free Integration" tutorial | June 16 | Step-by-step tutorial for protocol integrators |
| Example integration repo (GitHub template) | June 23 | Fork-and-deploy template for adding VibeSwap to any frontend |
| CRPC protocol documentation | June 30 | Document the CRPC demo and how it interfaces with VibeSwap |

### Community Milestones

| Milestone | Target Date | Celebration |
|-----------|-------------|-------------|
| 500 Telegram members | June 7 | JARVIS-hosted Telegram party, community NFT drop |
| 1,000 Twitter followers | June 14 | Twitter Spaces: "The VibeSwap Story" — 1-hour live discussion |
| 100 GitHub stars | June 21 | Contributor shoutout thread, tag top 10 contributors |
| First external integration | June 28 | Joint announcement with partner, co-marketed event |

### June Targets

| Metric | Start (June 1) | Target (June 30) |
|--------|----------------|------------------|
| Twitter followers | +1,000 cumul. | +2,500 cumulative |
| Telegram members | +250 cumul. | +500 cumulative |
| GitHub stars | +150 cumul. | +300 cumulative |
| Active partnerships | 0 | 2 signed |
| Developer docs pages | 0 | 30+ |
| External integrations | 0 | 1 |

---

## 4. Content Pipeline

### 4.1 Medium / Mirror Articles (2 per month)

| # | Title | Target Date | Audience | Cross-post |
|---|-------|-------------|----------|------------|
| 1 | "Why Every DEX Trade Robs You (And How to Fix It)" | Apr 7 | Traders | Mirror, Reddit, Twitter thread |
| 2 | "EthDC Recap: CRPC, Batch Auctions, and the Future of Fair DeFi" | Apr 21 | General crypto | Mirror, Reddit |
| 3 | "Shapley Values: How VibeSwap Distributes Rewards Using Game Theory" | May 5 | Builders, researchers | Mirror, r/ethereum |
| 4 | "LayerZero V2 + Batch Auctions = Omnichain MEV Protection" | May 12 | Builders | Mirror, r/ethdev |
| 5 | "Cooperative Capitalism: Why Self-Interest Should Serve the Collective" | May 19 | Idealists, DAOs | Mirror, r/ethereum |
| 6 | "The AI Co-Founder Experiment: 3 Months of JARVIS Building VibeSwap" | May 26 | AI + crypto crossover | Mirror, r/artificial |
| 7 | "How We Built 200 Smart Contracts With Zero VC Funding" | Jun 9 | Builders | Mirror, Hacker News |
| 8 | "The Developer's Guide to MEV-Free Integration" | Jun 23 | Developers | Mirror, r/ethdev |

### 4.2 Twitter/X Threads (10 tweets/week minimum)

**Thread templates** (rotate weekly):

1. **Mechanism explainer**: "How [specific mechanism] works in VibeSwap" — commit-reveal, Fisher-Yates, Shapley, TWAP oracle, circuit breakers
2. **MEV horror story**: Quote-tweet or screenshot a sandwich attack, explain how VibeSwap prevents it
3. **Build-in-public update**: "This week we shipped..." — GitHub commits, new contracts, frontend updates
4. **AI co-founder moment**: JARVIS posts something it built, explains its reasoning
5. **Comparison thread**: "VibeSwap vs [competitor] — an honest comparison"
6. **Community highlight**: Shout out a contributor, community member, or partner
7. **Philosophy thread**: Cooperative Capitalism, fairness axioms, game theory primitives

**Daily engagement target**: Reply to 5+ tweets about MEV, batch auctions, fair launch, or DeFi infrastructure. Always add value, never shill.

**Tweet repo**: All drafted tweets stored in `docs/medium-pipeline/` (rename to `docs/content-pipeline/` or create `docs/tweets/` directory).

### 4.3 Reddit Strategy (2 posts/week)

**Target subreddits** (priority order):

| Subreddit | Post Type | Frequency | Rules to Follow |
|-----------|-----------|-----------|-----------------|
| r/ethereum | Technical explainers, mechanism design | 2x/month | No shilling — educational only, no direct links to product |
| r/defi | Product updates, comparisons | 2x/month | Allowed to link product if relevant to discussion |
| r/CryptoCurrency | General crypto audience pieces | 2x/month | Must be substantial content, not promotional |
| r/ethdev | Developer tutorials, smart contract patterns | 1x/month | Pure technical content, no marketing language |
| r/NervosNetwork | CKB integration updates | 1x/month | Community-focused, show CKB-specific work |
| r/artificial | AI co-founder story | 1x/month | Lead with AI angle, not crypto |

**Reddit rules**:
- NEVER use marketing language. Write like an engineer explaining something cool they built.
- Always disclose: "Disclosure: I'm the founder of VibeSwap."
- Engage genuinely in comments. Answer every question.
- Existing post templates: `docs/reddit-posts/r-ethereum-mev-problem.md`

### 4.4 Telegram Announcements

| Type | Frequency | Format |
|------|-----------|--------|
| Dev update | Weekly (Monday) | "This week: [3-5 bullet points of what shipped]" |
| Community AMA | Monthly | JARVIS fields questions for 2 hours |
| Partnership announcement | As they happen | Formatted announcement + link to blog post |
| Milestone celebration | As achieved | Fun announcement + community engagement prompt |
| Market commentary | When relevant | JARVIS autonomous — brief MEV-related news + VibeSwap angle |

---

## 5. Partnership Targets

### Tier A — High Priority (Outreach in April)

| Target | Contact Path | Integration Idea | Karma Score (est.) |
|--------|-------------|-------------------|-------------------|
| **ElizaOS / Shaw** | Tim Cotten introduction (WARM — active as of Mar 13) | ElizaOS agents execute MEV-free trades via VibeSwap API | 90 |
| **LayerZero Labs** | Cold email + Twitter DM to Bryan Pellegrino | Featured omnichain partner — VibeSwap as reference V2 OApp | 85 |
| **Base / Coinbase** | Base Ecosystem Fund application + Jesse Pollak Twitter DM | Ecosystem grant + featured on Base DeFi page | 85 |
| **Nervos / CKB** | Active — already building integration | Cell model batch auctions, CKB-native VibeSwap deployment | 90 |
| **Tim Cotten / Scrypted** | Direct relationship (active) | CRPC protocol integration, co-developed spec | 95 |

### Tier B — Medium Priority (Outreach in May)

| Target | Contact Path | Integration Idea | Karma Score (est.) |
|--------|-------------|-------------------|-------------------|
| **Virtuals Protocol** | Cold outreach via Twitter | AI agent trading via VibeSwap — MEV-free agent-to-agent swaps | 70 |
| **DayDreams** | Tim Cotten connection (per memory) | AI agent framework integration | 65 |
| **Delula** | Tim Cotten connection (per memory) | AI agent MEV protection | 65 |
| **Chibi** | Tim Cotten connection (per memory) | AI agent integration | 60 |
| **Axelar** | Cold outreach | Alternative cross-chain messaging for redundancy | 60 |
| **Pyth Network** | Cold outreach | Oracle integration — Pyth price feeds for TWAP validation | 70 |
| **Gelato Network** | Cold outreach | Automated batch settlement execution via Gelato relayers | 65 |

### Tier C — Monitor (Outreach in June if capacity allows)

| Target | Contact Path | Integration Idea | Karma Score (est.) |
|--------|-------------|-------------------|-------------------|
| **Flashbots** | Cold — they may see us as competition | MEV research collaboration, shared data | 55 |
| **CoW Protocol** | Cold — direct competitor but shared mission | MEV protection research collaboration | 50 |
| **Safe (Gnosis Safe)** | Cold outreach | Safe module for MEV-free DAO treasury trading | 60 |
| **OpenZeppelin** | Cold outreach | Audit partnership or security review program | 55 |
| **Chainlink** | Cold outreach | Oracle integration as alternative to Pyth | 55 |

### Outreach Execution (per Karma framework)

For each Tier A target, execute the following by April 30:

1. **Research**: Read their last 20 tweets, last 5 blog posts, latest GitHub activity
2. **Score**: Apply Karma scoring matrix (see `partnership-framework-2026.md` Section 3)
3. **Draft**: Write personalized outreach email (< 150 words, reference specific work)
4. **Send**: Email + Twitter DM on same day
5. **Follow up**: Day 3 (DM), Day 7 (email with new angle), Day 14 (final)
6. **Track**: Log in Karma CRM pipeline

---

## 6. KPIs & Metrics

### 6.1 Growth Metrics (Track Weekly — Every Sunday)

| Metric | Mar 31 Baseline | Apr 30 | May 31 | Jun 30 |
|--------|----------------|--------|--------|--------|
| Twitter/X followers | [record] | +500 | +1,000 | +2,500 |
| Telegram members | [record] | +100 | +250 | +500 |
| GitHub stars | [record] | +50 | +150 | +300 |
| GitHub forks | [record] | +10 | +30 | +75 |
| GitHub contributors (external) | [record] | +2 | +5 | +10 |
| Discord members (if launched) | 0 | 0 | 50 | 200 |
| Medium article total views | 0 | 2,000 | 8,000 | 20,000 |
| Reddit post total karma | 0 | 500 | 2,000 | 5,000 |

### 6.2 Protocol Metrics (Track Weekly)

| Metric | Apr 30 | May 31 | Jun 30 |
|--------|--------|--------|--------|
| Unique traders (Base mainnet) | 50 | 200 | 1,000 |
| Daily active users | 5 | 20 | 100 |
| Monthly trading volume | $50K | $500K | $5M |
| Total batches settled | 500 | 5,000 | 50,000 |
| TVL (total value locked) | $10K | $100K | $1M |
| Cross-chain transactions | 0 | 50 | 500 |

### 6.3 Partnership Metrics (Track Monthly)

| Metric | Apr 30 | May 31 | Jun 30 |
|--------|--------|--------|--------|
| Tier A outreach sent | 5 | 5 | 5 |
| Tier B outreach sent | 0 | 7 | 7 |
| Responses received | 2 | 5 | 8 |
| Meetings completed | 1 | 3 | 5 |
| Partnerships signed | 0 | 0 | 2 |
| Partner-referred volume | $0 | $0 | $10K |

### 6.4 Content Metrics (Track Weekly)

| Metric | Apr 30 | May 31 | Jun 30 |
|--------|--------|--------|--------|
| Blog posts published | 2 | 5 | 8 |
| Twitter threads published | 12 | 24 | 36 |
| Reddit posts published | 4 | 12 | 20 |
| YouTube videos | 1 | 2 | 4 |
| Podcast appearances | 0 | 1 | 2 |
| Total content impressions | 10K | 50K | 200K |

### 6.5 Grant Metrics (Track Monthly)

| Metric | Apr 30 | May 31 | Jun 30 |
|--------|--------|--------|--------|
| Applications submitted | 1 | 5 | 6 |
| Applications accepted | 0 | 1 | 2 |
| Grant funding received | $0 | $0-25K | $25-100K |

---

## 7. Weekly Execution Cadence

Every week follows this rhythm:

| Day | Marketing Actions | Primary Owner |
|-----|-------------------|---------------|
| **Monday** | Telegram dev update. Plan week's content. Review last week's metrics. | Karma (TG), Will (planning) |
| **Tuesday** | Publish blog post (if scheduled). 2 Twitter threads. | Will (blog), Fate (threads) |
| **Wednesday** | Reddit post #1. Partnership outreach (1-2 emails). Engage Twitter. | Catto (Reddit), Freedom (outreach) |
| **Thursday** | Twitter thread. Reddit engagement (reply to comments). DeFi community engagement. | Fate (Twitter), Catto (Reddit), Defaibro (communities) |
| **Friday** | Reddit post #2. Twitter thread. Follow up on partnership outreach. Grant work. | Catto (Reddit), Fate (Twitter), John Paul (grants) |
| **Saturday** | JARVIS autonomous posting. Community engagement. Cross-pollination. | Fate + Karma + JARVIS |
| **Sunday** | Metrics review. Log all KPIs. Update this playbook with actuals vs. targets. | Karma (metrics), Will (review) |

### Team Roster & Lanes (Updated 2026-03-14)

| Person | Primary Lane | Secondary |
|--------|-------------|-----------|
| **Will** | Strategy, blog posts, mechanism design content | Final review on all |
| **Freedom** | Partnerships & BD outreach, grant coordination | Tim Cotten/ElizaOS pipeline |
| **Fate** | Twitter/X content deployment (154 tweets queued) | Live-tweeting events |
| **Catto** | Reddit & forum seeding (6 posts ready) | Hacker News, new subreddits |
| **Defaibro** | DeFi community infiltration (TG/Discord) | KOL relationship building |
| **John Paul** | Grants & hackathon submissions (7 apps ready) | DeFi Llama listing |
| **Karma** | Telegram growth & community engagement | Weekly metrics tracking |
| **JARVIS** | Autonomous posting, AMAs, shower thoughts | Engagement, replies |

See `docs/team-marketing-assignments.md` for detailed per-person assignments.

---

## 8. Tools & Accounts Needed

| Tool | Purpose | Status | Action Required |
|------|---------|--------|-----------------|
| Twitter/X @VibeSwap | Primary social | Pending | Create account, integrate JARVIS (see `docs/twitter.md`) |
| Medium publication | Blog posts | Pending | Create "VibeSwap" publication |
| Mirror.xyz | Web3-native blog | Pending | Create Mirror with wallet |
| Reddit u/vibeswap | Community posts | Pending | Create account, build karma organically first |
| YouTube channel | Video content | Pending | Create channel, upload first demo video |
| DeFi Llama listing | Protocol visibility | Pending | Submit PR to DeFi Llama repo |
| Karma CRM | Partnership tracking | See `partnership-framework-2026.md` | Implement Phase 1 (spreadsheet) |
| Google Analytics | Vercel site metrics | Pending | Add to frontend |
| Dune Analytics | On-chain dashboards | Pending | Create VibeSwap dashboard |

---

## 9. Budget (Bootstrapped)

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Twitter/X API (Free tier) | $0 | 1,500 tweets/month — sufficient for Q2 |
| Medium | $0 | Free publication |
| Mirror.xyz | $0 | Free (gas only for posts) |
| Vercel hosting | $0 | Free tier |
| Domain (if needed) | ~$12/year | vibeswap.io or similar |
| Video editing (DIY) | $0 | Screen recordings + free editing tools |
| **Total** | **$0-1/month** | Bootstrapped means bootstrapped |

The only real cost is time. Allocate 10-15 hours/week to marketing execution.

---

## 10. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tim Cotten EthDC talk doesn't mention VibeSwap | Medium | High | Coordinate beforehand. Even without mention, leverage the CRPC connection in our own content. |
| Shaw/ElizaOS not interested in integration | Medium | Medium | Pursue Virtuals, DayDreams, Chibi as alternative AI agent partners. |
| Grant applications rejected | High | Medium | Apply to 5+ programs — diversify. Each rejection provides feedback for next application. |
| Low Reddit engagement | Medium | Low | Focus on genuine educational content. Build karma before promotional posts. |
| Twitter account suspension | Low | High | Keep JARVIS posts within ToS. No spamming. Archive all tweet drafts locally. |
| Competitor ships similar feature | Medium | Low | VibeSwap has 200+ contracts and live product. Execution > announcements. |

---

## Appendix A: EthDC April 16 — Full Playbook

### Before (April 1-15)
- [ ] Confirm Tim Cotten's talk details (time, room, topic)
- [ ] Prepare 5 tweet drafts for live-tweeting
- [ ] Create "VibeSwap x CRPC" explainer graphic
- [ ] Schedule pre-event tweet for April 15 (day before)
- [ ] Brief JARVIS with EthDC context for autonomous engagement

### During (April 16)
- [ ] Live-tweet key moments from Tim's talk (quote + VibeSwap context)
- [ ] Engage every reply and quote-tweet
- [ ] DM anyone who shows interest
- [ ] Post Telegram update: "Tim just presented CRPC at EthDC..."

### After (April 17-20)
- [ ] Publish recap blog post within 48 hours
- [ ] Reddit post to r/CryptoCurrency with talk highlights
- [ ] Follow up with new contacts made during event
- [ ] DM Tim for intro to anyone who expressed interest

---

## Appendix B: Grant Application Template

```
PROJECT: VibeSwap
CATEGORY: DeFi Infrastructure / Public Good
ASK: $[amount]

PROBLEM: MEV extraction costs DeFi users $1.4B+ (2020-2025). Every continuous-execution
DEX is architecturally vulnerable.

SOLUTION: Commit-reveal batch auctions with uniform clearing prices. Open-source.
Deployed on [chain]. 200+ smart contracts. Live on Base mainnet.

WHY THIS GRANT: [Specific to each program — e.g., "VibeSwap is the first MEV-free
DEX on Base, contributing to Base's mission of bringing the next billion users on-chain
without the hidden tax of MEV extraction."]

TEAM: Faraday1 (mechanism design, Solidity) + JARVIS (AI co-founder, autonomous
development) + 6 contributors. Bootstrapped. No VC funding. Open source.

DELIVERABLES:
1. [Specific deliverable 1]
2. [Specific deliverable 2]
3. [Specific deliverable 3]

TIMELINE: [X weeks]

LINKS:
- GitHub: github.com/wglynn/vibeswap
- Live: frontend-jade-five-87.vercel.app
- Whitepaper: [link]
- Mechanism design paper: [link]
```

---

*This playbook is a living document. Update weekly with actuals vs. targets. Every Sunday, log metrics and adjust the following week's actions based on what's working.*

*Trade without getting robbed. Build without getting diluted.*
