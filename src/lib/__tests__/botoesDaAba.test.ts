// Testes de caracterização: QUAIS BOTÕES DE TRABALHO cada aba da Análise de
// crédito mostra hoje (ver `botoesDaAba` em src/lib/kommo.ts).
//
// POR QUE EXISTEM. 'rpv' abre a análise de RPV (o motor `gerar-analise-rpv`) e
// 'dd' abre a due diligence com o Escavador — as duas são PAGAS, e a due
// diligence busca sozinha ao abrir. O redesenho vai acrescentar colunas e botões
// à tela; uma aba de leitura que ganhasse um desses botões sem ninguém decidir
// custaria dinheiro a cada clique, e nada na tela denunciaria.
//
// A MATRIZ ESTÁ ESCRITA POR EXTENSO, e não derivada das listas, de propósito:
// cada linha é o que a tela faz HOJE. Aba nova, aba a menos ou botão diferente
// derruba o teste — e quem mudar a linha muda sabendo o que mudou.

import { describe, it, expect } from 'vitest'
import {
  abasDoFunil,
  botoesDaAba,
  FUNIL_PRECATORIO,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_RPV,
  type BotoesDoCard,
  type EtapaKommo,
  type SubdivisaoPrecatorio,
} from '@/lib/kommo'
import { espelhoDosTresFunis } from './fixtures/kanbans'

/** Os dois valores do seletor de cima da tela: RPV e Precatórios. */
const FUNIS = { RPV: FUNIL_RPV, Precatório: FUNIL_PRECATORIO } as const
type NomeDoFunil = keyof typeof FUNIS

/** [funil, trilha, chave da aba, rótulo da aba, botões]. */
type Linha = [NomeDoFunil, SubdivisaoPrecatorio, string, string, BotoesDoCard]

/**
 * O RPV IGNORA A TRILHA, mas a tela a passa mesmo assim: a pílula fica guardada
 * enquanto o RPV está aberto, para voltar ao mesmo lugar na troca de funil. Por
 * isso as seis abas aparecem duas vezes — a resposta não pode depender dela.
 */
const RPV = (trilha: SubdivisaoPrecatorio): Linha[] => [
  ['RPV', trilha, 'pendentes', 'Análise', 'rpv'],
  ['RPV', trilha, 'validacao', 'Revisão', 'rpv'],
  ['RPV', trilha, 'aprovados', 'Aprovados', 'nenhum'],
  ['RPV', trilha, 'diligencia', 'Diligência', 'nenhum'],
  ['RPV', trilha, 'reprovados', 'Reprovados', 'nenhum'],
  ['RPV', trilha, 'protocolo', 'p/ Protocolo', 'nenhum'],
]

