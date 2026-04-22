// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/oracles/OracleAggregationCRA.sol";
import "../../contracts/oracles/interfaces/IOracleAggregationCRA.sol";

/**
 * @title OracleAggregationCRA tests — C39 FAT-AUDIT-2
 * @notice Commit-reveal batch oracle aggregation regression suite.
 *         Scaffold + initialize tests in this commit; phase + median +
 *         slash tests land in subsequent commits per cadence-restore.
 */
contract OracleAggregationCRATest is Test {
    OracleAggregationCRA public agg;

    address public owner;
    address public issuer1;
    address public issuer2;
    address public issuer3;
    address public stubRegistry;
    address public stubTPO;

    function setUp() public {
        owner = address(this);
        issuer1 = makeAddr("issuer1");
        issuer2 = makeAddr("issuer2");
        issuer3 = makeAddr("issuer3");
        // Stub registry + TPO addresses — real wire-in tests come later.
        stubRegistry = makeAddr("registry");
        stubTPO = makeAddr("tpo");

        OracleAggregationCRA impl = new OracleAggregationCRA();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(OracleAggregationCRA.initialize.selector, stubRegistry, stubTPO)
        );
        agg = OracleAggregationCRA(address(proxy));
    }

    // ============ Initialization ============

    function test_initialize_setsRegistryAndTPO() public view {
        assertEq(agg.issuerRegistry(), stubRegistry);
        assertEq(agg.truePriceOracle(), stubTPO);
    }

    function test_initialize_opensFirstBatch() public view {
        assertEq(agg.getCurrentBatchId(), 1);
        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(1);
        assertEq(info.batchId, 1);
        assertTrue(info.commitDeadline > block.timestamp);
        assertTrue(info.revealDeadline > info.commitDeadline);
        assertEq(uint256(info.phase), uint256(IOracleAggregationCRA.BatchPhase.COMMIT));
    }

    function test_initialize_revertOnZeroRegistry() public {
        OracleAggregationCRA impl = new OracleAggregationCRA();
        vm.expectRevert(bytes("Invalid registry"));
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(OracleAggregationCRA.initialize.selector, address(0), stubTPO)
        );
    }

    function test_initialize_revertOnZeroTPO() public {
        OracleAggregationCRA impl = new OracleAggregationCRA();
        vm.expectRevert(bytes("Invalid TPO"));
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(OracleAggregationCRA.initialize.selector, stubRegistry, address(0))
        );
    }

    // ============ Commit Phase ============

    function _commitHash(uint256 price, bytes32 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(price, nonce));
    }

    function test_commitPrice_happy() public {
        bytes32 ch = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1);
        agg.commitPrice(ch);

        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(1);
        assertEq(info.commitCount, 1);
    }

    function test_commitPrice_revertZeroHash() public {
        vm.prank(issuer1);
        vm.expectRevert(bytes("Zero hash"));
        agg.commitPrice(bytes32(0));
    }

    function test_commitPrice_revertDoubleCommit() public {
        bytes32 ch = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1);
        agg.commitPrice(ch);
        vm.prank(issuer1);
        vm.expectRevert(bytes("Already committed"));
        agg.commitPrice(ch);
    }

    function test_commitPrice_autoAdvancesBatchAfterDeadline() public {
        bytes32 ch1 = _commitHash(1500e18, bytes32(uint256(1)));
        vm.prank(issuer1);
        agg.commitPrice(ch1);
        assertEq(agg.getCurrentBatchId(), 1);

        // Skip past commit + reveal deadlines for batch 1
        vm.warp(block.timestamp + 100);

        bytes32 ch2 = _commitHash(1600e18, bytes32(uint256(2)));
        vm.prank(issuer2);
        agg.commitPrice(ch2);
        assertEq(agg.getCurrentBatchId(), 2);

        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(2);
        assertEq(info.commitCount, 1);
    }
}
