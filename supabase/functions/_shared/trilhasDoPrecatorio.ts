// AS DUAS TRILHAS DO PRECATÓRIO: que colunas do Kommo viram aba na plataforma, e
// para onde o app pode mover um card.
//
// POR QUE ISTO SAIU DE `src/lib/kommo.ts` E VIROU MÓDULO COMPARTILHADO. A tela
// montava os botões a partir desta lista, e a Edge Function `kommo-mover`
// guardava uma lista PRÓPRIA das colunas que aceita como destino — escrita à mão,
// com dois nomes do funil antigo. Quando o Externo migrou para o funil novo, a
// tela passou a oferecer quatro saídas ("Enviar para revisão", "Aprovar
// crédito", "Exigir diligência", "Reprovar") que o servidor recusava com
// "Coluna de destino não reconhecida": o botão existia, o card não se movia.
//
// Duas listas que precisam dizer a mesma coisa acabam divergindo — e esta
// divergiu no primeiro dia. Agora há uma só: a tela lê daqui para desenhar os
// botões, e o servidor lê daqui para decidir o que aceita. Acrescentar uma etapa
// decisória passa a ser uma linha, e não duas em arquivos distintos.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, então o mesmo arquivo roda no vitest
// do site, no navegador (importado por caminho relativo) e na Edge Function.

export type SubdivisaoPrecatorio = 'interno' | 'externo'

/**
 * O funil do Precatório INTERNO, criado em 14/09/2026 e espelhado em 16/09.
 *
 * O funil antigo (13971995) era um só, com as duas destinações dentro — e era
 * isso que obrigava a tela a adivinhar a trilha pelo NOME da coluna. Com um
 * pipeline por trilha, a pergunta é o pipeline do card, e pipeline não é ambíguo.
 */
export const FUNIL_PRECATORIO_INTERNO = 14439512

/** O funil do Precatório EXTERNO, criado no mesmo dia e espelhado em 14/09/2026. */
export const FUNIL_PRECATORIO_EXTERNO = 14439516

/** O tom do botão de uma saída — o mesmo vocabulário dos botões da plataforma. */
export type VarianteDeAcao = 'primary' | 'secondary' | 'success' | 'warning' | 'danger'

/**
 * O QUE A AÇÃO FAZ, independente de para qual coluna ela move.
 *
 * Existe porque o `statusId` não identifica o ato: as mesmas etapas têm ids
 * diferentes em cada funil, e comparar com uma constante responderia "não" para
 * todas — reprovar um precatório não pediria motivo, e a anotação sairia com o
 * tom errado. Silenciosamente.
 *
 * MORA AQUI, e não em `src/lib/kommo.ts`, porque as saídas de cada etapa moram
 * aqui: o papel é campo delas.
 */
export type PapelDaAcao = 'validar' | 'aprovar' | 'diligenciar' | 'reprovar'

/**
 * Uma saída positiva de uma etapa: para onde o card vai, e com que palavras.
 *
 * É UMA LISTA, E NÃO UM DESTINO SÓ, desde 16/09/2026. Eram três campos paralelos
 * — `aprovaPara`, `rotuloAprovar`, `varianteAprovar` — que só sabiam descrever
 * uma saída; a revisão do Externo passou a ter duas (encaminhar ao fundo, ou
 * pedir o memorando de negociação antes), e um quarto campo paralelo para a
 * segunda deixaria a definição ilegível.
 *
 * O PAPEL DIZ O ATO, e é ele que decide o ícone, se o motivo é exigido e o tom
 * que a IA usa ao redigir a anotação. "Pedir memorando" não aprova nem recusa:
 * manda o crédito para outra etapa de trabalho, que é o que `validar` significa
 * desde o RPV.
 */
export interface SaidaDaEtapa {
  /** O nome da coluna de destino no kanban do Kommo. */
  colunaKommo: string
  label: string
  variant?: VarianteDeAcao
  /** Omitido, é `aprovar` — a saída positiva é a regra, as outras a exceção. */
  papel?: PapelDaAcao
}

