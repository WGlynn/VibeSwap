# CAT Protocol — A Substrate Analysis

*A short note on the Covenant Attested Token protocol through the substrate-geometry-match lens · 2026-05-06*

---

The Covenant Attested Token (CAT) protocol is a UTXO-based token system for Bitcoin that uses covenants (OP_CAT) to enforce token rules at Layer 1. Token data and logic reside on chain; miners validate; no indexer needed. The design is interesting at the substrate level beyond its specific token use case — what it fixes, structurally, is informative for protocol design generally.

## What CAT actually closes

Standard Bitcoin token protocols (BRC-20, Ordinals-based variants, RGB) require off-chain indexers to enforce token semantics. The Bitcoin chain sees only that *some* transaction occurred; the indexer sees that the transaction *meant* a token mint or transfer under the protocol's rules. The split creates three failure modes:

1. **Centralization risk**: a few well-known indexers run the canonical view. Token holders rely on their availability and honesty.
2. **Inconsistency risk**: two indexers can disagree about a token's state. The "correct" state is whichever one has more institutional adoption — which is reputation, not math.
3. **Replay / double-mint risk**: an over-minting transaction is invisible to Bitcoin consensus. Indexers reject it, but the rejection is policy, not consensus. A new indexer with looser policy could accept the over-mint.

CAT closes all three by moving token logic into Bitcoin Script via covenants. The chain itself enforces the rules. Indexers become read-only views over canonical state, not gatekeepers of canonical state.

This is the [airgap closure](./airgap-problem-onepager.md) shape applied to Bitcoin tokens: a property that previously lived off-chain (token rule enforcement) becomes structurally on-chain. Once enforced by consensus, the property no longer requires reputation-based trust.

## The substrate-geometry-match property

Per [substrate-geometry-match](https://github.com/wglynn/vibeswap/blob/master/docs/concepts/SUBSTRATE_GEOMETRY_MATCH.md), the natural geometric form of a substrate determines what mechanisms can be augmented onto it cheaply. Bitcoin's substrate is:
- UTXO model (state is a set of unspent outputs, not an account ledger).
- Bitcoin Script (stack-based, intentionally restricted, no general computation).
- 10-minute blocks with PoW finality (slow, but extremely durable).

A token protocol designed for Bitcoin must match this geometry or pay continuous translation costs. Three approaches:

| Approach | Geometry match | Cost |
|----------|----------------|------|
| Account-model token via off-chain indexer (BRC-20) | mismatched (account on top of UTXO) | indexer dependency |
| Sidechain/Layer-2 token (Lightning, Liquid) | external substrate | bridge trust assumption |
| Covenant-attested UTXO token (CAT) | matches | Script complexity at Layer 1 |

CAT's choice to encode token rules as covenants on UTXOs is *substrate-geometry-correct*. The token state lives in UTXOs (Bitcoin's native state form); the rules are Script (Bitcoin's native execution form); the validation is consensus (Bitcoin's native trust property). No translation layer.

The cost of substrate-geometry-match is paid in Script complexity, not in trust assumptions. That's the right asymmetry — Script is auditable mathematics; trust assumptions accumulate without bound.

## Programmable minting as expressibility-as-the-gate

CAT's programmable minting is the [expressibility-as-the-gate](https://github.com/wglynn/vibeswap/blob/master/docs/concepts/EXPRESSIBILITY_AS_THE_GATE.md) pattern applied to token issuance. The minting smart contract specifies issuance rules; over-minting transactions are *not expressible* under that contract; the network rejects them at consensus rather than at indexer policy.

The structural property: a token whose mint rules can be inspected at consensus level cannot have hidden minting. There is no off-chain admin path that mints "secretly." The DSL of the minting contract IS the issuance authority. Anything outside that DSL cannot produce valid minting transactions.

This is the same shape as the VibeSwap reasoning verification grammar: restrict the expressibility surface so that violations are syntactically impossible, not runtime-checked. Mint rules in CAT, reasoning chains in VibeSwap. Different substrates, same structural choice.

## Modularity through Script-ownership

The most architecturally interesting CAT property: tokens can be owned by smart contracts (covenants), not just addresses. This collapses a distinction that other Bitcoin token protocols enforce — between a token holder and a token-using contract.

Once a CAT token can be owned by a covenant, downstream contracts (AMMs, lending, staking) compose with CAT tokens directly. They don't need to wrap, bridge, or proxy. The covenant holds the token; the covenant's rules govern transfer; the rules are themselves Script verifiable on-chain.

This is sibling to VibeSwap's hook layer (V4-style hooks attached to pools) — extension that doesn't require modifying core. CAT achieves the same composability shape on Bitcoin's substrate.

