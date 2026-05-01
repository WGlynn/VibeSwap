# Everybody Is a Dev in VibeSwap

### How Your Telegram Conversations Earn VIBE Rewards

---

## The Short Version

Talk to Jarvis in the VibeSwap Telegram. Share insights, ask questions, discuss ideas. When your conversation contains something useful for the protocol, Jarvis automatically detects it, creates a GitHub contribution in your name, and credits you for VIBE rewards.

**You don't need to write code. You don't need to know what GitHub is. Your insights ARE the contributions.**

---

## How It Works (Step by Step)

### Step 1: Chat Normally

Just talk in the VibeSwap Telegram group. Ask Jarvis questions. Share opinions. Discuss crypto, DeFi, markets, governance, fairness — anything.

Example from our community:

> **Catto**: How come EV car sales went up when oil prices are skyrocketing? Our electricity also runs on oil.
>
> **Jarvis**: Because people are bad at math and good at headlines...
>
> **Will**: That insight about price manipulation is the truth. That's what we're trying to solve with our oracles and batch orders.

Catto didn't write a single line of code. But her observation about price manipulation maps directly to VibeSwap's oracle design and batch auction mechanism. That's a contribution.

### Step 2: Jarvis Detects the Insight

When your conversation touches protocol-relevant topics — pricing, fairness, governance, user experience, security, incentives — Jarvis's dialogue-to-code pipeline kicks in:

1. **Detects** protocol-relevant keywords and quality
2. **Compiles** the insight into a structured format
3. **Creates a GitHub issue** with your name on it
4. **Announces** in the chat that a contribution was recorded

You'll see something like:

> This conversation just generated a protocol contribution.
>
> "Price perception validates oracle design" — credited to @Catto
>
> GitHub: github.com/WGlynn/VibeSwap/issues/XXX
>
> You don't need to write code. Your insights ARE the contributions.

### Step 3: Link Your Wallet

To receive VIBE rewards, you need to connect your Ethereum wallet to your Telegram identity. In the VibeSwap TG group or DM to Jarvis:

```
/linkwallet 0xYourEthereumAddress
```

That's it. One command. Your TG account is now linked to your wallet.

**Important**: Use a wallet YOU control (MetaMask, hardware wallet, etc.). Never share your private keys. Your keys, your tokens.

### Step 4: Rewards Are Batched Weekly

Every week, Jarvis compiles all contributions into a reward batch:

1. Collects all tracked contributions from the week
2. Filters to users with linked wallets
3. Computes fair share using **Shapley game theory** (see below)
4. Creates an on-chain reward game
5. VIBE tokens are allocated from the emission pool

### Step 5: Claim Your VIBE

Once a batch is created, you can claim your rewards. The claim is permissionless — no one can stop you from collecting what's rightfully yours.

---

## What Counts as a Contribution?

Not every message earns rewards. Here's what the system looks for:

| Type | Example | Value |
|------|---------|-------|
| **Ideas** | "What if we added a feature that..." | High |
| **Insights** | "Prices are manipulated because..." | High |
| **Governance** | "The DAO should vote on..." | High |
| **Design/UX** | "This page is confusing because..." | Medium |
| **Quality Questions** | "How does the oracle prevent manipulation?" | Medium |
| **Community Help** | Helping new members, explaining concepts | Medium |
| **General Chat** | "gm", "wagmi", emoji reactions | Low (not tracked) |

**Quality matters more than quantity.** One insightful observation is worth more than 100 "gm" messages.

---

## How Is It Fair? (Shapley Game Theory)

VibeSwap doesn't use "most tokens = most votes" or "loudest voice wins." We use **Shapley value distribution** — a Nobel Prize-winning concept from cooperative game theory.

### What Shapley Means for You:

1. **Your fair share** is calculated based on your *marginal contribution* — what would be missing if you weren't there
2. **Nobody gets zero** — the Lawson Fairness Floor guarantees 1% minimum for anyone who contributed honestly
3. **Quality beats quantity** — a single brilliant insight can outweigh weeks of low-effort messages
4. **Time is valued** — being an early, consistent community member earns a stability bonus
5. **Rare contributions are scarce** — governance and code contributions are weighted higher than general chat

