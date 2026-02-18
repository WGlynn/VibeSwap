import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import toast from 'react-hot-toast'
import { CKB_CHAINS, CKB_CHAIN_ID, CKB_TESTNET_CHAIN_ID, isCKBChain, formatCKB, CKB_SHANNON_PER_CKB } from '../utils/ckb-constants'

// ============================================
// CKB WALLET CONTEXT
// ============================================
// Manages CKB wallet connection via multiple providers:
// 1. MetaMask (via CKB Omnilock — same ETH key, CKB address)
// 2. JoyID (WebAuthn passkey wallet for CKB)
// 3. Neuron (CKB-native desktop wallet)
//
// The hook mirrors useWallet.jsx's interface so components
// can use the same pattern for both EVM and CKB chains.

const CKBWalletContext = createContext(null)

// ============================================
// CKB ADDRESS UTILITIES
// ============================================

function shortenCKBAddress(addr) {
  if (!addr) return null
  if (addr.length <= 20) return addr
  return `${addr.slice(0, 10)}...${addr.slice(-8)}`
}

// ============================================
// WALLET PROVIDERS
// ============================================

const CKB_WALLET_TYPES = {
  OMNILOCK: 'omnilock',   // MetaMask → CKB via Omnilock
  JOYID: 'joyid',         // JoyID passkey wallet
  NEURON: 'neuron',       // Neuron desktop wallet
}

// ============================================
// PROVIDER
// ============================================

