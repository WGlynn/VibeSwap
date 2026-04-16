// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "../../contracts/consensus/DAOShelter.sol";
import "../../contracts/consensus/StateRentVault.sol";
import "../../contracts/consensus/ShardOperatorRegistry.sol";
import "../../contracts/consensus/SecondaryIssuanceController.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title C10 Deploy Simulation
 * @notice End-to-end simulation of the Cycle-10 / C10.1 production deploy
 *         sequence and post-deploy admin flow. Mirrors C8DeploySimulation in
 *         spirit but exercises the NCI surface (SOR + NCI + DAOShelter +
 *         SecondaryIssuanceController + StateRentVault) and the C10 audit
 *         fixes (AUDIT-1..AUDIT-9).
 *
 *   1. Deploy CKB + SOR + DAOShelter + StateRentVault + SecondaryIssuanceController
 *   2. Wire minter/locker/controller roles
 *   3. Run post-upgrade admin steps (SOR registered off-circulation per AUDIT-1)
 *   4. Exercise commit/challenge/finalize flow
 *   5. Exercise stale-shard eviction
 *   6. Exercise graceful DAOShelter fallback (AUDIT-4)
 *   7. Cover double-registration of DAOShelter (AUDIT-5)
 *   8. Cover destroyCell access control (AUDIT-6) and ownerCells purge (AUDIT-8)
 *
 * Goal: catch deploy-ordering bugs and access-control regressions before mainnet.
 *       If someone forgets to register SOR as an off-circulation holder, this
 *       test makes the systematic shard-share under-weighting impossible to miss.
 */
