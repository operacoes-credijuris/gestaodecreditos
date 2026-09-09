// O NÚMERO DO PROCESSO, lido de um texto qualquer.
//
// TRÊS IMPLEMENTAÇÕES DISSO EXISTIAM, e uma delas custou uma análise. O
// kommo-sync procurava só o formato PONTUADO (`\d{7}-\d{2}\.\d{4}\.…`); o
// título do card, que o comercial digita, costuma trazer os VINTE DÍGITOS
// CRUS — "Dr. Alex Dornelas Loures - 10063770820204013814". Não achando o
// número no título, o sync seguia para as ANOTAÇÕES e gravava no espelho o
// primeiro CNJ pontuado que encontrasse ali: um processo CITADO numa nota, das
// dívidas que a diligência apurou sobre o titular. Daí em diante o card carregava
// o número de outro processo — no nome do arquivo do Drive, na conferência do
// anexo, na busca por processo.
//
// A leitura é uma só, então mora num lugar só. `nucleo/` não importa nada, o que
// mantém isto alcançável pelos testes e pelos dois lados (Edge Function e
// navegador).

/** Só os dígitos: a máscara varia por tribunal e por quem digita, o número não. */
export const digitosDoCnj = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/**
 * Qualquer jeito de escrever um CNJ.
 *
 * Pontuado ("1006377-08.2020.4.01.3814"), cru ("10063770820204013814") e com
 * espaços no lugar dos separadores, que aparece em texto extraído de PDF.
 */
const RE_CNJ_QUALQUER = /\d{7}[\s.\-]?\d{2}[\s.\-]?\d{4}[\s.\-]?\d[\s.\-]?\d{2}[\s.\-]?\d{4}/g

/** 20 dígitos de volta à forma que se lê: 1006377-08.2020.4.01.3814. */
export function mascaraCnj(digitos: string): string {
  const d = digitosDoCnj(digitos)
  if (d.length !== 20) return String(digitos ?? '')
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`
}

/**
 * Os números de processo que aparecem num texto, sem repetir, só os dígitos.
 *
 * Conjunto, e não lista: quem pergunta quer saber SE um número está ali, e um
 * mesmo processo é citado várias vezes na mesma peça.
 */
export function cnjsNoTexto(texto: unknown): Set<string> {
  const achados = String(texto ?? '').match(RE_CNJ_QUALQUER) ?? []
  return new Set(achados.map(digitosDoCnj).filter((d) => d.length === 20))
}

/** O primeiro CNJ de um texto, PONTUADO. '' quando não há nenhum. */
export function primeiroCnj(texto: unknown): string {
  const primeiro = [...cnjsNoTexto(texto)][0]
  return primeiro ? mascaraCnj(primeiro) : ''
}

/**
 * O CNJ de um card: o do TÍTULO, e as reservas depois dele.
 *
 * A ORDEM É A REGRA, e é o que este módulo existe para fixar. O título é o
 * cadastro do card — é o que o operador tem à vista e o que ele controla. As
 * anotações vêm depois, e só para o card antigo que não tem número no título:
 * elas são texto livre onde o comercial cita processo conexo, "ver também" e as
 * dívidas do titular em outras ações. Invertida a ordem, o card passa a se
 * chamar por um processo que não é o dele.
 */
export function cnjDoCard(titulo: unknown, ...reservas: unknown[]): string {
  const doTitulo = primeiroCnj(titulo)
  if (doTitulo) return doTitulo
  for (const r of reservas) {
    const achado = primeiroCnj(r)
    if (achado) return achado
  }
  return ''
}
