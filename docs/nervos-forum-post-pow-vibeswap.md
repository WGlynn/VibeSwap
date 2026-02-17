PoW Shared State + Commit-Reveal Batch Auctions: Eliminating MEV at Every Layer on CKB

This post builds on Matt's PoW shared state proposal and explains how it fits naturally into VibeSwap's architecture as we explore a CKB integration. The short version: both projects solve ordering problems, but at different layers of the stack, and together they eliminate MEV at every layer.


The Problem VibeSwap Solves

VibeSwap is an omnichain DEX that eliminates MEV through commit-reveal batch auctions with uniform clearing prices. Instead of processing swaps one at a time (which creates front-running and sandwich attacks), VibeSwap collects orders in batches and settles them all at the same price.

The mechanism works in three phases. During the commit phase, users submit a hash of their order along with a deposit. Nobody can see anyone else's order. During the reveal phase, users reveal their actual orders. Then during settlement, all orders in the batch are shuffled deterministically and executed at a single uniform clearing price. No front-running is possible because orders are hidden during commit. No sandwich attacks because everyone gets the same price.

This works well on account-based chains like Ethereum where shared state is native. But bringing it to CKB presents an obvious challenge.


The CKB Challenge

VibeSwap's auction contract needs shared state by definition. Multiple users need to submit commits to the same auction cell during the commit phase. Multiple users need to reveal against that same cell during the reveal phase. Settlement reads the full set of orders from that cell and writes the results back.

On an account-based chain this is trivial. On CKB's cell model, this is exactly the contention problem Matt described. If twenty users try to commit to the same auction cell in the same block, nineteen of them fail. The auction becomes unusable.

You could put an operator in front of it to sequence the commits, but then you have reintroduced a centralized party who can see orders before they are committed, which defeats the entire purpose of a commit-reveal scheme. The operator becomes the MEV extractor.


How Matt's PoW Shared State Fits

Matt's proposal solves this cleanly by separating consensus mechanics from application logic using CKB's lock/type paradigm.

The lock script handles who gets to update the auction cell. It performs a PoW verification check against a difficulty target. Whoever finds a valid nonce earns the right to submit the next state transition. No centralized operator. No ticket issuer. Decentralized leader selection for write access, exactly the way Nakamoto consensus works.

The type script handles what the update does. This is where VibeSwap's auction logic lives. The type script validates that the state transition is a legitimate commit (correct hash format, sufficient deposit), a legitimate reveal (matches the prior commit hash), or a legitimate settlement (correct shuffle, correct clearing price).

Authorization and validation are cleanly separated. The PoW gate controls access. The auction logic controls correctness. Neither needs to know about the other.


Two Ordering Problems, Two Layers

It is worth being precise here because both VibeSwap and Matt's proposal solve ordering problems, but at different layers of the stack.

Matt's PoW solves infrastructure-layer ordering. On CKB's cell model, multiple transactions competing to update the same cell is a contention problem. Who gets write access next? On Ethereum this problem does not exist because the EVM handles shared state natively and anyone can call a contract. On CKB it is a fundamental blocker. Matt's PoW decentralizes write access the same way Nakamoto consensus decentralizes block production. This is not about trade ordering. It is about access to the cell itself.

VibeSwap solves application-layer ordering. Within a batch of collected orders, what sequence do they execute in? On Ethereum the ordering problem is mempool transaction ordering, which is where MEV lives. Validators and searchers reorder transactions for profit. VibeSwap neutralizes this by making ordering irrelevant. Orders are hidden during commit, batched together, then shuffled deterministically using XORed user secrets before settlement at a uniform clearing price. No one can predict or manipulate which trade executes first within the batch.

On Ethereum, VibeSwap's application-layer solution is sufficient because infrastructure-layer ordering is handled by the EVM. On CKB, you need both layers. Matt's PoW handles who gets to write to the auction cell. VibeSwap's auction logic handles fairness inside the auction once writes are collected. Neither replaces the other.


Why This Combination Is Uniquely Powerful

Together these two layers close the entire MEV surface on CKB.

