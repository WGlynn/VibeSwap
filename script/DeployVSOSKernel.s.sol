// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/core/VSOSKernel.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployVSOSKernel
 * @notice Deploys VSOSKernel via UUPS proxy and registers the full VSOS service map.
 *
 * Service addresses use address(1)–address(N) as placeholders. Replace with
 * real deployment addresses before broadcasting to a live network.
 *
 * Usage:
 *   forge script script/DeployVSOSKernel.s.sol --rpc-url $RPC --broadcast
 *
 * Or dry-run (no broadcast):
 *   forge script script/DeployVSOSKernel.s.sol
 */
contract DeployVSOSKernel is Script {

    // ============ Placeholder Addresses ============
    // Replace each with the real deployed contract address before going live.

    // KERNEL (category 0)
    address constant COMMIT_REVEAL_AUCTION   = address(1);
    address constant VIBE_SWAP_CORE          = address(2);
    address constant CIRCUIT_BREAKER         = address(3);
    address constant ADAPTIVE_BATCH_TIMING   = address(4);

    // IDENTITY (category 1)
    address constant SOULBOUND_IDENTITY      = address(5);
    address constant CONTRIBUTION_DAG        = address(6);
    address constant POST_QUANTUM_SHIELD     = address(7);
    address constant AGENT_REGISTRY          = address(8);

    // SECURITY (category 2)
    address constant VIBE_PRIVACY_POOL       = address(9);
    address constant VIBE_ZK_VERIFIER        = address(10);
    address constant COMPLIANCE_REGISTRY     = address(11);
    address constant SHAPLEY_VERIFIER        = address(12);

    // NETWORKING (category 3)
    address constant CROSS_CHAIN_ROUTER      = address(13);
    address constant VIBE_NAME_SERVICE       = address(14);
    address constant VIBE_MESSENGER          = address(15);

    // STORAGE (category 4)
    address constant VIBE_CHECKPOINT_REGISTRY = address(16);
    address constant VIBE_STATE_CHAIN         = address(17);
    address constant VIBE_NAMES               = address(18);

    // RESOURCES (category 5)
    address constant SHAPLEY_DISTRIBUTOR     = address(19);
    address constant FRACTAL_SHAPLEY         = address(20);
    address constant EMISSION_CONTROLLER     = address(21);

    // PACKAGES (category 6)
    address constant VIBE_PLUGIN_REGISTRY    = address(22);
    address constant VIBE_HOOK_REGISTRY      = address(23);

    // ECONOMICS (category 7)
    address constant VIBE_AMM                = address(24);
    address constant TRUE_PRICE_ORACLE       = address(25);
    address constant DAO_TREASURY            = address(26);
    address constant IL_PROTECTION_VAULT     = address(27);

    // GOVERNANCE (category 8)
    address constant COMMIT_REVEAL_GOVERNANCE = address(28);
    address constant CONTRIBUTION_ATTESTOR    = address(29);
    address constant TREASURY_STABILIZER      = address(30);

    // ============ Run ============

    function run() external {
        vm.startBroadcast();

        // ── 1. Deploy implementation ──────────────────────────────────────
        VSOSKernel impl = new VSOSKernel();

        // ── 2. Deploy UUPS proxy, call initialize() ───────────────────────
        bytes memory initData = abi.encodeCall(VSOSKernel.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        VSOSKernel kernel = VSOSKernel(address(proxy));

        // ── 3. Register services ──────────────────────────────────────────

        // ---- KERNEL (0): Core execution layer ----
        kernel.registerService(
            "CommitRevealAuction",
            COMMIT_REVEAL_AUCTION,
            VSOSKernel.ServiceCategory.KERNEL,
            "1.0.0"
        );
        kernel.registerService(
            "VibeSwapCore",
            VIBE_SWAP_CORE,
            VSOSKernel.ServiceCategory.KERNEL,
            "1.0.0"
        );
        kernel.registerService(
            "CircuitBreaker",
            CIRCUIT_BREAKER,
            VSOSKernel.ServiceCategory.KERNEL,
            "1.0.0"
        );
        kernel.registerService(
            "AdaptiveBatchTiming",
            ADAPTIVE_BATCH_TIMING,
            VSOSKernel.ServiceCategory.KERNEL,
            "1.0.0"
        );

        // ---- IDENTITY (1): User accounts, auth, trust ----
        kernel.registerService(
            "SoulboundIdentity",
            SOULBOUND_IDENTITY,
            VSOSKernel.ServiceCategory.IDENTITY,
            "1.0.0"
        );
        kernel.registerService(
            "ContributionDAG",
            CONTRIBUTION_DAG,
            VSOSKernel.ServiceCategory.IDENTITY,
            "1.0.0"
        );
        kernel.registerService(
            "PostQuantumShield",
            POST_QUANTUM_SHIELD,
            VSOSKernel.ServiceCategory.IDENTITY,
            "1.0.0"
        );
        kernel.registerService(
            "AgentRegistry",
            AGENT_REGISTRY,
            VSOSKernel.ServiceCategory.IDENTITY,
            "1.0.0"
        );

        // ---- SECURITY (2): Privacy, ZK, compliance, fairness proofs ----
        kernel.registerService(
            "VibePrivacyPool",
            VIBE_PRIVACY_POOL,
            VSOSKernel.ServiceCategory.SECURITY,
            "1.0.0"
        );
        kernel.registerService(
            "VibeZKVerifier",
            VIBE_ZK_VERIFIER,
            VSOSKernel.ServiceCategory.SECURITY,
            "1.0.0"
        );
        kernel.registerService(
            "ComplianceRegistry",
            COMPLIANCE_REGISTRY,
            VSOSKernel.ServiceCategory.SECURITY,
            "1.0.0"
        );
        kernel.registerService(
            "ShapleyVerifier",
            SHAPLEY_VERIFIER,
            VSOSKernel.ServiceCategory.SECURITY,
            "1.0.0"
        );

        // ---- NETWORKING (3): Cross-chain, DNS, messaging ----
        kernel.registerService(
            "CrossChainRouter",
            CROSS_CHAIN_ROUTER,
            VSOSKernel.ServiceCategory.NETWORKING,
            "1.0.0"
        );
        kernel.registerService(
            "VibeNameService",
            VIBE_NAME_SERVICE,
            VSOSKernel.ServiceCategory.NETWORKING,
            "1.0.0"
        );
        kernel.registerService(
            "VibeMessenger",
            VIBE_MESSENGER,
            VSOSKernel.ServiceCategory.NETWORKING,
            "1.0.0"
        );

        // ---- STORAGE (4): Checkpoints, state chain, username registry ----
        kernel.registerService(
            "VibeCheckpointRegistry",
            VIBE_CHECKPOINT_REGISTRY,
            VSOSKernel.ServiceCategory.STORAGE,
            "1.0.0"
        );
        kernel.registerService(
            "VibeStateChain",
            VIBE_STATE_CHAIN,
            VSOSKernel.ServiceCategory.STORAGE,
            "1.0.0"
        );
        kernel.registerService(
            "VibeNames",
            VIBE_NAMES,
            VSOSKernel.ServiceCategory.STORAGE,
            "1.0.0"
        );

        // ---- RESOURCES (5): Fair scheduling, attribution, emissions ----
        kernel.registerService(
            "ShapleyDistributor",
            SHAPLEY_DISTRIBUTOR,
            VSOSKernel.ServiceCategory.RESOURCES,
            "1.0.0"
        );
        kernel.registerService(
            "FractalShapley",
            FRACTAL_SHAPLEY,
            VSOSKernel.ServiceCategory.RESOURCES,
            "1.0.0"
        );
        kernel.registerService(
            "EmissionController",
            EMISSION_CONTROLLER,
            VSOSKernel.ServiceCategory.RESOURCES,
            "1.0.0"
        );

        // ---- PACKAGES (6): Plugin registry, hook extensions ----
        kernel.registerService(
            "VibePluginRegistry",
            VIBE_PLUGIN_REGISTRY,
            VSOSKernel.ServiceCategory.PACKAGES,
            "1.0.0"
        );
        kernel.registerService(
            "VibeHookRegistry",
            VIBE_HOOK_REGISTRY,
            VSOSKernel.ServiceCategory.PACKAGES,
            "1.0.0"
        );

        // ---- ECONOMICS (7): AMM, oracle, treasury, insurance ----
        kernel.registerService(
            "VibeAMM",
            VIBE_AMM,
            VSOSKernel.ServiceCategory.ECONOMICS,
            "1.0.0"
        );
        kernel.registerService(
            "TruePriceOracle",
            TRUE_PRICE_ORACLE,
            VSOSKernel.ServiceCategory.ECONOMICS,
            "1.0.0"
        );
        kernel.registerService(
            "DAOTreasury",
            DAO_TREASURY,
            VSOSKernel.ServiceCategory.ECONOMICS,
            "1.0.0"
        );
        kernel.registerService(
            "ILProtectionVault",
            IL_PROTECTION_VAULT,
            VSOSKernel.ServiceCategory.ECONOMICS,
            "1.0.0"
        );

        // ---- GOVERNANCE (8): Voting, tribunal, treasury management ----
        kernel.registerService(
            "CommitRevealGovernance",
            COMMIT_REVEAL_GOVERNANCE,
            VSOSKernel.ServiceCategory.GOVERNANCE,
            "1.0.0"
        );
        kernel.registerService(
            "ContributionAttestor",
            CONTRIBUTION_ATTESTOR,
            VSOSKernel.ServiceCategory.GOVERNANCE,
            "1.0.0"
        );
        kernel.registerService(
            "TreasuryStabilizer",
            TREASURY_STABILIZER,
            VSOSKernel.ServiceCategory.GOVERNANCE,
            "1.0.0"
        );

        vm.stopBroadcast();

        // ── 4. Post-deploy summary ────────────────────────────────────────
        console.log("=== VSOSKernel Deployment Complete ===");
        console.log("Implementation : ", address(impl));
        console.log("Proxy (kernel) : ", address(proxy));
        console.log("Services registered: ", kernel.serviceCount());
    }
}