/**
 * Uma aba do Precatório: uma coluna do kanban, com o nome que a casa lhe dá.
 *
 * A LIGAÇÃO É PELO NOME DA COLUNA, e não pelo status_id. Os ids do Precatório não
 * existem em lugar nenhum do código: são lidos do espelho (migration 0044). Colar
 * aqui números copiados da URL do Kommo é o erro que aquela migration existe para
 * evitar — um dígito trocado aponta para outra coluna que também existe, e o card
 * vai parar nela sem erro nenhum.
 *
 * Coluna renomeada no Kommo aparece em `colunasPrecatorioDesalinhadas`: a tela diz
 * qual nome não encontrou, em vez de ficar vazia em silêncio. A comparação passa
 * por `normalizarBusca`, então acento, caixa e espaço a mais não quebram nada.
 */
export interface DefAbaPrecatorio {
  key: string
  /** Rótulo na plataforma — vocabulário nosso, não o do CRM do comercial. */
  label: string
  /** Nome da coluna no kanban do Kommo, como está escrito lá. */
  colunaKommo: string
  descricaoVazia: string
  /**
   * As saídas positivas desta etapa, na ordem em que os botões aparecem.
   *
   * SÃO DA ETAPA, E NÃO DA TRILHA, e a diferença é o fluxo de trabalho real: quem
   * está na primeira análise são os analistas, e a saída deles não encaminha nada
   * — manda para a REVISÃO de quem decide. A mesma palavra, "aprovar", significa
   * destinos diferentes conforme quem a aperta.
   *
   * Diligência e reprovação não seguem essa regra: elas interrompem, e
   * interromper leva sempre ao mesmo lugar (ver `colunaDiligencia` e
   * `colunaReprovados`, que são da trilha).
   *
   * É TAMBÉM O QUE DIZ QUE A ETAPA TEM DESFECHO. Aba sem saída não oferece botão
   * nenhum — é etapa de espera ou terminal, onde quem move o card é o comercial,
   * pelo Kommo.
   */
  saidas?: SaidaDaEtapa[]
  /**
   * Esta etapa pode INTERROMPER o crédito — exigir diligência ou recusar?
   *
   * OMITIDO, SIM: quase toda etapa de decisão interrompe, e diligência e recusa
   * levam sempre às colunas da trilha, sem a etapa precisar dizer para onde.
   *
   * FALSO NA QUALIFICAÇÃO DO EXTERNO, desde 21/09/2026 e por decisão de quem
   * opera: ali a saída é uma só, passar adiante. Recusar um crédito e mandá-lo
   * para diligência são decisões que a casa quer que passem pela REVISÃO — antes
   * elas saíam direto de quem analisa, sem segunda leitura, e a revisão só via o
   * que fora aprovado.
   */
  interrompe?: boolean
}

export interface DefSubdivisao {
  key: SubdivisaoPrecatorio
  label: string
  /**
   * O funil do Kommo de onde esta trilha lê.
   *
   * É PROPRIEDADE DA TRILHA, e não uma constante do arquivo, porque as duas
   * deixaram de morar no mesmo pipeline. É esta linha que sustenta a separação
   * sem nenhum ramo especial no código que a lê.
   */
  pipelineId: number
  /** A coluna de diligência desta trilha, pelo nome no kanban. */
  colunaDiligencia: string
  /** A coluna de reprovação desta trilha, pelo nome no kanban. */
  colunaReprovados: string
  abas: DefAbaPrecatorio[]
}

/**
 * A aba onde a análise do precatório INTERNO acontece.
 *
 * Exportada porque a TELA precisa reconhecê-la: é a única aba do precatório cujos
 * cards oferecem Due Diligence e Análise Jurídica. Comparar com uma string solta
 * espalharia a regra por dois arquivos, e renomear a chave aqui deixaria os
 * botões desaparecerem sem nenhum erro.
 *
 * O NOME MUDOU COM O FUNIL NOVO. Eram duas abas — "Jurídico" e "Precificação" —
 * porque eram duas colunas no kanban antigo; o funil de 14/09/2026 as fundiu numa
 * só, "ANÁLISE JURÍDICA E ECONÔMICA". Manter o nome antigo aqui esconderia que a
 * análise econômica também acontece nesta aba.
 */
export const ABA_ANALISE_INTERNA = 'int-analise'

/** A aba dos créditos que já foram encaminhados aos fundos, no Externo. */
export const ABA_APROVADOS_EXTERNO = 'ext-encaminhar'

/** A aba dos créditos recusados, no Externo. */
export const ABA_REPROVADOS_EXTERNO = 'ext-reprovados'

/**
 * A aba dos créditos que estão com o fundo, esperando preço.
 *
 * ELA FICOU FORA DA TELA ATÉ 21/09/2026, por decisão de quem opera: era espera
 * do fundo, não trabalho da casa. Passou a valer a pena ver — um crédito parado
 * ali é dinheiro esperando resposta de alguém, e quem acompanha precisa saber
 * quantos são.
 */
