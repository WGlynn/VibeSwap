import { useState, useRef, useCallback, useEffect } from 'react'

const PLAYLIST_ID = 'PLQiikPOTiUt5_dXKg0WM_VIIzJcUrkyKq'
const STORAGE_KEY = 'vibeswap_player_state'

function savePlayerState(index, time) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ index, time, ts: Date.now() }))
  } catch {}
}

function loadPlayerState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

// Load YouTube IFrame API once
let ytApiReady = false
let ytApiCallbacks = []

function loadYTApi() {
  if (ytApiReady || document.getElementById('yt-iframe-api')) return
  const tag = document.createElement('script')
  tag.id = 'yt-iframe-api'
  tag.src = 'https://www.youtube.com/iframe_api'
  document.head.appendChild(tag)
  window.onYouTubeIframeAPIReady = () => {
    ytApiReady = true
    ytApiCallbacks.forEach(cb => cb())
    ytApiCallbacks = []
  }
}

function onYTReady(cb) {
  if (ytApiReady) cb()
  else ytApiCallbacks.push(cb)
}

export default function VibePlayer() {
  const [isOpen, setIsOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const playerRef = useRef(null)
  const containerRef = useRef(null)

  // Load YT API on mount
  useEffect(() => { loadYTApi() }, [])

  // Create/destroy YT.Player when isOpen changes
  useEffect(() => {
    if (!isOpen) {
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch {}
        playerRef.current = null
      }
      return
    }

    onYTReady(() => {
      if (!containerRef.current || playerRef.current) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: '1',
        width: '1',
        playerVars: {
          listType: 'playlist',
          list: PLAYLIST_ID,
          autoplay: 1,
          loop: 1,
          playsinline: 1,       // iOS: play inline, not fullscreen
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: (e) => {
            // Restore saved position if available
            const saved = loadPlayerState()
            if (saved && typeof saved.index === 'number') {
              e.target.playVideoAt(saved.index)
              // seekTo after a short delay — player needs to load the video first
              setTimeout(() => {
                if (saved.time > 0) {
                  e.target.seekTo(saved.time, true)
                }
              }, 500)
            } else {
              e.target.playVideo()
            }
          },
          onStateChange: (e) => {
            // Sync UI to actual playback state
            const state = e.data
            if (state === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true)
            } else if (state === window.YT.PlayerState.PAUSED) {
              setIsPlaying(false)
              // Save position on pause
              try {
                const idx = e.target.getPlaylistIndex()
                const time = e.target.getCurrentTime()
                savePlayerState(idx, time)
              } catch {}
            } else if (state === window.YT.PlayerState.ENDED ||
                       state === window.YT.PlayerState.UNSTARTED) {
              setIsPlaying(false)
            }
          },
        },
      })
    })

    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch {}
        playerRef.current = null
      }
    }
  }, [isOpen])

  const play = useCallback(() => {
    if (playerRef.current?.playVideo) playerRef.current.playVideo()
  }, [])

  const pause = useCallback(() => {
    if (playerRef.current?.pauseVideo) playerRef.current.pauseVideo()
  }, [])

  const togglePlayPause = useCallback(() => {
    if (isPlaying) pause()
    else play()
  }, [isPlaying, play, pause])

  const nextTrack = useCallback(() => {
    if (playerRef.current?.nextVideo) playerRef.current.nextVideo()
  }, [])

  const prevTrack = useCallback(() => {
    if (playerRef.current?.previousVideo) playerRef.current.previousVideo()
  }, [])

  // Save position every 5s while playing
  useEffect(() => {
    if (!isPlaying) return
    const interval = setInterval(() => {
      const p = playerRef.current
      if (p?.getPlaylistIndex && p?.getCurrentTime) {
        savePlayerState(p.getPlaylistIndex(), p.getCurrentTime())
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [isPlaying])

  const togglePlayer = useCallback(() => {
    if (!isOpen) {
      setIsOpen(true)
    } else {
      // Save position before closing
      const p = playerRef.current
      if (p?.getPlaylistIndex && p?.getCurrentTime) {
        savePlayerState(p.getPlaylistIndex(), p.getCurrentTime())
      }
      if (p?.pauseVideo) p.pauseVideo()
      setIsOpen(false)
      setIsPlaying(false)
      setShowPanel(false)
    }
  }, [isOpen])

  const togglePanel = useCallback(() => {
    if (!isOpen) {
      setIsOpen(true)
      setShowPanel(true)
    } else {
      setShowPanel(p => !p)
    }
  }, [isOpen])

  return (
    <div className="fixed bottom-4 right-4" style={{ zIndex: 50 }}>
      {/* Hidden YT player container — 1x1px, invisible */}
      {isOpen && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          <div ref={containerRef} />
        </div>
      )}

      {/* Mini panel — shows playlist info when expanded */}
      {showPanel && isOpen && (
        <div
          className="mb-2 rounded-xl overflow-hidden shadow-2xl border border-matrix-500/20 backdrop-blur-2xl"
          style={{
            width: 280,
            background: 'rgba(4,4,4,0.92)',
          }}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-black-700">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-matrix-500 animate-pulse' : 'bg-black-500'}`} />
              <span className="text-xs font-mono font-bold text-matrix-400">
                {isPlaying ? 'NOW VIBING' : 'PAUSED'}
              </span>
            </div>
            <button
              onClick={() => setShowPanel(false)}
              className="p-1 rounded hover:bg-black-700 text-black-400 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Visualizer bars */}
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-end justify-center gap-[3px] h-12 mb-3">
              {Array.from({ length: 16 }).map((_, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full transition-all duration-300"
                  style={{
                    background: 'linear-gradient(to top, #10b981, #00ff41)',
                    animation: isPlaying
                      ? `vibe-bar-${(i % 4) + 1} ${0.4 + (i % 5) * 0.15}s ease-in-out infinite`
                      : 'none',
                    height: isPlaying ? undefined : '3px',
                  }}
                />
              ))}
            </div>

            {/* Track info */}
            <div className="text-center">
              <div className="text-sm font-medium text-white truncate">VibeSwap Playlist</div>
              <div className="text-[11px] text-black-500 mt-0.5">YouTube Music</div>
            </div>
          </div>

          {/* Transport controls */}
          <div className="flex items-center justify-center gap-3 px-4 pb-4">
            {/* Previous */}
            <button
              onClick={prevTrack}
              className="w-9 h-9 rounded-full flex items-center justify-center text-black-300 hover:text-white hover:bg-white/10 transition-colors"
              title="Previous track"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>

            {/* Play / Pause */}
            <button
              onClick={togglePlayPause}
              className="w-11 h-11 rounded-full bg-matrix-600 hover:bg-matrix-500 text-black-900 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Next */}
            <button
              onClick={nextTrack}
              className="w-9 h-9 rounded-full flex items-center justify-center text-black-300 hover:text-white hover:bg-white/10 transition-colors"
              title="Next track"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        {isPlaying && !showPanel && (
          <>
            {/* Previous */}
            <button
              onClick={prevTrack}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 active:text-white active:scale-90 transition-all"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>

            {/* Pause */}
            <button
              onClick={togglePlayPause}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 active:text-white active:scale-90 transition-all"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            </button>

            {/* Next */}
            <button
              onClick={nextTrack}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 active:text-white active:scale-90 transition-all"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </>
        )}

        {/* Main VIBE button */}
        <button
          onClick={togglePlayer}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg transition-all duration-300 hover:scale-105 active:scale-95"
          style={{
            background: isPlaying
              ? 'linear-gradient(135deg, #10b981, #059669)'
              : 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
            border: '1px solid rgba(255,255,255,0.15)',
            backdropFilter: 'blur(12px)',
          }}
        >
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
      </div>

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
