PoW Auction Design Conversation — Matt + Will + JARVIS (Feb 17, 2026)

This captures the full design conversation about integrating VibeSwap's commit-reveal batch auction with Matt's PoW shared state on CKB.


Two-Layer Ordering Distinction

Matt's PoW solves infrastructure-layer ordering: who gets write access to the shared auction cell on CKB. VibeSwap solves application-layer ordering: fairness within the batch (deterministic shuffle, uniform clearing price). Different problems at different layers. Both needed on CKB. Neither replaces the other.


Recursive MMR for Mini-Blocks

Matt proposed using Merkle Mountain Ranges as the commit accumulator. Append-only, log(n) storage, efficient proofs. The key innovation is recursing MMR peaks into another MMR until a single root remains. This replaces the tx Merkle root in the Bitcoin-compatible block header.

Matt also proposed replacing the prevblock field with a recursive MMR. Standard blockchain is O(n) for historical proofs. MMR of blocks gives O(log n) proofs for any historical mini-block. Overhead is O(log n) peak storage instead of O(1) — worth it for the provability gain.

Bitcoin header format reuse means existing SHA256 hardware could secure the mini-blocks.

Reference implementation: https://github.com/matt-nervos/EfficientMMRinEVM


Miner Visibility Question

Matt asked: Can miners see the preimage to the order data?

Answer: No. Users submit hash(order || secret). Miners only see the hash and the deposit. Order details (token pair, direction, amount) and the user's secret are never revealed until the reveal phase, after the commit window closes. Miners can't front-run because they can't read the orders they're including.


Reveal Window and Non-Reveals

Matt asked: How does the system handle users who never reveal?

Answer: There's a reveal window after commits close. Users broadcast original order parameters and secret, contract verifies each reveal hashes to the matching commit. If a user never reveals, their deposit gets slashed 50%. Unrevealed orders are excluded from batch settlement. The slash prevents spam commits and griefing.


Forced Inclusion Is Non-Negotiable

Matt identified the critical insight: if a miner has discretion and drops your commit, you can never reveal because there's no commit on-chain to reveal against. Nothing is financially lost (your deposit never left your wallet), but you're censored from the batch.

Worse: if the miner is also a trader, they can selectively exclude commits to reduce competition and get a better clearing price for their own orders. That's MEV through selective censorship.

Forced inclusion closes this. Users post commits to their own cells (no contention). Miner aggregates into the shared auction cell. Type script rejects any mini-block that doesn't include all pending commits. Miner has zero discretion.


FOCIL and Legal Concerns

Matt raised the parallel to FOCIL (Fork-Choice Enforced Inclusion Lists) on Ethereum. The legal concern: if you force miners to include all transactions, what happens when one comes from a sanctioned wallet (OFAC)? The miner has no choice — include the sanctioned transaction or the entire batch fails. Legal exposure for miners.

This maps 1:1 to VibeSwap on CKB.


Solution: Forced Inclusion with Compliance Filter

VibeSwap already has a ComplianceRegistry contract on-chain. The type script requires miners to include all pending commits EXCEPT addresses flagged in the registry. Miners have zero discretion (can't censor for competitive advantage). Sanctioned addresses are filtered at the protocol level. Compliance enforced by code, not individual miner judgment. Legal burden sits with protocol rules, not miners.

Cleaner than Ethereum where each validator independently decides whether to comply with OFAC. Here it's uniform and auditable.


CKB UTXO Compliance: cell_dep Pattern

Matt flagged that compliance is harder on UTXOs than Ethereum's account model because there's no global state to query mid-transaction.

Solution: The ComplianceRegistry is itself a cell. The type script on the auction cell takes the compliance cell as a cell_dep (read-only dependency). When validating a mini-block, the type script reads the compliance cell and checks each commit's origin against it. Flagged addresses get rejected, everything else must be included.

No global state needed. The compliance list is just another cell the transaction references. Dependencies are declared explicitly in the transaction structure. More verbose than Ethereum's mapping(address => bool) but functionally identical and arguably more auditable since the dependency is visible in the transaction itself.

This is exactly how CKB's type/lock paradigm was designed to work.


Design Summary

Layer 1 — Infrastructure ordering: PoW-gated write access to shared auction cell
Layer 2 — Commit accumulation: Recursive MMR (append-only, log(n) proofs)
Layer 3 — Compliance: ComplianceRegistry cell as cell_dep, protocol-enforced filtering
Layer 4 — Application ordering: Deterministic Fisher-Yates shuffle within batch
Layer 5 — Pricing: Uniform clearing price for all orders in batch

Forced inclusion with compliance filter. Miners are compensated aggregators with zero discretion. MEV eliminated at every layer. Censorship structurally impossible for non-sanctioned addresses. Legal liability on protocol rules, not individual miners.
