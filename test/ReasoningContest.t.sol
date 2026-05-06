// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../contracts/governance/ReasoningContest.sol";
import {IReasoningVerifier} from "../contracts/governance/interfaces/IReasoningVerifier.sol";
import {IReasoningContest} from "../contracts/governance/interfaces/IReasoningContest.sol";

contract MockBondToken is ERC20 {
    constructor() ERC20("BondMock", "BOND") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract ReasoningContestTest is Test {
    ReasoningContest internal contestProxy;
    MockBondToken internal token;

    address internal admin     = address(0xA);
    address internal claimant  = address(0xB);
    address internal challenger = address(0xC);

    uint256 internal constant BOND   = 1000 ether;
    uint64  internal constant WINDOW = 1 days;

    bytes32 internal constant K_AMOUNT  = keccak256("amount");
    bytes32 internal constant K_BOOL    = keccak256("notFrozen");

    function setUp() public {
        token = new MockBondToken();
        token.mint(claimant, BOND * 10);
        token.mint(challenger, BOND * 10);

        ReasoningContest impl = new ReasoningContest();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                ReasoningContest.initialize.selector,
                admin,
                address(token),
                BOND,
                WINDOW
            )
        );
        contestProxy = ReasoningContest(address(proxy));

        vm.prank(claimant);
        token.approve(address(contestProxy), type(uint256).max);
    }

    // ============ Helpers ============

    function _atom(
        bytes32 lhs,
        IReasoningVerifier.Op op,
        bool isRhsVar,
        bytes32 rhsVar,
        int256 rhsConst
    ) internal pure returns (IReasoningVerifier.Atom memory) {
        return IReasoningVerifier.Atom({
            lhsVarKey: lhs,
            op: op,
            isRhsVar: isRhsVar,
            rhsVarKey: rhsVar,
            rhsConst: rhsConst
        });
    }

    /// Inconsistent chain: amount <= 100 AND amount > 100
    function _numericContradictionChain() internal pure returns (IReasoningVerifier.Atom[] memory atoms) {
        atoms = new IReasoningVerifier.Atom[](2);
        atoms[0] = _atom(K_AMOUNT, IReasoningVerifier.Op.LEQ, false, bytes32(0), 100);
        atoms[1] = _atom(K_AMOUNT, IReasoningVerifier.Op.GT,  false, bytes32(0), 100);
    }

    /// Inconsistent boolean chain: notFrozen=true AND notFrozen=false
    function _boolContradictionChain() internal pure returns (IReasoningVerifier.Atom[] memory atoms) {
        atoms = new IReasoningVerifier.Atom[](2);
        atoms[0] = _atom(K_BOOL, IReasoningVerifier.Op.BOOL_TRUE,  false, bytes32(0), 0);
        atoms[1] = _atom(K_BOOL, IReasoningVerifier.Op.BOOL_FALSE, false, bytes32(0), 0);
    }

    function _consistentChain() internal pure returns (IReasoningVerifier.Atom[] memory atoms) {
        atoms = new IReasoningVerifier.Atom[](2);
        atoms[0] = _atom(K_AMOUNT, IReasoningVerifier.Op.LEQ, false, bytes32(0), 100);
        atoms[1] = _atom(K_AMOUNT, IReasoningVerifier.Op.GEQ, false, bytes32(0), 50);
    }

    // ============ submitClaim ============

    function test_submit_pullsBond_recordsClaim() public {
        IReasoningVerifier.Atom[] memory atoms = _consistentChain();
        bytes32 actionHash = keccak256("action-1");

        uint256 balBefore = token.balanceOf(claimant);
        vm.prank(claimant);
        bytes32 chainHash = contestProxy.submitClaim(atoms, actionHash);
        assertEq(token.balanceOf(claimant), balBefore - BOND);
        assertEq(token.balanceOf(address(contestProxy)), BOND);

        IReasoningContest.Claim memory c = contestProxy.getClaim(chainHash);
        assertEq(c.claimant, claimant);
        assertEq(c.bond, BOND);
        assertEq(c.actionHash, actionHash);
        assertEq(uint256(c.status), uint256(IReasoningContest.ClaimStatus.PENDING));
    }

    function test_submit_duplicateChain_reverts() public {
        IReasoningVerifier.Atom[] memory atoms = _consistentChain();
        vm.startPrank(claimant);
        contestProxy.submitClaim(atoms, keccak256("a1"));
        vm.expectRevert(IReasoningContest.AlreadyChallenged.selector);
        contestProxy.submitClaim(atoms, keccak256("a2"));
        vm.stopPrank();
    }

    // ============ challengeContradiction ============

    function test_numericContradiction_upheld_slashesBond() public {
        IReasoningVerifier.Atom[] memory atoms = _numericContradictionChain();
        bytes32 actionHash = keccak256("action-evil");

        vm.prank(claimant);
        bytes32 chainHash = contestProxy.submitClaim(atoms, actionHash);

        IReasoningContest.DerivationStep[] memory deriv = new IReasoningContest.DerivationStep[](1);
        deriv[0] = IReasoningContest.DerivationStep({
            rule: IReasoningContest.InferenceRule.CONTRADICTION_NUMERIC,
            premiseIndices: _indices2(0, 1),
            conclusion: _atom(bytes32(0), IReasoningVerifier.Op.EQ, false, bytes32(0), 0)
        });

        uint256 chBefore = token.balanceOf(challenger);
        vm.prank(challenger);
        contestProxy.challengeContradiction(chainHash, 0, 1, deriv);
        assertEq(token.balanceOf(challenger), chBefore + BOND);

        IReasoningContest.Claim memory c = contestProxy.getClaim(chainHash);
        assertEq(uint256(c.status), uint256(IReasoningContest.ClaimStatus.REVERTED));
        assertEq(c.challenger, challenger);
    }

    function test_boolContradiction_upheld() public {
        IReasoningVerifier.Atom[] memory atoms = _boolContradictionChain();

        vm.prank(claimant);
        bytes32 chainHash = contestProxy.submitClaim(atoms, keccak256("a3"));

        IReasoningContest.DerivationStep[] memory deriv = new IReasoningContest.DerivationStep[](1);
        deriv[0] = IReasoningContest.DerivationStep({
            rule: IReasoningContest.InferenceRule.CONTRADICTION_BOOL,
            premiseIndices: _indices2(0, 1),
            conclusion: _atom(bytes32(0), IReasoningVerifier.Op.EQ, false, bytes32(0), 0)
        });

        vm.prank(challenger);
        contestProxy.challengeContradiction(chainHash, 0, 1, deriv);

        IReasoningContest.Claim memory c = contestProxy.getClaim(chainHash);
        assertEq(uint256(c.status), uint256(IReasoningContest.ClaimStatus.REVERTED));
    }

    function test_consistentChain_challengeFails() public {
        IReasoningVerifier.Atom[] memory atoms = _consistentChain();
        vm.prank(claimant);
        bytes32 chainHash = contestProxy.submitClaim(atoms, keccak256("a4"));

        IReasoningContest.DerivationStep[] memory deriv = new IReasoningContest.DerivationStep[](1);
        deriv[0] = IReasoningContest.DerivationStep({
            rule: IReasoningContest.InferenceRule.CONTRADICTION_NUMERIC,
            premiseIndices: _indices2(0, 1),
            conclusion: _atom(bytes32(0), IReasoningVerifier.Op.EQ, false, bytes32(0), 0)
        });

        vm.prank(challenger);
        vm.expectRevert(IReasoningContest.DerivationDoesNotConclude.selector);
        contestProxy.challengeContradiction(chainHash, 0, 1, deriv);
    }

    function test_challengeAfterDeadline_reverts() public {
        IReasoningVerifier.Atom[] memory atoms = _numericContradictionChain();
        vm.prank(claimant);
        bytes32 chainHash = contestProxy.submitClaim(atoms, keccak256("a5"));

        skip(WINDOW + 1);

        IReasoningContest.DerivationStep[] memory deriv = new IReasoningContest.DerivationStep[](1);
        deriv[0] = IReasoningContest.DerivationStep({
            rule: IReasoningContest.InferenceRule.CONTRADICTION_NUMERIC,
            premiseIndices: _indices2(0, 1),
            conclusion: _atom(bytes32(0), IReasoningVerifier.Op.EQ, false, bytes32(0), 0)
        });

        vm.prank(challenger);
        vm.expectRevert(IReasoningContest.ClaimWindowExpired.selector);
        contestProxy.challengeContradiction(chainHash, 0, 1, deriv);
    }

    // ============ finalizeUnchallenged ============

    function test_finalize_returnsBond_afterWindow() public {
        IReasoningVerifier.Atom[] memory atoms = _consistentChain();
        vm.prank(claimant);
        bytes32 chainHash = contestProxy.submitClaim(atoms, keccak256("a6"));

        skip(WINDOW + 1);

        uint256 balBefore = token.balanceOf(claimant);
        contestProxy.finalizeUnchallenged(chainHash);
        assertEq(token.balanceOf(claimant), balBefore + BOND);

        assertTrue(contestProxy.isFinalized(chainHash));
    }

    function test_finalize_beforeWindow_reverts() public {
        IReasoningVerifier.Atom[] memory atoms = _consistentChain();
        vm.prank(claimant);
        bytes32 chainHash = contestProxy.submitClaim(atoms, keccak256("a7"));

        vm.expectRevert(IReasoningContest.ClaimWindowNotExpired.selector);
        contestProxy.finalizeUnchallenged(chainHash);
    }

    // ============ Helpers ============

    function _indices2(uint256 a, uint256 b) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](2);
        arr[0] = a;
        arr[1] = b;
    }
}
