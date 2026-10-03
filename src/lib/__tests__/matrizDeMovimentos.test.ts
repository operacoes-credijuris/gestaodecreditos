// Testes de caracterização: PARA ONDE CADA BOTÃO DA ANÁLISE DE CRÉDITO MOVE O
// CARD, e para onde o servidor aceita que ele seja movido.
//
// MOVER CARD NO KOMMO NÃO SE DESFAZ: dispara as automações do funil (o Digital
// Pipeline), e a volta é à mão, com as automações disparando de novo. Por isso
// cada saída que a tela oferece está escrita aqui por extenso — rótulo, coluna
// de destino e papel —, aba por aba, como ela é HOJE.
//
// AS LISTAS DE PERMISSÃO DO SERVIDOR TAMBÉM ESTÃO ESCRITAS POR EXTENSO, e não
// lidas da definição, DE PROPÓSITO. A `kommo-mover` recusa o destino que não
// está nelas; elas saem de `idsDestinoDaTrilha`/`destinosDaTrilha`
// (`_shared/trilhasDoPrecatorio.ts`) no Precatório e de `COLUNAS`
// (`_shared/colunasRpv.ts`) no RPV. A tela e o servidor leem a MESMA definição
// — então um destino novo aparece nos dois ao mesmo tempo, para todo mundo, e
// nenhum teste derivado dela perceberia. ESTE ARQUIVO PERCEBE: todo destino novo
// obriga a mudar as listas daqui, e quem muda sabe que está mudando.

import { describe, it, expect } from 'vitest'
import {
  abasDoFunil,
  acaoDeReprovar,
  botoesDaAba,
  FUNIL_PRECATORIO,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
  FUNIL_RPV,
  SUBDIVISOES_PRECATORIO,
  TELAS,
  telasRpvDesalinhadas,
  type Aba,
  type SubdivisaoPrecatorio,
} from '@/lib/kommo'
import {
  destinosDaTrilha,
  idsDestinoDaTrilha,
} from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import { COLUNAS } from '../../../supabase/functions/_shared/colunasRpv.ts'
import { espelhoDosTresFunis, KANBAN_RPV } from './fixtures/kanbans'

/** [rótulo, coluna de destino, papel]. */
type Movimento = readonly [string, number, string]

/**
 * TODO MOVIMENTO QUE A TELA OFERECE NUMA ABA, e não só os desfechos.
 *
 * Os desfechos (`acoes`) saem com o papel deles. Os três fluxos próprios da
 * trilha — que movem o card mas não são botão genérico — saem com o nome do
 * campo no lugar do papel, e o rótulo é o do botão na tela:
 *   escolhaDeProposta  "Escolher proposta" (BotaoEscolherProposta)
 *   anexarEMover       o `rotulo` da trilha (BotaoAnexarEMover)
 *   envioAosFundos     "Mover para Em precificação" (ChecksDosFundos), que
 *                      também move sozinho quando o último fundo é marcado
 */
const movimentosDaAba = (a: Aba): Movimento[] => [
  ...a.acoes.map((x): Movimento => [x.label, x.statusId, x.papel]),
  ...(a.escolhaDeProposta ? [['Escolher proposta', a.escolhaDeProposta, 'escolhaDeProposta'] as const] : []),
  ...(a.anexarEMover ? [[a.anexarEMover.rotulo, a.anexarEMover.statusId, 'anexarEMover'] as const] : []),
  ...(a.envioAosFundos
    ? [['Mover para Em precificação', a.envioAosFundos.destino, 'envioAosFundos'] as const]
    : []),
]

const FUNIS = { RPV: FUNIL_RPV, Precatório: FUNIL_PRECATORIO } as const
type NomeDoFunil = keyof typeof FUNIS

const COMBINACOES: [NomeDoFunil, SubdivisaoPrecatorio][] = [
  ['RPV', 'interno'],
  ['RPV', 'externo'],
  ['Precatório', 'interno'],
  ['Precatório', 'externo'],
]

