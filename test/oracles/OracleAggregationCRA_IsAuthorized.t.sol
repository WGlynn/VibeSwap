// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/oracles/OracleAggregationCRA.sol";
import "../../contracts/oracles/IssuerReputationRegistry.sol";
import "../../contracts/oracles/interfaces/IIssuerReputationRegistry.sol";

/// @dev Minimal ERC20 for staking in IssuerReputationRegistry.
contract MockStakeC39 is ERC20 {
    constructor() ERC20("MockStakeC39", "MSK39") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title OracleAggregationCRA_IsAuthorized — C39-OCRA-1 targeted tests
 * @notice Verifies the real _isAuthorizedIssuer registry integration:
 *         (a) active issuer accepted
 *         (b) slashed/inactive issuer rejected
 *         (c) zero-registry still accepts (backwards compat)
 */
contract OracleAggregationCRA_IsAuthorizedTest is Test {
    // ============ Constants ============

    uint256 constant MIN_STAKE = 100e18;
    uint256 constant MIN_REPUTATION = 1000; // 10% — low threshold so standard slash tests work

    // ============ State ============

    OracleAggregationCRA public agg;
    IssuerReputationRegistry public reg;
    MockStakeC39 public stakeToken;

    address public owner;
    address public activeIssuer;
    address public inactiveIssuer;
    bytes32 public activeKey;
    bytes32 public inactiveKey;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        activeIssuer  = makeAddr("activeIssuer");
        inactiveIssuer = makeAddr("inactiveIssuer");
        activeKey   = keccak256("activeKey");
        inactiveKey = keccak256("inactiveKey");

        // --- Deploy real IssuerReputationRegistry ---
        stakeToken = new MockStakeC39();
        IssuerReputationRegistry regImpl = new IssuerReputationRegistry();
        ERC1967Proxy regProxy = new ERC1967Proxy(
            address(regImpl),
            abi.encodeCall(
                IssuerReputationRegistry.initialize,
                (address(stakeToken), owner, MIN_STAKE, MIN_REPUTATION)
            )
        );
        reg = IssuerReputationRegistry(address(regProxy));

        // Authorise this test contract as a slasher so we can slash in tests.
        reg.setAuthorizedSlasher(owner, true);

        // Mint + approve stake for both test issuers
        stakeToken.mint(activeIssuer,   MIN_STAKE * 10);
        stakeToken.mint(inactiveIssuer, MIN_STAKE * 10);

        vm.prank(activeIssuer);
        stakeToken.approve(address(reg), type(uint256).max);
        vm.prank(inactiveIssuer);
        stakeToken.approve(address(reg), type(uint256).max);

        // Register activeIssuer (stays ACTIVE)
        vm.prank(activeIssuer);
        reg.registerIssuer(activeKey, activeIssuer, MIN_STAKE);

        // Register inactiveIssuer, then slash it out
        vm.prank(inactiveIssuer);
        reg.registerIssuer(inactiveKey, inactiveIssuer, MIN_STAKE);
        // Slash 100% reputation → drops below MIN_REPUTATION → SLASHED_OUT
        reg.slashIssuer(inactiveKey, 10000, "C39-OCRA-1 test setup");

        // --- Deploy OracleAggregationCRA wired to real registry ---
        address stubTPO = makeAddr("tpo");
        OracleAggregationCRA aggImpl = new OracleAggregationCRA();
        ERC1967Proxy aggProxy = new ERC1967Proxy(
            address(aggImpl),
            abi.encodeCall(
                OracleAggregationCRA.initialize,
                (address(reg), stubTPO)
            )
        );
        agg = OracleAggregationCRA(address(aggProxy));
    }

    // ============ (a) Active issuer is accepted ============

    function test_activeIssuer_canCommit() public {
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(1500e18), bytes32(uint256(1))));
        vm.prank(activeIssuer);
        agg.commitPrice(commitHash);

        IOracleAggregationCRA.BatchInfo memory info = agg.getBatch(1);
        assertEq(info.commitCount, 1, "active issuer commit should be recorded");
    }

    // ============ (b) Slashed / inactive issuer is rejected ============

    function test_slashedIssuer_cannotCommit() public {
        // Verify setup: inactiveIssuer is SLASHED_OUT
        (IIssuerReputationRegistry.IssuerStatus status, , , , ) = reg.getIssuerStatus(inactiveKey);
        assertEq(
            uint8(status),
            uint8(IIssuerReputationRegistry.IssuerStatus.SLASHED_OUT),
            "inactiveIssuer should be SLASHED_OUT"
        );

        bytes32 commitHash = keccak256(abi.encodePacked(uint256(1500e18), bytes32(uint256(99))));
        vm.prank(inactiveIssuer);
        vm.expectRevert(bytes("Not registered issuer"));
        agg.commitPrice(commitHash);
    }

    function test_unregisteredAddress_cannotCommit() public {
        address stranger = makeAddr("stranger");
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(1000e18), bytes32(uint256(7))));
        vm.prank(stranger);
        vm.expectRevert(bytes("Not registered issuer"));
        agg.commitPrice(commitHash);
    }

    function test_unbondingIssuer_cannotCommit() public {
        // Initiate unbond — status transitions to UNBONDING, which verifyIssuer rejects.
        vm.prank(activeIssuer);
        reg.requestUnbond(activeKey);

        (IIssuerReputationRegistry.IssuerStatus status, , , , ) = reg.getIssuerStatus(activeKey);
        assertEq(
            uint8(status),
            uint8(IIssuerReputationRegistry.IssuerStatus.UNBONDING),
            "activeIssuer should be UNBONDING after requestUnbond"
        );

        bytes32 commitHash = keccak256(abi.encodePacked(uint256(1500e18), bytes32(uint256(5))));
        vm.prank(activeIssuer);
        vm.expectRevert(bytes("Not registered issuer"));
        agg.commitPrice(commitHash);
    }

    // ============ (c) Zero-registry stays permissive (backwards compat) ============

    function test_zeroRegistry_permissive() public {
        // Deploy a fresh aggregator with issuerRegistry == address(0) —
        // not possible via initialize (requires non-zero), so we use setIssuerRegistry
        // to wire a real registry first, then test the pre-wiring path by deploying
        // an aggregator instance whose registry slot is set to zero via a direct
        // storage override (vm.store). This validates the branch without modifying
        // the production initialize guard.
        //
        // Slot 0 of the implementation is not the registry slot; the registry is
        // stored in the proxy's storage. Use vm.load to find it, then zero it out.
        // Registry is declared after OZ gaps (OwnableUpgradeable = slot 0,
        // ReentrancyGuard = slot 1, UUPS = none), then OracleAggregationCRA:
        //   slot 0 → OwnableUpgradeable._owner (via ERC7201 namespaced storage)
        //
        // Simpler approach: deploy a new aggregator instance passing a permissive
        // mock registry, then programmatically verify the zero-registry fast path
        // by deploying yet another instance using a MockRegistry that returns 0
        // from signerToIssuer — which exercises the `issuerKey == bytes32(0) → false`
        // branch, not the zero-registry branch. The only clean way to test the
        // zero-registry branch is to construct an aggregator that has it set to zero.
        //
        // Since initialize requires non-zero, we use vm.store to overwrite the slot.
        // Find the slot by iterating: issuerRegistry is the 3rd custom state var
        // (after _batches mapping and currentBatchId).
        //
        // We locate the exact slot by checking known values:
        //   currentBatchId is stored at some slot S, issuerRegistry at S+1.
        // Use vm.load to confirm and then zero issuerRegistry.

        // Deploy fresh aggregator + find the issuerRegistry storage slot
        OracleAggregationCRA freshImpl = new OracleAggregationCRA();
        address freshStubTPO = makeAddr("freshTpo");
        // Use the real registry so initialize passes
        ERC1967Proxy freshProxy = new ERC1967Proxy(
            address(freshImpl),
            abi.encodeCall(
                OracleAggregationCRA.initialize,
                (address(reg), freshStubTPO)
            )
        );
        OracleAggregationCRA freshAgg = OracleAggregationCRA(address(freshProxy));

        // Scan for the slot holding issuerRegistry (address(reg))
        bytes32 registryAsBytes = bytes32(uint256(uint160(address(reg))));
        uint256 registrySlot = type(uint256).max;
        for (uint256 s = 0; s < 10; s++) {
            if (vm.load(address(freshProxy), bytes32(s)) == registryAsBytes) {
                registrySlot = s;
                break;
            }
        }
        require(registrySlot != type(uint256).max, "registry slot not found");

        // Zero out the issuerRegistry slot → pre-wiring path
        vm.store(address(freshProxy), bytes32(registrySlot), bytes32(0));
        assertEq(freshAgg.issuerRegistry(), address(0), "slot zeroed");

        // Now commitPrice should succeed for any caller (permissive)
        address anyAddress = makeAddr("anyAddress");
        bytes32 commitHash = keccak256(abi.encodePacked(uint256(2000e18), bytes32(uint256(42))));
        vm.prank(anyAddress);
        freshAgg.commitPrice(commitHash);

        // Confirm the commit was recorded
        IOracleAggregationCRA.BatchInfo memory info = freshAgg.getBatch(freshAgg.getCurrentBatchId());
        assertEq(info.commitCount, 1, "zero-registry: any caller should be accepted");
    }
}
