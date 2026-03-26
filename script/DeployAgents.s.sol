// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Tier 1: Foundation ============
import "../contracts/agents/VibeAgentProtocol.sol";
import "../contracts/agents/VibeAgentReputation.sol";
import "../contracts/agents/VibeAgentMemory.sol";
import "../contracts/agents/VibeAgentPersistence.sol";

// ============ Tier 2: Network Infrastructure ============
import "../contracts/agents/VibeAgentNetwork.sol";
import "../contracts/agents/VibeAgentConsensus.sol";
import "../contracts/agents/VibeTaskEngine.sol";
import "../contracts/agents/VibeAgentOrchestrator.sol";

// ============ Tier 3: Domain Services ============
import "../contracts/agents/VibeAgentTrading.sol";
import "../contracts/agents/VibeAgentMarketplace.sol";
import "../contracts/agents/VibeSecurityOracle.sol";
import "../contracts/agents/VibeAgentAnalytics.sol";
import "../contracts/agents/VibeAgentGovernance.sol";
import "../contracts/agents/VibeAgentInsurance.sol";
import "../contracts/agents/VibeAgentSelfImprovement.sol";

/**
 * @title DeployAgents — Deploy the VSOS AI Agent Infrastructure (15 contracts)
 * @notice Deploys the full agent stack in dependency order via UUPS proxies:
 *
 *         Tier 1 (Foundation):
 *           1. VibeAgentProtocol     — Agent identity, skills, tasks, CRPC
 *           2. VibeAgentReputation   — Multi-dimensional reputation scoring
 *           3. VibeAgentMemory       — Episodic/semantic/procedural memory layer
 *           4. VibeAgentPersistence  — Persistent memory banks with decay
 *
 *         Tier 2 (Network Infrastructure):
 *           5. VibeAgentNetwork      — Discovery, messaging, teams
 *           6. VibeAgentConsensus    — Byzantine consensus (commit-reveal + PoW + PoM)
 *           7. VibeTaskEngine        — Hierarchical task DAG decomposition
 *           8. VibeAgentOrchestrator — Multi-agent workflows and swarms
 *
 *         Tier 3 (Domain Services):
 *           9.  VibeAgentTrading         — Autonomous strategy vaults + copy trading
 *           10. VibeAgentMarketplace     — Agent hire marketplace (Shapley matching)
 *           11. VibeSecurityOracle       — Decentralized security audit protocol
 *           12. VibeAgentAnalytics       — Privacy-preserving conversation analytics
 *           13. VibeAgentGovernance      — AI agent DAO participation (bounded autonomy)
 *           14. VibeAgentInsurance       — Risk pools for agent operations
 *           15. VibeAgentSelfImprovement — Recursive self-improvement with safety bounds
 *
 * @dev Usage:
 *   forge script script/DeployAgents.s.sol --rpc-url $RPC --broadcast
 *
 *   Required env vars:
 *     PRIVATE_KEY          — deployer private key
 *
 *   Optional env vars:
 *     MULTISIG             — address for ownership transfer (skip if not set)
 *     CONSENSUS_MIN_STAKE  — min stake for consensus rounds (default: 0.01 ether)
 *     CONSENSUS_POW_DIFF   — PoW difficulty target (default: type(uint256).max / 1000)
 *     ARBITRATOR           — marketplace arbitrator address (default: deployer)
 */
