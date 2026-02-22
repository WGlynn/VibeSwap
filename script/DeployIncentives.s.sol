// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/incentives/IncentiveController.sol";
import "../contracts/incentives/VolatilityInsurancePool.sol";
import "../contracts/incentives/ILProtectionVault.sol";
import "../contracts/incentives/SlippageGuaranteeFund.sol";
import "../contracts/incentives/LoyaltyRewardsManager.sol";
import "../contracts/incentives/MerkleAirdrop.sol";
import "../contracts/oracles/VolatilityOracle.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/core/VibeSwapCore.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployIncentives
 * @notice Deploys the complete incentive vault layer — fee routing, LP protection, insurance
 * @dev Run after DeployProduction.s.sol + DeployTokenomics.s.sol:
 *      forge script script/DeployIncentives.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * Deploys (in order):
 *   1. VolatilityOracle (UUPS proxy) — on-chain volatility tracking
 *   2. IncentiveController (UUPS proxy) — central fee router + incentive coordinator
 *   3. VolatilityInsurancePool (UUPS proxy) — volatility-based insurance for LPs
 *   4. ILProtectionVault (UUPS proxy) — impermanent loss protection
 *   5. SlippageGuaranteeFund (UUPS proxy) — slippage compensation for traders
 *   6. LoyaltyRewardsManager (UUPS proxy) — loyalty-tiered LP reward boosts
 *   7. MerkleAirdrop (non-upgradeable) — token distribution for retroactive claims
 *
 * Post-deploy wiring:
 *   - IncentiveController.setVolatilityOracle(volatilityOracle)
 *   - IncentiveController.setVolatilityInsurancePool(volatilityInsurancePool)
 *   - IncentiveController.setILProtectionVault(ilProtectionVault)
 *   - IncentiveController.setSlippageGuaranteeFund(slippageGuaranteeFund)
 *   - IncentiveController.setLoyaltyRewardsManager(loyaltyRewardsManager)
 *   - IncentiveController.setShapleyDistributor(shapleyDistributor) [if tokenomics deployed]
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Deployer private key
 *   - VIBE_AMM: VibeAMM proxy address (from DeployProduction)
 *   - VIBESWAP_CORE: VibeSwapCore proxy address (from DeployProduction)
 *   - DAO_TREASURY: DAOTreasury proxy address (from DeployProduction)
 *
 * Optional environment variables:
 *   - OWNER_ADDRESS: Override owner (defaults to deployer)
 *   - VIBE_TOKEN: VIBEToken address (from DeployTokenomics) — for LoyaltyRewardsManager reward token
 *   - SHAPLEY_DISTRIBUTOR: ShapleyDistributor address (from DeployTokenomics)
 */
