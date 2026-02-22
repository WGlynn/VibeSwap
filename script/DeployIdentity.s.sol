// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/identity/SoulboundIdentity.sol";
import "../contracts/identity/ContributionDAG.sol";
import "../contracts/identity/RewardLedger.sol";
import "../contracts/identity/ContributionAttestor.sol";
import "../contracts/identity/VibeCode.sol";
import "../contracts/identity/AgentRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployIdentity
 * @notice Deploys the identity and contribution tracking layer
 * @dev Run after DeployTokenomics.s.sol (needs VIBEToken address for RewardLedger):
 *      forge script script/DeployIdentity.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * Deploys:
 *   1. SoulboundIdentity (UUPS proxy) — non-transferable identity NFTs
 *   2. AgentRegistry (UUPS proxy) — ERC-8004 AI agent identities
 *   3. ContributionDAG (constructor) — trust graph + Merkle vouch tree
 *   4. VibeCode (constructor) — behavioral fingerprint (human + AI)
 *   5. RewardLedger (constructor) — retroactive + active Shapley rewards
 *   6. ContributionAttestor (constructor) — 3-factor contribution verification
 *
 * After this, run GenesisContributions.s.sol to record founder contributions.
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Deployer private key
 *   - VIBE_TOKEN: VIBEToken proxy address (from DeployTokenomics)
 *
 * Optional environment variables:
 *   - OWNER_ADDRESS: Override owner (defaults to deployer)
 *   - ATTESTOR_THRESHOLD: Attestation acceptance threshold (default: 3)
 *   - CLAIM_TTL: Attestation claim TTL in seconds (default: 30 days)
 */
contract DeployIdentity is Script {
    // UUPS proxies
    address public soulboundIdentityImpl;
    address public agentRegistryImpl;
    address public soulboundIdentity;
    address public agentRegistry;

    // Non-upgradeable
    address public contributionDAG;
    address public vibeCode;
    address public rewardLedger;
    address public contributionAttestor;

    // Config
    address public owner;
    address public vibeToken;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        owner = vm.envOr("OWNER_ADDRESS", deployer);
        vibeToken = vm.envAddress("VIBE_TOKEN");

        uint256 attestorThreshold = vm.envOr("ATTESTOR_THRESHOLD", uint256(3));
        uint256 claimTTL = vm.envOr("CLAIM_TTL", uint256(30 days));

        console.log("=== VibeSwap Identity Layer Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Owner:", owner);
        console.log("VIBEToken:", vibeToken);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy SoulboundIdentity (UUPS proxy)
        console.log("Step 1: Deploying SoulboundIdentity...");
        soulboundIdentityImpl = address(new SoulboundIdentity());
        bytes memory sbiInit = abi.encodeWithSelector(SoulboundIdentity.initialize.selector);
        soulboundIdentity = address(new ERC1967Proxy(soulboundIdentityImpl, sbiInit));
        console.log("  SoulboundIdentity impl:", soulboundIdentityImpl);
        console.log("  SoulboundIdentity proxy:", soulboundIdentity);

        // Step 2: Deploy AgentRegistry (UUPS proxy)
        console.log("Step 2: Deploying AgentRegistry...");
        agentRegistryImpl = address(new AgentRegistry());
        bytes memory agentInit = abi.encodeWithSelector(AgentRegistry.initialize.selector);
        agentRegistry = address(new ERC1967Proxy(agentRegistryImpl, agentInit));
        console.log("  AgentRegistry impl:", agentRegistryImpl);
        console.log("  AgentRegistry proxy:", agentRegistry);

        // Step 3: Deploy ContributionDAG (needs SoulboundIdentity)
        console.log("Step 3: Deploying ContributionDAG...");
        contributionDAG = address(new ContributionDAG(soulboundIdentity));
        console.log("  ContributionDAG:", contributionDAG);

        // Step 4: Deploy VibeCode
        console.log("Step 4: Deploying VibeCode...");
        vibeCode = address(new VibeCode());
        console.log("  VibeCode:", vibeCode);

        // Step 5: Deploy RewardLedger (needs VIBEToken + ContributionDAG)
        console.log("Step 5: Deploying RewardLedger...");
        rewardLedger = address(new RewardLedger(vibeToken, contributionDAG));
        console.log("  RewardLedger:", rewardLedger);

        // Step 6: Deploy ContributionAttestor (needs ContributionDAG)
        console.log("Step 6: Deploying ContributionAttestor...");
        contributionAttestor = address(new ContributionAttestor(
            contributionDAG,
            attestorThreshold,
            claimTTL
        ));
        console.log("  ContributionAttestor:", contributionAttestor);

        // Step 7: Verify
        console.log("Step 7: Running verification...");
        _verify();

        vm.stopBroadcast();

        _outputSummary();
    }

    function _verify() internal view {
        require(soulboundIdentity.code.length > 0, "SoulboundIdentity proxy has no code");
        require(agentRegistry.code.length > 0, "AgentRegistry proxy has no code");
        require(contributionDAG.code.length > 0, "ContributionDAG has no code");
        require(vibeCode.code.length > 0, "VibeCode has no code");
        require(rewardLedger.code.length > 0, "RewardLedger has no code");
        require(contributionAttestor.code.length > 0, "ContributionAttestor has no code");

        console.log("  All verifications passed");
    }

    function _outputSummary() internal view {
        console.log("");
        console.log("=== IDENTITY LAYER DEPLOYMENT SUCCESSFUL ===");
        console.log("");
        console.log("UUPS Proxies:");
        console.log("  SOULBOUND_IDENTITY=", soulboundIdentity);
        console.log("  AGENT_REGISTRY=", agentRegistry);
        console.log("");
        console.log("Non-Upgradeable:");
        console.log("  CONTRIBUTION_DAG=", contributionDAG);
        console.log("  VIBE_CODE=", vibeCode);
        console.log("  REWARD_LEDGER=", rewardLedger);
        console.log("  CONTRIBUTION_ATTESTOR=", contributionAttestor);
        console.log("");
        console.log("Identity Architecture:");
        console.log("  Humans  -> SoulboundIdentity (non-transferable) + VibeCode");
        console.log("  AI      -> AgentRegistry (delegatable) + VibeCode");
        console.log("  Both    -> ContributionDAG (web of trust)");
        console.log("  Verify  -> ContributionAttestor (3-factor validation)");
        console.log("");
        console.log("Next steps:");
        console.log("1. Run GenesisContributions.s.sol to record founder contributions");
        console.log("2. Founders call ContributionDAG.vouch() for mutual trust links");
        console.log("3. Mint SoulboundIdentity NFTs for each founder");
        console.log("4. Submit governance vote to approve retroactive values");
        console.log("5. After all 3 factors confirmed, call RewardLedger.finalizeRetroactive()");
        console.log("=============================================");
        console.log("");
        console.log("// Copy these to your .env file:");
        console.log(string(abi.encodePacked("SOULBOUND_IDENTITY=", vm.toString(soulboundIdentity))));
        console.log(string(abi.encodePacked("AGENT_REGISTRY=", vm.toString(agentRegistry))));
        console.log(string(abi.encodePacked("CONTRIBUTION_DAG=", vm.toString(contributionDAG))));
        console.log(string(abi.encodePacked("VIBE_CODE=", vm.toString(vibeCode))));
        console.log(string(abi.encodePacked("REWARD_LEDGER=", vm.toString(rewardLedger))));
        console.log(string(abi.encodePacked("CONTRIBUTION_ATTESTOR=", vm.toString(contributionAttestor))));
    }
}
