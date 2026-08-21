// Acha CPFs no texto do processo, para quem monta o checklist ESCOLHER em vez de
// digitar.
//
// POR QUE ISSO EXISTE. O CPF do cedente é o parâmetro de emissão de toda
// certidão do checklist. Um dígito errado não dá erro em lugar nenhum: cada
// portal responde "nada consta" — corretamente, porque nada consta para um CPF
// que não existe — e o dossiê fecha limpo sobre uma pessoa inexistente. É o pior
// modo de falha do sistema, porque não parece falha, parece aprovação.
//
// Digitar 11 dígitos de um PDF é exatamente onde esse erro nasce. Então o texto
// do PDF já está aberto na tela (o botão Analisar o baixa e extrai): daqui sai a
// LISTA de candidatos, com o trecho em volta, e a pessoa clica no certo.
//
// O QUE ESTA FUNÇÃO NÃO FAZ, de propósito: escolher. Um processo tem o CPF do
// cedente, o do advogado, o do cônjuge, às vezes o de terceiros. Não existe
// regra confiável para dizer qual é qual, e adivinhar aqui seria o mesmo erro de
// digitar errado — só mais difícil de perceber. A ordenação abaixo é uma
// SUGESTÃO de leitura; a escolha é sempre de quem confere.
//
// E LISTA VAZIA NÃO É "O PROCESSO NÃO TEM CPF". O pdf.js entrega o texto
// fatiado do jeito que o PDF foi escrito, e há formas que os padrões abaixo não
// pegam. Quem chama tem de dizer "não encontrei", nunca "não existe" — ver o
// aviso na tela do checklist.

import { cpfValido, onlyDigits } from './format'

export interface CpfEncontrado {
  /** Só dígitos — é assim que vai para o banco. */
  cpf: string
  /** ~90 caracteres em volta, para reconhecer de quem é o CPF. */
  contexto: string
  /** A palavra "CPF" aparece logo antes. Sobe na ordem. */
  rotulado: boolean
  /** Veio com pontuação de CPF, não como 11 dígitos crus. Sobe na ordem. */
  mascarado: boolean
  /** Posição da primeira aparição no texto. É a ordem de leitura do documento. */
  posicao: number
}

// Três formas, porque o pdf.js junta os itens de texto com espaço e o corte cai
// onde o PDF quiser — inclusive NO MEIO de um grupo de dígitos:
//
//   COM_MASCARA  123.456.789-09, tolerando espaço em volta dos separadores
//   ESPACADO     123 456 789 09  (a pontuação virou espaço)
//   CRU          11 dígitos seguidos
//
// As guardas de borda estão nas TRÊS, e não são detalhe: sem elas
// "guia 529.982.247-250" e "R$ 1.529.982.247-25" casam e viram CPF de dígito
// válido, badgeado como conferido. Recorte de número maior é o falso positivo
// que mais engana, porque parece exato.
//
// Duas guardas de cada lado, porque uma só não basta:
//   (?<!\d)        barra "9529.982.247-25"
//   (?<!\d[.\-/])  barra "1.529.982.247-25" — o separador de milhar de um valor
//                  em reais não é dígito, então a primeira guarda passa por ele.
// A segunda é escrita como "dígito + pontuação", e não como "qualquer
// pontuação": "CPF.529.982.247-25", que o pdf.js produz quando o espaço depois
// do rótulo se perde, tem de continuar casando.
const BORDA_ESQ = String.raw`(?<!\d)(?<!\d[.\-/])`
const BORDA_DIR = String.raw`(?!\d)(?![.\-/]\d)`
const COM_MASCARA = new RegExp(
  BORDA_ESQ + String.raw`\d{3}\s*\.\s*\d{3}\s*\.\s*\d{3}\s*-\s*\d{2}` + BORDA_DIR,
  'g',
)
const ESPACADO = new RegExp(
  BORDA_ESQ + String.raw`\d{2,9}(?:[\s.\-]+\d{1,9}){1,4}` + BORDA_DIR,
  'g',
)
const CRU = new RegExp(BORDA_ESQ + String.raw`\d{11}` + BORDA_DIR, 'g')

function limparContexto(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Todos os CPFs de dígito verificador válido no texto, sem repetir, na ordem
 * sugerida de leitura: rotulado com "CPF" primeiro, depois com pontuação de CPF,
 * depois o resto — e, dentro de cada grupo, a ordem de aparição no documento,
 * porque a qualificação das partes vem no começo da peça.
 *
 * O DV é o filtro que torna a lista utilizável. Sem ele, os 11 dígitos crus
 * trariam número de protocolo, valor sem separador e pedaço de número de
 * processo. Com ele, sobra pouca coisa, e o que sobra vem com o trecho em volta.
 */
export function acharCpfs(texto: string, limite = 12): CpfEncontrado[] {
  if (!texto) return []
  const porCpf = new Map<string, CpfEncontrado>()

  const contextoDe = (i: number, tam: number) =>
    limparContexto(texto.slice(Math.max(0, i - 70), i + tam + 20))

  const varrer = (re: RegExp, mascarado: boolean) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(texto)) !== null) {
      const cpf = onlyDigits(m[0])
      if (cpf.length !== 11 || !cpfValido(cpf)) continue

      // 25 caracteres antes bastam para "CPF nº", "CPF/MF sob o nº" e
      // "inscrito no CPF". Mais que isso começa a pegar o rótulo do CPF
      // ANTERIOR, quando dois vêm na mesma linha de qualificação.
      const rotulado = /\bCPF\b/i.test(texto.slice(Math.max(0, m.index - 25), m.index))

      const jaTem = porCpf.get(cpf)
      if (jaTem) {
        // Aparição posterior só ACRESCENTA sinal. Nunca troca o contexto já
        // guardado: a primeira aparição é a que tende a estar na qualificação
        // das partes, e sobrescrever com uma menção de "intimar sobre custas"
        // jogaria fora justamente a informação que faz reconhecer a pessoa.
        if (mascarado) jaTem.mascarado = true
        if (rotulado && !jaTem.rotulado) {
          jaTem.rotulado = true
          jaTem.contexto = contextoDe(m.index, m[0].length)
          jaTem.posicao = m.index
        }
        continue
      }

      porCpf.set(cpf, {
        cpf,
        contexto: contextoDe(m.index, m[0].length),
        rotulado,
        mascarado,
        posicao: m.index,
      })
    }
  }

  varrer(COM_MASCARA, true)
  varrer(ESPACADO, true)
  varrer(CRU, false)

  const peso = (c: CpfEncontrado) => (c.rotulado ? 0 : c.mascarado ? 1 : 2)
  // Ordena por POSIÇÃO, não por ordem de inserção no Map: as varreduras rodam
  // uma depois da outra, então a ordem de inserção poria todo CPF mascarado
  // antes de todo CPF cru, mesmo que o cru viesse na primeira linha da peça.
  return [...porCpf.values()]
    .sort((a, b) => peso(a) - peso(b) || a.posicao - b.posicao)
    .slice(0, limite)
}
