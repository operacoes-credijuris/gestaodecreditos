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
// próprios, uma de cada vez: o Externo em 14/09 e o Interno em 16/09. O funil
// antigo, que tinha as duas dentro, não é lido por nenhuma delas.
//
// AQUI TAMBÉM SE PROVA O QUE O SERVIDOR ACEITA. A Edge Function que move o card
// guardava uma lista própria de colunas de destino, e ela ficou para trás na
// migração: a tela oferecia saídas que o servidor recusava. Hoje as duas leem a
// mesma definição, e o teste `destinos que o servidor aceita` é o que impede a
// divergência de voltar.

import { describe, it, expect } from 'vitest'
import { normalizarBusca } from '@/lib/format'
import { destinosDaTrilha } from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import {
  ABA_ANALISE_INTERNA,
  ABA_APROVADOS_EXTERNO,
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
  ST_PROTOCOLO,
  ST_REPROVADO,
  abasDoFunil,
  agruparPorAba,
  dataDaEtapa,
  colunasPrecatorioDesalinhadas,
  statusExibidos,
  tomDaTag,
  type EtapaKommo,
} from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'

/**
 * As colunas do funil NOVO do Interno, como o Kommo as devolveu.
 *
 * EM CAIXA ALTA PORQUE É ASSIM QUE ESTÃO LÁ. A etapa de entrada, "FECHADOS" e
 * "FORMALIZAÇÃO (CONTRATOS E ESCRITURA)" existem no kanban e NÃO viram aba, por
 * decisão de quem opera — são etapas do comercial. Ficam no espelho de propósito:
 * é o que garante que a ausência delas na tela se leia como escolha, e não como
 * coluna perdida no remapeamento.
 */
const COLUNAS_INTERNO = [
  'Etapa de leads de entrada',
  'ANÁLISE JURÍDICA E ECONÔMICA',
  'REVISÃO DA ANÁLISE',
  'PRODUÇÃO DE PROPOSTA',
  'FECHADOS',
  'FORMALIZAÇÃO (CONTRATOS E ESCRITURA)',
  'DILIGÊNCIA',
  'REPROVADOS',
  'PROTOCOLAR',
]

/**
 * As colunas do funil NOVO do Externo, como o Kommo as devolveu.
 *
 * EM CAIXA ALTA PORQUE É ASSIM QUE ESTÃO LÁ. "AGUARDANDO PRECIFICAÇÃO" existe
 * no kanban e NÃO vira aba, por decisão de quem opera — é espera pelo fundo, não
 * trabalho da casa. Fica no espelho de propósito: é o que garante que a ausência
 * dela na tela seja escolha, e não coluna perdida.
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
    pipeline_nome:
      pipelineId === FUNIL_PRECATORIO ? 'Funil Precatório Interno' : 'Funil Precatório Externo',
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

/**
 * O id de uma coluna, SEMPRE COM O FUNIL JUNTO.
 *
 * OS DOIS KANBANS REPETEM NOMES desde que o Interno migrou: "DILIGÊNCIA",
 * "REPROVADOS", "PRODUÇÃO DE PROPOSTA" e "FECHADOS" existem nos dois. Buscar só
 * pelo nome devolvia o id do primeiro funil da lista, e os testes do Externo
 * passariam a comparar com a coluna do Interno — exatamente o erro que a
 * produção não comete, porque lá a busca é escopada por pipeline.
 */
const idDe = (nome: string, etapas = espelho(), pipelineId = FUNIL_PRECATORIO) =>
  etapas.find((e) => e.pipeline_id === pipelineId && e.nome === nome)!.status_id

/** O mesmo, no funil do Externo. */
const idExt = (nome: string, etapas = espelho()) =>
  idDe(nome, etapas, FUNIL_PRECATORIO_EXTERNO)

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

  /**
   * A CHAVE QUE A TELA IMPORTA TEM DE EXISTIR NA TRILHA.
   *
   * O card dos Aprovados do Externo é o único que mostra as etiquetas do Kommo, e
   * ele reconhece a aba por esta constante. Renomear a chave na definição sem
   * mexer aqui faria as etiquetas sumirem da tela sem erro nenhum — que é a
   * família de defeito que este arquivo inteiro existe para pegar.
   */
  it('a chave dos Aprovados do Externo existe na trilha', () => {
    const externo = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'externo')!
    const aba = externo.abas.find((a) => a.key === ABA_APROVADOS_EXTERNO)
    expect(aba?.colunaKommo).toBe('ENCAMINHAR AOS FUNDOS')
    expect(aba?.label).toBe('Aprovados')
  })

  it('toda aba aponta para uma coluna que existe no kanban', () => {
    // O teste que pega erro de digitação no nome da coluna.
    expect(colunasPrecatorioDesalinhadas(espelho())).toEqual([])
  })
})

