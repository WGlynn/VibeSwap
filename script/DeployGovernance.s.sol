// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../contracts/governance/TreasuryStabilizer.sol";
import "../contracts/governance/VibeTimelock.sol";
import "../contracts/governance/VibeKeeperNetwork.sol";
import "../contracts/governance/DisputeResolver.sol";

/**
 * @title DeployGovernance
 * @notice Deploys governance layer contracts:
 *         TreasuryStabilizer (UUPS), VibeTimelock, VibeKeeperNetwork, DisputeResolver (UUPS)
 *
 *         Note: CircuitBreaker is an abstract mixin inherited by VibeSwapCore,
 *         not an independently deployable contract.
 *
 * Required env vars:
 *   PRIVATE_KEY              - Deployer private key
 *   VIBE_AMM                 - VibeAMM proxy address (from DeployProduction)
 *   DAO_TREASURY             - DAOTreasury proxy address (from DeployProduction)
 *   VOLATILITY_ORACLE        - VolatilityOracle proxy address (from DeployIncentives)
 *
 * Optional env vars:
 *   OWNER_ADDRESS            - Owner (defaults to deployer)
 *   GUARDIAN_ADDRESS          - Guardian for timelock (defaults to owner)
 *   JOULE_TOKEN              - Joule token address (from DeployTokenomics, for timelock/keeper)
 *   REPUTATION_ORACLE        - ReputationOracle address (for timelock/keeper)
 *   FEDERATED_CONSENSUS      - FederatedConsensus address (from DeployCompliance, for DisputeResolver)
 */
contract DeployGovernance is Script {
    function _deployStabilizer(address owner, address vibeAMM, address daoTreasury, address volatilityOracle)
        internal returns (address)
    {
        TreasuryStabilizer stabImpl = new TreasuryStabilizer();
        ERC1967Proxy stabProxy = new ERC1967Proxy(
            address(stabImpl),
            abi.encodeCall(TreasuryStabilizer.initialize, (owner, vibeAMM, daoTreasury, volatilityOracle))
        );
        address addr = address(stabProxy);
        console.log("TreasuryStabilizer:", addr);
        return addr;
    }

    function _deployTimelock(address owner, address guardian, address jouleToken, address reputationOracle)
        internal returns (address)
    {
        address[] memory proposers = new address[](1);
        proposers[0] = owner;
        address[] memory executors = new address[](1);
        executors[0] = owner;
        address[] memory cancellers = new address[](1);
        cancellers[0] = guardian;
        VibeTimelock timelock = new VibeTimelock(
            2 days, jouleToken, reputationOracle, guardian, proposers, executors, cancellers
        );
        address addr = address(timelock);
        console.log("VibeTimelock:", addr);
        return addr;
    }

    function _deployKeeper(address jouleToken, address reputationOracle) internal returns (address) {
        VibeKeeperNetwork keeper = new VibeKeeperNetwork(jouleToken, reputationOracle);
        address addr = address(keeper);
        console.log("VibeKeeperNetwork:", addr);
        return addr;
    }

    function _deployDisputeResolver(address owner, address federatedConsensus) internal returns (address) {
        DisputeResolver drImpl = new DisputeResolver();
        ERC1967Proxy drProxy = new ERC1967Proxy(
            address(drImpl),
            abi.encodeCall(DisputeResolver.initialize, (owner, federatedConsensus))
        );
        address addr = address(drProxy);
        console.log("DisputeResolver:", addr);
        return addr;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        address guardian = vm.envOr("GUARDIAN_ADDRESS", owner);

        address jouleToken = vm.envOr("JOULE_TOKEN", address(0));
        address reputationOracle = vm.envOr("REPUTATION_ORACLE", address(0));
        address federatedConsensus = vm.envOr("FEDERATED_CONSENSUS", address(0));

        vm.startBroadcast(deployerKey);

        address treasuryStabilizer = _deployStabilizer(
            owner,
            vm.envAddress("VIBE_AMM"),
            vm.envAddress("DAO_TREASURY"),
            vm.envAddress("VOLATILITY_ORACLE")
        );

        address vibeTimelock;
        if (jouleToken != address(0)) {
            vibeTimelock = _deployTimelock(owner, guardian, jouleToken, reputationOracle);
        } else {
            console.log("SKIP VibeTimelock (JOULE_TOKEN not provided - wire after DeployTokenomics)");
        }

        address vibeKeeperNetwork;
        if (jouleToken != address(0)) {
            vibeKeeperNetwork = _deployKeeper(jouleToken, reputationOracle);
        } else {
            console.log("SKIP VibeKeeperNetwork (JOULE_TOKEN not provided - wire after DeployTokenomics)");
        }

        address disputeResolver;
        if (federatedConsensus != address(0)) {
            disputeResolver = _deployDisputeResolver(owner, federatedConsensus);
        } else {
            console.log("SKIP DisputeResolver (FEDERATED_CONSENSUS not provided - wire after DeployCompliance)");
        }

        vm.stopBroadcast();

        // ============ Summary ============
        console.log("");
        console.log("=== Governance Deployment Summary ===");
        console.log("TreasuryStabilizer:", treasuryStabilizer);
        if (vibeTimelock != address(0)) console.log("VibeTimelock:", vibeTimelock);
        if (vibeKeeperNetwork != address(0)) console.log("VibeKeeperNetwork:", vibeKeeperNetwork);
        if (disputeResolver != address(0)) console.log("DisputeResolver:", disputeResolver);
        console.log("");
        console.log("POST-DEPLOY:");
        console.log("  1. TreasuryStabilizer.setMainPool(token, poolId) for each managed token");
        console.log("  2. TreasuryStabilizer.setConfig(token, config) for stabilizer parameters");
        if (vibeTimelock != address(0)) {
            console.log("  3. Transfer contract ownership to VibeTimelock for governance delay");
        }
        if (vibeKeeperNetwork != address(0)) {
            console.log("  4. VibeKeeperNetwork.registerTask(...) for automated jobs");
        }
        if (disputeResolver != address(0)) {
            console.log("  5. DisputeResolver.setTribunal(tribunalAddress) if DecentralizedTribunal deployed");
        }
    }
}

/**
 * @title TransferGovernanceOwnership
 * @notice Transfer governance contract ownership to multisig
 */
contract TransferGovernanceOwnership is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        address treasuryStabilizer = vm.envAddress("TREASURY_STABILIZER");

        vm.startBroadcast(deployerKey);

        TreasuryStabilizer(treasuryStabilizer).transferOwnership(multisig);
        console.log("TreasuryStabilizer ownership transferred to:", multisig);

        // VibeTimelock, VibeKeeperNetwork are Ownable - transfer if deployed
        address vibeTimelock = vm.envOr("VIBE_TIMELOCK", address(0));
        if (vibeTimelock != address(0)) {
            VibeTimelock(payable(vibeTimelock)).transferOwnership(multisig);
            console.log("VibeTimelock ownership transferred to:", multisig);
        }

        address vibeKeeperNetwork = vm.envOr("VIBE_KEEPER_NETWORK", address(0));
        if (vibeKeeperNetwork != address(0)) {
            VibeKeeperNetwork(vibeKeeperNetwork).transferOwnership(multisig);
            console.log("VibeKeeperNetwork ownership transferred to:", multisig);
        }

        address disputeResolver = vm.envOr("DISPUTE_RESOLVER", address(0));
        if (disputeResolver != address(0)) {
            DisputeResolver(payable(disputeResolver)).transferOwnership(multisig);
            console.log("DisputeResolver ownership transferred to:", multisig);
        }

        vm.stopBroadcast();
    }
}
