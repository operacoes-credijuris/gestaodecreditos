// Testes das duas trilhas do funil de Precatórios.
//
// Existem porque este é o tipo de coisa que revisão visual não pega: as abas são
// uma TABELA de rótulos e nomes de coluna do Kommo, e um nome errado não quebra
// nada — a aba simplesmente mostra zero card, para sempre, e zero card se lê
// como "não tem trabalho aqui".
//
// O vínculo com o Kommo é pelo NOME da coluna (ver SUBDIVISOES_PRECATORIO), e é
// exatamente esse vínculo que os testes exercitam: dado um espelho de kanban,
// as abas têm de casar; dado um espelho com a coluna renomeada, o desalinhamento
// tem de ser DENUNCIADO em vez de virar aba vazia.

import { describe, it, expect } from 'vitest'
import {
  FUNIL_PRECATORIO,
  FUNIL_RPV,
  SUBDIVISOES_PRECATORIO,
  abasDoFunil,
  agruparPorAba,
  colunasPrecatorioDesalinhadas,
  type EtapaKommo,
} from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'

/** As colunas do Funil Geral Precatório, como o kommo-sync as espelharia. */
const COLUNAS_KOMMO = [
  'Qualificação Jurídica Preliminar',
  'Análise Jurídica (TIER 1)',
  'Análise Econômico-Financeira (TIER 1)',
  'Revisão (TIER 1)',
  'Encaminhar ao Fundo',
  'Defesa Técnica (TIER 2+)',
  'Revisão da Defesa Técnica (TIER 2+)',
  'Diligência',
  'Reprovados Operacional',
  'Apresentação de Proposta',
  // Colunas do funil que NÃO entram em trilha nenhuma: existem no kanban do
  // comercial e não são do operacional. O saldo de cards delas é o que a linha
  // "em outras colunas do Kommo" conta.
  'Nutrição',
  'Venda ganha',
]

const espelho = (nomes: string[] = COLUNAS_KOMMO): EtapaKommo[] =>
  nomes.map((nome, i) => ({
    pipeline_id: FUNIL_PRECATORIO,
    status_id: 90000 + i,
    pipeline_nome: 'Funil Geral Precatório',
    nome,
    ordem: i,
    tipo: 0,
  }))

const idDe = (nome: string, etapas = espelho()) =>
  etapas.find((e) => e.nome === nome)!.status_id

const lead = (statusId: number, id = statusId): KommoLead =>
  ({
    kommo_lead_id: id,
    pipeline_id: FUNIL_PRECATORIO,
    status_id: statusId,
  }) as KommoLead

describe('SUBDIVISOES_PRECATORIO', () => {
  it('tem as duas trilhas, nomeadas Interno e Fundos', () => {
    expect(SUBDIVISOES_PRECATORIO.map((s) => s.key)).toEqual(['interno', 'fundos'])
    expect(SUBDIVISOES_PRECATORIO.map((s) => s.label)).toEqual(['Interno', 'Fundos'])
  })

  it('não repete chave de aba entre as trilhas', () => {
    // Chave repetida faria a aba escolhida numa trilha "casar" na outra, e a
    // tela abriria numa etapa que a pessoa não escolheu.
    const chaves = SUBDIVISOES_PRECATORIO.flatMap((s) => s.abas.map((a) => a.key))
    expect(new Set(chaves).size).toBe(chaves.length)
  })

  it('toda aba aponta para uma coluna que existe no kanban', () => {
    // O teste que pega erro de digitação no nome da coluna.
    expect(colunasPrecatorioDesalinhadas(espelho())).toEqual([])
  })
})

describe('abas do Interno', () => {
  const abas = abasDoFunil(FUNIL_PRECATORIO, espelho(), 'interno')

  it('mostra os seis rótulos da plataforma, com Aprovados antes de Diligência', () => {
    // A ordem é a DO TRABALHO, não a do kanban: Aprovados é o desfecho que se
    // busca e Diligência é o desvio.
    expect(abas.map((a) => a.label)).toEqual([
      'Due diligence + Análise Jurídica',
      'Precificação',
      'Validação',
      'Aprovados',
      'Diligência',
      'Reprovados',
    ])
  })

  it('cada rótulo resolve para a coluna certa do Kommo', () => {
    const porLabel = new Map(abas.map((a) => [a.label, a.statusIds[0]]))
    expect(porLabel.get('Due diligence + Análise Jurídica')).toBe(
      idDe('Análise Jurídica (TIER 1)'),
    )
    expect(porLabel.get('Precificação')).toBe(
      idDe('Análise Econômico-Financeira (TIER 1)'),
    )
    expect(porLabel.get('Validação')).toBe(idDe('Revisão (TIER 1)'))
    expect(porLabel.get('Aprovados')).toBe(idDe('Apresentação de Proposta'))
    expect(porLabel.get('Diligência')).toBe(idDe('Diligência'))
    expect(porLabel.get('Reprovados')).toBe(idDe('Reprovados Operacional'))
  })

  it('não oferece botão de mover', () => {
    // A kommo-mover só aceita os cinco status de RPV: botão aqui daria erro lá.
    expect(abas.every((a) => a.acoes.length === 0)).toBe(true)
  })
})

