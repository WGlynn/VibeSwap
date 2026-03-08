// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title AntiPhishing — On-Chain Domain Verification & Phishing Prevention
 * @notice Prevents users from interacting with fake/phishing contracts.
 *
 * How it works:
 * 1. VibeSwap registers its official contract addresses on-chain
 * 2. Frontend queries this registry before ANY transaction
 * 3. If destination isn't in registry → warning shown to user
 * 4. Community can report phishing contracts → auto-blacklist
 * 5. DNS-style verification: hash(domain) → contract address mapping
 *
 * This prevents:
 * - Fake token approvals to malicious contracts
 * - Phishing sites that mimic VibeSwap UI
 * - Clipboard hijacking (wrong address pasted)
 * - Homograph attacks (unicode domain tricks)
 */
contract AntiPhishing is OwnableUpgradeable, UUPSUpgradeable {

    struct VerifiedContract {
        string name;
        string domain;
        bytes32 domainHash;
        uint256 verifiedAt;
        bool active;
    }

    struct PhishingReport {
        address reporter;
        address suspicious;
        string reason;
        uint256 reportedAt;
        uint256 confirmations;
        bool confirmed;
    }

    // ============ State ============

    mapping(address => VerifiedContract) public verified;
    address[] public verifiedList;
    mapping(bytes32 => address) public domainToContract;

    mapping(address => bool) public blacklisted;
    mapping(uint256 => PhishingReport) public reports;
    uint256 public reportCount;
    mapping(uint256 => mapping(address => bool)) public reportConfirmations;

    uint256 public constant CONFIRM_THRESHOLD = 3;
    mapping(address => bool) public reporters; // Trusted reporters

    // ============ Events ============

    event ContractVerified(address indexed contractAddr, string name, string domain);
    event ContractRevoked(address indexed contractAddr);
    event PhishingReported(uint256 indexed reportId, address suspicious, address reporter);
    event PhishingConfirmed(address indexed suspicious);
    event AddressBlacklisted(address indexed addr);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Contract Verification ============

    /// @notice Register an official VibeSwap contract
    function verifyContract(
        address contractAddr,
        string calldata name,
        string calldata domain
    ) external onlyOwner {
        require(contractAddr != address(0), "Zero address");
        bytes32 dHash = keccak256(bytes(domain));

        verified[contractAddr] = VerifiedContract({
            name: name,
            domain: domain,
            domainHash: dHash,
            verifiedAt: block.timestamp,
            active: true
        });

        domainToContract[dHash] = contractAddr;
        verifiedList.push(contractAddr);

        emit ContractVerified(contractAddr, name, domain);
    }

    /// @notice Revoke a contract's verified status
    function revokeContract(address contractAddr) external onlyOwner {
        verified[contractAddr].active = false;
        emit ContractRevoked(contractAddr);
    }

    // ============ Phishing Reports ============

    /// @notice Report a suspicious contract
    function reportPhishing(address suspicious, string calldata reason) external {
        require(!verified[suspicious].active, "Cannot report verified contract");
        require(!blacklisted[suspicious], "Already blacklisted");

        uint256 id = reportCount++;
        reports[id] = PhishingReport({
            reporter: msg.sender,
            suspicious: suspicious,
            reason: reason,
            reportedAt: block.timestamp,
            confirmations: 1,
            confirmed: false
        });

        reportConfirmations[id][msg.sender] = true;
        emit PhishingReported(id, suspicious, msg.sender);

        // Auto-confirm if from trusted reporter
        if (reporters[msg.sender]) {
            _confirmPhishing(id);
        }
    }

    /// @notice Confirm a phishing report
    function confirmReport(uint256 reportId) external {
        require(!reportConfirmations[reportId][msg.sender], "Already confirmed");
        PhishingReport storage r = reports[reportId];
        require(!r.confirmed, "Already confirmed");

        reportConfirmations[reportId][msg.sender] = true;
        r.confirmations++;

        if (r.confirmations >= CONFIRM_THRESHOLD || reporters[msg.sender]) {
            _confirmPhishing(reportId);
        }
    }

    function _confirmPhishing(uint256 reportId) internal {
        PhishingReport storage r = reports[reportId];
        r.confirmed = true;
        blacklisted[r.suspicious] = true;
        emit PhishingConfirmed(r.suspicious);
        emit AddressBlacklisted(r.suspicious);
    }

    // ============ Reporter Management ============

    function addReporter(address reporter) external onlyOwner {
        reporters[reporter] = true;
    }

    function removeReporter(address reporter) external onlyOwner {
        reporters[reporter] = false;
    }

    // ============ Verification Queries ============

    /// @notice Check if an address is safe to interact with
    /// @return status 0=unknown, 1=verified, 2=blacklisted
    function checkAddress(address addr) external view returns (uint8 status_) {
        if (blacklisted[addr]) return 2;
        if (verified[addr].active) return 1;
        return 0;
    }

    /// @notice Look up contract by domain hash
    function getContractByDomain(string calldata domain) external view returns (address) {
        return domainToContract[keccak256(bytes(domain))];
    }

    /// @notice Get all verified contracts
    function getVerifiedContracts() external view returns (address[] memory) {
        return verifiedList;
    }

    function isVerified(address addr) external view returns (bool) {
        return verified[addr].active;
    }

    function isBlacklisted(address addr) external view returns (bool) {
        return blacklisted[addr];
    }

    receive() external payable {}
}
