/**
 * A PASTA DA ANÁLISE NO DRIVE — a regra que as certidões e a planilha jurídica
 * seguem para gravar arquivos (_shared/pastaDaAnalise.ts).
 *
 * O defeito de 03/10/2026: as certidões recalculavam a pasta sempre em
 * "Precatórios", pelo nome do título, e gravavam essa pasta no card — no RPV,
 * por cima do atalho da análise. Estes testes prendem as três frases da regra:
 * a do card primeiro; calculada só na falta, pela categoria do funil; e o card
 * nunca reescrito.
 */
import { describe, it, expect } from 'vitest'
import {
  CATEGORIA_PRECATORIOS,
  CATEGORIA_RPV,
  categoriaDoFunil,
  escolherPastaDaAnalise,
  nomeDaPastaDoCedente,
  nomeDaPastaDoOriginador,
  pastaGravada,
  tituloNome,
  urlDaPasta,
} from '../../../supabase/functions/_shared/pastaDaAnalise.ts'
import { FUNIL_RPV } from '../../../supabase/functions/_shared/autosParaOKommo.ts'
import {
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
} from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'

describe('escolherPastaDaAnalise: a do card vence a calculada', () => {
  it('card com pasta que existe: usa a do card, e não grava nada', () => {
    expect(escolherPastaDaAnalise({ pastaDoCard: 'abc123', pastaDoCardExiste: true })).toEqual({
      usar: 'card',
      pastaId: 'abc123',
      gravarNoCard: false,
    })
  })

  it('card sem pasta: calcula, e a calculada pode ir para o card', () => {
    expect(escolherPastaDaAnalise({ pastaDoCard: null, pastaDoCardExiste: null })).toEqual({
      usar: 'calcular',
      motivo: 'sem_pasta',
      gravarNoCard: true,
    })
  })

  it('texto vazio no card conta como "sem pasta"', () => {
    expect(escolherPastaDaAnalise({ pastaDoCard: '   ', pastaDoCardExiste: null })).toMatchObject({
      usar: 'calcular',
      gravarNoCard: true,
    })
  })

  it('pasta do card sumiu do Drive: calcula, mas NÃO reescreve o card', () => {
    expect(escolherPastaDaAnalise({ pastaDoCard: 'abc123', pastaDoCardExiste: false })).toEqual({
      usar: 'calcular',
      motivo: 'pasta_sumiu',
      gravarNoCard: false,
    })
  })

  it('não deu para conferir (null): fica a do card — dúvida não é "sumiu"', () => {
    expect(escolherPastaDaAnalise({ pastaDoCard: 'abc123', pastaDoCardExiste: null })).toEqual({
      usar: 'card',
      pastaId: 'abc123',
      gravarNoCard: false,
    })
  })

  it('nunca há caminho em que uma pasta gravada seja trocada por outra', () => {
    for (const existe of [true, false, null]) {
      const e = escolherPastaDaAnalise({ pastaDoCard: 'gravada', pastaDoCardExiste: existe })
      expect(e.gravarNoCard).toBe(false)
    }
  })
})

describe('categoriaDoFunil: a categoria vem do funil, não do texto', () => {
  it('RPV vai para "Requisições de Pequeno Valor"', () => {
    expect(categoriaDoFunil(FUNIL_RPV)).toBe(CATEGORIA_RPV)
  })

  it('as duas trilhas do precatório (e o funil antigo) vão para "Precatórios"', () => {
    expect(categoriaDoFunil(FUNIL_PRECATORIO_INTERNO)).toBe(CATEGORIA_PRECATORIOS)
    expect(categoriaDoFunil(FUNIL_PRECATORIO_EXTERNO)).toBe(CATEGORIA_PRECATORIOS)
    expect(categoriaDoFunil(13971995)).toBe(CATEGORIA_PRECATORIOS)
  })

  it('funil desconhecido fica em "Precatórios" (era a categoria de todo card antes)', () => {
    expect(categoriaDoFunil(null)).toBe(CATEGORIA_PRECATORIOS)
    expect(categoriaDoFunil(0)).toBe(CATEGORIA_PRECATORIOS)
  })
})

describe('nomeDaPastaDoCedente: o nome como a análise da categoria o escreve', () => {
  it('RPV: Title Case com conectores minúsculos (o da gerar-analise-rpv)', () => {
    expect(nomeDaPastaDoCedente(CATEGORIA_RPV, 'VANDERLAN GOMES DE MORAIS')).toBe('Vanderlan Gomes de Morais')
    expect(nomeDaPastaDoCedente(CATEGORIA_RPV, '')).toBe('Cedente')
    expect(nomeDaPastaDoCedente(CATEGORIA_RPV, 'a'.repeat(100))).toHaveLength(80)
  })

  it('Precatórios: como veio, aparado (o da planilha jurídica)', () => {
    expect(nomeDaPastaDoCedente(CATEGORIA_PRECATORIOS, '  MARIA DA SILVA ')).toBe('MARIA DA SILVA')
    expect(nomeDaPastaDoCedente(CATEGORIA_PRECATORIOS, null)).toBe('Sem cedente')
  })

  it('originador aparado, com reserva', () => {
    expect(nomeDaPastaDoOriginador(' CMR Advogados ')).toBe('CMR Advogados')
    expect(nomeDaPastaDoOriginador('   ')).toBe('Sem originador')
  })
})

describe('auxiliares', () => {
  it('tituloNome mantém o primeiro conector em maiúscula', () => {
    expect(tituloNome('de souza e silva')).toBe('De Souza e Silva')
  })
  it('pastaGravada', () => {
    expect(pastaGravada(' x ')).toBe('x')
    expect(pastaGravada(undefined)).toBeNull()
  })
  it('urlDaPasta', () => {
    expect(urlDaPasta('abc')).toBe('https://drive.google.com/drive/folders/abc')
  })
})
