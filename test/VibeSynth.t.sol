// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/financial/VibeSynth.sol";
import "../contracts/financial/interfaces/IVibeSynth.sol";
import "../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockSynthToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockSynthOracle is IReputationOracle {
    mapping(address => uint8) public tiers;

    function setTier(address user, uint8 tier) external {
        tiers[user] = tier;
    }

    function getTrustScore(address user) external view returns (uint256) {
        return uint256(tiers[user]) * 2500;
    }

    function getTrustTier(address user) external view returns (uint8) {
        return tiers[user];
    }

    function isEligible(address user, uint8 requiredTier) external view returns (bool) {
        return tiers[user] >= requiredTier;
    }
}

// ============ Test Contract ============

contract VibeSynthTest is Test {
    VibeSynth public synth;
    MockSynthToken public usdc;
    MockSynthToken public jul;
    MockSynthOracle public oracle;

    // ============ Actors ============

    address public alice;     // minter
    address public bob;       // minter #2
    address public charlie;   // keeper / liquidator
    address public priceSetter;

    // ============ Constants ============

    uint256 constant COLLATERAL = 10_000 ether;
    uint256 constant SYNTH_PRICE = 1000 ether;  // 1 vBTC = 1000 USDC
    uint16  constant MIN_CR = 15000;             // 150%
    uint16  constant LIQ_CR = 12000;             // 120%
    uint16  constant LIQ_PENALTY = 1000;         // 10%

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        priceSetter = makeAddr("priceSetter");

        jul = new MockSynthToken("JUL Token", "JUL");
        usdc = new MockSynthToken("USD Coin", "USDC");
        oracle = new MockSynthOracle();

        synth = new VibeSynth(address(jul), address(oracle), address(usdc));

        // Set tiers
        oracle.setTier(alice, 3);    // established
        oracle.setTier(bob, 2);      // default
        oracle.setTier(charlie, 1);  // low

        // Mint tokens
        usdc.mint(alice, 100_000_000 ether);
        usdc.mint(bob, 100_000_000 ether);
        jul.mint(alice, 10_000_000 ether);
        jul.mint(address(this), 10_000_000 ether);

        // Approvals
        vm.prank(alice);
        usdc.approve(address(synth), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(synth), type(uint256).max);
        vm.prank(alice);
        jul.approve(address(synth), type(uint256).max);
        jul.approve(address(synth), type(uint256).max); // test contract

        // Authorize price setter
        synth.setPriceSetter(priceSetter, true);
    }

    // ============ Helpers ============

    function _registerVBTC() internal returns (uint8 id) {
        id = synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "Synthetic Bitcoin",
            symbol: "vBTC",
            initialPrice: SYNTH_PRICE,
            minCRatioBps: MIN_CR,
            liquidationCRatioBps: LIQ_CR,
            liquidationPenaltyBps: LIQ_PENALTY
        }));
    }

    function _openDefaultPosition() internal returns (uint256 positionId) {
        _registerVBTC();
        vm.prank(alice);
        positionId = synth.openPosition(0, COLLATERAL);
    }

    function _openAndMint(uint256 collateral, uint256 synthAmt) internal returns (uint256 positionId) {
        _registerVBTC();
        vm.prank(alice);
        positionId = synth.openPosition(0, collateral);
        vm.prank(alice);
        synth.mintSynth(positionId, synthAmt);
    }

    // ============ Constructor Tests ============

    function test_constructor_zeroJulReverts() public {
        vm.expectRevert(IVibeSynth.ZeroAddress.selector);
        new VibeSynth(address(0), address(oracle), address(usdc));
    }

    function test_constructor_zeroOracleReverts() public {
        vm.expectRevert(IVibeSynth.ZeroAddress.selector);
        new VibeSynth(address(jul), address(0), address(usdc));
    }

    function test_constructor_zeroCollateralReverts() public {
        vm.expectRevert(IVibeSynth.ZeroAddress.selector);
        new VibeSynth(address(jul), address(oracle), address(0));
    }

    function test_constructor_initialState() public view {
        assertEq(synth.totalPositions(), 0);
        assertEq(synth.totalSynthAssets(), 0);
        assertEq(address(synth.julToken()), address(jul));
        assertEq(address(synth.reputationOracle()), address(oracle));
        assertEq(address(synth.collateralToken()), address(usdc));
        assertEq(synth.name(), "VibeSwap Synthetic Position");
        assertEq(synth.symbol(), "VSYNTH");
    }

    // ============ Register Synth Asset Tests ============

    function test_register_success() public {
        uint8 id = _registerVBTC();
        assertEq(id, 0);
        assertEq(synth.totalSynthAssets(), 1);

        IVibeSynth.SynthAsset memory asset = synth.getSynthAsset(0);
        assertEq(asset.currentPrice, SYNTH_PRICE);
        assertEq(asset.minCRatioBps, MIN_CR);
        assertEq(asset.liquidationCRatioBps, LIQ_CR);
        assertEq(asset.liquidationPenaltyBps, LIQ_PENALTY);
        assertTrue(asset.active);
    }

    function test_register_invalidCRatio_reverts() public {
        vm.expectRevert(IVibeSynth.InvalidCRatio.selector);
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "Bad", symbol: "BAD", initialPrice: 100 ether,
            minCRatioBps: 10000, // 100% — must be > 100%
            liquidationCRatioBps: 8000,
            liquidationPenaltyBps: 1000
        }));
    }

    function test_register_invalidLiquidationParams_reverts() public {
        // liquidation >= min
        vm.expectRevert(IVibeSynth.InvalidLiquidationParams.selector);
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "Bad", symbol: "BAD", initialPrice: 100 ether,
            minCRatioBps: 15000,
            liquidationCRatioBps: 15000, // same as min — invalid
            liquidationPenaltyBps: 1000
        }));
    }

    function test_register_zeroPriceReverts() public {
        vm.expectRevert(IVibeSynth.InvalidPrice.selector);
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "Bad", symbol: "BAD", initialPrice: 0,
            minCRatioBps: 15000, liquidationCRatioBps: 12000, liquidationPenaltyBps: 1000
        }));
    }

    // ============ Price Update Tests ============

    function test_updatePrice_authorized() public {
        _registerVBTC();

        // Price setter bounded by maxPriceJumpBps (20%) — update within limit
        vm.prank(priceSetter);
        synth.updatePrice(0, 1200 ether); // +20% from 1000

        assertEq(synth.getSynthAsset(0).currentPrice, 1200 ether);
    }

    function test_updatePrice_ownerCanUpdate() public {
        _registerVBTC();
        synth.updatePrice(0, 500 ether);
        assertEq(synth.getSynthAsset(0).currentPrice, 500 ether);
    }

    function test_updatePrice_unauthorized_reverts() public {
        _registerVBTC();
        vm.expectRevert(IVibeSynth.NotAuthorizedPriceSetter.selector);
        vm.prank(charlie);
        synth.updatePrice(0, 2000 ether);
    }

    // ============ Open Position Tests ============

    function test_openPosition_success() public {
        _registerVBTC();

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 id = synth.openPosition(0, COLLATERAL);

        assertEq(id, 1);
        assertEq(synth.totalPositions(), 1);
        assertEq(synth.ownerOf(id), alice);
        assertEq(usdc.balanceOf(alice), balBefore - COLLATERAL);

        IVibeSynth.SynthPosition memory pos = synth.getPosition(id);
        assertEq(pos.minter, alice);
        assertEq(pos.collateralAmount, COLLATERAL);
        assertEq(pos.mintedAmount, 0);
        assertEq(pos.synthAssetId, 0);
        assertEq(uint8(pos.state), uint8(IVibeSynth.PositionState.ACTIVE));
    }

    function test_openPosition_zeroCollateral_reverts() public {
        _registerVBTC();
        vm.expectRevert(IVibeSynth.ZeroAmount.selector);
        vm.prank(alice);
        synth.openPosition(0, 0);
    }

    function test_openPosition_inactiveSynth_reverts() public {
        _registerVBTC();
        synth.deactivateSynthAsset(0);

        vm.expectRevert(IVibeSynth.SynthAssetNotActive.selector);
        vm.prank(alice);
        synth.openPosition(0, COLLATERAL);
    }

    function test_openPosition_invalidSynth_reverts() public {
        vm.expectRevert(IVibeSynth.InvalidSynthAsset.selector);
        vm.prank(alice);
        synth.openPosition(99, COLLATERAL);
    }

    // ============ Mint Synth Tests ============

    function test_mintSynth_withinCRatio() public {
        uint256 id = _openDefaultPosition();

        // Alice tier 3 → reduction 1500 BPS → effective min CR = 15000 - 1500 = 13500 (135%)
        // Collateral = 10000, price = 1000
        // Max mint: 10000 / (1000 * 13500/10000) = 10000 / 1350 ≈ 7.407 ether
        vm.prank(alice);
        synth.mintSynth(id, 7 ether);

        IVibeSynth.SynthPosition memory pos = synth.getPosition(id);
        assertEq(pos.mintedAmount, 7 ether);
        assertEq(synth.getSynthAsset(0).totalMinted, 7 ether);
    }

    function test_mintSynth_exceedsCRatio_reverts() public {
        uint256 id = _openDefaultPosition();

        // Try to mint way too much
        vm.expectRevert(IVibeSynth.BelowMinCRatio.selector);
        vm.prank(alice);
        synth.mintSynth(id, 100 ether); // would need 100*1000*1.35 = 135000 collateral
    }

    function test_mintSynth_notOwner_reverts() public {
        uint256 id = _openDefaultPosition();

        vm.expectRevert(IVibeSynth.NotPositionOwner.selector);
        vm.prank(bob);
        synth.mintSynth(id, 1 ether);
    }

    function test_mintSynth_inactiveSynth_reverts() public {
        uint256 id = _openDefaultPosition();
        synth.deactivateSynthAsset(0);

        vm.expectRevert(IVibeSynth.SynthAssetNotActive.selector);
        vm.prank(alice);
        synth.mintSynth(id, 1 ether);
    }

    function test_mintSynth_multipleMints_accumulate() public {
        uint256 id = _openDefaultPosition();

        vm.prank(alice);
        synth.mintSynth(id, 2 ether);
        vm.prank(alice);
        synth.mintSynth(id, 3 ether);

        assertEq(synth.getPosition(id).mintedAmount, 5 ether);
        assertEq(synth.getSynthAsset(0).totalMinted, 5 ether);
    }

    // ============ Burn Synth Tests ============

    function test_burnSynth_partial() public {
        uint256 id = _openAndMint(COLLATERAL, 5 ether);

        vm.prank(alice);
        synth.burnSynth(id, 2 ether);

        assertEq(synth.getPosition(id).mintedAmount, 3 ether);
        assertEq(synth.getSynthAsset(0).totalMinted, 3 ether);
    }

    function test_burnSynth_full() public {
        uint256 id = _openAndMint(COLLATERAL, 5 ether);

        vm.prank(alice);
        synth.burnSynth(id, 5 ether);

        assertEq(synth.getPosition(id).mintedAmount, 0);
        assertEq(synth.getSynthAsset(0).totalMinted, 0);
    }

    function test_burnSynth_exceedsMinted_reverts() public {
        uint256 id = _openAndMint(COLLATERAL, 5 ether);

        vm.expectRevert(IVibeSynth.ExceedsMintedAmount.selector);
        vm.prank(alice);
        synth.burnSynth(id, 6 ether);
    }

    // ============ Collateral Tests ============

    function test_addCollateral_success() public {
        uint256 id = _openDefaultPosition();

        vm.prank(alice);
        synth.addCollateral(id, 5000 ether);

        assertEq(synth.getPosition(id).collateralAmount, COLLATERAL + 5000 ether);
    }

    function test_withdrawCollateral_withinCRatio() public {
        uint256 id = _openAndMint(COLLATERAL, 3 ether);

        // Debt = 3 * 1000 = 3000, min CR = 13500 (alice tier 3)
        // Required collateral = 3000 * 13500/10000 = 4050
        // Can withdraw 10000 - 4050 = 5950
        vm.prank(alice);
        synth.withdrawCollateral(id, 5000 ether);

        assertEq(synth.getPosition(id).collateralAmount, 5000 ether);
    }

    function test_withdrawCollateral_belowCRatio_reverts() public {
        uint256 id = _openAndMint(COLLATERAL, 5 ether);

        // Debt = 5000, required = 5000*1.35 = 6750
        // Try to withdraw down to 1000 — below 6750
        vm.expectRevert(IVibeSynth.BelowMinCRatio.selector);
        vm.prank(alice);
        synth.withdrawCollateral(id, 9000 ether);
    }

    function test_withdrawCollateral_noDebt_full() public {
        uint256 id = _openDefaultPosition();

        // No debt — can withdraw everything
        vm.prank(alice);
        synth.withdrawCollateral(id, COLLATERAL);

        assertEq(synth.getPosition(id).collateralAmount, 0);
    }

    // ============ Close Position Tests ============

    function test_closePosition_success() public {
        uint256 id = _openDefaultPosition();

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        synth.closePosition(id);

        assertEq(usdc.balanceOf(alice), aliceBefore + COLLATERAL);
        assertEq(uint8(synth.getPosition(id).state), uint8(IVibeSynth.PositionState.CLOSED));
    }

    function test_closePosition_withDebt_reverts() public {
        uint256 id = _openAndMint(COLLATERAL, 3 ether);

        vm.expectRevert(IVibeSynth.HasOutstandingDebt.selector);
        vm.prank(alice);
        synth.closePosition(id);
    }

    function test_closePosition_afterBurnAll() public {
        uint256 id = _openAndMint(COLLATERAL, 5 ether);

        vm.prank(alice);
        synth.burnSynth(id, 5 ether);

        vm.prank(alice);
        synth.closePosition(id);

        assertEq(uint8(synth.getPosition(id).state), uint8(IVibeSynth.PositionState.CLOSED));
    }

    // ============ Liquidation Tests ============

    function test_liquidation_belowThreshold() public {
        uint256 id = _openAndMint(COLLATERAL, 6 ether);

        // C-ratio = 10000 / (6*1000) = 166% → not liquidatable
        assertFalse(synth.isLiquidatable(id));

        // Price jumps to 1500 → debt = 6*1500=9000 → CR = 10000/9000 = 111% → below 120%
        // Owner bypasses price jump limit for emergency simulation
        synth.updatePrice(0, 1500 ether);

        assertTrue(synth.isLiquidatable(id));
    }

    function test_liquidation_notLiquidatable_reverts() public {
        uint256 id = _openAndMint(COLLATERAL, 3 ether);

        vm.expectRevert(IVibeSynth.NotLiquidatable.selector);
        vm.prank(charlie);
        synth.liquidate(id);
    }

    function test_liquidation_keeperTipPaid() public {
        synth.depositJulRewards(100 ether);

        uint256 id = _openAndMint(COLLATERAL, 6 ether);

        // Make liquidatable — owner bypasses jump limit
        synth.updatePrice(0, 1500 ether);

        uint256 charlieBefore = jul.balanceOf(charlie);
        vm.prank(charlie);
        synth.liquidate(id);

        assertEq(jul.balanceOf(charlie), charlieBefore + 10 ether);
        assertEq(synth.julRewardPool(), 90 ether);
    }

    function test_liquidation_penaltyCalculated() public {
        synth.depositJulRewards(100 ether);

        uint256 id = _openAndMint(COLLATERAL, 6 ether);

        // Price = 1500, debt = 6*1500 = 9000
        // Penalty = 9000 * 10% = 900
        // Total seized = 9000 + 900 = 9900
        // Collateral returned = 10000 - 9900 = 100
        // Owner bypasses jump limit
        synth.updatePrice(0, 1500 ether);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(charlie);
        synth.liquidate(id);

        uint256 returned = usdc.balanceOf(alice) - aliceBefore;
        assertEq(returned, 100 ether);
        assertEq(synth.protocolRevenue(), 9900 ether);

        IVibeSynth.SynthPosition memory pos = synth.getPosition(id);
        assertEq(uint8(pos.state), uint8(IVibeSynth.PositionState.LIQUIDATED));
        assertEq(pos.mintedAmount, 0);
        assertEq(pos.collateralAmount, 0);
    }

    function test_liquidation_underwater_noReturn() public {
        synth.depositJulRewards(100 ether);

        uint256 id = _openAndMint(COLLATERAL, 6 ether);

        // Price = 2000, debt = 12000, penalty = 1200, total = 13200 > 10000 collateral
        // All collateral seized, nothing returned — owner bypasses jump limit
        synth.updatePrice(0, 2000 ether);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(charlie);
        synth.liquidate(id);

        assertEq(usdc.balanceOf(alice), aliceBefore); // nothing returned
        assertEq(synth.protocolRevenue(), COLLATERAL); // all seized
    }

    // ============ Reputation Gating Tests ============

    function test_reputation_tierReducesCRatio() public {
        _registerVBTC();

        // Alice tier 3 → reduction 1500 → effective 13500
        assertEq(synth.effectiveMinCRatio(0, alice), 13500);

        // Bob tier 2 → reduction 1000 → effective 14000
        assertEq(synth.effectiveMinCRatio(0, bob), 14000);

        // Charlie tier 1 → reduction 500 → effective 14500
        assertEq(synth.effectiveMinCRatio(0, charlie), 14500);
    }

    function test_reputation_tier0_noReduction() public {
        _registerVBTC();
        oracle.setTier(alice, 0);
        assertEq(synth.effectiveMinCRatio(0, alice), 15000); // no reduction
    }

    function test_reputation_tier4_maxReduction() public {
        _registerVBTC();
        oracle.setTier(alice, 4);
        // reduction 2000, effective = 15000 - 2000 = 13000
        assertEq(synth.effectiveMinCRatio(0, alice), 13000);
    }

    // ============ JUL Integration Tests ============

    function test_jul_collateralBonus() public {
        // Register vBTC on main synth (USDC collateral) for comparison
        _registerVBTC();

        // Deploy VibeSynth with JUL as collateral
        VibeSynth julSynth = new VibeSynth(address(jul), address(oracle), address(jul));

        julSynth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "Synthetic Bitcoin",
            symbol: "vBTC",
            initialPrice: SYNTH_PRICE,
            minCRatioBps: MIN_CR,
            liquidationCRatioBps: LIQ_CR,
            liquidationPenaltyBps: LIQ_PENALTY
        }));

        // Alice tier 3 → reduction 1500 + JUL bonus 500 = 2000 total
        // effective = 15000 - 2000 = 13000
        assertEq(julSynth.effectiveMinCRatio(0, alice), 13000);

        // Without JUL collateral: 15000 - 1500 = 13500
        assertEq(synth.effectiveMinCRatio(0, alice), 13500);
    }

    function test_jul_rewardPoolDeposit() public {
        synth.depositJulRewards(50 ether);
        assertEq(synth.julRewardPool(), 50 ether);
    }

    // ============ ERC-721 Tests ============

    function test_erc721_transferUpdatesMinter() public {
        uint256 id = _openDefaultPosition();
        assertEq(synth.getPosition(id).minter, alice);

        vm.prank(alice);
        synth.transferFrom(alice, bob, id);

        assertEq(synth.ownerOf(id), bob);
        assertEq(synth.getPosition(id).minter, bob);
    }

    function test_erc721_newOwnerCanClose() public {
        uint256 id = _openDefaultPosition();

        vm.prank(alice);
        synth.transferFrom(alice, bob, id);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        synth.closePosition(id);

        assertEq(usdc.balanceOf(bob), bobBefore + COLLATERAL);
    }

    // ============ Integration Tests ============

    function test_integration_fullLifecycle() public {
        // 1. Register synth asset
        _registerVBTC();

        // 2. Alice opens position with 10k collateral
        vm.prank(alice);
        uint256 id = synth.openPosition(0, COLLATERAL);

        // 3. Alice mints 5 vBTC (debt = 5000 at price 1000)
        vm.prank(alice);
        synth.mintSynth(id, 5 ether);

        // 4. Check C-ratio: 10000/5000 = 200%
        assertEq(synth.collateralRatio(id), 20000);

        // 5. Price goes up to 1200 → debt = 6000 → CR = 166%
        // Within 20% jump limit, price setter can do this
        vm.prank(priceSetter);
        synth.updatePrice(0, 1200 ether);
        assertEq(synth.collateralRatio(id), 16666); // 166.66%

        // 6. Alice burns all synths
        vm.prank(alice);
        synth.burnSynth(id, 5 ether);

        // 7. Alice closes position and reclaims collateral
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        synth.closePosition(id);

        assertEq(usdc.balanceOf(alice), aliceBefore + COLLATERAL);
        assertEq(uint8(synth.getPosition(id).state), uint8(IVibeSynth.PositionState.CLOSED));
        assertEq(synth.getSynthAsset(0).totalMinted, 0);
    }

    function test_integration_multiPosition() public {
        _registerVBTC();

        vm.prank(alice);
        uint256 id1 = synth.openPosition(0, COLLATERAL);
        vm.prank(alice);
        synth.mintSynth(id1, 3 ether);

        vm.prank(bob);
        uint256 id2 = synth.openPosition(0, 20_000 ether);
        vm.prank(bob);
        synth.mintSynth(id2, 5 ether);

        assertEq(synth.totalPositions(), 2);
        assertEq(synth.getSynthAsset(0).totalMinted, 8 ether);

        // Burn and close one
        vm.prank(alice);
        synth.burnSynth(id1, 3 ether);
        vm.prank(alice);
        synth.closePosition(id1);

        assertEq(synth.getSynthAsset(0).totalMinted, 5 ether);
    }

    function test_integration_liquidateAndRecover() public {
        synth.depositJulRewards(100 ether);
        _registerVBTC();

        // Alice opens and mints near the limit
        vm.prank(alice);
        uint256 id = synth.openPosition(0, COLLATERAL);
        vm.prank(alice);
        synth.mintSynth(id, 7 ether); // debt = 7000, CR = 142%

        // Price spike makes it liquidatable — owner bypasses jump limit
        synth.updatePrice(0, 1200 ether); // debt = 8400, CR = 119% < 120%

        assertTrue(synth.isLiquidatable(id));

        // Charlie liquidates
        vm.prank(charlie);
        synth.liquidate(id);

        assertEq(uint8(synth.getPosition(id).state), uint8(IVibeSynth.PositionState.LIQUIDATED));
        assertEq(synth.getSynthAsset(0).totalMinted, 0);
        assertTrue(synth.protocolRevenue() > 0);

        // Owner withdraws protocol revenue
        uint256 revenue = synth.protocolRevenue();
        uint256 ownerBefore = usdc.balanceOf(address(this));
        synth.withdrawProtocolRevenue(revenue);

        assertEq(usdc.balanceOf(address(this)), ownerBefore + revenue);
        assertEq(synth.protocolRevenue(), 0);
    }

    // ============ Collateral Ratio View Tests ============

    function test_collateralRatio_noDebt() public {
        uint256 id = _openDefaultPosition();
        assertEq(synth.collateralRatio(id), type(uint256).max);
    }

    function test_collateralRatio_calculatedCorrectly() public {
        uint256 id = _openAndMint(COLLATERAL, 5 ether);
        // CR = 10000 * 10000 / (5 * 1000) = 20000 BPS = 200%
        assertEq(synth.collateralRatio(id), 20000);
    }

    // ============ Price Jump Validation Tests ============

    function test_priceJump_default20percent() public view {
        assertEq(synth.maxPriceJumpBps(), 2000);
    }

    function test_priceJump_withinLimit_succeeds() public {
        _registerVBTC();
        // 20% up from 1000 = 1200 — exactly at limit
        vm.prank(priceSetter);
        synth.updatePrice(0, 1200 ether);
        assertEq(synth.getSynthAsset(0).currentPrice, 1200 ether);

        // 20% down from 1200 = 960 — exactly at limit
        vm.prank(priceSetter);
        synth.updatePrice(0, 960 ether);
        assertEq(synth.getSynthAsset(0).currentPrice, 960 ether);
    }

    function test_priceJump_exceedsLimit_reverts() public {
        _registerVBTC();
        // 21% up from 1000 = 1210 — over limit
        vm.expectRevert(IVibeSynth.PriceJumpExceeded.selector);
        vm.prank(priceSetter);
        synth.updatePrice(0, 1210 ether);
    }

    function test_priceJump_exceedsLimitDown_reverts() public {
        _registerVBTC();
        // 21% down from 1000 = 790 — over limit
        vm.expectRevert(IVibeSynth.PriceJumpExceeded.selector);
        vm.prank(priceSetter);
        synth.updatePrice(0, 790 ether);
    }

    function test_priceJump_ownerBypasses() public {
        _registerVBTC();
        // Owner can make 100% jump
        synth.updatePrice(0, 2000 ether);
        assertEq(synth.getSynthAsset(0).currentPrice, 2000 ether);
    }

    function test_priceJump_incrementalUpdates() public {
        _registerVBTC();
        // Price setter can reach 2000 via incremental updates
        vm.startPrank(priceSetter);
        synth.updatePrice(0, 1200 ether); // +20%
        synth.updatePrice(0, 1440 ether); // +20%
        synth.updatePrice(0, 1728 ether); // +20%
        synth.updatePrice(0, 2073 ether); // +19.9%
        vm.stopPrank();
        assertGt(synth.getSynthAsset(0).currentPrice, 2000 ether);
    }

    function test_setMaxPriceJump_succeeds() public {
        synth.setMaxPriceJump(3000); // 30%
        assertEq(synth.maxPriceJumpBps(), 3000);

        // Now price setter can do 30% jumps
        _registerVBTC();
        vm.prank(priceSetter);
        synth.updatePrice(0, 1300 ether); // +30%
        assertEq(synth.getSynthAsset(0).currentPrice, 1300 ether);
    }

    function test_setMaxPriceJump_disabled() public {
        synth.setMaxPriceJump(0); // Disable
        assertEq(synth.maxPriceJumpBps(), 0);

        // Price setter can do any jump
        _registerVBTC();
        vm.prank(priceSetter);
        synth.updatePrice(0, 5000 ether); // +400%
        assertEq(synth.getSynthAsset(0).currentPrice, 5000 ether);
    }

    function test_setMaxPriceJump_exceedsMax_reverts() public {
        vm.expectRevert(IVibeSynth.InvalidJumpLimit.selector);
        synth.setMaxPriceJump(5001); // Over 50% cap
    }

    function test_setMaxPriceJump_onlyOwner_reverts() public {
        vm.expectRevert();
        vm.prank(alice);
        synth.setMaxPriceJump(3000);
    }

    event MaxPriceJumpUpdated(uint16 oldBps, uint16 newBps);

    function test_setMaxPriceJump_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit MaxPriceJumpUpdated(2000, 1000);
        synth.setMaxPriceJump(1000);
    }

    // ============ Protocol Revenue Tests ============

    function test_withdrawRevenue_success() public {
        synth.depositJulRewards(100 ether);
        uint256 id = _openAndMint(COLLATERAL, 6 ether);

        // Owner bypasses jump limit for liquidation test
        synth.updatePrice(0, 1500 ether);
        vm.prank(charlie);
        synth.liquidate(id);

        uint256 revenue = synth.protocolRevenue();
        assertTrue(revenue > 0);

        uint256 ownerBefore = usdc.balanceOf(address(this));
        synth.withdrawProtocolRevenue(revenue);
        assertEq(usdc.balanceOf(address(this)), ownerBefore + revenue);
    }
}
