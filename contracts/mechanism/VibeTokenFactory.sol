// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeTokenFactory — No-Code Token Deployment
 * @notice Permissionless token creation with built-in safety features.
 *         Users can deploy standard ERC20 tokens with optional features
 *         like max supply, transfer tax, burn mechanism, and vesting.
 *
 * @dev Tokens are registered in the factory for discoverability and trust scoring.
 */
contract VibeTokenFactory is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct TokenConfig {
        bytes32 tokenId;
        address creator;
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 initialSupply;
        uint256 transferTaxBps;     // 0 = no tax, max 1000 (10%)
        bool mintable;
        bool burnable;
        bool pausable;
        uint256 createdAt;
        bool verified;              // Verified by protocol team
    }

    struct TokenMetrics {
        uint256 holderCount;
        uint256 transferCount;
        uint256 totalTaxCollected;
        uint256 totalBurned;
    }

    // ============ State ============

    /// @notice Token registry
    mapping(bytes32 => TokenConfig) public tokens;
    bytes32[] public tokenList;

    /// @notice Token metrics
    mapping(bytes32 => TokenMetrics) public metrics;

    /// @notice Creator tokens
    mapping(address => bytes32[]) public creatorTokens;

    /// @notice Deployment fee
    uint256 public deploymentFee;

    /// @notice Max transfer tax
    uint256 public constant MAX_TAX_BPS = 1000; // 10%

    /// @notice Total tokens created
    uint256 public totalTokensCreated;

    /// @notice Total fees collected
    uint256 public totalFeesCollected;

    // ============ Events ============

    event TokenCreated(bytes32 indexed tokenId, address indexed creator, string name, string symbol);
    event TokenVerified(bytes32 indexed tokenId);
    event TokenUnverified(bytes32 indexed tokenId);
    event DeploymentFeeUpdated(uint256 newFee);

    // ============ Init ============

    function initialize(uint256 _deploymentFee) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        deploymentFee = _deploymentFee;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Token Creation ============

    /**
     * @notice Create a new token configuration
     */
    function createToken(
        string calldata name,
        string calldata symbol,
        uint256 maxSupply,
        uint256 initialSupply,
        uint256 transferTaxBps,
        bool mintable,
        bool burnable,
        bool pausable
    ) external payable nonReentrant returns (bytes32) {
        require(msg.value >= deploymentFee, "Insufficient fee");
        require(bytes(name).length > 0 && bytes(symbol).length > 0, "Empty name/symbol");
        require(initialSupply <= maxSupply || maxSupply == 0, "Initial > max");
        require(transferTaxBps <= MAX_TAX_BPS, "Tax too high");

        bytes32 tokenId = keccak256(abi.encodePacked(
            msg.sender, name, symbol, block.timestamp
        ));

        tokens[tokenId] = TokenConfig({
            tokenId: tokenId,
            creator: msg.sender,
            name: name,
            symbol: symbol,
            maxSupply: maxSupply,
            initialSupply: initialSupply,
            transferTaxBps: transferTaxBps,
            mintable: mintable,
            burnable: burnable,
            pausable: pausable,
            createdAt: block.timestamp,
            verified: false
        });

        tokenList.push(tokenId);
        creatorTokens[msg.sender].push(tokenId);
        totalTokensCreated++;
        totalFeesCollected += deploymentFee;

        // Refund excess
        if (msg.value > deploymentFee) {
            (bool ok, ) = msg.sender.call{value: msg.value - deploymentFee}("");
            require(ok, "Refund failed");
        }

        emit TokenCreated(tokenId, msg.sender, name, symbol);
        return tokenId;
    }

    /**
     * @notice Record a transfer (called by token contracts)
     */
    function recordTransfer(bytes32 tokenId) external {
        metrics[tokenId].transferCount++;
    }

    /**
     * @notice Record a burn (called by token contracts)
     */
    function recordBurn(bytes32 tokenId, uint256 amount) external {
        metrics[tokenId].totalBurned += amount;
    }

    /**
     * @notice Record tax collected (called by token contracts)
     */
    function recordTax(bytes32 tokenId, uint256 amount) external {
        metrics[tokenId].totalTaxCollected += amount;
    }

    // ============ Admin ============

    function verifyToken(bytes32 tokenId) external onlyOwner {
        tokens[tokenId].verified = true;
        emit TokenVerified(tokenId);
    }

    function unverifyToken(bytes32 tokenId) external onlyOwner {
        tokens[tokenId].verified = false;
        emit TokenUnverified(tokenId);
    }

    function setDeploymentFee(uint256 fee) external onlyOwner {
        deploymentFee = fee;
        emit DeploymentFeeUpdated(fee);
    }

    function withdrawFees() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "No fees");
        (bool ok, ) = owner().call{value: bal}("");
        require(ok, "Withdraw failed");
    }

    // ============ View ============

    function getToken(bytes32 tokenId) external view returns (TokenConfig memory) {
        return tokens[tokenId];
    }

    function getTokenMetrics(bytes32 tokenId) external view returns (TokenMetrics memory) {
        return metrics[tokenId];
    }

    function getCreatorTokens(address creator) external view returns (bytes32[] memory) {
        return creatorTokens[creator];
    }

    function getTokenCount() external view returns (uint256) { return tokenList.length; }

    function isVerified(bytes32 tokenId) external view returns (bool) {
        return tokens[tokenId].verified;
    }

    receive() external payable {
        totalFeesCollected += msg.value;
    }
}
