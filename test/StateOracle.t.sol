// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../contracts/governance/StateOracle.sol";

contract IntSource {
    int256 public value;
    bool public flag;
    constructor(int256 v, bool f) { value = v; flag = f; }
    function getValue() external view returns (int256) { return value; }
    function getFlag() external view returns (bool) { return flag; }
    function reverter() external pure returns (int256) { revert("nope"); }
}

contract StateOracleTest is Test {
    StateOracle internal oracle;
    IntSource internal source;

    address internal admin = address(0xA);

    bytes32 internal constant K_VAL  = keccak256("val");
    bytes32 internal constant K_FLAG = keccak256("flag");
    bytes32 internal constant K_BAD  = keccak256("bad");

    function setUp() public {
        StateOracle impl = new StateOracle();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(StateOracle.initialize.selector, admin)
        );
        oracle = StateOracle(address(proxy));
        source = new IntSource(int256(42), true);
    }

    function _register(bytes32 key, bytes4 sel, bool isBool) internal {
        vm.prank(admin);
        oracle.registerResolver(key, address(source), sel, isBool);
    }

    function test_register_setsResolver() public {
        _register(K_VAL, IntSource.getValue.selector, false);
        StateOracle.Resolver memory r = oracle.getResolver(K_VAL);
        assertEq(r.target, address(source));
        assertEq(r.selector, IntSource.getValue.selector);
        assertEq(r.isBool, false);
        assertEq(r.registered, true);
    }

    function test_readInt_returnsValue() public {
        _register(K_VAL, IntSource.getValue.selector, false);
        int256 v = oracle.readInt(K_VAL);
        assertEq(v, int256(42));
    }

    function test_readInt_boolTrue_returns1() public {
        _register(K_FLAG, IntSource.getFlag.selector, true);
        int256 v = oracle.readInt(K_FLAG);
        assertEq(v, int256(1));
    }

    function test_readInt_boolFalse_returns0() public {
        IntSource src2 = new IntSource(int256(0), false);
        vm.prank(admin);
        oracle.registerResolver(K_FLAG, address(src2), IntSource.getFlag.selector, true);
        int256 v = oracle.readInt(K_FLAG);
        assertEq(v, int256(0));
    }

    function test_readInt_unregistered_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(StateOracle.VarNotRegistered.selector, K_BAD));
        oracle.readInt(K_BAD);
    }

    function test_readInt_resolverReverts_propagates() public {
        _register(K_VAL, IntSource.reverter.selector, false);
        vm.expectRevert();
        oracle.readInt(K_VAL);
    }

    function test_hasVar() public {
        assertFalse(oracle.hasVar(K_VAL));
        _register(K_VAL, IntSource.getValue.selector, false);
        assertTrue(oracle.hasVar(K_VAL));
    }

    function test_revoke_removesResolver() public {
        _register(K_VAL, IntSource.getValue.selector, false);
        assertTrue(oracle.hasVar(K_VAL));
        vm.prank(admin);
        oracle.revokeResolver(K_VAL);
        assertFalse(oracle.hasVar(K_VAL));
    }

    function test_register_onlyOwner() public {
        vm.expectRevert();
        oracle.registerResolver(K_VAL, address(source), IntSource.getValue.selector, false);
    }

    function test_revoke_onlyOwner() public {
        _register(K_VAL, IntSource.getValue.selector, false);
        vm.expectRevert();
        oracle.revokeResolver(K_VAL);
    }
}
