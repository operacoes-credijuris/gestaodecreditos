// Mapeamento entre as colunas do kanban do Kommo e as telas da Análise de
// Crédito, mais as consultas ao espelho local (public.kommo_leads).
//
// A UI nunca fala com a API do Kommo: ela não devolve headers de CORS e o token
// tem direitos de administrador. Quem busca é a Edge Function kommo-sync; quem
// escreve é a kommo-mover.
//
// Fluxo do operacional:
//   Pendentes   a IA analisa o card, que fica aqui até a equipe de revisão
//               considerar a análise boa
//        ↓      "Enviar para validação"
//   Validação   três saídas
//        ↓
//   Aprovados | Diligência | Reprovados
//
// A análise (inclusive o motivo de uma eventual reprovação) é produzida em
// Pendentes. Validação só ratifica — por isso nenhuma das três saídas pede
// justificativa: ela já foi escrita antes.
//
// Toda tela corresponde a exatamente uma coluna do Kommo. Não há estado que
// exista só na nossa base — o kanban é a fonte de verdade.
//
// PRECATÓRIOS seguem a mesma ideia, com uma diferença: o funil deles atende
// DUAS destinações (Interno e Fundos), então as colunas estão divididas em duas
// listas fixas — ver SUBDIVISOES_PRECATORIO. Antes isso era configurável na
// própria tela (tabela etapa_visao, migration 0045); passou a ser fixo no
// código, como RPV sempre foi.
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { normalizarBusca } from './format'
import type { KommoLead, KommoAnaliseInterna } from './types'

// Conta do Kommo. O subdomínio não é segredo — é o que aparece na URL.
export const KOMMO_SUBDOMINIO = 'contatocredijuriscom'

// Funis que o operacional usa.
export const FUNIL_RPV = 13901939
export const FUNIL_PRECATORIO = 13971995

// Estágios do Funil Geral RPV que interessam ao operacional. Os nomes das
// constantes seguem os nomes das COLUNAS NO KOMMO; o rótulo que o usuário vê
// está em TELAS[].label e pode divergir (ST_DECISAO aparece como "Validação").
export const ST_ANALISE = 107272803 // Análise Jurídica-Econômico
export const ST_DECISAO = 107272807 // Revisão e Decisão do Pedro
export const ST_DILIGENCIA = 107830027 // Diligência
export const ST_PROPOSTA = 107830035 // Apresentação de Proposta
export const ST_REPROVADO = 107830031 // Reprovados Operacional

// ---------- Precatórios: as duas destinações, fixas ----------

/**
 * O destino do precatório, que decide por qual trilha ele anda no funil.
 *
 * NÃO é tipo de crédito (isso é o funil: RPV ou Precatório) e NÃO é etapa (isso
 * são as abas). É um terceiro eixo, e é justamente por serem três que a tela
 * precisa dar formas diferentes a cada um — dois seletores idênticos lado a
 * lado se leem como a mesma pergunta feita duas vezes.
 */
export type SubdivisaoPrecatorio = 'interno' | 'fundos'

/**
 * Uma aba do Precatório: o rótulo da plataforma e a coluna do Kommo por trás.
 *
 * A LIGAÇÃO É PELO NOME DA COLUNA, e não pelo status_id como em RPV. Não é
 * preferência de estilo: os ids do funil de Precatórios não existem em lugar
 * nenhum do código e só se leem com sessão aberta no banco (kommo_etapa exige
 * `authenticated`). O nome é o que se lê no kanban, então é o que dá para fixar
 * aqui — e a tela resolve o id sozinha, no navegador de quem já está logado.
 *
 * A troca de risco é explícita: id fixo quebra quando a coluna é RECRIADA no
 * Kommo (ganha id novo); nome fixo quebra quando ela é RENOMEADA. Nos dois
 * casos a aba mostraria zero card para sempre — e é por isso que existe
 * `colunasPrecatorioDesalinhadas`: a tela diz qual nome não encontrou, em vez
 * de ficar vazia em silêncio.
 *
 * A comparação passa por normalizarBusca, então acento, caixa e espaço a mais
 * não quebram nada: "Análise Jurídica (TIER 1)" casa com "ANALISE JURIDICA
 * (TIER 1)".
 */
export interface DefAbaPrecatorio {
  key: string
  /** Rótulo na plataforma — vocabulário nosso, não o do CRM do comercial. */
  label: string
  /** Nome da coluna no kanban do Kommo, como está escrito lá. */
  colunaKommo: string
  descricaoVazia: string
}

