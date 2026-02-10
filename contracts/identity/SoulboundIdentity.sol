// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title SoulboundIdentity
 * @notice Non-transferable identity NFT that binds username, avatar, and reputation to an address
 * @dev One identity per address, tracks contributions, levels, and alignment
 */
contract SoulboundIdentity is ERC721Upgradeable, OwnableUpgradeable, UUPSUpgradeable {

    // ============ Structs ============

    struct Identity {
        string username;
        uint256 level;
        uint256 xp;
        int256 alignment;        // -100 (chaos) to +100 (order)
        uint256 contributions;   // Total contribution count
        uint256 reputation;      // Community reputation score
        uint256 createdAt;
        uint256 lastActive;
        AvatarTraits avatar;
        bool quantumEnabled;     // Whether quantum resistance is enabled
        bytes32 quantumKeyRoot;  // Merkle root of Lamport public keys (if quantum enabled)
    }

    struct AvatarTraits {
        uint8 background;    // 0-15 backgrounds
        uint8 body;          // 0-15 body types
        uint8 eyes;          // 0-15 eye styles
        uint8 mouth;         // 0-15 mouth styles
        uint8 accessory;     // 0-15 accessories
        uint8 aura;          // 0-7 aura effects (unlocked by level)
    }

    struct Contribution {
        address author;
        uint256 timestamp;
        bytes32 contentHash;     // IPFS hash of content
        ContributionType cType;
        uint256 upvotes;
        uint256 downvotes;
        uint256 tokenId;         // Identity that made this contribution
    }

    enum ContributionType {
        POST,
        REPLY,
        PROPOSAL,
        CODE,
        TRADE_INSIGHT
    }

    // ============ Constants ============

    uint256 public constant XP_PER_POST = 10;
    uint256 public constant XP_PER_REPLY = 5;
    uint256 public constant XP_PER_UPVOTE = 2;
    uint256 public constant XP_PER_PROPOSAL = 50;
    uint256 public constant XP_PER_CODE = 100;

    uint256[] public LEVEL_THRESHOLDS;

    // ============ State ============

    uint256 private _nextTokenId;
    uint256 private _nextContributionId;

    mapping(uint256 => Identity) public identities;
    mapping(address => uint256) public addressToTokenId;
    mapping(string => bool) public usernameTaken;
    mapping(bytes32 => bool) public usernameHashTaken;

    mapping(uint256 => Contribution) public contributions;
    mapping(uint256 => uint256[]) public identityContributions; // tokenId => contribution IDs

    // Voting tracking
    mapping(uint256 => mapping(address => bool)) public hasVoted; // contributionId => voter => voted

    // Authorized contribution recorders (forum contract, etc.)
    mapping(address => bool) public authorizedRecorders;

    // ============ Events ============

    event IdentityMinted(address indexed owner, uint256 indexed tokenId, string username, bool quantumEnabled);
    event UsernameChanged(uint256 indexed tokenId, string oldUsername, string newUsername);
    event AvatarUpdated(uint256 indexed tokenId, AvatarTraits newTraits);
    event XPGained(uint256 indexed tokenId, uint256 amount, string reason);
    event LevelUp(uint256 indexed tokenId, uint256 newLevel);
    event AlignmentChanged(uint256 indexed tokenId, int256 oldAlignment, int256 newAlignment);
    event ContributionRecorded(uint256 indexed contributionId, uint256 indexed tokenId, ContributionType cType);
    event ContributionVoted(uint256 indexed contributionId, address indexed voter, bool upvote);
    event QuantumModeEnabled(uint256 indexed tokenId, bytes32 quantumKeyRoot);
    event QuantumKeyRotated(uint256 indexed tokenId, bytes32 newKeyRoot);

    // ============ Errors ============

    error AlreadyHasIdentity();
    error UsernameTaken();
    error UsernameInvalid();
    error NotTokenOwner();
    error SoulboundNoTransfer();
    error IdentityNotFound();
    error UnauthorizedRecorder();
    error AlreadyVoted();
    error CannotVoteOwnContent();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __ERC721_init("VibeSwap Identity", "VIBE-ID");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        _nextTokenId = 1;
        _nextContributionId = 1;

        // Level thresholds: 0, 100, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000
        LEVEL_THRESHOLDS.push(0);
        LEVEL_THRESHOLDS.push(100);
        LEVEL_THRESHOLDS.push(300);
        LEVEL_THRESHOLDS.push(600);
        LEVEL_THRESHOLDS.push(1000);
        LEVEL_THRESHOLDS.push(1500);
        LEVEL_THRESHOLDS.push(2500);
        LEVEL_THRESHOLDS.push(4000);
        LEVEL_THRESHOLDS.push(6000);
        LEVEL_THRESHOLDS.push(10000);
    }

    // ============ Identity Management ============

    /**
     * @notice Mint a new soulbound identity (standard mode)
     * @param username Unique username (3-20 chars, alphanumeric + underscore)
     */
    function mintIdentity(string calldata username) external returns (uint256) {
        return _mintIdentity(username, false, bytes32(0));
    }

    /**
     * @notice Mint a new soulbound identity with quantum resistance
     * @param username Unique username (3-20 chars, alphanumeric + underscore)
     * @param quantumKeyRoot Merkle root of Lamport public key hashes
     */
    function mintIdentityQuantum(string calldata username, bytes32 quantumKeyRoot) external returns (uint256) {
        require(quantumKeyRoot != bytes32(0), "Quantum key root required");
        return _mintIdentity(username, true, quantumKeyRoot);
    }

    /**
     * @notice Internal mint function
     */
    function _mintIdentity(
        string calldata username,
        bool quantumEnabled,
        bytes32 quantumKeyRoot
    ) internal returns (uint256) {
        if (addressToTokenId[msg.sender] != 0) revert AlreadyHasIdentity();
        if (!_isValidUsername(username)) revert UsernameInvalid();

        bytes32 usernameHash = keccak256(abi.encodePacked(_toLowerCase(username)));
        if (usernameHashTaken[usernameHash]) revert UsernameTaken();

        uint256 tokenId = _nextTokenId++;

        _safeMint(msg.sender, tokenId);

        // Generate pseudo-random avatar traits based on address and block data
        AvatarTraits memory avatar = _generateAvatar(msg.sender, tokenId);

        identities[tokenId] = Identity({
            username: username,
            level: 1,
            xp: 0,
            alignment: 0,
            contributions: 0,
            reputation: 0,
            createdAt: block.timestamp,
            lastActive: block.timestamp,
            avatar: avatar,
            quantumEnabled: quantumEnabled,
            quantumKeyRoot: quantumKeyRoot
        });

        addressToTokenId[msg.sender] = tokenId;
        usernameTaken[username] = true;
        usernameHashTaken[usernameHash] = true;

        emit IdentityMinted(msg.sender, tokenId, username, quantumEnabled);

        if (quantumEnabled) {
            emit QuantumModeEnabled(tokenId, quantumKeyRoot);
        }

        return tokenId;
    }

    /**
     * @notice Enable quantum mode for existing identity
     * @param quantumKeyRoot Merkle root of Lamport public key hashes
     */
    function enableQuantumMode(bytes32 quantumKeyRoot) external {
        uint256 tokenId = addressToTokenId[msg.sender];
        if (tokenId == 0) revert IdentityNotFound();
        require(quantumKeyRoot != bytes32(0), "Quantum key root required");

        Identity storage identity = identities[tokenId];
        require(!identity.quantumEnabled, "Quantum mode already enabled");

        identity.quantumEnabled = true;
        identity.quantumKeyRoot = quantumKeyRoot;
        identity.lastActive = block.timestamp;

        emit QuantumModeEnabled(tokenId, quantumKeyRoot);
    }

    /**
     * @notice Rotate quantum keys (for key refresh)
     * @param newKeyRoot New Merkle root of Lamport public key hashes
     */
    function rotateQuantumKeys(bytes32 newKeyRoot) external {
        uint256 tokenId = addressToTokenId[msg.sender];
        if (tokenId == 0) revert IdentityNotFound();
        require(newKeyRoot != bytes32(0), "Quantum key root required");

        Identity storage identity = identities[tokenId];
        require(identity.quantumEnabled, "Quantum mode not enabled");

        identity.quantumKeyRoot = newKeyRoot;
        identity.lastActive = block.timestamp;

        emit QuantumKeyRotated(tokenId, newKeyRoot);
    }

    /**
     * @notice Check if identity has quantum mode enabled
     */
    function isQuantumEnabled(address addr) external view returns (bool) {
        uint256 tokenId = addressToTokenId[addr];
        if (tokenId == 0) return false;
        return identities[tokenId].quantumEnabled;
    }

    /**
     * @notice Get quantum key root for an identity
     */
    function getQuantumKeyRoot(address addr) external view returns (bytes32) {
        uint256 tokenId = addressToTokenId[addr];
        if (tokenId == 0) return bytes32(0);
        return identities[tokenId].quantumKeyRoot;
    }

    /**
     * @notice Change username (costs reputation)
     */
    function changeUsername(string calldata newUsername) external {
        uint256 tokenId = addressToTokenId[msg.sender];
        if (tokenId == 0) revert IdentityNotFound();
        if (!_isValidUsername(newUsername)) revert UsernameInvalid();

        bytes32 newHash = keccak256(abi.encodePacked(_toLowerCase(newUsername)));
        if (usernameHashTaken[newHash]) revert UsernameTaken();

        Identity storage identity = identities[tokenId];
        string memory oldUsername = identity.username;
        bytes32 oldHash = keccak256(abi.encodePacked(_toLowerCase(oldUsername)));

        // Free old username
        usernameTaken[oldUsername] = false;
        usernameHashTaken[oldHash] = false;

        // Claim new username
        identity.username = newUsername;
        usernameTaken[newUsername] = true;
        usernameHashTaken[newHash] = true;

        // Cost: 10% of reputation
        if (identity.reputation > 0) {
            identity.reputation = (identity.reputation * 90) / 100;
        }

        emit UsernameChanged(tokenId, oldUsername, newUsername);
    }

    /**
     * @notice Update avatar traits (some locked by level)
     */
    function updateAvatar(AvatarTraits calldata newTraits) external {
        uint256 tokenId = addressToTokenId[msg.sender];
        if (tokenId == 0) revert IdentityNotFound();

        Identity storage identity = identities[tokenId];

        // Aura is level-gated: need level 3+ to customize
        if (newTraits.aura > 0 && identity.level < 3) {
            revert("Aura unlocks at level 3");
        }

        identity.avatar = newTraits;
        identity.lastActive = block.timestamp;

        emit AvatarUpdated(tokenId, newTraits);
    }

    // ============ Contribution Recording ============

    /**
     * @notice Record a contribution (called by authorized forum contract)
     */
    function recordContribution(
        address author,
        bytes32 contentHash,
        ContributionType cType
    ) external returns (uint256) {
        if (!authorizedRecorders[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedRecorder();
        }

        uint256 tokenId = addressToTokenId[author];
        if (tokenId == 0) revert IdentityNotFound();

        uint256 contributionId = _nextContributionId++;

        contributions[contributionId] = Contribution({
            author: author,
            timestamp: block.timestamp,
            contentHash: contentHash,
            cType: cType,
            upvotes: 0,
            downvotes: 0,
            tokenId: tokenId
        });

        identityContributions[tokenId].push(contributionId);

        Identity storage identity = identities[tokenId];
        identity.contributions++;
        identity.lastActive = block.timestamp;

        // Award XP based on contribution type
        uint256 xpGain = _getXPForType(cType);
        _addXP(tokenId, xpGain, _getTypeName(cType));

        emit ContributionRecorded(contributionId, tokenId, cType);

        return contributionId;
    }

    /**
     * @notice Vote on a contribution
     */
    function vote(uint256 contributionId, bool upvote) external {
        uint256 voterTokenId = addressToTokenId[msg.sender];
        if (voterTokenId == 0) revert IdentityNotFound();

        Contribution storage contribution = contributions[contributionId];
        if (contribution.author == msg.sender) revert CannotVoteOwnContent();
        if (hasVoted[contributionId][msg.sender]) revert AlreadyVoted();

        hasVoted[contributionId][msg.sender] = true;

        if (upvote) {
            contribution.upvotes++;
            // Award XP to author
            _addXP(contribution.tokenId, XP_PER_UPVOTE, "upvote received");
            // Increase reputation
            identities[contribution.tokenId].reputation++;
            // Slightly increase alignment toward order
            _adjustAlignment(contribution.tokenId, 1);
        } else {
            contribution.downvotes++;
            // Decrease reputation
            if (identities[contribution.tokenId].reputation > 0) {
                identities[contribution.tokenId].reputation--;
            }
            // Slightly decrease alignment toward chaos
            _adjustAlignment(contribution.tokenId, -1);
        }

        // Voter also gets small XP for participation
        _addXP(voterTokenId, 1, "voted");

        emit ContributionVoted(contributionId, msg.sender, upvote);
    }

    // ============ XP & Leveling ============

    function _addXP(uint256 tokenId, uint256 amount, string memory reason) internal {
        Identity storage identity = identities[tokenId];
        uint256 oldLevel = identity.level;
        identity.xp += amount;

        emit XPGained(tokenId, amount, reason);

        // Check for level up
        uint256 newLevel = _calculateLevel(identity.xp);
        if (newLevel > oldLevel) {
            identity.level = newLevel;
            emit LevelUp(tokenId, newLevel);
        }
    }

    function _calculateLevel(uint256 xp) internal view returns (uint256) {
        for (uint256 i = LEVEL_THRESHOLDS.length - 1; i > 0; i--) {
            if (xp >= LEVEL_THRESHOLDS[i]) {
                return i + 1;
            }
        }
        return 1;
    }

    function _adjustAlignment(uint256 tokenId, int256 change) internal {
        Identity storage identity = identities[tokenId];
        int256 oldAlignment = identity.alignment;
        int256 newAlignment = oldAlignment + change;

        // Clamp to [-100, 100]
        if (newAlignment > 100) newAlignment = 100;
        if (newAlignment < -100) newAlignment = -100;

        identity.alignment = newAlignment;

        emit AlignmentChanged(tokenId, oldAlignment, newAlignment);
    }

    // ============ View Functions ============

    function getIdentity(address addr) external view returns (Identity memory) {
        uint256 tokenId = addressToTokenId[addr];
        if (tokenId == 0) revert IdentityNotFound();
        return identities[tokenId];
    }

    function getIdentityByTokenId(uint256 tokenId) external view returns (Identity memory) {
        if (tokenId == 0 || tokenId >= _nextTokenId) revert IdentityNotFound();
        return identities[tokenId];
    }

    function getContributionsByIdentity(uint256 tokenId) external view returns (uint256[] memory) {
        return identityContributions[tokenId];
    }

    function getContribution(uint256 contributionId) external view returns (Contribution memory) {
        return contributions[contributionId];
    }

    function hasIdentity(address addr) external view returns (bool) {
        return addressToTokenId[addr] != 0;
    }

    function totalIdentities() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function totalContributions() external view returns (uint256) {
        return _nextContributionId - 1;
    }

    // ============ Admin Functions ============

    function setAuthorizedRecorder(address recorder, bool authorized) external onlyOwner {
        authorizedRecorders[recorder] = authorized;
    }

    /**
     * @notice Award XP directly (for off-chain contributions, trades, etc.)
     */
    function awardXP(address user, uint256 amount, string calldata reason) external {
        if (!authorizedRecorders[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedRecorder();
        }
        uint256 tokenId = addressToTokenId[user];
        if (tokenId == 0) revert IdentityNotFound();
        _addXP(tokenId, amount, reason);
    }

    // ============ Soulbound Override ============

    /**
     * @notice Prevent all transfers - this is a soulbound token
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // Allow minting (from == address(0)) but not transfers
        if (from != address(0) && to != address(0)) {
            revert SoulboundNoTransfer();
        }

        return super._update(to, tokenId, auth);
    }

    // ============ Internal Helpers ============

    function _isValidUsername(string calldata username) internal pure returns (bool) {
        bytes memory b = bytes(username);
        if (b.length < 3 || b.length > 20) return false;

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 char = b[i];
            bool isValid = (char >= 0x30 && char <= 0x39) || // 0-9
                          (char >= 0x41 && char <= 0x5A) || // A-Z
                          (char >= 0x61 && char <= 0x7A) || // a-z
                          char == 0x5F;                      // _
            if (!isValid) return false;
        }
        return true;
    }

    function _toLowerCase(string memory str) internal pure returns (string memory) {
        bytes memory b = bytes(str);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) {
                b[i] = bytes1(uint8(b[i]) + 32);
            }
        }
        return string(b);
    }

    function _generateAvatar(address owner, uint256 tokenId) internal view returns (AvatarTraits memory) {
        uint256 seed = uint256(keccak256(abi.encodePacked(owner, tokenId, block.prevrandao)));

        return AvatarTraits({
            background: uint8(seed % 16),
            body: uint8((seed >> 8) % 16),
            eyes: uint8((seed >> 16) % 16),
            mouth: uint8((seed >> 24) % 16),
            accessory: uint8((seed >> 32) % 16),
            aura: 0 // Starts with no aura, unlocked at level 3
        });
    }

    function _getXPForType(ContributionType cType) internal pure returns (uint256) {
        if (cType == ContributionType.POST) return XP_PER_POST;
        if (cType == ContributionType.REPLY) return XP_PER_REPLY;
        if (cType == ContributionType.PROPOSAL) return XP_PER_PROPOSAL;
        if (cType == ContributionType.CODE) return XP_PER_CODE;
        return XP_PER_POST; // TRADE_INSIGHT
    }

    function _getTypeName(ContributionType cType) internal pure returns (string memory) {
        if (cType == ContributionType.POST) return "post";
        if (cType == ContributionType.REPLY) return "reply";
        if (cType == ContributionType.PROPOSAL) return "proposal";
        if (cType == ContributionType.CODE) return "code contribution";
        return "trade insight";
    }

    // ============ Token URI ============

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        Identity memory identity = identities[tokenId];

        // Generate on-chain SVG avatar
        string memory svg = _generateSVG(identity);

        string memory json = string(abi.encodePacked(
            '{"name":"', identity.username, '",',
            '"description":"VibeSwap Soulbound Identity - Level ', _toString(identity.level), '",',
            '"image":"data:image/svg+xml;base64,', _base64Encode(bytes(svg)), '",',
            '"attributes":[',
                '{"trait_type":"Level","value":', _toString(identity.level), '},',
                '{"trait_type":"XP","value":', _toString(identity.xp), '},',
                '{"trait_type":"Alignment","value":', _toSignedString(identity.alignment), '},',
                '{"trait_type":"Contributions","value":', _toString(identity.contributions), '},',
                '{"trait_type":"Reputation","value":', _toString(identity.reputation), '}',
            ']}'
        ));

        return string(abi.encodePacked("data:application/json;base64,", _base64Encode(bytes(json))));
    }

    function _generateSVG(Identity memory identity) internal pure returns (string memory) {
        AvatarTraits memory a = identity.avatar;

        // Background colors
        string[16] memory bgColors = [
            "#0a0a0a", "#1a0a1a", "#0a1a1a", "#1a1a0a",
            "#0f0f1f", "#1f0f0f", "#0f1f0f", "#1f1f0f",
            "#000000", "#0d0d0d", "#1a0d0d", "#0d1a0d",
            "#0d0d1a", "#151515", "#101018", "#181010"
        ];

        // Body colors (skin tones + fantasy)
        string[16] memory bodyColors = [
            "#00ff41", "#00cc34", "#1aff76", "#4dff94",
            "#00d4ff", "#00a8cc", "#1ae0ff", "#67e8f9",
            "#ff3366", "#ff1a53", "#ff4d7a", "#ff6699",
            "#a855f7", "#9333ea", "#c084fc", "#d8b4fe"
        ];

        // Eye styles
        string[16] memory eyeStyles = [
            "M35,40 L40,40 M60,40 L65,40",
            "M35,40 Q37,38 40,40 M60,40 Q62,38 65,40",
            "M35,42 L40,38 M60,38 L65,42",
            "M32,40 L43,40 M57,40 L68,40",
            "M36,40 A2,2 0 1,1 38,40 M62,40 A2,2 0 1,1 64,40",
            "M35,40 L40,40 L37,43 M60,40 L65,40 L62,43",
            "M34,38 L41,42 M59,42 L66,38",
            "M35,40 L40,40 M60,40 L65,40",
            "M36,39 Q38,42 40,39 M60,39 Q62,42 64,39",
            "M35,40 L40,40 M60,40 L65,40 M37,37 L38,37 M62,37 L63,37",
            "M34,40 L41,40 M59,40 L66,40",
            "M35,40 A3,2 0 1,1 41,40 M59,40 A3,2 0 1,1 65,40",
            "M36,40 L39,40 M61,40 L64,40",
            "M35,39 L40,41 M60,41 L65,39",
            "M35,40 Q37,37 40,40 M60,40 Q62,37 65,40",
            "M33,40 L42,40 M58,40 L67,40"
        ];

        // Aura colors (level-gated)
        string[8] memory auraColors = [
            "none", "#00ff4140", "#00d4ff40", "#a855f740",
            "#ff336640", "#ffd70040", "#ffffff30", "#00ff4180"
        ];

        string memory auraElement = "";
        if (a.aura > 0 && bytes(auraColors[a.aura]).length > 4) {
            auraElement = string(abi.encodePacked(
                '<circle cx="50" cy="50" r="45" fill="', auraColors[a.aura], '" />'
            ));
        }

        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
            '<rect width="100" height="100" fill="', bgColors[a.background], '"/>',
            auraElement,
            '<circle cx="50" cy="55" r="25" fill="', bodyColors[a.body], '"/>',
            '<path d="', eyeStyles[a.eyes], '" stroke="#000" stroke-width="2" fill="none"/>',
            '<text x="50" y="95" text-anchor="middle" font-size="6" fill="#666">Lv.', _toString(identity.level), '</text>',
            '</svg>'
        ));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _toSignedString(int256 value) internal pure returns (string memory) {
        if (value >= 0) {
            return _toString(uint256(value));
        } else {
            return string(abi.encodePacked("-", _toString(uint256(-value))));
        }
    }

    function _base64Encode(bytes memory data) internal pure returns (string memory) {
        string memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 len = data.length;
        if (len == 0) return "";

        uint256 encodedLen = 4 * ((len + 2) / 3);
        bytes memory result = new bytes(encodedLen);

        uint256 i = 0;
        uint256 j = 0;

        while (i < len) {
            uint256 a = uint8(data[i++]);
            uint256 b = i < len ? uint8(data[i++]) : 0;
            uint256 c = i < len ? uint8(data[i++]) : 0;

            uint256 triple = (a << 16) | (b << 8) | c;

            result[j++] = bytes(table)[(triple >> 18) & 0x3F];
            result[j++] = bytes(table)[(triple >> 12) & 0x3F];
            result[j++] = bytes(table)[(triple >> 6) & 0x3F];
            result[j++] = bytes(table)[triple & 0x3F];
        }

        // Padding
        uint256 mod = len % 3;
        if (mod > 0) {
            result[encodedLen - 1] = "=";
            if (mod == 1) {
                result[encodedLen - 2] = "=";
            }
        }

        return string(result);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
