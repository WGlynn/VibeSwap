# Reply to: Open vs. Sealed Auction Format Choice for MEV
# https://ethresear.ch/t/open-vs-sealed-auction-format-choice-for-maximal-extractable-value/24454

## Reply — ready to post:

---

Excellent analysis of the linkage principle applied to MEV auctions. The empirical work on 2.2M transactions and the affiliation modeling are rigorous. A few observations from the perspective of mechanism design that approaches MEV elimination rather than MEV extraction optimization:

### The Missing Format: Commit-Reveal Batch Auctions

Your analysis covers English, SPSB, FPSB, Dutch, and all-pay formats — all of which assume **sequential, real-time bidding** where information flows between participants during the auction. The linkage principle is powerful precisely because it exploits this information flow.

But what happens when you eliminate the information flow entirely?

**Commit-reveal batch auctions** operate in a fundamentally different regime:

1. **Commit phase** (sealed): Users submit `hash(order || secret)` with a collateral deposit. No one — not searchers, not validators, not the protocol — can see the order contents.

2. **Reveal phase**: Users reveal their orders. Orders that don't match their commitment are slashed (50% of deposit).

3. **Settlement**: All revealed orders in the batch are shuffled using a deterministic seed derived from XOR of all secrets + post-reveal block entropy (beacon chain randomness). Uniform clearing price computed from batch math.

This eliminates the auction entirely for the end user. There are no bidders. There is no competition for execution position. The MEV surface area is structurally zero because:

- **No front-running**: You can't front-run what you can't see (commit phase is opaque)
- **No sandwich attacks**: Execution order is determined by Fisher-Yates shuffle with unpredictable seed
- **No information leakage**: The linkage principle requires that one bidder's signal informs others' valuations. Commit-reveal breaks this channel.

### Where Your Analysis Still Applies

Your work is directly relevant for the **priority auction layer** that sits on top of the batch mechanism. Users who want guaranteed execution order within a batch can bid for priority — and THAT auction follows your framework. The correlation parameter rho is meaningful there: searchers bidding for priority positions have affiliated valuations because they observe the same pending batch.

For this priority layer, your recommendation of English/SPSB under high affiliation makes sense. But it's a second-order revenue channel, not the primary execution mechanism.

### The Revenue Trade-off

Your paper optimizes for **proposer/block builder revenue** from MEV auctions. Commit-reveal batch auctions optimize for **user welfare** by eliminating the MEV surplus entirely. This is a fundamentally different objective function.

The ~$10-18M annual gap between SPSB and FPSB that you identify is meaningful for proposer revenue. But the total MEV extracted from users (sandwiches alone are estimated at $500M+ annually) dwarfs this. The question isn't "which auction format maximizes MEV revenue?" but "should the MEV surplus exist at all?"

### Non-Monotone Revenue and Batch Auctions

Your finding that revenue declines at extreme affiliation (rho -> 0.9) with large n is fascinating. In batch auctions, the analog is: when all participants submit near-identical orders (high affiliation), the uniform clearing price converges to the true market price, and the "spread" available for extraction collapses to zero. The non-monotonicity you observe in sequential auctions is structurally guaranteed in batch mechanisms.

### Practical Considerations

A reference implementation of this mechanism uses 10-second batches (8s commit + 2s reveal), which balances latency against the security guarantees of the commit-reveal scheme. Settlement can be made permissionless — anyone triggers it after reveal closes, because the computation is purely deterministic (Fisher-Yates shuffle + uniform clearing price from batch math). No trusted party needed.

Happy to discuss extending your analysis to batch auction formats — the linkage principle behaves differently when the information channel is structurally closed.
