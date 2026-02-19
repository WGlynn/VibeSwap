# Solidity Building Patterns

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

Confirmed patterns from building VibeLPNFT, VibeStream, VibeOptions, wBAR.

---

## ERC-721 Financial Instrument Skeleton

Every financial NFT follows this exact structure. Start here, add domain logic.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IFoo.sol";

contract Foo is ERC721, Ownable, ReentrancyGuard, IFoo {
    using SafeERC20 for IERC20;

    // ============ State ============

    IVibeAMM public immutable amm;              // immutable deps
    uint256 private _nextId = 1;                // starts at 1
    uint256 private _totalCount;                // never decremented on burn
    mapping(uint256 => Item) private _items;    // core data
    mapping(address => uint256[]) private _ownedItems;
    mapping(uint256 => uint256) private _ownedItemIndex;

    // ============ Constructor ============

    constructor(address _amm)
        ERC721("VibeSwap Foo", "VFOO")
        Ownable(msg.sender)
    {
        require(_amm != address(0), "Invalid AMM");
        amm = IVibeAMM(_amm);
    }

    // ============ Core: Create ============

    function create(Params calldata params) external nonReentrant returns (uint256 id) {
        // 1. Validate params
        // 2. Pull tokens: IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        // 3. Mint NFT:
        id = _nextId++;
        _safeMint(recipient, id);
        // 4. Store struct: _items[id] = Item({...});
        // 5. Track: _totalCount++;
        // 6. Emit event
    }

    // ============ Core: Settle/Exercise ============
    // Domain-specific — update state before transfer (CEI)

    // ============ Core: Burn ============

    function burn(uint256 id) external {
        address tokenOwner = _requireOwned(id);
        _checkAuthorized(tokenOwner, msg.sender, id);
        // Check settled/empty
        delete _items[id];
        _burn(id);
    }

    // ============ ERC721 Override ============

    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = super._update(to, tokenId, auth);
        if (from != address(0)) _removeFromOwned(from, tokenId);
        if (to != address(0)) {
            _ownedItemIndex[tokenId] = _ownedItems[to].length;
            _ownedItems[to].push(tokenId);
        }
        return from;
    }

    function _removeFromOwned(address owner, uint256 id) internal {
        uint256 idx = _ownedItemIndex[id];
        uint256 lastIdx = _ownedItems[owner].length - 1;
        if (idx != lastIdx) {
            uint256 lastId = _ownedItems[owner][lastIdx];
            _ownedItems[owner][idx] = lastId;
            _ownedItemIndex[lastId] = idx;
        }
        _ownedItems[owner].pop();
        delete _ownedItemIndex[id];
    }
}
```

### Key rules:
- `_nextId` starts at 1 (0 = nonexistent check)
- `_totalCount` never decrements (lifetime counter)
- `_update()` override handles mint/transfer/burn ownership tracking
- Swap-and-pop is O(1) removal — identical every time, never change it
- Always `nonReentrant` on functions that transfer tokens
- Always CEI: update state BEFORE external calls

---

## State Machine Pattern

Financial instruments follow enum-based state transitions.

```solidity
enum State { CREATED, ACTIVE, SETTLED, CLAIMED, CANCELED }
```

**Transition rules:**
```
CREATED → ACTIVE    (purchase/activate)
CREATED → CANCELED  (cancel by creator, only if not yet active)
ACTIVE  → SETTLED   (exercise/complete)
ACTIVE  → expired   (time passes, no explicit state change needed)
SETTLED → CLAIMED   (reclaim remainder)
```

**Implementation pattern:**
```solidity
// Each function checks its required state FIRST
if (item.state == State.SETTLED) revert AlreadySettled();
if (item.state != State.ACTIVE) revert NotActive();
// ... do work ...
item.state = State.SETTLED;  // transition BEFORE external calls
```

**Error naming convention:**
- `NotFoo` = caller/item isn't in the right state to do this
- `AlreadyFoo` = this transition already happened
- `FooExpired` / `FooNotExpired` = time-based conditions
- Don't overthink error names. Tests use `vm.expectRevert()` without selectors most of the time.

---

## Collateral Management

Two patterns, pick based on complexity:

### Direct settlement (simpler — VibeOptions style)
```solidity
// On create: pull collateral
IERC20(token).safeTransferFrom(writer, address(this), collateral);
item.collateral = collateral;

// On exercise: reduce collateral, send payoff
item.collateral -= payoff;
IERC20(token).safeTransfer(holder, payoff);

// On reclaim: send remainder
uint256 remainder = item.collateral;
item.collateral = 0;
IERC20(token).safeTransfer(writer, remainder);
```

### Two-step withdrawal (VibeLPNFT style)
```solidity
// On decrease: store owed amounts (no transfer)
_tokensOwed[id][token0] += amount0;
_tokensOwed[id][token1] += amount1;

// On collect: send and clear
uint256 owed = _tokensOwed[id][token];
_tokensOwed[id][token] = 0;
IERC20(token).safeTransfer(recipient, owed);
```

Use two-step when multiple tokens are involved or partial withdrawals are common. Use direct when there's one collateral token and settlement is atomic.

---

## Storage Slot Packing

```
address  = 20 bytes
uint40   = 5 bytes (timestamps up to year 36,812)
uint8    = 1 byte
bool     = 1 byte
enum     = 1 byte (up to 256 values)

Common slot combos (32 bytes each):
  address(20) + uint40(5) + uint40(5) + enum(1) + enum(1) = 32 ✓
  address(20) + uint40(5) + bool(1) + bool(1)             = 27 (5 wasted)
  uint128(16) + uint128(16)                                = 32 ✓
  bytes32                                                  = 32 ✓
  uint256                                                  = 32 ✓
```

Always comment slot boundaries in struct definitions:
```solidity
struct Item {
    // Slot 1 (32/32 bytes)
    address writer;          // 20 bytes
    uint40  expiry;          // 5 bytes
    uint40  exerciseEnd;     // 5 bytes
    OptionType optionType;   // 1 byte
    OptionState state;       // 1 byte

    // Slot 2 (32/32 bytes)
    bytes32 poolId;
    // ...
}
```

---

## TWAP Fallback Pattern

Used in VibeLPNFT (entry price) and VibeOptions (settlement price):
```solidity
uint256 price = amm.getTWAP(poolId, 600); // 10-min TWAP
if (price == 0) price = amm.getSpotPrice(poolId);
```

---

## Internal NFT Transfer (no approval needed)

For purchase/activate flows where the contract transfers an NFT from creator to buyer:
```solidity
// _transfer is internal — skips ERC721 approval checks
_transfer(currentOwner, newOwner, tokenId);
```

This works because `_transfer` calls `_update(to, tokenId, address(0))` with auth=address(0), bypassing authorization.

---

## Interface-First Design

Always create the interface before the contract:
1. `interfaces/IFoo.sol` — enums, structs, events, errors, function sigs
2. `Foo.sol` — `contract Foo is ERC721, Ownable, ReentrancyGuard, IFoo`
3. `test/Foo.t.sol` — imports both

Benefits:
- Forces API design before implementation
- Structs/enums accessible via `IFoo.StructName` in tests
- Other contracts can depend on interface without importing implementation
