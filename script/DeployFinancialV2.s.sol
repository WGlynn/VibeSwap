// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../contracts/financial/StrategyVault.sol";
import "../contracts/financial/VibeCredit.sol";
import "../contracts/financial/VibeLendPool.sol";
import "../contracts/financial/VibeFeeDistributor.sol";
import "../contracts/financial/VibeFlashLoan.sol";
import "../contracts/financial/VibeInsurancePool.sol";

/**
 * @title DeployFinancialV2
 * @notice Deploys the VSOS Financial Primitives layer (V2 additions):
 *         1. VibeLendPool (UUPS proxy) — AAVE-style lending with Shapley interest
 *         2. VibeFeeDistributor (UUPS proxy) — protocol revenue distribution
 *         3. VibeFlashLoan (UUPS proxy) — multi-pool flash loan aggregator
 *         4. VibeInsurancePool (UUPS proxy) — protocol-wide insurance underwriting
 *         5. VibeCredit (non-upgradeable) — P2P reputation-gated credit lines
 *         6. StrategyVault (non-upgradeable) — ERC-4626 automated yield vault
 *
 * @dev Run after DeployProduction.s.sol + DeployTokenomics.s.sol:
 *      forge script script/DeployFinancialV2.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * Required env vars:
 *   PRIVATE_KEY              — Deployer private key
 *   DAO_TREASURY             — DAOTreasury proxy address (from DeployProduction)
 *
 * Optional env vars:
 *   JOULE_TOKEN              — Joule token address (from DeployTokenomics, for VibeCredit)
 *   REPUTATION_ORACLE        — ReputationOracle address (for VibeCredit)
 *   VOLATILITY_INSURANCE_POOL — VolatilityInsurancePool address (from DeployIncentives, for flash loan insurance)
 *   CONTRIBUTION_DAG         — ContributionDAG address (from DeployIdentity, for mind rewards)
 *   STRATEGY_ASSET           — ERC20 asset for StrategyVault (default: skip)
 *   STRATEGY_DEPOSIT_CAP     — Max deposit for StrategyVault (default: 1M tokens)
 *   FEE_ROUTER               — FeeRouter address (from DeployProduction, for wiring)
 */