/** O que a tela oferece em cada aba, na ordem das abas e dos botões. */
const daTela = (funil: NomeDoFunil, trilha: SubdivisaoPrecatorio): [string, Movimento[]][] =>
  abasDoFunil(FUNIS[funil], espelhoDosTresFunis(), trilha).map((a) => [a.key, movimentosDaAba(a)])

// ---------- O que a tela oferece, aba por aba ----------

/**
 * O RPV, com as constantes ST_*. "Enviar para revisão" é `validar`: passa adiante
 * sem decidir o mérito. Os desfechos de 'pendentes' moram na janela da análise
 * de RPV, e os de 'validacao' no card — a tela decide onde, o destino é o mesmo.
 *
 * MUDOU DE PROPÓSITO NA ETAPA 7 DO REDESENHO (02/10/2026): o RPV passou a
 * espelhar o kanban inteiro, na ordem do Kommo, e as nove colunas novas entram
 * como `col-<id>`, SÓ PARA LEITURA — nenhuma move nada. Os movimentos de antes
 * são exatamente os mesmos; só a ordem das abas segue o kanban.
 */
const MOVIMENTOS_RPV: [string, Movimento[]][] = [
  [
    'pendentes',
    [
      ['Enviar para revisão', 107272807, 'validar'],
      ['Exigir diligência', 107830027, 'diligenciar'],
      ['Reprovar crédito', 107830031, 'reprovar'],
    ],
  ],
  [
    'validacao',
    [
      ['Aprovar', 107830035, 'aprovar'],
      ['Diligência', 107830027, 'diligenciar'],
      ['Reprovar', 107830031, 'reprovar'],
    ],
  ],
  ['diligencia', []],
  ['aprovados', []],
  ['col-107830039', []],
  ['col-107830043', []],
  ['col-107830047', []],
  ['col-107830051', []],
  ['col-107830055', []],
  ['protocolo', []],
  ['col-107830063', []],
  ['reprovados', []],
  ['col-107272811', []],
  ['col-112466388', []],
  ['col-107830067', []],
]

/**
 * O INTERNO. As duas abas de decisão saem pelo "Concluir" (desfecho agrupado);
 * diligência e recusa são da trilha e vêm depois das saídas da etapa.
 */
const MOVIMENTOS_INTERNO: [string, Movimento[]][] = [
  [
    'int-analise',
    [
      ['Enviar para revisão', 111533944, 'aprovar'],
      ['Exigir diligência', 111533960, 'diligenciar'],
      ['Reprovar crédito', 111534108, 'reprovar'],
    ],
  ],
  [
    'int-revisao',
    [
      ['Aprovar crédito', 111533948, 'aprovar'],
      ['Exigir diligência', 111533960, 'diligenciar'],
      ['Reprovar crédito', 111534108, 'reprovar'],
    ],
  ],
  // DESDE A ONDA 2 (02/10/2026, só na beta) o Interno mostra o kanban inteiro,
  // na ordem do Kommo: as colunas novas são `col-<id>`, só leitura, e não movem
  // nada. Os movimentos de antes são exatamente os mesmos.
  ['int-diligencia', []],
  ['int-aprovados', []],
  ['col-112466260', []],
  ['col-111533952', []],
  ['col-112466032', []],
  ['col-111533956', []],
  ['int-protocolo', []],
  ['col-112466340', []],
  ['int-reprovados', []],
  ['col-112465960', []],
  ['col-112382612', []],
]

