// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeTimelock
 * @notice Interface for general-purpose timelocked governance execution.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         All governance proposals execute after a mandatory delay,
 *         giving users an exit window before state changes take effect.
 *
 *         VibeSwap-specific properties:
 *           - ReputationOracle trust tiers reduce minimum delay (earned trust = faster governance)
 *           - Guardian role for emergency operations (reduced delay, never zero)
 *           - JUL keeper tips for timely execution
 *           - Operation chaining via predecessor dependencies
 *           - Batch operations for atomic multi-call governance actions
 *
 *         Role model:
 *           - PROPOSER: schedule operations (DAO multisig, governance contract)
 *           - EXECUTOR: execute after delay (can be open to anyone via address(0))
 *           - CANCELLER: cancel pending operations (guardian, DAO)
 *           - GUARDIAN: schedule emergency operations with reduced delay
 *
 *         Lifecycle: schedule → [delay elapses] → execute
 *                    schedule → cancel (before execution)
 */
interface IVibeTimelock {
    // ============ Enums ============

    enum OperationState {
        UNSET,      // never scheduled
        WAITING,    // scheduled, delay not elapsed
        READY,      // delay elapsed, awaiting execution
        EXECUTED,   // successfully executed
        CANCELLED   // cancelled before execution
    }

    // ============ Events ============

    event OperationScheduled(
        bytes32 indexed operationId,
        address indexed target,
        uint256 value,
        bytes data,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    );
    event OperationExecuted(
        bytes32 indexed operationId,
        address indexed target,
        uint256 value,
        bytes data
    );
    event OperationCancelled(bytes32 indexed operationId);
    event BatchScheduled(
        bytes32 indexed operationId,
        uint256 operationCount,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    );
    event BatchExecuted(bytes32 indexed operationId, uint256 operationCount);
    event MinDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event ProposerUpdated(address indexed account, bool authorized);
    event ExecutorUpdated(address indexed account, bool authorized);
    event CancellerUpdated(address indexed account, bool authorized);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event JulRewardsDeposited(address indexed depositor, uint256 amount);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error NotProposer();
    error NotExecutor();
    error NotCanceller();
    error NotGuardian();
    error NotSelf();
    error OperationAlreadyScheduled();
    error OperationNotReady();
    error OperationAlreadyExecuted();
    error OperationAlreadyCancelled();
    error OperationNotPending();
    error PredecessorNotExecuted();
    error DelayBelowMinimum();
    error DelayAboveMaximum();
    error ArrayLengthMismatch();
    error CallFailed(address target, bytes data);

    // ============ Schedule ============

    function schedule(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) external;

    function scheduleBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) external;

    function scheduleEmergency(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) external;

    // ============ Execute ============

    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) external payable;

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas,
        bytes32 predecessor,
        bytes32 salt
    ) external payable;

    // ============ Cancel ============

    function cancel(bytes32 operationId) external;

    // ============ View Functions ============

    function getOperationState(bytes32 operationId) external view returns (OperationState);
    function getTimestamp(bytes32 operationId) external view returns (uint256);
    function isOperationPending(bytes32 operationId) external view returns (bool);
    function isOperationReady(bytes32 operationId) external view returns (bool);
    function isOperationDone(bytes32 operationId) external view returns (bool);
    function hashOperation(
        address target, uint256 value, bytes calldata data,
        bytes32 predecessor, bytes32 salt
    ) external pure returns (bytes32);
    function hashOperationBatch(
        address[] calldata targets, uint256[] calldata values, bytes[] calldata datas,
        bytes32 predecessor, bytes32 salt
    ) external pure returns (bytes32);
    function minDelay() external view returns (uint256);
    function effectiveMinDelay(address proposer) external view returns (uint256);
    function guardian() external view returns (address);
    function isProposer(address account) external view returns (bool);
    function isExecutor(address account) external view returns (bool);
    function isCanceller(address account) external view returns (bool);
    function operationCount() external view returns (uint256);

    // ============ Admin ============

    function setMinDelay(uint256 newDelay) external;
    function setProposer(address account, bool authorized) external;
    function setExecutor(address account, bool authorized) external;
    function setCanceller(address account, bool authorized) external;
    function setGuardian(address newGuardian) external;
    function depositJulRewards(uint256 amount) external;
}
