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
 *
 * OLHA A ASSINATURA, E NÃO `ehNotaNossa`: esta última também reconhece as notas
 * antigas, escritas antes de a marca existir, e usá-la aqui deixaria uma nota
 * NOVA sem marca só porque a forma dela é a de sempre.
 */
export function assinarNota(texto: string): string {
  const t = String(texto ?? '').trim()
  if (!t) return t
  return t.includes(ASSINATURA) ? t : `${t}\n\n${MARCA_NOTA}`
}

/**
 * AS NOTAS ANTIGAS, escritas entre 13/08 e 07/09 de 2026 — `note_type: 'common'`
 * e ainda sem marca nenhuma.
 *
 * A marca conserta as notas de agora e não alcança as de trás: um card analisado
 * naquela janela que ainda esteja em Pendentes, Validação ou Diligência tem no
 * feed uma ficha e um veredito NOSSOS que o espelho continua trazendo de volta
 * como se fossem cadastro do comercial. É a mesma regressão que a marca existe
 * para impedir, viva no legado — "PARCELA CEDIDA: <o que a IA escolheu>" volta
 * como o que o card diz, e a análise seguinte confirma a si mesma.
 *
 * RECONHECER PELA FORMA, e não pelo conteúdo: cada padrão aqui é algo que só
 * este código produz. Rótulo em CAIXA no começo da linha seguido de dois-pontos
 * (a ficha, montada por `linhasDaFicha`), o cabeçalho do resumo da oportunidade,
 * a linha do Drive e os vereditos com o emoji. Exige-se DOIS rótulos na ficha
 * porque um só ("PROCESSO: 5001…") é coisa que gente escreve.
 *
 * O RISCO ACEITÁVEL é o inverso: uma nota humana confundida com nossa deixa de
 * alimentar a análise. Perde-se informação; não se cria informação falsa. Errar
 * para o outro lado — nossa nota lida como cadastro — é o que já custou caro.
 */
const ROTULOS_DA_FICHA =
  /^(?:TIPO|PROCESSO|TRIBUNAL|CEDENTE|ENTIDADE DEVEDORA|PARCELA CEDIDA|VALOR CEDIDO|HONORÁRIOS C\.):/gm

const FORMAS_LEGADAS: RegExp[] = [
  /^Oportunidade Credijuris/m,
  /^Planilha e análise no Drive: https?:\/\//m,
  /(?:✅|❌)\s*(?:APROVADO|RECUSADO) na análise automática\./,
  /ANÁLISE JURÍDICA CONCLUÍDA\./,
]

function ehFormatoLegado(t: string): boolean {
  if (FORMAS_LEGADAS.some((r) => r.test(t))) return true
  return (t.match(ROTULOS_DA_FICHA) ?? []).length >= 2
}

/**
 * A MARCA DA NOTA ESCRITA POR GENTE E POSTADA PELA PLATAFORMA.
 *
 * Duas coisas diferentes passam pelo kommo-anotar: a ficha e o veredito, que o
 * sistema redige, e o motivo da diligência, da reprovação ou da aprovação, que
 * uma PESSOA escreve na janela (a IA pode rascunhar, ela edita e confirma).
 * Assinar as duas com "nota automática da análise" fazia duas coisas erradas de
 * uma vez: mentia ao comercial sobre a autoria e, pior, fazia o kommo-sync
 * excluir do espelho a decisão escrita por gente — a justificativa nunca entrava
 * em `kommo_leads.notas` e não chegava à análise seguinte, que é justamente
 * quem mais precisa dela.
 *
 * Esta marca diz o que houve — o texto é de alguém, o carimbo de horário e o
 * autor no feed são do token da plataforma — e `ehNotaNossa` NÃO a reconhece.
 */
export function marcarComoDePessoa(texto: string, autor?: string | null): string {
  const t = String(texto ?? '').trim()
  if (!t) return t
  const quem = String(autor ?? '').trim()
  const rodape = quem
    ? `— registrado por ${quem} pela plataforma Credijuris`
    : '— registrado pela plataforma Credijuris'
  return t.includes('pela plataforma Credijuris') ? t : `${t}\n\n${rodape}`
}

/** A nota foi escrita pelo sistema? É o que mantém o espelho livre dela. */
export function ehNotaNossa(texto: string | null | undefined): boolean {
  const t = String(texto ?? '')
  if (!t.trim()) return false
  return t.includes(ASSINATURA) || ehFormatoLegado(t)
}
