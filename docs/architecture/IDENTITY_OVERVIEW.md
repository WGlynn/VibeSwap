# Identity Subsystem — Architecture Overview

**Status**: shipped (15 contracts; UUPS-upgradeable except where noted)
**Subsystem**: `contracts/identity/`
**Companions**: [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md), [`AGENTS_OVERVIEW.md`](./AGENTS_OVERVIEW.md), [`SECURITY_MECHANISM_DESIGN.md`](./SECURITY_MECHANISM_DESIGN.md)

---

## What this subsystem does

VibeSwap's identity stack — fifteen contracts that handle who-is-who, what-they-contributed, who-trusts-whom, and how-to-recover-when-things-go-wrong. The thesis: identity is not a single primitive. It's a layered substrate covering humans, AI agents, off-chain reality bridges, contribution attribution, recovery flows, and naming.

A monolithic `IdentityRegistry` would conflate concerns that update on different clocks (human vs agent identity, contribution vs trust vs naming). Splitting into 15 contracts maps each concern to its appropriate substrate.

## File map (grouped by concern)

```
contracts/identity/
├── HUMAN IDENTITY
│   ├── SoulboundIdentity.sol            ← non-transferable NFT, one per address; username + avatar + reputation
│   ├── VibeCode.sol                     ← deterministic identity fingerprint derived from on-chain contribution data
│   └── VibeNames.sol                    ← ENS-compatible .vibe naming, one-time fee, no rent renewal
│
├── AGENT IDENTITY
│   └── AgentRegistry.sol                ← ERC-8004 compatible AI agent registry (PsiNet × VibeSwap merge)
│
├── CONTRIBUTION + TRUST
│   ├── ContributionAttestor.sol         ← 3-branch separation-of-powers attestation governance
│   ├── ContributionDAG.sol              ← on-chain Web of Trust; vouches → handshakes → trust scores via BFS
│   ├── ContributionYieldTokenizer.sol   ← Pendle-inspired ideas-vs-execution tokenization
│   ├── RewardLedger.sol                 ← retroactive + active Shapley reward tracking
│   ├── GitHubContributionTracker.sol    ← off-chain GitHub contributions ingested via authorized relayers
│   └── PairwiseVerifier.sol             ← CRPC commit-reveal verification of non-deterministic AI outputs
│
├── ABSORPTION + ATTRIBUTION
│   └── AbsorptionRegistry.sol           ← tracks every protocol absorbed into VSOS, credits original developers
│
├── BRIDGE TO OFF-CHAIN
│   └── ContextAnchor.sol                ← on-chain anchor for PsiNet context graphs (IPFS-stored, Merkle-verified)
│
├── INTERACTION
│   └── Forum.sol                        ← decentralized forum bound to soulbound identities
│
└── RECOVERY
    ├── AGIResistantRecovery.sol         ← anti-AGI safeguards for wallet recovery
    └── WalletRecovery.sol               ← multi-layer recovery with social + time-lock + arbitration
```

## Per-concern role

### Human identity — SoulboundIdentity + VibeCode + VibeNames

Three contracts, three properties:

