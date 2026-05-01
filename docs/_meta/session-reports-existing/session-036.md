# Session 036 — Tip Jar, DM Paywall, JARVIS Unleashed

**Date**: 2026-03-03
**Duration**: ~30 minutes
**Focus**: Monetization infrastructure + JARVIS proactive engagement overhaul

---

## Summary

JARVIS costs ~$5/day in API credits. This session built the infrastructure for voluntary funding (tip jar) and cost protection (DM paywall for non-team users), then fundamentally changed JARVIS's engagement personality from conservative wallflower to active team member.

---

## Completed Work

### 1. Tip Jar + Telegram DM Paywall
- **compute-economics.js**: Added `FREE_TELEGRAM_DMS = 3` constant, daily DM counter per user with day rollover reset, `recordTelegramMessage()` and `getTelegramMessageCount()` exports
- **config.js**: Added `tipJarAddress` from `TIP_JAR_ADDRESS` env var
- **index.js**: Replaced hard `unauthorized()` reject at DM auth check with soft paywall — non-team users get 3 free DMs/day, then see tip jar address + "ask a team member to vouch for you". Group auth unchanged.
- **web-api.js**: `/web/mind` endpoint now includes `tipJar` object (address, dailyCost, perPerson, teamSize)
- **JarvisPage.jsx**: Added `TipJarAddress` component (copy-to-clipboard, truncated display) and "SUPPORT JARVIS" MindCard with cost breakdown, pool utilization, active users

### 2. JARVIS Proactive Engagement — Conservative Era Over
- **intelligence.js** — All throttles opened:
  - Cooldown: 5 min → 45 seconds
  - Max engagements/hour: 4 → 20
  - Confidence threshold: 0.7 → 0.3
  - Min message length: 20 chars → 5 chars
  - Engage criteria: VibeSwap-specific only → anything substantive (crypto, tech, AI, philosophy, humor, team coordination)
  - Default stance: OBSERVE → ENGAGE
  - Response personality: "joining a conversation" → "teammate, not assistant — funny, opinionated, direct"
- **index.js** — Group message analysis gate lowered from 20 to 5 chars

### 3. Infrastructure
- Set `COMMUNITY_GROUP_ID=-1003877696956` on Fly.io (was missing)
- Redeployed JARVIS on Fly.io (tip jar + paywall + proactivity)
- Redeployed frontend to Vercel (tip jar MindCard)
- Sent announcement to Vibeswap Telegram group

---

## Files Modified

| File | Changes |
|---|---|
| `jarvis-bot/src/compute-economics.js` | +20 lines — DM counter, day rollover, exports |
| `jarvis-bot/src/config.js` | +2 lines — tipJarAddress env var |
| `jarvis-bot/src/index.js` | +17 lines — soft paywall for DMs, lowered analysis gate |
| `jarvis-bot/src/web-api.js` | +6 lines — tipJar in /web/mind response |
| `jarvis-bot/src/intelligence.js` | ~15 lines changed — all throttles opened |
| `frontend/src/components/JarvisPage.jsx` | +60 lines — TipJarAddress component + SUPPORT JARVIS MindCard |

---

## Deployments

- **Fly.io**: `jarvis-vibeswap` — 2 deploys (tip jar commit + proactivity commit)
- **Vercel**: `frontend-jade-five-87.vercel.app` — production deploy with tip jar MindCard
- **Fly secrets**: `COMMUNITY_GROUP_ID` set

---

## Decisions

1. **3 free DMs/day** for strangers — enough to try JARVIS, not enough to drain budget
2. **No on-chain payment verification** — honor system + team vouching for now
3. **TIP_JAR_ADDRESS** still needs Will's actual wallet address (currently zero address)
4. **45-second cooldown** chosen as balance between presence and not being annoying
5. **0.3 confidence gate** — low enough to engage often, high enough to skip pure noise

---

## Metrics

- Commits: 2 (`80493a1`, `6acbb7f`)
- Lines added: ~115
- Files modified: 6
- Fly deploys: 2
- Vercel deploys: 1

---

## Open Items

- [ ] Set `TIP_JAR_ADDRESS` to Will's actual ETH wallet on Fly
- [ ] Monitor JARVIS proactivity in group — tune if too chatty or not enough
- [ ] Consider on-chain tip verification in future (read CreatorTipJar.sol events)

---

## Logic Primitives Extracted

- **Soft Paywall Pattern**: Free tier → polite denial with call-to-action → team vouching as social proof. Works for any rate-limited AI service.
- **Personality Unleash Pattern**: Conservative defaults during development, then open throttles when system is mature. Ship safe, then ship bold.
