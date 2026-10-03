// Catraca do visual (etapa 0A do redesenho).
//
// A etapa 5 troca as cores fixas por variáveis (a base do modo escuro) e os
// tamanhos de texto arbitrários pela escala do Tailwind. PARA ESSA TROCA TERMINAR
// algum dia, o que já existe não pode continuar crescendo enquanto ela anda:
// cada `text-slate-400` novo é mais um lugar que o modo escuro não alcança, e
// cada `text-[11px]` é um tamanho fora da escala (o `tailwind.config.js` já
// pede para não usar).
//
// Por isso este teste lê os fontes de `src/` como TEXTO, conta, e falha se a
// contagem SUBIR acima da linha de base gravada aqui. Descer pode — e, quando
// descer, baixe o número no mesmo commit, para a folga não virar espaço de
// recaída. Subir de propósito exige mudar o número aqui e dizer por quê.
//
// Os testes ficam de fora: um teste que confira uma classe pelo nome não pinta
// nada na tela.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Linhas de base ─────────────────────────────────────────────────────────
/** `text-[NNpx]`: eram 17 (02/10/2026, main em 230bce6). A onda 1 do redesenho
 *  trocou o único de 13px pelo `text-sm`; ficam os de 10 e 11px, abaixo da
 *  escala (10 na janela de análise do RPV, 2 na Análise de Crédito, 2 em Tarefas
 *  e 2 na janela de desfecho), que a onda 2 resolve tela a tela. */
const BASE_TEXTO_PX = 16
/** Cor da paleta do Tailwind com número (`bg-slate-50`, `hover:text-red-700`,
 *  `ring-amber-500/40`…). Eram 1.162 (o plano estimava cerca de 1.493). A onda 1
 *  trocou por token (`text-texto-2`, `bg-aviso-fundo`…) tudo o que era troca de
 *  1 para 1. As 65 que ficam são DE PROPÓSITO: paletas categóricas, em que a cor
 *  só distingue um nome de outro (os tons de etiqueta da Badge, a paleta de
 *  situação da Fase processual, os grupos de colunas da Carteira, os tipos de
 *  contato) e a escala graduada de "parado há…" das Publicações.
 *  A onda 2 (Quadro) baixou para 64: o azul do status "Azul" da carteira virou
 *  o token `text-info`. */
const BASE_COR_FIXA = 64

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function fontes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : fontes(caminho)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [caminho] : []
  })
}

const TEXTO_PX = /text-\[\d+(?:\.\d+)?px\]/g

/**
 * A paleta PADRÃO do Tailwind. `brand`, `verde` e `papel` (as da marca, no
 * `tailwind.config.js`) ficam de fora: são exatamente as que a etapa 5a mapeia
 * em variáveis, e passam a ser token sem mudar o nome da classe.
 */
const PALETA = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose',
]
const PREFIXOS = [
  'bg', 'text', 'border', 'ring', 'from', 'to', 'via', 'fill', 'stroke', 'divide',
  'outline', 'placeholder',
]
/**
 * Antes do prefixo, nem letra nem hífen: pega `hover:bg-…` e `!text-…`, mas não
 * um pedaço de outra palavra. Depois do número, nenhum dígito; a opacidade
 * (`/40`) não atrapalha.
 */
const COR_FIXA = new RegExp(
  String.raw`(?<![\w-])(?:${PREFIXOS.join('|')})-(?:${PALETA.join('|')})-(?:50|[1-9]00|950)(?!\d)`,
  'g',
)

const ARQUIVOS = fontes(SRC).map((caminho) => ({
  nome: relative(SRC, caminho),
  texto: readFileSync(caminho, 'utf-8'),
}))

function contar(re: RegExp) {
  const porArquivo = ARQUIVOS
    .map(({ nome, texto }) => ({ nome, n: texto.match(re)?.length ?? 0 }))
    .filter((a) => a.n > 0)
    .sort((a, b) => b.n - a.n)
  return { total: porArquivo.reduce((s, a) => s + a.n, 0), porArquivo }
}

/** Mensagem que já aponta onde procurar quando a contagem sobe. */
function explicar(o: string, base: number, c: ReturnType<typeof contar>) {
  const maiores = c.porArquivo.slice(0, 8).map((a) => `${a.nome}: ${a.n}`).join('; ')
  return `${o}: ${c.total} (linha de base ${base}). Use a escala/os tokens em vez de ` +
    `acrescentar. Arquivos com mais ocorrências: ${maiores}`
}

describe('catraca do visual', () => {
  it('lê os fontes de verdade (senão o teste não está testando nada)', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(80)
    expect(ARQUIVOS.some((a) => a.nome.endsWith('App.tsx'))).toBe(true)
    expect(ARQUIVOS.some((a) => a.nome.includes('__tests__'))).toBe(false)
  })

  it('a regra de cor pega as formas que o código usa, e só elas', () => {
    const achar = (s: string) => s.match(COR_FIXA) ?? []
    expect(achar('bg-slate-50 hover:text-red-700 ring-amber-500/40 !border-gray-200'))
      .toHaveLength(4)
    expect(achar('bg-brand-600 text-white bg-[#fff] contexto-red-500 text-slate-4000'))
      .toHaveLength(0)
  })

  it(`text-[NNpx] não passa de ${BASE_TEXTO_PX}`, () => {
    const c = contar(TEXTO_PX)
    expect(c.total, explicar('text-[NNpx]', BASE_TEXTO_PX, c)).toBeLessThanOrEqual(BASE_TEXTO_PX)
  })

  it(`cor fixa da paleta não passa de ${BASE_COR_FIXA}`, () => {
    const c = contar(COR_FIXA)
    expect(c.total, explicar('cor fixa', BASE_COR_FIXA, c)).toBeLessThanOrEqual(BASE_COR_FIXA)
  })
})

describe('o ambiente de teste não enxerga o banco de produção', () => {
  // Guarda do `test.env` do `vitest.config.ts`. Se alguém o apagar, o Vitest
  // volta a ler o `.env` de produção, e nenhum outro teste perceberia.
  it('o cliente do Supabase é montado com o endereço de mentira', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBe('http://supabase.teste.invalid')
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBe('chave-de-teste')
  })
})