/** O EXTERNO, na ordem do kanban; as `col-*` são só leitura e não movem nada. */
const MOVIMENTOS_EXTERNO: [string, Movimento[]][] = [
  // A QUALIFICAÇÃO SÓ ENCAMINHA (`interrompe: false`): recusa e diligência
  // passam pela revisão.
  ['ext-qualificacao', [['Enviar para revisão', 111533972, 'aprovar']]],
  [
    'ext-revisao',
    [
      ['Aprovar crédito', 111533980, 'aprovar'],
      ['Pedir memorando', 111533976, 'validar'],
      ['Exigir diligência', 111533996, 'diligenciar'],
      ['Reprovar crédito', 111534212, 'reprovar'],
    ],
  ],
  // O SANAR DO EXTERNO é um botão próprio no card, sem diligência nem recusa.
  ['ext-diligencia', [['Sanar', 111533972, 'validar']]],
  ['ext-memorando', [['Anexar', 111533980, 'anexarEMover']]],
  ['ext-encaminhar', [['Mover para Em precificação', 111533984, 'envioAosFundos']]],
  ['ext-precificacao', [['Escolher proposta', 111533988, 'escolhaDeProposta']]],
  ['ext-apresentacao', []],
  ['col-112339984', []],
  ['ext-fechados', []],
  ['ext-documentacao', []],
  ['col-112341612', []],
  ['col-112341616', []],
  ['col-112006404', []],
  ['ext-reprovados', []],
  ['col-111985976', []],
]

describe('matriz de movimentos — o que cada aba oferece', () => {
  it('RPV: o mesmo nas duas trilhas, que o RPV ignora', () => {
    expect(daTela('RPV', 'interno')).toEqual(MOVIMENTOS_RPV)
    expect(daTela('RPV', 'externo')).toEqual(MOVIMENTOS_RPV)
  })

  it('Precatório Interno', () => {
    expect(daTela('Precatório', 'interno')).toEqual(MOVIMENTOS_INTERNO)
  })

  it('Precatório Externo', () => {
    expect(daTela('Precatório', 'externo')).toEqual(MOVIMENTOS_EXTERNO)
  })

  /**
   * TODA SAÍDA PRECISA DE UMA PORTA NA TELA. O "Concluir" do desfecho agrupado
   * mora na fileira de trabalho, e ela só aparece com 'dd' (ver o CardCredito em
   * AnaliseCredito.tsx). Aba agrupada sem 'dd' teria saídas que ninguém aciona
   * — foi o que a Revisão do Interno viveu antes de 28/09/2026.
   */
  it("toda aba de desfecho agrupado é aba com 'dd'", () => {
    let agrupadas = 0
    for (const [funil, trilha] of COMBINACOES) {
      for (const a of abasDoFunil(FUNIS[funil], espelhoDosTresFunis(), trilha)) {
        if (!a.desfechoAgrupado || a.acoes.length === 0) continue
        agrupadas++
        expect(botoesDaAba(FUNIS[funil], trilha, a), `${funil} · ${trilha} · ${a.label}`).toBe('dd')
      }
    }
    // int-analise, int-revisao, ext-qualificacao, ext-revisao.
    expect(agrupadas).toBe(4)
  })
})

/**
 * A RECUSA DA JANELA DE DUE DILIGENCE, que vale em qualquer aba: sai do funil
 * DO CARD (não da aba aberta), e por isso é perguntada pelos três funis de card.
 * A tela só a esconde quando o card já está na coluna de destino.
 */
describe('matriz de movimentos — a recusa da due diligence', () => {
  it('em cada funil, para a coluna de reprovados dele', () => {
    const etapas = espelhoDosTresFunis()
    const recusa = (pipelineId: number): Movimento | null => {
      const a = acaoDeReprovar(pipelineId, etapas)
      return a ? [a.label, a.statusId, a.papel] : null
    }
    expect(recusa(FUNIL_RPV)).toEqual(['Reprovar crédito', 107830031, 'reprovar'])
    expect(recusa(FUNIL_PRECATORIO_INTERNO)).toEqual(['Reprovar crédito', 111534108, 'reprovar'])
    expect(recusa(FUNIL_PRECATORIO_EXTERNO)).toEqual(['Reprovar crédito', 111534212, 'reprovar'])
    expect(recusa(999)).toBeNull()
  })
})

