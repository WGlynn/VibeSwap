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
        // True blacks - surface hierarchy
        black: {
          50: '#b0b0b0',
          100: '#909090',
          200: '#707070',
          300: '#505050',
          400: '#353535',
          500: '#252525',
          600: '#181818',
          700: '#0d0d0d', // Main surface
          800: '#080808',
          900: '#000000', // True black
        },
        // Legacy aliases for easier migration
        void: {
          200: '#707070',
          300: '#505050',
          400: '#353535',
          500: '#252525',
          600: '#181818',
          700: '#0d0d0d',
          800: '#080808',
          900: '#000000',
        },
        // Success/warning/error
        success: '#00ff41',
        warning: '#ffaa00',
        error: '#ff3366',
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
      },
      boxShadow: {
        'subtle': '0 1px 2px rgba(0, 0, 0, 0.5)',
        'medium': '0 4px 12px rgba(0, 0, 0, 0.5)',
        'strong': '0 8px 24px rgba(0, 0, 0, 0.6)',
        'glow-green': '0 0 20px rgba(0, 255, 65, 0.15)',
        'glow-cyan': '0 0 20px rgba(0, 212, 255, 0.15)',
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
