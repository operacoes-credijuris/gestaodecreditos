// A ANÁLISE DO PRECATÓRIO EXTERNO acontece FORA daqui, e é por isso que este
// arquivo é pequeno.
//
// No Interno o motor analisa: lê os autos, audita a conta, precifica. No Externo
// quem decide o preço é o fundo comprador — o que a casa faz é montar o crédito
// e conversar sobre ele. Essa conversa mora no Claude, e o papel desta tela é
// ABRIR essa conversa já dizendo de que crédito se trata e já entregando os
// autos.
//
// ABRE O APLICATIVO, e não o navegador. O Claude Desktop registra o esquema
// `claude://` no Windows, e as rotas dele espelham as da web — o próprio app usa
// `claude://claude.ai/new?surface=chat` no atalho "New Chat" da barra de tarefas.
// Então `claude://claude.ai/new?q=…` abre a conversa no app com a pergunta
// escrita.
//
// OS AUTOS NÃO VÃO: SÃO BUSCADOS. Esta é a inversão que faz o fluxo funcionar.
// Anexar de verdade não é possível de fora, e isto foi verificado no pacote
// instalado, não suposto — as quatro vias que existiriam estão todas fechadas:
// a URL não carrega o CONTEÚDO de um arquivo; a área de transferência só aceita
// texto, HTML e PNG; o app não declara alvo de compartilhamento (não há
// ShareTarget no AppxManifest); e a API interna de anexar
// (`postMessage({type:"anthropic:attach-files"})`) fala com `window.parent` — é
// para página que roda DENTRO da conversa, num artifact, não para um site.
//
// PÔR O LINK DO KOMMO NA PERGUNTA TAMBÉM NÃO RESOLVEU. Foi a primeira tentativa,
// e era barata: o link é público, então bastaria o modelo buscá-lo. Ele não
// busca. Fica registrado para ninguém tentar de novo.
//
// O QUE RESOLVE É O CONECTOR. A plataforma deposita o TEXTO dos autos num balcão
// (a função `autos-guardar`) sob um código, e põe esse código na pergunta; o
// aplicativo do Claude chama o conector `mcp-autos` com o código e recebe os
// autos inteiros. Nada trafega pelo disco, nada é arrastado, e quem lê os PDFs
// continua sendo o navegador — com pdf.js, como no resto da plataforma.

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
   * O código com que o Claude vem buscar os autos.
   *
   * É A CHAVE DO BALCÃO, e por isso vai escrito na pergunta: o aplicativo não
   * recebe arquivo nenhum, ele chama o conector com este código e lê os autos de
   * lá. Vazio abre a conversa sem os autos — o que acontece quando o depósito
   * falhou, e aí o resgate é pelo disco.
   */
  codigo = '',
): string {
  const pct = String(dados.honorariosPct ?? '').trim()
  const parcela = String(dados.parcelaCedida ?? '').trim()
  // A PARCELA CEDIDA JÁ PODE SER A VERBA DE HONORÁRIOS, e aí o sufixo repete o
  // que ela acabou de dizer: "Honorários contratuais - 30% de honorários
  // contratuais". Quando ela fala de honorário, o percentual entra sozinho.
  const sufixo = /honor/i.test(parcela) ? '' : ' de honorários contratuais'
  // "0" é informação: quer dizer cessão sem honorário contratual, e some num
  // teste de string vazia se ele for feito com truthy.
  const comPct = pct !== '' ? `${pct.replace('.', ',')}%${sufixo}` : ''
  const partes = [dados.cedente, parcela, comPct]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
  const cabeca = 'executar análise de crédito: ' + partes.join(' - ')
  const chave = String(codigo ?? '').trim()
  if (!chave) return cabeca
  // A INSTRUÇÃO VEM JUNTO, e nomeia a ferramenta. Um código solto na mensagem
  // não diz a ninguém o que fazer com ele; dito assim, a primeira coisa que a
  // conversa faz é abrir os autos.
  return (
    cabeca +
    '\n\nOs autos deste crédito estão no conector Credijuris. Antes de responder, ' +
    'leia-os com a ferramenta `autos_do_credito`, código ' +
    chave +
    '.'
  )
}

/**
 * O PROJETO DO CLAUDE em que a conversa deve nascer.
 *
 * Vazio abre uma conversa solta, que funciona e perde o contexto — o projeto é
 * quem carrega as instruções da operação, o manual e o histórico. Cole aqui a
 * URL do projeto (https://claude.ai/project/…).
 *
 * MAS LEIA `urlDoClaude` ANTES DE PREENCHER: no aplicativo, projeto e pergunta
 * são excludentes, e a pergunta ganha.
 *
 * CONSTANTE, e não configuração de tela: é uma URL por instalação, não por
 * usuário, e uma tela de configuração para um campo que muda de ano em ano custa
 * mais do que a linha que ela pouparia.
 */
export const PROJETO_CLAUDE = ''

/**
 * A URL que abre a conversa com a pergunta já escrita.
 *
 * `?q=` é o que o claude.ai lê para pré-preencher o campo.
 *
 * NO APLICATIVO, O PROJETO CUSTA A PERGUNTA — e isto está no código do próprio
 * Claude Desktop, não é suposição. O tratador de `claude://` tem um ramo por
 * rota: o de `/new` repassa o `q`, o de `/project/…` chama um copiador que só
 * conhece os parâmetros de retorno de OAuth (`oauth_error`, `gdrive_success` e
 * afins) e DESCARTA todo o resto. Abrir o projeto no app, portanto, abre uma
 * conversa dentro dele com o campo vazio — e sem a pergunta não há código, sem
 * código não há autos, e a análise não começa.
 *
 * ENTÃO A PERGUNTA GANHA: com `PROJETO_CLAUDE` preenchido, o aplicativo continua
 * indo para `/new`. No NAVEGADOR o projeto é honrado, porque lá a página lê o
 * `?q=` em qualquer rota.
 *
 * SÓ claude.ai. A URL do projeto é digitada por uma pessoa, e uma linha trocada
 * por descuido faria este botão abrir um site qualquer levando o nome do cedente
 * na query.
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
  // No app, `/project/…` engoliria o `?q=`: fica em `/new`.
  if (base && !noApp) {
    try {
      const u = new URL(base)
      if (u.hostname.endsWith('claude.ai')) caminho = u.pathname + u.search
    } catch {
      caminho = '/new'
    }
  }
  const separador = caminho.includes('?') ? '&' : '?'
  const prefixo = noApp ? 'claude://claude.ai' : 'https://claude.ai'
  return `${prefixo}${caminho}${separador}q=${q}`
}
