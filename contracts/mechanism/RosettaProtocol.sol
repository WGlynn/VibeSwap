// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title RosettaProtocol — On-Chain Lexicon Registry and Translation Verification
 * @notice Universal translation layer for cross-agent communication. Makes the
 *         Rosetta Protocol trustless by anchoring domain lexicons, universal concept
 *         mappings, and the Ten Covenants of Tet permanently on-chain.
 *
 * @dev Three modules in one contract:
 *
 *      1. Lexicon Registry
 *         Each address registers one domain lexicon: a mapping of domain-specific
 *         terms to universal concept IDs (UCI). Terms are stored as keccak256
 *         hashes to save gas and enable O(1) lookups. Anyone can verify that two
 *         terms from different lexicons resolve to the same universal concept,
 *         confirming semantic equivalence without off-chain trust.
 *
 *      2. Translation Verification
 *         verifyTranslation(from, to, sourceTerm, targetTerm) returns true iff
 *         both terms hash to a universal concept ID that is identical across both
 *         lexicons. This is the on-chain Rosetta Stone: same decree, different scripts.
 *
 *      3. Covenant Registry
 *         The Ten Covenants of Tet are stored by index hash at deployment.
 *         COVENANT_HASH is immutable — Covenant IX enforced structurally.
 *         verifyCovenant(index, text) lets anyone confirm the text hasn't drifted
 *         from genesis. Alteration is not punished — it is impossible to hide.
 *
 *      4. Challenge Protocol
 *         On-chain dispute resolution per Covenant II. Challenger commits stakes,
 *         challenged agent selects game format (Covenant V). Resolution via
 *         trusted oracle/multisig until a ZK-based verifier is hardened (SOFT→HARD).
 *
 * @dev Design decisions:
 *      - Terms stored as keccak256(bytes(term)) — gas efficient, collision-resistant
 *      - One lexicon per address — mirrors "one agent, one domain" architecture
 *      - getEquivalents() uses a reverse index: universalConcept → list of (addr, termHash)
 *      - Challenges use a two-step commit (initiate → resolve) with stake escrow in ETH
 *      - COVENANT_HASH is set once at initialize() and declared immutable via storage slot
 *        (not Solidity `immutable` keyword, which is incompatible with UUPS proxies)
 *      - P-001: 0% protocol extraction. Challenge stakes go entirely to winner.
 *
 * @author Faraday1, JARVIS | March 2026
 *
 * References:
 *   docs/papers/rosetta-stone-protocol.md
 *   DOCUMENTATION/ROSETTA_COVENANTS.md
 */
