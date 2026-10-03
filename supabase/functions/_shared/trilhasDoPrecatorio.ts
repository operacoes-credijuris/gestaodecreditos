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
  /** O id da coluna de destino — quando há, é ele que manda (ver `resolverColuna`). */
  statusId?: number
  label: string
  variant?: VarianteDeAcao
  /** Omitido, é `aprovar` — a saída positiva é a regra, as outras a exceção. */
  papel?: PapelDaAcao
}

/**
 * Uma aba do Precatório: uma coluna do kanban, com o que a plataforma faz nela.
 *
 * A LIGAÇÃO É PELO ID DA COLUNA, QUANDO HÁ, e pelo nome quando não há. O nome
 * foi a única ligação até 29/09/2026 — e cada coluna renomeada no Kommo fazia a
 * aba perder botões, etiquetas e automações até alguém renomear aqui também. O
 * id não muda com o nome: é por ele que o Externo se liga desde então, e o nome
 * ficou de reserva (coluna recriada, id que sumiu do espelho) e de rótulo.
 *
 * O MEDO ANTIGO ERA COPIAR ID DA URL — um dígito trocado aponta para outra coluna
 * que também existe. Os ids daqui vieram do próprio espelho (`kommo_etapa`,
 * consulta de 29/09/2026), e os testes os prendem ao nome que tinham naquele dia.
 *
 * Coluna que não se acha nem pelo id nem pelo nome aparece em
 * `colunasPrecatorioDesalinhadas`: a tela diz qual não encontrou, em vez de
 * ficar vazia em silêncio.
 */
/** Um desfecho do envio a um fundo: a etiqueta que ele põe no card e a linha da anotação. */
export interface AtoDoEnvio {
  etiqueta: string
  nota: string
  /** O fundo recusou o crédito — o botão sai vermelho. */
  reprova?: boolean
}

/** Um fundo com plataforma própria de envio, e os desfechos possíveis dele. */
export interface FundoDoEnvio {
  fundo: string
  /** "o BTG", "a PJus" — para a tela escrever "envio ao BTG" e "envio à PJus". */
  artigo: 'o' | 'a'
  plataforma: string
  atos: AtoDoEnvio[]
}

