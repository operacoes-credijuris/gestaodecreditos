// A COTAÇÃO QUE UM FUNDO DEVOLVEU: o valor da proposta e a comissão, e o texto
// com que ela fica gravada no card do Kommo.
//
// Pedido do dono em 05/10/2026: ao marcar "Cotado ‹fundo›" na Em precificação, a
// pessoa diz quanto o fundo ofereceu, e o valor vai para o campo daquele fundo
// no grupo "Cotações/propostas" do card. A janela "Escolher proposta" lê esses
// campos de volta, para comparar os fundos lado a lado.
//
// O TEXTO DO CAMPO É EXATAMENTE
//   "R$ 850.000,00 / R$ 40.000,00"               (proposta / comissão limitada)
//   "R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)" (proposta final / comissão, no spread)
// No SPREAD (pedido do dono, 05/10/2026, à tarde), a pessoa digita o valor da
// proposta (R$ 850.000,00) e o percentual (5%); a comissão é o percentual sobre
// o valor (R$ 42.500,00) e a proposta final é o que sobra (R$ 807.500,00). QUEM
// CALCULA É ESTE MÓDULO (`calcularSpread`), na prévia da tela e no servidor: a
// `kommo-etiquetar` recebe valor e percentual e escreve o texto ela mesma.
//
// A BASE DO SPREAD É O VALOR LÍQUIDO VALIDADO (correção do dono, 06/10/2026):
// "o spread tem que ser sobre o valor líquido validado", e não sobre o valor da
// proposta. A conta passou a ser
//   comissão = líquido validado × percentual;  proposta final = proposta − comissão
// — proposta de R$ 850.000,00, líquido de R$ 800.000,00, 5%: comissão de
// R$ 40.000,00 e final de R$ 810.000,00, gravado "R$ 810.000,00 / R$ 40.000,00
// (Spread de 5%)". O texto do campo é o mesmo; o que mudou é de onde sai a
// comissão. O líquido vem da nota de oportunidade do card
// (`liquidoDaOportunidade.ts`), e a pessoa o confere na janela. A tela de
// 05/10/2026 (aberta antes do deploy) manda o spread SEM a base: ele continua
// aceito e calculado sobre o valor da proposta, como era.
//
// O FORMATO ANTERIOR do spread, "R$ 850.000,00 / Spread" (sem percentual), é o
// que ainda grava uma aba aberta antes da mudança, e continua lido: ali o valor
// é o da proposta, e a comissão não tem número.
//
// Sempre com espaço comum depois do "R$" — e não o espaço inseparável do
// `toLocaleString`, que no Kommo parece igual e não é: quem buscar "R$ 850" lá
// dentro não acharia. Por isso a formatação é feita à mão, em centavos inteiros
// (sem vírgula flutuante no caminho do dinheiro).
//
// A LEITURA DE VOLTA É TOLERANTE, porque o campo é de texto e o comercial pode
// escrever nele pelo Kommo: "850 mil / 40 mil", "R$ 850.000 - spread",
// "850000". O que não se lê com segurança fica como texto, sem número — melhor
// mostrar o que está escrito do que um valor adivinhado.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —: roda no vitest, no navegador e na
// Edge Function (a `kommo-etiquetar`), e os dois lados escrevem o mesmo texto.

import {
  comissoesDoFundo,
  FUNDOS_DA_PRECIFICACAO,
  type ModalidadeDaComissao,
  normalizarEtiqueta,
  semEntidadesHtml,
} from './etiquetasDoFundo.ts'

// ------------------------------------------------------------------ dinheiro

/** Teto de sanidade: R$ 1 trilhão. Acima disso é dígito colado a mais. */
const TETO_CENTAVOS = 100_000_000_000_000

/** "850.000,00" — os reais com ponto de milhar e vírgula, sem o "R$". */
export function formatarReaisSemPrefixo(centavos: number): string {
  const c = Math.round(Math.abs(centavos))
  const inteiro = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const fracao = String(c % 100).padStart(2, '0')
  return `${centavos < 0 ? '-' : ''}${inteiro},${fracao}`
}

/** "R$ 1.234.567,89", com espaço COMUM depois do "R$" (ver o cabeçalho). */
export function formatarReais(centavos: number): string {
  return `R$ ${formatarReaisSemPrefixo(centavos)}`
}

