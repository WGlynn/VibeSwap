// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/mechanism/IntelligenceExchange.sol";
import "../contracts/mechanism/CognitiveConsensusMarket.sol";
import "../contracts/mechanism/SIEShapleyAdapter.sol";
import "../contracts/mechanism/SIEPermissionlessLaunch.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeploySIE — Deploy the Sovereign Intelligence Exchange (Phase 1 + Phase 2)
 * @notice Deploys the full SIE stack:
 *         1. IntelligenceExchange (UUPS proxy) — SIE orchestrator
 *         2. CognitiveConsensusMarket — CRPC evaluation market
 *         3. SIEShapleyAdapter (UUPS proxy) — Phase 2 bridge to ShapleyDistributor
 *         4. SIEPermissionlessLaunch — Cincinnatus factory
 *
 * @dev Usage:
 *   forge script script/DeploySIE.s.sol --rpc-url $RPC --broadcast
 *
 *   Required env vars:
 *     PRIVATE_KEY              — deployer private key
 *     VIBE_TOKEN               — address of deployed VIBE token
 *
 *   Optional env vars:
 *     JARVIS_SHARD             — address authorized to submit knowledge epochs
 *     SHAPLEY_DISTRIBUTOR      — ShapleyDistributor proxy (from DeployTokenomics, for Phase 2 wiring)
 *     SHAPLEY_VERIFIER         — ShapleyVerifier proxy (from DeploySettlement, for Phase 2 wiring)
 */
