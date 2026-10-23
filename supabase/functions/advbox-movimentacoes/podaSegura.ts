// advbox-movimentacoes/podaSegura.ts
// O QUE A PODA DOS CACHES DO ADVBOX PODE APAGAR, E COMO APAGAR (23/10/2026).
//
// Puro (sem `Deno.`, sem `npm:`), para o vitest alcançar. Usado pela
// advbox-movimentacoes e pela advbox-tarefas — as duas podam do mesmo jeito e
// tinham os mesmos três defeitos:
//
//   1. O CADASTRO ERA LIDO SEM PAGINAR. `processos`, `apensos` e `requerimentos`
//      saíam num `select` solto, e o PostgREST corta em 1000 linhas sem avisar.
//      Passado esse tamanho, os processos de fora do corte deixavam de ser
//      "casáveis" e a poda APAGAVA o histórico deles — a cada sincronização.
//   2. A PODA IA NUMA URL SÓ. `not in (todos os lawsuits casáveis)` cresce com a
//      carteira; passadas algumas centenas de ids a URL estoura, a consulta volta
//      500 e a sincronização inteira morre antes de começar.
//   3. DOIS PROCESSOS COM O MESMO NÚMERO num lote derrubavam o upsert do status
//      ("ON CONFLICT DO UPDATE command cannot affect row a second time"): a função
//      lançava antes de encadear a fatia seguinte, e a cadeia morria em toda
//      passada.

import {
  lerTodasAsLinhas,
  type LeituraCompleta,
  type PaginaDoBanco,
} from '../_shared/leituraPaginada.ts'

/** Piso para considerar um número de processo válido (igual às outras funções). */
export const MIN_DIGITS = 6

/** Ids por DELETE: o mesmo corte do `lerPorIds` e da rotina do Escavador. */
export const POR_FATIA_DA_PODA = 150

const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/** As três tabelas do cadastro e a coluna do número em cada uma. */
export const TABELAS_DO_CADASTRO = [
  { tabela: 'processos', coluna: 'numero_cnj' },
  { tabela: 'apensos', coluna: 'numero' },
  { tabela: 'requerimentos', coluna: 'numero_protocolo' },
] as const

export interface Cadastro {
  /** Números cadastrados, só dígitos, com pelo menos MIN_DIGITS. */
  numeros: Set<string>
  /**
   * TODAS as linhas das três tabelas foram lidas. Falso = alguma leitura bateu
   * no teto de páginas: a sincronização segue com o que veio, mas NADA é podado,
   * porque "não está no conjunto" deixou de significar "saiu do cadastro".
   */
  completo: boolean
  /** Por que não está completo (para o log e para a resposta). */
  motivo: string | null
}

/**
 * Lê o cadastro inteiro, PAGINADO e com ordem estável (quem chama ordena pelo
 * `id`, que é único — sem ordem o Postgres não promete as mesmas linhas entre
 * duas páginas).
 *
 * ERRO DE LEITURA LANÇA, como antes: este conjunto decide o que a poda apaga, e
 * um soluço que o deixasse vazio ou parcial apagaria histórico certo. Melhor a
 * sincronização falhar e tentar de novo no próximo cron.
 */
export async function lerCadastro(
  pagina: (
    tabela: string,
    coluna: string,
    de: number,
    ate: number,
  ) => PromiseLike<PaginaDoBanco<Record<string, unknown>>>,
): Promise<Cadastro> {
  const leituras = await Promise.all(
    TABELAS_DO_CADASTRO.map(async ({ tabela, coluna }) => ({
      tabela,
      coluna,
      r: await lerTodasAsLinhas<Record<string, unknown>>((de, ate) =>
        pagina(tabela, coluna, de, ate)
      ),
    })),
  )
  const numeros = new Set<string>()
  const cortes: string[] = []
  for (const { tabela, coluna, r } of leituras) {
    if (r.erro) throw new Error(`cadastro (${tabela}): ${r.erro}`)
    if (r.cortada) cortes.push(`${tabela} lida só até ${r.linhas.length} linhas`)
    for (const l of r.linhas) {
      const d = onlyDigits(l[coluna])
      if (d.length >= MIN_DIGITS) numeros.add(d)
    }
  }
  return {
    numeros,
    completo: cortes.length === 0,
    motivo: cortes.length ? `cadastro incompleto: ${cortes.join('; ')}` : null,
  }
}

