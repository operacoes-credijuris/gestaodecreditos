// A ANÁLISE DO PRECATÓRIO EXTERNO acontece FORA daqui, e é por isso que este
// arquivo é pequeno.
//
// No Interno o motor analisa: lê os autos, audita a conta, precifica. No Externo
// quem decide o preço é o fundo comprador — o que a casa faz é montar o crédito
// e conversar sobre ele. Essa conversa mora no Claude, num projeto que carrega o
// contexto da operação, e o papel desta tela é ABRIR essa conversa já dizendo de
// que crédito se trata.
//
// ABRE O APLICATIVO, e não o navegador. O Claude Desktop registra o esquema
// `claude://` no Windows, e as rotas dele espelham as da web — o próprio app usa
// `claude://claude.ai/new?surface=chat` no atalho "New Chat" da barra de tarefas.
// Então `claude://claude.ai/new?q=…` abre a conversa no app com a pergunta
// escrita.
//
// OS ANEXOS VÃO POR LINK, e é assim que eles chegam à conversa sem ninguém
// arrastar nada. O link de download do Kommo é PÚBLICO — o navegador o busca sem
// cabeçalho de autenticação, que é como esta plataforma já lê os PDFs — então
// basta que ele esteja na pergunta para o Claude buscar os autos por conta
// própria.
//
// POR QUE NÃO ANEXAR DE VERDADE, e isto foi verificado no pacote instalado, não
// suposto. Quatro vias existiriam e as quatro estão fechadas para quem chama de
// fora: URL não carrega o CONTEÚDO de um arquivo; a área de transferência só
// aceita texto, HTML e PNG; o app não declara alvo de compartilhamento (não há
// ShareTarget no AppxManifest); e a API interna de anexar
// (`postMessage({type:"anthropic:attach-files"})`) fala com `window.parent` — é
// para página que roda DENTRO da conversa, num artifact, não para um site.
//
// O LINK CONTORNA TODAS ELAS, porque não transporta arquivo: transporta endereço,
// e quem busca é o Claude. O download continua acontecendo como rede de
// segurança — se a busca falhar, os arquivos já estão no disco para arrastar.

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
export function promptDaAnaliseExterna(
  dados: DadosDoTituloParaPrompt,
  /**
   * Os anexos do card, por endereço.
   *
   * ENDEREÇO, E NÃO ARQUIVO: o link do Kommo é público, e o Claude o busca
   * sozinho. É o que faz a conversa nascer com os autos sem ninguém arrastar.
   */
  anexos: { nome: string; download: string }[] = [],
): string {
  const pct = String(dados.honorariosPct ?? '').trim()
  // "0" é informação: quer dizer cessão sem honorário contratual, e some num
  // teste de string vazia se ele for feito com truthy.
  const comPct = pct !== '' ? `${pct.replace('.', ',')}% de honorários contratuais` : ''
  const partes = [dados.cedente, dados.parcelaCedida, comPct]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
  const cabeca = 'executar análise de crédito: ' + partes.join(' - ')
  const links = anexos
    .filter((a) => a && a.download)
    .map((a) => '- ' + (a.nome || 'anexo') + ': ' + a.download)
  if (links.length === 0) return cabeca
  // A INSTRUÇÃO VEM JUNTO. Sem ela o modelo lê uma lista de endereços e pode
  // tratá-la como referência a citar; com ela, sabe que o trabalho começa por
  // abrir os arquivos.
  return (
    cabeca +
    '\n\nOs autos estão nos anexos abaixo. Baixe e leia cada um antes de responder:\n' +
    links.join('\n')
  )
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
export function urlDoClaude(
  prompt: string,
  projeto: string = PROJETO_CLAUDE,
  /**
   * No APLICATIVO, que é o padrão.
   *
   * `claude://` é o esquema que o Claude Desktop registra, e o caminho é o mesmo
   * da web — o app o usa assim no próprio atalho de "New Chat". Falso abre no
   * navegador, que é a saída para máquina sem o app instalado: ali o esquema não
   * tem quem o atenda e o clique não faz nada visível.
   */
  noApp = true,
): string {
  const q = encodeURIComponent(prompt)
  const base = String(projeto ?? '').trim()
  let caminho = '/new'
  if (base) {
    try {
      const u = new URL(base)
      // SÓ claude.ai. A URL do projeto é digitada por uma pessoa, e uma linha
      // trocada por descuido faria este botão abrir um site qualquer levando o
      // nome do cedente na query.
      if (u.hostname.endsWith('claude.ai')) caminho = u.pathname + u.search
    } catch {
      caminho = '/new'
    }
  }
  const separador = caminho.includes('?') ? '&' : '?'
  const prefixo = noApp ? 'claude://claude.ai' : 'https://claude.ai'
  return `${prefixo}${caminho}${separador}q=${q}`
}
