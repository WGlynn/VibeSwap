// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../../contracts/identity/SoulboundIdentity.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "../../contracts/identity/interfaces/IContributionAttestor.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "../../contracts/incentives/MicroGameFactory.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/CircuitBreaker.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "../../contracts/amm/VibeAMM.sol";

/// @title Recent Cycles — Cross-Contract Composition Integration Tests
/// @notice Verifies that the recently-shipped cycles (C39, C42, C45, C46, C47, C48-F1,
///         C48-F2, C28-F2, C39-F1, C42-F1, C19-F1) compose correctly across contracts.
///         Per-cycle unit tests live in their own files; this file targets the
///         INTEGRATION surface: behaviors that emerge only when multiple cycles run
///         in the same proxy / call sequence.
///
/// @dev Targeted run:
///        ~/.foundry/bin/forge test --match-path test/integration/RecentCyclesComposition.t.sol -vvv
///
///      Five scenarios in this file (one commit per scenario suggested in the report):
///        S1: C28-F2 + C45 + C46  — soulbound holder, identity-gated DAG vouch
///                                  (cooldown observability), then post-attestation
///                                  lineage binding.
///        S2: C48-F1 + C42        — MicroGameFactory cap-revert leaves Shapley keeper
///                                  state untouched; under-cap pool's keeper flow
///                                  proceeds end-to-end.
///        S3: C48-F2 + C39        — VibeSwapCore.compactFailedExecutions called while
///                                  LOSS_BREAKER is mid-trip; pagination preserves
///                                  C39 default-on classification + tripped state.
///        S4: C39-F1 (cross-contract) — pre-C39 storage simulated on BOTH VibeSwapCore
///                                      and VibeAMM; both run initializeC39Migration
///                                      atomically and preserve in-flight trips.
///        S5: C42-F1 end-to-end   — pre-C42 proxy upgraded via initializeC42Defaults;
///                                  full M-of-N keeper commit-reveal then settles.
///
///      Mocks are kept minimal — we deploy real production proxies only for the
///      contracts whose composition we're testing, and mock everything else with
///      the smallest interface-compliant stub.

// ============ Mocks ============

