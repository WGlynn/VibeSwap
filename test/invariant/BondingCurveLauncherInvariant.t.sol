// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/BondingCurveLauncher.sol";

// ============ Mock Token ============

contract MockBCLIToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount);
        require(allowance[from][msg.sender] >= amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

// ============ Handler ============

contract BCLHandler is Test {
    BondingCurveLauncher public bcl;
    MockBCLIToken public launchToken;
    MockBCLIToken public reserveToken;
    uint256 public launchId;

    address[] public buyers;

    // Ghost variables
    uint256 public ghost_totalBought;
    uint256 public ghost_totalSold;
    uint256 public ghost_totalReserveIn;
    uint256 public ghost_totalReserveOut;

    constructor(
        BondingCurveLauncher _bcl,
        MockBCLIToken _launchToken,
        MockBCLIToken _reserveToken,
        uint256 _launchId,
        address[] memory _buyers
    ) {
        bcl = _bcl;
        launchToken = _launchToken;
        reserveToken = _reserveToken;
        launchId = _launchId;
        buyers = _buyers;
    }

    function buy(uint256 buyerSeed, uint256 amount) public {
        amount = bound(amount, 0.01 ether, 100 ether);
        address buyer = buyers[buyerSeed % buyers.length];

        uint256 quote = bcl.buyQuote(launchId, amount);

        vm.prank(buyer);
        try bcl.buy(launchId, amount, quote) {
            ghost_totalBought += amount;
            ghost_totalReserveIn += quote;
        } catch {}
    }

    function sell(uint256 buyerSeed, uint256 amount) public {
        if (ghost_totalBought == 0) return;

        address buyer = buyers[buyerSeed % buyers.length];
        uint256 bal = launchToken.balanceOf(buyer);
        if (bal == 0) return;

        amount = bound(amount, 1, bal);

        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(launchId);
        if (amount > l.tokensSold) return;

        vm.prank(buyer);
        launchToken.approve(address(bcl), amount);

        uint256 balBefore = reserveToken.balanceOf(buyer);
        vm.prank(buyer);
        try bcl.sell(launchId, amount, 0) {
            ghost_totalSold += amount;
            ghost_totalReserveOut += reserveToken.balanceOf(buyer) - balBefore;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract BondingCurveLauncherInvariantTest is StdInvariant, Test {
    BondingCurveLauncher public bcl;
    MockBCLIToken public launchToken;
    MockBCLIToken public reserveToken;
    BCLHandler public handler;

    address public treasuryAddr;
    address public creator;
    address[] public buyers;
    uint256 public launchId;

    function setUp() public {
        treasuryAddr = makeAddr("treasury");
        creator = makeAddr("creator");

        bcl = new BondingCurveLauncher(treasuryAddr);

        launchToken = new MockBCLIToken();
        reserveToken = new MockBCLIToken();

        // Fund contract with launch tokens
        launchToken.mint(address(bcl), 10_000_000 ether);

        // Create buyers
        for (uint256 i = 0; i < 5; i++) {
            address b = makeAddr(string(abi.encodePacked("buyer", vm.toString(i))));
            buyers.push(b);
            reserveToken.mint(b, 1_000_000 ether);
            vm.prank(b);
            reserveToken.approve(address(bcl), type(uint256).max);
        }

        // Create launch
        vm.prank(creator);
        launchId = bcl.createLaunch(
            address(launchToken),
            address(reserveToken),
            0.01 ether,
            0.001 ether,
            1_000_000 ether,
            1_000_000 ether,
            200 // 2% creator fee
        );

        handler = new BCLHandler(bcl, launchToken, reserveToken, launchId, buyers);
        targetContract(address(handler));
    }

    // ============ Invariant: reserve balance covers recorded amount ============

    function invariant_reserveSolvent() public view {
        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(launchId);
        uint256 contractBal = reserveToken.balanceOf(address(bcl));
        assertGe(contractBal, l.reserveBalance, "SOLVENCY: reserve token balance < recorded reserve");
    }

    // ============ Invariant: tokensSold = bought - sold ============

    function invariant_tokensSoldConsistent() public view {
        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(launchId);
        assertEq(
            l.tokensSold,
            handler.ghost_totalBought() - handler.ghost_totalSold(),
            "SOLD: tokensSold != bought - sold"
        );
    }

    // ============ Invariant: price is monotonically increasing with supply ============

    function invariant_pricePositive() public view {
        uint256 price = bcl.currentPrice(launchId);
        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(launchId);
        uint256 expected = l.initialPrice + (l.curveSlope * l.tokensSold) / 1e18;
        assertEq(price, expected, "PRICE: doesn't match formula");
    }

    // ============ Invariant: tokensSold <= maxSupply ============

    function invariant_supplyBounded() public view {
        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(launchId);
        assertLe(l.tokensSold, l.maxSupply, "SUPPLY: exceeds maxSupply");
    }

    // ============ Invariant: state machine valid ============

    function invariant_validState() public view {
        IBondingCurveLauncher.TokenLaunch memory l = bcl.getLaunch(launchId);
        uint8 state = uint8(l.state);
        assertTrue(state <= uint8(IBondingCurveLauncher.LaunchState.FAILED), "STATE: invalid");
    }

    // ============ Invariant: reserve in >= reserve out ============

    function invariant_reserveFlowPositive() public view {
        assertGe(
            handler.ghost_totalReserveIn(),
            handler.ghost_totalReserveOut(),
            "FLOW: more reserve out than in"
        );
    }
}
