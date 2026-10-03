// Mapeamento entre as colunas do kanban do Kommo e as telas da Análise de
// Crédito, mais as consultas ao espelho local (public.kommo_leads).
//
// A UI nunca fala com a API do Kommo: ela não devolve headers de CORS e o token
// tem direitos de administrador. Quem busca é a Edge Function kommo-sync; quem
// escreve é a kommo-mover.
//
// Fluxo do operacional:
//   Análise     a IA analisa o card, que fica aqui até a equipe de revisão
//               considerar a análise boa
//        ↓      "Enviar para revisão"
//   Revisão     três saídas
//        ↓
//   Aprovados | Diligência | Reprovados
//
// A análise (inclusive o motivo de uma eventual reprovação) é produzida na
// Análise. A revisão só ratifica — por isso nenhuma das três saídas pede
// justificativa: ela já foi escrita antes.
//
// Depois de aprovado o crédito passa por etapas do comercial (oferta, contratos,
// assinaturas) que não têm aba aqui, e reaparece em "p/ Protocolo", que é
// trabalho nosso de novo.
//
// Toda tela corresponde a exatamente uma coluna do Kommo. Não há estado que
// exista só na nossa base — o kanban é a fonte de verdade.
//
// PRECATÓRIOS seguem a mesma ideia, com uma diferença: o funil deles atende
// DUAS destinações (Interno e Externo), então as colunas estão divididas em duas
// listas fixas — ver SUBDIVISOES_PRECATORIO. Antes isso era configurável na
// própria tela (tabela etapa_visao, migration 0045); passou a ser fixo no
// código, como RPV sempre foi.
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { normalizarBusca } from './format'
// A DEFINIÇÃO DAS TRILHAS VEM DE `supabase/functions/_shared`, por caminho
// relativo, porque a Edge Function que MOVE o card lê a mesma lista. Duas
// listas que precisam dizer a mesma coisa acabam divergindo — e esta divergiu
// no primeiro dia da migração do Externo.
import {
  ABA_ANALISE_INTERNA,
  ABA_APROVADOS_EXTERNO,
  ABA_EM_PRECIFICACAO_EXTERNO,
  ABA_REPROVADOS_EXTERNO,
  ABAS_COM_TAGS,
  type DefAbaPrecatorio,
  type DefSubdivisao,
  type FundoDoEnvio,
  type PapelDaAcao,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
  type SubdivisaoPrecatorio,
  TRILHAS_PRECATORIO,
  COLUNAS_DE_SISTEMA,
  resolverColuna,
} from '../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
// PELO MESMO MOTIVO das trilhas: a lista das etiquetas que a casa aplica é lida
// pela tela, que desenha o seletor, e pela Edge Function `kommo-etiquetar`, que
// decide o que aceita. Uma lista só — e ela precisa ser fechada, porque o Kommo
// CRIA a etiqueta ao receber um nome que ainda não existe na conta.
import {
  ETIQUETAS_DA_PRECIFICACAO,
  type EtiquetaDoFundo,
  ATOS_DA_PRECIFICACAO,
  desdeQuandoAEtiqueta,
  etiquetaCanonica,
  etiquetasPorDestino,
  FUNDOS_DA_PRECIFICACAO,
  irmasDaEtiqueta,
  mensagemDaProposta,
  mesmaEtiqueta,
  ordenarEtiquetas,
  normalizarEtiqueta,
} from '../../supabase/functions/_shared/etiquetasDoFundo.ts'
import type { KommoLead, KommoAnaliseInterna } from './types'

// Conta do Kommo. O subdomínio não é segredo — é o que aparece na URL.
export const KOMMO_SUBDOMINIO = 'contatocredijuriscom'

// Funis que o operacional usa.
export const FUNIL_RPV = 13901939
/**
 * O FUNIL QUE A PÍLULA "Precatórios" ABRE, e que é também o da trilha Interna.
 *
 * O funil antigo (13971995) tinha as duas destinações dentro, e por isso servia
 * de chave para a tela inteira. Em 14/09/2026 a casa separou os pipelines — o
 * Externo migrou naquele dia, o Interno em 16/09 —, e o antigo deixou de ser
 * lido: nenhuma aba aponta para ele.
 *
 * A TELA PRECISA DE UMA CHAVE SÓ para o tipo de crédito, e é esta. Quem decide
 * de quais funis a consulta traz card é `funisExibidos`, que devolve os dois —
 * apontar a chave para um funil que não é de precatório faria a consulta buscar
 * só ele, e a tela ficaria vazia com as abas certas.
 */
export const FUNIL_PRECATORIO = FUNIL_PRECATORIO_INTERNO
export {
  ABA_ANALISE_INTERNA,
  ABA_APROVADOS_EXTERNO,
  ABA_EM_PRECIFICACAO_EXTERNO,
  ABA_REPROVADOS_EXTERNO,
  ABAS_COM_TAGS,
  ETIQUETAS_DA_PRECIFICACAO,
  type EtiquetaDoFundo,
  ATOS_DA_PRECIFICACAO,
  desdeQuandoAEtiqueta,
  etiquetaCanonica,
  etiquetasPorDestino,
  FUNDOS_DA_PRECIFICACAO,
  irmasDaEtiqueta,
  mensagemDaProposta,
  mesmaEtiqueta,
  ordenarEtiquetas,
  normalizarEtiqueta,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
}

/**
 * As etiquetas que a plataforma oferece NESTA aba — ou nenhuma, e aí o card só
 * as mostra.
 *
 * SÓ "EM PRECIFICAÇÃO", por ora e por decisão de quem opera: é a aba em que o
 * crédito está com um fundo esperando preço, e a etiqueta é o que diz com qual e
 * em que pé. Nas outras duas abas com etiqueta — Aprovados e Reprovados — elas
 * continuam sendo leitura: o trabalho já passou.
 *
 * DEVOLVE A LISTA, e não um booleano, porque é a lista que o seletor desenha e
 * que o servidor valida. Quando outra aba ganhar etiquetas, o que muda aqui é
 * uma linha, e não o componente.
 */
export function etiquetasDaAba(abaKey: string | null | undefined): readonly EtiquetaDoFundo[] {
  return abaKey === ABA_EM_PRECIFICACAO_EXTERNO ? ETIQUETAS_DA_PRECIFICACAO : []
}

// Estágios do Funil Geral RPV que interessam ao operacional. Os nomes das
// constantes seguem os nomes das COLUNAS NO KOMMO; o rótulo que o usuário vê
// está em TELAS[].label e pode divergir (ST_DECISAO aparece como "Revisão").
export const ST_ANALISE = 107272803 // Análise Jurídica-Econômico
export const ST_DECISAO = 107272807 // Revisão e Decisão do Pedro
export const ST_DILIGENCIA = 107830027 // Diligência
export const ST_PROPOSTA = 107830035 // Apresentação de Proposta
export const ST_REPROVADO = 107830031 // Reprovados Operacional
// A ÚLTIMA COLUNA QUE O OPERACIONAL ACOMPANHA no RPV. As anteriores a ela —
// oferta a investidores, contratos, assinaturas — são do comercial, e por isso
// não têm aba: a plataforma volta a mostrar o crédito quando ele chega ao
// protocolo, que é trabalho nosso outra vez.
export const ST_PROTOCOLO = 107830059 // Protocolo

// ---------- Precatórios: as duas destinações, fixas ----------

/**
 * O destino do precatório, que decide por qual trilha ele anda no funil.
 *
 * NÃO é tipo de crédito (isso é o funil: RPV ou Precatório) e NÃO é etapa (isso
 * são as abas). É um terceiro eixo, e é justamente por serem três que a tela
 * precisa dar formas diferentes a cada um — dois seletores idênticos lado a
 * lado se leem como a mesma pergunta feita duas vezes.
 *
 * O TIPO E AS DEFINIÇÕES MORAM EM `_shared/trilhasDoPrecatorio.ts`, e são
 * reexportados aqui para nada que já os importava precisar mudar. Foram para lá
 * porque a Edge Function `kommo-mover` também precisa deles: ela guardava uma
 * lista PRÓPRIA das colunas que aceita como destino, e no dia em que o Externo
 * migrou a lista dela ficou para trás — a tela oferecia quatro saídas que o
 * servidor recusava.
 */
export type { DefAbaPrecatorio, DefSubdivisao, SubdivisaoPrecatorio }
export type { AtoDoEnvio, FundoDoEnvio } from '../../supabase/functions/_shared/trilhasDoPrecatorio.ts'

/**
 * A aba do Interno onde a análise acontece, e as trilhas inteiras.
 *
 * Reexportadas de `_shared/trilhasDoPrecatorio.ts` — ver lá o porquê de a
 * definição ter saído deste arquivo. `SUBDIVISOES_PRECATORIO` mantém o nome que
 * a tela sempre usou: quem lê "subdivisão" na tela é quem escolhe a pílula.
 */
export const SUBDIVISOES_PRECATORIO = TRILHAS_PRECATORIO

/**
 * A cor de uma etiqueta do Kommo, estável pelo nome.
 *
 * PELA MESMA TAG, SEMPRE A MESMA COR. É o que faz a cor valer alguma coisa: numa
 * coluna de trinta cards encaminhados, quem procura os de um fundo específico
 * acha pela mancha antes de ler o texto. Cor sorteada a cada render, ou por
 * posição na lista, seria enfeite — e enfeite que muda confunde.
 *
 * VERDE E VERMELHO FICAM DE FORA, e não por gosto: no card eles já significam
 * outra coisa (verde é análise pronta, vermelho é recusa). Uma etiqueta verde
 * seria lida como estado do crédito.
 */