describe('abas do Interno', () => {
  const abas = abasDoFunil(FUNIL_PRECATORIO, espelho(), 'interno')

  it('mostra os seis rótulos da plataforma, na ordem do trabalho', () => {
    expect(abas.map((a) => a.label)).toEqual([
      'Análise',
      'Revisão',
      'Aprovados',
      'Diligência',
      'Reprovados',
      'p/ Protocolo',
    ])
  })

  it('cada rótulo resolve para a coluna certa do funil novo', () => {
    const porLabel = new Map(abas.map((a) => [a.label, a.statusIds[0]]))
    expect(porLabel.get('Análise')).toBe(idDe('ANÁLISE JURÍDICA E ECONÔMICA'))
    expect(porLabel.get('Revisão')).toBe(idDe('REVISÃO DA ANÁLISE'))
    expect(porLabel.get('Aprovados')).toBe(idDe('PRODUÇÃO DE PROPOSTA'))
    expect(porLabel.get('Diligência')).toBe(idDe('DILIGÊNCIA'))
    expect(porLabel.get('Reprovados')).toBe(idDe('REPROVADOS'))
    expect(porLabel.get('p/ Protocolo')).toBe(idDe('PROTOCOLAR'))
  })

  /**
   * DUAS COLUNAS VIRARAM UMA. O kanban antigo separava "Análise Jurídica (TIER
   * 1)" de "Análise Econômico-Financeira (TIER 1)", e a plataforma tinha uma aba
   * para cada. O funil novo as fundiu em "ANÁLISE JURÍDICA E ECONÔMICA" — e é
   * por isso que a aba de trabalho deixou de se chamar "Jurídico": o nome antigo
   * esconderia que a análise econômica também acontece nela.
   */
  it('a análise jurídica e a econômica moram na mesma aba', () => {
    expect(abas.find((a) => a.key === ABA_ANALISE_INTERNA)!.label).toBe('Análise')
    expect(abas.map((a) => a.label)).not.toContain('Precificação')
  })

  /**
   * O CAMINHO POSITIVO TEM DOIS PASSOS, como no Externo: quem analisa passa
   * adiante, quem revisa aprova. A mesma palavra em botões diferentes significa
   * destinos diferentes, e é a ETAPA que diz qual — por isso `aprovaPara` é da
   * aba e não da trilha.
   */
  it('a análise envia para revisão; a revisão aprova', () => {
    const emAnalise = abas.find((a) => a.label === 'Análise')!
    const daAnalise = emAnalise.acoes.find((x) => x.papel === 'aprovar')!
    expect(daAnalise.label).toBe('Enviar para revisão')
    expect(daAnalise.variant).toBe('secondary')
    expect(daAnalise.statusId).toBe(idDe('REVISÃO DA ANÁLISE'))

    const revisao = abas.find((a) => a.label === 'Revisão')!
    const daRevisao = revisao.acoes.find((x) => x.papel === 'aprovar')!
    expect(daRevisao.label).toBe('Aprovar crédito')
    expect(daRevisao.variant).toBe('primary')
    expect(daRevisao.statusId).toBe(idDe('PRODUÇÃO DE PROPOSTA'))
  })

  it('as duas abas de decisão também interrompem', () => {
    for (const label of ['Análise', 'Revisão']) {
      const aba = abas.find((a) => a.label === label)!
      expect(aba.acoes.map((x) => x.papel), label).toEqual([
        'aprovar',
        'diligenciar',
        'reprovar',
      ])
      expect(aba.acoes.find((x) => x.papel === 'diligenciar')!.statusId, label).toBe(
        idDe('DILIGÊNCIA'),
      )
      expect(aba.acoes.find((x) => x.papel === 'reprovar')!.statusId, label).toBe(
        idDe('REPROVADOS'),
      )
      // A janela de Concluir é o único lugar onde a anotação que vai para o
      // Kommo é escrita ANTES de o card se mover.
      expect(aba.desfechoAgrupado, label).toBe(true)
    }
  })

  // Das terminais o card não volta pelo app: de Aprovados e Reprovados não se
  // sai, a diligência quem devolve é o comercial, e o protocolo é dele também.
  it('as abas terminais não oferecem desfecho', () => {
    for (const label of ['Aprovados', 'Diligência', 'Reprovados', 'p/ Protocolo']) {
      const aba = abas.find((a) => a.label === label)!
      expect(aba.acoes, label).toEqual([])
      expect(aba.desfechoAgrupado, label).toBe(false)
    }
  })

  // O ID VEM DO ESPELHO, e coluna que ele não tem não vira botão: melhor a aba
  // sem desfecho do que um botão que move o card para lugar nenhum.
  it('sem a coluna no kanban, o botão não aparece', () => {
    const semReprovados = espelho(COLUNAS_INTERNO.filter((n) => n !== 'REPROVADOS'))
    const emAnalise = abasDoFunil(FUNIL_PRECATORIO, semReprovados, 'interno').find(
      (a) => a.label === 'Análise',
    )!
    expect(emAnalise.acoes.map((x) => x.papel)).toEqual(['aprovar', 'diligenciar'])
  })

  // AS COLUNAS DO COMERCIAL FICAM FORA, e a ausência é escolha de quem opera:
  // fechados, formalização e a etapa de entrada existem no kanban e não são
  // trabalho do operacional.
  it('as colunas do comercial não viram aba', () => {
    for (const fora of [
      'FECHADOS',
      'FORMALIZAÇÃO (CONTRATOS E ESCRITURA)',
      'Etapa de leads de entrada',
    ]) {
      expect(abas.some((a) => a.statusIds[0] === idDe(fora)), fora).toBe(false)
    }
  })
})