/**
 * Lê um valor em reais escrito por gente e devolve CENTAVOS, ou null.
 *
 * O QUE SE LÊ (e é o que se cola de planilha, de e-mail e de WhatsApp):
 *   "850000" · "850.000" · "850.000,00" · "R$ 850.000,00" · "850000,5"
 *   "850000.00" (ponto decimal com DUAS casas, de sistema que exporta assim)
 *   "850 mil" · "1,5 mi" · "1.5 milhão" · "2 milhões"
 *
 * O QUE NÃO SE LÊ, de propósito: o que tem duas leituras. "850.5" (ponto com
 * uma casa e sem "mil"/"mi") pode ser 850,50 ou um dígito comido; "1.23.456",
 * "12,345" (vírgula com três casas é o milhar dos americanos). Devolver null
 * aqui é o que deixa o campo vazio para a pessoa conferir — um número errado
 * gravado no card seria comparado com os outros fundos como se fosse certo.
 */
export function lerReais(texto: unknown): number | null {
  let s = String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s  ]+/g, ' ')
    .trim()
  s = s.replace(/^r\s?\$\s?/, '').replace(/^rs\s/, '').trim()
  if (!s) return null

  let mult = 1
  const escala = s.match(/^(.*?)\s*(mil|mi|mm|milhao|milhoes)\.?$/)
  if (escala) {
    s = escala[1].trim()
    mult = escala[2] === 'mil' ? 1_000 : 1_000_000
  }
  s = s.replace(/ /g, '')
  if (!s) return null

  let inteiro: string
  let fracao = ''
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    // "850.000" e "850.000,00": o ponto é o milhar.
    const [i, f = ''] = s.split(',')
    inteiro = i.replace(/\./g, '')
    fracao = f
  } else if (/^\d+(,\d{1,2})?$/.test(s)) {
    // "850000" e "850000,5".
    const [i, f = ''] = s.split(',')
    inteiro = i
    fracao = f
  } else if (/^\d+\.\d{2}$/.test(s) || (mult > 1 && /^\d+\.\d{1,2}$/.test(s))) {
    // "850000.00" (duas casas: é decimal) e "1.5 mi" (com escala, o ponto não é
    // milhar — "1.500 mi" já caiu no primeiro caso).
    const [i, f] = s.split('.')
    inteiro = i
    fracao = f
  } else {
    return null
  }

  const centavos = (Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'))) * mult
  if (!Number.isFinite(centavos) || centavos > TETO_CENTAVOS) return null
  return Math.round(centavos)
}

// ------------------------------------------------------------------ percentual

/**
 * O PERCENTUAL DO SPREAD EM CENTÉSIMOS DE PONTO, inteiro: 5% = 500, 5,5% = 550,
 * 12,25% = 1225. Inteiro pelo mesmo motivo do dinheiro em centavos — a conta
 * da comissão não passa por ponto flutuante.
 */
const PERCENTUAL_MINIMO = 1 // 0,01%
const PERCENTUAL_MAXIMO = 9_999 // 99,99%

/** O percentual que chegou é um inteiro de 0,01% a 99,99%? */
export const percentualValido = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= PERCENTUAL_MINIMO && n <= PERCENTUAL_MAXIMO

/** O que a pessoa digitou no campo do percentual, lido. */
export type PercentualLido =
  | { ok: true; centesimos: number }
  | { ok: false; motivo: 'vazio' | 'formato' | 'casas' | 'zero' | 'teto'; erro: string }

/**
 * LÊ O PERCENTUAL DIGITADO: "5", "5,5", "12,25" (vírgula decimal, até duas
 * casas). Tolera o "%" no fim, espaços e o ponto no lugar da vírgula ("5.5").
 * Maior que 0 e menor que 100; fora disso, o erro diz por quê.
 */
export function lerPercentual(texto: unknown): PercentualLido {
  const s = String(texto ?? '')
    .replace(/[\s%]+/g, '')
    .replace('.', ',')
  if (!s) return { ok: false, motivo: 'vazio', erro: 'Informe o percentual do spread.' }
  const m = s.match(/^(\d+)(?:,(\d{0,2}))?$/)
  if (!m) {
    return /^\d+,\d{3,}$/.test(s)
      ? { ok: false, motivo: 'casas', erro: 'O percentual aceita no máximo duas casas depois da vírgula.' }
      : { ok: false, motivo: 'formato', erro: 'Digite o percentual só com números e vírgula (por exemplo, 5 ou 5,5).' }
  }
  const inteiro = Number(m[1])
  const centesimos = inteiro * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  if (inteiro >= 100) return { ok: false, motivo: 'teto', erro: 'O percentual precisa ser menor que 100.' }
  if (centesimos < PERCENTUAL_MINIMO) return { ok: false, motivo: 'zero', erro: 'O percentual precisa ser maior que 0.' }
  return { ok: true, centesimos }
}