contract DeployAgents is Script {
    // ============ Deployed Addresses ============

    // Tier 1
    address public agentProtocol;
    address public agentReputation;
    address public agentMemory;
    address public agentPersistence;

    // Tier 2
    address public agentNetwork;
    address public agentConsensus;
    address public taskEngine;
    address public agentOrchestrator;

    // Tier 3
    address public agentTrading;
    address public agentMarketplace;
    address public securityOracle;
    address public agentAnalytics;
    address public agentGovernance;
    address public agentInsurance;
    address public agentSelfImprovement;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Optional config
        address multisig = vm.envOr("MULTISIG", address(0));
        uint256 consensusMinStake = vm.envOr("CONSENSUS_MIN_STAKE", uint256(0.01 ether));
        uint256 consensusPowDiff = vm.envOr("CONSENSUS_POW_DIFF", type(uint256).max / 1000);
        address arbitrator = vm.envOr("ARBITRATOR", deployer);

        console.log("=== VSOS AI Agent Infrastructure Deployment ===");
        console.log("Deployer:", deployer);
        if (multisig != address(0)) {
            console.log("Multisig (ownership target):", multisig);
        }
        console.log("Arbitrator:", arbitrator);
        console.log("Consensus min stake:", consensusMinStake);
        console.log("");

        vm.startBroadcast(deployerKey);

        // ============ Tier 1: Foundation ============

        console.log("--- Tier 1: Foundation ---");

        // 1. VibeAgentProtocol
        agentProtocol = _deployProxy(
            address(new VibeAgentProtocol()),
            abi.encodeCall(VibeAgentProtocol.initialize, ()),
            "VibeAgentProtocol"
        );

        // 2. VibeAgentReputation
        agentReputation = _deployProxy(
            address(new VibeAgentReputation()),
            abi.encodeCall(VibeAgentReputation.initialize, ()),
            "VibeAgentReputation"
        );

        // 3. VibeAgentMemory (takes owner address)
        agentMemory = _deployProxy(
            address(new VibeAgentMemory()),
            abi.encodeCall(VibeAgentMemory.initialize, (deployer)),
            "VibeAgentMemory"
        );

        // 4. VibeAgentPersistence
        agentPersistence = _deployProxy(
            address(new VibeAgentPersistence()),
            abi.encodeCall(VibeAgentPersistence.initialize, ()),
            "VibeAgentPersistence"
        );

        console.log("");

        // ============ Tier 2: Network Infrastructure ============

        console.log("--- Tier 2: Network Infrastructure ---");

        // 5. VibeAgentNetwork
        agentNetwork = _deployProxy(
            address(new VibeAgentNetwork()),
            abi.encodeCall(VibeAgentNetwork.initialize, ()),
            "VibeAgentNetwork"
        );

        // 6. VibeAgentConsensus (takes minStake, powDifficulty)
        agentConsensus = _deployProxy(
            address(new VibeAgentConsensus()),
            abi.encodeCall(VibeAgentConsensus.initialize, (consensusMinStake, consensusPowDiff)),
            "VibeAgentConsensus"
        );

        // 7. VibeTaskEngine
        taskEngine = _deployProxy(
            address(new VibeTaskEngine()),
            abi.encodeCall(VibeTaskEngine.initialize, ()),
            "VibeTaskEngine"
        );

        // 8. VibeAgentOrchestrator
        agentOrchestrator = _deployProxy(
            address(new VibeAgentOrchestrator()),
            abi.encodeCall(VibeAgentOrchestrator.initialize, ()),
            "VibeAgentOrchestrator"
        );

        console.log("");

        // ============ Tier 3: Domain Services ============

        console.log("--- Tier 3: Domain Services ---");

        // 9. VibeAgentTrading
        agentTrading = _deployProxy(
            address(new VibeAgentTrading()),
            abi.encodeCall(VibeAgentTrading.initialize, ()),
            "VibeAgentTrading"
        );

        // 10. VibeAgentMarketplace (takes arbitrator address)
        agentMarketplace = _deployProxy(
            address(new VibeAgentMarketplace()),
            abi.encodeCall(VibeAgentMarketplace.initialize, (arbitrator)),
            "VibeAgentMarketplace"
        );

        // 11. VibeSecurityOracle
        securityOracle = _deployProxy(
            address(new VibeSecurityOracle()),
            abi.encodeCall(VibeSecurityOracle.initialize, ()),
            "VibeSecurityOracle"
        );

        // 12. VibeAgentAnalytics
        agentAnalytics = _deployProxy(
            address(new VibeAgentAnalytics()),
            abi.encodeCall(VibeAgentAnalytics.initialize, ()),
            "VibeAgentAnalytics"
        );

        // 13. VibeAgentGovernance
        agentGovernance = _deployProxy(
            address(new VibeAgentGovernance()),
            abi.encodeCall(VibeAgentGovernance.initialize, ()),
            "VibeAgentGovernance"
        );

        // 14. VibeAgentInsurance
        agentInsurance = _deployProxy(
            address(new VibeAgentInsurance()),
            abi.encodeCall(VibeAgentInsurance.initialize, ()),
            "VibeAgentInsurance"
        );

        // 15. VibeAgentSelfImprovement
        agentSelfImprovement = _deployProxy(
            address(new VibeAgentSelfImprovement()),
            abi.encodeCall(VibeAgentSelfImprovement.initialize, ()),
            "VibeAgentSelfImprovement"
        );

        console.log("");

        // ============ Verification ============

        console.log("--- Verification ---");
        require(VibeAgentProtocol(payable(agentProtocol)).platformFeeBps() == 500, "Protocol fee mismatch");
        console.log("  VibeAgentProtocol: platformFeeBps = 500 (5%)");

        require(VibeAgentConsensus(payable(agentConsensus)).minStake() == consensusMinStake, "Consensus minStake mismatch");
        console.log("  VibeAgentConsensus: minStake verified");

        require(VibeAgentMarketplace(payable(agentMarketplace)).arbitrator() == arbitrator, "Marketplace arbitrator mismatch");
        console.log("  VibeAgentMarketplace: arbitrator verified");

        require(VibeAgentAnalytics(payable(agentAnalytics)).qualityAlertThreshold() == 3000, "Analytics threshold mismatch");
        console.log("  VibeAgentAnalytics: qualityAlertThreshold = 3000");

        console.log("  All verifications passed");
        console.log("");

        // ============ Ownership Transfer (Multisig) ============

        if (multisig != address(0)) {
            console.log("--- Ownership Transfer to Multisig ---");
            _transferOwnership(agentProtocol, multisig, "VibeAgentProtocol");
            _transferOwnership(agentReputation, multisig, "VibeAgentReputation");
            _transferOwnership(agentMemory, multisig, "VibeAgentMemory");
            _transferOwnership(agentPersistence, multisig, "VibeAgentPersistence");
            _transferOwnership(agentNetwork, multisig, "VibeAgentNetwork");
            _transferOwnership(agentConsensus, multisig, "VibeAgentConsensus");
            _transferOwnership(taskEngine, multisig, "VibeTaskEngine");
            _transferOwnership(agentOrchestrator, multisig, "VibeAgentOrchestrator");
            _transferOwnership(agentTrading, multisig, "VibeAgentTrading");
            _transferOwnership(agentMarketplace, multisig, "VibeAgentMarketplace");
            _transferOwnership(securityOracle, multisig, "VibeSecurityOracle");
            _transferOwnership(agentAnalytics, multisig, "VibeAgentAnalytics");
            _transferOwnership(agentGovernance, multisig, "VibeAgentGovernance");
            _transferOwnership(agentInsurance, multisig, "VibeAgentInsurance");
            _transferOwnership(agentSelfImprovement, multisig, "VibeAgentSelfImprovement");
            console.log("  All 15 contracts transferred to:", multisig);
            console.log("");
        }

        vm.stopBroadcast();

        // ============ Summary ============

        console.log("=== Agent Infrastructure Deployed Successfully ===");
        console.log("");
        console.log("Tier 1 (Foundation):");
        console.log("  AGENT_PROTOCOL=", agentProtocol);
        console.log("  AGENT_REPUTATION=", agentReputation);
        console.log("  AGENT_MEMORY=", agentMemory);
        console.log("  AGENT_PERSISTENCE=", agentPersistence);
        console.log("");
        console.log("Tier 2 (Network Infrastructure):");
        console.log("  AGENT_NETWORK=", agentNetwork);
        console.log("  AGENT_CONSENSUS=", agentConsensus);
        console.log("  TASK_ENGINE=", taskEngine);
        console.log("  AGENT_ORCHESTRATOR=", agentOrchestrator);
        console.log("");
        console.log("Tier 3 (Domain Services):");
        console.log("  AGENT_TRADING=", agentTrading);
        console.log("  AGENT_MARKETPLACE=", agentMarketplace);
        console.log("  SECURITY_ORACLE=", securityOracle);
        console.log("  AGENT_ANALYTICS=", agentAnalytics);
        console.log("  AGENT_GOVERNANCE=", agentGovernance);
        console.log("  AGENT_INSURANCE=", agentInsurance);
        console.log("  AGENT_SELF_IMPROVEMENT=", agentSelfImprovement);
        console.log("");
        console.log("POST-DEPLOY:");
        console.log("  1. Add claim verifiers:  VibeAgentInsurance.addVerifier(addr)");
        console.log("  2. Add expert panel:     VibeSecurityOracle.addExpert(addr)");
        console.log("  3. Add memory validators: VibeAgentMemory.setValidator(addr, true)");
        console.log("  4. Add SI approvers:     VibeAgentSelfImprovement.addApprover(addr)");
        console.log("  5. Set safety bounds:    VibeAgentSelfImprovement.setSafetyBounds(...)");
        console.log("  6. Wire agent operators:  VibeAgentOrchestrator.registerAgentOperator(...)");
        if (multisig == address(0)) {
            console.log("  7. Transfer ownership:   Set MULTISIG env and re-run, or call transferOwnership()");
        }
        console.log("");
        console.log("Nothing is promised. Everything is earned.");
    }

    // ============ Helpers ============

    /**
     * @notice Deploy a UUPS proxy with implementation and initializer
     */
    function _deployProxy(
        address implementation,
        bytes memory initData,
        string memory name
    ) internal returns (address proxy) {
        ERC1967Proxy p = new ERC1967Proxy(implementation, initData);
        proxy = address(p);
        console.log(string.concat("  ", name, ":"), proxy);
    }

    /**
     * @notice Transfer ownership of an OwnableUpgradeable proxy to a new owner
     */
    function _transferOwnership(
        address proxy,
        address newOwner,
        string memory name
    ) internal {
        OwnableUpgradeable(proxy).transferOwnership(newOwner);
        console.log(string.concat("  ", name, " -> transferred"));
    }
}

