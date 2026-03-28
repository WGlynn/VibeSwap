// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/StealthAddress.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 10_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockCompliance is IStealthComplianceRegistry {
    mapping(address => bool) public standing;
    constructor() { }
    function setStanding(address user, bool ok) external { standing[user] = ok; }
    function isInGoodStanding(address user) external view returns (bool) {
        return standing[user];
    }
}

// ============ Test Contract ============

contract StealthAddressTest is Test {
    // ============ Events ============

    event StealthMetaAddressRegistered(address indexed owner, bytes spendingPubKey, bytes viewingPubKey);
    event StealthMetaAddressUpdated(address indexed owner, bytes spendingPubKey, bytes viewingPubKey);
    event StealthPayment(
        address indexed stealthAddress,
        bytes ephemeralPubKey,
        bytes32 indexed viewTag,
        address indexed token,
        uint256 amount
    );
    event StealthWithdrawal(
        address indexed stealthAddress,
        address indexed token,
        uint256 amount,
        address indexed recipient
    );
    event ComplianceRegistryUpdated(address indexed registry);

    // ============ State ============

    StealthAddress public sa;
    MockERC20 public token;
    MockCompliance public compliance;

    address public owner;
    address public alice;
    address public bob;
    address public stealthAddr; // simulated one-time stealth address

    // Valid 33-byte compressed secp256k1 public keys
    bytes constant SPEND_KEY = hex"02f8b00e7fd6d1b40a1e94b2baae6c6073c4a77e3a2e8d9f1c5b4a3d2e1f0c9b8a";
    bytes constant VIEW_KEY  = hex"03a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
    bytes constant EPHEM_KEY = hex"02d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5";

    // ============ setUp ============

    function setUp() public {
        owner     = makeAddr("owner");
        alice     = makeAddr("alice");
        bob       = makeAddr("bob");
        stealthAddr = makeAddr("stealthAddr");

        token      = new MockERC20();
        compliance = new MockCompliance();

        // Deploy behind UUPS proxy (no compliance by default)
        StealthAddress impl = new StealthAddress();
        bytes memory initData = abi.encodeCall(
            StealthAddress.initialize,
            (owner, address(0))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sa = StealthAddress(address(proxy));

        // Fund accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(stealthAddr, 1 ether);

        token.mint(alice, 1000 ether);
        token.mint(bob, 1000 ether);

        vm.prank(alice);
        token.approve(address(sa), type(uint256).max);
        vm.prank(bob);
        token.approve(address(sa), type(uint256).max);
    }

    // ============ Helpers ============

    function _registerAlice() internal {
        vm.prank(alice);
        sa.registerStealthMeta(SPEND_KEY, VIEW_KEY);
    }

    // ============ Registration Tests ============

    function test_registerStealthMeta_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit StealthMetaAddressRegistered(alice, SPEND_KEY, VIEW_KEY);

        vm.prank(alice);
        sa.registerStealthMeta(SPEND_KEY, VIEW_KEY);
    }

    function test_registerStealthMeta_isRegistered() public {
        assertFalse(sa.isRegistered(alice));
        _registerAlice();
        assertTrue(sa.isRegistered(alice));
    }

    function test_registerStealthMeta_getData() public {
        _registerAlice();
        StealthAddress.StealthMetaAddress memory meta = sa.getStealthMeta(alice);
        assertEq(meta.owner, alice);
        assertEq(meta.spendingPubKey, SPEND_KEY);
        assertEq(meta.viewingPubKey, VIEW_KEY);
        assertGt(meta.registeredAt, 0);
    }

    function test_registerStealthMeta_updateEmitsUpdatedEvent() public {
        _registerAlice();

        bytes memory newSpend = hex"03b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
        bytes memory newView  = hex"02c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

        vm.expectEmit(true, false, false, true);
        emit StealthMetaAddressUpdated(alice, newSpend, newView);

        vm.prank(alice);
        sa.registerStealthMeta(newSpend, newView);
    }

    function test_registerStealthMeta_revertsInvalidKeyLength() public {
        bytes memory shortKey = hex"02aabb";
        vm.prank(alice);
        vm.expectRevert(StealthAddress.InvalidPubKeyLength.selector);
        sa.registerStealthMeta(shortKey, VIEW_KEY);
    }

    function test_getStealthMeta_revertsNotRegistered() public {
        vm.expectRevert(StealthAddress.MetaAddressNotRegistered.selector);
        sa.getStealthMeta(alice);
    }

    // ============ ETH Send Tests ============

    function test_sendStealth_eth_basic() public {
        uint256 amount = 1 ether;

        vm.expectEmit(true, false, true, true);
        emit StealthPayment(stealthAddr, EPHEM_KEY, bytes32(uint256(0xDEAD)), address(0), amount);

        vm.prank(alice);
        sa.sendStealth{value: amount}(stealthAddr, EPHEM_KEY, bytes32(uint256(0xDEAD)));

        assertEq(sa.stealthBalance(stealthAddr, address(0)), amount);
    }

    function test_sendStealth_eth_announcementLogged() public {
        uint256 amount = 0.5 ether;
        bytes32 viewTag = bytes32(uint256(0xFEED));

        assertEq(sa.announcementCount(), 0);

        vm.prank(alice);
        sa.sendStealth{value: amount}(stealthAddr, EPHEM_KEY, viewTag);

        assertEq(sa.announcementCount(), 1);
        StealthAddress.StealthAnnouncement[] memory anns = sa.getAnnouncements(0, 1);
        assertEq(anns.length, 1);
        assertEq(anns[0].stealthAddress, stealthAddr);
        assertEq(anns[0].amount, amount);
        assertEq(anns[0].token, address(0));
        assertEq(anns[0].viewTag, viewTag);
    }

    function test_sendStealth_eth_revertsZeroAddress() public {
        vm.prank(alice);
        vm.expectRevert(StealthAddress.ZeroAddress.selector);
        sa.sendStealth{value: 1 ether}(address(0), EPHEM_KEY, bytes32(0));
    }

    function test_sendStealth_eth_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(StealthAddress.ZeroAmount.selector);
        sa.sendStealth{value: 0}(stealthAddr, EPHEM_KEY, bytes32(0));
    }

    function test_sendStealth_eth_revertsInvalidEphemeralKeyLength() public {
        vm.prank(alice);
        vm.expectRevert(StealthAddress.InvalidPubKeyLength.selector);
        sa.sendStealth{value: 1 ether}(stealthAddr, hex"0102", bytes32(0));
    }

    // ============ ERC20 Send Tests ============

    function test_sendStealthToken_basic() public {
        uint256 amount = 100 ether;
        bytes32 viewTag = bytes32(uint256(0xBEEF));

        vm.prank(alice);
        sa.sendStealthToken(address(token), amount, stealthAddr, EPHEM_KEY, viewTag);

        assertEq(sa.stealthBalance(stealthAddr, address(token)), amount);
        assertEq(sa.announcementCount(), 1);
    }

    function test_sendStealthToken_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(StealthAddress.ZeroAmount.selector);
        sa.sendStealthToken(address(token), 0, stealthAddr, EPHEM_KEY, bytes32(0));
    }

    function test_sendStealthToken_revertsZeroTokenAddress() public {
        vm.prank(alice);
        vm.expectRevert(StealthAddress.ZeroAddress.selector);
        sa.sendStealthToken(address(0), 100 ether, stealthAddr, EPHEM_KEY, bytes32(0));
    }

    // ============ Withdrawal Tests ============

    function test_withdrawFromStealth_eth() public {
        uint256 amount = 1 ether;
        vm.prank(alice);
        sa.sendStealth{value: amount}(stealthAddr, EPHEM_KEY, bytes32(0));

        address recipient = makeAddr("recipient");
        uint256 recipientBefore = recipient.balance;

        vm.expectEmit(true, true, false, true);
        emit StealthWithdrawal(stealthAddr, address(0), amount, recipient);

        vm.prank(stealthAddr);
        sa.withdrawFromStealth(stealthAddr, address(0), amount, recipient);

        assertEq(sa.stealthBalance(stealthAddr, address(0)), 0);
        assertEq(recipient.balance, recipientBefore + amount);
    }

    function test_withdrawFromStealth_erc20() public {
        uint256 amount = 50 ether;
        vm.prank(alice);
        sa.sendStealthToken(address(token), amount, stealthAddr, EPHEM_KEY, bytes32(0));

        address recipient = makeAddr("recipient");

        vm.prank(stealthAddr);
        sa.withdrawFromStealth(stealthAddr, address(token), amount, recipient);

        assertEq(sa.stealthBalance(stealthAddr, address(token)), 0);
        assertEq(token.balanceOf(recipient), amount);
    }

    function test_withdrawFromStealth_partialWithdrawal() public {
        uint256 amount = 2 ether;
        vm.prank(alice);
        sa.sendStealth{value: amount}(stealthAddr, EPHEM_KEY, bytes32(0));

        address recipient = makeAddr("recipient");
        vm.prank(stealthAddr);
        sa.withdrawFromStealth(stealthAddr, address(0), 1 ether, recipient);

        assertEq(sa.stealthBalance(stealthAddr, address(0)), 1 ether);
    }

    function test_withdrawFromStealth_revertsWrongSender() public {
        uint256 amount = 1 ether;
        vm.prank(alice);
        sa.sendStealth{value: amount}(stealthAddr, EPHEM_KEY, bytes32(0));

        // alice tries to withdraw from stealthAddr but she's not msg.sender == stealthAddress
        vm.prank(alice);
        vm.expectRevert(StealthAddress.ZeroAddress.selector);
        sa.withdrawFromStealth(stealthAddr, address(0), amount, alice);
    }

    function test_withdrawFromStealth_revertsInsufficientBalance() public {
        vm.prank(stealthAddr);
        vm.expectRevert(StealthAddress.InsufficientBalance.selector);
        sa.withdrawFromStealth(stealthAddr, address(0), 1 ether, alice);
    }

    // ============ Pagination Tests ============

    function test_getAnnouncements_pagination() public {
        bytes32 viewTag = bytes32(uint256(0xABC));
        // Post 5 announcements from alice
        for (uint256 i = 0; i < 5; i++) {
            address sa_ = makeAddr(string(abi.encodePacked("stealth", i)));
            vm.deal(alice, alice.balance + 1 ether);
            vm.prank(alice);
            sa.sendStealth{value: 1 ether}(sa_, EPHEM_KEY, viewTag);
        }

        assertEq(sa.announcementCount(), 5);

        // Page 1: items 0-1
        StealthAddress.StealthAnnouncement[] memory page1 = sa.getAnnouncements(0, 2);
        assertEq(page1.length, 2);

        // Page 2: items 2-3
        StealthAddress.StealthAnnouncement[] memory page2 = sa.getAnnouncements(2, 2);
        assertEq(page2.length, 2);

        // Page 3: item 4 only
        StealthAddress.StealthAnnouncement[] memory page3 = sa.getAnnouncements(4, 10);
        assertEq(page3.length, 1);

        // Out of bounds
        StealthAddress.StealthAnnouncement[] memory empty = sa.getAnnouncements(10, 5);
        assertEq(empty.length, 0);
    }

    // ============ Compliance Tests ============

    function test_compliance_blocksNonCompliantSender() public {
        // Deploy with compliance registry
        StealthAddress impl2 = new StealthAddress();
        bytes memory initData2 = abi.encodeCall(
            StealthAddress.initialize,
            (owner, address(compliance))
        );
        ERC1967Proxy proxy2 = new ERC1967Proxy(address(impl2), initData2);
        StealthAddress saCompliant = StealthAddress(address(proxy2));

        vm.deal(alice, 10 ether);
        // alice not in good standing — should revert
        vm.prank(alice);
        vm.expectRevert(StealthAddress.ComplianceCheckFailed.selector);
        saCompliant.sendStealth{value: 1 ether}(stealthAddr, EPHEM_KEY, bytes32(0));
    }

    function test_compliance_allowsCompliantSender() public {
        StealthAddress impl2 = new StealthAddress();
        bytes memory initData2 = abi.encodeCall(
            StealthAddress.initialize,
            (owner, address(compliance))
        );
        ERC1967Proxy proxy2 = new ERC1967Proxy(address(impl2), initData2);
        StealthAddress saCompliant = StealthAddress(address(proxy2));

        compliance.setStanding(alice, true);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        saCompliant.sendStealth{value: 1 ether}(stealthAddr, EPHEM_KEY, bytes32(0));

        assertEq(saCompliant.stealthBalance(stealthAddr, address(0)), 1 ether);
    }

    // ============ Admin Tests ============

    function test_setComplianceRegistry_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        sa.setComplianceRegistry(address(compliance));
    }

    function test_setComplianceRegistry_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ComplianceRegistryUpdated(address(compliance));

        vm.prank(owner);
        sa.setComplianceRegistry(address(compliance));

        assertEq(address(sa.complianceRegistry()), address(compliance));
    }

    // ============ Fuzz Tests ============

    function testFuzz_registerAndSendEth(uint96 amount) public {
        vm.assume(amount > 0 && amount <= 50 ether);
        vm.deal(alice, uint256(amount));

        vm.prank(alice);
        sa.sendStealth{value: amount}(stealthAddr, EPHEM_KEY, bytes32(uint256(0xBEEF)));

        assertEq(sa.stealthBalance(stealthAddr, address(0)), uint256(amount));
        assertEq(sa.announcementCount(), 1);
    }
}
