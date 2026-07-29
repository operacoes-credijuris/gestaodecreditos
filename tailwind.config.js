/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidade visual Credijuris (azul institucional + dourado)
        brand: {
          50: '#eef4fb',
          100: '#d6e4f5',
          200: '#aecaeb',
          300: '#7ba7da',
          400: '#4d83c6',
          500: '#2f64ab',
          600: '#234e88',
          700: '#1d406f',
          800: '#1a3760',
          900: '#0f223d',
          950: '#0a172a',
        },
        gold: {
          400: '#e3b84d',
          500: '#cda032',
          600: '#a98226',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      // Escala tipográfica com px explícitos, desacoplada do font-size do
      // <html> (que fica em 12px só para manter a densidade dos espaçamentos
      // em rem). Hierarquia oficial do app — NÃO usar text-[NNpx] arbitrário:
      //   xs   = metadados, rótulos auxiliares (mínimo legível)
      //   sm   = corpo padrão de texto e tabelas
      //   base = corpo enfatizado / campos
      //   2xl  = título de página (PageHeader)
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '19px' }],
        base: ['14px', { lineHeight: '21px' }],
        lg: ['16px', { lineHeight: '24px' }],
        xl: ['18px', { lineHeight: '26px' }],
        '2xl': ['22px', { lineHeight: '28px' }],
        '3xl': ['26px', { lineHeight: '32px' }],
      },
    },
  },
  plugins: [],
}
