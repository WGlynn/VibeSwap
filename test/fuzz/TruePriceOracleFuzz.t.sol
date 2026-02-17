// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/oracles/TruePriceOracle.sol";
import "../../contracts/oracles/interfaces/ITruePriceOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Fuzz Tests ============

contract TruePriceOracleFuzzTest is Test {
    TruePriceOracle public oracle;

    address public owner;
    uint256 public signerPrivateKey;
    address public signerAddr;

    bytes32 public poolId;
    bytes32 public DOMAIN_SEPARATOR;

    uint256 constant PRECISION = 1e18;

    bytes32 constant PRICE_UPDATE_TYPEHASH = keccak256(
        "PriceUpdate(bytes32 poolId,uint256 price,uint256 confidence,int256 deviationZScore,uint8 regime,uint256 manipulationProb,bytes32 dataHash,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        owner = address(this);
        signerPrivateKey = 0xA11CE;
        signerAddr = vm.addr(signerPrivateKey);
        poolId = keccak256("ETH/USDC");

        TruePriceOracle impl = new TruePriceOracle();
        bytes memory initData = abi.encodeWithSelector(
            TruePriceOracle.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        oracle = TruePriceOracle(address(proxy));

        oracle.setAuthorizedSigner(signerAddr, true);
        DOMAIN_SEPARATOR = oracle.DOMAIN_SEPARATOR();
    }

    // ============ Helpers ============

    function _createPriceSig(
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
            _poolId, price, confidence, deviationZScore, uint8(regime),
            manipulationProb, dataHash, nonce, deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v, nonce, deadline);
    }

    function _submitPrice(uint256 price) internal {
        uint256 nonce = oracle.getNonce(signerAddr);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _createPriceSig(
            poolId, price, 9000, int256(0),
            ITruePriceOracle.RegimeType.NORMAL, 1000,
            keccak256("data"), nonce, deadline
        );
        oracle.updateTruePrice(poolId, price, 9000, int256(0),
            ITruePriceOracle.RegimeType.NORMAL, 1000, keccak256("data"), sig);
    }

    // ============ Fuzz: price jump validation enforced ============

    function testFuzz_priceJumpValidation(uint256 initialPrice, uint256 jumpBps) public {
        initialPrice = bound(initialPrice, 1e15, 1e24);
        jumpBps = bound(jumpBps, 1100, 5000); // > 11% jump (buffer for integer truncation)

        // Set initial price
        _submitPrice(initialPrice);

        // Try price jump > 10%
        uint256 newPrice = initialPrice + (initialPrice * jumpBps) / 10000;

        uint256 nonce = oracle.getNonce(signerAddr);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _createPriceSig(
            poolId, newPrice, 9000, int256(0),
            ITruePriceOracle.RegimeType.NORMAL, 1000,
            keccak256("data2"), nonce, deadline
        );

        vm.expectRevert();
        oracle.updateTruePrice(poolId, newPrice, 9000, int256(0),
            ITruePriceOracle.RegimeType.NORMAL, 1000, keccak256("data2"), sig);
    }

    // ============ Fuzz: valid price jump succeeds ============

    function testFuzz_validPriceJumpSucceeds(uint256 initialPrice, uint256 jumpBps) public {
        initialPrice = bound(initialPrice, 1e15, 1e24);
        jumpBps = bound(jumpBps, 0, 999); // <= 9.99% jump

        _submitPrice(initialPrice);

        uint256 newPrice = initialPrice + (initialPrice * jumpBps) / 10000;

        uint256 nonce = oracle.getNonce(signerAddr);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _createPriceSig(
            poolId, newPrice, 9000, int256(0),
            ITruePriceOracle.RegimeType.NORMAL, 500,
            keccak256("data2"), nonce, deadline
        );

        oracle.updateTruePrice(poolId, newPrice, 9000, int256(0),
            ITruePriceOracle.RegimeType.NORMAL, 500, keccak256("data2"), sig);

        ITruePriceOracle.TruePriceData memory data = oracle.getTruePrice(poolId);
        assertEq(data.price, newPrice, "Price must be updated");
    }

    // ============ Fuzz: nonce strictly increasing ============

    function testFuzz_nonceStrictlyIncreasing(uint256 numUpdates) public {
        numUpdates = bound(numUpdates, 1, 20);

        uint256 price = 1000e18;

        for (uint256 i = 0; i < numUpdates; i++) {
            uint256 expectedNonce = i;
            assertEq(oracle.getNonce(signerAddr), expectedNonce, "Nonce must match expected");

            _submitPrice(price);

            assertEq(oracle.getNonce(signerAddr), expectedNonce + 1, "Nonce must increment");
        }
    }

    // ============ Fuzz: freshness check ============

    function testFuzz_freshnessCheck(uint256 age) public {
        age = bound(age, 0, 1 hours);

        _submitPrice(1000e18);

        vm.warp(block.timestamp + age);

        bool fresh = oracle.isFresh(poolId, 5 minutes);

        if (age <= 5 minutes) {
            assertTrue(fresh, "Should be fresh within maxAge");
        } else {
            assertFalse(fresh, "Should be stale after maxAge");
        }
    }

    // ============ Fuzz: manipulation probability bounded ============

    function testFuzz_manipulationProbBounded(uint256 manipProb) public {
        manipProb = bound(manipProb, 0, PRECISION);

        uint256 nonce = oracle.getNonce(signerAddr);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _createPriceSig(
            poolId, 1000e18, 9000, int256(0),
            ITruePriceOracle.RegimeType.NORMAL, manipProb,
            keccak256("data"), nonce, deadline
        );

        oracle.updateTruePrice(poolId, 1000e18, 9000, int256(0),
            ITruePriceOracle.RegimeType.NORMAL, manipProb, keccak256("data"), sig);

        (, , uint256 storedProb) = oracle.getDeviationMetrics(poolId);
        assertEq(storedProb, manipProb, "Manipulation prob must be stored correctly");
    }
}
