How every DEX works vs how VibeSwap works.

No diagrams needed. Just logic.

---

CONTINUOUS TRADING (every other DEX):

You submit a trade →
It enters the mempool →
Bots see it →
Bot buys before you →
Your trade executes at a worse price →
Bot sells after you →
Bot profits. You lose.

Timeline: You → Bot → You → Bot
Result: You paid more than you should have.

---

BATCH AUCTION (VibeSwap):

You submit a hashed commitment →
Nobody can read it →
Other users submit hashed commitments →
Nobody can read those either →
Commit window closes →
All orders revealed simultaneously →
Single clearing price calculated →
Everyone gets the same price.

Timeline: Everyone → Settlement
Result: Fair price. No extraction.

---

Think of it like this.

Continuous trading is an open auction where someone is reading your bid card before you hold it up.

Batch trading is a sealed-bid auction where all envelopes are opened at the same time.

---

"But who determines the order inside the batch?"

Great question. Nobody.

Execution order is determined by a Fisher-Yates shuffle. The randomness seed comes from XORing all participants' secrets together.

No single party controls ordering. Not even us.

---

"What about the clearing price?"

One price. For everyone. In the entire batch.

If you and I both buy ETH in the same 10-second window, we pay the same amount. Not "roughly the same." The same.

Uniform clearing price. The way markets should work.

---

Continuous trading: optimized for speed.
Batch trading: optimized for fairness.

Speed benefits bots.
Fairness benefits you.

Pick one.