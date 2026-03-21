// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/governance/GovernanceGuard.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DissolveCincinnatus
 * @notice Phase 2: Transfer ownership from deployer EOA to GovernanceGuard.
 *         After this script, no single human key controls any critical function.
 *         All changes require: propose → 48h delay → execute (vetoable by Shapley).
 *
 * @dev Run after all core contracts are deployed and working:
 *      forge script script/DissolveCincinnatus.s.sol --rpc-url $RPC_URL --broadcast
 *
 * PHASE 2a: Deploy GovernanceGuard + transfer CRITICAL tier contracts
 * PHASE 2b: Transfer HIGH + MEDIUM tier contracts (separate run with PHASE=2b)
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Current owner (Will's deployer key — used for the last time)
 *   - VETO_GUARDIAN: Address authorized to veto proposals (Shapley-backed multisig)
 *   - EMERGENCY_GUARDIAN: Address for fast-track emergency proposals
 *
 * Optional (for wiring existing contracts):
 *   - FEE_ROUTER: FeeRouter proxy address
 *   - BUYBACK_ENGINE: BuybackEngine proxy address
 *   - VIBE_SWAP_CORE: VibeSwapCore proxy address
 *   - SHAPLEY_DISTRIBUTOR: ShapleyDistributor proxy address
 *   - VIBE_AMM: VibeAMM proxy address
 *   - DAO_TREASURY: DAOTreasury proxy address
 *   - VIBE_TOKEN: VIBEToken proxy address
 *   - COMMIT_REVEAL_AUCTION: CommitRevealAuction proxy address
 *   - SHAPLEY_VERIFIER: ShapleyVerifier proxy address
 *   - TRUST_SCORE_VERIFIER: TrustScoreVerifier proxy address
 *   - VOTE_VERIFIER: VoteVerifier proxy address
 *
 * After running:
 *   - GovernanceGuard owns all transferred contracts
 *   - Will's key can still propose (as authorized proposer)
 *   - But cannot execute without 48h delay + surviving veto window
 *   - Shapley veto prevents governance capture (P-001)
 *
 * "I want nothing left but a holy ghost."
 */
contract DissolveCincinnatus is Script {
    GovernanceGuard public guard;
    address public guardProxy;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address vetoGuardian = vm.envAddress("VETO_GUARDIAN");
        address emergencyGuardian = vm.envAddress("EMERGENCY_GUARDIAN");

        console.log("=== CINCINNATUS DISSOLUTION - Phase 2 ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer (last use of this key for admin):", deployer);
        console.log("Veto Guardian (Shapley):", vetoGuardian);
        console.log("Emergency Guardian:", emergencyGuardian);
        console.log("");
        console.log("After this script, ALL admin functions require:");
        console.log("  1. Governance proposal");
        console.log("  2. 48-hour delay (6h emergency)");
        console.log("  3. Survive Shapley veto window");
        console.log("  4. Permissionless execution");
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ============ Step 1: Deploy GovernanceGuard ============

        console.log("Step 1: Deploying GovernanceGuard...");
        GovernanceGuard impl = new GovernanceGuard();
        bytes memory initData = abi.encodeWithSelector(
            GovernanceGuard.initialize.selector,
            deployer,           // Initial owner (transfers itself later)
            vetoGuardian,       // Shapley-backed veto
            emergencyGuardian   // Fast-track guardian
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        guard = GovernanceGuard(payable(address(proxy)));
        guardProxy = address(proxy);

        console.log("  GovernanceGuard impl:", address(impl));
        console.log("  GovernanceGuard proxy:", guardProxy);

        // Authorize deployer as proposer (can still propose, just can't execute instantly)
        guard.setProposer(deployer, true);
        console.log("  Deployer authorized as proposer");

        // ============ Step 2: Transfer Critical Contracts ============

        console.log("");
        console.log("Step 2: Transferring contract ownership to GovernanceGuard...");

        _tryTransfer("FEE_ROUTER");
        _tryTransfer("BUYBACK_ENGINE");
        _tryTransfer("VIBE_SWAP_CORE");
        _tryTransfer("SHAPLEY_DISTRIBUTOR");
        _tryTransfer("VIBE_AMM");
        _tryTransfer("DAO_TREASURY");
        _tryTransfer("VIBE_TOKEN");
        _tryTransfer("COMMIT_REVEAL_AUCTION");
        _tryTransfer("SHAPLEY_VERIFIER");
        _tryTransfer("TRUST_SCORE_VERIFIER");
        _tryTransfer("VOTE_VERIFIER");

        // ============ Step 3: Transfer GovernanceGuard ownership to itself ============

        console.log("");
        console.log("Step 3: GovernanceGuard takes ownership of itself...");
        guard.transferOwnership(guardProxy);
        console.log("  GovernanceGuard now owns itself");
        console.log("  Changing guardian/proposer roles now requires a proposal");

        vm.stopBroadcast();

        // ============ Verification ============

        _verify();
        _outputSummary(deployer);
    }

    function _tryTransfer(string memory envKey) internal {
        address target = vm.envOr(envKey, address(0));
        if (target == address(0)) {
            console.log("  SKIP:", envKey, "(not set)");
            return;
        }

        // Call transferOwnership on the target contract
        (bool ok, ) = target.call(
            abi.encodeWithSignature("transferOwnership(address)", guardProxy)
        );

        if (ok) {
            console.log("  OK:", envKey, "->", target);
            guard.acceptAdmin(target);
        } else {
            console.log("  FAIL:", envKey, "(check ownership)");
        }
    }

    function _verify() internal view {
        require(guardProxy.code.length > 0, "GovernanceGuard proxy has no code");
        require(guard.vetoGuardian() != address(0), "Veto guardian not set");
        require(guard.emergencyGuardian() != address(0), "Emergency guardian not set");

        console.log("");
        console.log("  Verification passed");
    }

    function _outputSummary(address deployer) internal view {
        console.log("");
        console.log("=== CINCINNATUS DISSOLUTION COMPLETE ===");
        console.log("");
        console.log("GovernanceGuard:");
        console.log("  GOVERNANCE_GUARD=", guardProxy);
        console.log("");
        console.log("Governance Flow:");
        console.log("  propose() -> 48h delay -> execute() [permissionless]");
        console.log("  veto() -> cancels proposal [Shapley guardian]");
        console.log("  proposeEmergency() -> 6h delay -> execute() [emergency guardian]");
        console.log("");
        console.log("What changed:");
        console.log("  BEFORE: Will's key could instantly call any admin function");
        console.log("  AFTER:  Will can only PROPOSE. 48h+ before execution.");
        console.log("          Shapley veto can cancel any proposal during the window.");
        console.log("          P-001 is now enforced at the execution layer.");
        console.log("");
        console.log("Will's key:", deployer);
        console.log("  - Can still PROPOSE governance actions");
        console.log("  - CANNOT execute without 48h delay");
        console.log("  - CANNOT override Shapley veto");
        console.log("  - CANNOT change GovernanceGuard config (it owns itself)");
        console.log("");
        console.log("The Cincinnatus Test: If Will disappeared tomorrow...");
        console.log("  - Emergency guardian can fast-track critical fixes (6h)");
        console.log("  - Any authorized proposer can submit governance actions");
        console.log("  - Shapley veto prevents capture - math governs, not men");
        console.log("  - Protocol continues operating permissionlessly");
        console.log("");
        console.log("// Copy to .env:");
        console.log(string(abi.encodePacked("GOVERNANCE_GUARD=", vm.toString(guardProxy))));
        console.log("============================================");
    }
}
