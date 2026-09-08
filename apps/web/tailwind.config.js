/**
 * Design system.
 *
 * The palette, radii, shadows and spacing scale below are the single source of
 * truth for the whole product. Screens compose these tokens rather than
 * inventing one-off colours.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#07111F',
        navy: '#0A2342',
        brand: {
          DEFAULT: '#176BFF',
          50: '#EAF1FF',
          100: '#D6E4FF',
          200: '#AEC9FF',
          300: '#7FA8FF',
          400: '#4A87FF',
          500: '#176BFF',
          600: '#0F55D1',
          700: '#0B41A3',
          800: '#0A2342',
          900: '#07111F',
        },
        sky: '#61C8F4',
        page: '#F7F9FC',
        panel: '#EEF3F7',
        line: '#D1D9E2',
        muted: '#52606D',
        success: {
          DEFAULT: '#18A36B',
          soft: '#E7F6EF',
          border: '#A8E0C7',
        },
        warning: {
          DEFAULT: '#E89A20',
          soft: '#FDF3E3',
          border: '#F3D39B',
        },
        critical: {
          DEFAULT: '#D64545',
          soft: '#FCEBEB',
          border: '#F1B6B6',
        },
        info: {
          DEFAULT: '#176BFF',
          soft: '#EAF1FF',
          border: '#B9D0FF',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Typography scale from the design system.
        meta: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px
        support: ['0.875rem', { lineHeight: '1.375rem' }], // 14px
        body: ['0.9375rem', { lineHeight: '1.5rem' }], // 15px
        'body-lg': ['1.0625rem', { lineHeight: '1.6875rem' }], // 17px
        card: ['1.125rem', { lineHeight: '1.625rem' }], // 18px
        'card-lg': ['1.25rem', { lineHeight: '1.75rem' }], // 20px
        section: ['1.5rem', { lineHeight: '2rem' }], // 24px
        'section-lg': ['1.75rem', { lineHeight: '2.25rem' }], // 28px
        heading: ['2rem', { lineHeight: '2.5rem' }], // 32px
        'page-lg': ['2.5rem', { lineHeight: '3rem' }], // 40px
      },
      borderRadius: {
        card: '12px',
        panel: '14px',
        control: '10px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(7, 17, 31, 0.04), 0 1px 3px rgba(7, 17, 31, 0.06)',
        raised: '0 2px 4px rgba(7, 17, 31, 0.05), 0 8px 20px rgba(7, 17, 31, 0.08)',
        overlay: '0 12px 40px rgba(7, 17, 31, 0.18)',
        focus: '0 0 0 3px rgba(23, 107, 255, 0.28)',
      },
      spacing: {
        // 8px system
        18: '4.5rem',
        22: '5.5rem',
        68: '17rem',
      },
      maxWidth: {
        content: '84rem',
        prose: '46rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
      },
    },
  },
  plugins: [],
};
