// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IVibeTimelock.sol";
import "../oracle/IReputationOracle.sol";

/**
 * @title VibeTimelock
 * @notice General-purpose timelocked governance execution controller.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      All governance actions (parameter changes, upgrades, role grants)
 *      must pass through this contract. A mandatory delay between scheduling
 *      and execution gives users an exit window before changes take effect.
 *
 *      Inspired by OpenZeppelin TimelockController, extended with:
 *        - ReputationOracle integration: trusted proposers earn reduced delays
 *        - Emergency guardian: fast-track critical security fixes (6h floor)
 *        - JUL keeper tips: incentivize timely operation execution
 *        - Operation chaining: predecessor dependencies for ordered execution
 *
 *      Security model:
 *        - Timelock is non-upgradeable (it IS the trust anchor)
 *        - minDelay changes go through the timelock itself (self-governing)
 *        - Owner manages roles, can renounce after setup for full decentralization
 *        - address(0) as executor = anyone can execute (open execution)
 *
 *      Lifecycle: schedule → [delay] → execute
 *                 schedule → cancel
 */
contract VibeTimelock is Ownable, ReentrancyGuard, IVibeTimelock {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant _DONE_TIMESTAMP = 1;
    uint256 public constant MIN_DELAY_FLOOR = 6 hours;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant DELAY_REDUCTION_PER_TIER = 6 hours;
    uint256 public constant EMERGENCY_DELAY = 6 hours;
    uint256 public constant KEEPER_TIP = 10 ether;

    // ============ Immutables ============

    IERC20 public immutable julToken;
    IReputationOracle public immutable reputationOracle;

    // ============ State ============

    uint256 private _minDelay;
    address private _guardian;
    uint256 public julRewardPool;
    uint256 public operationCount;

    mapping(bytes32 => uint256) private _timestamps;
    mapping(bytes32 => bool) private _cancelled;
    mapping(address => bool) private _proposers;
    mapping(address => bool) private _executors;
    mapping(address => bool) private _cancellers;

    // ============ Constructor ============

    constructor(
        uint256 initialMinDelay,
        address _julToken,
        address _reputationOracle,
        address guardian_,
        address[] memory proposers_,
        address[] memory executors_,
        address[] memory cancellers_
    ) Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        if (_reputationOracle == address(0)) revert ZeroAddress();
        if (initialMinDelay < MIN_DELAY_FLOOR) revert DelayBelowMinimum();
        if (initialMinDelay > MAX_DELAY) revert DelayAboveMaximum();

        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
        _minDelay = initialMinDelay;
        _guardian = guardian_;

        for (uint256 i = 0; i < proposers_.length; i++) {
            _proposers[proposers_[i]] = true;
            emit ProposerUpdated(proposers_[i], true);
        }
        for (uint256 i = 0; i < executors_.length; i++) {
            _executors[executors_[i]] = true;
            emit ExecutorUpdated(executors_[i], true);
        }
        for (uint256 i = 0; i < cancellers_.length; i++) {
            _cancellers[cancellers_[i]] = true;
            emit CancellerUpdated(cancellers_[i], true);
        }
    }

    // ============ Modifiers ============

    modifier onlyProposer() {
        if (!_proposers[msg.sender]) revert NotProposer();
        _;
    }

    modifier onlyExecutorOrOpen() {
        if (!_executors[address(0)] && !_executors[msg.sender]) revert NotExecutor();
        _;
    }

    modifier onlyCanceller() {
        if (!_cancellers[msg.sender]) revert NotCanceller();
        _;
    }

    // ============ Schedule Functions ============

    /**
     * @notice Schedule an operation for future execution.
     * @param target    Contract to call
     * @param value     ETH value to send
     * @param data      Encoded function call
     * @param predecessor Operation that must execute first (bytes32(0) for none)
     * @param salt      Differentiator for identical operations
     * @param delay     Time to wait before execution (>= effectiveMinDelay)
     */
    function schedule(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) external onlyProposer {
        bytes32 id = hashOperation(target, value, data, predecessor, salt);
        _schedule(id, delay, msg.sender, false);
        emit OperationScheduled(id, target, value, data, predecessor, salt, delay);
    }

    /**
     * @notice Schedule a batch of operations as a single atomic unit.
     */
    function scheduleBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) external onlyProposer {
        if (targets.length != values.length || targets.length != datas.length) {
            revert ArrayLengthMismatch();
        }
        bytes32 id = hashOperationBatch(targets, values, datas, predecessor, salt);
        _schedule(id, delay, msg.sender, false);
        emit BatchScheduled(id, targets.length, predecessor, salt, delay);
    }

    /**
     * @notice Schedule an emergency operation with reduced delay.
     * @dev Only callable by the guardian. Uses EMERGENCY_DELAY (6 hours).
     */
    function scheduleEmergency(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) external {
        if (msg.sender != _guardian) revert NotGuardian();
        bytes32 id = hashOperation(target, value, data, predecessor, salt);
        _schedule(id, EMERGENCY_DELAY, msg.sender, true);
        emit OperationScheduled(id, target, value, data, predecessor, salt, EMERGENCY_DELAY);
    }

    function _schedule(bytes32 id, uint256 delay, address proposer, bool isEmergency) internal {
        if (_timestamps[id] != 0 || _cancelled[id]) revert OperationAlreadyScheduled();

        if (!isEmergency) {
            uint256 effectiveDelay = _effectiveMinDelay(proposer);
            if (delay < effectiveDelay) revert DelayBelowMinimum();
        }
        if (delay > MAX_DELAY) revert DelayAboveMaximum();

        _timestamps[id] = block.timestamp + delay;
        operationCount++;
    }

    // ============ Execute Functions ============

    /**
     * @notice Execute a scheduled operation after its delay has elapsed.
     * @dev Executor receives JUL keeper tip if reward pool is funded.
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) external payable nonReentrant onlyExecutorOrOpen {
        bytes32 id = hashOperation(target, value, data, predecessor, salt);
        _beforeExecute(id, predecessor);
        _execute(target, value, data);
        _afterExecute(id);
        emit OperationExecuted(id, target, value, data);
    }

    /**
     * @notice Execute a batch of scheduled operations atomically.
     */
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas,
        bytes32 predecessor,
        bytes32 salt
    ) external payable nonReentrant onlyExecutorOrOpen {
        if (targets.length != values.length || targets.length != datas.length) {
            revert ArrayLengthMismatch();
        }
        bytes32 id = hashOperationBatch(targets, values, datas, predecessor, salt);
        _beforeExecute(id, predecessor);
        for (uint256 i = 0; i < targets.length; i++) {
            _execute(targets[i], values[i], datas[i]);
        }
        _afterExecute(id);
        emit BatchExecuted(id, targets.length);
    }

    function _beforeExecute(bytes32 id, bytes32 predecessor) internal view {
        if (!isOperationReady(id)) revert OperationNotReady();
        if (predecessor != bytes32(0) && !isOperationDone(predecessor)) {
            revert PredecessorNotExecuted();
        }
    }

    function _execute(address target, uint256 value, bytes calldata data) internal {
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        if (!success) {
            if (returndata.length > 0) {
                assembly {
                    revert(add(32, returndata), mload(returndata))
                }
            }
            revert CallFailed(target, data);
        }
    }

    function _afterExecute(bytes32 id) internal {
        _timestamps[id] = _DONE_TIMESTAMP;

        // Pay keeper tip
        if (julRewardPool >= KEEPER_TIP) {
            julRewardPool -= KEEPER_TIP;
            julToken.safeTransfer(msg.sender, KEEPER_TIP);
        }
    }

    // ============ Cancel ============

    /**
     * @notice Cancel a pending operation.
     * @dev Only callable by cancellers. Cannot cancel executed operations.
     */
    function cancel(bytes32 operationId) external onlyCanceller {
        uint256 ts = _timestamps[operationId];
        if (ts == 0 && !_cancelled[operationId]) revert OperationNotPending();
        if (ts == _DONE_TIMESTAMP) revert OperationAlreadyExecuted();
        if (_cancelled[operationId]) revert OperationAlreadyCancelled();

        _timestamps[operationId] = 0;
        _cancelled[operationId] = true;

        emit OperationCancelled(operationId);
    }

    // ============ View Functions ============

    function getOperationState(bytes32 id) public view returns (OperationState) {
        if (_cancelled[id]) return OperationState.CANCELLED;
        uint256 ts = _timestamps[id];
        if (ts == 0) return OperationState.UNSET;
        if (ts == _DONE_TIMESTAMP) return OperationState.EXECUTED;
        if (block.timestamp < ts) return OperationState.WAITING;
        return OperationState.READY;
    }

    function getTimestamp(bytes32 id) external view returns (uint256) {
        return _timestamps[id];
    }

    function isOperationPending(bytes32 id) public view returns (bool) {
        OperationState state = getOperationState(id);
        return state == OperationState.WAITING || state == OperationState.READY;
    }

    function isOperationReady(bytes32 id) public view returns (bool) {
        return getOperationState(id) == OperationState.READY;
    }

    function isOperationDone(bytes32 id) public view returns (bool) {
        return getOperationState(id) == OperationState.EXECUTED;
    }

    function hashOperation(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data, predecessor, salt));
    }

    function hashOperationBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas,
        bytes32 predecessor,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(targets, values, datas, predecessor, salt));
    }

    function minDelay() external view returns (uint256) {
        return _minDelay;
    }

    function effectiveMinDelay(address proposer) external view returns (uint256) {
        return _effectiveMinDelay(proposer);
    }

    function guardian() external view returns (address) {
        return _guardian;
    }

    function isProposer(address account) external view returns (bool) {
        return _proposers[account];
    }

    function isExecutor(address account) external view returns (bool) {
        return _executors[account] || _executors[address(0)];
    }

    function isCanceller(address account) external view returns (bool) {
        return _cancellers[account];
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the minimum delay. Only callable by the timelock itself.
     * @dev This means changing the delay is itself a timelocked operation,
     *      preventing instant delay reduction attacks.
     */
    function setMinDelay(uint256 newDelay) external {
        if (msg.sender != address(this)) revert NotSelf();
        if (newDelay < MIN_DELAY_FLOOR) revert DelayBelowMinimum();
        if (newDelay > MAX_DELAY) revert DelayAboveMaximum();

        uint256 oldDelay = _minDelay;
        _minDelay = newDelay;
        emit MinDelayUpdated(oldDelay, newDelay);
    }

    function setProposer(address account, bool authorized) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        _proposers[account] = authorized;
        emit ProposerUpdated(account, authorized);
    }

    function setExecutor(address account, bool authorized) external onlyOwner {
        // address(0) allowed — means "open execution" (anyone can execute)
        _executors[account] = authorized;
        emit ExecutorUpdated(account, authorized);
    }

    function setCanceller(address account, bool authorized) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        _cancellers[account] = authorized;
        emit CancellerUpdated(account, authorized);
    }

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert ZeroAddress();
        address old = _guardian;
        _guardian = newGuardian;
        emit GuardianUpdated(old, newGuardian);
    }

    /**
     * @notice Deposit JUL into the keeper reward pool.
     */
    function depositJulRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        julRewardPool += amount;
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        emit JulRewardsDeposited(msg.sender, amount);
    }

    // ============ Internal ============

    /**
     * @notice Reputation-gated delay reduction. Higher trust = shorter minimum delay.
     */
    function _effectiveMinDelay(address proposer) internal view returns (uint256) {
        uint8 tier = reputationOracle.getTrustTier(proposer);
        uint256 reduction = uint256(tier) * DELAY_REDUCTION_PER_TIER;
        uint256 delay = _minDelay > reduction ? _minDelay - reduction : 0;
        return delay < MIN_DELAY_FLOOR ? MIN_DELAY_FLOOR : delay;
    }

    // ============ Receive ============

    receive() external payable {}
}