export interface DefAbaPrecatorio {
  key: string
  /** Rótulo na plataforma — vocabulário nosso, não o do CRM do comercial. */
  label: string
  /** Nome da coluna no kanban do Kommo, como está escrito lá. */
  colunaKommo: string
  /** O id da coluna no Kommo — o que não muda quando ela é renomeada. */
  statusId?: number
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
   * A ESCOLHA DA PROPOSTA: a etapa em que os fundos respondem termina quando a
   * casa escolhe com qual seguir, e o card vai para a coluna daqui.
   *
   * NÃO É UMA SAÍDA COMUM, e por isso não mora em `saidas`: saída comum vira
   * botão genérico na tela, com a janela da mensagem livre e, junto, os botões de
   * diligência e recusa da trilha. A escolha tem fluxo próprio — escolhe-se o
   * FUNDO, e a mensagem do card sai dele ("Seguir com a proposta do BTG."). O
   * destino entra em `destinosDaTrilha` igual, que é o que a kommo-mover aceita.
   */
  escolhaDeProposta?: { colunaKommo: string; statusId?: number }
  /**
   * As saídas saem de UM botão só ("Concluir", na fileira de trabalho) ou de um
   * botão cada, no canto do card? OMITIDO, vale ter saída: agrupado. FALSO na
   * aba cuja saída é um ato pontual e que não tem fileira de trabalho — a
   * Diligência do Externo, onde "Diligência sanada" é um botão próprio.
   */
  desfechoAgrupado?: boolean
  /**
   * ANEXAR E MOVER: o botão que recebe um arquivo do computador, sobe ao card
   * com uma anotação padrão e move o card. O primeiro uso é o memorando de
   * negociação (29/09/2026): "Memorando assinado", e o card vai para a remessa
   * aos fundos. Fluxo próprio, como a escolha de proposta — fora das `saidas`.
   */
  anexarEMover?: { rotulo: string; nota: string; colunaKommo: string; statusId?: number }
  /**
   * O BOTÃO "CERTIDÕES" no card: abre o painel de certidões da due diligence do
   * Interno (checklist e emissão pela BullAI), sozinho. O primeiro uso é a
   * Obtenção de documentação do Externo (29/09/2026), onde o fundo pede as
   * certidões do cedente e a casa as tira.
   */
  certidoes?: boolean
  /**
   * O ENVIO AOS FUNDOS: um check por fundo que tem plataforma própria de envio.
   * Quem sobe o crédito lá marca o check, escreve (ou cola o print) numa janela,
   * e a plataforma anota no card, põe a etiqueta daquele fundo e — com todos os
   * checks feitos — move o card para o destino. Pedido de 29/09/2026 para a
   * remessa aos fundos (BTG e PJus, depois Em precificação).
   *
   * O CHECK FEITO É A ETIQUETA NO CARD: não há outro registro que possa
   * discordar do Kommo, e a etiqueta posta à mão lá também conta.
   *
   * DOIS DESFECHOS POR FUNDO (01/10/2026): o fundo pode aceitar o crédito
   * ("Enviado PJus", "Cotado BTG") ou reprová-lo já na plataforma ("Reprovado
   * PJus", "Reprovado BTG"). Qualquer um dos dois faz o check daquele fundo.
   */
  envioAosFundos?: {
    fundos: FundoDoEnvio[]
    destino: { colunaKommo: string; statusId?: number }
  }
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
  /** Os ids das duas, quando há — ver `resolverColuna`. */
  idDiligencia?: number
  idReprovados?: number
  abas: DefAbaPrecatorio[]
  /**
   * TODA COLUNA DO FUNIL VIRA ABA, com o nome e na ordem do Kommo — menos as
   * duas de sistema ("Closed - won" e "Closed - lost") e a de entrada de leads
   * (a do tipo 1 no Kommo), que é do comercial e ficou de fora a pedido.
   *
   * Pedido de 29/09/2026 para o Externo, depois de o funil dele ganhar sete
   * colunas de uma vez: a plataforma espelha o kanban inteiro, e o nome da aba é
   * o da coluna, sem vocabulário próprio. As `abas` daqui continuam valendo
   * como o que cada coluna FAZ (botões, desfechos, etiquetas), casadas pelo nome;
   * coluna que não está nelas entra só para leitura. Coluna criada no Kommo
   * aparece sozinha, sem mexer no código.
   */
  espelhoCompleto?: boolean
  /**
   * AS FASES DO FUNIL: as colunas agrupadas, na tela, num nível acima das abas —
   * pedido de 29/09/2026, quando o Externo passou de quinze abas numa fileira só.
   *
   * PELO ID DA COLUNA, como o resto. Coluna que não está em fase nenhuma (criada
   * depois no Kommo) entra na fase da coluna que vem antes dela no kanban: as
   * fases seguem a ordem do kanban, então é ali que ela quase sempre pertence.
   */
  fases?: {
    nome: string
    colunas: number[]
    /** Fase fora do fluxo (os perdidos): aparece mais discreta na tela. */
    discreta?: boolean
  }[]
  /**
   * O DESFECHO DA NEGOCIAÇÃO COM O CEDENTE: da coluna Negociação, o card vai
   * para Fechados, Não fechados ou Sem resposta (etapa 10a do redesenho,
   * 02/10/2026). Pelo id, com o nome de reserva, como o resto.
   *
   * NÃO MORA EM `saidas`, E É DE PROPÓSITO. Saída vira botão na tela oficial,
   * para todo mundo, no mesmo deploy (`abasDoFunil` as desenha). Estes destinos
   * entram primeiro só no SERVIDOR — somados em `idsDestinoDaTrilha` e
   * `destinosDaTrilha` —, e os botões vêm depois, na beta e só para
   * administrador. Pôr aqui em `saidas` faria o botão aparecer para a equipe
   * inteira antes de alguém decidir isso.
   *
   * `coluna` É A ORIGEM (a própria Negociação), e NÃO é destino. O servidor só
   * aceita os outros três se o card estiver nela (ver
   * `_shared/desfechoDaNegociacao.ts`), e a tela vai usá-la para saber em que aba
   * oferecer os botões. A nota que o servidor grava ao mover para os três sai com
   * o serviço "Comercial" (ver `_shared/servicoDaNota.ts`).
   */
  negociacao?: {
    coluna: RefColuna
    fechados: RefColuna
    naoFechados: RefColuna
    semResposta: RefColuna
  }
}

