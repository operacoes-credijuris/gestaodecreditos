// AS PROPOSTAS CADASTRADAS NO CARD (pedido do dono, 07/10/2026): o indicador "3
// propostas" da Produção de proposta e da Negociação, e a lista só de leitura
// que ele abre. Ver `src/lib/propostasDoCard.ts`.
//
// O QUE SE PRENDE AQUI: o que conta como proposta (para o número e para a
// lista), a ordem dos fundos (a de `FUNDOS_DA_PRECIFICACAO`, a mesma da
// "Escolher proposta") e as colunas em que o indicador aparece — pelas abas que
// a tela monta de verdade, nos três funis.

import { describe, it, expect } from 'vitest'
import {
  COLUNAS_QUE_MOSTRAM_AS_PROPOSTAS,
  linhasDasCotacoes,
  mostraAsPropostas,
  propostasCadastradas,
  rotuloDaComissao,
  rotuloDasPropostas,
  situacaoDoFundo,
} from '@/lib/propostasDoCard'
import {
  abasDoFunil,
  FUNDOS_DA_PRECIFICACAO,
  FUNIL_PRECATORIO,
  FUNIL_RPV,
  type SubdivisaoPrecatorio,
} from '@/lib/kommo'
import { espelhoDosTresFunis } from './fixtures/kanbans'

const campo = (nome: string, valor: unknown) => ({
  field_id: nome.length,
  field_name: nome,
  field_type: 'text',
  values: [{ value: valor }],
})
const card = (campos: ReturnType<typeof campo>[], tags: string[] = [], tags_em: Record<string, string> = {}) => ({
  tags,
  tags_em,
  raw: { custom_fields_values: campos },
})

describe('propostasCadastradas — o que conta como proposta', () => {
  const c = card([
    campo('PJUS', 'R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)'),
    campo('BTG', 'R$ 850.000,00 / R$ 40.000,00'),
    campo('PX Ativos', 'R$ 1.234.567,89 / Spread'),
    campo('Invest Precatórios', 'aguardando o comitê de quinta'),
    campo('K & WC Ativos', ''),
    campo('Precatur', '—'),
    campo('Carbon', '   '),
  ])

  it('o campo com valor legível e o escrito à mão contam; vazio, "—" e espaços, não', () => {
    expect(propostasCadastradas(c).map((l) => l.fundo)).toEqual(['PJus', 'BTG', 'PX Ativos', 'Invest Precatórios'])
  })

  it('o escrito à mão vem como está, sem valor (a tela o mostra cortado, com o texto na dica)', () => {
    const mao = propostasCadastradas(c).find((l) => l.fundo === 'Invest Precatórios')!
    expect(mao.cotacao).toEqual({ texto: 'aguardando o comitê de quinta', proposta: null, comissao: null })
  })

  it('os três formatos leem a proposta e a comissão', () => {
    const [pjus, btg, px] = propostasCadastradas(c)
    expect(pjus.cotacao).toMatchObject({ proposta: 80_750_000, comissao: { modalidade: 'spread', centavos: 4_250_000 } })
    expect(btg.cotacao).toMatchObject({ proposta: 85_000_000, comissao: { modalidade: 'limitada', centavos: 4_000_000 } })
    expect(px.cotacao).toMatchObject({ proposta: 123_456_789, comissao: { modalidade: 'spread' } })
  })

  it('card sem campos, ou sem `raw`, não tem proposta (e o indicador não aparece)', () => {
    expect(propostasCadastradas(card([]))).toEqual([])
    expect(propostasCadastradas({ tags: [], tags_em: null, raw: null })).toEqual([])
  })

  it('campo que não é de fundo não conta', () => {
    expect(propostasCadastradas(card([campo('Valor da causa', 'R$ 1.000.000,00')]))).toEqual([])
  })
})

describe('a ordem dos fundos', () => {
  it('é a de FUNDOS_DA_PRECIFICACAO, qualquer que seja a ordem dos campos no card', () => {
    const c = card([
      campo('Carbon', 'R$ 10,00 / R$ 1,00'),
      campo('PX Ativos', 'R$ 30,00 / R$ 3,00'),
      campo('PJus', 'R$ 20,00 / R$ 2,00'),
    ])
    expect(propostasCadastradas(c).map((l) => l.fundo)).toEqual(['PJus', 'PX Ativos', 'Carbon'])
  })

  it('a "Escolher proposta" usa as mesmas linhas, com todos os fundos (sem valor = null)', () => {
    const linhas = linhasDasCotacoes(card([campo('BTG', 'R$ 850.000,00 / R$ 40.000,00')]))
    expect(linhas.map((l) => l.fundo)).toEqual([...FUNDOS_DA_PRECIFICACAO])
    expect(linhas.filter((l) => l.cotacao !== null).map((l) => l.fundo)).toEqual(['BTG'])
  })
})

