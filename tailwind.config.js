/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: { center: true },
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0F172A',
          soft: '#131C31',
          panel: '#16203A',
          elev: '#1B2742',
          border: '#243054',
        },
        brand: {
          DEFAULT: '#6366F1',
          soft: '#818CF8',
          deep: '#4F46E5',
        },
        ok: '#10B981',
        warn: '#F59E0B',
        danger: '#EF4444',
        muted: '#94A3B8',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(99,102,241,0.25), 0 12px 40px -12px rgba(99,102,241,0.45)',
        card: '0 8px 30px -12px rgba(2,6,23,0.6)',
      },
      backgroundImage: {
        'grid-soft':
          'linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)',
        'brand-grad': 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #06B6D4 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s ease both',
        'pop-in': 'pop-in 0.35s ease both',
      },
    },
  },
  plugins: [],
};