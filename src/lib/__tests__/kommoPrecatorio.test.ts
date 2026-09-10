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
  ABA_FUNDOS_COMPARTILHADA,
  acaoDeReprovar,
  ehCardDeFundos,
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

  // OS DOIS DESFECHOS QUE INTERROMPEM, e só eles. "Aprovar" continua fora: qual
  // coluna significa aprovado no Precatório ninguém definiu, e adivinhar seria
  // mover card de verdade com base em palpite.
  it('as abas de trabalho oferecem diligência e reprovação', () => {
    for (const label of ['Jurídico', 'Precificação', 'Validação']) {
      const aba = abas.find((a) => a.label === label)!
      expect(aba.acoes.map((x) => x.papel), label).toEqual(['diligenciar', 'reprovar'])
      expect(aba.acoes.find((x) => x.papel === 'reprovar')!.statusId, label).toBe(
        idDe('Reprovados Operacional'),
      )
      expect(aba.acoes.find((x) => x.papel === 'diligenciar')!.statusId, label).toBe(
        idDe('Diligência'),
      )
    }
  })

  // Das terminais o card não volta pelo app: de Aprovados e Reprovados não se
  // sai, e a diligência quem devolve é o comercial, pelo Kommo.
  it('as abas terminais não oferecem desfecho', () => {
    for (const label of ['Aprovados', 'Diligência', 'Reprovados']) {
      expect(abas.find((a) => a.label === label)!.acoes, label).toEqual([])
    }
  })

  // O ID VEM DO ESPELHO, e coluna que ele não tem não vira botão: melhor a aba
  // sem desfecho do que um botão que move o card para lugar nenhum.
  it('sem a coluna no kanban, o botão não aparece', () => {
    const semReprovados = espelho(COLUNAS_KOMMO.filter((n) => n !== 'Reprovados Operacional'))
    const juridico = abasDoFunil(FUNIL_PRECATORIO, semReprovados, 'interno').find(
      (a) => a.label === 'Jurídico',
    )!
    expect(juridico.acoes.map((x) => x.papel)).toEqual(['diligenciar'])
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

describe('ehCardDeFundos', () => {
  /**
   * A DESTINAÇÃO SAI DO CARD, não da pílula aberta.
   *
   * A subdivisão é um recorte da TELA. Se a due diligence perguntasse a ela,
   * alternar Interno/Fundos atrás de uma janela aberta trocaria as frentes da
   * diligência em curso — a aba de certidões aparecendo e sumindo enquanto
   * alguém preenche o formulário. Quem responde é o status_id.
   */
  it('coluna que só existe nos Fundos é card de fundo', () => {
    for (const coluna of [
      'Qualificação Jurídica Preliminar',
      'Encaminhar ao Fundo',
      'Defesa Técnica (TIER 2+)',
      'Revisão da Defesa Técnica (TIER 2+)',
    ]) {
      expect(ehCardDeFundos(idDe(coluna), espelho()), coluna).toBe(true)
    }
  })

  it('coluna do Interno não é', () => {
    for (const coluna of [
      'Análise Jurídica (TIER 1)',
      'Análise Econômico-Financeira (TIER 1)',
      'Revisão (TIER 1)',
      'Diligência',
      'Reprovados Operacional',
    ]) {
      expect(ehCardDeFundos(idDe(coluna), espelho()), coluna).toBe(false)
    }
  })

  // "APRESENTAÇÃO DE PROPOSTA" É A MESMA COLUNA nas duas trilhas — "Aprovados"
  // no Interno, "Apresentação" nos Fundos. Dela não se sabe a destinação, então
  // ela conta como Interno: é o comportamento que já valia, e é por isso que
  // aquela aba não oferece botão em trilha nenhuma.
  it('a coluna compartilhada não é tratada como de fundo', () => {
    expect(ehCardDeFundos(idDe('Apresentação de Proposta'), espelho())).toBe(false)
  })

  it('coluna fora das trilhas, e espelho vazio, não são de fundo', () => {
    expect(ehCardDeFundos(idDe('Nutrição'), espelho())).toBe(false)
    expect(ehCardDeFundos(90000, [])).toBe(false)
  })

  // A aba compartilhada é nomeada em kommo.ts para a tela poder excluí-la dos
  // botões; se a chave mudar lá e não aqui, o botão reaparece na aba errada.
  it('ABA_FUNDOS_COMPARTILHADA aponta para a aba da coluna compartilhada', () => {
    const fundos = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'fundos')!
    const aba = fundos.abas.find((a) => a.key === ABA_FUNDOS_COMPARTILHADA)
    expect(aba?.colunaKommo).toBe('Apresentação de Proposta')
  })
})

describe('acaoDeReprovar', () => {
  /**
   * A RECUSA DA JANELA DE DUE DILIGENCE não segue o mapa das etapas.
   *
   * As ações de uma aba são as saídas daquela ETAPA: existem onde o trabalho
   * acontece e somem nas terminais. A recusa por diligência nasce do que a
   * apuração achou, e a apuração pode acontecer em qualquer card — inclusive na
   * trilha dos Fundos, que não tem desfecho nenhum e deixava a janela achando
   * execução contra o cedente sem oferecer como recusar.
   */
  it('no precatório, resolve a coluna pelo nome no espelho', () => {
    const a = acaoDeReprovar(FUNIL_PRECATORIO, espelho())
    expect(a?.statusId).toBe(idDe('Reprovados Operacional'))
    expect(a?.papel).toBe('reprovar')
  })

  it('em RPV, é a constante de sempre', () => {
    expect(acaoDeReprovar(FUNIL_RPV, espelho())?.statusId).toBe(ST_REPROVADO)
  })

  // Sem a coluna no espelho não há botão: melhor a janela sem recusa do que um
  // botão que move o card para lugar nenhum.
  it('sem a coluna no kanban, não há ação', () => {
    const sem = espelho(COLUNAS_KOMMO.filter((n) => n !== 'Reprovados Operacional'))
    expect(acaoDeReprovar(FUNIL_PRECATORIO, sem)).toBeNull()
    expect(acaoDeReprovar(FUNIL_PRECATORIO, [])).toBeNull()
  })

  it('funil que não é do operacional não tem recusa', () => {
    expect(acaoDeReprovar(999, espelho())).toBeNull()
  })
})
