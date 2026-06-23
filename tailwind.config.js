/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#102033',
        panel: '#f8fafc',
        line: '#d8e0ea',
        primary: '#2563eb',
        success: '#0f9f6e',
        danger: '#dc2626',
        warning: '#b7791f'
      },
      boxShadow: {
        soft: '0 10px 30px rgba(15, 23, 42, 0.08)'
      }
    }
  },
  plugins: []
};