/**
 * A LISTA DE PERMISSÃO DO SERVIDOR sai da mesma definição que desenha os botões.
 *
 * ELA JÁ FOI ESCRITA À MÃO dentro da Edge Function `kommo-mover`, com dois nomes
 * do funil antigo. Quando as trilhas migraram para pipelines próprios, a tela
 * passou a oferecer saídas que o servidor recusava com "Coluna de destino não
 * reconhecida": o botão existia, o card não se movia, e nada no caminho dizia
 * que a causa eram duas listas que precisavam concordar e não concordavam.
 */
describe('destinos que o servidor aceita', () => {
  const colunaDoId = new Map(espelho().map((e) => [e.status_id, e.nome]))

  it('cobre toda saída que a tela oferece, nas duas trilhas', () => {
    for (const trilha of SUBDIVISOES_PRECATORIO) {
      const permitidos = destinosDaTrilha(trilha.pipelineId).map(normalizarBusca)
      for (const aba of abasDoFunil(trilha.pipelineId, espelho(), trilha.key)) {
        for (const acao of aba.acoes) {
          expect(
            permitidos,
            `${trilha.label} · ${aba.label} · ${acao.label}`,
          ).toContain(normalizarBusca(colunaDoId.get(acao.statusId)!))
        }
      }
    }
  })

  // A RECUSA NASCE EM QUALQUER CARD, e não numa etapa: ela vem do que a
  // diligência achou. Se o servidor não a aceitasse, a janela ofereceria um
  // botão de reprovar que não reprova.
  it('a recusa da janela de due diligence também é aceita', () => {
    for (const trilha of SUBDIVISOES_PRECATORIO) {
      const acao = acaoDeReprovar(trilha.pipelineId, espelho())!
      expect(destinosDaTrilha(trilha.pipelineId).map(normalizarBusca), trilha.label).toContain(
        normalizarBusca(colunaDoId.get(acao.statusId)!),
      )
    }
  })

  it('funil que não é de precatório não tem destino nenhum', () => {
    expect(destinosDaTrilha(FUNIL_RPV)).toEqual([])
    expect(destinosDaTrilha(999)).toEqual([])
  })

  // UM statusId SOLTO NO CORPO DA REQUISIÇÃO moveria o card para uma coluna do
  // comercial. A lista é de desfechos, e só.
  it('não aceita coluna que não é desfecho', () => {
    const permitidos = destinosDaTrilha(FUNIL_PRECATORIO).map(normalizarBusca)
    for (const fora of ['FECHADOS', 'PROTOCOLAR', 'Etapa de leads de entrada']) {
      expect(permitidos, fora).not.toContain(normalizarBusca(fora))
    }
  })
})