contract C10DeploySimulationTest is Test {
    // ============ Deployed Contracts ============

    CKBNativeToken public ckb;
    DAOShelter public shelter;
    StateRentVault public vault;
    ShardOperatorRegistry public sor;
    SecondaryIssuanceController public issuance;

    // ============ Actors ============

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address insurance = makeAddr("insurance");
    address op1 = makeAddr("operator1");
    address op2 = makeAddr("operator2");
    address challenger = makeAddr("challenger");
    address depositor = makeAddr("depositor");

    // NCI / VibeStable / JCV stand-ins. They need non-zero code length because
    // setOffCirculationHolder requires `holder.code.length > 0` (C9-AUDIT-6).
    address nci = makeAddr("nciContract");
    address vibeStable = makeAddr("vibeStableContract");
    address jcv = makeAddr("jcvContract");

    uint256 constant STAKE = 500e18;

    function setUp() public {
        // Etch a single STOP byte on EOA stand-ins so the contract-code guard passes.
        vm.etch(nci, hex"00");
        vm.etch(vibeStable, hex"00");
        vm.etch(jcv, hex"00");
    }

    // ============ Deploy helpers ============

    function _deployCkb() internal returns (CKBNativeToken) {
        CKBNativeToken impl = new CKBNativeToken();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner)
        );
        return CKBNativeToken(address(proxy));
    }

    function _deployShelter(address _ckb) internal returns (DAOShelter) {
        DAOShelter impl = new DAOShelter();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(DAOShelter.initialize.selector, _ckb, owner)
        );
        return DAOShelter(address(proxy));
    }

    function _deployVault(address _ckb) internal returns (StateRentVault) {
        StateRentVault impl = new StateRentVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(StateRentVault.initialize.selector, _ckb, owner)
        );
        return StateRentVault(address(proxy));
    }

    function _deploySor(address _ckb) internal returns (ShardOperatorRegistry) {
        ShardOperatorRegistry impl = new ShardOperatorRegistry();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(ShardOperatorRegistry.initialize.selector, _ckb, owner)
        );
        return ShardOperatorRegistry(address(proxy));
    }

    function _deployIssuance(
        address _ckb,
        address _shelter,
        address _sor,
        address _insurance
    ) internal returns (SecondaryIssuanceController) {
        SecondaryIssuanceController impl = new SecondaryIssuanceController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                SecondaryIssuanceController.initialize.selector,
                _ckb,
                _shelter,
                _sor,
                _insurance,
                owner
            )
        );
        return SecondaryIssuanceController(address(proxy));
    }

    /// @notice Full C10 deploy + wire. Everything except the specific
    ///         off-circulation registration that tests exercise individually.
    function _fullDeploy() internal {
        ckb = _deployCkb();
        shelter = _deployShelter(address(ckb));
        vault = _deployVault(address(ckb));
        sor = _deploySor(address(ckb));
        issuance = _deployIssuance(address(ckb), address(shelter), address(sor), insurance);

        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        ckb.setMinter(address(issuance), true);
        ckb.setLocker(address(vault), true);
        shelter.setIssuanceController(address(issuance));
        sor.setIssuanceController(address(issuance));
        // C11-AUDIT-14: wire the SOR to the canonical StateRentVault so
        // respondToChallenge can verify cellIds are real active cells.
        sor.setStateRentVault(address(vault));
        // Make test contract a cellManager so tests can materialize real cells.
        vault.setCellManager(address(this), true);
        vm.stopPrank();

        // Test contract funds + approves vault so it can lock capacity on createCell.
        vm.prank(minter);
        ckb.mint(address(this), 100_000e18);
        ckb.approve(address(vault), type(uint256).max);

        // Give actors tokens for staking, depositing, challenging.
        vm.startPrank(minter);
        ckb.mint(op1, 50_000e18);
        ckb.mint(op2, 50_000e18);
        ckb.mint(challenger, 10_000e18);
        ckb.mint(depositor, 10_000e18);
        vm.stopPrank();

        vm.prank(op1);
        ckb.approve(address(sor), type(uint256).max);
        vm.prank(op2);
        ckb.approve(address(sor), type(uint256).max);
        vm.prank(challenger);
        ckb.approve(address(sor), type(uint256).max);
        vm.prank(depositor);
        ckb.approve(address(shelter), type(uint256).max);
    }

    /// @dev Build a simple 2-leaf Merkle tree over (index, cellId) pairs
    ///      using OZ MerkleProof's sorted-pair convention.
    function _build2LeafTree(bytes32 cellId0, bytes32 cellId1)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proof0, bytes32[] memory proof1)
    {
        bytes32 leaf0 = keccak256(abi.encode(uint256(0), cellId0));
        bytes32 leaf1 = keccak256(abi.encode(uint256(1), cellId1));
        root = _hashPair(leaf0, leaf1);
        proof0 = new bytes32[](1);
        proof0[0] = leaf1;
        proof1 = new bytes32[](1);
        proof1[0] = leaf0;
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    // ============ Phase 1: fresh deploy happy path ============

    /// @notice AUDIT-1 fix: full C10 deploy wires SOR as an off-circulation
    ///         holder, registers an operator, commits + finalizes a cells
    ///         report, and distributes an epoch that credits the shard share.
    function test_FreshDeploy_HappyPath_DistributesToShardShare() public {
        _fullDeploy();

        // AUDIT-1 fix: register SOR as off-circulation holder.
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(address(sor), true);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);
        ckb.setOffCirculationHolder(jcv, true);
        vm.stopPrank();

        assertTrue(ckb.isOffCirculationHolder(address(sor)), "SOR registered off-circ");
        assertEq(ckb.offCirculationHolderCount(), 4);

        // Register operator — stake moves into SOR, making it off-circulation.
        vm.prank(op1);
        sor.registerShard(keccak256("shard1"), STAKE);
        assertEq(ckb.balanceOf(address(sor)), STAKE, "SOR holds op stake");

        // Commit a cells report + finalize after the challenge window.
        vm.prank(op1);
        sor.commitCellsReport(100, bytes32(0));
        vm.warp(block.timestamp + sor.CHALLENGE_WINDOW() + 1);
        sor.finalizeCellsReport(keccak256("shard1"));
        assertEq(sor.getShard(keccak256("shard1")).cellsServed, 100);

        // Depositor parks into shelter to give daoShare a floor.
        vm.prank(depositor);
        shelter.deposit(1_000e18);

        // Distribute epoch.
        vm.warp(block.timestamp + 1 days);
        uint256 insBefore = ckb.balanceOf(insurance);
        issuance.distributeEpoch();

        // Shard got non-zero rewards — SOR is credited via accRewardPerShare.
        assertGt(sor.accRewardPerShare(), 0, "shardShare credited");
        // Insurance received the remainder.
        assertGt(ckb.balanceOf(insurance), insBefore, "insurance credited");
        // Some emission went to the shelter (DAO share pulled via depositYield).
        assertGt(ckb.balanceOf(address(shelter)), 1_000e18, "DAO yield received");

        // Operator pulls their rewards.
        uint256 op1Before = ckb.balanceOf(op1);
        vm.prank(op1);
        sor.claimRewards();
        assertGt(ckb.balanceOf(op1), op1Before, "operator rewards claimed");
    }

    // ============ Phase 2: upgrade-path / deploy-order hazards ============

    /// @notice AUDIT-1 fix: offCirculation() is a view over balanceOf, so it
    ///         accounts retroactively if SOR is registered AFTER stakes exist.
    function test_SorRegisteredAfterStake_AccountsRetroactively() public {
        _fullDeploy();

        // Stake BEFORE SOR is registered as off-circulation.
        vm.prank(op1);
        sor.registerShard(keccak256("shard-late"), STAKE);
        assertEq(ckb.balanceOf(address(sor)), STAKE);
        // offCirculation does NOT yet include stake.
        uint256 offBefore = ckb.offCirculation();
        assertEq(offBefore, 0, "stake invisible to offCirc pre-registration");

        // Now register SOR post-hoc.
        vm.prank(owner);
        ckb.setOffCirculationHolder(address(sor), true);

        // offCirculation now retroactively includes the operator's stake.
        assertEq(ckb.offCirculation(), STAKE, "stake accounted retroactively");
    }

    /// @notice AUDIT-1 fix (counterfactual): if SOR is NEVER registered,
    ///         operator stakes are counted as circulating and shard share is
    ///         systematically under-weighted at epoch distribution.
    function test_SorNotRegistered_ShardShareUnderWeighted() public {
        _fullDeploy();

        // Intentionally skip `ckb.setOffCirculationHolder(address(sor), true)`.

        vm.prank(op1);
        sor.registerShard(keccak256("shard-nocirc"), STAKE);
        vm.prank(op1);
        sor.commitCellsReport(100, bytes32(0));
        vm.warp(block.timestamp + sor.CHALLENGE_WINDOW() + 1);
        sor.finalizeCellsReport(keccak256("shard-nocirc"));

        // Observable assertion: offCirc does NOT reflect the staked tokens.
        assertEq(ckb.offCirculation(), 0, "SOR invisible -> offCirc=0");
        assertGt(ckb.balanceOf(address(sor)), 0, "but SOR holds real stake");

        // Distribute — shardShare falls to zero proportionally, so try/catch
        // forcefully routes the shardRegistry share to insurance via the
        // "No active shards" revert path (totalWeight==0 would trigger that,
        // but here we have weight). The substantive bug is that offCirc=0
        // means shardShare=0 since (emission * 0 / totalSupply) = 0.
        vm.warp(block.timestamp + 1 days);
        uint256 insBefore = ckb.balanceOf(insurance);
        issuance.distributeEpoch();

        // accRewardPerShare unchanged — no rewards flowed to SOR.
        assertEq(sor.accRewardPerShare(), 0, "shard share starved");
        // Insurance (or shelter) captured everything.
        assertGt(ckb.balanceOf(insurance), insBefore, "emission rerouted");
    }

    // ============ Phase 3: stale shard eviction ============

    /// @notice AUDIT-2 fix: anyone can deactivate a stale (non-heartbeating)
    ///         shard. Stake returns to the operator, weight removed from pool.
    function test_StaleShardEviction_PermissionlessReaping() public {
        _fullDeploy();

        // Register op1 and commit+finalize a report so weight > 0.
        vm.prank(op1);
        sor.registerShard(keccak256("shardA"), STAKE);
        vm.prank(op1);
        sor.commitCellsReport(100, bytes32(0));
        vm.warp(block.timestamp + sor.CHALLENGE_WINDOW() + 1);
        sor.finalizeCellsReport(keccak256("shardA"));

        uint256 weightBefore = sor.totalWeight();
        uint256 op1Before = ckb.balanceOf(op1);
        assertGt(weightBefore, 0, "weight present pre-eviction");

        // Let the shard go silent for past HEARTBEAT_GRACE (48h).
        vm.warp(block.timestamp + sor.HEARTBEAT_GRACE() + 1);

        // A random caller reaps it.
        vm.prank(op2);
        sor.deactivateStaleShard(keccak256("shardA"));

        // Stake returned to op1; weight zeroed; operator slot freed.
        assertEq(ckb.balanceOf(op1), op1Before + STAKE, "stake returned to operator");
        assertEq(sor.totalWeight(), 0, "weight removed from pool");
        assertFalse(sor.getShard(keccak256("shardA")).active);
        assertEq(sor.operatorShard(op1), bytes32(0), "op can re-register");
    }

    // ============ Phase 4: challenge-response flow ============

    /// @notice AUDIT-3 fix (happy path): operator commits report with merkle
    ///         root, challenger opens, operator refutes with valid proof,
    ///         challenger's bond is forfeited, finalize succeeds.
    function test_ChallengeHappyPath_OperatorRefutes_BondForfeit() public {
        _fullDeploy();

        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, bytes32[] memory proof0, ) = _build2LeafTree(cellA, cellB);

        // C11-AUDIT-14: materialize cellA/cellB as real cells in the vault
        // so the refute's cell-existence check passes.
        vault.createCell(cellA, 100e18, keccak256("content-A"));
        vault.createCell(cellB, 100e18, keccak256("content-B"));

        vm.prank(op1);
        sor.registerShard(keccak256("shard-chal"), STAKE);
        vm.prank(op1);
        sor.commitCellsReport(2, root);

        uint256 op1Before = ckb.balanceOf(op1);
        uint256 chalBefore = ckb.balanceOf(challenger);

        vm.prank(challenger);
        sor.challengeCellsReport(keccak256("shard-chal"), 0);

        // Challenger's bond moved into SOR custody.
        assertEq(ckb.balanceOf(challenger), chalBefore - sor.CHALLENGE_BOND());

        // Operator responds with valid proof.
        vm.prank(op1);
        sor.respondToChallenge(keccak256("shard-chal"), cellA, proof0);

        // Bond transferred to operator.
        assertEq(ckb.balanceOf(op1), op1Before + sor.CHALLENGE_BOND(), "bond forfeits to op");

        // Finalize after the original window succeeds.
        vm.warp(block.timestamp + sor.CHALLENGE_WINDOW() + 1);
        sor.finalizeCellsReport(keccak256("shard-chal"));
        assertEq(sor.getShard(keccak256("shard-chal")).cellsServed, 2, "report finalized");
    }

    /// @notice AUDIT-3 fix (slash path): operator fails to respond in the
    ///         response window, anyone triggers claimChallengeSlash,
    ///         operator's stake is slashed and paid (with bond) to challenger.
    function test_ChallengeSlashPath_OperatorSilent_StakeSlashed() public {
        _fullDeploy();

        bytes32 cellA = keccak256("cellA");
        bytes32 cellB = keccak256("cellB");
        (bytes32 root, , ) = _build2LeafTree(cellA, cellB);

        vm.prank(op1);
        sor.registerShard(keccak256("shard-slash"), STAKE);
        vm.prank(op1);
        sor.commitCellsReport(2, root);

        vm.prank(challenger);
        sor.challengeCellsReport(keccak256("shard-slash"), 0);

        uint256 chalBefore = ckb.balanceOf(challenger);
        uint256 expectedSlash = (STAKE * sor.CHALLENGE_SLASH_BPS()) / 10_000;

        // Operator ignores — response window elapses.
        vm.warp(block.timestamp + sor.CHALLENGE_RESPONSE_WINDOW() + 1);

        // Random caller (op2) triggers slash; proceeds go to challenger.
        vm.prank(op2);
        sor.claimChallengeSlash(keccak256("shard-slash"));

        // Operator's stake reduced.
        assertEq(sor.getShard(keccak256("shard-slash")).stake, STAKE - expectedSlash);
        // Challenger receives slash + original bond.
        assertEq(
            ckb.balanceOf(challenger),
            chalBefore + expectedSlash + sor.CHALLENGE_BOND()
        );
    }

    // ============ Phase 5: graceful DAOShelter fallback ============

    /// @notice C11-AUDIT-1 hardening of the AUDIT-4 silent-return path:
    ///         if a buggy/hostile shelter returns SUCCESSFULLY from depositYield
    ///         without pulling the approved tokens, halt the epoch rather than
    ///         silently rerouting. In normal operation totalDeposited()==0
    ///         implies daoShare==0 so depositYield is never called; reaching
    ///         this path means inconsistent shelter state and the safe response
    ///         is to revert so the operator can investigate.
    function test_DaoShelterSilentReturn_RevertsEpoch() public {
        _fullDeploy();

        // SOR registered so shardShare is nonzero and we still reach the
        // daoShare branch rather than short-circuiting earlier.
        vm.prank(owner);
        ckb.setOffCirculationHolder(address(sor), true);

        vm.prank(op1);
        sor.registerShard(keccak256("shard-gr"), STAKE);
        vm.prank(op1);
        sor.commitCellsReport(100, bytes32(0));
        vm.warp(block.timestamp + sor.CHALLENGE_WINDOW() + 1);
        sor.finalizeCellsReport(keccak256("shard-gr"));

        // Inflate totalDeposited() via mock so the controller computes a
        // non-zero daoShare. The real shelter slot is still 0, so the shelter's
        // actual depositYield hits its `if (totalDeposited == 0) return;` path
        // and silently returns without pulling. Under C11-AUDIT-1 the controller
        // treats that as a bug and reverts.
        assertEq(shelter.totalDeposited(), 0, "shelter has no depositors");
        vm.mockCall(
            address(shelter),
            abi.encodeWithSelector(IDAOShelterForIssuance.totalDeposited.selector),
            abi.encode(uint256(1_000e18))
        );

        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(SecondaryIssuanceController.ShelterShortPull.selector);
        issuance.distributeEpoch();

        vm.clearMockedCalls();
    }

    // ============ Phase 6: off-circulation double-count subtraction ============

    /// @notice AUDIT-5 fix: if DAOShelter is accidentally registered as
    ///         off-circulation, the controller detects the double-count at
    ///         distribute time and subtracts the shelter balance from offCirc
    ///         so insurance isn't starved of its slice.
    function test_DaoShelterDoubleRegistered_OffCircSubtracted() public {
        _fullDeploy();

        // Register SOR (correct) AND shelter (incorrect — test the guard).
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(address(sor), true);
        ckb.setOffCirculationHolder(address(shelter), true);
        vm.stopPrank();

        // Operator with stake, finalized report — shardShare non-zero.
        vm.prank(op1);
        sor.registerShard(keccak256("shard-dd"), STAKE);
        vm.prank(op1);
        sor.commitCellsReport(100, bytes32(0));
        vm.warp(block.timestamp + sor.CHALLENGE_WINDOW() + 1);
        sor.finalizeCellsReport(keccak256("shard-dd"));

        // Real depositor so shelter balance grows — the thing that would be
        // double-counted if AUDIT-5 weren't in place.
        vm.prank(depositor);
        shelter.deposit(5_000e18);

        assertTrue(ckb.isOffCirculationHolder(address(shelter)), "shelter mis-registered");

        // Distribute — the controller should detect shelter is in the registry
        // and subtract its balance from offCirc before computing shardShare.
        vm.warp(block.timestamp + 1 days);
        uint256 insBefore = ckb.balanceOf(insurance);
        issuance.distributeEpoch();

        // Insurance still receives a share — it wasn't zeroed by the double-count.
        assertGt(ckb.balanceOf(insurance), insBefore, "insurance not starved");
    }

    // ============ Phase 7: destroyCell access control ============

    /// @notice AUDIT-6 fix: only the cell's owner (the manager that created
    ///         it) can destroy it. A second registered cell manager cannot.
    function test_DestroyCell_OtherCellManagerRejected() public {
        _fullDeploy();

        // Authorize two cell managers. The CKB minter grants both tokens and
        // both have approved the vault.
        address mgrA = makeAddr("mgrA");
        address mgrB = makeAddr("mgrB");

        vm.prank(owner);
        vault.setCellManager(mgrA, true);
        vm.prank(owner);
        vault.setCellManager(mgrB, true);

        vm.prank(minter);
        ckb.mint(mgrA, 1_000e18);
        vm.prank(mgrA);
        ckb.approve(address(vault), type(uint256).max);

        // mgrA creates a cell.
        bytes32 cellId = keccak256("cellX");
        vm.prank(mgrA);
        vault.createCell(cellId, 500e18, keccak256("contentX"));

        // mgrB (a registered cell manager but NOT the owner) cannot destroy.
        vm.prank(mgrB);
        vm.expectRevert(StateRentVault.NotCellOwner.selector);
        vault.destroyCell(cellId);

        // mgrA can.
        vm.prank(mgrA);
        vault.destroyCell(cellId);
        assertFalse(vault.getCell(cellId).active, "destroyed by owner");
    }

    // ============ Phase 8: ownerCells swap-and-pop purge ============

    /// @notice AUDIT-8 fix: destroying a cell in the middle of ownerCells
    ///         swap-and-pops the array so it doesn't grow unboundedly.
    function test_DestroyCell_SwapAndPopsOwnerCells() public {
        _fullDeploy();

        address mgr = makeAddr("mgr");
        vm.prank(owner);
        vault.setCellManager(mgr, true);
        vm.prank(minter);
        ckb.mint(mgr, 3_000e18);
        vm.prank(mgr);
        ckb.approve(address(vault), type(uint256).max);

        bytes32 c1 = keccak256("c1");
        bytes32 c2 = keccak256("c2");
        bytes32 c3 = keccak256("c3");

        vm.startPrank(mgr);
        vault.createCell(c1, 100e18, keccak256("h1"));
        vault.createCell(c2, 100e18, keccak256("h2"));
        vault.createCell(c3, 100e18, keccak256("h3"));
        vm.stopPrank();

        assertEq(vault.getOwnerCellIds(mgr).length, 3, "3 cells present");

        // Destroy the middle one.
        vm.prank(mgr);
        vault.destroyCell(c2);

        bytes32[] memory remaining = vault.getOwnerCellIds(mgr);
        assertEq(remaining.length, 2, "swap-and-pop shrunk the array");

        // c2 is gone; c1 and c3 both present (order irrelevant after swap).
        bool hasC1;
        bool hasC3;
        for (uint256 i = 0; i < remaining.length; i++) {
            if (remaining[i] == c1) hasC1 = true;
            if (remaining[i] == c3) hasC3 = true;
            assertTrue(remaining[i] != c2, "c2 purged");
        }
        assertTrue(hasC1 && hasC3, "c1 and c3 remain");

        // cellCount updated too.
        assertEq(vault.cellCount(mgr), 2);
    }

    // ============ Phase 9: reportCellsServed nonReentrant ============

    /// @notice AUDIT-9 fix: commitCellsReport is nonReentrant. There is no
    ///         external callback surface inside commit that the operator
    ///         controls (it doesn't make an external call — it only writes
    ///         storage). So a reentrancy attack isn't naturally reachable
    ///         from the new flow. We document the invariant by asserting the
    ///         guard rejects a self-reentrant call. Since we cannot force a
    ///         reentry without a malicious callback surface on this path,
    ///         we prove the guard is live by sending a nested call via a
    ///         helper contract — or, lacking a surface, we verify the
    ///         PendingReportActive barrier (which also prevents stacking).
    function test_CommitCellsReport_NoReentrantStacking() public {
        _fullDeploy();

        vm.prank(op1);
        sor.registerShard(keccak256("shard-reent"), STAKE);

        vm.prank(op1);
        sor.commitCellsReport(50, bytes32(0));

        // Attempting to commit AGAIN (which would be the effect of a
        // successful reentry on the same frame) is rejected by the
        // PendingReportActive guard. nonReentrant is the belt; this check
        // is the suspenders.
        vm.prank(op1);
        vm.expectRevert(ShardOperatorRegistry.PendingReportActive.selector);
        sor.commitCellsReport(75, bytes32(0));
    }

    // ============ Phase 10: post-deploy invariants ============

    /// @notice Post-deploy invariants hold after full C10 deploy + admin
    ///         init: totalSupply = sum of known balances; offCirc includes
    ///         SOR stake; circulating + offCirc = totalSupply.
    function test_PostDeployInvariants_OffCircConsistency() public {
        _fullDeploy();

        vm.startPrank(owner);
        ckb.setOffCirculationHolder(address(sor), true);
        ckb.setOffCirculationHolder(nci, true);
        vm.stopPrank();

        vm.prank(op1);
        sor.registerShard(keccak256("shard-inv"), STAKE);

        // Move some tokens to nci to simulate staking.
        vm.prank(op1);
        ckb.transfer(nci, 1_000e18);

        // Invariant: offCirculation picks up BOTH sor and nci balances.
        uint256 expectedOff = ckb.balanceOf(address(sor)) + ckb.balanceOf(nci);
        assertEq(ckb.offCirculation(), expectedOff);

        // Invariant: circulating + offCirc == totalSupply.
        assertEq(ckb.circulatingSupply() + ckb.offCirculation(), ckb.totalSupply());
    }

    // ============ Phase 11: access control on new setters ============

    /// @notice Non-owner cannot register off-circulation holders.
    function test_NonOwnerCannotRegisterOffCircHolder() public {
        _fullDeploy();
        vm.prank(op1);
        vm.expectRevert();
        ckb.setOffCirculationHolder(address(sor), true);
    }

    /// @notice Non-owner cannot set issuance controller on SOR.
    function test_NonOwnerCannotSetIssuanceControllerOnSor() public {
        _fullDeploy();
        vm.prank(op1);
        vm.expectRevert();
        sor.setIssuanceController(address(0xdead));
    }
}
