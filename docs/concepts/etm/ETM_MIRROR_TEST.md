# ETM Mirror Test

> *A test that asserts "the contract compiles" tells you nothing about whether the contract is correct. A test that asserts "the function returns the expected number" tells you something. A test that asserts "the mechanism mirrors the cognitive substrate" tells you whether the mechanism is WHAT IT CLAIMS TO BE.*

This doc describes a testing discipline for ETM-aligned mechanisms: write tests that assert not just correctness in the narrow sense ("does it compile?", "does it return the right type?"), but **mirror correctness** — does the mechanism actually reflect the cognitive-economic substrate it's supposed to mirror?

## The library analogy, again

Suppose you're building software to manage library-desk allocation with the Attention-Surface Scaling primitive. A correct implementation:

1. Compiles.
2. Takes requests.
3. Returns prices.
4. **Charges convex rent shaped like `base × (1 - (t/T)^α)` with α ∈ [1.2, 1.8]**.

Points 1-3 are narrow-correctness. A test suite for them is: "call the function, check the return type, check that prices go up with time." Sufficient for the library to not crash.

Point 4 is **mirror-correctness**. A test for it is: "call the function at times 0, T/4, T/2, 3T/4, T; verify the returned values fit a convex curve with α in the acceptable range."

The mirror test checks that the code implements the INTENDED SHAPE, not just that it compiles. If someone refactored the curve to linear, narrow-correctness tests would all pass. Mirror-correctness tests would fail loudly.

## The primitive, stated

**ETM Mirror Test** is a testing discipline that:

- **Asserts the mechanism's shape against the substrate's shape.** Not just "returns a number" but "returns numbers matching this curve."
- **Uses the substrate's calibration as the expected value.** If cognitive retention has α ≈ 1.6, the mirror test asserts the mechanism reproduces α ≈ 1.6 (within tolerance).
- **Fails loudly on shape drift.** A refactor that changes linear→convex or vice versa triggers the mirror test, even if narrow correctness still passes.
- **Documents the substrate reference.** The test name, comment, or assertion message cites WHY the expected values are what they are (e.g., "α = 1.6 per ETM paper §6.4").

## Structure of a mirror test

A typical mirror test has four parts:

### Part 1 — Fixture: the substrate reference

Define what the cognitive substrate says the answer should be. Usually a table of (input, expected_output) pairs derived from the substrate model.

Example for NCI retention:

```solidity
// Expected values from CONVEX_RETENTION_DERIVATION.md, α=1.6, T=365
uint256[] memory expectedWeights = new uint256[](6);
uint256[] memory expectedTimes = new uint256[](6);
expectedTimes[0] = 0;   expectedWeights[0] = 1000;
expectedTimes[1] = 30;  expectedWeights[1] = 986;
expectedTimes[2] = 90;  expectedWeights[2] = 894;
expectedTimes[3] = 180; expectedWeights[3] = 662;
expectedTimes[4] = 270; expectedWeights[4] = 344;
expectedTimes[5] = 365; expectedWeights[5] = 0;
```

### Part 2 — Action: exercise the mechanism

Call the function at each input.

```solidity
uint256[] memory actualWeights = new uint256[](6);
for (uint256 i = 0; i < expectedTimes.length; i++) {
    actualWeights[i] = nci.retentionWeight(expectedTimes[i], 1000);
}
```

### Part 3 — Assertion: check the shape

Each point is within tolerance. Tolerance is an explicit parameter — for retention curves, 1% (relative) is usually acceptable.

```solidity
for (uint256 i = 0; i < expectedTimes.length; i++) {
    uint256 diff = expectedWeights[i] > actualWeights[i]
        ? expectedWeights[i] - actualWeights[i]
        : actualWeights[i] - expectedWeights[i];
    uint256 tolerance = expectedWeights[i] / 100; // 1%
    require(diff <= tolerance,
        string.concat("Mirror drift at t=", vm.toString(expectedTimes[i])));
}
```

### Part 4 — Documentation: cite the substrate

The test's comment or assertion message references the source.

```solidity
/// @notice Asserts retentionWeight matches ETM cognitive substrate with α=1.6
/// @dev Reference values from CONVEX_RETENTION_DERIVATION.md, derived from
///      Ebbinghaus 1885 data via power-law β→α translation. See MIRROR.md.
function test_retentionMirrorsCognitive() public { ... }
```

## Mirror tests for each ETM mechanism

Each ETM-aligned mechanism should have at least one mirror test. Here's the map:

### NCI Retention (Gap #1)

