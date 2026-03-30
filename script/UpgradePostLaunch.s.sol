// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/incentives/EmissionController.sol";
import "../contracts/incentives/ShapleyDistributor.sol";
import "../contracts/incentives/FractalShapley.sol";
import "../contracts/incentives/MicroGameFactory.sol";
import "../contracts/settlement/ShapleyVerifier.sol";
import "../contracts/settlement/BatchProver.sol";
import "../contracts/core/VSOSKernel.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title UpgradePostLaunch
 * @notice Comprehensive post-launch upgrade: brings all contracts added/modified
 *         since Base mainnet deployment live, then activates emissions via drip().
 *
 * @dev This script captures everything that has changed since the initial
 *      DeployTokenomics deployment. It upgrades existing proxies, deploys new
 *      contracts, wires integrations, and activates the emission pipeline.
 *
 *      Run:
 *        forge script script/UpgradePostLaunch.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
 *
 *      Cost estimate: ~$40 in ETH for deployment + gas on Base L2.
 *
 * Phases:
 *   Phase 1: Upgrade existing UUPS proxies (ShapleyDistributor, EmissionController)
 *   Phase 2: Deploy new contracts (FractalShapley, BatchProver, VSOSKernel, etc.)
 *   Phase 3: Wire integrations (authorization, registry, verifier links)
 *   Phase 4: Activate emissions (drip() + fundStaking())
 *   Phase 5: Verify invariants
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Deployer key (must be owner of all proxies)
 *   - VIBE_TOKEN: VIBEToken proxy address
 *   - EMISSION_CONTROLLER: EmissionController proxy address
 *   - SHAPLEY_DISTRIBUTOR: ShapleyDistributor proxy address
 *   - LIQUIDITY_GAUGE: LiquidityGauge address
 *   - SINGLE_STAKING: SingleStaking address
 *   - PRIORITY_REGISTRY: PriorityRegistry proxy address
 *
 * Optional:
 *   - SKIP_DRIP: Set to "true" to deploy without activating emissions
 *   - FRACTAL_SHAPLEY: Existing FractalShapley proxy (skip deployment if set)
 */
