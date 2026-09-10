// A ANÁLISE DO PRECATÓRIO EXTERNO acontece FORA daqui, e é por isso que este
// arquivo é pequeno.
//
// No Interno o motor analisa: lê os autos, audita a conta, precifica. No Externo
// quem decide o preço é o fundo comprador — o que a casa faz é montar o crédito
// e conversar sobre ele. Essa conversa mora no Claude, num projeto que carrega o
// contexto da operação, e o papel desta tela é ABRIR essa conversa já dizendo de
// que crédito se trata.
//
// O QUE NÃO DÁ, e não é limitação nossa: NÃO EXISTE forma de anexar arquivo a uma
// conversa do claude.ai por link. Nem parâmetro de URL, nem área de
// transferência (o navegador só deixa escrever texto e imagem no clipboard, não
// PDF). Anexo entra na conversa pela mão de quem conversa — arrastando ou pelo
// seletor. Então o botão faz as duas metades que PODE fazer: abre a conversa com
// a pergunta pronta e baixa os anexos do card, para o arrasto ser um gesto só.

/** O que o título do card informa, já lido por `lerTituloCard`. */
export interface DadosDoTituloParaPrompt {
  cedente: string
  parcelaCedida: string
  honorariosPct: string
}

/**
 * A primeira mensagem da conversa, montada do TÍTULO do card.
 *
 * DO TÍTULO, e não da leitura dos autos: aqui ninguém leu os autos ainda — a
 * conversa é que vai lê-los. O título é o cadastro do card, é o que o comercial
 * escreveu, e é o que identifica o negócio: quem cede, o que cede, a que
 * percentual de honorários.
 *
 * CAMPO AUSENTE É OMITIDO, nunca preenchido com "não informado". A mensagem é o
 * começo de uma conversa, e uma lacuna anunciada ali convida a resposta errada:
 * o modelo tenta suprir o que falta em vez de perguntar. O que o título não
 * trouxer, quem conversa diz.
 */
export function promptDaAnaliseExterna(dados: DadosDoTituloParaPrompt): string {
  const pct = String(dados.honorariosPct ?? '').trim()
  // "0" é informação: quer dizer cessão sem honorário contratual, e some num
  // teste de string vazia se ele for feito com truthy.
  const comPct = pct !== '' ? `${pct.replace('.', ',')}% de honorários contratuais` : ''
  const partes = [dados.cedente, dados.parcelaCedida, comPct]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
  return 'executar análise de crédito: ' + partes.join(' - ')
}

/**
 * O PROJETO DO CLAUDE em que a conversa deve nascer.
 *
 * Vazio abre uma conversa solta, que funciona e perde o contexto — o projeto é
 * quem carrega as instruções da operação, o manual e o histórico. Cole aqui a
 * URL do projeto (https://claude.ai/project/…) para as conversas nascerem
 * dentro dele.
 *
 * CONSTANTE, e não configuração de tela: é uma URL por instalação, não por
 * usuário, e uma tela de configuração para um campo que muda de ano em ano custa
 * mais do que a linha que ela pouparia.
 */
export const PROJETO_CLAUDE = ''

/**
 * A URL que abre a conversa com a pergunta já escrita.
 *
 * `?q=` é o que o claude.ai lê para pré-preencher o campo. Anexado à URL do
 * PROJETO quando há um: se aquela página ignorar o parâmetro, a conversa abre
 * dentro do projeto com o campo vazio — que continua sendo melhor do que uma
 * conversa fora dele.
 *
 * SÓ claude.ai. A URL do projeto é digitada por uma pessoa, e uma linha
 * trocada por descuido faria este botão abrir um site qualquer levando o nome
 * do cedente na query.
 */
export function urlDoClaude(prompt: string, projeto: string = PROJETO_CLAUDE): string {
  const q = encodeURIComponent(prompt)
  const base = String(projeto ?? '').trim()
  let permitida = false
  if (base) {
    try {
      permitida = new URL(base).hostname.endsWith('claude.ai')
    } catch {
      permitida = false
    }
  }
  if (!permitida) return `https://claude.ai/new?q=${q}`
  return base.includes('?') ? `${base}&q=${q}` : `${base}?q=${q}`
}
