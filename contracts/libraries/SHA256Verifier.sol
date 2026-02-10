// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SHA256Verifier
 * @notice Helper library for SHA-256 hash computation using EVM precompile
 * @dev Uses the SHA-256 precompile at address 0x02 for gas-efficient hashing
 */
library SHA256Verifier {
    /// @notice Compute SHA-256 hash using the EVM precompile
    /// @param data The data to hash
    /// @return result The SHA-256 hash of the input data
    function sha256Hash(bytes memory data) internal view returns (bytes32 result) {
        assembly {
            // Call the SHA-256 precompile at address 0x02
            let success := staticcall(
                gas(),              // Forward all available gas
                0x02,               // SHA-256 precompile address
                add(data, 32),      // Input data starts after length prefix
                mload(data),        // Input length
                result,             // Output location (direct to result variable)
                32                  // Output length (32 bytes)
            )
            // Revert if the call failed
            if iszero(success) {
                revert(0, 0)
            }
        }
    }

    /// @notice Compute SHA-256 hash of two bytes32 values packed together
    /// @param a First bytes32 value
    /// @param b Second bytes32 value
    /// @return result The SHA-256 hash of the concatenated values
    function sha256Packed(bytes32 a, bytes32 b) internal view returns (bytes32 result) {
        bytes memory data = abi.encodePacked(a, b);
        return sha256Hash(data);
    }

    /// @notice Compute SHA-256 hash of a challenge and nonce (common PoW pattern)
    /// @param challenge The challenge value
    /// @param nonce The nonce value to test
    /// @return result The SHA-256 hash of challenge || nonce
    function sha256ChallengeNonce(bytes32 challenge, bytes32 nonce) internal view returns (bytes32 result) {
        return sha256Packed(challenge, nonce);
    }
}
