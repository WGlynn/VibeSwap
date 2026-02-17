/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Matrix green - primary accent
        matrix: {
          50: '#e6fff0',
          100: '#b3ffd1',
          200: '#80ffb3',
          300: '#4dff94',
          400: '#1aff76',
          500: '#00ff41', // Primary - terminal green
          600: '#00cc34',
          700: '#009927',
          800: '#00661a',
          900: '#00330d',
        },
        // Terminal cyan - secondary accent
        terminal: {
          50: '#e6fcff',
          100: '#b3f5ff',
          200: '#80eeff',
          300: '#4de7ff',
          400: '#1ae0ff',
          500: '#00d4ff', // Secondary - cyan
          600: '#00a8cc',
          700: '#007c99',
          800: '#005066',
          900: '#002433',
        },
        // True blacks - surface hierarchy (text colors lightened 25% for visibility)
        black: {
          50: '#dcdcdc',
          100: '#b4b4b4',
          200: '#8c8c8c',
          300: '#646464',
          400: '#424242',
          500: '#2e2e2e',
          600: '#181818',
          700: '#0d0d0d', // Main surface
          800: '#080808',
          900: '#000000', // True black
        },
        // Legacy aliases for easier migration
        void: {
          200: '#8c8c8c',
          300: '#646464',
          400: '#424242',
          500: '#2e2e2e',
          600: '#181818',
          700: '#0d0d0d',
          800: '#080808',
          900: '#000000',
        },
        // Legacy dark-* (maps to black-*)
        dark: {
          200: '#8c8c8c',
          300: '#646464',
          400: '#424242',
          500: '#2e2e2e',
          600: '#181818',
          700: '#0d0d0d',
          800: '#080808',
          900: '#000000',
        },
        // Legacy vibe-* (maps to matrix-*)
        vibe: {
          300: '#4dff94',
          400: '#1aff76',
          500: '#00ff41',
          600: '#00cc34',
          700: '#009927',
        },
        // Legacy cyber-* (maps to terminal-*)
        cyber: {
          400: '#1ae0ff',
          500: '#00d4ff',
          600: '#00a8cc',
        },
        // Legacy glow-* (maps to matrix-*)
        glow: {
          400: '#1aff76',
          500: '#00ff41',
          600: '#00cc34',
        },
        // Success/warning/error
        success: '#00ff41',
        warning: '#ffaa00',
        error: '#ff3366',
        // Standard colors for compatibility
        green: {
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
        },
        red: {
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
        },
        yellow: {
          400: '#facc15',
          500: '#eab308',
        },
        purple: {
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
        },
        blue: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
        orange: {
          400: '#fb923c',
          500: '#f97316',
        },
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        gray: {
          300: '#d1d5db',
          400: '#9ca3af',
        },
      },
      fontFamily: {
        sans: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'monospace'],
        display: ['JetBrains Mono', 'SF Mono', 'monospace'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'display-xl': ['3.5rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'display-lg': ['2.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display': ['2rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-down': 'slide-down 0.2s ease-out',
        'scale-in': 'scale-in 0.15s ease-out',
        'pulse-subtle': 'pulse-subtle 2s ease-in-out infinite',
        'blink': 'blink 1s step-end infinite',
        'heartbeat': 'heartbeat 1s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.5s ease-out infinite',
        'glow-breathe': 'glow-breathe 3s ease-in-out infinite',
        'shimmer': 'shimmer 3s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'border-flow': 'border-flow 3s linear infinite',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'heartbeat': {
          '0%': { opacity: '0.3', transform: 'scale(1)' },
          '14%': { opacity: '1', transform: 'scale(1.02)' },
          '28%': { opacity: '0.5', transform: 'scale(1)' },
          '42%': { opacity: '0.9', transform: 'scale(1.01)' },
          '70%': { opacity: '0.3', transform: 'scale(1)' },
          '100%': { opacity: '0.3', transform: 'scale(1)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(1)', opacity: '0.8' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
        'glow-breathe': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(0,255,65,0.05)' },
          '50%': { boxShadow: '0 0 20px rgba(0,255,65,0.12)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'border-flow': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
      },
      boxShadow: {
        'subtle': '0 1px 2px rgba(0, 0, 0, 0.5)',
        'medium': '0 4px 12px rgba(0, 0, 0, 0.5)',
        'strong': '0 8px 24px rgba(0, 0, 0, 0.6)',
        'glow-green': '0 0 20px rgba(0, 255, 65, 0.15)',
        'glow-cyan': '0 0 20px rgba(0, 212, 255, 0.15)',
        'glow-green-md': '0 0 30px -5px rgba(0, 255, 65, 0.08)',
        'glow-green-lg': '0 0 40px -5px rgba(0, 255, 65, 0.12)',
        'glow-cyan-md': '0 0 30px -5px rgba(0, 212, 255, 0.08)',
        'glow-cyan-lg': '0 0 40px -5px rgba(0, 212, 255, 0.12)',
        'inner-glow-green': 'inset 0 0 20px rgba(0, 255, 65, 0.06)',
        'inner-glow-cyan': 'inset 0 0 20px rgba(0, 212, 255, 0.06)',
      },
      borderColor: {
        DEFAULT: '#252525',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
