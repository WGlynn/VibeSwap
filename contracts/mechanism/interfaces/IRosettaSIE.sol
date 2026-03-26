// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IRosettaSIE
 * @notice Minimal interface used by RosettaProtocol to register concept assets
 *         and record citations in IntelligenceExchange.
 *
 * @dev Two entry-points only:
 *      1. registerConceptAsset — called once when a term is first added to a
 *         Rosetta lexicon; anchors the concept as an on-chain knowledge asset
 *         without requiring an ETH stake (the lexicon registration IS the signal).
 *      2. recordCitation — called every time verifyTranslation() succeeds and
 *         one domain-concept translates through a UCI to another; records a
 *         citation so the cited term's bonding curve price rises.
 *
 * @author Faraday1, JARVIS | March 2026
 */
interface IRosettaSIE {
    /**
     * @notice Register a Rosetta concept as a knowledge asset in the SIE.
     * @param assetId     Deterministic ID: keccak256(owner, universalConcept, term)
     * @param contributor Address of the lexicon owner who registered the term
     */
    function registerConceptAsset(bytes32 assetId, address contributor) external;

    /**
     * @notice Record that a concept (citedAsset) was used in a translation,
     *         incrementing its citation count and updating its bonding price.
     * @param citingAsset  Asset ID of the concept being translated FROM (the source term)
     * @param citedAsset   Asset ID of the universal concept being cited/translated THROUGH
     */
    function recordCitation(bytes32 citingAsset, bytes32 citedAsset) external;
}
