# VibeSwap Autonomous Partnership Framework

**W. Glynn, JARVIS**
**March 2026 | VibeSwap**

---

## Executive Summary

VibeSwap uses an autonomous partnership pipeline — codename **Karma** — that continuously discovers, evaluates, contacts, and tracks potential protocol partners. The system runs with minimal human intervention, surfacing only high-quality opportunities for final approval.

Karma replaces the traditional BD model (one person cold-emailing) with a structured, repeatable, autonomous workflow that any team member can operate and any AI agent can execute.

---

## 1. The Karma Loop

```
┌─────────────┐    ┌──────────────┐    ┌───────────┐
│  DISCOVERY   │───►│  EVALUATION  │───►│  OUTREACH  │
│  (automated) │    │  (scored)    │    │  (templated│
└─────────────┘    └──────────────┘    │  + custom) │
                                       └─────┬─────┘
                                             │
┌─────────────┐    ┌──────────────┐    ┌─────▼─────┐
│  REPORTING   │◄───│  EXECUTION   │◄───│  TRACKING  │
│  (dashboard) │    │  (on-chain)  │    │  (CRM)     │
└─────────────┘    └──────────────┘    └───────────┘
```

The loop runs continuously. Each stage feeds the next. No stage requires synchronous human decision-making except final deal approval.

---

## 2. Stage 1: Discovery

### 2.1 Sources

| Source | Signal | Scan Frequency |
|--------|--------|---------------|
| Twitter/X | Projects tweeting about MEV, batch auctions, fair launch | Daily |
| GitHub | Repos with MEV protection, DEX, cross-chain keywords | Weekly |
| DeFi Llama | New protocols with >$1M TVL in target categories | Daily |
| Ethereum Research Forum | Posts about auction mechanisms, MEV mitigation | Weekly |
| Nervos/CKB Forums | Projects building on CKB cell model | Weekly |
| LayerZero Ecosystem | Projects using LZ V2 for cross-chain | Weekly |

### 2.2 Discovery Criteria

A project enters the pipeline if it matches ANY of:

- Building MEV protection or fair ordering
- Building batch auction infrastructure
- Building AI agent infrastructure
- Building cross-chain DEX or bridge infrastructure
- Active on a chain VibeSwap deploys on (Base, Arbitrum, Optimism, CKB)
- Has expressed interest in Cooperative Capitalism or similar economic models

### 2.3 Implementation

Phase 1 (manual + templates):
- Weekly 30-minute discovery session using Twitter search, DeFi Llama, and GitHub
- Log prospects in a shared spreadsheet or Notion database

Phase 2 (semi-automated):
- Scrapling-based web scraper monitors sources automatically
- Generates discovery report delivered to Telegram/Discord
- Human reviews and approves entries into pipeline

Phase 3 (fully autonomous):
- JARVIS runs discovery autonomously using web search + API tools
- Auto-populates CRM with scored prospects
- Human only reviews final outreach drafts

---

## 3. Stage 2: Evaluation

### 3.1 Scoring Matrix

Each prospect is scored 0-100 across five dimensions:

| Dimension | Weight | Scoring Criteria |
|-----------|--------|-----------------|
| **Live Product** | 25% | Mainnet deployment (25), Testnet (15), Whitepaper only (5), Nothing (0) |
| **Team Credibility** | 20% | Known builders (20), Anon but active (12), Anon no history (5) |
| **Technical Overlap** | 25% | Direct integration path (25), Shared dependencies (15), Thematic only (5) |
| **Community Size** | 15% | >10K followers (15), 1-10K (10), <1K (5) |
| **Alignment** | 15% | Explicitly anti-MEV/pro-fairness (15), Neutral (8), VC-captured (0) |

### 3.2 Tier Classification

| Score | Tier | Action |
|-------|------|--------|
| 80-100 | A | Immediate outreach, founder-to-founder |
| 60-79 | B | Standard outreach via email template |
| 40-59 | C | Monitor, outreach when milestone triggers |
| 0-39 | D | Archive, revisit quarterly |

### 3.3 Auto-Disqualification

Prospects are auto-rejected if:
- Known scam or rug pull history
- Explicit VC lockup with >25% insider allocation
- No public code or product after 12+ months
- Adversarial relationship with communities we serve

---

## 4. Stage 3: Outreach

### 4.1 Email Template Structure