/** Uma coluna do kanban: o id, quando há, e o nome de reserva (ver `resolverColuna`). */
export interface RefColuna {
  colunaKommo: string
  statusId?: number
}

/** As duas colunas de sistema do Kommo, que existem em todo funil e não são etapa de ninguém. */
export const COLUNAS_DE_SISTEMA: ReadonlySet<number> = new Set([142, 143])

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
 * A remessa e a precificação do Externo, e não a tela toda. O espelho guarda as tags de
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
  // REPROVADOS SAIU EM 29/09/2026, a pedido: ali a etiqueta do fundo não diz
  // nada que a coluna já não diga.
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
    // OS IDS DO KANBAN, como no Externo, desde 02/10/2026. Até então o Interno se
    // ligava só pelo NOME, e o Kommo renomeou "REVISÃO DA ANÁLISE" para "Revisão"
    // e "PROTOCOLAR" para "Protocolo": as abas Revisão e p/ Protocolo ficaram sem
    // coluna, o "Concluir" da Análise perdeu o "Enviar para revisão" e o servidor
    // recusava esse destino. Os ids não mudaram com a troca de nome (conferido nas
    // duas consultas ao kommo_etapa que o dono mandou); o nome fica de reserva.
    idDiligencia: 111533960,
    idReprovados: 111534108,
    // SEM `espelhoCompleto` E SEM `fases`, por ora: espelhar o kanban inteiro
    // muda a cara da tela OFICIAL (abas com os nomes do Kommo, colunas do
    // comercial como leitura), e isso espera a aprovação do dono (02/10/2026).
    //
    // O DESFECHO DA NEGOCIAÇÃO, só no servidor por ora — ver `negociacao`. A aba
    // da Negociação não existe na tela do Interno; o campo serve à permissão do
    // servidor e, depois, aos botões da beta.
    negociacao: {
      coluna: { colunaKommo: 'Negociação', statusId: 112466260 },
      fechados: { colunaKommo: 'Fechados', statusId: 111533952 },
      naoFechados: { colunaKommo: 'Não fechados', statusId: 112382612 },
      semResposta: { colunaKommo: 'Sem resposta', statusId: 112465960 },
    },
    abas: [
      {
        key: ABA_ANALISE_INTERNA,
        // UMA PALAVRA, e a coluna do Kommo se chama "ANÁLISE JURÍDICA E
        // ECONÔMICA": o rótulo da plataforma nomeia a etapa, o nome do kanban
        // descreve o trabalho que acontece nela.
        label: 'Análise',
        // A PRIMEIRA ABA É A ENTRADA DO FUNIL: é nela que o Escavador busca os autos
        // sozinho (ver `colunasDeEntradaDoPrecatorio`). Não mudar a ordem.
        colunaKommo: 'ANÁLISE JURÍDICA E ECONÔMICA', statusId: 111533940,
        descricaoVazia: 'Nenhum precatório em análise.',
        // APROVAR AQUI É PEDIR REVISÃO, e não aprovar o crédito. Quem trabalha
        // nesta etapa são os analistas; a decisão é de quem revisa. Recusar e
        // exigir diligência passam direto — não precisam de segunda leitura.
        saidas: [
          { colunaKommo: 'REVISÃO', statusId: 111533944, label: 'Enviar para revisão', variant: 'secondary' },
        ],
      },
      {
        key: 'int-revisao',
        label: 'Revisão',
        colunaKommo: 'REVISÃO', statusId: 111533944,
        descricaoVazia: 'Nenhuma análise aguardando revisão.',
        // AQUI A APROVAÇÃO É DE VERDADE: é a segunda leitura, feita por quem
        // decide, e o crédito segue para a produção da proposta.
        saidas: [
          { colunaKommo: 'PRODUÇÃO DE PROPOSTA', statusId: 111533948, label: 'Aprovar crédito', variant: 'primary' },
        ],
      },
      {
        key: 'int-aprovados',
        // "APROVADOS" NA PLATAFORMA, "PRODUÇÃO DE PROPOSTA" NO KOMMO — e é de
        // propósito, como no Externo. O rótulo daqui é o vocabulário de quem
        // analisa: o que o ato significa para a casa é uma aprovação. O nome do
        // kanban é o do comercial e diz o que acontece DEPOIS.
        label: 'Aprovados',
        colunaKommo: 'PRODUÇÃO DE PROPOSTA', statusId: 111533948,
        descricaoVazia: 'Nenhum precatório aprovado.',
      },
      {
        key: 'int-diligencia',
        label: 'Diligência',
        colunaKommo: 'DILIGÊNCIA', statusId: 111533960,
        descricaoVazia: 'Nenhum precatório interno em diligência.',
      },
      {
        key: 'int-reprovados',
        label: 'Reprovados',
        colunaKommo: 'REPROVADOS', statusId: 111534108,
        descricaoVazia: 'Nenhum precatório interno reprovado.',
      },
      {
        key: 'int-protocolo',
        label: 'p/ Protocolo',
        colunaKommo: 'PROTOCOLO', statusId: 111693840,
        descricaoVazia: 'Nenhum precatório aguardando protocolo.',
      },
    ],
    // FORA DA TELA, por decisão de quem opera: a etapa de entrada e as colunas do
    // comercial (em 01/10/2026: Negociação, Fechados, Oferta aos investidores,
    // Escritura pública, Pagamento finalizado, Sem resposta, Não fechados) existem
    // no kanban e não viram aba — são etapas do comercial, não do operacional.
    // Ficam registradas aqui para que a ausência se leia como escolha, e não como
    // coluna esquecida no remapeamento.
  },
  {
    key: 'externo',
    label: 'Externo',
    pipelineId: FUNIL_PRECATORIO_EXTERNO,
    colunaDiligencia: 'DILIGÊNCIA',
    colunaReprovados: 'REPROVADOS',
    // OS IDS DO KANBAN, lidos do espelho em 29/09/2026 — é por eles que tudo se
    // liga, e o nome fica de reserva. Renomear uma coluna no Kommo não tira nada.
    idDiligencia: 111533996,
    idReprovados: 111534212,
    // O KANBAN INTEIRO, com os nomes de lá — ver `espelhoCompleto`.
    espelhoCompleto: true,
    // AS QUATRO FASES, ditadas por quem opera em 29/09/2026 — pelos ids.
    fases: [
      {
        nome: 'Qualificação',
        // qualificação preliminar, revisão, diligência, memorando
        colunas: [111533968, 111533972, 111533996, 111533976],
      },
      {
        nome: 'Comercialização',
        // encaminhar aos fundos (a primeira desde 29/09/2026: é quando o crédito
        // vai ao mercado), em precificação, produção de proposta, negociação, fechados
        colunas: [111533980, 111533984, 111533988, 112339984, 111533992],
      },
      {
        nome: 'Formalização',
        // obtenção de documentação, aguardando aprovação do fundo,
        // revisão/assinatura da escritura, pagos
        colunas: [112341608, 112341612, 112341616, 112006404],
      },
      {
        nome: 'Perdidos',
        // reprovados, sem resposta (criada no Kommo depois de 29/09/2026 e posta
        // aqui em 02/10/2026, na ordem da amostra; sem ela, a coluna herdaria a
        // fase da anterior no kanban), não fechado
        colunas: [111534212, 112346344, 111985976],
        discreta: true,
      },
    ],
    // O DESFECHO DA NEGOCIAÇÃO, só no servidor por ora — ver `negociacao`.
    negociacao: {
      coluna: { colunaKommo: 'NEGOCIAÇÃO', statusId: 112339984 },
      fechados: { colunaKommo: 'FECHADOS', statusId: 111533992 },
      naoFechados: { colunaKommo: 'NÃO FECHADO', statusId: 111985976 },
      semResposta: { colunaKommo: 'SEM RESPOSTA', statusId: 112346344 },
    },
    abas: [
      {
        key: 'ext-qualificacao',
        // UMA PALAVRA, como a "Análise" do Interno: o rótulo nomeia a etapa e
        // "QUALIFICAÇÃO PRELIMINAR", no kanban, descreve o trabalho.
        label: 'Qualificação',
        colunaKommo: 'QUALIFICAÇÃO PRELIMINAR', statusId: 111533968,
        descricaoVazia: 'Nenhum precatório em qualificação preliminar.',
        // UMA SAÍDA SÓ, e é o que esta etapa passou a ser: quem qualifica lê os
        // autos e passa adiante. Recusar e exigir diligência saíam daqui direto,
        // sem segunda leitura — e a revisão, que existe para ler o que a casa
        // decide, só via o que tinha sido aprovado. Agora tudo passa por ela.
        saidas: [
          { colunaKommo: 'REVISÃO DA QUALIFICAÇÃO', statusId: 111533972, label: 'Enviar para revisão', variant: 'secondary' },
        ],
        interrompe: false,
      },
      {
        key: 'ext-revisao',
        label: 'Revisão',
        colunaKommo: 'REVISÃO DA QUALIFICAÇÃO', statusId: 111533972,
        descricaoVazia: 'Nenhuma qualificação aguardando revisão.',
        // AQUI A APROVAÇÃO ENCAMINHA DE VERDADE. É a segunda leitura, feita por
        // quem decide; aprovada nela, o crédito segue para o fundo. As outras
        // duas saídas são as mesmas da qualificação — quem revisa também pode
        // exigir diligência ou recusar, e aí não há terceira leitura.
        saidas: [
          { colunaKommo: 'ENCAMINHAR AOS FUNDOS', statusId: 111533980, label: 'Aprovar crédito', variant: 'primary' },
          {
            // PEDIR MEMORANDO NÃO É APROVAR NEM RECUSAR. O crédito não foi recusado
            // e ainda não vai ao fundo: falta uma peça, e ela é trabalho da casa —
            // é o caso do valor alto ou do originador sem vínculo direto. Por isso o
            // papel é `validar`, o mesmo de "Enviar para revisão" no RPV: passa
            // adiante para outra etapa de trabalho, sem decidir nada sobre o mérito.
            //
            // A ABA MEMORANDO CONTINUA SEM BOTÃO, por decisão de quem opera: pronto
            // o memorando, quem move o card de volta é o Kommo.
            colunaKommo: 'MEMORANDO DE NEGOCIAÇÃO', statusId: 111533976,
            label: 'Pedir memorando',
            variant: 'secondary',
            papel: 'validar',
          },
        ],
      },
      {
        key: 'ext-memorando',
        // O MEMORANDO ASSINADO LEVA O CRÉDITO AOS FUNDOS (29/09/2026): quem o
        // recebeu do comercial o escolhe no computador, o card recebe o arquivo e
        // a anotação, e segue para a remessa aos fundos.
        anexarEMover: {
          rotulo: 'Anexar',
          nota: 'Memorando assinado.',
          colunaKommo: 'ENCAMINHAR AOS FUNDOS',
          statusId: 111533980,
        },
        // SEM DESFECHO, por ora: é etapa de trabalho, não de decisão. A saída
        // dela ainda não foi definida — e enquanto não for, a aba mostra os
        // cards e quem os move é o Kommo.
        label: 'Memorando',
        colunaKommo: 'MEMORANDO DE NEGOCIAÇÃO', statusId: 111533976,
        descricaoVazia: 'Nenhum crédito em memorando de negociação.',
      },
      {
        key: ABA_APROVADOS_EXTERNO,
        // PRIMEIRO AS PLATAFORMAS DOS FUNDOS, DEPOIS A PRECIFICAÇÃO (29/09/2026):
        // BTG e PJus recebem o crédito nas plataformas deles; com os dois checks
        // feitos, o card vai para Em precificação — já com as duas etiquetas.
        envioAosFundos: {
          fundos: [
            {
              fundo: 'BTG',
              artigo: 'o',
              plataforma: 'https://officer.precatoriosbrasil.com/monitor/precatorios/list/new',
              atos: [
                { etiqueta: 'Cotado BTG', nota: 'Crédito enviado ao BTG.' },
                { etiqueta: 'Reprovado BTG', nota: 'Crédito reprovado pelo BTG.', reprova: true },
              ],
            },
            {
              fundo: 'PJus',
              artigo: 'a',
              plataforma: 'https://parceiro.pjus.com.br/area-parceiro/cotacoes/nova-cotacao',
              atos: [
                { etiqueta: 'Enviado PJus', nota: 'Crédito enviado à PJus.' },
                { etiqueta: 'Reprovado PJus', nota: 'Crédito reprovado pela PJus.', reprova: true },
              ],
            },
          ],
          destino: { colunaKommo: 'EM PRECIFICAÇÃO', statusId: 111533984 },
        },
        // "APROVADOS" NA PLATAFORMA, "ENCAMINHAR AOS FUNDOS" NO KOMMO — e é de
        // propósito. O rótulo daqui é o vocabulário de quem analisa: o que o ato
        // significa para a casa é uma aprovação. O nome do kanban é o do
        // comercial, diz o que acontece DEPOIS, e não muda por causa disto.
        label: 'Aprovados',
        colunaKommo: 'ENCAMINHAR AOS FUNDOS', statusId: 111533980,
        descricaoVazia: 'Nenhum precatório aprovado.',
      },
      {
        key: ABA_EM_PRECIFICACAO_EXTERNO,
        // "EM PRECIFICAÇÃO" NA PLATAFORMA E NO KOMMO desde 29/09/2026, quando a
        // coluna do kanban deixou de se chamar "AGUARDANDO PRECIFICAÇÃO" — o nome
        // do estado do crédito, como nas outras abas, em vez da espera de quem
        // mandou. A ligação é pelo id: renomear lá não tira nada daqui.
        label: 'Em precificação',
        colunaKommo: 'EM PRECIFICAÇÃO', statusId: 111533984,
        descricaoVazia: 'Nenhum precatório em precificação pelo fundo.',
        // OS FUNDOS RESPONDERAM, e a casa escolhe com qual proposta seguir: o
        // card vai para a produção da proposta ao cedente (29/09/2026).
        escolhaDeProposta: { colunaKommo: 'PRODUÇÃO DE PROPOSTA', statusId: 111533988 },
      },
      {
        key: 'ext-diligencia',
        // DILIGÊNCIA SANADA VOLTA PARA A REVISÃO (29/09/2026): quem apurou o que
        // faltava devolve o crédito à segunda leitura. Um botão próprio no card,
        // com a janela da mensagem para dizer o que foi sanado — e sem os botões
        // de diligência e recusa, que aqui não fazem sentido.
        saidas: [
          {
            colunaKommo: 'REVISÃO DA QUALIFICAÇÃO',
            statusId: 111533972,
            label: 'Sanar',
            // VERDE, como o "Anexar" do Memorando: os dois resolvem o que
            // travava o crédito e o põem de volta no caminho.
            variant: 'success',
            papel: 'validar',
          },
        ],
        interrompe: false,
        desfechoAgrupado: false,
        label: 'Diligência',
        colunaKommo: 'DILIGÊNCIA', statusId: 111533996,
        descricaoVazia: 'Nenhum precatório externo em diligência.',
      },
      {
        key: ABA_REPROVADOS_EXTERNO,
        label: 'Reprovados',
        colunaKommo: 'REPROVADOS', statusId: 111534212,
        descricaoVazia: 'Nenhum precatório externo reprovado.',
      },
      {
        key: 'ext-apresentacao',
        // "PROPOSTA" NA PLATAFORMA: o que a etapa produz. "Apresentação" vinha
        // do funil antigo, onde a coluna se chamava "Apresentação de Proposta" —
        // o nome guardava o ato e perdia a coisa.
        label: 'Proposta',
        colunaKommo: 'PRODUÇÃO DE PROPOSTA', statusId: 111533988,
        descricaoVazia: 'Nenhum precatório em apresentação.',
      },
      {
        key: 'ext-fechados',
        label: 'Fechados',
        colunaKommo: 'FECHADOS', statusId: 111533992,
        descricaoVazia: 'Nenhum precatório externo fechado.',
      },
      {
        key: 'ext-documentacao',
        // AS CERTIDÕES DO CEDENTE, pela API da Bull (29/09/2026): na formalização
        // o fundo pede os documentos, e o card ganha o botão que abre o mesmo
        // painel de certidões da due diligence do Interno. Sem desfecho: quem
        // move o card, por ora, é o Kommo.
        certidoes: true,
        label: 'Documentação',
        colunaKommo: 'OBTENÇÃO DE DOCUMENTAÇÃO', statusId: 112341608,
        descricaoVazia: 'Nenhum crédito em obtenção de documentação.',
      },
    ],
    // AS COLUNAS COM FUNÇÃO NA PLATAFORMA. As outras do kanban — a entrada, a
    // negociação, a escritura, os pagos — entram pelo `espelhoCompleto`, só
    // para leitura.
  },
]

