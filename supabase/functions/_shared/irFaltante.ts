// O IMPOSTO QUE A CONTA NÃO RETEVE, calculado aqui.
//
// POR QUE ISTO EXISTE, e é um caso real. A auditoria achou, corretamente, que
// não houve retenção de IR sobre a parcela de lucros cessantes — que é
// tributável (art. 43 do CTN) — e então PAROU, escrevendo "sem memória de
// competências nos autos, não é possível apurar a alíquota exata". Leitura
// impecável, número nenhum. E número nenhum não desconta nada: o preço seguia
// contando com um líquido que não vai ser pago.
//
// A LEITURA DECLARA, O CÓDIGO CALCULA. Ela diz sobre QUE valor o imposto incide
// e EM QUANTAS COMPETÊNCIAS; a tabela é nossa, em irpf.ts, e é a MESMA que
// calcula o IR dos honorários — dois caminhos calculando o mesmo imposto fariam
// a tela e a planilha divergirem no mesmo processo.
//
// O NÚMERO DE COMPETÊNCIAS É OBRIGATÓRIO, e a primeira versão errou aqui. Ela
// assumia PAGAMENTO ÚNICO quando não sabia, chamando isso de conservador. Não é
// conservador: é OUTRO REGIME. O art. 12-A da Lei 7.713/88 manda tributar
// rendimento recebido acumuladamente pela tabela do mês aplicada à média mensal,
// com a parcela a deduzir multiplicada de volta pelos meses — e num crédito de
// sete anos a diferença entre isso e a tabela jogada sobre o total é enorme.
//
// SAIU DO HANDLER porque é este o bloco que DOBRAVA o IR a cada ação, e o
// conserto (a linha de base `_ir_lido`, em revisao.ts) não tinha teste que o
// protegesse. A conta é pura; quem escreve em `dados` continua sendo o handler.
import { competencia, mesesEntre } from './indicesBcb.ts'
import { ANO_TABELA_IRRF, irProgressivo } from './irpf.ts'

/** Um item de IR faltante como a leitura o declara — tudo pode vir torto. */
export interface ItemDeIrFaltante {
  verba?: unknown
  base?: unknown
  meses?: unknown
  de?: unknown
  ate?: unknown
}

export interface IrFaltanteCalculado {
  /** O imposto a acrescentar, já arredondado. Zero significa nada a fazer. */
  soma: number
  /** Uma memória por verba, para a célula da planilha e a justificativa. */
  memorias: string[]
  /** Avisos da conta: item descartado por base implausível ou ilegível. */
  avisos: string[]
  /** Avisos da auditoria: o que faltou para calcular, e como resolver. */
  avisosAuditoria: string[]
}

/** Quantos itens de IR faltante se aceitam por análise. */
export const MAX_ITENS_IR = 6

/**
 * Calcula o IR que a conta deixou de reter.
 *
 * NADA AQUI ESCREVE EM `dados`: quem chama soma `soma` ao IR lido — nunca ao IR
 * que está no campo, que já pode conter uma passada anterior. É essa distinção
 * que mantém a conta idempotente.
 */
export function calcularIrFaltante(o: {
  itens: unknown
  /** O bruto, para recusar base maior que o crédito inteiro. */
  bruto: number
  /** O formatador de moeda de quem chama, para a mensagem sair na língua da casa. */
  brl: (n: number) => string
}): IrFaltanteCalculado {
  const itens: ItemDeIrFaltante[] = Array.isArray(o.itens) ? o.itens.slice(0, MAX_ITENS_IR) : []
  const bruto = Number(o.bruto) || 0
  const brl = o.brl
  const memorias: string[] = []
  const avisos: string[] = []
  const avisosAuditoria: string[] = []
  let soma = 0

  for (const it of itens) {
    const verba = String(it?.verba ?? 'verba tributável').slice(0, 60)
    const base = Number(it?.base)
    // BASE ILEGÍVEL SE DIZ, e não se descarta em silêncio.
    //
    // Era um `continue` mudo enquanto a falta dos MESES gerava aviso — e as duas
    // omissões custam a mesma coisa: o preço segue sem embutir um imposto que a
    // auditoria já sabe que existe. O prompt promete que o item vira conta ou
    // vira aviso; sem base, não virava nem uma nem outra.
    if (!Number.isFinite(base) || base <= 0) {
      avisosAuditoria.push(
        `⚠️ IR NÃO CALCULADO em ${verba}: a auditoria apontou tributo faltante mas não disse sobre QUE VALOR ele incide ` +
        `(veio "${String(it?.base ?? '')}"). O preço NÃO embute este imposto — diga a base tributável no chat e ele se refaz.`,
      )
      continue
    }
    // Base maior que o bruto é valor lido errado — o total de outro credor, a
    // soma de requisitórios. Tributar sobre ela devolveria um imposto que
    // engoliria o crédito, e a precificação aceitaria sem reclamar.
    if (bruto > 0 && base > bruto) {
      avisos.push(
        `A auditoria apontou IR faltante sobre uma base de ${brl(base)} em ${verba}, maior que o bruto (${brl(bruto)}). ` +
        'O item foi ignorado — confira de onde saiu essa base.',
      )
      continue
    }
    // AS COMPETÊNCIAS: declaradas, ou contadas do período de apuração. Contar do
    // período é o caminho normal — a auditoria já leu o termo inicial e o final
    // para o confronto com o título.
    const mDito = Number(it?.meses)
    const de = competencia(it?.de)
    const ate = competencia(it?.ate)
    const meses = Number.isFinite(mDito) && mDito >= 1
      ? Math.floor(mDito)
      : (de && ate ? mesesEntre(de, ate) : null)
    if (meses == null || meses < 1) {
      avisosAuditoria.push(
        `⚠️ IR NÃO CALCULADO em ${verba}: a auditoria achou a base tributável (${brl(base)}) mas não disse em quantas competências ` +
        'o pagamento se refere, nem o período de apuração. O art. 12-A da Lei 7.713/88 tributa rendimento acumulado pela tabela do MÊS sobre a média mensal, ' +
        'e sem os meses não há como aplicá-la — jogar a tabela mensal sobre o total inteiro seria outro regime, não uma aproximação. ' +
        'O preço NÃO embute este imposto. Diga o período no chat ("o período de apuração desta verba é 01/2015 a 12/2021") e o preço se refaz.',
      )
      continue
    }
    const calc = irProgressivo(base, meses)
    if (!(calc.imposto > 0)) {
      avisosAuditoria.push(`IR de ${verba}: nada a reter — ${calc.memoria}.`)
      continue
    }
    soma += calc.imposto
    memorias.push(`${verba} — ${calc.memoria}`)
  }

  return { soma: Number(soma.toFixed(2)), memorias, avisos, avisosAuditoria }
}

/** O texto da memória, para a célula do IR e para a justificativa. */
export function memoriaDoIrFaltante(o: {
  soma: number
  memorias: string[]
  irAntes: number
  irDepois: number
  brl: (n: number) => string
}): string {
  return (
    `IR NÃO RETIDO PELA CONTA, calculado pela tabela progressiva ${ANO_TABELA_IRRF}: ` +
    `${o.memorias.join(' | ')}. Total acrescentado ao IR: ${o.brl(o.soma)} (de ${o.brl(o.irAntes)} para ${o.brl(o.irDepois)}).`
  )
}