At the infrastructure layer, you cannot win write access by being faster or by bribing a sequencer. You win by doing work. The cost of that work self-adjusts through difficulty targeting. Griefing is self-punishing because you burn real hash power for no economic gain.

At the pricing layer, even if you win write access, you cannot extract value from other users because all orders in the batch settle at the same uniform clearing price. There is no informational advantage to being first because orders are committed as hashes.

At the execution layer, the deterministic shuffle (seeded by XORed user secrets) ensures that execution order within a batch is unpredictable and unmanipulable. No one can position their trade advantageously within the batch.

This is defense in depth against MEV. Not one mechanism hoping to cover everything, but three independent layers each closing a different attack vector. Matt's PoW handles the layer that is unique to CKB. VibeSwap's batch auction handles the layers that exist on every chain. The combination is stronger than either alone.


Implementation Sketch

The auction cell becomes its own mini-blockchain, exactly as Matt described. Each state transition (a new commit, a new reveal, a settlement) is a block in the auction's PoW chain. The lock script verifies the proof meets the difficulty target and adjusts difficulty based on update frequency.

During the commit phase, miners compete to include user commits into the auction cell. The type script validates each commit contains a valid hash and sufficient deposit. During the reveal phase, miners include reveals and the type script validates each reveal matches its corresponding commit hash. During settlement, a miner submits the final state transition containing the shuffled execution and uniform clearing price, and the type script validates the math.

The Bitcoin header format reuse that Matt proposed is elegant here because it means the auction's PoW chain is SPV-verifiable. Light clients can independently verify the auction's state history without trusting anyone.

Multiple auction cells can run concurrently for different trading pairs. Each is an independent PoW chain settled on CKB L1. They appear chaotic from the outside but each is internally ordered and independently verifiable.


Difficulty and Timing Considerations

VibeSwap's batches run on fixed time windows. On Ethereum we use roughly 10 second batches with 8 seconds for commits and 2 seconds for reveals. On CKB with PoW-gated shared state, the timing dynamics change.

The difficulty target on each auction cell needs to be tuned so that state transitions happen frequently enough to include all user commits within the commit window but not so frequently that the PoW cost becomes negligible and stops serving as a contention resolution mechanism. This is an area where the economic equilibrium Matt mentioned becomes important. The market will find the balance between PoW cost and trading value, and difficulty adjustment keeps it calibrated.

For high-volume trading pairs, difficulty will naturally be higher because more miners compete for the more valuable write access. For low-volume pairs, difficulty stays low and updates are cheap. The system self-scales.


What This Means for CKB DeFi

CKB's cell model has been seen as a limitation for DeFi because shared state is hard. Matt's PoW proposal turns that limitation into a feature. The contention resolution mechanism itself becomes an anti-MEV tool rather than just an infrastructure patch.

VibeSwap on CKB would not just be a port of an Ethereum DEX. It would be a fundamentally stronger design because the PoW layer adds MEV resistance that is not possible on account-based chains where anyone can write to shared state for the cost of gas. On CKB with PoW-gated cells, writing to shared state has a real cost that self-adjusts to match the value at stake. That cost is the MEV extraction floor, and it is enforced by physics, not by protocol rules that can be gamed.

We think this is a compelling direction and would be interested in collaborating with the CKB community on a proof of concept. The auction logic is already built and battle-tested. The PoW shared state primitive is the missing piece that makes it viable on CKB.


Edit: I want to clarify something about how these two solutions relate. Both VibeSwap and Matt's proposal solve ordering problems, but at different layers. Matt's PoW solves infrastructure-layer ordering, which is unique to CKB's cell model. When multiple transactions compete to update the same cell, who gets write access? That problem does not exist on account-based chains like Ethereum where shared state is native. VibeSwap solves application-layer ordering. Within a batch of collected trades, what sequence do they execute in? We handle this with hidden commits, deterministic shuffling, and uniform clearing prices so that ordering becomes irrelevant. On Ethereum, our application-layer solution alone is sufficient. On CKB, you need both layers. Matt handles access to the cell. We handle fairness inside the auction. Neither replaces the other, and the combination is stronger than either alone.
