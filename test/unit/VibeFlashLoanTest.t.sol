// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeFlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFlashToken is ERC20 {
    constructor() ERC20("FLASH", "FLASH") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Good borrower — repays loan + fee
contract GoodBorrower is IVibeFlashBorrower {
    function onFlashLoan(
        address,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external returns (bytes32) {
        // Approve repayment (amount + fee back to lender)
        IERC20(token).approve(msg.sender, amount + fee);
        // Transfer back
        IERC20(token).transfer(msg.sender, amount + fee);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

/// @notice Bad borrower — doesn't repay
contract BadBorrower is IVibeFlashBorrower {
    function onFlashLoan(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes32) {
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

/// @notice Wrong return borrower
contract WrongReturnBorrower is IVibeFlashBorrower {
    function onFlashLoan(
        address,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external returns (bytes32) {
        IERC20(token).transfer(msg.sender, amount + fee);
        return keccak256("WRONG");
    }
}

// ============ Tests ============

contract VibeFlashLoanTest is Test {
    VibeFlashLoan public flashLoan;
    MockFlashToken public token;
    GoodBorrower public goodBorrower;
    BadBorrower public badBorrower;
    WrongReturnBorrower public wrongBorrower;

    address insuranceFund = address(0xEE);

    function setUp() public {
        flashLoan = new VibeFlashLoan();
        flashLoan.initialize(insuranceFund);

        token = new MockFlashToken();
        goodBorrower = new GoodBorrower();
        badBorrower = new BadBorrower();
        wrongBorrower = new WrongReturnBorrower();

        // Seed flash loan contract with liquidity
        token.mint(address(flashLoan), 1_000_000e18);

        // Give borrowers tokens to pay fees
        token.mint(address(goodBorrower), 100_000e18);
        token.mint(address(wrongBorrower), 100_000e18);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(flashLoan.insuranceFund(), insuranceFund);
        assertEq(flashLoan.loanCount(), 0);
        assertEq(flashLoan.BASE_FEE_BPS(), 9);
        assertEq(flashLoan.MAX_FEE_BPS(), 100);
    }

    // ============ Pool Management ============

    function test_registerPool() public {
        address poolAddr = address(0x1234);
        flashLoan.registerPool(poolAddr, address(token), 1000e18);

        assertEq(flashLoan.getPoolCount(), 1);
    }

    function test_removePool() public {
        address poolAddr = address(0x1234);
        flashLoan.registerPool(poolAddr, address(token), 1000e18);

        bytes32 poolId = keccak256(abi.encodePacked(poolAddr, address(token)));
        flashLoan.removePool(poolId);

        (, , , bool active) = flashLoan.pools(poolId);
        assertFalse(active);
    }

    function test_revertRegisterPoolNotOwner() public {
        vm.prank(address(0xA1));
        vm.expectRevert();
        flashLoan.registerPool(address(0x1234), address(token), 1000e18);
    }

    // ============ Flash Loan Execution ============

    function test_flashLoanSuccess() public {
        uint256 amount = 100_000e18;
        uint256 balanceBefore = token.balanceOf(address(flashLoan));

        bool success = flashLoan.flashLoan(
            address(goodBorrower),
            address(token),
            amount,
            ""
        );

        assertTrue(success);
        assertEq(flashLoan.loanCount(), 1);
        assertEq(flashLoan.getTotalVolume(address(token)), amount);

        // Flash loan contract should have more tokens (fee earned minus insurance cut)
        uint256 fee = flashLoan.flashFee(address(token), amount);
        uint256 insuranceCut = (fee * 1000) / 10000;
        assertEq(
            token.balanceOf(address(flashLoan)),
            balanceBefore + fee - insuranceCut
        );
    }

    function test_flashLoanInsuranceCut() public {
        uint256 amount = 100_000e18;
        uint256 insuranceBefore = token.balanceOf(insuranceFund);

        flashLoan.flashLoan(
            address(goodBorrower),
            address(token),
            amount,
            ""
        );

        uint256 fee = flashLoan.flashFee(address(token), amount);
        uint256 expectedInsurance = (fee * 1000) / 10000;
        assertEq(token.balanceOf(insuranceFund), insuranceBefore + expectedInsurance);
    }

    function test_revertFlashLoanInsufficientLiquidity() public {
        vm.expectRevert("Insufficient liquidity");
        flashLoan.flashLoan(
            address(goodBorrower),
            address(token),
            2_000_000e18, // More than contract balance
            ""
        );
    }

    function test_revertFlashLoanNotRepaid() public {
        vm.expectRevert("Loan not repaid");
        flashLoan.flashLoan(
            address(badBorrower),
            address(token),
            100_000e18,
            ""
        );
    }

    function test_revertFlashLoanWrongCallback() public {
        vm.expectRevert("Callback failed");
        flashLoan.flashLoan(
            address(wrongBorrower),
            address(token),
            100_000e18,
            ""
        );
    }

    function test_multipleFlashLoans() public {
        flashLoan.flashLoan(address(goodBorrower), address(token), 50_000e18, "");
        flashLoan.flashLoan(address(goodBorrower), address(token), 30_000e18, "");

        assertEq(flashLoan.loanCount(), 2);
        assertEq(flashLoan.getTotalVolume(address(token)), 80_000e18);
    }

    // ============ Fee Calculation ============

    function test_flashFeeAtBaseRate() public view {
        // No utilization → base fee = 0.09%
        uint256 fee = flashLoan.flashFee(address(token), 100_000e18);
        assertEq(fee, (100_000e18 * 9) / 10000);
    }

    function test_flashFeeCallbackSuccess() public view {
        assertEq(
            flashLoan.CALLBACK_SUCCESS(),
            keccak256("ERC3156FlashBorrower.onFlashLoan")
        );
    }

    // ============ Views ============

    function test_maxFlashLoan() public view {
        assertEq(flashLoan.maxFlashLoan(address(token)), 1_000_000e18);
    }

    function test_getPoolCount() public view {
        assertEq(flashLoan.getPoolCount(), 0);
    }
}