- **SoulboundIdentity**: the canonical non-transferable identity NFT. One per address. Binds username, avatar, contribution history, level, and alignment. Source-lineage binding (Strengthen #2, C45) ties identity to the address that minted it — preventing identity transfer attacks.
- **VibeCode**: a deterministic fingerprint computed from a user's on-chain contribution data. *Your account IS your vibe code.* Ports the "contribution-as-identity" property to a content-addressable form.
- **VibeNames**: ENS-compatible `.vibe` naming. One-time fee scaled by name length. No rent renewals — once registered, a name is yours forever. The design choice: ENS-style rent extraction vs ICANN-style permanent registration. VibeNames picks permanent.

The three contracts compose: a human has a `SoulboundIdentity` (canonical), a `VibeCode` (deterministic fingerprint), and optionally a `VibeNames` registration (human-readable name). The properties are orthogonal; no single contract does everything.

### Agent identity — AgentRegistry

ERC-8004 compatible AI agent registry, distinct from `SoulboundIdentity`. The split:
- Humans = soulbound, non-transferable, one-per-address.
- Agents = delegatable, operator-controlled, multi-instance per operator.

The discrimination is structural. An agent operator may run dozens of agents; each agent has its own identity but the operator's control is delegatable. Humans cannot delegate identity (sets up identity-theft vectors). Agents must delegate (operators run multiple agents).

PsiNet × VibeSwap merge — the agent registry was designed jointly to work across both substrates.

### Contribution + trust — six contracts

The largest cluster. Each handles one aspect of contribution attribution:

- **ContributionAttestor**: 3-branch separation-of-powers governance. Executive (Handshake Protocol), Legislative (proposal + vote), Judicial (dispute resolution). Attestations are governance objects, not unilateral writes.
- **ContributionDAG**: pairwise vouches form handshakes → distance-from-founders via BFS computes trust scores. 15% decay per hop. Direct port of `trustChain.js` (likely PsiNet origin).
- **ContributionYieldTokenizer**: separates *idea contribution* from *execution contribution* via Pendle-inspired tokenization. Two primitives — different actors, different reward streams.
- **RewardLedger**: retroactive + active Shapley reward tracking. Owner can submit pre-launch contributions for retroactive payout; ongoing contributions accumulate active value. Direct port of `shapleyTrust.js`.
- **GitHubContributionTracker**: off-chain GitHub contributions ingested via authorized relayers, Merkle-compressed, recorded as value events on RewardLedger. Bridges Web2 contribution data to on-chain rewards.
- **PairwiseVerifier**: CRPC (Commit-Reveal Pairwise Comparison) — 4-phase protocol verifying non-deterministic AI outputs on-chain. Critical for AI agent contribution scoring (the "did this agent's output deserve credit?" question).

### Absorption + attribution — AbsorptionRegistry

Every protocol absorbed into VSOS gets recorded; original developers get Shapley-fair rewards. *Convergence, not conquest.* The protocol's growth is structurally pro-absorption: a project that absorbs into VSOS is credited via on-chain attribution, not silently consumed.

This is the [augmented mechanism design](./AUGMENTED_MECHANISM_DESIGN.md) shape applied to ecosystem expansion: math-enforced fairness when absorbing other protocols, rather than discretionary acknowledgment.

### Bridge to off-chain — ContextAnchor

Anchors PsiNet context graphs (off-chain, IPFS-stored) to on-chain identity. Each context update is a contribution event. Merkle proofs verify the context graph against the on-chain anchor.

This is the cognitive substrate's airgap closure: context is too large for on-chain, but its anchor is on-chain, so context-mutations can be verified without storing context itself.

### Interaction — Forum

Decentralized forum where every post/reply is bound to a soulbound identity. No anonymous posting; identity is the participation gate. Post quality contributes to reputation; reputation gates higher-leverage participation elsewhere.

### Recovery — AGIResistantRecovery + WalletRecovery

Two contracts because recovery has two distinct adversary models:

- **AGIResistantRecovery**: assumes AGI-class attackers can fake digital signals. Defends with mechanisms AGI struggles with (specific challenges we don't enumerate publicly).
- **WalletRecovery**: 5 recovery methods ranging fastest-to-most-secure. Social recovery, time-lock, arbitration, etc. Each has different latency/security trade-off; user picks.

The split: AGIResistantRecovery handles novel adversary; WalletRecovery handles legacy + standard adversaries. Coexist; user opts into level.

## Composition flow (typical user lifecycle)

```
1. New address connects → mints SoulboundIdentity (one-time)
   │
   ▼
2. User contributes (via on-chain action, GitHub via relayer, forum post)
   → ContributionAttestor records → RewardLedger accumulates Shapley value
   │
   ▼
3. User vouches for others (and is vouched for) via ContributionDAG
   → BFS from founders updates trust score
   │
   ▼
4. User claims VibeCode (deterministic from contribution data)
   + optionally registers VibeNames (.vibe handle)
   │
   ▼
5. User participates in Forum, governance, etc — gated by reputation tiers
   │
   ▼
6. (If something goes wrong) WalletRecovery kicks in
   social recovery → time-lock → arbitration paths
```

Agents follow a similar flow but via `AgentRegistry` (delegated identity) and CRPC-verified contributions (`PairwiseVerifier`).

## Why 15 contracts, not one or three

Each contract handles a property that has its own clock and adversary model:

- Identity (slow-changing, identity-theft adversary).
- Contributions (fast-changing, gaming adversary).
- Trust (slow-changing, sybil adversary).
- Recovery (rare, AGI-class adversary).
- Naming (slow, registrar-extraction adversary).
- Bridges (medium, off-chain-trust adversary).

Conflating them either ties the slow concerns to fast-update cycles (degrades stability) or ties the fast concerns to slow-update cycles (degrades responsiveness). 15 contracts let each property update on its native clock.

The cost is real (15 deployment surfaces, 15 audit targets). The benefit is real (each surface is bounded; cross-cutting concerns aggregate cleanly via consumed interfaces).

## Configurability

Each contract is independently UUPS-upgradeable with `_authorizeUpgrade(onlyOwner)`. Cross-cutting parameters:

| Parameter | Where | Notes |
|-----------|-------|-------|
| Trust decay rate | ContributionDAG | 15% per hop in BFS |
| Recovery method choice | WalletRecovery | per-user opt-in |
| Naming fee schedule | VibeNames | scales by name length |
| Attestation governance roles | ContributionAttestor | executive / legislative / judicial |
| Relayer authorization | GitHubContributionTracker | curated list |

## Related

- [`AGENTS_OVERVIEW.md`](./AGENTS_OVERVIEW.md) — agents subsystem consumes `AgentRegistry` for identity.
- [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md) — reputation primitive that consumes contribution attribution.
- [`COMPLIANCE_OVERVIEW.md`](./COMPLIANCE_OVERVIEW.md) — `ComplianceRegistry` reads identity tier for KYC.
- [`MONETARY_OVERVIEW.md`](./MONETARY_OVERVIEW.md) — VIBE token Shapley distribution consumes RewardLedger data.
- [`bonded-permissionless-contest`](../concepts/primitives/bonded-permissionless-contest.md) — pattern used by attestation dispute paths.
