#!/usr/bin/env node

/**
 * ============================================================
 * BD Toolkit — 1-Click Business Development Automation
 * ============================================================
 *
 * Usage:
 *   node scripts/bd-toolkit.js <command> [options]
 *
 * Commands:
 *   grant <template>     — Generate a ready-to-submit grant application
 *   pitch <audience>     — Generate a tailored pitch deck/doc
 *   tweet <category>     — Pick and format a tweet for posting
 *   reddit <post>        — Format a Reddit post for copy-paste
 *   outreach <target>    — Generate a cold outreach email/DM
 *   stats                — Pull live project stats for any application
 *   all-grants           — Generate all grant applications at once
 *   calendar             — Show this week's content calendar
 *
 * Examples:
 *   node scripts/bd-toolkit.js grant ethereum-foundation
 *   node scripts/bd-toolkit.js pitch investor
 *   node scripts/bd-toolkit.js tweet hook-threads
 *   node scripts/bd-toolkit.js outreach layerzero
 *   node scripts/bd-toolkit.js stats
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const TWEETS = path.join(ROOT, 'tweet repo');
const GRANTS = path.join(DOCS, 'grants');
const REDDIT = path.join(DOCS, 'reddit-posts');
const OUTPUT = path.join(DOCS, 'bd-output');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { recursive: true });

// ============ Live Project Stats ============

function getStats() {
  const stats = {};

  // Use glob-based counting that works on Windows + MinGW
  function countFiles(dir, ext) {
    try {
      const count = execSync(`git ls-files "${dir}" -- "*.${ext}" 2>/dev/null | wc -l`, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
      return parseInt(count) || 0;
    } catch {
      // Fallback: walk the dir in Node
      try {
        let n = 0;
        const walk = (d) => {
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            if (f.isDirectory()) walk(path.join(d, f.name));
            else if (f.name.endsWith('.' + ext)) n++;
          }
        };
        walk(path.join(ROOT, dir));
        return n;
      } catch { return 0; }
    }
  }

  try {
    stats.contracts = countFiles('contracts', 'sol') || '200+';
    stats.testFiles = countFiles('test', 'sol') || '100+';

    // Frontend components
    try {
      const comps = fs.readdirSync(path.join(ROOT, 'frontend/src/components')).filter(f => f.endsWith('.jsx'));
      stats.frontendPages = comps.length || '170+';
      stats.frontendComponents = comps.length || '170+';
    } catch { stats.frontendPages = '170+'; stats.frontendComponents = '170+'; }

    // Git commits
    try {
      stats.commits = execSync('git rev-list --count HEAD', { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    } catch { stats.commits = '1000+'; }

    // UI components
    try {
      stats.uiComponents = fs.readdirSync(path.join(ROOT, 'frontend/src/components/ui')).filter(f => f.endsWith('.jsx')).length || '80+';
    } catch { stats.uiComponents = '80+'; }

    // Hooks
    try {
      stats.hooks = fs.readdirSync(path.join(ROOT, 'frontend/src/hooks')).filter(f => f.endsWith('.jsx')).length || '20+';
    } catch { stats.hooks = '20+'; }

    // Contract categories
    try {
      stats.contractCategories = fs.readdirSync(path.join(ROOT, 'contracts'), { withFileTypes: true }).filter(d => d.isDirectory()).length || '20+';
    } catch { stats.contractCategories = '20+'; }

    // Papers
    try {
      stats.papers = fs.readdirSync(path.join(ROOT, 'docs/papers')).filter(f => f.endsWith('.md')).length || '30+';
    } catch { stats.papers = '30+'; }

    // Tweet count
    try {
      let tweetCount = 0;
      const tweetDir = path.join(ROOT, 'tweet repo');
      if (fs.existsSync(tweetDir)) {
        fs.readdirSync(tweetDir, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => {
          tweetCount += fs.readdirSync(path.join(tweetDir, d.name)).filter(f => f.endsWith('.md')).length;
        });
      }
      stats.tweetDrafts = tweetCount || '140+';
    } catch { stats.tweetDrafts = '140+'; }

  } catch (e) {
    stats.contracts = '200+';
    stats.testFiles = '100+';
    stats.frontendPages = '170+';
    stats.commits = '1000+';
  }

  // Static stats that don't change often
  stats.chains = 'Base (mainnet), Ethereum, Arbitrum, Optimism (planned)';
  stats.crossChain = 'LayerZero V2';
  stats.vcFunding = '$0';
  stats.preMine = '0%';
  stats.teamAllocation = '0%';
  stats.techStack = 'Solidity 0.8.20, Foundry, React 18, Vite 5, ethers.js v6, Python 3.9+';
  stats.frameworks = 'OpenZeppelin v5.0.1 (UUPS), LayerZero V2 OApp';
  stats.website = 'https://frontend-jade-five-87.vercel.app';
  stats.github = 'https://github.com/wglynn/vibeswap';
  stats.telegram = 'https://t.me/+3uHbNxyZH-tiOGY8';

  return stats;
}

// ============ Commands ============

function cmdStats() {
  const stats = getStats();
  console.log('\n=== VibeSwap Live Stats ===\n');
  for (const [key, val] of Object.entries(stats)) {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    console.log(`  ${label}: ${val}`);
  }
  console.log('\n(Copy these into any application)\n');

  // Also write to a file for easy access
  const md = Object.entries(stats).map(([k, v]) => {
    const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    return `| ${label} | ${v} |`;
  }).join('\n');

  const output = `# VibeSwap Stats — Auto-Generated\n\n| Metric | Value |\n|--------|-------|\n${md}\n\n*Generated: ${new Date().toISOString().split('T')[0]}*\n`;
  fs.writeFileSync(path.join(OUTPUT, 'latest-stats.md'), output);
  console.log(`Saved to docs/bd-output/latest-stats.md`);
}

function cmdGrant(template) {
  if (!template) {
    console.log('\nAvailable grant templates:');
    if (fs.existsSync(GRANTS)) {
      fs.readdirSync(GRANTS).filter(f => f.endsWith('.md')).forEach(f => {
        console.log(`  - ${f.replace('.md', '')}`);
      });
    }
    console.log('\nUsage: node scripts/bd-toolkit.js grant <template-name>');
    return;
  }

  const file = path.join(GRANTS, `${template}.md`);
  if (!fs.existsSync(file)) {
    console.log(`Template not found: ${file}`);
    console.log('Run without argument to see available templates.');
    return;
  }

  let content = fs.readFileSync(file, 'utf8');
  const stats = getStats();

  // Auto-fill stats placeholders
  content = content.replace(/\[CONTRACTS_COUNT\]/g, stats.contracts);
  content = content.replace(/\[PAGES_COUNT\]/g, stats.frontendPages);
  content = content.replace(/\[COMMITS_COUNT\]/g, stats.commits);
  content = content.replace(/\[SOLIDITY_LOC\]/g, stats.solidityLOC);
  content = content.replace(/\[FRONTEND_LOC\]/g, stats.frontendLOC);
  content = content.replace(/\[GITHUB_URL\]/g, stats.github);
  content = content.replace(/\[WEBSITE_URL\]/g, stats.website);
  content = content.replace(/\[TELEGRAM_URL\]/g, stats.telegram);
  content = content.replace(/\[DATE\]/g, new Date().toISOString().split('T')[0]);

  const outFile = path.join(OUTPUT, `grant-${template}-${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(outFile, content);
  console.log(`\nGrant application generated: ${outFile}`);
  console.log(`\nSearch for [CUSTOMIZE] to find fields that need manual input.\n`);
}

function cmdTweet(category) {
  if (!category) {
    console.log('\nAvailable tweet categories:');
    if (fs.existsSync(TWEETS)) {
      fs.readdirSync(TWEETS).filter(f => fs.statSync(path.join(TWEETS, f)).isDirectory()).forEach(d => {
        const count = fs.readdirSync(path.join(TWEETS, d)).filter(f => f.endsWith('.md')).length;
        console.log(`  - ${d} (${count} tweets)`);
      });
    }
    console.log('\nUsage: node scripts/bd-toolkit.js tweet <category>');
    console.log('       node scripts/bd-toolkit.js tweet random');
    return;
  }

  let files;
  if (category === 'random') {
    // Pick from all categories
    files = [];
    if (fs.existsSync(TWEETS)) {
      fs.readdirSync(TWEETS).filter(f => {
        const fp = path.join(TWEETS, f);
        return fs.statSync(fp).isDirectory();
      }).forEach(d => {
        fs.readdirSync(path.join(TWEETS, d)).filter(f => f.endsWith('.md')).forEach(f => {
          files.push(path.join(TWEETS, d, f));
        });
      });
    }
  } else {
    const dir = path.join(TWEETS, category);
    if (!fs.existsSync(dir)) {
      console.log(`Category not found: ${category}`);
      return;
    }
    files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f));
  }

  if (files.length === 0) {
    console.log('No tweets found.');
    return;
  }

  const pick = files[Math.floor(Math.random() * files.length)];
  const content = fs.readFileSync(pick, 'utf8');
  const relPath = path.relative(ROOT, pick);

  console.log(`\n=== Tweet from ${relPath} ===\n`);
  console.log(content);
  console.log('\n=== Ready to post ===\n');
}

function cmdReddit(post) {
  if (!post) {
    console.log('\nAvailable Reddit posts:');
    if (fs.existsSync(REDDIT)) {
      fs.readdirSync(REDDIT).filter(f => f.endsWith('.md')).forEach(f => {
        console.log(`  - ${f.replace('.md', '')}`);
      });
    }
    console.log('\nUsage: node scripts/bd-toolkit.js reddit <post-name>');
    return;
  }

  const file = path.join(REDDIT, `${post}.md`);
  if (!fs.existsSync(file)) {
    console.log(`Post not found: ${file}`);
    return;
  }

  const content = fs.readFileSync(file, 'utf8');
  console.log(`\n=== Reddit Post: ${post} ===\n`);
  console.log(content);
  console.log('\n=== Copy and post to Reddit ===\n');
}

function cmdOutreach(target) {
  const stats = getStats();
  const templates = {
    layerzero: {
      subject: 'VibeSwap — Omnichain DEX using LayerZero V2 OApp',
      body: `Hi team,

I'm Will Glynn, builder of VibeSwap — an omnichain DEX that eliminates MEV through commit-reveal batch auctions.

We're using LayerZero V2's OApp protocol for cross-chain swaps and messaging. Our CrossChainRouter is live and we're looking to deepen the integration.

Quick stats:
- ${stats.contracts} smart contracts, ${stats.frontendPages} frontend pages
- Live on Base mainnet
- Zero VC funding, fair launch
- Full test suite (unit, fuzz, invariant)

We'd love to explore:
1. Ecosystem grant for omnichain DEX development
2. Co-marketing for our cross-chain features
3. Technical collaboration on novel OApp patterns

GitHub: ${stats.github}
Live demo: ${stats.website}

Would love to connect. Best, Will`
    },
    base: {
      subject: 'VibeSwap — MEV-Free DEX Live on Base',
      body: `Hi Base team,

I'm Will Glynn, builder of VibeSwap — the first fair-launch DEX on Base that structurally eliminates MEV.

We're live on Base mainnet with:
- ${stats.contracts} smart contracts
- ${stats.frontendPages}-page React frontend
- Commit-reveal batch auctions (no front-running possible)
- Shapley value reward distribution
- Zero VC, zero pre-mine

We believe VibeSwap brings unique value to the Base ecosystem by making DeFi genuinely fair for retail users.

Looking to explore:
1. Base ecosystem grant
2. Feature in Base ecosystem directory
3. Co-marketing / launch support

GitHub: ${stats.github}
Live: ${stats.website}

Best, Will`
    },
    nervos: {
      subject: 'VibeSwap CKB Integration — UTXO-Based DEX',
      body: `Hi Nervos team,

I'm Will Glynn, building VibeSwap — an omnichain DEX with commit-reveal batch auctions. We're actively building a CKB integration using Rust.

Our CKB work includes:
- Rust SDK for VibeSwap on CKB
- UTXO-based order matching
- Cell-native commit-reveal mechanism

The UTXO model is actually ideal for our batch auction design — each order is a discrete cell, settlement is atomic.

Looking to explore:
1. CKB ecosystem grant
2. Technical mentorship on cell model optimization
3. Co-promotion to bring DeFi users to CKB

GitHub: ${stats.github}

Best, Will`
    },
    elizaos: {
      subject: 'JARVIS x ElizaOS — AI Agent Collaboration',
      body: `Hey Shaw,

Will Glynn here — builder of VibeSwap. Tim Cotten mentioned you two have been talking.

JARVIS is our Claude-powered AI co-founder that runs our Telegram community autonomously. We've built:
- Autonomous community management (moderation, digests, contribution tracking)
- Session chain (hash-linked cognitive state persistence)
- Rosetta Protocol (universal agent translation)
- CRPC integration (Tim's work)

I think there's a natural collaboration between ElizaOS and JARVIS — especially around agent-to-agent communication standards and DeFi-native agent economies.

Would love to jam on this. Our agent architecture: ${stats.github}/tree/master/jarvis-bot

Best, Will`
    },
    generic: {
      subject: 'VibeSwap — [CUSTOMIZE: specific angle]',
      body: `Hi [NAME],

I'm Will Glynn, builder of VibeSwap — an omnichain DEX that eliminates MEV through commit-reveal batch auctions with uniform clearing prices.

[CUSTOMIZE: Why this matters to them specifically]

Quick stats:
- ${stats.contracts} smart contracts across ${stats.contractCategories} categories
- ${stats.frontendPages} frontend pages (React 18 + Vite)
- ${stats.commits} git commits
- Zero VC funding, fair launch, fully open source
- AI co-founder (JARVIS) runs community autonomously

[CUSTOMIZE: Specific ask — grant, partnership, feature, collaboration]

GitHub: ${stats.github}
Live demo: ${stats.website}
Telegram: ${stats.telegram}

Best, Will`
    },
  };

  if (!target || !templates[target]) {
    console.log('\nAvailable outreach templates:');
    Object.keys(templates).forEach(k => console.log(`  - ${k}`));
    console.log('\nUsage: node scripts/bd-toolkit.js outreach <target>');
    return;
  }

  const t = templates[target];
  console.log(`\n=== Outreach: ${target} ===\n`);
  console.log(`Subject: ${t.subject}\n`);
  console.log(t.body);
  console.log('\n=== Copy and send ===\n');

  // Save to file
  const outFile = path.join(OUTPUT, `outreach-${target}-${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(outFile, `# ${t.subject}\n\n${t.body}\n`);
  console.log(`Saved to ${outFile}`);
}

function cmdCalendar() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek + 1); // Monday

  console.log('\n=== This Week\'s Content Calendar ===\n');

  const schedule = [
    { day: 'Monday', tasks: ['Post 1 engagement tweet', 'Share 1 hook thread', 'Check Reddit for relevant discussions'] },
    { day: 'Tuesday', tasks: ['Post 1 feature spotlight tweet', 'Reply to 3 crypto Twitter threads', 'Post to r/defi or r/ethereum'] },
    { day: 'Wednesday', tasks: ['Post 1 philosophy tweet', 'Share build update in Telegram', 'Engage with 5 community messages'] },
    { day: 'Thursday', tasks: ['Post 1 narrative tweet', 'Post 1 stats-flex tweet', 'Check grant deadlines'] },
    { day: 'Friday', tasks: ['Post 1 mission-driven tweet', 'Weekly digest in Telegram', 'Post to r/CryptoCurrency'] },
    { day: 'Saturday', tasks: ['Post 1 hook thread (longer form)', 'Community AMA or discussion'] },
    { day: 'Sunday', tasks: ['Plan next week\'s content', 'Review analytics', 'Queue tweets for the week'] },
  ];

  schedule.forEach((day, i) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    const isToday = date.toDateString() === today.toDateString();
    const marker = isToday ? ' <-- TODAY' : '';
    console.log(`${day.day} (${date.toISOString().split('T')[0]})${marker}`);
    day.tasks.forEach(t => console.log(`  [ ] ${t}`));
    console.log('');
  });

  console.log('Quick commands:');
  console.log('  node scripts/bd-toolkit.js tweet random     — Pick a random tweet');
  console.log('  node scripts/bd-toolkit.js tweet engagement — Pick an engagement tweet');
  console.log('  node scripts/bd-toolkit.js reddit           — List Reddit posts');
  console.log('');
}

function cmdPitch(audience) {
  const stats = getStats();

  const pitches = {
    investor: `# VibeSwap — Investment Thesis

## One-liner
The first DEX where front-running is structurally impossible, not just discouraged.

## Problem ($1.4B+)
MEV (Maximal Extractable Value) costs DeFi users billions annually. Every swap on Uniswap, SushiSwap, or any continuous-trading DEX is vulnerable to front-running and sandwich attacks.

## Solution
10-second commit-reveal batch auctions with uniform clearing prices. Orders are encrypted during submission, shuffled cryptographically at settlement, and all execute at the same price. MEV is eliminated by design, not by policy.

## Traction
- ${stats.contracts} smart contracts deployed
- ${stats.frontendPages} frontend pages (full application)
- Live on Base mainnet
- ${stats.commits} git commits
- AI co-founder (JARVIS) manages community autonomously
- Full test suite: unit, fuzz, invariant, adversarial

## Differentiation
- Zero VC funding (fair launch)
- Zero pre-mine, zero team allocation
- Open source everything
- AI-native from day one
- Cross-chain via LayerZero V2
- Shapley value reward distribution (game theory, not arbitrary)

## Ask
[CUSTOMIZE: What you're looking for]

## Links
- GitHub: ${stats.github}
- Live: ${stats.website}
- Telegram: ${stats.telegram}
`,
    partner: `# VibeSwap Partnership Overview

## What We Are
An omnichain DEX that eliminates MEV through batch auctions. ${stats.contracts} contracts, ${stats.frontendPages} pages, live on Base.

## Why Partner With Us
1. **Novel mechanism** — Commit-reveal batch auctions are genuinely new. No one else does this.
2. **Full stack** — Not just contracts. Frontend, oracle, AI bot, cross-chain. Complete product.
3. **Fair launch** — No VC baggage. No token allocation politics. Clean cap table.
4. **AI-native** — JARVIS (Claude-powered) runs community, generates content, assists development.

## Partnership Models
- **Technical integration** — We integrate your protocol/chain/tool
- **Co-marketing** — Joint announcements, cross-promotion
- **Liquidity** — Mutual liquidity provision
- **Research** — Joint papers on mechanism design

## Links
- GitHub: ${stats.github}
- Live: ${stats.website}
`,
    hackathon: `# VibeSwap — Hackathon Pitch (60 seconds)

**Problem**: Every DEX lets bots steal from you. MEV = $1.4B+ extracted from retail traders.

**Solution**: VibeSwap uses 10-second batch auctions. Your order is encrypted, shuffled, and executed at one uniform price. Front-running is impossible — not just hard, impossible.

**How it works**:
1. Submit encrypted order hash (8 seconds)
2. Reveal your order (2 seconds)
3. Fisher-Yates shuffle with XORed secrets
4. Everyone gets the same clearing price

**Built with**: Solidity, Foundry, React, LayerZero V2, Claude AI

**Stats**: ${stats.contracts} contracts, ${stats.frontendPages} pages, ${stats.commits} commits, zero funding

**Demo**: ${stats.website}
**Code**: ${stats.github}
`,
  };

  if (!audience || !pitches[audience]) {
    console.log('\nAvailable pitch types:');
    Object.keys(pitches).forEach(k => console.log(`  - ${k}`));
    console.log('\nUsage: node scripts/bd-toolkit.js pitch <type>');
    return;
  }

  const content = pitches[audience];
  console.log(content);

  const outFile = path.join(OUTPUT, `pitch-${audience}-${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(outFile, content);
  console.log(`\nSaved to ${outFile}`);
}

// ============ Today: 1-Click Daily Package ============

function cmdToday() {
  const today = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[today.getDay()];
  const dateStr = today.toISOString().split('T')[0];

  console.log(`\n=== VibeSwap Daily Package — ${dayName} ${dateStr} ===\n`);

  // Show today's calendar tasks
  const dailyTasks = {
    Monday: ['Post 1 engagement tweet', 'Share 1 hook thread', 'Check Reddit for relevant discussions'],
    Tuesday: ['Post 1 feature spotlight tweet', 'Reply to 3 crypto Twitter threads', 'Post to r/defi or r/ethereum'],
    Wednesday: ['Post 1 philosophy tweet', 'Share build update in Telegram', 'Engage with 5 community messages'],
    Thursday: ['Post 1 narrative tweet', 'Post 1 stats-flex tweet', 'Check grant deadlines'],
    Friday: ['Post 1 mission-driven tweet', 'Weekly digest in Telegram', 'Post to r/CryptoCurrency'],
    Saturday: ['Post 1 hook thread (longer form)', 'Community AMA or discussion'],
    Sunday: ["Plan next week's content", 'Review analytics', 'Queue tweets for the week'],
  };

  console.log('TODAY\'S TASKS:');
  (dailyTasks[dayName] || []).forEach(t => console.log(`  [ ] ${t}`));
  console.log('');

  // Pick today's tweet
  const tweetCats = {
    Monday: 'engagement', Tuesday: 'hook-threads', Wednesday: 'philosophy',
    Thursday: 'narrative', Friday: 'mission', Saturday: 'hook-threads', Sunday: null,
  };
  const todayCat = tweetCats[dayName];
  if (todayCat) {
    const catDir = path.join(TWEETS, todayCat);
    let tweetFiles = [];
    if (fs.existsSync(catDir)) {
      tweetFiles = fs.readdirSync(catDir).filter(f => f.endsWith('.md'));
    }
    // Fallback to random from all categories
    if (tweetFiles.length === 0) {
      if (fs.existsSync(TWEETS)) {
        fs.readdirSync(TWEETS).filter(f => {
          const fp = path.join(TWEETS, f);
          try { return fs.statSync(fp).isDirectory(); } catch { return false; }
        }).forEach(d => {
          fs.readdirSync(path.join(TWEETS, d)).filter(f => f.endsWith('.md')).forEach(f => {
            tweetFiles.push(path.join(d, f));
          });
        });
      }
      if (tweetFiles.length > 0) {
        const pick = tweetFiles[Math.floor(Math.random() * tweetFiles.length)];
        const full = pick.includes('/') ? path.join(TWEETS, pick) : path.join(catDir, pick);
        if (fs.existsSync(full)) {
          console.log('TODAY\'S TWEET:');
          console.log('─'.repeat(50));
          console.log(fs.readFileSync(full, 'utf8').trim());
          console.log('─'.repeat(50));
          console.log('');
        }
      }
    } else {
      const pick = tweetFiles[Math.floor(Math.random() * tweetFiles.length)];
      const full = path.join(catDir, pick);
      console.log(`TODAY'S TWEET (${todayCat}/${pick}):`);
      console.log('─'.repeat(50));
      console.log(fs.readFileSync(full, 'utf8').trim());
      console.log('─'.repeat(50));
      console.log('');
    }
  }

  // Pick a Reddit post if it's a posting day
  if (['Tuesday', 'Friday'].includes(dayName) && fs.existsSync(REDDIT)) {
    const posts = fs.readdirSync(REDDIT).filter(f => f.endsWith('.md'));
    if (posts.length > 0) {
      const pick = posts[Math.floor(Math.random() * posts.length)];
      console.log(`TODAY'S REDDIT POST (${pick}):`);
      console.log('─'.repeat(50));
      const content = fs.readFileSync(path.join(REDDIT, pick), 'utf8');
      // Just show the title and first few lines
      const lines = content.split('\n').filter(Boolean);
      console.log(lines.slice(0, 5).join('\n'));
      console.log('  ... (run `node scripts/bd-toolkit.js reddit ' + pick.replace('.md', '') + '` for full post)');
      console.log('─'.repeat(50));
      console.log('');
    }
  }

  // Grant status check on Thursdays
  if (dayName === 'Thursday') {
    console.log('GRANT CHECK:');
    cmdGrantStatus();
  }

  // Quick stats
  const stats = getStats();
  console.log('CURRENT STATS:');
  console.log(`  ${stats.contracts} contracts | ${stats.frontendPages} pages | ${stats.commits} commits | ${stats.tweetDrafts} tweets ready`);
  console.log('');
  console.log('QUICK ACTIONS:');
  console.log('  node scripts/bd-toolkit.js tweet random     — Different tweet');
  console.log('  node scripts/bd-toolkit.js reddit           — Browse Reddit posts');
  console.log('  node scripts/bd-toolkit.js outreach         — Send outreach');
  console.log('  node scripts/bd-toolkit.js grant-status     — Check grants');
  console.log('');
}

// ============ Grant Status: At-a-Glance Tracker ============

function cmdGrantStatus() {
  const trackerPath = path.join(GRANTS, 'TRACKER.md');
  if (!fs.existsSync(trackerPath)) {
    console.log('  No TRACKER.md found.');
    return;
  }

  const content = fs.readFileSync(trackerPath, 'utf8');
  const lines = content.split('\n');

  // Parse the table
  const tableLines = lines.filter(l => l.startsWith('|') && !l.startsWith('|--') && !l.startsWith('| Program'));

  console.log('\n  GRANT TRACKER:');
  let draftReady = 0, submitted = 0, pending = 0, watching = 0;

  tableLines.forEach(line => {
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length >= 2) {
      const [program, status, , amount] = cols;
      const icon = status === 'Draft ready' ? '📝' : status === 'Submitted' ? '✅' : status === 'Pending' ? '⏳' : status === 'Watching' ? '👀' : '❓';
      console.log(`  ${icon} ${program} — ${status}${amount ? ` (${amount})` : ''}`);
      if (status === 'Draft ready') draftReady++;
      if (status === 'Submitted') submitted++;
      if (status === 'Pending') pending++;
      if (status === 'Watching') watching++;
    }
  });

  console.log('');
  console.log(`  Summary: ${draftReady} ready to submit | ${submitted} submitted | ${pending} pending | ${watching} watching`);
  console.log('  Generate: node scripts/bd-toolkit.js all-grants');
  console.log('');
}

// ============ Social Blast: All Content at Once ============

function cmdSocialBlast() {
  const stats = getStats();
  const dateStr = new Date().toISOString().split('T')[0];

  console.log('\n=== VibeSwap Social Blast — All Content Generated ===\n');

  // Generate 3 tweets (different categories)
  const categories = [];
  if (fs.existsSync(TWEETS)) {
    fs.readdirSync(TWEETS).filter(f => {
      const fp = path.join(TWEETS, f);
      try { return fs.statSync(fp).isDirectory(); } catch { return false; }
    }).forEach(d => categories.push(d));
  }

  const picked = [];
  const usedCats = new Set();
  for (let i = 0; i < 3 && categories.length > 0; i++) {
    // Pick a category we haven't used
    const available = categories.filter(c => !usedCats.has(c));
    if (available.length === 0) break;
    const cat = available[Math.floor(Math.random() * available.length)];
    usedCats.add(cat);
    const files = fs.readdirSync(path.join(TWEETS, cat)).filter(f => f.endsWith('.md'));
    if (files.length > 0) {
      const file = files[Math.floor(Math.random() * files.length)];
      picked.push({ cat, file, content: fs.readFileSync(path.join(TWEETS, cat, file), 'utf8').trim() });
    }
  }

  if (picked.length > 0) {
    console.log('TWEETS (pick 1-3 to post today):');
    picked.forEach((t, i) => {
      console.log(`\n  [${i + 1}] ${t.cat}/${t.file}`);
      console.log('  ' + '─'.repeat(45));
      t.content.split('\n').forEach(l => console.log('  ' + l));
      console.log('  ' + '─'.repeat(45));
    });
    console.log('');
  }

  // Pick a Reddit post
  if (fs.existsSync(REDDIT)) {
    const posts = fs.readdirSync(REDDIT).filter(f => f.endsWith('.md'));
    if (posts.length > 0) {
      const pick = posts[Math.floor(Math.random() * posts.length)];
      console.log(`REDDIT POST: ${pick}`);
      const content = fs.readFileSync(path.join(REDDIT, pick), 'utf8');
      const lines = content.split('\n').filter(Boolean);
      console.log('  ' + lines[0]); // Title
      console.log(`  (run: node scripts/bd-toolkit.js reddit ${pick.replace('.md', '')})`);
      console.log('');
    }
  }

  // Telegram digest snippet
  console.log('TELEGRAM UPDATE:');
  console.log('  ' + '─'.repeat(45));
  console.log(`  VibeSwap build update — ${dateStr}`);
  console.log(`  ${stats.contracts} contracts | ${stats.frontendPages} pages | ${stats.commits} commits`);
  console.log(`  Zero VC. Zero pre-mine. All open source.`);
  console.log(`  ${stats.website}`);
  console.log('  ' + '─'.repeat(45));
  console.log('');

  // Save the package
  let packageContent = `# Social Blast Package — ${dateStr}\n\n`;
  packageContent += `## Tweets\n`;
  picked.forEach((t, i) => {
    packageContent += `\n### Tweet ${i + 1} (${t.cat})\n\n${t.content}\n`;
  });
  packageContent += `\n## Telegram Update\n\nVibeSwap build update — ${dateStr}\n${stats.contracts} contracts | ${stats.frontendPages} pages | ${stats.commits} commits\nZero VC. Zero pre-mine. All open source.\n${stats.website}\n`;

  const outFile = path.join(OUTPUT, `social-blast-${dateStr}.md`);
  fs.writeFileSync(outFile, packageContent);
  console.log(`Package saved to ${outFile}`);
  console.log('');
}

// ============ Main ============

const [,, command, ...args] = process.argv;

switch (command) {
  case 'stats': cmdStats(); break;
  case 'grant': cmdGrant(args[0]); break;
  case 'tweet': cmdTweet(args[0]); break;
  case 'reddit': cmdReddit(args[0]); break;
  case 'outreach': cmdOutreach(args[0]); break;
  case 'calendar': cmdCalendar(); break;
  case 'pitch': cmdPitch(args[0]); break;
  case 'today': cmdToday(); break;
  case 'grant-status': cmdGrantStatus(); break;
  case 'social-blast': cmdSocialBlast(); break;
  case 'all-grants':
    if (fs.existsSync(GRANTS)) {
      fs.readdirSync(GRANTS).filter(f => f.endsWith('.md') && f !== 'TRACKER.md').forEach(f => {
        cmdGrant(f.replace('.md', ''));
      });
    }
    break;
  default:
    console.log(`
VibeSwap BD Toolkit — 1-Click Business Development

Commands:
  today                — YOUR DAILY PACKAGE: tasks + tweet + reddit + stats (START HERE)
  social-blast         — Generate ALL social content at once (tweets + reddit + telegram)
  stats                — Pull live project stats (auto-counted)
  grant <template>     — Generate grant application with live stats
  grant-status         — At-a-glance view of all grant applications
  pitch <audience>     — Generate tailored pitch (investor/partner/hackathon)
  tweet <category>     — Pick a tweet to post (or 'random')
  reddit <post>        — Format a Reddit post for copy-paste
  outreach <target>    — Generate outreach email (layerzero/base/nervos/elizaos/generic)
  calendar             — Show this week's content calendar
  all-grants           — Generate ALL grant applications at once

Lazy Mode (start here):
  node scripts/bd-toolkit.js today          — What do I do today?
  node scripts/bd-toolkit.js social-blast   — Give me everything to post

Examples:
  node scripts/bd-toolkit.js grant ethereum-foundation-grant
  node scripts/bd-toolkit.js pitch hackathon
  node scripts/bd-toolkit.js tweet random
  node scripts/bd-toolkit.js outreach base
`);
}