contract DeployFinancialV2 is Script {
    // ============ UUPS Proxies ============

    address public vibeLendPoolImpl;
    address public vibeLendPool;

    address public vibeFeeDistributorImpl;
    address public vibeFeeDistributor;

    address public vibeFlashLoanImpl;
    address public vibeFlashLoan;

    address public vibeInsurancePoolImpl;
    address public vibeInsurancePool;

    // ============ Non-Upgradeable ============

    address public vibeCredit;
    address public strategyVault;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Required
        address daoTreasury = vm.envAddress("DAO_TREASURY");

        // Optional dependencies
        address jouleToken = vm.envOr("JOULE_TOKEN", address(0));
        address reputationOracle = vm.envOr("REPUTATION_ORACLE", address(0));
        address insuranceFund = vm.envOr("VOLATILITY_INSURANCE_POOL", deployer);
        address contributionDAG = vm.envOr("CONTRIBUTION_DAG", address(0));
        address strategyAsset = vm.envOr("STRATEGY_ASSET", address(0));
        uint256 strategyDepositCap = vm.envOr("STRATEGY_DEPOSIT_CAP", uint256(1_000_000e18));
        address feeRouterAddr = vm.envOr("FEE_ROUTER", address(0));

        console.log("=== VSOS Financial Primitives V2 Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("DAOTreasury:", daoTreasury);
        console.log("");

        vm.startBroadcast(deployerKey);

        // ============ 1. VibeLendPool (UUPS Proxy) ============

        console.log("Step 1: Deploying VibeLendPool...");
        vibeLendPoolImpl = address(new VibeLendPool());
        bytes memory lendInit = abi.encodeWithSelector(
            VibeLendPool.initialize.selector
        );
        vibeLendPool = address(new ERC1967Proxy(vibeLendPoolImpl, lendInit));
        console.log("  VibeLendPool impl:", vibeLendPoolImpl);
        console.log("  VibeLendPool proxy:", vibeLendPool);

        // ============ 2. VibeFeeDistributor (UUPS Proxy) ============

        console.log("Step 2: Deploying VibeFeeDistributor...");
        vibeFeeDistributorImpl = address(new VibeFeeDistributor());
        // mindRewardPool = ContributionDAG or deployer as placeholder
        address mindRewardPool = contributionDAG != address(0) ? contributionDAG : deployer;
        bytes memory feeDistInit = abi.encodeCall(
            VibeFeeDistributor.initialize,
            (daoTreasury, insuranceFund, mindRewardPool)
        );
        vibeFeeDistributor = address(new ERC1967Proxy(vibeFeeDistributorImpl, feeDistInit));
        console.log("  VibeFeeDistributor impl:", vibeFeeDistributorImpl);
        console.log("  VibeFeeDistributor proxy:", vibeFeeDistributor);

        // ============ 3. VibeFlashLoan (UUPS Proxy) ============

        console.log("Step 3: Deploying VibeFlashLoan...");
        vibeFlashLoanImpl = address(new VibeFlashLoan());
        bytes memory flashInit = abi.encodeCall(
            VibeFlashLoan.initialize,
            (insuranceFund)
        );
        vibeFlashLoan = address(new ERC1967Proxy(vibeFlashLoanImpl, flashInit));
        console.log("  VibeFlashLoan impl:", vibeFlashLoanImpl);
        console.log("  VibeFlashLoan proxy:", vibeFlashLoan);

        // ============ 4. VibeInsurancePool (UUPS Proxy) ============

        console.log("Step 4: Deploying VibeInsurancePool...");
        vibeInsurancePoolImpl = address(new VibeInsurancePool());
        bytes memory insPoolInit = abi.encodeWithSelector(
            VibeInsurancePool.initialize.selector
        );
        vibeInsurancePool = address(new ERC1967Proxy(vibeInsurancePoolImpl, insPoolInit));
        console.log("  VibeInsurancePool impl:", vibeInsurancePoolImpl);
        console.log("  VibeInsurancePool proxy:", vibeInsurancePool);

        // ============ 5. VibeCredit (Non-Upgradeable) ============

        if (jouleToken != address(0) && reputationOracle != address(0)) {
            console.log("Step 5: Deploying VibeCredit...");
            vibeCredit = address(new VibeCredit(jouleToken, reputationOracle));
            console.log("  VibeCredit:", vibeCredit);
        } else {
            console.log("Step 5: SKIP VibeCredit (needs JOULE_TOKEN + REPUTATION_ORACLE)");
        }

        // ============ 6. StrategyVault (Non-Upgradeable, ERC-4626) ============

        if (strategyAsset != address(0)) {
            console.log("Step 6: Deploying StrategyVault...");
            strategyVault = address(new StrategyVault(
                IERC20(strategyAsset),
                "VibeSwap Strategy Vault",
                "vsVAULT",
                daoTreasury,           // fee recipient
                strategyDepositCap
            ));
            console.log("  StrategyVault:", strategyVault);
        } else {
            console.log("Step 6: SKIP StrategyVault (STRATEGY_ASSET not provided)");
        }

        // ============ Post-Deploy Wiring ============

        console.log("");
        console.log("=== Post-Deploy Wiring ===");

        // Register VibeLendPool as a liquidity source on VibeFlashLoan
        // (VibeLendPool must also authorize VibeFlashLoan as a flash loan provider)
        console.log("  NOTE: Call VibeFlashLoan.registerPool(vibeLendPool) after markets created");
        console.log("  NOTE: Call VibeLendPool.setFlashLoanProvider(vibeFlashLoan) if setter exists");

        vm.stopBroadcast();

        // ============ Verification ============

        console.log("");
        console.log("=== Verification ===");
        require(vibeLendPool.code.length > 0, "VibeLendPool proxy has no code");
        require(vibeFeeDistributor.code.length > 0, "VibeFeeDistributor proxy has no code");
        require(vibeFlashLoan.code.length > 0, "VibeFlashLoan proxy has no code");
        require(vibeInsurancePool.code.length > 0, "VibeInsurancePool proxy has no code");
        console.log("  All UUPS proxies verified");

        // ============ Summary ============

        console.log("");
        console.log("=== Financial V2 Deployment Summary ===");
        console.log("");
        console.log("UUPS Proxies:");
        console.log("  VIBE_LEND_POOL=", vibeLendPool);
        console.log("  VIBE_FEE_DISTRIBUTOR=", vibeFeeDistributor);
        console.log("  VIBE_FLASH_LOAN=", vibeFlashLoan);
        console.log("  VIBE_INSURANCE_POOL=", vibeInsurancePool);
        console.log("");
        console.log("Non-Upgradeable:");
        if (vibeCredit != address(0)) {
            console.log("  VIBE_CREDIT=", vibeCredit);
        }
        if (strategyVault != address(0)) {
            console.log("  STRATEGY_VAULT=", strategyVault);
        }
        console.log("");
        console.log("POST-DEPLOY:");
        console.log("  1. VibeLendPool.createMarket(asset, ltvBps, ...) for each supported asset");
        console.log("  2. VibeFlashLoan.registerPool(vibeLendPool) for flash loan liquidity");
        console.log("  3. VibeInsurancePool: underwriters deposit capital");
        console.log("  4. VibeFeeDistributor: register revenue sources");
        if (vibeCredit == address(0)) {
            console.log("  5. Deploy VibeCredit: set JOULE_TOKEN + REPUTATION_ORACLE");
        }
        if (strategyVault == address(0)) {
            console.log("  6. Deploy StrategyVault: set STRATEGY_ASSET");
        }
        console.log("  7. StrategyVault.proposeStrategy(strategyAddr) + activate after timelock");
        console.log("========================================");
        console.log("");
        console.log("// Copy these to your .env file:");
        console.log(string(abi.encodePacked("VIBE_LEND_POOL=", vm.toString(vibeLendPool))));
        console.log(string(abi.encodePacked("VIBE_FEE_DISTRIBUTOR=", vm.toString(vibeFeeDistributor))));
        console.log(string(abi.encodePacked("VIBE_FLASH_LOAN=", vm.toString(vibeFlashLoan))));
        console.log(string(abi.encodePacked("VIBE_INSURANCE_POOL=", vm.toString(vibeInsurancePool))));
        if (vibeCredit != address(0)) {
            console.log(string(abi.encodePacked("VIBE_CREDIT=", vm.toString(vibeCredit))));
        }
        if (strategyVault != address(0)) {
            console.log(string(abi.encodePacked("STRATEGY_VAULT=", vm.toString(strategyVault))));
        }
    }
}

