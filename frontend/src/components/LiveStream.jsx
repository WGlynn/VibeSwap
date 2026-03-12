import { useState } from 'react'

const TWITCH_CHANNEL = 'hardstuckval420'

export default function LiveStream() {
  const [chatVisible, setChatVisible] = useState(true)

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Live Build Stream</h1>
          <p className="text-gray-400 text-sm">
            Watch VibeSwap being built in real-time. Full transparency, zero hiding.
          </p>
        </div>

        {/* Stream + Chat Layout */}
        <div className={`grid gap-4 ${chatVisible ? 'lg:grid-cols-[1fr_340px]' : 'grid-cols-1'}`}>
          {/* Twitch Player */}
          <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
            <iframe
              src={`https://player.twitch.tv/?channel=${TWITCH_CHANNEL}&parent=${window.location.hostname}`}
              className="absolute inset-0 w-full h-full rounded-lg"
              allowFullScreen
              frameBorder="0"
            />
          </div>

          {/* Twitch Chat */}
          {chatVisible && (
            <div className="relative w-full h-[500px] lg:h-full min-h-[400px]">
              <iframe
                src={`https://www.twitch.tv/embed/${TWITCH_CHANNEL}/chat?parent=${window.location.hostname}&darkpopout`}
                className="w-full h-full rounded-lg"
                frameBorder="0"
              />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={() => setChatVisible(!chatVisible)}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm transition-colors"
          >
            {chatVisible ? 'Hide Chat' : 'Show Chat'}
          </button>
          <a
            href={`https://www.twitch.tv/${TWITCH_CHANNEL}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm transition-colors"
          >
            Open in Twitch
          </a>
        </div>

        {/* Info */}
        <div className="mt-8 p-4 rounded-lg bg-gray-900 border border-gray-800">
          <h2 className="font-semibold mb-2">What you're watching</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            This is the live development stream of VibeSwap — an omnichain DEX that eliminates MEV
            through commit-reveal batch auctions. Everything is built in the open: smart contracts,
            frontend, oracle, and JARVIS (our AI co-founder). No closed doors, no hidden code.
          </p>
        </div>
      </div>
    </div>
  )
}