contract DeploySIE is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address vibeToken = vm.envAddress("VIBE_TOKEN");

        // Optional dependencies
        address jarvisShard = vm.envOr("JARVIS_SHARD", address(0));
        address shapleyDistributor = vm.envOr("SHAPLEY_DISTRIBUTOR", address(0));
        address shapleyVerifier = vm.envOr("SHAPLEY_VERIFIER", address(0));

        console.log("=== Sovereign Intelligence Exchange Deployment ===");
        console.log("Deployer:", deployer);
        console.log("VIBE Token:", vibeToken);
        console.log("Jarvis Shard:", jarvisShard);
        if (shapleyDistributor != address(0)) {
            console.log("ShapleyDistributor:", shapleyDistributor);
        }
        if (shapleyVerifier != address(0)) {
            console.log("ShapleyVerifier:", shapleyVerifier);
        }
        console.log("");

        vm.startBroadcast(deployerKey);

        // ============ 1. IntelligenceExchange (UUPS Proxy) ============

        console.log("Step 1: Deploying IntelligenceExchange...");
        IntelligenceExchange sieImpl = new IntelligenceExchange();
        console.log("  Implementation:", address(sieImpl));

        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize,
            (vibeToken, deployer)
        );
        ERC1967Proxy sieProxy = new ERC1967Proxy(address(sieImpl), initData);
        IntelligenceExchange sie = IntelligenceExchange(payable(address(sieProxy)));
        console.log("  Proxy (SIE):", address(sieProxy));

        // Verify P-001
        require(sie.PROTOCOL_FEE_BPS() == 0, "P-001 VIOLATION: protocol fee must be zero");
        console.log("  P-001 verified: 0% protocol fee");

        // Authorize Jarvis shard for epoch anchoring
        if (jarvisShard != address(0)) {
            sie.addEpochSubmitter(jarvisShard);
            console.log("  Epoch submitter authorized:", jarvisShard);
        }

        // ============ 2. CognitiveConsensusMarket ============

        console.log("Step 2: Deploying CognitiveConsensusMarket...");
        CognitiveConsensusMarket ccm = new CognitiveConsensusMarket(vibeToken);
        console.log("  CognitiveConsensusMarket:", address(ccm));

        // Wire SIE <-> CCM
        sie.setCognitiveConsensusMarket(address(ccm));
        console.log("  SIE wired to CCM");

        // ============ 3. SIEShapleyAdapter (UUPS Proxy — Phase 2) ============

        address sieShapleyAdapter;
        if (shapleyDistributor != address(0)) {
            console.log("Step 3: Deploying SIEShapleyAdapter (Phase 2)...");
            SIEShapleyAdapter adapterImpl = new SIEShapleyAdapter();
            console.log("  Implementation:", address(adapterImpl));

            bytes memory adapterInit = abi.encodeCall(
                SIEShapleyAdapter.initialize,
                (
                    address(sieProxy),      // intelligenceExchange
                    shapleyDistributor,     // shapleyDistributor
                    shapleyVerifier,        // shapleyVerifier (can be address(0))
                    deployer                // owner
                )
            );
            ERC1967Proxy adapterProxy = new ERC1967Proxy(address(adapterImpl), adapterInit);
            sieShapleyAdapter = address(adapterProxy);
            console.log("  Proxy (SIEShapleyAdapter):", sieShapleyAdapter);

            // Set VIBE token on adapter
            SIEShapleyAdapter(payable(sieShapleyAdapter)).setVibeToken(vibeToken);
            console.log("  SIEShapleyAdapter.setVibeToken set");

            // Wire SIE -> Adapter (SIE calls adapter.onSettlement on each evaluation)
            sie.setShapleyAdapter(sieShapleyAdapter);
            console.log("  SIE.setShapleyAdapter -> SIEShapleyAdapter");

            // Verify wiring
            require(sie.shapleyAdapter() == sieShapleyAdapter, "SIE adapter wiring failed");
            require(
                SIEShapleyAdapter(payable(sieShapleyAdapter)).intelligenceExchange() == address(sieProxy),
                "Adapter SIE reference mismatch"
            );
            require(
                SIEShapleyAdapter(payable(sieShapleyAdapter)).shapleyDistributor() == shapleyDistributor,
                "Adapter ShapleyDistributor reference mismatch"
            );
            console.log("  Phase 2 wiring verified: SIE -> Adapter -> ShapleyDistributor");
        } else {
            console.log("Step 3: SKIP SIEShapleyAdapter (SHAPLEY_DISTRIBUTOR not provided)");
            console.log("  Wire later: set SHAPLEY_DISTRIBUTOR env and re-run, or deploy manually");
        }

        // ============ 4. SIEPermissionlessLaunch (Cincinnatus Factory) ============

        console.log("Step 4: Deploying SIEPermissionlessLaunch...");
        SIEPermissionlessLaunch launcher = new SIEPermissionlessLaunch();
        console.log("  SIEPermissionlessLaunch:", address(launcher));

        // ============ Verification ============

        console.log("");
        console.log("=== Verification ===");
        require(address(sie.vibeToken()) == vibeToken, "VIBE token mismatch");
        require(sie.assetCount() == 0, "Asset count should be 0");
        require(sie.epochCount() == 0, "Epoch count should be 0");
        require(sie.cognitiveConsensusMarket() == address(ccm), "CCM not wired");
        console.log("  All verifications passed");

        vm.stopBroadcast();

        // ============ Summary ============

        console.log("");
        console.log("=== SIE Stack Deployed Successfully ===");
        console.log("");
        console.log("Core:");
        console.log("  INTELLIGENCE_EXCHANGE=", address(sieProxy));
        console.log("  COGNITIVE_CONSENSUS_MARKET=", address(ccm));
        console.log("");
        console.log("Phase 2 (Shapley Bridge):");
        if (sieShapleyAdapter != address(0)) {
            console.log("  SIE_SHAPLEY_ADAPTER=", sieShapleyAdapter);
            console.log("  Wiring: SIE -> Adapter -> ShapleyDistributor (ACTIVE)");
        } else {
            console.log("  SIE_SHAPLEY_ADAPTER= NOT DEPLOYED (needs SHAPLEY_DISTRIBUTOR)");
        }
        console.log("");
        console.log("Factory:");
        console.log("  SIE_PERMISSIONLESS_LAUNCH=", address(launcher));
        console.log("");
        console.log("POST-DEPLOY:");
        console.log("  1. Set INTELLIGENCE_EXCHANGE in Jarvis .env");
        console.log("  2. Set COGNITIVE_CONSENSUS_MARKET in Jarvis .env");
        if (sieShapleyAdapter == address(0)) {
            console.log("  3. Deploy SIEShapleyAdapter: set SHAPLEY_DISTRIBUTOR and re-run");
        } else {
            console.log("  3. Authorize SIEShapleyAdapter as creator on ShapleyDistributor");
            console.log("     ShapleyDistributor.setAuthorizedCreator(SIE_SHAPLEY_ADAPTER, true)");
            console.log("  4. Fund SIEShapleyAdapter with VIBE for true-up rounds");
        }
        console.log("Nothing is promised. Everything is earned.");
    }
}