/** "5", "5,5", "12,25", "0,05" — sem zeros à toa, com vírgula (sem o "%"). */
export function formatarPercentual(centesimos: number): string {
  const inteiro = Math.floor(centesimos / 100)
  const fracao = String(centesimos % 100).padStart(2, '0').replace(/0+$/, '')
  return fracao ? `${inteiro},${fracao}` : String(inteiro)
}

/**
 * A CONTA DO SPREAD, em centavos inteiros:
 *   comissão = BASE × percentual / 100, arredondada ao centavo (meio para cima);
 *   proposta final = valor da proposta − comissão.
 *
 * A BASE É O VALOR LÍQUIDO VALIDADO (06/10/2026). Sem ela, é o valor da
 * proposta — a conta de 05/10/2026, que a tela antiga ainda pede.
 *
 * SEM PONTO FLUTUANTE E SEM ESTOURO: base × centésimos passaria de 2^53 perto
 * do teto (R$ 1 trilhão × 9.999), então a base é partida em q·10.000 + r e a
 * conta é feita por partes — q·p é exato e só r·p (< 10^8) é arredondado.
 *
 * A FINAL PODE SAIR ZERO OU NEGATIVA (líquido maior que a proposta, percentual
 * alto): quem recusa é `validarCotacao`, com a mensagem.
 */
export function calcularSpread(
  propostaCentavos: number,
  percentualCentesimos: number,
  baseCentavos: number = propostaCentavos,
): { comissaoCentavos: number; finalCentavos: number } {
  const q = Math.floor(baseCentavos / 10_000)
  const r = baseCentavos % 10_000
  const comissaoCentavos = q * percentualCentesimos + Math.floor((r * percentualCentesimos + 5_000) / 10_000)
  return { comissaoCentavos, finalCentavos: propostaCentavos - comissaoCentavos }
}

// ------------------------------------------------------------------ cotação

/**
 * A COMISSÃO, em duas modalidades:
 *   - LIMITADA: o fundo já diz quanto aceita pagar de comissão, em reais;
 *   - SPREAD: a casa desconta a comissão do valor da proposta, a um percentual
 *     (`percentualCentesimos`: 5% = 500) sobre o VALOR LÍQUIDO VALIDADO
 *     (`baseCentavos`, 06/10/2026).
 *     SEM a base é o spread da tela de 05/10/2026: o percentual sobre o valor
 *     da proposta. SEM o percentual é o da tela anterior a ela, que grava
 *     "R$ X / Spread". As duas são abas abertas antes do deploy, e o servidor
 *     ainda as aceita.
 */
export type Comissao =
  | { modalidade: 'limitada'; centavos: number }
  | { modalidade: 'spread'; percentualCentesimos?: number; baseCentavos?: number }

/**
 * A COTAÇÃO COMO A PESSOA A DIGITOU: no spread, `propostaCentavos` é o valor
 * da proposta ANTES da comissão (R$ 850.000,00), e o texto do campo traz a
 * proposta final (R$ 807.500,00).
 */
export interface Cotacao {
  propostaCentavos: number
  comissao: Comissao
}

/**
 * A conta do spread desta cotação, ou null (limitada, ou spread sem percentual).
 * `baseCentavos` é sobre o que o percentual incidiu, e `sobreLiquido` diz se é
 * o líquido validado (a tela nova) ou o valor da proposta (a de 05/10/2026).
 */
export function spreadDaCotacao(c: Cotacao): {
  percentualCentesimos: number
  baseCentavos: number
  sobreLiquido: boolean
  comissaoCentavos: number
  finalCentavos: number
} | null {
  if (c.comissao.modalidade !== 'spread' || c.comissao.percentualCentesimos === undefined) return null
  const p = c.comissao.percentualCentesimos
  const sobreLiquido = c.comissao.baseCentavos !== undefined
  const baseCentavos = c.comissao.baseCentavos ?? c.propostaCentavos
  return { percentualCentesimos: p, baseCentavos, sobreLiquido, ...calcularSpread(c.propostaCentavos, p, baseCentavos) }
}

