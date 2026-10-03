/**
 * Uma cor do Tailwind lida de uma variável CSS de `src/index.css`.
 *
 * OS VALORES MORAM EM index.css, NÃO AQUI. Aqui só se dá nome às variáveis: é o
 * que deixa o modo escuro (decidido para depois) ser apenas outra lista de
 * valores, sem tocar em classe nenhuma. O `<alpha-value>` mantém funcionando a
 * opacidade das classes (`bg-superficie/80`, `ring-anel/25`).
 */
const cor = (nome) => `rgb(var(--${nome}) / <alpha-value>)`

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
        // real é o verde (ver `verde` abaixo). Os valores estão em index.css.
        brand: {
          50: cor('brand-50'),
          100: cor('brand-100'),
          200: cor('brand-200'),
          300: cor('brand-300'),
          400: cor('brand-400'),
          500: cor('brand-500'), // ← o azul da logomarca
          600: cor('brand-600'), // ← azul de títulos do contrato
          700: cor('brand-700'), // ← azul de cabeçalho do contrato
          800: cor('brand-800'),
          900: cor('brand-900'), // ← navy da apresentação de Oferta (literal)
          950: cor('brand-950'),
        },
        // Fundo da aplicação: papel quente, o fundo de TODAS as apresentações
        // comerciais da marca (#FAF7F0, #F5F2EC, #F1EFE8…). Um cinza-azulado
        // aqui parecia genérico; o papel é o que faz "parecer Credijuris".
        papel: cor('papel'),
        // Acento verde dos materiais comerciais (#2ECC71 e #1FA75B nas
        // apresentações) — usado para o indicador de navegação ativa e
        // destaques positivos/financeiros.
        verde: {
          50: cor('verde-50'),
          400: cor('verde-400'),
          500: cor('verde-500'),
          600: cor('verde-600'),
        },

        // ── Tokens por PAPEL (a amostra aprovada, estilo.css) ──────────────
        // Uma tela pede "a superfície", "o texto secundário", "o fundo de
        // aviso" — nunca um cinza ou um âmbar da paleta. A catraca
        // (catraca.test.ts) conta as cores fixas que ainda restam.
        superficie: {
          DEFAULT: cor('superficie'), // cartão, janela, campo
          2: cor('superficie-2'), // cabeçalho de tabela, linha sob o mouse
          3: cor('superficie-3'), // hover de botão, trilho do segmentado
        },
        borda: {
          DEFAULT: cor('borda'), // divisória, contorno de cartão
          forte: cor('borda-forte'), // botão secundário, separador "·"
          controle: cor('borda-controle'), // contorno de campo (3:1)
        },
        texto: {
          DEFAULT: cor('texto'), // texto principal
          2: cor('texto-2'), // descrição, texto secundário
          3: cor('texto-3'), // metadado, dica, ícone discreto
        },
        veu: cor('veu'), // fundo escurecido atrás de janela e painel
        marca: {
          DEFAULT: cor('marca'), // botão primário
          hover: cor('marca-hover'),
          viva: cor('marca-viva'), // sublinhado da aba, barras
          suave: cor('marca-suave'), // contagem acesa, avatar
          leve: cor('marca-leve'), // hover de link, caixa de ajuda
          texto: cor('marca-texto'), // texto e link na cor da marca
        },
        anel: cor('anel'), // anel de foco
        nav: {
          DEFAULT: cor('nav-fundo'),
          2: cor('nav-fundo-2'),
          texto: cor('nav-texto'),
          apagado: cor('nav-apagado'),
          ativo: cor('nav-ativo'),
        },
        acento: cor('acento'), // barra verde do item aceso no menu
        sucesso: {
          DEFAULT: cor('sucesso'),
          fundo: cor('sucesso-fundo'),
          cheio: cor('sucesso-cheio'),
          borda: cor('sucesso-borda'),
        },
        perigo: {
          DEFAULT: cor('perigo'),
          fundo: cor('perigo-fundo'),
          cheio: cor('perigo-cheio'),
          borda: cor('perigo-borda'),
        },
        aviso: {
          DEFAULT: cor('aviso'),
          fundo: cor('aviso-fundo'),
          cheio: cor('aviso-cheio'),
          borda: cor('aviso-borda'),
        },
        info: {
          DEFAULT: cor('info'),
          fundo: cor('info-fundo'),
          borda: cor('info-borda'),
        },
      },
      // A BORDA SEM COR (`border`, `divide-y`) também é token: o preflight do
      // Tailwind usa este valor, que antes era o gray-200 frio da paleta.
      borderColor: { DEFAULT: cor('borda') },
      // `ring` sem cor era o azul do Tailwind (blue-500); agora é o anel da casa.
      ringColor: { DEFAULT: cor('anel') },
      // Os raios da amostra. A escala padrão (rounded-lg…) é em rem e, com o
      // <html> em 12px, encolhe um quarto: rounded-2xl vale 12px, não 16px.
      borderRadius: {
        controle: 'var(--raio-controle)',
        campo: 'var(--raio-campo)',
        cartao: 'var(--raio-cartao)',
        janela: 'var(--raio-janela)',
      },
      boxShadow: {
        'nivel-1': 'var(--sombra-1)', // cartão
        'nivel-2': 'var(--sombra-2)', // menu, aviso flutuante
        'nivel-3': 'var(--sombra-3)', // janela, painel lateral
      },
      fontFamily: {
        // Corpo, tabelas e formulários. Geométrica com altura-x generosa —
        // aguenta os 13px das listagens densas sem fechar os contraformas.
        sans: ['"Figtree Variable"', 'Figtree', 'system-ui', 'sans-serif'],
        // Títulos, números grandes e a marca. É a que ecoa o desenho
        // geométrico do wordmark "credijuris"; usar em texto corrido a
        // desvaloriza (e cansa a leitura), então fica só no display.
        display: [
          '"Plus Jakarta Sans Variable"',
          '"Plus Jakarta Sans"',
          'system-ui',
          'sans-serif',
        ],
      },
      // Escala tipográfica com px explícitos, desacoplada do font-size do
      // <html> (que fica em 12px só para manter a densidade dos espaçamentos
      // em rem). Hierarquia oficial do app — NÃO usar text-[NNpx] arbitrário:
      //   xs    = metadados, rótulos auxiliares, dica de campo (mínimo legível)
      //   sm    = controles compactos: botão, segmentado, selo largo
      //   corpo = TEXTO CORRIDO E CÉLULA DE TABELA (14px, decisão do dono)
      //   base  = corpo enfatizado (mesmo tamanho de `corpo`; prefira `corpo`)
      //   3xl   = título de página (PageHeader)
      //
      // `corpo` E NÃO "subir o sm": o sm continua sendo o tamanho dos controles,
      // como na amostra (botão de 13px ao lado de texto de 14px). O cn() de
      // src/lib/cn.ts precisa conhecer este nome — ver o extendTailwindMerge lá.
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '19px' }],
        corpo: ['14px', { lineHeight: '21px' }],
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
