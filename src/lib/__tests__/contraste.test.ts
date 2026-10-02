// Contraste dos tokens do visual (etapa 5 do redesenho).
//
// Os valores moram em `src/index.css` (`:root`), e este teste os lê DE LÁ, como
// texto: mudou uma cor no CSS, o teste refaz a conta. Assim o modo escuro
// (decidido para depois), que será outra lista de valores, já nasce com a régua
// pronta — basta acrescentar o bloco dele aqui.
//
// A régua é a da WCAG 2.1 AA:
// - texto sobre o fundo em que ele aparece: pelo menos 4,5:1 (1.4.3);
// - contorno de campo e anel de foco: pelo menos 3:1 (1.4.11) — senão um campo
//   vazio some no cartão, e quem navega pelo teclado não acha onde está.
//
// Os pares são os que os componentes de `src/components/ui/` e a moldura
// (`src/components/layout/`) de fato montam. Par novo num componente, par novo
// aqui.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cn } from '@/lib/cn'

const CSS = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf-8')
const CONFIG = readFileSync(
  fileURLToPath(new URL('../../../tailwind.config.js', import.meta.url)),
  'utf-8',
)

type Rgb = [number, number, number]

/** As variáveis do primeiro `:root {…}` do index.css, como texto cru. */
function variaveisDoRoot(css: string): Map<string, string> {
  const bloco = css.match(/:root\s*\{([\s\S]*?)\n\s*\}/)
  if (!bloco) throw new Error('index.css sem bloco :root')
  const semComentario = bloco[1].replace(/\/\*[\s\S]*?\*\//g, '')
  const vars = new Map<string, string>()
  for (const m of semComentario.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].trim())
  }
  return vars
}

const VARS = variaveisDoRoot(CSS)

/** Resolve `var(--x)` (os papéis da marca apontam para a escala) até os canais R G B. */
function rgb(nome: string, visitados: string[] = []): Rgb {
  if (visitados.includes(nome)) throw new Error(`ciclo em --${nome}`)
  const valor = VARS.get(nome)
  if (valor === undefined) throw new Error(`--${nome} não existe no :root do index.css`)
  const ref = valor.match(/^var\(--([\w-]+)\)$/)
  if (ref) return rgb(ref[1], [...visitados, nome])
  const canais = valor.split(/\s+/).map(Number)
  if (canais.length !== 3 || canais.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    throw new Error(`--${nome} não está em canais "R G B": ${valor}`)
  }
  return canais as Rgb
}

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

const cor = (nome: string): Rgb => (nome === 'branco' ? BRANCO : rgb(nome))

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
  ['marca', 'superficie', 'link na escala da marca (brand-600)'],
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
  // O aviso flutuante (toast) é escuro: a superfície sobre o texto.
  ['superficie', 'texto', 'aviso flutuante'],
  // O selo neutro (Badge gray).
  ['texto-2', 'superficie-3', 'selo neutro'],
]

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
  // O sublinhado da aba aberta e a barra verde do item aceso.
  ['marca-viva', 'superficie', 'sublinhado da aba aberta'],
  ['acento', 'nav-fundo', 'barra do item aceso no menu'],
]

const fmt = (n: number) => n.toFixed(2).replace('.', ',')

describe('contraste dos tokens (index.css)', () => {
  it('lê os tokens de verdade (senão o teste não está testando nada)', () => {
    expect(VARS.size).toBeGreaterThan(40)
    expect(rgb('texto')).toEqual([23, 32, 43])
    // Os papéis da marca apontam para a escala, e a referência é seguida.
    expect(rgb('marca')).toEqual(rgb('brand-600'))
  })

  it.each(TEXTO)('texto %s sobre %s (%s) passa de 4,5:1', (frente, fundo) => {
    const c = contraste(cor(frente), cor(fundo))
    expect(c, `${frente} sobre ${fundo}: ${fmt(c)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(NAO_TEXTO)('%s sobre %s (%s) passa de 3:1', (frente, fundo) => {
    const c = contraste(cor(frente), cor(fundo))
    expect(c, `${frente} sobre ${fundo}: ${fmt(c)}:1`).toBeGreaterThanOrEqual(3)
  })

  it('a régua confere com valores conhecidos', () => {
    expect(contraste(BRANCO, [0, 0, 0])).toBeCloseTo(21, 5)
    expect(contraste(BRANCO, BRANCO)).toBeCloseTo(1, 5)
    // A conta que a amostra anota ao lado dos tokens (estilo.css).
    expect(contraste(cor('texto'), BRANCO)).toBeGreaterThan(16)
    expect(contraste(cor('texto-3'), BRANCO)).toBeGreaterThan(5.2)
  })
})

describe('os tokens chegam inteiros às classes', () => {
  it('toda cor do tailwind.config.js tem a sua variável no index.css', () => {
    // Uma variável com nome trocado não dá erro em lugar nenhum: a cor só some
    // da tela. Por isso o nome de cada `cor('x')` precisa existir em `--x`.
    const nomes = [...CONFIG.matchAll(/cor\('([\w-]+)'\)/g)].map((m) => m[1])
    expect(nomes.length).toBeGreaterThan(40)
    const faltando = nomes.filter((n) => !VARS.has(n))
    expect(faltando).toEqual([])
    for (const n of nomes) expect(() => rgb(n)).not.toThrow()
  })

  it('os raios e as sombras dos tokens existem', () => {
    const usados = [...CONFIG.matchAll(/var\(--((?:raio|sombra)-[\w-]+)\)/g)].map((m) => m[1])
    expect(usados.length).toBeGreaterThanOrEqual(7)
    expect(usados.filter((n) => !VARS.has(n))).toEqual([])
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
  })
})