/**
 * A PALETA DE RESERVA: as cores de uma etiqueta que a casa ainda não nomeou.
 *
 * Verde e vermelho ficam fora DELA de propósito. Eles são cores com recado —
 * passou, não passou — e uma etiqueta desconhecida que caísse no vermelho seria
 * lida como recusa por acaso. Quem tem recado a dar é a tabela abaixo.
 */
export const TONS_DA_TAG = ['blue', 'purple', 'orange', 'teal', 'pink', 'indigo'] as const

export type TomDaTag = (typeof TONS_DA_TAG)[number] | 'red' | 'green' | 'yellow'

/**
 * A COR SAI DO ATO, e não do nome inteiro.
 *
 * As etiquetas da casa se escrevem "‹ato› ‹fundo›" — "Cotado BTG", "Reprovado
 * PJus", "Enviado PJus" —, e o que a cor precisa dizer, na varredura de uma
 * coluna, é o ATO: quem cotou está vivo, quem reprovou acabou. O fundo é o
 * texto, que se lê quando a cor já chamou o olho.
 *
 * FOI O QUE FEZ VERDE E VERMELHO VOLTAREM. Eles estavam fora da paleta porque
 * uma cor com recado num sorteio mente; aqui não há sorteio — "Reprovado BTG"
 * em vermelho diz exatamente o que aconteceu, no mesmo vocabulário que o resto
 * da tela usa.
 *
 * COMPARAÇÃO POR PEDAÇO DO COMEÇO, e não igualdade: o fundo muda ("Cotado XP"
 * entra amanhã) e a flexão também ("Reprovada", "Reprovados"). Nome que não
 * casa com regra nenhuma cai na paleta de reserva, e continua tendo cor.
 */
const TOM_POR_ATO: { comeca: string; tom: TomDaTag }[] = [
  { comeca: 'cotad', tom: 'green' },
  { comeca: 'enviad', tom: 'blue' },
  { comeca: 'reprovad', tom: 'red' },
  { comeca: 'sem proposta', tom: 'red' },
  // PENDENTE É ESPERA, e espera tem cor própria na tela inteira: âmbar. Entrou
  // com "Pendente Luiz", em 22/09/2026 — sem regra ela cairia na paleta de
  // reserva, e um crédito que ainda vai ser cotado sairia da mesma cor de um
  // rótulo qualquer, ao lado do verde de quem já cotou.
  { comeca: 'pendente', tom: 'yellow' },
]

/** A cor que o ato manda, ou nada — e aí quem decide é a paleta de reserva. */
function tomPorAto(nome: string): TomDaTag | null {
  const limpo = normalizarBusca(nome)
  return TOM_POR_ATO.find((r) => limpo.startsWith(r.comeca))?.tom ?? null
}

