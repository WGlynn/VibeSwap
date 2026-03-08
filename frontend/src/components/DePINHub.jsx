import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// DePIN Hub — Device Network, Private Compute, Medical Vault
// ============================================================

const DEPIN_MODULES = [
  {
    id: 'devices',
    name: 'Device Network',
    icon: '📡',
    description: 'Register IoT devices — RFID, cameras, sensors, robots, phones, AI compute nodes',
    stats: [
      { label: 'Devices', value: '2,847' },
      { label: 'Fleets', value: '156' },
      { label: 'Heartbeats/hr', value: '18.4K' },
    ],
    features: ['Hardware attestation via TEE/SE', 'Firmware verification', 'Fleet management', 'Heartbeat monitoring'],
    contract: 'VibeDeviceNetwork',
  },
  {
    id: 'compute',
    name: 'Private Compute',
    icon: '🔐',
    description: 'Zero-knowledge & homomorphic encryption compute on encrypted data. Privacy-preserving AI.',
    stats: [
      { label: 'Datasets', value: '892' },
      { label: 'Compute Jobs', value: '4,120' },
      { label: 'Nodes', value: '67' },
    ],
    features: ['ZK Proofs', 'FHE Aggregation', 'TEE Enclaves', 'Multi-Party Computation'],
    contract: 'VibePrivateCompute',
  },
  {
    id: 'medical',
    name: 'Medical Vault',
    icon: '🏥',
    description: 'HIPAA-grade medical records with granular consent. Emergency access with audit trail.',
    stats: [
      { label: 'Records', value: '12,400' },
      { label: 'Providers', value: '340' },
      { label: 'Studies', value: '28' },
    ],
    features: ['Per-provider consent', 'Research enrollment', 'Emergency access', 'Compensation tracking'],
    contract: 'VibeMedicalVault',
  },
]

function ModuleCard({ module, isActive, onClick }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={`bg-black-800/60 border rounded-xl p-5 cursor-pointer transition-all ${
        isActive ? 'border-matrix-600 bg-matrix-900/10' : 'border-black-700 hover:border-black-600'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="text-3xl">{module.icon}</div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-white">{module.name}</h3>
          <p className="text-sm text-black-400 mt-1">{module.description}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        {module.stats.map((stat) => (
          <div key={stat.label} className="text-center p-2 bg-black-900/40 rounded-lg">
            <div className="text-matrix-400 font-mono font-bold text-sm">{stat.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Features */}
      {isActive && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-4 space-y-1"
        >
          {module.features.map((f) => (
            <div key={f} className="flex items-center gap-2 text-xs font-mono text-black-300">
              <span className="text-matrix-500">+</span> {f}
            </div>
          ))}
          <div className="mt-3 text-[10px] font-mono text-black-600">
            Contract: {module.contract}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

export default function DePINHub() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [activeModule, setActiveModule] = useState('devices')

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          DePIN <span className="text-matrix-500">Network</span>
        </h1>
        <p className="text-black-400 text-sm mt-2 max-w-lg mx-auto">
          Decentralized Physical Infrastructure. Connect devices, compute on encrypted data,
          share sensitive records — all trustless and privacy-preserving.
        </p>
      </div>

      {/* Protocol stats banner */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Total Devices', value: '2,847' },
          { label: 'Compute Jobs', value: '4,120' },
          { label: 'Data Privacy', value: '100%' },
          { label: 'Device Types', value: '9' },
        ].map((s) => (
          <div key={s.label} className="text-center p-3 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="text-white font-mono font-bold">{s.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Modules */}
      <div className="space-y-4">
        {DEPIN_MODULES.map((module) => (
          <ModuleCard
            key={module.id}
            module={module}
            isActive={activeModule === module.id}
            onClick={() => setActiveModule(activeModule === module.id ? null : module.id)}
          />
        ))}
      </div>

      {/* CTA */}
      {!isConnected && (
        <div className="mt-8 text-center">
          <p className="text-black-500 text-xs font-mono">Connect wallet to register devices and access compute</p>
        </div>
      )}
    </div>
  )
}