## Cross-chain bridging as honesty closure

CAT's cross-chain bridges claim to require trust only in the bridged blockchains themselves, not any intermediate party. The mechanism is structurally similar to optimistic bridge designs: the source chain commits to a bridge transaction; the destination chain accepts based on SPV proofs of the source-chain state.

This is the [airgap closure](./airgap-problem-onepager.md) applied to cross-chain identity: an asset locked on chain A and minted on chain B is verifiable from B-side data alone (plus SPV chain-A proof). No bridge committee, no multisig, no "bridge oracle" with extractable trust.

The structural property: bridge correctness reduces to consensus correctness on each end. As long as each blockchain's consensus is sound, the bridge is sound. As long as each blockchain's PoW (or PoS) is securing N units of value, the bridge can route up to N units without additional trust.

VibeSwap's `CrossChainRouter` (LayerZero-V2-based) sits in different design space — it relies on LayerZero's ULN (Ultra Light Node) trust assumption, not pure SPV. CAT's design is structurally stronger but limited to chains supporting the relevant Script primitives. The trade-off is real: SPV bridges are stronger but narrower; LZ-style bridges are wider but require the LZ trust assumption.

## SPV compatibility as substrate-level property

CAT tokens are SPV-verifiable: a light client can confirm a token transaction is valid given only the relevant block headers and a Merkle proof. This is the *substrate-level* property — anyone can verify, not just full nodes.

Most Layer-2 token systems (Lightning, sidechain-based tokens) sacrifice SPV. The user runs a wallet that trusts a server. CAT preserves SPV because the verification rules are Script, and Script verification is SPV-friendly.

For mobile users, agents, IoT devices — anyone who cannot run a full node — SPV is the difference between "I can verify this myself" and "I trust the server." CAT's preservation of this property is structural, not optional.

## What CAT depends on

Two prerequisites:

1. **OP_CAT activation** (or a Bitcoin-compatible chain that has it). OP_CAT is a previously-deactivated Bitcoin opcode that the protocol requires. Without it, covenants of the kind CAT uses are not expressible.
2. **Sufficient Script complexity budget** to encode token rules at Layer 1. Bitcoin's per-script size and per-block compute limits bound how complex CAT's covenants can be.

The first prerequisite is a politics-of-Bitcoin question (BIP / soft fork). The second is engineering: complex token logic may need optimization or composition across multiple covenants.

The current state: CAT protocol works today on Bitcoin-compatible chains that have OP_CAT (e.g., Litecoin via MWEB-adjacent enhancements, or specific Bitcoin sidechains). On Bitcoin mainnet, it requires re-activation.

## Where this matters for VibeSwap

VibeSwap is EVM-based. CAT is Bitcoin-Script-based. Direct integration is not the question; structural alignment is. Three cross-substrate observations:

**Indexer-airgap closure.** The shape CAT applies to Bitcoin tokens (move logic on-chain so indexers become read-only views) applies to any protocol that currently relies on off-chain interpretation. VibeSwap's reasoning verification subsystem is the same shape applied to AI-agent reasoning: move the verification on-chain so off-chain "reasoning observers" become read-only views.

**Substrate-geometry-match for tokens.** VibeSwap's 3-token model (JUL / VIBE / CKB-native) chose to instance token economics as separate roles each tuned for its substrate. CAT chose to instance token economics on Bitcoin's UTXO+Script substrate. Same discipline, different substrates: pick the geometry match, not the universal token model.

**Cross-chain trust shapes.** VibeSwap's LZ-based router sits between SPV-only-trust (CAT-style) and committee-trust (multisig bridges) on the trust-vs-coverage curve. The choice is informed by what application the bridge serves. For value transfer where users can choose to wait for finality, SPV is correct. For real-time settlement where a few seconds matter, ULN-style is acceptable. Both designs are valid; the context selects.

## Why this is worth analyzing

CAT is a relatively recent protocol. The pattern matters more than the specific implementation. As Bitcoin Script regains complexity (whether via OP_CAT, OP_CHECKTEMPLATEVERIFY, or future opcodes), more protocols will move on-chain logic that previously lived off-chain. Each one closes an airgap; each one chooses a substrate-geometry-match (or doesn't); each one bounds its expressibility surface.

The architectural shapes named here — airgap closure, substrate-geometry-match, expressibility-as-the-gate, modularity-through-shared-substrate, SPV-as-substrate-property — are not specific to Bitcoin or VibeSwap. They are protocol-design properties applicable wherever someone is choosing what lives on-chain versus off-chain, and whether the on-chain version actually inherits the substrate's trust properties.

CAT does the inheritance correctly. That's the worth-noting part.