/**
 * O texto do campo do fundo no Kommo:
 *   "R$ 850.000,00 / R$ 40.000,00"                 (limitada)
 *   "R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)"  (spread: final / comissão)
 *   "R$ 850.000,00 / Spread"                       (spread sem percentual, da tela antiga)
 * O texto não diz a base: é o mesmo com o líquido (06/10/2026) ou sem ele.
 */
export function textoDaCotacao(c: Cotacao): string {
  if (c.comissao.modalidade === 'limitada') {
    return `${formatarReais(c.propostaCentavos)} / ${formatarReais(c.comissao.centavos)}`
  }
  const s = spreadDaCotacao(c)
  if (!s) return `${formatarReais(c.propostaCentavos)} / Spread`
  return (
    `${formatarReais(s.finalCentavos)} / ${formatarReais(s.comissaoCentavos)} ` +
    `(Spread de ${formatarPercentual(s.percentualCentesimos)}%)`
  )
}

/**
 * O RESUMO DA CONTA, para a prévia da janela — ou null fora do spread:
 * "Comissão (5% sobre o líquido de R$ 800.000,00): R$ 40.000,00" e
 * "Proposta final: R$ 810.000,00". Sem a base (a conta de 05/10/2026),
 * "Comissão (5%): …".
 */
export function resumoDoSpread(c: Cotacao): { comissao: string; final: string } | null {
  const s = spreadDaCotacao(c)
  if (!s) return null
  const pct = `${formatarPercentual(s.percentualCentesimos)}%`
  const sobre = s.sobreLiquido ? `${pct} sobre o líquido de ${formatarReais(s.baseCentavos)}` : pct
  return {
    comissao: `Comissão (${sobre}): ${formatarReais(s.comissaoCentavos)}`,
    final: `Proposta final: ${formatarReais(s.finalCentavos)}`,
  }
}

/**
 * A recusa de uma modalidade que o fundo não aceita — a de uma aba aberta antes
 * de 07/10/2026 mandando spread no BTG. Diz o que fazer: recarregar.
 */
export function erroDaModalidade(fundo: string, modalidade: ModalidadeDaComissao): string {
  const aceitas = comissoesDoFundo(fundo)
  return modalidade === 'spread' && aceitas.length === 1 && aceitas[0] === 'limitada'
    ? `O ${fundo} não trabalha com spread: a comissão dele é sempre limitada, em reais. ` +
        'Recarregue a página (F5) e informe a comissão em R$.'
    : `A comissão ${modalidade} não vale para o fundo ${fundo}. Recarregue a página (F5) e cote de novo.`
}

const centavosValidos = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= TETO_CENTAVOS

/**
 * A cotação que chegou na requisição, conferida — é a porta do servidor.
 *
 * EM CENTAVOS INTEIROS, e não em reais com casas: 0,1 + 0,2 não é 0,3 em ponto
 * flutuante, e um centavo a mais no card é um centavo que ninguém digitou.
 *
 * O SPREAD SEM PERCENTUAL é aceito por padrão — é o que manda uma aba aberta
 * antes de 05/10/2026, e recusá-lo quebraria o "Cotado" de quem está com ela
 * aberta. A tela nova pede `exigirPercentualNoSpread` (e já não deixa enviar
 * sem ele). Percentual PRESENTE e fora da faixa é sempre recusado: é a tela
 * nova com um valor errado, não a antiga.
 *
 * A BASE (o valor líquido validado, 06/10/2026) segue a mesma regra: AUSENTE é
 * a tela de 05/10/2026, e a conta é sobre o valor da proposta, como era;
 * PRESENTE e inválida é recusada; e a tela nova pede `exigirBaseNoSpread`.
 *
 * A COMISSÃO NÃO PODE ALCANÇAR A PROPOSTA: com o líquido como base, um
 * percentual alto (ou um líquido maior que a proposta) faria a final zero ou
 * negativa. É recusado, e a mensagem diz os dois números.
 *
 * O FUNDO DECIDE AS MODALIDADES (07/10/2026): com `fundo`, a comissão precisa
 * ser uma das que ele aceita (`comissoesDoFundo`) — o BTG só a limitada. Aqui
 * NÃO HÁ TOLERÂNCIA para a tela antiga: uma aba aberta antes do deploy que mande
 * spread no BTG recebe o erro, e a pessoa recarrega. Gravar um spread que o
 * banco não pratica seria pior que pedir um clique a mais. Sem `fundo`, valem
 * as duas, como antes.
 */
