// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/core/wBAR.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockWBARIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract WBARHandler is Test {
    wBAR public wbarToken;
    MockWBARIToken public tokenOut;
    address public coreAddr;

    // Ghost variables
    uint256 public ghost_totalMinted;
    uint256 public ghost_totalBurned;
    uint256 public ghost_positionCount;
    uint256 public ghost_settledCount;
    uint256 public ghost_redeemedCount;

    address[] public holders;
    bytes32[] public activePositions;
    bytes32[] public settledPositions;

    constructor(wBAR _wbar, MockWBARIToken _tokenOut, address _coreAddr) {
        wbarToken = _wbar;
        tokenOut = _tokenOut;
        coreAddr = _coreAddr;

        holders.push(address(uint160(500)));
        holders.push(address(uint160(501)));
        holders.push(address(uint160(502)));
    }

    function mintPosition(uint256 holderSeed, uint256 amount) public {
        amount = bound(amount, 1 ether, 100_000 ether);
        address holder = holders[holderSeed % holders.length];

        bytes32 commitId = keccak256(abi.encode("pos", ghost_positionCount));

        vm.prank(coreAddr);
        try wbarToken.mint(
            commitId, 1, holder,
            address(0x1), address(tokenOut),
            amount, 0
        ) {
            ghost_totalMinted += amount;
            ghost_positionCount++;
            activePositions.push(commitId);
        } catch {}
    }

    function settlePosition(uint256 positionSeed, uint256 amountOut) public {
        if (activePositions.length == 0) return;

        uint256 idx = positionSeed % activePositions.length;
        bytes32 commitId = activePositions[idx];

        IwBAR.Position memory pos = wbarToken.getPosition(commitId);
        if (pos.settled) return;

        amountOut = bound(amountOut, 0, 100_000 ether);

        vm.prank(coreAddr);
        try wbarToken.settle(commitId, amountOut) {
            ghost_settledCount++;
            settledPositions.push(commitId);

            // Fund wBAR for redemption
            tokenOut.mint(address(wbarToken), amountOut);
        } catch {}
    }

    function redeemPosition(uint256 positionSeed) public {
        if (settledPositions.length == 0) return;

        uint256 idx = positionSeed % settledPositions.length;
        bytes32 commitId = settledPositions[idx];

        IwBAR.Position memory pos = wbarToken.getPosition(commitId);
        if (pos.redeemed || !pos.settled) return;

        vm.prank(pos.holder);
        try wbarToken.redeem(commitId) {
            ghost_totalBurned += pos.amountIn;
            ghost_redeemedCount++;
        } catch {}
    }

    function getHolderCount() external view returns (uint256) {
        return holders.length;
    }

    function getActiveCount() external view returns (uint256) {
        return activePositions.length;
    }

    function getSettledCount() external view returns (uint256) {
        return settledPositions.length;
    }
}

// ============ Invariant Tests ============

contract wBARInvariantTest is StdInvariant, Test {
    wBAR public wbarToken;
    MockWBARIToken public tokenOut;
    WBARHandler public handler;

    address public coreAddr;

    function setUp() public {
        coreAddr = address(this);

        tokenOut = new MockWBARIToken("Out", "OUT");

        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            coreAddr,
            makeAddr("treasury"),
            address(0)
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);

        wbarToken = new wBAR(address(auctionProxy), coreAddr);

        handler = new WBARHandler(wbarToken, tokenOut, coreAddr);
        targetContract(address(handler));
    }

    // ============ Invariant: totalSupply = ghost_totalMinted - ghost_totalBurned ============

    function invariant_totalSupplyConsistent() public view {
        assertEq(
            wbarToken.totalSupply(),
            handler.ghost_totalMinted() - handler.ghost_totalBurned(),
            "SUPPLY: totalSupply != minted - burned"
        );
    }

    // ============ Invariant: settled positions have settled flag ============

    function invariant_settledPositionsMarked() public view {
        uint256 settledCount = handler.getSettledCount();

        for (uint256 i = 0; i < settledCount && i < 10; i++) {
            bytes32 commitId = handler.settledPositions(i);
            IwBAR.Position memory pos = wbarToken.getPosition(commitId);
            assertTrue(pos.settled, "SETTLED: position not marked settled");
        }
    }

    // ============ Invariant: redeemed count <= settled count ============

    function invariant_redeemedBounded() public view {
        assertLe(
            handler.ghost_redeemedCount(),
            handler.ghost_settledCount(),
            "REDEEMED: more redeemed than settled"
        );
    }

    // ============ Invariant: position count consistent ============

    function invariant_positionCountConsistent() public view {
        assertEq(
            handler.getActiveCount(),
            handler.ghost_positionCount(),
            "POSITIONS: active count != ghost count"
        );
    }

    // ============ Invariant: each position has a non-zero holder ============

    function invariant_positionsHaveHolders() public view {
        uint256 count = handler.getActiveCount();

        for (uint256 i = 0; i < count && i < 10; i++) {
            bytes32 commitId = handler.activePositions(i);
            IwBAR.Position memory pos = wbarToken.getPosition(commitId);
            assertTrue(pos.holder != address(0), "HOLDER: position has zero holder");
        }
    }
}
