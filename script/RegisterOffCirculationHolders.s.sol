// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/monetary/CKBNativeToken.sol";

/**
 * @title Register Off-Circulation Holders (RSI C8 — post-upgrade admin)
 * @notice Registers staking/collateral contracts as off-circulation holders
 *         on CKBNativeToken. Must run after upgrading CKBNativeToken and
 *         SecondaryIssuanceController proxies with C7-GOV-001 changes.
 *
 * Reads contract addresses from env:
 *   CKB_NATIVE_ADDRESS
 *   NCI_ADDRESS
 *   VIBE_STABLE_ADDRESS
 *   JCV_ADDRESS
 *   DAO_SHELTER_ADDRESS (optional — has own totalDeposited() accounting)
 *
 * Usage:
 *   forge script script/RegisterOffCirculationHolders.s.sol \
 *     --rpc-url $RPC --broadcast --private-key $OWNER_KEY
 */
contract RegisterOffCirculationHolders is Script {
    function run() external {
        address ckbAddress = vm.envAddress("CKB_NATIVE_ADDRESS");
        CKBNativeToken ckb = CKBNativeToken(ckbAddress);

        address nci = vm.envOr("NCI_ADDRESS", address(0));
        address vibeStable = vm.envOr("VIBE_STABLE_ADDRESS", address(0));
        address jcv = vm.envOr("JCV_ADDRESS", address(0));
        address daoShelter = vm.envOr("DAO_SHELTER_ADDRESS", address(0));

        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        vm.startBroadcast(ownerKey);

        if (nci != address(0) && !ckb.isOffCirculationHolder(nci)) {
            console.log("Registering NCI as off-circulation holder:", nci);
            ckb.setOffCirculationHolder(nci, true);
        }

        if (vibeStable != address(0) && !ckb.isOffCirculationHolder(vibeStable)) {
            console.log("Registering VibeStable as off-circulation holder:", vibeStable);
            ckb.setOffCirculationHolder(vibeStable, true);
        }

        if (jcv != address(0) && !ckb.isOffCirculationHolder(jcv)) {
            console.log("Registering JarvisComputeVault as off-circulation holder:", jcv);
            ckb.setOffCirculationHolder(jcv, true);
        }

        // DAOShelter exposes totalDeposited() separately, but registering it
        // here as off-circulation would double-count. Skip unless explicitly
        // opted-in via env:
        if (daoShelter != address(0)) {
            bool registerDAO = vm.envOr("REGISTER_DAO_SHELTER", false);
            if (registerDAO && !ckb.isOffCirculationHolder(daoShelter)) {
                console.log("Registering DAOShelter as off-circulation holder:", daoShelter);
                ckb.setOffCirculationHolder(daoShelter, true);
            }
        }

        vm.stopBroadcast();

        // Verify final state
        console.log("\nFinal off-circulation holders:");
        uint256 count = ckb.offCirculationHolderCount();
        for (uint256 i = 0; i < count; i++) {
            address holder = ckb.offCirculationHolders(i);
            console.log(" -", holder, "balance:", ckb.balanceOf(holder));
        }
        console.log("\nTotal off-circulation:", ckb.offCirculation());
        console.log("Circulating supply:", ckb.circulatingSupply());
    }
}
