// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title VibeMultisig — M-of-N Multi-Signature Wallet
 * @notice Gnosis Safe alternative — simple, auditable, no delegate calls.
 *         Quantum-hardening compatible via PostQuantumShield integration.
 */
contract VibeMultisig is Initializable, UUPSUpgradeable {
    // ============ State ============

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public required;

    struct Transaction {
        uint256 txId;
        address to;
        uint256 value;
        bytes data;
        uint256 confirmations;
        bool executed;
        uint256 createdAt;
    }

    mapping(uint256 => Transaction) public transactions;
    uint256 public txCount;

    mapping(uint256 => mapping(address => bool)) public confirmed;

    // ============ Events ============

    event TransactionSubmitted(uint256 indexed txId, address indexed submitter, address to, uint256 value);
    event TransactionConfirmed(uint256 indexed txId, address indexed confirmer);
    event TransactionRevoked(uint256 indexed txId, address indexed revoker);
    event TransactionExecuted(uint256 indexed txId);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event RequirementChanged(uint256 required);

    // ============ Modifiers ============

    modifier onlyOwner_() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier onlyWallet() {
        require(msg.sender == address(this), "Not wallet");
        _;
    }

    // ============ Init ============

    function initialize(address[] calldata _owners, uint256 _required) external initializer {
        __UUPSUpgradeable_init();
        require(_owners.length >= _required && _required > 0, "Invalid config");

        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "Zero address");
            require(!isOwner[_owners[i]], "Duplicate");
            isOwner[_owners[i]] = true;
            owners.push(_owners[i]);
        }
        required = _required;
    }

    function _authorizeUpgrade(address) internal override onlyWallet {}

    // ============ Transaction Lifecycle ============

    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyOwner_ returns (uint256) {
        txCount++;
        transactions[txCount] = Transaction({
            txId: txCount,
            to: to,
            value: value,
            data: data,
            confirmations: 1,
            executed: false,
            createdAt: block.timestamp
        });

        confirmed[txCount][msg.sender] = true;

        emit TransactionSubmitted(txCount, msg.sender, to, value);
        emit TransactionConfirmed(txCount, msg.sender);

        // Auto-execute if 1-of-1
        if (required == 1) {
            _execute(txCount);
        }

        return txCount;
    }

    function confirmTransaction(uint256 txId) external onlyOwner_ {
        require(!confirmed[txId][msg.sender], "Already confirmed");
        require(!transactions[txId].executed, "Already executed");

        confirmed[txId][msg.sender] = true;
        transactions[txId].confirmations++;

        emit TransactionConfirmed(txId, msg.sender);

        if (transactions[txId].confirmations >= required) {
            _execute(txId);
        }
    }

    function revokeConfirmation(uint256 txId) external onlyOwner_ {
        require(confirmed[txId][msg.sender], "Not confirmed");
        require(!transactions[txId].executed, "Already executed");

        confirmed[txId][msg.sender] = false;
        transactions[txId].confirmations--;

        emit TransactionRevoked(txId, msg.sender);
    }

    // ============ Owner Management (via wallet) ============

    function addOwner(address owner) external onlyWallet {
        require(!isOwner[owner], "Already owner");
        isOwner[owner] = true;
        owners.push(owner);
        emit OwnerAdded(owner);
    }

    function removeOwner(address owner) external onlyWallet {
        require(isOwner[owner], "Not owner");
        require(owners.length - 1 >= required, "Below threshold");
        isOwner[owner] = false;

        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner);
    }

    function changeRequirement(uint256 _required) external onlyWallet {
        require(_required > 0 && _required <= owners.length, "Invalid");
        required = _required;
        emit RequirementChanged(_required);
    }

    // ============ Internal ============

    function _execute(uint256 txId) internal {
        Transaction storage tx_ = transactions[txId];
        require(!tx_.executed, "Already executed");
        require(tx_.confirmations >= required, "Not enough confirmations");

        tx_.executed = true;
        (bool ok, ) = tx_.to.call{value: tx_.value}(tx_.data);
        require(ok, "Execution failed");

        emit TransactionExecuted(txId);
    }

    // ============ View ============

    function getOwners() external view returns (address[] memory) { return owners; }
    function getOwnerCount() external view returns (uint256) { return owners.length; }
    function getTransactionCount() external view returns (uint256) { return txCount; }

    function isConfirmed(uint256 txId) external view returns (bool) {
        return transactions[txId].confirmations >= required;
    }

    receive() external payable {}
}
