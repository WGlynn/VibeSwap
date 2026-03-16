# The Idea Token Primitive: Why Ideas Should Be Liquid Assets

Every funding model in crypto has the same fatal flaw: they conflate the value of an idea with the value of its execution.

A VC writes a check to a founder. A DAO votes to fund a proposal. A grant committee approves a project. In every case, the money goes to a *person* — and the idea lives or dies with that person's ability to execute. If the founder burns out, the idea dies. If the DAO-funded team pivots, the original vision evaporates. The idea had value. The execution failed. But because the two were never separated, the idea's value was destroyed alongside the execution.

This is a solved problem. We just haven't applied the solution yet.

## The Insight: Ideas and Execution Are Independent Variables

Think about it this way. The idea for a decentralized exchange existed long before Uniswap. The idea for programmable money existed long before Ethereum. The idea for digital cash existed long before Bitcoin — the cypherpunks were writing about it in the 1990s.

Ideas have intrinsic value that is independent of any particular execution. A good idea is still a good idea even if the first three teams that attempt it fail. A bad idea is still a bad idea even if a brilliant team executes it flawlessly.

Yet every funding mechanism in existence treats them as the same thing. You can't fund an idea without funding a specific person to execute it. And once that person has the money, the idea is hostage to their competence, motivation, and integrity.

What if we could separate the two?

## Two Primitives, Not One

The Idea Token primitive introduces two independent financial instruments:

**1. The Idea Token (IT)** — a liquid asset representing the idea itself.

When someone proposes an idea, a new ERC-20 token is deployed specifically for that idea. Anyone can fund the idea by depositing tokens and receiving IT in return, minted 1:1 with the funding. The IT is fully liquid from day zero — you can buy it, sell it, transfer it. Holding IT means you believe in the idea's value.

The crucial property: IT never expires. Ideas don't have deadlines. The concept of automated market making didn't expire when the first attempt failed. It waited for the right execution. IT captures this reality — the token represents permanent, intrinsic value that exists regardless of whether anyone is currently building it.

Price discovery happens naturally. Good ideas attract funding and their IT appreciates. Bad ideas don't. The market figures it out.

**2. The Execution Stream (ES)** — continuous, performance-dependent funding for whoever builds it.

Anyone can propose to execute an idea by creating an Execution Stream. The stream starts at zero flow rate. IT holders then vote with their tokens — committing IT to signal conviction that this executor should receive funding. The more conviction, the higher the stream rate. Funding flows continuously, proportional to demonstrated value.

The crucial property: ES is revocable. If an executor stalls — stops reporting milestones, stops shipping — the stream decays automatically. After a stale period, anyone holding IT can redirect the stream to a new executor. The idea survives the death of any particular execution attempt.

Multiple executors can compete for the same idea's funding simultaneously. The market of IT holders decides who deserves the resources.

## Conviction Voting: Liquid Democracy for Funding

The mechanism for connecting IT holders to execution streams is conviction voting — a form of liquid democracy where your vote grows stronger the longer you hold it.

When you commit IT tokens to vote for an execution stream, your conviction starts at an initial value weighted by your trust score in the network's web of trust. Over time, conviction grows linearly. This means patient, committed believers have more influence than speculators who jump in and out.

Trust weighting matters. A founder with a 3x trust multiplier who commits 1,000 IT gets 3,000 initial conviction. An untrusted newcomer committing the same amount gets 500. The web of trust — a directed graph of mutual vouches with BFS-computed scores decaying 15% per hop from founders — ensures that conviction is weighted by demonstrated trustworthiness.

You can withdraw your conviction vote at any time. Your IT tokens are returned. The stream rate adjusts accordingly. This is liquid democracy in its purest form — continuous, real-time reallocation of funding based on demonstrated value.

## The Stale Check: Ideas Outlive Bad Executors

Here's where it gets interesting. Every execution stream has a stale duration — by default, 14 days. If the executor doesn't report a milestone (with on-chain evidence) within that window, anyone can trigger a stale check. The stream rate drops to zero. The stream status changes to STALLED.

Once stalled, any IT holder can propose a redirect — nominating a new executor to take over. The stream reactivates with the new executor, and conviction voting resumes.

This is how ideas become immortal. The original executor might burn out, pivot, or disappear. The idea doesn't care. The IT holders — the people who funded the idea's existence — retain governance over who gets to build it next.

An idea can have its executor replaced five times and still succeed on the sixth attempt. Under traditional funding models, it would have died with the first failure.

## Why This Matters: Proactive Funding

The separation of idea value from execution value unlocks something that doesn't exist in crypto today: proactive funding.

Currently, to fund something in DeFi, you need a specific proposal from a specific team with a specific plan. The funding is reactive — someone proposes, then money moves.

With Idea Tokens, you can fund an idea before anyone proposes to build it. You see a concept you believe in — say, a new approach to oracle design — and you buy IT. Your money is now backing the *idea*, not any particular builder. When a competent team eventually proposes to execute, the funding pool is already there, governed by IT holders through conviction voting.

This flips the entire funding model. Instead of ideas competing for money, money competes for ideas.

## The Deeper Point: Separation of Powers

The Idea Token primitive is part of a broader architecture built on separation of powers. Just as democratic governments separate executive, legislative, and judicial authority, the system separates three independent validation signals:

1. **Vouches** (executive) — trusted actors in a web of trust endorse contributors through mutual handshakes
2. **Governance** (legislative) — the community votes on contribution values and funding allocation
3. **Decentralized Identity** (judicial) — cryptographic verification that you are who you claim to be

No single factor is standalone proof. A founder's vouch carries weight but isn't sufficient alone. A governance vote must be backed by identity verification. Each factor equals one weight. Redundancy by design.

This three-factor model applies to everything — retroactive reward claims, execution stream authorization, trust score computation. The system doesn't trust any single authority, including its own creators.

## Implementation

The Idea Token primitive is implemented as a Solidity smart contract (`ContributionYieldTokenizer.sol`) that integrates with:

- **ContributionDAG** — an on-chain web of trust that computes BFS trust scores from founder nodes, with 15% decay per hop (max 6 hops). Trust multipliers weight conviction votes.
- **RewardLedger** — a dual-mode reward system supporting both retroactive (pre-launch) and active (real-time) Shapley value distribution along trust chains.

Each idea gets its own ERC-20 token. Execution streams are continuous funding channels governed by conviction voting. Stale detection and redirect mechanisms ensure ideas outlive any single execution attempt.

The contract is fully tested with 44 unit tests covering the complete lifecycle: idea creation, funding, execution proposals, conviction voting, milestone reporting, stale detection, stream redirection, and completion.

## The Primitive, Not the Product

The Idea Token is a primitive — a building block, not a finished product. It can be composed with other DeFi mechanisms:

- IT tokens can be used as collateral in lending protocols
- IT can be traded on AMMs for price discovery
- Execution streams can integrate with insurance pools for risk mitigation
- Conviction voting can feed into quadratic funding mechanisms

The separation of idea value from execution value is the fundamental insight. Everything else is composition.

Ideas deserve to be first-class financial assets. Not bundled with execution risk. Not locked behind specific teams. Not killed by the failure of any single attempt.

Ideas are permanent. The Idea Token makes them liquid.

---

*The Idea Token primitive was conceived by FreedomWarrior13 and implemented as part of the VibeSwap protocol. The core insight — that idea value is intrinsic and independent from execution value — is the foundation for proactive funding through liquid democracy.*

*Built in a cave, with a box of scraps.*