describe('abas da trilha Externa', () => {
  const abas = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, espelho(), 'externo')

  it('mostra os oito rótulos da plataforma, na ordem da trilha', () => {
    expect(abas.map((a) => a.label)).toEqual([
      'Qualificação',
      'Revisão',
      'Memorando',
      'Aprovados',
      'Diligência',
      'Reprovados',
      'Proposta',
      'Fechados',
    ])
  })

  it('cada rótulo resolve para a coluna certa do funil novo', () => {
    const porLabel = new Map(abas.map((a) => [a.label, a.statusIds[0]]))
    // O RÓTULO NOMEIA A ETAPA, a coluna diz o trabalho: "Qualificação" na
    // plataforma, "QUALIFICAÇÃO PRELIMINAR" no kanban.
    expect(porLabel.get('Qualificação')).toBe(idExt('QUALIFICAÇÃO PRELIMINAR'))
    expect(porLabel.get('Revisão')).toBe(idExt('REVISÃO DA QUALIFICAÇÃO'))
    expect(porLabel.get('Memorando')).toBe(idExt('MEMORANDO DE NEGOCIAÇÃO'))
    // "APROVADOS" AQUI, "ENCAMINHAR AOS FUNDOS" LÁ: o rótulo é o vocabulário de
    // quem analisa, o nome da coluna é o do comercial. O teste guarda os dois
    // lados justamente porque eles divergem de propósito.
    expect(porLabel.get('Aprovados')).toBe(idExt('ENCAMINHAR AOS FUNDOS'))
    expect(porLabel.get('Diligência')).toBe(idExt('DILIGÊNCIA'))
    expect(porLabel.get('Reprovados')).toBe(idExt('REPROVADOS'))
    expect(porLabel.get('Proposta')).toBe(idExt('PRODUÇÃO DE PROPOSTA'))
    expect(porLabel.get('Fechados')).toBe(idExt('FECHADOS'))
  })

  /**
   * A COLUNA QUE FICOU DE FORA, e ficou por decisão.
   *
   * "AGUARDANDO PRECIFICAÇÃO" existe no kanban e não vira aba: é espera pelo
   * fundo, e não trabalho da casa. O teste não afirma que isso é certo — afirma
   * que é DELIBERADO: se um dia alguém a espelhar, este teste cai e obriga a
   * decisão a ser tomada de novo, em vez de entrar de carona.
   *
   * FOI ASSIM QUE O MEMORANDO ENTROU: ele estava nesta lista, o teste caiu, e a
   * inclusão passou por uma decisão em vez de por um descuido.
   */
  it('a precificação do fundo não vira aba', () => {
    expect(abas).toHaveLength(8)
    const externo = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'externo')!
    const nomes = externo.abas.map((a) => a.colunaKommo)
    expect(nomes).not.toContain('AGUARDANDO PRECIFICAÇÃO')
  })

  // ETAPA DE TRABALHO, NÃO DE DECISÃO. A Revisão passou a MANDAR cards para cá
  // ("Pedir memorando"), mas a volta continua sendo do Kommo, por decisão de quem
  // opera: pronto o memorando, quem move o card é quem o escreveu.
  it('o Memorando não oferece desfecho', () => {
    const memorando = abas.find((a) => a.label === 'Memorando')!
    expect(memorando.acoes).toEqual([])
    expect(memorando.desfechoAgrupado).toBe(false)
  })

  /** As duas etapas em que a casa decide algo — as demais são de espera. */
  const DECISORIAS = ['Qualificação', 'Revisão']

  /**
   * O DESFECHO DO EXTERNO MORA NAS DUAS ETAPAS DE DECISÃO.
   *
   * A qualificação é dos analistas e a revisão é de quem decide — são os dois
   * pontos em que a casa diz alguma coisa sobre o crédito. Depois de encaminhado
   * quem move o card é o fundo, e o parecer é dele: oferecer desfecho adiante
   * seria decidir no lugar de quem decide.
   */
  it('a Qualificação oferece as três saídas', () => {
    const qualificacao = abas.find((a) => a.label === 'Qualificação')!
    expect(qualificacao.acoes.map((x) => x.papel)).toEqual([
      'aprovar',
      'diligenciar',
      'reprovar',
    ])
    const porPapel = new Map(qualificacao.acoes.map((a) => [a.papel, a.statusId]))
    // APROVAR AQUI E PEDIR REVISAO, e nao encaminhar ao fundo: quem trabalha
    // nesta etapa sao os analistas, e a decisao de mandar o credito para fora e
    // de quem revisa. Interromper — diligencia e recusa — passa direto.
    expect(porPapel.get('aprovar')).toBe(idExt('REVISÃO DA QUALIFICAÇÃO'))
    expect(porPapel.get('diligenciar')).toBe(idExt('DILIGÊNCIA'))
    expect(porPapel.get('reprovar')).toBe(idExt('REPROVADOS'))
  })

  /**
   * NEM TODO "SEGUIR" É UM "APROVAR".
   *
   * Na qualificação a saída positiva manda o crédito para a REVISÃO de outra
   * pessoa: não se aprovou nada ainda, apenas se passou adiante. O rótulo diz
   * isso e o tom é neutro — no azul da aprovação, o botão de quem analisa teria
   * o peso do de quem decide.
   */
  it('a saída positiva da Qualificação envia para revisão, em tom neutro', () => {
    const qualificacao = abas.find((a) => a.label === 'Qualificação')!
    const aprovar = qualificacao.acoes.find((x) => x.papel === 'aprovar')!
    expect(aprovar.label).toBe('Enviar para revisão')
    expect(aprovar.variant).toBe('secondary')
  })

  /**
   * NA REVISÃO A APROVAÇÃO ENCAMINHA DE VERDADE — é a segunda leitura, e depois
   * dela não há terceira. As outras duas saídas são as mesmas: quem revisa
   * também pode exigir diligência ou recusar.
   */
  it('a Revisão oferece quatro saídas, e aprova para os fundos', () => {
    const revisao = abas.find((a) => a.label === 'Revisão')!
    expect(revisao.acoes.map((x) => x.papel)).toEqual([
      'aprovar',
      'validar',
      'diligenciar',
      'reprovar',
    ])
    const porLabel = new Map(revisao.acoes.map((a) => [a.label, a.statusId]))
    expect(porLabel.get('Aprovar crédito')).toBe(idExt('ENCAMINHAR AOS FUNDOS'))
    expect(porLabel.get('Exigir diligência')).toBe(idExt('DILIGÊNCIA'))
    expect(porLabel.get('Reprovar crédito')).toBe(idExt('REPROVADOS'))
  })

  /**
   * PEDIR MEMORANDO NÃO É APROVAR NEM RECUSAR.
   *
   * O crédito não foi recusado e ainda não vai ao fundo: falta uma peça, e ela é
   * trabalho da casa — o caso do valor alto ou do originador sem vínculo direto.
   * O papel é `validar`, o mesmo de "Enviar para revisão" no RPV: passa adiante
   * para outra etapa de trabalho sem dizer nada sobre o mérito. É o papel que
   * decide o ícone, se o motivo é exigido e o tom que a IA usa na anotação —
   * marcá-lo como aprovação faria a nota do Kommo anunciar um encaminhamento que
   * não aconteceu.
   */
  it('a Revisão pode pedir o memorando, ao lado de aprovar', () => {
    const revisao = abas.find((a) => a.label === 'Revisão')!
    const memorando = revisao.acoes.find((x) => x.label === 'Pedir memorando')!
    expect(memorando.statusId).toBe(idExt('MEMORANDO DE NEGOCIAÇÃO'))
    expect(memorando.papel).toBe('validar')
    expect(memorando.variant).toBe('secondary')
    // AO LADO DE APROVAR, e logo depois: a ordem dos botões é a ordem das saídas
    // declaradas na etapa, e a aprovação é o caminho que se busca.
    expect(revisao.acoes.map((x) => x.label).slice(0, 2)).toEqual([
      'Aprovar crédito',
      'Pedir memorando',
    ])
  })

  /**
   * AQUI O RÓTULO NÃO DIZ O DESTINO, e é de propósito: o derivado sairia
   * "Aprovar e enviar para Aprovados", que gagueja e não informa nada. O nome do
   * destino só precisa ser dito quando ele SURPREENDE — como na qualificação,
   * onde aprovar manda para a revisão.
   */
  it('na Revisão é aprovação de verdade, e no azul da casa', () => {
    const revisao = abas.find((a) => a.label === 'Revisão')!
    const aprovar = revisao.acoes.find((x) => x.papel === 'aprovar')!
    expect(aprovar.label).toBe('Aprovar crédito')
    expect(aprovar.variant).toBe('primary')
  })

  it('as demais abas do Externo não oferecem desfecho', () => {
    for (const aba of abas.filter((a) => !DECISORIAS.includes(a.label))) {
      expect(aba.acoes, aba.label).toEqual([])
    }
  })

  /**
   * AS TRÊS SAEM DE UM BOTÃO SÓ. A análise acontece fora da plataforma, numa
   * conversa com o Claude; três botões soltos no card convidariam o clique antes
   * do texto, e o texto é o único registro que aquela análise deixa no CRM.
   */
  it('as duas etapas de decisão marcam o desfecho como agrupado', () => {
    for (const aba of abas) {
      expect(aba.desfechoAgrupado, aba.label).toBe(DECISORIAS.includes(aba.label))
    }
  })

  // Sem a coluna no espelho não há saída: melhor a janela com duas do que um
  // botão que move o card para lugar nenhum.
  it('saída sem coluna no kanban simplesmente não aparece', () => {
    const sem = espelho(
      COLUNAS_INTERNO,
      COLUNAS_EXTERNO.filter((n) => n !== 'REVISÃO DA QUALIFICAÇÃO'),
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
    COLUNAS_INTERNO.map((n) => (n === 'REVISÃO DA ANÁLISE' ? 'REVISÃO DA ANALISE FEITA' : n)),
  )

  it('é denunciada, com o nome que se esperava', () => {
    const faltando = colunasPrecatorioDesalinhadas(renomeado, 'interno')
    expect(faltando.map((a) => a.colunaKommo)).toEqual(['REVISÃO DA ANÁLISE'])
    expect(faltando.map((a) => a.label)).toEqual(['Revisão'])
  })

  it('deixa a aba na tela, vazia, em vez de sumir com ela', () => {
    // Sumir com a aba esconderia o defeito: a pessoa veria cinco abas onde a
    // regra diz seis e não teria como saber qual faltou.
    const abas = abasDoFunil(FUNIL_PRECATORIO, renomeado, 'interno')
    expect(abas).toHaveLength(6)
    expect(abas.find((a) => a.label === 'Revisão')!.statusIds).toEqual([])
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
        lead(idDe('ANÁLISE JURÍDICA E ECONÔMICA', etapas), 1),
        lead(idDe('FECHADOS', etapas), 2),
        lead(idDe('FORMALIZAÇÃO (CONTRATOS E ESCRITURA)', etapas), 3),
      ],
      abas,
    )
    expect(porAba[ABA_ANALISE_INTERNA].map((l) => l.kommo_lead_id)).toEqual([1])
    // A ORDEM AQUI NAO E O ASSUNTO: cada coluna passou a sair do mais novo para
    // o mais antigo, e o que este teste guarda e o particionamento.
    expect([...outras.map((l) => l.kommo_lead_id)].sort((a, b) => a - b)).toEqual([2, 3])
  })
})

