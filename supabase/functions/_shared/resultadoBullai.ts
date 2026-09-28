// O QUE A BULLAI DEVOLVE, traduzido para o checklist da casa.
//
// A BullAI responde portal a portal: cada um com um status (pendente, rodando,
// concluído, falhou, aguardando e-mail…) e uma categoria de resultado (negativa,
// positiva, não encontrado, indeterminada, só manual, portal fora do ar…). O
// checklist pensa por ITEM, e um item pode ser mais de um portal — o TJ cível e
// criminal da BA é uma linha da planilha e duas certidões. Este arquivo junta as
// duas visões: dado o que cada portal do item disse, em que pé está o item.
//
// MÓDULO PURO — sem `Deno.` e sem `npm:`.

/** Um portal de um pedido, como a BullAI o descreve (os campos que usamos). */
export interface RodadaDoPortal {
  portalKey: string
  portalLabel?: string
  status: string
  errorCategory?: string | null
  message?: string
  expectedBy?: string
  artifactIds?: string[]
}

export type ResultadoDaCertidao = 'positiva' | 'indeterminada' | 'emitida' | 'nada_consta' | 'negativa'

/**
 * O resultado que a categoria da BullAI declara, ou null quando ela não fala de
 * resultado (falha, portal fora do ar, limite de chamadas).
 *
 * "NOT_FOUND" É NADA CONSTA: o portal procurou e não achou registro contra o
 * documento — que, numa certidão de distribuição, é o resultado que se quer.
 */
export function resultadoDaCategoria(categoria: unknown): ResultadoDaCertidao | null {
  switch (String(categoria ?? '')) {
    case 'negative':
      return 'negativa'
    case 'not_found':
      return 'nada_consta'
    case 'positive':
      return 'positiva'
    case 'indeterminate':
      return 'indeterminada'
    case 'success':
      return 'emitida'
    default:
      return null
  }
}

/**
 * Do mais grave ao menos grave. É a ordem em que o item mostra o resultado
 * quando os portais dele discordam: uma cível negativa e uma criminal POSITIVA
 * são um item positivo — mostrar "negativa" esconderia justamente o que pesa.
 */
const GRAVIDADE: ResultadoDaCertidao[] = ['positiva', 'indeterminada', 'emitida', 'nada_consta', 'negativa']

export function piorResultado(resultados: ResultadoDaCertidao[]): ResultadoDaCertidao | null {
  for (const r of GRAVIDADE) if (resultados.includes(r)) return r
  return null
}

/** Os estados de rodada que ainda vão mudar. */
const EM_CURSO = new Set(['pending', 'running', 'awaiting_async'])
/** As categorias que dizem que a falha é do caminho, e não do documento. */
const FALHAS = new Set(['portal_inoperable', 'rate_limited', 'invalid_input', 'failed'])

export interface EstadoDoItem {
  /** O status do checklist: OBTIDA, EM_EMISSAO, FALHA, PENDENTE_MANUAL. */
  status: 'OBTIDA' | 'EM_EMISSAO' | 'FALHA' | 'PENDENTE_MANUAL'
  resultado: ResultadoDaCertidao | null
  /** O que explicar na tela, quando não está obtida. */
  detalhe: string | null
}

/**
 * Em que pé está um item, pelas rodadas dos portais dele.
 *
 * `comArquivo` diz de quais portais o PDF já está no Drive — e SÓ COM O PDF o
 * item é OBTIDA: a trava de conclusão da etapa documental exige o arquivo, e
 * "a BullAI disse que emitiu" sem o arquivo em casa não fecha dossiê nenhum.
 */
