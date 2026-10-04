// O CHECKLIST DE CERTIDÕES ARRUMADO PARA A TELA — agrupado por estado, o
// placar em quatro números, a pasta do Drive e de onde veio o cadastro.
//
// PEDIDO DO DONO (03/10/2026): "limpar visualmente as abas da certidão [...]
// condensar mais as informações importantes". A tela (PainelCertidoes) passou a
// mostrar primeiro o que precisa de ação — problemas e pendências — e a recolher
// as obtidas e as dispensadas no fim. Quem decide em que grupo cada item cai, e
// o que entra em cada número, mora aqui, puro e testado: são regras que a
// pessoa lê como verdade ("3 com problema") e não podem divergir da lista.
//
// NADA AQUI MUDA O QUE O BANCO DIZ. O placar oficial continua sendo o de
// v_dd_completude (obrigatórias, obtidas válidas, vencidas, dispensadas); os
// grupos só repartem os "pendentes" da view pelo que se faz com cada um.

/** O que a tela precisa de um item do checklist para agrupá-lo. */
export interface ItemParaAgrupar {
  status: string
  obrigatoria: boolean
  /** 'AAAA-MM-DD'. Só a obtida tem. */
  validade_ate?: string | null
}

export type GrupoDoChecklist = 'problema' | 'pendente' | 'emissao' | 'obtida' | 'dispensada'

/** A ordem na tela: o que pede ação primeiro, o que está resolvido no fim. */
export const ORDEM_DOS_GRUPOS: readonly GrupoDoChecklist[] = ['problema', 'pendente', 'emissao', 'obtida', 'dispensada']

export const ROTULO_DO_GRUPO: Record<GrupoDoChecklist, string> = {
  problema: 'Com problema',
  pendente: 'Pendentes',
  emissao: 'Em emissão',
  obtida: 'Obtidas',
  dispensada: 'Dispensadas',
}

/** Os grupos que abrem recolhidos: estão resolvidos, e a ação está nos outros. */
export const GRUPOS_RECOLHIDOS: ReadonlySet<GrupoDoChecklist> = new Set(['obtida', 'dispensada'])

/** A obtida cuja validade já passou — a mesma conta da view (validade < hoje). */
export function vencida(item: ItemParaAgrupar, hoje: string): boolean {
  return item.status === 'OBTIDA' && Boolean(item.validade_ate) && String(item.validade_ate) < hoje
}

/**
 * O grupo de um item.
 *
 * VENCIDA É PROBLEMA, e não obtida: a view não a conta como obtida válida, e a
 * etapa documental não fecha com ela. FALHA e PENDENTE_MANUAL também: nos dois
 * a certidão não vai sair sozinha. Estado desconhecido cai em pendente — nunca
 * some da lista, nem se esconde entre as resolvidas.
 */
export function grupoDoItem(item: ItemParaAgrupar, hoje: string): GrupoDoChecklist {
  switch (item.status) {
    case 'FALHA':
    case 'PENDENTE_MANUAL':
      return 'problema'
    case 'OBTIDA':
      return vencida(item, hoje) ? 'problema' : 'obtida'
    case 'EM_EMISSAO':
      return 'emissao'
    case 'NAO_APLICAVEL':
      return 'dispensada'
    default:
      return 'pendente'
  }
}

/** Os grupos na ordem da tela, só os que têm item, cada um em ordem alfabética. */
export function agruparChecklist<T extends ItemParaAgrupar>(
  itens: readonly T[],
  hoje: string,
  nome: (i: T) => string,
): { grupo: GrupoDoChecklist; itens: T[] }[] {
  const mapa = new Map<GrupoDoChecklist, T[]>()
  for (const i of itens) {
    const g = grupoDoItem(i, hoje)
    mapa.set(g, [...(mapa.get(g) ?? []), i])
  }
  return ORDEM_DOS_GRUPOS.filter((g) => mapa.has(g)).map((g) => ({
    grupo: g,
    itens: [...mapa.get(g)!].sort((a, b) => nome(a).localeCompare(nome(b), 'pt-BR')),
  }))
}

/**
 * Os números da faixa de resumo, SÓ DAS OBRIGATÓRIAS — a mesma base da view.
 * `pendentes + problema + emissao` é o "pendentes" da view mais as vencidas.
 */
export interface PlacarDoChecklist {
  pendentes: number
  problema: number
  emissao: number
  vencidas: number
}