/**
 * @title DeploySIEPhase2Only
 * @notice Deploy SIEShapleyAdapter against an existing SIE deployment.
 *         Use this when SIE was deployed first (Phase 1) and ShapleyDistributor
 *         is now available for Phase 2 wiring.
 *
 * @dev Usage:
 *   forge script script/DeploySIE.s.sol:DeploySIEPhase2Only --rpc-url $RPC --broadcast
 *
 *   Required env vars:
 *     PRIVATE_KEY              — deployer private key
 *     INTELLIGENCE_EXCHANGE    — existing SIE proxy address
 *     SHAPLEY_DISTRIBUTOR      — ShapleyDistributor proxy address
 *     VIBE_TOKEN               — VIBE token address
 *
 *   Optional env vars:
 *     SHAPLEY_VERIFIER         — ShapleyVerifier proxy address
 */
contract DeploySIEPhase2Only is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address sieAddress = vm.envAddress("INTELLIGENCE_EXCHANGE");
        address shapleyDistributor = vm.envAddress("SHAPLEY_DISTRIBUTOR");
        address vibeToken = vm.envAddress("VIBE_TOKEN");
        address shapleyVerifier = vm.envOr("SHAPLEY_VERIFIER", address(0));

        console.log("=== SIE Phase 2: SIEShapleyAdapter Deployment ===");
        console.log("Deployer:", deployer);
        console.log("SIE:", sieAddress);
        console.log("ShapleyDistributor:", shapleyDistributor);
        console.log("VIBE Token:", vibeToken);
        console.log("");

        vm.startBroadcast(deployerKey);

        // ============ Deploy SIEShapleyAdapter (UUPS Proxy) ============

        SIEShapleyAdapter adapterImpl = new SIEShapleyAdapter();
        console.log("SIEShapleyAdapter impl:", address(adapterImpl));

        bytes memory adapterInit = abi.encodeCall(
            SIEShapleyAdapter.initialize,
            (sieAddress, shapleyDistributor, shapleyVerifier, deployer)
        );
        ERC1967Proxy adapterProxy = new ERC1967Proxy(address(adapterImpl), adapterInit);
        address adapter = address(adapterProxy);
        console.log("SIEShapleyAdapter proxy:", adapter);

        // Set VIBE token
        SIEShapleyAdapter(payable(adapter)).setVibeToken(vibeToken);
        console.log("  setVibeToken:", vibeToken);

        // Wire SIE -> Adapter
        IntelligenceExchange sie = IntelligenceExchange(payable(sieAddress));
        sie.setShapleyAdapter(adapter);
        console.log("  SIE.setShapleyAdapter -> Adapter");

        // ============ Verify ============

        require(sie.shapleyAdapter() == adapter, "SIE adapter wiring failed");
        require(
            SIEShapleyAdapter(payable(adapter)).intelligenceExchange() == sieAddress,
            "Adapter SIE reference mismatch"
        );
        require(
            SIEShapleyAdapter(payable(adapter)).shapleyDistributor() == shapleyDistributor,
            "Adapter ShapleyDistributor mismatch"
        );
        console.log("  Wiring verified: SIE -> Adapter -> ShapleyDistributor");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Phase 2 Deployed ===");
        console.log("SIE_SHAPLEY_ADAPTER=", adapter);
        console.log("");
        console.log("POST-DEPLOY:");
        console.log("  1. ShapleyDistributor.setAuthorizedCreator(SIE_SHAPLEY_ADAPTER, true)");
        console.log("  2. Fund SIEShapleyAdapter with VIBE for true-up rounds");
        console.log("  3. Call executeTrueUp() periodically via keeper");
    }
}