- **Mirror**: cognitive retention decay, power-law α≈1.6.
- **Test**: assert retentionWeight curve at [0, 30, 90, 180, 270, 365] days matches expected values within 1%.
- **Also test**: governance-tunability within bounds — α = 1.2 and α = 1.8 both produce valid curves; α = 0.5 reverts.

### Shapley Time-Indexed (Gap #2)

- **Mirror**: scientific-priority credit assignment, novelty-weighted.
- **Test**: with 3 contributors having similarity scores [0.05, 0.90, 0.95] to prior state, assert shares match [450, 292.5, 157.5] (normalized 50%/32.5%/17.5%) within 1%.
- **Also test**: Lawson Floor binding — a contributor with similarity 1.0 still gets ≥ 0.2x multiplier.

### Circuit Breaker Attested Resume (Gap #3)

- **Mirror**: flinch-and-re-evaluate reflex.
- **Test**: breaker trips; 1-hour floor elapses; attempt resume without attestation → reverts; submit 2-of-3 attestations → resume succeeds.
- **Also test**: bad signature → reverts; below-quorum attestations → stays paused; repeat trip within resume window → attestors slashable.

### CKB State-Rent

- **Mirror**: attention-surface convex decay.
- **Test**: rent at t=0 is base_rent; at t=T/2 exceeds base_rent×1.5; at t=T exceeds base_rent×3. (Specific curve depends on PoM implementation.)

### Commit-Reveal Auction

- **Mirror**: attention-time characteristic window.
- **Test**: commit-phase is exactly 8 seconds; reveal-phase is exactly 2 seconds; total 10 seconds; outside-window reveals are rejected.
- **Also test**: the rationale for 10s is documented in contract NatSpec referencing cognitive-attention-time.

### Contribution DAG Handshake Cooldown

- **Mirror**: attention-bandwidth scarcity.
- **Test**: handshake within 24h of previous reverts; handshake 24h + 1s succeeds. Covers step-function boundary.

### Lawson Floor

- **Mirror**: replication-credit minimum.
- **Test**: a contribution with similarity 1.0 to prior state receives multiplier ≥ lawson_floor (e.g., 0.2x).
- **Also test**: the floor isn't violable — cannot be disabled by admin, cannot be set below 0.1x.

### Fibonacci Scaling (rate limits)

- **Mirror**: golden-ratio substrate geometry.
- **Test**: scaling coefficients match Fibonacci retracement levels [0.236, 0.382, 0.5, 0.618] within 0.01.

## Anti-patterns — tests that LOOK like mirror tests but aren't

### Anti-pattern 1 — Testing against the implementation

```solidity
uint256 expected = contract.retentionWeight(90, 1000); // BAD: circular
require(expected > 800 && expected < 1000, "bad");
```

This test asserts that the current implementation gives a value in a range. If the implementation is wrong, the test is wrong too. The test's expected values must come from an EXTERNAL reference (the substrate model), not from calling the function.

### Anti-pattern 2 — Testing only endpoints

```solidity
require(retentionWeight(0, 1000) == 1000);
require(retentionWeight(365, 1000) == 0);
```

Passing at endpoints says nothing about the middle. Linear, convex, and concave curves all hit these endpoints. Must assert middle points.

### Anti-pattern 3 — Tolerance too loose

```solidity
require(abs(actual - expected) < expected); // Tolerance 100% — useless
```

Tolerance should be tight enough that a real shape change fails. 1% is usually right for convex curves; 0.1% might be too tight given integer-math approximations.

### Anti-pattern 4 — No reference to substrate

```solidity
require(retentionWeight(180, 1000) > 600);
```

Where does 600 come from? A developer's guess? The substrate? Without a cited reference, the assertion value is arbitrary — future maintainers can't evaluate whether it's correct.

## Why mirror tests reduce drift

Over time, protocol implementations drift. A helper function gets refactored. A "small optimization" changes a calculation. A dependency upgrade changes behavior subtly.

