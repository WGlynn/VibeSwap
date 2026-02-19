# IT Token Vision (Freedomwarrior13)

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

Source: Freedomwarrior13's refined IT design doc, saved Session 18 (Feb 17, 2026)

---

## Core Thesis

IT is NOT a contract, NOT an ERC-20, NOT just governance. IT is the **atomic unit of the chain** — a native protocol object representing a living idea with capital, execution competition, conviction governance, memory, and long-term growth.

Every IT evolves over time, accumulating work, contributors, and impact.

---

## Five Inseparable Components of an IT

### 1. Identity
- Creator, timestamp, canonical content hash
- Version history (edits, refinements, forks)
- Makes ideas addressable, referenceable, composable

### 2. Treasury
- Reward tokens deposited directly into the IT
- Treasury funds execution ONLY
- Funds exit exclusively through protocol-level streams
- No withdrawals. No arbitrary spending.

### 3. IT Supply (Governance Power)
- Minted 1:1 when funding enters treasury
- Transferable and liquid
- Holding IT = governance over who builds (authority over execution, NOT ownership of funds)

### 4. Conviction Execution Market
- Executors attach to an IT
- Multiple executors compete simultaneously
- IT holders lock conviction toward executors
- Conviction grows with time
- Stream share proportional to conviction
- Inactivity triggers decay after fixed window (e.g., 14 days)
- Conviction can be redirected at any time
- Execution is continuous, competitive, and replaceable

### 5. Memory
- Permanent record per IT:
  - Milestones + evidence
  - Artifacts (code, designs, docs, demos)
  - Contributor graph
  - AI summaries and evaluations (as attestations)
  - Disputes and resolutions
- ITs GROW instead of resetting every funding round
- Can fork, reference other ITs, be reused/extended
- Gain credibility and gravity over time

**VibeCode = the aggregate history and quality of ITs you're associated with**

---

## Why IT Must Be Its Own Chain (Option C)

System breaks if ITs are implemented as contracts. Needs:
- Native time semantics (conviction growth, decay, stalls)
- Native streaming (no per-block hacks)
- Native object storage (not account balances)
- Native attestations + disputes
- Native identity and reputation hooks
- Native AI integration (without touching consensus)

Chain optimizes for:
- Idea evolution
- Execution markets
- Conviction accounting
- Long-term memory
- Impact attribution

Smart contracts become EXTENSIONS, not the core.

---

## AI Integration

AI does NOT decide truth. AI produces **attestations**:
- "Executor likely stalled"
- "Milestone plausibly completed"
- "This IT duplicates 80% of an existing one"

AI is baked in but never sovereign.

---

## Revenue Distribution

Recipients:
- Original creator (ongoing, not upfront)
- Milestone contributors
- Successful executors
- Long-term IT governors (curators)

Makes ideas productive assets, not lottery tickets.

---

## Milestones

- Executors submit milestone evidence
- AI + humans generate attestations
- If uncontested -> accepted after a window
- If contested -> dispute resolution
- Acceptance refreshes execution streams
- Non-acceptance triggers decay
- No committee. No centralized approval.

---

## Security & Incentive Posture (Non-Negotiable)

System must assume:
- Bribery attempts
- Fake progress
- Sybil executors
- Colluding attesters
- Governance capture

Defenses:
- Staking exists everywhere
- Identity and reputation compound slowly
- Disputes cheap to trigger, costly to lose
- Conviction is time-weighted, not instant
- Power from sustained participation, not flash capital

---

## One-Sentence Definition

> IT is a protocol-native idea that holds capital, governs execution through conviction, accumulates memory, and rewards contributors based on realized impact over time.

---

## Consensus: Proof of Mind IS IT (confirmed by Will)

POM and IT are not separate systems. The IT primitive IS the consensus mechanism. Creating, funding, executing, attesting on ITs — that activity IS your proof of mind. Consensus emerges from the IT graph itself, not from a separate layer bolted on top.

NOT PoW (value doesn't come from computation), NOT PoS (value doesn't come from flash capital). Consensus weight = your accumulated IT activity — time-weighted, contribution-derived, impossible to buy or mine.

## Open Design Questions (from Freedomwarrior13)
- Formalize IT as a state machine (exact transitions)
- Define minimum viable chain spec
- Design first genesis rules
- Stress-test against adversarial behavior

---

## Delta from Current VibeSwap Implementation

Current CYT contract (Session 18) implements a simplified version:
- IT minted 1:1 with funding (matches component 3)
- Execution streams with stale decay (partial component 4)
- Milestones + evidence (partial component 5)
- **Conviction stripped for VibeSwap** — correct move for an EVM DEX, free market execution is simpler and sufficient
- **MISSING (intentionally, for now)**: conviction voting, native chain, AI attestations, full memory/artifact system, treasury-only fund exits

**Will's directive**: Stripping conviction is right for VibeSwap. FW13's full vision (conviction, native chain, AI attestations) is for the **Decentralized Ideas Network** — a separate future project built on its own chain where IT is the native object, not an EVM contract. VibeSwap's CYT is the proving ground; the Ideas Network is the destination.
