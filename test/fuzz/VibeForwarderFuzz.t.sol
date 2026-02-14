// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/metatx/VibeForwarder.sol";
import "../../contracts/metatx/interfaces/IVibeForwarder.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

// ============ Mocks ============

contract MockVFFuzzToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockVFFuzzOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockVFFuzzTarget is ERC2771Context {
    uint256 public value;
    address public lastCaller;
    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}
    function setValue(uint256 _value) external { value = _value; lastCaller = _msgSender(); }
}

// ============ Fuzz Tests ============

contract VibeForwarderFuzzTest is Test {
    VibeForwarder public forwarder;
    MockVFFuzzToken public jul;
    MockVFFuzzOracle public oracle;
    MockVFFuzzTarget public target;

    address public relayer;
    uint256 public userPK;
    address public user;

    bytes32 constant _FORWARD_REQUEST_TYPEHASH =
        keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)");

    function setUp() public {
        relayer = makeAddr("relayer");
        (user, userPK) = makeAddrAndKey("user");

        jul = new MockVFFuzzToken("JUL", "JUL");
        oracle = new MockVFFuzzOracle();

        forwarder = new VibeForwarder(address(jul), address(oracle), 5 ether, 100);

        target = new MockVFFuzzTarget(address(forwarder));
        forwarder.setTargetWhitelist(address(target), true);

        jul.mint(address(this), 100_000 ether);
        jul.approve(address(forwarder), type(uint256).max);
        forwarder.depositJulRewards(50_000 ether);

        vm.prank(relayer);
        forwarder.registerRelayer();
    }

    // ============ Tip Properties ============

    function testFuzz_tipNeverExceedsMax(uint256 tip) public {
        forwarder.setRelayerTip(tip);
        assertLe(forwarder.relayerTip(), 100 ether);
    }

    // ============ Rate Limit Properties ============

    function testFuzz_rateLimitNeverExceedsMax(uint32 limit) public {
        forwarder.setUserRateLimit(limit);
        assertLe(forwarder.userRateLimit(), 1000);
        assertGe(forwarder.userRateLimit(), 1);
    }

    function testFuzz_rateLimitEnforced(uint32 limit) public {
        limit = uint32(bound(limit, 1, 10));
        forwarder.setUserRateLimit(limit);

        // Execute up to the limit
        for (uint32 i = 0; i < limit; i++) {
            ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
                user,
                userPK,
                address(target),
                abi.encodeCall(MockVFFuzzTarget.setValue, (uint256(i))),
                0
            );
            vm.prank(relayer);
            forwarder.executeWithTracking(request);
        }

        // Next should fail
        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFFuzzTarget.setValue, (999)),
            0
        );
        vm.prank(relayer);
        vm.expectRevert(IVibeForwarder.UserRateLimited.selector);
        forwarder.executeWithTracking(request);
    }

    // ============ Forwarding Properties ============

    function testFuzz_forwardedCallResolvesCorrectSender(uint256 valueSeed) public {
        uint256 val = bound(valueSeed, 0, type(uint128).max);

        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFFuzzTarget.setValue, (val)),
            0
        );

        vm.prank(relayer);
        forwarder.executeWithTracking(request);

        assertEq(target.value(), val);
        assertEq(target.lastCaller(), user, "Forwarded call must resolve to original user");
    }

    function testFuzz_multipleForwardsIncrementNonce(uint8 count) public {
        count = uint8(bound(count, 1, 20));

        for (uint8 i = 0; i < count; i++) {
            ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
                user,
                userPK,
                address(target),
                abi.encodeCall(MockVFFuzzTarget.setValue, (uint256(i))),
                0
            );
            vm.prank(relayer);
            forwarder.executeWithTracking(request);
        }

        assertEq(forwarder.nonces(user), count, "Nonce must equal number of successful forwards");
    }

    // ============ Trust Tier Properties ============

    function testFuzz_trustTierGating(uint8 minTier, uint8 userTier) public {
        minTier = uint8(bound(minTier, 0, 4));
        userTier = uint8(bound(userTier, 0, 4));

        forwarder.setMinTrustTier(minTier);
        oracle.setTier(user, userTier);

        ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
            user,
            userPK,
            address(target),
            abi.encodeCall(MockVFFuzzTarget.setValue, (42)),
            0
        );

        if (userTier < minTier) {
            vm.prank(relayer);
            vm.expectRevert(IVibeForwarder.UserRateLimited.selector);
            forwarder.executeWithTracking(request);
        } else {
            vm.prank(relayer);
            forwarder.executeWithTracking(request);
            assertEq(target.value(), 42);
        }
    }

    // ============ JUL Solvency Properties ============

    function testFuzz_julPoolNeverGoesNegative(uint8 forwardCount) public {
        forwardCount = uint8(bound(forwardCount, 1, 50));

        for (uint8 i = 0; i < forwardCount; i++) {
            ERC2771Forwarder.ForwardRequestData memory request = _buildSignedRequest(
                user,
                userPK,
                address(target),
                abi.encodeCall(MockVFFuzzTarget.setValue, (uint256(i))),
                0
            );
            vm.prank(relayer);
            forwarder.executeWithTracking(request);
        }

        // Pool should never underflow
        uint256 pool = forwarder.julRewardPool();
        uint256 balance = jul.balanceOf(address(forwarder));
        assertGe(balance, pool, "JUL balance must cover reward pool");
    }

    // ============ Helpers ============

    function _buildSignedRequest(
        address from,
        uint256 pk,
        address to,
        bytes memory data,
        uint256 value
    ) internal view returns (ERC2771Forwarder.ForwardRequestData memory) {
        uint256 nonce = forwarder.nonces(from);
        uint48 deadline = uint48(block.timestamp + 1 hours);

        bytes32 structHash = keccak256(
            abi.encode(
                _FORWARD_REQUEST_TYPEHASH,
                from, to, value, 200_000, nonce, deadline, keccak256(data)
            )
        );

        bytes32 domainSep = _getDomainSeparator();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        return ERC2771Forwarder.ForwardRequestData({
            from: from, to: to, value: value, gas: 200_000,
            deadline: deadline, data: data,
            signature: abi.encodePacked(r, s, v)
        });
    }

    function _getDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("VibeForwarder")),
            keccak256(bytes("1")),
            block.chainid,
            address(forwarder)
        ));
    }
}