export function tomDaTag(nome: string): TomDaTag {
  const doAto = tomPorAto(nome)
  if (doAto) return doAto

  const tons = TONS_DA_TAG
  // FNV-1a, e não a soma dos caracteres. A soma espalha mal quando os nomes
  // compartilham palavras — que é exatamente o caso aqui, onde quase toda
  // etiqueta é "<ato> <fundo>": "Reprovado PJus" e "Reprovado BTG" têm metade
  // dos caracteres em comum, e somas próximas caem no mesmo resto.
  let h = 0x811c9dc5
  for (const c of String(nome ?? '')) {
    h ^= c.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return tons[h % tons.length]
}

/**
 * As cores das etiquetas de UM card, garantidamente diferentes entre si.
 *
 * SEIS CORES NÃO BASTAM PARA TODA ETIQUETA QUE EXISTE, e nunca bastariam: o
 * comercial cria quantas quiser, e em algum momento duas caem no mesmo tom. O
 * que se pode garantir — e é o que o olho precisa — é que as etiquetas DE UM
 * MESMO CARD nunca se repitam em cor: duas iguais lado a lado sugerem
 * parentesco que não existe.
 *
 * A COR CONTINUA SAINDO DO NOME, e o desvio só acontece quando há choque ali
 * naquele card: o vizinho escolhe o próximo tom livre. Na esmagadora maioria
 * dos cards nada desvia, e a mesma etiqueta guarda a mesma cor pela coluna
 * inteira — que é o que permite achar os de um fundo pela mancha.
 */
export function coresDasTags(nomes: readonly string[]): Map<string, TomDaTag> {
  const usados = new Set<TomDaTag>()
  const mapa = new Map<string, TomDaTag>()
  for (const nome of nomes) {
    if (mapa.has(nome)) continue

    // A COR DO ATO NÃO DESVIA, e é a exceção que dá sentido à regra: "Reprovado
    // BTG" e "Reprovado PJus" no mesmo card TÊM de sair vermelhas as duas — a
    // cor ali não separa etiquetas, ela diz o que aconteceu com o crédito em
    // cada fundo. Desviar a segunda por higiene visual apagaria a informação.
    const doAto = tomPorAto(nome)
    if (doAto) {
      mapa.set(nome, doAto)
      continue
    }

    // Sem regra de ato, a cor vem da paleta de reserva — e só ela desvia.
    let tom: TomDaTag = tomDaTag(nome)
    if (usados.has(tom)) {
      const inicio = TONS_DA_TAG.indexOf(tom as (typeof TONS_DA_TAG)[number])
      for (let k = 1; k < TONS_DA_TAG.length; k++) {
        const outro = TONS_DA_TAG[(inicio + k) % TONS_DA_TAG.length]
        if (!usados.has(outro)) {
          tom = outro
          break
        }
      }
      // Mais etiquetas que cores no mesmo card: aí repete mesmo, e repetir é
      // melhor do que deixar de mostrar a etiqueta.
    }
    usados.add(tom)
    mapa.set(nome, tom)
  }
  return mapa
}

/**
 * Este funil é um dos de Precatório?
 *
 * DEIXOU DE SER UMA COMPARAÇÃO e virou uma pergunta, porque a resposta deixou de
 * ser um número: são dois pipelines hoje e serão outros dois quando o interno
 * migrar. Todo lugar que comparava `pipeline_id === FUNIL_PRECATORIO` para
 * dizer "é precatório" passa por aqui — senão um card do funil novo se leria
 * como RPV, e a análise sairia com a categoria errada e sem aviso.
 */
export function ehFunilPrecatorio(pipelineId: number): boolean {
  return SUBDIVISOES_PRECATORIO.some((s) => s.pipelineId === pipelineId)
}

/** A trilha a que um funil pertence, ou nada se ele não for de Precatório. */
function subdivisaoDoPipeline(pipelineId: number): DefSubdivisao | undefined {
  return SUBDIVISOES_PRECATORIO.find((s) => s.pipelineId === pipelineId)
}

/** A subdivisão que a tela abre por padrão. */
export const SUBDIVISAO_PADRAO: SubdivisaoPrecatorio = 'interno'

export type TelaAnalise =
  | 'pendentes'
  | 'validacao'
  | 'aprovados'
  | 'diligencia'
  | 'reprovados'
  | 'protocolo'

export interface DefTela {
  key: TelaAnalise
  label: string
  statusId: number
  descricaoVazia: string
}

/**
 * As ABAS DE TRABALHO do RPV: as seis colunas do Kommo em que a plataforma tem
 * função (ou teve, e por isso têm chave própria).
 *
 * DESDE A ETAPA 7 DO REDESENHO (02/10/2026) O RPV MOSTRA O KANBAN INTEIRO — ver
 * `ESPELHO_RPV` e `abasDoFunil`. Estas seis continuam existindo porque são as que
 * guardam CHAVE histórica ('pendentes', 'validacao'…), e é pela chave que o resto
 * do código compara (os botões de trabalho, o desfecho na janela, o selo
 * "Finalizado"). As outras nove colunas entram como `col-<id>`, só para leitura.
 *
 * OS RÓTULOS SÃO OS NOMES DO KOMMO desde a mesma data (decisão do dono, estudo
 * §8.2: "Aprovados" vira "Produção de proposta", "p/ Protocolo" vira
 * "Protocolo"). Na tela a aba usa o nome que o espelho traz; o daqui é o de
 * 02/10/2026, e vale enquanto o espelho não chega e no aviso de coluna sumida.
 *
 * A anotação gravada no card do Kommo usa o nome de lá, de propósito — quem a
 * lê é o comercial, dentro do Kommo (ver COLUNAS na Edge Function kommo-mover).
 */
export const TELAS: DefTela[] = [
  {
    key: 'pendentes',
    // AS CHAVES SÃO HISTÓRICAS, os rótulos não. 'pendentes' e 'validacao' são o
    // que a tela guarda (no estado da página — hoje nada disso vai na URL) e o
    // que o resto do código compara; o que se lê é o nome da coluna no Kommo.
    // Manter as chaves deixa pronto o dia em que a aba for para a URL, sem
    // renomear nada.
    label: 'Análise Jurídica e Econômica',
    statusId: ST_ANALISE,
    descricaoVazia:
      'Nenhum card aguardando revisão. Quando o comercial mover um crédito para análise no Kommo, ele aparece aqui.',
  },
  {
    key: 'validacao',
    label: 'Revisão',
    statusId: ST_DECISAO,
    descricaoVazia: 'Nenhum crédito aguardando validação.',
  },
  {
    key: 'aprovados',
    label: 'Produção de proposta',
    statusId: ST_PROPOSTA,
    descricaoVazia: 'Nenhum crédito aprovado nesta etapa.',
  },
  {
    key: 'diligencia',
    label: 'Diligência',
    statusId: ST_DILIGENCIA,
    descricaoVazia: 'Nenhum crédito em diligência.',
  },
  {
    key: 'reprovados',
    label: 'Reprovados operacional',
    statusId: ST_REPROVADO,
    descricaoVazia: 'Nenhum crédito reprovado.',
  },
  {
    key: 'protocolo',
    label: 'Protocolo',
    statusId: ST_PROTOCOLO,
    descricaoVazia: 'Nenhum crédito aguardando protocolo.',
  },
]

/**
 * O KANBAN DO RPV INTEIRO, como o `kommo_etapa` o devolveu em 02/10/2026: as 15
 * colunas do funil, na ordem de lá — sem a entrada de leads (tipo 1) e sem as
 * duas de sistema (142 e 143), como no Externo.
 *
 * É A DEFINIÇÃO PRÓPRIA DO RPV, e mora aqui de propósito: o RPV NUNCA entra em
 * `TRILHAS_PRECATORIO`. Lá ele trocaria a categoria da análise (a pasta do
 * Drive), os destinos que a `kommo-mover` aceita e a coluna de entrada do
 * Escavador — tudo o que as trilhas decidem para o precatório.
 *
 * SERVE DE RESERVA: com o espelho já sincronizado, a tela usa as colunas DELE
 * (nome e ordem de lá, e coluna nova aparece sozinha, só para leitura); sem
 * espelho ainda, usa esta lista — melhor que uma tela sem aba nenhuma. Pelo ID,
 * como o resto: renomear a coluna no Kommo não tira nada.
 */
export const ESPELHO_RPV: readonly { statusId: number; nome: string }[] = [
  { statusId: ST_ANALISE, nome: 'Análise Jurídica e Econômica' },
  { statusId: ST_DECISAO, nome: 'Revisão' },
  { statusId: ST_DILIGENCIA, nome: 'Diligência' },
  { statusId: ST_PROPOSTA, nome: 'Produção de proposta' },
  { statusId: 107830039, nome: 'Negociação' },
  { statusId: 107830043, nome: 'Fechados' },
  { statusId: 107830047, nome: 'Oferta aos investidores' },
  { statusId: 107830051, nome: 'Elaboração de contratos' },
  { statusId: 107830055, nome: 'Aguardando assinaturas' },
  { statusId: ST_PROTOCOLO, nome: 'Protocolo' },
  { statusId: 107830063, nome: 'Pagamento finalizado' },
  { statusId: ST_REPROVADO, nome: 'Reprovados operacional' },
  { statusId: 107272811, nome: 'Reprovados comercial' },
  { statusId: 112466388, nome: 'Sem resposta' },
  { statusId: 107830067, nome: 'Não fechado' },
]

/** Uma fase do funil: as colunas agrupadas num nível acima das abas. */
export type DefFase = NonNullable<DefSubdivisao['fases']>[number]

/**
 * AS QUATRO FASES DO RPV, as mesmas do Externo (pedido de 01/10/2026), pelos ids.
 * "Oferta aos investidores" fica em Comercialização (decisão do dono, estudo
 * §8.3): depois de fechar com o cedente, a casa oferece o crédito aos
 * investidores. Coluna que o Kommo ganhar depois entra na fase da que vem antes
 * dela no kanban (ver `comFases`).
 */
export const FASES_RPV: readonly DefFase[] = [
  { nome: 'Qualificação', colunas: [ST_ANALISE, ST_DECISAO, ST_DILIGENCIA] },
  { nome: 'Comercialização', colunas: [ST_PROPOSTA, 107830039, 107830043, 107830047] },
  { nome: 'Formalização', colunas: [107830051, 107830055, ST_PROTOCOLO, 107830063] },
  { nome: 'Perdidos', colunas: [ST_REPROVADO, 107272811, 112466388, 107830067], discreta: true },
]

/**
 * O QUE SE FAZ EM CADA COLUNA, em uma frase — o cabeçalho da etapa na tela
 * (item "Novo" da amostra: "Cabeçalho da etapa"). Pelo id, nos três funis.
 *
 * SÓ TEXTO, e só o que a plataforma faz HOJE. A amostra descreve também os
 * botões da onda 4 (o "Fechado!" da Negociação, o "Gerar contrato" da
 * Elaboração de contratos, o "Sanar" do RPV e do Interno); essas frases foram
 * reescritas sem prometer botão que a tela ainda não tem.
 *
 * Coluna sem frase aqui (criada depois no Kommo) mostra só o nome — sem
 * inventar o que se faz nela.
 */
export const DESCRICAO_DA_COLUNA: Readonly<Record<number, string>> = {
  // ---- RPV
  [ST_ANALISE]:
    'Créditos que o comercial mandou para análise. Rode a análise (qualifica e precifica) e envie para revisão.',
  [ST_DECISAO]: 'A análise está pronta: quem decide confere e aprova, pede diligência ou reprova.',
  [ST_DILIGENCIA]: 'Falta algo para decidir. Sanada a pendência, o comercial move o card de volta no Kommo.',
  [ST_PROPOSTA]: 'Aprovado: a proposta ao cedente está sendo montada.',
  107830039: 'Proposta apresentada, em negociação com o cedente.',
  107830043: 'Negócio fechado com o cedente.',
  107830047: 'O crédito fechado está sendo oferecido aos investidores.',
  107830051: 'Contratos de cessão sendo gerados.',
  107830055: 'Contratos enviados, aguardando as assinaturas.',
  [ST_PROTOCOLO]: 'Cessão assinada, aguardando o protocolo no processo.',
  107830063: 'Cessão paga ao cedente.',
  [ST_REPROVADO]: 'Recusados na análise ou na revisão.',
  107272811: 'Recusados na negociação.',
  112466388: 'Cedente que deixou de responder.',
  107830067: 'Negociação encerrada sem acordo.',
  // ---- Precatório Interno
  111533940: 'Leitura dos autos e planilha jurídica, pela conversa no Claude. Conclua com a razão escrita.',
  111533944: 'Segunda leitura de quem decide: aprovar, exigir diligência ou reprovar.',
  111533960: 'Pendência a resolver antes de decidir. Sanada, o comercial move o card de volta no Kommo.',
  111533948:
    'Aprovado: a proposta ao cedente está sendo montada. A due diligence e a análise continuam à mão.',
  112466260: 'Proposta apresentada, em negociação com o cedente.',
  111533952: 'Negócio fechado com o cedente.',
  112466032: 'O crédito fechado está sendo oferecido aos investidores.',
  111533956: 'Escritura de cessão em cartório.',
  111693840: 'Cessão assinada, aguardando o protocolo no processo.',
  112466340: 'Cessão paga ao cedente.',
  111534108: 'Créditos recusados.',
  112465960: 'Cedente que deixou de responder.',
  112382612: 'Negociação encerrada sem acordo.',
  // ---- Precatório Externo
  111533968: 'Primeira leitura dos autos. Rode a análise no Claude e conclua com a razão escrita.',
  111533972: 'Segunda leitura de quem decide: aprovar, pedir memorando, exigir diligência ou reprovar.',
  111533996: 'Falta algo para seguir. Sanada a pendência, o crédito volta para a revisão.',
  111533976: 'Aguardando o memorando assinado do comercial. Anexe-o para levar o crédito aos fundos.',
  111533980:
    'Suba o crédito nas plataformas do BTG e da PJus. Com os dois registros, o card vai para Em precificação.',
  111533984: 'Os fundos estão precificando. Marque o retorno de cada um e escolha a proposta para seguir.',
  111533988: 'Proposta ao cedente sendo montada.',
  112339984: 'Proposta apresentada, em negociação com o cedente.',
  111533992: 'Negócio fechado com o cedente.',
  112341608: 'O fundo pediu os documentos. Emita as certidões do cedente pela BullAI.',
  112341612: 'Documentação com o fundo, aguardando aprovação.',
  112341616: 'Escritura de cessão em revisão ou assinatura.',
  112006404: 'Cessão paga ao cedente.',
  111534212: 'Créditos recusados pela casa ou pelos fundos.',
  112346344: 'Cedente que deixou de responder.',
  111985976: 'Negociação encerrada sem acordo.',
}

/**
 * O QUE A AÇÃO FAZ, independente de para qual coluna ela move.
 *
 * Existe porque o `statusId` deixou de identificar o ato. Enquanto só RPV tinha
 * desfechos, comparar com ST_REPROVADO respondia "isto é uma reprovação?" — e a
 * tela toda foi escrita assim: o ícone, a exigência de motivo, o tom que a IA
 * usa ao redigir a anotação. No funil de Precatórios as MESMAS colunas têm
 * outros ids (o Kommo numera por funil), então essas comparações passariam a
 * responder "não" para todas: reprovar um precatório não pediria motivo e a
 * anotação sairia com o tom de validação. Silenciosamente, nos dois casos.
 */
export type { PapelDaAcao }

export interface AcaoTela {
  statusId: number
  label: string
  // 'secondary' É O TOM NEUTRO, e existe para a saída que PASSA ADIANTE sem
  // decidir nada — mandar para a revisão de outra pessoa não é aprovar. Sem ele
  // essa saída sairia no azul da aprovação, e as duas se confundiriam.
  variant: 'primary' | 'secondary' | 'success' | 'warning' | 'danger'
  papel: PapelDaAcao
}

/**
 * Botões de ação por tela: cada etapa oferece direto as saídas que fazem sentido
 * nela, com um clique.
 *
 * As telas terminais ficam sem ação: de Aprovados e Reprovados o card não volta
 * pelo app, e a diligência é encargo do comercial — concluída, ele move o card
 * de volta para análise no Kommo e o sync o traz de novo para Pendentes.
 */
export const ACOES: Record<TelaAnalise, AcaoTela[]> = {
  // PENDENTES TEM TRÊS SAÍDAS, e não uma. Enviar para validação continua sendo
  // o caminho normal, mas há dois desfechos que se decidem já na primeira
  // leitura: o crédito que precisa de diligência antes de valer análise, e o que
  // não passa de jeito nenhum. Para esses dois, passar por Validação era um
  // clique a mais numa fila que existe para decidir o que ficou em dúvida.
  //
  // APROVAR NÃO ENTRA AQUI de propósito: aprovar direto de Pendentes pularia a
  // revisão, que é a razão de a coluna de Validação existir.
  // OS RÓTULOS DIZEM O ATO. "Diligência" e "Reprovar" viram verbo porque o
  // que se lê num botão é o que ele faz. Salvar deixou de andar junto do envio:
  // são dois botões no rodapé da janela, e o envio só acende quando existe
  // planilha na pasta do Drive.
  pendentes: [
    // O RÓTULO SEGUE O NOME DA ETAPA: a coluna passou a se chamar Revisão, e um
    // botão que manda 'para validação' apontaria para uma aba que não existe mais
    // com esse nome. O papel continua `validar` — é o ato, não o rótulo.
    { statusId: ST_DECISAO, label: 'Enviar para revisão', variant: 'primary', papel: 'validar' },
    { statusId: ST_DILIGENCIA, label: 'Exigir diligência', variant: 'warning', papel: 'diligenciar' },
    { statusId: ST_REPROVADO, label: 'Reprovar crédito', variant: 'danger', papel: 'reprovar' },
  ],
  // Cores em vez de hierarquia: as três são alternativas legítimas, e
  // verde/laranja/vermelho se lê mais rápido que o rótulo numa tela onde a mesma
  // decisão é tomada dezenas de vezes.
  validacao: [
    { statusId: ST_PROPOSTA, label: 'Aprovar', variant: 'success', papel: 'aprovar' },
    { statusId: ST_DILIGENCIA, label: 'Diligência', variant: 'warning', papel: 'diligenciar' },
    { statusId: ST_REPROVADO, label: 'Reprovar', variant: 'danger', papel: 'reprovar' },
  ],
  aprovados: [],
  diligencia: [],
  reprovados: [],
  // O PROTOCOLO É ACOMPANHAMENTO, não decisão: o card chega ali depois de tudo
  // o que a casa decidiu, e quem o move de lá é quem protocola.
  protocolo: [],
}

// ---------- Consultas ----------

/**
 * Cards do funil informado (espelho local).
 *
 * PAGINADO, e não uma consulta só: o PostgREST tem um teto próprio de linhas por
 * resposta, independente do que se pede, e ele não avisa que cortou — devolve
 * menos linhas como se fossem todas. O espelho cresce com o CRM (só o funil de RPV
 * já passa de 140 cards), e no dia em que passar do teto as etapas começariam a
 * mostrar contagem menor do que a real, sem nenhum sinal na tela. É o mesmo defeito
 * que escondeu intimações do DJEN até a gente instrumentar a sincronização.
 *
 * O laço para quando a página vem incompleta, que é o fim dos dados. O limite de
 * páginas é rede de segurança contra laço infinito, não expectativa de volume.
 */
const POR_PAGINA = 1000
const MAX_PAGINAS = 20

/**
 * Os funis de onde a tela precisa buscar cards com este tipo de crédito aberto.
 *
 * QUASE SEMPRE É UM SÓ, e no Precatório são dois. As trilhas foram separadas em
 * pipelines próprios, mas para quem olha a tela "Precatórios" continua sendo UMA
 * aba com uma pílula dentro — então o que a consulta precisa trazer é o card das
 * duas, não o do funil que serve de chave para a aba de cima.
 *
 * ERA ESTE O DEFEITO: buscar por um id só deixava a trilha Externa sem card
 * nenhum, com as abas certas e a lista vazia. Nada acusava — lista vazia se lê
 * como "não tem trabalho aqui", que é exatamente o que o funil novo parecia
 * dizer depois de sincronizado.
 */
export function funisExibidos(pipelineId: number): number[] {
  if (!ehFunilPrecatorio(pipelineId)) return [pipelineId]
  return [...new Set(SUBDIVISOES_PRECATORIO.map((s) => s.pipelineId))]
}

export function useKommoLeads(pipelineId: number) {
  const funis = funisExibidos(pipelineId)
  return useQuery({
    // A CHAVE CARREGA OS DOIS IDS: com a chave antiga, trocar de tipo de crédito
    // reaproveitaria o cache de uma consulta que trouxe outro conjunto de funis.
    queryKey: ['kommo_leads', funis.join(',')],
    queryFn: async () => {
      const todos: KommoLead[] = []
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const de = pagina * POR_PAGINA
        const { data, error } = await supabase
          .from('kommo_leads')
          .select('*')
          .in('pipeline_id', funis)
          .order('atualizado_em', { ascending: false })
          .order('kommo_lead_id', { ascending: false })
          .range(de, de + POR_PAGINA - 1)
        if (error) throw new Error(error.message)
        const lote = (data ?? []) as KommoLead[]
        todos.push(...lote)
        if (lote.length < POR_PAGINA) break
      }
      return todos
    },
  })
}

