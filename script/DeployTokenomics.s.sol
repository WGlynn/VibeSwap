// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/monetary/VIBEToken.sol";
import "../contracts/monetary/Joule.sol";
import "../contracts/incentives/EmissionController.sol";
import "../contracts/incentives/ShapleyDistributor.sol";
import "../contracts/incentives/LiquidityGauge.sol";
import "../contracts/incentives/SingleStaking.sol";
import "../contracts/incentives/PriorityRegistry.sol";
import "../contracts/amm/VibeAMM.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployTokenomics
 * @notice Deploys the complete VIBE emission and reward system
 * @dev Run after DeployProduction.s.sol:
 *      forge script script/DeployTokenomics.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * Deploys (in order):
 *   1. VIBEToken (UUPS proxy) — 21M hard cap, zero pre-mine
 *   2. Joule (constructor) — PoW-mined elastic token
 *   3. ShapleyDistributor (UUPS proxy) — cooperative game theory rewards
 *   4. PriorityRegistry (UUPS proxy) — pioneer bonus tracking
 *   5. LiquidityGauge (constructor) — Curve-style LP staking
 *   6. SingleStaking (constructor) — governance staking (stake JUL, earn VIBE)
 *   7. EmissionController (UUPS proxy) — wall-clock emission with accumulation pool
 *
 * Post-deploy wiring:
 *   - VIBEToken.setMinter(emissionController, true)
 *   - ShapleyDistributor.setAuthorizedCreator(emissionController, true)
 *   - ShapleyDistributor.setPriorityRegistry(priorityRegistry)
 *   - SingleStaking ownership → EmissionController (required for notifyRewardAmount)
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Deployer private key
 *   - VIBESWAP_CORE: VibeSwapCore proxy address (from DeployProduction)
 *
 * Optional environment variables:
 *   - OWNER_ADDRESS: Override owner (defaults to deployer)
 *   - KEEPER_ADDRESS: Authorized drainer bot for automated emission games
 *   - GAUGE_EMISSION_RATE: LiquidityGauge emission rate (default: 1e18 per epoch)
 *   - GAUGE_EPOCH_DURATION: LiquidityGauge epoch length (default: 7 days)
 */