contract DeployIncentives is Script {
    // ============ Deployed Addresses ============

    // UUPS implementations
    address public volatilityOracleImpl;
    address public incentiveControllerImpl;
    address public volatilityInsurancePoolImpl;
    address public ilProtectionVaultImpl;
    address public slippageGuaranteeFundImpl;
    address public loyaltyRewardsManagerImpl;

    // Proxies (use these addresses)
    address public volatilityOracle;
    address public incentiveController;
    address public volatilityInsurancePool;
    address public ilProtectionVault;
    address public slippageGuaranteeFund;
    address public loyaltyRewardsManager;

    // Non-upgradeable
    address public merkleAirdrop;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Phase 1 addresses (required)
        address vibeAMM = vm.envAddress("VIBE_AMM");
        address vibeSwapCore = vm.envAddress("VIBESWAP_CORE");
        address daoTreasury = vm.envAddress("DAO_TREASURY");

        // Optional overrides
        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        address vibeToken = vm.envOr("VIBE_TOKEN", address(0));
        address shapleyDistributor = vm.envOr("SHAPLEY_DISTRIBUTOR", address(0));

        vm.startBroadcast(deployerKey);

        // ============ 1. VolatilityOracle (UUPS) ============
        console.log("Deploying VolatilityOracle...");
        volatilityOracleImpl = address(new VolatilityOracle());
        volatilityOracle = address(new ERC1967Proxy(
            volatilityOracleImpl,
            abi.encodeCall(VolatilityOracle.initialize, (owner, vibeAMM))
        ));
        console.log("  VolatilityOracle impl:", volatilityOracleImpl);
        console.log("  VolatilityOracle proxy:", volatilityOracle);

        // ============ 2. IncentiveController (UUPS) ============
        console.log("Deploying IncentiveController...");
        incentiveControllerImpl = address(new IncentiveController());
        incentiveController = address(new ERC1967Proxy(
            incentiveControllerImpl,
            abi.encodeCall(IncentiveController.initialize, (
                owner,
                vibeAMM,
                vibeSwapCore,
                daoTreasury
            ))
        ));
        console.log("  IncentiveController impl:", incentiveControllerImpl);
        console.log("  IncentiveController proxy:", incentiveController);

        // ============ 3. VolatilityInsurancePool (UUPS) ============
        console.log("Deploying VolatilityInsurancePool...");
        volatilityInsurancePoolImpl = address(new VolatilityInsurancePool());
        volatilityInsurancePool = address(new ERC1967Proxy(
            volatilityInsurancePoolImpl,
            abi.encodeCall(VolatilityInsurancePool.initialize, (
                owner,
                volatilityOracle,
                incentiveController
            ))
        ));
        console.log("  VolatilityInsurancePool impl:", volatilityInsurancePoolImpl);
        console.log("  VolatilityInsurancePool proxy:", volatilityInsurancePool);

        // ============ 4. ILProtectionVault (UUPS) ============
        console.log("Deploying ILProtectionVault...");
        ilProtectionVaultImpl = address(new ILProtectionVault());
        ilProtectionVault = address(new ERC1967Proxy(
            ilProtectionVaultImpl,
            abi.encodeCall(ILProtectionVault.initialize, (
                owner,
                volatilityOracle,
                incentiveController,
                vibeAMM
            ))
        ));
        console.log("  ILProtectionVault impl:", ilProtectionVaultImpl);
        console.log("  ILProtectionVault proxy:", ilProtectionVault);

        // ============ 5. SlippageGuaranteeFund (UUPS) ============
        console.log("Deploying SlippageGuaranteeFund...");
        slippageGuaranteeFundImpl = address(new SlippageGuaranteeFund());
        slippageGuaranteeFund = address(new ERC1967Proxy(
            slippageGuaranteeFundImpl,
            abi.encodeCall(SlippageGuaranteeFund.initialize, (
                owner,
                incentiveController
            ))
        ));
        console.log("  SlippageGuaranteeFund impl:", slippageGuaranteeFundImpl);
        console.log("  SlippageGuaranteeFund proxy:", slippageGuaranteeFund);

        // ============ 6. LoyaltyRewardsManager (UUPS) ============
        console.log("Deploying LoyaltyRewardsManager...");
        // Use VIBE token as reward token if available, otherwise treasury as placeholder
        address rewardToken = vibeToken != address(0) ? vibeToken : daoTreasury;
        loyaltyRewardsManagerImpl = address(new LoyaltyRewardsManager());
        loyaltyRewardsManager = address(new ERC1967Proxy(
            loyaltyRewardsManagerImpl,
            abi.encodeCall(LoyaltyRewardsManager.initialize, (
                owner,
                incentiveController,
                daoTreasury,
                rewardToken
            ))
        ));
        console.log("  LoyaltyRewardsManager impl:", loyaltyRewardsManagerImpl);
        console.log("  LoyaltyRewardsManager proxy:", loyaltyRewardsManager);

        // ============ 7. MerkleAirdrop (non-upgradeable) ============
        console.log("Deploying MerkleAirdrop...");
        merkleAirdrop = address(new MerkleAirdrop());
        console.log("  MerkleAirdrop:", merkleAirdrop);

        // ============ Post-Deploy Wiring ============
        console.log("");
        console.log("=== Wiring IncentiveController to vaults ===");

        IncentiveController ic = IncentiveController(payable(incentiveController));

        // Wire all vault addresses into IncentiveController
        ic.setVolatilityOracle(volatilityOracle);
        console.log("  Set VolatilityOracle");

        ic.setVolatilityInsurancePool(volatilityInsurancePool);
        console.log("  Set VolatilityInsurancePool");

        ic.setILProtectionVault(ilProtectionVault);
        console.log("  Set ILProtectionVault");

        ic.setSlippageGuaranteeFund(slippageGuaranteeFund);
        console.log("  Set SlippageGuaranteeFund");

        ic.setLoyaltyRewardsManager(loyaltyRewardsManager);
        console.log("  Set LoyaltyRewardsManager");

        // Wire ShapleyDistributor if available (from DeployTokenomics)
        if (shapleyDistributor != address(0)) {
            ic.setShapleyDistributor(shapleyDistributor);
            console.log("  Set ShapleyDistributor");
        } else {
            console.log("  SKIP ShapleyDistributor (not provided - wire after DeployTokenomics)");
        }

        // Wire IncentiveController into VibeAMM and VibeSwapCore
        console.log("");
        console.log("=== Wiring AMM + Core to IncentiveController ===");
        VibeAMM(vibeAMM).setIncentiveController(incentiveController);
        console.log("  VibeAMM.setIncentiveController set");

        VibeSwapCore(payable(vibeSwapCore)).setIncentiveController(incentiveController);
        console.log("  VibeSwapCore.setIncentiveController set");

        vm.stopBroadcast();

        // ============ Verification ============
        console.log("");
        console.log("=== Deployment Verification ===");

        // Verify IncentiveController wiring
        require(address(ic.volatilityOracle()) != address(0), "VolatilityOracle not set");
        require(ic.volatilityInsurancePool() != address(0), "VolatilityInsurancePool not set");
        require(address(ic.ilProtectionVault()) != address(0), "ILProtectionVault not set");
        require(address(ic.slippageGuaranteeFund()) != address(0), "SlippageGuaranteeFund not set");
        require(address(ic.loyaltyRewardsManager()) != address(0), "LoyaltyRewardsManager not set");

        // Verify authorized callers
        require(ic.authorizedCallers(vibeAMM), "VibeAMM not authorized");
        require(ic.authorizedCallers(vibeSwapCore), "VibeSwapCore not authorized");

        console.log("  All verifications passed!");

        // ============ Summary ============
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("VolatilityOracle:        ", volatilityOracle);
        console.log("IncentiveController:     ", incentiveController);
        console.log("VolatilityInsurancePool: ", volatilityInsurancePool);
        console.log("ILProtectionVault:       ", ilProtectionVault);
        console.log("SlippageGuaranteeFund:   ", slippageGuaranteeFund);
        console.log("LoyaltyRewardsManager:   ", loyaltyRewardsManager);
        console.log("MerkleAirdrop:           ", merkleAirdrop);
        console.log("");
        console.log("=== Next Steps ===");
        console.log("1. Copy addresses to .env");
        console.log("2. If ShapleyDistributor not set, run:");
        console.log("   IncentiveController.setShapleyDistributor(SHAPLEY_ADDRESS)");
        console.log("3. Run DeployTokenomics.s.sol if not already done");
        console.log("4. Run DeployIdentity.s.sol for identity layer");
        console.log("5. Fund VolatilityInsurancePool and SlippageGuaranteeFund with initial reserves");
    }
}

