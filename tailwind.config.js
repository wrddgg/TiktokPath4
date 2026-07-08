/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#FE2C55', // 抖音红
          dark: '#C71F40'
        },
        ink: {
          900: '#0D0D0D',
          800: '#161616',
          700: '#1F1F1F',
          600: '#2A2A2A'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif']
      },
      animation: {
        'slide-up': 'slideUp 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fadeIn 0.24s ease-out',
        'pulse-soft': 'pulseSoft 1.6s ease-in-out infinite'
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' }
        }
      }
    }
  },
  plugins: []
}
