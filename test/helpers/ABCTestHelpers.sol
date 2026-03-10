// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ABCTestHelpers
 * @notice Shared mock tokens and helpers for ABC and HatchManager tests
 * @dev Import these instead of duplicating mock contracts in every test file
 */

// ============ Mock Reserve Token ============

contract MockReserveToken is ERC20 {
    constructor() ERC20("Reserve", "DAI") {
        _mint(msg.sender, 1_000_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Mock Community Token (Controller-Gated) ============

contract MockCommunityToken is ERC20 {
    address public controller;

    constructor() ERC20("Community", "VIBE") {}

    function setController(address _c) external {
        controller = _c;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _burn(from, amount);
    }
}

// ============ Mock JUL Token (For Governance Staking) ============

contract MockJULToken is ERC20 {
    constructor() ERC20("JUL", "JUL") {
        _mint(msg.sender, 1_000_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Mock Reputation Oracle ============

contract MockReputationOracle {
    function isEligible(address, uint8) external pure returns (bool) {
        return true;
    }

    function getReputation(address) external pure returns (uint256) {
        return 100;
    }

    function getTier(address) external pure returns (uint8) {
        return 5;
    }
}

// ============ Mock Soulbound Identity ============

contract MockSoulboundIdentity {
    mapping(address => bool) public hasIdentity;

    function setIdentity(address addr, bool val) external {
        hasIdentity[addr] = val;
    }
}
