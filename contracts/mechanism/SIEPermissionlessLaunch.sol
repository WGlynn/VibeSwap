// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./IntelligenceExchange.sol";

/**
 * @title SIEPermissionlessLaunch — Anyone Can Launch the Intelligence Exchange
 * @notice Permissionless deployment factory. Whoever pays the gas can deploy.
 *         The deployer becomes the initial owner but the protocol fee is
 *         hardcoded to 0% (P-001) and cannot be changed.
 *
 * @dev Why this exists:
 *      "If I can't afford the gas to deploy, anyone should be able to do it."
 *      — Will Glynn, March 2026
 *
 *      This is the Cincinnatus pattern: the founder designs a system that
 *      doesn't need the founder to exist. If Will disappears tomorrow,
 *      anyone can call launch() and the SIE lives.
 *
 *      The protocol fee is 0% forever. This is not a parameter — it's a
 *      constant in IntelligenceExchange.sol. No governance vote, no admin
 *      key, no multisig can change it. P-001 is physics, not policy.
 *
 * @author Faraday1, JARVIS | March 2026
 */
contract SIEPermissionlessLaunch {
    // ============ Events ============

    event SIELaunched(
        address indexed launcher,
        address indexed proxy,
        address implementation,
        address vibeToken,
        uint256 timestamp
    );

    event EpochSubmitterAdded(
        address indexed proxy,
        address indexed submitter,
        address indexed addedBy
    );

    // ============ State ============

    /// @notice All SIE deployments, in order
    address[] public deployments;

    /// @notice Mapping to check if an address is a known SIE deployment
    mapping(address => bool) public isDeployment;

    // ============ Launch ============

    /**
     * @notice Deploy a new IntelligenceExchange. Anyone can call this.
     *         Caller pays gas. Caller becomes initial owner.
     *         Protocol fee is 0% forever (hardcoded constant).
     *
     * @param vibeToken Address of the VIBE ERC-20 token
     * @param epochSubmitters Array of addresses authorized to anchor knowledge epochs
     * @return proxy Address of the deployed SIE proxy
     */
    function launch(
        address vibeToken,
        address[] calldata epochSubmitters
    ) external returns (address proxy) {
        require(vibeToken != address(0), "Zero VIBE address");

        // Deploy implementation
        IntelligenceExchange impl = new IntelligenceExchange();

        // Deploy proxy with caller as owner
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize,
            (vibeToken, msg.sender)
        );
        ERC1967Proxy erc1967Proxy = new ERC1967Proxy(address(impl), initData);
        proxy = address(erc1967Proxy);

        IntelligenceExchange sie = IntelligenceExchange(payable(proxy));

        // Verify P-001
        require(sie.PROTOCOL_FEE_BPS() == 0, "P-001 VIOLATION");

        // Authorize epoch submitters
        for (uint256 i = 0; i < epochSubmitters.length; i++) {
            if (epochSubmitters[i] != address(0)) {
                sie.addEpochSubmitter(epochSubmitters[i]);
                emit EpochSubmitterAdded(proxy, epochSubmitters[i], msg.sender);
            }
        }

        // Record deployment
        deployments.push(proxy);
        isDeployment[proxy] = true;

        emit SIELaunched(msg.sender, proxy, address(impl), vibeToken, block.timestamp);
    }

    // ============ View ============

    function deploymentCount() external view returns (uint256) {
        return deployments.length;
    }

    function getDeployment(uint256 index) external view returns (address) {
        return deployments[index];
    }

    function allDeployments() external view returns (address[] memory) {
        return deployments;
    }
}
