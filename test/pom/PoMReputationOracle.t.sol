// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {PoMOperatorRegistry} from "../../contracts/pom/PoMOperatorRegistry.sol";
import {PoMReward} from "../../contracts/pom/PoMReward.sol";
import {PoMExportHub} from "../../contracts/pom/PoMExportHub.sol";
import {PoMReputationOracle} from "../../contracts/pom/PoMReputationOracle.sol";
import {IPoMExportHub} from "../../contracts/pom/interfaces/IPoMExportHub.sol";
import {IProofOfMindReputation} from "../../contracts/pom/interfaces/IProofOfMindReputation.sol";

contract MockBond is ERC20 {
    constructor() ERC20("Bond", "BOND") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title PoMReputationOracle — the reputation read surface consumers gate on
 * @notice A finalized standing carries a scores root; the oracle lets any protocol record a
 *         contributor's verified reputation once, then read it cheaply (reputationOf /
 *         hasReputationAtLeast), plus an as-of-now verifyLive.
 */
contract PoMReputationOracleTest is Test {
    MockBond bond;
    PoMReward reward;
    PoMOperatorRegistry registry;
    PoMExportHub hub;
    PoMReputationOracle oracle;

    address owner = makeAddr("owner");
    address resolver = makeAddr("resolver");
    address proposer = makeAddr("proposer");
    address rando = makeAddr("rando");

    uint64 constant WINDOW = 1 hours;
    uint64 constant RESOLUTION_WINDOW = 1 days;
    uint96 constant BOND = 1 ether;

    bytes32 contribA = keccak256("alice");
    bytes32 contribB = keccak256("bob");
    uint256 constant VAL_A = 1000;
    uint256 constant VAL_B = 500;
    bytes32 scoresRoot;
    bytes32[] proofA;

    function setUp() public {
        bond = new MockBond();
        reward = new PoMReward(owner);

        PoMOperatorRegistry regImpl = new PoMOperatorRegistry();
        registry = PoMOperatorRegistry(address(new ERC1967Proxy(
            address(regImpl),
            abi.encodeCall(PoMOperatorRegistry.initialize, (address(bond), owner))
        )));

        PoMExportHub hubImpl = new PoMExportHub();
        hub = PoMExportHub(address(new ERC1967Proxy(
            address(hubImpl),
            abi.encodeCall(PoMExportHub.initialize, (
                address(registry), address(reward), resolver, owner,
                WINDOW, RESOLUTION_WINDOW, uint96(50e18), uint96(0.5 ether)
            ))
        )));

        vm.startPrank(owner);
        registry.setSlasher(address(hub));
        reward.setMinter(address(hub));
        vm.stopPrank();

        bond.mint(proposer, BOND);
        vm.startPrank(proposer);
        bond.approve(address(registry), type(uint256).max);
        registry.register(proposer, BOND);
        vm.stopPrank();
        vm.warp(block.timestamp + registry.activationDelay() + 1);

        scoresRoot = _hashPair(_leaf(contribA, VAL_A), _leaf(contribB, VAL_B));
        proofA.push(_leaf(contribB, VAL_B));

        // Finalize a standing so the hub exposes a live scoresRoot the oracle reads.
        IPoMExportHub.PomStanding memory s = IPoMExportHub.PomStanding({
            nonce: 0,
            noesisHeight: 1,
            thetaSimQ16: 62259,
            thetaEntQ16: 62259,
            total: VAL_A + VAL_B,
            scoresRoot: scoresRoot,
            payoutRoot: keccak256("payout"),
            inputCommitment: keccak256("canonical-inputs")
        });
        vm.prank(proposer);
        uint256 id = hub.propose(s);
        vm.warp(block.timestamp + WINDOW + 1);
        hub.finalize(id);

        oracle = new PoMReputationOracle(address(hub));
    }

    function _leaf(bytes32 c, uint256 v) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(c, v))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function test_Constructor_RejectsZeroHub() public {
        vm.expectRevert(bytes("hub=0"));
        new PoMReputationOracle(address(0));
    }

    function test_RecordThenRead() public {
        // Permissionless record: anyone submits a valid proof; the fact is public.
        vm.prank(rando);
        oracle.recordReputation(contribA, VAL_A, proofA);

        (uint256 value, uint256 asOfNonce) = oracle.reputationOf(contribA);
        assertEq(value, VAL_A, "recorded value");
        assertEq(asOfNonce, 0, "stamped with the standing nonce");
        assertEq(oracle.hub(), address(hub), "hub exposed");
    }

    function test_HasReputationAtLeast_GatesOnEarnedMind() public {
        oracle.recordReputation(contribA, VAL_A, proofA);
        assertTrue(oracle.hasReputationAtLeast(contribA, VAL_A), "meets exact threshold");
        assertTrue(oracle.hasReputationAtLeast(contribA, VAL_A - 1), "meets lower threshold");
        assertFalse(oracle.hasReputationAtLeast(contribA, VAL_A + 1), "below higher threshold");
        // Unknown contributor reads zero, gates closed.
        assertFalse(oracle.hasReputationAtLeast(contribB, 1), "unrecorded contributor has no standing");
    }

    function test_Record_RejectsBadProof() public {
        // Wrong value => leaf not in the scores tree.
        vm.expectRevert(IProofOfMindReputation.InvalidReputationProof.selector);
        oracle.recordReputation(contribA, VAL_A + 1, proofA);
    }

    function test_VerifyLive_NoStateWrite() public view {
        assertTrue(oracle.verifyLive(contribA, VAL_A, proofA), "honest live check passes");
        assertFalse(oracle.verifyLive(contribA, VAL_A - 1, proofA), "tampered value fails");
        // verifyLive never records.
        (uint256 value,) = oracle.reputationOf(contribA);
        assertEq(value, 0, "verifyLive did not cache");
    }

    function test_ReputationOf_UnknownIsZero() public view {
        (uint256 value, uint256 asOfNonce) = oracle.reputationOf(keccak256("nobody"));
        assertEq(value, 0);
        assertEq(asOfNonce, 0);
    }
}
