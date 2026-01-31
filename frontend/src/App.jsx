import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import SwapPage from './components/SwapPage'
import PoolPage from './components/PoolPage'
import BridgePage from './components/BridgePage'
import MobileNav from './components/MobileNav'

function App() {
  return (
    <div className="min-h-screen animated-bg">
      {/* Background decorations */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-vibe-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-vibe-500/5 rounded-full blur-3xl" />
      </div>

      {/* Main content */}
      <div className="relative z-10 pb-20 md:pb-0">
        <Header />
        <main className="pt-4 md:pt-8 pb-8 md:pb-16">
          <Routes>
            <Route path="/" element={<SwapPage />} />
            <Route path="/swap" element={<SwapPage />} />
            <Route path="/pool" element={<PoolPage />} />
            <Route path="/bridge" element={<BridgePage />} />
          </Routes>
        </main>
      </div>

      {/* Mobile Navigation */}
      <MobileNav />
    </div>
  )
}

export default App