/**
 * A ORDEM DENTRO DA COLUNA, e a data que a decide.
 *
 * A pergunta de quem abre a tela é há quanto tempo um crédito está parado
 * naquela etapa. Nenhum campo do card do Kommo responde isso: `created_at` é o
 * nascimento — um card de março movido ontem erra por cinco meses — e
 * `updated_at` muda quando alguém troca uma tag. A resposta vem do evento
 * `lead_status_changed`, que o kommo-sync grava em `etapa_em`.
 */
describe('a ordem dentro da coluna', () => {
  const etapas = espelho()
  const abas = abasDoFunil(FUNIL_PRECATORIO, etapas, 'interno')
  const juridico = idDe('ANÁLISE JURÍDICA E ECONÔMICA', etapas)
  const naColuna = (
    id: number,
    etapa_em: string | null,
    extras: Partial<KommoLead> = {},
  ): KommoLead =>
    ({
      ...lead(juridico, id),
      etapa_em,
      etapa_status_id: juridico,
      criado_em: null,
      ...extras,
    }) as KommoLead

  it('o mais recente vem primeiro', () => {
    const { porAba } = agruparPorAba(
      [
        naColuna(1, '2026-09-01T10:00:00Z'),
        naColuna(2, '2026-09-14T10:00:00Z'),
        naColuna(3, '2026-09-08T10:00:00Z'),
      ],
      abas,
    )
    expect(porAba[ABA_ANALISE_INTERNA].map((l) => l.kommo_lead_id)).toEqual([2, 3, 1])
  })

  /**
   * A DATA SÓ VALE PARA A COLUNA EM QUE FOI APURADA.
   *
   * Entre uma sincronização e outra alguém move o card no Kommo. Sem comparar
   * `etapa_status_id` com `status_id`, a tela exibiria com toda a confiança há
   * quanto tempo o card está num lugar onde ele já não está — e o erro seria
   * invisível, porque data errada tem a mesma cara de data certa.
   */
  it('data de outra coluna não é exibida', () => {
    const mudouDeColuna = naColuna(1, '2026-09-14T10:00:00Z', { etapa_status_id: 999 })
    expect(dataDaEtapa(mudouDeColuna)).toBeNull()
    expect(dataDaEtapa(naColuna(2, '2026-09-14T10:00:00Z'))).toBe('2026-09-14T10:00:00Z')
    expect(dataDaEtapa(naColuna(3, null))).toBeNull()
  })

  // CARD SEM DATA APURADA NÃO AFUNDA. Ele cairia para o fim da lista com zero —
  // o pior lugar para um card que pode ter chegado hoje —, e a data de criação
  // erra por pouco e na direção certa.
  it('sem data apurada, a criação segura a posição', () => {
    const { porAba } = agruparPorAba(
      [
        naColuna(1, '2026-09-10T10:00:00Z'),
        naColuna(2, null, { criado_em: '2026-09-15T10:00:00Z' }),
        naColuna(3, null, { criado_em: '2026-09-02T10:00:00Z' }),
      ],
      abas,
    )
    expect(porAba[ABA_ANALISE_INTERNA].map((l) => l.kommo_lead_id)).toEqual([2, 1, 3])
  })

  // Empate pelo id, que também cresce no tempo: dois cards movidos no mesmo
  // instante (uma movimentação em lote) não podem trocar de lugar a cada render.
  it('empate desempata pelo id, do maior para o menor', () => {
    const { porAba } = agruparPorAba(
      [naColuna(7, '2026-09-10T10:00:00Z'), naColuna(9, '2026-09-10T10:00:00Z')],
      abas,
    )
    expect(porAba[ABA_ANALISE_INTERNA].map((l) => l.kommo_lead_id)).toEqual([9, 7])
  })
})

