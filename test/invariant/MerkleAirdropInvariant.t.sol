// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/incentives/MerkleAirdrop.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockAirdropInvToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract AirdropHandler is Test {
    MerkleAirdrop public airdrop;
    MockAirdropInvToken public token;
    address public owner;

    uint256 public ghost_totalFunded;
    uint256 public ghost_totalClaimed;
    uint256 public ghost_distributions;

    // Track claims per distribution
    mapping(uint256 => mapping(address => bool)) public ghost_claimed;

    // Pre-built distributions for handler
    bytes32[] public roots;
    uint256[] public amounts;
    address[] public recipients;

    constructor(MerkleAirdrop _airdrop, MockAirdropInvToken _token, address _owner) {
        airdrop = _airdrop;
        token = _token;
        owner = _owner;
    }

    function createDistribution(uint256 amount) public {
        amount = bound(amount, 1 ether, 1_000_000 ether);

        // Create a single-leaf tree with a unique recipient
        address recipient = address(uint160(0x1000 + ghost_distributions));
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, amount))));

        // Fund and create
        token.mint(owner, amount);
        vm.startPrank(owner);
        token.approve(address(airdrop), amount);
        try airdrop.createDistribution(address(token), leaf, amount, block.timestamp + 30 days) {
            ghost_totalFunded += amount;
            ghost_distributions++;
            roots.push(leaf);
            amounts.push(amount);
            recipients.push(recipient);
        } catch {}
        vm.stopPrank();
    }

    function claimRandom(uint256 distSeed) public {
        if (ghost_distributions == 0) return;
        uint256 distId = distSeed % ghost_distributions;

        address recipient = recipients[distId];
        uint256 amount = amounts[distId];

        if (ghost_claimed[distId][recipient]) return;

        bytes32[] memory proof = new bytes32[](0);

        try airdrop.claim(distId, recipient, amount, proof) {
            ghost_totalClaimed += amount;
            ghost_claimed[distId][recipient] = true;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract MerkleAirdropInvariantTest is StdInvariant, Test {
    MockAirdropInvToken token;
    MerkleAirdrop airdrop;
    AirdropHandler handler;

    function setUp() public {
        token = new MockAirdropInvToken();
        airdrop = new MerkleAirdrop();

        handler = new AirdropHandler(airdrop, token, address(this));
        targetContract(address(handler));
    }

    // ============ Invariant: airdrop balance = funded - claimed ============

    function invariant_balanceConsistency() public view {
        uint256 airdropBalance = token.balanceOf(address(airdrop));
        assertEq(airdropBalance, handler.ghost_totalFunded() - handler.ghost_totalClaimed());
    }

    // ============ Invariant: claimed never exceeds funded ============

    function invariant_claimedNeverExceedsFunded() public view {
        assertLe(handler.ghost_totalClaimed(), handler.ghost_totalFunded());
    }

    // ============ Invariant: distribution count matches ghost ============

    function invariant_distributionCountMatchesGhost() public view {
        assertEq(airdrop.distributionCount(), handler.ghost_distributions());
    }

    // ============ Invariant: claimed amount per distribution accurate ============

    function invariant_claimedAmountAccurate() public view {
        for (uint256 i; i < handler.ghost_distributions() && i < 5; i++) {
            IMerkleAirdrop.Distribution memory dist = airdrop.getDistribution(i);
            assertLe(dist.claimedAmount, dist.totalAmount);
        }
    }
}
