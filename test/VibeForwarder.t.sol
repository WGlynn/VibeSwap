// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/metatx/VibeForwarder.sol";
import "../contracts/metatx/interfaces/IVibeForwarder.sol";
import "../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

// ============ Mocks ============

contract MockVFToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockVFOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

/// @notice Mock target that trusts the forwarder via ERC2771Context
contract MockVFTarget is ERC2771Context {
    uint256 public value;
    address public lastCaller;

    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}

    function setValue(uint256 _value) external {
        value = _value;
        lastCaller = _msgSender();
    }

    function getActualSender() external view returns (address) {
        return _msgSender();
    }
}

// ============ Unit Tests ============

contract VibeForwarderTest is Test {
    VibeForwarder public forwarder;
    MockVFToken public jul;
    MockVFOracle public oracle;
    MockVFTarget public target;

    address public owner;
    address public relayer;
    uint256 public userPK;
    address public user;
    address public alice;

    uint256 constant RELAYER_TIP = 5 ether;
    uint32 constant RATE_LIMIT = 10;

    // EIP-712 typehash (must match OZ's ERC2771Forwarder)
    bytes32 constant _FORWARD_REQUEST_TYPEHASH =
        keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)");

    function setUp() public {
        owner = address(this);
        relayer = makeAddr("relayer");
        (user, userPK) = makeAddrAndKey("user");
        alice = makeAddr("alice");

        jul = new MockVFToken("JUL", "JUL");
        oracle = new MockVFOracle();

        forwarder = new VibeForwarder(
            address(jul),
            address(oracle),
            RELAYER_TIP,
            RATE_LIMIT
        );

        target = new MockVFTarget(address(forwarder));

        // Setup
        forwarder.setTargetWhitelist(address(target), true);

        // Fund reward pool
        jul.mint(address(this), 100_000 ether);
        jul.approve(address(forwarder), type(uint256).max);
        forwarder.depositJulRewards(50_000 ether);

        // Register relayer
        vm.prank(relayer);
        forwarder.registerRelayer();
    }

    // ============ Constructor Tests ============

    function test_constructor_setsState() public view {
        assertEq(address(forwarder.julToken()), address(jul));
        assertEq(address(forwarder.reputationOracle()), address(oracle));
        assertEq(forwarder.relayerTip(), RELAYER_TIP);
        assertEq(forwarder.userRateLimit(), RATE_LIMIT);
        assertFalse(forwarder.openRelaying());
    }

    function test_constructor_revertsZeroToken() public {
        vm.expectRevert(IVibeForwarder.ZeroAddress.selector);
        new VibeForwarder(address(0), address(oracle), RELAYER_TIP, RATE_LIMIT);
    }

    function test_constructor_revertsZeroOracle() public {
        vm.expectRevert(IVibeForwarder.ZeroAddress.selector);
        new VibeForwarder(address(jul), address(0), RELAYER_TIP, RATE_LIMIT);
    }

    function test_constructor_clampsTip() public {
        VibeForwarder f = new VibeForwarder(address(jul), address(oracle), 200 ether, RATE_LIMIT);
        assertEq(f.relayerTip(), 100 ether); // MAX_TIP
    }

    function test_constructor_clampsRateLimit() public {
        VibeForwarder f = new VibeForwarder(address(jul), address(oracle), RELAYER_TIP, 5000);
        assertEq(f.userRateLimit(), 1000); // MAX_RATE_LIMIT
    }

    function test_constructor_zeroRateLimitDefaultsTo10() public {
        VibeForwarder f = new VibeForwarder(address(jul), address(oracle), RELAYER_TIP, 0);
        assertEq(f.userRateLimit(), 10);
    }

    // ============ Relayer Registration Tests ============

    function test_registerRelayer() public {
        vm.prank(alice);
        forwarder.registerRelayer();

        assertTrue(forwarder.isActiveRelayer(alice));
        IVibeForwarder.RelayerInfo memory r = forwarder.getRelayer(alice);
        assertTrue(r.active);
        assertEq(r.totalForwarded, 0);
    }

    function test_registerRelayer_revertsDuplicate() public {
        vm.prank(relayer);
        vm.expectRevert(IVibeForwarder.AlreadyRegistered.selector);
        forwarder.registerRelayer();
    }

    function test_deactivateRelayer() public {
        vm.prank(relayer);
        forwarder.deactivateRelayer();

        assertFalse(forwarder.isActiveRelayer(relayer));
    }

    function test_deactivateRelayer_revertsNotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(IVibeForwarder.NotRegistered.selector);
        forwarder.deactivateRelayer();
    }

    // ============ Execute With Tracking Tests ============

    function test_executeWithTracking() public {
        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (42)),
            0 // value
        );

        vm.prank(relayer);
        forwarder.executeWithTracking(request);

        // Target got the call
        assertEq(target.value(), 42);
        // _msgSender() resolved to user (not relayer or forwarder)
        assertEq(target.lastCaller(), user);

        // Relayer stats updated
        IVibeForwarder.RelayerInfo memory r = forwarder.getRelayer(relayer);
        assertEq(r.totalForwarded, 1);
        assertEq(r.totalEarned, RELAYER_TIP);

        // Relayer got JUL tip
        assertEq(jul.balanceOf(relayer), RELAYER_TIP);
    }

    function test_executeWithTracking_revertsNotActiveRelayer() public {
        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (42)),
            0
        );

        vm.prank(alice); // not registered
        vm.expectRevert(IVibeForwarder.NotActiveRelayer.selector);
        forwarder.executeWithTracking(request);
    }

    function test_executeWithTracking_openRelaying() public {
        forwarder.setOpenRelaying(true);

        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (42)),
            0
        );

        vm.prank(alice); // unregistered, but open relaying
        forwarder.executeWithTracking(request);

        assertEq(target.value(), 42);
        assertEq(target.lastCaller(), user);
    }

    function test_executeWithTracking_rateLimit() public {
        // Set rate limit to 2 per hour
        forwarder.setUserRateLimit(2);

        // Execute twice (ok)
        for (uint256 i = 0; i < 2; i++) {
            ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
                user,
                userPK,
                address(target),
                abi.encodeCall(MockVFTarget.setValue, (i)),
                0
            );
            vm.prank(relayer);
            forwarder.executeWithTracking(request);
        }

        // Third time hits rate limit
        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (99)),
            0
        );

        vm.prank(relayer);
        vm.expectRevert(IVibeForwarder.UserRateLimited.selector);
        forwarder.executeWithTracking(request);
    }

    function test_executeWithTracking_rateLimitResetsNextHour() public {
        forwarder.setUserRateLimit(1);

        // First request ok
        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (1)),
            0
        );
        vm.prank(relayer);
        forwarder.executeWithTracking(request);

        // Warp to next hour
        vm.warp(block.timestamp + 1 hours);

        // Second request ok (new hour bucket)
        ERC2771Forwarder.ForwardRequestData memory request2 = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (2)),
            0
        );
        vm.prank(relayer);
        forwarder.executeWithTracking(request2);

        assertEq(target.value(), 2);
    }

    function test_executeWithTracking_trustTierCheck() public {
        forwarder.setMinTrustTier(2);

        // User has tier 0 — should fail
        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (42)),
            0
        );

        vm.prank(relayer);
        vm.expectRevert(IVibeForwarder.UserRateLimited.selector);
        forwarder.executeWithTracking(request);

        // Set user tier to 2
        oracle.setTier(user, 2);

        ERC2771Forwarder.ForwardRequestData memory request2 = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (42)),
            0
        );

        vm.prank(relayer);
        forwarder.executeWithTracking(request2);
        assertEq(target.value(), 42);
    }

    function test_executeWithTracking_targetNotWhitelisted() public {
        MockVFTarget target2 = new MockVFTarget(address(forwarder));
        // Don't whitelist target2

        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target2),
            abi.encodeCall(MockVFTarget.setValue, (42)),
            0
        );

        vm.prank(relayer);
        vm.expectRevert(IVibeForwarder.UserRateLimited.selector);
        forwarder.executeWithTracking(request);
    }

    // ============ Admin Tests ============

    function test_setRelayerTip() public {
        forwarder.setRelayerTip(10 ether);
        assertEq(forwarder.relayerTip(), 10 ether);
    }

    function test_setRelayerTip_clamped() public {
        forwarder.setRelayerTip(200 ether);
        assertEq(forwarder.relayerTip(), 100 ether);
    }

    function test_setMinTrustTier() public {
        forwarder.setMinTrustTier(3);
        assertEq(forwarder.minTrustTier(), 3);
    }

    function test_setUserRateLimit() public {
        forwarder.setUserRateLimit(50);
        assertEq(forwarder.userRateLimit(), 50);
    }

    function test_setUserRateLimit_clamped() public {
        forwarder.setUserRateLimit(5000);
        assertEq(forwarder.userRateLimit(), 1000);
    }

    function test_setUserRateLimit_zeroBecomesOne() public {
        forwarder.setUserRateLimit(0);
        assertEq(forwarder.userRateLimit(), 1);
    }

    function test_setOpenRelaying() public {
        forwarder.setOpenRelaying(true);
        assertTrue(forwarder.openRelaying());
    }

    function test_setTargetWhitelist() public {
        address newTarget = makeAddr("newTarget");
        forwarder.setTargetWhitelist(newTarget, true);
        assertTrue(forwarder.isTargetWhitelisted(newTarget));

        forwarder.setTargetWhitelist(newTarget, false);
        assertFalse(forwarder.isTargetWhitelisted(newTarget));
    }

    function test_setTargetWhitelist_revertsZeroAddress() public {
        vm.expectRevert(IVibeForwarder.ZeroAddress.selector);
        forwarder.setTargetWhitelist(address(0), true);
    }

    function test_depositJulRewards() public {
        uint256 poolBefore = forwarder.julRewardPool();
        forwarder.depositJulRewards(1000 ether);
        assertEq(forwarder.julRewardPool(), poolBefore + 1000 ether);
    }

    function test_depositJulRewards_revertsZero() public {
        vm.expectRevert(IVibeForwarder.ZeroAmount.selector);
        forwarder.depositJulRewards(0);
    }

    // ============ View Tests ============

    function test_userRequestCount() public {
        assertEq(forwarder.userRequestCount(user), 0);

        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (1)),
            0
        );

        vm.prank(relayer);
        forwarder.executeWithTracking(request);

        assertEq(forwarder.userRequestCount(user), 1);
    }

    function test_isActiveRelayer_openMode() public {
        forwarder.setOpenRelaying(true);
        assertTrue(forwarder.isActiveRelayer(address(0xdead))); // anyone
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // 1. Relayer registers (done in setUp)
        assertTrue(forwarder.isActiveRelayer(relayer));

        // 2. User signs request to set value
        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (100)),
            0
        );

        // 3. Relayer forwards
        uint256 poolBefore = forwarder.julRewardPool();
        vm.prank(relayer);
        forwarder.executeWithTracking(request);

        // 4. Verify: target updated, user is _msgSender, relayer got tip
        assertEq(target.value(), 100);
        assertEq(target.lastCaller(), user);
        assertEq(jul.balanceOf(relayer), RELAYER_TIP);
        assertEq(forwarder.julRewardPool(), poolBefore - RELAYER_TIP);

        // 5. Second request (nonce auto-incremented)
        ERC2771Forwarder.ForwardRequestData memory request2 = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (200)),
            0
        );

        vm.prank(relayer);
        forwarder.executeWithTracking(request2);

        assertEq(target.value(), 200);
        assertEq(target.lastCaller(), user);
        assertEq(forwarder.getRelayer(relayer).totalForwarded, 2);
    }

    function test_multipleUsersMultipleRelayers() public {
        // Register second relayer
        vm.prank(alice);
        forwarder.registerRelayer();

        // Create second user
        (address user2, uint256 user2PK) = makeAddrAndKey("user2");

        // User1 via relayer1
        ERC2771Forwarder.ForwardRequestData memory req1 = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (1)),
            0
        );
        vm.prank(relayer);
        forwarder.executeWithTracking(req1);

        // User2 via relayer2 (alice)
        ERC2771Forwarder.ForwardRequestData memory req2 = _buildSignedRequest(
            user2,
            user2PK,
            address(target),
            abi.encodeCall(MockVFTarget.setValue, (2)),
            0
        );
        vm.prank(alice);
        forwarder.executeWithTracking(req2);

        assertEq(target.value(), 2);
        assertEq(target.lastCaller(), user2);
        assertEq(forwarder.getRelayer(relayer).totalForwarded, 1);
        assertEq(forwarder.getRelayer(alice).totalForwarded, 1);
    }

    function test_noTipWhenPoolEmpty() public {
        // Deploy forwarder with no rewards
        VibeForwarder emptyForwarder = new VibeForwarder(
            address(jul), address(oracle), RELAYER_TIP, RATE_LIMIT
        );
        MockVFTarget emptyTarget = new MockVFTarget(address(emptyForwarder));
        emptyForwarder.setTargetWhitelist(address(emptyTarget), true);

        vm.prank(relayer);
        emptyForwarder.registerRelayer();

        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(emptyTarget),
            abi.encodeCall(MockVFTarget.setValue, (42)),
            0
        );

        // Need to rebuild request for different forwarder domain
        request = _buildSignedRequestForForwarder(
            emptyForwarder,
            user,
            userPK,
            address(emptyTarget),
            abi.encodeCall(MockVFTarget.setValue, (42)),
            0
        );

        uint256 relayerBefore = jul.balanceOf(relayer);
        vm.prank(relayer);
        emptyForwarder.executeWithTracking(request);

        assertEq(jul.balanceOf(relayer), relayerBefore); // No tip
        assertEq(emptyTarget.value(), 42);
    }

    // ============ Helpers ============

    function _buildSignedRequest(
        address from,
        uint256 pk,
        address to,
        bytes memory data,
        uint256 value
    ) internal view returns (ERC2771Forwarder.ForwardRequestData memory) {
        return _buildSignedRequestForForwarder(forwarder, from, pk, to, data, value);
    }

    function _buildSignedRequestForForwarder(
        VibeForwarder fwd,
        address from,
        uint256 pk,
        address to,
        bytes memory data,
        uint256 value
    ) internal view returns (ERC2771Forwarder.ForwardRequestData memory) {
        uint256 nonce = fwd.nonces(from);
        uint48 deadline = uint48(block.timestamp + 1 hours);

        bytes32 structHash = keccak256(
            abi.encode(
                _FORWARD_REQUEST_TYPEHASH,
                from,
                to,
                value,
                200_000, // gas
                nonce,
                deadline,
                keccak256(data)
            )
        );

        bytes32 digest = _getEIP712Digest(fwd, structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        return ERC2771Forwarder.ForwardRequestData({
            from: from,
            to: to,
            value: value,
            gas: 200_000,
            deadline: deadline,
            data: data,
            signature: signature
        });
    }

    function _getEIP712Digest(VibeForwarder fwd, bytes32 structHash) internal view returns (bytes32) {
        bytes32 domainSeparator = _getDomainSeparator(fwd);
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _getDomainSeparator(VibeForwarder fwd) internal view returns (bytes32) {
        // EIP712 domain: name="VibeForwarder", version="1", chainid, verifying contract
        bytes32 typeHash = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 nameHash = keccak256(bytes("VibeForwarder"));
        bytes32 versionHash = keccak256(bytes("1"));

        return keccak256(
            abi.encode(
                typeHash,
                nameHash,
                versionHash,
                block.chainid,
                address(fwd)
            )
        );
    }
}
