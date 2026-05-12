// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Implementation reporting the SAME axiom hash as the canonical ShapleyDistributor.
///      Represents a future implementation that preserves the axiom set (e.g., bug fix,
///      gas optimization, new internal data structure — but unchanged math semantics).
contract ShapleyDistributorSameAxiom is ShapleyDistributor {
    // Inherits axiomVersion() from ShapleyDistributor → returns the canonical hash.
}

/// @dev Implementation that fabricates a DIFFERENT axiom hash. Represents a malicious
///      or careless governance-elected impl that signals it enforces a different axiom
///      set. _authorizeUpgrade must reject this.
contract ShapleyDistributorDifferentAxiom is ShapleyDistributor {
    function axiomVersion() public pure override returns (bytes32) {
        return keccak256("vibeswap-shapley-axiom-set:LINEARITY-DROPPED");
    }
}

/// @dev Implementation that does NOT expose axiomVersion() at all (raw contract).
///      _authorizeUpgrade must reject this with "axiom-version call failed" because
///      the staticcall reverts on missing function.
contract NoAxiomVersionImpl {
    /// @dev Mimics minimal UUPS impl surface — has code but no axiomVersion().
    function proxiableUUID() external pure returns (bytes32) {
        return 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    }
    function placeholder() external pure returns (uint256) { return 0; }
}

/// @dev Implementation whose axiomVersion() returns malformed data (not 32 bytes).
///      Edge case — staticcall succeeds but returns unexpected length.
contract BadReturnImpl {
    function proxiableUUID() external pure returns (bytes32) {
        return 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    }
    function axiomVersion() external pure returns (bytes16) {
        return bytes16(keccak256("short-return"));
    }
}

contract ShapleyDistributorAxiomVersionGateTest is Test {
    ShapleyDistributor public distributor;
    address public owner;

    function setUp() public {
        owner = address(this);

        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));
    }

    // ============ axiomVersion() is deterministic + stable ============

    function test_axiomVersion_isDeterministic() public view {
        bytes32 v1 = distributor.axiomVersion();
        bytes32 v2 = distributor.axiomVersion();
        assertEq(v1, v2);
        assertTrue(v1 != bytes32(0));
    }

    function test_axiomVersion_matchesExpectedHash() public view {
        bytes32 expected = keccak256(
            "vibeswap-shapley-axiom-set:linearity|symmetry|efficiency|null-player|pairwise-proportionality"
        );
        assertEq(distributor.axiomVersion(), expected);
    }

    // ============ Upgrade gate — POSITIVE cases ============

    function test_upgrade_succeedsWithSameAxiomVersion() public {
        ShapleyDistributorSameAxiom newImpl = new ShapleyDistributorSameAxiom();
        // Same axiom hash → upgrade allowed
        distributor.upgradeToAndCall(address(newImpl), "");
        // After upgrade, axiomVersion() still returns the same value
        assertEq(
            distributor.axiomVersion(),
            keccak256("vibeswap-shapley-axiom-set:linearity|symmetry|efficiency|null-player|pairwise-proportionality")
        );
    }

    // ============ Upgrade gate — NEGATIVE cases ============

    function test_upgrade_revertsWithDifferentAxiomVersion() public {
        ShapleyDistributorDifferentAxiom badImpl = new ShapleyDistributorDifferentAxiom();
        vm.expectRevert("axiom-version mismatch");
        distributor.upgradeToAndCall(address(badImpl), "");
    }

    function test_upgrade_revertsWhenImplMissingAxiomVersion() public {
        NoAxiomVersionImpl bareImpl = new NoAxiomVersionImpl();
        vm.expectRevert("axiom-version call failed");
        distributor.upgradeToAndCall(address(bareImpl), "");
    }

    function test_upgrade_revertsWhenImplReturnsBadLength() public {
        BadReturnImpl badImpl = new BadReturnImpl();
        // bytes16 packs into 32-byte ABI return slot (left-padded), so length is 32.
        // The decode succeeds but the hash bytes differ from current → mismatch.
        vm.expectRevert("axiom-version mismatch");
        distributor.upgradeToAndCall(address(badImpl), "");
    }

    function test_upgrade_revertsWhenImplIsNotAContract() public {
        address eoa = makeAddr("eoa-not-a-contract");
        vm.expectRevert("Not a contract");
        distributor.upgradeToAndCall(eoa, "");
    }

    function test_upgrade_revertsWhenNotOwner() public {
        ShapleyDistributorSameAxiom newImpl = new ShapleyDistributorSameAxiom();
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        // OwnableUpgradeable's revert
        vm.expectRevert();
        distributor.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Invariant: every axiomVersion change is a deliberate migration ============

    /// @dev Documents the migration discipline: changing the axiom set requires
    ///      changing the constant string in axiomVersion(), which produces a new
    ///      hash that won't match the current one — so the upgrade reverts at
    ///      this gate. Anyone wanting to change axioms must explicitly authorize
    ///      a *separate* governance action that updates the requirement, not
    ///      slip the change through a routine upgrade.
    function test_axiomVersion_distinctHashesForDistinctImpls() public {
        ShapleyDistributorSameAxiom sameImpl = new ShapleyDistributorSameAxiom();
        ShapleyDistributorDifferentAxiom diffImpl = new ShapleyDistributorDifferentAxiom();
        assertEq(sameImpl.axiomVersion(), distributor.axiomVersion());
        assertTrue(diffImpl.axiomVersion() != distributor.axiomVersion());
    }
}
