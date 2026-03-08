import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// RWA Hub — Real World Assets
// ============================================================

const RWA_MODULES = [
  {
    id: 'realestate',
    name: 'Real Estate',
    icon: '🏠',
    tagline: 'Decentralized Zillow — buy, sell, and earn rental income on-chain',
    description: 'Tokenized property ownership. Fractional shares. Smart contract escrow. Staked appraisal network. Rental income distribution.',
    stats: { properties: '340', volume: '2,100 ETH', avg_yield: '6.2%' },
    types: ['Residential', 'Commercial', 'Industrial', 'Land', 'Mixed-Use'],
    contract: 'VibeRealEstate',
  },
  {
    id: 'energy',
    name: 'Energy Market',
    icon: '⚡',
    tagline: 'P2P renewable energy trading — no utility middlemen',
    description: 'Solar panel owners sell excess energy directly. IoT smart meters verify production. Carbon credit issuance for renewables.',
    stats: { producers: '890', traded_kwh: '1.2M', co2_offset: '480T' },
    types: ['Solar', 'Wind', 'Hydro', 'Geothermal', 'Biomass'],
    contract: 'VibeEnergyMarket',
  },
  {
    id: 'supplychain',
    name: 'Supply Chain',
    icon: '📦',
    tagline: 'RFID/IoT supply chain verification from factory to doorstep',
    description: 'Track products through every checkpoint. RFID and IoT device attestation. Batch management. Tamper detection.',
    stats: { shipments: '4,200', checkpoints: '18K', verified: '99.7%' },
    types: ['Food', 'Pharma', 'Electronics', 'Luxury', 'Industrial'],
    contract: 'VibeSupplyChain',
  },
  {
    id: 'credentials',
    name: 'Credential Vault',
    icon: '🎓',
    tagline: 'Verifiable credentials — prove without revealing',
    description: 'Degrees, licenses, certifications — ZK-verifiable on-chain. Prove you have a credential without revealing the credential itself.',
    stats: { credentials: '12,400', verifications: '8,900', issuers: '56' },
    types: ['Degree', 'License', 'Certification', 'Achievement', 'Employment'],
    contract: 'VibeCredentialVault',
  },
  {
    id: 'rwa',
    name: 'Asset Tokenization',
    icon: '🪙',
    tagline: 'Universal RWA protocol — tokenize anything',
    description: 'Fractional ownership of real estate, commodities, art, IP, collectibles. Yield distribution. Secondary market.',
    stats: { assets: '560', total_value: '8,400 ETH', holders: '2,300' },
    types: ['Real Estate', 'Commodity', 'Art', 'IP', 'Vehicle', 'Collectible'],
    contract: 'VibeRWA',
  },
]

function RWACard({ module, isExpanded, onToggle }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-black-800/60 border rounded-xl overflow-hidden transition-colors ${
        isExpanded ? 'border-matrix-600' : 'border-black-700 hover:border-black-600'
      }`}
    >
      <div className="p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{module.icon}</span>
          <div className="flex-1">
            <h3 className="text-white font-bold">{module.name}</h3>
            <p className="text-black-400 text-xs">{module.tagline}</p>
          </div>
        </div>
        <div className="flex gap-4 mt-2">
          {Object.entries(module.stats).map(([k, v]) => (
            <span key={k} className="text-[10px] font-mono">
              <span className="text-matrix-400">{v}</span>
              <span className="text-black-500 ml-1">{k.replace('_', ' ')}</span>
            </span>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-black-700"
          >
            <div className="p-4">
              <p className="text-sm text-black-300 mb-3">{module.description}</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {module.types.map((t) => (
                  <span key={t} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black-900/60 border border-black-700 text-black-400">
                    {t}
                  </span>
                ))}
              </div>
              <div className="text-[10px] font-mono text-black-600">Contract: {module.contract}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function RWAHub() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [expanded, setExpanded] = useState('realestate')

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          Real World <span className="text-matrix-500">Assets</span>
        </h1>
        <p className="text-black-400 text-sm mt-2">
          Tokenize real-world assets. Trade property. Verify credentials. Track supply chains.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Assets', value: '18,400' },
          { label: 'Volume', value: '10.5K ETH' },
          { label: 'Holders', value: '5,200' },
          { label: 'CO2 Offset', value: '480T kg' },
        ].map((s) => (
          <div key={s.label} className="text-center p-2 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="text-white font-mono font-bold text-sm">{s.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Modules */}
      <div className="space-y-3">
        {RWA_MODULES.map((m) => (
          <RWACard
            key={m.id}
            module={m}
            isExpanded={expanded === m.id}
            onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
          />
        ))}
      </div>

      {!isConnected && (
        <div className="mt-8 text-center text-black-500 text-xs font-mono">
          Connect wallet to tokenize and trade real world assets
        </div>
      )}
    </div>
  )
}
