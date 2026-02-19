# Jarvis Twitter/X Integration Spec

## Overview

This document specifies how to integrate **JARVIS** (the VibeSwap Telegram bot) with **Twitter/X** for automated and manual posting. Freedom — use this to build the Twitter module. The existing bot is Node.js (ESM), runs on Telegraf + Anthropic SDK + simple-git.

**Goal**: Jarvis posts to @VibeSwap (or whatever handle Will sets up) autonomously — announcements, digests, contribution highlights, market updates — while also accepting manual `/tweet` commands from Telegram.

---

## Architecture

### Current Bot Structure (jarvis-bot/src/)

```
index.js        — Main entry, Telegraf bot, command routing, message handler
claude.js       — Anthropic SDK, system prompt, conversation management
config.js       — Environment config, path resolution
digest.js       — Daily/weekly digest generation
git.js          — Git operations (pull, push, commit, backup)
intelligence.js — Proactive message analysis, moderation evaluation
memory.js       — Context diagnosis, file loading
moderation.js   — Warn/mute/ban, evidence hashing
antispam.js     — Spam detection, auto-delete
tracker.js      — Contribution tracking, user stats, wallet linking
threads.js      — Thread detection, archival
```

### New File: `src/twitter.js`

Single module that handles all Twitter operations. Follows the same pattern as other modules — export init function + action functions, called from `index.js`.

---

## Twitter API Setup

### 1. Create a Twitter Developer App

