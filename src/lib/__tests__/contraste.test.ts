// Contraste dos tokens do visual (etapa 5 do redesenho), NOS DOIS TEMAS.
//
// Os valores moram em `src/index.css` — o claro no `:root`, o escuro em
// `:root[data-tema='escuro']` — e este teste os lê DE LÁ, como texto: mudou uma
// cor no CSS, o teste refaz a conta. O escuro (aprovado em 03/10/2026) é outra
// lista de valores para os mesmos nomes, e passa pela mesma régua do claro.
//
// A régua é a da WCAG 2.1 AA:
// - texto sobre o fundo em que ele aparece: pelo menos 4,5:1 (1.4.3);
// - contorno de campo, anel de foco e ícone: pelo menos 3:1 (1.4.11) — senão um
//   campo vazio some no cartão, e quem navega pelo teclado não acha onde está.
//
// Os pares são os que os componentes de `src/components/ui/` e a moldura
// (`src/components/layout/`) de fato montam. Par novo num componente, par novo
// aqui.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cn } from '@/lib/cn'
import { CHART, CHART_ESCURO, type CoresDoGrafico } from '@/lib/chartColors'

const CSS = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf-8')
const CONFIG = readFileSync(
  fileURLToPath(new URL('../../../tailwind.config.js', import.meta.url)),
  'utf-8',
)

type Rgb = [number, number, number]
type Vars = Map<string, string>

/** As variáveis de um bloco do index.css, como texto cru. */
function variaveis(css: string, seletor: RegExp, nome: string): Vars {
  const bloco = css.match(new RegExp(seletor.source + String.raw`\s*\{([\s\S]*?)\n\s*\}`))
  if (!bloco) throw new Error(`index.css sem bloco ${nome}`)
  const semComentario = bloco[1].replace(/\/\*[\s\S]*?\*\//g, '')
  const vars: Vars = new Map()
  for (const m of semComentario.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].trim())
  }
  return vars
}

