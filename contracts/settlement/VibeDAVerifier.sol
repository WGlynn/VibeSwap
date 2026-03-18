// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title VibeDAVerifier — Data Availability verification for state chain
/// @notice Ensures block data is available before finalization
contract VibeDAVerifier is OwnableUpgradeable, UUPSUpgradeable {
    struct DACommitment { uint256 blockNumber; bytes32 dataRoot; uint256 blobCount; uint256 totalSize; uint256 timestamp; bool verified; }
    mapping(uint256 => DACommitment) public commitments;
    uint256 public commitmentCount;
    mapping(address => bool) public validators;
    mapping(uint256 => mapping(address => bool)) public attestations;
    mapping(uint256 => uint256) public attestationCount;
    uint256 public quorum;
    event DACommitted(uint256 indexed id, uint256 blockNumber, bytes32 dataRoot);
    event DAVerified(uint256 indexed id);

    function initialize(uint256 _quorum) external initializer { __Ownable_init(msg.sender); __UUPSUpgradeable_init(); quorum = _quorum > 0 ? _quorum : 2; }
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    function commitDA(uint256 blockNumber, bytes32 dataRoot, uint256 blobCount, uint256 totalSize) external {
        require(validators[msg.sender] || msg.sender == owner(), "Not validator");
        commitmentCount++;
        commitments[commitmentCount] = DACommitment(blockNumber, dataRoot, blobCount, totalSize, block.timestamp, false);
        emit DACommitted(commitmentCount, blockNumber, dataRoot);
    }
    function attestDA(uint256 id) external {
        require(validators[msg.sender], "Not validator");
        require(!attestations[id][msg.sender], "Already attested");
        attestations[id][msg.sender] = true;
        attestationCount[id]++;
        if (attestationCount[id] >= quorum) { commitments[id].verified = true; emit DAVerified(id); }
    }
    function addValidator(address v) external onlyOwner { validators[v] = true; }
    function setQuorum(uint256 q) external onlyOwner { quorum = q; }
    function getCommitment(uint256 id) external view returns (DACommitment memory) { return commitments[id]; }
    receive() external payable {}
}