/** A MATRIZ DE HOJE, com o kanban real dos três funis. */
const MATRIZ: Linha[] = [
  ...RPV('interno'),
  ...RPV('externo'),
  ['Precatório', 'interno', 'int-analise', 'Análise', 'dd'],
  ['Precatório', 'interno', 'int-revisao', 'Revisão', 'dd'],
  ['Precatório', 'interno', 'int-aprovados', 'Aprovados', 'dd'],
  ['Precatório', 'interno', 'int-diligencia', 'Diligência', 'nenhum'],
  ['Precatório', 'interno', 'int-reprovados', 'Reprovados', 'nenhum'],
  ['Precatório', 'interno', 'int-protocolo', 'p/ Protocolo', 'nenhum'],
  // O EXTERNO ESPELHA O KANBAN INTEIRO, na ordem e com os nomes de lá; a coluna
  // sem função na plataforma entra como `col-<id>`, só para leitura.
  ['Precatório', 'externo', 'ext-qualificacao', 'QUALIFICAÇÃO PRELIMINAR', 'dd'],
  ['Precatório', 'externo', 'ext-revisao', 'REVISÃO DA QUALIFICAÇÃO', 'dd'],
  ['Precatório', 'externo', 'ext-diligencia', 'DILIGÊNCIA', 'nenhum'],
  ['Precatório', 'externo', 'ext-memorando', 'MEMORANDO DE NEGOCIAÇÃO', 'nenhum'],
  ['Precatório', 'externo', 'ext-encaminhar', 'ENCAMINHAR AOS FUNDOS', 'nenhum'],
  ['Precatório', 'externo', 'ext-precificacao', 'EM PRECIFICAÇÃO', 'nenhum'],
  ['Precatório', 'externo', 'ext-apresentacao', 'PRODUÇÃO DE PROPOSTA', 'nenhum'],
  ['Precatório', 'externo', 'col-112339984', 'NEGOCIAÇÃO', 'nenhum'],
  ['Precatório', 'externo', 'ext-fechados', 'FECHADOS', 'nenhum'],
  ['Precatório', 'externo', 'ext-documentacao', 'OBTENÇÃO DE DOCUMENTAÇÃO', 'nenhum'],
  ['Precatório', 'externo', 'col-112341612', 'AGUARDANDO APROVAÇÃO DO FUNDO', 'nenhum'],
  ['Precatório', 'externo', 'col-112341616', 'REVISÃO/ASSINATURA DA ESCRITURA', 'nenhum'],
  ['Precatório', 'externo', 'col-112006404', 'PAGOS', 'nenhum'],
  ['Precatório', 'externo', 'ext-reprovados', 'REPROVADOS', 'nenhum'],
  ['Precatório', 'externo', 'col-111985976', 'NÃO FECHADO', 'nenhum'],
]

/** As combinações de funil e trilha que a tela consegue abrir. */
const COMBINACOES: [NomeDoFunil, SubdivisaoPrecatorio][] = [
  ['RPV', 'interno'],
  ['RPV', 'externo'],
  ['Precatório', 'interno'],
  ['Precatório', 'externo'],
]

/** O que a tela calcula para cada aba de um funil e trilha, na ordem das abas. */
const doQueATelaMonta = (
  funil: NomeDoFunil,
  trilha: SubdivisaoPrecatorio,
  etapas: EtapaKommo[],
): Linha[] =>
  abasDoFunil(FUNIS[funil], etapas, trilha).map((a) => [
    funil,
    trilha,
    a.key,
    a.label,
    botoesDaAba(FUNIS[funil], trilha, a),
  ])

describe('botoesDaAba — a matriz de hoje', () => {
  for (const [funil, trilha] of COMBINACOES) {
    it(`${funil} · ${trilha}: cada aba, na ordem, com os botões que oferece`, () => {
      expect(doQueATelaMonta(funil, trilha, espelhoDosTresFunis())).toEqual(
        MATRIZ.filter((l) => l[0] === funil && l[1] === trilha),
      )
    })
  }

  it('a matriz cobre as 33 abas de hoje', () => {
    expect(MATRIZ).toHaveLength(33)
  })

  /**
   * ANTES DE O ESPELHO CHEGAR (a consulta ao kommo_etapa ainda em voo), o Externo
   * mostra só as abas que a trilha conhece, sem as `col-*`. Os botões continuam
   * saindo da chave — e é esta a tela que a equipe vê no primeiro segundo.
   */
  it('sem espelho ainda, os botões saem da chave da aba', () => {
    const semEspelho = COMBINACOES.flatMap(([funil, trilha]) => doQueATelaMonta(funil, trilha, []))
    expect(semEspelho).toEqual([
      ...RPV('interno'),
      ...RPV('externo'),
      // NO INTERNO NADA MUDA: as abas e os rótulos são da plataforma, não do kanban.
      ...MATRIZ.filter((l) => l[0] === 'Precatório' && l[1] === 'interno'),
      // NO EXTERNO, as dez que a trilha declara, na ordem e com os rótulos dela.
      ['Precatório', 'externo', 'ext-qualificacao', 'Qualificação', 'dd'],
      ['Precatório', 'externo', 'ext-revisao', 'Revisão', 'dd'],
      ['Precatório', 'externo', 'ext-memorando', 'Memorando', 'nenhum'],
      ['Precatório', 'externo', 'ext-encaminhar', 'Aprovados', 'nenhum'],
      ['Precatório', 'externo', 'ext-precificacao', 'Em precificação', 'nenhum'],
      ['Precatório', 'externo', 'ext-diligencia', 'Diligência', 'nenhum'],
      ['Precatório', 'externo', 'ext-reprovados', 'Reprovados', 'nenhum'],
      ['Precatório', 'externo', 'ext-apresentacao', 'Proposta', 'nenhum'],
      ['Precatório', 'externo', 'ext-fechados', 'Fechados', 'nenhum'],
      ['Precatório', 'externo', 'ext-documentacao', 'Documentação', 'nenhum'],
    ])
  })
})

