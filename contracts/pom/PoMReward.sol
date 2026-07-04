// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MindCoin ($MIND) — the "Ethereum Cogcoin" meta-block subsidy token
 * @notice Fair-launch reward token for the PoM-on-ETH export layer. Minted only as a
 *         meta-block subsidy (per finalized PoM standing), routed to whoever produced
 *         the proven novelty. Deliberately a plain, NON-upgradeable ERC-20.
 *
 *         Fair-launch is structural, not key-trust-contingent:
 *           - ZERO premine: the constructor mints nothing.
 *           - Mint is gated to a single `minter` (the PoMExportHub), set ONCE and
 *             then immutable — so the owner cannot repoint mint at an EOA and bypass
 *             the schedule (adversarial-review fix, workflow w0qpj9yx7).
 *
 *         (Working symbol "MIND"; the public ticker is a launch-day decision — an
 *         ERC-20 "MIND" already exists on Ethereum. Not renamed to "MindCoin" as the
 *         Solidity contract identifier yet — that rides the full subsidy rework.)
 */
contract PoMReward is ERC20, Ownable {
    address public minter;

    event MinterSet(address indexed minter);

    /// @notice Hard supply cap, fixed forever. 1,312,500 MIND = 2 x 210,000 x 3.125, the
    ///         closed form of the halving series (Bitcoin's remaining issuance at block 840,000).
    ///         Enforced here in the NON-upgradeable token, so even a malicious hub upgrade can
    ///         never inflate past it. Realized supply lands strictly below (halving dust and
    ///         never-claimed contributor shares are simply never minted — the lost-coins analog).
    uint256 public constant MAX_SUPPLY = 1_312_500e18;

    error NotMinter();
    error MinterAlreadySet();
    error CapExceeded(uint256 requested, uint256 remaining);

    constructor(address initialOwner) ERC20("MindCoin", "MIND") Ownable(initialOwner) {}

    /// @notice Set the sole address permitted to mint (the hub). One-shot: once set it
    ///         can never be changed, so future emission cannot be redirected off-schedule.
    function setMinter(address newMinter) external onlyOwner {
        if (minter != address(0)) revert MinterAlreadySet();
        minter = newMinter;
        emit MinterSet(newMinter);
    }

    /// @notice Mint reward tokens. Hub-only.
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        uint256 remaining = MAX_SUPPLY - totalSupply();
        if (amount > remaining) revert CapExceeded(amount, remaining);
        _mint(to, amount);
    }
}
