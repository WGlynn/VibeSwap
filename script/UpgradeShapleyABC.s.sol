// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/incentives/ShapleyDistributor.sol";
import "../contracts/incentives/PoeRevaluation.sol";
import "../contracts/mechanism/AugmentedBondingCurve.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title UpgradeShapleyABC
 * @notice Upgrades ShapleyDistributor to v2 (ABC seal), deploys ABC + POE
 * @dev Run after DeployTokenomics.s.sol:
 *      forge script script/UpgradeShapleyABC.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Steps:
 *   1. Deploy new ShapleyDistributor implementation (with ABC seal)
 *   2. Upgrade existing proxy to new implementation
 *   3. Deploy AugmentedBondingCurve
 *   4. Open the curve (initialize with parameters)
 *   5. Seal the bonding curve on ShapleyDistributor (IRREVERSIBLE)
 *   6. Deploy PoeRevaluation (UUPS proxy)
 *   7. Seal the bonding curve on PoeRevaluation (IRREVERSIBLE)
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Deployer private key (must be owner of ShapleyDistributor proxy)
 *   - SHAPLEY_PROXY: ShapleyDistributor proxy address (from DeployTokenomics)
 *   - VIBE_TOKEN: VIBEToken proxy address (from DeployTokenomics)
 *   - RESERVE_TOKEN: Reserve token address (e.g., USDC on Base)
 *   - EMISSION_CONTROLLER: EmissionController proxy address
 *
 * Optional:
 *   - KAPPA: Bonding curve exponent (default: 6)
 *   - ENTRY_TRIBUTE_BPS: Entry tribute (default: 200 = 2%)
 *   - EXIT_TRIBUTE_BPS: Exit tribute (default: 500 = 5%)
 *   - INITIAL_RESERVE: Initial reserve amount (default: 1000e6 for USDC)
 *   - INITIAL_SUPPLY: Initial token supply (default: from VIBEToken.totalSupply())
 */
contract UpgradeShapleyABC is Script {
    // Deployed addresses
    address public newShapleyImpl;
    address public bondingCurve;
    address public poeImpl;
    address public poeProxy;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Required addresses
        address shapleyProxy = vm.envAddress("SHAPLEY_PROXY");
        address vibeToken = vm.envAddress("VIBE_TOKEN");
        address reserveToken = vm.envAddress("RESERVE_TOKEN");
        address emissionController = vm.envAddress("EMISSION_CONTROLLER");

        // ABC configuration
        uint256 kappa = vm.envOr("KAPPA", uint256(6));
        uint16 entryTributeBps = uint16(vm.envOr("ENTRY_TRIBUTE_BPS", uint256(200)));
        uint16 exitTributeBps = uint16(vm.envOr("EXIT_TRIBUTE_BPS", uint256(500)));

        console.log("=== ShapleyDistributor v2 + ABC + POE Upgrade ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("ShapleyDistributor proxy:", shapleyProxy);
        console.log("VIBEToken:", vibeToken);
        console.log("Reserve token:", reserveToken);
        console.log("Kappa:", kappa);
        console.log("");

        vm.startBroadcast(deployerKey);

        // Step 1: Deploy new ShapleyDistributor implementation (v2 with ABC seal)
        console.log("Step 1: Deploying ShapleyDistributor v2 implementation...");
        newShapleyImpl = address(new ShapleyDistributor());
        console.log("  New impl:", newShapleyImpl);

        // Step 2: Upgrade proxy to v2
        console.log("Step 2: Upgrading ShapleyDistributor proxy...");
        ShapleyDistributor(payable(shapleyProxy)).upgradeToAndCall(newShapleyImpl, "");
        console.log("  Proxy upgraded to v2");

        // Step 3: Deploy AugmentedBondingCurve
        console.log("Step 3: Deploying AugmentedBondingCurve...");
        bondingCurve = address(new AugmentedBondingCurve(
            reserveToken,
            vibeToken,
            vibeToken,  // tokenController = VIBEToken itself (has mint/burn)
            kappa,
            entryTributeBps,
            exitTributeBps
        ));
        console.log("  AugmentedBondingCurve:", bondingCurve);

        // Step 4: Seal bonding curve on ShapleyDistributor (IRREVERSIBLE)
        // NOTE: ABC must be opened first. The seal requires isOpen() == true.
        // The curve will be opened manually after initial reserve is deposited.
        // For now, we deploy and log — sealing happens after curve initialization.
        console.log("Step 4: ABC deployed. Seal after curve initialization.");
        console.log("  Call AugmentedBondingCurve.openCurve(reserve, funding, supply)");
        console.log("  Then ShapleyDistributor.sealBondingCurve(abc_address)");

        // Step 5: Deploy PoeRevaluation (UUPS proxy)
        console.log("Step 5: Deploying PoeRevaluation...");
        poeImpl = address(new PoeRevaluation());
        bytes memory poeInit = abi.encodeWithSelector(
            PoeRevaluation.initialize.selector,
            deployer,           // owner
            vibeToken,          // staking token
            emissionController, // emission controller
            shapleyProxy        // shapley distributor
        );
        poeProxy = address(new ERC1967Proxy(poeImpl, poeInit));
        console.log("  PoeRevaluation impl:", poeImpl);
        console.log("  PoeRevaluation proxy:", poeProxy);

        vm.stopBroadcast();

        // Summary
        console.log("");
        console.log("=== UPGRADE COMPLETE ===");
        console.log("");
        console.log("New ShapleyDistributor impl:", newShapleyImpl);
        console.log("AugmentedBondingCurve:", bondingCurve);
        console.log("PoeRevaluation proxy:", poeProxy);
        console.log("");
        console.log("NEXT STEPS (manual):");
        console.log("  1. Deposit reserve tokens to AugmentedBondingCurve");
        console.log("  2. Call openCurve(reserve, fundingPool, supply)");
        console.log("  3. Call ShapleyDistributor.sealBondingCurve(abc)  [IRREVERSIBLE]");
        console.log("  4. Call PoeRevaluation.sealBondingCurve(abc)      [IRREVERSIBLE]");
        console.log("  5. Call EmissionController.drip() to start emissions");
    }
}
