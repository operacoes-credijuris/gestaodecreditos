// Leitura do modelo e medidas da petição.
//
// Separado do gerador de .docx por dois motivos:
//
//   • dá para conferir a leitura e as medidas FORA do navegador, com node — foi
//     assim que o recuo das citações, o alinhamento das listas e o tamanho do
//     timbrado foram verificados, sem depender de abrir a plataforma;
//   • as medidas ficam num lugar só. Já houve um gerador de PDF ao lado deste, e as
//     duas leituras do mesmo markdown teriam divergido — um recuando 4 cm, o outro
//     3,8 — sem ninguém perceber até um juiz receber duas peças do mesmo escritório
//     com formatações diferentes. Se o PDF voltar, volta consumindo daqui.
//
// `lerModelo` transforma o markdown em blocos com significado (título, parágrafo,
// citação, dados, item); o gerador só resolve a mecânica do formato. As medidas
// ficam em milímetros e pontos, e cada formato converte para a sua unidade.
//
// As medidas saíram do CONTRATO_CREDIJURIS_MODELO, o documento que a Credijuris já
// usa: Calibri 11, entrelinha 1,08, 12pt depois de cada parágrafo, margens
// 25/34,9/25/33 mm e a paleta abaixo.

/**
 * Margens da página, em milímetros.
 *
 * Laterais e topo saíram do CONTRATO_CREDIJURIS_MODELO. O RODAPÉ, não: o contrato
 * usa 33 mm, e a arte do timbrado começa a 265,7 mm — sobravam 1,7 mm, e na prática
 * o último item da lista encavalava no rodapé. Vale 40 mm, que dá ~9 mm de folga da
 * arte. Custa 7 mm de área útil e evita texto por cima da marca.
 */
export const MARGENS_MM = { esquerda: 25, topo: 34.9, direita: 25, rodape: 40 }

/** Corpo do texto. */
export const CORPO = { fonte: 11, entrelinha: 1.08 }

/** Citação direta: um corpo menor e sem entrelinha, como manda a praxe. */
export const CITACAO = { fonte: 10, entrelinha: 1 }

/**
 * Espaço depois de um parágrafo comum, em pontos — o `w:after="240"` do modelo de
 * referência. O dobro é o que a vista lê como "uma linha em branco", e é o que
 * separa os tópicos.
 */
export const DEPOIS_PT = 12

/**
 * Recuo da citação direta, em milímetros. Convenção da peça: ementa transcrita
 * entra afastada da margem, para o juízo distinguir de relance o que é texto do
 * peticionário e o que é palavra do tribunal.
 *
 * NÃO vale para os dados bancários: o cartão já os separa do texto corrido, e
 * recuar empurrava para o meio da página um dado que o juízo precisa achar de
 * relance ao expedir alvará.
 */
export const RECUO_CITACAO_MM = 40

/** Paleta extraída do CONTRATO_CREDIJURIS_MODELO, sem o `#`. */
export const COR = {
  /** 0A6296 — o azul escuro mais usado no contrato. */
  titulo: '0A6296',
  /** 075278 — o marinho, para o endereçamento e o número do processo. */
  cabecalho: '075278',
  /** C9E2F2 — a cor de borda do contrato (50 ocorrências). */
  regua: 'C9E2F2',
  /** F4FAFD — o fundo claro do contrato. */
  fundoDados: 'F4FAFD',
  /**
   * Corpo quase preto, e não azul: o contrato usa azul em texto corrido, mas
   * contrato é peça comercial e petição vai para juiz. A identidade entra na
   * estrutura — títulos, réguas e o cartão de dados.
   */
  corpo: '111827',
}

/** Um pedaço de texto com ou sem ênfase. */
export interface Trecho {
  texto: string
  negrito?: boolean
  italico?: boolean
}

export type Alinhamento = 'justificado' | 'esquerda' | 'centro'

/**
 * Um bloco do documento, já com significado resolvido. Cada gerador decide como
 * desenhar, mas nenhum decide o que a coisa É.
 */
export type Bloco =
  | {
      tipo: 'titulo'
      trechos: Trecho[]
      /**
       * Endereçamento e número do processo. Levam menos espaço acima que um título
       * de seção e não recebem a régua: entre eles a folga grande separaria o que é
       * uma coisa só.
       */
      cabecalho: boolean
    }
  | {
      tipo: 'paragrafo'
      trechos: Trecho[]
      alinhamento: Alinhamento
      /**
       * Primeiro bloco do fecho ("Nestes termos, pede deferimento"). Leva linha em
       * branco acima, por pedido. Vem marcado aqui em vez de o desenhista deduzir
       * pelo alinhamento — dedução daria resultado diferente nos dois formatos.
       */
      abreFecho?: boolean
    }
  | { tipo: 'citacao'; trechos: Trecho[] }
  | { tipo: 'dados'; trechos: Trecho[] }
  | { tipo: 'item'; marcador: string; trechos: Trecho[]; ultimo: boolean }

/**
 * Trechos em negrito e itálico.
 *
 * Roda no PARÁGRAFO INTEIRO, não linha por linha. Tem de ser assim: quando o
 * rótulo [DADOS BANCÁRIOS...] é substituído, entra um bloco de várias linhas
 * DENTRO do `**negrito**` do modelo. Lendo linha a linha, o `**` abriria numa e
 * fecharia noutra, e os asteriscos sairiam impressos. Como `[^*]` também aceita
 * `\n`, processar o bloco todo resolve.
 *
 * Aceita `_itálico_` e `*itálico*`: a conversão de .docx para .md gerou as duas.
 */
