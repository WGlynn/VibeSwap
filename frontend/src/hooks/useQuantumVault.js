import { useState, useCallback, useEffect } from 'react'
import { useWallet } from './useWallet'
import {
  generateLamportKeySet,
  createQuantumProof,
  getNextKeyIndex,
  saveQuantumKeys,
  loadQuantumKeys,
  hasStoredQuantumKeys,
  getQuantumKeyMetadata,
  hashMessage,
} from '../utils/quantumCrypto'

/**
 * Hook for managing quantum-resistant keys
 *
 * Provides:
 * - Key generation and storage
 * - Signing messages with quantum signatures
 * - Key usage tracking
 * - Encrypted local storage
 */
export function useQuantumVault() {
  const { address, isConnected } = useWallet()

  const [keySet, setKeySet] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [metadata, setMetadata] = useState(null)

  // Check for existing keys on mount
  useEffect(() => {
    if (address) {
      const meta = getQuantumKeyMetadata(address)
      setMetadata(meta)
    } else {
      setMetadata(null)
      setKeySet(null)
    }
  }, [address])

  /**
   * Generate new quantum keys
   * @param {number} keyCount Number of keys to generate (power of 2)
   * @param {string} password Password to encrypt keys
   */
  const generateKeys = useCallback(async (keyCount = 256, password) => {
    if (!address) throw new Error('Wallet not connected')
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters')
    }

    setIsGenerating(true)
    setError(null)

    try {
      // Generate keys in a worker-friendly way (yield to UI)
      const newKeySet = await new Promise((resolve) => {
        setTimeout(() => {
          resolve(generateLamportKeySet(keyCount))
        }, 0)
      })

      // Save encrypted
      await saveQuantumKeys(newKeySet, password, address)

      setKeySet(newKeySet)
      setMetadata({
        merkleRoot: newKeySet.merkleRoot,
        totalKeys: newKeySet.totalKeys,
        usedCount: 0
      })

      return {
        merkleRoot: newKeySet.merkleRoot,
        totalKeys: newKeySet.totalKeys
      }
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setIsGenerating(false)
    }
  }, [address])

  /**
   * Unlock existing keys with password
   * @param {string} password Decryption password
   */
  const unlockKeys = useCallback(async (password) => {
    if (!address) throw new Error('Wallet not connected')
    if (!hasStoredQuantumKeys(address)) {
      throw new Error('No quantum keys found for this address')
    }

    setIsLoading(true)
    setError(null)

    try {
      const loadedKeySet = await loadQuantumKeys(password, address)
      setKeySet(loadedKeySet)
      return true
    } catch (err) {
      setError('Invalid password or corrupted keys')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [address])

  /**
   * Lock keys (clear from memory)
   */
  const lockKeys = useCallback(() => {
    setKeySet(null)
  }, [])

  /**
   * Sign a message with quantum signature
   * @param {string|Uint8Array} message Message to sign
   * @returns {Object} Quantum proof for contract submission
   */
  const signMessage = useCallback(async (message) => {
    if (!keySet) throw new Error('Keys not unlocked')

    const keyIndex = getNextKeyIndex(keySet)
    if (keyIndex === -1) {
      throw new Error('All quantum keys exhausted - generate new keys')
    }

    const messageHash = hashMessage(message)
    const proof = createQuantumProof(keySet, keyIndex, messageHash)

    // Update metadata
    setMetadata(prev => ({
      ...prev,
      usedCount: keySet.usedKeys.size
    }))

    return {
      messageHash,
      proof
    }
  }, [keySet])

  /**
   * Sign structured data (for contract calls)
   * @param {Object} data Structured data to sign
   * @returns {Object} Quantum proof
   */
  const signStructured = useCallback(async (domainSeparator, data) => {
    if (!keySet) throw new Error('Keys not unlocked')

    const keyIndex = getNextKeyIndex(keySet)
    if (keyIndex === -1) {
      throw new Error('All quantum keys exhausted')
    }

    // Create structured message hash
    const dataBytes = typeof data === 'string' ? data : JSON.stringify(data)
    const message = domainSeparator + dataBytes
    const messageHash = hashMessage(message)

    const proof = createQuantumProof(keySet, keyIndex, messageHash)

    setMetadata(prev => ({
      ...prev,
      usedCount: keySet.usedKeys.size
    }))

    return {
      messageHash,
      proof
    }
  }, [keySet])

  // Computed values
  const hasKeys = !!metadata
  const isUnlocked = !!keySet
  const remainingKeys = keySet ? keySet.totalKeys - keySet.usedKeys.size : (metadata?.totalKeys - metadata?.usedCount || 0)
  const keysLow = remainingKeys < 10 && remainingKeys > 0
  const keysExhausted = hasKeys && remainingKeys === 0

  return {
    // State
    hasKeys,
    isUnlocked,
    isLoading,
    isGenerating,
    error,
    metadata,

    // Computed
    remainingKeys,
    keysLow,
    keysExhausted,
    merkleRoot: metadata?.merkleRoot,
    totalKeys: metadata?.totalKeys,

    // Actions
    generateKeys,
    unlockKeys,
    lockKeys,
    signMessage,
    signStructured,
  }
}

export default useQuantumVault
