// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../monetary/VIBEToken.sol";
import "../incentives/EmissionController.sol";
import "../incentives/ShapleyDistributor.sol";
import "./IntelligenceExchange.sol";

/**
 * @title VibePermissionlessLaunch — Anyone Can Launch the Entire Protocol
 * @notice One call deploys: VIBE token + EmissionController + ShapleyDistributor + SIE.
 *         Whoever pays gas can launch VibeSwap on any EVM chain.
 *
 * @dev Cincinnatus from day zero.
 *
 *      "If Will disappeared tomorrow, does it still work?"
 *      Yes. Anyone calls launch(). Protocol lives.
 *
 *      What this deploys:
 *        1. VIBEToken — 21M cap, zero pre-mine, burn-permanent
 *        2. ShapleyDistributor — cooperative game theory rewards
 *        3. EmissionController — permissionless drip(), halving schedule
 *        4. IntelligenceExchange — Sovereign Intelligence Exchange
 *
 *      What this guarantees:
 *        - P-001: 0% protocol fee (constant, not parameter)
 *        - drip() is permissionless (no onlyOwner)
 *        - VIBE cap is lifetime (burns don't create room)
 *        - Shapley distribution satisfies 5 axioms
 *
 *      The caller becomes initial owner of all contracts.
 *      Ownership can be transferred to a DAO, multisig, or renounced.
 *
 * @author Faraday1, JARVIS | March 2026
 */
contract VibePermissionlessLaunch {
    // ============ Events ============

    event ProtocolLaunched(
        address indexed launcher,
        address vibeToken,
        address emissionController,
        address shapleyDistributor,
        address intelligenceExchange,
        uint256 timestamp
    );

    // ============ Structs ============

    struct Deployment {
        address launcher;
        address vibeToken;
        address emissionController;
        address shapleyDistributor;
        address intelligenceExchange;
        uint256 timestamp;
        uint256 chainId;
    }

    // ============ State ============

    Deployment[] public deployments;
    mapping(uint256 => Deployment) public deploymentByChain;

    // ============ Launch ============

    /**
     * @notice Deploy the entire VibeSwap protocol stack. Anyone can call.
     *         Caller pays gas. Caller becomes initial owner of all contracts.
     *
     * @param epochSubmitters Addresses authorized to anchor knowledge epochs (Jarvis shards)
     * @return d The full deployment addresses
     */
    function launch(
        address[] calldata epochSubmitters
    ) external returns (Deployment memory d) {
        d.launcher = msg.sender;
        d.timestamp = block.timestamp;
        d.chainId = block.chainid;

        // ============ 1. VIBE Token ============
        VIBEToken vibeImpl = new VIBEToken();
        ERC1967Proxy vibeProxy = new ERC1967Proxy(
            address(vibeImpl),
            abi.encodeCall(VIBEToken.initialize, (msg.sender))
        );
        d.vibeToken = address(vibeProxy);

        // ============ 2. Shapley Distributor ============
        ShapleyDistributor shapleyImpl = new ShapleyDistributor();
        ERC1967Proxy shapleyProxy = new ERC1967Proxy(
            address(shapleyImpl),
            abi.encodeCall(ShapleyDistributor.initialize, (msg.sender))
        );
        d.shapleyDistributor = address(shapleyProxy);

        // ============ 3. Emission Controller ============
        EmissionController emissionImpl = new EmissionController();
        ERC1967Proxy emissionProxy = new ERC1967Proxy(
            address(emissionImpl),
            abi.encodeCall(EmissionController.initialize, (
                msg.sender,           // owner
                d.vibeToken,          // VIBE token
                d.shapleyDistributor, // Shapley pool
                address(0),           // gauge (can be set later)
                address(0),           // staking (can be set later)
                0                     // genesis = now
            ))
        );
        d.emissionController = address(emissionProxy);

        // ============ 4. Intelligence Exchange (SIE) ============
        IntelligenceExchange sieImpl = new IntelligenceExchange();
        ERC1967Proxy sieProxy = new ERC1967Proxy(
            address(sieImpl),
            abi.encodeCall(IntelligenceExchange.initialize, (
                d.vibeToken,
                msg.sender
            ))
        );
        d.intelligenceExchange = address(sieProxy);

        // ============ Configure ============

        // Grant EmissionController minting rights on VIBE
        VIBEToken(d.vibeToken).setMinter(d.emissionController, true);

        // Authorize epoch submitters on the SIE
        IntelligenceExchange sie = IntelligenceExchange(payable(d.intelligenceExchange));
        for (uint256 i = 0; i < epochSubmitters.length; i++) {
            if (epochSubmitters[i] != address(0)) {
                sie.addEpochSubmitter(epochSubmitters[i]);
            }
        }

        // ============ Verify P-001 ============
        require(sie.PROTOCOL_FEE_BPS() == 0, "P-001: SIE fee must be 0");

        // ============ Store ============
        deployments.push(d);
        deploymentByChain[block.chainid] = d;

        emit ProtocolLaunched(
            msg.sender,
            d.vibeToken,
            d.emissionController,
            d.shapleyDistributor,
            d.intelligenceExchange,
            block.timestamp
        );
    }

    // ============ View ============

    function deploymentCount() external view returns (uint256) {
        return deployments.length;
    }

    function getDeployment(uint256 index) external view returns (Deployment memory) {
        return deployments[index];
    }

    function getChainDeployment(uint256 chainId) external view returns (Deployment memory) {
        return deploymentByChain[chainId];
    }

    function latestDeployment() external view returns (Deployment memory) {
        require(deployments.length > 0, "No deployments");
        return deployments[deployments.length - 1];
    }
}
