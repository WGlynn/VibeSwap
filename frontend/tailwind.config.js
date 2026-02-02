/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // VibeSwap signature colors - electric, alive, otherworldly
        vibe: {
          50: '#fff0fe',
          100: '#ffe0fd',
          200: '#ffc2fb',
          300: '#ff94f7',
          400: '#ff57f0',
          500: '#ff1ee8', // Primary - electric magenta
          600: '#e600c9',
          700: '#be00a4',
          800: '#9c0086',
          900: '#80006c',
          950: '#520044',
        },
        // Accent - cyan/teal for contrast
        cyber: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#00d4ff', // Secondary - electric cyan
          600: '#00b4d8',
          700: '#0891b2',
          800: '#0e7490',
          900: '#155e75',
        },
        // Warm accent - for success states
        glow: {
          400: '#c0ff57',
          500: '#a3ff00', // Bioluminescent green
          600: '#84cc16',
        },
        // Deep space background palette
        void: {
          50: '#f0f1ff',
          100: '#cacde8',
          200: '#9499b8',
          300: '#5f6588',
          400: '#3d4259',
          500: '#282d42',
          600: '#1a1e30',
          700: '#12152a', // Main background
          800: '#0c0e1f',
          900: '#070815', // Deepest
          950: '#030308',
        }
      },
      fontFamily: {
        sans: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Orbitron', 'Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'display-xl': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'display-lg': ['3.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display': ['2.5rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
        'gradient-flow': 'gradient-flow 15s ease infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'orbit': 'orbit 20s linear infinite',
        'breathe': 'breathe 4s ease-in-out infinite',
        'scan': 'scan 2s linear infinite',
        'glitch': 'glitch 0.3s ease-in-out',
        'slide-up': 'slide-up 0.5s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'bounce-subtle': 'bounce-subtle 0.5s ease-out',
        'ripple': 'ripple 0.6s ease-out',
        'morph': 'morph 8s ease-in-out infinite',
        'aurora': 'aurora 10s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.8', filter: 'brightness(1.2)' },
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'gradient-flow': {
          '0%': { backgroundPosition: '0% 0%' },
          '50%': { backgroundPosition: '100% 100%' },
          '100%': { backgroundPosition: '0% 0%' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        orbit: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.5' },
          '50%': { transform: 'scale(1.05)', opacity: '0.8' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        glitch: {
          '0%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(-2px, -2px)' },
          '60%': { transform: 'translate(2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
          '100%': { transform: 'translate(0)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
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
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'bounce-subtle': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)' },
        },
        ripple: {
          '0%': { transform: 'scale(0)', opacity: '1' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
        morph: {
          '0%, 100%': { borderRadius: '60% 40% 30% 70%/60% 30% 70% 40%' },
          '50%': { borderRadius: '30% 60% 70% 40%/50% 60% 30% 60%' },
        },
        aurora: {
          '0%': { backgroundPosition: '50% 50%', transform: 'rotate(0deg)' },
          '100%': { backgroundPosition: '350% 50%', transform: 'rotate(360deg)' },
        },
      },
      backgroundSize: {
        '300%': '300%',
        '400%': '400%',
      },
      boxShadow: {
        'glow-sm': '0 0 15px -3px var(--tw-shadow-color)',
        'glow': '0 0 30px -5px var(--tw-shadow-color)',
        'glow-lg': '0 0 50px -10px var(--tw-shadow-color)',
        'glow-xl': '0 0 80px -15px var(--tw-shadow-color)',
        'inner-glow': 'inset 0 0 30px -10px var(--tw-shadow-color)',
        'neon': '0 0 5px var(--tw-shadow-color), 0 0 20px var(--tw-shadow-color), 0 0 40px var(--tw-shadow-color)',
      },
      dropShadow: {
        'glow': '0 0 10px var(--tw-shadow-color)',
        'glow-lg': '0 0 25px var(--tw-shadow-color)',
      },
      backdropBlur: {
        'xs': '2px',
      },
      transitionTimingFunction: {
        'bounce-in': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
