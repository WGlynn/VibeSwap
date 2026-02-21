// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/amm/VibeAMMLite.sol";
import "../contracts/governance/DAOTreasury.sol";
import "../contracts/messaging/CrossChainRouter.sol";
import "../contracts/oracles/TruePriceOracle.sol";
import "../contracts/oracles/StablecoinFlowRegistry.sol";
import "../contracts/core/ProtocolFeeAdapter.sol";
import "../contracts/core/FeeRouter.sol";
import "../contracts/core/BuybackEngine.sol";
import "../contracts/libraries/LiquidityProtection.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployProduction
 * @notice Production deployment script with verification and artifact saving
 * @dev Run with: forge script script/DeployProduction.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * Required environment variables:
 * - PRIVATE_KEY: Deployer private key
 * - ETHERSCAN_API_KEY: For contract verification (optional)
 *
 * Optional environment variables:
 * - OWNER_ADDRESS: Override owner (defaults to deployer)
 * - GUARDIAN_ADDRESS: Security guardian (defaults to deployer)
 * - MULTISIG_ADDRESS: Multisig for ownership transfer after deployment
 * - ORACLE_SIGNER: Off-chain oracle signer address
 */
contract DeployProduction is Script {
    // Deployed addresses - Core
    address public auctionImpl;
    address public ammImpl;
    address public treasuryImpl;
    address public routerImpl;
    address public coreImpl;

    address public auction;
    address public amm;
    address public treasury;
    address public router;
    address public core;

    // Deployed addresses - Fee Pipeline
    address public feeAdapter;
    address public feeRouter;
    address public buybackEngine;

    // Deployed addresses - Oracles
    address public truePriceOracleImpl;
    address public stablecoinRegistryImpl;
    address public truePriceOracle;
    address public stablecoinRegistry;

    // Configuration
    address public owner;
    address public guardian;
    address public multisig;
    address public lzEndpoint;
    address public oracleSigner;

    // Deployment tracking
    string public deploymentId;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Check if mainnet deployment
        bool isMainnet = _isMainnet(block.chainid);

        // Configuration - stricter requirements for mainnet
        if (isMainnet) {
            // Mainnet requires explicit addresses, no defaults to deployer
            owner = vm.envOr("OWNER_ADDRESS", deployer);
            guardian = vm.envAddress("GUARDIAN_ADDRESS"); // Required for mainnet
            multisig = vm.envAddress("MULTISIG_ADDRESS"); // Required for mainnet
            oracleSigner = vm.envAddress("ORACLE_SIGNER"); // Required for mainnet

            require(guardian != address(0), "GUARDIAN_ADDRESS required for mainnet deployment");
            require(oracleSigner != address(0), "ORACLE_SIGNER required for mainnet deployment");
            // NOTE: guardian == deployer allowed for initial deployment
            // Transfer ownership to multisig post-deployment via TransferOwnership script

            console.log("");
            console.log("!!! MAINNET DEPLOYMENT !!!");
            console.log("Double-check all addresses before broadcasting!");
            console.log("");
        } else {
            // Testnet/local - allow defaults
            owner = vm.envOr("OWNER_ADDRESS", deployer);
            guardian = vm.envOr("GUARDIAN_ADDRESS", deployer);
            multisig = vm.envOr("MULTISIG_ADDRESS", address(0));
            oracleSigner = vm.envOr("ORACLE_SIGNER", deployer);
        }

        lzEndpoint = _getLZEndpoint(block.chainid);

        // Generate deployment ID
        deploymentId = string(abi.encodePacked(
            "vibeswap-",
            vm.toString(block.chainid),
            "-",
            vm.toString(block.timestamp)
        ));

        console.log("=== VibeSwap Production Deployment ===");
        console.log("Deployment ID:", deploymentId);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Owner:", owner);
        console.log("Guardian:", guardian);
        console.log("Oracle Signer:", oracleSigner);
        console.log("LZ Endpoint:", lzEndpoint);
        if (multisig != address(0)) {
            console.log("Multisig (for ownership transfer):", multisig);
        }
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy implementations
        console.log("Step 1: Deploying core implementations...");
        _deployImplementations();

        // Step 2: Deploy oracle implementations
        console.log("Step 2: Deploying oracle implementations...");
        _deployOracleImplementations();

        // Step 3: Deploy proxies
        console.log("Step 3: Deploying proxies...");
        _deployProxies();

        // Step 4: Deploy oracle proxies
        console.log("Step 4: Deploying oracle proxies...");
        _deployOracleProxies();

        // Step 5: Deploy fee pipeline
        console.log("Step 5: Deploying fee pipeline...");
        _deployFeePipeline();

        // Step 6: Configure authorizations
        console.log("Step 6: Configuring authorizations...");
        _configureAuthorizations();

        // Step 7: Configure oracles
        console.log("Step 7: Configuring oracles...");
        _configureOracles();

        // Step 8: Configure security
        console.log("Step 8: Configuring security...");
        _configureSecurity();

        // Step 9: Final verification
        console.log("Step 9: Running verification...");
        _verifyDeployment();

        vm.stopBroadcast();

        // Output deployment summary
        _outputSummary();

        // Save deployment artifacts
        _saveArtifacts();
    }

    function _deployImplementations() internal {
        auctionImpl = address(new CommitRevealAuction());
        ammImpl = address(new VibeAMMLite());
        treasuryImpl = address(new DAOTreasury());
        routerImpl = address(new CrossChainRouter());
        coreImpl = address(new VibeSwapCore());

        console.log("  CommitRevealAuction impl:", auctionImpl);
        console.log("  VibeAMMLite impl:", ammImpl);
        console.log("  DAOTreasury impl:", treasuryImpl);
        console.log("  CrossChainRouter impl:", routerImpl);
        console.log("  VibeSwapCore impl:", coreImpl);
    }

    function _deployOracleImplementations() internal {
        truePriceOracleImpl = address(new TruePriceOracle());
        stablecoinRegistryImpl = address(new StablecoinFlowRegistry());

        console.log("  TruePriceOracle impl:", truePriceOracleImpl);
        console.log("  StablecoinFlowRegistry impl:", stablecoinRegistryImpl);
    }

    function _deployProxies() internal {
        // Deploy AMM first (Treasury needs it)
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMMLite.initialize.selector,
            owner,
            address(0x1) // Placeholder treasury
        );
        amm = address(new ERC1967Proxy(ammImpl, ammInit));
        console.log("  VibeAMMLite proxy:", amm);

        // Deploy Treasury (needs AMM)
        bytes memory treasuryInit = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            amm
        );
        treasury = address(new ERC1967Proxy(treasuryImpl, treasuryInit));
        console.log("  DAOTreasury proxy:", treasury);

        // Set AMM treasury to DAOTreasury initially (overridden by fee pipeline in Step 5)
        VibeAMMLite(amm).setTreasury(treasury);

        // Deploy Auction
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury,
            address(0) // complianceRegistry - can be set post-deploy
        );
        auction = address(new ERC1967Proxy(auctionImpl, auctionInit));
        console.log("  CommitRevealAuction proxy:", auction);

        // Deploy Router
        bytes memory routerInit = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector,
            owner,
            lzEndpoint,
            auction
        );
        router = address(new ERC1967Proxy(routerImpl, routerInit));
        console.log("  CrossChainRouter proxy:", router);

        // Deploy Core
        bytes memory coreInit = abi.encodeWithSelector(
            VibeSwapCore.initialize.selector,
            owner,
            auction,
            amm,
            treasury,
            router
        );
        core = address(new ERC1967Proxy(coreImpl, coreInit));
        console.log("  VibeSwapCore proxy:", core);
    }

    function _deployOracleProxies() internal {
        // Deploy StablecoinFlowRegistry first (TruePriceOracle references it)
        bytes memory registryInit = abi.encodeWithSelector(
            StablecoinFlowRegistry.initialize.selector,
            owner
        );
        stablecoinRegistry = address(new ERC1967Proxy(stablecoinRegistryImpl, registryInit));
        console.log("  StablecoinFlowRegistry proxy:", stablecoinRegistry);

        // Deploy TruePriceOracle
        bytes memory oracleInit = abi.encodeWithSelector(
            TruePriceOracle.initialize.selector,
            owner
        );
        truePriceOracle = address(new ERC1967Proxy(truePriceOracleImpl, oracleInit));
        console.log("  TruePriceOracle proxy:", truePriceOracle);

        // Link TruePriceOracle to StablecoinRegistry
        TruePriceOracle(truePriceOracle).setStablecoinRegistry(stablecoinRegistry);
        console.log("  TruePriceOracle linked to StablecoinFlowRegistry");
    }

    function _deployFeePipeline() internal {
        // FeeRouter needs 4 destination addresses.
        // Treasury wallet = DAOTreasury proxy (already deployed).
        // Insurance + RevShare = owner for now (governance can update).
        // BuybackEngine address unknown yet — deploy router, then engine, then update.

        // Deploy FeeRouter
        feeRouter = address(new FeeRouter(
            treasury,         // 40% to DAOTreasury
            owner,            // 20% insurance (governance updates to insurance pool later)
            owner,            // 30% revShare  (governance updates to revshare contract later)
            address(0xDEAD)   // 10% buyback — placeholder, updated below
        ));
        console.log("  FeeRouter:", feeRouter);

        // Deploy ProtocolFeeAdapter (bridges VibeAMM fees to FeeRouter)
        // WETH address is chain-specific (e.g. 0xC02a...6Cc2 on Ethereum mainnet)
        address weth = vm.envOr("WETH_ADDRESS", address(0x4200000000000000000000000000000000000006));
        feeAdapter = address(new ProtocolFeeAdapter(feeRouter, weth));
        console.log("  ProtocolFeeAdapter:", feeAdapter);

        // Deploy BuybackEngine (swaps + burns via VibeAMM)
        buybackEngine = address(new BuybackEngine(
            amm,
            address(0xDEAD),  // placeholder protocolToken — update via setProtocolToken() when JUL deployed
            500,              // 5% slippage tolerance
            1 hours           // 1 hour cooldown between buybacks
        ));
        console.log("  BuybackEngine:", buybackEngine);

        // Wire up: FeeRouter buyback target -> BuybackEngine
        FeeRouter(feeRouter).setBuybackTarget(buybackEngine);
        console.log("  FeeRouter buyback target -> BuybackEngine");

        // Wire up: Authorize ProtocolFeeAdapter as FeeRouter source
        FeeRouter(feeRouter).authorizeSource(feeAdapter);
        console.log("  ProtocolFeeAdapter authorized as FeeRouter source");

        // Wire up: VibeAMM treasury -> ProtocolFeeAdapter (fees flow through cooperative pipeline)
        VibeAMMLite(amm).setTreasury(feeAdapter);
        console.log("  VibeAMM treasury -> ProtocolFeeAdapter");

        // Enable protocol fee share (10% of trading fees to protocol)
        VibeAMMLite(amm).setProtocolFeeShare(1000);
        console.log("  VibeAMM protocolFeeShare -> 10% (1000 bps)");
    }

    function _configureAuthorizations() internal {
        // Auction authorizations
        CommitRevealAuction(payable(auction)).setAuthorizedSettler(core, true);
        CommitRevealAuction(payable(auction)).setAuthorizedSettler(router, true);
        console.log("  Auction: Core and Router authorized as settlers");

        // AMM authorizations
        VibeAMMLite(amm).setAuthorizedExecutor(core, true);
        console.log("  AMM: Core authorized as executor");

        // Treasury authorizations
        DAOTreasury(payable(treasury)).setAuthorizedFeeSender(amm, true);
        DAOTreasury(payable(treasury)).setAuthorizedFeeSender(core, true);
        console.log("  Treasury: AMM and Core authorized as fee senders");

        // Router authorizations
        CrossChainRouter(payable(router)).setAuthorized(core, true);
        console.log("  Router: Core authorized");
    }

    function _configureOracles() internal {
        // Authorize oracle signer for TruePriceOracle
        TruePriceOracle(truePriceOracle).setAuthorizedSigner(oracleSigner, true);
        console.log("  TruePriceOracle: Signer authorized:", oracleSigner);

        // Authorize oracle signer for StablecoinFlowRegistry
        StablecoinFlowRegistry(stablecoinRegistry).setAuthorizedUpdater(oracleSigner, true);
        console.log("  StablecoinFlowRegistry: Updater authorized:", oracleSigner);

        // Note: VibeAMMLite has liquidity protection baked in (no toggle needed)
    }

    function _configureSecurity() internal {
        // AMM security
        VibeAMMLite(amm).setFlashLoanProtection(true);
        VibeAMMLite(amm).setTWAPValidation(true);
        console.log("  AMM: Flash loan protection enabled, TWAP validation enabled");

        // Core security - guardian
        VibeSwapCore(payable(core)).setGuardian(guardian);
        console.log("  Core: Guardian set:", guardian);

        // Core security
        VibeSwapCore(payable(core)).setRequireEOA(true);
        VibeSwapCore(payable(core)).setMaxSwapPerHour(1_000_000 * 1e18);
        VibeSwapCore(payable(core)).setCommitCooldown(1);
        console.log("  Core: EOA required, rate limiting configured");
    }

    function _verifyDeployment() internal view {
        // Verify core implementations have code
        require(auctionImpl.code.length > 0, "Auction impl has no code");
        require(ammImpl.code.length > 0, "AMM impl has no code");
        require(treasuryImpl.code.length > 0, "Treasury impl has no code");
        require(routerImpl.code.length > 0, "Router impl has no code");
        require(coreImpl.code.length > 0, "Core impl has no code");

        // Verify oracle implementations have code
        require(truePriceOracleImpl.code.length > 0, "TruePriceOracle impl has no code");
        require(stablecoinRegistryImpl.code.length > 0, "StablecoinRegistry impl has no code");

        // Verify core proxies have code
        require(auction.code.length > 0, "Auction proxy has no code");
        require(amm.code.length > 0, "AMM proxy has no code");
        require(treasury.code.length > 0, "Treasury proxy has no code");
        require(router.code.length > 0, "Router proxy has no code");
        require(core.code.length > 0, "Core proxy has no code");

        // Verify oracle proxies have code
        require(truePriceOracle.code.length > 0, "TruePriceOracle proxy has no code");
        require(stablecoinRegistry.code.length > 0, "StablecoinRegistry proxy has no code");

        // Verify core ownership
        require(VibeSwapCore(payable(core)).owner() == owner, "Core owner mismatch");
        require(CommitRevealAuction(payable(auction)).owner() == owner, "Auction owner mismatch");
        require(VibeAMMLite(amm).owner() == owner, "AMM owner mismatch");
        require(DAOTreasury(payable(treasury)).owner() == owner, "Treasury owner mismatch");
        require(CrossChainRouter(payable(router)).owner() == owner, "Router owner mismatch");

        // Verify oracle ownership
        require(TruePriceOracle(truePriceOracle).owner() == owner, "TruePriceOracle owner mismatch");
        require(StablecoinFlowRegistry(stablecoinRegistry).owner() == owner, "StablecoinRegistry owner mismatch");

        // Verify critical authorizations
        require(CommitRevealAuction(payable(auction)).authorizedSettlers(core), "Core not settler");
        require(VibeAMMLite(amm).authorizedExecutors(core), "Core not executor");
        require(DAOTreasury(payable(treasury)).authorizedFeeSenders(amm), "AMM not fee sender");

        // Verify oracle authorizations
        require(TruePriceOracle(truePriceOracle).authorizedSigners(oracleSigner), "Oracle signer not authorized");
        require(StablecoinFlowRegistry(stablecoinRegistry).authorizedUpdaters(oracleSigner), "Registry updater not authorized");

        // Verify security settings from _configureSecurity()
        require(VibeSwapCore(payable(core)).requireEOA(), "Core: EOA requirement not enabled");
        require(VibeSwapCore(payable(core)).maxSwapPerHour() > 0, "Core: Rate limit not configured");
        require(VibeSwapCore(payable(core)).guardian() == guardian, "Core: Guardian not set");

        // Verify router authorization
        require(CrossChainRouter(payable(router)).authorized(core), "Router: Core not authorized");

        // Verify fee pipeline
        require(feeRouter.code.length > 0, "FeeRouter has no code");
        require(feeAdapter.code.length > 0, "FeeAdapter has no code");
        require(buybackEngine.code.length > 0, "BuybackEngine has no code");
        require(VibeAMMLite(amm).treasury() == feeAdapter, "AMM treasury should be FeeAdapter");
        require(VibeAMMLite(amm).protocolFeeShare() == 1000, "AMM protocolFeeShare should be 1000");
        require(FeeRouter(feeRouter).isAuthorizedSource(feeAdapter), "FeeAdapter not authorized on FeeRouter");
        require(ProtocolFeeAdapter(payable(feeAdapter)).feeRouter() == feeRouter, "FeeAdapter feeRouter mismatch");

        console.log("  All verifications passed (including fee pipeline)");
    }

    function _outputSummary() internal view {
        console.log("");
        console.log("=== DEPLOYMENT SUCCESSFUL ===");
        console.log("");
        console.log("Core Implementations:");
        console.log("  CommitRevealAuction:", auctionImpl);
        console.log("  VibeAMMLite:", ammImpl);
        console.log("  DAOTreasury:", treasuryImpl);
        console.log("  CrossChainRouter:", routerImpl);
        console.log("  VibeSwapCore:", coreImpl);
        console.log("");
        console.log("Oracle Implementations:");
        console.log("  TruePriceOracle:", truePriceOracleImpl);
        console.log("  StablecoinFlowRegistry:", stablecoinRegistryImpl);
        console.log("");
        console.log("Proxies (use these addresses):");
        console.log("  VIBESWAP_CORE=", core);
        console.log("  VIBESWAP_AUCTION=", auction);
        console.log("  VIBESWAP_AMM=", amm);
        console.log("  VIBESWAP_TREASURY=", treasury);
        console.log("  VIBESWAP_ROUTER=", router);
        console.log("  TRUE_PRICE_ORACLE=", truePriceOracle);
        console.log("  STABLECOIN_REGISTRY=", stablecoinRegistry);
        console.log("");
        console.log("Fee Pipeline:");
        console.log("  FEE_ROUTER=", feeRouter);
        console.log("  FEE_ADAPTER=", feeAdapter);
        console.log("  BUYBACK_ENGINE=", buybackEngine);
        console.log("");
        console.log("Next steps:");
        console.log("1. Verify contracts on block explorer");
        console.log("2. Run VerifyDeployment.s.sol to validate");
        console.log("3. Run SetupMVP.s.sol to create pools");
        console.log("4. Start off-chain oracle (python -m oracle.main)");
        if (multisig != address(0)) {
            console.log("5. Transfer ownership to multisig:", multisig);
        }
        console.log("=============================");
    }

    function _saveArtifacts() internal {
        // Note: In production, you would save these to a JSON file
        // For now, the console output serves as the artifact
        console.log("");
        console.log("// Copy these to your .env file:");
        console.log(string(abi.encodePacked("VIBESWAP_CORE=", vm.toString(core))));
        console.log(string(abi.encodePacked("VIBESWAP_AUCTION=", vm.toString(auction))));
        console.log(string(abi.encodePacked("VIBESWAP_AMM=", vm.toString(amm))));
        console.log(string(abi.encodePacked("VIBESWAP_TREASURY=", vm.toString(treasury))));
        console.log(string(abi.encodePacked("VIBESWAP_ROUTER=", vm.toString(router))));
        console.log(string(abi.encodePacked("TRUE_PRICE_ORACLE_ADDRESS=", vm.toString(truePriceOracle))));
        console.log(string(abi.encodePacked("STABLECOIN_REGISTRY_ADDRESS=", vm.toString(stablecoinRegistry))));
        console.log(string(abi.encodePacked("FEE_ROUTER=", vm.toString(feeRouter))));
        console.log(string(abi.encodePacked("FEE_ADAPTER=", vm.toString(feeAdapter))));
        console.log(string(abi.encodePacked("BUYBACK_ENGINE=", vm.toString(buybackEngine))));
    }

    function _isMainnet(uint256 chainId) internal pure returns (bool) {
        // Return true for production mainnets
        return chainId == 1 ||      // Ethereum
               chainId == 42161 ||  // Arbitrum
               chainId == 10 ||     // Optimism
               chainId == 137 ||    // Polygon
               chainId == 8453 ||   // Base
               chainId == 43114 ||  // Avalanche
               chainId == 56;       // BSC
    }

    function _getLZEndpoint(uint256 chainId) internal pure returns (address) {
        // LayerZero V2 Endpoints (mainnet uses same address across chains)
        if (chainId == 1) return 0x1a44076050125825900e736c501f859c50fE728c; // Ethereum
        if (chainId == 42161) return 0x1a44076050125825900e736c501f859c50fE728c; // Arbitrum
        if (chainId == 10) return 0x1a44076050125825900e736c501f859c50fE728c; // Optimism
        if (chainId == 137) return 0x1a44076050125825900e736c501f859c50fE728c; // Polygon
        if (chainId == 8453) return 0x1a44076050125825900e736c501f859c50fE728c; // Base
        if (chainId == 43114) return 0x1a44076050125825900e736c501f859c50fE728c; // Avalanche
        if (chainId == 56) return 0x1a44076050125825900e736c501f859c50fE728c; // BSC

        // Testnets
        if (chainId == 11155111) return 0x6EDCE65403992e310A62460808c4b910D972f10f; // Sepolia
        if (chainId == 421614) return 0x6EDCE65403992e310A62460808c4b910D972f10f; // Arbitrum Sepolia
        if (chainId == 84532) return 0x6EDCE65403992e310A62460808c4b910D972f10f; // Base Sepolia

        // Local development
        if (chainId == 31337) return address(0); // Anvil/Hardhat

        revert("Unsupported chain - add LZ endpoint");
    }
}

