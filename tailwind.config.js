/**
 * Uma cor do Tailwind lida de uma variável CSS de `src/index.css`.
 *
 * OS VALORES MORAM EM index.css, NÃO AQUI. Aqui só se dá nome às variáveis: é o
 * que deixa o modo escuro (aprovado em 03/10/2026) ser apenas outra lista de
 * valores, sem tocar em classe nenhuma. O `<alpha-value>` mantém funcionando a
 * opacidade das classes (`bg-superficie/80`, `ring-anel/25`).
 */
const cor = (nome) => `rgb(var(--${nome}) / <alpha-value>)`

/** Os papéis de um tom categórico: `tom('azul', ['fundo'])` → `{ fundo: cor('tom-azul-fundo') }`. */
const tom = (matiz, papeis) =>
  Object.fromEntries(papeis.map((p) => [p, cor(`tom-${matiz}-${p}`)]))

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // O MODO ESCURO É O ATRIBUTO no <html> (src/lib/tema.ts), e não a preferência
  // do sistema: a pessoa escolhe Claro, Escuro ou Do sistema. Quase nada usa
  // `dark:` — as cores trocam pelas variáveis de index.css; a variante fica para
  // o que não é cor de token (o filtro da logomarca no Entrar).
  darkMode: ['selector', '[data-tema="escuro"]'],
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
          // O anel de foco DENTRO do menu navy (auditoria visual, 03/10/2026): o
          // azul do anel global dava 3,2:1 sobre o navy; este, 7:1, igual nos
          // dois temas.
          foco: cor('nav-foco'),
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
        // O ícone de cada tipo no aviso flutuante (Toast), que é escuro no
        // claro e claro no escuro.
        flutuante: {
          ok: cor('flutuante-ok'),
          erro: cor('flutuante-erro'),
          info: cor('flutuante-info'),
        },
        // TONS CATEGÓRICOS: a cor só distingue um nome de outro (etiqueta livre,
        // situação da Fase processual, grupo de coluna da Carteira…). No claro,
        // os mesmos valores da paleta do Tailwind de antes; no escuro, os da
        // amostra. Ver o bloco "tons categóricos" de index.css.
        tom: {
          azul: tom('azul', ['fundo', 'texto', 'borda', 'ponto', 'forte']),
          violeta: tom('violeta', ['fundo', 'texto', 'borda', 'ponto']),
          laranja: tom('laranja', ['fundo', 'texto', 'borda', 'ponto']),
          agua: tom('agua', ['fundo', 'texto', 'borda', 'cheio']),
          rosa: tom('rosa', ['fundo', 'texto', 'borda', 'ponto']),
          anil: tom('anil', ['fundo', 'texto', 'borda', 'cheio']),
          ceu: tom('ceu', ['texto']),
          ambar: tom('ambar', ['fundo', 'texto', 'ponto']),
          esmeralda: tom('esmeralda', ['fundo', 'texto', 'ponto']),
          vermelho: tom('vermelho', ['fundo', 'texto', 'ponto']),
          ardosia: tom('ardosia', ['fundo', 'texto', 'ponto']),
        },
        // A escala graduada de "parado há…" (Publicações): os degraus do meio e
        // do fim; as pontas são `aviso` e `perigo`.
        parado: {
          serio: {
            fundo: cor('parado-serio-fundo'),
            texto: cor('parado-serio-texto'),
            borda: cor('parado-serio-borda'),
            cheio: cor('parado-serio-cheio'),
          },
          critico: cor('parado-critico'),
        },
      },
      // A BORDA SEM COR (`border`, `divide-y`) também é token: o preflight do
      // Tailwind usa este valor, que antes era o gray-200 frio da paleta.
      borderColor: { DEFAULT: cor('borda') },
      // `ring` sem cor era o azul do Tailwind (blue-500); agora é o anel da casa.
      ringColor: { DEFAULT: cor('anel') },
      // O vão entre o anel de foco e o botão (`ring-offset-*`) era o branco fixo
      // do Tailwind: no escuro, um halo branco em volta de todo foco. Agora é a
      // superfície — no claro, o mesmo branco. Sem `<alpha-value>`: este valor
      // vai cru para a variável do preflight.
      ringOffsetColor: { DEFAULT: 'rgb(var(--superficie))' },
      // Os raios da amostra. A escala padrão (rounded-lg…) é em rem e, com o
      // <html> em 12px, encolhe um quarto: rounded-2xl vale 12px, não 16px.
      borderRadius: {
        controle: 'var(--raio-controle)',
        campo: 'var(--raio-campo)',
        cartao: 'var(--raio-cartao)',
        janela: 'var(--raio-janela)',
        // O que flutua sobre a tela: menu suspenso, o "?", aviso e o aviso de
        // versão (auditoria visual, §0.3). O `rounded-2xl` de antes era em rem
        // e valia 12px por acaso.
        flutuante: 'var(--raio-flutuante)',
      },
      // A GRADE DE 4 PX, COM RITMO DE 8 (auditoria visual de 03/10/2026, §0.1).
      // ADITIVA: a escala numérica de sempre continua (com o <html> em 12px, uma
      // unidade vale 3px — `p-5` = 15px), e trocá-la inteira mudaria a densidade
      // de todas as telas de uma vez (AP5, recusado). Estas valem em px, em
      // qualquer utilitário de espaço (`p-s4`, `gap-s2`, `mb-s6`, `h-controle`…).
      // Ao mexer num arquivo, converta: 0.5→s0.5; 1 e 1.5→s1; 2, 2.5 e 3→s2;
      // 3.5 e 4→s3; 5→s4 (ou s5 em cartão); 6→s5; 8→s6; 10→s8.
      //
      // AS ALTURAS DE CONTROLE (§0.2): uma só para botão, campo, select, data,
      // segmentado e busca de lista (36px); a pequena para botão `sm`, ação de
      // linha e chip (28px); a grande só no Entrar e em formulário de página
      // inteira (40px).
      spacing: {
        's0.5': '2px',
        s1: '4px',
        's1.5': '6px',
        s2: '8px',
        s3: '12px',
        s4: '16px',
        s5: '20px',
        s6: '24px',
        s8: '32px',
        s10: '40px',
        s12: '48px',
        s16: '64px',
        // 28px no computador e 36px no toque (`--controle-sm`, em index.css).
        'controle-sm': 'var(--controle-sm)',
        controle: '36px',
        'controle-lg': '40px',
      },
      // AS CAMADAS (§0.11), por nome e não por número solto: quem fica por cima
      // de quem é decisão da moldura, e um `z-40` escrito à mão numa tela não diz
      // com quem compete. Antes, o botão do assistente e a gaveta do celular
      // estavam ambos em z-40, e o botão ficava por cima do menu aberto.
      zIndex: {
        cabecalho: '10', // cabeçalho fixo de tabela
        topo: '30', // a barra do topo
        assistente: '30', // o botão flutuante do assistente
        'assistente-painel': '40', // o painel aberto do assistente
        janela: '50', // janela, painel lateral e a gaveta do menu no celular
        'aviso-versao': '55', // "Há uma versão nova"
        aviso: '60', // os avisos flutuantes e a dica do menu recolhido
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
