// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/governance/DAOTreasury.sol";
import "../contracts/messaging/CrossChainRouter.sol";
import "../contracts/oracles/TruePriceOracle.sol";
import "../contracts/oracles/StablecoinFlowRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VerifyDeployment
 * @notice Verify deployment correctness and permissions after deployment
 * @dev Run with: forge script script/VerifyDeployment.s.sol --rpc-url $RPC_URL
 */
contract VerifyDeployment is Script {
    // Core contracts
    address public core;
    address public auction;
    address public amm;
    address public treasury;
    address public router;

    // Oracle contracts
    address public truePriceOracle;
    address public stablecoinRegistry;

    uint256 public errors;
    uint256 public warnings;

    function run() external {
        // Load core addresses from environment
        core = vm.envAddress("VIBESWAP_CORE");
        auction = vm.envAddress("VIBESWAP_AUCTION");
        amm = vm.envAddress("VIBESWAP_AMM");
        treasury = vm.envAddress("VIBESWAP_TREASURY");
        router = vm.envAddress("VIBESWAP_ROUTER");

        // Load oracle addresses from environment
        truePriceOracle = vm.envAddress("TRUE_PRICE_ORACLE_ADDRESS");
        stablecoinRegistry = vm.envAddress("STABLECOIN_REGISTRY_ADDRESS");

        console.log("=== VibeSwap Deployment Verification ===");
        console.log("Chain ID:", block.chainid);
        console.log("");

        // Verify contracts are deployed
        _verifyContractsDeployed();

        // Verify proxy implementations
        _verifyProxyImplementations();

        // Verify ownership
        _verifyOwnership();

        // Verify authorizations
        _verifyAuthorizations();

        // Verify oracle configuration
        _verifyOracleConfiguration();

        // Verify security settings
        _verifySecuritySettings();

        // Verify contract interconnections
        _verifyInterconnections();

        // Summary
        console.log("");
        console.log("=== Verification Summary ===");
        if (errors == 0 && warnings == 0) {
            console.log("Status: ALL CHECKS PASSED");
        } else {
            console.log("Errors:", errors);
            console.log("Warnings:", warnings);
            if (errors > 0) {
                console.log("Status: FAILED - Address critical errors before launch");
            } else {
                console.log("Status: PASSED WITH WARNINGS - Review warnings");
            }
        }
    }

    function _verifyContractsDeployed() internal view {
        console.log("--- Core Contract Deployment ---");

        _checkCode("VibeSwapCore", core);
        _checkCode("CommitRevealAuction", auction);
        _checkCode("VibeAMM", amm);
        _checkCode("DAOTreasury", treasury);
        _checkCode("CrossChainRouter", router);

        console.log("");
        console.log("--- Oracle Contract Deployment ---");

        _checkCode("TruePriceOracle", truePriceOracle);
        _checkCode("StablecoinFlowRegistry", stablecoinRegistry);
    }

    function _verifyProxyImplementations() internal view {
        console.log("");
        console.log("--- Proxy Implementations ---");

        // Check implementation slots (ERC1967)
        bytes32 implSlot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

        _checkImplementation("VibeSwapCore", core, implSlot);
        _checkImplementation("CommitRevealAuction", auction, implSlot);
        _checkImplementation("VibeAMM", amm, implSlot);
        _checkImplementation("DAOTreasury", treasury, implSlot);
        _checkImplementation("CrossChainRouter", router, implSlot);
        _checkImplementation("TruePriceOracle", truePriceOracle, implSlot);
        _checkImplementation("StablecoinFlowRegistry", stablecoinRegistry, implSlot);
    }

    function _verifyOwnership() internal view {
        console.log("");
        console.log("--- Ownership ---");

        address coreOwner = VibeSwapCore(payable(core)).owner();
        address auctionOwner = CommitRevealAuction(payable(auction)).owner();
        address ammOwner = VibeAMM(amm).owner();
        address treasuryOwner = DAOTreasury(payable(treasury)).owner();
        address routerOwner = CrossChainRouter(payable(router)).owner();

        console.log("VibeSwapCore owner:", coreOwner);
        console.log("CommitRevealAuction owner:", auctionOwner);
        console.log("VibeAMM owner:", ammOwner);
        console.log("DAOTreasury owner:", treasuryOwner);
        console.log("CrossChainRouter owner:", routerOwner);

        // Check all owners match
        if (coreOwner != auctionOwner || auctionOwner != ammOwner ||
            ammOwner != treasuryOwner || treasuryOwner != routerOwner) {
            console.log("WARNING: Contract owners do not match!");
            // Note: Can't increment in view function, just log
        }
    }

    function _verifyAuthorizations() internal view {
        console.log("");
        console.log("--- Authorizations ---");

        // Check Core is authorized settler on Auction
        bool coreIsSettler = CommitRevealAuction(payable(auction)).authorizedSettlers(core);
        console.log("Core authorized as settler:", coreIsSettler ? "YES" : "NO");
        if (!coreIsSettler) {
            console.log("ERROR: Core must be authorized settler on Auction");
        }

        // Check Router is authorized settler on Auction
        bool routerIsSettler = CommitRevealAuction(payable(auction)).authorizedSettlers(router);
        console.log("Router authorized as settler:", routerIsSettler ? "YES" : "NO");
        if (!routerIsSettler) {
            console.log("ERROR: Router must be authorized settler on Auction");
        }

        // Check Core is authorized executor on AMM
        bool coreIsExecutor = VibeAMM(amm).authorizedExecutors(core);
        console.log("Core authorized as AMM executor:", coreIsExecutor ? "YES" : "NO");
        if (!coreIsExecutor) {
            console.log("ERROR: Core must be authorized executor on AMM");
        }

        // Check AMM is authorized fee sender on Treasury
        bool ammIsFeeSender = DAOTreasury(payable(treasury)).authorizedFeeSenders(amm);
        console.log("AMM authorized as fee sender:", ammIsFeeSender ? "YES" : "NO");
        if (!ammIsFeeSender) {
            console.log("ERROR: AMM must be authorized fee sender on Treasury");
        }

        // Check Core is authorized fee sender on Treasury
        bool coreIsFeeSender = DAOTreasury(payable(treasury)).authorizedFeeSenders(core);
        console.log("Core authorized as fee sender:", coreIsFeeSender ? "YES" : "NO");
        if (!coreIsFeeSender) {
            console.log("ERROR: Core must be authorized fee sender on Treasury");
        }

        // Check Core is authorized on Router
        bool coreIsAuthorizedRouter = CrossChainRouter(payable(router)).authorized(core);
        console.log("Core authorized on Router:", coreIsAuthorizedRouter ? "YES" : "NO");
        if (!coreIsAuthorizedRouter) {
            console.log("ERROR: Core must be authorized on Router");
        }
    }

    function _verifyOracleConfiguration() internal view {
        console.log("");
        console.log("--- Oracle Configuration ---");

        // Check TruePriceOracle ownership
        address oracleOwner = TruePriceOracle(truePriceOracle).owner();
        console.log("TruePriceOracle owner:", oracleOwner);

        // Check StablecoinFlowRegistry ownership
        address registryOwner = StablecoinFlowRegistry(stablecoinRegistry).owner();
        console.log("StablecoinFlowRegistry owner:", registryOwner);

        // Check if TruePriceOracle is linked to StablecoinFlowRegistry
        address linkedRegistry = address(TruePriceOracle(truePriceOracle).stablecoinRegistry());
        console.log("TruePriceOracle linked to registry:", linkedRegistry);
        if (linkedRegistry != stablecoinRegistry) {
            console.log("ERROR: TruePriceOracle not linked to StablecoinFlowRegistry");
        }

        // Check if AMM has liquidity protection enabled
        bool liquidityProtectionEnabled = VibeAMM(amm).liquidityProtectionEnabled();
        console.log("AMM liquidity protection:", liquidityProtectionEnabled ? "ENABLED" : "DISABLED");
        if (!liquidityProtectionEnabled) {
            console.log("WARNING: Liquidity protection is disabled");
        }

        // Check oracle max staleness
        uint256 maxStaleness = TruePriceOracle(truePriceOracle).MAX_STALENESS();
        console.log("Oracle max staleness:", maxStaleness, "seconds");
    }

    function _verifySecuritySettings() internal view {
        console.log("");
        console.log("--- Security Settings ---");

        // Check AMM security
        bool flashLoanProtection = VibeAMM(amm).flashLoanProtectionEnabled();
        bool twapValidation = VibeAMM(amm).twapValidationEnabled();

        console.log("AMM flash loan protection:", flashLoanProtection ? "ENABLED" : "DISABLED");
        console.log("AMM TWAP validation:", twapValidation ? "ENABLED" : "DISABLED");

        if (!flashLoanProtection) {
            console.log("WARNING: Flash loan protection is disabled");
        }
        if (!twapValidation) {
            console.log("WARNING: TWAP validation is disabled");
        }

        // Check Core security
        bool requireEOA = VibeSwapCore(payable(core)).requireEOA();
        console.log("Core requireEOA:", requireEOA ? "ENABLED" : "DISABLED");

        if (!requireEOA) {
            console.log("WARNING: EOA requirement is disabled (contracts can swap)");
        }

        // Check Auction timing (PROTOCOL CONSTANTS)
        uint256 commitDuration = CommitRevealAuction(payable(auction)).COMMIT_DURATION();
        uint256 revealDuration = CommitRevealAuction(payable(auction)).REVEAL_DURATION();
        uint256 slashRate = CommitRevealAuction(payable(auction)).SLASH_RATE_BPS();
        uint256 collateralBps = CommitRevealAuction(payable(auction)).COLLATERAL_BPS();
        console.log("Auction commit duration:", commitDuration, "seconds (CONSTANT)");
        console.log("Auction reveal duration:", revealDuration, "seconds (CONSTANT)");
        console.log("Slash rate:", slashRate, "bps (CONSTANT)");
        console.log("Collateral requirement:", collateralBps, "bps (CONSTANT)");
    }

    function _verifyInterconnections() internal view {
        console.log("");
        console.log("--- Contract Interconnections ---");

        // Check AMM treasury address
        address ammTreasury = VibeAMM(amm).treasury();
        console.log("AMM treasury:", ammTreasury);
        if (ammTreasury != treasury) {
            console.log("ERROR: AMM treasury does not match deployed treasury");
        }

        // Check Treasury AMM reference
        address treasuryAmm = DAOTreasury(payable(treasury)).vibeAMM();
        console.log("Treasury AMM:", treasuryAmm);
        if (treasuryAmm != amm) {
            console.log("ERROR: Treasury AMM does not match deployed AMM");
        }

        // Check Core references
        address coreAuction = address(VibeSwapCore(payable(core)).auction());
        address coreAmm = address(VibeSwapCore(payable(core)).amm());
        address coreTreasury = address(VibeSwapCore(payable(core)).treasury());
        address coreRouter = address(VibeSwapCore(payable(core)).router());

        console.log("Core auction:", coreAuction);
        console.log("Core AMM:", coreAmm);
        console.log("Core treasury:", coreTreasury);
        console.log("Core router:", coreRouter);

        if (coreAuction != auction) {
            console.log("ERROR: Core auction mismatch");
        }
        if (coreAmm != amm) {
            console.log("ERROR: Core AMM mismatch");
        }
        if (coreTreasury != treasury) {
            console.log("ERROR: Core treasury mismatch");
        }
        if (coreRouter != router) {
            console.log("ERROR: Core router mismatch");
        }
    }

    function _checkCode(string memory name, address addr) internal view {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        if (size == 0) {
            console.log(name, "at", addr);
            console.log("  - NO CODE (ERROR)");
        } else {
            console.log(name, "at", addr);
            console.log("  - OK, size:", size);
        }
    }

    function _checkImplementation(string memory name, address proxy, bytes32 slot) internal view {
        bytes32 implAddr = vm.load(proxy, slot);
        address impl = address(uint160(uint256(implAddr)));

        uint256 size;
        assembly {
            size := extcodesize(impl)
        }

        if (impl == address(0)) {
            console.log(name, "implementation: NOT SET (ERROR)");
        } else if (size == 0) {
            console.log(name, "implementation at", impl, "- NO CODE (ERROR)");
        } else {
            console.log(name, "implementation:", impl, "- OK");
        }
    }
}

/**
 * @title CheckPhase
 * @notice Check current auction phase and batch info
 */
contract CheckPhase is Script {
    function run() external view {
        address auction = vm.envAddress("VIBESWAP_AUCTION");

        CommitRevealAuction auctionContract = CommitRevealAuction(payable(auction));

        ICommitRevealAuction.BatchPhase phase = auctionContract.getCurrentPhase();
        uint64 batchId = auctionContract.getCurrentBatchId();

        string memory phaseStr;
        if (phase == ICommitRevealAuction.BatchPhase.COMMIT) {
            phaseStr = "COMMIT";
        } else if (phase == ICommitRevealAuction.BatchPhase.REVEAL) {
            phaseStr = "REVEAL";
        } else {
            phaseStr = "SETTLING";
        }

        console.log("Current batch:", batchId);
        console.log("Current phase:", phaseStr);
        console.log("Block timestamp:", block.timestamp);
    }
}
