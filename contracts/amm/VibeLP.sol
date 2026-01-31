// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VibeLP
 * @notice LP token for VibeSwap liquidity pools
 * @dev Minted by VibeAMM when liquidity is added
 */
contract VibeLP is ERC20, Ownable {
    /// @notice Token addresses in the pool
    address public immutable token0;
    address public immutable token1;

    /// @notice Minimum liquidity locked forever
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    /// @notice Whether minimum liquidity has been locked
    bool public minimumLiquidityLocked;

    /**
     * @notice Constructor
     * @param _token0 First token in pair
     * @param _token1 Second token in pair
     * @param _owner VibeAMM contract address
     */
    constructor(
        address _token0,
        address _token1,
        address _owner
    ) ERC20(
        string(abi.encodePacked("VibeSwap LP ", _tokenSymbol(_token0), "-", _tokenSymbol(_token1))),
        string(abi.encodePacked("VLP-", _tokenSymbol(_token0), "-", _tokenSymbol(_token1)))
    ) Ownable(_owner) {
        require(_token0 != address(0) && _token1 != address(0), "Invalid token");
        require(_token0 != _token1, "Identical tokens");

        token0 = _token0;
        token1 = _token1;
    }

    /**
     * @notice Mint LP tokens
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        // Lock minimum liquidity on first mint
        if (!minimumLiquidityLocked && totalSupply() == 0) {
            require(amount > MINIMUM_LIQUIDITY, "Insufficient initial liquidity");
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
            minimumLiquidityLocked = true;
            _mint(to, amount - MINIMUM_LIQUIDITY);
        } else {
            _mint(to, amount);
        }
    }

    /**
     * @notice Burn LP tokens
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    /**
     * @notice Get token symbol safely
     * @param token Token address
     * @return Symbol or truncated address
     */
    function _tokenSymbol(address token) internal view returns (string memory) {
        // Try to get symbol, fallback to address
        try IERC20Metadata(token).symbol() returns (string memory symbol) {
            return symbol;
        } catch {
            return _addressToString(token);
        }
    }

    /**
     * @notice Convert address to short string
     */
    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory result = new bytes(6);
        result[0] = "0";
        result[1] = "x";
        for (uint256 i = 0; i < 2; i++) {
            result[2 + i * 2] = alphabet[uint8(uint160(addr) >> (156 - i * 8)) >> 4];
            result[3 + i * 2] = alphabet[uint8(uint160(addr) >> (156 - i * 8)) & 0x0f];
        }
        return string(result);
    }
}

/**
 * @title IERC20Metadata
 * @notice Interface for ERC20 metadata
 */
interface IERC20Metadata {
    function symbol() external view returns (string memory);
}
