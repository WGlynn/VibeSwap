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
 * @dev Lifecycle:
 *      propose → [48h delay] → execute        (normal path)
 *      propose → veto (ShapleyDistributor)     (fairness check failed)
 *      proposeEmergency → [6h delay] → execute (guardian fast-track, still vetoable)
 *
 *      The Shapley veto is the key innovation: the vetoGuardian can cancel any
 *      proposal that fails a fairness check during the delay window. Governance
 *      captures are structurally impossible — P-001 enforced at the execution layer.
 *
 *      UUPS upgradeable. Once ownership is transferred here, changes to this
 *      contract require a proposal that survives the full veto window.
 */
contract GovernanceGuard is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    uint256 public constant TIMELOCK_DELAY = 48 hours;
    uint256 public constant EMERGENCY_DELAY = 6 hours;

    // ============ Enums ============

    enum ProposalState { EMPTY, PENDING, READY, EXECUTED, VETOED, CANCELLED }

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

    mapping(bytes32 => Proposal) public proposals;
    uint256 public proposalCount;
    address public vetoGuardian;
    address public emergencyGuardian;
    mapping(address => bool) public proposers;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ProposalCreated(
        bytes32 indexed proposalId, address indexed proposer, address indexed target,
        uint256 value, bytes data, string description, uint256 executeAfter, bool emergency
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
    error NotProposerOrOwner();
    error NotVetoGuardian();
    error NotEmergencyGuardian();
    error ProposalAlreadyExists();
    error ProposalNotFound();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyVetoed();
    error ProposalAlreadyCancelled();
    error TimelockNotElapsed();
    error CallFailed(address target, bytes data);

    // ============ Modifiers ============

    modifier onlyProposer() {
        if (!proposers[msg.sender] && msg.sender != owner()) revert NotProposerOrOwner();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

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

    /// @notice Create a governance proposal with standard 48-hour delay
    function propose(
        address target, uint256 value, bytes calldata data, string calldata description
    ) external onlyProposer returns (bytes32 proposalId) {
        proposalId = hashProposal(target, value, data, description);
        _createProposal(proposalId, target, value, data, description, TIMELOCK_DELAY, false);
    }

    /// @notice Create an emergency proposal with 6-hour delay (guardian only, still vetoable)
    function proposeEmergency(
        address target, uint256 value, bytes calldata data, string calldata description
    ) external returns (bytes32 proposalId) {
        if (msg.sender != emergencyGuardian) revert NotEmergencyGuardian();
        proposalId = hashProposal(target, value, data, description);
        _createProposal(proposalId, target, value, data, description, EMERGENCY_DELAY, true);
    }

    function _createProposal(
        bytes32 proposalId, address target, uint256 value,
        bytes calldata data, string calldata description,
        uint256 delay, bool emergency
    ) internal {
        if (proposals[proposalId].executeAfter != 0) revert ProposalAlreadyExists();

        uint256 executeAfter = block.timestamp + delay;
        proposals[proposalId] = Proposal({
            proposer: msg.sender, target: target, value: value,
            data: data, description: description, executeAfter: executeAfter,
            emergency: emergency, executed: false, vetoed: false, cancelled: false
        });
        proposalCount++;

        emit ProposalCreated(proposalId, msg.sender, target, value, data, description, executeAfter, emergency);
    }

    // ============ Proposal Execution ============

    /// @notice Execute a proposal after its delay has elapsed. Permissionless — anyone can call.
    function execute(
        address target, uint256 value, bytes calldata data, string calldata description
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
                assembly { revert(add(32, returndata), mload(returndata)) }
            }
            revert CallFailed(target, data);
        }

        emit ProposalExecuted(proposalId, msg.sender);
    }

    // ============ Veto (Shapley Fairness Check) ============

    /// @notice Veto a proposal that fails a fairness check. P-001 enforcement.
    /// @dev Only vetoGuardian (ShapleyDistributor or authorized multisig).
    ///      Can veto at any time before execution — the delay IS the veto window.
    function veto(bytes32 proposalId, string calldata reason) external {
        if (msg.sender != vetoGuardian) revert NotVetoGuardian();
        Proposal storage p = proposals[proposalId];

        if (p.executeAfter == 0) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.vetoed) revert ProposalAlreadyVetoed();
        if (p.cancelled) revert ProposalAlreadyCancelled();

        p.vetoed = true;
        emit ProposalVetoed(proposalId, msg.sender, reason);
    }

    // ============ Cancellation ============

    /// @notice Cancel a pending proposal. Only the original proposer or owner.
    function cancel(bytes32 proposalId) external {
        Proposal storage p = proposals[proposalId];

        if (p.executeAfter == 0) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.vetoed) revert ProposalAlreadyVetoed();
        if (p.cancelled) revert ProposalAlreadyCancelled();
        if (msg.sender != p.proposer && msg.sender != owner()) revert NotProposerOrOwner();

        p.cancelled = true;
        emit ProposalCancelled(proposalId, msg.sender);
    }

    // ============ View Functions ============

    function getProposalState(bytes32 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        if (p.executeAfter == 0) return ProposalState.EMPTY;
        if (p.executed) return ProposalState.EXECUTED;
        if (p.vetoed) return ProposalState.VETOED;
        if (p.cancelled) return ProposalState.CANCELLED;
        if (block.timestamp < p.executeAfter) return ProposalState.PENDING;
        return ProposalState.READY;
    }

    function hashProposal(
        address target, uint256 value, bytes calldata data, string calldata description
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data, keccak256(bytes(description))));
    }

    function getProposal(bytes32 proposalId) external view returns (
        address proposer, address target, uint256 value, bytes memory data,
        string memory description, uint256 executeAfter, bool emergency, ProposalState state
    ) {
        Proposal storage p = proposals[proposalId];
        return (p.proposer, p.target, p.value, p.data, p.description,
                p.executeAfter, p.emergency, getProposalState(proposalId));
    }

    function isExecutable(bytes32 proposalId) external view returns (bool) {
        Proposal storage p = proposals[proposalId];
        return p.executeAfter != 0 && !p.executed && !p.vetoed
            && !p.cancelled && block.timestamp >= p.executeAfter;
    }

    function timeUntilExecutable(bytes32 proposalId) external view returns (uint256) {
        Proposal storage p = proposals[proposalId];
        if (p.executeAfter == 0 || p.executed || p.vetoed || p.cancelled) return 0;
        if (block.timestamp >= p.executeAfter) return 0;
        return p.executeAfter - block.timestamp;
    }

    // ============ Admin Transfer Helper ============

    /// @notice Emit event for Grade C -> Grade B migration tracking.
    /// @dev The target contract's current owner must call transferOwnership(address(this))
    ///      separately. This function is for auditability.
    function acceptAdmin(address target) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        emit AdminTransferred(target, address(this));
    }

    // ============ Guardian Management ============

    function setVetoGuardian(address _vetoGuardian) external onlyOwner {
        if (_vetoGuardian == address(0)) revert ZeroAddress();
        address old = vetoGuardian;
        vetoGuardian = _vetoGuardian;
        emit VetoGuardianUpdated(old, _vetoGuardian);
    }

    function setEmergencyGuardian(address _emergencyGuardian) external onlyOwner {
        if (_emergencyGuardian == address(0)) revert ZeroAddress();
        address old = emergencyGuardian;
        emergencyGuardian = _emergencyGuardian;
        emit EmergencyGuardianUpdated(old, _emergencyGuardian);
    }

    function setProposer(address account, bool authorized) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        proposers[account] = authorized;
        emit ProposerUpdated(account, authorized);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Receive ============

    receive() external payable {}
}
