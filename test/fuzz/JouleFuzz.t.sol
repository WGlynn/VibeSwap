// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/Joule.sol";
import "../../contracts/monetary/interfaces/IJoule.sol";

// ============ Mock Oracle ============

contract MockJouleFOracle {
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

// ============ Fuzz Tests ============

contract JouleFuzzTest is Test {
    Joule public joule;
    MockJouleFOracle public marketOracle;
    MockJouleFOracle public electricityOracle;
    MockJouleFOracle public cpiOracle;

    address public governance;
    address public miner;

    function setUp() public {
        governance = makeAddr("governance");
        miner = makeAddr("miner");

        joule = new Joule(governance);

        marketOracle = new MockJouleFOracle();
        electricityOracle = new MockJouleFOracle();
        cpiOracle = new MockJouleFOracle();

        marketOracle.setPrice(1e8);
        electricityOracle.setPrice(1e8);
        cpiOracle.setPrice(1e8);

        vm.startPrank(governance);
        joule.setMarketOracle(address(marketOracle));
        joule.setElectricityOracle(address(electricityOracle));
        joule.setCPIOracle(address(cpiOracle));
        vm.stopPrank();
    }

    // ============ Helper: find valid PoW nonce ============

    function _findValidNonce() internal view returns (bytes32 nonce) {
        bytes32 challenge = joule.getCurrentChallenge();
        IJoule.Epoch memory ep = joule.getCurrentEpoch();
        uint256 threshold = type(uint256).max / ep.difficulty;
        for (uint256 i = 1; i < 1_000_000; i++) {
            nonce = bytes32(i);
            bytes32 hash = sha256(abi.encodePacked(challenge, nonce));
            if (uint256(hash) < threshold) return nonce;
        }
        revert("Could not find valid nonce");
    }

    function _mineTokens(address _miner, uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            bytes32 nonce = _findValidNonce();
            vm.prank(_miner);
            joule.mine(nonce);
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 600);
        }
    }

    // ============ Fuzz: rebase within ±5% band produces no supply change ============

    function testFuzz_rebaseWithinBandNoChange(uint256 priceDeviation) public {
        // Price within ±5% of target (1e18)
        priceDeviation = bound(priceDeviation, 0, 499); // 0-4.99% in bps

        // Mine some tokens first so supply > 0
        _mineTokens(miner, 3);

        uint256 supplyBefore = joule.totalSupply();

        // Set market price within band
        // Target is ~1e18, price oracle uses 8 decimals → 1e8 = 1.0
        // ±5% = 0.95 to 1.05 → 95000000 to 105000000
        uint256 price8dec = 1e8 + (priceDeviation * 1e8 / 10000);
        marketOracle.setPrice(int256(price8dec));

        // Advance past cooldown
        vm.warp(block.timestamp + 1 days + 1);
        marketOracle.setPrice(int256(price8dec)); // refresh updatedAt

        joule.rebase();

        uint256 supplyAfter = joule.totalSupply();

        // Supply should not change within equilibrium band
        assertEq(supplyAfter, supplyBefore, "Supply should not change within band");
    }

    // ============ Fuzz: expansion when market > target ============

    function testFuzz_expansionAboveBand(uint256 premiumBps) public {
        premiumBps = bound(premiumBps, 600, 5000); // 6% to 50% above target

        _mineTokens(miner, 3);

        uint256 scalarBefore = joule.getRebaseScalar();

        // Price above target by premiumBps
        uint256 price8dec = 1e8 + (premiumBps * 1e8 / 10000);
        marketOracle.setPrice(int256(price8dec));

        vm.warp(block.timestamp + 1 days + 1);
        marketOracle.setPrice(int256(price8dec));

        joule.rebase();

        uint256 scalarAfter = joule.getRebaseScalar();

        // Scalar should increase (expansion)
        assertGt(scalarAfter, scalarBefore, "Scalar should increase on expansion");
    }

    // ============ Fuzz: contraction when market < target ============

    function testFuzz_contractionBelowBand(uint256 discountBps) public {
        discountBps = bound(discountBps, 600, 5000); // 6% to 50% below target

        _mineTokens(miner, 3);

        uint256 scalarBefore = joule.getRebaseScalar();

        // Price below target by discountBps
        uint256 price8dec = 1e8 - (discountBps * 1e8 / 10000);
        if (price8dec == 0) price8dec = 1; // floor
        marketOracle.setPrice(int256(price8dec));

        vm.warp(block.timestamp + 1 days + 1);
        marketOracle.setPrice(int256(price8dec));

        joule.rebase();

        uint256 scalarAfter = joule.getRebaseScalar();

        // Scalar should decrease (contraction)
        assertLt(scalarAfter, scalarBefore, "Scalar should decrease on contraction");
    }

    // ============ Fuzz: Moore's Law decay is monotonically decreasing ============

    function testFuzz_mooresLawDecreasing(uint256 days1, uint256 days2) public {
        days1 = bound(days1, 1, 365);
        days2 = bound(days2, days1 + 1, 730);

        // At time days1
        vm.warp(joule.deployTimestamp() + days1 * 1 days);
        uint256 factor1 = joule.getMooresLawFactor();

        // At time days2
        vm.warp(joule.deployTimestamp() + days2 * 1 days);
        uint256 factor2 = joule.getMooresLawFactor();

        // Later time should have lower Moore's factor
        assertLt(factor2, factor1, "Moore's Law must be monotonically decreasing");
        assertGt(factor2, 0, "Moore's factor should remain positive");
    }

    // ============ Fuzz: transfer preserves total supply ============

    function testFuzz_transferPreservesTotalSupply(uint256 transferFraction) public {
        transferFraction = bound(transferFraction, 1, 10000);

        _mineTokens(miner, 5);

        uint256 supplyBefore = joule.totalSupply();
        uint256 minerBal = joule.balanceOf(miner);

        uint256 transferAmt = (minerBal * transferFraction) / 10000;
        if (transferAmt == 0) transferAmt = 1;
        if (transferAmt > minerBal) transferAmt = minerBal;

        address recipient = makeAddr("recipient");
        vm.prank(miner);
        joule.transfer(recipient, transferAmt);

        uint256 supplyAfter = joule.totalSupply();

        assertEq(supplyAfter, supplyBefore, "Transfer must not change total supply");
        assertEq(
            joule.balanceOf(miner) + joule.balanceOf(recipient),
            minerBal,
            "Balances must sum to original"
        );
    }

    // ============ Fuzz: cooldown enforcement ============

    function testFuzz_rebaseCooldownEnforcement(uint256 waitTime) public {
        waitTime = bound(waitTime, 0, 2 days);

        _mineTokens(miner, 3);

        // First rebase
        vm.warp(block.timestamp + 1 days + 1);
        marketOracle.setPrice(1.1e8);
        joule.rebase();

        // Try second rebase after waitTime
        vm.warp(block.timestamp + waitTime);
        marketOracle.setPrice(1.1e8);

        if (waitTime < 1 days) {
            vm.expectRevert(IJoule.RebaseTooSoon.selector);
            joule.rebase();
        } else {
            // Should succeed
            joule.rebase();
        }
    }
}
