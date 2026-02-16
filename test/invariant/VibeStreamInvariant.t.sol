// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VibeStream.sol";
import "../../contracts/financial/interfaces/IVibeStream.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockStreamIToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract StreamHandler is Test {
    VibeStream public stream;
    MockStreamIToken public token;

    address public sender;
    address public recipient;

    uint256[] public activeStreamIds;

    // Ghost variables
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_totalRefunded;
    uint256 public ghost_streamCount;
    uint256 public ghost_cancelCount;

    constructor(VibeStream _stream, MockStreamIToken _token, address _sender, address _recipient) {
        stream = _stream;
        token = _token;
        sender = _sender;
        recipient = _recipient;
    }

    function createStream(uint128 deposit, uint40 duration) public {
        deposit = uint128(bound(deposit, 1 ether, 1000 ether));
        duration = uint40(bound(duration, 1 days, 365 days));

        token.mint(sender, deposit);
        vm.prank(sender);
        token.approve(address(stream), deposit);

        uint256 start = block.timestamp;

        vm.prank(sender);
        try stream.createStream(IVibeStream.CreateParams({
            recipient: recipient,
            token: address(token),
            depositAmount: deposit,
            startTime: uint40(start),
            endTime: uint40(start) + duration,
            cliffTime: 0,
            cancelable: true
        })) returns (uint256 streamId) {
            activeStreamIds.push(streamId);
            ghost_totalDeposited += deposit;
            ghost_streamCount++;
        } catch {}
    }

    function withdrawFromStream(uint256 streamSeed) public {
        if (activeStreamIds.length == 0) return;

        uint256 streamId = activeStreamIds[streamSeed % activeStreamIds.length];

        try stream.withdrawable(streamId) returns (uint128 available) {
            if (available == 0) return;

            vm.prank(recipient);
            try stream.withdraw(streamId, available, recipient) {
                ghost_totalWithdrawn += available;
            } catch {}
        } catch {}
    }

    function cancelStream(uint256 streamSeed) public {
        if (activeStreamIds.length == 0) return;

        uint256 streamId = activeStreamIds[streamSeed % activeStreamIds.length];

        try stream.getStream(streamId) returns (IVibeStream.Stream memory s) {
            if (s.canceled || !s.cancelable) return;

            uint256 senderBefore = token.balanceOf(sender);

            vm.prank(sender);
            try stream.cancel(streamId) {
                uint256 refund = token.balanceOf(sender) - senderBefore;
                ghost_totalRefunded += refund;
                ghost_cancelCount++;
            } catch {}
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 30 days);
        vm.warp(block.timestamp + delta);
    }

    function getActiveCount() external view returns (uint256) {
        return activeStreamIds.length;
    }
}

// ============ Invariant Tests ============

contract VibeStreamInvariantTest is StdInvariant, Test {
    VibeStream public stream;
    MockStreamIToken public token;
    StreamHandler public handler;

    address public sender;
    address public recipient;

    function setUp() public {
        sender = makeAddr("sender");
        recipient = makeAddr("recipient");

        stream = new VibeStream();
        token = new MockStreamIToken("USD Coin", "USDC");

        handler = new StreamHandler(stream, token, sender, recipient);
        targetContract(address(handler));
    }

    // ============ Invariant: contract balance >= deposits - withdrawn - refunded ============

    function invariant_tokenBalanceSolvent() public view {
        uint256 bal = token.balanceOf(address(stream));
        uint256 expected = handler.ghost_totalDeposited()
            - handler.ghost_totalWithdrawn()
            - handler.ghost_totalRefunded();

        assertGe(bal, expected, "SOLVENCY: token balance below expected");
    }

    // ============ Invariant: withdrawn + refunded <= deposited ============

    function invariant_flowsConsistent() public view {
        assertLe(
            handler.ghost_totalWithdrawn() + handler.ghost_totalRefunded(),
            handler.ghost_totalDeposited(),
            "FLOW: outflows exceed deposits"
        );
    }

    // ============ Invariant: totalStreams = stream count ============

    function invariant_streamCountConsistent() public view {
        assertEq(
            stream.totalStreams(),
            handler.ghost_streamCount(),
            "COUNT: totalStreams must equal ghost count"
        );
    }

    // ============ Invariant: cancel count <= stream count ============

    function invariant_cancelsLeStreams() public view {
        assertLe(
            handler.ghost_cancelCount(),
            handler.ghost_streamCount(),
            "CANCEL: cancels cannot exceed streams"
        );
    }

    // ============ Invariant: withdrawable never exceeds deposit for any stream ============

    function invariant_withdrawableNeverExceedsDeposit() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 streamId = handler.activeStreamIds(i);
            try stream.getStream(streamId) returns (IVibeStream.Stream memory s) {
                try stream.withdrawable(streamId) returns (uint128 w) {
                    assertLe(w, s.depositAmount, "WITHDRAW: exceeds deposit for stream");
                } catch {}
            } catch {}
        }
    }
}
