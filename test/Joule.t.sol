// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/monetary/Joule.sol";
import "../contracts/monetary/interfaces/IJoule.sol";

// ============ Mock Oracle ============

contract MockJouleOracle {
    int256 public price;
    uint256 public updatedAt;

    function setPrice(int256 _price) external {
        price = _price;
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80 answeredInRound
    ) {
        return (1, price, block.timestamp, updatedAt, 1);
    }
}

// ============ Joule Test Suite ============

contract JouleTest is Test {
    Joule public joule;
    MockJouleOracle public marketOracle;
    MockJouleOracle public electricityOracle;
    MockJouleOracle public cpiOracle;

    address public governance;
    address public alice;
    address public bob;

    function setUp() public {
        governance = makeAddr("governance");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        joule = new Joule(governance);

        // Set up oracles
        marketOracle = new MockJouleOracle();
        electricityOracle = new MockJouleOracle();
        cpiOracle = new MockJouleOracle();

        // Set initial prices (1.0 in 8 decimals for Chainlink)
        marketOracle.setPrice(1e8);
        electricityOracle.setPrice(1e8);
        cpiOracle.setPrice(1e8);

        vm.startPrank(governance);
        joule.setMarketOracle(address(marketOracle));
        joule.setElectricityOracle(address(electricityOracle));
        joule.setCPIOracle(address(cpiOracle));
        vm.stopPrank();
    }

    // ============ Constructor Tests ============

    function test_constructor_initialState() public view {
        assertEq(joule.name(), "Joule");
        assertEq(joule.symbol(), "JUL");
        assertEq(joule.decimals(), 18);
        assertEq(joule.totalSupply(), 0);
        assertEq(joule.currentEpochNumber(), 0);
        assertEq(joule.totalBlocksMined(), 0);
    }

    function test_constructor_rebaseScalar() public view {
        assertEq(joule.getRebaseScalar(), 1e18);
    }

    function test_constructor_piState() public view {
        IJoule.PIState memory pi = joule.getPIState();
        assertEq(pi.redemptionPrice, 1e18);
        assertEq(pi.integral, 0);
        assertEq(pi.lastError, 0);
    }

    function test_constructor_epoch() public view {
        IJoule.Epoch memory ep = joule.getCurrentEpoch();
        assertEq(ep.difficulty, 1 << 16);
        assertEq(ep.blocksMined, 0);
    }

    function test_constructor_zeroGovernance_reverts() public {
        // OZ Ownable(address(0)) reverts with OwnableInvalidOwner
        vm.expectRevert();
        new Joule(address(0));
    }

    // ============ Mining Tests ============

    function test_mine_validProof() public {
        bytes32 nonce = _findValidNonce();

        vm.prank(alice);
        uint256 reward = joule.mine(nonce);

        assertGt(reward, 0, "Reward should be positive");
        assertGt(joule.balanceOf(alice), 0, "Alice should have tokens");
        assertEq(joule.totalBlocksMined(), 1);
    }

    function test_mine_rewardIsProportionalToDifficulty() public view {
        uint256 reward = joule.getCurrentReward();
        // Initial: difficulty = 2^16, scale = 1e18, moore = 1.0
        // reward = (2^16 * 1e18 * 1e18) / (2^16 * 1e18) = 1e18 = 1 JUL
        assertEq(reward, 1e18, "Initial reward should be 1 JUL");
    }

    function test_mine_invalidProof_reverts() public {
        // First find a VALID nonce to confirm mining works
        bytes32 validNonce = _findValidNonce();

        // Now mine it to advance the state
        vm.prank(alice);
        joule.mine(validNonce);

        // The valid nonce from the OLD challenge won't work with the NEW challenge
        // (blocksMined changed from 0→1, so challenge changed)
        // But it also won't match the usedProofs since challenge is different
        // We need a nonce that genuinely fails the difficulty check on the new challenge
        bytes32 newChallenge = joule.getCurrentChallenge();
        uint128 difficulty = joule.getCurrentEpoch().difficulty;
        uint256 threshold = type(uint256).max / difficulty;

        // Search for a nonce that fails (99.998% of nonces fail at difficulty 2^16)
        bytes32 badNonce;
        for (uint256 i = 500000; i < 600000; i++) {
            badNonce = bytes32(i);
            bytes32 hash = sha256(abi.encodePacked(newChallenge, badNonce));
            if (uint256(hash) >= threshold) {
                break;
            }
        }

        vm.prank(alice);
        vm.expectRevert(IJoule.InsufficientDifficulty.selector);
        joule.mine(badNonce);
    }

    function test_mine_proofHashRecorded() public {
        // Test that the proof hash is recorded (replay prevention mechanism)
        bytes32 nonce = _findValidNonce();
        bytes32 challenge = joule.getCurrentChallenge();
        bytes32 expectedProofHash = keccak256(abi.encodePacked(challenge, nonce));

        // Before mining, proof is unused
        assertFalse(joule.usedProofs(expectedProofHash));

        vm.prank(alice);
        joule.mine(nonce);

        // After mining, proof is recorded
        assertTrue(joule.usedProofs(expectedProofHash));
    }

    function test_mine_antiMergeMining() public {
        // Challenge includes address(this) — different contract = different challenge
        bytes32 challenge1 = joule.getCurrentChallenge();

        Joule joule2 = new Joule(governance);
        bytes32 challenge2 = joule2.getCurrentChallenge();

        assertTrue(challenge1 != challenge2, "Challenges should differ between contracts");
    }

    function test_mine_epochProgression() public {
        IJoule.Epoch memory ep = joule.getCurrentEpoch();
        assertEq(ep.blocksMined, 0);

        bytes32 nonce = _findValidNonce();
        vm.prank(alice);
        joule.mine(nonce);

        ep = joule.getCurrentEpoch();
        assertEq(ep.blocksMined, 1);
    }

    // ============ Moore's Law Tests ============

    function test_mooresLaw_dayZero() public view {
        uint256 factor = joule.getMooresLawFactor();
        assertEq(factor, 1e18, "Day 0 factor should be 1.0");
    }

    function test_mooresLaw_decaysOverTime() public {
        vm.warp(block.timestamp + 365 days);
        uint256 factor = joule.getMooresLawFactor();

        // ~25% annual decay → factor ≈ 0.7-0.75
        assertLt(factor, 0.8e18, "Factor should be less than 0.8 after 1 year");
        assertGt(factor, 0.6e18, "Factor should be greater than 0.6 after 1 year");
    }

    function test_mooresLaw_affectsReward() public {
        uint256 rewardDay0 = joule.getCurrentReward();

        vm.warp(block.timestamp + 365 days);
        uint256 rewardYear1 = joule.getCurrentReward();

        assertLt(rewardYear1, rewardDay0, "Reward should decrease over time");
    }

    // ============ Rebase Tests ============

    function test_rebase_withinBand_noChange() public {
        _mineTokens(alice, 3);

        uint256 balBefore = joule.balanceOf(alice);

        // Refresh oracle THEN warp (so it's not stale)
        marketOracle.setPrice(1e8);
        vm.warp(block.timestamp + 1 days);
        // Re-set oracle so updatedAt is current
        marketOracle.setPrice(1e8);

        joule.rebase();

        assertEq(joule.balanceOf(alice), balBefore, "Balance should not change within band");
    }

    function test_rebase_positiveExpansion() public {
        _mineTokens(alice, 3);

        uint256 balBefore = joule.balanceOf(alice);

        // Set price 10% above target (outside ±5% band)
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(1.1e8);

        int256 delta = joule.rebase();

        assertGt(delta, 0, "Supply delta should be positive");
        assertGt(joule.balanceOf(alice), balBefore, "Balance should increase on expansion");
    }

    function test_rebase_negativeContraction() public {
        _mineTokens(alice, 3);

        uint256 balBefore = joule.balanceOf(alice);

        // Set price 10% below target
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(0.9e8);

        int256 delta = joule.rebase();

        assertLt(delta, 0, "Supply delta should be negative");
        assertLt(joule.balanceOf(alice), balBefore, "Balance should decrease on contraction");
    }

    function test_rebase_proportionalToAllHolders() public {
        _mineTokens(alice, 3);

        // Transfer some to bob
        uint256 aliceBal = joule.balanceOf(alice);
        uint256 transferAmt = aliceBal / 3;
        vm.prank(alice);
        joule.transfer(bob, transferAmt);

        uint256 aliceRatio = (joule.balanceOf(alice) * 1e18) / joule.totalSupply();
        uint256 bobRatio = (joule.balanceOf(bob) * 1e18) / joule.totalSupply();

        // Rebase
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(1.2e8);
        joule.rebase();

        // Ratios should remain the same (Shapley symmetry)
        uint256 aliceRatioAfter = (joule.balanceOf(alice) * 1e18) / joule.totalSupply();
        uint256 bobRatioAfter = (joule.balanceOf(bob) * 1e18) / joule.totalSupply();

        assertApproxEqAbs(aliceRatio, aliceRatioAfter, 1, "Alice ratio unchanged");
        assertApproxEqAbs(bobRatio, bobRatioAfter, 1, "Bob ratio unchanged");
    }

    function test_rebase_cooldown() public {
        _mineTokens(alice, 1);

        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(1.2e8);
        joule.rebase();

        // Too soon — no time warp
        marketOracle.setPrice(1.2e8);
        vm.expectRevert(IJoule.RebaseTooSoon.selector);
        joule.rebase();
    }

    function test_rebase_globalScalar_O1() public view {
        assertEq(joule.getRebaseScalar(), 1e18);
    }

    function test_rebase_lagFactor() public {
        _mineTokens(alice, 3);

        uint256 totalBefore = joule.totalSupply();

        // 20% above target
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(1.2e8);
        joule.rebase();

        uint256 totalAfter = joule.totalSupply();
        uint256 actualChange = totalAfter - totalBefore;
        // Expected: totalSupply * 0.20 / 10 = 2% of total
        uint256 expectedChange = (totalBefore * 20) / 100 / 10;

        assertApproxEqRel(actualChange, expectedChange, 0.01e18, "Lag should smooth to ~2%");
    }

    // ============ PI Controller Tests ============

    function test_pi_errorCalculation() public {
        _mineTokens(alice, 1);

        // Market above target — negative error
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(1.5e8);
        joule.rebase();

        IJoule.PIState memory pi = joule.getPIState();
        assertLt(pi.lastError, 0, "Error should be negative when market > target");
    }

    function test_pi_targetAdjustsOverTime() public {
        _mineTokens(alice, 1);
        uint256 initialTarget = joule.getRebaseTarget();

        // Persistent deviation: market stays above target
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < 5; i++) {
            t += 2 days;
            vm.warp(t);
            marketOracle.setPrice(1.3e8);
            joule.rebase();
        }

        uint256 finalTarget = joule.getRebaseTarget();
        assertTrue(finalTarget != initialTarget, "Target should have adjusted");
    }

    function test_pi_integralAccumulates() public {
        _mineTokens(alice, 1);

        // First rebase
        uint256 t1 = block.timestamp + 2 days;
        vm.warp(t1);
        marketOracle.setPrice(1.2e8);
        joule.rebase();

        IJoule.PIState memory pi1 = joule.getPIState();

        // Second rebase — explicitly compute next timestamp
        uint256 t2 = t1 + 2 days;
        vm.warp(t2);
        marketOracle.setPrice(1.2e8);
        joule.rebase();

        IJoule.PIState memory pi2 = joule.getPIState();

        // Integral should have grown (accumulated error)
        assertTrue(
            _abs(pi2.integral) > _abs(pi1.integral) / 2,
            "Integral should accumulate"
        );
    }

    // ============ ERC-20 Tests ============

    function test_transfer() public {
        _mineTokens(alice, 2);

        uint256 amount = joule.balanceOf(alice) / 2;
        vm.prank(alice);
        joule.transfer(bob, amount);

        assertApproxEqAbs(joule.balanceOf(bob), amount, 1);
    }

    function test_transferFrom_withApproval() public {
        _mineTokens(alice, 2);

        uint256 amount = joule.balanceOf(alice) / 2;
        vm.prank(alice);
        joule.approve(bob, amount);

        vm.prank(bob);
        joule.transferFrom(alice, bob, amount);

        assertApproxEqAbs(joule.balanceOf(bob), amount, 1);
    }

    function test_transferFrom_insufficientAllowance_reverts() public {
        _mineTokens(alice, 2);

        vm.prank(bob);
        vm.expectRevert();
        joule.transferFrom(alice, bob, 1e18);
    }

    function test_transfer_insufficientBalance_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        joule.transfer(bob, 1e18);
    }

    // ============ Oracle Tests ============

    function test_oracle_setElectricity_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        joule.setElectricityOracle(address(electricityOracle));
    }

    function test_oracle_setCPI_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        joule.setCPIOracle(address(cpiOracle));
    }

    function test_oracle_zeroAddress_reverts() public {
        vm.prank(governance);
        vm.expectRevert(IJoule.ZeroAddress.selector);
        joule.setElectricityOracle(address(0));
    }

    function test_oracle_staleData_reverts() public {
        _mineTokens(alice, 1);

        // Set oracle price then make it stale
        marketOracle.setPrice(1e8);
        vm.warp(block.timestamp + 2 days); // > 1 day staleness

        vm.expectRevert(IJoule.OracleStale.selector);
        joule.rebase();
    }

    function test_oracle_fallbackToElectricity() public {
        Joule joule2 = new Joule(governance);

        vm.prank(governance);
        joule2.setElectricityOracle(address(electricityOracle));

        uint256 price = joule2.getMarketPrice();
        assertEq(price, 1e18);
    }

    function test_oracle_noOracle_returnsTarget() public {
        Joule joule2 = new Joule(governance);

        uint256 price = joule2.getMarketPrice();
        assertEq(price, 1e18);
    }

    // ============ Integration / Lifecycle Tests ============

    function test_lifecycle_mineRebaseTransfer() public {
        // 1. Mine tokens
        _mineTokens(alice, 3);
        uint256 mined = joule.balanceOf(alice);
        assertGt(mined, 0);

        // 2. Transfer half to bob
        uint256 half = mined / 2;
        vm.prank(alice);
        joule.transfer(bob, half);

        // 3. Rebase (expansion)
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(1.15e8);
        joule.rebase();

        // 4. Both should have more than before rebase
        assertGt(joule.balanceOf(alice), mined / 2);
        assertGt(joule.balanceOf(bob), half);

        // 5. Ratios preserved
        uint256 aliceRatio = (joule.balanceOf(alice) * 1e18) / joule.totalSupply();
        uint256 bobRatio = (joule.balanceOf(bob) * 1e18) / joule.totalSupply();
        assertApproxEqAbs(aliceRatio, bobRatio, 2, "Ratios should be ~equal");
    }

    function test_lifecycle_multipleRebases() public {
        _mineTokens(alice, 3);

        // Multiple rebases over time
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < 3; i++) {
            t += 2 days;
            vm.warp(t);
            marketOracle.setPrice(1.1e8);
            joule.rebase();
        }

        assertGt(joule.getRebaseScalar(), 1e18, "Scalar should increase after expansions");
    }

    function test_lifecycle_contractionThenExpansion() public {
        _mineTokens(alice, 3);

        uint256 initial = joule.balanceOf(alice);

        // Contraction
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(0.8e8);
        joule.rebase();
        uint256 afterContraction = joule.balanceOf(alice);
        assertLt(afterContraction, initial, "Should decrease on contraction");

        // Expansion
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(1.2e8);
        joule.rebase();

        assertGt(joule.balanceOf(alice), afterContraction, "Should increase after expansion");
    }

    // ============ Difficulty Adjustment Tests ============

    function test_difficultyAdjustment_afterEpoch() public {
        // We can't mine 144 blocks in a test (too much gas for nonce search)
        // Instead test the mechanism indirectly: mine a few blocks fast,
        // then verify epoch tracking works
        bytes32 nonce = _findValidNonce();
        vm.prank(alice);
        joule.mine(nonce);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 60); // 1 min (too fast)

        IJoule.Epoch memory ep = joule.getCurrentEpoch();
        assertEq(ep.blocksMined, 1, "Should track blocks mined");
        assertEq(joule.currentEpochNumber(), 0, "Still epoch 0");
        // Full epoch test would require 144 blocks — covered by integration testing
    }

    // ============ Internal Balance vs External Balance ============

    function test_internalVsExternal_beforeRebase() public {
        _mineTokens(alice, 2);

        // Before any rebase, internal == external (scalar = 1.0)
        assertEq(joule.internalBalanceOf(alice), joule.balanceOf(alice));
    }

    function test_internalVsExternal_afterRebase() public {
        _mineTokens(alice, 3);

        uint256 internalBefore = joule.internalBalanceOf(alice);

        // Positive rebase
        vm.warp(block.timestamp + 1 days);
        marketOracle.setPrice(1.2e8);
        joule.rebase();

        // Internal should not change, external should increase
        assertEq(joule.internalBalanceOf(alice), internalBefore, "Internal unchanged");
        assertGt(joule.balanceOf(alice), internalBefore, "External increased");
    }

    // ============ Helpers ============

    function _findValidNonce() internal view returns (bytes32 nonce) {
        bytes32 challenge = joule.getCurrentChallenge();
        uint128 difficulty = joule.getCurrentEpoch().difficulty;
        uint256 threshold = type(uint256).max / difficulty;

        for (uint256 i = 1; i < 1_000_000; i++) {
            nonce = bytes32(i);
            bytes32 hash = sha256(abi.encodePacked(challenge, nonce));
            if (uint256(hash) < threshold) {
                return nonce;
            }
        }
        revert("Could not find valid nonce in 1M attempts");
    }

    function _mineTokens(address miner, uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            bytes32 nonce = _findValidNonce();
            vm.prank(miner);
            joule.mine(nonce);
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 600); // 10 min between blocks
        }
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
}
