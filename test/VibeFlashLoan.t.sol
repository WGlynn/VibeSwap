// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/financial/VibeFlashLoan.sol";

// ============ Mocks ============

contract MockFlashToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Mock liquidity pool — holds tokens and allows the flash loan contract to pull from it
contract MockPool {
    function transferTokens(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }

    function approveFor(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }
}

/// @notice Good borrower — returns tokens + fee in callback, returns CALLBACK_SUCCESS
contract MockBorrower is IVibeFlashBorrower {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    /// @dev The test setUp pre-mints extra tokens to this contract to cover fees
    function onFlashLoan(
        address /* initiator */,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata /* data */
    ) external override returns (bytes32) {
        // Repay: transfer amount + fee back to the lender (msg.sender)
        IERC20(token).transfer(msg.sender, amount + fee);
        return CALLBACK_SUCCESS;
    }
}

/// @notice Bad borrower — does NOT return tokens
contract BadBorrower is IVibeFlashBorrower {
    function onFlashLoan(
        address /* initiator */,
        address /* token */,
        uint256 /* amount */,
        uint256 /* fee */,
        bytes calldata /* data */
    ) external override returns (bytes32) {
        // Intentionally does not repay
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

/// @notice Wrong-return borrower — returns tokens but wrong callback selector
contract WrongReturnBorrower is IVibeFlashBorrower {
    function onFlashLoan(
        address /* initiator */,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata /* data */
    ) external override returns (bytes32) {
        IERC20(token).transfer(msg.sender, amount + fee);
        return keccak256("WRONG");
    }
}

// ============ Test Contract ============

contract VibeFlashLoanTest is Test {
    // Re-declare events for expectEmit
    event FlashLoanExecuted(address indexed borrower, address indexed token, uint256 amount, uint256 fee);
    event PoolRegistered(bytes32 indexed poolId, address pool, address token);
    event PoolRemoved(bytes32 indexed poolId);

    VibeFlashLoan public flashLoan;
    MockFlashToken public tokenA;
    MockFlashToken public tokenB;
    MockPool public pool1;
    MockPool public pool2;
    MockBorrower public goodBorrower;
    BadBorrower public badBorrower;
    WrongReturnBorrower public wrongBorrower;

    // ============ Actors ============

    address public owner;
    address public insuranceFund;
    address public alice;
    address public bob;

    // ============ Constants ============

    uint256 constant POOL_LIQUIDITY = 1_000_000 ether;
    uint256 constant LOAN_AMOUNT = 100_000 ether;

    function setUp() public {
        owner = address(this);
        insuranceFund = makeAddr("insuranceFund");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy tokens
        tokenA = new MockFlashToken("Token A", "TKA");
        tokenB = new MockFlashToken("Token B", "TKB");

        // Deploy flash loan via UUPS proxy
        VibeFlashLoan impl = new VibeFlashLoan();
        bytes memory initData = abi.encodeWithSelector(
            VibeFlashLoan.initialize.selector,
            insuranceFund
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        flashLoan = VibeFlashLoan(address(proxy));

        // Deploy mock pools
        pool1 = new MockPool();
        pool2 = new MockPool();

        // Deploy borrowers
        goodBorrower = new MockBorrower();
        badBorrower = new BadBorrower();
        wrongBorrower = new WrongReturnBorrower();

        // Fund the flash loan contract with liquidity (tokens held directly)
        tokenA.mint(address(flashLoan), POOL_LIQUIDITY);
        tokenB.mint(address(flashLoan), POOL_LIQUIDITY);

        // Pre-mint fee tokens to the good borrower so it can repay amount + fee
        // Max fee is 1% = 1000 ether on a 100k loan
        tokenA.mint(address(goodBorrower), 10_000 ether);
        tokenB.mint(address(goodBorrower), 10_000 ether);

        // Pre-mint to wrong-return borrower too
        tokenA.mint(address(wrongBorrower), 10_000 ether);

        // Register pools
        flashLoan.registerPool(address(pool1), address(tokenA), 500_000 ether);
        flashLoan.registerPool(address(pool2), address(tokenA), 500_000 ether);
        flashLoan.registerPool(address(pool1), address(tokenB), POOL_LIQUIDITY);
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(flashLoan.owner(), owner);
        assertEq(flashLoan.insuranceFund(), insuranceFund);
        assertEq(flashLoan.loanCount(), 0);
        assertEq(flashLoan.BASE_FEE_BPS(), 9);
        assertEq(flashLoan.MAX_FEE_BPS(), 100);
        assertEq(flashLoan.INSURANCE_CUT_BPS(), 1000);
        assertEq(flashLoan.BPS(), 10000);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        flashLoan.initialize(insuranceFund);
    }

    // ============ Register Pool ============

    function test_registerPool_success() public {
        MockPool newPool = new MockPool();
        bytes32 expectedId = keccak256(abi.encodePacked(address(newPool), address(tokenA)));

        vm.expectEmit(true, false, false, true);
        emit PoolRegistered(expectedId, address(newPool), address(tokenA));

        flashLoan.registerPool(address(newPool), address(tokenA), 250_000 ether);

        // Verify pool was registered (4 pools total now)
        assertEq(flashLoan.getPoolCount(), 4);
    }

    function test_registerPool_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        flashLoan.registerPool(address(pool1), address(tokenA), 100 ether);
    }

    function test_registerPool_storesCorrectData() public {
        bytes32 poolId = keccak256(abi.encodePacked(address(pool1), address(tokenA)));
        (address poolAddr, address token, uint256 maxAmount, bool active) = flashLoan.pools(poolId);

        assertEq(poolAddr, address(pool1));
        assertEq(token, address(tokenA));
        assertEq(maxAmount, 500_000 ether);
        assertTrue(active);
    }

    function test_registerPool_multipleForSameToken() public view {
        // setUp already registered 2 pools for tokenA
        assertEq(flashLoan.getPoolCount(), 3);
    }

    // ============ Remove Pool ============

    function test_removePool_success() public {
        bytes32 poolId = keccak256(abi.encodePacked(address(pool1), address(tokenA)));

        vm.expectEmit(true, false, false, false);
        emit PoolRemoved(poolId);

        flashLoan.removePool(poolId);

        (, , , bool active) = flashLoan.pools(poolId);
        assertFalse(active);
    }

    function test_removePool_onlyOwner() public {
        bytes32 poolId = keccak256(abi.encodePacked(address(pool1), address(tokenA)));

        vm.prank(alice);
        vm.expectRevert();
        flashLoan.removePool(poolId);
    }

    function test_removePool_idempotent() public {
        bytes32 poolId = keccak256(abi.encodePacked(address(pool1), address(tokenA)));

        flashLoan.removePool(poolId);
        // Removing again should not revert (just sets active = false again)
        flashLoan.removePool(poolId);

        (, , , bool active) = flashLoan.pools(poolId);
        assertFalse(active);
    }

    // ============ Flash Loan — Success ============

    function test_flashLoan_success() public {
        uint256 amount = LOAN_AMOUNT;
        uint256 expectedFee = flashLoan.flashFee(address(tokenA), amount);

        uint256 contractBalBefore = tokenA.balanceOf(address(flashLoan));

        vm.expectEmit(true, true, false, true);
        emit FlashLoanExecuted(address(this), address(tokenA), amount, expectedFee);

        bool success = flashLoan.flashLoan(
            address(goodBorrower),
            address(tokenA),
            amount,
            ""
        );

        assertTrue(success);
        assertEq(flashLoan.loanCount(), 1);

        // Contract should have gained fee minus insurance cut
        uint256 insuranceCut = (expectedFee * 1000) / 10000; // 10%
        uint256 contractBalAfter = tokenA.balanceOf(address(flashLoan));

        // Contract balance: before + fee - insuranceCut
        assertEq(contractBalAfter, contractBalBefore + expectedFee - insuranceCut);
    }

    function test_flashLoan_updatesVolume() public {
        uint256 amount = LOAN_AMOUNT;

        flashLoan.flashLoan(address(goodBorrower), address(tokenA), amount, "");

        assertEq(flashLoan.getTotalVolume(address(tokenA)), amount);
    }

    function test_flashLoan_multipleLoansCumulativeVolume() public {
        uint256 amount = LOAN_AMOUNT;

        flashLoan.flashLoan(address(goodBorrower), address(tokenA), amount, "");
        flashLoan.flashLoan(address(goodBorrower), address(tokenA), amount, "");

        assertEq(flashLoan.loanCount(), 2);
        assertEq(flashLoan.getTotalVolume(address(tokenA)), amount * 2);
    }

    function test_flashLoan_differentTokens() public {
        flashLoan.flashLoan(address(goodBorrower), address(tokenA), LOAN_AMOUNT, "");
        flashLoan.flashLoan(address(goodBorrower), address(tokenB), LOAN_AMOUNT, "");

        assertEq(flashLoan.loanCount(), 2);
        assertEq(flashLoan.getTotalVolume(address(tokenA)), LOAN_AMOUNT);
        assertEq(flashLoan.getTotalVolume(address(tokenB)), LOAN_AMOUNT);
    }

    function test_flashLoan_passesDataToBorrower() public {
        bytes memory testData = abi.encode("test payload", uint256(42));

        // Should not revert — data is passed through to callback
        bool success = flashLoan.flashLoan(
            address(goodBorrower),
            address(tokenA),
            LOAN_AMOUNT,
            testData
        );
        assertTrue(success);
    }

    // ============ Flash Loan — Failure Cases ============

    function test_flashLoan_insufficientLiquidity() public {
        // Try to borrow more than what the contract holds
        uint256 tooMuch = POOL_LIQUIDITY + 1;

        vm.expectRevert("Insufficient liquidity");
        flashLoan.flashLoan(address(goodBorrower), address(tokenA), tooMuch, "");
    }

    function test_flashLoan_badBorrower_noRepayment() public {
        vm.expectRevert("Loan not repaid");
        flashLoan.flashLoan(address(badBorrower), address(tokenA), LOAN_AMOUNT, "");
    }

    function test_flashLoan_wrongCallbackReturn() public {
        vm.expectRevert("Callback failed");
        flashLoan.flashLoan(address(wrongBorrower), address(tokenA), LOAN_AMOUNT, "");
    }

    function test_flashLoan_zeroAmount() public {
        // Zero amount loan — fee is 0, should succeed trivially
        bool success = flashLoan.flashLoan(
            address(goodBorrower),
            address(tokenA),
            0,
            ""
        );
        assertTrue(success);
    }

    // ============ Flash Fee ============

    function test_flashFee_baseFee_zeroUtilization() public view {
        // At 0% utilization, fee = BASE_FEE_BPS (9) / BPS (10000) * amount
        uint256 amount = 1_000_000 ether;
        uint256 fee = flashLoan.flashFee(address(tokenA), amount);

        // fee = (1_000_000 ether * 9) / 10000 = 900 ether
        assertEq(fee, (amount * 9) / 10000);
    }

    function test_flashFee_scalesWithAmount() public view {
        uint256 fee1 = flashLoan.flashFee(address(tokenA), 100 ether);
        uint256 fee2 = flashLoan.flashFee(address(tokenA), 200 ether);

        // Fee should scale linearly at same utilization
        assertEq(fee2, fee1 * 2);
    }

    function test_flashFee_zeroAmount() public view {
        uint256 fee = flashLoan.flashFee(address(tokenA), 0);
        assertEq(fee, 0);
    }

    function test_flashFee_dynamicPricing() public view {
        // tokenUtilization is a public mapping — at 0% utilization, fee = BASE_FEE_BPS
        // At 100% utilization (10000 bps): fee = BASE_FEE + (MAX_FEE - BASE_FEE) * 10000 / 10000
        //                                      = 9 + 91 = 100 bps = 1%

        uint256 amount = 10_000 ether;

        // At 0% util: fee = amount * 9 / 10000
        uint256 feeAtZero = flashLoan.flashFee(address(tokenA), amount);
        assertEq(feeAtZero, (amount * 9) / 10000); // 9 ether

        // For a token with no utilization set, baseFee applies
        address randomToken = address(0xdead1234);
        uint256 feeRandom = flashLoan.flashFee(randomToken, amount);
        assertEq(feeRandom, (amount * 9) / 10000);
    }

    function test_flashFee_formula_consistency() public view {
        // Verify: fee = (amount * (BASE_FEE_BPS + (MAX_FEE_BPS - BASE_FEE_BPS) * util / BPS)) / BPS
        // At 0 util: fee = amount * 9 / 10000
        uint256 amount = 123_456 ether;
        uint256 fee = flashLoan.flashFee(address(tokenA), amount);

        uint256 expectedFeeBps = 9 + ((100 - 9) * 0) / 10000; // = 9
        uint256 expectedFee = (amount * expectedFeeBps) / 10000;

        assertEq(fee, expectedFee);
    }

    // ============ Max Flash Loan ============

    function test_maxFlashLoan_returnsContractBalance() public view {
        uint256 max = flashLoan.maxFlashLoan(address(tokenA));
        assertEq(max, POOL_LIQUIDITY);
    }

    function test_maxFlashLoan_differentTokens() public view {
        assertEq(flashLoan.maxFlashLoan(address(tokenA)), POOL_LIQUIDITY);
        assertEq(flashLoan.maxFlashLoan(address(tokenB)), POOL_LIQUIDITY);
    }

    function test_maxFlashLoan_unregisteredToken() public {
        // Deploy a real token contract that is NOT registered as a pool in flashLoan
        // maxFlashLoan returns balanceOf(this) — for an unregistered token the balance is 0
        MockFlashToken unregistered = new MockFlashToken("Unregistered", "UNR");
        assertEq(flashLoan.maxFlashLoan(address(unregistered)), 0);
    }

    function test_maxFlashLoan_decreasesAfterLoan() public {
        uint256 maxBefore = flashLoan.maxFlashLoan(address(tokenA));

        flashLoan.flashLoan(address(goodBorrower), address(tokenA), LOAN_AMOUNT, "");

        uint256 maxAfter = flashLoan.maxFlashLoan(address(tokenA));

        // After loan: contract has (original + fee - insuranceCut)
        uint256 fee = flashLoan.flashFee(address(tokenA), LOAN_AMOUNT);
        uint256 insuranceCut = (fee * 1000) / 10000;

        // maxAfter should be original + fee - insuranceCut
        assertEq(maxAfter, maxBefore + fee - insuranceCut);
    }

    // ============ Insurance Fund ============

    function test_insurance_receivesCut() public {
        uint256 insuranceBalBefore = tokenA.balanceOf(insuranceFund);

        flashLoan.flashLoan(address(goodBorrower), address(tokenA), LOAN_AMOUNT, "");

        uint256 fee = flashLoan.flashFee(address(tokenA), LOAN_AMOUNT);
        uint256 expectedInsuranceCut = (fee * 1000) / 10000; // 10% of fee

        uint256 insuranceBalAfter = tokenA.balanceOf(insuranceFund);
        assertEq(insuranceBalAfter - insuranceBalBefore, expectedInsuranceCut);
    }

    function test_insurance_exactPercentage() public {
        // Verify 10% of fee goes to insurance
        uint256 amount = 500_000 ether;
        uint256 fee = flashLoan.flashFee(address(tokenA), amount);

        // Need to ensure borrower has enough to repay
        tokenA.mint(address(goodBorrower), fee);

        flashLoan.flashLoan(address(goodBorrower), address(tokenA), amount, "");

        uint256 insuranceBal = tokenA.balanceOf(insuranceFund);
        // 10% of fee = fee * 1000 / 10000
        assertEq(insuranceBal, (fee * 1000) / 10000);
    }

    function test_insurance_cumulativeAcrossLoans() public {
        uint256 amount = LOAN_AMOUNT;
        uint256 fee = flashLoan.flashFee(address(tokenA), amount);
        uint256 insuranceCutPerLoan = (fee * 1000) / 10000;

        flashLoan.flashLoan(address(goodBorrower), address(tokenA), amount, "");
        flashLoan.flashLoan(address(goodBorrower), address(tokenA), amount, "");

        uint256 insuranceBal = tokenA.balanceOf(insuranceFund);
        assertEq(insuranceBal, insuranceCutPerLoan * 2);
    }

    function test_insurance_zeroFee_noCutSent() public {
        // Zero amount loan => zero fee => no insurance transfer
        uint256 insuranceBalBefore = tokenA.balanceOf(insuranceFund);

        flashLoan.flashLoan(address(goodBorrower), address(tokenA), 0, "");

        uint256 insuranceBalAfter = tokenA.balanceOf(insuranceFund);
        assertEq(insuranceBalAfter, insuranceBalBefore);
    }

    // ============ Access Control ============

    function test_onlyOwner_registerPool() public {
        vm.prank(bob);
        vm.expectRevert();
        flashLoan.registerPool(address(pool1), address(tokenA), 100 ether);
    }

    function test_onlyOwner_removePool() public {
        bytes32 poolId = keccak256(abi.encodePacked(address(pool1), address(tokenA)));

        vm.prank(bob);
        vm.expectRevert();
        flashLoan.removePool(poolId);
    }

    function test_flashLoan_anyoneCanCall() public {
        // Flash loans are permissionless — alice can call
        vm.prank(alice);
        bool success = flashLoan.flashLoan(
            address(goodBorrower),
            address(tokenA),
            LOAN_AMOUNT,
            ""
        );
        assertTrue(success);
    }

    // ============ View Functions ============

    function test_getPoolCount() public view {
        // setUp registers 3 pools
        assertEq(flashLoan.getPoolCount(), 3);
    }

    function test_getTotalVolume_initiallyZero() public view {
        assertEq(flashLoan.getTotalVolume(address(tokenA)), 0);
        assertEq(flashLoan.getTotalVolume(address(tokenB)), 0);
    }

    function test_callbackSuccessConstant() public view {
        assertEq(
            flashLoan.CALLBACK_SUCCESS(),
            keccak256("ERC3156FlashBorrower.onFlashLoan")
        );
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_onlyOwner() public {
        VibeFlashLoan newImpl = new VibeFlashLoan();

        vm.prank(alice);
        vm.expectRevert();
        flashLoan.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_rejectsEOA() public {
        // _authorizeUpgrade requires newImplementation.code.length > 0
        address eoa = makeAddr("eoa");

        vm.expectRevert("Not a contract");
        flashLoan.upgradeToAndCall(eoa, "");
    }
}