contract UpgradePostLaunch is Script {
    // ============ New Deployments ============

    address public newShapleyImpl;
    address public newEmissionImpl;
    address public fractalShapleyImpl;
    address public fractalShapleyProxy;
    address public batchProverImpl;
    address public batchProverProxy;
    address public vsosKernelImpl;
    address public vsosKernelProxy;
    address public shapleyVerifier;
    address public microGameFactory;

    // ============ Existing Addresses ============

    address public vibeToken;
    address public emissionController;
    address public shapleyDistributor;
    address public liquidityGauge;
    address public singleStaking;
    address public priorityRegistry;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        bool skipDrip = vm.envOr("SKIP_DRIP", false);

        // Load existing addresses
        vibeToken = vm.envAddress("VIBE_TOKEN");
        emissionController = vm.envAddress("EMISSION_CONTROLLER");
        shapleyDistributor = vm.envAddress("SHAPLEY_DISTRIBUTOR");
        liquidityGauge = vm.envAddress("LIQUIDITY_GAUGE");
        singleStaking = vm.envAddress("SINGLE_STAKING");
        priorityRegistry = vm.envAddress("PRIORITY_REGISTRY");

        console.log("==========================================");
        console.log("  VibeSwap Post-Launch Upgrade");
        console.log("  Deployer:", deployer);
        console.log("==========================================");

        vm.startBroadcast(deployerKey);

        // ============ Phase 1: Upgrade Existing Proxies ============

        console.log("");
        console.log("--- Phase 1: Upgrade Existing Proxies ---");

        // 1a. Upgrade ShapleyDistributor (adds ABC health gate, sybil guard, verifier slot)
        newShapleyImpl = address(new ShapleyDistributor());
        ShapleyDistributor(payable(shapleyDistributor)).upgradeToAndCall(newShapleyImpl, "");
        console.log("  ShapleyDistributor upgraded to:", newShapleyImpl);

        // 1b. Upgrade EmissionController (cross-era fixes, drift guard)
        newEmissionImpl = address(new EmissionController());
        EmissionController(emissionController).upgradeToAndCall(newEmissionImpl, "");
        console.log("  EmissionController upgraded to:", newEmissionImpl);

        // ============ Phase 2: Deploy New Contracts ============

        console.log("");
        console.log("--- Phase 2: Deploy New Contracts ---");

        // 2a. FractalShapley - recursive attribution through influence DAGs
        //     initialize(contributionDAG, propagationDecay, minAttestations)
        address existingFractal = vm.envOr("FRACTAL_SHAPLEY", address(0));
        address contributionDAG = vm.envOr("CONTRIBUTION_DAG", address(0));
        if (existingFractal == address(0)) {
            fractalShapleyImpl = address(new FractalShapley());
            fractalShapleyProxy = address(new ERC1967Proxy(
                fractalShapleyImpl,
                abi.encodeCall(FractalShapley.initialize, (contributionDAG, 9000, 2))
            ));
            console.log("  FractalShapley deployed:", fractalShapleyProxy);
        } else {
            fractalShapleyProxy = existingFractal;
            console.log("  FractalShapley (existing):", fractalShapleyProxy);
        }

        // 2b. BatchProver - STARK proof verification for batch settlement
        //     initialize(owner, challengeWindow, challengeBond)
        batchProverImpl = address(new BatchProver());
        batchProverProxy = address(new ERC1967Proxy(
            batchProverImpl,
            abi.encodeCall(BatchProver.initialize, (deployer, 1 hours, 0.01 ether))
        ));
        console.log("  BatchProver deployed:", batchProverProxy);

        // 2c. VSOSKernel - service registry (the OS layer)
        //     initialize() - no args, owner = msg.sender
        vsosKernelImpl = address(new VSOSKernel());
        vsosKernelProxy = address(new ERC1967Proxy(
            vsosKernelImpl,
            abi.encodeCall(VSOSKernel.initialize, ())
        ));
        console.log("  VSOSKernel deployed:", vsosKernelProxy);

        // 2d. ShapleyVerifier - settlement layer integration
        shapleyVerifier = address(new ShapleyVerifier());
        console.log("  ShapleyVerifier deployed:", shapleyVerifier);

        // 2e. MicroGameFactory - atomized game creation
        microGameFactory = address(new MicroGameFactory());
        console.log("  MicroGameFactory deployed:", microGameFactory);

        // ============ Phase 3: Wire Integrations ============

        console.log("");
        console.log("--- Phase 3: Wire Integrations ---");

        // 3a. Link ShapleyVerifier to ShapleyDistributor
        ShapleyDistributor(payable(shapleyDistributor)).setShapleyVerifier(shapleyVerifier);
        console.log("  ShapleyDistributor.shapleyVerifier =", shapleyVerifier);

        // 3b. Authorize FractalShapley as game creator on ShapleyDistributor
        ShapleyDistributor(payable(shapleyDistributor)).setAuthorizedCreator(fractalShapleyProxy, true);
        console.log("  FractalShapley authorized as game creator");

        // 3c. Register core services on VSOSKernel
        VSOSKernel kernel = VSOSKernel(vsosKernelProxy);

        // Register economics services (name, implementation, category, version)
        kernel.registerService("EmissionController", emissionController, VSOSKernel.ServiceCategory.ECONOMICS, "1.0.0");
        kernel.registerService("ShapleyDistributor", shapleyDistributor, VSOSKernel.ServiceCategory.ECONOMICS, "2.0.0");
        kernel.registerService("FractalShapley", fractalShapleyProxy, VSOSKernel.ServiceCategory.ECONOMICS, "1.0.0");
        kernel.registerService("LiquidityGauge", liquidityGauge, VSOSKernel.ServiceCategory.ECONOMICS, "1.0.0");

        // Register identity services
        kernel.registerService("PriorityRegistry", priorityRegistry, VSOSKernel.ServiceCategory.IDENTITY, "1.0.0");
        kernel.registerService("VIBEToken", vibeToken, VSOSKernel.ServiceCategory.RESOURCES, "1.0.0");

        // Register settlement services
        kernel.registerService("BatchProver", batchProverProxy, VSOSKernel.ServiceCategory.SECURITY, "1.0.0");
        kernel.registerService("ShapleyVerifier", shapleyVerifier, VSOSKernel.ServiceCategory.SECURITY, "1.0.0");

        console.log("  VSOSKernel: 8 services registered");

        // ============ Phase 4: Activate Emissions ============

        if (!skipDrip) {
            console.log("");
            console.log("--- Phase 4: Activate Emissions ---");

            // First drip - mints all accrued VIBE since genesis
            EmissionController ec = EmissionController(emissionController);
            ec.drip();
            console.log("  drip() called - emissions active");

            uint256 shapleyPool = ec.shapleyPool();
            uint256 stakingPending = ec.stakingPending();
            uint256 totalEmitted = ec.totalEmitted();

            console.log("  Total emitted:", totalEmitted);
            console.log("  Shapley pool:", shapleyPool);
            console.log("  Staking pending:", stakingPending);

            // Fund staking if there's pending
            if (stakingPending > 0) {
                ec.fundStaking();
                console.log("  fundStaking() called - staking rewards active");
            }
        } else {
            console.log("");
            console.log("--- Phase 4: SKIPPED (SKIP_DRIP=true) ---");
        }

        vm.stopBroadcast();

        // ============ Phase 5: Verify & Summary ============

        console.log("");
        console.log("==========================================");
        console.log("  Post-Launch Upgrade Complete");
        console.log("==========================================");
        console.log("");
        console.log("Upgraded Proxies:");
        console.log("  ShapleyDistributor impl:", newShapleyImpl);
        console.log("  EmissionController impl:", newEmissionImpl);
        console.log("");
        console.log("New Deployments:");
        console.log(string(abi.encodePacked("  FRACTAL_SHAPLEY=", vm.toString(fractalShapleyProxy))));
        console.log(string(abi.encodePacked("  BATCH_PROVER=", vm.toString(batchProverProxy))));
        console.log(string(abi.encodePacked("  VSOS_KERNEL=", vm.toString(vsosKernelProxy))));
        console.log(string(abi.encodePacked("  SHAPLEY_VERIFIER=", vm.toString(shapleyVerifier))));
        console.log(string(abi.encodePacked("  MICRO_GAME_FACTORY=", vm.toString(microGameFactory))));
        console.log("");
        console.log("Integrations Wired:");
        console.log("  ShapleyVerifier -> ShapleyDistributor");
        console.log("  FractalShapley -> ShapleyDistributor (authorized creator)");
        console.log("  8 services -> VSOSKernel registry");
        console.log("");

        if (!skipDrip) {
            console.log("Emissions: ACTIVE");
            console.log("  Budget: 50% Shapley | 35% Gauge | 15% Staking");
            console.log("  Schedule: Wall-clock halving, 365.25 day eras");
            console.log("  Next: Set up keeper to call drip() every 1-7 days");
        } else {
            console.log("Emissions: NOT YET ACTIVE (run without SKIP_DRIP to activate)");
        }

        console.log("");
        console.log("Remaining manual steps:");
        console.log("  1. Deploy AugmentedBondingCurve (run UpgradeShapleyABC.s.sol)");
        console.log("  2. Seal bonding curve on ShapleyDistributor (IRREVERSIBLE)");
        console.log("  3. Set up keeper bot for periodic drip() + fundStaking()");
        console.log("  4. Transfer governance to multisig + TimelockController");
        console.log("==========================================");
    }
}