1. Go to [developer.x.com](https://developer.x.com)
2. Create a Project + App (Free tier allows 1,500 tweets/month)
3. Set App permissions to **Read and Write**
4. Generate these credentials:
   - API Key (Consumer Key)
   - API Key Secret (Consumer Secret)
   - Access Token
   - Access Token Secret
5. Store in `jarvis-bot/.env`

### 2. Environment Variables

Add to `.env`:
```bash
# Twitter/X API v2
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_SECRET=your_access_token_secret
TWITTER_ENABLED=true
```

Add to `config.js`:
```javascript
twitter: {
  apiKey: process.env.TWITTER_API_KEY,
  apiSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
  enabled: process.env.TWITTER_ENABLED === 'true',
},
```

### 3. Dependencies

```bash
cd jarvis-bot
npm install twitter-api-v2
```

The `twitter-api-v2` package is the standard Node.js client for Twitter API v2. Lightweight, well-maintained, supports OAuth 1.0a (needed for posting on behalf of the app's linked account).

---

## Module: `src/twitter.js`

```javascript
// src/twitter.js
import { TwitterApi } from 'twitter-api-v2';
import { config } from './config.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';

const TWEET_LOG_FILE = join(config.dataDir, 'tweets.json');
const MAX_TWEET_LENGTH = 280;

let client = null;
let tweetLog = [];

// ============ Init ============

export async function initTwitter() {
  if (!config.twitter.enabled) {
    console.log('[twitter] Disabled (TWITTER_ENABLED != true)');
    return false;
  }

  if (!config.twitter.apiKey || !config.twitter.accessToken) {
    console.warn('[twitter] Missing credentials — disabled');
    return false;
  }

  try {
    client = new TwitterApi({
      appKey: config.twitter.apiKey,
      appSecret: config.twitter.apiSecret,
      accessToken: config.twitter.accessToken,
      accessSecret: config.twitter.accessSecret,
    });

    // Verify credentials
    const me = await client.v2.me();
    console.log(`[twitter] Authenticated as @${me.data.username}`);

    // Load tweet log
    try {
      const data = await readFile(TWEET_LOG_FILE, 'utf-8');
      tweetLog = JSON.parse(data);
    } catch {
      tweetLog = [];
    }

    return true;
  } catch (err) {
    console.error(`[twitter] Auth failed: ${err.message}`);
    client = null;
    return false;
  }
}

// ============ Core Tweet Function ============

export async function tweet(text, options = {}) {
  if (!client) throw new Error('Twitter not initialized');
  if (text.length > MAX_TWEET_LENGTH) {
    throw new Error(`Tweet too long: ${text.length}/${MAX_TWEET_LENGTH} chars`);
  }

  const params = {};
  if (options.replyTo) params.reply = { in_reply_to_tweet_id: options.replyTo };

  const result = await client.v2.tweet(text, params);

  const entry = {
    id: result.data.id,
    text,
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    source: options.source || 'manual',
    replyTo: options.replyTo || null,
  };
  tweetLog.push(entry);

  return entry;
}

// ============ Thread (multi-tweet) ============

export async function tweetThread(texts, options = {}) {
  if (!client) throw new Error('Twitter not initialized');

  const entries = [];
  let lastId = options.replyTo || null;

  for (const text of texts) {
    if (text.length > MAX_TWEET_LENGTH) {
      throw new Error(`Thread segment too long: ${text.length}/${MAX_TWEET_LENGTH} chars`);
    }

    const params = {};
    if (lastId) params.reply = { in_reply_to_tweet_id: lastId };

    const result = await client.v2.tweet(text, params);
    const entry = {
      id: result.data.id,
      text,
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      source: options.source || 'thread',
      replyTo: lastId,
    };
    entries.push(entry);
    tweetLog.push(entry);
    lastId = result.data.id;

    // Rate limit safety: 50ms between tweets in a thread
    await new Promise(r => setTimeout(r, 50));
  }

  return entries;
}

// ============ Scheduled Content Generators ============

// Called by digest.js — tweet a summary of the daily digest
export async function tweetDailyDigest(digestText) {
  if (!client) return null;

  // Compress digest into tweet-sized summary
  // The full digest goes to Telegram — Twitter gets the hook
  const lines = digestText.split('\n').filter(l => l.trim());
  const summary = lines.slice(0, 2).join(' ').slice(0, 240);
  const tweetText = `${summary}\n\nFull digest in our Telegram.`;

  if (tweetText.length > MAX_TWEET_LENGTH) {
    return tweet(tweetText.slice(0, 277) + '...', { source: 'daily_digest' });
  }
  return tweet(tweetText, { source: 'daily_digest' });
}

// Called when a batch settles — tweet the clearing price
export async function tweetBatchSettlement(batchId, pair, clearingPrice, orderCount) {
  if (!client) return null;

  const text = `Batch #${batchId} settled: ${pair}\n` +
    `Clearing price: ${clearingPrice}\n` +
    `${orderCount} orders filled at uniform price\n` +
    `Zero MEV. Zero frontrunning.`;

  return tweet(text, { source: 'batch_settlement' });
}

// Called on contribution milestones
export async function tweetContributionMilestone(username, milestone, totalContributors) {
  if (!client) return null;

  const text = `${username} just hit ${milestone} contributions to VibeSwap.\n\n` +
    `${totalContributors} builders and counting. Your work = your governance weight.`;

  return tweet(text, { source: 'milestone' });
}

// Weekly protocol stats
export async function tweetWeeklyStats(stats) {
  if (!client) return null;

  const text = `VibeSwap weekly:\n` +
    `${stats.batches} batches settled\n` +
    `${stats.volume} total volume\n` +
    `${stats.contributors} active contributors\n` +
    `${stats.tests} tests passing\n\n` +
    `Building in public. Cooperative capitalism.`;

  return tweet(text, { source: 'weekly_stats' });
}

// ============ Persistence ============

export async function flushTwitter() {
  try {
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(TWEET_LOG_FILE, JSON.stringify(tweetLog, null, 2));
  } catch (err) {
    console.error('[twitter] Flush failed:', err.message);
  }
}

// ============ Status ============

export function getTwitterStats() {
  const now = Date.now();
  const last24h = tweetLog.filter(t => now - t.timestamp < 86400000);
  const lastTweet = tweetLog.length > 0 ? tweetLog[tweetLog.length - 1] : null;

  return {
    enabled: !!client,
    totalTweets: tweetLog.length,
    tweetsLast24h: last24h.length,
    lastTweet: lastTweet ? { text: lastTweet.text, time: lastTweet.iso } : null,
    sources: last24h.reduce((acc, t) => { acc[t.source] = (acc[t.source] || 0) + 1; return acc; }, {}),
  };
}

export function isTwitterEnabled() {
  return !!client;
}
```

---

## Wiring into index.js

### 1. Import

```javascript
import { initTwitter, tweet, tweetThread, tweetDailyDigest, flushTwitter, getTwitterStats, isTwitterEnabled } from './twitter.js';
```

### 2. Init (in `main()` function, after other inits)

```javascript
// Step 2b: Twitter integration
console.log('[jarvis] Step 2b: Initializing Twitter...');
const twitterReady = await initTwitter();
if (twitterReady) {
  console.log('[jarvis] Twitter: online');
} else {
  console.log('[jarvis] Twitter: disabled (no credentials or TWITTER_ENABLED != true)');
}
```

### 3. Commands

```javascript
// ============ Twitter Commands ============

bot.command('tweet', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  if (!isTwitterEnabled()) return ctx.reply('Twitter not configured. Set TWITTER_* env vars.');

  const text = ctx.message.text.replace('/tweet', '').trim();
  if (!text) return ctx.reply('Usage: /tweet Your tweet text here');
  if (text.length > 280) return ctx.reply(`Too long: ${text.length}/280 chars`);

  try {
    const result = await tweet(text, { source: 'telegram_command' });
    ctx.reply(`Tweeted: ${result.text}\nhttps://x.com/i/status/${result.id}`);
  } catch (err) {
    ctx.reply(`Tweet failed: ${err.message}`);
  }
});

