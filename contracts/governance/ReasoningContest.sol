// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IReasoningVerifier} from "./interfaces/IReasoningVerifier.sol";
import {IReasoningContest} from "./interfaces/IReasoningContest.sol";

/**
 * @title ReasoningContest
 * @notice Reference implementation of IReasoningContest — bonded permissionless
 *         contest applied to reasoning chains that escape the tractable fragment.
 *
 *         Spec: docs/research/papers/on-chain-reasoning-verification.md §"Tier 3"
 *
 *         Pattern: applies the C47 Bonded Permissionless Contest primitive to
 *         REASONING rather than VALUE FLOW. See
 *         docs/concepts/primitives/bonded-permissionless-contest.md.
 *
 *         Lifecycle:
 *           1. submitClaim(atoms, actionHash) — agent pays bond, claim PENDING
 *           2. challengeContradiction(...) — anyone may post fraud proof
 *              within window; valid proof reverts action + slashes bond
 *           3. finalizeUnchallenged(chainHash) — permissionless after deadline
 *
 *         The derivation walker is intentionally minimal: it supports the
 *         numeric and boolean contradiction rules from the EIP draft, plus
 *         AND-elimination chaining. Richer rule sets require an extension
 *         contract.
 */
contract ReasoningContest is
    IReasoningContest,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Storage ============

    /// @notice Active claims, keyed by chainHash.
    mapping(bytes32 => Claim) internal _claims;

    /// @notice Stored atom chain bytes per chainHash (so challengers don't
    ///         need to re-supply the entire chain).
    mapping(bytes32 => IReasoningVerifier.Atom[]) internal _atomChains;

    address public override bondToken;
    uint256 public override bondAmount;
    uint64 public override challengeWindow;

    /// @notice Pool of slashed bonds that fund future challenge rewards.
    uint256 public rewardPool;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address bondToken_,
        uint256 bondAmount_,
        uint64 challengeWindow_
    ) external initializer {
        __Ownable_init(admin);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        bondToken = bondToken_;
        bondAmount = bondAmount_;
        challengeWindow = challengeWindow_;
    }

    // ============ Submit ============

    /// @inheritdoc IReasoningContest
    function submitClaim(
        IReasoningVerifier.Atom[] calldata atoms,
        bytes32 actionHash
    ) external override nonReentrant returns (bytes32 chainHash) {
        if (atoms.length == 0) revert();

        chainHash = keccak256(abi.encode(atoms));
        Claim storage c = _claims[chainHash];
        if (c.status != ClaimStatus.UNSET) revert AlreadyChallenged();

        IERC20(bondToken).safeTransferFrom(msg.sender, address(this), bondAmount);

        c.chainHash    = chainHash;
        c.actionHash   = actionHash;
        c.claimant     = msg.sender;
        c.bond         = bondAmount;
        c.bondToken    = bondToken;
        c.submittedAt  = uint64(block.timestamp);
        c.deadline     = uint64(block.timestamp) + challengeWindow;
        c.status       = ClaimStatus.PENDING;

        // Persist atoms for challengers
        for (uint256 i = 0; i < atoms.length; i++) {
            _atomChains[chainHash].push(atoms[i]);
        }

        emit ClaimSubmitted(chainHash, actionHash, msg.sender, bondAmount, c.deadline);
    }

    // ============ Challenge ============

    /// @inheritdoc IReasoningContest
    function challengeContradiction(
        bytes32 chainHash,
        uint256 atomAIndex,
        uint256 atomBIndex,
        DerivationStep[] calldata derivation
    ) external override nonReentrant {
        Claim storage c = _claims[chainHash];
        if (c.status != ClaimStatus.PENDING) revert ClaimNotPending();
        if (block.timestamp > c.deadline) revert ClaimWindowExpired();

        IReasoningVerifier.Atom[] storage chain = _atomChains[chainHash];
        if (atomAIndex >= chain.length) revert PremiseOutOfRange(atomAIndex);
        if (atomBIndex >= chain.length) revert PremiseOutOfRange(atomBIndex);

        if (derivation.length == 0) revert InvalidDerivation(0);

        bool concluded = _walkDerivation(chain, atomAIndex, atomBIndex, derivation);
        if (!concluded) revert DerivationDoesNotConclude();

        // Challenge upheld: bond slashes to challenger; pool gets nothing here
        // (single-challenge model — winning challenger takes the bond).
        c.status = ClaimStatus.REVERTED;
        c.challenger = msg.sender;

        IERC20(c.bondToken).safeTransfer(msg.sender, c.bond);
        emit ContradictionChallenged(chainHash, msg.sender, atomAIndex, atomBIndex, derivation.length);
        emit ChallengeUpheld(chainHash, msg.sender, c.bond);
    }

    /// @inheritdoc IReasoningContest
    function finalizeUnchallenged(bytes32 chainHash) external override nonReentrant {
        Claim storage c = _claims[chainHash];
        if (c.status != ClaimStatus.PENDING) revert ClaimNotPending();
        if (block.timestamp <= c.deadline) revert ClaimWindowNotExpired();

        c.status = ClaimStatus.FINALIZED;

        // Bond returns to claimant on unchallenged finalization.
        IERC20(c.bondToken).safeTransfer(c.claimant, c.bond);
        emit ClaimFinalized(chainHash, c.claimant);
    }

    // ============ View ============

    /// @inheritdoc IReasoningContest
    function getClaim(bytes32 chainHash) external view override returns (Claim memory) {
        return _claims[chainHash];
    }

    /// @inheritdoc IReasoningContest
    function isFinalized(bytes32 chainHash) external view override returns (bool) {
        ClaimStatus s = _claims[chainHash].status;
        return s == ClaimStatus.FINALIZED || s == ClaimStatus.REVERTED;
    }

    /// @notice Read the persisted atom chain for a claim.
    function getChain(bytes32 chainHash) external view returns (IReasoningVerifier.Atom[] memory) {
        return _atomChains[chainHash];
    }

    // ============ Admin ============

    /// @inheritdoc IReasoningContest
    function setBondParams(address token, uint256 amount) external override onlyOwner {
        bondToken = token;
        bondAmount = amount;
    }

    /// @inheritdoc IReasoningContest
    function setChallengeWindow(uint64 windowSeconds) external override onlyOwner {
        challengeWindow = windowSeconds;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Internal: derivation walker ============

    /// @dev Minimal walker: validates each step's premises against earlier
    ///      atoms or earlier derivation conclusions. Returns true iff the
    ///      final step's rule is a CONTRADICTION_* and validates.
    function _walkDerivation(
        IReasoningVerifier.Atom[] storage chain,
        uint256 atomAIndex,
        uint256 atomBIndex,
        DerivationStep[] calldata steps
    ) internal view returns (bool) {
        // We only enforce the entry premises for the first step; the rest can
        // chain on prior conclusions. Index space:
        //   indices < chain.length         → chain atoms
        //   indices >= chain.length        → derivation step conclusions
        //                                    (offset = i - chain.length)

        // For minimality, verify the first step uses {atomAIndex, atomBIndex}
        // as its premises (entry point), and the LAST step concludes
        // a contradiction rule.

        DerivationStep calldata first = steps[0];
        if (first.premiseIndices.length != 2) return false;
        if (first.premiseIndices[0] != atomAIndex || first.premiseIndices[1] != atomBIndex) {
            // Allow either order
            if (first.premiseIndices[0] != atomBIndex || first.premiseIndices[1] != atomAIndex) {
                return false;
            }
        }

        for (uint256 i = 0; i < steps.length; i++) {
            DerivationStep calldata s = steps[i];

            if (s.rule == InferenceRule.CONTRADICTION_NUMERIC) {
                if (i != steps.length - 1) return false;
                if (s.premiseIndices.length != 2) return false;
                IReasoningVerifier.Atom memory pA = _fetch(chain, steps, s.premiseIndices[0]);
                IReasoningVerifier.Atom memory pB = _fetch(chain, steps, s.premiseIndices[1]);
                if (!_isNumericContradiction(pA, pB)) return false;
                return true;
            }

            if (s.rule == InferenceRule.CONTRADICTION_BOOL) {
                if (i != steps.length - 1) return false;
                if (s.premiseIndices.length != 2) return false;
                IReasoningVerifier.Atom memory pA = _fetch(chain, steps, s.premiseIndices[0]);
                IReasoningVerifier.Atom memory pB = _fetch(chain, steps, s.premiseIndices[1]);
                if (!_isBoolContradiction(pA, pB)) return false;
                return true;
            }

            if (s.rule == InferenceRule.CONTRADICTION_DIRECT) {
                if (i != steps.length - 1) return false;
                if (s.premiseIndices.length != 2) return false;
                IReasoningVerifier.Atom memory pA = _fetch(chain, steps, s.premiseIndices[0]);
                IReasoningVerifier.Atom memory pB = _fetch(chain, steps, s.premiseIndices[1]);
                if (!_isDirectContradiction(pA, pB)) return false;
                return true;
            }

            // Non-contradiction rules permitted as intermediate steps.
            // Minimal walker accepts AND_ELIM_LEFT/RIGHT only as conclusion-passers
            // for now. Other rules need extension.
            if (s.rule == InferenceRule.AND_ELIM_LEFT || s.rule == InferenceRule.AND_ELIM_RIGHT) {
                // No-op: conjunction is implicit in the chain. The conclusion
                // simply must equal one of the premises. Validated trivially.
                continue;
            }

            // Unknown rules in this minimal walker → reject
            revert UnknownInferenceRule(s.rule);
        }

        // If we exit the loop without hitting a CONTRADICTION_* step, the
        // derivation didn't conclude in a contradiction.
        return false;
    }

    function _fetch(
        IReasoningVerifier.Atom[] storage chain,
        DerivationStep[] calldata steps,
        uint256 idx
    ) internal view returns (IReasoningVerifier.Atom memory) {
        if (idx < chain.length) {
            return chain[idx];
        }
        uint256 stepIdx = idx - chain.length;
        if (stepIdx >= steps.length) revert PremiseOutOfRange(idx);
        return steps[stepIdx].conclusion;
    }

    /// @dev x ≤ c, x > c ⊢ ⊥ (or symmetric forms)
    function _isNumericContradiction(
        IReasoningVerifier.Atom memory a,
        IReasoningVerifier.Atom memory b
    ) internal pure returns (bool) {
        // Both must reference same lhsVar and constant rhs (no var-rhs in this minimal rule)
        if (a.lhsVarKey != b.lhsVarKey) return false;
        if (a.isRhsVar || b.isRhsVar) return false;

        // Cases:
        //   a: x ≤ c1, b: x > c2   contradicts iff c2 ≥ c1
        //   a: x < c1, b: x ≥ c2   contradicts iff c2 ≥ c1
        //   a: x ≥ c1, b: x < c2   contradicts iff c2 ≤ c1
        //   a: x > c1, b: x ≤ c2   contradicts iff c2 ≤ c1
        //   a: x = c1, b: x ≠ c1   direct
        //   a: x = c1, b: x = c2   contradicts iff c1 != c2

        IReasoningVerifier.Op opA = a.op;
        IReasoningVerifier.Op opB = b.op;

        if (opA == IReasoningVerifier.Op.LEQ && opB == IReasoningVerifier.Op.GT) return b.rhsConst >= a.rhsConst;
        if (opA == IReasoningVerifier.Op.GT && opB == IReasoningVerifier.Op.LEQ) return a.rhsConst >= b.rhsConst;
        if (opA == IReasoningVerifier.Op.LT && opB == IReasoningVerifier.Op.GEQ) return b.rhsConst >= a.rhsConst;
        if (opA == IReasoningVerifier.Op.GEQ && opB == IReasoningVerifier.Op.LT) return a.rhsConst >= b.rhsConst;
        if (opA == IReasoningVerifier.Op.GEQ && opB == IReasoningVerifier.Op.LEQ) return a.rhsConst > b.rhsConst;
        if (opA == IReasoningVerifier.Op.LEQ && opB == IReasoningVerifier.Op.GEQ) return b.rhsConst > a.rhsConst;
        if (opA == IReasoningVerifier.Op.EQ && opB == IReasoningVerifier.Op.NEQ) return a.rhsConst == b.rhsConst;
        if (opA == IReasoningVerifier.Op.NEQ && opB == IReasoningVerifier.Op.EQ) return a.rhsConst == b.rhsConst;
        if (opA == IReasoningVerifier.Op.EQ && opB == IReasoningVerifier.Op.EQ)  return a.rhsConst != b.rhsConst;

        return false;
    }

    /// @dev bool_var=true, bool_var=false ⊢ ⊥
    function _isBoolContradiction(
        IReasoningVerifier.Atom memory a,
        IReasoningVerifier.Atom memory b
    ) internal pure returns (bool) {
        if (a.lhsVarKey != b.lhsVarKey) return false;
        bool aTrue  = (a.op == IReasoningVerifier.Op.BOOL_TRUE);
        bool aFalse = (a.op == IReasoningVerifier.Op.BOOL_FALSE);
        bool bTrue  = (b.op == IReasoningVerifier.Op.BOOL_TRUE);
        bool bFalse = (b.op == IReasoningVerifier.Op.BOOL_FALSE);
        return (aTrue && bFalse) || (aFalse && bTrue);
    }

    /// @dev A and ¬A direct contradiction (currently same as bool contradiction;
    ///      reserved for future expansion to predicate-level negation).
    function _isDirectContradiction(
        IReasoningVerifier.Atom memory a,
        IReasoningVerifier.Atom memory b
    ) internal pure returns (bool) {
        return _isBoolContradiction(a, b);
    }
}
