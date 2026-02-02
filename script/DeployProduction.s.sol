// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/governance/DAOTreasury.sol";
import "../contracts/messaging/CrossChainRouter.sol";
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
 */
contract DeployProduction is Script {
    // Deployed addresses
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

    // Configuration
    address public owner;
    address public guardian;
    address public multisig;
    address public lzEndpoint;

    // Deployment tracking
    string public deploymentId;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Configuration
        owner = vm.envOr("OWNER_ADDRESS", deployer);
        guardian = vm.envOr("GUARDIAN_ADDRESS", deployer);
        multisig = vm.envOr("MULTISIG_ADDRESS", address(0));
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
        console.log("LZ Endpoint:", lzEndpoint);
        if (multisig != address(0)) {
            console.log("Multisig (for ownership transfer):", multisig);
        }
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy implementations
        console.log("Step 1: Deploying implementations...");
        _deployImplementations();

        // Step 2: Deploy proxies
        console.log("Step 2: Deploying proxies...");
        _deployProxies();

        // Step 3: Configure authorizations
        console.log("Step 3: Configuring authorizations...");
        _configureAuthorizations();

        // Step 4: Configure security
        console.log("Step 4: Configuring security...");
        _configureSecurity();

        // Step 5: Final verification
        console.log("Step 5: Running verification...");
        _verifyDeployment();

        vm.stopBroadcast();

        // Output deployment summary
        _outputSummary();

        // Save deployment artifacts
        _saveArtifacts();
    }

    function _deployImplementations() internal {
        auctionImpl = address(new CommitRevealAuction());
        ammImpl = address(new VibeAMM());
        treasuryImpl = address(new DAOTreasury());
        routerImpl = address(new CrossChainRouter());
        coreImpl = address(new VibeSwapCore());

        console.log("  CommitRevealAuction impl:", auctionImpl);
        console.log("  VibeAMM impl:", ammImpl);
        console.log("  DAOTreasury impl:", treasuryImpl);
        console.log("  CrossChainRouter impl:", routerImpl);
        console.log("  VibeSwapCore impl:", coreImpl);
    }

    function _deployProxies() internal {
        // Deploy AMM first (Treasury needs it)
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            address(0x1) // Placeholder treasury
        );
        amm = address(new ERC1967Proxy(ammImpl, ammInit));
        console.log("  VibeAMM proxy:", amm);

        // Deploy Treasury (needs AMM)
        bytes memory treasuryInit = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            amm
        );
        treasury = address(new ERC1967Proxy(treasuryImpl, treasuryInit));
        console.log("  DAOTreasury proxy:", treasury);

        // Update AMM treasury
        VibeAMM(amm).setTreasury(treasury);

        // Deploy Auction
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury
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

    function _configureAuthorizations() internal {
        // Auction authorizations
        CommitRevealAuction(payable(auction)).setAuthorizedSettler(core, true);
        CommitRevealAuction(payable(auction)).setAuthorizedSettler(router, true);
        console.log("  Auction: Core and Router authorized as settlers");

        // AMM authorizations
        VibeAMM(amm).setAuthorizedExecutor(core, true);
        console.log("  AMM: Core authorized as executor");

        // Treasury authorizations
        DAOTreasury(payable(treasury)).setAuthorizedFeeSender(amm, true);
        DAOTreasury(payable(treasury)).setAuthorizedFeeSender(core, true);
        console.log("  Treasury: AMM and Core authorized as fee senders");

        // Router authorizations
        CrossChainRouter(payable(router)).setAuthorized(core, true);
        console.log("  Router: Core authorized");
    }

    function _configureSecurity() internal {
        // AMM security
        VibeAMM(amm).setGuardian(guardian, true);
        VibeAMM(amm).setFlashLoanProtection(true);
        VibeAMM(amm).setTWAPValidation(true);
        console.log("  AMM: Guardian set, flash loan protection enabled, TWAP validation enabled");

        // Core security
        VibeSwapCore(payable(core)).setRequireEOA(true);
        VibeSwapCore(payable(core)).setMaxSwapPerHour(1_000_000 * 1e18);
        VibeSwapCore(payable(core)).setCommitCooldown(1);
        console.log("  Core: EOA required, rate limiting configured");
    }

    function _verifyDeployment() internal view {
        // Verify implementations have code
        require(auctionImpl.code.length > 0, "Auction impl has no code");
        require(ammImpl.code.length > 0, "AMM impl has no code");
        require(treasuryImpl.code.length > 0, "Treasury impl has no code");
        require(routerImpl.code.length > 0, "Router impl has no code");
        require(coreImpl.code.length > 0, "Core impl has no code");

        // Verify proxies have code
        require(auction.code.length > 0, "Auction proxy has no code");
        require(amm.code.length > 0, "AMM proxy has no code");
        require(treasury.code.length > 0, "Treasury proxy has no code");
        require(router.code.length > 0, "Router proxy has no code");
        require(core.code.length > 0, "Core proxy has no code");

        // Verify ownership
        require(VibeSwapCore(payable(core)).owner() == owner, "Core owner mismatch");
        require(CommitRevealAuction(payable(auction)).owner() == owner, "Auction owner mismatch");
        require(VibeAMM(amm).owner() == owner, "AMM owner mismatch");
        require(DAOTreasury(payable(treasury)).owner() == owner, "Treasury owner mismatch");
        require(CrossChainRouter(payable(router)).owner() == owner, "Router owner mismatch");

        // Verify critical authorizations
        require(CommitRevealAuction(payable(auction)).authorizedSettlers(core), "Core not settler");
        require(VibeAMM(amm).authorizedExecutors(core), "Core not executor");
        require(DAOTreasury(payable(treasury)).authorizedFeeSenders(amm), "AMM not fee sender");

        console.log("  All verifications passed");
    }

    function _outputSummary() internal view {
        console.log("");
        console.log("=== DEPLOYMENT SUCCESSFUL ===");
        console.log("");
        console.log("Implementations:");
        console.log("  CommitRevealAuction:", auctionImpl);
        console.log("  VibeAMM:", ammImpl);
        console.log("  DAOTreasury:", treasuryImpl);
        console.log("  CrossChainRouter:", routerImpl);
        console.log("  VibeSwapCore:", coreImpl);
        console.log("");
        console.log("Proxies (use these addresses):");
        console.log("  VIBESWAP_CORE=", core);
        console.log("  VIBESWAP_AUCTION=", auction);
        console.log("  VIBESWAP_AMM=", amm);
        console.log("  VIBESWAP_TREASURY=", treasury);
        console.log("  VIBESWAP_ROUTER=", router);
        console.log("");
        console.log("Next steps:");
        console.log("1. Verify contracts on block explorer");
        console.log("2. Run VerifyDeployment.s.sol to validate");
        console.log("3. Run SetupMVP.s.sol to create pools");
        if (multisig != address(0)) {
            console.log("4. Transfer ownership to multisig:", multisig);
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

        address core = vm.envAddress("VIBESWAP_CORE");
        address auction = vm.envAddress("VIBESWAP_AUCTION");
        address amm = vm.envAddress("VIBESWAP_AMM");
        address treasury = vm.envAddress("VIBESWAP_TREASURY");
        address router = vm.envAddress("VIBESWAP_ROUTER");

        require(multisig != address(0), "MULTISIG_ADDRESS required");

        console.log("Transferring ownership to:", multisig);

        vm.startBroadcast(deployerPrivateKey);

        VibeSwapCore(payable(core)).transferOwnership(multisig);
        CommitRevealAuction(payable(auction)).transferOwnership(multisig);
        VibeAMM(amm).transferOwnership(multisig);
        DAOTreasury(payable(treasury)).transferOwnership(multisig);
        CrossChainRouter(payable(router)).transferOwnership(multisig);

        vm.stopBroadcast();

        console.log("Ownership transfer initiated");
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

        address amm = vm.envAddress("VIBESWAP_AMM");

        console.log("Initiating emergency pause...");

        vm.startBroadcast(guardianKey);

        // Pause AMM globally (this prevents all swaps and liquidity operations)
        VibeAMM(amm).setGlobalPause(true);

        vm.stopBroadcast();

        console.log("AMM globally paused - all operations are disabled");
        console.log("Guardian must call setGlobalPause(false) to resume operations");
    }
}
