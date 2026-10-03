// Regras de TELA de Dados cadastrais (onda 2 do redesenho): a busca da lista e
// as iniciais do avatar. O que o Salvar grava NÃO mora aqui — está em
// fichaPessoa.ts, com o teste que o prende.
//
// Sem import nenhum: roda no teste sem rede e sem o cliente do Supabase.

/** Minúsculo e sem acento — a busca não pode depender de "José" × "Jose". */
export function semAcento(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * A linha casa com a busca?
 *
 * DUAS FORMAS DE CASAR, como na amostra (base.js › casaBusca):
 *   • TEXTO, sem acento e sem caixa, em qualquer campo — nome, documento,
 *     representante;
 *   • DÍGITOS, para o documento colado cru ou com outra máscara: "11222333"
 *     acha "11.222.333/0001-81". SÓ A PARTIR DE 4 DÍGITOS: com um ou dois, todo
 *     CPF da lista casaria, e a busca deixaria de filtrar.
 *
 * Busca em branco casa com tudo.
 */
export function casaBuscaDaFicha(
  campos: Array<string | null | undefined>,
  busca: string,
  minDigitos = 4,
): boolean {
  const q = semAcento(busca).trim()
  if (!q) return true
  if (campos.some((c) => semAcento(c).includes(q))) return true
  const dq = q.replace(/\D/g, '')
  return (
    dq.length >= minDigitos &&
    campos.some((c) => String(c ?? '').replace(/\D/g, '').includes(dq))
  )
}

const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/**
 * As iniciais do avatar da linha: as duas primeiras palavras com mais de duas
 * letras, SEM OS CONECTIVOS ("Francisco das Chagas Lima" → "FC"; a amostra dava
 * "FD", e "das" não é nome de ninguém). Nome só de palavras curtas cai na
 * primeira letra, para o avatar nunca sair vazio.
 */
export function iniciaisDoNome(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean)
  const longas = palavras
    .filter((p) => p.length > 2 && !CONECTIVOS.has(p.toLowerCase()))
    .slice(0, 2)
  const base = longas.length ? longas : palavras.slice(0, 1)
  return base
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}
