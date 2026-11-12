// Auditoria C (12/11/2026): telas de execução do Operacional — Créditos,
// Publicações e movimentações, Fase processual — e as fichas delas.
//
// Um bloco por defeito corrigido. Cada um falharia antes da correção: ou porque
// a função pura não existia, ou porque o fonte ainda tinha o desenho que quebrava.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { faseDaTrilha } from '../situacaoDaFase'
import { paradoNaJanela } from '../paralisados'
import { FASE_ATIVO_ORDEM, FASE_COMPLEMENTAR_ORDEM } from '../labels'

const ler = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')
const FASE = '../../pages/operacional/execucao/FaseProcessual.tsx'
const PUB = '../../pages/operacional/execucao/PublicacoesMovimentacoes.tsx'

describe('Fase processual: o crédito que troca de trilha não some da tela', () => {
  const linha = (fase_codigo: string) => ({ processo_id: 'p1', fase_codigo })

  it('a fase da própria trilha vale', () => {
    expect(faseDaTrilha(linha('ATV-03'), FASE_ATIVO_ORDEM)?.fase_codigo).toBe('ATV-03')
    expect(faseDaTrilha(linha('CMP-05'), FASE_COMPLEMENTAR_ORDEM)?.fase_codigo).toBe('CMP-05')
  })

  it('a fase de antes da troca de status conta como sem fase', () => {
    // Passou de Ativo para Complementar e ainda não foi reclassificado.
    expect(faseDaTrilha(linha('ATV-03'), FASE_COMPLEMENTAR_ORDEM)).toBeUndefined()
    expect(faseDaTrilha(linha('CMP-05'), FASE_ATIVO_ORDEM)).toBeUndefined()
  })

  it('sem linha, sem fase', () => {
    expect(faseDaTrilha(undefined, FASE_ATIVO_ORDEM)).toBeUndefined()
    expect(faseDaTrilha(null, FASE_ATIVO_ORDEM)).toBeUndefined()
  })

  it('os cartões, a lista, o "Nº e Enter" e a ficha usam a mesma régua', () => {
    const src = ler(FASE)
    // Cartões e lista.
    expect(src).toMatch(/const r = faseDaTrilha\(faseDe\.get\(p\.id\), ordem\)/)
    expect(src).toMatch(/r: faseDaTrilha\(faseDe\.get\(p\.id\), ordem\)/)
    // A ficha: o seletor não fica com um valor fora das opções.
    expect(src).toMatch(/const r = faseDaTrilha\(query\.data, ordem\)/)
    // O "Nº do processo e Enter" não filtra por uma fase sem cartão.
    expect(src).toMatch(/faseDe\.get\(encontrado\.id\),\s*\n\s*encontrado\.status === 'ativo'/)
  })
})

describe('Ficha do crédito: falha ao ler a fase não se passa por "sem fase"', () => {
  it('mostra o erro com "Tentar de novo", e o seletor não diz "Escolher fase…"', () => {
    const src = ler(FASE)
    expect(src).toMatch(/query\.isError \? 'Fase não lida' : 'Escolher fase…'/)
    expect(src).toMatch(/Não consegui ler a fase deste crédito/)
    expect(src).toMatch(/onClick=\{\(\) => void query\.refetch\(\)\}/)
  })
})

describe('Movimentações: quem movimentou dentro da janela não está em Paralisados', () => {
  const inicio = '2026-10-23' // 20 dias antes de 12/11/2026

  it('última movimentação antes da janela: parado', () => {
    expect(paradoNaJanela('2026-10-22', inicio)).toBe(true)
    expect(paradoNaJanela('2026-01-05', inicio)).toBe(true)
  })

  it('última movimentação dentro da janela (o caso do apenso): não está parado', () => {
    expect(paradoNaJanela('2026-11-10', inicio)).toBe(false)
    // O primeiro dia da janela já é dentro dela, como no `.gte` da lista.
    expect(paradoNaJanela('2026-10-23', inicio)).toBe(false)
    // Com hora, compara pelo dia.
    expect(paradoNaJanela('2026-11-10T14:00:00-03:00', inicio)).toBe(false)
  })

  it('sem movimentação nenhuma continua parado (o caso mais grave)', () => {
    expect(paradoNaJanela(null, inicio)).toBe(true)
    expect(paradoNaJanela(undefined, inicio)).toBe(true)
    expect(paradoNaJanela('', inicio)).toBe(true)
  })

  it('a lista de Paralisados filtra pela janela da própria aba', () => {
    const src = ler(PUB)
    expect(src).toMatch(/\.filter\(\(s\) => paradoNaJanela\(s\.ultima_movimentacao, ini20\)\)/)
    // O aviso do corte não promete mais o defeito que deixou de existir.
    expect(src).not.toMatch(/pode\s+aparecer em Paralisados sem estar/)
  })
})

describe('Publicações: marcar e desmarcar "tratada" vai ao servidor em fila', () => {
  it('a gravação tem escopo próprio (dois cliques não chegam fora de ordem)', () => {
    const src = ler(PUB)
    expect(src).toMatch(/const toggleTratada = useMutation\(\{[\s\S]{0,600}scope: \{ id: 'djen_tratada' \}/)
  })

  it('a caixa diz de qual publicação é, para o leitor de tela', () => {
    const src = ler(PUB)
    expect(src).not.toMatch(/<span className="sr-only">Tratada<\/span>/)
    expect(src).toMatch(/sr-only">Publicação \{formatCNJ\(p\.numero_processo \?\? ''\)\} tratada/)
  })
})

describe('Crédito: digitar o número não apaga os outros erros do formulário', () => {
  it('limpa só o erro do número', () => {
    const src = ler('../../components/CreditoFormModal.tsx')
    expect(src).not.toMatch(/if \(erros\.numero_cnj\) setErros\(\{\}\)/)
    expect(src).toMatch(/if \(erros\.numero_cnj\) setErros\(\(v\) => \(\{ \.\.\.v, numero_cnj: '' \}\)\)/)
  })
})

describe('Pasta no Drive: a falha do caminho rápido aparece', () => {
  it('o import() do atalho do id guardado está dentro de um try', () => {
    const src = ler('../../components/NumeroProcessoDrive.tsx')
    const rapido = src.slice(src.indexOf('if (processo.drive_pasta_id) {'), src.indexOf('setAbrindo(true)'))
    expect(rapido).toMatch(/try \{\s*\n\s*const \{ linkDaPasta \} = await import/)
    expect(rapido).toMatch(/catch \(err\) \{\s*\n\s*toast\.error/)
  })
})