/**
 * Cards cuja análise automática já ficou pronta.
 *
 * A tabela é escrita pelo processo de análise (IA), do lado servidor — a
 * interface só lê. Serve para o revisor distinguir, dentro de Pendentes, o que
 * já dá para revisar do que ainda está na fila: sem isso os cards são
 * visualmente idênticos e ele abre no escuro.
 *
 * Devolve um Set dos ids com análise concluída; a ausência da linha é o estado
 * "em curso".
 */
export function useAnalisesProntas() {
  return useQuery({
    queryKey: ['kommo_analise_interna'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kommo_analise_interna')
        .select('kommo_lead_id')
      if (error) throw new Error(error.message)
      return new Set(
        ((data ?? []) as Pick<KommoAnaliseInterna, 'kommo_lead_id'>[]).map(
          (r) => r.kommo_lead_id,
        ),
      )
    },
  })
}

/**
 * Colunas do kanban do Kommo, espelhadas em public.kommo_etapa pelo kommo-sync.
 *
 * As abas dos dois funis são fixas no código (TELAS para RPV,
 * SUBDIVISOES_PRECATORIO para Precatório). O espelho existe por causa do
 * Precatório, que fixa a coluna pelo NOME: é aqui que o nome vira status_id.
 * Sem ele, RPV funcionaria (os ids estão nas constantes ST_*) e o Precatório
 * abriria com as seis abas vazias.
 */
export interface EtapaKommo {
  pipeline_id: number
  status_id: number
  pipeline_nome: string | null
  nome: string
  ordem: number
  tipo: number
}

export function useKommoEtapas() {
  return useQuery({
    queryKey: ['kommo_etapa'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kommo_etapa')
        .select('pipeline_id, status_id, pipeline_nome, nome, ordem, tipo')
        .order('pipeline_id')
        .order('ordem')
      if (error) throw new Error(error.message)
      return (data ?? []) as EtapaKommo[]
    },
  })
}

/** Uma aba da tela: um rótulo, os status que ela cobre e as ações que oferece. */
export interface Aba {
  key: string
  label: string
  statusIds: number[]
  descricaoVazia: string
  acoes: AcaoTela[]
  /**
   * Os desfechos desta aba saem de UM botão só, e não de um botão cada.
   *
   * QUANDO A DECISÃO VEM DEPOIS DE LER ALGO QUE NÃO ESTÁ AQUI. Na qualificação
   * do Externo a análise acontece fora da plataforma, numa conversa com o
   * Claude; quem volta já sabe o que decidiu e precisa registrar POR QUÊ. Três
   * botões soltos no card convidam o clique antes do texto — e o texto é o
   * único registro que vai sobrar daquela análise dentro do CRM.
   *
   * Então o card oferece "Concluir", e as três saídas ficam na janela, ao lado
   * do campo em que a razão é escrita.
   */
  desfechoAgrupado?: boolean
  /**
   * A coluna para onde a ESCOLHA DA PROPOSTA leva o card (Em precificação do
   * Externo), ou null. Ver `escolhaDeProposta` em trilhasDoPrecatorio.ts.
   */
  escolhaDeProposta?: number | null
  /**
   * Coluna do kanban que a plataforma espelha sem dar função a ela: mostra os
   * cards, sem botão de trabalho nem desfecho. Ver `espelhoCompleto`.
   */
  soLeitura?: boolean
  /** O que se faz nesta coluna, em uma frase (ver `DESCRICAO_DA_COLUNA`), quando há. */
  descricao?: string
  /** A fase do funil a que a aba pertence (ver `fases` da trilha), quando o funil tem fases. */
  fase?: string
  /** A fase dela é a de fora do fluxo (os perdidos) — a tela a mostra mais discreta. */
  faseDiscreta?: boolean
  /** O botão de anexar e mover (ver `anexarEMover` na trilha), com a coluna já resolvida. */
  anexarEMover?: { rotulo: string; nota: string; statusId: number } | null
  /** O botão "Certidões" no card (ver `certidoes` na trilha). */
  certidoes?: boolean
  /** Os checks do envio aos fundos (ver `envioAosFundos` na trilha), com o destino resolvido. */
  envioAosFundos?: {
    fundos: FundoDoEnvio[]
    destino: number
  } | null
}


/**
 * Os status_id que um funil EXIBE — a união de todas as suas abas.
 *
 * É o que dá sentido ao número ao lado de "RPV" e "Precatórios": não o tamanho
 * do funil no Kommo, mas o tamanho do que está na tela. O funil do comercial tem
 * colunas que não são do operacional (nutrição, venda ganha, venda perdida), e
 * contá-las fazia o número de cima nunca fechar com a soma das pílulas de baixo
 * — dois totais discordando na mesma tela, sem nada explicando a diferença.
 *
 * NO PRECATÓRIO É A UNIÃO DAS DUAS TRILHAS, não a trilha aberta. O número
 * descreve o FUNIL, e trocar de destinação não muda quantos precatórios existem;
 * um número que mudasse ao alternar Interno/Externo se leria como dado mudando.
 * Set, então "Apresentação de Proposta" — que serve às duas — entra uma vez só.
 */
