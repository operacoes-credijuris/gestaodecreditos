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
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
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
 * É daqui que saem as abas do funil de Precatórios. O de RPV mantém as abas
 * curadas em TELAS, com rótulo próprio e botões de ação; o Precatório não tem
 * curadoria nenhuma ainda, então usa o kanban como ele é.
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
 * As abas de um funil.
 *
 * RPV usa TELAS: rótulos no vocabulário da plataforma e as três saídas de
 * Validação com um clique. Qualquer outro funil usa o kanban do Kommo como ele
 * é, SEM botão de ação — e isso é decisão, não pendência: os botões de RPV
 * carregam semântica ("Aprovar" = mover para Apresentação de Proposta) que
 * ninguém definiu para o Precatório. Adivinhar qual coluna significa "aprovado"
 * seria mover card de verdade com base em palpite. A kommo-mover, de todo modo,
 * só aceita os cinco status de RPV — um palpite aqui daria erro lá, o que é o
 * comportamento certo, mas o botão não devia existir.
 */
export function abasDoFunil(pipelineId: number, etapas: EtapaKommo[]): Aba[] {
  if (pipelineId === FUNIL_RPV) {
    return TELAS.map((t) => ({
      key: t.key,
      label: t.label,
      statusIds: [t.statusId],
      descricaoVazia: t.descricaoVazia,
      acoes: ACOES[t.key],
    }))
  }
  return etapas
    .filter((e) => e.pipeline_id === pipelineId)
    .map((e) => ({
      key: `st${e.status_id}`,
      label: e.nome,
      statusIds: [e.status_id],
      descricaoVazia: `Nenhum card em "${e.nome}" no Kommo.`,
      acoes: [],
    }))
}

/** A aba que existe só para nada desaparecer. Ver agruparPorAba. */
export const ABA_OUTRAS = 'outras'

/**
 * Separa os cards nas abas — e devolve à parte os que não couberam em nenhuma.
 *
 * O SALDO EXISTE DE PROPÓSITO. A versão anterior filtrava card por card contra
 * os cinco status de RPV e descartava o resto em silêncio: um card movido no
 * Kommo para uma coluna fora dessas cinco sumia da tela, sem aparecer em aba
 * nenhuma e sem entrar em contagem nenhuma. Ninguém tinha como notar — a
 * ausência de um card não chama atenção. Agora ele cai em "Outras etapas", que
 * só aparece quando tem algo dentro.
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