export function estadoDoItem(
  portaisDoItem: string[],
  rodadas: RodadaDoPortal[],
  comArquivo: ReadonlySet<string>,
): EstadoDoItem {
  const minhas = portaisDoItem.map((p) => ({ chave: p, rodada: rodadas.find((r) => r.portalKey === p) }))

  // SÓ MANUAL: a BullAI diz que aquela certidão exige ir ao balcão.
  const manuais = minhas.filter((m) => m.rodada?.errorCategory === 'manual_only')
  if (manuais.length > 0 && manuais.length === minhas.length) {
    return {
      status: 'PENDENTE_MANUAL',
      resultado: null,
      detalhe: 'A BullAI informou que esta certidão só se obtém presencialmente.',
    }
  }

  const falhas = minhas.filter(
    (m) =>
      m.rodada &&
      !EM_CURSO.has(m.rodada.status) &&
      (['failed', 'timed_out', 'cancelled', 'skipped'].includes(m.rodada.status) ||
        FALHAS.has(String(m.rodada.errorCategory ?? ''))),
  )
  const emCurso = minhas.filter((m) => !m.rodada || EM_CURSO.has(m.rodada.status))
  const prontas = minhas.filter((m) => m.rodada && !EM_CURSO.has(m.rodada.status) && comArquivo.has(m.chave))

  if (prontas.length === minhas.length) {
    const resultados = prontas
      .map((m) => resultadoDaCategoria(m.rodada?.errorCategory))
      .filter((r): r is ResultadoDaCertidao => Boolean(r))
    return { status: 'OBTIDA', resultado: piorResultado(resultados) ?? 'emitida', detalhe: null }
  }

  if (emCurso.length > 0) {
    const aguardando = emCurso.find((m) => m.rodada?.status === 'awaiting_async')
    const quando = aguardando?.rodada?.expectedBy
    return {
      status: 'EM_EMISSAO',
      resultado: null,
      detalhe: aguardando
        ? 'Aguardando o portal responder' + (quando ? ` (previsto até ${quando.slice(0, 10)})` : '') + '.'
        : 'Em emissão na BullAI.',
    }
  }

  if (falhas.length > 0) {
    return {
      status: 'FALHA',
      resultado: null,
      detalhe: falhas
        .map((m) => `${m.rodada?.portalLabel ?? m.chave}: ${m.rodada?.message || m.rodada?.errorCategory || m.rodada?.status}`)
        .join(' · '),
    }
  }

  // TERMINOU SEM ARQUIVO E SEM FALHA DECLARADA: o PDF ainda não desceu.
  return { status: 'EM_EMISSAO', resultado: null, detalhe: 'Emitida na BullAI; o PDF ainda não chegou ao Drive.' }
}

/** O que a BullAI exige de uma pessoa para abrir o pedido — ou o que falta. */
export interface SujeitoParaPedido {
  tipo_pessoa: 'PF' | 'PJ'
  nome: string
  documento: string
  data_nascimento?: string | null
  nome_mae?: string | null
  uf_atual?: string | null
  municipio_atual?: string | null
}

/**
 * O corpo do pedido à BullAI para um sujeito, ou o que falta para montá-lo.
 *
 * PESSOA FÍSICA EXIGE A DATA DE NASCIMENTO — é a documentação que diz, e sem
 * ela o pedido volta recusado. Melhor dizer aqui, com o nome da pessoa, do que
 * gastar a chamada.
 */
export function corpoDoPedido(
  s: SujeitoParaPedido,
  portais: string[],
): { ok: true; corpo: Record<string, unknown> } | { ok: false; falta: string } {
  const doc = String(s.documento ?? '').replace(/\D/g, '')
  if (s.tipo_pessoa === 'PJ') {
    if (doc.length !== 14) return { ok: false, falta: `CNPJ de ${s.nome} inválido.` }
    return { ok: true, corpo: { documentType: 'CNPJ', cnpj: doc, razaoSocial: s.nome, requestedPortals: portais } }
  }
  if (doc.length !== 11) return { ok: false, falta: `CPF de ${s.nome} inválido.` }
  if (!s.data_nascimento) {
    return { ok: false, falta: `Falta a data de nascimento de ${s.nome} — a BullAI exige para pessoa física.` }
  }
  // A DATA COMO A PLATAFORMA GUARDA (AAAA-MM-DD). A documentação não fixa o
  // formato; o ISO é o que um campo `date` do banco devolve.
  const corpo: Record<string, unknown> = {
    documentType: 'CPF',
    cpf: doc,
    fullName: s.nome,
    birthDate: String(s.data_nascimento).slice(0, 10),
    requestedPortals: portais,
  }
  if (s.nome_mae?.trim()) corpo.motherName = s.nome_mae.trim()
  if (s.uf_atual?.trim()) corpo.addressState = s.uf_atual.trim().toUpperCase()
  if (s.municipio_atual?.trim()) corpo.addressCity = s.municipio_atual.trim().slice(0, 40)
  return { ok: true, corpo }
}
