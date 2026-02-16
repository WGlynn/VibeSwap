// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/identity/ContributionDAG.sol";
import "../contracts/identity/RewardLedger.sol";
import "../contracts/identity/interfaces/IRewardLedger.sol";

/**
 * @title GenesisContributions
 * @notice Deploy-time script to record retroactive contributions and trust graph.
 *         Run ONCE after deploying ContributionDAG + RewardLedger, BEFORE finalizeRetroactive().
 *
 * Contributors:
 * - Faraday1 (Will)     — Protocol architect, mechanism design, code
 * - Jarvis (Claude)      — Code, mechanism design, testing, formal proofs
 * - FreedomWarrior13     — Idea Token primitive (separating idea value from execution value)
 *
 * ============ THREE-FACTOR VALIDATION PROTOCOL ============
 *
 * Retroactive claims require three independent signals, each carrying EQUAL weight (1):
 *
 *   1. VOUCH (ContributionDAG)    — Handshake from trusted founder(s)
 *   2. GOVERNANCE (Community)     — DAO vote approving the contribution
 *   3. DECENTRALIZED ID (Soulbound) — Verified SoulboundIdentity on-chain
 *
 * No single factor is standalone proof. Vouches are reliable but not sufficient alone.
 * This multi-factor approach provides redundancy until the system is robust enough
 * to weight factors independently based on network maturity.
 *
 * Finalization (finalizeRetroactive) only happens AFTER all three signals confirm.
 *
 * Philosophy:
 * Retroactive Shapley claims for founders (human or AI) via governance.
 * Credit flows through trust chains — the ContributionDAG determines weight.
 */
contract GenesisContributions is Script {

    // ============ Addresses (set before mainnet deploy) ============

    // Founders — addresses TBD at deploy time
    address constant FARADAY1 = address(0x1); // Will — placeholder
    address constant JARVIS = address(0x2);   // Claude/Jarvis — placeholder
    address constant FREEDOM_WARRIOR_13 = address(0x3); // placeholder

    function run() external {
        // These will be set via environment variables at deploy time
        address dagAddr = vm.envAddress("CONTRIBUTION_DAG");
        address ledgerAddr = vm.envAddress("REWARD_LEDGER");

        ContributionDAG dag = ContributionDAG(dagAddr);
        RewardLedger ledger = RewardLedger(ledgerAddr);

        vm.startBroadcast();

        // ============ Trust Graph: Founders ============
        dag.addFounder(FARADAY1);
        dag.addFounder(JARVIS);

        // ============ Trust Graph: Vouches ============
        // Vouches are recorded post-deploy by the actual accounts (handshake protocol).
        // Intended trust relationships:
        //   Faraday1 <-> FreedomWarrior13 (mutual — friends)
        //   Faraday1 <-> Jarvis (mutual — co-builders)
        //
        // IMPORTANT: A vouch is 1 of 3 validation factors.
        // It carries weight but is NOT standalone proof.
        // Claim finalization requires: vouch(1) + governance(1) + decentralized ID(1).

        // ============ Retroactive Contributions ============
        // These are RECORDED here but NOT CLAIMABLE until:
        //   1. Handshake vouches confirmed on ContributionDAG
        //   2. Governance vote approves contribution values
        //   3. SoulboundIdentity verified for each contributor
        // Only then does owner call finalizeRetroactive().

        // Faraday1 — Protocol architect
        ledger.recordRetroactiveContribution(
            FARADAY1,
            100_000e18, // value TBD by governance
            IRewardLedger.EventType.MECHANISM_DESIGN,
            bytes32("ipfs:faraday1-protocol-design")
        );
        ledger.recordRetroactiveContribution(
            FARADAY1,
            80_000e18,
            IRewardLedger.EventType.CODE,
            bytes32("ipfs:faraday1-code")
        );

        // Jarvis — Code, mechanism design, testing, formal proofs
        ledger.recordRetroactiveContribution(
            JARVIS,
            90_000e18,
            IRewardLedger.EventType.CODE,
            bytes32("ipfs:jarvis-code")
        );
        ledger.recordRetroactiveContribution(
            JARVIS,
            60_000e18,
            IRewardLedger.EventType.MECHANISM_DESIGN,
            bytes32("ipfs:jarvis-mechanism-design")
        );

        // FreedomWarrior13 — Idea Token primitive
        // Contributed the core insight: separate idea value (intrinsic, permanent,
        // instantly liquid) from execution value (time-bound, conviction-voted).
        // This unlocked proactive funding via liquid democracy.
        ledger.recordRetroactiveContribution(
            FREEDOM_WARRIOR_13,
            50_000e18,
            IRewardLedger.EventType.MECHANISM_DESIGN,
            bytes32("ipfs:fw13-idea-token-primitive")
        );

        // NOTE: Do NOT call ledger.finalizeRetroactive() here.
        // Finalization requires all 3 validation factors confirmed:
        //   [x] Vouch — handshakes on ContributionDAG
        //   [x] Governance — DAO vote approving values
        //   [x] Decentralized ID — SoulboundIdentity for each contributor
        // Each factor = 1 weight. No single factor is sufficient alone.

        vm.stopBroadcast();
    }
}
