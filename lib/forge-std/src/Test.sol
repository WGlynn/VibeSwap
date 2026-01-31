// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

// Minimal forge-std Test stub
// Replace with actual forge-std by running: forge install foundry-rs/forge-std

import "./Vm.sol";
import "./console.sol";

abstract contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition) internal pure {
        require(condition, "Assertion failed");
    }

    function assertTrue(bool condition, string memory message) internal pure {
        require(condition, message);
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "Assertion failed");
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "Values not equal");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "Addresses not equal");
    }

    function assertEq(bytes32 a, bytes32 b) internal pure {
        require(a == b, "Bytes32 not equal");
    }

    function assertEq(bool a, bool b) internal pure {
        require(a == b, "Bools not equal");
    }

    function assertGt(uint256 a, uint256 b) internal pure {
        require(a > b, "Not greater than");
    }

    function assertGe(uint256 a, uint256 b) internal pure {
        require(a >= b, "Not greater or equal");
    }

    function assertLt(uint256 a, uint256 b) internal pure {
        require(a < b, "Not less than");
    }

    function assertApproxEqRel(uint256 a, uint256 b, uint256 maxPercentDelta) internal pure {
        if (b == 0) {
            require(a == 0, "Not approximately equal");
            return;
        }
        uint256 delta = a > b ? a - b : b - a;
        uint256 percentDelta = (delta * 1e18) / b;
        require(percentDelta <= maxPercentDelta, "Not approximately equal");
    }

    function makeAddr(string memory name) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(name)))));
    }
}
