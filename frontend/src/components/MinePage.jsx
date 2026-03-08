import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import toast from 'react-hot-toast'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'
import AnimatedNumber from './ui/AnimatedNumber'
import { StaggerContainer, StaggerItem } from './ui/StaggerContainer'

const EPOCH_LENGTH = 100 // proofs per difficulty adjustment (matches server)

// ============ JARVIS Mining API ============

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://jarvis-vibeswap.fly.dev'

async function fetchMiningTarget() {
  const res = await fetch(`${API_URL}/web/mining/target`)
  if (!res.ok) throw new Error('Failed to fetch mining target')
  return res.json()
}

async function submitMiningProof(walletAddress, nonce, hash, challenge) {
  const res = await fetch(`${API_URL}/web/mining/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, nonce, hash, challenge }),
  })
  return res.json()
}

async function fetchMiningStats(walletAddress) {
  const res = await fetch(`${API_URL}/web/mining/stats/wallet:${walletAddress.toLowerCase()}`)
  if (!res.ok) return null
  return res.json()
}

// ============ SHA-256 Mining Worker (inline) ============
// Worker uses server challenge + leading-zero-bit difficulty (not hex prefix)

const WORKER_CODE = `
  let mining = false
  let hashCount = 0
  let startTime = 0
  let reporterInterval = null
  let currentGeneration = 0

  // Convert hex string to Uint8Array (matches Node Buffer.from(hex, 'hex'))
  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    return bytes
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // SHA-256 of raw bytes — matches server: createHash('sha256').update(Buffer).digest()
  async function sha256(challengeHex, nonceHex) {
    const challengeBytes = hexToBytes(challengeHex)
    const nonceBytes = hexToBytes(nonceHex)
    const combined = new Uint8Array(challengeBytes.length + nonceBytes.length)
    combined.set(challengeBytes)
    combined.set(nonceBytes, challengeBytes.length)
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
    return new Uint8Array(hashBuffer)
  }

  // Count leading zero bits (matches server-side countLeadingZeroBits)
  function countLeadingZeroBits(hashBytes) {
    for (let i = 0; i < hashBytes.length; i++) {
      const byte = hashBytes[i]
      if (byte === 0) continue
      return i * 8 + (Math.clz32(byte) - 24)
    }
    return 255
  }

  async function mineBlock(challengeHex, difficulty, batchSize, generation) {
    for (let i = 0; i < batchSize; i++) {
      if (!mining || currentGeneration !== generation) return null

      const nonce = crypto.getRandomValues(new Uint8Array(32))
      const nonceHex = bytesToHex(nonce)

      // Hash: SHA-256(challenge_bytes || nonce_bytes) — raw byte concat
      const hashBytes = await sha256(challengeHex, nonceHex)
      hashCount++

      if (countLeadingZeroBits(hashBytes) >= difficulty) {
        return { nonce: nonceHex, hash: bytesToHex(hashBytes), challenge: challengeHex }
      }
    }
    return undefined
  }

  self.onmessage = async (e) => {
    const { type, challenge, difficulty } = e.data

    if (type === 'start') {
      // Stop any previous mining loop via generation counter
      mining = false
      if (reporterInterval) { clearInterval(reporterInterval); reporterInterval = null }
      // Small yield to let previous loop exit
      await new Promise(r => setTimeout(r, 10))

      mining = true
      hashCount = 0
      startTime = Date.now()
      const gen = ++currentGeneration

      reporterInterval = setInterval(() => {
        if (!mining || currentGeneration !== gen) { clearInterval(reporterInterval); reporterInterval = null; return }
        const elapsed = (Date.now() - startTime) / 1000
        const hashrate = elapsed > 0 ? hashCount / elapsed : 0
        self.postMessage({ type: 'hashrate', hashrate, totalHashes: hashCount })
      }, 1000)

      while (mining && currentGeneration === gen) {
        const result = await mineBlock(challenge, difficulty, 100, gen)
        if (result === null) break
        if (result) {
          mining = false
          if (reporterInterval) { clearInterval(reporterInterval); reporterInterval = null }
          self.postMessage({ type: 'found', ...result, totalHashes: hashCount })
          return
        }
      }

      if (reporterInterval) { clearInterval(reporterInterval); reporterInterval = null }
      self.postMessage({ type: 'stopped' })
    }

    if (type === 'stop') {
      mining = false
      currentGeneration++
    }
  }
`

function MinePage() {
  const { isConnected: isExternalConnected, connect, address: externalAddress } = useWallet()
  const { isConnected: isDeviceConnected, address: deviceAddress } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const address = externalAddress || deviceAddress

  // Mining state
  const [isMining, setIsMining] = useState(false)
  const [hashrate, setHashrate] = useState(0)
  const [totalHashes, setTotalHashes] = useState(0)
  const [blocksFound, setBlocksFound] = useState(0)
  const [totalReward, setTotalReward] = useState(0)
  const [miningLog, setMiningLog] = useState([])
  const [workerCount, setWorkerCount] = useState(
    Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8))
  )

  // Network state (from JARVIS backend)
  const [difficulty, setDifficulty] = useState(12)
  const [currentReward, setCurrentReward] = useState(1.0)
  const [epochNumber, setEpochNumber] = useState(0)
  const [totalBlocksMined, setTotalBlocksMined] = useState(0)
  const [challenge, setChallenge] = useState('')
  const [serverBalance, setServerBalance] = useState(0)
  const [serverProofs, setServerProofs] = useState(0)
  const [activeMinerCount, setActiveMinerCount] = useState(0)

  const workersRef = useRef([])
  const miningStartRef = useRef(null)
  const challengeRef = useRef('')

  // Fetch mining target from backend on mount + every 60s
  const refreshTarget = useCallback(async () => {
    try {
      const target = await fetchMiningTarget()
      setChallenge(target.challenge)
      challengeRef.current = target.challenge
      setDifficulty(target.difficulty)
      setCurrentReward(target.reward)
      setEpochNumber(target.epoch)
      setTotalBlocksMined(target.totalProofs)
      setActiveMinerCount(target.activeMinerCount)
    } catch (err) {
      console.warn('[mine] Failed to fetch target:', err.message)
    }
  }, [])

  // Fetch user's server-side balance
  const refreshStats = useCallback(async () => {
    if (!address) return
    try {
      const stats = await fetchMiningStats(address)
      if (stats) {
        setServerBalance(stats.julBalance)
        setServerProofs(stats.proofsSubmitted)
      }
    } catch {}
  }, [address])

  // Refresh target on mount + every 4 min (challenge rotates every 5 min on server)
  // Also restarts active workers with fresh challenge to prevent stale submissions
  useEffect(() => {
    refreshTarget()
    const interval = setInterval(async () => {
      const oldChallenge = challengeRef.current
      await refreshTarget()
      // If challenge changed and we're mining, restart workers with new challenge
      if (isMining && challengeRef.current && challengeRef.current !== oldChallenge) {
        workersRef.current.forEach(w => {
          w.postMessage({ type: 'start', challenge: challengeRef.current, difficulty })
        })
      }
    }, 4 * 60_000)
    return () => clearInterval(interval)
  }, [refreshTarget, isMining, difficulty])

  useEffect(() => {
    refreshStats()
  }, [refreshStats])

  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    setMiningLog(prev => [{timestamp, message, type}, ...prev.slice(0, 49)])
  }, [])

  const startMining = useCallback(async () => {
    if (!isConnected) {
      connect()
      return
    }

    // Fetch fresh challenge before starting
    await refreshTarget()

    if (!challengeRef.current) {
      addLog('Failed to get mining target from network', 'error')
      return
    }

    setIsMining(true)
    setHashrate(0)
    setTotalHashes(0)
    miningStartRef.current = Date.now()
    addLog(`Starting ${workerCount} mining threads...`, 'system')
    addLog(`Challenge: ${challengeRef.current.slice(0, 18)}...`, 'system')
    addLog(`Difficulty: ${difficulty} bits`, 'system')

    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' })
    const workerUrl = URL.createObjectURL(blob)
    const workers = []

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerUrl)

      worker.onmessage = async (e) => {
        const { type, hashrate: hr, nonce, hash, challenge: proofChallenge } = e.data

        if (type === 'hashrate') {
          setHashrate(hr * workerCount)
          setTotalHashes(prev => prev + 100)
        }

        if (type === 'found') {
          addLog(`PROOF FOUND! Submitting to network...`, 'success')
          addLog(`Nonce: ${nonce.slice(0, 18)}...`, 'success')
          addLog(`Hash: ${hash.slice(0, 18)}...`, 'success')

          // Submit proof to JARVIS backend — use the challenge the proof was mined against
          try {
            const submitChallenge = proofChallenge || challengeRef.current
            if (!submitChallenge) {
              addLog('No challenge available — refreshing...', 'error')
              await refreshTarget()
              worker.postMessage({ type: 'start', challenge: challengeRef.current, difficulty })
              return
            }
            const result = await submitMiningProof(address, nonce, hash, submitChallenge)
            if (result.accepted) {
              setBlocksFound(prev => prev + 1)
              setTotalReward(result.julBalance || 0)
              setServerBalance(result.julBalance || 0)
              setServerProofs(result.proofsSubmitted || 0)
              setTotalBlocksMined(prev => prev + 1)
              addLog(`ACCEPTED! +${result.reward?.toFixed(6) || '?'} JUL (total: ${result.julBalance?.toFixed(4) || '?'})`, 'success')
              toast.success(`Block accepted! +${result.reward?.toFixed(4) || '?'} JUL`)
            } else {
              const reason = result.reason || result.error || 'unknown'
              addLog(`Rejected: ${reason}`, 'error')
              if (reason === 'stale_challenge' || reason.includes('challenge')) {
                addLog('Challenge expired — refreshing and restarting...', 'system')
                await refreshTarget()
                // Don't break — the worker restart below will use the fresh challenge
              } else if (reason === 'rate_limited') {
                addLog(`Rate limited — waiting ${result.retryAfter || 60}s`, 'warning')
              }
            }
          } catch (err) {
            addLog(`Submit error: ${err.message}`, 'error')
          }

          // Refresh challenge and restart worker
          await refreshTarget()
          worker.postMessage({ type: 'start', challenge: challengeRef.current, difficulty })
        }
      }

      worker.postMessage({ type: 'start', challenge: challengeRef.current, difficulty })
      workers.push(worker)
    }

    workersRef.current = workers
    // Don't revoke blob URL until workers are stopped — some mobile browsers
    // (OnePlus/Android) fail if the source URL is revoked during worker init
    workersRef.current._blobUrl = workerUrl
  }, [isConnected, connect, workerCount, difficulty, address, addLog, refreshTarget])

  const stopMining = useCallback(() => {
    if (workersRef.current._blobUrl) {
      URL.revokeObjectURL(workersRef.current._blobUrl)
    }
    workersRef.current.forEach(w => {
      w.postMessage({ type: 'stop' })
      w.terminate()
    })
    workersRef.current = []
    setIsMining(false)
    setHashrate(0)
    addLog('Mining stopped', 'system')
  }, [addLog])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workersRef.current.forEach(w => {
        w.postMessage({ type: 'stop' })
        w.terminate()
      })
    }
  }, [])

  // Format hashrate for display
  const formatHashrate = (h) => {
    if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`
    if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`
    if (h >= 1e3) return `${(h / 1e3).toFixed(2)} KH/s`
    return `${Math.round(h)} H/s`
  }

  const uptime = isMining && miningStartRef.current
    ? Math.floor((Date.now() - miningStartRef.current) / 1000)
    : 0

  const formatUptime = (s) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m ${sec}s`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

  // Force re-render every second for uptime counter
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isMining) return
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isMining])

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard className="max-w-md mx-auto p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-500/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
            </svg>
          </div>
          <h2 className="text-2xl font-display font-bold mb-3">Mine Joule (JUL)</h2>
          <p className="text-void-400 mb-6 max-w-md mx-auto">
            Mine JUL tokens using SHA-256 proof-of-work directly in your browser.
            Rewards are proportional to difficulty — the harder the work, the greater the reward.
          </p>
          <InteractiveButton variant="primary" onClick={connect} className="px-6 py-3">
            Sign In to Mine
          </InteractiveButton>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pb-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold">Mine JUL</h1>
        <p className="text-void-400 mt-1">SHA-256 proof-of-work mining — earn Joule tokens</p>
      </div>

      <StaggerContainer>
        {/* Mining Controls */}
        <StaggerItem>
          <GlassCard className="p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${isMining ? 'bg-green-400 animate-pulse' : 'bg-void-500'}`} />
                <span className="text-lg font-semibold">
                  {isMining ? 'Mining Active' : 'Miner Idle'}
                </span>
              </div>
              <InteractiveButton
                variant={isMining ? 'danger' : 'primary'}
                onClick={isMining ? stopMining : startMining}
                className="px-6 py-2.5"
              >
                {isMining ? 'Stop Mining' : 'Start Mining'}
              </InteractiveButton>
            </div>

            {/* Thread Count Selector */}
            <div className="flex items-center gap-4 mb-4">
              <span className="text-void-400 text-sm">Threads:</span>
              <div className="flex gap-1">
                {[1, 2, 4, 6, 8].filter(n => n <= (navigator.hardwareConcurrency || 4) * 2).map(n => (
                  <button
                    key={n}
                    onClick={() => !isMining && setWorkerCount(n)}
                    disabled={isMining}
                    className={`px-3 py-1 rounded text-sm font-mono transition-colors ${
                      workerCount === n
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                        : 'bg-void-800/50 text-void-400 border border-void-700/50 hover:text-void-200'
                    } ${isMining ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-void-500 text-xs">
                ({navigator.hardwareConcurrency || '?'} CPU cores detected)
              </span>
            </div>

            {/* Hashrate Bar */}
            {isMining && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-4"
              >
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-void-400">Hashrate</span>
                  <span className="text-amber-300 font-mono">{formatHashrate(hashrate)}</span>
                </div>
                <div className="w-full h-2 bg-void-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                    animate={{ width: `${Math.min((hashrate / 10000) * 100, 100)}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </motion.div>
            )}
          </GlassCard>
        </StaggerItem>

        {/* Stats Grid */}
        <StaggerItem>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <GlassCard className="p-4 text-center">
              <div className="text-void-400 text-xs mb-1">Uptime</div>
              <div className="text-lg font-mono font-bold">{formatUptime(uptime)}</div>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <div className="text-void-400 text-xs mb-1">Blocks Found</div>
              <div className="text-lg font-mono font-bold text-green-400">
                <AnimatedNumber value={blocksFound} />
              </div>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <div className="text-void-400 text-xs mb-1">JUL Balance</div>
              <div className="text-lg font-mono font-bold text-amber-400">
                <AnimatedNumber value={serverBalance || totalReward} decimals={4} />
              </div>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <div className="text-void-400 text-xs mb-1">Total Hashes</div>
              <div className="text-lg font-mono font-bold">
                {totalHashes >= 1e6 ? `${(totalHashes / 1e6).toFixed(1)}M` :
                 totalHashes >= 1e3 ? `${(totalHashes / 1e3).toFixed(1)}K` :
                 totalHashes}
              </div>
            </GlassCard>
          </div>
        </StaggerItem>

        {/* Network Info */}
        <StaggerItem>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-void-300 mb-3">Network Stats</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Difficulty</span>
                  <span className="font-mono text-sm">{difficulty} bits</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Block Reward</span>
                  <span className="font-mono text-sm text-amber-400">{currentReward.toFixed(6)} JUL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Epoch</span>
                  <span className="font-mono text-sm">{epochNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Network Proofs</span>
                  <span className="font-mono text-sm">{totalBlocksMined.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Active Miners</span>
                  <span className="font-mono text-sm">{activeMinerCount}</span>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-void-300 mb-3">Mining Info</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Algorithm</span>
                  <span className="font-mono text-sm">SHA-256</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Reward Model</span>
                  <span className="font-mono text-sm">Proportional to Difficulty</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Supply</span>
                  <span className="font-mono text-sm text-void-300">No cap (elastic rebase)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Rebase</span>
                  <span className="font-mono text-sm">AMPL-style elastic</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Stability</span>
                  <span className="font-mono text-sm">PI Controller + PoW + Rebase</span>
                </div>
              </div>
            </GlassCard>
          </div>
        </StaggerItem>

        {/* Quantum Resistance */}
        <StaggerItem>
          <GlassCard className="p-5 mb-4 border border-emerald-500/10">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <h3 className="text-sm font-semibold text-emerald-400">Quantum Resistance</h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-void-400 text-sm">Preimage Security</span>
                <span className="font-mono text-sm text-emerald-400">256-bit (classical) / 128-bit (quantum)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-void-400 text-sm">Grover's Speedup</span>
                <span className="font-mono text-sm">2x bit reduction (sqrt of search space)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-void-400 text-sm">Qubits to Break</span>
                <span className="font-mono text-sm text-amber-400">~{(2593 + difficulty * 20).toLocaleString()} error-corrected</span>
              </div>
              <div className="flex justify-between">
                <span className="text-void-400 text-sm">Best Quantum Computer (2026)</span>
                <span className="font-mono text-sm text-red-400">~1,180 noisy qubits (IBM Condor)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-void-400 text-sm">Raspberry Pi Qubits</span>
                <span className="font-mono text-sm text-red-400">0 (classical silicon, no coherence)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-void-400 text-sm">NIST Status</span>
                <span className="font-mono text-sm text-emerald-400">SHA-256 approved post-quantum (Category 1)</span>
              </div>
            </div>
            <div className="mt-3 p-3 bg-void-900/60 rounded-lg">
              <p className="text-void-500 text-xs leading-relaxed">
                SHA-256 mining is quantum-resistant by design. Grover's algorithm provides only a quadratic speedup
                (2<sup>128</sup> operations vs 2<sup>256</sup>), requiring millions of error-corrected qubits that
                don't exist and won't for decades. A Raspberry Pi is classical silicon — it has exactly zero quantum
                bits, zero superposition, and zero entanglement. Calling it a "quantum computer" is like calling a
                bicycle a spaceship because both have wheels. Even if quantum mining existed, our difficulty
                auto-adjusts every {EPOCH_LENGTH} proofs — the network adapts to any computational advantage.
              </p>
            </div>

            {/* Alternative Arithmetic Validator */}
            <div className="mt-3 p-3 bg-void-900/60 rounded-lg border border-red-500/10">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono font-bold text-red-400">ALTERNATIVE ARITHMETIC VALIDATOR</span>
              </div>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-void-600">test:</span>
                  <span className="text-void-400">if 1 x 1 = 2, then SHA-256 search space =</span>
                  <span className="text-red-400">2<sup>512</sup></span>
                  <span className="text-void-600">— harder, not easier</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-void-600">test:</span>
                  <span className="text-void-400">if 1 x 1 = 2, then {difficulty}-bit difficulty =</span>
                  <span className="text-red-400">{(difficulty * 2).toLocaleString()}-bit equivalent</span>
                  <span className="text-void-600">— double the work</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-void-600">test:</span>
                  <span className="text-void-400">if 1 x 1 = 2, then hash output bits =</span>
                  <span className="text-red-400">512</span>
                  <span className="text-void-600">— more entropy, more impossible</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-void-600">test:</span>
                  <span className="text-void-400">if 1 x 1 = 2, then brute force operations =</span>
                  <span className="text-red-400">2<sup>{difficulty * 2}</sup></span>
                  <span className="text-void-600">— universe dies first</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-void-600">test:</span>
                  <span className="text-void-400">if 1 x 1 = 2, then qubits needed =</span>
                  <span className="text-red-400">{((2593 + difficulty * 20) * 2).toLocaleString()}</span>
                  <span className="text-void-600">— more than atoms in your brain</span>
                </div>
                <div className="mt-2 pt-2 border-t border-void-800">
                  <span className="text-void-500">result: </span>
                  <span className="text-emerald-400 font-bold">EVERY alternative arithmetic makes SHA-256 harder, not weaker.</span>
                </div>
                <div>
                  <span className="text-void-500">proof: </span>
                  <span className="text-void-400">
                    SHA-256 is a one-way compression function. Inflating the input domain (1x1=2)
                    expands the search space exponentially. Deflating it (1x1=0) collapses valid nonces
                    to the empty set. Standard arithmetic (1x1=1) is the <span className="text-amber-400">only</span> system
                    where mining is even possible. You don't get to rewrite the axioms of
                    a hash function after it's been deployed to 10,000+ Bitcoin nodes since 2009.
                    The math was here first. Sit down.
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>
        </StaggerItem>

        {/* Current Challenge */}
        <StaggerItem>
          <GlassCard className="p-5 mb-4">
            <h3 className="text-sm font-semibold text-void-300 mb-3">Current Challenge</h3>
            <div className="bg-void-900/60 rounded-lg p-3 font-mono text-xs text-void-400 break-all select-all">
              {challenge || 'Loading...'}
            </div>
            <p className="text-void-500 text-xs mt-2">
              Find a nonce where SHA-256(challenge + nonce) meets the difficulty target.
              Compatible with Bitcoin ASICs.
            </p>
          </GlassCard>
        </StaggerItem>

        {/* Mining Log */}
        <StaggerItem>
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-void-300">Mining Log</h3>
              {miningLog.length > 0 && (
                <button
                  onClick={() => setMiningLog([])}
                  className="text-void-500 text-xs hover:text-void-300 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="bg-void-900/60 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-1">
              {miningLog.length === 0 ? (
                <div className="text-void-600">Waiting for mining activity...</div>
              ) : (
                miningLog.map((entry, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-void-600 shrink-0">[{entry.timestamp}]</span>
                    <span className={
                      entry.type === 'success' ? 'text-green-400' :
                      entry.type === 'error' ? 'text-red-400' :
                      entry.type === 'system' ? 'text-amber-400/70' :
                      'text-void-400'
                    }>
                      {entry.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        </StaggerItem>
      </StaggerContainer>
    </div>
  )
}

export default MinePage
