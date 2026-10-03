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
//
// O DESFECHO DA NEGOCIAÇÃO (onda 4 do redesenho) também entra, com o rótulo e o
// papel de cada saída — "Fechado!", "Não fechou", "Sem resposta". Desde
// 03/10/2026 (decisão do dono) ele vale para todo mundo, e está nas listas abaixo.
// O "Gerar contrato" não move card e não entra aqui: tem teste próprio.
const movimentosDaAba = (a: Aba): Movimento[] => [
  ...a.acoes.map((x): Movimento => [x.label, x.statusId, x.papel]),
  ...[a.negociacao?.fechado, a.negociacao?.naoFechou, a.negociacao?.semResposta]
    .filter((x) => x !== undefined)
    .map((x): Movimento => [x.label, x.statusId, x.papel]),
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
const daTela = (funil: NomeDoFunil, trilha: SubdivisaoPrecatorio, etapas = espelhoDosTresFunis()): [string, Movimento[]][] =>
  abasDoFunil(FUNIS[funil], etapas, trilha).map((a) => [a.key, movimentosDaAba(a)])

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
 *
 * MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): os botões da onda 4 valem
 * para todo mundo. A Revisão troca os três botões do card pelo Concluir — os
 * MESMOS destinos, com os rótulos do Interno (etapa 9) —; a Diligência ganha o
 * "Sanar", de volta à Revisão (etapa 8); e a Negociação, que segue só de leitura,
 * ganha o desfecho (etapa 10b).
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
      ['Aprovar crédito', 107830035, 'aprovar'],
      ['Exigir diligência', 107830027, 'diligenciar'],
      ['Reprovar crédito', 107830031, 'reprovar'],
    ],
  ],
  ['diligencia', [['Sanar', 107272807, 'validar']]],
  ['aprovados', []],
  [
    'col-107830039',
    [
      ['Fechado!', 107830043, 'fechar'],
      ['Não fechou', 107830067, 'reprovar'],
      ['Sem resposta', 112466388, 'reprovar'],
    ],
  ],
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
  //
  // MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): o "Sanar" da Diligência
  // (de volta à Revisão) e o desfecho da Negociação, para todo mundo.
  ['int-diligencia', [['Sanar', 111533944, 'validar']]],
  ['int-aprovados', []],
  [
    'col-112466260',
    [
      ['Fechado!', 111533952, 'fechar'],
      ['Não fechou', 112382612, 'reprovar'],
      ['Sem resposta', 112465960, 'reprovar'],
    ],
  ],
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
  // MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): o desfecho da Negociação,
  // para todo mundo. O "Sem resposta" (112346344) não está no espelho destes
  // testes (29/09/2026), então a opção não aparece — ver o teste com ele.
  [
    'col-112339984',
    [
      ['Fechado!', 111533992, 'fechar'],
      ['Não fechou', 111985976, 'reprovar'],
    ],
  ],
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
   *
   * MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): o Concluir da Revisão do
   * RPV vale para todo mundo, e a porta dele é a fileira de 'rpv' — o Concluir
   * aparece em toda aba de trabalho (ver o CardCredito). As abas agrupadas estão
   * escritas por extenso: aba nova agrupada, ou que deixou de ser, muda a lista.
   */
  it("toda aba de desfecho agrupado tem porta ('dd' ou 'rpv'), e são estas", () => {
    const agrupadas: [string, string, string][] = []
    for (const [funil, trilha] of COMBINACOES) {
      for (const a of abasDoFunil(FUNIS[funil], espelhoDosTresFunis(), trilha)) {
        if (!a.desfechoAgrupado || a.acoes.length === 0) continue
        const porta = botoesDaAba(FUNIS[funil], trilha, a)
        expect(['dd', 'rpv'], `${funil} · ${trilha} · ${a.label}`).toContain(porta)
        agrupadas.push([`${funil} · ${trilha}`, a.key, porta])
      }
    }
    expect(agrupadas).toEqual([
      // A Revisão do RPV, nas duas trilhas que o RPV ignora.
      ['RPV · interno', 'validacao', 'rpv'],
      ['RPV · externo', 'validacao', 'rpv'],
      ['Precatório · interno', 'int-analise', 'dd'],
      ['Precatório · interno', 'int-revisao', 'dd'],
      ['Precatório · externo', 'ext-qualificacao', 'dd'],
      ['Precatório · externo', 'ext-revisao', 'dd'],
    ])
  })

  /**
   * O "GERAR CONTRATO" (onda 4): não move card — leva à Geração de contratos com
   * o card no endereço —, por isso não está nas matrizes. Fica aqui, por extenso:
   * SÓ na Elaboração de contratos do RPV, e em nenhuma aba do Precatório.
   *
   * MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): para todo mundo.
   */
  it('o "Gerar contrato": só na Elaboração de contratos do RPV', () => {
    const comGerar = COMBINACOES.flatMap(([funil, trilha]) =>
      abasDoFunil(FUNIS[funil], espelhoDosTresFunis(), trilha)
        .filter((a) => a.gerarContrato)
        .map((a) => `${funil} · ${trilha} · ${a.key}`),
    )
    expect(comGerar).toEqual(['RPV · interno · col-107830051', 'RPV · externo · col-107830051'])
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
   *
   * MUDOU DE PROPÓSITO EM 02/10/2026 (etapa 10a do redesenho): o servidor passa a
   * aceitar o desfecho da Negociação — Fechados (107830043), Não fechado
   * (107830067) e Sem resposta (112466388). EXATAMENTE ESSES TRÊS: a própria
   * Negociação (107830039) e a Oferta aos investidores (107830047) continuam
   * recusadas. Os botões vieram na onda 4 e, desde 03/10/2026, são de todos (ver
   * "todo destino aceito tem botão").
   */
  it('RPV: as colunas de `COLUNAS`', () => {
    expect(ordenado(Object.keys(COLUNAS).map(Number))).toEqual(
      ordenado([
        107272803, 107272807, 107830027, 107830035, 107830031,
        // O DESFECHO DA NEGOCIAÇÃO (02/10/2026)
        107830043, 107830067, 112466388,
      ]),
    )
    expect(COLUNAS[107830039], 'Negociação').toBeUndefined()
    expect(COLUNAS[107830047], 'Oferta aos investidores').toBeUndefined()
  })

  /**
   * E O NOME QUE CADA UMA LEVA para a anotação de auditoria ("Movido de X para Y
   * por …"). São os nomes ANTIGOS das colunas — o kanban de 02/10/2026 chama
   * 107272807 de "Revisão" e 107830035 de "Produção de proposta" —, e mudar o
   * texto muda a nota que o comercial lê no card.
   *
   * OS TRÊS DA NEGOCIAÇÃO (02/10/2026) entram com o nome do kanban daquele dia.
   * Ficam só de reserva, como os outros: a nota usa o nome do `kommo_etapa`.
   */
  it('RPV: o nome de cada coluna na anotação', () => {
    expect(COLUNAS).toEqual({
      107272803: 'Análise Jurídica-Econômico',
      107272807: 'Revisão e Decisão do Pedro',
      107830027: 'Diligência',
      107830035: 'Apresentação de Proposta',
      107830031: 'Reprovados Operacional',
      107830043: 'Fechados',
      107830067: 'Não fechado',
      112466388: 'Sem resposta',
    })
  })

  // MUDOU DE PROPÓSITO EM 02/10/2026 (etapa 10a): + os três destinos do desfecho
  // da Negociação, que vêm do campo `negociacao` da trilha — não de `saidas`, que
  // virariam botão na tela oficial. A Negociação (112466260) segue recusada.
  it('Precatório Interno: os ids de `idsDestinoDaTrilha`', () => {
    expect(ordenado(idsDestinoDaTrilha(FUNIL_PRECATORIO_INTERNO))).toEqual(
      ordenado([
        111533960, // DILIGÊNCIA (da trilha)
        111534108, // REPROVADOS (da trilha)
        111533944, // REVISÃO — "Enviar para revisão" da Análise
        111533948, // PRODUÇÃO DE PROPOSTA — "Aprovar crédito" da Revisão
        111533952, // Fechados — desfecho da Negociação (botão na aba da Negociação)
        112382612, // Não fechados — desfecho da Negociação (botão na aba da Negociação)
        112465960, // Sem resposta — desfecho da Negociação (botão na aba da Negociação)
      ]),
    )
  })

  // MUDOU DE PROPÓSITO EM 02/10/2026 (etapa 10a): idem, no Externo. A Negociação
  // (112339984) segue recusada.
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
        111533992, // FECHADOS — desfecho da Negociação (botão na aba da Negociação)
        111985976, // NÃO FECHADO — desfecho da Negociação (botão na aba da Negociação)
        112346344, // SEM RESPOSTA — desfecho da Negociação (botão na aba da Negociação)
      ]),
    )
  })

  /**
   * O NOME DE RESERVA TAMBÉM AUTORIZA: `destinoPermitido` aceita a coluna do funil
   * cujo nome casa com um destes, mesmo com outro id (coluna apagada e recriada
   * no Kommo). É uma segunda porta de permissão, e por isso também fica por
   * extenso.
   */
  //
  // MUDOU DE PROPÓSITO EM 02/10/2026 (etapa 10a): + os nomes de reserva dos três
  // destinos da Negociação, em cada trilha (os nomes do kanban daquele dia).
  it('Precatório: os nomes de reserva de `destinosDaTrilha`', () => {
    expect(ordenado(destinosDaTrilha(FUNIL_PRECATORIO_INTERNO))).toEqual(
      ordenado([
        'DILIGÊNCIA',
        'REPROVADOS',
        'REVISÃO',
        'PRODUÇÃO DE PROPOSTA',
        'Fechados',
        'Não fechados',
        'Sem resposta',
      ]),
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
        'FECHADOS',
        'NÃO FECHADO',
        'SEM RESPOSTA',
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
 * O ESPELHO COMO O KANBAN ESTÁ (kommo_etapa de 02/10/2026): o dos testes, mais o
 * "SEM RESPOSTA" do Externo (112346344), que o espelho dos testes (29/09/2026)
 * não tem. Sem a coluna no espelho, a opção não vira botão — é a regra de sempre
 * ("melhor sem a opção do que um botão que move para lugar nenhum").
 */
const espelhoComSemRespostaDoExterno = () => [
  ...espelhoDosTresFunis(),
  { pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: 112346344, pipeline_nome: null, nome: 'SEM RESPOSTA', ordem: 14.5, tipo: 0 },
]

/**
 * A TELA E O SERVIDOR CONCORDAM, NOS DOIS SENTIDOS. Todo movimento que a tela
 * oferece o servidor aceita (senão o botão existe e o card não se move); e todo
 * destino que o servidor aceita tem botão na tela — o que fica sem botão está
 * dito aqui, por extenso, para não crescer em silêncio.
 */
describe('a tela e o servidor concordam', () => {
  /** Os destinos que a tela oferece para os cards de um funil. */
  const oferecidos = (pipelineId: number, etapas = espelhoDosTresFunis()): Set<number> => {
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
      for (const id of oferecidos(pipelineId, espelhoComSemRespostaDoExterno())) {
        expect(permitidos, String(id)).toContain(id)
      }
    })
  }

  /**
   * TODO DESTINO QUE O SERVIDOR ACEITA TEM BOTÃO. A única exceção é a Análise do
   * RPV (107272803), de sempre: nenhum botão volta o card para lá, e a
   * `kommo-mover` aceita. Botão novo para a Análise — ou destino novo sem botão —
   * muda esta lista.
   *
   * MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): até aqui a lista tinha
   * também os três destinos do desfecho da Negociação de cada funil — o servidor
   * os aceitava (etapa 10a) e só o admin tinha o botão. Com os botões da onda 4
   * para todo mundo, eles saíram: agora têm botão, na aba da Negociação.
   */
  it('todo destino aceito tem botão (só a Análise do RPV fica sem, de sempre)', () => {
    const semBotao = (pipelineId: number, etapas = espelhoComSemRespostaDoExterno()) =>
      ordenado(aceitos(pipelineId).filter((id) => !oferecidos(pipelineId, etapas).has(id)))
    expect(semBotao(FUNIL_RPV)).toEqual([107272803])
    expect(semBotao(FUNIL_PRECATORIO_INTERNO)).toEqual([])
    expect(semBotao(FUNIL_PRECATORIO_EXTERNO)).toEqual([])
    // NO ESPELHO DOS TESTES, sem a coluna "SEM RESPOSTA" do Externo, a opção não
    // vira botão — e o destino fica aceito sem botão, só ele.
    expect(semBotao(FUNIL_PRECATORIO_EXTERNO, espelhoDosTresFunis())).toEqual([112346344])
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

// ---------- Os botões da onda 4 do redesenho ----------

/**
 * O ADMINISTRADOR VÊ O MESMO QUE TODO MUNDO. Na onda 4 (02/10/2026) os botões que
 * movem card de um jeito novo apareciam primeiro só para admin (`soAdmin`,
 * filtrado em `abaParaQuemVe`), e esta seção escrevia o que o admin via a mais.
 *
 * MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): os botões são de todos
 * (`BOTOES_NOVOS_PARA_TODOS`), e as matrizes de cima já os trazem. O que fica
 * aqui é que a visão do admin é exatamente a mesma matriz — a chave desligada,
 * ou um botão novo só de admin, derruba estes testes.
 */
const daTelaDoAdmin = (funil: NomeDoFunil, trilha: SubdivisaoPrecatorio, etapas = espelhoDosTresFunis()) =>
  abasDoFunil(FUNIS[funil], etapas, trilha, { admin: true }).map((a): [string, Movimento[]] => [a.key, movimentosDaAba(a)])

describe('matriz de movimentos — os botões da onda 4, para todo mundo', () => {
  it('o admin vê exatamente as matrizes de todo mundo', () => {
    expect(daTelaDoAdmin('RPV', 'interno')).toEqual(MOVIMENTOS_RPV)
    expect(daTelaDoAdmin('RPV', 'externo')).toEqual(MOVIMENTOS_RPV)
    expect(daTelaDoAdmin('Precatório', 'interno')).toEqual(MOVIMENTOS_INTERNO)
    expect(daTelaDoAdmin('Precatório', 'externo')).toEqual(MOVIMENTOS_EXTERNO)
  })

  it('Externo: com o "SEM RESPOSTA" no espelho, a opção entra na Negociação', () => {
    const neg = daTela('Precatório', 'externo', espelhoComSemRespostaDoExterno()).find(([k]) => k === 'col-112339984')!
    expect(neg[1]).toEqual([
      ['Fechado!', 111533992, 'fechar'],
      ['Não fechou', 111985976, 'reprovar'],
      ['Sem resposta', 112346344, 'reprovar'],
    ])
  })

  it('sem espelho ainda, a Negociação do precatório não oferece nada (destino não resolvido)', () => {
    for (const trilha of ['interno', 'externo'] as const) {
      for (const a of abasDoFunil(FUNIL_PRECATORIO, [], trilha)) {
        expect(a.negociacao, `${trilha} · ${a.key}`).toBeUndefined()
      }
    }
  })
})