/** Uma coluna do espelho, nos campos que a resolução usa. */
export interface ColunaDoEspelho {
  pipeline_id: number
  status_id: number
  nome: string
}

const normalizarNome = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

/**
 * O id de uma coluna, dado o que a definição sabe dela: PELO ID, primeiro, e
 * pelo nome na falta.
 *
 * O ID VALE SE O ESPELHO O TEM — sem espelho não há coluna, como antes: um botão
 * para um id que o espelho não conhece moveria o card para onde a kommo-mover não
 * reconhece. Id que sumiu do espelho — coluna apagada e recriada no Kommo — cai para o nome,
 * que é o que a coluna nova provavelmente herdou. Nem um nem outro: undefined, e
 * a tela avisa (ver `colunasPrecatorioDesalinhadas`).
 */
export function resolverColuna(
  pipelineId: number,
  etapas: readonly ColunaDoEspelho[],
  ref: { colunaKommo: string; statusId?: number },
): number | undefined {
  const doFunil = etapas.filter((e) => Number(e.pipeline_id) === pipelineId)
  if (ref.statusId && doFunil.some((e) => Number(e.status_id) === ref.statusId)) {
    return ref.statusId
  }
  const alvo = normalizarNome(ref.colunaKommo)
  const achada = doFunil.find((e) => normalizarNome(e.nome) === alvo)
  return achada ? Number(achada.status_id) : undefined
}

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
/**
 * Os destinos do desfecho da Negociação de uma trilha — Fechados, Não fechados e
 * Sem resposta —, ou nenhum. A própria Negociação (`coluna`) NÃO entra: é a
 * origem, e mover PARA ela continua recusado.
 */