export function statusExibidos(pipelineId: number, etapas: EtapaKommo[]): Set<number> {
  // NO RPV, AS COLUNAS QUE A TELA MOSTRA — o kanban inteiro desde a etapa 7 —, e
  // pela mesma função que monta as abas: assim o número de cima é, por
  // construção, a soma das colunas de baixo.
  if (pipelineId === FUNIL_RPV) {
    return new Set(abasDoFunil(FUNIL_RPV, etapas).flatMap((a) => a.statusIds))
  }
  if (!ehFunilPrecatorio(pipelineId)) return new Set()
  const ids = new Set<number>()
  // UM ESPELHO POR TRILHA, porque cada uma lê do seu funil. Resolver todas as
  // colunas num mapa só voltaria a misturar os dois kanbans — e há nome que se
  // repete entre eles ("PRODUÇÃO DE PROPOSTA", "DILIGÊNCIA"), com ids
  // diferentes.
  //
  // PELA MESMA FUNÇÃO QUE MONTA AS ABAS, trilha por trilha: no espelho completo
  // (o Externo pela trilha, o Interno pela exibição do front) toda coluna do
  // funil é aba — e conta. Assim o número de cima é, por construção, a soma das
  // colunas de baixo, seja qual for o jeito de cada trilha montar as suas.
  for (const s of SUBDIVISOES_PRECATORIO) {
    for (const a of abasDoFunil(s.pipelineId, etapas, s.key)) for (const id of a.statusIds) ids.add(id)
  }
  return ids
}

/**
 * As colunas que o Precatório fixa e que o kanban do Kommo não tem — nem pelo id,
 * nem pelo nome de reserva.
 *
 * O equivalente de telasRpvDesalinhadas para o outro funil, e por que ele
 * existe é o mesmo motivo: aba ligada a uma coluna inexistente mostra zero card
 * PARA SEMPRE, e zero card se lê como "não tem trabalho aqui". Coluna renomeada
 * no Kommo é a causa provável — daí o aviso citar o nome que se esperava.
 *
 * Devolve vazio quando o espelho ainda não chegou, para não acusar defeito por
 * falta de dado.
 */
export function colunasPrecatorioDesalinhadas(
  etapas: EtapaKommo[],
  subdivisao: SubdivisaoPrecatorio | null = null,
): DefAbaPrecatorio[] {
  const alvos = subdivisao
    ? SUBDIVISOES_PRECATORIO.filter((s) => s.key === subdivisao)
    : SUBDIVISOES_PRECATORIO
  const faltando: DefAbaPrecatorio[] = []
  for (const s of alvos) {
    // ESPELHO AUSENTE NÃO É DESALINHAMENTO, e agora isso se pergunta POR FUNIL:
    // com as trilhas em pipelines diferentes, o espelho de uma pode ter chegado
    // e o da outra não. Acusar a trilha que ainda não sincronizou seria apontar
    // defeito onde só falta dado.
    if (!etapas.some((e) => e.pipeline_id === s.pipelineId)) continue
    for (const a of s.abas) {
      if (resolverColuna(s.pipelineId, etapas, a) === undefined) faltando.push(a)
    }
  }
  return faltando
}

/**
 * As abas do Externo que NÃO oferecem trabalho.
 *
 * SUBSTITUI A ABA COMPARTILHADA. Antes havia uma exceção só, e por outro motivo:
 * "Apresentação de Proposta" era a MESMA coluna do Kommo nas duas trilhas, e o
 * botão apareceria ou não conforme a pílula aberta — um card não pode mudar de
 * natureza porque alguém trocou o recorte da tela. Com funis separados essa
 * ambiguidade acabou.
 *
 * O QUE SOBRA É UMA REGRA DE ETAPA, e não de ambiguidade: apresentação, fechado,
 * em diligência e reprovado são pontos onde o trabalho da casa já passou.
 * Oferecer "executar análise" ali convida ao retrabalho — é o mesmo critério que
 * já valia para as abas terminais de RPV.
 */
export const ABAS_EXTERNO_SEM_TRABALHO: ReadonlySet<string> = new Set([
  'ext-apresentacao',
  'ext-fechados',
  'ext-diligencia',
  'ext-reprovados',
  // EM PRECIFICAÇÃO A BOLA ESTÁ COM O FUNDO: o crédito já foi encaminhado e o
  // que se espera é o preço dele. Oferecer diligência ali convidaria a refazer
  // o que já foi feito antes de encaminhar.
  ABA_EM_PRECIFICACAO_EXTERNO,
  // NA REMESSA AOS FUNDOS O CRÉDITO JÁ SAIU DA CASA: vai ao mercado, e a
  // análise ficou para trás (pedido de 29/09/2026).
  ABA_APROVADOS_EXTERNO,
  // NO MEMORANDO A ANÁLISE JÁ FOI FEITA E REVISADA: a revisão mandou o crédito
  // para cá porque falta o memorando, não uma nova leitura. Sem due diligence
  // nem "Executar análise" (pedido de 29/09/2026).
  'ext-memorando',
  // NA OBTENÇÃO DE DOCUMENTAÇÃO o crédito já foi vendido: o card tem só o botão
  // de certidões (ver `certidoes` na trilha), e não a diligência inteira.
  'ext-documentacao',
])

/**
 * As abas do Interno em que o trabalho da casa já passou.
 *
 * O ESPELHO DE `ABAS_EXTERNO_SEM_TRABALHO`, e existe desde 28/09/2026, quando a
 * equipe pediu no Interno as mesmas ferramentas do Externo — a due diligence
 * com o Escavador e o "Executar análise" no Claude. Antes o Interno só tinha
 * trabalho numa aba (Análise), e esta lista não precisava existir.
 *
 * DILIGÊNCIA E REPROVADOS pelo mesmo motivo do Externo: o crédito saiu do
 * fluxo, e oferecer análise ali convida ao retrabalho. p/ PROTOCOLO porque é
 * depois da venda — contrato assinado, o que resta é protocolar —, o análogo
 * de "Fechados" no Externo.
 *
 * APROVADOS FICA COM AS FERRAMENTAS, como no Externo: o crédito aprovado ainda
 * vai virar proposta, e reapurar o cedente antes dela é trabalho legítimo.
 */
export const ABAS_INTERNO_SEM_TRABALHO: ReadonlySet<string> = new Set([
  'int-diligencia',
  'int-reprovados',
  'int-protocolo',
])

/**
 * As abas de RPV em que a análise ACONTECE — as ÚNICAS que oferecem a análise de
 * RPV e a due diligence, que são PAGAS.
 *
 * ERA UMA LISTA DE EXCLUSÃO (`ABAS_RPV_TERMINAIS`: aprovados, diligência,
 * reprovados, protocolo), e toda aba fora dela ganhava os dois botões. Com seis
 * abas fixas isso não custava nada; com o kanban inteiro do RPV na tela (etapa 7,
 * 02/10/2026), cada uma das nove colunas novas — e toda coluna que o Kommo
 * ganhar depois — passaria a oferecer, num card de Negociação ou de Pagamento
 * finalizado, os dois minutos de leitura do processo e a busca no Escavador.
 *
 * VIROU LISTA DE PERMISSÃO: só estas duas trabalham, e aba nova nasce sem botão.
 * Oferecer trabalho numa aba passa a ser decisão escrita aqui — e presa em
 * botoesDaAba.test.ts.
 *
 * Fora delas, pelo mesmo raciocínio que já valia no precatório: analisar um
 * card já aprovado, reprovado, em diligência ou no protocolo não é trabalho, é
 * retrabalho.
 */
export const ABAS_RPV_COM_TRABALHO: ReadonlySet<string> = new Set(['pendentes', 'validacao'])

/**
 * Que botões de trabalho o card oferece.
 *
 *   'rpv'         a análise de RPV que já existia, mais a due diligence
 *   'dd'          due diligence + Executar análise (no Claude) + Concluir — as
 *                 abas de trabalho do Externo e, desde 28/09/2026, do Interno
 *   'nenhum'      etapa em que não se analisa: aprovados, diligência, reprovados
 *
 * O "EXECUTAR ANÁLISE" DO PRECATÓRIO NÃO É O DE RPV, embora tenha o mesmo nome.
 * O de RPV roda o motor da plataforma (template, cenários, prazo de RPV), e num
 * precatório ele entregava parecer errado com cara de conferido — por isso
 * 'rpv' nunca aparece fora do funil de RPV. O do precatório abre uma conversa no
 * Claude, que busca os autos pelo conector e segue o roteiro da casa.
 */
export type BotoesDoCard = 'rpv' | 'dd' | 'nenhum'

