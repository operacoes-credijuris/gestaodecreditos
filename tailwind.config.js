/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidade visual REAL da Credijuris, extraída dos materiais da marca
        // (logomarca, contrato timbrado e apresentações comerciais):
        //   - o azul da logomarca é EXATAMENTE #0B81C5 (amostrado pixel a pixel);
        //   - #0A6296 e #075278 são os azuis de título e cabeçalho do contrato;
        //   - os demais degraus interpolam esses três âncoras no mesmo matiz.
        // O antigo dourado NÃO existe em nenhum material da marca — o acento
        // real é o verde (ver `verde` abaixo).
        brand: {
          50: '#f2f9fd',
          100: '#e2f1fa',
          200: '#bfe2f4',
          300: '#86caea',
          400: '#40abdc',
          500: '#0b81c5', // ← o azul da logomarca
          600: '#0a6296', // ← azul de títulos do contrato
          700: '#075278', // ← azul de cabeçalho do contrato
          800: '#053f65',
          900: '#042c53', // ← navy da apresentação de Oferta (literal)
          950: '#021c38',
        },
        // Fundo da aplicação: papel quente, o fundo de TODAS as apresentações
        // comerciais da marca (#FAF7F0, #F5F2EC, #F1EFE8…). Um cinza-azulado
        // aqui parecia genérico; o papel é o que faz "parecer Credijuris".
        papel: '#f8f5ef',
        // Acento verde dos materiais comerciais (#2ECC71 e #1FA75B nas
        // apresentações) — usado para o indicador de navegação ativa e
        // destaques positivos/financeiros.
        verde: {
          50: '#e9faf1',
          400: '#2ecc71',
          500: '#1fa75b',
          600: '#147a43',
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