Narrow-correctness tests catch blatant errors (wrong sign, wrong type, revert-where-it-shouldn't). They don't catch drift in the SHAPE of a curve.

Mirror tests catch shape drift because they assert shape, not just values. A refactor from `(1 - (t/T)^α)` to `(1 - t/T)` would make day-180 retention drop from 662 to 506. Narrow tests pass; mirror test fails loudly at day 180's assertion.

This is the same protection that property-based testing provides, but targeted at substrate-mirror properties specifically.

## Writing a new mirror test

When proposing a new ETM-aligned mechanism, include a mirror test spec. Minimum:

1. **What substrate is being mirrored?** (e.g., "cognitive retention decay")
2. **What calibration?** (e.g., "α = 1.6 per ETM paper §6.4")
3. **What reference values?** (e.g., table from CONVEX_RETENTION_DERIVATION.md)
4. **What tolerance?** (e.g., "1% relative")
5. **What governance-tunability test?** (e.g., "α in [1.2, 1.8] works; outside reverts")

A new mechanism without a mirror test spec shouldn't ship. The mirror test is the correctness criterion, not "it compiles."

## Integrating with RSI cycles

When an RSI cycle addresses an ETM gap (like Gap #1 C40), the mirror test is part of the cycle deliverable. Cycle checklist:

- [ ] Code change implements the mechanism
- [ ] Narrow-correctness tests (compile, type, revert-where-expected)
- [ ] **Mirror test asserts substrate match**
- [ ] **Substrate reference cited** in test comment
- [ ] Governance-tunability test if applicable
- [ ] Commit references the gap and the mirror test

Without the mirror test, the cycle is incomplete even if other tests pass.

## Student exercises

1. **Write a mirror test for a toy function.** Suppose `computePrice(t) = base × (1 - (t/T)^α)` with α = 1.6, T = 100, base = 1000. Write Solidity code implementing a mirror test that verifies this at t = 25, 50, 75, 100.

2. **Identify mirror tests in existing VibeSwap test suite.** Look at `test/` directory. Find tests that qualify as mirror tests (assert shape, cite substrate) vs tests that don't.

3. **Propose a mirror test for a mechanism that lacks one.** Pick a VibeSwap mechanism without an explicit mirror test (e.g., TWAP validation). Propose what substrate it should mirror and what a mirror test would assert.

4. **Cross-mechanism mirror.** Is there a substrate property that should be consistent ACROSS mechanisms (e.g., all decay curves use same α)? If so, what's the cross-mechanism mirror test?

5. **Governance-tunability mirror.** Write a mirror test that exercises governance-tunability — α = 1.2 works, α = 1.8 works, α = 0.5 reverts, α = 5.0 reverts.

## Connection to code review

When reviewing code for an ETM-aligned mechanism, ask:

- Does a mirror test exist?
- Does it cite the substrate reference?
- Does it assert middle-of-curve values, not just endpoints?
- Is tolerance reasonable (not too loose)?
- Does it exercise governance-tunability bounds?

If any of these are missing, the review verdict is "needs mirror test before merge."

## Future work — concrete code cycles this primitive surfaces

### Queued as part of C40

- **NCI retention mirror test** — implement the 6-point retention curve assertion from CONVEX_RETENTION_DERIVATION.md. File: `test/ci/NCIRetentionMirror.t.sol`.

### Queued as part of C41-C42

- **Shapley Time-Indexed mirror test** — 3-contributor case with similarity scores. File: `test/ci/ShapleyTimeIndexedMirror.t.sol`.

### Queued as part of C43

- **Circuit Breaker Attested Resume mirror test** — flinch-and-re-evaluate scenario. File: `test/ci/CircuitBreakerAttestedMirror.t.sol`.

### Queued for un-scheduled cycles

- **CRA attention-window mirror** — verify 8s + 2s window, document rationale in NatSpec.
- **CKB state-rent mirror** — once PoM rent curve is accessible, assert convexity.
- **Handshake cooldown mirror** — step function boundary test.
- **Lawson Floor mirror** — verify floor isn't violable.

### Primitive extraction

Extract this to `memory/primitive_etm-mirror-test.md` as a review-gate: no ETM-aligned code ships without a mirror test cited.

## Relationship to other primitives

- **Attention-Surface Scaling** (see [`ATTENTION_SURFACE_SCALING.md`](./ATTENTION_SURFACE_SCALING.md)) — what shape mechanisms should have.
- **Convex Retention Derivation** (see [`CONVEX_RETENTION_DERIVATION.md`](./CONVEX_RETENTION_DERIVATION.md)) — where the calibration numbers come from.
- **Correspondence Triad** (see [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md)) — design-gate that motivates mirror tests.
- **Self-Theater Audit Gate** — existing review pattern; mirror tests are the ETM-specific extension.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Specifies a testing discipline that accompanies every ETM-aligned code cycle.
2. Provides concrete mirror test specifications for each known mechanism.
3. Opens the question of cross-mechanism mirrors (future research).
4. Becomes the review-gate citation when mirror tests are missing.

Each cycle that ships a mirror test against this doc's spec extends the "shipped" section. Over time, the doc becomes a catalog of mirror-tested mechanisms + their substrate references.

## One-line summary

*ETM Mirror Test is a testing discipline asserting mechanism shape against substrate shape, not just narrow correctness. Each ETM-aligned mechanism gets a mirror test citing the substrate reference + middle-of-curve assertions + governance-tunability bounds. Missing mirror test = incomplete cycle. Prevents shape drift across refactors.*
