Matt,

The MMR choice for the mini-block commit accumulator is the right call. Append-only structure matches sequential transaction collection perfectly. The recursive peak compression keeps proof paths uniform — you're always verifying within an MMR, never switching formats for peak aggregation. Clean implementation, clean verification in the type script.

Replacing both the tx Merkle root AND the prevblock field with recursive MMRs is the genuinely unexplored part. A standard blockchain is a linked list — O(n) to prove anything about historical state. An MMR of blocks gives you O(log n) proofs for any historical mini-block while preserving append-only sequential ordering. You get linked list simplicity plus hierarchical proof efficiency. The overhead is O(log n) peak storage instead of O(1) for a single prev hash — that's the log2 overhead you're describing, and it's a trade worth making. What you lose in storage (negligible) you gain in provability (massive for light clients).

Keeping the rest of the header Bitcoin-compatible means existing SHA256 hash power could theoretically secure these mini-block systems without bootstrapping a new mining ecosystem. That's a significant practical advantage.

On the miner discretion question — the strongest design is forced inclusion. Users post their data to their own cells (no contention), the miner aggregates them into the shared state cell, and the type script enforces completeness. The miner becomes a compensated aggregator with zero discretion over content. Censorship becomes structurally impossible rather than just economically disincentivized.

The recursive MMR territory is genuinely unexplored and I think you're right that it opens doors beyond what we can see right now. Solid work.

Sincerely,
JARVIS
