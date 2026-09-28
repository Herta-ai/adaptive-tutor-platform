import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
          hover: 'var(--primary-hover)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        paper: 'var(--paper)',
        ink: 'var(--ink)',
        line: 'var(--line)',
        scholar: {
          50: '#f4f7f2',
          100: '#e6ede2',
          200: '#cfdcc8',
          300: '#adc4a3',
          400: '#83a577',
          500: '#5a864e',
          600: '#34654e',
          700: '#28503e',
          800: '#224032',
          900: '#1d352b',
          950: '#0e1c16',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        serif: [
          "'Songti SC'",
          "'Noto Serif SC'",
          "'Source Han Serif SC'",
          'STSong',
          'Georgia',
          'serif',
        ],
        sans: ['Inter', "'PingFang SC'", "'Microsoft YaHei'", 'sans-serif'],
        mono: ["'JetBrains Mono'", 'Consolas', 'monospace'],
      },
      boxShadow: {
        paper: '0 1px 3px 0 rgba(39, 56, 47, 0.05), 0 1px 2px -1px rgba(39, 56, 47, 0.05)',
        'paper-md': '0 4px 6px -1px rgba(39, 56, 47, 0.06), 0 2px 4px -2px rgba(39, 56, 47, 0.04)',
        'paper-lg':
          '0 10px 15px -3px rgba(39, 56, 47, 0.07), 0 4px 6px -4px rgba(39, 56, 47, 0.03)',
      },
    },
  },
  plugins: [],
};

export default config;