describe('abas dos Fundos', () => {
  const abas = abasDoFunil(FUNIL_PRECATORIO, espelho(), 'fundos')

  it('mostra os cinco rótulos da plataforma, na ordem da trilha', () => {
    expect(abas.map((a) => a.label)).toEqual([
      'Qualificação Preliminar',
      'Encaminhar',
      'Elaboração da Defesa Técnica',
      'Validação',
      'Apresentação',
    ])
  })

  it('cada rótulo resolve para a coluna certa do Kommo', () => {
    const porLabel = new Map(abas.map((a) => [a.label, a.statusIds[0]]))
    expect(porLabel.get('Qualificação Preliminar')).toBe(
      idDe('Qualificação Jurídica Preliminar'),
    )
    expect(porLabel.get('Encaminhar')).toBe(idDe('Encaminhar ao Fundo'))
    expect(porLabel.get('Elaboração da Defesa Técnica')).toBe(
      idDe('Defesa Técnica (TIER 2+)'),
    )
    expect(porLabel.get('Validação')).toBe(idDe('Revisão da Defesa Técnica (TIER 2+)'))
    expect(porLabel.get('Apresentação')).toBe(idDe('Apresentação de Proposta'))
  })
})

describe('Apresentação de Proposta serve às duas trilhas', () => {
  it('é a MESMA coluna do Kommo, com rótulo diferente em cada', () => {
    // Decisão confirmada pelo dono, e não descuido de cópia: um card ali aparece
    // nas duas trilhas. Se um dia isso mudar, é este teste que cai — e o rótulo
    // duplo deixa de ser intencional.
    const interno = abasDoFunil(FUNIL_PRECATORIO, espelho(), 'interno')
    const fundos = abasDoFunil(FUNIL_PRECATORIO, espelho(), 'fundos')
    const aprovados = interno.find((a) => a.label === 'Aprovados')!
    const apresentacao = fundos.find((a) => a.label === 'Apresentação')!
    expect(aprovados.statusIds).toEqual(apresentacao.statusIds)
  })
})

describe('coluna renomeada no Kommo', () => {
  // O modo de falha do vínculo por nome, e o que impede que ele passe calado.
  const renomeado = espelho(
    COLUNAS_KOMMO.map((n) => (n === 'Revisão (TIER 1)' ? 'Revisão TIER 1' : n)),
  )

  it('é denunciada, com o nome que se esperava', () => {
    const faltando = colunasPrecatorioDesalinhadas(renomeado, 'interno')
    expect(faltando.map((a) => a.colunaKommo)).toEqual(['Revisão (TIER 1)'])
    expect(faltando.map((a) => a.label)).toEqual(['Validação'])
  })

  it('deixa a aba na tela, vazia, em vez de sumir com ela', () => {
    // Sumir com a aba esconderia o defeito: a pessoa veria cinco abas onde a
    // regra diz seis e não teria como saber qual faltou.
    const abas = abasDoFunil(FUNIL_PRECATORIO, renomeado, 'interno')
    expect(abas).toHaveLength(6)
    expect(abas.find((a) => a.label === 'Validação')!.statusIds).toEqual([])
  })

  it('não acusa nada quando o espelho ainda não chegou', () => {
    // Espelho vazio é "não sei ainda", não "está errado".
    expect(colunasPrecatorioDesalinhadas([])).toEqual([])
  })
})

describe('acento, caixa e espaço não quebram o casamento', () => {
  it('casa a coluna escrita sem acento e em caixa alta', () => {
    const torto = espelho(
      COLUNAS_KOMMO.map((n) =>
        n === 'Análise Jurídica (TIER 1)' ? 'ANALISE  JURIDICA (TIER 1)' : n,
      ),
    )
    expect(colunasPrecatorioDesalinhadas(torto, 'interno')).toEqual([])
  })
})

describe('saldo de cards fora das trilhas', () => {
  it('cards de coluna não listada ficam de fora das abas, e são contados', () => {
    // A rede que substituiu a aba "Outras etapas": o card não entra em aba
    // nenhuma, mas também não desaparece da contagem.
    const etapas = espelho()
    const abas = abasDoFunil(FUNIL_PRECATORIO, etapas, 'interno')
    const { porAba, outras } = agruparPorAba(
      [
        lead(idDe('Análise Jurídica (TIER 1)', etapas), 1),
        lead(idDe('Nutrição', etapas), 2),
        lead(idDe('Venda ganha', etapas), 3),
      ],
      abas,
    )
    expect(porAba['int-due-diligence'].map((l) => l.kommo_lead_id)).toEqual([1])
    expect(outras.map((l) => l.kommo_lead_id)).toEqual([2, 3])
  })
})

describe('RPV não é afetado pela subdivisão', () => {
  it('devolve as cinco telas curadas, com os botões de mover', () => {
    // A subdivisão é um eixo só do Precatório. Passá-la aqui não pode mudar nada.
    const abas = abasDoFunil(FUNIL_RPV, espelho(), 'fundos')
    expect(abas.map((a) => a.label)).toEqual([
      'Pendentes',
      'Validação',
      'Aprovados',
      'Diligência',
      'Reprovados',
    ])
    expect(abas.find((a) => a.label === 'Validação')!.acoes).toHaveLength(3)
  })
})