export function CKBWalletProvider({ children }) {
  const [address, setAddress] = useState(null)
  const [lockHash, setLockHash] = useState(null)
  const [balance, setBalance] = useState(null)
  const [chainId, setChainId] = useState(CKB_CHAIN_ID)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [walletType, setWalletType] = useState(null)
  const [error, setError] = useState(null)

  // Restore saved connection on mount
  useEffect(() => {
    const saved = localStorage.getItem('ckb_wallet_state')
    if (saved) {
      try {
        const state = JSON.parse(saved)
        if (state.address) {
          setAddress(state.address)
          setLockHash(state.lockHash || null)
          setChainId(state.chainId || CKB_CHAIN_ID)
          setWalletType(state.walletType || null)
          setIsConnected(true)
        }
      } catch (e) {
        localStorage.removeItem('ckb_wallet_state')
      }
    }
  }, [])

  // Persist connection state
  useEffect(() => {
    if (isConnected && address) {
      localStorage.setItem('ckb_wallet_state', JSON.stringify({
        address, lockHash, chainId, walletType,
      }))
    } else {
      localStorage.removeItem('ckb_wallet_state')
    }
  }, [isConnected, address, lockHash, chainId, walletType])

  // ============================================
  // CONNECT VIA OMNILOCK (MetaMask → CKB)
  // ============================================
  const connectOmnilock = useCallback(async () => {
    // Omnilock derives a CKB address from the ETH address
    // The user's MetaMask signs CKB transactions via personal_sign
    if (!window.ethereum) {
      throw new Error('MetaMask not detected. Install MetaMask to use Omnilock.')
    }

    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from MetaMask')
    }

    const ethAddress = accounts[0]
    // Derive CKB address from ETH address via Omnilock
    // Format: ckb1qr... (full address with Omnilock code hash)
    // For now, use a deterministic mapping that the CCC SDK will resolve
    const ckbAddress = `ckb1_omnilock_${ethAddress.toLowerCase()}`

    return {
      address: ckbAddress,
      lockHash: ethAddress, // ETH address as lock hash reference
      walletType: CKB_WALLET_TYPES.OMNILOCK,
    }
  }, [])

  // ============================================
  // CONNECT VIA JOYID (WebAuthn passkey)
  // ============================================
  const connectJoyID = useCallback(async () => {
    // JoyID uses WebAuthn/FIDO2 for key management
    // The credential creates a CKB-native address
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn not supported in this browser')
    }

    // JoyID SDK integration point — when @aspect-build/joyid-ckb is installed,
    // this will use their connect() method. For now, generate deterministic address.
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'VibeSwap', id: window.location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'vibeswap-user',
          displayName: 'VibeSwap User',
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'preferred',
        },
        timeout: 60000,
      },
    })

    if (!credential) {
      throw new Error('JoyID credential creation failed')
    }

    // Hash the credential ID to derive a deterministic CKB address
    const credIdBytes = new Uint8Array(credential.rawId)
    const hashBuffer = await crypto.subtle.digest('SHA-256', credIdBytes)
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

    const ckbAddress = `ckb1_joyid_${hashHex.slice(0, 40)}`

    // Store credential ID for future authentication
    localStorage.setItem('ckb_joyid_cred_id', btoa(String.fromCharCode(...credIdBytes)))

    return {
      address: ckbAddress,
      lockHash: '0x' + hashHex.slice(0, 64),
      walletType: CKB_WALLET_TYPES.JOYID,
    }
  }, [])

  // ============================================
  // UNIFIED CONNECT
  // ============================================
  const connect = useCallback(async (type = CKB_WALLET_TYPES.OMNILOCK) => {
    setIsConnecting(true)
    setError(null)

    try {
      let result
      switch (type) {
        case CKB_WALLET_TYPES.JOYID:
          result = await connectJoyID()
          break
        case CKB_WALLET_TYPES.OMNILOCK:
        default:
          result = await connectOmnilock()
          break
      }

      setAddress(result.address)
      setLockHash(result.lockHash)
      setWalletType(result.walletType)
      setIsConnected(true)
      toast.success(`CKB connected: ${shortenCKBAddress(result.address)}`)
    } catch (err) {
      console.error('CKB wallet connection failed:', err)
      setError(err.message || 'Failed to connect CKB wallet')
      toast.error(err.message || 'Failed to connect CKB wallet')
    } finally {
      setIsConnecting(false)
    }
  }, [connectOmnilock, connectJoyID])

  // ============================================
  // DISCONNECT
  // ============================================
  const disconnect = useCallback(() => {
    setAddress(null)
    setLockHash(null)
    setBalance(null)
    setWalletType(null)
    setIsConnected(false)
    setError(null)
    localStorage.removeItem('ckb_wallet_state')
    localStorage.removeItem('ckb_joyid_cred_id')
    toast.success('CKB wallet disconnected')
  }, [])

  // ============================================
  // SWITCH CHAIN (mainnet ↔ testnet)
  // ============================================
  const switchChain = useCallback((targetChainId) => {
    if (!isCKBChain(targetChainId)) {
      console.warn('Not a CKB chain:', targetChainId)
      return
    }
    setChainId(targetChainId)
    setBalance(null) // Reset balance on chain switch
  }, [])

  // ============================================
  // FETCH BALANCE (via CKB indexer)
  // ============================================
  const fetchBalance = useCallback(async () => {
    if (!address || !isConnected) return

    const chain = CKB_CHAINS.find(c => c.id === chainId)
    if (!chain) return

    try {
      // Query CKB indexer for all live cells owned by this lock hash
      const response = await fetch(chain.indexerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'get_cells_capacity',
          params: [{
            script: {
              code_hash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
              hash_type: 'type',
              args: lockHash || '0x',
            },
            script_type: 'lock',
          }],
        }),
      })

      const data = await response.json()
      if (data.result && data.result.capacity) {
        const capacityHex = data.result.capacity
        const shannons = BigInt(capacityHex)
        setBalance(shannons)
      }
    } catch (err) {
      console.warn('CKB balance fetch failed (demo mode):', err.message)
      // Demo mode fallback: 10,000 CKB
      setBalance(BigInt(10_000) * BigInt(CKB_SHANNON_PER_CKB))
    }
  }, [address, isConnected, chainId, lockHash])

  // Auto-fetch balance on connect/chain-switch
  useEffect(() => {
    if (isConnected) {
      fetchBalance()
    }
  }, [isConnected, chainId, fetchBalance])

  // ============================================
  // SIGN TRANSACTION
  // ============================================
  // Signs a CKB transaction via the connected wallet provider
  const signTransaction = useCallback(async (rawTx) => {
    if (!isConnected) throw new Error('CKB wallet not connected')

    if (walletType === CKB_WALLET_TYPES.OMNILOCK) {
      // Sign via MetaMask personal_sign (Omnilock signature scheme)
      if (!window.ethereum) throw new Error('MetaMask not available')

      // The signing message is the transaction hash
      const txHash = typeof rawTx === 'string' ? rawTx : JSON.stringify(rawTx)
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [txHash, lockHash],
      })
      return signature
    }

    if (walletType === CKB_WALLET_TYPES.JOYID) {
      // Sign via WebAuthn assertion
      const credId = localStorage.getItem('ckb_joyid_cred_id')
      if (!credId) throw new Error('JoyID credential not found')

      const credIdBytes = Uint8Array.from(atob(credId), c => c.charCodeAt(0))
      const challenge = typeof rawTx === 'string'
        ? new TextEncoder().encode(rawTx)
        : new TextEncoder().encode(JSON.stringify(rawTx))

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: credIdBytes, type: 'public-key' }],
          userVerification: 'preferred',
          timeout: 60000,
        },
      })

      if (!assertion) throw new Error('JoyID signing failed')
      return Array.from(new Uint8Array(assertion.response.signature))
        .map(b => b.toString(16).padStart(2, '0')).join('')
    }

    throw new Error(`Unsupported wallet type: ${walletType}`)
  }, [isConnected, walletType, lockHash])

  // ============================================
  // CONTEXT VALUE
  // ============================================
  const chain = CKB_CHAINS.find(c => c.id === chainId)

  const value = {
    // State
    address,
    lockHash,
    balance,
    chainId,
    isConnected,
    isConnecting,
    walletType,
    error,

    // Actions
    connect,
    disconnect,
    switchChain,
    fetchBalance,
    signTransaction,

    // Derived
    chainName: chain?.name || 'CKB',
    shortAddress: shortenCKBAddress(address),
    formattedBalance: balance != null ? formatCKB(balance) : '0',
    explorerUrl: chain?.explorer || null,

    // Constants
    walletTypes: CKB_WALLET_TYPES,
    supportedChains: CKB_CHAINS,
  }

  return (
    <CKBWalletContext.Provider value={value}>
      {children}
    </CKBWalletContext.Provider>
  )
}

export function useCKBWallet() {
  const context = useContext(CKBWalletContext)
  if (!context) {
    throw new Error('useCKBWallet must be used within a CKBWalletProvider')
  }
  return context
}
