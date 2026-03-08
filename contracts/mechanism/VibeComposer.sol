// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeComposer — DeFi Lego Execution Engine
 * @notice Executes multi-module compositions atomically.
 *         Users chain protocol actions into single transactions.
 *
 * @dev Think "Zap" but for any VSOS module combination:
 *      - Swap + LP deposit + Options hedge in one tx
 *      - Borrow + Swap + Yield farm in one tx
 *      - Any arbitrary composition of VSOS protocol calls
 *
 *   Compositions are defined as ordered action lists.
 *   Each action targets a module contract with encoded calldata.
 *   The composer executes atomically — all or nothing.
 */
contract VibeComposer is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct Action {
        address target;         // Module contract
        bytes callData;         // Encoded function call
        uint256 value;          // ETH to send
        bool optional;          // If true, failure doesn't revert the whole composition
    }

    struct Recipe {
        uint256 recipeId;
        address creator;
        string name;
        Action[] actions;
        uint256 executionCount;
        bool active;
    }

    // ============ State ============

    /// @notice Whitelist of modules that can be composed
    mapping(address => bool) public allowedModules;

    /// @notice Saved recipes (reusable compositions)
    mapping(uint256 => Recipe) public recipes;
    uint256 public recipeCount;

    /// @notice User's saved recipes
    mapping(address => uint256[]) public userRecipes;

    /// @notice Execution counter
    uint256 public totalExecutions;

    // ============ Events ============

    event ModuleAllowed(address indexed module, bool allowed);
    event CompositionExecuted(address indexed executor, uint256 actionCount, uint256 successCount);
    event RecipeSaved(uint256 indexed recipeId, address indexed creator, string name);
    event RecipeExecuted(uint256 indexed recipeId, address indexed executor);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Module Management ============

    function setModuleAllowed(address module, bool allowed) external onlyOwner {
        allowedModules[module] = allowed;
        emit ModuleAllowed(module, allowed);
    }

    function setModulesAllowed(address[] calldata modules_, bool[] calldata allowed_) external onlyOwner {
        require(modules_.length == allowed_.length, "Length mismatch");
        for (uint256 i = 0; i < modules_.length; i++) {
            allowedModules[modules_[i]] = allowed_[i];
            emit ModuleAllowed(modules_[i], allowed_[i]);
        }
    }

    // ============ Composition Execution ============

    /**
     * @notice Execute a composition of actions atomically
     * @param actions Ordered list of module calls
     */
    function compose(Action[] calldata actions) external payable nonReentrant returns (bytes[] memory results) {
        results = new bytes[](actions.length);
        uint256 successCount;

        for (uint256 i = 0; i < actions.length; i++) {
            require(allowedModules[actions[i].target], "Module not allowed");

            (bool success, bytes memory result) = actions[i].target.call{value: actions[i].value}(
                actions[i].callData
            );

            if (!success && !actions[i].optional) {
                // Bubble up the revert reason
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }

            if (success) {
                results[i] = result;
                successCount++;
            }
        }

        totalExecutions++;
        emit CompositionExecuted(msg.sender, actions.length, successCount);
    }

    /**
     * @notice Save a composition as a reusable recipe
     */
    function saveRecipe(
        string calldata name,
        Action[] calldata actions
    ) external returns (uint256) {
        recipeCount++;
        Recipe storage recipe = recipes[recipeCount];
        recipe.recipeId = recipeCount;
        recipe.creator = msg.sender;
        recipe.name = name;
        recipe.active = true;

        for (uint256 i = 0; i < actions.length; i++) {
            recipe.actions.push(actions[i]);
        }

        userRecipes[msg.sender].push(recipeCount);
        emit RecipeSaved(recipeCount, msg.sender, name);
        return recipeCount;
    }

    /**
     * @notice Execute a saved recipe
     */
    function executeRecipe(uint256 recipeId) external payable nonReentrant returns (bytes[] memory results) {
        Recipe storage recipe = recipes[recipeId];
        require(recipe.active, "Recipe not active");

        results = new bytes[](recipe.actions.length);
        uint256 successCount;

        for (uint256 i = 0; i < recipe.actions.length; i++) {
            Action storage action = recipe.actions[i];
            require(allowedModules[action.target], "Module not allowed");

            (bool success, bytes memory result) = action.target.call{value: action.value}(
                action.callData
            );

            if (!success && !action.optional) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }

            if (success) {
                results[i] = result;
                successCount++;
            }
        }

        recipe.executionCount++;
        totalExecutions++;
        emit RecipeExecuted(recipeId, msg.sender);
        emit CompositionExecuted(msg.sender, recipe.actions.length, successCount);
    }

    // ============ View Functions ============

    function getUserRecipes(address user) external view returns (uint256[] memory) {
        return userRecipes[user];
    }

    function getRecipeActions(uint256 recipeId) external view returns (uint256) {
        return recipes[recipeId].actions.length;
    }
}