export function destinosDaNegociacao(trilha: DefSubdivisao): RefColuna[] {
  const n = trilha.negociacao
  return n ? [n.fechados, n.naoFechados, n.semResposta] : []
}

/** Os IDS das colunas para as quais a plataforma pode mover um card deste funil. */
export function idsDestinoDaTrilha(pipelineId: number): number[] {
  const trilha = trilhaDoPipeline(pipelineId)
  if (!trilha) return []
  const ids = new Set<number>()
  if (trilha.idDiligencia) ids.add(trilha.idDiligencia)
  if (trilha.idReprovados) ids.add(trilha.idReprovados)
  for (const aba of trilha.abas) {
    for (const saida of aba.saidas ?? []) if (saida.statusId) ids.add(saida.statusId)
    if (aba.escolhaDeProposta?.statusId) ids.add(aba.escolhaDeProposta.statusId)
    if (aba.anexarEMover?.statusId) ids.add(aba.anexarEMover.statusId)
    if (aba.envioAosFundos?.destino.statusId) ids.add(aba.envioAosFundos.destino.statusId)
  }
  // O DESFECHO DA NEGOCIAÇÃO É DA TRILHA, e não de uma aba — ver `negociacao`.
  for (const d of destinosDaNegociacao(trilha)) if (d.statusId) ids.add(d.statusId)
  return [...ids]
}

