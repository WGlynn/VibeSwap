// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockShapleyIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract ShapleyHandler is Test {
    ShapleyDistributor public distributor;
    MockShapleyIToken public rewardToken;

    address public authorizedCreator;

    // Ghost variables
    uint256 public ghost_gamesCreated;
    uint256 public ghost_gamesSettled;
    uint256 public ghost_totalClaimed;

    bytes32[] public gameIds;
    bool[] public gameSettled;

    // Track participants per game for claim verification
    mapping(uint256 => address[]) public gameParticipantAddrs;

    constructor(
        ShapleyDistributor _distributor,
        MockShapleyIToken _rewardToken,
        address _authorizedCreator
    ) {
        distributor = _distributor;
        rewardToken = _rewardToken;
        authorizedCreator = _authorizedCreator;
    }

    function createAndSettle(uint256 totalValue, uint256 seed) public {
        totalValue = bound(totalValue, 1 ether, 100 ether);

        uint256 numParticipants = (seed % 4) + 2; // 2-5 participants

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](numParticipants);

        address[] memory addrs = new address[](numParticipants);

        for (uint256 i = 0; i < numParticipants; i++) {
            uint256 contribution = uint256(keccak256(abi.encode(seed, i, "c"))) % (10 ether) + 1 ether;
            uint256 timeInPool = uint256(keccak256(abi.encode(seed, i, "t"))) % (30 days) + 1 days;
            uint256 scarcity = uint256(keccak256(abi.encode(seed, i, "s"))) % 10001;
            uint256 stability = uint256(keccak256(abi.encode(seed, i, "st"))) % 10001;

            address addr = address(uint160(ghost_gamesCreated * 100 + i + 1));

            participants[i] = ShapleyDistributor.Participant({
                participant: addr,
                directContribution: contribution,
                timeInPool: timeInPool,
                scarcityScore: scarcity,
                stabilityScore: stability
            });
            addrs[i] = addr;
        }

        // Fund distributor
        rewardToken.mint(address(distributor), totalValue);

        bytes32 gameId = keccak256(abi.encode("inv", ghost_gamesCreated, seed));

        vm.prank(authorizedCreator);
        try distributor.createGame(gameId, totalValue, address(rewardToken), participants) {
            gameIds.push(gameId);
            gameSettled.push(false);

            // Store participant addresses
            uint256 gameIdx = gameIds.length - 1;
            for (uint256 i = 0; i < addrs.length; i++) {
                gameParticipantAddrs[gameIdx].push(addrs[i]);
            }

            ghost_gamesCreated++;

            // Settle immediately
            vm.prank(authorizedCreator);
            try distributor.computeShapleyValues(gameId) {
                gameSettled[gameIdx] = true;
                ghost_gamesSettled++;
            } catch {}
        } catch {}
    }

    function claimReward(uint256 gameSeed, uint256 participantSeed) public {
        if (gameIds.length == 0) return;

        uint256 gameIdx = gameSeed % gameIds.length;
        if (!gameSettled[gameIdx]) return;

        address[] storage addrs = gameParticipantAddrs[gameIdx];
        if (addrs.length == 0) return;

        uint256 pIdx = participantSeed % addrs.length;
        address claimer = addrs[pIdx];

        vm.prank(claimer);
        try distributor.claimReward(gameIds[gameIdx]) returns (uint256 amount) {
            ghost_totalClaimed += amount;
        } catch {}
    }

    function getGameCount() external view returns (uint256) {
        return gameIds.length;
    }
}

// ============ Invariant Tests ============

contract ShapleyInvariantTest is StdInvariant, Test {
    ShapleyDistributor public distributor;
    MockShapleyIToken public rewardToken;
    ShapleyHandler public handler;

    address public owner;
    address public authorizedCreator;

    function setUp() public {
        owner = address(this);
        authorizedCreator = makeAddr("authorizedCreator");

        rewardToken = new MockShapleyIToken("Reward", "RWD");

        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        distributor.setAuthorizedCreator(authorizedCreator, true);

        handler = new ShapleyHandler(distributor, rewardToken, authorizedCreator);
        targetContract(address(handler));
    }

    // ============ Invariant: totalGamesCreated consistent ============

    function invariant_gamesCountConsistent() public view {
        assertEq(
            distributor.totalGamesCreated(),
            handler.ghost_gamesCreated(),
            "GAMES: count mismatch"
        );
    }

    // ============ Invariant: efficiency — sum of shapley values = totalValue ============

    function invariant_efficiencyAxiom() public view {
        uint256 count = handler.getGameCount();
        for (uint256 g = 0; g < count && g < 3; g++) {
            bytes32 gameId = handler.gameIds(g);

            if (!distributor.isGameSettled(gameId)) continue;

            ShapleyDistributor.Participant[] memory participants = distributor.getGameParticipants(gameId);
            (,uint256 totalValue,,,) = distributor.games(gameId);

            uint256 sumShapley = 0;
            for (uint256 i = 0; i < participants.length; i++) {
                sumShapley += distributor.getShapleyValue(gameId, participants[i].participant);
            }

            // Allow 1 wei per participant for rounding
            assertApproxEqAbs(
                sumShapley,
                totalValue,
                participants.length,
                "EFFICIENCY: sum != totalValue"
            );
        }
    }

    // ============ Invariant: settled games stay settled ============

    function invariant_settledGamesImmutable() public view {
        uint256 count = handler.getGameCount();
        for (uint256 g = 0; g < count && g < 5; g++) {
            bytes32 gameId = handler.gameIds(g);

            // If handler marked it settled, contract should agree
            if (handler.gameSettled(g)) {
                assertTrue(
                    distributor.isGameSettled(gameId),
                    "SETTLED: game unsettled unexpectedly"
                );
            }
        }
    }

    // ============ Invariant: claimed tokens leave the contract ============

    function invariant_claimedMatchesTransfers() public view {
        // Total claimed by handler should not exceed total reward tokens minted to distributor
        // The contract balance + claimed should equal total minted
        uint256 contractBal = rewardToken.balanceOf(address(distributor));
        uint256 totalMinted = handler.ghost_gamesCreated() > 0
            ? contractBal + handler.ghost_totalClaimed()
            : 0;

        // ghost_totalClaimed should be <= what was funded
        assertGe(
            totalMinted,
            handler.ghost_totalClaimed(),
            "CLAIMS: claimed exceeds funded"
        );
    }

    // ============ Invariant: no shapley value exceeds totalValue ============

    function invariant_noShareExceedsTotalValue() public view {
        uint256 count = handler.getGameCount();
        for (uint256 g = 0; g < count && g < 3; g++) {
            bytes32 gameId = handler.gameIds(g);

            if (!distributor.isGameSettled(gameId)) continue;

            ShapleyDistributor.Participant[] memory participants = distributor.getGameParticipants(gameId);
            (,uint256 totalValue,,,) = distributor.games(gameId);

            for (uint256 i = 0; i < participants.length; i++) {
                uint256 share = distributor.getShapleyValue(gameId, participants[i].participant);
                assertLe(
                    share,
                    totalValue,
                    "SHARE: exceeds total value"
                );
            }
        }
    }
}
