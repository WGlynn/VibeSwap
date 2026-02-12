// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/oracles/TruePriceOracle.sol";
import "../../contracts/oracles/StablecoinFlowRegistry.sol";
import "../../contracts/oracles/interfaces/ITruePriceOracle.sol";
import "../../contracts/oracles/interfaces/IStablecoinFlowRegistry.sol";
import "../../contracts/libraries/TruePriceLib.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract TruePriceOracleTest is Test {
    TruePriceOracle public oracle;
    StablecoinFlowRegistry public registry;

    address public owner;
    uint256 public signerPrivateKey;
    address public signer;
    address public unauthorized;

    bytes32 public poolId;
    bytes32 public DOMAIN_SEPARATOR;

    uint256 constant PRECISION = 1e18;

    bytes32 constant PRICE_UPDATE_TYPEHASH = keccak256(
        "PriceUpdate(bytes32 poolId,uint256 price,uint256 confidence,int256 deviationZScore,uint8 regime,uint256 manipulationProb,bytes32 dataHash,uint256 nonce,uint256 deadline)"
    );

    bytes32 constant STABLECOIN_UPDATE_TYPEHASH = keccak256(
        "StablecoinUpdate(uint256 usdtUsdcRatio,bool usdtDominant,bool usdcDominant,uint256 volatilityMultiplier,uint256 nonce,uint256 deadline)"
    );

    event TruePriceUpdated(
        bytes32 indexed poolId,
        uint256 price,
        int256 deviationZScore,
        ITruePriceOracle.RegimeType regime,
        uint256 manipulationProb,
        uint64 timestamp
    );

    event StablecoinContextUpdated(
        uint256 usdtUsdcRatio,
        bool usdtDominant,
        bool usdcDominant,
        uint256 volatilityMultiplier
    );

    event OracleSignerUpdated(address indexed signer, bool authorized);

    function setUp() public {
        owner = address(this);
        signerPrivateKey = 0xA11CE;
        signer = vm.addr(signerPrivateKey);
        unauthorized = makeAddr("unauthorized");
        poolId = keccak256("ETH/USDC");

        // Deploy TruePriceOracle
        TruePriceOracle oracleImpl = new TruePriceOracle();
        bytes memory oracleInitData = abi.encodeWithSelector(
            TruePriceOracle.initialize.selector,
            owner
        );
        ERC1967Proxy oracleProxy = new ERC1967Proxy(address(oracleImpl), oracleInitData);
        oracle = TruePriceOracle(address(oracleProxy));

        // Deploy StablecoinFlowRegistry
        StablecoinFlowRegistry registryImpl = new StablecoinFlowRegistry();
        bytes memory registryInitData = abi.encodeWithSelector(
            StablecoinFlowRegistry.initialize.selector,
            owner
        );
        ERC1967Proxy registryProxy = new ERC1967Proxy(address(registryImpl), registryInitData);
        registry = StablecoinFlowRegistry(address(registryProxy));

        // Connect oracle to registry
        oracle.setStablecoinRegistry(address(registry));

        // Authorize signer
        oracle.setAuthorizedSigner(signer, true);
        registry.setAuthorizedUpdater(signer, true);

        // Store domain separator
        DOMAIN_SEPARATOR = oracle.DOMAIN_SEPARATOR();
    }

    // ============ Helper Functions ============

    function _createPriceSignature(
        bytes32 _poolId,
        uint256 price,
        uint256 confidence,
        int256 deviationZScore,
        ITruePriceOracle.RegimeType regime,
        uint256 manipulationProb,
        bytes32 dataHash,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            PRICE_UPDATE_TYPEHASH,
            _poolId,
            price,
            confidence,
            deviationZScore,
            uint8(regime),
            manipulationProb,
            dataHash,
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);

        return abi.encodePacked(r, s, v, nonce, deadline);
    }

    function _createStablecoinSignature(
        uint256 usdtUsdcRatio,
        bool usdtDominant,
        bool usdcDominant,
        uint256 volatilityMultiplier,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            STABLECOIN_UPDATE_TYPEHASH,
            usdtUsdcRatio,
            usdtDominant,
            usdcDominant,
            volatilityMultiplier,
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);

        return abi.encodePacked(r, s, v, nonce, deadline);
    }

    function _submitPrice(
        bytes32 _poolId,
        uint256 price,
        ITruePriceOracle.RegimeType regime,
        uint256 manipulationProb
    ) internal {
        uint256 nonce = oracle.getNonce(signer);
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _createPriceSignature(
            _poolId,
            price,
            PRECISION / 100, // 1% confidence
            0, // neutral z-score
            regime,
            manipulationProb,
            keccak256("data"),
            nonce,
            deadline
        );

        oracle.updateTruePrice(
            _poolId,
            price,
            PRECISION / 100,
            0,
            regime,
            manipulationProb,
            keccak256("data"),
            sig
        );
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(oracle.owner(), owner);
        assertTrue(oracle.DOMAIN_SEPARATOR() != bytes32(0));
    }

    function test_initialize_zeroOwner() public {
        TruePriceOracle impl = new TruePriceOracle();
        bytes memory initData = abi.encodeWithSelector(
            TruePriceOracle.initialize.selector,
            address(0)
        );

        vm.expectRevert(TruePriceOracle.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_defaultStablecoinContext() public view {
        ITruePriceOracle.StablecoinContext memory ctx = oracle.getStablecoinContext();
        assertEq(ctx.usdtUsdcRatio, PRECISION); // 1.0
        assertFalse(ctx.usdtDominant);
        assertFalse(ctx.usdcDominant);
        assertEq(ctx.volatilityMultiplier, PRECISION); // 1.0x
    }

    // ============ Signer Authorization Tests ============

    function test_setAuthorizedSigner() public {
        address newSigner = makeAddr("newSigner");

        vm.expectEmit(true, false, false, true);
        emit OracleSignerUpdated(newSigner, true);

        oracle.setAuthorizedSigner(newSigner, true);
        assertTrue(oracle.authorizedSigners(newSigner));

        oracle.setAuthorizedSigner(newSigner, false);
        assertFalse(oracle.authorizedSigners(newSigner));
    }

    function test_setAuthorizedSigner_zeroAddress() public {
        vm.expectRevert(TruePriceOracle.ZeroAddress.selector);
        oracle.setAuthorizedSigner(address(0), true);
    }

    function test_setAuthorizedSigner_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        oracle.setAuthorizedSigner(unauthorized, true);
    }

    // ============ Price Update Tests ============

    function test_updateTruePrice() public {
        uint256 price = 2000 * PRECISION;
        uint256 nonce = oracle.getNonce(signer);
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _createPriceSignature(
            poolId,
            price,
            PRECISION / 100,
            int256(PRECISION / 2), // 0.5 z-score
            ITruePriceOracle.RegimeType.NORMAL,
            PRECISION / 10, // 10% manipulation prob
            keccak256("data"),
            nonce,
            deadline
        );

        vm.expectEmit(true, false, false, true);
        emit TruePriceUpdated(
            poolId,
            price,
            int256(PRECISION / 2),
            ITruePriceOracle.RegimeType.NORMAL,
            PRECISION / 10,
            uint64(block.timestamp)
        );

        oracle.updateTruePrice(
            poolId,
            price,
            PRECISION / 100,
            int256(PRECISION / 2),
            ITruePriceOracle.RegimeType.NORMAL,
            PRECISION / 10,
            keccak256("data"),
            sig
        );

        ITruePriceOracle.TruePriceData memory data = oracle.getTruePrice(poolId);
        assertEq(data.price, price);
        assertEq(data.confidence, PRECISION / 100);
        assertEq(data.deviationZScore, int256(PRECISION / 2));
        assertEq(uint8(data.regime), uint8(ITruePriceOracle.RegimeType.NORMAL));
        assertEq(data.manipulationProb, PRECISION / 10);
    }

    function test_updateTruePrice_unauthorizedSigner() public {
        uint256 unauthorizedKey = 0xBAD;
        address unauthorizedSigner = vm.addr(unauthorizedKey);

        bytes32 structHash = keccak256(abi.encode(
            PRICE_UPDATE_TYPEHASH,
            poolId,
            2000 * PRECISION,
            PRECISION / 100,
            int256(0),
            uint8(ITruePriceOracle.RegimeType.NORMAL),
            uint256(0),
            keccak256("data"),
            uint256(0),
            block.timestamp + 1 hours
        ));

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(unauthorizedKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v, uint256(0), block.timestamp + 1 hours);

        vm.expectRevert(TruePriceOracle.UnauthorizedSigner.selector);
        oracle.updateTruePrice(
            poolId,
            2000 * PRECISION,
            PRECISION / 100,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0,
            keccak256("data"),
            sig
        );
    }

    function test_updateTruePrice_expiredSignature() public {
        uint256 nonce = oracle.getNonce(signer);
        uint256 deadline = block.timestamp - 1; // Already expired

        bytes memory sig = _createPriceSignature(
            poolId,
            2000 * PRECISION,
            PRECISION / 100,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0,
            keccak256("data"),
            nonce,
            deadline
        );

        vm.expectRevert(TruePriceOracle.ExpiredSignature.selector);
        oracle.updateTruePrice(
            poolId,
            2000 * PRECISION,
            PRECISION / 100,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0,
            keccak256("data"),
            sig
        );
    }

    function test_updateTruePrice_invalidNonce() public {
        uint256 wrongNonce = 999;
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _createPriceSignature(
            poolId,
            2000 * PRECISION,
            PRECISION / 100,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0,
            keccak256("data"),
            wrongNonce,
            deadline
        );

        vm.expectRevert(TruePriceOracle.InvalidNonce.selector);
        oracle.updateTruePrice(
            poolId,
            2000 * PRECISION,
            PRECISION / 100,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0,
            keccak256("data"),
            sig
        );
    }

    function test_updateTruePrice_nonceIncrement() public {
        assertEq(oracle.getNonce(signer), 0);

        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);
        assertEq(oracle.getNonce(signer), 1);

        _submitPrice(poolId, 2010 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);
        assertEq(oracle.getNonce(signer), 2);
    }

    // ============ Price Jump Validation Tests ============

    function test_updateTruePrice_validJump() public {
        // First update
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);

        // 5% jump (within 10% limit)
        _submitPrice(poolId, 2100 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);

        ITruePriceOracle.TruePriceData memory data = oracle.getTruePrice(poolId);
        assertEq(data.price, 2100 * PRECISION);
    }

    function test_updateTruePrice_priceJumpTooLarge() public {
        // First update
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);

        // 15% jump (exceeds 10% limit)
        uint256 nonce = oracle.getNonce(signer);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 newPrice = 2300 * PRECISION;

        bytes memory sig = _createPriceSignature(
            poolId,
            newPrice,
            PRECISION / 100,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0,
            keccak256("data"),
            nonce,
            deadline
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                TruePriceOracle.PriceJumpTooLarge.selector,
                2000 * PRECISION,
                newPrice,
                1500 // 15% in bps
            )
        );
        oracle.updateTruePrice(
            poolId,
            newPrice,
            PRECISION / 100,
            0,
            ITruePriceOracle.RegimeType.NORMAL,
            0,
            keccak256("data"),
            sig
        );
    }

    // ============ Staleness Tests ============

    function test_getTruePrice_stale() public {
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);

        // Advance time past staleness threshold (5 minutes)
        vm.warp(block.timestamp + 6 minutes);

        vm.expectRevert(TruePriceOracle.StaleData.selector);
        oracle.getTruePrice(poolId);
    }

    function test_getTruePrice_noPriceData() public {
        bytes32 unknownPool = keccak256("UNKNOWN");

        vm.expectRevert(TruePriceOracle.NoPriceData.selector);
        oracle.getTruePrice(unknownPool);
    }

    function test_isFresh() public {
        // Price submitted at timestamp 1 (Foundry default)
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);

        assertTrue(oracle.isFresh(poolId, 5 minutes));

        // Use absolute timestamps to avoid vm.warp(block.timestamp + x) nightly bug
        vm.warp(181); // 3 minutes after timestamp 1
        assertTrue(oracle.isFresh(poolId, 5 minutes));
        assertFalse(oracle.isFresh(poolId, 2 minutes));

        vm.warp(361); // 6 minutes after timestamp 1
        assertFalse(oracle.isFresh(poolId, 5 minutes));
    }

    function test_isFresh_noData() public {
        bytes32 unknownPool = keccak256("UNKNOWN");
        assertFalse(oracle.isFresh(unknownPool, 5 minutes));
    }

    // ============ Regime Tests ============

    function test_getRegime() public {
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.CASCADE, 0);

        ITruePriceOracle.RegimeType regime = oracle.getRegime(poolId);
        assertEq(uint8(regime), uint8(ITruePriceOracle.RegimeType.CASCADE));
    }

    function test_allRegimeTypes() public {
        ITruePriceOracle.RegimeType[6] memory regimes = [
            ITruePriceOracle.RegimeType.NORMAL,
            ITruePriceOracle.RegimeType.TREND,
            ITruePriceOracle.RegimeType.LOW_VOLATILITY,
            ITruePriceOracle.RegimeType.HIGH_LEVERAGE,
            ITruePriceOracle.RegimeType.MANIPULATION,
            ITruePriceOracle.RegimeType.CASCADE
        ];

        for (uint256 i = 0; i < regimes.length; i++) {
            bytes32 testPool = keccak256(abi.encodePacked("pool", i));
            _submitPrice(testPool, 2000 * PRECISION, regimes[i], 0);

            assertEq(uint8(oracle.getRegime(testPool)), uint8(regimes[i]));
        }
    }

    // ============ Manipulation Detection Tests ============

    function test_isManipulationLikely() public {
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.MANIPULATION, 6e17); // 60%

        assertTrue(oracle.isManipulationLikely(poolId, 5e17)); // > 50%
        assertFalse(oracle.isManipulationLikely(poolId, 7e17)); // > 70%
    }

    function test_getDeviationMetrics() public {
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 3e17);

        (uint256 price, int256 zScore, uint256 manipProb) = oracle.getDeviationMetrics(poolId);
        assertEq(price, 2000 * PRECISION);
        assertEq(zScore, 0);
        assertEq(manipProb, 3e17);
    }

    // ============ Price Bounds Tests ============

    function test_getPriceBounds_normal() public {
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);

        (uint256 lower, uint256 upper) = oracle.getPriceBounds(poolId, 500); // 5%

        // Normal regime, neutral stablecoin context: bounds should be ±5%
        assertEq(lower, 2000 * PRECISION - (2000 * PRECISION * 500 / 10000));
        assertEq(upper, 2000 * PRECISION + (2000 * PRECISION * 500 / 10000));
    }

    function test_getPriceBounds_cascade() public {
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.CASCADE, 0);

        (uint256 lowerCascade, uint256 upperCascade) = oracle.getPriceBounds(poolId, 500);

        // CASCADE regime: 70% of normal bounds
        uint256 adjustedBps = (500 * 7000) / 10000; // 350 bps = 3.5%
        assertEq(lowerCascade, 2000 * PRECISION - (2000 * PRECISION * adjustedBps / 10000));
        assertEq(upperCascade, 2000 * PRECISION + (2000 * PRECISION * adjustedBps / 10000));
    }

    function test_getPriceBounds_trend() public {
        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.TREND, 0);

        (uint256 lowerTrend, uint256 upperTrend) = oracle.getPriceBounds(poolId, 500);

        // TREND regime: 130% of normal bounds
        uint256 adjustedBps = (500 * 13000) / 10000; // 650 bps = 6.5%
        assertEq(lowerTrend, 2000 * PRECISION - (2000 * PRECISION * adjustedBps / 10000));
        assertEq(upperTrend, 2000 * PRECISION + (2000 * PRECISION * adjustedBps / 10000));
    }

    function test_getPriceBounds_noData() public view {
        bytes32 unknownPool = keccak256("UNKNOWN");
        (uint256 lower, uint256 upper) = oracle.getPriceBounds(unknownPool, 500);

        assertEq(lower, 0);
        assertEq(upper, type(uint256).max);
    }

    // ============ Stablecoin Context Tests ============

    function test_updateStablecoinContext() public {
        // Disconnect registry so oracle uses local stablecoin context
        oracle.setStablecoinRegistry(address(0));

        uint256 nonce = oracle.getNonce(signer);
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _createStablecoinSignature(
            25e17, // 2.5 ratio
            true,  // USDT dominant
            false,
            15e17, // 1.5x volatility
            nonce,
            deadline
        );

        vm.expectEmit(false, false, false, true);
        emit StablecoinContextUpdated(25e17, true, false, 15e17);

        oracle.updateStablecoinContext(25e17, true, false, 15e17, sig);

        ITruePriceOracle.StablecoinContext memory ctx = oracle.getStablecoinContext();
        assertEq(ctx.usdtUsdcRatio, 25e17);
        assertTrue(ctx.usdtDominant);
        assertFalse(ctx.usdcDominant);
        assertEq(ctx.volatilityMultiplier, 15e17);
    }

    function test_stablecoinContext_fromRegistry() public {
        // Update registry directly (must prank as authorized updater)
        vm.prank(signer);
        registry.updateFlowRatio(3e18); // 3.0 ratio (USDT dominant)

        ITruePriceOracle.StablecoinContext memory ctx = oracle.getStablecoinContext();

        // Should read from registry
        assertEq(ctx.usdtUsdcRatio, 3e18);
        assertTrue(ctx.usdtDominant);
        assertFalse(ctx.usdcDominant);
    }

    function test_getPriceBounds_usdtDominant() public {
        // Set USDT dominant via registry
        vm.prank(signer);
        registry.updateFlowRatio(3e18);

        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);

        (uint256 lower, uint256 upper) = oracle.getPriceBounds(poolId, 500);

        // USDT dominant: 80% of normal bounds (tighter)
        uint256 adjustedBps = (500 * 8000) / 10000; // 400 bps = 4%
        assertEq(lower, 2000 * PRECISION - (2000 * PRECISION * adjustedBps / 10000));
        assertEq(upper, 2000 * PRECISION + (2000 * PRECISION * adjustedBps / 10000));
    }

    function test_getPriceBounds_usdcDominant() public {
        // Set USDC dominant via registry
        vm.prank(signer);
        registry.updateFlowRatio(4e17); // 0.4 ratio

        _submitPrice(poolId, 2000 * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);

        (uint256 lower, uint256 upper) = oracle.getPriceBounds(poolId, 500);

        // USDC dominant: 120% of normal bounds (looser)
        uint256 adjustedBps = (500 * 12000) / 10000; // 600 bps = 6%
        assertEq(lower, 2000 * PRECISION - (2000 * PRECISION * adjustedBps / 10000));
        assertEq(upper, 2000 * PRECISION + (2000 * PRECISION * adjustedBps / 10000));
    }

    // ============ History Tests ============

    function test_priceHistory() public {
        // Submit multiple prices
        for (uint256 i = 0; i < 5; i++) {
            _submitPrice(poolId, (2000 + i * 10) * PRECISION, ITruePriceOracle.RegimeType.NORMAL, 0);
            vm.warp(block.timestamp + 1); // Small time advancement
        }

        // Latest price should be stored
        ITruePriceOracle.TruePriceData memory data = oracle.getTruePrice(poolId);
        assertEq(data.price, 2040 * PRECISION);
    }

    // ============ TruePriceLib Tests ============

    function test_lib_validatePriceDeviation() public pure {
        assertTrue(TruePriceLib.validatePriceDeviation(100e18, 100e18, 500)); // 0%
        assertTrue(TruePriceLib.validatePriceDeviation(105e18, 100e18, 500)); // 5%
        assertFalse(TruePriceLib.validatePriceDeviation(106e18, 100e18, 500)); // 6% > 5%
        assertTrue(TruePriceLib.validatePriceDeviation(95e18, 100e18, 500)); // -5%
        assertFalse(TruePriceLib.validatePriceDeviation(94e18, 100e18, 500)); // -6% > 5%
    }

    function test_lib_adjustDeviationForStablecoin() public pure {
        uint256 base = 500; // 5%

        // USDT dominant: 80%
        assertEq(TruePriceLib.adjustDeviationForStablecoin(base, true, false), 400);

        // USDC dominant: 120%
        assertEq(TruePriceLib.adjustDeviationForStablecoin(base, false, true), 600);

        // Neutral
        assertEq(TruePriceLib.adjustDeviationForStablecoin(base, false, false), 500);
    }

    function test_lib_adjustDeviationForRegime() public pure {
        uint256 base = 1000; // 10%

        assertEq(
            TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.CASCADE),
            600 // 60%
        );
        assertEq(
            TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.MANIPULATION),
            700 // 70%
        );
        assertEq(
            TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.HIGH_LEVERAGE),
            850 // 85%
        );
        assertEq(
            TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.TREND),
            1300 // 130%
        );
        assertEq(
            TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.LOW_VOLATILITY),
            700 // 70%
        );
        assertEq(
            TruePriceLib.adjustDeviationForRegime(base, ITruePriceOracle.RegimeType.NORMAL),
            1000 // 100%
        );
    }

    function test_lib_zScoreToReversionProbability() public pure {
        // Low z-score: low reversion probability
        uint256 prob1 = TruePriceLib.zScoreToReversionProbability(5e17, false); // 0.5 sigma
        assertLt(prob1, PRECISION / 4);

        // High z-score: high reversion probability
        uint256 prob2 = TruePriceLib.zScoreToReversionProbability(3 * int256(PRECISION), false); // 3 sigma
        assertGt(prob2, PRECISION / 2);

        // USDT dominant increases probability
        uint256 prob3 = TruePriceLib.zScoreToReversionProbability(2 * int256(PRECISION), true);
        uint256 prob4 = TruePriceLib.zScoreToReversionProbability(2 * int256(PRECISION), false);
        assertGt(prob3, prob4);
    }
}