/**
 * @title TransferIncentivesOwnership
 * @notice Transfer all incentive contract ownership to multisig
 * @dev Run as final step:
 *      forge script script/DeployIncentives.s.sol:TransferIncentivesOwnership --rpc-url $RPC_URL --broadcast
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Current owner private key
 *   - MULTISIG_ADDRESS: Target multisig address
 *   - INCENTIVE_CONTROLLER: IncentiveController proxy
 *   - VOLATILITY_ORACLE: VolatilityOracle proxy
 *   - VOLATILITY_INSURANCE_POOL: VolatilityInsurancePool proxy
 *   - IL_PROTECTION_VAULT: ILProtectionVault proxy
 *   - SLIPPAGE_GUARANTEE_FUND: SlippageGuaranteeFund proxy
 *   - LOYALTY_REWARDS_MANAGER: LoyaltyRewardsManager proxy
 */
contract TransferIncentivesOwnership is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        address icAddr = vm.envAddress("INCENTIVE_CONTROLLER");
        address voAddr = vm.envAddress("VOLATILITY_ORACLE");
        address vipAddr = vm.envAddress("VOLATILITY_INSURANCE_POOL");
        address ilpAddr = vm.envAddress("IL_PROTECTION_VAULT");
        address sgfAddr = vm.envAddress("SLIPPAGE_GUARANTEE_FUND");
        address lrmAddr = vm.envAddress("LOYALTY_REWARDS_MANAGER");

        vm.startBroadcast(deployerKey);

        IncentiveController(payable(icAddr)).transferOwnership(multisig);
        console.log("IncentiveController ownership -> multisig");

        VolatilityOracle(voAddr).transferOwnership(multisig);
        console.log("VolatilityOracle ownership -> multisig");

        VolatilityInsurancePool(vipAddr).transferOwnership(multisig);
        console.log("VolatilityInsurancePool ownership -> multisig");

        ILProtectionVault(ilpAddr).transferOwnership(multisig);
        console.log("ILProtectionVault ownership -> multisig");

        SlippageGuaranteeFund(sgfAddr).transferOwnership(multisig);
        console.log("SlippageGuaranteeFund ownership -> multisig");

        LoyaltyRewardsManager(lrmAddr).transferOwnership(multisig);
        console.log("LoyaltyRewardsManager ownership -> multisig");

        vm.stopBroadcast();

        console.log("");
        console.log("All incentive contracts transferred to:", multisig);
    }
}