// ---------- O que o servidor aceita ----------

/** Mesma lista, em qualquer ordem: a ordem da permissão não é comportamento. */
const ordenado = <T extends string | number>(xs: Iterable<T>): T[] =>
  [...xs].sort((a, b) => String(a).localeCompare(String(b)))

describe('lista de permissão do servidor — escrita por extenso', () => {
  /**
   * O RPV: as chaves de `COLUNAS`. A `kommo-mover` aceita qualquer statusId que
   * esteja aqui, sem consultar a trilha.
   */
  it('RPV: as colunas de `COLUNAS`', () => {
    expect(ordenado(Object.keys(COLUNAS).map(Number))).toEqual(
      ordenado([107272803, 107272807, 107830027, 107830035, 107830031]),
    )
  })

  /**
   * E O NOME QUE CADA UMA LEVA para a anotação de auditoria ("Movido de X para Y
   * por …"). São os nomes ANTIGOS das colunas — o kanban de 02/10/2026 chama
   * 107272807 de "Revisão" e 107830035 de "Produção de proposta" —, e mudar o
   * texto muda a nota que o comercial lê no card.
   */
  it('RPV: o nome de cada coluna na anotação', () => {
    expect(COLUNAS).toEqual({
      107272803: 'Análise Jurídica-Econômico',
      107272807: 'Revisão e Decisão do Pedro',
      107830027: 'Diligência',
      107830035: 'Apresentação de Proposta',
      107830031: 'Reprovados Operacional',
    })
  })

  it('Precatório Interno: os ids de `idsDestinoDaTrilha`', () => {
    expect(ordenado(idsDestinoDaTrilha(FUNIL_PRECATORIO_INTERNO))).toEqual(
      ordenado([
        111533960, // DILIGÊNCIA (da trilha)
        111534108, // REPROVADOS (da trilha)
        111533944, // REVISÃO — "Enviar para revisão" da Análise
        111533948, // PRODUÇÃO DE PROPOSTA — "Aprovar crédito" da Revisão
      ]),
    )
  })

  it('Precatório Externo: os ids de `idsDestinoDaTrilha`', () => {
    expect(ordenado(idsDestinoDaTrilha(FUNIL_PRECATORIO_EXTERNO))).toEqual(
      ordenado([
        111533996, // DILIGÊNCIA (da trilha)
        111534212, // REPROVADOS (da trilha)
        111533972, // REVISÃO DA QUALIFICAÇÃO — "Enviar para revisão" e "Sanar"
        111533980, // ENCAMINHAR AOS FUNDOS — "Aprovar crédito" e o "Anexar" do memorando
        111533976, // MEMORANDO DE NEGOCIAÇÃO — "Pedir memorando"
        111533984, // EM PRECIFICAÇÃO — o envio aos fundos
        111533988, // PRODUÇÃO DE PROPOSTA — a escolha da proposta
      ]),
    )
  })

  /**
   * O NOME DE RESERVA TAMBÉM AUTORIZA: `destinoPermitido` aceita a coluna do funil
   * cujo nome casa com um destes, mesmo com outro id (coluna apagada e recriada
   * no Kommo). É uma segunda porta de permissão, e por isso também fica por
   * extenso.
   */
  it('Precatório: os nomes de reserva de `destinosDaTrilha`', () => {
    expect(ordenado(destinosDaTrilha(FUNIL_PRECATORIO_INTERNO))).toEqual(
      ordenado(['DILIGÊNCIA', 'REPROVADOS', 'REVISÃO', 'PRODUÇÃO DE PROPOSTA']),
    )
    expect(ordenado(destinosDaTrilha(FUNIL_PRECATORIO_EXTERNO))).toEqual(
      ordenado([
        'DILIGÊNCIA',
        'REPROVADOS',
        'REVISÃO DA QUALIFICAÇÃO',
        'ENCAMINHAR AOS FUNDOS',
        'MEMORANDO DE NEGOCIAÇÃO',
        'EM PRECIFICAÇÃO',
        'PRODUÇÃO DE PROPOSTA',
      ]),
    )
  })

  // O RPV NÃO PASSA PELAS TRILHAS: o único caminho dele é `COLUNAS`.
  it('funil que não é de precatório não tem destino de trilha', () => {
    expect(idsDestinoDaTrilha(FUNIL_RPV)).toEqual([])
    expect(destinosDaTrilha(FUNIL_RPV)).toEqual([])
    expect(idsDestinoDaTrilha(999)).toEqual([])
  })
})