/** Os valores de uma coluna de uma leitura paginada, mantendo erro e corte. */
export function colunaDaLeitura<T>(
  leitura: LeituraCompleta<T>,
  campo: keyof T,
): LeituraCompleta<string | null> {
  return {
    linhas: leitura.linhas.map((l) => {
      const v = l[campo]
      return v == null ? null : String(v)
    }),
    erro: leitura.erro,
    cortada: leitura.cortada,
  }
}

/**
 * Os ids que estão no cache e NÃO estão no conjunto a manter — calculado AQUI,
 * e não com `not in (lista inteira)` no banco (ver o cabeçalho).
 *
 * LEITURA INCOMPLETA → NADA A APAGAR. Com erro ou corte, um id "ausente" pode ser
 * só um id que não chegou a ser lido. Conjunto a manter vazio também não apaga:
 * vazio aqui é sempre defeito de leitura, nunca carteira realmente vazia.
 *
 * Nulo e vazio ficam de fora, como no `not in` de antes (NULL NOT IN (...) não é
 * verdadeiro, então a linha sem lawsuit nunca foi apagada).
 */
export function idsAApagar(
  presentes: LeituraCompleta<string | null>,
  manter: ReadonlySet<string>,
): string[] {
  if (presentes.erro || presentes.cortada || manter.size === 0) return []
  const fora = new Set<string>()
  for (const id of presentes.linhas) {
    if (id != null && id !== '' && !manter.has(id)) fora.add(id)
  }
  return [...fora]
}

/**
 * Apaga em fatias de POR_FATIA_DA_PODA, um `in` POSITIVO por fatia — a URL fica
 * do mesmo tamanho com 100 ou com 10.000 créditos. Para no primeiro erro e o
 * devolve: quem chama decide se é fatal, mas não pode deixar de saber.
 */
export async function apagarEmFatias(
  ids: readonly string[],
  apagar: (fatia: string[]) => PromiseLike<{ error: { message: string } | null }>,
  porFatia = POR_FATIA_DA_PODA,
): Promise<{ apagados: number; erro: string | null }> {
  let apagados = 0
  for (let i = 0; i < ids.length; i += porFatia) {
    const fatia = ids.slice(i, i + porFatia)
    const { error } = await apagar(fatia)
    if (error) return { apagados, erro: error.message }
    apagados += fatia.length
  }
  return { apagados, erro: null }
}

/** Uma linha de advbox_processo_status. */
export interface StatusDoProcesso {
  numero_processo: string
  advbox_lawsuit_id: string
  ultima_movimentacao: string | null
  sincronizado_em: string
}

/**
 * UMA LINHA POR NÚMERO antes do upsert do status (chave `numero_processo`).
 *
 * Dois lawsuits do ADVBOX com o mesmo número (cadastro duplicado lá, ou
 * principal e cópia) no mesmo lote faziam o Postgres recusar o upsert INTEIRO.
 * Fica a mais informativa: com data vence sem data; entre duas datas, a mais
 * recente — é a "última movimentação" do número, seja de qual lawsuit for. No
 * empate, a última lida.
 */
export function statusUnicoPorNumero<
  T extends { numero_processo: string; ultima_movimentacao: string | null },
>(linhas: readonly T[]): T[] {
  const m = new Map<string, T>()
  for (const l of linhas) {
    const atual = m.get(l.numero_processo)
    if (!atual) {
      m.set(l.numero_processo, l)
      continue
    }
    const nova = l.ultima_movimentacao
    const velha = atual.ultima_movimentacao
    const melhor = nova == null ? velha == null : velha == null || nova >= velha
    if (melhor) m.set(l.numero_processo, l)
  }
  return [...m.values()]
}