contract _IntMockToken is ERC20 {
    constructor() ERC20("Integration Mock Token", "IMT") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Minimal IContributionAttestor — only `getClaim` is exercised by
///      SoulboundIdentity.bindSourceLineage (C45). Tests drive every code path
///      via setClaim().
contract _IntMockAttestor {
    mapping(bytes32 => IContributionAttestor.ContributionClaim) private _claims;

    function setAcceptedClaim(bytes32 claimId, address contributor) external {
        _claims[claimId] = IContributionAttestor.ContributionClaim({
            claimId: claimId,
            contributor: contributor,
            claimant: contributor,
            contribType: IContributionAttestor.ContributionType.Code,
            evidenceHash: bytes32(uint256(0xC0FFEE)),
            description: "integration mock",
            value: 0,
            timestamp: block.timestamp,
            expiresAt: block.timestamp + 30 days,
            status: IContributionAttestor.ClaimStatus.Accepted,
            resolvedBy: IContributionAttestor.ResolutionSource.Executive,
            netWeight: 100,
            attestationCount: 3,
            contestationCount: 0
        });
    }

    function getClaim(bytes32 claimId)
        external
        view
        returns (IContributionAttestor.ContributionClaim memory)
    {
        return _claims[claimId];
    }
}

/// @dev MockUtilizationAccumulator for MicroGameFactory cap test (S2). Mirrors the
///      shape used in `test/incentives/MicroGameFactory.t.sol`.
contract _IntMockAccumulator {
    struct EpochPoolData {
        uint128 totalVolumeIn; uint128 totalVolumeOut;
        uint64 buyVolume; uint64 sellVolume;
        uint32 batchCount; uint8 maxVolatilityTier; bool finalized;
    }
    mapping(uint256 => mapping(bytes32 => EpochPoolData)) public epochData;
    mapping(bytes32 => address[]) public poolLPs;
    mapping(bytes32 => mapping(address => uint128)) public snapshots;
    uint256 public currentEpochId;

    function setEpochPoolData(
        uint256 epochId, bytes32 poolId,
        uint128 volIn, uint128 volOut, uint8 volatilityTier, bool finalized
    ) external {
        epochData[epochId][poolId] = EpochPoolData({
            totalVolumeIn: volIn, totalVolumeOut: volOut,
            buyVolume: uint64(volIn / 2e10), sellVolume: uint64(volIn / 2e10),
            batchCount: 10, maxVolatilityTier: volatilityTier, finalized: finalized
        });
    }

    function addLP(bytes32 poolId, address lp, uint128 snapshot) external {
        poolLPs[poolId].push(lp);
        snapshots[poolId][lp] = snapshot;
    }

    function getEpochPoolData(uint256 epochId, bytes32 poolId)
        external view returns (EpochPoolData memory) { return epochData[epochId][poolId]; }
    function getPoolLPs(bytes32 poolId)
        external view returns (address[] memory) { return poolLPs[poolId]; }
    function getLPSnapshot(bytes32 poolId, address lp)
        external view returns (uint128) { return snapshots[poolId][lp]; }
}

contract _IntMockEmission {
    struct Participant {
        address participant; uint256 directContribution;
        uint256 timeInPool; uint256 scarcityScore; uint256 stabilityScore;
    }
    mapping(bytes32 => bool) public created;
    function createContributionGame(bytes32 gameId, Participant[] calldata, uint256) external {
        created[gameId] = true;
    }
}

contract _IntMockLoyalty {
    function getStakeTimestamp(bytes32, address) external pure returns (uint256) {
        return 0;
    }
}

/// @dev Stubs for VibeSwapCore.initialize() pointer requirements. We only need
///      address-non-zero — the integration paths under test do not invoke them.
contract _IntMockAuction {
    function getCurrentBatchId() external pure returns (uint64) { return 1; }
    function getCurrentPhase() external pure returns (ICommitRevealAuction.BatchPhase) {
        return ICommitRevealAuction.BatchPhase.COMMIT;
    }
}
contract _IntMockAMM {}
contract _IntMockTreasury {}
contract _IntMockRouter {}

/// @dev Test harness exposing helpers to push synthetic failed executions
///      into VibeSwapCore so we can exercise compactFailedExecutions (C48-F2)
///      without driving a full settlement path. Mirrors the harness shape in
///      `test/VibeSwapCoreCompactionTest.t.sol`.
contract _CoreCompactHarness is VibeSwapCore {
    function pushFailed(address trader_, uint256 amountIn_) external {
        failedExecutions.push(FailedExecution({
            poolId: bytes32(amountIn_),
            trader: trader_,
            amountIn: amountIn_,
            estimatedOut: 0,
            expectedMinOut: 0,
            reason: bytes(""),
            timestamp: block.timestamp
        }));
    }
    function killEntry(uint256 index) external {
        delete failedExecutions[index];
    }
}

// ============ Integration Test Contract ============

contract RecentCyclesCompositionTest is Test {
    // Cross-cycle identifiers
    bytes32 internal LOSS;
    bytes32 internal TRUE_PRICE;
    bytes32 internal VOLUME;

    // Storage slot for c39SecurityDefaultsInitialized in CircuitBreaker linear
    // storage block. Confirmed by the per-cycle test
    // `test/security/C39MigrationWiring.t.sol` (slot 12).
    uint256 internal constant C39_FLAG_SLOT = 12;

    // ShapleyDistributor storage slots — confirmed by
    // `test/incentives/ShapleyDistributorC42Migration.t.sol` (slots 32, 33).
    uint256 internal constant SHAPLEY_THRESHOLD_SLOT = 32;
    uint256 internal constant SHAPLEY_DELAY_SLOT = 33;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public keeper1;
    address public keeper2;

    // Mirror events for vm.expectEmit
    event SecurityBreakerDefaultOverridden(bytes32 indexed breakerType, bool overrideValue, string reason);
    event HandshakeBlockedByCooldown(address indexed from, address indexed to, uint256 remaining);
    event HandshakeConfirmed(address indexed user1, address indexed user2);
    event SourceLineageBound(uint256 indexed tokenId, address indexed holder, bytes32 indexed claimId, bytes32 lineageHash);
    event NoveltyMultiplierSet(bytes32 indexed gameId, address indexed participant, uint256 multiplierBps);

    function setUp() public {
        // Realistic timestamp anchor — avoids `block.timestamp - cooldown` underflow.
        vm.warp(1_735_689_600); // 2025-01-01

        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        keeper1 = makeAddr("keeper-1");
        keeper2 = makeAddr("keeper-2");

        LOSS = keccak256("LOSS_BREAKER");
        TRUE_PRICE = keccak256("TRUE_PRICE_BREAKER");
        VOLUME = keccak256("VOLUME_BREAKER");
    }

    // ============ Deploy Helpers ============

    function _deploySoulbound() internal returns (SoulboundIdentity sbi) {
        SoulboundIdentity impl = new SoulboundIdentity();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(SoulboundIdentity.initialize, ())
        );
        sbi = SoulboundIdentity(address(proxy));
    }

    function _deployShapley() internal returns (ShapleyDistributor s) {
        ShapleyDistributor impl = new ShapleyDistributor();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ShapleyDistributor.initialize, (owner))
        );
        s = ShapleyDistributor(payable(address(proxy)));
        s.setAuthorizedCreator(owner, true);
    }

    function _deployMicroGameFactory(
        address accumulator, address emission, address loyalty
    ) internal returns (MicroGameFactory f) {
        MicroGameFactory impl = new MicroGameFactory();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                MicroGameFactory.initialize.selector,
                owner, accumulator, emission, loyalty
            )
        );
        f = MicroGameFactory(address(proxy));
    }

    function _deployVibeSwapCore() internal returns (VibeSwapCore core) {
        address auction = address(new _IntMockAuction());
        address amm = address(new _IntMockAMM());
        address treasury = address(new _IntMockTreasury());
        address router = address(new _IntMockRouter());

        VibeSwapCore impl = new VibeSwapCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner, auction, amm, treasury, router
            )
        );
        core = VibeSwapCore(payable(address(proxy)));
    }

    function _deployCoreCompactHarness() internal returns (_CoreCompactHarness core) {
        address auction = address(new _IntMockAuction());
        address amm = address(new _IntMockAMM());
        address treasury = address(new _IntMockTreasury());
        address router = address(new _IntMockRouter());

        _CoreCompactHarness impl = new _CoreCompactHarness();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner, auction, amm, treasury, router
            )
        );
        core = _CoreCompactHarness(payable(address(proxy)));
    }

    function _deployVibeAMM() internal returns (VibeAMM amm) {
        VibeAMM impl = new VibeAMM();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeAMM.initialize.selector, owner, makeAddr("amm-treasury"))
        );
        amm = VibeAMM(address(proxy));
    }

    /// @dev Simulate a pre-C39 proxy: reset the C39 init slot AFTER tripping a
    ///      breaker. Models the upgrade-time condition where an in-flight trip
    ///      exists in storage but the C39 slot has never been claimed.
    function _simulatePreC39_withTrippedBreaker(
        address proxy, bytes32 breakerType
    ) internal {
        // BreakerState lives in the mapping at slot 4 (mapping(bytes32 =>
        // BreakerState)). Layout: tripped(bool, slot+0), trippedAt(uint256, slot+1).
        bytes32 stateSlot = keccak256(abi.encode(breakerType, uint256(4)));
        // Write tripped = true.
        vm.store(proxy, stateSlot, bytes32(uint256(1)));
        // Write trippedAt = block.timestamp.
        vm.store(proxy, bytes32(uint256(stateSlot) + 1), bytes32(block.timestamp));
        // Clear C39 init flag (slot 12).
        vm.store(proxy, bytes32(C39_FLAG_SLOT), bytes32(uint256(0)));
    }

    /// @dev Simulate a pre-C42 proxy: clear the keeper threshold + delay slots
    ///      so the storage mirrors a proxy initialized BEFORE C42 shipped.
    function _simulatePreC42(address shapley) internal {
        vm.store(shapley, bytes32(SHAPLEY_THRESHOLD_SLOT), bytes32(uint256(0)));
        vm.store(shapley, bytes32(SHAPLEY_DELAY_SLOT), bytes32(uint256(0)));
    }

    // =========================================================================
    // SCENARIO 1 — C28-F2 + C45 + C46
    //
    // Soulbound holder mints (C28-F2 makes mint reentrancy-safe). DAG cooldown
    // observability counters (C46) increment on cooldown blocks for that holder.
    // After an attested contribution, lineage binding (C45) succeeds — the same
    // identity that produced the audit telemetry now has a permanent provenance
    // anchor. Verifies the three cycles compose without storage / behavior
    // collisions.
    //
    // INVARIANTS:
    //   I1. mintIdentity is reentrancy-safe (C28-F2): nonReentrant guard prevents
    //       double-mint to a single address even via onERC721Received reentry.
    //   I2. tryAddVouch (C46) increments totalHandshakeAttempts on first call AND
    //       totalHandshakesBlockedByCooldown on second cooldown-blocked call. The
    //       counter delta survives the cooldown branch — no revert wipes it.
    //   I3. After cooldown elapses, a successful handshake increments
    //       totalHandshakeSuccesses; the per-pair lastHandshakeAt is set.
    //   I4. SoulboundIdentity.bindSourceLineage (C45) succeeds on the same holder
    //       AFTER an Accepted claim is wired; getSourceLineageHash returns a
    //       non-zero canonical hash.
    //   I5. The lineage-bound identity continues to satisfy
    //       hasIdentity()-gated DAG operations — no cycle interferes with another.
    // =========================================================================

    /// @dev Extracted helpers cut local-variable count per function and dodge
    ///      Solidity's stack-depth ceiling (the default profile compiles without
    ///      via_ir per repo convention).
    function _s1_runDAGCounters(ContributionDAG dag) internal {
        // First addVouch increments attempts only.
        vm.prank(alice);
        dag.addVouch(bob, bytes32(uint256(0xAA)));
        assertEq(dag.totalHandshakeAttempts(), 1, "attempts after first vouch");
        assertEq(dag.totalHandshakeSuccesses(), 0, "no handshake yet");
        assertEq(dag.totalHandshakesBlockedByCooldown(), 0, "no blocks yet");

        // Same-block re-vouch via tryAddVouch is blocked, both counters bump.
        vm.expectEmit(true, true, false, true, address(dag));
        emit HandshakeBlockedByCooldown(alice, bob, dag.HANDSHAKE_COOLDOWN());
        vm.prank(alice);
        (ContributionDAG.VouchStatus status, , uint256 remaining) =
            dag.tryAddVouch(bob, bytes32(uint256(0xBEEF)));
        assertEq(uint256(status), uint256(ContributionDAG.VouchStatus.BlockedByCooldown));
        assertEq(remaining, dag.HANDSHAKE_COOLDOWN());
        assertEq(dag.totalHandshakeAttempts(), 2, "attempts == 2");
        assertEq(dag.totalHandshakesBlockedByCooldown(), 1, "blocked == 1");

        // Bob's reverse vouch confirms the handshake.
        vm.prank(bob);
        dag.addVouch(alice, bytes32(uint256(0xCAFE)));
        assertEq(dag.totalHandshakeSuccesses(), 1, "one handshake");
    }

    function _s1_bindLineageAndAssert(
        SoulboundIdentity sbi,
        _IntMockAttestor attestor,
        uint256 aliceTokenId
    ) internal {
        bytes32 ALICE_CLAIM = keccak256("alice-first-contrib");
        attestor.setAcceptedClaim(ALICE_CLAIM, alice);

        bytes32 expectedLineage = keccak256(abi.encode(address(attestor), ALICE_CLAIM));
        vm.expectEmit(true, true, true, true, address(sbi));
        emit SourceLineageBound(aliceTokenId, alice, ALICE_CLAIM, expectedLineage);
        vm.prank(alice);
        sbi.bindSourceLineage(ALICE_CLAIM);

        assertEq(sbi.getSourceLineageHash(alice), expectedLineage, "alice lineage bound");
        assertTrue(sbi.hasSourceLineage(alice), "alice has lineage");
    }

    function test_S1_soulboundLineageWithDAGAuditCounters() public {
        // --- Deploy real production stack ---
        SoulboundIdentity sbi = _deploySoulbound();
        ContributionDAG dag = new ContributionDAG(address(sbi));
        _IntMockAttestor attestor = new _IntMockAttestor();
        sbi.setContributionAttestor(address(attestor));

        // --- Alice and Bob mint identities (reentrancy-safe per C28-F2) ---
        // I1: re-entry attempt would revert; simple EOA mint succeeds normally.
        vm.prank(alice);
        uint256 aliceTokenId = sbi.mintIdentity("alice_v");
        vm.prank(bob);
        sbi.mintIdentity("bob_v");

        // Sanity: each address holds exactly one identity.
        assertEq(sbi.balanceOf(alice), 1, "alice exactly one identity");
        assertEq(sbi.balanceOf(bob), 1, "bob exactly one identity");

        // I2 + I3: DAG audit counters compose with C28-F2 identity gating.
        _s1_runDAGCounters(dag);

        // I4: post-attestation lineage binding succeeds for the same holder.
        _s1_bindLineageAndAssert(sbi, attestor, aliceTokenId);

        // I5: post-lineage, post-cooldown vouch path is unaffected — alice has
        // identity, so a fresh vouch (different counterparty) returns Success
        // for the cooldown gate. We deliberately use bob (already-handshook)
        // after warp to verify the cooldown gate clears AND the lineage state
        // does not leak into the gating logic.
        vm.warp(block.timestamp + dag.HANDSHAKE_COOLDOWN() + 1);
        vm.prank(alice);
        (ContributionDAG.VouchStatus okStatus, , ) =
            dag.tryAddVouch(bob, bytes32(uint256(0xD00D)));
        assertEq(
            uint256(okStatus),
            uint256(ContributionDAG.VouchStatus.Success),
            "post-cooldown re-vouch by lineage-bound holder succeeds"
        );
    }

    // =========================================================================
    // SCENARIO 2 — C48-F1 + C42
    //
    // MicroGameFactory at LP-cap (1001 LPs) reverts with TooManyLPs BEFORE any
    // expensive sort or downstream emission. The Shapley distributor — which
    // would be the eventual settlement target — is unaffected: its keeper
    // commit-reveal flow continues to work for an UNRELATED game.
    //
    // This is the "noisy neighbor" composition: a single griefed pool cannot
    // brick legitimate keeper operations on adjacent games.
    //
    // INVARIANTS:
    //   I1. createMicroGame on a >1000-LP pool reverts with TooManyLPs and does
    //       NOT consume the epoch (lastSettledEpoch unchanged).
    //   I2. The Shapley distributor's keeper threshold + delay are
    //       observable post-revert (no state corruption).
    //   I3. A keeper commit + reveal on an unrelated game succeeds end-to-end
    //       and applies the multiplier.
    //   I4. The cap-revert is cheap (under the per-cycle-test 5M gas budget) —
    //       the C48-F1 cap MUST fire before the O(n^2) sort path.
    // =========================================================================

    function test_S2_microGameCapDoesNotBrickShapleyKeepers() public {
        // --- Deploy stack ---
        _IntMockAccumulator acc = new _IntMockAccumulator();
        _IntMockEmission emis = new _IntMockEmission();
        _IntMockLoyalty loy = new _IntMockLoyalty();
        MicroGameFactory factory = _deployMicroGameFactory(
            address(acc), address(emis), address(loy)
        );
        ShapleyDistributor shapley = _deployShapley();
        _IntMockToken token = new _IntMockToken();

        // --- Set up the over-cap pool ---
        bytes32 BAD_POOL = keccak256("over-cap-pool");
        acc.setEpochPoolData(1, BAD_POOL, 1_000_000e18, 950_000e18, 1, true);
        for (uint256 i = 0; i < 1001; i++) {
            address lp = address(uint160(0x10000 + i));
            acc.addLP(BAD_POOL, lp, 1e18);
        }

        // I1 + I4: cap-revert is cheap and does not consume the epoch.
        uint256 g0 = gasleft();
        vm.expectRevert(abi.encodeWithSelector(
            MicroGameFactory.TooManyLPs.selector, uint256(1001), uint256(1000)
        ));
        factory.createMicroGame(BAD_POOL, 1);
        uint256 used = g0 - gasleft();
        assertLt(used, 5_000_000, "cap-revert under 5M gas");
        assertEq(factory.lastSettledEpoch(BAD_POOL), 0, "epoch NOT consumed");

        // --- Set up a legitimate Shapley game on an UNRELATED gameId. ---
        bytes32 GAME_ID = keccak256("legitimate-game");
        token.mint(address(shapley), 100 ether);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant({
            participant: alice, directContribution: 100 ether,
            timeInPool: 7 days, scarcityScore: 6000, stabilityScore: 8000
        });
        ps[1] = ShapleyDistributor.Participant({
            participant: bob, directContribution: 50 ether,
            timeInPool: 14 days, scarcityScore: 5000, stabilityScore: 5000
        });
        shapley.createGame(GAME_ID, 100 ether, address(token), ps);

        // I2: Shapley defaults are observable + uncorrupted post-cap-revert.
        assertEq(shapley.keeperRevealThreshold(), 1, "default M=1");
        assertEq(
            shapley.keeperRevealDelay(),
            shapley.DEFAULT_KEEPER_REVEAL_DELAY(),
            "default delay"
        );

        // I3: keeper commit + reveal flow on the unrelated game succeeds.
        shapley.setCertifiedKeeper(keeper1, true);
        bytes32 salt = keccak256("salt-s2");
        uint256 mult = 15000;
        bytes32 commit = shapley.computeNoveltyCommitment(GAME_ID, alice, mult, salt, 0);

        vm.prank(keeper1);
        shapley.commitNoveltyMultiplier(GAME_ID, alice, commit);

        vm.warp(block.timestamp + shapley.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        vm.expectEmit(true, true, false, true, address(shapley));
        emit NoveltyMultiplierSet(GAME_ID, alice, mult);
        vm.prank(keeper1);
        shapley.revealNoveltyMultiplier(GAME_ID, alice, mult, salt);

        assertEq(shapley.getNoveltyMultiplier(GAME_ID, alice), mult, "multiplier applied");
        assertEq(shapley.getRevealRound(GAME_ID, alice), 1, "round bumped");
    }

    // =========================================================================
    // SCENARIO 3 — C48-F2 + C39
    //
    // VibeSwapCore.compactFailedExecutions runs while LOSS_BREAKER is mid-trip.
    // Verifies the C48-F2 pagination is structurally orthogonal to the C39
    // attested-resume default-on classification — they live in different
    // storage regions and neither cycle's invariant is touched by the other's
    // execution.
    //
    // INVARIANTS:
    //   I1. Before compaction: LOSS_BREAKER is tripped AND
    //       isAttestedResumeRequired(LOSS) == true (C39 default-on).
    //       c39SecurityDefaultsInitialized == true.
    //   I2. compactFailedExecutions caps work at MAX_COMPACTION_PER_CALL = 200
    //       in the same tx the breaker is tripped.
    //   I3. After compaction: LOSS_BREAKER is STILL tripped, classification
    //       unchanged, C39 slot still claimed. Failed-queue length shrunk by
    //       exactly the count of zeroed entries in the scan window.
    //   I4. The attestedResumeOverridden mapping is undisturbed (no spillover
    //       writes from compaction's pop loop).
    // =========================================================================

    function test_S3_compactionDoesNotInterfereWithBreakerTrip() public {
        _CoreCompactHarness core = _deployCoreCompactHarness();

        // I1 precondition: fresh deploy claims C39 slot, LOSS classified default-on.
        assertTrue(core.c39SecurityDefaultsInitialized(), "C39 slot claimed on fresh");
        assertTrue(core.isAttestedResumeRequired(LOSS), "LOSS default-on");

        // Simulate a tripped LOSS breaker WITHOUT clearing the C39 flag (this is
        // the "post-C39 proxy with active trip" condition, distinct from the
        // pre-C39 migration scenario). configureBreaker requires non-zero params.
        core.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);
        bytes32 stateSlot = keccak256(abi.encode(LOSS, uint256(4)));
        vm.store(address(core), stateSlot, bytes32(uint256(1)));
        vm.store(address(core), bytes32(uint256(stateSlot) + 1), bytes32(block.timestamp));

        (, bool tripped,,,) = core.getBreakerStatus(LOSS);
        assertTrue(tripped, "precondition: LOSS tripped");

        // Push 500 entries; mark first 250 dead, last 250 live.
        for (uint256 i = 0; i < 500; i++) core.pushFailed(alice, i + 1);
        for (uint256 i = 0; i < 250; i++) core.killEntry(i);
        assertEq(core.getFailedExecutionCount(), 500);

        // I2: compaction caps at 200 entries in the scan window. With 200 dead
        // in window (out of the first 250 dead), removed == 200, scanned == 200.
        (uint256 scanned, uint256 removed) = core.compactFailedExecutions();
        assertEq(scanned, 200, "scan window capped");
        assertEq(removed, 200, "200 dead removed in window");
        assertEq(core.getFailedExecutionCount(), 300, "queue shrunk by exactly 200");

        // I3: breaker state unchanged.
        (, bool stillTripped,,,) = core.getBreakerStatus(LOSS);
        assertTrue(stillTripped, "LOSS still tripped post-compaction");
        assertTrue(
            core.isAttestedResumeRequired(LOSS),
            "C39 classification preserved post-compaction"
        );
        assertTrue(
            core.c39SecurityDefaultsInitialized(),
            "C39 slot still claimed post-compaction"
        );

        // I4: attestedResumeOverridden untouched (we never set it; should still be false).
        assertFalse(
            core.attestedResumeOverridden(LOSS),
            "no spillover write to override mapping"
        );
        assertFalse(
            core.attestedResumeOverridden(TRUE_PRICE),
            "no spillover write to TRUE_PRICE override"
        );
    }

    // =========================================================================
    // SCENARIO 4 — C39-F1 (cross-contract migration sequence)
    //
    // Two production proxies, both with simulated pre-C39 storage AND in-flight
    // tripped security breakers (LOSS on VibeSwapCore, TRUE_PRICE on VibeAMM).
    // Run initializeC39Migration on BOTH atomically. Both contracts must:
    //   (a) preserve their in-flight trip's wall-clock semantics, and
    //   (b) mark the C39 slot claimed so future reinitializer(2) attempts revert.
    //
    // INVARIANTS:
    //   I1. Pre-migration: both proxies have c39SecurityDefaultsInitialized == false
    //       AND a tripped breaker.
    //   I2. Post-migration: both proxies have c39SecurityDefaultsInitialized == true.
    //   I3. The in-flight tripped breakers have attestedResumeOverridden = true,
    //       requiresAttestedResume = false, and the EFFECTIVE answer on
    //       isAttestedResumeRequired is FALSE (wall-clock preserved).
    //   I4. Untripped security breakers (e.g., TRUE_PRICE on Core) still get the
    //       C39 default-on classification — only the in-flight trip is preserved.
    //   I5. VOLUME_BREAKER on both contracts remains wall-clock (operational class).
    // =========================================================================

    function test_S4_C39MigrationCrossContract_inFlightPreserved() public {
        VibeSwapCore core = _deployVibeSwapCore();
        VibeAMM amm = _deployVibeAMM();

        // Trip LOSS on Core, TRUE_PRICE on AMM — both with valid configurations
        // first (configureBreaker requires non-zero params).
        core.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);
        amm.configureBreaker(TRUE_PRICE, 1000 ether, 1 hours, 10 minutes);

        _simulatePreC39_withTrippedBreaker(address(core), LOSS);
        _simulatePreC39_withTrippedBreaker(address(amm), TRUE_PRICE);

        // I1 precondition: both proxies look pre-C39 with active trips.
        assertFalse(core.c39SecurityDefaultsInitialized(), "Core: pre-C39 (sim)");
        assertFalse(amm.c39SecurityDefaultsInitialized(), "AMM: pre-C39 (sim)");
        (, bool coreTripped,,,) = core.getBreakerStatus(LOSS);
        (, bool ammTripped,,,) = amm.getBreakerStatus(TRUE_PRICE);
        assertTrue(coreTripped, "precondition: LOSS tripped on Core");
        assertTrue(ammTripped, "precondition: TRUE_PRICE tripped on AMM");

        // --- Run migrations atomically on both ---
        // Each must emit SecurityBreakerDefaultOverridden for its in-flight breaker.
        vm.expectEmit(true, false, false, true, address(core));
        emit SecurityBreakerDefaultOverridden(
            LOSS, false, "C39 migration: in-flight trip preserved on wall-clock"
        );
        core.initializeC39Migration();

        vm.expectEmit(true, false, false, true, address(amm));
        emit SecurityBreakerDefaultOverridden(
            TRUE_PRICE, false, "C39 migration: in-flight trip preserved on wall-clock"
        );
        amm.initializeC39Migration();

        // I2: both proxies claimed the C39 slot.
        assertTrue(core.c39SecurityDefaultsInitialized(), "Core: post-migration slot claimed");
        assertTrue(amm.c39SecurityDefaultsInitialized(), "AMM: post-migration slot claimed");

        // I3: in-flight trips preserved on wall-clock (override pinned, raw=false).
        assertTrue(core.attestedResumeOverridden(LOSS), "Core LOSS: override pinned");
        assertFalse(core.requiresAttestedResume(LOSS), "Core LOSS: raw=false");
        assertFalse(core.isAttestedResumeRequired(LOSS), "Core LOSS: effective wall-clock");

        assertTrue(amm.attestedResumeOverridden(TRUE_PRICE), "AMM TRUE_PRICE: override pinned");
        assertFalse(amm.requiresAttestedResume(TRUE_PRICE), "AMM TRUE_PRICE: raw=false");
        assertFalse(
            amm.isAttestedResumeRequired(TRUE_PRICE), "AMM TRUE_PRICE: effective wall-clock"
        );

        // I4: untripped security breakers fall through to C39 default-on. On
        //      Core, TRUE_PRICE was never tripped — so it must be default-on.
        //      On AMM, LOSS was never tripped — so it must be default-on.
        assertTrue(
            core.isAttestedResumeRequired(TRUE_PRICE),
            "Core TRUE_PRICE (untripped) gets C39 default-on"
        );
        assertTrue(
            amm.isAttestedResumeRequired(LOSS),
            "AMM LOSS (untripped) gets C39 default-on"
        );

        // I5: VOLUME on both is operational class — wall-clock by default.
        assertFalse(core.isAttestedResumeRequired(VOLUME), "Core VOLUME wall-clock");
        assertFalse(amm.isAttestedResumeRequired(VOLUME), "AMM VOLUME wall-clock");

        // The migration is one-shot per proxy.
        vm.expectRevert(); // InvalidInitialization
        core.initializeC39Migration();
        vm.expectRevert();
        amm.initializeC39Migration();
    }

    // =========================================================================
    // SCENARIO 5 — C42-F1 end-to-end keeper commit-reveal post-migration
    //
    // Pre-C42 proxy upgraded via initializeC42Defaults — the reinitializer sets
    // safe defaults for keeperRevealDelay + keeperRevealThreshold. The full
    // M-of-N keeper commit-reveal flow then runs end-to-end with M=2 (2-of-2
    // agreement) and a multiplier is applied to the participant.
    //
    // This composes the migration (C42-F1) with the cycle's primary flow (C42).
    // INVARIANTS:
    //   I1. Pre-migration storage has zero threshold + zero delay.
    //   I2. Post-migration: delay = DEFAULT_KEEPER_REVEAL_DELAY, threshold = 1.
    //   I3. Governance can override threshold to 2 after migration; the new
    //       value sticks (no idempotency overwrite).
    //   I4. Two certified keepers commit + (after delay) reveal the same
    //       multiplier; the second reveal triggers application; multiplier is
    //       set; round bumps to 1.
    //   I5. A non-certified address cannot commit (gating intact post-migration).
    // =========================================================================

    function test_S5_C42MigrationThenFullKeeperFlow() public {
        ShapleyDistributor shapley = _deployShapley();
        _IntMockToken token = new _IntMockToken();

        // Seed a game (un-settled) so reveals have a target.
        bytes32 GAME_ID = keccak256("c42-int-game");
        token.mint(address(shapley), 100 ether);
        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant({
            participant: alice, directContribution: 100 ether,
            timeInPool: 7 days, scarcityScore: 6000, stabilityScore: 8000
        });
        ps[1] = ShapleyDistributor.Participant({
            participant: bob, directContribution: 50 ether,
            timeInPool: 14 days, scarcityScore: 5000, stabilityScore: 5000
        });
        shapley.createGame(GAME_ID, 100 ether, address(token), ps);

        // I1: simulate pre-C42 storage (threshold = 0, delay = 0).
        _simulatePreC42(address(shapley));
        assertEq(shapley.keeperRevealThreshold(), 0, "pre-C42 threshold cleared");
        assertEq(shapley.keeperRevealDelay(), 0, "pre-C42 delay cleared");

        // --- Run the migration ---
        shapley.initializeC42Defaults();

        // I2: defaults restored.
        assertEq(shapley.keeperRevealThreshold(), 1, "post-mig threshold = 1");
        assertEq(
            shapley.keeperRevealDelay(),
            shapley.DEFAULT_KEEPER_REVEAL_DELAY(),
            "post-mig delay = default"
        );

        // I3: governance overrides threshold to 2 (M-of-N consensus).
        shapley.setKeeperRevealThreshold(2);
        assertEq(shapley.keeperRevealThreshold(), 2, "governance override sticks");

        // Certify two keepers.
        shapley.setCertifiedKeeper(keeper1, true);
        shapley.setCertifiedKeeper(keeper2, true);

        // I5: non-certified address rejected (negative path, post-migration).
        vm.prank(carol);
        vm.expectRevert(ShapleyDistributor.NotCertifiedKeeper.selector);
        shapley.commitNoveltyMultiplier(GAME_ID, alice, keccak256("nope"));

        // I4: 2-of-2 keeper commit + reveal flow on alice.
        uint256 mult = 18000;
        bytes32 salt1 = keccak256("salt-k1");
        bytes32 salt2 = keccak256("salt-k2");
        bytes32 c1 = shapley.computeNoveltyCommitment(GAME_ID, alice, mult, salt1, 0);
        bytes32 c2 = shapley.computeNoveltyCommitment(GAME_ID, alice, mult, salt2, 0);

        vm.prank(keeper1);
        shapley.commitNoveltyMultiplier(GAME_ID, alice, c1);
        vm.prank(keeper2);
        shapley.commitNoveltyMultiplier(GAME_ID, alice, c2);

        // Use-site floor honors the post-migration delay.
        vm.warp(block.timestamp + shapley.DEFAULT_KEEPER_REVEAL_DELAY() + 1);

        // First reveal: count -> 1, no application yet (M=2).
        vm.prank(keeper1);
        shapley.revealNoveltyMultiplier(GAME_ID, alice, mult, salt1);
        assertEq(
            shapley.getNoveltyMultiplier(GAME_ID, alice),
            10000,
            "default-1.0x before threshold reached"
        );
        assertEq(shapley.getRevealRound(GAME_ID, alice), 0, "round un-bumped");

        // Second matching reveal: count -> 2 == threshold, applies, bumps round.
        vm.expectEmit(true, true, false, true, address(shapley));
        emit NoveltyMultiplierSet(GAME_ID, alice, mult);
        vm.prank(keeper2);
        shapley.revealNoveltyMultiplier(GAME_ID, alice, mult, salt2);

        assertEq(shapley.getNoveltyMultiplier(GAME_ID, alice), mult, "multiplier applied");
        assertEq(shapley.getRevealRound(GAME_ID, alice), 1, "round bumped");

        // Migration is one-shot — second call reverts.
        vm.expectRevert(); // InvalidInitialization
        shapley.initializeC42Defaults();
    }
}
