// A assinatura que separa a nota escrita pelo sistema da escrita por gente.
//
// POR QUE ELA EXISTE. As anotações da análise precisam ser NOTA DE VERDADE no
// feed do Kommo — `note_type: 'common'` —, porque só esse tipo preserva as
// quebras de linha. O `service_message` é renderizado como uma linha do
// histórico, com o nome do serviço na frente e os parágrafos colados num bloco
// corrido: a ficha do crédito e o resumo da oportunidade chegavam ilegíveis.
//
// MAS `common` É JUSTAMENTE O QUE O kommo-sync TRAZ DE VOLTA. Sem separar uma
// coisa da outra, a análise volta a ler a própria anotação como se fosse
// cadastro do comercial — e isso já aconteceu: a ficha que ela escreveu virava
// "o que o card diz" na análise seguinte, o aviso de "parcela cedida não
// informada" nunca mais disparava, e o sistema confirmava a si mesmo.
//
// A saída foi trocar o critério. Antes era o TIPO da nota, que decidia junto o
// que o feed mostra — duas perguntas diferentes presas na mesma resposta. Agora
// é uma marca no texto, e cada pergunta tem a sua: o tipo decide como se lê, a
// marca decide de quem é.
//
// POR QUE VISÍVEL, e não um caractere invisível: quem abre o card vê que aquela
// nota foi escrita pela análise e não por um colega. O marcador invisível
// resolveria o mesmo e mentiria para o leitor.

/** A marca, no fim de toda nota que o sistema escreve. */
export const MARCA_NOTA = '— Credijuris · nota automática da análise'

/**
 * O trecho que a identifica.
 *
 * MENOR QUE A MARCA INTEIRA de propósito: o travessão do começo é o pedaço mais
 * frágil (é o que alguém apaga ao editar, e o que um cliente de e-mail trocaria
 * por hífen). O miolo com o ponto médio não aparece por acaso num texto humano.
 */
const ASSINATURA = 'Credijuris · nota automática'

/**
 * Assina a nota, uma vez só.
 *
 * IDEMPOTENTE porque o texto pode passar por aqui mais de uma vez — a mesma
 * análise reescrita, um texto que já vinha assinado de outra ação — e duas
 * assinaturas no rodapé denunciam o remendo em vez do registro.
 */
export function assinarNota(texto: string): string {
  const t = String(texto ?? '').trim()
  if (!t) return t
  return ehNotaNossa(t) ? t : `${t}\n\n${MARCA_NOTA}`
}

/** A nota foi escrita pelo sistema? É o que mantém o espelho livre dela. */
export function ehNotaNossa(texto: string | null | undefined): boolean {
  return String(texto ?? '').includes(ASSINATURA)
}