export const ABA_EM_PRECIFICACAO_EXTERNO = 'ext-precificacao'

/**
 * AS ABAS EM QUE O CARD MOSTRA AS ETIQUETAS DO KOMMO.
 *
 * As duas terminais do Externo, e não a tela toda. O espelho guarda as tags de
 * TODOS os cards — vêm de graça na listagem —, e mostrá-las em toda aba encheria
 * a fila de rótulo onde o que se procura é o processo. Nestas duas o quadro se
 * inverte: passado o trabalho, a etiqueta é o que resta dizendo PARA QUAL FUNDO
 * o crédito foi, ou por que ele não foi.
 *
 * É UM CONJUNTO, e não uma comparação solta na tela: renomear a chave de uma aba
 * aqui faria as etiquetas sumirem sem nenhum erro — a família de defeito que
 * este arquivo inteiro existe para evitar.
 */
export const ABAS_COM_TAGS: ReadonlySet<string> = new Set([
  ABA_APROVADOS_EXTERNO,
  // EM PRECIFICAÇÃO É ONDE A ETIQUETA MAIS IMPORTA: o crédito está com um fundo
  // específico, esperando o preço dele, e a etiqueta é o que diz com qual.
  ABA_EM_PRECIFICACAO_EXTERNO,
  ABA_REPROVADOS_EXTERNO,
])

/**
 * As colunas de cada destinação, cada uma no SEU funil.
 *
 * CADA TRILHA TEM O SEU PIPELINE desde 14/09/2026 — e é isso que desfez o pior
 * remendo daqui. Enquanto as duas moravam no mesmo funil, "Apresentação de
 * Proposta" era a MESMA coluna nas duas, com rótulo diferente em cada uma, e o
 * mesmo card era contado duas vezes. Agora cada funil tem a sua, e a ambiguidade
 * não existe mais: nada é compartilhado.
 *
 * A MIGRAÇÃO FOI UMA TRILHA POR VEZ, a pedido de quem opera: o Externo em 14/09 e
 * o Interno em 16/09/2026. O funil antigo não é lido por nenhuma das duas.
 *
 * A ordem das abas é a DO TRABALHO, não a do kanban. Mudar a ordem aqui muda a
 * ordem na tela, nada mais.
 */
