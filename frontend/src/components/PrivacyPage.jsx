import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// Privacy Page — Privacy Pools (Vitalik's model)
// ============================================================

const DENOMINATIONS = [
  { value: '0.1 ETH', deposits: 1240, anonymitySet: '89%' },
  { value: '1 ETH',   deposits: 890,  anonymitySet: '92%' },
  { value: '10 ETH',  deposits: 340,  anonymitySet: '85%' },
  { value: '100 ETH', deposits: 45,   anonymitySet: '78%' },
]

export default function PrivacyPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [selectedDenom, setSelectedDenom] = useState(1)
  const [action, setAction] = useState('deposit')

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          Privacy <span className="text-matrix-500">Pools</span>
        </h1>
        <p className="text-black-400 text-sm mt-2">
          Compliant privacy. Prove your funds are clean without revealing your identity.
        </p>
        <p className="text-black-600 text-[10px] font-mono mt-1">
          Based on Vitalik's Privacy Pools paper — association set model
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total Deposits', value: '2,515' },
          { label: 'TVL', value: '4,820 ETH' },
          { label: 'Association Providers', value: '12' },
        ].map((s) => (
          <div key={s.label} className="text-center p-3 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="text-white font-mono font-bold">{s.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Deposit/Withdraw toggle */}
      <div className="flex gap-1 p-1 bg-black-800/50 rounded-lg mb-6">
        <button
          onClick={() => setAction('deposit')}
          className={`flex-1 py-2 text-xs font-mono rounded-md transition-colors ${
            action === 'deposit' ? 'bg-matrix-600 text-black-900 font-bold' : 'text-black-400 hover:text-white'
          }`}
        >
          DEPOSIT
        </button>
        <button
          onClick={() => setAction('withdraw')}
          className={`flex-1 py-2 text-xs font-mono rounded-md transition-colors ${
            action === 'withdraw' ? 'bg-matrix-600 text-black-900 font-bold' : 'text-black-400 hover:text-white'
          }`}
        >
          WITHDRAW
        </button>
      </div>

      {/* Denomination selector */}
      <div className="space-y-3 mb-6">
        {DENOMINATIONS.map((d, i) => (
          <motion.button
            key={d.value}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setSelectedDenom(i)}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              selectedDenom === i
                ? 'border-matrix-600 bg-matrix-900/10'
                : 'border-black-700 bg-black-800/60 hover:border-black-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-white font-bold text-lg">{d.value}</div>
                <div className="text-black-500 text-xs font-mono">{d.deposits} deposits in pool</div>
              </div>
              <div className="text-right">
                <div className="text-matrix-400 font-mono font-bold">{d.anonymitySet}</div>
                <div className="text-black-500 text-[10px] font-mono">anonymity</div>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {/* Action button */}
      <button
        disabled={!isConnected}
        className="w-full py-3 bg-matrix-600 hover:bg-matrix-500 disabled:bg-black-700 disabled:text-black-500 text-black-900 font-bold rounded-lg transition-colors text-sm"
      >
        {action === 'deposit'
          ? `Deposit ${DENOMINATIONS[selectedDenom].value}`
          : `Withdraw ${DENOMINATIONS[selectedDenom].value}`
        }
      </button>

      {/* Info */}
      <div className="mt-6 p-4 bg-black-800/30 border border-black-700/50 rounded-xl">
        <h3 className="text-sm font-bold text-white mb-2">How Privacy Pools Work</h3>
        <div className="space-y-1 text-xs text-black-400">
          <p>+ Deposit a fixed denomination into the pool</p>
          <p>+ Wait for more deposits to grow the anonymity set</p>
          <p>+ Withdraw to a new address with a ZK proof</p>
          <p>+ Association set providers attest that your funds are not from sanctioned sources</p>
          <p>+ Compliant privacy — you prove cleanness without revealing identity</p>
        </div>
      </div>
    </div>
  )
}