export function validarCotacao(
  x: unknown,
  opcoes: { exigirPercentualNoSpread?: boolean; exigirBaseNoSpread?: boolean; fundo?: string } = {},
): { ok: true; cotacao: Cotacao } | { ok: false; erro: string } {
  const c = (x ?? {}) as {
    propostaCentavos?: unknown
    comissao?: { modalidade?: unknown; centavos?: unknown; percentualCentesimos?: unknown; baseCentavos?: unknown }
  }
  if (!centavosValidos(c.propostaCentavos)) {
    return { ok: false, erro: 'Informe o valor da proposta (em reais, maior que zero).' }
  }
  const m = c.comissao?.modalidade
  if (
    opcoes.fundo !== undefined &&
    (m === 'spread' || m === 'limitada') &&
    !comissoesDoFundo(opcoes.fundo).includes(m)
  ) {
    return { ok: false, erro: erroDaModalidade(opcoes.fundo, m) }
  }
  if (m === 'spread') {
    const p = c.comissao?.percentualCentesimos
    if (p === undefined || p === null) {
      if (opcoes.exigirPercentualNoSpread) {
        return { ok: false, erro: 'Com a comissão em spread, informe o percentual.' }
      }
      return { ok: true, cotacao: { propostaCentavos: c.propostaCentavos, comissao: { modalidade: 'spread' } } }
    }
    if (!percentualValido(p)) {
      return {
        ok: false,
        erro: 'O percentual do spread precisa ser maior que 0 e menor que 100, com até duas casas depois da vírgula.',
      }
    }
    const b = c.comissao?.baseCentavos
    const semBase = b === undefined || b === null
    if (semBase && opcoes.exigirBaseNoSpread) {
      return { ok: false, erro: 'Com a comissão em spread, informe o valor líquido validado.' }
    }
    if (!semBase && !centavosValidos(b)) {
      return { ok: false, erro: 'Informe o valor líquido validado (em reais, maior que zero).' }
    }
    const base = semBase ? undefined : (b as number)
    const conta = calcularSpread(c.propostaCentavos, p, base)
    if (conta.comissaoCentavos < 1) {
      return {
        ok: false,
        erro: semBase
          ? 'Com esse valor e esse percentual, a comissão daria menos de um centavo.'
          : 'Com esse valor líquido e esse percentual, a comissão daria menos de um centavo.',
      }
    }
    if (conta.finalCentavos < 1) {
      return {
        ok: false,
        erro:
          `A comissão (${formatarReais(conta.comissaoCentavos)}) não pode ser igual ou maior que o valor ` +
          `da proposta (${formatarReais(c.propostaCentavos)}): a proposta final precisa ser maior que zero. ` +
          (semBase ? 'Confira o percentual.' : 'Confira o percentual e o valor líquido validado.'),
      }
    }
    return {
      ok: true,
      cotacao: {
        propostaCentavos: c.propostaCentavos,
        comissao: {
          modalidade: 'spread',
          percentualCentesimos: p,
          ...(base !== undefined ? { baseCentavos: base } : {}),
        },
      },
    }
  }
  if (m === 'limitada') {
    if (!centavosValidos(c.comissao?.centavos)) {
      return { ok: false, erro: 'Com a comissão limitada, informe o valor da comissão (em reais, maior que zero).' }
    }
    return {
      ok: true,
      cotacao: {
        propostaCentavos: c.propostaCentavos,
        comissao: { modalidade: 'limitada', centavos: c.comissao!.centavos as number },
      },
    }
  }
  return { ok: false, erro: 'A comissão precisa ser "limitada" ou "spread".' }
}

/**
 * A comissão como se LÊ do campo. No spread, além do percentual (quando o texto
 * o diz), `centavos` é a comissão em reais do FORMATO NOVO
 * ("R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)"): com ela, a `proposta` lida é
 * a FINAL, e o valor que a pessoa digitou é proposta + comissão
 * (`valorDigitadoDaCotacao`). Sem ela ("R$ 850.000,00 / Spread"), a `proposta`
 * é o valor da proposta, como sempre foi.
 */