/** O primeiro `:root {…}`: o claro. */
const CLARO = variaveis(CSS, /:root/, ':root')
/** O que o escuro redefine. */
const SO_ESCURO = variaveis(CSS, /:root\[data-tema=['"]escuro['"]\]/, ":root[data-tema='escuro']")
/**
 * O que vale no escuro: o claro com o escuro por cima, como o navegador faz (os
 * dois blocos estão no mesmo `<html>`, e o do atributo é mais específico). Um
 * `var(--x)` do claro passa a apontar para o `--x` do escuro.
 */
const ESCURO: Vars = new Map([...CLARO, ...SO_ESCURO])

/** Resolve `var(--x)` (os papéis da marca apontam para a escala) até os canais R G B. */
function rgbEm(vars: Vars, nome: string, visitados: string[] = []): Rgb {
  if (nome === 'branco') return BRANCO
  if (visitados.includes(nome)) throw new Error(`ciclo em --${nome}`)
  const valor = vars.get(nome)
  if (valor === undefined) throw new Error(`--${nome} não existe no index.css`)
  const ref = valor.match(/^var\(--([\w-]+)\)$/)
  if (ref) return rgbEm(vars, ref[1], [...visitados, nome])
  const canais = valor.split(/\s+/).map(Number)
  if (canais.length !== 3 || canais.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    throw new Error(`--${nome} não está em canais "R G B": ${valor}`)
  }
  return canais as Rgb
}
const rgb = (nome: string) => rgbEm(CLARO, nome)

const BRANCO: Rgb = [255, 255, 255]

function luminancia([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contraste(a: Rgb, b: Rgb): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** [frente, fundo, onde aparece] */
type Par = [string, string, string]

const SUPERFICIES = ['superficie', 'superficie-2', 'superficie-3', 'papel']

const TEXTO: Par[] = [
  // Os três cinzas de texto em toda superfície (cartão, cabeçalho de tabela,
  // hover/trilho, fundo da página).
  ...['texto', 'texto-2', 'texto-3'].flatMap((t) =>
    SUPERFICIES.map((s): Par => [t, s, 'texto sobre superfície']),
  ),
  // A cor da marca como texto: link, aba aberta, opção escolhida, contagem acesa.
  ...['superficie', 'superficie-2', 'papel', 'marca-suave', 'marca-leve'].map(
    (s): Par => ['marca-texto', s, 'texto na cor da marca'],
  ),
  // Estados: o texto do estado no fundo pálido dele (selo, caixa de aviso) e no
  // branco (dica de erro do campo, "dispensada"); e o texto comum dentro da caixa.
  ...(['sucesso', 'perigo', 'aviso', 'info'] as const).flatMap((e): Par[] => [
    [e, `${e}-fundo`, `selo/caixa de ${e}`],
    [e, 'superficie', `texto de ${e} no cartão`],
    ['texto', `${e}-fundo`, `texto comum na caixa de ${e}`],
  ]),
  // Texto branco sobre os preenchidos: botões e item aceso do menu.
  ['branco', 'marca', 'botão primário'],
  ['branco', 'marca-hover', 'botão primário sob o mouse'],
  ['branco', 'perigo-cheio', 'botão de perigo'],
  ['branco', 'sucesso-cheio', 'botão de sucesso'],
  ['branco', 'nav-ativo', 'item aceso do menu'],
  // O menu lateral navy.
  ['branco', 'nav-fundo', 'marca e item sob o mouse no menu'],
  ['nav-texto', 'nav-fundo', 'itens do menu'],
  ['nav-apagado', 'nav-fundo', 'títulos das seções do menu'],
  ['acento', 'nav-fundo', 'título da seção acesa do menu'],
  // O número do contador no canto do ícone, no menu recolhido (o azul da marca).
  ['branco', 'marca', 'contador do menu recolhido'],
  // O aviso flutuante (toast): a superfície sobre o texto (escuro no claro,
  // claro no escuro). A dica do menu recolhido (ui/Dica.tsx) é o mesmo par.
  ['superficie', 'texto', 'aviso flutuante e dica do menu'],
  // O selo neutro (Badge gray).
  ['texto-2', 'superficie-3', 'selo neutro'],
  // OS TONS CATEGÓRICOS: a letra do selo no fundo pálido dele (Badge, situação
  // da Fase processual) e o título do grupo da Carteira no cabeçalho da tabela.
  ...['azul', 'violeta', 'laranja', 'agua', 'rosa', 'anil', 'ambar', 'esmeralda', 'vermelho', 'ardosia'].map(
    (t): Par => [`tom-${t}-texto`, `tom-${t}-fundo`, `selo do tom ${t}`],
  ),
  ...['tom-ceu-texto', 'tom-ambar-texto', 'tom-esmeralda-texto', 'tom-vermelho-texto',
    'tom-laranja-texto', 'tom-azul-forte', 'tom-violeta-texto'].map(
    (t): Par => [t, 'superficie-2', 'título de grupo da Carteira'],
  ),
  ['parado-serio-texto', 'parado-serio-fundo', 'selo "parado há…" (sério)'],
  ['branco', 'tom-anil-cheio', 'selo preenchido anil (espécie)'],
]

/**
 * SÓ NO CLARO. O `brand-600` como texto de link era um par do claro; no escuro
 * a `marca` é o FUNDO do botão primário (4,8:1 com o branco, como na amostra), e
 * nenhuma tela escreve `text-marca` — o texto na cor da marca é `marca-texto`,
 * conferido acima nos dois temas.
 */
const TEXTO_SO_NO_CLARO: Par[] = [['marca', 'superficie', 'link na escala da marca (brand-600)']]

/**
 * SÓ NO ESCURO. O verde-água preenchido (`tealSolid` da Badge) é o teal-600 do
 * Tailwind no claro, com 3,7:1 contra o branco — o valor de antes, que o claro
 * não pode mudar. No escuro, o da amostra (#0f766e) passa.
 */
const TEXTO_SO_NO_ESCURO: Par[] = [['branco', 'tom-agua-cheio', 'selo preenchido verde-água (espécie)']]

const NAO_TEXTO: Par[] = [
  // O contorno do campo onde há campos: cartão, janela, cabeçalho de tabela e
  // barra de filtros sobre o papel.
  ['borda-controle', 'superficie', 'contorno de campo no cartão'],
  ['borda-controle', 'superficie-2', 'contorno de campo na superfície 2'],
  ['borda-controle', 'papel', 'contorno de campo no fundo da página'],
  ['perigo', 'superficie', 'contorno de campo com erro'],
  // O anel de foco em todo fundo onde há algo focável.
  ['anel', 'superficie', 'anel de foco no cartão'],
  ['anel', 'papel', 'anel de foco no fundo da página'],
  ['anel', 'nav-fundo', 'anel de foco no menu'],
  // O anel PRÓPRIO do menu (auditoria visual, 03/10/2026): o `anel` dava 3,2:1
  // no navy; o `nav-foco`, por dentro do item, no fundo e no item aceso.
  ['nav-foco', 'nav-fundo', 'anel de foco do menu (nav-foco)'],
  ['nav-foco', 'nav-ativo', 'anel de foco no item aceso do menu'],
  // O sublinhado da aba aberta e a barra verde do item aceso.
  ['marca-viva', 'superficie', 'sublinhado da aba aberta'],
  ['acento', 'nav-fundo', 'barra do item aceso no menu'],
  // O ícone de cada tipo no aviso flutuante (fundo `texto`).
  ['flutuante-ok', 'texto', 'ícone de sucesso no aviso flutuante'],
  ['flutuante-erro', 'texto', 'ícone de erro no aviso flutuante'],
  ['flutuante-info', 'texto', 'ícone de informação no aviso flutuante'],
]

/** Ícones e bolinhas que só existem como sinal no escuro (no claro, ver acima). */
const NAO_TEXTO_SO_NO_ESCURO: Par[] = [['marca', 'superficie', 'botão primário no cartão']]

const fmt = (n: number) => n.toFixed(2).replace('.', ',')

const TEMAS = [
  { nome: 'claro', vars: CLARO, texto: [...TEXTO, ...TEXTO_SO_NO_CLARO], naoTexto: NAO_TEXTO },
  {
    nome: 'escuro',
    vars: ESCURO,
    texto: [...TEXTO, ...TEXTO_SO_NO_ESCURO],
    naoTexto: [...NAO_TEXTO, ...NAO_TEXTO_SO_NO_ESCURO],
  },
] as const

describe.each(TEMAS)('contraste dos tokens no $nome (index.css)', ({ vars, texto, naoTexto }) => {
  const cor = (nome: string) => rgbEm(vars, nome)

  it.each(texto)('texto %s sobre %s (%s) passa de 4,5:1', (frente, fundo) => {
    const c = contraste(cor(frente), cor(fundo))
    expect(c, `${frente} sobre ${fundo}: ${fmt(c)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(naoTexto)('%s sobre %s (%s) passa de 3:1', (frente, fundo) => {
    const c = contraste(cor(frente), cor(fundo))
    expect(c, `${frente} sobre ${fundo}: ${fmt(c)}:1`).toBeGreaterThanOrEqual(3)
  })
})

describe('a régua e a leitura dos blocos', () => {
  it('lê os tokens de verdade (senão o teste não está testando nada)', () => {
    expect(CLARO.size).toBeGreaterThan(40)
    expect(rgb('texto')).toEqual([23, 32, 43])
    // Os papéis da marca apontam para a escala, e a referência é seguida.
    expect(rgb('marca')).toEqual(rgb('brand-600'))
    // O escuro foi lido, e é outro.
    expect(SO_ESCURO.size).toBeGreaterThan(40)
    expect(rgbEm(ESCURO, 'texto')).toEqual([232, 238, 245])
    expect(rgbEm(ESCURO, 'papel')).not.toEqual(rgb('papel'))
  })

  it('a régua confere com valores conhecidos', () => {
    expect(contraste(BRANCO, [0, 0, 0])).toBeCloseTo(21, 5)
    expect(contraste(BRANCO, BRANCO)).toBeCloseTo(1, 5)
    // A conta que a amostra anota ao lado dos tokens (estilo.css).
    expect(contraste(rgb('texto'), BRANCO)).toBeGreaterThan(16)
    expect(contraste(rgb('texto-3'), BRANCO)).toBeGreaterThan(5.2)
    // "4,8:1 com texto branco", anotado ao lado do --brand escuro da amostra.
    expect(contraste(rgbEm(ESCURO, 'marca'), BRANCO)).toBeCloseTo(4.8, 1)
  })
})

describe('o escuro cobre o claro inteiro', () => {
  it('toda variável de cor do claro tem o seu valor escuro (os raios não mudam)', () => {
    // UMA COR ESQUECIDA NO ESCURO não dá erro: ela fica com o valor claro, e
    // aparece como uma mancha branca ou uma letra que some.
    const faltando = [...CLARO.keys()].filter((n) => !n.startsWith('raio-') && !SO_ESCURO.has(n))
    expect(faltando).toEqual([])
  })

  it('o escuro não inventa nome que o claro não tem (nome trocado)', () => {
    expect([...SO_ESCURO.keys()].filter((n) => !CLARO.has(n))).toEqual([])
  })

  it('o escuro liga `color-scheme: dark` (rolagem, campos nativos, calendário)', () => {
    const bloco = CSS.match(/:root\[data-tema=['"]escuro['"]\]\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    expect(bloco).toMatch(/color-scheme:\s*dark;/)
  })

  it('as cores dos gráficos repetem os tokens do tema delas', () => {
    // O Recharts precisa de hex (ver chartColors.ts); a cópia não pode descolar.
    const hex = ([r, g, b]: Rgb) => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
    const conferir = (cores: CoresDoGrafico, vars: Vars) => {
      expect(cores.grid).toBe(hex(rgbEm(vars, 'borda')))
      expect(cores.axis).toBe(hex(rgbEm(vars, 'borda-forte')))
      expect(cores.label).toBe(hex(rgbEm(vars, 'texto-3')))
      expect(cores.ink).toBe(hex(rgbEm(vars, 'texto')))
      expect(cores.surface).toBe(hex(rgbEm(vars, 'superficie')))
      // E o rótulo do eixo lê sobre o cartão.
      expect(contraste(rgbEm(vars, 'texto-3'), rgbEm(vars, 'superficie'))).toBeGreaterThanOrEqual(4.5)
    }
    conferir(CHART, CLARO)
    conferir(CHART_ESCURO, ESCURO)
  })
})

describe('os tokens chegam inteiros às classes', () => {
  /** Os nomes que o tailwind.config.js pede: `cor('x')` e os `tom('azul', [...])`. */
  const nomesDoConfig = () => [
    ...[...CONFIG.matchAll(/cor\('([\w-]+)'\)/g)].map((m) => m[1]),
    ...[...CONFIG.matchAll(/tom\('([\w-]+)',\s*\[([^\]]*)\]\)/g)].flatMap((m) =>
      [...m[2].matchAll(/'([\w-]+)'/g)].map((p) => `tom-${m[1]}-${p[1]}`),
    ),
  ]

  it('toda cor do tailwind.config.js tem a sua variável no index.css, nos dois temas', () => {
    // Uma variável com nome trocado não dá erro em lugar nenhum: a cor só some
    // da tela. Por isso o nome de cada `cor('x')` precisa existir em `--x`.
    const nomes = nomesDoConfig()
    expect(nomes.length).toBeGreaterThan(80)
    expect(nomes).toContain('tom-azul-fundo')
    const faltando = nomes.filter((n) => !CLARO.has(n))
    expect(faltando).toEqual([])
    for (const n of nomes) {
      expect(() => rgbEm(CLARO, n)).not.toThrow()
      expect(() => rgbEm(ESCURO, n)).not.toThrow()
    }
  })

  it('os raios e as sombras dos tokens existem', () => {
    const usados = [...CONFIG.matchAll(/var\(--((?:raio|sombra)-[\w-]+)\)/g)].map((m) => m[1])
    // 8: o raio dos flutuantes (auditoria visual, 03/10/2026) entrou.
    expect(usados.length).toBeGreaterThanOrEqual(8)
    expect(usados).toContain('raio-flutuante')
    expect(usados.filter((n) => !CLARO.has(n))).toEqual([])
  })

  it('o cn() reconhece os nomes próprios (corpo, raios, sombras)', () => {
    // Sem o extendTailwindMerge, o `text-corpo` era tomado por cor e descartado
    // quando vinha junto de uma cor de texto — a letra voltava aos 12px da raiz.
    expect(cn('text-corpo text-texto-2')).toBe('text-corpo text-texto-2')
    expect(cn('text-sm', 'text-corpo')).toBe('text-corpo')
    expect(cn('text-corpo', 'text-xs')).toBe('text-xs')
    expect(cn('rounded-cartao', 'rounded-lg')).toBe('rounded-lg')
    expect(cn('shadow-nivel-1', 'shadow-none')).toBe('shadow-none')
    expect(cn('border-borda-controle', 'border-perigo')).toBe('border-perigo')
    // A grade de 4px, as alturas de controle, o raio dos flutuantes e as
    // camadas (auditoria visual, 03/10/2026): a classe da tela vence a do
    // componente, e não a ordem do CSS.
    expect(cn('h-controle px-s4', 'h-9')).toBe('px-s4 h-9')
    expect(cn('p-5', 'p-s5')).toBe('p-s5')
    expect(cn('gap-s2', 'gap-s1.5')).toBe('gap-s1.5')
    expect(cn('rounded-flutuante', 'rounded-controle')).toBe('rounded-controle')
    expect(cn('z-topo', 'z-janela')).toBe('z-janela')
    expect(cn('text-corpo', 'text-texto-2', 'h-controle-sm')).toBe('text-corpo text-texto-2 h-controle-sm')
  })

  it('o menu no escuro se separa do papel (auditoria visual, E1)', () => {
    // O navy da amostra (#0a1622) era quase o papel (#0d141d): 1,01:1. Agora,
    // 1,1:1 — com a borda à direita do menu, é o que basta para separar.
    expect(contraste(rgbEm(ESCURO, 'nav-fundo'), rgbEm(ESCURO, 'papel'))).toBeGreaterThan(1.08)
    expect(rgbEm(ESCURO, 'nav-fundo')).toEqual([15, 30, 46])
    // O anel do menu é o mesmo nos dois temas.
    expect(rgbEm(ESCURO, 'nav-foco')).toEqual(rgb('nav-foco'))
  })
})