export interface DefSubdivisao {
  key: SubdivisaoPrecatorio
  label: string
  /** Uma linha dizendo o que a subdivisão é, exibida sob o seletor. */
  descricao: string
  abas: DefAbaPrecatorio[]
}

/**
 * As colunas de cada destinação, e só elas. Do "Funil Geral Precatório".
 *
 * "APRESENTAÇÃO DE PROPOSTA" APARECE NAS DUAS, de propósito: é a MESMA coluna
 * do Kommo, com rótulo diferente em cada trilha ("Aprovados" no Interno,
 * "Apresentação" nos Fundos). Consequência assumida: um card ali é contado nas
 * duas subdivisões. Confirmado pelo dono — não é descuido de cópia.
 *
 * A ordem das abas é a DO TRABALHO, não a do kanban: no Interno, Aprovados vem
 * antes de Diligência porque é o desfecho que se busca, e a diligência é o
 * desvio. Mudar a ordem aqui muda a ordem na tela, nada mais.
 */
export const SUBDIVISOES_PRECATORIO: DefSubdivisao[] = [
  {
    key: 'interno',
    label: 'Interno',
    descricao: 'Precatórios destinados à base de investidores da Credijuris.',
    abas: [
      {
        key: 'int-due-diligence',
        label: 'Due diligence + Análise Jurídica',
        colunaKommo: 'Análise Jurídica (TIER 1)',
        descricaoVazia: 'Nenhum precatório em due diligence.',
      },
      {
        key: 'int-precificacao',
        label: 'Precificação',
        colunaKommo: 'Análise Econômico-Financeira (TIER 1)',
        descricaoVazia: 'Nenhum precatório em precificação.',
      },
      {
        key: 'int-validacao',
        label: 'Validação',
        colunaKommo: 'Revisão (TIER 1)',
        descricaoVazia: 'Nenhum precatório aguardando validação.',
      },
      {
        key: 'int-aprovados',
        label: 'Aprovados',
        colunaKommo: 'Apresentação de Proposta',
        descricaoVazia: 'Nenhum precatório aprovado.',
      },
      {
        key: 'int-diligencia',
        label: 'Diligência',
        colunaKommo: 'Diligência',
        descricaoVazia: 'Nenhum precatório em diligência.',
      },
      {
        key: 'int-reprovados',
        label: 'Reprovados',
        colunaKommo: 'Reprovados Operacional',
        descricaoVazia: 'Nenhum precatório reprovado.',
      },
    ],
  },
  {
    key: 'fundos',
    label: 'Fundos',
    descricao: 'Precatórios encaminhados a fundos, com defesa técnica própria.',
    abas: [
      {
        key: 'fun-qualificacao',
        label: 'Qualificação Preliminar',
        colunaKommo: 'Qualificação Jurídica Preliminar',
        descricaoVazia: 'Nenhum precatório em qualificação preliminar.',
      },
      {
        key: 'fun-encaminhar',
        label: 'Encaminhar',
        colunaKommo: 'Encaminhar ao Fundo',
        descricaoVazia: 'Nenhum precatório a encaminhar.',
      },
      {
        key: 'fun-defesa',
        label: 'Elaboração da Defesa Técnica',
        colunaKommo: 'Defesa Técnica (TIER 2+)',
        descricaoVazia: 'Nenhuma defesa técnica em elaboração.',
      },
      {
        key: 'fun-validacao',
        label: 'Validação',
        colunaKommo: 'Revisão da Defesa Técnica (TIER 2+)',
        descricaoVazia: 'Nenhuma defesa técnica aguardando validação.',
      },
      {
        key: 'fun-apresentacao',
        label: 'Apresentação',
        colunaKommo: 'Apresentação de Proposta',
        descricaoVazia: 'Nenhum precatório em apresentação.',
      },
    ],
  },
]

/** A subdivisão que a tela abre por padrão. */
export const SUBDIVISAO_PADRAO: SubdivisaoPrecatorio = 'interno'

export type TelaAnalise =
  | 'pendentes'
  | 'validacao'
  | 'aprovados'
  | 'diligencia'
  | 'reprovados'

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
    label: 'Pendentes',
    statusId: ST_ANALISE,
    descricaoVazia:
      'Nenhum card aguardando revisão. Quando o comercial mover um crédito para análise no Kommo, ele aparece aqui.',
  },
  {
    key: 'validacao',
    label: 'Validação',
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
]