/**
 * Os botões de trabalho da etapa aberta.
 *
 * RPV oferece só nas abas de `ABAS_RPV_COM_TRABALHO` (Análise e Revisão). No PRECATÓRIO, as duas
 * trilhas oferecem as mesmas ferramentas em toda aba de trabalho — as que não
 * são estão em `ABAS_EXTERNO_SEM_TRABALHO` e `ABAS_INTERNO_SEM_TRABALHO`,
 * porque oferecer análise num card reprovado ou já vendido convida ao
 * retrabalho.
 *
 * E o "Analisar" de RPV não aparece em precatório NENHUM — nem na aba Jurídico.
 * Era o defeito relatado: o motor por trás dele é o `gerar-analise-rpv`, com
 * template, cenários (RPV expedida ou não) e cálculo de prazo de RPV, e num
 * precatório ele entregava parecer e planilha errados sem nenhum sinal na tela.
 *
 * AS DUAS TRILHAS TÊM OS MESMOS BOTÕES desde 28/09/2026. A planilha jurídica do
 * Interno, que tinha botão próprio, passou a ser entregue pela conversa do
 * Claude, e o motor antigo ficou só como reserva, dentro da janela de colar.
 *
 * SAIU DE `AnaliseCredito.tsx` PARA SER PRESA POR TESTE (botoesDaAba.test.ts):
 * 'rpv' e 'dd' abrem análise e due diligence, que são PAGAS, e a tela vai
 * ganhar colunas novas. Aba que passar a oferecer um deles sem ninguém decidir
 * isso derruba o teste antes de chegar à equipe.
 */
export function botoesDaAba(
  funil: number,
  subdivisao: SubdivisaoPrecatorio,
  aba: Pick<Aba, 'key' | 'soLeitura'> | null,
): BotoesDoCard {
  //
  // AS DUAS TRILHAS COM AS MESMAS FERRAMENTAS, desde 28/09/2026 e a pedido da
  // equipe: due diligence com o Escavador, "Executar análise" no Claude e
  // "Concluir" em toda aba de trabalho, no Interno como no Externo. Antes o
  // Interno só oferecia trabalho na aba Análise — e, por um descuido que o
  // transplante corrigiu, nenhuma aba dele desenhava o "Concluir": o desfecho
  // agrupado estava ligado, mas o botão só existia no modo do Externo, e a
  // Revisão do Interno não tinha como aprovar pela plataforma.
  //
  // A PLANILHA JURÍDICA NÃO TEM MAIS BOTÃO PRÓPRIO (28/09/2026): o "Executar
  // análise" do Interno leva o questionário à conversa, e o Claude a grava pela
  // ferramenta `entregar_planilha` do conector. Sobrou só a saída de emergência
  // no quadro de status do card — ver `planilhaDeReserva`.
  //
  // NO RPV, LISTA DE PERMISSÃO E `soLeitura` RESPEITADO (etapa 7, 02/10/2026):
  // só as abas de `ABAS_RPV_COM_TRABALHO` oferecem a análise e a due diligence.
  // Antes o ramo do RPV ignorava `soLeitura` e usava uma lista de exclusão — com
  // o kanban inteiro na tela, toda coluna nova ganharia os dois botões pagos.
  // Sem aba aberta, nada: a tela ainda não sabe em que etapa está.
  if (funil === FUNIL_RPV) {
    return aba && !aba.soLeitura && ABAS_RPV_COM_TRABALHO.has(aba.key) ? 'rpv' : 'nenhum'
  }
  const semTrabalho =
    subdivisao === 'externo' ? ABAS_EXTERNO_SEM_TRABALHO : ABAS_INTERNO_SEM_TRABALHO
  return !aba || aba.soLeitura || semTrabalho.has(aba.key) ? 'nenhum' : 'dd'
}

/**
 * O card é da trilha Externa?
 *
 * AGORA É O PIPELINE QUE RESPONDE, e a função encolheu para uma linha. Antes ela
 * comparava conjuntos de colunas resolvidos pelo nome, porque as duas trilhas
 * dividiam um funil — e mesmo assim havia uma coluna sem resposta possível, a
 * que pertencia às duas. Com um funil por trilha, a pergunta tem resposta exata
 * e não depende do espelho ter chegado.
 *
 * CONTINUA SENDO O CARD QUE RESPONDE, e não a pílula aberta: a subdivisão é um
 * recorte da TELA, e a due diligence de um card aberto não pode mudar de frentes
 * porque alguém clicou em Interno atrás da janela.
 */
export function ehCardExterno(pipelineId: number): boolean {
  return subdivisaoDoPipeline(pipelineId)?.key === 'externo'
}

/**
 * As abas de um funil.
 *
 * OS DOIS FUNIS TÊM ABAS FIXAS, cada um do seu jeito: RPV amarra o status_id
 * (TELAS) e o Precatório amarra o nome da coluna (SUBDIVISOES_PRECATORIO, ver
 * lá o porquê). Nenhum dos dois lê mais o kanban como ele é.
 *
 * NO PRECATÓRIO SÓ OS DOIS DESFECHOS QUE INTERROMPEM, e só na trilha Interna.
 * Diligência e Reprovação são atos cujo significado o dono definiu; "Aprovar"
 * continua fora, porque qual coluna significa aprovado no Precatório ninguém
 * disse, e adivinhar seria mover card de verdade com base em palpite. No Externo
 * também não há desfecho: o parecer de lá é do fundo, e quem move o card depois
 * de encaminhar é ele.
 *
 * O ID SAI DO ESPELHO, pelo nome da coluna, como todo o resto do Precatório — os
 * ST_* são do funil de RPV e apontariam para coluna de outro funil. Coluna que o
 * espelho não tem não vira botão: melhor a aba sem desfecho do que um botão que
 * move para lugar nenhum.
 */
/**
 * A RECUSA, para a janela de due diligence — em qualquer funil e qualquer etapa.
 *
 * POR QUE ELA NÃO SAI DE `abasDoFunil`. As ações de uma aba são as saídas
 * daquela ETAPA do fluxo: existem onde o trabalho acontece e somem nas
 * terminais. A recusa por diligência não segue esse mapa — ela nasce do que a
 * apuração achou, e a apuração pode acontecer em qualquer card. Na trilha
 * Externa, que não tem desfecho nenhum (o parecer é do fundo comprador), a
 * janela ficava só com "Seguir": uma diligência que acha execução contra o
 * cedente e não oferece como recusar.
 *
 * O ID SAI DE ONDE SEMPRE SAIU: constante em RPV, nome da coluna no espelho para
 * o Precatório, que numera as mesmas colunas com outros ids. Sem a coluna no
 * espelho não há botão — melhor a janela sem recusa do que um botão que move o
 * card para lugar nenhum.
 */
export function acaoDeReprovar(
  pipelineId: number,
  etapas: EtapaKommo[],
): AcaoTela | null {
  const reprovar = (statusId: number): AcaoTela => ({
    statusId,
    label: 'Reprovar crédito',
    variant: 'danger',
    papel: 'reprovar',
  })
  if (pipelineId === FUNIL_RPV) return reprovar(ST_REPROVADO)
  const sub = subdivisaoDoPipeline(pipelineId)
  if (!sub) return null
  const id = resolverColuna(sub.pipelineId, etapas, {
    colunaKommo: sub.colunaReprovados,
    statusId: sub.idReprovados,
  })
  return id === undefined ? null : reprovar(id)
}