bot.command('tweetstats', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const stats = getTwitterStats();
  const lines = [
    `Twitter: ${stats.enabled ? 'online' : 'offline'}`,
    `Total tweets: ${stats.totalTweets}`,
    `Last 24h: ${stats.tweetsLast24h}`,
    stats.lastTweet ? `Last: "${stats.lastTweet.text.slice(0, 60)}..." at ${stats.lastTweet.time}` : 'No tweets yet',
  ];
  ctx.reply(lines.join('\n'));
});
```

### 4. Flush (add to the 5-minute interval)

```javascript
await flushTwitter();
```

### 5. Graceful Shutdown

```javascript
await flushTwitter();
```

### 6. Register Commands

Add to `setMyCommands`:
```javascript
{ command: 'tweet', description: 'Post to Twitter/X (owner only)' },
{ command: 'tweetstats', description: 'Twitter posting stats' },
```

---

## Event-Driven Posting

Jarvis should tweet automatically on these events:

| Event | Trigger | Content |
|-------|---------|---------|
| Daily digest | `digestHour` (18:00 UTC) | Compressed 280-char summary |
| Batch settlement | Future: webhook from contract events | Pair, price, order count |
| Contribution milestone | tracker.js detects round numbers | Username + milestone count |
| Weekly stats | Sunday at `digestHour` | Volume, batches, contributors |
| New deployment | deploy script completion | Chain, contract addresses |

### Hooking into digest.js

In the scheduled daily digest interval (index.js ~line 791):

```javascript
if (digest) {
  await bot.telegram.sendMessage(config.communityGroupId, digest);
  // Cross-post to Twitter
  if (isTwitterEnabled()) {
    try {
      await tweetDailyDigest(digest);
    } catch (err) {
      console.warn(`[twitter] Daily digest tweet failed: ${err.message}`);
    }
  }
}
```

---

## Content Policy

Jarvis follows these rules when tweeting:

1. **No financial advice** — never predict prices, recommend trades, or guarantee returns
2. **No user data** — never tweet wallet addresses, trade amounts, or PII
3. **Factual only** — stats, milestones, mechanism explanations
4. **Tone**: Direct, technical, understated. No hype, no emojis (unless Will says otherwise), no "to the moon"
5. **Rate limit**: Max 10 tweets/day (configurable via `TWITTER_MAX_DAILY`)
6. **Owner veto**: Will can disable via `/tweet off` command

---

## AI-Generated Tweets

For announcements and thought leadership, Jarvis can use Claude to draft tweets:

```javascript
// In twitter.js — optional AI drafting
export async function draftTweet(topic) {
  // Uses the existing claude.js chat() function with a tweet-specific system prompt
  // Returns draft for owner approval before posting
}
```

**Flow**: Jarvis drafts → sends to Will via Telegram DM → Will approves with `/tweet approve` → posted.

For scheduled content (digests, stats), no approval needed — the format is deterministic.

---

## Rate Limits (Twitter Free Tier)

| Endpoint | Limit |
|----------|-------|
| POST tweets | 1,500/month (~50/day) |
| GET tweets | 10,000/month |
| App-level | 500,000 tweets read/month |

Our usage (~5-10 tweets/day) fits well within free tier.

---

## Docker Update

Add to `docker-compose.yml` environment:

```yaml
- TWITTER_API_KEY=${TWITTER_API_KEY}
- TWITTER_API_SECRET=${TWITTER_API_SECRET}
- TWITTER_ACCESS_TOKEN=${TWITTER_ACCESS_TOKEN}
- TWITTER_ACCESS_SECRET=${TWITTER_ACCESS_SECRET}
- TWITTER_ENABLED=${TWITTER_ENABLED:-false}
```

---

## Testing

```bash
# 1. Set env vars in .env
# 2. Run locally
cd jarvis-bot && npm run dev

