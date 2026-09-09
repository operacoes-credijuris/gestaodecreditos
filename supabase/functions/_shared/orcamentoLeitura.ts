// Quanto cabe num pedido de leitura: texto, anotações e páginas em imagem.
//
// O QUE ISTO CONSERTA. Texto e imagem passaram a ir JUNTOS no mesmo pedido, e
// cada um tinha o seu teto — 360 mil caracteres de um lado, 60 imagens do outro
// — sem ninguém somando os dois. A soma estourava a janela do modelo:
//
//   360.000 caracteres  ≈ 120.000 tokens
//   60 imagens de A4    ≈ 144.000 tokens
//   anotações + prompt  ≈  14.000 tokens
//   saída reservada         16.000 tokens
//   ------------------------------------
//   total               ≈ 294.000 tokens, numa janela de 200.000
//
// E não era caso raro: a seleção de páginas dá prioridade máxima justamente às
// páginas escaneadas DENTRO de um arquivo com texto (a conta da contadoria em
// imagem no meio de um processo digital), que é a combinação que estoura. O
// pedido voltava HTTP 400 depois de o navegador ter passado minutos renderizando
// e subindo as páginas, e a mensagem na tela era "Claude API 400".
//
// O CUSTO DE UMA IMAGEM ERA SUBESTIMADO EM 55%. O comentário antigo dizia "perto
// de 1.500 tokens por página". A conta da API é `largura × altura / 750`, com a
// aresta maior reduzida a 1.568 px antes de contar: uma A4 chega como 1109×1568
// = 2.318 tokens. É por isso que renderizamos com a aresta maior JÁ em 1.568
// (ver renderizarPaginas.ts) — acima disso são bytes que se sobem, se baixam e
// se descartam, pagando os mesmos tokens.
//
// SEM `npm:`, para o vitest e o navegador alcançarem. Este módulo é a ÚNICA
// fonte destes números: o navegador o usa para decidir o que renderizar, e a
// Edge Function o usa como rede de segurança contra um cliente desatualizado.

/** A janela do modelo. Opus e Sonnet: 200 mil tokens. */
export const JANELA_TOKENS = 200_000

/** O que a extração pode gerar (`max_tokens`). Entra na conta da janela. */
export const RESERVA_SAIDA = 16_000

/**
 * System prompt, esquema JSON e instruções fixas.
 *
 * Medido, não chutado: SYSTEM_ANALISE tem ~11 mil caracteres e o esquema
 * serializado, ~13 mil. Arredondado para cima, porque errar aqui é estourar a
 * janela e perder a análise inteira.
 */
export const RESERVA_PROMPT = 12_000

/**
 * Caracteres por token em português jurídico.
 *
 * Prosa em pt-BR fica entre 3,2 e 3,6; texto de processo tem número, citação e
 * abreviatura, que tokenizam pior. 3,0 é a estimativa CONSERVADORA — supõe mais
 * tokens do que provavelmente serão gastos, e sobrar janela é o erro barato.
 */
export const CHARS_POR_TOKEN = 3.0

/** Teto por imagem: A4 a 1568 px na aresta maior custa 2.318; 2.400 dá folga. */
export const TOKENS_POR_IMAGEM = 2_400

/**
 * Teto das anotações do card.
 *
 * Era 40 mil caracteres. Decisão do dono: 7 mil cobrem o histórico de um card
 * real com folga, e o que sobrava disputava janela com os autos — que são o
 * documento que decide o preço.
 */
export const MAX_NOTAS_CHARS = 7_000

/**
 * Teto do texto do processo, em caracteres.
 *
 * Vale para o navegador (que escolhe as páginas) e para a Edge Function (que
 * corta o que chegar maior). Eram DOIS números diferentes — 360 mil lá, 420 mil
 * aqui —, e o maior nunca chegava a valer.
 */
export const MAX_TEXTO_CHARS = 360_000

/** Teto absoluto de imagens por pedido. A API aceita 100; 60 é o nosso. */
export const MAX_IMAGENS = 60

/**
 * Páginas em imagem que nunca são cortadas para caber mais texto.
 *
 * Quando um processo digital traz páginas escaneadas, elas são quase sempre a
 * conta da contadoria e o requisitório — as duas peças que decidem o preço.
 * Sacrificá-las para caber mais petição inicial seria trocar o essencial pelo
 * acessório. Doze páginas cobrem uma conta e um requisitório com folga.
 */
export const PISO_IMAGENS = 12