function trechosDe(texto: string): Trecho[] {
  const partes: Trecho[] = []
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g
  let ultimo = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push({ texto: texto.slice(ultimo, m.index) })
    const negrito = m[1] ?? m[2]
    if (negrito !== undefined) partes.push({ texto: negrito, negrito: true })
    else partes.push({ texto: (m[3] ?? m[4]) as string, italico: true })
    ultimo = m.index + m[0].length
  }
  if (ultimo < texto.length) partes.push({ texto: texto.slice(ultimo) })
  return partes.length ? partes : [{ texto }]
}

/** Remove o escape de colchete que a conversão para .md introduziu. */
const semEscape = (s: string) => s.replace(/\\([[\]])/g, '$1')

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * O bloco é TODO negrito — nada fora de marcação, a não ser espaço.
 *
 * Aceita negrito PARTIDO, e não só um par de `**` envolvendo tudo: a conversão de
 * .docx para .md gerou `**II -** **CONSTRIÇÃO...**` num dos títulos. Exigindo um
 * par único, aquele título deixava de ser título — perdia cor, régua e
 * espaçamento — e o defeito aparecia como "uma seção diferente das outras".
 */
const todoNegrito = (bloco: string) =>
  /\*\*/.test(bloco) && bloco.replace(/\*\*[^*]+\*\*/g, '').trim() === ''

/**
 * Citação direta é marcada com `>` no modelo, como em markdown.
 *
 * É MARCAÇÃO EXPLÍCITA de propósito, e não heurística: dava para adivinhar ementa
 * pelo "(STF - ..." ou pelo caixa-alta, mas aí o recuo passaria a depender de como
 * o tribunal formata o acórdão, e uma citação de STJ, de TJ ou de doutrina ficaria
 * de fora sem ninguém entender por quê.
 */
const ehCitacao = (bloco: string) =>
  bloco.split('\n').every((l) => /^>\s?/.test(l.trim()))

const semMarcaCitacao = (s: string) =>
  s.split('\n').map((l) => l.trim().replace(/^>\s?/, '')).join('\n')

/** O fecho da peça: daqui até o fim tudo é centralizado. */
const ehFecho = (bloco: string) => semAcento(bloco).includes('pede deferimento')

/**
 * Markdown do modelo para blocos com significado.
 *
 * Cobre só o que os dez modelos usam: parágrafo, negrito, itálico, citação com
 * `>`, lista com marcador e lista numerada. Deliberadamente não é um parser
 * completo — um parser genérico traria casos que nenhum modelo exercita, e cada um
 * é uma forma de o documento sair diferente do esperado sem ninguém perceber.
 *
 * A numeração das listas é a do texto, não gerada: o modelo de RPV complementar já
 * teve uma lista que reiniciava em 1, e renumerar automaticamente mudaria o texto
 * jurídico sem ninguém pedir.
 */
export function lerModelo(md: string): Bloco[] {
  const saida: Bloco[] = []
  const blocos = semEscape(md.replace(/\r\n/g, '\n'))
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  const inicioFecho = blocos.findIndex(ehFecho)

  blocos.forEach((bloco, i) => {
    const noFecho = inicioFecho >= 0 && i >= inicioFecho

    if (ehCitacao(bloco)) {
      saida.push({ tipo: 'citacao', trechos: trechosDe(semMarcaCitacao(bloco)) })
      return
    }

    // Dados bancários: todo negrito e com várias linhas. Fora do fecho, senão a
    // assinatura (que também é toda negrito e de duas linhas) cairia aqui em vez
    // de ser centralizada.
    if (todoNegrito(bloco) && bloco.includes('\n') && !noFecho) {
      saida.push({ tipo: 'dados', trechos: trechosDe(bloco) })
      return
    }

    const linhas = bloco.split('\n').map((l) => l.trim()).filter(Boolean)

    if (linhas.length && linhas.every((l) => /^([-*]|\d+\.)\s/.test(l))) {
      linhas.forEach((l, j) => {
        const parte = l.match(/^(\d+\.|[-*])\s+(.*)$/)
        if (!parte) return
        saida.push({
          tipo: 'item',
          marcador: parte[1] === '-' || parte[1] === '*' ? '•' : parte[1],
          trechos: trechosDe(parte[2]),
          ultimo: j === linhas.length - 1,
        })
      })
      return
    }

    // Título: todo negrito e de uma só linha. Os dois primeiros blocos são o
    // cabeçalho da peça (endereçamento e número do processo).
    if (todoNegrito(bloco) && !bloco.includes('\n')) {
      saida.push({ tipo: 'titulo', trechos: trechosDe(bloco), cabecalho: i < 2 })
      return
    }

    saida.push({
      tipo: 'paragrafo',
      trechos: trechosDe(linhas.join('\n')),
      // Bloco com quebra interna é dado ou assinatura: justificar esticaria linhas
      // de duas palavras.
      alinhamento: noFecho ? 'centro' : linhas.length > 1 ? 'esquerda' : 'justificado',
      abreFecho: i === inicioFecho,
    })
  })

  return saida
}