export const TRILHAS_PRECATORIO: DefSubdivisao[] = [
  {
    key: 'interno',
    label: 'Interno',
    pipelineId: FUNIL_PRECATORIO_INTERNO,
    colunaDiligencia: 'DILIGÊNCIA',
    // "REPROVADOS", e não "Reprovados Operacional": o funil novo encurtou o
    // nome. Os dois funis novos usam o mesmo, e o antigo já não é lido.
    colunaReprovados: 'REPROVADOS',
    abas: [
      {
        key: ABA_ANALISE_INTERNA,
        // UMA PALAVRA, e a coluna do Kommo se chama "ANÁLISE JURÍDICA E
        // ECONÔMICA": o rótulo da plataforma nomeia a etapa, o nome do kanban
        // descreve o trabalho que acontece nela.
        label: 'Análise',
        colunaKommo: 'ANÁLISE JURÍDICA E ECONÔMICA',
        descricaoVazia: 'Nenhum precatório em análise.',
        // APROVAR AQUI É PEDIR REVISÃO, e não aprovar o crédito. Quem trabalha
        // nesta etapa são os analistas; a decisão é de quem revisa. Recusar e
        // exigir diligência passam direto — não precisam de segunda leitura.
        saidas: [
          { colunaKommo: 'REVISÃO DA ANÁLISE', label: 'Enviar para revisão', variant: 'secondary' },
        ],
      },
      {
        key: 'int-revisao',
        label: 'Revisão',
        colunaKommo: 'REVISÃO DA ANÁLISE',
        descricaoVazia: 'Nenhuma análise aguardando revisão.',
        // AQUI A APROVAÇÃO É DE VERDADE: é a segunda leitura, feita por quem
        // decide, e o crédito segue para a produção da proposta.
        saidas: [
          { colunaKommo: 'PRODUÇÃO DE PROPOSTA', label: 'Aprovar crédito', variant: 'primary' },
        ],
      },
      {
        key: 'int-aprovados',
        // "APROVADOS" NA PLATAFORMA, "PRODUÇÃO DE PROPOSTA" NO KOMMO — e é de
        // propósito, como no Externo. O rótulo daqui é o vocabulário de quem
        // analisa: o que o ato significa para a casa é uma aprovação. O nome do
        // kanban é o do comercial e diz o que acontece DEPOIS.
        label: 'Aprovados',
        colunaKommo: 'PRODUÇÃO DE PROPOSTA',
        descricaoVazia: 'Nenhum precatório aprovado.',
      },
      {
        key: 'int-diligencia',
        label: 'Diligência',
        colunaKommo: 'DILIGÊNCIA',
        descricaoVazia: 'Nenhum precatório interno em diligência.',
      },
      {
        key: 'int-reprovados',
        label: 'Reprovados',
        colunaKommo: 'REPROVADOS',
        descricaoVazia: 'Nenhum precatório interno reprovado.',
      },
      {
        key: 'int-protocolo',
        label: 'p/ Protocolo',
        colunaKommo: 'PROTOCOLAR',
        descricaoVazia: 'Nenhum precatório aguardando protocolo.',
      },
    ],
    // FORA DA TELA, por decisão de quem opera: "Etapa de leads de entrada",
    // "FECHADOS" e "FORMALIZAÇÃO (CONTRATOS E ESCRITURA)" existem no kanban e não
    // viram aba — são etapas do comercial, não do operacional. Ficam registradas
    // aqui para que a ausência se leia como escolha, e não como coluna esquecida
    // no remapeamento.
  },
  {
    key: 'externo',
    label: 'Externo',
    pipelineId: FUNIL_PRECATORIO_EXTERNO,
    colunaDiligencia: 'DILIGÊNCIA',
    colunaReprovados: 'REPROVADOS',
    abas: [
      {
        key: 'ext-qualificacao',
        // UMA PALAVRA, como a "Análise" do Interno: o rótulo nomeia a etapa e
        // "QUALIFICAÇÃO PRELIMINAR", no kanban, descreve o trabalho.
        label: 'Qualificação',
        colunaKommo: 'QUALIFICAÇÃO PRELIMINAR',
        descricaoVazia: 'Nenhum precatório em qualificação preliminar.',
        // UMA SAÍDA SÓ, e é o que esta etapa passou a ser: quem qualifica lê os
        // autos e passa adiante. Recusar e exigir diligência saíam daqui direto,
        // sem segunda leitura — e a revisão, que existe para ler o que a casa
        // decide, só via o que tinha sido aprovado. Agora tudo passa por ela.
        saidas: [
          { colunaKommo: 'REVISÃO DA QUALIFICAÇÃO', label: 'Enviar para revisão', variant: 'secondary' },
        ],
        interrompe: false,
      },
      {
        key: 'ext-revisao',
        label: 'Revisão',
        colunaKommo: 'REVISÃO DA QUALIFICAÇÃO',
        descricaoVazia: 'Nenhuma qualificação aguardando revisão.',
        // AQUI A APROVAÇÃO ENCAMINHA DE VERDADE. É a segunda leitura, feita por
        // quem decide; aprovada nela, o crédito segue para o fundo. As outras
        // duas saídas são as mesmas da qualificação — quem revisa também pode
        // exigir diligência ou recusar, e aí não há terceira leitura.
        saidas: [
          { colunaKommo: 'ENCAMINHAR AOS FUNDOS', label: 'Aprovar crédito', variant: 'primary' },
          {
            // PEDIR MEMORANDO NÃO É APROVAR NEM RECUSAR. O crédito não foi recusado
            // e ainda não vai ao fundo: falta uma peça, e ela é trabalho da casa —
            // é o caso do valor alto ou do originador sem vínculo direto. Por isso o
            // papel é `validar`, o mesmo de "Enviar para revisão" no RPV: passa
            // adiante para outra etapa de trabalho, sem decidir nada sobre o mérito.
            //
            // A ABA MEMORANDO CONTINUA SEM BOTÃO, por decisão de quem opera: pronto
            // o memorando, quem move o card de volta é o Kommo.
            colunaKommo: 'MEMORANDO DE NEGOCIAÇÃO',
            label: 'Pedir memorando',
            variant: 'secondary',
            papel: 'validar',
          },
        ],
      },
      {
        key: 'ext-memorando',
        // SEM DESFECHO, por ora: é etapa de trabalho, não de decisão. A saída
        // dela ainda não foi definida — e enquanto não for, a aba mostra os
        // cards e quem os move é o Kommo.
        label: 'Memorando',
        colunaKommo: 'MEMORANDO DE NEGOCIAÇÃO',
        descricaoVazia: 'Nenhum crédito em memorando de negociação.',
      },
      {
        key: ABA_APROVADOS_EXTERNO,
        // "APROVADOS" NA PLATAFORMA, "ENCAMINHAR AOS FUNDOS" NO KOMMO — e é de
        // propósito. O rótulo daqui é o vocabulário de quem analisa: o que o ato
        // significa para a casa é uma aprovação. O nome do kanban é o do
        // comercial, diz o que acontece DEPOIS, e não muda por causa disto.
        label: 'Aprovados',
        colunaKommo: 'ENCAMINHAR AOS FUNDOS',
        descricaoVazia: 'Nenhum precatório aprovado.',
      },
      {
        key: ABA_EM_PRECIFICACAO_EXTERNO,
        // "EM PRECIFICAÇÃO" NA PLATAFORMA, "AGUARDANDO PRECIFICAÇÃO" NO KOMMO. O
        // nome do kanban descreve a espera de quem mandou; o daqui nomeia o
        // estado do crédito, como nas outras abas — e nenhuma delas começa por
        // "aguardando", embora quase todas sejam espera de alguém.
        label: 'Em precificação',
        colunaKommo: 'AGUARDANDO PRECIFICAÇÃO',
        descricaoVazia: 'Nenhum precatório em precificação pelo fundo.',
      },
      {
        key: 'ext-diligencia',
        label: 'Diligência',
        colunaKommo: 'DILIGÊNCIA',
        descricaoVazia: 'Nenhum precatório externo em diligência.',
      },
      {
        key: ABA_REPROVADOS_EXTERNO,
        label: 'Reprovados',
        colunaKommo: 'REPROVADOS',
        descricaoVazia: 'Nenhum precatório externo reprovado.',
      },
      {
        key: 'ext-apresentacao',
        // "PROPOSTA" NA PLATAFORMA: o que a etapa produz. "Apresentação" vinha
        // do funil antigo, onde a coluna se chamava "Apresentação de Proposta" —
        // o nome guardava o ato e perdia a coisa.
        label: 'Proposta',
        colunaKommo: 'PRODUÇÃO DE PROPOSTA',
        descricaoVazia: 'Nenhum precatório em apresentação.',
      },
      {
        key: 'ext-fechados',
        label: 'Fechados',
        colunaKommo: 'FECHADOS',
        descricaoVazia: 'Nenhum precatório externo fechado.',
      },
    ],
    // TODAS AS COLUNAS DO KANBAN ESTÃO AQUI, menos a etapa de entrada — que é
    // do comercial, antes de o crédito chegar à casa. "AGUARDANDO PRECIFICAÇÃO"
    // era a última de fora e entrou em 21/09/2026.
  },
]

