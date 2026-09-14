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
//
// DESDE 14/09/2026 SÃO DOIS KANBANS. As trilhas foram separadas em pipelines
// próprios, uma de cada vez: o Externo já lê do funil novo, o Interno ainda lê
// do antigo. É por isso que o espelho destes testes tem dois funis — e é
// justamente essa convivência que eles precisam provar que funciona.

import { describe, it, expect } from 'vitest'
import {
  ABA_JURIDICO,
  ABAS_EXTERNO_SEM_TRABALHO,
  acaoDeReprovar,
  ehCardExterno,
  ehFunilPrecatorio,
  FUNIL_PRECATORIO,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_RPV,
  funisExibidos,
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

/** As colunas do funil ANTIGO, onde a trilha Interna ainda vive. */
const COLUNAS_INTERNO = [
  'Análise Jurídica (TIER 1)',
  'Análise Econômico-Financeira (TIER 1)',
  'Revisão (TIER 1)',
  'Apresentação de Proposta',
  'Diligência',
  'Reprovados Operacional',
  // Colunas do funil que NÃO entram em trilha nenhuma: existem no kanban do
  // comercial e não são do operacional.
  'Nutrição',
  'Venda ganha',
]

/**
 * As colunas do funil NOVO do Externo, como o Kommo as devolveu.
 *
 * EM CAIXA ALTA PORQUE É ASSIM QUE ESTÃO LÁ, e duas delas — "MEMORANDO DE
 * NEGOCIAÇÃO" e "AGUARDANDO PRECIFICAÇÃO" — existem no kanban e NÃO viram aba,
 * por decisão de quem opera. Ficam no espelho de propósito: é o que garante que
 * a ausência delas na tela seja escolha, e não coluna perdida.
 */
const COLUNAS_EXTERNO = [
  'Etapa de leads de entrada',
  'QUALIFICAÇÃO PRELIMINAR',
  'REVISÃO DA QUALIFICAÇÃO',
  'MEMORANDO DE NEGOCIAÇÃO',
  'ENCAMINHAR AOS FUNDOS',
  'AGUARDANDO PRECIFICAÇÃO',
  'PRODUÇÃO DE PROPOSTA',
  'FECHADOS',
  'DILIGÊNCIA',
  'REPROVADOS',
]

const colunasDe = (pipelineId: number, nomes: string[], base: number): EtapaKommo[] =>
  nomes.map((nome, i) => ({
    pipeline_id: pipelineId,
    status_id: base + i,
    pipeline_nome: pipelineId === FUNIL_PRECATORIO ? 'Funil Geral Precatório' : 'Funil Precatório Externo',
    nome,
    ordem: i,
    tipo: 0,
  }))

/** O espelho como o kommo-sync o gravaria: os dois funis, lado a lado. */
const espelho = (
  internas: string[] = COLUNAS_INTERNO,
  externas: string[] = COLUNAS_EXTERNO,
): EtapaKommo[] => [
  ...colunasDe(FUNIL_PRECATORIO, internas, 90_000),
  ...colunasDe(FUNIL_PRECATORIO_EXTERNO, externas, 95_000),
]

const idDe = (nome: string, etapas = espelho()) =>
  etapas.find((e) => e.nome === nome)!.status_id

const lead = (statusId: number, id = statusId, pipelineId = FUNIL_PRECATORIO): KommoLead =>
  ({
    kommo_lead_id: id,
    pipeline_id: pipelineId,
    status_id: statusId,
  }) as KommoLead

describe('SUBDIVISOES_PRECATORIO', () => {
  it('tem as duas trilhas, nomeadas Interno e Externo', () => {
    expect(SUBDIVISOES_PRECATORIO.map((s) => s.key)).toEqual(['interno', 'externo'])
    expect(SUBDIVISOES_PRECATORIO.map((s) => s.label)).toEqual(['Interno', 'Externo'])
  })

  // CADA TRILHA NO SEU FUNIL. Enquanto a migração não termina os dois ids são
  // diferentes; quando o Interno migrar, é esta linha que muda — e se alguém
  // apontar as duas para o mesmo funil sem querer, o teste cai.
  it('cada trilha lê de um funil próprio', () => {
    const porKey = new Map(SUBDIVISOES_PRECATORIO.map((s) => [s.key, s.pipelineId]))
    expect(porKey.get('interno')).toBe(FUNIL_PRECATORIO)
    expect(porKey.get('externo')).toBe(FUNIL_PRECATORIO_EXTERNO)
    expect(porKey.get('interno')).not.toBe(porKey.get('externo'))
  })

  it('os dois funis são reconhecidos como de precatório', () => {
    expect(ehFunilPrecatorio(FUNIL_PRECATORIO)).toBe(true)
    expect(ehFunilPrecatorio(FUNIL_PRECATORIO_EXTERNO)).toBe(true)
    expect(ehFunilPrecatorio(FUNIL_RPV)).toBe(false)
    expect(ehFunilPrecatorio(999)).toBe(false)
  })

  /**
   * A CONSULTA DE CARDS TEM DE COBRIR OS DOIS FUNIS.
   *
   * Foi o defeito que a separação criou e que nada acusava: as abas do Externo
   * resolviam certo, e a lista vinha vazia porque os cards eram buscados por um
   * id só — o da aba de cima, que é o funil antigo. Lista vazia se lê como "não
   * tem trabalho aqui".
   */
  it('a tela busca cards dos dois funis quando o Precatório está aberto', () => {
    expect(new Set(funisExibidos(FUNIL_PRECATORIO))).toEqual(
      new Set([FUNIL_PRECATORIO, FUNIL_PRECATORIO_EXTERNO]),
    )
    expect(new Set(funisExibidos(FUNIL_PRECATORIO_EXTERNO))).toEqual(
      new Set([FUNIL_PRECATORIO, FUNIL_PRECATORIO_EXTERNO]),
    )
  })

  it('fora do Precatório, busca só o funil aberto', () => {
    expect(funisExibidos(FUNIL_RPV)).toEqual([FUNIL_RPV])
    expect(funisExibidos(999)).toEqual([999])
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

  /**
   * O INTERNO CONTINUA SEM APROVAÇÃO, e isso não é esquecimento: qual coluna
   * significa "aprovado" no precatório interno ninguém definiu, e adivinhar seria
   * mover card de verdade com base em palpite. O Externo ganhou a sua porque lá
   * ela foi definida — este teste existe para que a de lá não vaze para cá.
   */
  it('nenhuma aba do Interno oferece aprovação', () => {
    for (const aba of abas) {
      expect(aba.acoes.some((x) => x.papel === 'aprovar'), aba.label).toBe(false)
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
    const semReprovados = espelho(
      COLUNAS_INTERNO.filter((n) => n !== 'Reprovados Operacional'),
    )
    const juridico = abasDoFunil(FUNIL_PRECATORIO, semReprovados, 'interno').find(
      (a) => a.label === 'Jurídico',
    )!
    expect(juridico.acoes.map((x) => x.papel)).toEqual(['diligenciar'])
  })
})

describe('abas da trilha Externa', () => {
  const abas = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, espelho(), 'externo')

  it('mostra os sete rótulos da plataforma, na ordem da trilha', () => {
    expect(abas.map((a) => a.label)).toEqual([
      'Qualificação Preliminar',
      'Revisão',
      'Aprovados',
      'Diligência',
      'Reprovados',
      'Apresentação',
      'Fechados',
    ])
  })

  it('cada rótulo resolve para a coluna certa do funil novo', () => {
    const porLabel = new Map(abas.map((a) => [a.label, a.statusIds[0]]))
    expect(porLabel.get('Qualificação Preliminar')).toBe(idDe('QUALIFICAÇÃO PRELIMINAR'))
    expect(porLabel.get('Revisão')).toBe(idDe('REVISÃO DA QUALIFICAÇÃO'))
    // "APROVADOS" AQUI, "ENCAMINHAR AOS FUNDOS" LÁ: o rótulo é o vocabulário de
    // quem analisa, o nome da coluna é o do comercial. O teste guarda os dois
    // lados justamente porque eles divergem de propósito.
    expect(porLabel.get('Aprovados')).toBe(idDe('ENCAMINHAR AOS FUNDOS'))
    expect(porLabel.get('Diligência')).toBe(idDe('DILIGÊNCIA'))
    expect(porLabel.get('Reprovados')).toBe(idDe('REPROVADOS'))
    expect(porLabel.get('Apresentação')).toBe(idDe('PRODUÇÃO DE PROPOSTA'))
    expect(porLabel.get('Fechados')).toBe(idDe('FECHADOS'))
  })

  /**
   * AS DUAS COLUNAS QUE FICARAM DE FORA, e ficaram por decisão.
   *
   * Elas existem no kanban e não viram aba. O teste não afirma que isso é certo
   * — afirma que é DELIBERADO: se um dia alguém as espelhar, este teste cai e
   * obriga a decisão a ser tomada de novo, em vez de entrar de carona.
   */
  it('memorando e precificação do fundo não viram aba', () => {
    const colunas = abas.map((a) => a.descricaoVazia + '')
    expect(colunas).toHaveLength(7)
    const externo = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'externo')!
    const nomes = externo.abas.map((a) => a.colunaKommo)
    expect(nomes).not.toContain('MEMORANDO DE NEGOCIAÇÃO')
    expect(nomes).not.toContain('AGUARDANDO PRECIFICAÇÃO')
  })

  /**
   * O DESFECHO DO EXTERNO MORA NA QUALIFICAÇÃO, e só nela.
   *
   * É a única etapa em que a casa decide algo: dali o crédito segue para o
   * fundo, volta para diligência ou é recusado. Depois de encaminhado quem move
   * o card é o fundo, e o parecer é dele — oferecer desfecho adiante seria
   * decidir no lugar de quem decide.
   */
  it('só a Qualificação oferece desfecho, e são as três saídas', () => {
    const qualificacao = abas.find((a) => a.label === 'Qualificação Preliminar')!
    expect(qualificacao.acoes.map((x) => x.papel)).toEqual([
      'aprovar',
      'diligenciar',
      'reprovar',
    ])
    const porPapel = new Map(qualificacao.acoes.map((a) => [a.papel, a.statusId]))
    expect(porPapel.get('aprovar')).toBe(idDe('ENCAMINHAR AOS FUNDOS'))
    expect(porPapel.get('diligenciar')).toBe(idDe('DILIGÊNCIA'))
    expect(porPapel.get('reprovar')).toBe(idDe('REPROVADOS'))
  })

  it('as demais abas do Externo não oferecem desfecho', () => {
    for (const aba of abas.filter((a) => a.label !== 'Qualificação Preliminar')) {
      expect(aba.acoes, aba.label).toEqual([])
    }
  })

  /**
   * AS TRÊS SAEM DE UM BOTÃO SÓ. A análise acontece fora da plataforma, numa
   * conversa com o Claude; três botões soltos no card convidariam o clique antes
   * do texto, e o texto é o único registro que aquela análise deixa no CRM.
   */
  it('a Qualificação marca o desfecho como agrupado', () => {
    const qualificacao = abas.find((a) => a.label === 'Qualificação Preliminar')!
    expect(qualificacao.desfechoAgrupado).toBe(true)
    for (const aba of abas.filter((a) => a.label !== 'Qualificação Preliminar')) {
      expect(aba.desfechoAgrupado, aba.label).toBe(false)
    }
  })

  // Sem a coluna no espelho não há saída: melhor a janela com duas do que um
  // botão que move o card para lugar nenhum.
  it('saída sem coluna no kanban simplesmente não aparece', () => {
    const sem = espelho(
      COLUNAS_INTERNO,
      COLUNAS_EXTERNO.filter((n) => n !== 'ENCAMINHAR AOS FUNDOS'),
    )
    const qualificacao = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, sem, 'externo').find(
      (a) => a.key === 'ext-qualificacao',
    )!
    expect(qualificacao.acoes.map((x) => x.papel)).toEqual(['diligenciar', 'reprovar'])
  })
})

describe('as duas trilhas não dividem mais nenhuma coluna', () => {
  /**
   * O REMENDO QUE OS FUNIS SEPARADOS DESFIZERAM.
   *
   * Enquanto as trilhas moravam no mesmo pipeline, "Apresentação de Proposta"
   * era a MESMA coluna nas duas — "Aprovados" no Interno, "Apresentação" no
   * Externo —, e o mesmo card era contado duas vezes. Agora cada funil tem a
   * sua, e a contagem por trilha fecha com a do topo.
   */
  it('nenhum status_id aparece nas abas das duas', () => {
    const ids = (sub: 'interno' | 'externo') =>
      new Set(
        abasDoFunil(
          sub === 'interno' ? FUNIL_PRECATORIO : FUNIL_PRECATORIO_EXTERNO,
          espelho(),
          sub,
        ).flatMap((a) => a.statusIds),
      )
    const interno = ids('interno')
    const externo = ids('externo')
    expect([...interno].filter((id) => externo.has(id))).toEqual([])
  })
})

describe('coluna renomeada no Kommo', () => {
  // O modo de falha do vínculo por nome, e o que impede que ele passe calado.
  const renomeado = espelho(
    COLUNAS_INTERNO.map((n) => (n === 'Revisão (TIER 1)' ? 'Revisão TIER 1' : n)),
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

  it('também é denunciada no funil novo do Externo', () => {
    const torto = espelho(
      COLUNAS_INTERNO,
      COLUNAS_EXTERNO.map((n) => (n === 'FECHADOS' ? 'FECHADO' : n)),
    )
    const faltando = colunasPrecatorioDesalinhadas(torto, 'externo')
    expect(faltando.map((a) => a.colunaKommo)).toEqual(['FECHADOS'])
  })

  it('não acusa nada quando o espelho ainda não chegou', () => {
    // Espelho vazio é "não sei ainda", não "está errado".
    expect(colunasPrecatorioDesalinhadas([])).toEqual([])
  })

  /**
   * ESPELHO DE UMA TRILHA SÓ NÃO ACUSA A OUTRA.
   *
   * Com as trilhas em funis diferentes, o espelho de uma pode chegar antes do da
   * outra — e acusar a que ainda não sincronizou seria apontar defeito onde só
   * falta dado. Este é o caso que não existia enquanto havia um funil só.
   */
  it('funil ainda não espelhado não é tratado como desalinhado', () => {
    const soInterno = colunasDe(FUNIL_PRECATORIO, COLUNAS_INTERNO, 90_000)
    expect(colunasPrecatorioDesalinhadas(soInterno, 'externo')).toEqual([])
    expect(colunasPrecatorioDesalinhadas(soInterno)).toEqual([])
  })
})

describe('acento, caixa e espaço não quebram o casamento', () => {
  it('casa a coluna escrita sem acento e em caixa alta', () => {
    const torto = espelho(
      COLUNAS_INTERNO.map((n) =>
        n === 'Análise Jurídica (TIER 1)' ? 'ANALISE  JURIDICA (TIER 1)' : n,
      ),
    )
    expect(colunasPrecatorioDesalinhadas(torto, 'interno')).toEqual([])
  })

  // O funil novo escreve tudo em caixa alta e a plataforma fixa o mesmo texto;
  // se um dia o Kommo voltar à caixa mista, nada pode quebrar.
  it('casa a coluna do funil novo escrita em caixa mista', () => {
    const torto = espelho(
      COLUNAS_INTERNO,
      COLUNAS_EXTERNO.map((n) => (n === 'REPROVADOS' ? 'Reprovados' : n)),
    )
    expect(colunasPrecatorioDesalinhadas(torto, 'externo')).toEqual([])
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
    // 6 abas do Interno + 7 do Externo, e nada compartilhado desde a separação.
    expect(ids.size).toBe(13)
  })

  it('a união vale seja qual for o funil de precatório perguntado', () => {
    // O parâmetro é o funil que a TELA tem aberto no topo. Como o precatório é
    // um tipo só para quem olha, os dois funis respondem a mesma união.
    const etapas = espelho()
    expect(statusExibidos(FUNIL_PRECATORIO_EXTERNO, etapas)).toEqual(
      statusExibidos(FUNIL_PRECATORIO, etapas),
    )
  })

  it('não inclui coluna do kanban que não é do operacional', () => {
    // É o defeito que o número antigo tinha: contava o funil inteiro, então o
    // total de cima nunca fechava com a soma das pílulas de baixo.
    const etapas = espelho()
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    expect(ids.has(idDe('Nutrição', etapas))).toBe(false)
    expect(ids.has(idDe('Venda ganha', etapas))).toBe(false)
    expect(ids.has(idDe('MEMORANDO DE NEGOCIAÇÃO', etapas))).toBe(false)
    expect(ids.has(idDe('AGUARDANDO PRECIFICAÇÃO', etapas))).toBe(false)
  })

  it('a soma das pílulas fecha com o número do tipo de crédito', () => {
    // A invariante que o usuário vê: o número de cima é a soma dos de baixo.
    // AGORA ELA FECHA POR TRILHA TAMBÉM — antes não fechava, porque uma coluna
    // servia às duas e era contada duas vezes.
    const etapas = espelho()
    const leads = [
      lead(idDe('Análise Jurídica (TIER 1)', etapas), 1),
      lead(idDe('Revisão (TIER 1)', etapas), 2),
      lead(idDe('QUALIFICAÇÃO PRELIMINAR', etapas), 3, FUNIL_PRECATORIO_EXTERNO),
      lead(idDe('FECHADOS', etapas), 4, FUNIL_PRECATORIO_EXTERNO),
      lead(idDe('Nutrição', etapas), 5), // fora das trilhas: não conta
    ]
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    expect(leads.filter((l) => ids.has(l.status_id)).length).toBe(4)

    const somaDe = (sub: 'interno' | 'externo') => {
      const { porAba } = agruparPorAba(
        leads,
        abasDoFunil(
          sub === 'interno' ? FUNIL_PRECATORIO : FUNIL_PRECATORIO_EXTERNO,
          etapas,
          sub,
        ),
      )
      return Object.values(porAba).reduce((t, l) => t + l.length, 0)
    }
    expect(somaDe('interno')).toBe(2)
    expect(somaDe('externo')).toBe(2)
    expect(somaDe('interno') + somaDe('externo')).toBe(4)
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
    const abas = abasDoFunil(FUNIL_RPV, espelho(), 'externo')
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

describe('ehCardExterno', () => {
  /**
   * A DESTINAÇÃO SAI DO CARD, não da pílula aberta.
   *
   * A subdivisão é um recorte da TELA. Se a due diligence perguntasse a ela,
   * alternar Interno/Externo atrás de uma janela aberta trocaria as frentes da
   * diligência em curso — a aba de certidões aparecendo e sumindo enquanto
   * alguém preenche o formulário.
   *
   * QUEM RESPONDE AGORA É O FUNIL, e não mais um conjunto de colunas resolvido
   * pelo nome: com um pipeline por trilha a resposta é exata e não depende de o
   * espelho ter chegado.
   */
  it('card do funil externo é externo', () => {
    expect(ehCardExterno(FUNIL_PRECATORIO_EXTERNO)).toBe(true)
  })

  it('card do funil interno não é', () => {
    expect(ehCardExterno(FUNIL_PRECATORIO)).toBe(false)
  })

  it('funil que não é de precatório não é', () => {
    expect(ehCardExterno(FUNIL_RPV)).toBe(false)
    expect(ehCardExterno(999)).toBe(false)
  })
})

describe('ABAS_EXTERNO_SEM_TRABALHO', () => {
  /**
   * As abas do Externo onde o trabalho da casa já passou — apresentação,
   * fechado, em diligência, reprovado. A tela as usa para esconder os botões;
   * chave escrita errada aqui faria o botão reaparecer na aba errada, sem erro.
   */
  it('toda chave listada existe entre as abas do Externo', () => {
    const externo = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'externo')!
    const chaves = new Set(externo.abas.map((a) => a.key))
    for (const k of ABAS_EXTERNO_SEM_TRABALHO) {
      expect(chaves.has(k), k).toBe(true)
    }
  })

  it('deixa de fora as três abas onde o trabalho acontece', () => {
    for (const k of ['ext-qualificacao', 'ext-revisao', 'ext-encaminhar']) {
      expect(ABAS_EXTERNO_SEM_TRABALHO.has(k), k).toBe(false)
    }
  })
})

describe('acaoDeReprovar', () => {
  /**
   * A RECUSA DA JANELA DE DUE DILIGENCE não segue o mapa das etapas.
   *
   * As ações de uma aba são as saídas daquela ETAPA: existem onde o trabalho
   * acontece e somem nas terminais. A recusa por diligência nasce do que a
   * apuração achou, e a apuração pode acontecer em qualquer card — inclusive na
   * trilha Externa, que não tem desfecho nenhum e deixava a janela achando
   * execução contra o cedente sem oferecer como recusar.
   */
  it('no interno, resolve a coluna pelo nome no espelho', () => {
    const a = acaoDeReprovar(FUNIL_PRECATORIO, espelho())
    expect(a?.statusId).toBe(idDe('Reprovados Operacional'))
    expect(a?.papel).toBe('reprovar')
  })

  /**
   * O NOME MUDOU NO FUNIL NOVO, e é por isso que cada trilha nomeia a sua
   * coluna: "Reprovados Operacional" virou "REPROVADOS". Um nome só, fixo no
   * arquivo, mandaria o botão procurar coluna inexistente — e sem coluna não há
   * botão, então a recusa sumiria da tela sem erro nenhum.
   */
  it('no externo, resolve a coluna com o nome do funil novo', () => {
    const a = acaoDeReprovar(FUNIL_PRECATORIO_EXTERNO, espelho())
    expect(a?.statusId).toBe(idDe('REPROVADOS'))
    expect(a?.papel).toBe('reprovar')
  })

  it('em RPV, é a constante de sempre', () => {
    expect(acaoDeReprovar(FUNIL_RPV, espelho())?.statusId).toBe(ST_REPROVADO)
  })

  // Sem a coluna no espelho não há botão: melhor a janela sem recusa do que um
  // botão que move o card para lugar nenhum.
  it('sem a coluna no kanban, não há ação', () => {
    const sem = espelho(COLUNAS_INTERNO.filter((n) => n !== 'Reprovados Operacional'))
    expect(acaoDeReprovar(FUNIL_PRECATORIO, sem)).toBeNull()
    expect(acaoDeReprovar(FUNIL_PRECATORIO, [])).toBeNull()
    expect(acaoDeReprovar(FUNIL_PRECATORIO_EXTERNO, [])).toBeNull()
  })

  it('funil que não é do operacional não tem recusa', () => {
    expect(acaoDeReprovar(999, espelho())).toBeNull()
  })
})
