// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/monetary/Joule.sol";
import "../../contracts/monetary/interfaces/IJoule.sol";

// ============ Mock Oracle ============

contract MockJouleIOracle {
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

// ============ Handler ============
// NOTE: Mining is pre-done in setUp because SHA-256 PoW is too expensive
// for invariant handlers (50k+ hash iterations per mine × 128K calls = days).
// The handler focuses on rebase stability — the real risk surface for Joule.

contract JouleHandler is Test {
    Joule public joule;
    MockJouleIOracle public marketOracle;

    // Ghost variables
    uint256 public ghost_totalRebases;
    uint256 public ghost_expansions;
    uint256 public ghost_contractions;

    constructor(
        Joule _joule,
        MockJouleIOracle _marketOracle
    ) {
        joule = _joule;
        marketOracle = _marketOracle;
    }

    function rebase(uint256 priceSeed) public {
        // Set a random market price: 0.5x to 2.0x of $1
        priceSeed = bound(priceSeed, 5000, 20000);
        int256 newPrice = int256((priceSeed * 1e8) / 10000);
        if (newPrice <= 0) newPrice = 1;

        uint256 scalarBefore = joule.getRebaseScalar();

        marketOracle.setPrice(newPrice);

        try joule.rebase() {
            ghost_totalRebases++;
            uint256 scalarAfter = joule.getRebaseScalar();
            if (scalarAfter > scalarBefore) ghost_expansions++;
            else if (scalarAfter < scalarBefore) ghost_contractions++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 600, 2 days);
        vm.warp(block.timestamp + delta);
        vm.roll(block.number + 1);

        // Refresh oracle timestamp so it doesn't go stale
        (, int256 currentPrice,,,) = marketOracle.latestRoundData();
        marketOracle.setPrice(currentPrice);
    }
}

// ============ Invariant Tests ============

contract JouleInvariantTest is StdInvariant, Test {
    Joule public joule;
    MockJouleIOracle public marketOracle;
    MockJouleIOracle public electricityOracle;
    MockJouleIOracle public cpiOracle;
    JouleHandler public handler;

    address public governance;
    address public miner;

    function setUp() public {
        governance = makeAddr("governance");
        miner = makeAddr("miner");

        joule = new Joule(governance);

        marketOracle = new MockJouleIOracle();
        electricityOracle = new MockJouleIOracle();
        cpiOracle = new MockJouleIOracle();

        marketOracle.setPrice(1e8);
        electricityOracle.setPrice(1e8);
        cpiOracle.setPrice(1e8);

        vm.startPrank(governance);
        joule.setMarketOracle(address(marketOracle));
        joule.setElectricityOracle(address(electricityOracle));
        joule.setCPIOracle(address(cpiOracle));
        vm.stopPrank();

        // Pre-mine tokens so supply > 0 for rebase testing
        _preMine(5);

        handler = new JouleHandler(joule, marketOracle);
        targetContract(address(handler));
    }

    function _preMine(uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            bytes32 nonce = _findValidNonce();
            vm.prank(miner);
            joule.mine(nonce);
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 600);
        }
    }

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

    // ============ Invariant: rebase scalar always > 0 ============

    function invariant_scalarPositive() public view {
        uint256 scalar = joule.getRebaseScalar();
        assertGt(scalar, 0, "SCALAR: must be positive");
    }

    // ============ Invariant: redemption price always > 0 ============

    function invariant_redemptionPricePositive() public view {
        IJoule.PIState memory pi = joule.getPIState();
        assertGt(pi.redemptionPrice, 0, "REDEMPTION: must be positive");
    }

    // ============ Invariant: difficulty always > 0 ============

    function invariant_difficultyPositive() public view {
        IJoule.Epoch memory ep = joule.getCurrentEpoch();
        assertGt(ep.difficulty, 0, "DIFFICULTY: must be positive");
    }

    // ============ Invariant: supply remains positive after pre-mining ============

    function invariant_supplyPositive() public view {
        uint256 supply = joule.totalSupply();
        assertGt(supply, 0, "SUPPLY: must be positive after pre-mining");
    }

    // ============ Invariant: totalBlocksMined unchanged (no mining in handler) ============

    function invariant_blocksMineStable() public view {
        assertEq(
            joule.totalBlocksMined(),
            5, // pre-mined in setUp
            "BLOCKS: should not change during rebase-only invariant"
        );
    }
}
