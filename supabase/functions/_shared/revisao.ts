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

  for (const [campo, valor] of Object.entries(alteracoes ?? {})) {
    if (!camposValidos.has(campo)) { desconhecidos.push(campo); continue }

    // m2 é dicionário por linha: mescla, senão mexer numa linha apaga as outras.
    if (campo === 'm2' && ehObjeto(valor)) {
      const antes = ehObjeto(atual.m2) ? atual.m2 : {}
      novo.m2 = { ...antes, ...valor }
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

  return { dados: novo, mudancas, desconhecidos, remocoesVazias }
}
