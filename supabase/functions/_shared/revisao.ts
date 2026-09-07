// O patch que o chat de revisão aplica sobre a análise.
//
// SEM DEPENDÊNCIA DE INTEGRAÇÃO, para os testes alcançarem — é onde moram três
// falhas que o operador sentia como "limitação da ferramenta", quando na
// verdade eram silêncios:
//
//   1. EDITAR UM ITEM DE LISTA APAGAVA O RESTO. O merge era raso, então mandar
//      um roteiro com um ato substituía os outros. O chat dizia "ajustei o
//      prazo do ato 2" e a análise perdia os atos 1 e 3.
//   2. REMOVER DE LISTA SÓ FUNCIONAVA EM `riscos`. "roteiro_prazo.1" caía num
//      ramo que não trata nada e voltava sem reclamar.
//   3. NOME DE CAMPO ERRADO ENTRAVA COMO CAMPO NOVO. "valor_bruto" em vez de
//      "bruto_total" era gravado, ignorado por todo o resto do motor, e a
//      resposta dizia que estava feito.
//
// Falha silenciosa é pior que recusa: a recusa o operador contorna, o silêncio
// ele leva para a proposta.

export interface ResultadoPatch {
  dados: Record<string, unknown>
  /** O que mudou de fato, campo a campo, para a resposta poder ser conferida. */
  mudancas: string[]
  /** Nomes de campo que não existem no formato — não foram aplicados. */
  desconhecidos: string[]
  /** Caminhos de remoção que não acharam nada. */
  remocoesVazias: string[]
  /**
   * As linhas do questionário que o PEDIDO tocou nesta rodada.
   *
   * Existe por causa das linhas 10 e 11 (histórico do cedente e do advogado),
   * que a due diligence escreve depois. Sem saber quais linhas vieram de uma
   * ordem explícita de quem confere, a diligência revertia a correção em
   * silêncio: a pessoa mandava "linha 10 é Não", o motor gravava, e a apuração
   * punha "Sim" de volta sem que nada na tela ligasse uma coisa à outra.
   */
  m2Tocadas: string[]
}