/**
 * @title TransferAgentOwnership
 * @notice Standalone script to transfer ownership of all agent contracts to a multisig.
 *         Use this post-deploy when the MULTISIG address is available.
 *
 * @dev Usage:
 *   forge script script/DeployAgents.s.sol:TransferAgentOwnership --rpc-url $RPC --broadcast
 *
 *   Required env vars:
 *     PRIVATE_KEY              — current owner private key
 *     MULTISIG                 — new owner address
 *     AGENT_PROTOCOL           — proxy address
 *     AGENT_REPUTATION         — proxy address
 *     AGENT_MEMORY             — proxy address
 *     AGENT_PERSISTENCE        — proxy address
 *     AGENT_NETWORK            — proxy address
 *     AGENT_CONSENSUS          — proxy address
 *     TASK_ENGINE              — proxy address
 *     AGENT_ORCHESTRATOR       — proxy address
 *     AGENT_TRADING            — proxy address
 *     AGENT_MARKETPLACE        — proxy address
 *     SECURITY_ORACLE          — proxy address
 *     AGENT_ANALYTICS          — proxy address
 *     AGENT_GOVERNANCE         — proxy address
 *     AGENT_INSURANCE          — proxy address
 *     AGENT_SELF_IMPROVEMENT   — proxy address
 */
