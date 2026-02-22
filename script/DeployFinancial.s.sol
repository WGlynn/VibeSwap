// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

import "../contracts/financial/VibeRevShare.sol";
import "../contracts/financial/VibeInsurance.sol";
import "../contracts/financial/VibeBonds.sol";
import "../contracts/financial/VibeOptions.sol";
import "../contracts/financial/VibeStream.sol";
import "../contracts/financial/VestingSchedule.sol";
import "../contracts/core/FeeRouter.sol";

/**
 * @title DeployFinancial
 * @notice Deploys financial instrument contracts (all non-upgradeable):
 *         VibeRevShare, VibeInsurance, VibeBonds, VibeOptions, VibeStream, VestingSchedule
 *
 * Required env vars:
 *   PRIVATE_KEY              - Deployer private key
 *   JOULE_TOKEN              - Joule token address (from DeployTokenomics)
 *   VIBE_AMM                 - VibeAMM proxy address (from DeployProduction)
 *   VOLATILITY_ORACLE        - VolatilityOracle proxy address (from DeployIncentives)
 *
 * Optional env vars:
 *   REPUTATION_ORACLE        - ReputationOracle address (for VibeRevShare, VibeInsurance)
 *   REVENUE_TOKEN            - Revenue distribution token (defaults to first supported stablecoin)
 *   COLLATERAL_TOKEN         - Insurance collateral token
 *   FEE_ROUTER               - FeeRouter address (to wire VibeRevShare as revShare target)
 */
contract DeployFinancial is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Required
        address jouleToken = vm.envAddress("JOULE_TOKEN");
        address vibeAMM = vm.envAddress("VIBE_AMM");
        address volatilityOracle = vm.envAddress("VOLATILITY_ORACLE");

        // Optional
        address reputationOracle = vm.envOr("REPUTATION_ORACLE", address(0));
        address revenueToken = vm.envOr("REVENUE_TOKEN", address(0));
        address collateralToken = vm.envOr("COLLATERAL_TOKEN", address(0));
        address feeRouterAddr = vm.envOr("FEE_ROUTER", address(0));

        vm.startBroadcast(deployerKey);

        // ============ 1. VibeRevShare ============

        address vibeRevShare;
        if (revenueToken != address(0)) {
            VibeRevShare revShare = new VibeRevShare(
                jouleToken,
                reputationOracle,   // can be address(0) initially
                revenueToken
            );
            vibeRevShare = address(revShare);
            console.log("VibeRevShare:", vibeRevShare);

            // Wire FeeRouter -> VibeRevShare
            if (feeRouterAddr != address(0)) {
                FeeRouter(feeRouterAddr).setRevShare(vibeRevShare);
                console.log("  FeeRouter.setRevShare -> VibeRevShare");

                VibeRevShare(vibeRevShare).setRevenueSource(feeRouterAddr, true);
                console.log("  VibeRevShare.setRevenueSource -> FeeRouter");
            }
        } else {
            console.log("SKIP VibeRevShare (REVENUE_TOKEN not provided)");
        }

        // ============ 2. VibeInsurance ============

        address vibeInsurance;
        if (collateralToken != address(0)) {
            VibeInsurance insurance = new VibeInsurance(
                jouleToken,
                reputationOracle,   // can be address(0) initially
                collateralToken
            );
            vibeInsurance = address(insurance);
            console.log("VibeInsurance:", vibeInsurance);
        } else {
            console.log("SKIP VibeInsurance (COLLATERAL_TOKEN not provided)");
        }

        // ============ 3. VibeBonds ============

        VibeBonds vibeBonds = new VibeBonds(jouleToken);
        console.log("VibeBonds:", address(vibeBonds));

        // ============ 4. VibeOptions ============

        VibeOptions vibeOptions = new VibeOptions(vibeAMM, volatilityOracle);
        console.log("VibeOptions:", address(vibeOptions));

        // ============ 5. VibeStream ============

        VibeStream vibeStream = new VibeStream();
        console.log("VibeStream:", address(vibeStream));

        // ============ 6. VestingSchedule ============

        VestingSchedule vestingSchedule = new VestingSchedule();
        console.log("VestingSchedule:", address(vestingSchedule));

        vm.stopBroadcast();

        // ============ Summary ============
        console.log("");
        console.log("=== Financial Deployment Summary ===");
        if (vibeRevShare != address(0)) console.log("VibeRevShare:", vibeRevShare);
        if (vibeInsurance != address(0)) console.log("VibeInsurance:", vibeInsurance);
        console.log("VibeBonds:", address(vibeBonds));
        console.log("VibeOptions:", address(vibeOptions));
        console.log("VibeStream:", address(vibeStream));
        console.log("VestingSchedule:", address(vestingSchedule));
        console.log("");
        console.log("POST-DEPLOY:");
        if (vibeRevShare != address(0) && feeRouterAddr == address(0)) {
            console.log("  1. FeeRouter.setRevShare(vibeRevShare) -- CRITICAL");
            console.log("  2. VibeRevShare.setRevenueSource(feeRouter, true)");
        }
        if (vibeInsurance != address(0)) {
            console.log("  3. VibeInsurance.setTriggerResolver(keeperAddr, true)");
        }
        console.log("  4. VestingSchedule.createSchedule(...) for team/investor vesting");
        console.log("  5. BuybackEngine.setProtocolToken(VIBE_TOKEN) if not already set");
    }
}

/**
 * @title TransferFinancialOwnership
 * @notice Transfer financial contract ownership to multisig
 */
contract TransferFinancialOwnership is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        vm.startBroadcast(deployerKey);

        address revShare = vm.envOr("VIBE_REVSHARE", address(0));
        if (revShare != address(0)) {
            VibeRevShare(revShare).transferOwnership(multisig);
            console.log("VibeRevShare ownership -> multisig");
        }

        address insurance = vm.envOr("VIBE_INSURANCE", address(0));
        if (insurance != address(0)) {
            VibeInsurance(insurance).transferOwnership(multisig);
            console.log("VibeInsurance ownership -> multisig");
        }

        VibeBonds(vm.envAddress("VIBE_BONDS")).transferOwnership(multisig);
        console.log("VibeBonds ownership -> multisig");

        VibeOptions(vm.envAddress("VIBE_OPTIONS")).transferOwnership(multisig);
        console.log("VibeOptions ownership -> multisig");

        VibeStream(vm.envAddress("VIBE_STREAM")).transferOwnership(multisig);
        console.log("VibeStream ownership -> multisig");

        VestingSchedule(vm.envAddress("VESTING_SCHEDULE")).transferOwnership(multisig);
        console.log("VestingSchedule ownership -> multisig");

        vm.stopBroadcast();
    }
}