export function placarDoChecklist(itens: readonly ItemParaAgrupar[], hoje: string): PlacarDoChecklist {
  const p: PlacarDoChecklist = { pendentes: 0, problema: 0, emissao: 0, vencidas: 0 }
  for (const i of itens) {
    if (!i.obrigatoria) continue
    const g = grupoDoItem(i, hoje)
    if (g === 'pendente') p.pendentes++
    else if (g === 'problema') p.problema++
    else if (g === 'emissao') p.emissao++
    if (vencida(i, hoje)) p.vencidas++
  }
  return p
}

/**
 * O RÓTULO DE UM NÚMERO DO PLACAR, NO NÚMERO CERTO (auditoria visual de
 * 03/10/2026, A4): a faixa dizia "1 pendentes". Um é singular; zero e dois ou
 * mais, plural — como se fala ("0 pendentes", "1 pendente", "2 pendentes").
 */
export function rotuloNoNumero(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

/** Hoje, 'AAAA-MM-DD', no fuso de Brasília — é contra ele que a validade vence. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

// ------------------------------------------------------------------ a pasta

/** A pasta do Drive que a tela oferece, e o que dizer dela. */
export interface PastaNaTela {
  url: string
  /** 'certidoes': a subpasta "Certidões"; 'analise': a pasta da análise do card. */
  qual: 'certidoes' | 'analise'
}

const URL_DA_PASTA = (id: string) => `https://drive.google.com/drive/folders/${id}`

/**
 * O atalho "Pasta no Drive" do topo da aba.
 *
 * A SUBPASTA "Certidões", quando já se sabe qual é: cada PDF da BullAI guarda o
 * id dela (`arquivos[].pasta_id`, desde 03/10/2026). Antes do primeiro PDF, a
 * pasta da análise do card (`drive_pasta_id`), que é onde a subpasta vai nascer.
 * Sem nenhuma das duas, nada — um link para lugar nenhum seria pior.
 *
 * SEM PERGUNTAR AO DRIVE AO ABRIR A ABA: os dois ids já estão no banco. Abrir a
 * pasta "depois de gerar" também não abre aba sozinho — o navegador bloqueia
 * janela aberta depois de uma chamada assíncrona —, então o link fica à mão.
 */
export function pastaDoChecklistNaTela(
  itens: readonly { arquivos?: readonly { pasta_id?: string | null }[] | null }[],
  drivePastaId: string | null | undefined,
): PastaNaTela | null {
  for (const i of itens) {
    const id = (i.arquivos ?? []).find((a) => a?.pasta_id)?.pasta_id
    if (id) return { url: URL_DA_PASTA(id), qual: 'certidoes' }
  }
  const analise = String(drivePastaId ?? '').trim()
  return analise ? { url: URL_DA_PASTA(analise), qual: 'analise' } : null
}

// ------------------------------------------------------- de onde veio o cadastro

/**
 * De onde vieram os dados do cedente na tela, numa palavra.
 *
 * Gravado e intocado é "cadastro gravado" — o banco não guarda a origem, e
 * inventá-la seria pior que dizer o que se sabe. No formulário: o ofício manda
 * (é a regra do titular), depois a IA, e o resto é digitação.
 */
export function origemDoCadastro(o: {
  gravado: boolean
  mexeu: boolean
  doOficio: boolean
  daIA: boolean
}): string {
  if (o.gravado && !o.mexeu) return 'cadastro gravado'
  if (o.doOficio) return 'do ofício'
  if (o.daIA) return 'lido pela IA'
  return 'digitado'
}

/** O cadastro contra o ofício requisitório, para o selo da faixa. */
export function conferenciaDoOficio(o: {
  temTitular: boolean
  diverge: boolean
  semOficio: boolean
}): { tom: 'sucesso' | 'perigo' | 'neutro'; rotulo: string } | null {
  if (o.temTitular && o.diverge) return { tom: 'perigo', rotulo: 'não bate com o ofício' }
  if (o.temTitular) return { tom: 'sucesso', rotulo: 'conferido no ofício' }
  if (o.semOficio) return { tom: 'neutro', rotulo: 'sem ofício nos anexos' }
  return null
}

/**
 * O aviso da leitura da IA que vai EM DESTAQUE: o que fala do documento (CPF ou
 * CNPJ descartado, inválido, de outra pessoa). Os outros ficam juntos e
 * recolhidos — continuam lá, a um clique.
 */
export function avisoDaIAEmDestaque(texto: string): boolean {
  return /\b(CPF|CNPJ|documento)\b/i.test(texto)
}
