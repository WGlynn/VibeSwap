// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../contracts/compliance/ComplianceRegistry.sol";
import "../contracts/compliance/ClawbackVault.sol";
import "../contracts/compliance/ClawbackRegistry.sol";
import "../contracts/compliance/FederatedConsensus.sol";

/**
 * @title DeployCompliance
 * @notice Deploys compliance layer contracts (all UUPS):
 *         FederatedConsensus -> ClawbackRegistry -> ClawbackVault -> ComplianceRegistry
 *
 *         Deploy order resolves circular dependency:
 *         1. FederatedConsensus (no deps)
 *         2. ClawbackRegistry (needs FederatedConsensus)
 *         3. ClawbackVault (needs ClawbackRegistry)
 *         4. ComplianceRegistry (no deps)
 *         5. Wire: FederatedConsensus.setExecutor(ClawbackRegistry)
 *         6. Wire: ClawbackRegistry.setVault(ClawbackVault)
 *
 * Required env vars:
 *   PRIVATE_KEY              - Deployer private key
 *
 * Optional env vars:
 *   OWNER_ADDRESS            - Owner (defaults to deployer)
 *   VIBESWAP_CORE            - VibeSwapCore address (for authorized tracker)
 *   COMMIT_REVEAL_AUCTION    - CommitRevealAuction address (to set compliance registry)
 */
contract DeployCompliance is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        address vibeSwapCore = vm.envOr("VIBESWAP_CORE", address(0));

        vm.startBroadcast(deployerKey);

        // ============ 1. FederatedConsensus (UUPS) ============

        FederatedConsensus fcImpl = new FederatedConsensus();
        ERC1967Proxy fcProxy = new ERC1967Proxy(
            address(fcImpl),
            abi.encodeCall(FederatedConsensus.initialize, (
                owner,
                3,       // approval threshold (3-of-N)
                2 days   // grace period
            ))
        );
        address federatedConsensus = address(fcProxy);
        console.log("FederatedConsensus:", federatedConsensus);

        // ============ 2. ClawbackRegistry (UUPS) ============

        ClawbackRegistry crImpl = new ClawbackRegistry();
        ERC1967Proxy crProxy = new ERC1967Proxy(
            address(crImpl),
            abi.encodeCall(ClawbackRegistry.initialize, (
                owner,
                federatedConsensus,
                5,       // max cascade depth (5 hops)
                1e15     // min taint amount (0.001 tokens - dust filter)
            ))
        );
        address clawbackRegistry = address(crProxy);
        console.log("ClawbackRegistry:", clawbackRegistry);

        // ============ 3. ClawbackVault (UUPS) ============

        ClawbackVault cvImpl = new ClawbackVault();
        ERC1967Proxy cvProxy = new ERC1967Proxy(
            address(cvImpl),
            abi.encodeCall(ClawbackVault.initialize, (
                owner,
                clawbackRegistry
            ))
        );
        address clawbackVault = address(cvProxy);
        console.log("ClawbackVault:", clawbackVault);

        // ============ 4. ComplianceRegistry (UUPS) ============

        ComplianceRegistry compImpl = new ComplianceRegistry();
        ERC1967Proxy compProxy = new ERC1967Proxy(
            address(compImpl),
            abi.encodeCall(ComplianceRegistry.initialize, (owner))
        );
        address complianceRegistry = address(compProxy);
        console.log("ComplianceRegistry:", complianceRegistry);

        // ============ 5. Post-deploy wiring ============

        // Resolve circular dependency
        FederatedConsensus(federatedConsensus).setExecutor(clawbackRegistry);
        console.log("  FederatedConsensus.setExecutor -> ClawbackRegistry");

        ClawbackRegistry(clawbackRegistry).setVault(clawbackVault);
        console.log("  ClawbackRegistry.setVault -> ClawbackVault");

        // Authorize VibeSwapCore as transaction tracker (for taint propagation)
        if (vibeSwapCore != address(0)) {
            ClawbackRegistry(clawbackRegistry).setAuthorizedTracker(vibeSwapCore, true);
            console.log("  ClawbackRegistry.setAuthorizedTracker -> VibeSwapCore");

            ComplianceRegistry(complianceRegistry).setAuthorizedContract(vibeSwapCore, true);
            console.log("  ComplianceRegistry.setAuthorizedContract -> VibeSwapCore");
        }

        vm.stopBroadcast();

        // ============ Summary ============
        console.log("");
        console.log("=== Compliance Deployment Summary ===");
        console.log("FederatedConsensus:", federatedConsensus);
        console.log("ClawbackRegistry:", clawbackRegistry);
        console.log("ClawbackVault:", clawbackVault);
        console.log("ComplianceRegistry:", complianceRegistry);
        console.log("");
        console.log("POST-DEPLOY:");
        console.log("  1. FederatedConsensus.addAuthority(addr, role, jurisdiction) for each authority");
        console.log("  2. ComplianceRegistry.setComplianceOfficer(addr, true)");
        console.log("  3. ComplianceRegistry.setKYCProvider(addr, true)");
        console.log("  4. CommitRevealAuction: redeploy or upgrade with complianceRegistry set");
        console.log("  5. VibeSwapCore.setClawbackRegistry(clawbackRegistry) if setter exists");
    }
}

/**
 * @title TransferComplianceOwnership
 * @notice Transfer compliance contract ownership to multisig
 */
contract TransferComplianceOwnership is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        vm.startBroadcast(deployerKey);

        address fc = vm.envAddress("FEDERATED_CONSENSUS");
        FederatedConsensus(fc).transferOwnership(multisig);
        console.log("FederatedConsensus ownership -> multisig");

        address cr = vm.envAddress("CLAWBACK_REGISTRY");
        ClawbackRegistry(cr).transferOwnership(multisig);
        console.log("ClawbackRegistry ownership -> multisig");

        address cv = vm.envAddress("CLAWBACK_VAULT");
        ClawbackVault(cv).transferOwnership(multisig);
        console.log("ClawbackVault ownership -> multisig");

        address comp = vm.envAddress("COMPLIANCE_REGISTRY");
        ComplianceRegistry(comp).transferOwnership(multisig);
        console.log("ComplianceRegistry ownership -> multisig");

        vm.stopBroadcast();
    }
}