### The Four Weights:

| Weight | What It Measures | Share |
|--------|-----------------|-------|
| **Direct Contribution** | Quality x quantity of your insights | 40% |
| **Time in Pool** | How long you've been active (log scale) | 30% |
| **Scarcity** | Rare contribution types score higher | 20% |
| **Stability** | Consistent weekly participation | 10% |

### Anti-Gaming Protection:

- Spam gets filtered before tracking (antispam system)
- Quality scoring prevents low-effort farming
- Rate limits: max 3 insights detected per hour per chat
- Cooldown: 30 minutes between insights from same user
- Clawback mechanism: if gaming is detected after distribution, rewards can be recovered

---

## The VIBE Reward Pool

There's currently ~1,000,000 VIBE accumulated in the emission pool waiting to be distributed. Every week, a portion (10-50%) is drained into a Shapley game for community contributors.

### Where VIBE Comes From:

- **EmissionController** mints VIBE on a halving schedule (like Bitcoin)
- 50% goes to the Shapley pool (community contributions)
- 35% goes to liquidity providers
- 15% goes to stakers

### Halving:

Like Bitcoin, VIBE emission halves over time. Early contributors earn more. Being here now is worth more than being here later.

---

## Quick Start Checklist

- [ ] Join the VibeSwap Telegram: https://t.me/+3uHbNxyZH-tiOGY8
- [ ] Chat with Jarvis — share insights, ask questions, discuss ideas
- [ ] Link your wallet: `/linkwallet 0xYourAddress`
- [ ] Wait for weekly batch (or check status: `/mystatus`)
- [ ] Claim rewards when batch is created

---

## Commands

| Command | What It Does |
|---------|-------------|
| `/linkwallet 0x...` | Connect your Ethereum wallet |
| `/mystatus` | Check your contribution stats and reward eligibility |
| `/contributions` | See recent dialogue-to-code insights |
| `/leaderboard` | See top contributors |

---

## FAQ

**Q: Do I need to know how to code?**
No. That's the whole point. Your conversations, insights, and questions are the contributions. Jarvis turns dialogue into code autonomously.

**Q: How much VIBE can I earn?**
It depends on the quality and quantity of your contributions, how long you've been active, and how many other contributors there are. Shapley ensures your share is proportional to your marginal contribution.

**Q: Can I game the system?**
The system has multiple protections: quality scoring, spam filtering, rate limiting, and clawback mechanisms. Gaming attempts will be detected and rewards can be recovered. Don't try it — genuine participation is more valuable.

**Q: What if I contributed before linking my wallet?**
Your contributions are tracked from your first message. Linking your wallet retroactively connects all past contributions. Nothing is lost.

**Q: What if I contributed before this system existed?**
All historical contributions tracked by the system are included. If you've been chatting with Jarvis for months, that history counts.

**Q: Is this real? Like, actual tokens?**
Yes. VIBE is a real ERC-20 token on Ethereum/Base. The emission schedule is enforced by smart contracts. The Shapley distribution is computed on-chain. Your wallet receives actual tokens.

**Q: What's the Lawson Fairness Floor?**
Named after our fairness axiom: nobody who contributed honestly walks away with zero. Even if your Shapley share is tiny, you get at least 1% of the average share. This prevents the "rich get richer" dynamic.

---

## The Philosophy

> "My contribution graph is real. It's not gatekept by developers."
> — Will, VibeSwap founder

Traditional open source measures contributions by code commits. This excludes 99% of the people who actually make a project successful — the community members who test, provide feedback, share insights, onboard newcomers, and keep the conversation alive.

VibeSwap's dialogue-to-code pipeline recognizes that **every useful conversation is a contribution**. The protocol's oracle design was validated by a community member asking about EV car prices. The batch auction mechanism was informed by users discussing price manipulation. The governance system evolved through Telegram debates.

These aren't second-class contributions. They're the foundation everything else is built on. And now they're tracked, attributed, and rewarded.

**Everybody is a dev in VibeSwap.**

---

*VibeSwap Protocol — March 2026*
*"The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge."*