export type ComissaoLida =
  | { modalidade: 'limitada'; centavos: number }
  | { modalidade: 'spread'; percentualCentesimos?: number; centavos?: number }

/** O que se leu de um campo de cotação: os números, quando se leem, e o texto como está. */
export interface CotacaoLida {
  /** O texto do campo, como está no Kommo (aparado). */
  texto: string
  /**
   * A proposta em centavos, ou null se o texto não a diz com segurança. No
   * spread do formato novo, é a proposta FINAL (já sem a comissão).
   */
  proposta: number | null
  /** A comissão, ou null se o texto não a diz. */
  comissao: ComissaoLida | null
}

/**
 * O VALOR QUE A PESSOA DIGITOU, de volta: no spread do formato novo, a final
 * mais a comissão (R$ 807.500,00 + R$ 42.500,00 = R$ 850.000,00); nos outros,
 * a proposta como está. É o que pré-preenche a janela ao recotar.
 */
export function valorDigitadoDaCotacao(l: CotacaoLida | null): number | null {
  if (!l || l.proposta === null) return null
  if (l.comissao?.modalidade === 'spread' && l.comissao.centavos !== undefined) {
    return l.proposta + l.comissao.centavos
  }
  return l.proposta
}

/**
 * COMO A JANELA DA COTAÇÃO COMEÇA, a partir do que o campo do fundo tem no card
 * — o valor que a pessoa digitou da outra vez, a modalidade, a comissão e o
 * percentual.
 *
 * AS MODALIDADES SÃO AS DO FUNDO (`comissoesDoFundo`, 07/10/2026). Um campo
 * gravado numa modalidade que o fundo não aceita mais — o spread de um BTG
 * antigo — volta na primeira modalidade dele (a limitada), com a comissão
 * VAZIA e `foraDoFundo`: a janela mostra o texto de hoje, e o spread não vira
 * sozinho uma comissão em reais. A LEITURA do campo (`lerCotacao`) não muda: o
 * card continua mostrando o spread antigo como está.
 */
export function inicioDaCotacao(
  atual: CotacaoLida | null,
  fundo?: string,
): {
  modalidades: readonly ModalidadeDaComissao[]
  proposta: number | null
  modalidade: ModalidadeDaComissao
  comissao: number | null
  percentual: string
  foraDoFundo: boolean
} {
  const modalidades = comissoesDoFundo(fundo)
  const c0 = atual?.comissao ?? null
  const aceita = c0 !== null && modalidades.includes(c0.modalidade)
  return {
    modalidades,
    proposta: valorDigitadoDaCotacao(atual),
    modalidade: aceita ? c0!.modalidade : modalidades[0],
    comissao: aceita && c0!.modalidade === 'limitada' ? c0!.centavos : null,
    percentual:
      aceita && c0!.modalidade === 'spread' && c0!.percentualCentesimos !== undefined
        ? formatarPercentual(c0!.percentualCentesimos)
        : '',
    foraDoFundo: c0 !== null && !aceita,
  }
}

/** Os rótulos que alguém pode ter escrito antes do número, no Kommo. */
const ROTULO = /^(?:proposta|valor(?:\s+da\s+proposta)?|comissao|com\.?|cotacao)\s*[:=-]?\s*/

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** O percentual escrito num pedaço de texto ("(Spread de 5,5%)", "spread 5%"), em centésimos. */
function percentualNoTexto(s: string): number | undefined {
  const m = s.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/)
  if (!m) return undefined
  const p = lerPercentual(m[1])
  return p.ok ? p.centesimos : undefined
}

