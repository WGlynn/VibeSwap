// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title VibeCheckpointRegistry — Merkle checkpoint storage for state chain
/// @notice Stores periodic state root checkpoints for light client verification
contract VibeCheckpointRegistry is OwnableUpgradeable, UUPSUpgradeable {
    struct Checkpoint { uint256 blockNumber; bytes32 stateRoot; bytes32 receiptsRoot; uint256 timestamp; address submitter; }
    mapping(uint256 => Checkpoint) public checkpoints;
    uint256 public checkpointCount;
    mapping(address => bool) public submitters;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    event CheckpointSubmitted(uint256 indexed id, uint256 blockNumber, bytes32 stateRoot);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer { __Ownable_init(msg.sender); __UUPSUpgradeable_init(); }
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    function submit(uint256 blockNumber, bytes32 stateRoot, bytes32 receiptsRoot) external {
        require(submitters[msg.sender] || msg.sender == owner(), "Not submitter");
        checkpointCount++;
        checkpoints[checkpointCount] = Checkpoint(blockNumber, stateRoot, receiptsRoot, block.timestamp, msg.sender);
        emit CheckpointSubmitted(checkpointCount, blockNumber, stateRoot);
    }
    function addSubmitter(address s) external onlyOwner { submitters[s] = true; }
    function getCheckpoint(uint256 id) external view returns (Checkpoint memory) { return checkpoints[id]; }
    receive() external payable {}
}