contract DeployTokenomics is Script {
    // ============ Deployed Addresses ============

    // UUPS implementations
    address public vibeTokenImpl;
    address public shapleyImpl;
    address public priorityRegistryImpl;
    address public emissionControllerImpl;

    // Proxies (use these addresses)
    address public vibeToken;
    address public shapley;
    address public priorityRegistry;
    address public emissionController;

    // Non-upgradeable
    address public joule;
    address public liquidityGauge;
    address public singleStaking;

    // Configuration
    address public owner;
    address public vibeSwapCore;
    address public keeper;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        owner = vm.envOr("OWNER_ADDRESS", deployer);
        vibeSwapCore = vm.envOr("VIBESWAP_CORE", address(0));
        keeper = vm.envOr("KEEPER_ADDRESS", address(0));

        uint256 gaugeEmissionRate = vm.envOr("GAUGE_EMISSION_RATE", uint256(1e18));
        uint256 gaugeEpochDuration = vm.envOr("GAUGE_EPOCH_DURATION", uint256(7 days));

        console.log("=== VibeSwap Tokenomics Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Owner:", owner);
        if (vibeSwapCore != address(0)) {
            console.log("VibeSwapCore:", vibeSwapCore);
        }
        if (keeper != address(0)) {
            console.log("Keeper:", keeper);
        }
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy UUPS implementations
        console.log("Step 1: Deploying implementations...");
        vibeTokenImpl = address(new VIBEToken());
        shapleyImpl = address(new ShapleyDistributor());
        priorityRegistryImpl = address(new PriorityRegistry());
        emissionControllerImpl = address(new EmissionController());
        console.log("  VIBEToken impl:", vibeTokenImpl);
        console.log("  ShapleyDistributor impl:", shapleyImpl);
        console.log("  PriorityRegistry impl:", priorityRegistryImpl);
        console.log("  EmissionController impl:", emissionControllerImpl);

        // Step 2: Deploy VIBEToken proxy
        console.log("Step 2: Deploying VIBEToken proxy...");
        bytes memory vibeInit = abi.encodeWithSelector(
            VIBEToken.initialize.selector,
            owner
        );
        vibeToken = address(new ERC1967Proxy(vibeTokenImpl, vibeInit));
        console.log("  VIBEToken proxy:", vibeToken);

        // Step 3: Deploy Joule (non-upgradeable)
        console.log("Step 3: Deploying Joule...");
        joule = address(new Joule(owner));
        console.log("  Joule:", joule);

        // Step 4: Deploy ShapleyDistributor proxy
        console.log("Step 4: Deploying ShapleyDistributor proxy...");
        bytes memory shapleyInit = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        shapley = address(new ERC1967Proxy(shapleyImpl, shapleyInit));
        console.log("  ShapleyDistributor proxy:", shapley);

        // Step 5: Deploy PriorityRegistry proxy
        console.log("Step 5: Deploying PriorityRegistry proxy...");
        bytes memory priorityInit = abi.encodeWithSelector(
            PriorityRegistry.initialize.selector,
            owner
        );
        priorityRegistry = address(new ERC1967Proxy(priorityRegistryImpl, priorityInit));
        console.log("  PriorityRegistry proxy:", priorityRegistry);

        // Step 6: Deploy LiquidityGauge (non-upgradeable)
        console.log("Step 6: Deploying LiquidityGauge...");
        liquidityGauge = address(new LiquidityGauge(
            vibeToken,
            gaugeEmissionRate,
            gaugeEpochDuration
        ));
        console.log("  LiquidityGauge:", liquidityGauge);

        // Step 7: Deploy SingleStaking (non-upgradeable)
        // Stake JUL, earn VIBE
        console.log("Step 7: Deploying SingleStaking...");
        singleStaking = address(new SingleStaking(
            joule,      // stakingToken = JUL
            vibeToken   // rewardToken = VIBE
        ));
        console.log("  SingleStaking:", singleStaking);

        // Step 8: Deploy EmissionController proxy
        console.log("Step 8: Deploying EmissionController proxy...");
        bytes memory emissionInit = abi.encodeWithSelector(
            EmissionController.initialize.selector,
            owner,
            vibeToken,
            shapley,
            liquidityGauge,
            singleStaking
        );
        emissionController = address(new ERC1967Proxy(emissionControllerImpl, emissionInit));
        console.log("  EmissionController proxy:", emissionController);

        // Step 9: Post-deployment wiring
        console.log("Step 9: Configuring authorizations...");
        _configureAuthorizations();

        // Step 10: Verification
        console.log("Step 10: Running verification...");
        _verifyDeployment();

        vm.stopBroadcast();

        _outputSummary();
    }

    function _configureAuthorizations() internal {
        // VIBEToken: authorize EmissionController as minter
        VIBEToken(vibeToken).setMinter(emissionController, true);
        console.log("  VIBEToken: EmissionController authorized as minter");

        // ShapleyDistributor: authorize EmissionController as game creator
        ShapleyDistributor(payable(shapley)).setAuthorizedCreator(emissionController, true);
        console.log("  ShapleyDistributor: EmissionController authorized as creator");

        // ShapleyDistributor: authorize VibeSwapCore as game creator (batch fee distribution)
        if (vibeSwapCore != address(0)) {
            ShapleyDistributor(payable(shapley)).setAuthorizedCreator(vibeSwapCore, true);
            console.log("  ShapleyDistributor: VibeSwapCore authorized as creator");
        }

        // ShapleyDistributor: link PriorityRegistry for pioneer bonus
        ShapleyDistributor(payable(shapley)).setPriorityRegistry(priorityRegistry);
        console.log("  ShapleyDistributor: PriorityRegistry linked");

        // SingleStaking: transfer ownership to EmissionController
        // EmissionController calls notifyRewardAmount() which is onlyOwner
        SingleStaking(singleStaking).transferOwnership(emissionController);
        console.log("  SingleStaking: ownership transferred to EmissionController");

        // EmissionController: authorize keeper as drainer (if provided)
        if (keeper != address(0)) {
            EmissionController(emissionController).setAuthorizedDrainer(keeper, true);
            console.log("  EmissionController: Keeper authorized as drainer:", keeper);
        }

        // EmissionController: authorize owner as drainer (for manual games)
        EmissionController(emissionController).setAuthorizedDrainer(owner, true);
        console.log("  EmissionController: Owner authorized as drainer");
    }

    function _verifyDeployment() internal view {
        // Verify implementations have code
        require(vibeTokenImpl.code.length > 0, "VIBEToken impl has no code");
        require(shapleyImpl.code.length > 0, "Shapley impl has no code");
        require(priorityRegistryImpl.code.length > 0, "PriorityRegistry impl has no code");
        require(emissionControllerImpl.code.length > 0, "EmissionController impl has no code");

        // Verify proxies have code
        require(vibeToken.code.length > 0, "VIBEToken proxy has no code");
        require(shapley.code.length > 0, "Shapley proxy has no code");
        require(priorityRegistry.code.length > 0, "PriorityRegistry proxy has no code");
        require(emissionController.code.length > 0, "EmissionController proxy has no code");

        // Verify non-upgradeable contracts
        require(joule.code.length > 0, "Joule has no code");
        require(liquidityGauge.code.length > 0, "LiquidityGauge has no code");
        require(singleStaking.code.length > 0, "SingleStaking has no code");

        // Verify ownership
        require(VIBEToken(vibeToken).owner() == owner, "VIBEToken owner mismatch");
        require(ShapleyDistributor(payable(shapley)).owner() == owner, "Shapley owner mismatch");
        require(PriorityRegistry(priorityRegistry).owner() == owner, "PriorityRegistry owner mismatch");
        require(EmissionController(emissionController).owner() == owner, "EmissionController owner mismatch");

        // Verify critical authorizations
        require(VIBEToken(vibeToken).minters(emissionController), "EmissionController not authorized minter");
        require(
            ShapleyDistributor(payable(shapley)).authorizedCreators(emissionController),
            "EmissionController not authorized creator"
        );

        // Verify SingleStaking ownership transferred
        require(
            SingleStaking(singleStaking).owner() == emissionController,
            "SingleStaking ownership not transferred to EmissionController"
        );

        // Verify EmissionController sinks are set
        require(
            address(EmissionController(emissionController).vibeToken()) == vibeToken,
            "EmissionController vibeToken mismatch"
        );

        console.log("  All verifications passed");
    }

    function _outputSummary() internal view {
        console.log("");
        console.log("=== TOKENOMICS DEPLOYMENT SUCCESSFUL ===");
        console.log("");
        console.log("UUPS Implementations:");
        console.log("  VIBEToken:", vibeTokenImpl);
        console.log("  ShapleyDistributor:", shapleyImpl);
        console.log("  PriorityRegistry:", priorityRegistryImpl);
        console.log("  EmissionController:", emissionControllerImpl);
        console.log("");
        console.log("Proxies (use these addresses):");
        console.log("  VIBE_TOKEN=", vibeToken);
        console.log("  SHAPLEY_DISTRIBUTOR=", shapley);
        console.log("  PRIORITY_REGISTRY=", priorityRegistry);
        console.log("  EMISSION_CONTROLLER=", emissionController);
        console.log("");
        console.log("Non-Upgradeable:");
        console.log("  JOULE=", joule);
        console.log("  LIQUIDITY_GAUGE=", liquidityGauge);
        console.log("  SINGLE_STAKING=", singleStaking);
        console.log("");
        console.log("Emission Budget Split:");
        console.log("  50% -> ShapleyDistributor (accumulation pool, drained per game)");
        console.log("  35% -> LiquidityGauge (streamed to LP stakers)");
        console.log("  15% -> SingleStaking (periodic notifyRewardAmount)");
        console.log("");
        console.log("Next steps:");
        console.log("1. Create gauges: LiquidityGauge.createGauge(poolId, lpToken)");
        console.log("2. Set gauge weights: LiquidityGauge.updateWeights(poolIds, weights)");
        console.log("3. Call EmissionController.drip() to start emissions");
        console.log("4. Update BuybackEngine.setProtocolToken(VIBE_TOKEN)");
        if (vibeSwapCore == address(0)) {
            console.log("5. Set VIBESWAP_CORE and re-run to authorize it on ShapleyDistributor");
        }
        console.log("==========================================");
        console.log("");
        console.log("// Copy these to your .env file:");
        console.log(string(abi.encodePacked("VIBE_TOKEN=", vm.toString(vibeToken))));
        console.log(string(abi.encodePacked("JOULE=", vm.toString(joule))));
        console.log(string(abi.encodePacked("SHAPLEY_DISTRIBUTOR=", vm.toString(shapley))));
        console.log(string(abi.encodePacked("PRIORITY_REGISTRY=", vm.toString(priorityRegistry))));
        console.log(string(abi.encodePacked("LIQUIDITY_GAUGE=", vm.toString(liquidityGauge))));
        console.log(string(abi.encodePacked("SINGLE_STAKING=", vm.toString(singleStaking))));
        console.log(string(abi.encodePacked("EMISSION_CONTROLLER=", vm.toString(emissionController))));
    }
}