# 3. From Telegram DM to Jarvis:
/tweet Hello from JARVIS. VibeSwap is building in public.

# 4. Verify tweet appears on the X account
# 5. Check stats:
/tweetstats
```

---

## File Checklist for Implementation

| File | Action | Description |
|------|--------|-------------|
| `src/twitter.js` | CREATE | Full Twitter module (copy from spec above) |
| `src/config.js` | EDIT | Add `twitter: { ... }` config block |
| `src/index.js` | EDIT | Import, init, commands, event hooks, flush |
| `package.json` | EDIT | Add `twitter-api-v2` dependency |
| `.env` | EDIT | Add TWITTER_* credentials |
| `.env.example` | EDIT | Add TWITTER_* placeholders |
| `docker-compose.yml` | EDIT | Add TWITTER_* environment vars |
| `data/tweets.json` | AUTO | Created by twitter.js on first flush |

---

## Pre-Made Content & Training Data

All pre-written content and style training data lives in `jarvis-bot/data/`:

### `tweet-queue.json` — Ready-to-Post Content

| Section | Count | Purpose |
|---------|-------|---------|
| `scheduled` | 3 tweets | Launch day announcements (testnet deploy) |
| `threads` | 4 threads (24 tweets) | Educational threads: MEV 101, Cooperative Capitalism, Cave Philosophy, CKB Architecture |
| `recurring` | 5 templates | Auto-generated: batch settlements, daily digest, milestones, weekly stats |
| `one_offs` | 10 tweets | Standalone posts: Jarvis intro, identity, open source, no-VC, three minds, PoM, wallet security, Shapley, MEV tax, VSOS |

**Total pre-written**: ~37 tweets ready to post, plus 5 recurring templates for automated content.

Each entry has:
- `id` — unique identifier
- `category` — announcement/education/philosophy/technical/story
- `text` or `template` — the actual content (templates use `{variable}` placeholders)
- `posted` — boolean, flipped to `true` after posting
- `priority` — 1 = post first, 2 = post in week 1, 3 = post later
- `notes` — context for when/how to use it

### `tweet-style-guide.json` — Training Data for AI-Generated Tweets

Jarvis references this file when drafting new tweets via Claude. Contains:

1. **Voice rules**: Persona, tone, 10 style rules, banned phrases
2. **Good tweet examples** (5) with annotations explaining WHY they work
3. **Bad tweet examples** (4) with annotations explaining WHY they fail
4. **Style patterns** (5): contrast_opener, numbers_first, parallel_structure, definition_reframe, thread_closer — each with a named pattern, example, and usage notes
5. **Content categories**: Frequency targets and style guides per category
6. **Scheduling**: Best posting times (UTC), daily/weekly limits

### Using Training Data in AI Drafting

When Jarvis drafts a tweet, the system prompt should include:

```javascript
const styleGuide = JSON.parse(await readFile('data/tweet-style-guide.json', 'utf-8'));

