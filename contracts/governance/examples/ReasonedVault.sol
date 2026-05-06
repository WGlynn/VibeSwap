// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IReasoningVerifier, IStateOracle} from "../interfaces/IReasoningVerifier.sol";

/**
 * @title ReasonedVault
 * @notice Example consumer: a minimal vault where withdrawals MUST be
 *         accompanied by a reasoning chain that the verifier accepts.
 *
 *         Demonstrates the integration pattern from
 *         `docs/concepts/WITNESS_AS_ON_CHAIN_WHY.md` — action and
 *         justification travel together, subject to the same fail-closed gate.
 *
 *         For docs/architecture purposes only — NOT production. The vault
 *         logic is deliberately minimal (single token, single user balance);
 *         the load-bearing demonstration is the reasoning-binding step.
 */
contract ReasonedVault {
    // ============ Storage ============

    mapping(address => uint256) public balanceOf;
    uint256 public maxWithdrawPerTx = 1_000 ether;
    bool public notFrozen = true;

    IReasoningVerifier public immutable verifier;
    IStateOracle public immutable oracle;

    // Canonical var-keys for atoms in this vault's grammar.
    // Per EIP-A: keccak256(abi.encode(domain, contract, selector, params))
    bytes32 public immutable K_AMOUNT;       // params: tx-scoped, set per call
    bytes32 public immutable K_BALANCE;      // params: msg.sender
    bytes32 public immutable K_MAX;
    bytes32 public immutable K_NOT_FROZEN;

    // ============ Events ============

    event Deposited(address indexed user, uint256 amount);
    event WithdrawalReasoned(address indexed user, uint256 amount, bytes32 chainHash);

    // ============ Errors ============

    error InsufficientBalance();
    error ChainMismatch();
    error VaultFrozen();
    error AmountExceedsMax();
    error VerifierZero();
    error OracleZero();

    constructor(IReasoningVerifier verifier_, IStateOracle oracle_) {
        if (address(verifier_) == address(0)) revert VerifierZero();
        if (address(oracle_) == address(0)) revert OracleZero();
        verifier = verifier_;
        oracle = oracle_;

        K_AMOUNT     = keccak256(abi.encode("vibeswap", address(this), "amount"));
        K_BALANCE    = keccak256(abi.encode("vibeswap", address(this), "balance"));
        K_MAX        = keccak256(abi.encode("vibeswap", address(this), "maxWithdraw"));
        K_NOT_FROZEN = keccak256(abi.encode("vibeswap", address(this), "notFrozen"));
    }

    // ============ Deposit (no reasoning required — additive action) ============

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    // ============ Withdraw with reasoning ============

    /// @notice Withdraw `amount`. The action is gated on a reasoning chain
    ///         + witness that proves the withdrawal is internally coherent
    ///         and grounded in current state.
    /// @dev The reasoning chain MUST mention the same `amount` and `msg.sender`
    ///      that this call uses. The contract substitutes those bindings into
    ///      the witness lookup, runs the verifier, and only then executes.
    function withdrawWithReasoning(
        uint256 amount,
        IReasoningVerifier.Atom[] calldata reasoning,
        IReasoningVerifier.Witness calldata witness
    ) external {
        // Bind the amount and balance var-keys into the witness so the
        // chain literally addresses THIS withdrawal (no replay across actions).
        // Implementation detail: in this minimal example the consumer accepts
        // any witness whose K_AMOUNT entry matches the calldata `amount`.
        _enforceWitnessBinding(witness, amount);

        // Verify the chain: consistency by witness AND truth against state.
        bytes32 chainHash = verifier.verifyChain(reasoning, witness, oracle);

        // Belt-and-suspenders: the runtime checks fire too. If the reasoning
        // is correct, these will not revert; if it isn't, the verifier should
        // already have caught it. Both passing = defense in depth.
        if (!notFrozen) revert VaultFrozen();
        if (amount > maxWithdrawPerTx) revert AmountExceedsMax();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();

        balanceOf[msg.sender] -= amount;
        emit WithdrawalReasoned(msg.sender, amount, chainHash);

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
    }

    // ============ Internal binding ============

    /// @dev Confirms the witness binds K_AMOUNT to the actual `amount` argument.
    ///      Without this check, an agent could submit a coherent witness for
    ///      "amount = 1" while calling with `amount = 1000` — the chain would
    ///      verify, but it wouldn't be about the action being executed.
    function _enforceWitnessBinding(
        IReasoningVerifier.Witness calldata w,
        uint256 amount
    ) internal view {
        bool found;
        for (uint256 i = 0; i < w.varKeys.length; i++) {
            if (w.varKeys[i] == K_AMOUNT) {
                found = true;
                if (uint256(int256(w.varValues[i])) != amount) revert ChainMismatch();
                break;
            }
        }
        if (!found) revert ChainMismatch();
    }

    // ============ Emergency (admin) — out of scope for example ============

    /// @notice For example purposes only. A real vault would gate this.
    function setFrozen(bool frozen_) external {
        notFrozen = !frozen_;
    }
}