/**
 * A TELA E O SERVIDOR CONCORDAM. Todo movimento que a tela oferece o servidor
 * aceita (senão o botão existe e o card não se move); e o que o servidor aceita
 * sem botão nenhum fica dito aqui, para não crescer em silêncio.
 */
describe('a tela e o servidor concordam', () => {
  const etapas = espelhoDosTresFunis()

  /** Os destinos que a tela oferece para os cards de um funil. */
  const oferecidos = (pipelineId: number): Set<number> => {
    const ids = new Set<number>()
    const trilha = SUBDIVISOES_PRECATORIO.find((s) => s.pipelineId === pipelineId)
    const abas =
      pipelineId === FUNIL_RPV ? abasDoFunil(FUNIL_RPV, etapas) : abasDoFunil(FUNIL_PRECATORIO, etapas, trilha!.key)
    for (const a of abas) for (const [, id] of movimentosDaAba(a)) ids.add(id)
    const recusa = acaoDeReprovar(pipelineId, etapas)
    if (recusa) ids.add(recusa.statusId)
    return ids
  }

  const aceitos = (pipelineId: number): number[] =>
    pipelineId === FUNIL_RPV ? Object.keys(COLUNAS).map(Number) : idsDestinoDaTrilha(pipelineId)

  for (const [nome, pipelineId] of [
    ['RPV', FUNIL_RPV],
    ['Interno', FUNIL_PRECATORIO_INTERNO],
    ['Externo', FUNIL_PRECATORIO_EXTERNO],
  ] as const) {
    it(`${nome}: todo destino oferecido é aceito pelo servidor`, () => {
      const permitidos = aceitos(pipelineId)
      for (const id of oferecidos(pipelineId)) expect(permitidos, String(id)).toContain(id)
    })
  }

  /**
   * O QUE O SERVIDOR ACEITA SEM BOTÃO NA TELA. No RPV, a Análise (107272803):
   * nenhum botão move para lá hoje, e a `kommo-mover` aceita. Botão novo para a
   * Análise — ou destino novo sem botão — muda esta lista.
   */
  it('o que o servidor aceita e nenhum botão oferece', () => {
    const semBotao = (pipelineId: number) =>
      ordenado(aceitos(pipelineId).filter((id) => !oferecidos(pipelineId).has(id)))
    expect(semBotao(FUNIL_RPV)).toEqual([107272803])
    expect(semBotao(FUNIL_PRECATORIO_INTERNO)).toEqual([])
    expect(semBotao(FUNIL_PRECATORIO_EXTERNO)).toEqual([])
  })

  /**
   * OS IDS DO RPV EXISTEM NO KANBAN REAL. O RPV se liga só pelo id (as
   * constantes ST_* e `COLUNAS`), e coluna recriada no Kommo ganha id novo: o
   * botão continuaria lá, movendo para uma coluna que não existe mais.
   */
  it('RPV: toda coluna da tela e do servidor existe no kanban de 02/10/2026', () => {
    const doKanban = new Set(KANBAN_RPV.map((e) => e.status_id))
    expect(telasRpvDesalinhadas([...KANBAN_RPV])).toEqual([])
    for (const t of TELAS) expect(doKanban.has(t.statusId), t.label).toBe(true)
    for (const id of Object.keys(COLUNAS).map(Number)) expect(doKanban.has(id), String(id)).toBe(true)
  })
})
