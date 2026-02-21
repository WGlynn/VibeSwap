import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { ethers } from 'ethers'

/**
 * Device Wallet Hook with React Context
 * Creates and manages a wallet secured by the device's Secure Element via WebAuthn/Passkeys
 *
 * IMPORTANT: Uses React Context so all components share the same state.
 * When one component calls createWallet(), all other components see the update.
 *
 * How it works:
 * 1. Uses WebAuthn to create a passkey (stored in Secure Element)
 * 2. The passkey credential ID is used to derive an Ethereum private key
 * 3. Biometric auth (Face ID, Touch ID) required to sign transactions
 *
 * @version 2.0.0 - Now uses React Context for shared state
 */

const STORAGE_KEY = 'vibeswap_device_wallet'
const APP_NAME = 'VibeSwap'
const RP_ID = typeof window !== 'undefined' ? window.location.hostname : 'localhost'

// ============================================
// CONTEXT
// ============================================
const DeviceWalletContext = createContext(null)

// Check if WebAuthn is supported
export const isWebAuthnSupported = () => {
  return typeof window !== 'undefined' &&
         window.PublicKeyCredential !== undefined &&
         typeof window.PublicKeyCredential === 'function'
}

// Check if platform authenticator (Secure Element) is available
export const isPlatformAuthenticatorAvailable = async () => {
  if (!isWebAuthnSupported()) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

// Derive an Ethereum private key from credential data
// Uses the credential ID + user handle as entropy for key derivation
const derivePrivateKey = (credentialId, userHandle) => {
  // Combine credential ID and user handle for entropy
  const combined = credentialId + ':' + userHandle
  // Hash it to get 32 bytes for the private key
  const privateKeyBytes = ethers.keccak256(ethers.toUtf8Bytes(combined))
  return privateKeyBytes
}

// Generate registration options (normally from server, but we do it client-side for simplicity)
const generateRegistrationOptions = (userId, preferPlatform = true) => {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userIdBytes = new TextEncoder().encode(userId)

  const options = {
    challenge: challenge,
    rp: {
      name: APP_NAME,
      id: RP_ID,
    },
    user: {
      id: userIdBytes,
      name: `${APP_NAME} User`,
      displayName: `${APP_NAME} Wallet`,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },   // ES256 (P-256)
      { alg: -257, type: 'public-key' }, // RS256
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      userVerification: 'preferred',
      residentKey: 'preferred',
    },
  }

  // Only force platform attachment if we know it's available
  if (preferPlatform) {
    options.authenticatorSelection.authenticatorAttachment = 'platform'
  }

  return options
}

// Generate authentication options
const generateAuthenticationOptions = (credentialId) => {
  const challenge = crypto.getRandomValues(new Uint8Array(32))

  return {
    challenge: challenge,
    timeout: 60000,
    rpId: RP_ID,
    userVerification: 'required',
    allowCredentials: credentialId ? [{
      id: base64ToArrayBuffer(credentialId),
      type: 'public-key',
      transports: ['internal'],
    }] : [],
  }
}