/**
 * @title TransferOwnership
 * @notice Transfer ownership of all contracts to multisig
 * @dev Run after deployment verification: forge script script/DeployProduction.s.sol:TransferOwnership --rpc-url $RPC_URL --broadcast
 */
contract TransferOwnership is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        // Core contracts
        address core = vm.envAddress("VIBESWAP_CORE");
        address auction = vm.envAddress("VIBESWAP_AUCTION");
        address amm = vm.envAddress("VIBESWAP_AMM");
        address treasury = vm.envAddress("VIBESWAP_TREASURY");
        address router = vm.envAddress("VIBESWAP_ROUTER");

        // Oracle contracts
        address truePriceOracle = vm.envAddress("TRUE_PRICE_ORACLE_ADDRESS");
        address stablecoinRegistry = vm.envAddress("STABLECOIN_REGISTRY_ADDRESS");

        require(multisig != address(0), "MULTISIG_ADDRESS required");

        console.log("Transferring ownership to:", multisig);

        vm.startBroadcast(deployerPrivateKey);

        // Transfer core contract ownership
        VibeSwapCore(payable(core)).transferOwnership(multisig);
        CommitRevealAuction(payable(auction)).transferOwnership(multisig);
        VibeAMMLite(amm).transferOwnership(multisig);
        DAOTreasury(payable(treasury)).transferOwnership(multisig);
        CrossChainRouter(payable(router)).transferOwnership(multisig);

        // Transfer oracle contract ownership
        TruePriceOracle(truePriceOracle).transferOwnership(multisig);
        StablecoinFlowRegistry(stablecoinRegistry).transferOwnership(multisig);

        // Transfer fee pipeline ownership
        address feeRouterAddr = vm.envAddress("FEE_ROUTER");
        address feeAdapterAddr = vm.envAddress("FEE_ADAPTER");
        address buybackAddr = vm.envAddress("BUYBACK_ENGINE");
        FeeRouter(feeRouterAddr).transferOwnership(multisig);
        ProtocolFeeAdapter(payable(feeAdapterAddr)).transferOwnership(multisig);
        BuybackEngine(buybackAddr).transferOwnership(multisig);

        vm.stopBroadcast();

        console.log("Ownership transfer initiated for 10 contracts");
        console.log("Multisig must accept ownership for each contract");
    }
}

/**
 * @title EmergencyPause
 * @notice Emergency pause all contracts
 * @dev Run by guardian: forge script script/DeployProduction.s.sol:EmergencyPause --rpc-url $RPC_URL --broadcast
 */
contract EmergencyPause is Script {
    function run() external {
        uint256 guardianKey = vm.envUint("GUARDIAN_KEY");

        address core = vm.envAddress("VIBESWAP_CORE");

        console.log("Initiating emergency pause...");

        vm.startBroadcast(guardianKey);

        // Pause VibeSwapCore (guardian or owner can call this)
        VibeSwapCore(payable(core)).pause();

        vm.stopBroadcast();

        console.log("VibeSwapCore paused - all swap operations are disabled");
        console.log("Owner must call unpause() to resume operations");
    }
}