contract TransferAgentOwnership is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address multisig = vm.envAddress("MULTISIG");

        address[15] memory proxies = [
            vm.envAddress("AGENT_PROTOCOL"),
            vm.envAddress("AGENT_REPUTATION"),
            vm.envAddress("AGENT_MEMORY"),
            vm.envAddress("AGENT_PERSISTENCE"),
            vm.envAddress("AGENT_NETWORK"),
            vm.envAddress("AGENT_CONSENSUS"),
            vm.envAddress("TASK_ENGINE"),
            vm.envAddress("AGENT_ORCHESTRATOR"),
            vm.envAddress("AGENT_TRADING"),
            vm.envAddress("AGENT_MARKETPLACE"),
            vm.envAddress("SECURITY_ORACLE"),
            vm.envAddress("AGENT_ANALYTICS"),
            vm.envAddress("AGENT_GOVERNANCE"),
            vm.envAddress("AGENT_INSURANCE"),
            vm.envAddress("AGENT_SELF_IMPROVEMENT")
        ];

        string[15] memory names = [
            "VibeAgentProtocol",
            "VibeAgentReputation",
            "VibeAgentMemory",
            "VibeAgentPersistence",
            "VibeAgentNetwork",
            "VibeAgentConsensus",
            "VibeTaskEngine",
            "VibeAgentOrchestrator",
            "VibeAgentTrading",
            "VibeAgentMarketplace",
            "VibeSecurityOracle",
            "VibeAgentAnalytics",
            "VibeAgentGovernance",
            "VibeAgentInsurance",
            "VibeAgentSelfImprovement"
        ];

        console.log("=== Agent Ownership Transfer ===");
        console.log("From:", deployer);
        console.log("To:  ", multisig);
        console.log("");

        vm.startBroadcast(deployerKey);

        for (uint256 i = 0; i < 15; i++) {
            OwnableUpgradeable(proxies[i]).transferOwnership(multisig);
            console.log(string.concat("  ", names[i], " -> transferred"));
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== All 15 agent contracts transferred to multisig ===");
        console.log("Multisig must call acceptOwnership() if using Ownable2Step.");
    }
}
