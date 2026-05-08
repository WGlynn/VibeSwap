// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../contracts/messaging/MessagingPoM.sol";
import "../../contracts/messaging/MessagingValidatorRegistry.sol";
import {IAttestationVerifier} from "../../contracts/messaging/interfaces/IAttestationVerifier.sol";
import {IMessagingValidatorRegistry} from "../../contracts/messaging/interfaces/IMessagingValidatorRegistry.sol";

contract MockBondToken is ERC20 {
    constructor() ERC20("Bond", "BOND") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Minimal AttestationVerifier mock — implements the methods the PoM
///         calls (only hashMessage in v0.1).
contract MockVerifier is IAttestationVerifier {
    function verify(AttestationMessage calldata, AttestationProof calldata)
        external pure returns (bytes32, uint32) { return (bytes32(0), 0); }
    function hashMessage(AttestationMessage calldata m) external pure returns (bytes32) {
        return keccak256(abi.encode(
            m.sourceChainId, m.dstChainId, m.nonce, m.sender, m.recipient,
            m.token, m.amount, m.sourceBlockHash, m.sourceBlockNumber
        ));
    }
    function threshold(uint64) external pure returns (uint32) { return 0; }
    function isConsumed(bytes32) external pure returns (bool) { return false; }
    function consume(bytes32) external pure {}
    function expectedAggregator(uint64, uint256) external pure returns (uint32) { return 0; }
    function isAggregatorWindowOpen(uint256) external pure returns (bool) { return true; }
    function aggregatorWindow() external pure returns (uint64) { return 60; }
    function registry() external pure returns (IMessagingValidatorRegistry) {
        return IMessagingValidatorRegistry(address(0));
    }
}

contract MessagingPoMTest is Test {
    MessagingPoM public pom;
    MessagingValidatorRegistry public registry;
    MockBondToken public bond;
    MockVerifier public verifier;

    address owner = makeAddr("owner");
    address authority = makeAddr("pomAuthority");
    address pool = makeAddr("insurancePool");
    address mallory = makeAddr("mallory");

    address op1 = makeAddr("op1");
    address op2 = makeAddr("op2");
    bytes pk1;
    bytes pk2;

    uint96 constant BOND = 100 ether;
    uint96 constant SUBMISSION_BOND = 1 ether;

    uint32 idx1;
    uint32 idx2;

    function setUp() public {
        bond = new MockBondToken();
        verifier = new MockVerifier();

        // Deploy PoM proxy first so we know its address; then deploy registry
        // with PoM as the slasher; then re-init PoM with the registry address.
        // OZ proxies require initialize during deploy — we'll initialize PoM
        // with placeholders, then patch via setters.

        // Predict PoM proxy address by deploying impl → proxy.
        // Simpler: deploy registry with a placeholder PoM address then update.
        MessagingValidatorRegistry regImpl = new MessagingValidatorRegistry();
        bytes memory regData = abi.encodeWithSelector(
            MessagingValidatorRegistry.initialize.selector,
            address(bond),
            address(this), // temp placeholder — will be updated
            owner
        );
        ERC1967Proxy regProxy = new ERC1967Proxy(address(regImpl), regData);
        registry = MessagingValidatorRegistry(address(regProxy));

        MessagingPoM pomImpl = new MessagingPoM();
        bytes memory pomData = abi.encodeWithSelector(
            MessagingPoM.initialize.selector,
            address(registry),
            address(verifier),
            address(bond),
            authority,
            pool,
            SUBMISSION_BOND,
            owner
        );
        ERC1967Proxy pomProxy = new ERC1967Proxy(address(pomImpl), pomData);
        pom = MessagingPoM(address(pomProxy));

        // Now wire PoM as the registry's slasher.
        vm.prank(owner);
        registry.setProofOfMisbehavior(address(pom));

        // Set up validators.
        pk1 = _pubkey(0xAA);
        pk2 = _pubkey(0xBB);
        bond.mint(op1, 1_000 ether);
        bond.mint(op2, 1_000 ether);

        idx1 = _register(op1, pk1, BOND);
        idx2 = _register(op2, pk2, BOND);
    }

    // ============ Helpers ============

    function _pubkey(uint8 fill) internal pure returns (bytes memory) {
        bytes memory pk = new bytes(48);
        for (uint256 i = 0; i < 48; i++) pk[i] = bytes1(fill);
        return pk;
    }

    function _register(address op, bytes memory pk, uint96 amount) internal returns (uint32) {
        vm.startPrank(op);
        bond.approve(address(registry), amount);
        uint32 idx = registry.register(pk, op, amount);
        vm.stopPrank();
        return idx;
    }

    function _msg(uint64 nonce, uint256 amount) internal view returns (
        IAttestationVerifier.AttestationMessage memory
    ) {
        return IAttestationVerifier.AttestationMessage({
            sourceChainId: 1,
            dstChainId: 8453,
            nonce: nonce,
            sender: address(this),
            recipient: address(this),
            token: address(this),
            amount: amount,
            sourceBlockHash: bytes32("block"),
            sourceBlockNumber: 100
        });
    }

    // ============ Forged attestation ============

    function test_slashForged_callerMustBeAuthority() public {
        IAttestationVerifier.AttestationMessage memory mA = _msg(1, 100 ether);
        IAttestationVerifier.AttestationMessage memory mB = _msg(1, 200 ether);

        vm.prank(mallory);
        vm.expectRevert(MessagingPoM.UnauthorizedCaller.selector);
        pom.slashForgedAttestation(idx1, mA, mB);
    }

    function test_slashForged_revertsIfMessagesAreIdentical() public {
        IAttestationVerifier.AttestationMessage memory mA = _msg(1, 100 ether);

        vm.prank(authority);
        vm.expectRevert(MessagingPoM.MessagesNotConflicting.selector);
        pom.slashForgedAttestation(idx1, mA, mA);
    }

    function test_slashForged_revertsIfDifferentNonces() public {
        IAttestationVerifier.AttestationMessage memory mA = _msg(1, 100 ether);
        IAttestationVerifier.AttestationMessage memory mB = _msg(2, 100 ether);

        vm.prank(authority);
        vm.expectRevert(MessagingPoM.MessagesNotConflicting.selector);
        pom.slashForgedAttestation(idx1, mA, mB);
    }

    function test_slashForged_slashes100Percent() public {
        IAttestationVerifier.AttestationMessage memory mA = _msg(1, 100 ether);
        IAttestationVerifier.AttestationMessage memory mB = _msg(1, 200 ether);

        uint96 bondBefore = registry.getValidator(idx1).bondAmount;
        assertEq(bondBefore, BOND);

        vm.prank(authority);
        pom.slashForgedAttestation(idx1, mA, mB);

        IMessagingValidatorRegistry.Validator memory v = registry.getValidator(idx1);
        assertEq(v.bondAmount, 0, "100% slash leaves zero bond");
        assertTrue(v.slashed);
    }

    function test_slashForged_revertsOnDuplicateEvidence() public {
        IAttestationVerifier.AttestationMessage memory mA = _msg(1, 100 ether);
        IAttestationVerifier.AttestationMessage memory mB = _msg(1, 200 ether);

        vm.startPrank(authority);
        pom.slashForgedAttestation(idx1, mA, mB);

        vm.expectRevert(MessagingPoM.EvidenceAlreadyClaimed.selector);
        pom.slashForgedAttestation(idx1, mA, mB);
        vm.stopPrank();
    }

    // ============ Reorged signature ============

    function test_slashReorg_slashes50Percent() public {
        vm.prank(authority);
        pom.slashReorgedSignature(idx1, bytes32("orphan"), bytes32("canon"), 100, 1);

        IMessagingValidatorRegistry.Validator memory v = registry.getValidator(idx1);
        assertEq(v.bondAmount, BOND - (BOND * 5_000 / 10_000));
        // 50 ether residual is above the bond floor (32 ether), so validator
        // is NOT auto-ejected — they can keep operating with reduced stake.
        assertFalse(v.slashed);
    }

    function test_slashReorg_revertsOnIdenticalHashes() public {
        vm.prank(authority);
        vm.expectRevert(MessagingPoM.MessagesNotConflicting.selector);
        pom.slashReorgedSignature(idx1, bytes32("x"), bytes32("x"), 100, 1);
    }

    function test_slashReorg_callerMustBeAuthority() public {
        vm.prank(mallory);
        vm.expectRevert(MessagingPoM.UnauthorizedCaller.selector);
        pom.slashReorgedSignature(idx1, bytes32("o"), bytes32("c"), 100, 1);
    }

    // ============ Liveness ============

    function test_slashLiveness_slashes5Percent() public {
        vm.prank(authority);
        pom.slashLivenessFailure(idx1, 1_000, 15);

        IMessagingValidatorRegistry.Validator memory v = registry.getValidator(idx1);
        assertEq(v.bondAmount, BOND - (BOND * 500 / 10_000));
    }

    function test_slashLiveness_revertsBelowThreshold() public {
        vm.prank(authority);
        vm.expectRevert(
            abi.encodeWithSelector(
                MessagingPoM.MissedCountBelowThreshold.selector,
                uint64(5),
                uint64(10)
            )
        );
        pom.slashLivenessFailure(idx1, 1_000, 5);
    }

    function test_slashLiveness_revertsOnDuplicateWindow() public {
        vm.startPrank(authority);
        pom.slashLivenessFailure(idx1, 1_000, 15);

        vm.expectRevert(MessagingPoM.EvidenceAlreadyClaimed.selector);
        pom.slashLivenessFailure(idx1, 1_000, 15);
        vm.stopPrank();
    }

    // ============ Cumulative slashing ============

    function test_repeatedLivenessSlashesEjectOnNthOffense() public {
        // Self-audit C-2: 5% per offense up to LIVENESS_OFFENSE_LIMIT, then
        // 100% on the limit-th offense — explicit ejection rather than
        // asymptotic decay.
        uint32 limit = pom.LIVENESS_OFFENSE_LIMIT();
        uint64 window = 1_000;

        // First (limit-1) offenses don't eject.
        for (uint256 i = 0; i < limit - 1; i++) {
            vm.prank(authority);
            pom.slashLivenessFailure(idx1, window, 15);
            window += 24 hours;

            IMessagingValidatorRegistry.Validator memory v = registry.getValidator(idx1);
            assertFalse(v.slashed, "should not be ejected before limit");
            assertEq(pom.livenessOffenses(idx1), uint32(i + 1));
        }

        // limit-th offense ejects.
        vm.prank(authority);
        pom.slashLivenessFailure(idx1, window, 15);

        IMessagingValidatorRegistry.Validator memory v = registry.getValidator(idx1);
        assertTrue(v.slashed, "should be ejected on Nth liveness offense");
        assertEq(v.bondAmount, 0, "100% slash on the limit-th offense");
    }

    function test_livenessOffenseCounter_isPerValidator() public {
        // Slashing op1 doesn't increment op2's counter.
        vm.prank(authority);
        pom.slashLivenessFailure(idx1, 1_000, 15);

        assertEq(pom.livenessOffenses(idx1), 1);
        assertEq(pom.livenessOffenses(idx2), 0);
    }

    // ============ Admin ============

    function test_setPomAuthority_rotates() public {
        address newAuth = makeAddr("newAuth");
        vm.prank(owner);
        pom.setPomAuthority(newAuth);
        assertEq(pom.pomAuthority(), newAuth);

        // Old authority no longer works.
        IAttestationVerifier.AttestationMessage memory mA = _msg(1, 100 ether);
        IAttestationVerifier.AttestationMessage memory mB = _msg(1, 200 ether);
        vm.prank(authority);
        vm.expectRevert(MessagingPoM.UnauthorizedCaller.selector);
        pom.slashForgedAttestation(idx1, mA, mB);
    }
}
