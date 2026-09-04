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
  ABA_JURIDICO,
  FUNIL_PRECATORIO,
  FUNIL_RPV,
  SUBDIVISOES_PRECATORIO,
  ST_ANALISE,
  ST_DECISAO,
  ST_DILIGENCIA,
  ST_PROPOSTA,
  ST_REPROVADO,
  abasDoFunil,
  agruparPorAba,
  colunasPrecatorioDesalinhadas,
  statusExibidos,
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
      'Jurídico',
      'Precificação',
      'Validação',
      'Aprovados',
      'Diligência',
      'Reprovados',
    ])
  })

  it('cada rótulo resolve para a coluna certa do Kommo', () => {
    const porLabel = new Map(abas.map((a) => [a.label, a.statusIds[0]]))
    expect(porLabel.get('Jurídico')).toBe(idDe('Análise Jurídica (TIER 1)'))
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
      'Defesa Técnica',
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
    expect(porLabel.get('Defesa Técnica')).toBe(idDe('Defesa Técnica (TIER 2+)'))
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

describe('cards fora das trilhas', () => {
  it('não entram em aba nenhuma, e nem se misturam na primeira', () => {
    // A tela não exibe mais esse saldo (nem aba, nem linha de contagem). O que
    // este teste garante é o particionamento: card de coluna que não é do
    // operacional fica FORA das abas, e não encostado na primeira delas.
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
    expect(porAba[ABA_JURIDICO].map((l) => l.kommo_lead_id)).toEqual([1])
    expect(outras.map((l) => l.kommo_lead_id)).toEqual([2, 3])
  })
})

describe('statusExibidos — o número ao lado do tipo de crédito', () => {
  it('no Precatório, é a UNIÃO das duas trilhas, não a trilha aberta', () => {
    // O número descreve o FUNIL: trocar de destinação não muda quantos
    // precatórios existem. Se mudasse, se leria como dado mudando.
    const etapas = espelho()
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    // 10 colunas listadas, mas Apresentação de Proposta serve às duas trilhas:
    // 6 do Interno + 5 dos Fundos = 11 abas sobre 10 colunas distintas.
    expect(ids.size).toBe(10)
    for (const nome of COLUNAS_KOMMO.slice(0, 10)) {
      expect(ids.has(idDe(nome, etapas))).toBe(true)
    }
  })

  it('não inclui coluna do kanban que não é do operacional', () => {
    // É o defeito que o número antigo tinha: contava o funil inteiro, então o
    // total de cima nunca fechava com a soma das pílulas de baixo.
    const etapas = espelho()
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    expect(ids.has(idDe('Nutrição', etapas))).toBe(false)
    expect(ids.has(idDe('Venda ganha', etapas))).toBe(false)
  })

  it('a soma das pílulas fecha com o número do tipo de crédito', () => {
    // A invariante que o usuário vê: o número de cima é a soma dos de baixo.
    // Vale por trilha porque cada card só cai numa aba de cada trilha.
    const etapas = espelho()
    const leads = [
      lead(idDe('Análise Jurídica (TIER 1)', etapas), 1),
      lead(idDe('Revisão (TIER 1)', etapas), 2),
      lead(idDe('Apresentação de Proposta', etapas), 3),
      lead(idDe('Defesa Técnica (TIER 2+)', etapas), 4),
      lead(idDe('Nutrição', etapas), 5), // fora das trilhas: não conta
    ]
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    const doTipo = leads.filter((l) => ids.has(l.status_id)).length
    expect(doTipo).toBe(4)

    const somaDe = (sub: 'interno' | 'fundos') => {
      const { porAba } = agruparPorAba(
        leads,
        abasDoFunil(FUNIL_PRECATORIO, etapas, sub),
      )
      return Object.values(porAba).reduce((t, l) => t + l.length, 0)
    }
    // Interno vê 3 (jurídica, revisão, proposta); Fundos vê 2 (defesa,
    // proposta). A proposta entra nas duas, e é por isso que a soma por trilha
    // não bate isolada — só a união bate, que é o que o número de cima usa.
    expect(somaDe('interno')).toBe(3)
    expect(somaDe('fundos')).toBe(2)
  })

  it('em RPV, são os cinco status curados', () => {
    expect(statusExibidos(FUNIL_RPV, espelho())).toEqual(
      new Set([ST_ANALISE, ST_DECISAO, ST_PROPOSTA, ST_DILIGENCIA, ST_REPROVADO]),
    )
  })

  it('devolve vazio para funil desconhecido', () => {
    expect(statusExibidos(999, espelho()).size).toBe(0)
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