describe('a etiqueta e o tempo de cada fundo', () => {
  it('o ato da etiqueta que o card tem, e desde quando (grafia do Kommo à parte)', () => {
    const c = card([], ['Cotado PJUS', 'Reprovado Carbon'], { 'Cotado PJUS': '2026-10-05T12:00:00Z' })
    expect(situacaoDoFundo(c, 'PJus')).toEqual({ ato: 'Cotado', desde: '2026-10-05T12:00:00Z' })
    expect(situacaoDoFundo(c, 'Carbon')).toEqual({ ato: 'Reprovado', desde: null })
    expect(situacaoDoFundo(c, 'BTG')).toBeNull()
  })

  it('vai junto na linha da proposta', () => {
    const c = card([campo('PJus', 'R$ 20,00 / R$ 2,00')], ['Cotado PJus'], { 'Cotado PJus': '2026-10-06T09:00:00Z' })
    expect(propostasCadastradas(c)[0].situacao).toEqual({ ato: 'Cotado', desde: '2026-10-06T09:00:00Z' })
  })
})

describe('o número', () => {
  it('"1 proposta", "3 propostas"', () => {
    expect(rotuloDasPropostas(1)).toBe('1 proposta')
    expect(rotuloDasPropostas(3)).toBe('3 propostas')
  })
})

describe('a linha da comissão (a mesma nas duas caixas)', () => {
  it('limitada, spread novo, spread antigo, sem comissão', () => {
    expect(rotuloDaComissao({ modalidade: 'limitada', centavos: 4_000_000 })).toEqual({ texto: 'Comissão R$ 40.000,00' })
    expect(rotuloDaComissao({ modalidade: 'spread', centavos: 4_250_000, percentualCentesimos: 500 })).toEqual({
      texto: 'Comissão R$ 42.500,00',
      detalhe: '(spread 5%)',
    })
    expect(rotuloDaComissao({ modalidade: 'spread' })).toEqual({ texto: 'Comissão em spread' })
    expect(rotuloDaComissao(null)).toEqual({ texto: 'Comissão —' })
  })
})

describe('as colunas em que o indicador aparece', () => {
  it('as seis: Produção de proposta e Negociação dos três funis', () => {
    expect([...COLUNAS_QUE_MOSTRAM_AS_PROPOSTAS.keys()].sort()).toEqual(
      [107830035, 107830039, 111533948, 111533988, 112339984, 112466260].sort(),
    )
  })

  const COMBINACOES: [string, number, SubdivisaoPrecatorio][] = [
    ['RPV', FUNIL_RPV, 'interno'],
    ['Precatório interno', FUNIL_PRECATORIO, 'interno'],
    ['Precatório externo', FUNIL_PRECATORIO, 'externo'],
  ]
  for (const [nome, funil, trilha] of COMBINACOES) {
    it(`${nome}: só nas abas Produção de proposta e Negociação (das abas que a tela monta)`, () => {
      const abas = abasDoFunil(funil, espelhoDosTresFunis(), trilha)
      const com = abas.filter((a) => mostraAsPropostas(a.statusIds)).map((a) => a.label.toLocaleLowerCase('pt-BR'))
      expect(com).toEqual(['produção de proposta', 'negociação'])
    })
  }

  it('a Em precificação (onde está a "Escolher proposta") não ganha o indicador', () => {
    const ext = abasDoFunil(FUNIL_PRECATORIO, espelhoDosTresFunis(), 'externo')
    const precificacao = ext.find((a) => a.key === 'ext-precificacao')!
    expect(precificacao.escolhaDeProposta).toBeTruthy()
    expect(mostraAsPropostas(precificacao.statusIds)).toBe(false)
  })

  it('aba sem status (ou nenhuma aba) não mostra', () => {
    expect(mostraAsPropostas([])).toBe(false)
    expect(mostraAsPropostas(undefined)).toBe(false)
  })
})
