// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

import "../contracts/core/TrinityGuardian.sol";
import "../contracts/core/ProofOfMind.sol";
import "../contracts/core/HoneypotDefense.sol";
import "../contracts/core/OmniscientAdversaryDefense.sol";

/**
 * @title DeployCoreSecurity
 * @notice Deploys the core security and consensus contracts:
 *         1. TrinityGuardian — immutable BFT node protection (no admin, no pause, no kill switch)
 *         2. ProofOfMind — hybrid PoW/PoS/PoM consensus primitive
 *         3. HoneypotDefense — MEV trap and frontrun detection
 *         4. OmniscientAdversaryDefense — game-theoretic adversarial resilience
 *
 * @dev These are all non-upgradeable by design. TrinityGuardian explicitly has NO owner,
 *      NO pause, NO kill switch. "Not even by me." — Will
 *
 *      Run after DeployProduction.s.sol:
 *      forge script script/DeployCoreSecurity.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * Required env vars:
 *   PRIVATE_KEY              — Deployer private key
 *
 * Optional env vars:
 *   VIBESWAP_CORE            — VibeSwapCore proxy address (for HoneypotDefense wiring)
 *   COMMIT_REVEAL_AUCTION    — CommitRevealAuction proxy (for OmniscientAdversaryDefense)
 */
contract DeployCoreSecurity is Script {
    address public trinityGuardian;
    address public proofOfMind;
    address public honeypotDefense;
    address public omniscientAdversaryDefense;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address vibeSwapCore = vm.envOr("VIBESWAP_CORE", address(0));
        address commitRevealAuction = vm.envOr("COMMIT_REVEAL_AUCTION", address(0));

        console.log("=== Core Security Layer Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        if (vibeSwapCore != address(0)) {
            console.log("VibeSwapCore:", vibeSwapCore);
        }
        console.log("");

        vm.startBroadcast(deployerKey);

        // ============ 1. TrinityGuardian (Immutable — No Owner) ============

        console.log("Step 1: Deploying TrinityGuardian...");
        trinityGuardian = address(new TrinityGuardian());
        console.log("  TrinityGuardian:", trinityGuardian);
        console.log("  WARNING: No owner, no pause, no kill switch. This is permanent.");
        console.log("  Nodes self-register with stake. 2/3 BFT consensus required.");

        // ============ 2. ProofOfMind (Non-Upgradeable) ============

        console.log("Step 2: Deploying ProofOfMind...");
        proofOfMind = address(new ProofOfMind());
        console.log("  ProofOfMind:", proofOfMind);
        console.log("  Weights: Stake 30%, PoW 10%, Mind 60%");

        // ============ 3. HoneypotDefense (Non-Upgradeable) ============

        console.log("Step 3: Deploying HoneypotDefense...");
        honeypotDefense = address(new HoneypotDefense());
        console.log("  HoneypotDefense:", honeypotDefense);

        // ============ 4. OmniscientAdversaryDefense (Non-Upgradeable) ============

        console.log("Step 4: Deploying OmniscientAdversaryDefense...");
        omniscientAdversaryDefense = address(new OmniscientAdversaryDefense());
        console.log("  OmniscientAdversaryDefense:", omniscientAdversaryDefense);

        vm.stopBroadcast();

        // ============ Verification ============

        console.log("");
        console.log("=== Verification ===");
        require(trinityGuardian.code.length > 0, "TrinityGuardian has no code");
        require(proofOfMind.code.length > 0, "ProofOfMind has no code");
        require(honeypotDefense.code.length > 0, "HoneypotDefense has no code");
        require(omniscientAdversaryDefense.code.length > 0, "OmniscientAdversaryDefense has no code");
        console.log("  All contracts verified");

        // ============ Summary ============

        console.log("");
        console.log("=== Core Security Deployment Summary ===");
        console.log("");
        console.log("Non-Upgradeable (by design):");
        console.log("  TRINITY_GUARDIAN=", trinityGuardian);
        console.log("  PROOF_OF_MIND=", proofOfMind);
        console.log("  HONEYPOT_DEFENSE=", honeypotDefense);
        console.log("  OMNISCIENT_ADVERSARY_DEFENSE=", omniscientAdversaryDefense);
        console.log("");
        console.log("POST-DEPLOY:");
        console.log("  1. TrinityGuardian: Each Jarvis node calls register() with stake");
        console.log("  2. ProofOfMind: Nodes call joinAsMindNode() with stake + mind score");
        console.log("  3. Wire HoneypotDefense into VibeSwapCore monitoring (if setter exists)");
        console.log("  4. Set OmniscientAdversaryDefense on CommitRevealAuction (if setter exists)");
        console.log("  5. Start heartbeat cron job for TrinityGuardian nodes");
        console.log("============================================");
        console.log("");
        console.log("// Copy these to your .env file:");
        console.log(string(abi.encodePacked("TRINITY_GUARDIAN=", vm.toString(trinityGuardian))));
        console.log(string(abi.encodePacked("PROOF_OF_MIND=", vm.toString(proofOfMind))));
        console.log(string(abi.encodePacked("HONEYPOT_DEFENSE=", vm.toString(honeypotDefense))));
        console.log(string(abi.encodePacked("OMNISCIENT_ADVERSARY_DEFENSE=", vm.toString(omniscientAdversaryDefense))));
    }
}
