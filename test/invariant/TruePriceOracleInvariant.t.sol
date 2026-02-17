// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/oracles/TruePriceOracle.sol";
import "../../contracts/oracles/interfaces/ITruePriceOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Handler ============

contract TPOHandler is Test {
    TruePriceOracle public oracle;
    uint256 public signerKey;
    address public signerAddr;
    bytes32 public poolId;
    bytes32 public DOMAIN_SEPARATOR;

    bytes32 constant PRICE_UPDATE_TYPEHASH = keccak256(
        "PriceUpdate(bytes32 poolId,uint256 price,uint256 confidence,int256 deviationZScore,uint8 regime,uint256 manipulationProb,bytes32 dataHash,uint256 nonce,uint256 deadline)"
    );

    // Ghost variables
    uint256 public ghost_updateCount;
    uint256 public ghost_lastPrice;

    constructor(
        TruePriceOracle _oracle,
        uint256 _signerKey,
        address _signerAddr,
        bytes32 _poolId
    ) {
        oracle = _oracle;
        signerKey = _signerKey;
        signerAddr = _signerAddr;
        poolId = _poolId;
        DOMAIN_SEPARATOR = oracle.DOMAIN_SEPARATOR();
    }

    function updatePrice(uint256 priceSeed, uint256 regimeSeed, uint256 manipProbSeed) public {
        uint256 price;
        if (ghost_lastPrice == 0) {
            price = bound(priceSeed, 100e18, 10000e18);
        } else {
            // Stay within 10% jump
            uint256 maxDelta = (ghost_lastPrice * 999) / 10000;
            uint256 delta = bound(priceSeed, 0, maxDelta);
            if (priceSeed % 2 == 0) {
                price = ghost_lastPrice + delta;
            } else {
                price = ghost_lastPrice > delta ? ghost_lastPrice - delta : ghost_lastPrice;
            }
            if (price == 0) price = 1;
        }

        uint8 regime = uint8(regimeSeed % 4);
        uint256 manipProb = bound(manipProbSeed, 0, 1e18);

        uint256 nonce = oracle.getNonce(signerAddr);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 structHash = keccak256(abi.encode(
            PRICE_UPDATE_TYPEHASH,
            poolId, price, uint256(9000), int256(0), regime,
            manipProb, keccak256(abi.encode(ghost_updateCount)),
            nonce, deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v, nonce, deadline);

        try oracle.updateTruePrice(
            poolId, price, 9000, int256(0),
            ITruePriceOracle.RegimeType(regime), manipProb,
            keccak256(abi.encode(ghost_updateCount)), sig
        ) {
            ghost_updateCount++;
            ghost_lastPrice = price;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 10 minutes);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract TruePriceOracleInvariantTest is StdInvariant, Test {
    TruePriceOracle public oracle;
    TPOHandler public handler;

    address public owner;
    uint256 public signerKey;
    address public signerAddr;
    bytes32 public poolId;

    function setUp() public {
        owner = address(this);
        signerKey = 0xA11CE;
        signerAddr = vm.addr(signerKey);
        poolId = keccak256("ETH/USDC");

        TruePriceOracle impl = new TruePriceOracle();
        bytes memory initData = abi.encodeWithSelector(
            TruePriceOracle.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        oracle = TruePriceOracle(address(proxy));

        oracle.setAuthorizedSigner(signerAddr, true);

        handler = new TPOHandler(oracle, signerKey, signerAddr, poolId);
        targetContract(address(handler));
    }

    // ============ Invariant: nonce monotonically increasing ============

    function invariant_nonceMonotonic() public view {
        uint256 nonce = oracle.getNonce(signerAddr);
        assertEq(nonce, handler.ghost_updateCount(), "NONCE: must equal update count");
    }

    // ============ Invariant: stored price matches last update ============

    function invariant_storedPriceConsistent() public view {
        if (handler.ghost_updateCount() == 0) return;

        (uint256 price,,,,,,) = oracle.truePrices(poolId);
        assertEq(price, handler.ghost_lastPrice(), "PRICE: stored must match ghost");
    }

    // ============ Invariant: regime always valid enum ============

    function invariant_regimeValid() public view {
        if (handler.ghost_updateCount() == 0) return;

        ITruePriceOracle.RegimeType regime = oracle.getRegime(poolId);
        assertTrue(uint8(regime) <= 3, "REGIME: invalid enum value");
    }

    // ============ Invariant: manipulation prob bounded ============

    function invariant_manipProbBounded() public view {
        if (handler.ghost_updateCount() == 0) return;

        (, , uint256 manipProb) = oracle.getDeviationMetrics(poolId);
        assertLe(manipProb, 1e18, "MANIP_PROB: exceeds 100%");
    }

    // ============ Invariant: price timestamp never in future ============

    function invariant_timestampNotFuture() public view {
        if (handler.ghost_updateCount() == 0) return;

        (,,,,, uint64 timestamp,) = oracle.truePrices(poolId);
        assertLe(timestamp, block.timestamp, "TIMESTAMP: in the future");
    }
}