/**
 * A PROPRIEDADE QUE IMPORTA: aba só de leitura não abre nada pago.
 *
 * Vale para toda aba que a tela monta — com o kanban de hoje e com o kanban que
 * ganhou uma coluna em cada funil, que é exatamente o que as próximas etapas
 * fazem (ver o plano, etapas 7, 8 e 10). Quando o RPV e o Interno passarem a
 * espelhar o kanban inteiro, as colunas novas deles entram aqui sozinhas.
 */
describe('botoesDaAba — nenhuma aba de leitura oferece análise nem due diligence', () => {
  /** Uma coluna que o Kommo ganhou e que a plataforma não conhece. */
  const colunaNova = (pipeline_id: number, status_id: number, nome: string, ordem: number): EtapaKommo => ({
    pipeline_id,
    status_id,
    pipeline_nome: null,
    nome,
    ordem,
    tipo: 0,
  })

  const KANBANS: [string, EtapaKommo[]][] = [
    ['o kanban de hoje', espelhoDosTresFunis()],
    [
      'o kanban com uma coluna nova em cada funil',
      [
        ...espelhoDosTresFunis(),
        colunaNova(FUNIL_RPV, 99_901, 'Coluna nova do RPV', 55),
        colunaNova(FUNIL_PRECATORIO, 99_902, 'Coluna nova do Interno', 4.5),
        // O "SEM RESPOSTA" DO EXTERNO (112346344), que o plano cita na etapa 10 e
        // que o espelho destes testes, de 29/09/2026, ainda não tem.
        colunaNova(FUNIL_PRECATORIO_EXTERNO, 112346344, 'SEM RESPOSTA', 14.5),
      ],
    ],
    ['o espelho ainda vazio', []],
  ]

  for (const [descricao, etapas] of KANBANS) {
    it(`com ${descricao}`, () => {
      let deLeitura = 0
      for (const [funil, trilha] of COMBINACOES) {
        for (const aba of abasDoFunil(FUNIS[funil], etapas, trilha)) {
          if (!aba.soLeitura && !aba.key.startsWith('col-')) continue
          deLeitura++
          expect(botoesDaAba(FUNIS[funil], trilha, aba), `${funil} · ${trilha} · ${aba.label}`).toBe('nenhum')
        }
      }
      // O TESTE PRECISA TER O QUE TESTAR: sem nenhuma aba de leitura no kanban,
      // ele passaria sem olhar nada.
      if (etapas.length > 0) expect(deLeitura).toBeGreaterThan(0)
    })
  }

  // A COLUNA NOVA NO EXTERNO entra como leitura, e não como trabalho.
  it('a coluna que o Externo ganhar entra como leitura, sem botão', () => {
    const etapas = [
      ...espelhoDosTresFunis(),
      colunaNova(FUNIL_PRECATORIO_EXTERNO, 112346344, 'SEM RESPOSTA', 14.5),
    ]
    const nova = abasDoFunil(FUNIL_PRECATORIO, etapas, 'externo').find((a) => a.label === 'SEM RESPOSTA')!
    expect(nova).toMatchObject({ key: 'col-112346344', soLeitura: true })
    expect(botoesDaAba(FUNIL_PRECATORIO, 'externo', nova)).toBe('nenhum')
  })

  it('no Precatório, `soLeitura` vence a chave, em qualquer trilha', () => {
    for (const trilha of ['interno', 'externo'] as const) {
      for (const key of ['ext-qualificacao', 'ext-revisao', 'int-analise', 'int-revisao', 'int-aprovados', 'col-1']) {
        expect(botoesDaAba(FUNIL_PRECATORIO, trilha, { key, soLeitura: true }), `${trilha} · ${key}`).toBe('nenhum')
      }
    }
  })
})

