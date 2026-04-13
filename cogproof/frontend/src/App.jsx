import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import DemoPipeline from './pages/DemoPipeline'
import Reputation from './pages/Reputation'
import Batches from './pages/Batches'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', Component: Dashboard },
  { id: 'demo', label: 'Demo', Component: DemoPipeline },
  { id: 'reputation', label: 'Reputation', Component: Reputation },
  { id: 'batches', label: 'Batches', Component: Batches },
]

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const current = TABS.find(t => t.id === tab)

  return (
    <div className="min-h-screen bg-[#0a0b0f]">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm">
              CP
            </div>
            <h1 className="text-lg font-semibold text-white tracking-tight">
              CogProof
            </h1>
            <span className="text-xs text-gray-500 hidden sm:inline">
              Behavioral Reputation Infrastructure
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />
            Live
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="border-b border-gray-800 px-6">
        <div className="max-w-6xl mx-auto flex gap-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'text-amber-400 border-amber-400'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-6">
        <current.Component />
      </main>
    </div>
  )
}
