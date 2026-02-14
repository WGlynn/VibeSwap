// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/metatx/VibeForwarder.sol";
import "../../contracts/metatx/interfaces/IVibeForwarder.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

// ============ Mocks ============

contract MockVFInvToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockVFInvOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockVFInvTarget is ERC2771Context {
    uint256 public value;
    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {}
    function setValue(uint256 _value) external { value = _value; }
}

// ============ Handler ============

contract ForwarderHandler is Test {
    VibeForwarder public forwarder;
    MockVFInvToken public jul;
    MockVFInvTarget public target;

    address public relayer;
    address[] public users;
    uint256[] public userPKs;

    // Ghost variables
    uint256 public ghost_forwarded;
    uint256 public ghost_tipsDistributed;
    uint256 public ghost_relayersRegistered;

    bytes32 constant _FORWARD_REQUEST_TYPEHASH =
        keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)");

    constructor(
        VibeForwarder _forwarder,
        MockVFInvToken _jul,
        MockVFInvTarget _target,
        address _relayer
    ) {
        forwarder = _forwarder;
        jul = _jul;
        target = _target;
        relayer = _relayer;

        // Create user pool with known private keys
        for (uint256 i = 0; i < 5; i++) {
            uint256 pk = uint256(keccak256(abi.encodePacked("user", i))) % (type(uint256).max - 1) + 1;
            address user = vm.addr(pk);
            users.push(user);
            userPKs.push(pk);
        }
    }

    function forwardRequest(uint256 userSeed, uint256 valueSeed) public {
        uint256 idx = userSeed % users.length;
        address user = users[idx];
        uint256 pk = userPKs[idx];
        uint256 val = bound(valueSeed, 0, 1_000_000);

        uint256 nonce = forwarder.nonces(user);
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory data = abi.encodeCall(MockVFInvTarget.setValue, (val));

        bytes32 structHash = keccak256(abi.encode(
            _FORWARD_REQUEST_TYPEHASH,
            user, address(target), uint256(0), uint256(200_000), nonce, deadline, keccak256(data)
        ));

        bytes32 domainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("VibeForwarder")),
            keccak256(bytes("1")),
            block.chainid,
            address(forwarder)
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        ERC2771Forwarder.ForwardRequestData memory request = ERC2771Forwarder.ForwardRequestData({
            from: user, to: address(target), value: 0, gas: 200_000,
            deadline: deadline, data: data,
            signature: abi.encodePacked(r, s, v)
        });

        vm.prank(relayer);
        try forwarder.executeWithTracking(request) {
            ghost_forwarded++;
            if (forwarder.relayerTip() > 0) {
                ghost_tipsDistributed += forwarder.relayerTip();
            }
        } catch {}
    }

    function registerRelayer(uint256 seed) public {
        address newRelayer = address(uint160(bound(seed, 300_000, 300_050)));
        vm.prank(newRelayer);
        try forwarder.registerRelayer() {
            ghost_relayersRegistered++;
        } catch {}
    }

    function warpTime(uint256 seconds_) public {
        seconds_ = bound(seconds_, 0, 2 hours);
        vm.warp(block.timestamp + seconds_);
    }
}

// ============ Invariant Tests ============

contract ForwarderInvariantTest is StdInvariant, Test {
    VibeForwarder public forwarder;
    MockVFInvToken public jul;
    MockVFInvOracle public oracle;
    MockVFInvTarget public target;
    ForwarderHandler public handler;

    address public relayer;
    uint256 constant INITIAL_REWARD_POOL = 50_000 ether;
    uint256 constant RELAYER_TIP = 5 ether;

    function setUp() public {
        relayer = makeAddr("relayer");

        jul = new MockVFInvToken("JUL", "JUL");
        oracle = new MockVFInvOracle();

        forwarder = new VibeForwarder(address(jul), address(oracle), RELAYER_TIP, 100);
        target = new MockVFInvTarget(address(forwarder));

        forwarder.setTargetWhitelist(address(target), true);

        jul.mint(address(this), INITIAL_REWARD_POOL);
        jul.approve(address(forwarder), type(uint256).max);
        forwarder.depositJulRewards(INITIAL_REWARD_POOL);

        vm.prank(relayer);
        forwarder.registerRelayer();

        handler = new ForwarderHandler(forwarder, jul, target, relayer);
        targetContract(address(handler));
    }

    // ============ JUL Solvency Invariant ============

    /**
     * @notice JUL balance always covers reward pool.
     */
    function invariant_julSolvency() public view {
        uint256 balance = jul.balanceOf(address(forwarder));
        uint256 pool = forwarder.julRewardPool();
        assertGe(balance, pool, "JUL balance must cover reward pool");
    }

    // ============ Reward Pool Monotone ============

    /**
     * @notice Reward pool only decreases via tips (no deposits from handler).
     */
    function invariant_rewardPoolBounded() public view {
        assertLe(
            forwarder.julRewardPool(),
            INITIAL_REWARD_POOL,
            "Reward pool must not exceed initial deposit"
        );
    }

    // ============ Tips Match Forwards ============

    /**
     * @notice Total tips distributed equals forwards * tip rate (approximately).
     */
    function invariant_tipsConsistent() public view {
        uint256 expectedMaxTips = handler.ghost_forwarded() * RELAYER_TIP;
        uint256 poolDrain = INITIAL_REWARD_POOL - forwarder.julRewardPool();
        assertLe(poolDrain, expectedMaxTips, "Pool drain must not exceed expected tips");
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("--- Forwarder Invariant Summary ---");
        console.log("Forwarded:", handler.ghost_forwarded());
        console.log("Tips distributed:", handler.ghost_tipsDistributed());
        console.log("Relayers registered:", handler.ghost_relayersRegistered());
        console.log("Reward pool:", forwarder.julRewardPool());
    }
}