/**
 * @title SetupGauges
 * @notice Create gauges for existing pools and set initial weights
 * @dev Run after DeployTokenomics and SetupMVP:
 *      forge script script/DeployTokenomics.s.sol:SetupGauges --rpc-url $RPC_URL --broadcast
 */
contract SetupGauges is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("PRIVATE_KEY");

        address gaugeAddr = vm.envAddress("LIQUIDITY_GAUGE");
        address amm = vm.envAddress("VIBESWAP_AMM");

        // Token addresses for pool ID computation
        address weth = vm.envAddress("WETH_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address usdt = vm.envOr("USDT_ADDRESS", address(0));

        console.log("=== Gauge Setup ===");

        vm.startBroadcast(ownerKey);

        LiquidityGauge gauge = LiquidityGauge(gaugeAddr);
        VibeAMM vibeAMM = VibeAMM(amm);

        // Compute pool IDs (must match how VibeAMM computes them)
        bytes32 ethUsdcPool = vibeAMM.getPoolId(weth, usdc);

        // Create ETH/USDC gauge (always — primary pool)
        // LP token = AMM address itself for simplicity, or VibeLPNFT if using NFT positions
        gauge.createGauge(ethUsdcPool, amm);
        console.log("  Created ETH/USDC gauge");

        // Create ETH/USDT gauge if USDT exists
        if (usdt != address(0)) {
            bytes32 ethUsdtPool = vibeAMM.getPoolId(weth, usdt);
            gauge.createGauge(ethUsdtPool, amm);
            console.log("  Created ETH/USDT gauge");

            // Set weights: ETH/USDC 60%, ETH/USDT 40%
            bytes32[] memory poolIds = new bytes32[](2);
            uint256[] memory weights = new uint256[](2);
            poolIds[0] = ethUsdcPool;
            poolIds[1] = ethUsdtPool;
            weights[0] = 6000; // 60%
            weights[1] = 4000; // 40%
            gauge.updateWeights(poolIds, weights);
            console.log("  Weights set: ETH/USDC 60%, ETH/USDT 40%");
        } else {
            // Single gauge gets 100%
            bytes32[] memory poolIds = new bytes32[](1);
            uint256[] memory weights = new uint256[](1);
            poolIds[0] = ethUsdcPool;
            weights[0] = 10000; // 100%
            gauge.updateWeights(poolIds, weights);
            console.log("  Weights set: ETH/USDC 100%");
        }

        vm.stopBroadcast();

        console.log("=== Gauges configured ===");
    }
}