/**
 * A plataforma pode mover um card deste funil para esta coluna? PELO ID, e pelo
 * nome de reserva — a mesma regra de `resolverColuna`, do lado do servidor.
 * Renomear a coluna no Kommo não tira a permissão.
 */
export function destinoPermitido(pipelineId: number, statusId: number, nome: string | null): boolean {
  if (idsDestinoDaTrilha(pipelineId).includes(statusId)) return true
  const alvo = normalizarNome(nome)
  return !!alvo && destinosDaTrilha(pipelineId).some((d) => normalizarNome(d) === alvo)
}

export function destinosDaTrilha(pipelineId: number): string[] {
  const trilha = trilhaDoPipeline(pipelineId)
  if (!trilha) return []
  const nomes = new Set<string>([trilha.colunaDiligencia, trilha.colunaReprovados])
  for (const aba of trilha.abas) {
    for (const saida of aba.saidas ?? []) nomes.add(saida.colunaKommo)
    if (aba.escolhaDeProposta) nomes.add(aba.escolhaDeProposta.colunaKommo)
    if (aba.anexarEMover) nomes.add(aba.anexarEMover.colunaKommo)
    if (aba.envioAosFundos) nomes.add(aba.envioAosFundos.destino.colunaKommo)
  }
  for (const d of destinosDaNegociacao(trilha)) nomes.add(d.colunaKommo)
  return [...nomes]
}