describe('statusExibidos — o número ao lado do tipo de crédito', () => {
  it('no Precatório, é a UNIÃO das duas trilhas, não a trilha aberta', () => {
    // O número descreve o FUNIL: trocar de destinação não muda quantos
    // precatórios existem. Se mudasse, se leria como dado mudando.
    const etapas = espelho()
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    // 6 abas do Interno + 8 do Externo, e nada compartilhado desde a separação.
    expect(ids.size).toBe(14)
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
    expect(ids.has(idDe('FECHADOS', etapas))).toBe(false)
    expect(ids.has(idDe('FORMALIZAÇÃO (CONTRATOS E ESCRITURA)', etapas))).toBe(false)
    expect(ids.has(idDe('Etapa de leads de entrada', etapas))).toBe(false)
    expect(ids.has(idExt('AGUARDANDO PRECIFICAÇÃO', etapas))).toBe(false)
  })

  it('a soma das pílulas fecha com o número do tipo de crédito', () => {
    // A invariante que o usuário vê: o número de cima é a soma dos de baixo.
    // AGORA ELA FECHA POR TRILHA TAMBÉM — antes não fechava, porque uma coluna
    // servia às duas e era contada duas vezes.
    const etapas = espelho()
    const leads = [
      lead(idDe('ANÁLISE JURÍDICA E ECONÔMICA', etapas), 1),
      lead(idDe('REVISÃO DA ANÁLISE', etapas), 2),
      lead(idExt('QUALIFICAÇÃO PRELIMINAR', etapas), 3, FUNIL_PRECATORIO_EXTERNO),
      lead(idExt('FECHADOS', etapas), 4, FUNIL_PRECATORIO_EXTERNO),
      // Formalização é coluna do comercial: fora das trilhas, não conta.
      lead(idDe('FORMALIZAÇÃO (CONTRATOS E ESCRITURA)', etapas), 5),
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

  it('em RPV, são os seis status curados', () => {
    expect(statusExibidos(FUNIL_RPV, espelho())).toEqual(
      new Set([ST_ANALISE, ST_DECISAO, ST_PROPOSTA, ST_DILIGENCIA, ST_REPROVADO, ST_PROTOCOLO]),
    )
  })

  it('devolve vazio para funil desconhecido', () => {
    expect(statusExibidos(999, espelho()).size).toBe(0)
  })
})

describe('RPV não é afetado pela subdivisão', () => {
  it('devolve as seis telas curadas, com os botões de mover', () => {
    // A subdivisão é um eixo só do Precatório. Passá-la aqui não pode mudar nada.
    const abas = abasDoFunil(FUNIL_RPV, espelho(), 'externo')
    expect(abas.map((a) => a.label)).toEqual([
      'Análise',
      'Revisão',
      'Aprovados',
      'Diligência',
      'Reprovados',
      'p/ Protocolo',
    ])
    expect(abas.find((a) => a.label === 'Revisão')!.acoes).toHaveLength(3)
    // O protocolo é acompanhamento: o card chega ali depois de tudo o que a casa
    // decidiu, e quem o move de lá é quem protocola.
    expect(abas.find((a) => a.label === 'p/ Protocolo')!.acoes).toEqual([])
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
    expect(a?.statusId).toBe(idDe('REPROVADOS'))
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
    expect(a?.statusId).toBe(idExt('REPROVADOS'))
    expect(a?.papel).toBe('reprovar')
  })

  it('em RPV, é a constante de sempre', () => {
    expect(acaoDeReprovar(FUNIL_RPV, espelho())?.statusId).toBe(ST_REPROVADO)
  })

  // Sem a coluna no espelho não há botão: melhor a janela sem recusa do que um
  // botão que move o card para lugar nenhum.
  it('sem a coluna no kanban, não há ação', () => {
    const sem = espelho(COLUNAS_INTERNO.filter((n) => n !== 'REPROVADOS'))
    expect(acaoDeReprovar(FUNIL_PRECATORIO, sem)).toBeNull()
    expect(acaoDeReprovar(FUNIL_PRECATORIO, [])).toBeNull()
    expect(acaoDeReprovar(FUNIL_PRECATORIO_EXTERNO, [])).toBeNull()
  })

  it('funil que não é do operacional não tem recusa', () => {
    expect(acaoDeReprovar(999, espelho())).toBeNull()
  })
})

/**
 * A COR DA ETIQUETA, e por que ela precisa ser estável.
 *
 * Numa coluna de trinta créditos encaminhados, quem procura os de um fundo acha
 * pela mancha antes de ler o texto — mas só se a mesma etiqueta tiver sempre a
 * mesma cor. Sorteada a cada render, ou tirada da posição na lista, a cor vira
 * enfeite; e enfeite que muda a cada sincronização confunde em vez de ajudar.
 */
describe('tomDaTag', () => {
  it('a mesma etiqueta tem sempre a mesma cor', () => {
    expect(tomDaTag('Fundo Alfa')).toBe(tomDaTag('Fundo Alfa'))
    expect(tomDaTag('')).toBe(tomDaTag(''))
  })

  // VERDE E VERMELHO FICAM DE FORA: no card eles já significam análise pronta e
  // recusa, e uma etiqueta verde seria lida como estado do crédito.
  it('não usa as cores que já significam outra coisa no card', () => {
    for (const nome of ['Fundo Alfa', 'Beta', 'urgente', 'XP', 'a', 'zzz', '2026']) {
      expect(['blue', 'purple', 'orange'], nome).toContain(tomDaTag(nome))
    }
  })

  // Etiquetas diferentes não podem cair todas na mesma cor: com um punhado de
  // fundos, a paleta tem de se dividir.
  it('nomes diferentes se espalham pela paleta', () => {
    const nomes = ['Fundo Alfa', 'Fundo Beta', 'Fundo Gama', 'Fundo Delta', 'Fundo Épsilon']
    expect(new Set(nomes.map(tomDaTag)).size).toBeGreaterThan(1)
  })
})