export interface AcaoTela {
  statusId: number
  label: string
  variant: 'primary' | 'success' | 'warning' | 'danger'
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
  pendentes: [
    { statusId: ST_DECISAO, label: 'Enviar para validação', variant: 'primary' },
  ],
  // Cores em vez de hierarquia: as três são alternativas legítimas, e
  // verde/laranja/vermelho se lê mais rápido que o rótulo numa tela onde a mesma
  // decisão é tomada dezenas de vezes.
  validacao: [
    { statusId: ST_PROPOSTA, label: 'Aprovar', variant: 'success' },
    { statusId: ST_DILIGENCIA, label: 'Diligência', variant: 'warning' },
    { statusId: ST_REPROVADO, label: 'Reprovar', variant: 'danger' },
  ],
  aprovados: [],
  diligencia: [],
  reprovados: [],
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

export function useKommoLeads(pipelineId: number) {
  return useQuery({
    queryKey: ['kommo_leads', pipelineId],
    queryFn: async () => {
      const todos: KommoLead[] = []
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const de = pagina * POR_PAGINA
        const { data, error } = await supabase
          .from('kommo_leads')
          .select('*')
          .eq('pipeline_id', pipelineId)
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
 * SUBDIVISOES_PRECATORIO para Precatório). O espelho serve a duas coisas:
 * resolver o status_id da coluna que o Precatório fixa pelo NOME, e dar o nome
 * da coluna de origem de um card (nomeDaEtapa).
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
  const doFunil = etapas.filter((e) => e.pipeline_id === FUNIL_PRECATORIO)
  if (doFunil.length === 0) return []
  const nomes = porNomeDeColuna(FUNIL_PRECATORIO, etapas)
  const defs = subdivisao
    ? (SUBDIVISOES_PRECATORIO.find((s) => s.key === subdivisao)?.abas ?? [])
    : SUBDIVISOES_PRECATORIO.flatMap((s) => s.abas)
  return defs.filter((a) => !nomes.has(normalizarBusca(a.colunaKommo)))
}

/**
 * As abas de um funil.
 *
 * OS DOIS FUNIS TÊM ABAS FIXAS, cada um do seu jeito: RPV amarra o status_id
 * (TELAS) e o Precatório amarra o nome da coluna (SUBDIVISOES_PRECATORIO, ver
 * lá o porquê). Nenhum dos dois lê mais o kanban como ele é.
 *
 * SEM BOTÃO DE AÇÃO no Precatório, e isso é decisão, não pendência: os botões de
 * RPV carregam semântica ("Aprovar" = mover para Apresentação de Proposta) que
 * ninguém definiu para o Precatório. Adivinhar qual coluna significa "aprovado"
 * seria mover card de verdade com base em palpite. A kommo-mover, de todo modo,
 * só aceita os cinco status de RPV — um palpite aqui daria erro lá.
 */
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
  if (pipelineId !== FUNIL_PRECATORIO) return []

  const def = SUBDIVISOES_PRECATORIO.find(
    (s) => s.key === (subdivisao ?? SUBDIVISAO_PADRAO),
  )
  if (!def) return []
  const nomes = porNomeDeColuna(FUNIL_PRECATORIO, etapas)

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
      acoes: [] as AcaoTela[],
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
 * O saldo já teve aba própria ("Outras etapas"), removida por decisão do dono.
 * Hoje ele vira UMA LINHA de contagem sob as abas: continua impossível um card
 * desaparecer sem deixar rastro, sem custar uma pílula na régua de etapas.
 */
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
  return { porAba, outras }
}

/**
 * Nome da coluna do Kommo, para explicar de onde vem um card.
 *
 * PRECISA DO FUNIL, não só do status. É o mesmo motivo da chave composta na
 * migration 0044: os estágios de sistema 142 ("Venda ganha") e 143 ("Venda
 * perdida") existem em TODOS os funis com o MESMO status_id. Buscando só pelo
 * status, um card de RPV em "Venda ganha" podia ser rotulado com o nome que
 * aquela coluna tem no funil de Precatórios.
 */
export function nomeDaEtapa(
  statusId: number,
  pipelineId: number,
  etapas: EtapaKommo[],
): string {
  const achada = etapas.find(
    (e) => e.status_id === statusId && e.pipeline_id === pipelineId,
  )
  return achada?.nome ?? `coluna ${statusId}`
}

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