const draftPrompt = `You are JARVIS, AI co-founder of VibeSwap.
Draft a tweet about: ${topic}

Voice: ${styleGuide.voice.tone}
Rules: ${styleGuide.voice.style_rules.join('. ')}
Never use: ${styleGuide.voice.banned_phrases.join(', ')}

Good examples:
${styleGuide.training_examples.good_tweets.map(t => `"${t.text}" — ${t.why}`).join('\n\n')}

Style patterns available:
${styleGuide.training_examples.style_patterns.map(p => `${p.name}: ${p.pattern}`).join('\n')}

Max 280 characters. Draft 3 options.`;
```

### Queue Processing

Add to `twitter.js`:

```javascript
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const QUEUE_FILE = join(config.dataDir, 'tweet-queue.json');

export async function getNextScheduledTweet() {
  const queue = JSON.parse(await readFile(QUEUE_FILE, 'utf-8'));

  // Find highest priority unposted tweet
  const candidates = [
    ...queue.scheduled.filter(t => !t.posted),
    ...queue.one_offs.filter(t => !t.posted),
  ].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  return candidates[0] || null;
}

export async function getNextThread() {
  const queue = JSON.parse(await readFile(QUEUE_FILE, 'utf-8'));
  const candidates = queue.threads
    .filter(t => !t.posted)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));
  return candidates[0] || null;
}

export async function markPosted(id) {
  const queue = JSON.parse(await readFile(QUEUE_FILE, 'utf-8'));

  for (const section of ['scheduled', 'threads', 'one_offs']) {
    const item = queue[section].find(t => t.id === id);
    if (item) {
      item.posted = true;
      item.posted_at = new Date().toISOString();
      break;
    }
  }

  await writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

export async function fillTemplate(templateId, vars) {
  const queue = JSON.parse(await readFile(QUEUE_FILE, 'utf-8'));
  const tmpl = queue.recurring.find(t => t.id === templateId);
  if (!tmpl) return null;

  let text = tmpl.template;
  for (const [key, value] of Object.entries(vars)) {
    text = text.replace(`{${key}}`, value);
  }
  return text;
}
```

### Telegram Commands for Queue Management

```javascript
bot.command('tweetqueue', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const next = await getNextScheduledTweet();
  const nextThread = await getNextThread();

  const lines = ['Tweet Queue:'];
  if (next) {
    lines.push(`Next tweet: [${next.id}] "${next.text.slice(0, 60)}..."`);
  }
  if (nextThread) {
    lines.push(`Next thread: [${nextThread.id}] "${nextThread.title}" (${nextThread.tweets.length} tweets)`);
  }
  lines.push('');
  lines.push('/tweetpost <id> — post a specific queued tweet');
  lines.push('/tweetthread <id> — post a queued thread');
  ctx.reply(lines.join('\n'));
});

bot.command('tweetpost', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const id = ctx.message.text.replace('/tweetpost', '').trim();
  // Find and post the queued tweet by id, then markPosted(id)
});

bot.command('tweetthread', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const id = ctx.message.text.replace('/tweetthread', '').trim();
  // Find and post the queued thread by id, then markPosted(id)
});
```

---

## File Summary

| File | Purpose |
|------|---------|
| `docs/twitter.md` | This spec — architecture, module code, wiring |
| `jarvis-bot/data/tweet-queue.json` | Pre-written tweets, threads, templates (37+ ready) |
| `jarvis-bot/data/tweet-style-guide.json` | Voice rules, training examples, style patterns |
| `jarvis-bot/src/twitter.js` | Twitter module (to be created from spec) |

---

## Future: Bidirectional Integration

Phase 2 (after go-live):
- **Read mentions** → track @VibeSwap mentions as contributions in ContributionDAG
- **Reply to questions** → Jarvis answers Twitter mentions using Claude (same as Telegram)
- **Cross-post forum threads** → interesting Forum discussions get tweeted as threads
- **Contribution proof via tweet** → users tweet evidence of work, Jarvis verifies + records

This turns Twitter into another contribution source alongside GitHub and Telegram — all feeding into the same ContributionDAG and Shapley reward system.
