// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {IStateOracle} from "./interfaces/IReasoningVerifier.sol";

/**
 * @title StateOracle
 * @notice Reference implementation of IStateOracle — keyed registry mapping
 *         canonical var-keys to (resolver, selector) tuples. Resolves a var
 *         by staticcall'ing the registered resolver and decoding the result.
 *
 *         Spec: docs/research/papers/on-chain-reasoning-verification.md
 *         Companion to ReasoningVerifier (Tier 2 truth check).
 *
 *         Var-key derivation (canonical, per EIP-A draft):
 *           varKey = keccak256(abi.encode(domain, contract, selector, params))
 *
 *         Resolvers can be:
 *           - the contract itself (read its public getters)
 *           - a wrapper view contract that exposes raw storage slots
 *           - any contract returning int256
 *
 *         Booleans are returned as 0 or 1 (uint→int).
 */
contract StateOracle is IStateOracle, OwnableUpgradeable, UUPSUpgradeable {
    // ============ Structs ============

    struct Resolver {
        address target;
        bytes4 selector;        // function selector returning int256 or bool
        bool isBool;            // if true, expect bool return; coerce to 0/1
        bool registered;
    }

    // ============ Storage ============

    mapping(bytes32 => Resolver) internal _resolvers;

    // ============ Events ============

    event ResolverRegistered(bytes32 indexed varKey, address indexed target, bytes4 selector, bool isBool);
    event ResolverRevoked(bytes32 indexed varKey);

    // ============ Errors ============

    error VarNotRegistered(bytes32 varKey);
    error ResolverCallFailed(bytes32 varKey, bytes returnData);
    error UnexpectedReturnLength(bytes32 varKey, uint256 length);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __Ownable_init(admin);
        __UUPSUpgradeable_init();
    }

    // ============ Registry ============

    function registerResolver(
        bytes32 varKey,
        address target,
        bytes4 selector,
        bool isBool
    ) external onlyOwner {
        _resolvers[varKey] = Resolver({
            target: target,
            selector: selector,
            isBool: isBool,
            registered: true
        });
        emit ResolverRegistered(varKey, target, selector, isBool);
    }

    function revokeResolver(bytes32 varKey) external onlyOwner {
        delete _resolvers[varKey];
        emit ResolverRevoked(varKey);
    }

    function getResolver(bytes32 varKey) external view returns (Resolver memory) {
        return _resolvers[varKey];
    }

    // ============ IStateOracle ============

    /// @inheritdoc IStateOracle
    function readInt(bytes32 varKey) external view override returns (int256) {
        Resolver memory r = _resolvers[varKey];
        if (!r.registered) revert VarNotRegistered(varKey);

        (bool ok, bytes memory ret) = r.target.staticcall(abi.encodePacked(r.selector));
        if (!ok) revert ResolverCallFailed(varKey, ret);
        if (ret.length != 32) revert UnexpectedReturnLength(varKey, ret.length);

        if (r.isBool) {
            bool b = abi.decode(ret, (bool));
            return b ? int256(1) : int256(0);
        }
        return abi.decode(ret, (int256));
    }

    /// @inheritdoc IStateOracle
    function hasVar(bytes32 varKey) external view override returns (bool) {
        return _resolvers[varKey].registered;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
