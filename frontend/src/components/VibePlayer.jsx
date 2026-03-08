import { useState, useRef, useCallback } from 'react'

const PLAYLIST_ID = 'PLQiikPOTiUt5_dXKg0WM_VIIzJcUrkyKq'

export default function VibePlayer() {
  const [isOpen, setIsOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const iframeRef = useRef(null)

  const togglePlayer = useCallback(() => {
    if (!isOpen) {
      setIsOpen(true)
      setIsPlaying(true)
    } else {
      setIsOpen(false)
      setIsPlaying(false)
    }
  }, [isOpen])

  return (
    <div className="fixed bottom-4 right-4" style={{ zIndex: 50 }}>
      {/* Expanded player */}
      {isOpen && (
        <div className="mb-2 rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-black/90 backdrop-blur-xl"
          style={{ width: 320, height: 200 }}
        >
          <iframe
            ref={iframeRef}
            width="320"
            height="200"
            src={`https://www.youtube.com/embed/videoseries?list=${PLAYLIST_ID}&autoplay=1&loop=1`}
            title="VibeSwap Playlist"
            frameBorder="0"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={togglePlayer}
        className="ml-auto flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg transition-all duration-300 hover:scale-105 active:scale-95"
        style={{
          background: isPlaying
            ? 'linear-gradient(135deg, #10b981, #059669)'
            : 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
          border: '1px solid rgba(255,255,255,0.15)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Music icon / bars animation */}
        {isPlaying ? (
          <div className="flex items-end gap-[2px] h-4">
            <span className="w-[3px] bg-white rounded-full animate-vibe-1" />
            <span className="w-[3px] bg-white rounded-full animate-vibe-2" />
            <span className="w-[3px] bg-white rounded-full animate-vibe-3" />
            <span className="w-[3px] bg-white rounded-full animate-vibe-4" />
          </div>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        )}
        <span className="text-white text-sm font-medium">
          {isPlaying ? 'VIBING' : 'VIBE'}
        </span>
      </button>

      {/* Keyframe animations for the music bars */}
      <style>{`
        @keyframes vibe-bar-1 { 0%, 100% { height: 4px; } 50% { height: 16px; } }
        @keyframes vibe-bar-2 { 0%, 100% { height: 10px; } 50% { height: 6px; } }
        @keyframes vibe-bar-3 { 0%, 100% { height: 6px; } 50% { height: 14px; } }
        @keyframes vibe-bar-4 { 0%, 100% { height: 12px; } 50% { height: 4px; } }
        .animate-vibe-1 { animation: vibe-bar-1 0.8s ease-in-out infinite; }
        .animate-vibe-2 { animation: vibe-bar-2 0.6s ease-in-out infinite; }
        .animate-vibe-3 { animation: vibe-bar-3 0.7s ease-in-out infinite; }
        .animate-vibe-4 { animation: vibe-bar-4 0.9s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
