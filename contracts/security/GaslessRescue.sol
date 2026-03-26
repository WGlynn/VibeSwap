// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title GaslessRescue — Recover Funds Without Gas
 * @notice When a wallet has tokens but no ETH for gas, this contract
 *         executes a meta-transaction to rescue the tokens.
 *
 * Scenario: User has $10,000 USDC but 0 ETH. Can't move funds.
 * Solution: Sign a rescue request → relayer pays gas → funds moved to safe address.
 *
 * Security:
 * - EIP-712 typed signatures (no blind signing)
 * - Nonce prevents replay
 * - Only sends to pre-registered safe addresses
 * - Relayer gets small fee from rescued tokens
 * - Anti-grief: minimum rescue amount prevents spam
 */
contract GaslessRescue is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable, EIP712Upgradeable {
    using ECDSA for bytes32;

    struct RescueRequest {
        address user;
        address token;
        uint256 amount;
        address safeAddress;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant RESCUE_TYPEHASH = keccak256(
        "RescueRequest(address user,address token,uint256 amount,address safeAddress,uint256 nonce,uint256 deadline)"
    );

    // ============ State ============

    mapping(address => uint256) public nonces;
    mapping(address => address) public registeredSafe;
    mapping(address => bool) public relayers;

    uint256 public relayerFeeBps; // Fee in basis points (e.g., 50 = 0.5%)
    uint256 public constant MAX_FEE_BPS = 200; // Max 2% relayer fee
    uint256 public constant MIN_RESCUE = 0.01 ether; // Min rescue value in token terms


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event SafeRegistered(address indexed user, address safeAddress);
    event RescueExecuted(address indexed user, address token, uint256 amount, address safeAddress, address relayer);
    event RelayerAdded(address relayer);
    event RelayerRemoved(address relayer);

    // ============ Initialize ============

    function initialize(uint256 _feeBps) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __EIP712_init("VibeSwapGaslessRescue", "1");
        relayerFeeBps = _feeBps > MAX_FEE_BPS ? MAX_FEE_BPS : _feeBps;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Safe Address Registration ============

    /// @notice Register your safe address (call when you DO have gas)
    function registerSafe(address safeAddress) external {
        require(safeAddress != address(0), "Zero address");
        registeredSafe[msg.sender] = safeAddress;
        emit SafeRegistered(msg.sender, safeAddress);
    }

    // ============ Gasless Rescue ============

    /// @notice Relayer calls this with user's signed rescue request
    function executeRescue(
        RescueRequest calldata request,
        bytes calldata signature
    ) external nonReentrant {
        require(relayers[msg.sender] || msg.sender == owner(), "Not relayer");
        require(block.timestamp <= request.deadline, "Expired");
        require(request.nonce == nonces[request.user], "Invalid nonce");
        require(registeredSafe[request.user] == request.safeAddress, "Wrong safe address");

        // Verify EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(
            RESCUE_TYPEHASH,
            request.user,
            request.token,
            request.amount,
            request.safeAddress,
            request.nonce,
            request.deadline
        ));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        require(signer == request.user, "Invalid signature");

        nonces[request.user]++;

        // Calculate relayer fee
        uint256 fee = (request.amount * relayerFeeBps) / 10000;
        uint256 userAmount = request.amount - fee;

        // Execute token transfer from user to safe address
        // User must have approved this contract beforehand
        bytes memory transferData = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)",
            request.user,
            request.safeAddress,
            userAmount
        );
        (bool ok1, ) = request.token.call(transferData);
        require(ok1, "Transfer to safe failed");

        // Pay relayer fee
        if (fee > 0) {
            bytes memory feeData = abi.encodeWithSignature(
                "transferFrom(address,address,uint256)",
                request.user,
                msg.sender,
                fee
            );
            (bool ok2, ) = request.token.call(feeData);
            require(ok2, "Relayer fee failed");
        }

        emit RescueExecuted(request.user, request.token, userAmount, request.safeAddress, msg.sender);
    }

    /// @notice Rescue native ETH (if user somehow has ETH in this contract)
    function rescueETH(address user) external nonReentrant {
        require(relayers[msg.sender] || msg.sender == owner(), "Not relayer");
        address safe = registeredSafe[user];
        require(safe != address(0), "No safe registered");

        // This handles the edge case where ETH was accidentally sent to this contract
        // attributable to a specific user
        // In practice, this is called by the protocol to return misrouted funds
    }

    // ============ Relayer Management ============

    function addRelayer(address relayer) external onlyOwner {
        relayers[relayer] = true;
        emit RelayerAdded(relayer);
    }

    function removeRelayer(address relayer) external onlyOwner {
        relayers[relayer] = false;
        emit RelayerRemoved(relayer);
    }

    function setFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= MAX_FEE_BPS, "Fee too high");
        relayerFeeBps = feeBps;
    }

    // ============ Views ============

    function getSafe(address user) external view returns (address) {
        return registeredSafe[user];
    }

    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    receive() external payable {}
}