export interface PlanoDeLeitura {
  /** Quantos caracteres de texto do processo cabem. */
  maxCharsTexto: number
  /** Quantas páginas podem ir como imagem. */
  maxImagens: number
  /** Estimativa de tokens do pedido montado com este plano. */
  tokensEstimados: number
  /** Algo teve de ser cortado para caber. */
  apertou: boolean
}

/**
 * O que cabe neste pedido.
 *
 * A ORDEM DE PREFERÊNCIA É: piso de imagens > texto até o teto > o resto em
 * imagens. Ou seja: as páginas escaneadas essenciais entram sempre; o texto
 * então toma o que quiser até 360 mil caracteres; e o que sobrar da janela vira
 * mais páginas em imagem.
 *
 * Processo inteiramente escaneado não tem texto, então as 60 páginas cabem.
 * Processo digital puro não tem imagem, então os 360 mil caracteres cabem.
 * O aperto só existe no híbrido, e é lá que a ordem acima decide.
 */
export function planoDeLeitura(o: {
  /** Caracteres de texto que existem para mandar (antes de qualquer corte). */
  charsTexto: number
  /** Páginas que a seleção gostaria de mandar como imagem. */
  imagensPedidas: number
  /** Tamanho das anotações do card, já capado por MAX_NOTAS_CHARS. */
  charsNotas: number
}): PlanoDeLeitura {
  const tokensConteudo = JANELA_TOKENS - RESERVA_SAIDA - RESERVA_PROMPT
  const emTokens = (chars: number) => Math.ceil(Math.max(0, chars) / CHARS_POR_TOKEN)

  const disponivel = Math.max(0, tokensConteudo - emTokens(Math.min(o.charsNotas, MAX_NOTAS_CHARS)))

  const pedidas = Math.max(0, Math.min(o.imagensPedidas, MAX_IMAGENS))
  const textoDesejado = Math.max(0, Math.min(o.charsTexto, MAX_TEXTO_CHARS))

  // 1. O piso de imagens é reservado antes de o texto escolher.
  const piso = Math.min(pedidas, PISO_IMAGENS)
  const sobraParaTexto = Math.max(0, disponivel - piso * TOKENS_POR_IMAGEM)

  // 2. O texto pega o que quiser dentro do que sobrou.
  const tokensTexto = Math.min(emTokens(textoDesejado), sobraParaTexto)
  const maxCharsTexto = Math.min(textoDesejado, Math.floor(tokensTexto * CHARS_POR_TOKEN))

  // 3. O resto vira imagem.
  const tokensParaImagens = Math.max(0, disponivel - tokensTexto)
  const maxImagens = Math.min(pedidas, Math.floor(tokensParaImagens / TOKENS_POR_IMAGEM))

  const tokensEstimados =
    RESERVA_PROMPT + RESERVA_SAIDA +
    emTokens(Math.min(o.charsNotas, MAX_NOTAS_CHARS)) +
    emTokens(maxCharsTexto) +
    maxImagens * TOKENS_POR_IMAGEM

  return {
    maxCharsTexto,
    maxImagens,
    tokensEstimados,
    apertou: maxCharsTexto < textoDesejado || maxImagens < pedidas,
  }
}

/**
 * Corta as anotações mantendo O INÍCIO E O FIM.
 *
 * As duas pontas importam, e por motivos diferentes: a PRIMEIRA anotação é onde
 * o comercial registra os parâmetros do negócio (parcela cedida, percentual de
 * honorários, o que o cedente disse), e as ÚLTIMAS dizem em que pé a conversa
 * está hoje. Cortar só o fim perderia o estado atual; cortar só o começo
 * perderia o combinado.
 */
/**
 * A marca do corte das ANOTAÇÕES, que não é a do corte do processo.
 *
 * Era a mesma frase, e o servidor procurava essa frase nos blocos para acender
 * o aviso "o processo é muito grande e PARTE do conteúdo foi omitida". Card com
 * histórico de anotações longo acendia o aviso sobre o PROCESSO, que estava
 * inteiro.
 */
export const MARCA_CORTE_NOTAS = 'ANOTAÇÕES DO CARD OMITIDAS POR TAMANHO'

export function capNotas(txt: string, marca = MARCA_CORTE_NOTAS): string {
  if (txt.length <= MAX_NOTAS_CHARS) return txt
  const head = Math.floor(MAX_NOTAS_CHARS * 0.5)
  const tail = MAX_NOTAS_CHARS - head
  return txt.slice(0, head) +
    `\n\n[...${marca} — histórico de anotações muito longo; exibindo as primeiras e as últimas...]\n\n` +
    txt.slice(txt.length - tail)
}
