// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeSynth.sol";
import "../../contracts/financial/interfaces/IVibeSynth.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockSynthFToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockSynthFOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Fuzz Tests ============

contract VibeSynthFuzzTest is Test {
    VibeSynth public synth;
    MockSynthFToken public usdc;
    MockSynthFToken public jul;
    MockSynthFOracle public oracle;

    address public minter;
    address public priceSetter;

    uint256 constant SYNTH_PRICE = 1000 ether;
    uint16 constant MIN_CR = 15000;     // 150%
    uint16 constant LIQ_CR = 12000;     // 120%
    uint16 constant LIQ_PENALTY = 1000; // 10%

    function setUp() public {
        minter = makeAddr("minter");
        priceSetter = makeAddr("priceSetter");

        jul = new MockSynthFToken("JUL", "JUL");
        usdc = new MockSynthFToken("USDC", "USDC");
        oracle = new MockSynthFOracle();

        synth = new VibeSynth(address(jul), address(oracle), address(usdc));

        oracle.setTier(minter, 3); // tier 3 = 1500 bps reduction

        usdc.mint(minter, 100_000_000 ether);
        jul.mint(address(this), 10_000_000 ether);

        vm.prank(minter);
        usdc.approve(address(synth), type(uint256).max);
        jul.approve(address(synth), type(uint256).max);

        synth.setPriceSetter(priceSetter, true);

        // Register vBTC
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "Synthetic Bitcoin",
            symbol: "vBTC",
            initialPrice: SYNTH_PRICE,
            minCRatioBps: MIN_CR,
            liquidationCRatioBps: LIQ_CR,
            liquidationPenaltyBps: LIQ_PENALTY
        }));
    }

    // ============ Fuzz: C-ratio correct after deposit ============

    function testFuzz_cRatioInfiniteWithNoDebt(uint256 collateral) public {
        collateral = bound(collateral, 1 ether, 10_000_000 ether);

        vm.prank(minter);
        uint256 posId = synth.openPosition(0, collateral);

        uint256 cRatio = synth.collateralRatio(posId);
        assertEq(cRatio, type(uint256).max, "No debt = infinite C-ratio");
    }

    // ============ Fuzz: mint respects C-ratio ============

    function testFuzz_mintRespectsMinCRatio(uint256 collateral, uint256 synthAmount) public {
        collateral = bound(collateral, 100 ether, 10_000_000 ether);

        vm.prank(minter);
        uint256 posId = synth.openPosition(0, collateral);

        // Effective min C-ratio for tier 3: 15000 - 1500 = 13500 bps
        uint256 effectiveCR = synth.effectiveMinCRatio(0, minter);
        // Max synth = collateral * 10000 / (price * effectiveCR / 10000)
        // = collateral * 10000 * 1e18 / (price * effectiveCR)
        uint256 maxSynth = (collateral * 10000 * 1e18) / (SYNTH_PRICE * effectiveCR);

        synthAmount = bound(synthAmount, 1, maxSynth + 10 ether);

        if (synthAmount <= maxSynth) {
            vm.prank(minter);
            synth.mintSynth(posId, synthAmount);

            IVibeSynth.SynthPosition memory pos = synth.getPosition(posId);
            assertEq(pos.mintedAmount, synthAmount, "Minted amount stored");
        } else {
            vm.prank(minter);
            vm.expectRevert(IVibeSynth.BelowMinCRatio.selector);
            synth.mintSynth(posId, synthAmount);
        }
    }

    // ============ Fuzz: add collateral improves C-ratio ============

    function testFuzz_addCollateralImprovesCRatio(uint256 collateral, uint256 addAmount) public {
        collateral = bound(collateral, 1000 ether, 1_000_000 ether);
        addAmount = bound(addAmount, 1 ether, 1_000_000 ether);

        vm.prank(minter);
        uint256 posId = synth.openPosition(0, collateral);

        // Mint some synth to create debt
        uint256 effectiveCR = synth.effectiveMinCRatio(0, minter);
        uint256 maxSynth = (collateral * 10000 * 1e18) / (SYNTH_PRICE * effectiveCR);
        uint256 synthAmt = maxSynth / 2;
        if (synthAmt == 0) return;

        vm.prank(minter);
        synth.mintSynth(posId, synthAmt);

        uint256 cRatioBefore = synth.collateralRatio(posId);

        usdc.mint(minter, addAmount);
        vm.prank(minter);
        synth.addCollateral(posId, addAmount);

        uint256 cRatioAfter = synth.collateralRatio(posId);
        // assertGe (not assertGt) because integer division in BPS may round equally
        assertGe(cRatioAfter, cRatioBefore, "Adding collateral must not decrease C-ratio");
    }

    // ============ Fuzz: burn synth reduces debt ============

    function testFuzz_burnReducesDebt(uint256 collateral, uint256 burnFraction) public {
        collateral = bound(collateral, 1000 ether, 1_000_000 ether);
        burnFraction = bound(burnFraction, 1, 10000);

        vm.prank(minter);
        uint256 posId = synth.openPosition(0, collateral);

        uint256 effectiveCR = synth.effectiveMinCRatio(0, minter);
        uint256 maxSynth = (collateral * 10000 * 1e18) / (SYNTH_PRICE * effectiveCR);
        uint256 synthAmt = maxSynth / 2;
        if (synthAmt == 0) return;

        vm.prank(minter);
        synth.mintSynth(posId, synthAmt);

        uint256 burnAmount = (synthAmt * burnFraction) / 10000;
        if (burnAmount == 0) burnAmount = 1;
        if (burnAmount > synthAmt) burnAmount = synthAmt;

        vm.prank(minter);
        synth.burnSynth(posId, burnAmount);

        IVibeSynth.SynthPosition memory pos = synth.getPosition(posId);
        assertEq(pos.mintedAmount, synthAmt - burnAmount, "Minted reduced by burn amount");
    }

    // ============ Fuzz: close position returns collateral ============

    function testFuzz_closeReturnsCollateral(uint256 collateral) public {
        collateral = bound(collateral, 1 ether, 10_000_000 ether);

        vm.prank(minter);
        uint256 posId = synth.openPosition(0, collateral);

        uint256 balBefore = usdc.balanceOf(minter);

        vm.prank(minter);
        synth.closePosition(posId);

        assertEq(usdc.balanceOf(minter), balBefore + collateral, "Full collateral returned");

        IVibeSynth.SynthPosition memory pos = synth.getPosition(posId);
        assertEq(uint8(pos.state), uint8(IVibeSynth.PositionState.CLOSED));
    }

    // ============ Fuzz: liquidation triggers below threshold ============

    function testFuzz_liquidatableBelowThreshold(uint256 collateral) public {
        collateral = bound(collateral, 1500 ether, 10_000_000 ether);

        vm.prank(minter);
        uint256 posId = synth.openPosition(0, collateral);

        // Mint near max
        uint256 effectiveCR = synth.effectiveMinCRatio(0, minter);
        uint256 maxSynth = (collateral * 10000 * 1e18) / (SYNTH_PRICE * effectiveCR);
        if (maxSynth == 0) return;

        vm.prank(minter);
        synth.mintSynth(posId, maxSynth);

        // Not liquidatable at current price
        assertFalse(synth.isLiquidatable(posId), "Should not be liquidatable initially");

        // Double the price → C-ratio halves → should be liquidatable
        vm.prank(priceSetter);
        synth.updatePrice(0, SYNTH_PRICE * 2);

        assertTrue(synth.isLiquidatable(posId), "Should be liquidatable after price increase");
    }
}