/**
 * @title StartEmissions
 * @notice Call drip() to begin VIBE emissions
 * @dev Run after DeployTokenomics + SetupGauges:
 *      forge script script/DeployTokenomics.s.sol:StartEmissions --rpc-url $RPC_URL --broadcast
 */
contract StartEmissions is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address ecAddr = vm.envAddress("EMISSION_CONTROLLER");

        console.log("=== Starting VIBE Emissions ===");

        vm.startBroadcast(ownerKey);

        EmissionController ec = EmissionController(ecAddr);

        // First drip: mints accrued VIBE since genesis and splits to sinks
        ec.drip();

        // Log emission info
        (
            uint256 era,
            uint256 rate,
            uint256 pool,
            uint256 pending,
            uint256 totalEmitted,
            uint256 remaining
        ) = ec.getEmissionInfo();

        console.log("  Era:", era);
        console.log("  Rate (wei/s):", rate);
        console.log("  Shapley Pool:", pool);
        console.log("  Total Emitted:", totalEmitted);
        console.log("  Remaining Supply:", remaining);

        vm.stopBroadcast();

        console.log("=== Emissions started ===");
        console.log("Set up a keeper bot to call drip() periodically");
    }
}

/**
 * @title TransferTokenomicsOwnership
 * @notice Transfer all tokenomics contract ownership to multisig
 * @dev Run after deployment verification
 */
contract TransferTokenomicsOwnership is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        require(multisig != address(0), "MULTISIG_ADDRESS required");

        address vibeToken = vm.envAddress("VIBE_TOKEN");
        address shapleyAddr = vm.envAddress("SHAPLEY_DISTRIBUTOR");
        address priorityAddr = vm.envAddress("PRIORITY_REGISTRY");
        address ecAddr = vm.envAddress("EMISSION_CONTROLLER");
        address gaugeAddr = vm.envAddress("LIQUIDITY_GAUGE");

        console.log("Transferring tokenomics ownership to:", multisig);

        vm.startBroadcast(ownerKey);

        VIBEToken(vibeToken).transferOwnership(multisig);
        ShapleyDistributor(payable(shapleyAddr)).transferOwnership(multisig);
        PriorityRegistry(priorityAddr).transferOwnership(multisig);
        EmissionController(ecAddr).transferOwnership(multisig);
        LiquidityGauge(gaugeAddr).transferOwnership(multisig);
        // Note: SingleStaking ownership already with EmissionController (by design)
        // Note: Joule ownership stays with governance address set at construction

        vm.stopBroadcast();

        console.log("Ownership transfer initiated for 5 tokenomics contracts");
        console.log("Multisig must accept ownership for each contract (if using 2-step)");
    }
}