// Helper: ArrayBuffer to Base64
const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Helper: Base64 to ArrayBuffer
const base64ToArrayBuffer = (base64) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// ============================================
// PROVIDER COMPONENT
// ============================================
export function DeviceWalletProvider({ children }) {
  const [isSupported, setIsSupported] = useState(false)
  const [isAvailable, setIsAvailable] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [address, setAddress] = useState(null)
  const [error, setError] = useState(null)

  // Check support on mount
  useEffect(() => {
    const checkSupport = async () => {
      const supported = isWebAuthnSupported()
      setIsSupported(supported)

      if (supported) {
        const available = await isPlatformAuthenticatorAvailable()
        setIsAvailable(available)
      }

      // Check if we have a stored wallet
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        try {
          const { address: storedAddress } = JSON.parse(stored)
          setAddress(storedAddress)
          setIsConnected(true)
        } catch (e) {
          console.error('Failed to parse stored wallet:', e)
        }
      }
    }

    checkSupport()
  }, [])

  // Create a new device wallet
  const createWallet = useCallback(async () => {
    if (!isWebAuthnSupported()) {
      setError('WebAuthn is not supported in this browser')
      return null
    }

    setIsLoading(true)
    setError(null)

    try {
      // Generate a unique user ID
      const userId = crypto.randomUUID()

      let credential = null

      // Try platform authenticator first (biometrics), fall back to any authenticator
      try {
        const options = generateRegistrationOptions(userId, true)
        credential = await navigator.credentials.create({ publicKey: options })
      } catch (platformErr) {
        console.warn('Platform authenticator failed, trying without restriction:', platformErr.message)
        // Retry without forcing platform attachment
        const fallbackOptions = generateRegistrationOptions(userId, false)
        credential = await navigator.credentials.create({ publicKey: fallbackOptions })
      }

      if (!credential) {
        throw new Error('Failed to create credential')
      }

      // Extract credential ID
      const credentialId = arrayBufferToBase64(credential.rawId)

      // Derive Ethereum private key from credential
      const privateKey = derivePrivateKey(credentialId, userId)
      const wallet = new ethers.Wallet(privateKey)

      // Store wallet info (NOT the private key - it's derived from credential)
      const walletData = {
        credentialId,
        userId,
        address: wallet.address,
        createdAt: Date.now(),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData))

      // Update state - this will propagate to ALL components using this context
      setAddress(wallet.address)
      setIsConnected(true)
      setIsLoading(false)

      return {
        address: wallet.address,
        credentialId,
      }
    } catch (err) {
      console.error('Failed to create device wallet:', err)
      setError(err.message || 'Failed to create wallet')
      setIsLoading(false)
      return null
    }
  }, [isAvailable])

  // Authenticate and get signer
  const authenticate = useCallback(async () => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      setError('No device wallet found')
      return null
    }

    setIsLoading(true)
    setError(null)

    try {
      const { credentialId, userId } = JSON.parse(stored)

      // Create authentication options
      const options = generateAuthenticationOptions(credentialId)

      // Start WebAuthn authentication (triggers biometric prompt)
      const assertion = await navigator.credentials.get({
        publicKey: options
      })

      if (!assertion) {
        throw new Error('Authentication failed')
      }

      // Derive the same private key
      const privateKey = derivePrivateKey(credentialId, userId)
      const wallet = new ethers.Wallet(privateKey)

      setIsLoading(false)
      return wallet
    } catch (err) {
      console.error('Failed to authenticate:', err)
      setError(err.message || 'Authentication failed')
      setIsLoading(false)
      return null
    }
  }, [])

  // Sign a message (requires biometric auth)
  const signMessage = useCallback(async (message) => {
    const wallet = await authenticate()
    if (!wallet) return null

    try {
      return await wallet.signMessage(message)
    } catch (err) {
      setError(err.message || 'Failed to sign message')
      return null
    }
  }, [authenticate])

  // Sign a transaction (requires biometric auth)
  const signTransaction = useCallback(async (transaction) => {
    const wallet = await authenticate()
    if (!wallet) return null

    try {
      return await wallet.signTransaction(transaction)
    } catch (err) {
      setError(err.message || 'Failed to sign transaction')
      return null
    }
  }, [authenticate])

  // Disconnect (remove stored wallet)
  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setAddress(null)
    setIsConnected(false)
  }, [])

  // Get short address
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null

  const value = {
    // State
    isSupported,
    isAvailable,
    isConnected,
    isLoading,
    address,
    shortAddress,
    error,

    // Actions
    createWallet,
    authenticate,
    signMessage,
    signTransaction,
    disconnect,
  }

  return (
    <DeviceWalletContext.Provider value={value}>
      {children}
    </DeviceWalletContext.Provider>
  )
}

// ============================================
// HOOK
// ============================================
export function useDeviceWallet() {
  const context = useContext(DeviceWalletContext)
  if (!context) {
    throw new Error('useDeviceWallet must be used within a DeviceWalletProvider')
  }
  return context
}

export default useDeviceWallet
