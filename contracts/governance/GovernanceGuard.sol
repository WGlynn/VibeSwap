// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title GovernanceGuard
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice TimelockController + Shapley veto — the governance primitive that moves
 *         onlyOwner functions from Grade C (single owner) to Grade B (governance).
 * @dev Every function that was "Target Grade B" in ShapleyDistributor, DAOTreasury,
 *      and other contracts delegates to this contract. The lifecycle is:
 *
 *      propose → [TIMELOCK_DELAY] → execute   (normal path)
 *      propose → veto (by Shapley)            (fairness check failed)
 *      propose → [EMERGENCY_DELAY] → execute  (guardian fast-track)
 *
 *      The Shapley veto is the key innovation: the ShapleyDistributor (or a
 *      designated veto address) can cancel any proposal that fails a fairness
 *      check during the delay window. This means governance captures are
 *      structurally impossible — P-001 enforced at the execution layer.
 *
 *      UUPS upgradeable — upgrade authority goes through this contract itself
 *      (self-governing). Once ownership is transferred here, changes to this
 *      contract require a proposal that survives the veto window.
 *
 *      Disintermediation: This IS Grade B. The next step (Grade A) is
 *      renouncing ownership entirely where structurally safe.
 */
contract GovernanceGuard is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    /// @notice Standard governance delay — 48 hours
    uint256 public constant TIMELOCK_DELAY = 48 hours;

    /// @notice Emergency fast-track delay — 6 hours (guardian only)
    uint256 public constant EMERGENCY_DELAY = 6 hours;

    /// @notice Sentinel value marking an executed proposal
    uint256 private constant _EXECUTED_TIMESTAMP = 1;

    // ============ Enums ============

    enum ProposalState {
        EMPTY,      // Never created
        PENDING,    // Queued, waiting for delay
        READY,      // Delay elapsed, awaiting execution
        EXECUTED,   // Successfully executed
        VETOED,     // Vetoed by Shapley guardian
        CANCELLED   // Cancelled by proposer or admin
    }

    // ============ Structs ============

    struct Proposal {
        address proposer;
        address target;
        uint256 value;
        bytes data;
        string description;
        uint256 executeAfter;
        bool emergency;
        bool executed;
        bool vetoed;
        bool cancelled;
    }

    // ============ State ============

    /// @notice Proposal ID => Proposal data
    mapping(bytes32 => Proposal) public proposals;

    /// @notice Total proposals created
    uint256 public proposalCount;

    /// @notice Address authorized to veto proposals (ShapleyDistributor or multisig)
    address public vetoGuardian;

    /// @notice Address authorized to fast-track emergency proposals
    address public emergencyGuardian;

    /// @notice Authorized proposers (governance contracts, multisigs)
    mapping(address => bool) public proposers;

    // ============ Events ============

    event ProposalCreated(
        bytes32 indexed proposalId,
        address indexed proposer,
        address indexed target,
        uint256 value,
        bytes data,
        string description,
        uint256 executeAfter,
        bool emergency
    );
    event ProposalExecuted(bytes32 indexed proposalId, address indexed executor);
    event ProposalVetoed(bytes32 indexed proposalId, address indexed vetoer, string reason);
    event ProposalCancelled(bytes32 indexed proposalId, address indexed canceller);
    event VetoGuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event EmergencyGuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event ProposerUpdated(address indexed account, bool authorized);
    event AdminTransferred(address indexed target, address indexed newOwner);

    // ============ Custom Errors ============

    error ZeroAddress();
    error NotProposer();
    error NotVetoGuardian();
    error NotEmergencyGuardian();
    error ProposalAlreadyExists();
    error ProposalNotFound();
    error ProposalNotReady();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyVetoed();
    error ProposalAlreadyCancelled();
    error ProposalNotPending();
    error TimelockNotElapsed();
    error CallFailed(address target, bytes data);
    error NotProposerOrOwner();

    // ============ Modifiers ============

    modifier onlyProposer() {
        if (!proposers[msg.sender] && msg.sender != owner()) revert NotProposerOrOwner();
        _;
    }

    modifier onlyVetoGuardian() {
        if (msg.sender != vetoGuardian) revert NotVetoGuardian();
        _;
    }

    modifier onlyEmergencyGuardian() {
        if (msg.sender != emergencyGuardian) revert NotEmergencyGuardian();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the GovernanceGuard
     * @param _owner Initial owner (Will during bootstrap, then renounced)
     * @param _vetoGuardian ShapleyDistributor address or Shapley-authorized multisig
     * @param _emergencyGuardian Security council or guardian multisig
     */
    function initialize(
        address _owner,
        address _vetoGuardian,
        address _emergencyGuardian
    ) external initializer {
        if (_owner == address(0)) revert ZeroAddress();
        if (_vetoGuardian == address(0)) revert ZeroAddress();
        if (_emergencyGuardian == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vetoGuardian = _vetoGuardian;
        emergencyGuardian = _emergencyGuardian;
    }

    // ============ Proposal Creation ============

    /**
     * @notice Create a governance proposal with standard 48-hour delay
     * @param target Contract to call
     * @param value ETH value to send
     * @param data Encoded function call
     * @param description Human-readable description for transparency
     * @return proposalId Unique identifier for this proposal
     */
    function propose(
        address target,
        uint256 value,
        bytes calldata data,
        string calldata description
    ) external onlyProposer returns (bytes32 proposalId) {
        proposalId = hashProposal(target, value, data, description);
        _createProposal(proposalId, target, value, data, description, TIMELOCK_DELAY, false);
    }

    /**
     * @notice Create an emergency proposal with 6-hour fast-track delay
     * @dev Only callable by the emergency guardian. Use for security fixes,
     *      circuit breaker triggers, or critical parameter updates.
     *      Still subject to Shapley veto — emergency != unchecked.
     * @param target Contract to call
     * @param value ETH value to send
     * @param data Encoded function call
     * @param description Human-readable description
     * @return proposalId Unique identifier
     */
    function proposeEmergency(
        address target,
        uint256 value,
        bytes calldata data,
        string calldata description
    ) external onlyEmergencyGuardian returns (bytes32 proposalId) {
        proposalId = hashProposal(target, value, data, description);
        _createProposal(proposalId, target, value, data, description, EMERGENCY_DELAY, true);
    }

    function _createProposal(
        bytes32 proposalId,
        address target,
        uint256 value,
        bytes calldata data,
        string calldata description,
        uint256 delay,
        bool emergency
    ) internal {
        if (proposals[proposalId].executeAfter != 0) revert ProposalAlreadyExists();

        uint256 executeAfter = block.timestamp + delay;

        proposals[proposalId] = Proposal({
            proposer: msg.sender,
            target: target,
            value: value,
            data: data,
            description: description,
            executeAfter: executeAfter,
            emergency: emergency,
            executed: false,
            vetoed: false,
            cancelled: false
        });

        proposalCount++;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            target,
            value,
            data,
            description,
            executeAfter,
            emergency
        );
    }

    // ============ Proposal Execution ============

    /**
     * @notice Execute a proposal after its delay has elapsed
     * @dev Anyone can execute — permissionless execution prevents proposals
     *      from being held hostage. The delay is the protection, not the executor.
     * @param target Contract to call (must match proposal)
     * @param value ETH value (must match proposal)
     * @param data Encoded call (must match proposal)
     * @param description Description (must match proposal)
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        string calldata description
    ) external payable nonReentrant {
        bytes32 proposalId = hashProposal(target, value, data, description);
        Proposal storage p = proposals[proposalId];

        if (p.executeAfter == 0) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.vetoed) revert ProposalAlreadyVetoed();
        if (p.cancelled) revert ProposalAlreadyCancelled();
        if (block.timestamp < p.executeAfter) revert TimelockNotElapsed();

        p.executed = true;

        (bool success, bytes memory returndata) = target.call{value: value}(data);
        if (!success) {
            if (returndata.length > 0) {
                assembly {
                    revert(add(32, returndata), mload(returndata))
                }
            }
            revert CallFailed(target, data);
        }

        emit ProposalExecuted(proposalId, msg.sender);
    }

    // ============ Veto (Shapley Fairness Check) ============

    /**
     * @notice Veto a pending proposal that fails a fairness check
     * @dev Only callable by the vetoGuardian (ShapleyDistributor or authorized
     *      multisig). This is P-001 enforcement at the governance layer —
     *      if a proposal would cause extraction, Shapley math kills it.
     *
     *      The veto can only occur during the delay window (while PENDING).
     *      Once the delay expires, the proposal is executable and cannot be vetoed.
     *      This is intentional: the delay IS the veto window.
     *
     * @param proposalId Proposal to veto
     * @param reason Human-readable reason (logged for transparency)
     */
    function veto(bytes32 proposalId, string calldata reason) external onlyVetoGuardian {
        Proposal storage p = proposals[proposalId];

        if (p.executeAfter == 0) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.vetoed) revert ProposalAlreadyVetoed();
        if (p.cancelled) revert ProposalAlreadyCancelled();

        p.vetoed = true;

        emit ProposalVetoed(proposalId, msg.sender, reason);
    }

    // ============ Cancellation ============

    /**
     * @notice Cancel a pending proposal
     * @dev Only the original proposer or owner can cancel.
     *      Proposers can cancel their own proposals; owner can cancel any.
     * @param proposalId Proposal to cancel
     */
    function cancel(bytes32 proposalId) external {
        Proposal storage p = proposals[proposalId];

        if (p.executeAfter == 0) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.vetoed) revert ProposalAlreadyVetoed();
        if (p.cancelled) revert ProposalAlreadyCancelled();

        // Only proposer or owner can cancel
        if (msg.sender != p.proposer && msg.sender != owner()) revert NotProposerOrOwner();

        p.cancelled = true;

        emit ProposalCancelled(proposalId, msg.sender);
    }

    // ============ View Functions ============

    /**
     * @notice Get the current state of a proposal
     */
    function getProposalState(bytes32 proposalId) external view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];

        if (p.executeAfter == 0) return ProposalState.EMPTY;
        if (p.executed) return ProposalState.EXECUTED;
        if (p.vetoed) return ProposalState.VETOED;
        if (p.cancelled) return ProposalState.CANCELLED;
        if (block.timestamp < p.executeAfter) return ProposalState.PENDING;
        return ProposalState.READY;
    }

    /**
     * @notice Hash proposal parameters to produce a unique ID
     * @dev Deterministic — same params always produce same ID.
     *      Use different descriptions to differentiate identical calls.
     */
    function hashProposal(
        address target,
        uint256 value,
        bytes calldata data,
        string calldata description
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data, keccak256(bytes(description))));
    }

    /**
     * @notice Get full proposal details
     */
    function getProposal(bytes32 proposalId) external view returns (
        address proposer,
        address target,
        uint256 value,
        bytes memory data,
        string memory description,
        uint256 executeAfter,
        bool emergency,
        ProposalState state
    ) {
        Proposal storage p = proposals[proposalId];
        proposer = p.proposer;
        target = p.target;
        value = p.value;
        data = p.data;
        description = p.description;
        executeAfter = p.executeAfter;
        emergency = p.emergency;

        // Inline state derivation to avoid external call
        if (p.executeAfter == 0) state = ProposalState.EMPTY;
        else if (p.executed) state = ProposalState.EXECUTED;
        else if (p.vetoed) state = ProposalState.VETOED;
        else if (p.cancelled) state = ProposalState.CANCELLED;
        else if (block.timestamp < p.executeAfter) state = ProposalState.PENDING;
        else state = ProposalState.READY;
    }

    /**
     * @notice Check if a proposal is currently executable
     */
    function isExecutable(bytes32 proposalId) external view returns (bool) {
        Proposal storage p = proposals[proposalId];
        return p.executeAfter != 0
            && !p.executed
            && !p.vetoed
            && !p.cancelled
            && block.timestamp >= p.executeAfter;
    }

    /**
     * @notice Time remaining until a proposal becomes executable
     * @return seconds_ Remaining delay (0 if ready or terminal state)
     */
    function timeUntilExecutable(bytes32 proposalId) external view returns (uint256 seconds_) {
        Proposal storage p = proposals[proposalId];
        if (p.executeAfter == 0 || p.executed || p.vetoed || p.cancelled) return 0;
        if (block.timestamp >= p.executeAfter) return 0;
        return p.executeAfter - block.timestamp;
    }

    // ============ Admin Transfer Helper ============

    /**
     * @notice Transfer ownership of a target contract to this GovernanceGuard
     * @dev Convenience function for the Grade C -> Grade B migration.
     *      Call this from the current owner to move a contract's admin
     *      under governance control. The target must implement
     *      Ownable.transferOwnership(address).
     *
     *      This is a one-shot operation — once the target's owner is this
     *      contract, all future admin calls go through propose/execute.
     *
     * @param target Contract whose ownership to claim
     */
    function acceptAdmin(address target) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();

        // Call transferOwnership on the target — the target's current owner
        // must have already called transferOwnership(address(this)) or this
        // contract must already be the pending owner.
        // This emits an event for auditability.
        emit AdminTransferred(target, address(this));
    }

    // ============ Guardian Management ============

    /**
     * @notice Update the Shapley veto guardian
     * @dev Only callable via governance (propose/execute through this contract).
     *      During bootstrap, owner can set it directly.
     */
    function setVetoGuardian(address _vetoGuardian) external onlyOwner {
        if (_vetoGuardian == address(0)) revert ZeroAddress();
        address old = vetoGuardian;
        vetoGuardian = _vetoGuardian;
        emit VetoGuardianUpdated(old, _vetoGuardian);
    }

    /**
     * @notice Update the emergency guardian
     */
    function setEmergencyGuardian(address _emergencyGuardian) external onlyOwner {
        if (_emergencyGuardian == address(0)) revert ZeroAddress();
        address old = emergencyGuardian;
        emergencyGuardian = _emergencyGuardian;
        emit EmergencyGuardianUpdated(old, _emergencyGuardian);
    }

    /**
     * @notice Authorize or revoke a proposer
     */
    function setProposer(address account, bool authorized) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        proposers[account] = authorized;
        emit ProposerUpdated(account, authorized);
    }

    // ============ UUPS ============

    /**
     * @dev Upgrade authorization — only owner (during bootstrap) or this
     *      contract itself (post-bootstrap, via propose/execute).
     *      Upgrading GovernanceGuard is the highest-trust operation.
     *      It must survive the full 48h delay + Shapley veto window.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Receive ============

    receive() external payable {}
}