contract RosettaProtocol is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Enums ============

    enum ChallengeState { PENDING, ACCEPTED, RESOLVED, CANCELLED }

    // ============ Structs ============

    /// @notice A single domain lexicon belonging to one address
    struct Lexicon {
        string domain;              // Human-readable domain name (e.g. "trading", "governance")
        bool registered;            // Guard against re-registration
        uint256 termCount;          // Total active terms
        uint256 registeredAt;       // Block timestamp of initial registration
    }

    /// @notice A single registered term inside a lexicon
    struct TermEntry {
        bytes32 universalConcept;   // UCI identifier this term resolves to
        bool active;                // Soft-delete flag (removeTerm)
        uint256 addedAt;
    }

    /// @notice A pointer used in the reverse index for getEquivalents()
    struct TermPointer {
        address owner;              // Lexicon owner
        bytes32 termHash;           // keccak256(bytes(term))
        string term;                // Original string for readability
    }

    /// @notice A single challenge under Covenant II
    struct Challenge {
        uint256 id;
        address challenger;
        address opponent;
        bytes32 stakes;             // ABI-encoded stake descriptor (amount, type, etc.)
        uint256 stakeAmount;        // ETH escrowed from challenger
        uint256 opponentStake;      // ETH escrowed from opponent
        ChallengeState state;
        address winner;             // Populated on resolution
        string gameRules;           // Submitted by challenged agent (Covenant V)
        uint256 initiatedAt;
        uint256 resolvedAt;
    }

    // ============ Constants ============

    uint256 public constant MAX_TERMS_PER_LEXICON = 256;
    uint256 public constant CHALLENGE_EXPIRY = 7 days;

    /// @notice P-001: No Extraction Ever. 0% protocol cut on challenge stakes.
    uint256 public constant PROTOCOL_FEE_BPS = 0;

    // ============ Storage ============

    /// @notice Immutable Covenant hash — set once at initialize(), never changed
    /// @dev Not Solidity `immutable` because UUPS proxies initialise after deployment.
    ///      Enforced by having no setter function whatsoever.
    bytes32 public COVENANT_HASH;

    /// @notice Per-covenant text hashes (index 1-10)
    mapping(uint8 => bytes32) public covenantHashes;

    /// @notice lexiconOf[owner] → Lexicon metadata
    mapping(address => Lexicon) public lexiconOf;

    /// @notice terms[owner][termHash] → TermEntry
    mapping(address => mapping(bytes32 => TermEntry)) public terms;

    /// @notice reverseIndex[universalConcept] → all TermPointers mapping to it
    mapping(bytes32 => TermPointer[]) private _reverseIndex;

    /// @notice challenges[id] → Challenge
    mapping(uint256 => Challenge) public challenges;

    /// @notice Total challenges ever initiated
    uint256 public challengeCount;

    /// @notice Trusted resolvers for challenge outcomes (oracle/multisig)
    mapping(address => bool) public isTrustedResolver;

    // ============ Events ============

    event LexiconRegistered(address indexed owner, string domain, uint256 timestamp);
    event TermAdded(address indexed owner, string term, bytes32 termHash, bytes32 universalConcept);
    event TermRemoved(address indexed owner, string term, bytes32 termHash);
    event TranslationVerified(
        address indexed from,
        address indexed to,
        string sourceTerm,
        string targetTerm,
        bytes32 universalConcept,
        bool result
    );
    event ChallengeInitiated(
        uint256 indexed challengeId,
        address indexed challenger,
        address indexed opponent,
        bytes32 stakes,
        uint256 stakeAmount
    );
    event GameRulesSubmitted(uint256 indexed challengeId, string gameRules);
    event ChallengeResolved(
        uint256 indexed challengeId,
        address indexed winner,
        uint256 payout
    );
    event ChallengeCancelled(uint256 indexed challengeId, string reason);
    event TrustedResolverUpdated(address indexed resolver, bool trusted);

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error TermAlreadyExists();
    error TermNotFound();
    error LexiconFull();
    error InvalidInput();
    error ChallengeNotFound();
    error WrongChallengeState();
    error NotChallenged();
    error NotResolver();
    error StakeRequired();
    error StakeMismatch();
    error TransferFailed();
    error ChallengeExpired();
    error ChallengeNotExpired();

    // ============ Initializer ============

    /**
     * @notice Initialise the Rosetta Protocol with the Ten Covenants.
     * @param _owner            Contract owner (multisig recommended)
     * @param _covenantTexts    The Ten Covenants in order (index 0 = Covenant I)
     * @param _trustedResolvers Initial set of trusted challenge resolvers
     */
    function initialize(
        address _owner,
        string[10] calldata _covenantTexts,
        address[] calldata _trustedResolvers
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        // Store individual covenant hashes and compute the aggregate
        bytes32 runningHash;
        for (uint8 i = 0; i < 10; i++) {
            bytes32 h = keccak256(bytes(_covenantTexts[i]));
            covenantHashes[i + 1] = h;
            runningHash = keccak256(abi.encodePacked(runningHash, h));
        }
        COVENANT_HASH = runningHash;

        for (uint256 i = 0; i < _trustedResolvers.length; i++) {
            if (_trustedResolvers[i] != address(0)) {
                isTrustedResolver[_trustedResolvers[i]] = true;
                emit TrustedResolverUpdated(_trustedResolvers[i], true);
            }
        }
    }

    // ============ Lexicon Registry ============

    /**
     * @notice Register a new lexicon for the caller's address.
     * @dev One lexicon per address. Domain name is free-form (e.g. "trading").
     *      The domain is stored for human readability; terms are registered
     *      separately via addTerm / the bulk form below.
     * @param domain            Human-readable domain identifier
     * @param termStrings       Initial terms to add (may be empty)
     * @param universalConcepts Corresponding UCI identifiers (parallel array)
     */
    function registerLexicon(
        string calldata domain,
        string[] calldata termStrings,
        bytes32[] calldata universalConcepts
    ) external nonReentrant {
        if (lexiconOf[msg.sender].registered) revert AlreadyRegistered();
        if (bytes(domain).length == 0) revert InvalidInput();
        if (termStrings.length != universalConcepts.length) revert InvalidInput();
        if (termStrings.length > MAX_TERMS_PER_LEXICON) revert LexiconFull();

        lexiconOf[msg.sender] = Lexicon({
            domain: domain,
            registered: true,
            termCount: 0,
            registeredAt: block.timestamp
        });

        emit LexiconRegistered(msg.sender, domain, block.timestamp);

        // Bulk-add initial terms
        for (uint256 i = 0; i < termStrings.length; i++) {
            _addTerm(msg.sender, termStrings[i], universalConcepts[i]);
        }
    }

    /**
     * @notice Add a single term to the caller's lexicon.
     * @param term              Domain-specific term string
     * @param universalConcept  UCI identifier this term maps to
     */
    function addTerm(
        string calldata term,
        bytes32 universalConcept
    ) external nonReentrant {
        if (!lexiconOf[msg.sender].registered) revert NotRegistered();
        _addTerm(msg.sender, term, universalConcept);
    }

    /**
     * @notice Remove a term from the caller's lexicon (soft-delete).
     * @dev The reverse index entry is left in place but the active flag is cleared.
     *      This preserves historical translation records without gas-heavy deletion.
     * @param term Term string to remove
     */
    function removeTerm(string calldata term) external nonReentrant {
        if (!lexiconOf[msg.sender].registered) revert NotRegistered();
        bytes32 termHash = keccak256(bytes(term));
        TermEntry storage entry = terms[msg.sender][termHash];
        if (!entry.active) revert TermNotFound();

        entry.active = false;
        lexiconOf[msg.sender].termCount -= 1;

        emit TermRemoved(msg.sender, term, termHash);
    }

    // ============ Translation Verification ============

    /**
     * @notice Verify that sourceTerm (in `from`'s lexicon) and targetTerm (in `to`'s
     *         lexicon) both map to the same universal concept, confirming semantic
     *         equivalence without trusting either party.
     * @param from       Address of the source lexicon owner
     * @param to         Address of the target lexicon owner
     * @param sourceTerm Term in the source domain
     * @param targetTerm Term in the target domain
     * @return True iff both terms are active and share a universal concept
     */
    function verifyTranslation(
        address from,
        address to,
        string calldata sourceTerm,
        string calldata targetTerm
    ) external returns (bool) {
        bytes32 sourceHash = keccak256(bytes(sourceTerm));
        bytes32 targetHash = keccak256(bytes(targetTerm));

        TermEntry storage sourceEntry = terms[from][sourceHash];
        TermEntry storage targetEntry = terms[to][targetHash];

        bool result = (
            sourceEntry.active &&
            targetEntry.active &&
            sourceEntry.universalConcept == targetEntry.universalConcept &&
            sourceEntry.universalConcept != bytes32(0)
        );

        emit TranslationVerified(
            from,
            to,
            sourceTerm,
            targetTerm,
            sourceEntry.universalConcept,
            result
        );

        return result;
    }

    /**
     * @notice Get the universal concept ID for a given term in a lexicon.
     * @param user Address of the lexicon owner
     * @param term Domain-specific term
     * @return universalConcept The UCI identifier, or bytes32(0) if not found / inactive
     */
    function getUniversalConcept(
        address user,
        string calldata term
    ) external view returns (bytes32 universalConcept) {
        bytes32 termHash = keccak256(bytes(term));
        TermEntry storage entry = terms[user][termHash];
        if (!entry.active) return bytes32(0);
        return entry.universalConcept;
    }

    /**
     * @notice Get all active terms across all lexicons that map to a universal concept.
     * @dev Iterates the reverse index. Gas cost grows with the number of registered
     *      equivalents; callers should use this for view/off-chain reads only.
     * @param universalConcept UCI identifier to look up
     * @return owners     Lexicon owner addresses
     * @return termHashes keccak256 hashes of matching terms
     * @return termValues Original term strings
     */
    function getEquivalents(
        bytes32 universalConcept
    ) external view returns (
        address[] memory owners,
        bytes32[] memory termHashes,
        string[] memory termValues
    ) {
        TermPointer[] storage pointers = _reverseIndex[universalConcept];
        uint256 total = pointers.length;

        // First pass: count actives to size return arrays
        uint256 activeCount;
        for (uint256 i = 0; i < total; i++) {
            TermEntry storage e = terms[pointers[i].owner][pointers[i].termHash];
            if (e.active) activeCount++;
        }

        owners     = new address[](activeCount);
        termHashes = new bytes32[](activeCount);
        termValues = new string[](activeCount);

        uint256 idx;
        for (uint256 i = 0; i < total; i++) {
            TermEntry storage e = terms[pointers[i].owner][pointers[i].termHash];
            if (e.active) {
                owners[idx]     = pointers[i].owner;
                termHashes[idx] = pointers[i].termHash;
                termValues[idx] = pointers[i].term;
                idx++;
            }
        }
    }

    // ============ Covenant Registry ============

    /**
     * @notice Verify that a covenant's text matches the genesis hash.
     * @dev Covenant IX enforced by making the aggregate COVENANT_HASH unchangeable.
     *      Individual covenant verification lets anyone spot a single altered clause.
     * @param index Covenant number 1–10
     * @param text  The covenant text to verify
     * @return True iff keccak256(text) matches the genesis hash for that covenant
     */
    function verifyCovenant(
        uint8 index,
        string calldata text
    ) external view returns (bool) {
        if (index < 1 || index > 10) revert InvalidInput();
        return covenantHashes[index] == keccak256(bytes(text));
    }

    /**
     * @notice Verify the complete set of Ten Covenants in one call.
     * @dev Recomputes the aggregate hash from all ten texts and compares to COVENANT_HASH.
     * @param covenantTexts All ten covenants in order (index 0 = Covenant I)
     * @return True iff the aggregate hash matches genesis
     */
    function verifyAllCovenants(
        string[10] calldata covenantTexts
    ) external view returns (bool) {
        bytes32 runningHash;
        for (uint8 i = 0; i < 10; i++) {
            bytes32 h = keccak256(bytes(covenantTexts[i]));
            runningHash = keccak256(abi.encodePacked(runningHash, h));
        }
        return runningHash == COVENANT_HASH;
    }

    // ============ Challenge Protocol ============

    /**
     * @notice Initiate a challenge against an opponent (Covenant II).
     * @dev Challenger deposits ETH as stake. Opponent must match the stake before
     *      game rules can be submitted (Covenant III: equal stakes).
     *      The challenged agent selects the game format (Covenant V).
     * @param opponent  Address being challenged
     * @param stakes    ABI-encoded stake descriptor (for off-chain game resolution)
     */
    function initiateChallenge(
        address opponent,
        bytes32 stakes
    ) external payable nonReentrant {
        if (opponent == address(0) || opponent == msg.sender) revert InvalidInput();
        if (msg.value == 0) revert StakeRequired();

        uint256 id = ++challengeCount;
        challenges[id] = Challenge({
            id: id,
            challenger: msg.sender,
            opponent: opponent,
            stakes: stakes,
            stakeAmount: msg.value,
            opponentStake: 0,
            state: ChallengeState.PENDING,
            winner: address(0),
            gameRules: "",
            initiatedAt: block.timestamp,
            resolvedAt: 0
        });

        emit ChallengeInitiated(id, msg.sender, opponent, stakes, msg.value);
    }

    /**
     * @notice Opponent accepts the challenge by matching the stake and submitting game rules.
     * @dev Implements Covenants III (equal stakes) and V (challenged picks game).
     * @param challengeId  The challenge to accept
     * @param gameRules    Game format description (e.g. "weighted_vote", "simulation_tournament")
     */
    function acceptChallenge(
        uint256 challengeId,
        string calldata gameRules
    ) external payable nonReentrant {
        Challenge storage c = challenges[challengeId];
        if (c.id == 0) revert ChallengeNotFound();
        if (c.state != ChallengeState.PENDING) revert WrongChallengeState();
        if (msg.sender != c.opponent) revert NotChallenged();
        if (block.timestamp > c.initiatedAt + CHALLENGE_EXPIRY) revert ChallengeExpired();

        // Covenant III: opponent must match challenger's stake exactly
        if (msg.value != c.stakeAmount) revert StakeMismatch();
        if (bytes(gameRules).length == 0) revert InvalidInput();

        c.opponentStake = msg.value;
        c.state = ChallengeState.ACCEPTED;
        c.gameRules = gameRules;

        emit GameRulesSubmitted(challengeId, gameRules);
    }

    /**
     * @notice Resolve a challenge and pay out the winner (Covenant VI: stakes upheld).
     * @dev Called by a trusted resolver (oracle or multisig). The Rosetta Protocol
     *      moves toward ZK-verified game outcomes as SOFT→HARD hardening progresses.
     *      Any cheating detection (Covenant VIII) must be encoded in the winner param.
     * @param challengeId Challenge to resolve
     * @param winner      Address of the winning party
     */
    function resolveChallenge(
        uint256 challengeId,
        address winner
    ) external nonReentrant {
        if (!isTrustedResolver[msg.sender]) revert NotResolver();

        Challenge storage c = challenges[challengeId];
        if (c.id == 0) revert ChallengeNotFound();
        if (c.state != ChallengeState.ACCEPTED) revert WrongChallengeState();
        if (winner != c.challenger && winner != c.opponent) revert InvalidInput();

        c.state = ChallengeState.RESOLVED;
        c.winner = winner;
        c.resolvedAt = block.timestamp;

        // Covenant VI: stakes transferred automatically. P-001: 0% protocol cut.
        uint256 payout = c.stakeAmount + c.opponentStake;
        (bool ok, ) = winner.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit ChallengeResolved(challengeId, winner, payout);
    }

    /**
     * @notice Cancel an expired challenge and return the challenger's stake.
     * @dev If the opponent never accepts within CHALLENGE_EXPIRY, the challenger
     *      can reclaim their stake. No penalty — they simply chose not to play.
     * @param challengeId Challenge to cancel
     */
    function cancelExpiredChallenge(uint256 challengeId) external nonReentrant {
        Challenge storage c = challenges[challengeId];
        if (c.id == 0) revert ChallengeNotFound();
        if (c.state != ChallengeState.PENDING) revert WrongChallengeState();
        if (block.timestamp <= c.initiatedAt + CHALLENGE_EXPIRY) revert ChallengeNotExpired();
        if (msg.sender != c.challenger) revert InvalidInput();

        c.state = ChallengeState.CANCELLED;

        (bool ok, ) = c.challenger.call{value: c.stakeAmount}("");
        if (!ok) revert TransferFailed();

        emit ChallengeCancelled(challengeId, "expired");
    }

    // ============ Admin ============

    /**
     * @notice Add or remove a trusted resolver for challenge outcomes.
     * @dev Resolver set should be a multisig or time-locked oracle until ZK hardens.
     */
    function setTrustedResolver(address resolver, bool trusted) external onlyOwner {
        if (resolver == address(0)) revert InvalidInput();
        isTrustedResolver[resolver] = trusted;
        emit TrustedResolverUpdated(resolver, trusted);
    }

    // ============ Internal ============

    /**
     * @dev Core term-addition logic shared by registerLexicon and addTerm.
     */
    function _addTerm(
        address owner,
        string memory term,
        bytes32 universalConcept
    ) internal {
        if (bytes(term).length == 0) revert InvalidInput();
        if (universalConcept == bytes32(0)) revert InvalidInput();
        if (lexiconOf[owner].termCount >= MAX_TERMS_PER_LEXICON) revert LexiconFull();

        bytes32 termHash = keccak256(bytes(term));
        TermEntry storage entry = terms[owner][termHash];
        if (entry.active) revert TermAlreadyExists();

        entry.universalConcept = universalConcept;
        entry.active = true;
        entry.addedAt = block.timestamp;

        lexiconOf[owner].termCount += 1;

        // Maintain reverse index for getEquivalents()
        _reverseIndex[universalConcept].push(TermPointer({
            owner: owner,
            termHash: termHash,
            term: term
        }));

        emit TermAdded(owner, term, termHash, universalConcept);
    }

    // ============ UUPS ============

    /// @dev Only the owner may authorise an upgrade (UUPS pattern)
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
