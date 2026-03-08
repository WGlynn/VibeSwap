import { useState, useEffect, createContext, useContext } from 'react'

const ThemeContext = createContext()

const THEME_KEY = 'vibeswap-theme'

// Available themes
const THEMES = {
  dark: { label: 'Dark', class: '' },
  terminal: { label: 'Terminal', class: 'theme-terminal' },
  midnight: { label: 'Midnight', class: 'theme-midnight' },
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem(THEME_KEY) || 'dark'
  })

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme)
    // Remove all theme classes, then add current
    document.documentElement.classList.remove(...Object.values(THEMES).map(t => t.class).filter(Boolean))
    const themeClass = THEMES[theme]?.class
    if (themeClass) document.documentElement.classList.add(themeClass)
  }, [theme])

  const setTheme = (t) => {
    if (THEMES[t]) setThemeState(t)
  }

  const cycleTheme = () => {
    const keys = Object.keys(THEMES)
    const idx = keys.indexOf(theme)
    setTheme(keys[(idx + 1) % keys.length])
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