/**
 * O QUE A REGRA AINDA NÃO PROTEGE — preso como está HOJE, para que a mudança,
 * quando vier, seja de propósito.
 *
 * AS DUAS LISTAS SÃO DE EXCLUSÃO: toda aba que não está nelas ganha os botões.
 * Hoje isso não custa nada, porque as abas são exatamente as da matriz acima.
 * Mas é o buraco por onde uma aba nova ganharia análise e due diligence pagas.
 */
describe('botoesDaAba — o que a regra ainda não protege', () => {
  /**
   * NO RPV, `soLeitura` É IGNORADO: só a chave conta. Hoje nenhuma aba do RPV é
   * de leitura (as seis de `TELAS` são fixas), mas a etapa 7 do plano vai
   * espelhar o kanban inteiro do RPV — e cada coluna nova ganharia a análise de
   * RPV e a due diligence. A ETAPA 7 TEM DE TROCAR ESTE 'rpv' POR 'nenhum'
   * (lista de permissão no lugar de `ABAS_RPV_TERMINAIS`), e este teste junto.
   */
  it("no RPV, uma aba de leitura ainda receberia 'rpv'", () => {
    expect(botoesDaAba(FUNIL_RPV, 'interno', { key: 'col-107830039', soLeitura: true })).toBe('rpv')
    expect(botoesDaAba(FUNIL_RPV, 'externo', { key: 'col-107830039', soLeitura: true })).toBe('rpv')
  })

  // NO RPV, SEM ABA NENHUMA, também 'rpv'. Não acontece na tela — `TELAS` nunca
  // é vazia —, mas é a mesma regra de exclusão.
  it("no RPV, sem aba aberta, a resposta é 'rpv'", () => {
    expect(botoesDaAba(FUNIL_RPV, 'interno', null)).toBe('rpv')
  })

  // NO PRECATÓRIO, SEM ABA NENHUMA, nada: a tela ainda não sabe em que etapa está.
  it('no Precatório, sem aba aberta, nenhum botão', () => {
    expect(botoesDaAba(FUNIL_PRECATORIO, 'interno', null)).toBe('nenhum')
    expect(botoesDaAba(FUNIL_PRECATORIO, 'externo', null)).toBe('nenhum')
  })

  /**
   * NO PRECATÓRIO, ABA DE TRABALHO NOVA NASCE COM 'dd'. Uma aba declarada na
   * trilha (não `soLeitura`) que não entre em `ABAS_*_SEM_TRABALHO` ganha due
   * diligence e "Executar análise". A matriz acima pega isso — a aba nova
   * apareceria nela —, e este teste diz por quê.
   */
  it("no Precatório, aba de trabalho fora das listas recebe 'dd'", () => {
    expect(botoesDaAba(FUNIL_PRECATORIO, 'interno', { key: 'int-nova' })).toBe('dd')
    expect(botoesDaAba(FUNIL_PRECATORIO, 'externo', { key: 'ext-nova', soLeitura: false })).toBe('dd')
  })
})
