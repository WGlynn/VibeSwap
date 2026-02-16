// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VibeSynth.sol";
import "../../contracts/financial/interfaces/IVibeSynth.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockSynthIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockSynthIOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Handler ============

contract SynthHandler is Test {
    VibeSynth public synth;
    MockSynthIToken public usdc;
    MockSynthIOracle public oracle;

    address public minter;
    address public priceSetter;

    uint256 constant SYNTH_PRICE = 1000 ether;

    // Ghost variables
    uint256 public ghost_positionCount;
    uint256 public ghost_totalMinted;
    uint256 public ghost_totalBurned;

    uint256[] public activePositions;

    constructor(
        VibeSynth _synth,
        MockSynthIToken _usdc,
        MockSynthIOracle _oracle,
        address _minter,
        address _priceSetter
    ) {
        synth = _synth;
        usdc = _usdc;
        oracle = _oracle;
        minter = _minter;
        priceSetter = _priceSetter;
    }

    function openAndMint(uint256 collateral, uint256 mintFraction) public {
        collateral = bound(collateral, 1000 ether, 1_000_000 ether);
        mintFraction = bound(mintFraction, 1, 5000); // up to 50% of max

        usdc.mint(minter, collateral);
        vm.prank(minter);
        usdc.approve(address(synth), collateral);

        vm.prank(minter);
        try synth.openPosition(0, collateral) returns (uint256 posId) {
            activePositions.push(posId);
            ghost_positionCount++;

            uint256 effectiveCR = synth.effectiveMinCRatio(0, minter);
            uint256 maxSynth = (collateral * 10000 * 1e18) / (SYNTH_PRICE * effectiveCR);
            uint256 synthAmt = (maxSynth * mintFraction) / 10000;
            if (synthAmt == 0) return;

            vm.prank(minter);
            try synth.mintSynth(posId, synthAmt) {
                ghost_totalMinted += synthAmt;
            } catch {}
        } catch {}
    }

    function burnSynth(uint256 posSeed, uint256 burnFraction) public {
        if (activePositions.length == 0) return;

        uint256 posId = activePositions[posSeed % activePositions.length];
        burnFraction = bound(burnFraction, 1, 10000);

        try synth.getPosition(posId) returns (IVibeSynth.SynthPosition memory pos) {
            if (pos.state != IVibeSynth.PositionState.ACTIVE) return;
            if (pos.mintedAmount == 0) return;

            uint256 burnAmt = (pos.mintedAmount * burnFraction) / 10000;
            if (burnAmt == 0) burnAmt = 1;
            if (burnAmt > pos.mintedAmount) burnAmt = pos.mintedAmount;

            vm.prank(minter);
            try synth.burnSynth(posId, burnAmt) {
                ghost_totalBurned += burnAmt;
            } catch {}
        } catch {}
    }

    function addCollateral(uint256 posSeed, uint256 addAmount) public {
        if (activePositions.length == 0) return;

        uint256 posId = activePositions[posSeed % activePositions.length];
        addAmount = bound(addAmount, 1 ether, 100_000 ether);

        try synth.getPosition(posId) returns (IVibeSynth.SynthPosition memory pos) {
            if (pos.state != IVibeSynth.PositionState.ACTIVE) return;

            usdc.mint(minter, addAmount);
            vm.prank(minter);
            usdc.approve(address(synth), addAmount);

            vm.prank(minter);
            try synth.addCollateral(posId, addAmount) {} catch {}
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 30 days);
        vm.warp(block.timestamp + delta);
    }

    function getActiveCount() external view returns (uint256) {
        return activePositions.length;
    }
}

// ============ Invariant Tests ============

contract VibeSynthInvariantTest is StdInvariant, Test {
    VibeSynth public synth;
    MockSynthIToken public usdc;
    MockSynthIToken public jul;
    MockSynthIOracle public oracle;
    SynthHandler public handler;

    address public minter;
    address public priceSetter;

    uint256 constant SYNTH_PRICE = 1000 ether;
    uint16 constant MIN_CR = 15000;
    uint16 constant LIQ_CR = 12000;
    uint16 constant LIQ_PENALTY = 1000;

    function setUp() public {
        minter = makeAddr("minter");
        priceSetter = makeAddr("priceSetter");

        jul = new MockSynthIToken("JUL", "JUL");
        usdc = new MockSynthIToken("USDC", "USDC");
        oracle = new MockSynthIOracle();

        synth = new VibeSynth(address(jul), address(oracle), address(usdc));

        oracle.setTier(minter, 3);

        jul.mint(address(this), 10_000_000 ether);
        jul.approve(address(synth), type(uint256).max);

        synth.setPriceSetter(priceSetter, true);

        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "Synthetic Bitcoin",
            symbol: "vBTC",
            initialPrice: SYNTH_PRICE,
            minCRatioBps: MIN_CR,
            liquidationCRatioBps: LIQ_CR,
            liquidationPenaltyBps: LIQ_PENALTY
        }));

        handler = new SynthHandler(synth, usdc, oracle, minter, priceSetter);
        targetContract(address(handler));
    }

    // ============ Invariant: position count = ghost count ============

    function invariant_positionCountConsistent() public view {
        assertEq(
            synth.totalPositions(),
            handler.ghost_positionCount(),
            "POSITIONS: count mismatch"
        );
    }

    // ============ Invariant: minted >= burned ============

    function invariant_mintedGeBurned() public view {
        assertGe(
            handler.ghost_totalMinted(),
            handler.ghost_totalBurned(),
            "FLOW: burned exceeds minted"
        );
    }

    // ============ Invariant: no-debt positions have infinite C-ratio ============

    function invariant_noDebtInfiniteCRatio() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 posId = handler.activePositions(i);
            try synth.getPosition(posId) returns (IVibeSynth.SynthPosition memory pos) {
                if (pos.state != IVibeSynth.PositionState.ACTIVE) continue;
                if (pos.mintedAmount == 0) {
                    uint256 cr = synth.collateralRatio(posId);
                    assertEq(cr, type(uint256).max, "CRATIO: no debt must be infinite");
                }
            } catch {}
        }
    }

    // ============ Invariant: valid position state ============

    function invariant_validPositionState() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 posId = handler.activePositions(i);
            try synth.getPosition(posId) returns (IVibeSynth.SynthPosition memory pos) {
                uint8 state = uint8(pos.state);
                assertTrue(
                    state <= uint8(IVibeSynth.PositionState.LIQUIDATED),
                    "STATE: invalid position state"
                );
            } catch {}
        }
    }

    // ============ Invariant: active positions have collateral > 0 ============

    function invariant_activePositionHasCollateral() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 posId = handler.activePositions(i);
            try synth.getPosition(posId) returns (IVibeSynth.SynthPosition memory pos) {
                if (pos.state == IVibeSynth.PositionState.ACTIVE) {
                    assertGt(pos.collateralAmount, 0, "COLLATERAL: active position must have collateral");
                }
            } catch {}
        }
    }
}