const ehLista = (v: unknown): v is unknown[] => Array.isArray(v)
const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** "R$ 1.234,56" para a mensagem de mudança; number vira número mesmo. */
function resumir(v: unknown): string {
  if (v == null) return '(vazio)'
  if (typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  if (ehLista(v)) return `${v.length} item(ns)`
  if (ehObjeto(v)) return `${Object.keys(v).length} campo(s)`
  const s = String(v)
  return s.length > 60 ? s.slice(0, 60) + '…' : s
}

/**
 * Aplica uma alteração a um campo de LISTA.
 *
 * Três formas, e a do meio é a que faltava:
 *   - array inteiro  -> substitui a lista (o modelo quis reescrever tudo)
 *   - { "1": {...} } -> edita SÓ o item 1, preservando os outros
 *   - { "+": {...} } -> acrescenta um item ao fim
 *
 * Aceitar as três é o que permite "mude o prazo do segundo ato" sem que o
 * modelo precise repetir a lista inteira — repetição que é justamente onde ele
 * perdia itens.
 */
function aplicarNaLista(atual: unknown[], patch: unknown): { lista: unknown[]; nota: string } {
  if (ehLista(patch)) return { lista: patch, nota: `lista inteira substituída (${patch.length} item(ns))` }
  if (!ehObjeto(patch)) return { lista: atual, nota: '' }

  const lista = [...atual]
  const partes: string[] = []
  for (const [chave, valor] of Object.entries(patch)) {
    if (chave === '+') {
      // Vários itens de uma vez, ou um só.
      for (const item of ehLista(valor) ? valor : [valor]) lista.push(item)
      partes.push(`${ehLista(valor) ? valor.length : 1} acrescentado(s)`)
      continue
    }
    const i = Number(chave)
    if (!Number.isInteger(i) || i < 0) continue
    if (i >= lista.length) { lista.push(valor); partes.push(`item ${i} acrescentado`); continue }
    // Objeto sobre objeto: mescla, para "mude só os dias" não zerar o "ato".
    lista[i] = ehObjeto(valor) && ehObjeto(lista[i])
      ? { ...(lista[i] as Record<string, unknown>), ...valor }
      : valor
    partes.push(`item ${i} alterado`)
  }
  return { lista, nota: partes.join(', ') }
}

/**
 * Aplica o patch da IA sobre a análise atual.
 *
 * `camposValidos` é o conjunto de nomes que o formato aceita. Nome fora dele
 * NÃO entra: vira aviso. É a diferença entre o chat mentir e o chat avisar.
 * `listas` diz quais campos são listas, para a edição por índice funcionar.
 */
export function aplicarPatch(
  atual: Record<string, unknown>,
  alteracoes: Record<string, unknown>,
  remover: string[],
  camposValidos: ReadonlySet<string>,
  listas: ReadonlySet<string>,
): ResultadoPatch {
  const novo: Record<string, unknown> = { ...atual }
  const mudancas: string[] = []
  const desconhecidos: string[] = []
  const remocoesVazias: string[] = []
  const m2Tocadas: string[] = []

  for (const [campo, valor] of Object.entries(alteracoes ?? {})) {
    if (!camposValidos.has(campo)) { desconhecidos.push(campo); continue }

    // m2 é dicionário por linha: mescla, senão mexer numa linha apaga as outras.
    if (campo === 'm2' && ehObjeto(valor)) {
      const antes = ehObjeto(atual.m2) ? atual.m2 : {}
      novo.m2 = { ...antes, ...valor }
      m2Tocadas.push(...Object.keys(valor))
      mudancas.push(`questionário: linha(s) ${Object.keys(valor).join(', ')}`)
      continue
    }

    if (listas.has(campo)) {
      const antes = ehLista(atual[campo]) ? (atual[campo] as unknown[]) : []
      const { lista, nota } = aplicarNaLista(antes, valor)
      novo[campo] = lista
      if (nota) mudancas.push(`${campo}: ${nota}`)
      continue
    }

    if (JSON.stringify(atual[campo]) === JSON.stringify(valor)) continue  // nada mudou
    novo[campo] = valor
    mudancas.push(`${campo}: ${resumir(atual[campo])} → ${resumir(valor)}`)
  }

  // --- Remoções, em QUALQUER lista e em qualquer campo ---------------------
  const porLista = new Map<string, number[]>()
  for (const caminho of remover ?? []) {
    const [raiz, chave] = String(caminho).split('.')
    // 'riscos' é como o prompt sempre chamou a lista de riscos.
    const campo = raiz === 'riscos' ? 'bloco_g_riscos' : raiz

    if (chave === undefined) {
      if (!camposValidos.has(campo)) { desconhecidos.push(campo); continue }
      // "m2" SEM ÍNDICE apagaria o QUESTIONÁRIO INTEIRO — as 29 linhas —, e o
      // pedido que produz isso ("tira o questionário") quase nunca quer dizer
      // isso. Um campo escalar removido a pessoa vê sumir na tela; o
      // questionário só reaparece vazio na planilha, depois de salvo. Para
      // apagar uma linha existe "m2.37".
      if (campo === 'm2') {
        remocoesVazias.push(caminho)
        mudancas.push('questionário: NÃO apaguei o m2 inteiro — para remover uma linha, use "m2.<número>"')
        continue
      }
      if (!(campo in novo)) { remocoesVazias.push(caminho); continue }
      delete novo[campo]
      mudancas.push(`${campo}: removido`)
      continue
    }
    if (campo === 'm2') {
      const m = ehObjeto(novo.m2) ? { ...novo.m2 } : {}
      if (!(chave in m)) { remocoesVazias.push(caminho); continue }
      delete m[chave]
      novo.m2 = m
      m2Tocadas.push(chave)
      mudancas.push(`questionário: linha ${chave} apagada`)
      continue
    }
    if (!listas.has(campo)) { remocoesVazias.push(caminho); continue }
    const i = Number(chave)
    if (!Number.isInteger(i) || i < 0) { remocoesVazias.push(caminho); continue }
    porLista.set(campo, [...(porLista.get(campo) ?? []), i])
  }
  // DE TRÁS PARA FRENTE, senão remover o item 1 desloca o 2 e o índice seguinte
  // apaga o item errado.
  for (const [campo, indices] of porLista) {
    const lista = ehLista(novo[campo]) ? [...(novo[campo] as unknown[])] : []
    let apagados = 0
    for (const i of [...indices].sort((a, b) => b - a)) {
      if (i < lista.length) { lista.splice(i, 1); apagados++ }
      else remocoesVazias.push(`${campo}.${i}`)
    }
    novo[campo] = lista
    if (apagados) mudancas.push(`${campo}: ${apagados} item(ns) removido(s)`)
  }

  return { dados: novo, mudancas, desconhecidos, remocoesVazias, m2Tocadas: [...new Set(m2Tocadas)] }
}

// ---------------------------------------------------------------------------
// Os parâmetros do negócio ditados no chat
// ---------------------------------------------------------------------------
//
// ESTAVAM SENDO GRAVADOS E NUNCA LIDOS. O chat escrevia `_desagio_manual`,
// `_alvo_manual`, `_comissao_manual`, `_diligencia_manual` e `_verbas_manuais`
// na análise, respondia "Aplicado: deságio ditado: 30,00%" — e o motor
// calibrava como se nada tivesse sido dito. O operador salvava acreditando
// ter fechado a 30%. É o pior defeito que um chat pode ter: afirmar uma coisa
// e fazer outra sobre o preço.
//
// Agora a leitura mora aqui, pura e testada, e o motor a consome (ver
// `parametrosParaCalibragem`). Três regras:
//
//   1. CHAVE AUSENTE NÃO MEXE. O modelo só manda o que o usuário pediu.
//   2. NULL (ou "auto") VOLTA AO AUTOMÁTICO. Era o caminho que não existia:
//      um parâmetro ditado ficava para sempre, e `Number(null)` virava ZERO —
//      "volta ao automático" fixaria o deságio em 0%.
//   3. FORA DE FAIXA É IGNORADO E DITO. Deságio de 300% é erro de digitação,
//      não pedido; entra como aviso, não como número.

/** Os campos internos que o chat pode fixar, e a faixa que cada um aceita. */
const PARAMETROS: Array<{
  chave: string
  campo: string
  rotulo: string
  /** Aceita e normaliza, ou null quando fora de faixa. */
  valida: (n: number) => number | null
  formata: (n: number) => string
}> = [
  {
    chave: 'desagio', campo: '_desagio_manual', rotulo: 'deságio',
    valida: (n) => (n >= 0 && n <= 0.95 ? n : null),
    formata: (n) => `${(n * 100).toFixed(2)}%`,
  },
  {
    chave: 'alvo_mensal', campo: '_alvo_manual', rotulo: 'meta de rentabilidade',
    valida: (n) => (n > 0 && n <= 1 ? n : null),
    formata: (n) => `${(n * 100).toFixed(2)}% ao mês`,
  },
  {
    chave: 'comissao_pct', campo: '_comissao_manual', rotulo: 'comissão',
    valida: (n) => (n >= 0 && n <= 1 ? n : null),
    formata: (n) => `${(n * 100).toFixed(2)}%`,
  },
  {
    chave: 'diligencia', campo: '_diligencia_manual', rotulo: 'diligência',
    // Teto de R$ 50 mil: correspondente não custa mais que o crédito.
    valida: (n) => (n >= 0 && n <= 50000 ? n : null),
    formata: (n) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
]

const ehAutomatico = (v: unknown) =>
  v === null || (typeof v === 'string' && /^\s*(auto|autom[aá]tico|padr[aã]o)\s*$/i.test(v))

/**
 * Número de verdade, ou null. `Number(null)` é 0 e `Number('')` é 0 — os dois
 * passariam por "zero pedido", e nenhum dos dois é um pedido.
 */
function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export interface ResultadoParametros {
  dados: Record<string, unknown>
  mudancas: string[]
  /** O que foi pedido e não pôde entrar, em português. */
  avisos: string[]
}

/**
 * Aplica os parâmetros ditados sobre a análise.
 *
 * `parametros` é o objeto que a ferramenta devolve ({desagio, alvo_mensal,
 * comissao_pct, diligencia}); `verbas` é {principal, contratuais,
 * sucumbenciais}; `prazoMeses` é o prazo ditado. Qualquer um pode ser null
 * ("volta ao automático") ou ausente ("não mexa").
 */
export function aplicarParametrosManuais(
  atual: Record<string, unknown>,
  entrada: { parametros?: unknown; verbas?: unknown; prazo_meses_manual?: unknown },
): ResultadoParametros {
  const dados: Record<string, unknown> = { ...atual }
  const mudancas: string[] = []
  const avisos: string[] = []

  const par = ehObjeto(entrada.parametros) ? entrada.parametros : {}
  for (const p of PARAMETROS) {
    if (!(p.chave in par)) continue
    const v = par[p.chave]
    if (ehAutomatico(v)) {
      if (p.campo in dados) { delete dados[p.campo]; mudancas.push(`${p.rotulo}: de volta ao automático`) }
      continue
    }
    const n = numero(v)
    const ok = n == null ? null : p.valida(n)
    if (ok == null) { avisos.push(`${p.rotulo}: "${String(v)}" está fora de faixa e foi ignorado`); continue }
    dados[p.campo] = ok
    mudancas.push(`${p.rotulo} ditado: ${p.formata(ok)}`)
  }

  // As verbas: o que está sendo comprado.
  if ('verbas' in entrada) {
    const vb = entrada.verbas
    if (ehAutomatico(vb)) {
      if ('_verbas_manuais' in dados) { delete dados._verbas_manuais; mudancas.push('verbas negociadas: de volta ao que o card diz') }
    } else if (ehObjeto(vb)) {
      const escolhidas = {
        principal: vb.principal === true,
        contratuais: vb.contratuais === true,
        sucumbenciais: vb.sucumbenciais === true,
      }
      if (escolhidas.principal || escolhidas.contratuais || escolhidas.sucumbenciais) {
        dados._verbas_manuais = escolhidas
        mudancas.push(
          'verbas negociadas: ' +
          Object.entries(escolhidas).filter(([, v]) => v).map(([k]) => k).join(' + '),
        )
      } else {
        avisos.push('verbas negociadas: nenhuma verba marcada, então não mexi — um negócio precisa de pelo menos uma')
      }
    }
  }

  // O prazo. Zero e "auto" voltam ao cálculo; null não mexe (é o padrão da
  // ferramenta quando o usuário não falou de prazo).
  if ('prazo_meses_manual' in entrada) {
    const v = entrada.prazo_meses_manual
    if (v === 0 || (typeof v === 'string' && ehAutomatico(v))) {
      if ('_prazo_manual' in dados) { delete dados._prazo_manual; mudancas.push('prazo: de volta ao calculado') }
    } else if (v !== null && v !== undefined) {
      const n = numero(v)
      if (n != null && n > 0 && n <= 120) { dados._prazo_manual = n; mudancas.push(`prazo ditado: ${n} meses`) }
      else avisos.push(`prazo: "${String(v)}" não é um número de meses válido (1 a 120) e foi ignorado`)
    }
  }

  return { dados, mudancas, avisos }
}

/** Como o motor deve calibrar, lidos da análise. Ausente = automático. */
export interface ParametrosCalibragem {
  desagioFixo: number | null
  alvo: number | undefined
  comissaoPct: number | undefined
  diligencia: number | undefined
  verbas: { principal: boolean; contratuais: boolean; sucumbenciais: boolean } | null
  /** Para a tela dizer o que está fixado. */
  descricao: string[]
}

/**
 * O que a análise carrega de parâmetro ditado, no formato que calibrarDesagio
 * recebe. Só devolve o que for número válido — um campo corrompido volta ao
 * automático em vez de virar zero.
 */
export function parametrosParaCalibragem(dados: Record<string, unknown>): ParametrosCalibragem {
  const desc: string[] = []
  const pega = (campo: string, valida: (n: number) => number | null): number | null => {
    const n = numero(dados[campo])
    return n == null ? null : valida(n)
  }
  const desagio = pega('_desagio_manual', PARAMETROS[0].valida)
  const alvo = pega('_alvo_manual', PARAMETROS[1].valida)
  const comissao = pega('_comissao_manual', PARAMETROS[2].valida)
  const dilig = pega('_diligencia_manual', PARAMETROS[3].valida)
  if (desagio != null) desc.push(`deságio ditado no chat: ${PARAMETROS[0].formata(desagio)}`)
  if (alvo != null) desc.push(`meta ditada no chat: ${PARAMETROS[1].formata(alvo)}`)
  if (comissao != null) desc.push(`comissão ditada no chat: ${PARAMETROS[2].formata(comissao)}`)
  if (dilig != null) desc.push(`diligência ditada no chat: ${PARAMETROS[3].formata(dilig)}`)

  const vb = dados._verbas_manuais
  const verbas = ehObjeto(vb) && (vb.principal === true || vb.contratuais === true || vb.sucumbenciais === true)
    ? { principal: vb.principal === true, contratuais: vb.contratuais === true, sucumbenciais: vb.sucumbenciais === true }
    : null
  if (verbas) desc.push('verbas negociadas ditadas no chat: ' + Object.entries(verbas).filter(([, v]) => v).map(([k]) => k).join(' + '))

  return {
    desagioFixo: desagio,
    alvo: alvo ?? undefined,
    comissaoPct: comissao ?? undefined,
    diligencia: dilig ?? undefined,
    verbas,
    descricao: desc,
  }
}