/**
 * @title TransferFinancialV2Ownership
 * @notice Transfer Financial V2 contract ownership to multisig
 */
contract TransferFinancialV2Ownership is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        vm.startBroadcast(deployerKey);

        address lendPool = vm.envAddress("VIBE_LEND_POOL");
        VibeLendPool(lendPool).transferOwnership(multisig);
        console.log("VibeLendPool ownership -> multisig");

        address feeDist = vm.envAddress("VIBE_FEE_DISTRIBUTOR");
        VibeFeeDistributor(payable(feeDist)).transferOwnership(multisig);
        console.log("VibeFeeDistributor ownership -> multisig");

        address flashLoan = vm.envAddress("VIBE_FLASH_LOAN");
        VibeFlashLoan(payable(flashLoan)).transferOwnership(multisig);
        console.log("VibeFlashLoan ownership -> multisig");

        address insPool = vm.envAddress("VIBE_INSURANCE_POOL");
        VibeInsurancePool(payable(insPool)).transferOwnership(multisig);
        console.log("VibeInsurancePool ownership -> multisig");

        address credit = vm.envOr("VIBE_CREDIT", address(0));
        if (credit != address(0)) {
            VibeCredit(credit).transferOwnership(multisig);
            console.log("VibeCredit ownership -> multisig");
        }

        address vault = vm.envOr("STRATEGY_VAULT", address(0));
        if (vault != address(0)) {
            StrategyVault(payable(vault)).transferOwnership(multisig);
            console.log("StrategyVault ownership -> multisig");
        }

        vm.stopBroadcast();
    }
}