/** A trilha a que um funil pertence, ou undefined se o funil não é de precatório. */
export function trilhaDoPipeline(pipelineId: number): DefSubdivisao | undefined {
  return TRILHAS_PRECATORIO.find((s) => s.pipelineId === pipelineId)
}

/**
 * Os nomes de coluna para os quais a plataforma pode mover um card deste funil.
 *
 * É A LISTA DE PERMISSÃO DO SERVIDOR, e sai da mesma definição que desenha os
 * botões — é este o ponto do arquivo. Um statusId solto no corpo da requisição
 * moveria o card para "Nutrição" ou "Venda perdida", que são colunas do
 * comercial; e uma lista escrita à mão do lado do servidor já divergiu da tela
 * uma vez, deixando quatro botões do Externo clicáveis e sem efeito.
 *
 * DILIGÊNCIA E REPROVAÇÃO SEMPRE ENTRAM, mesmo que nenhuma aba as declare: elas
 * são da trilha, e é para lá que vão os dois desfechos que interrompem —
 * inclusive o da janela de due diligence, que pode partir de qualquer card.
 */
export function destinosDaTrilha(pipelineId: number): string[] {
  const trilha = trilhaDoPipeline(pipelineId)
  if (!trilha) return []
  const nomes = new Set<string>([trilha.colunaDiligencia, trilha.colunaReprovados])
  for (const aba of trilha.abas) {
    for (const saida of aba.saidas ?? []) nomes.add(saida.colunaKommo)
  }
  return [...nomes]
}