export function abasDoFunil(
  pipelineId: number,
  etapas: EtapaKommo[],
  subdivisao: SubdivisaoPrecatorio | null = null,
): Aba[] {
  if (pipelineId === FUNIL_RPV) return abasDoRpv(etapas)
  if (!ehFunilPrecatorio(pipelineId)) return []

  const def = SUBDIVISOES_PRECATORIO.find(
    (s) => s.key === (subdivisao ?? SUBDIVISAO_PADRAO),
  )
  if (!def) return []
  // DO FUNIL DA TRILHA, e não do que veio por parâmetro: o parâmetro é o funil
  // que a tela tem aberto no topo, e as duas trilhas do Precatório vivem em
  // pipelines diferentes durante a migração.
  // A COLUNA PELO ID, e pelo nome de reserva — ver `resolverColuna`.
  const coluna = (ref: { colunaKommo: string; statusId?: number }) =>
    resolverColuna(def.pipelineId, etapas, ref)

  // QUEM TEM DESFECHO É DITO PELA PRÓPRIA ABA, nas duas trilhas. O Interno tinha
  // uma lista separada de chaves, que precisava ser mantida em sincronia com os
  // destinos; a primeira etapa decisória acrescentada sem atualizar as duas
  // apareceria muda. Com a migração de 16/09/2026 o Interno ganhou `aprovaPara`
  // como o Externo, e a lista deixou de ter o que dizer.
  const oferece = (aba: DefAbaPrecatorio): boolean => (aba.saidas?.length ?? 0) > 0

  const desfechos = (aba: DefAbaPrecatorio): AcaoTela[] => {
    if (!oferece(aba)) return []
    const saida: AcaoTela[] = []
    // AS SAÍDAS POSITIVAS VÊM PRIMEIRO, na ordem declarada na etapa: é o caminho
    // que se busca, e as que interrompem são o desvio. Mesma ordem das abas.
    //
    // COLUNA QUE O ESPELHO NÃO TEM NÃO VIRA BOTÃO, e a saída é pulada sem levar
    // as outras junto: melhor a etapa com um botão a menos do que um que move o
    // card para lugar nenhum.
    for (const s of aba.saidas ?? []) {
      const id = coluna(s)
      if (id === undefined) continue
      saida.push({
        statusId: id,
        label: s.label,
        variant: s.variant ?? 'primary',
        papel: s.papel ?? 'aprovar',
      })
    }
    // AS QUE INTERROMPEM SÃO DA TRILHA, e não da etapa — interromper leva sempre
    // ao mesmo lugar. Mas nem toda etapa PODE interromper: a qualificação do
    // Externo passou a só encaminhar, para recusa e diligência não saírem sem
    // passar pela revisão. Ver `interrompe`.
    if (aba.interrompe === false) return saida
    const idDiligencia = coluna({ colunaKommo: def.colunaDiligencia, statusId: def.idDiligencia })
    const idReprovados = coluna({ colunaKommo: def.colunaReprovados, statusId: def.idReprovados })
    if (idDiligencia !== undefined) {
      saida.push({
        statusId: idDiligencia,
        label: 'Exigir diligência',
        variant: 'warning',
        papel: 'diligenciar',
      })
    }
    if (idReprovados !== undefined) {
      saida.push({
        statusId: idReprovados,
        label: 'Reprovar crédito',
        variant: 'danger',
        papel: 'reprovar',
      })
    }
    return saida
  }

  const montar = (a: DefAbaPrecatorio): Aba => {
    const statusId = coluna(a)
    return {
      key: a.key,
      label: a.label,
      // ABA SEM COLUNA CASADA CONTINUA EXISTINDO, com zero card. Sumir com ela
      // esconderia o defeito: a pessoa veria cinco abas onde a regra diz seis e
      // não teria como saber qual faltou. Quem nomeia a que faltou é
      // colunasPrecatorioDesalinhadas, no topo da tela.
      statusIds: statusId === undefined ? [] : [statusId],
      descricaoVazia: a.descricaoVazia,
      descricao: DESCRICAO_DA_COLUNA[statusId ?? a.statusId ?? -1],
      acoes: desfechos(a),
      // AS SAÍDAS SAEM DE UM BOTÃO SÓ — ver `desfechoAgrupado`. Era regra do
      // Externo, onde a análise acontece fora da plataforma e o que se precisa
      // guardar é a razão escrita por quem voltou dela; no Interno vale igual, e
      // por um motivo a mais: a janela é o único lugar onde a anotação que vai
      // para o Kommo é escrita antes de o card se mover.
      desfechoAgrupado: a.desfechoAgrupado ?? oferece(a),
      escolhaDeProposta: a.escolhaDeProposta ? (coluna(a.escolhaDeProposta) ?? null) : null,
      anexarEMover: (() => {
        const id = a.anexarEMover ? coluna(a.anexarEMover) : undefined
        return a.anexarEMover && id !== undefined
          ? { rotulo: a.anexarEMover.rotulo, nota: a.anexarEMover.nota, statusId: id }
          : null
      })(),
      envioAosFundos: (() => {
        const id = a.envioAosFundos ? coluna(a.envioAosFundos.destino) : undefined
        return a.envioAosFundos && id !== undefined ? { fundos: a.envioAosFundos.fundos, destino: id } : null
      })(),
      certidoes: a.certidoes ?? false,
    }
  }

  // O KANBAN INTEIRO, na ordem e com os nomes do Kommo (ver `espelhoCompleto`).
  // A coluna que tem função aqui leva a aba dela — botões, desfechos, etiquetas
  // —, só que com o nome do Kommo; a que não tem entra só para leitura.
  //
  // O INTERNO ENTRA AQUI PELA EXIBIÇÃO DO FRONT (`EXIBICAO_NO_FRONT`), e não
  // pela trilha: a trilha é lida também pela tela oficial e pelo servidor, e
  // ligar `espelhoCompleto` nela mudaria a tela da equipe. Ver lá.
  const exibicao = def.espelhoCompleto ? undefined : EXIBICAO_NO_FRONT[def.key]
  if (def.espelhoCompleto || exibicao) {
    const doEspelho = colunasDoFunil(def.pipelineId, etapas).map((e) => ({
      status_id: Number(e.status_id),
      nome: e.nome,
    }))
    // SEM ESPELHO AINDA: o kanban que a exibição declara, quando há (o Interno,
    // como o RPV); senão, as abas conhecidas — melhor que uma tela sem aba.
    const doFunil =
      doEspelho.length > 0
        ? doEspelho
        : (exibicao?.espelho.map((c) => ({ status_id: c.statusId, nome: c.nome })) ?? [])
    if (doFunil.length === 0) return def.abas.map(montar)
    // A ABA CASA COM A COLUNA PELO ID: renomeada no Kommo, a coluna continua com
    // os botões, as etiquetas e as automações dela, só que com o nome novo.
    // NA RESERVA (sem espelho), PELO ID DECLARADO: sem espelho `resolverColuna`
    // não acha coluna nenhuma, e toda aba de trabalho viraria uma `col-*` só de
    // leitura ao lado da aba dela, repetida. A aba continua sem os desfechos até
    // o espelho chegar — o mesmo de antes, quando não havia reserva.
    const naReserva = doEspelho.length === 0
    const porColuna = new Map<number, DefAbaPrecatorio>()
    for (const a of def.abas) {
      const id = naReserva ? a.statusId : coluna(a)
      if (id !== undefined && !porColuna.has(id)) porColuna.set(id, a)
    }
    const usadas = new Set<string>()
    const abas: Aba[] = doFunil.map((e) => {
      const d = porColuna.get(Number(e.status_id))
      if (d) {
        usadas.add(d.key)
        return { ...montar(d), label: e.nome }
      }
      return colunaSoDeLeitura(e)
    })
    // A ABA CONHECIDA CUJA COLUNA SUMIU fica no fim, vazia — é o que o aviso de
    // coluna não encontrada aponta, e sumir com ela esconderia o defeito.
    for (const d of def.abas) {
      if (usadas.has(d.key)) continue
      const nome = exibicao?.espelho.find((c) => c.statusId === d.statusId)?.nome ?? d.colunaKommo
      abas.push({ ...montar(d), label: nome })
    }
    return comFases(abas, def.fases ?? exibicao?.fases, idsDeclarados(def.abas))
  }

  // AS FASES TAMBÉM SEM O ESPELHO COMPLETO, se a trilha as declarar: a tela as
  // desenha a partir de `fases`, e não do nome da trilha.
  return comFases(def.abas.map(montar), def.fases, idsDeclarados(def.abas))
}

/**
 * O QUADRO DE UMA TRILHA DESENHADO SÓ NO FRONT: o kanban inteiro e as fases,
 * para a tela da beta, sem tocar na trilha.
 *
 * EXISTE PARA O INTERNO (pedido de 02/10/2026). As fases e o espelho completo do
 * Externo moram na trilha (`_shared/trilhasDoPrecatorio.ts`), que a tela OFICIAL
 * e o servidor também leem — ligar o mesmo no Interno mudaria a tela da equipe
 * antes de o dono aprovar. Aqui é só exibição: as abas de trabalho do Interno
 * continuam saindo da trilha, com as chaves, os botões e os destinos de hoje; as
 * colunas novas entram como `col-<id>`, SÓ PARA LEITURA (sem 'rpv' nem 'dd',
 * ver `botoesDaAba`). Nada daqui chega à `kommo-mover`.
 *
 * Trilha que um dia declarar `espelhoCompleto` passa a usar o dela, e esta
 * entrada deixa de valer — sem mudar nada em `abasDoFunil`.
 */
export const EXIBICAO_NO_FRONT: Partial<
  Record<SubdivisaoPrecatorio, { espelho: readonly { statusId: number; nome: string }[]; fases: readonly DefFase[] }>
> = {
  interno: {
    // O KANBAN DO INTERNO (14439512) como o `kommo_etapa` o devolveu em
    // 02/10/2026, na ordem de lá, sem a entrada de leads e as de sistema. É a
    // reserva enquanto o espelho não chega; com ele, valem o nome e a ordem dele.
    espelho: [
      { statusId: 111533940, nome: 'Análise jurídica e econômica' },
      { statusId: 111533944, nome: 'Revisão' },
      { statusId: 111533960, nome: 'Diligência' },
      { statusId: 111533948, nome: 'Produção de proposta' },
      { statusId: 112466260, nome: 'Negociação' },
      { statusId: 111533952, nome: 'Fechados' },
      { statusId: 112466032, nome: 'Oferta aos investidores' },
      { statusId: 111533956, nome: 'Escritura pública' },
      { statusId: 111693840, nome: 'Protocolo' },
      { statusId: 112466340, nome: 'Pagamento finalizado' },
      { statusId: 111534108, nome: 'Reprovados' },
      { statusId: 112465960, nome: 'Sem resposta' },
      { statusId: 112382612, nome: 'Não fechados' },
    ],
    // AS MESMAS QUATRO FASES DO RPV E DO EXTERNO, pelos ids — a distribuição da
    // amostra aprovada ("Oferta aos investidores" em Comercialização).
    fases: [
      { nome: 'Qualificação', colunas: [111533940, 111533944, 111533960] },
      { nome: 'Comercialização', colunas: [111533948, 112466260, 111533952, 112466032] },
      { nome: 'Formalização', colunas: [111533956, 111693840, 112466340] },
      { nome: 'Perdidos', colunas: [111534108, 112465960, 112382612], discreta: true },
    ],
  },
}

/** A coluna do kanban que a plataforma espelha sem dar função — ver `espelhoCompleto`. */
function colunaSoDeLeitura(e: { status_id: number; nome: string }): Aba {
  return {
    key: `col-${e.status_id}`,
    label: e.nome,
    statusIds: [e.status_id],
    descricaoVazia: `Nenhum card em ${e.nome}.`,
    descricao: DESCRICAO_DA_COLUNA[e.status_id],
    acoes: [],
    desfechoAgrupado: false,
    escolhaDeProposta: null,
    soLeitura: true,
  }
}

/** O id que cada aba declara, pela chave — para achar a fase da aba cuja coluna sumiu. */
function idsDeclarados(abas: readonly { key: string; statusId?: number }[]): Map<string, number | undefined> {
  return new Map(abas.map((a) => [a.key, a.statusId]))
}