/** O que vem ANTES do "spread" ou do parêntese: "R$ 42.500,00 (Spread de 5%)" → "r$ 42.500,00". */
const antesDoSpread = (s: string) => semAcento(s).split(/\(|\bspread\b/)[0]

/**
 * LÊ DE VOLTA o texto do campo do fundo — o que a plataforma gravou e o que
 * alguém digitou à mão no Kommo.
 *
 * Devolve null para o campo vazio (inclusive o "..." que o Kommo mostra em campo
 * sem valor, se alguém o digitar). Com texto, devolve sempre o texto, e os
 * números só quando se leem: "proposta boa, ligar" fica como texto, sem valor.
 *
 * OS TRÊS FORMATOS DA PLATAFORMA:
 *   "R$ 850.000,00 / R$ 40.000,00"                → limitada
 *   "R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)" → spread novo: a final, a comissão e o percentual
 *   "R$ 850.000,00 / Spread"                      → spread antigo: o valor, sem comissão
 * E, à mão, as variações: "807.500 / 42.500 spread 5%", "850 mil / spread de 5%"
 * (percentual sem a comissão em reais: o valor é o da proposta, como no antigo).
 */
export function lerCotacao(texto: unknown): CotacaoLida | null {
  const bruto = String(texto ?? '').replace(/\s+/g, ' ').trim()
  if (!bruto || /^[.…\-–—\s]*$/.test(bruto)) return null

  // A PRIMEIRA BARRA (ou |, ;, ou travessão entre espaços) separa as duas partes.
  const partes = bruto.split(/\s*[/|;]\s*|\s+[-–—]\s+/)
  const [p1, ...resto] = partes
  const p2 = resto.join(' ')

  const limpa = (s: string) => semAcento(s).trim().replace(ROTULO, '')
  const temSpread = (s: string) => /\bspread\b/.test(semAcento(s))

  /** O spread de um pedaço: o percentual (se escrito) e a comissão em reais (se escrita antes dele). */
  const spreadDe = (s: string, comValor: boolean): ComissaoLida => {
    const percentualCentesimos = percentualNoTexto(s)
    const c = comValor ? lerReais(limpa(antesDoSpread(s))) : null
    return {
      modalidade: 'spread',
      ...(percentualCentesimos !== undefined ? { percentualCentesimos } : {}),
      ...(c !== null && c > 0 ? { centavos: c } : {}),
    }
  }

  let proposta = lerReais(limpa(p1))
  let comissao: ComissaoLida | null = null
  if (resto.length > 0) {
    if (temSpread(p2)) comissao = spreadDe(p2, true)
    else {
      const c = lerReais(limpa(p2))
      if (c !== null && c > 0) comissao = { modalidade: 'limitada', centavos: c }
    }
  } else if (temSpread(p1)) {
    // "850 mil spread", sem separador: o número antes do "spread" é a proposta.
    comissao = spreadDe(p1, false)
    proposta = lerReais(limpa(antesDoSpread(p1)))
  }
  if (proposta !== null && proposta <= 0) proposta = null
  return { texto: bruto, proposta, comissao }
}

// ------------------------------------------------------------------ os campos do Kommo

/** Um campo personalizado de lead, como `GET /leads/custom_fields` o devolve (o que usamos). */
export interface CampoDoKommo {
  id: number
  name: string
  type: string
  /** "leads_1592396812437", ou null/ausente no grupo principal. */
  group_id?: string | null
}

/** Um grupo (aba) de campos, como `GET /leads/custom_fields/groups` o devolve. */
export interface GrupoDoKommo {
  id: string
  name: string
}

/**
 * Os tipos de campo que guardam um texto livre. `numeric` e `price` não aceitam
 * "R$ 850.000,00 / Spread", e `select` só aceita uma das opções dele.
 */
export const TIPOS_QUE_ACEITAM_TEXTO: readonly string[] = ['text', 'textarea']

/** O nome do grupo de campos que o dono criou no card. */
export const NOME_DO_GRUPO_DAS_COTACOES = 'Cotações/propostas'

/**
 * A CHAVE DE UM NOME, para casar o fundo com o campo: sem acento, sem caixa e
 * só letra e número. "PJUS" é "PJus"; "K&WC Ativos" é "K & WC Ativos".
 */
export function chaveDoNome(nome: unknown): string {
  return normalizarEtiqueta(nome).replace(/[^A-Z0-9]/g, '')
}

/** "Cotações/propostas", "Cotacoes / Propostas", "Cotações e propostas"… */
export function ehGrupoDasCotacoes(nome: unknown): boolean {
  const k = chaveDoNome(nome)
  return k.includes('COTAC') && k.includes('PROPOST')
}

/**
 * O CAMPO DO FUNDO, achado pelo NOME entre os campos de lead da conta.
 *
 * O DO GRUPO "Cotações/propostas" PRIMEIRO: um campo "BTG" noutra aba (de outro
 * assunto) não pode receber a cotação. Sem campo do fundo no grupo — ou sem o
 * grupo —, vale o de mesmo nome em qualquer aba, se for um só.
 *
 * O ERRO DIZ O QUE FALTA, com o nome: é ele que aparece na janela, e é com ele
 * que alguém vai ao Kommo criar ou corrigir o campo.
 */
export function campoDoFundo(
  fundo: string,
  campos: readonly CampoDoKommo[],
  grupos: readonly GrupoDoKommo[],
): { ok: true; campo: CampoDoKommo } | { ok: false; erro: string } {
  const chave = chaveDoNome(fundo)
  const candidatos = campos.filter((c) => chaveDoNome(c.name) === chave)
  const doGrupo = new Set(grupos.filter((g) => ehGrupoDasCotacoes(g.name)).map((g) => g.id))
  const noGrupo = candidatos.filter((c) => c.group_id != null && doGrupo.has(c.group_id))
  const escolhidos = noGrupo.length > 0 ? noGrupo : candidatos

  if (escolhidos.length === 0) {
    return {
      ok: false,
      erro:
        `Falta no Kommo o campo "${fundo}" no grupo "${NOME_DO_GRUPO_DAS_COTACOES}" do card. ` +
        'Crie o campo (de texto) com o nome do fundo e tente de novo.',
    }
  }
  if (escolhidos.length > 1) {
    return {
      ok: false,
      erro:
        `Há ${escolhidos.length} campos chamados "${fundo}" no Kommo` +
        (noGrupo.length > 0 ? ` dentro do grupo "${NOME_DO_GRUPO_DAS_COTACOES}"` : '') +
        ', e não sei em qual gravar. Deixe um só.',
    }
  }
  const campo = escolhidos[0]
  if (!TIPOS_QUE_ACEITAM_TEXTO.includes(campo.type)) {
    return {
      ok: false,
      erro:
        `O campo "${campo.name}" do Kommo é do tipo "${campo.type}", que não aceita o texto da cotação. ` +
        'Troque-o por um campo de texto.',
    }
  }
  return { ok: true, campo }
}

// ------------------------------------------------------------------ a leitura do card

/** Um valor de campo, como vem em `custom_fields_values` do lead (o que usamos). */
export interface ValorDeCampo {
  field_id?: number | null
  field_name?: string | null
  field_type?: string | null
  values?: { value?: unknown }[] | null
}

/** O texto de um valor de campo (o primeiro valor, que é o que um campo de texto tem). */
function textoDoValor(v: ValorDeCampo): string {
  const x = v.values?.[0]?.value
  // "&amp;" do Kommo vira "&" também no valor (o texto escrito à mão aparece na caixa).
  return typeof x === 'string' ? semEntidadesHtml(x) : typeof x === 'number' ? String(x) : ''
}

/**
 * AS COTAÇÕES DO CARD, por fundo (na ordem da tela), lidas de
 * `custom_fields_values` — o que o espelho guarda em `raw` e o que a
 * `kommo-etiquetar` devolve depois de gravar.
 *
 * PELO NOME DO CAMPO, porque é o que o lead traz: os valores não dizem a que
 * grupo o campo pertence. Havendo dois campos com o nome do fundo, vale o que
 * tem uma cotação legível — o da aba "Cotações/propostas" é o que a plataforma
 * escreve, e escreve sempre legível.
 */
export function cotacoesDoCard(
  valores: readonly ValorDeCampo[] | null | undefined,
  fundos: readonly string[] = FUNDOS_DA_PRECIFICACAO,
): Record<string, CotacaoLida | null> {
  const fora: Record<string, CotacaoLida | null> = {}
  for (const fundo of fundos) {
    const chave = chaveDoNome(fundo)
    const lidas = (valores ?? [])
      .filter((v) => chaveDoNome(v.field_name) === chave)
      .map((v) => lerCotacao(textoDoValor(v)))
      .filter((l): l is CotacaoLida => l !== null)
    fora[fundo] = lidas.find((l) => l.proposta !== null) ?? lidas[0] ?? null
  }
  return fora
}

/**
 * Os valores de campo do card com o do fundo trocado — o que a tela põe no
 * cache depois de gravar, quando a releitura do card não voltou.
 */
export function comCotacaoGravada(
  valores: readonly ValorDeCampo[] | null | undefined,
  campo: { id: number; name: string; type?: string },
  texto: string,
): ValorDeCampo[] {
  const outros = (valores ?? []).filter((v) => v.field_id !== campo.id)
  return [...outros, { field_id: campo.id, field_name: campo.name, field_type: campo.type ?? 'text', values: [{ value: texto }] }]
}
