import { createContext, useContext, useState, useEffect } from 'react'

const GameModeContext = createContext()

export function GameModeProvider({ children }) {
  // Check localStorage for saved preference
  const [isGamerMode, setIsGamerMode] = useState(() => {
    const saved = localStorage.getItem('vibeswap-gamer-mode')
    return saved === 'true'
  })

  // Persist preference
  useEffect(() => {
    localStorage.setItem('vibeswap-gamer-mode', isGamerMode.toString())
  }, [isGamerMode])

  const toggleMode = () => setIsGamerMode(!isGamerMode)

  return (
    <GameModeContext.Provider value={{ isGamerMode, setIsGamerMode, toggleMode }}>
      {children}
    </GameModeContext.Provider>
  )
}

export function useGameMode() {
  const context = useContext(GameModeContext)
  if (!context) {
    throw new Error('useGameMode must be used within a GameModeProvider')
  }
  return context
}
