// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

library console {
    address constant CONSOLE_ADDRESS = address(0x000000000000000000636F6e736F6c652e6c6f67);

    function log(string memory) internal pure {}
    function log(string memory, uint256) internal pure {}
    function log(string memory, address) internal pure {}
    function log(uint256) internal pure {}
    function log(address) internal pure {}
}
