import { useState, useEffect } from 'react'

// ============================================================
// useWindowSize — Track window dimensions with debounce
// Returns { width, height, isMobile, isTablet, isDesktop }
// ============================================================

export function useWindowSize() {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  })

  useEffect(() => {
    let timeout
    function handleResize() {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        setSize({ width: window.innerWidth, height: window.innerHeight })
      }, 150)
    }

    window.addEventListener('resize', handleResize, { passive: true })
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return {
    ...size,
    isMobile: size.width < 640,
    isTablet: size.width >= 640 && size.width < 1024,
    isDesktop: size.width >= 1024,
  }
}