/**
 * AS ABAS DO RPV: o kanban inteiro, nas quatro fases (etapa 7, 02/10/2026).
 *
 * A MESMA FORMA DO ESPELHO COMPLETO DO EXTERNO, com a definição própria do RPV
 * (`ESPELHO_RPV`, `FASES_RPV`, `TELAS`): toda coluna do funil vira aba, com o
 * nome e na ordem do Kommo; as seis que têm chave (`TELAS`) levam as ações
 * delas, e as outras entram como `col-<id>`, SÓ PARA LEITURA — sem botão de
 * trabalho (ver `botoesDaAba`) e sem desfecho. Nenhum movimento novo: as ações
 * são exatamente as de `ACOES`, de antes.
 */
function abasDoRpv(etapas: EtapaKommo[]): Aba[] {
  const doEspelho = colunasDoFunil(FUNIL_RPV, etapas)
  // SEM ESPELHO AINDA, o kanban de 02/10/2026: melhor que uma tela sem aba.
  const colunas =
    doEspelho.length > 0
      ? doEspelho.map((e) => ({ status_id: Number(e.status_id), nome: e.nome }))
      : ESPELHO_RPV.map((c) => ({ status_id: c.statusId, nome: c.nome }))

  const montar = (t: DefTela, nome: string): Aba => ({
    key: t.key,
    label: nome,
    statusIds: [t.statusId],
    descricaoVazia: t.descricaoVazia,
    descricao: DESCRICAO_DA_COLUNA[t.statusId],
    acoes: ACOES[t.key],
  })

  const porColuna = new Map(TELAS.map((t) => [t.statusId, t]))
  const usadas = new Set<string>()
  const abas: Aba[] = colunas.map((c) => {
    const t = porColuna.get(c.status_id)
    if (!t) return colunaSoDeLeitura(c)
    usadas.add(t.key)
    return montar(t, c.nome)
  })
  // A ABA DE TRABALHO CUJA COLUNA SUMIU DO KANBAN fica no fim, vazia, como no
  // Externo — é o que o aviso de `telasRpvDesalinhadas` aponta.
  for (const t of TELAS) if (!usadas.has(t.key)) abas.push(montar(t, t.label))
  return comFases(abas, FASES_RPV, new Map(TELAS.map((t) => [t.key, t.statusId])))
}

/**
 * A FASE DE CADA ABA, pelo id da coluna. A que não está em fase nenhuma herda a
 * da aba anterior (na ordem do kanban), e a primeira sem fase fica na primeira.
 * A aba cuja coluna sumiu do kanban usa o id declarado (`idDeclarado`).
 *
 * GENÉRICA SOBRE `fases`: serve às trilhas do precatório e ao RPV. Sem fases, as
 * abas voltam como vieram.
 */
function comFases(
  abas: Aba[],
  fases: readonly DefFase[] | undefined,
  idDeclarado: Map<string, number | undefined>,
): Aba[] {
  if (!fases || fases.length === 0) return abas
  const faseDoId = new Map<number, string>()
  for (const f of fases) for (const id of f.colunas) faseDoId.set(id, f.nome)
  let anterior = fases[0].nome
  return abas.map((a) => {
    const id = a.statusIds[0] ?? idDeclarado.get(a.key)
    const fase = (id !== undefined ? faseDoId.get(id) : undefined) ?? anterior
    anterior = fase
    return { ...a, fase, faseDiscreta: Boolean(fases.find((x) => x.nome === fase)?.discreta) }
  })
}

/**
 * As colunas de um funil no espelho, na ordem do kanban — sem as duas de
 * sistema (ganho e perdido) e sem a de ENTRADA DE LEADS, que o Kommo marca com
 * `tipo` 1: é do comercial, e ficou fora da tela a pedido (29/09/2026). Pelo
 * tipo, e não pelo nome, para continuar de fora se for renomeada.
 */
function colunasDoFunil(pipelineId: number, etapas: EtapaKommo[]): EtapaKommo[] {
  return etapas
    .filter(
      (e) =>
        e.pipeline_id === pipelineId &&
        !COLUNAS_DE_SISTEMA.has(Number(e.status_id)) &&
        Number(e.tipo) !== 1,
    )
    .sort((a, b) => a.ordem - b.ordem || a.status_id - b.status_id)
}

/**
 * Separa os cards nas abas — e devolve à parte os que não couberam em nenhuma.
 *
 * O SALDO EXISTE DE PROPÓSITO. Uma versão antiga filtrava card por card contra
 * os cinco status de RPV e descartava o resto em silêncio: um card movido no
 * Kommo para uma coluna fora dessas cinco sumia da tela, sem aparecer em aba
 * nenhuma e sem entrar em contagem nenhuma. Ninguém tinha como notar — a
 * ausência de um card não chama atenção.
 *
 * O saldo já teve aba própria ("Outras etapas") e depois uma linha de contagem
 * sob as abas; as duas foram removidas por decisão do dono. HOJE NADA O EXIBE, e
 * o efeito é assumido: card em coluna que a tela não lista não aparece em lugar
 * nenhum. Ele continua sendo devolvido aqui porque é assim que a função mantém
 * card estranho FORA das abas em vez de misturá-lo na primeira — e é o que o
 * teste de particionamento verifica.
 */
/**
 * Desde quando o card está na coluna em que está — ou null, se não sabemos.
 *
 * A CONFERÊNCIA DO STATUS É O CORAÇÃO DISTO. A data é gravada junto com a
 * coluna a que se refere, porque entre uma sincronização e outra alguém move o
 * card no Kommo. Sem comparar as duas, a tela exibiria com toda a confiança há
 * quanto tempo o card está num lugar onde ele já não está — e o erro seria
 * invisível, porque uma data errada tem exatamente a mesma cara de uma certa.
 */
export function dataDaEtapa(lead: KommoLead): string | null {
  if (!lead.etapa_em) return null
  return lead.etapa_status_id === lead.status_id ? lead.etapa_em : null
}

/**
 * A chave de ordenação dentro da coluna: quanto maior, mais recente.
 *
 * `criado_em` É A REDE DE SEGURANÇA, e não um segundo critério: card que ainda
 * não teve a data apurada — ou que se moveu depois do último sync — cairia para
 * o fim da lista com zero, que é o pior lugar para um card recém-chegado. A data
 * de criação erra por pouco e na direção certa.
 */
export function ordemNaColuna(lead: KommoLead): number {
  const quando = dataDaEtapa(lead) ?? lead.criado_em
  const t = quando ? Date.parse(quando) : NaN
  return Number.isNaN(t) ? 0 : t
}

/** Do mais recente para o mais antigo; empate pelo id, que também cresce no tempo. */
function daColunaMaisNovoPrimeiro(a: KommoLead, b: KommoLead): number {
  return ordemNaColuna(b) - ordemNaColuna(a) || b.kommo_lead_id - a.kommo_lead_id
}

export function agruparPorAba(
  leads: KommoLead[],
  abas: Aba[],
): { porAba: Record<string, KommoLead[]>; outras: KommoLead[] } {
  const porAba: Record<string, KommoLead[]> = {}
  const daAba = new Map<number, string>()
  for (const a of abas) {
    porAba[a.key] = []
    for (const s of a.statusIds) daAba.set(s, a.key)
  }
  const outras: KommoLead[] = []
  for (const l of leads) {
    const chave = daAba.get(l.status_id)
    if (chave) porAba[chave].push(l)
    else outras.push(l)
  }
  // CADA COLUNA DO MAIS NOVO PARA O MAIS ANTIGO, e a ordenação é aqui porque é
  // aqui que a coluna existe: a consulta devolve os cards dos quatro funis
  // misturados, e ordenar lá deixaria a ordem de cada aba à mercê de quem
  // mexeu no card mais recentemente em qualquer outra.
  for (const chave of Object.keys(porAba)) porAba[chave].sort(daColunaMaisNovoPrimeiro)
  outras.sort(daColunaMaisNovoPrimeiro)
  return { porAba, outras }
}

// nomeDaEtapa (nome da coluna de origem de um card) saiu junto com os dois
// lugares que a usavam: o selo cinza no card e a linha de contagem do saldo.
// Se ela voltar, o cuidado que o comentário dela guardava era este: a busca
// precisa do FUNIL e não só do status, porque os estágios de sistema 142 ("Venda
// ganha") e 143 ("Venda perdida") existem em TODOS os funis com o MESMO
// status_id — é o motivo da chave composta na migration 0044.

/**
 * Os status de RPV escritos à mão que NÃO existem mais no kanban do Kommo.
 *
 * Existe porque a 0044 tornou a checagem possível e seria desperdício não fazer:
 * as cinco constantes ST_* são números colados no código, e coluna recriada no
 * Kommo ganha id novo. Quando isso acontece, a aba correspondente passa a mostrar
 * zero card PARA SEMPRE, e o único vestígio é a pílula "Outras etapas" — que
 * ninguém relaciona à causa. Devolve vazio quando o espelho de etapas ainda não
 * chegou, para não acusar defeito por falta de dado.
 */
export function telasRpvDesalinhadas(etapas: EtapaKommo[]): DefTela[] {
  const doRpv = etapas.filter((e) => e.pipeline_id === FUNIL_RPV)
  if (doRpv.length === 0) return []
  const existentes = new Set(doRpv.map((e) => e.status_id))
  return TELAS.filter((t) => !existentes.has(t.statusId))
}

// ---------- O título do card ----------

// O CADASTRO DO CARD — a leitura do título e das anotações — mora em
// _shared/cadastroDoCard.ts desde 28/09/2026: o conector passou a gravar a
// planilha jurídica e precisa da mesma leitura. Reexportada daqui para nenhum
// import mudar.
export {
  classificarParcelaCedida,
  type DadosDoTitulo,
  lerCadastroDoCard,
  lerTituloCard,
  type ParcelaCedida,
  valorDoCampo,
} from '../../supabase/functions/_shared/cadastroDoCard.ts'
