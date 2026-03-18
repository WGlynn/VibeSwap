# r/solidity — "How do you test that a distribution is fair? We use Shapley axioms as Foundry assertions."

**Subreddit**: r/solidity
**Flair**: Technical

---

**Title**: How do you test that a reward distribution is fair? We turned cooperative game theory axioms into Foundry test assertions.

**Body**:

You can test that a swap executes correctly. You can test fee calculations. But how do you test that the *distribution* of rewards is **fair**?

Fairness isn't a boolean. It's a set of properties that must hold simultaneously. We use [Shapley value axioms](https://en.wikipedia.org/wiki/Shapley_value) as test assertions in Foundry.

**The five axioms as Solidity tests:**

```solidity
// Efficiency: total distributed = total available (conservation)
assertApproxEqAbs(sum, totalValue, 4, "Efficiency axiom violated");

// Symmetry: equal contributors get equal rewards
assertEq(shapley1, shapley2, "Symmetry: equal contribution = equal reward");

// Null Player: zero contribution = zero reward
assertEq(freeloaderShapley, 0, "Null player axiom");

// Extraction detection: anything above Shapley value = taking too much
(bool isExtracting, uint256 amount) = detectExtraction(shapleyValue, actual);
assertTrue(isExtracting);
```

**The power move: fuzz testing fairness**

```solidity
function testFuzz_ExtractionAlwaysDetected(
    uint256 contribution,
    uint256 extraction
) public pure {
    contribution = bound(contribution, 1e18, 1_000_000e18);
    extraction = bound(extraction, 1, 1_000e18);

    uint256 shapleyValue = calculateShapleyValue(
        contribution, contribution, totalValue
    );
    uint256 overAllocation = shapleyValue + extraction;

    (bool isExtracting, uint256 amount) = detectExtraction(
        shapleyValue, overAllocation
    );
    assert(isExtracting);      // ALWAYS detected
    assert(amount == extraction); // EXACT amount
}
```

256 random runs. 100% detection rate.

The same Shapley math that distributes rewards also detects when someone takes more than their share. Symmetric proof — if the math knows what's fair, it knows what's unfair.

**What this enables:** We use this to make governance capture impossible. A 51% vote to enable protocol fee extraction gets checked against the null player axiom (protocol contributed zero liquidity → deserves zero fees) and is automatically blocked.

Full test file (9 tests, 2 fuzz): https://github.com/WGlynn/VibeSwap/blob/master/test/simulation/ExtractionDetection.t.sol

Shapley distributor contract (62 tests): https://github.com/WGlynn/VibeSwap/blob/master/contracts/incentives/ShapleyDistributor.sol

How do you approach fairness testing in your contracts? Are there axiom systems beyond Shapley that work well on-chain?