```
Subject: [Project Name] × VibeSwap — [specific integration idea]

Hi [Name],

[1 sentence: what they're building and why we noticed]

[1 sentence: what VibeSwap does and the specific synergy]

[1 sentence: concrete proposal — integration, co-marketing, shared research]

[1 sentence: next step — "15 min call this week?"]

— Will Glynn, VibeSwap
```

### 4.2 Personalization Rules

- Reference a specific tweet, commit, or blog post from the prospect
- Propose a concrete integration (not vague "let's collaborate")
- Include a link to the most relevant VibeSwap paper or demo
- Keep it under 150 words

### 4.3 Follow-Up Cadence

| Day | Action |
|-----|--------|
| 0 | Initial email |
| 3 | Twitter DM (if no response) |
| 7 | Follow-up email with new angle |
| 14 | Final follow-up, then archive to Tier C |

---

## 5. Stage 4: Tracking (CRM Pipeline)

### 5.1 Pipeline Stages

```
Discovered → Evaluated → Contacted → Responded → Meeting Scheduled →
Deal Terms → Executed → Active Partnership → Review
```

### 5.2 Required Fields

| Field | Type | Required |
|-------|------|---------|
| Project name | Text | Yes |
| Contact name + email | Text | Yes |
| Score (0-100) | Number | Yes |
| Tier (A/B/C/D) | Enum | Yes |
| Stage | Enum | Yes |
| Last contact date | Date | Yes |
| Next action | Text | Yes |
| Integration type | Enum | Yes |
| Notes | Text | Optional |

### 5.3 Integration Types

- **Technical Integration**: Shared smart contracts, cross-protocol calls
- **Liquidity Partnership**: Shared pools, cross-listed assets
- **Research Collaboration**: Co-authored papers, shared mechanism design
- **Co-Marketing**: Joint announcements, shared content, cross-promotion
- **Ecosystem Grant**: Funding from partner ecosystem for VibeSwap deployment

---

## 6. Stage 5: Execution

### 6.1 On-Chain Partnership Contracts

For technical and liquidity partnerships, terms are encoded in smart contracts:

```solidity
struct Partnership {
    address partner;
    uint256 revenueShareBps;    // Partner's share in basis points
    uint256 startBlock;
    uint256 endBlock;           // 0 = indefinite
    bytes32 integrationHash;    // Hash of integration spec
    bool active;
}
```

### 6.2 Milestone Structure

Each partnership has 3 milestones:

1. **Integration Complete**: Smart contracts deployed, interoperability verified
2. **Volume Threshold**: $X monthly volume flowing through partnership
3. **Community Adoption**: Y unique users from partner community

Revenue sharing activates at Milestone 1. Bonus allocation at Milestones 2 and 3.

### 6.3 Revenue Sharing

Default: 50/50 split on cross-protocol fees generated by the partnership.

Partner-originated swaps (referred by partner UI or contracts) generate fees that are split:
- 50% to VibeSwap Shapley pool
- 50% to partner treasury

This aligns incentives: both sides benefit from driving volume through the integration.

---

## 7. Stage 6: Reporting

### 7.1 Dashboard Metrics

| Metric | Update Frequency |
|--------|-----------------|
| Total prospects in pipeline | Real-time |
| Prospects by stage | Real-time |
| Outreach response rate | Weekly |
| Active partnerships | Real-time |
| Partnership revenue (30d) | Daily |
| Integration uptime | Real-time |
| Partner-referred volume | Daily |

### 7.2 Weekly Report

Generated automatically every Monday:

```
=== Karma Weekly Partnership Report ===

New Prospects: X discovered, Y evaluated
Pipeline: A contacted, B responded, C meetings
Active Partnerships: N (generating $X/month)
Top Prospect: [Name] — [Score] — [Status]
Action Items: [auto-generated from pipeline]
```

---

## 8. Karma for JARVIS

JARVIS can execute the Karma loop autonomously:

1. **Discovery**: Use web search tools to find prospects matching criteria
2. **Evaluation**: Score using the matrix, classify into tiers
3. **Outreach**: Draft personalized emails for human approval
4. **Tracking**: Update CRM entries after each interaction
5. **Reporting**: Generate weekly reports and surface action items

Human involvement: Review outreach drafts, attend meetings, approve deal terms. Everything else is autonomous.

---

*Partnerships should be autonomous. We don't chase — we attract through technical credibility and execute through structured process.*
