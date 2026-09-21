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
import { primeiroCnj } from '../../supabase/functions/_shared/nucleo/cnj.ts'
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
  type PapelDaAcao,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
  type SubdivisaoPrecatorio,
  TRILHAS_PRECATORIO,
} from '../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
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
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
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
 * SEIS TONS, E ERAM TRÊS. Com três, seis etiquetas distintas ("Enviado PJUS",
 * "Reprovado BTG", "Cotado BTG", "Sem proposta"…) caíam duas a duas na mesma
 * cor. Verde e vermelho continuam fora: no card eles já significam análise
 * pronta e recusa.
 */
export const TONS_DA_TAG = ['blue', 'purple', 'orange', 'teal', 'pink', 'indigo'] as const

export type TomDaTag = (typeof TONS_DA_TAG)[number]

export function tomDaTag(nome: string): TomDaTag {
  const tons = TONS_DA_TAG
  // FNV-1a, e não a soma dos caracteres. A soma espalha mal quando os nomes
  // compartilham palavras — que é exatamente o caso aqui, onde quase toda
  // etiqueta é "<ato> <fundo>": "Reprovado PJUS" e "Reprovado BTG" têm metade
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
    let tom = tomDaTag(nome)
    if (usados.has(tom)) {
      const inicio = TONS_DA_TAG.indexOf(tom)
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
 * As telas da Análise de Crédito, uma por coluna do Kommo. Os rótulos usam o
 * vocabulário DA PLATAFORMA, não o do Kommo: quem opera aqui não precisa saber
 * que "Aprovados" é "Apresentação de Proposta" no CRM do comercial.
 *
 * A anotação gravada no card do Kommo usa o nome de lá, de propósito — quem a
 * lê é o comercial, dentro do Kommo (ver COLUNAS na Edge Function kommo-mover).
 */
export const TELAS: DefTela[] = [
  {
    key: 'pendentes',
    // AS CHAVES SÃO HISTÓRICAS, os rótulos não. 'pendentes' e 'validacao' são o
    // que a tela guarda e o que vai na URL; o que se lê mudou para o vocabulário
    // que a operação usa hoje, o mesmo das duas trilhas do Precatório — em
    // análise, depois revisão. Renomear as chaves quebraria link salvo sem
    // devolver nada em troca.
    label: 'Análise',
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
    label: 'Aprovados',
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
    label: 'Reprovados',
    statusId: ST_REPROVADO,
    descricaoVazia: 'Nenhum crédito reprovado.',
  },
  {
    key: 'protocolo',
    label: 'p/ Protocolo',
    statusId: ST_PROTOCOLO,
    descricaoVazia: 'Nenhum crédito aguardando protocolo.',
  },
]

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
}

/**
 * Índice nome-da-coluna -> status_id, para um funil.
 *
 * A chave passa por normalizarBusca porque o nome vem digitado em dois lugares
 * diferentes: no kanban do Kommo e em SUBDIVISOES_PRECATORIO. Exigir igualdade
 * byte a byte faria um acento ou um espaço a mais esvaziar uma aba.
 */
function porNomeDeColuna(pipelineId: number, etapas: EtapaKommo[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of etapas) {
    if (e.pipeline_id !== pipelineId) continue
    m.set(normalizarBusca(e.nome), e.status_id)
  }
  return m
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
  if (pipelineId === FUNIL_RPV) return new Set(TELAS.map((t) => t.statusId))
  if (!ehFunilPrecatorio(pipelineId)) return new Set()
  const ids = new Set<number>()
  // UM ESPELHO POR TRILHA, porque cada uma lê do seu funil. Resolver todas as
  // colunas num mapa só voltaria a misturar os dois kanbans — e há nome que se
  // repete entre eles ("PRODUÇÃO DE PROPOSTA", "DILIGÊNCIA"), com ids
  // diferentes.
  for (const s of SUBDIVISOES_PRECATORIO) {
    const nomes = porNomeDeColuna(s.pipelineId, etapas)
    for (const a of s.abas) {
      const id = nomes.get(normalizarBusca(a.colunaKommo))
      if (id !== undefined) ids.add(id)
    }
  }
  return ids
}

/**
 * As colunas que o Precatório fixa pelo nome e que o kanban do Kommo não tem.
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
    const nomes = porNomeDeColuna(s.pipelineId, etapas)
    for (const a of s.abas) {
      if (!nomes.has(normalizarBusca(a.colunaKommo))) faltando.push(a)
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
])

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
  const id = porNomeDeColuna(sub.pipelineId, etapas).get(normalizarBusca(sub.colunaReprovados))
  return id === undefined ? null : reprovar(id)
}

export function abasDoFunil(
  pipelineId: number,
  etapas: EtapaKommo[],
  subdivisao: SubdivisaoPrecatorio | null = null,
): Aba[] {
  if (pipelineId === FUNIL_RPV) {
    return TELAS.map((t) => ({
      key: t.key,
      label: t.label,
      statusIds: [t.statusId],
      descricaoVazia: t.descricaoVazia,
      acoes: ACOES[t.key],
    }))
  }
  if (!ehFunilPrecatorio(pipelineId)) return []

  const def = SUBDIVISOES_PRECATORIO.find(
    (s) => s.key === (subdivisao ?? SUBDIVISAO_PADRAO),
  )
  if (!def) return []
  // DO FUNIL DA TRILHA, e não do que veio por parâmetro: o parâmetro é o funil
  // que a tela tem aberto no topo, e as duas trilhas do Precatório vivem em
  // pipelines diferentes durante a migração.
  const nomes = porNomeDeColuna(def.pipelineId, etapas)

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
      const id = nomes.get(normalizarBusca(s.colunaKommo))
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
    const idDiligencia = nomes.get(normalizarBusca(def.colunaDiligencia))
    const idReprovados = nomes.get(normalizarBusca(def.colunaReprovados))
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

  return def.abas.map((a) => {
    const statusId = nomes.get(normalizarBusca(a.colunaKommo))
    return {
      key: a.key,
      label: a.label,
      // ABA SEM COLUNA CASADA CONTINUA EXISTINDO, com zero card. Sumir com ela
      // esconderia o defeito: a pessoa veria cinco abas onde a regra diz seis e
      // não teria como saber qual faltou. Quem nomeia a que faltou é
      // colunasPrecatorioDesalinhadas, no topo da tela.
      statusIds: statusId === undefined ? [] : [statusId],
      descricaoVazia: a.descricaoVazia,
      acoes: desfechos(a),
      // AS SAÍDAS SAEM DE UM BOTÃO SÓ — ver `desfechoAgrupado`. Era regra do
      // Externo, onde a análise acontece fora da plataforma e o que se precisa
      // guardar é a razão escrita por quem voltou dela; no Interno vale igual, e
      // por um motivo a mais: a janela é o único lugar onde a anotação que vai
      // para o Kommo é escrita antes de o card se mover.
      desfechoAgrupado: oferece(a),
    }
  })
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

/** O separador dos campos no título, como o comercial escreve. */
const SEP_TITULO = ' - '

/**
 * O separador na leitura: o hífen entre espaços, e as variantes tipográficas.
 *
 * O TRAVESSÃO ENTRA porque não é outro formato — é o mesmo caractere depois de
 * passar pela correção automática do teclado ou de um colar do Word. Exigir o
 * hífen exato fazia o título inteiro virar uma parte só, e daí não se lê nem o
 * intermediador (que é obrigatório): a análise nem começava.
 *
 * OS ESPAÇOS EM VOLTA SÃO OBRIGATÓRIOS, e é isso que salva o número: o CNJ tem
 * um hífen dentro ("0001234-56"), e sem exigir espaço ele seria separador.
 */
const RE_SEPARADOR = /\s+[-–—]\s+/

/** Uma porcentagem colada no fim de uma frase: "principal + honorários 30%". */
const RE_PORCENTAGEM_NO_FIM = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*$/

/** Uma porcentagem e nada mais: "30", "30%", "12,5%". */
const RE_SO_PORCENTAGEM = /^(\d{1,3}(?:[.,]\d+)?)\s*%?$/
/** Palavra que só aparece em nome de verba, nunca em nome de pessoa ou empresa. */
const RE_VERBA = /principal|honor|sucumb|contratu/i

// O CNJ que houver num pedaço de texto, sempre pontuado. A leitura mora em
// _shared/nucleo/cnj.ts, com o resto: eram três implementações da mesma coisa, e
// a do kommo-sync — que não reconhecia o número cru — gravava no espelho o
// processo citado numa ANOTAÇÃO em vez do do título.
const cnjNoTexto = primeiroCnj

/** O que o título do card diz. Campo ausente vem como ''. */
export interface DadosDoTitulo {
  intermediador: string
  cedente: string
  /** CNJ pontuado. */
  numero: string
  /** O texto cru da parcela cedida — quem classifica é classificarParcelaCedida. */
  parcelaCedida: string
  /** Porcentagem pronta para Number(): "30", "12.5". */
  honorariosPct: string
}

const TITULO_VAZIO: DadosDoTitulo = {
  intermediador: '', cedente: '', numero: '', parcelaCedida: '', honorariosPct: '',
}

/**
 * Os campos do crédito escritos no título do card.
 *
 * O comercial vem encurtando o cadastro, e o destino disso é o título carregar
 * tudo: "[intermediador] - [cedente] - [nº] - [parcela cedida] - [% honorários]".
 *
 * LIDO POR CONTEÚDO, NÃO POR POSIÇÃO, e a diferença importa. Ler por posição
 * significa que um nome com " - " dentro — "SILVA - ADVOGADOS ASSOCIADOS" —
 * empurra todos os campos seguintes uma casa, e a parcela cedida passa a ser
 * lida do lugar do número. Isso não dá erro: precifica a verba errada e a
 * análise sai completa.
 *
 * Então o que ancora tudo é o NÚMERO CNJ, que é inconfundível. Antes dele estão
 * o intermediador (a primeira parte) e o cedente (o que sobra até o número,
 * remontado com o separador, o que devolve o nome inteiro); depois dele estão a
 * parcela cedida e a porcentagem, cada uma reconhecida pelo que é e em qualquer
 * ordem. As palavras de verba só são procuradas DEPOIS do número, para um
 * cedente chamado "Principal Logística" não virar parcela cedida.
 *
 * Título sem número reconhecível cai na leitura posicional antiga — as duas
 * primeiras partes —, porque sem a âncora não há como saber onde o nome termina.
 */
export function lerTituloCard(titulo: unknown): DadosDoTitulo {
  const cru = String(titulo ?? '').split(RE_SEPARADOR).map((p) => p.trim())

  // A PORCENTAGEM É INCONFUNDÍVEL EM QUALQUER POSIÇÃO: nenhum nome de pessoa ou
  // de empresa é um número solto de até três dígitos. Então ela é colhida antes
  // de tudo e RETIRADA da lista — escrita fora do lugar combinado, ela deixa de
  // entrar no nome do cedente, que era o efeito de lê-la pela posição. Até três
  // dígitos, de propósito: assim um ano ("2023") não é confundido com ela.
  //
  // Vírgula é o decimal, e ponto também: porcentagem não tem separador de
  // milhar, então não há o que descartar.
  let honorariosPct = ''
  const partes: string[] = []
  cru.forEach((p, i) => {
    const m = i > 0 && !honorariosPct ? p.match(RE_SO_PORCENTAGEM) : null
    if (m) honorariosPct = m[1].replace(',', '.')
    else partes.push(p)
  })

  const iCnj = partes.findIndex((p) => cnjNoTexto(p))
  if (iCnj < 0) {
    return {
      ...TITULO_VAZIO,
      honorariosPct,
      intermediador: partes[0] ?? '',
      cedente: partes[1] ?? '',
    }
  }

  // TODAS as partes de verba, juntadas — não a primeira.
  //
  // "principal - honorários" é uma parcela cedida escrita com o separador entre
  // as verbas, e é escrita provável: o hífen é o que o comercial já usa para
  // tudo no título. Pegando só a primeira, isso virava cessão SÓ DO PRINCIPAL —
  // o honorário caía fora do negócio sem nada acusar. Juntadas, a classificação
  // vê as duas verbas e responde "ambos", que é o que estava escrito.
  const verbas: string[] = []
  for (const p of partes.slice(iCnj + 1)) {
    if (!RE_VERBA.test(p)) continue
    // "principal + honorários 30%" numa parte só, sem separar: a verba fica e a
    // porcentagem colada nela é aproveitada. AQUI O SINAL DE % É EXIGIDO —
    // número solto no meio de uma frase pode ser qualquer coisa, e adivinhar
    // seria pior que perder.
    const m = p.match(RE_PORCENTAGEM_NO_FIM)
    if (!m) {
      verbas.push(p)
      continue
    }
    if (!honorariosPct) honorariosPct = m[1].replace(',', '.')
    verbas.push(p.slice(0, m.index).replace(/[\s,;:]+$/, ''))
  }

  return {
    intermediador: iCnj > 0 ? partes[0] : '',
    cedente: iCnj > 1 ? partes.slice(1, iCnj).join(SEP_TITULO) : '',
    numero: cnjNoTexto(partes[iCnj]),
    parcelaCedida: verbas.join(SEP_TITULO),
    honorariosPct,
  }
}

// ---------- A anotação do comercial ----------

/**
 * Um ponto-e-vírgula seguido de outro rótulo — "; HONORÁRIOS C.:".
 *
 * A anotação é texto livre, e o comercial escreve os campos NUMA LINHA SÓ.
 * Capturar do rótulo até o fim da linha fazia "PARCELA CEDIDA: principal;
 * HONORÁRIOS C.: 30%" valer "principal; HONORÁRIOS C.: 30%" — e a palavra
 * "honorários" ali dentro classificava uma cessão de PRINCIPAL como PRINCIPAL
 * + HONORÁRIOS. O erro não aparece em lugar nenhum: a análise sai completa,
 * com uma verba a mais no preço — justamente a que fica com o advogado.
 *
 * O PONTO-E-VÍRGULA SOZINHO NÃO CORTA: "honorários contratuais +
 * sucumbenciais; sem principal" é um valor só. O que corta é o rótulo depois
 * dele — dois-pontos precedidos de poucas palavras.
 */
const RE_PROXIMO_ROTULO = /;\s*[^:;\n]{1,40}:/

/** O valor de um campo da anotação: do rótulo até o fim da linha ou até o próximo rótulo. */
export function valorDoCampo(bruto: unknown): string {
  const t = String(bruto ?? '')
  const m = t.match(RE_PROXIMO_ROTULO)
  return (m ? t.slice(0, m.index) : t).trim()
}

/**
 * O que está sendo cedido, lido do "PARCELA CEDIDA" das anotações do card.
 *
 * Os quatro valores correspondem, um a um, aos quatro cenários da planilha de
 * precificação e à lista suspensa da célula C3 da aba jurídica. É esta
 * classificação que decide qual coluna sobra no arquivo entregue e sobre o que
 * o deságio é calibrado — errar aqui precifica a coisa errada, em silêncio.
 *
 * 'auto' = o card não disse; quem decide passa a ser o destaque dos honorários
 * nos cálculos da contadoria.
 */
export type ParcelaCedida =
  | 'principal'      // só o crédito principal
  | 'ambos'          // principal + honorários
  | 'honorarios'     // honorários contratuais E sucumbenciais
  | 'contratuais'    // só os honorários contratuais
  | 'sucumbenciais'  // só os honorários sucumbenciais
  | 'indefinido'     // diz "honorários" e não diz quais — resolva contra os autos
  | 'auto'           // o card não disse nada

export function classificarParcelaCedida(texto: unknown): ParcelaCedida {
  const t = String(texto ?? '').toLowerCase()
  const principal = /principal/.test(t)
  const sucumbenciais = /sucumb/.test(t)
  const contratuais = /contratu/.test(t)
  const honorarios = /honor/.test(t) || sucumbenciais || contratuais

  if (principal && honorarios) return 'ambos'
  if (principal) return 'principal'

  // Daqui para baixo é cessão só de honorários, e QUAL verba muda o preço:
  // contratuais saem do bolo do principal, sucumbenciais vêm por fora, pagos
  // pelo vencido. Somar as duas quando só uma foi cedida é comprar crédito que
  // não vem junto.
  if (contratuais && sucumbenciais) return 'honorarios'      // as duas verbas
  if (sucumbenciais) return 'sucumbenciais'                  // só a do vencido
  // Card que diz só "contratuais" é, quase sempre, processo SEM sucumbenciais —
  // não cessão que os deixa de fora. Por isso o preço trata este caso igual ao
  // de cima (cede-se o honorário que existe); a distinção sobrevive aqui só
  // para o motor poder avisar quando o processo tiver a outra verba.
  if (contratuais) return 'contratuais'                      // só a do contrato

  // "HONORÁRIOS", SEM DIZER QUAIS: A PERGUNTA VAI PARA OS AUTOS.
  //
  // Quem responde é o motor, e só ele pode: a maioria das RPVs vem do JUIZADO
  // ESPECIAL, onde não há sucumbência em primeiro grau (art. 55 da Lei
  // 9.099/95) — existe um honorário só, o contratual, e "honorários" não é
  // ambíguo ali. Havendo as DUAS verbas no processo, aí sim a escolha é real
  // (contratuais saem de dentro do principal, sucumbenciais vêm por fora,
  // pagos pelo vencido) e a análise para, pedindo que o card diga qual.
  //
  // Esta função não sabe o que há nos autos, então não decide: devolve
  // 'indefinido', que quer dizer "resolva contra o processo".
  if (honorarios) return 'indefinido'
  return 'auto'
}
