#!/usr/bin/env node
// A PONTE entre o aplicativo do Claude e o conector dos autos.
//
// POR QUE ELA EXISTE. O conector mora numa Edge Function e fala MCP por HTTP
// (`supabase/functions/mcp-autos`). O aplicativo do Claude sabe conversar com
// servidor remoto — mas só pela tela de Conectores. Pelo arquivo de
// configuração (`claude_desktop_config.json`), o schema de cada entrada aceita
// exatamente `{ command, args, env, extensionId }`: é stdio e nada mais, sem
// `url` e sem `type`. Verificado no pacote instalado, não suposto.
//
// ENTÃO A PONTE É O TRADUTOR: o aplicativo fala com ela por stdio, ela fala com
// a Edge Function por HTTPS. Nada mais. Não há sessão para guardar nem estado
// para reconciliar, porque o conector do outro lado é sem estado — cada pedido
// é uma requisição inteira e a resposta volta na mesma.
//
// ESCRITA AQUI EM VEZ DE INSTALADA DO NPM de propósito. Existe pacote pronto
// para isto (`mcp-remote`), e usá-lo significaria baixar e executar código de
// terceiro na máquina de quem opera, toda vez que o aplicativo abre, para fazer
// as trinta linhas abaixo. O que passa por este cano são autos de processo.
//
// USO: node scripts/mcp-ponte-autos.cjs [url]
//   Sem argumento, usa a URL de produção. `MCP_AUTOS_URL` no ambiente também vale.

const ALVO =
  process.argv[2] ||
  process.env.MCP_AUTOS_URL ||
  'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/mcp-autos'

// O LOG VAI PARA stderr, SEMPRE. O stdout é o canal do protocolo: uma linha
// solta ali quebra o enquadramento e o aplicativo desconecta o servidor.
const log = (...a) => process.stderr.write('[ponte-autos] ' + a.join(' ') + '\n')

/**
 * Uma mensagem, ida e volta.
 *
 * NOTIFICAÇÃO NÃO TEM RESPOSTA: quando o pedido não traz `id`, o servidor
 * devolve 202 sem corpo e nada deve sair no stdout — responder a uma
 * notificação é erro de protocolo, e alguns clientes desligam por causa disso.
 */
async function repassar(pedido) {
  const res = await fetch(ALVO, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(pedido),
  })
  if (res.status === 202) return null
  const texto = await res.text()
  if (!texto) return null
  return texto
}

// O ENQUADRAMENTO É POR LINHA (newline-delimited JSON), que é como o transporte
// stdio do MCP funciona. O buffer existe porque uma mensagem grande chega
// picada: só o que vem antes de um "\n" está inteiro.
let buffer = ''

// NÃO HÁ SAÍDA FORÇADA AQUI, E É DE PROPÓSITO.
//
// A tentação é fechar o processo quando o stdin acaba. Duas coisas quebram com
// isso: o pedido que ainda não voltou perde a resposta — e a busca dos autos
// espera até 45 segundos pelo depósito, que é o pedido mais demorado que passa
// por este cano —, e a escrita que ainda está saindo pelo stdout morre no meio,
// o que no Windows derruba o processo com "UV_HANDLE_CLOSING".
//
// Sem `process.exit`, o Node faz sozinho o que se queria: enquanto houver
// requisição no ar ele fica de pé, e quando a última voltar e o stdout esvaziar
// não sobra nada no laço de eventos e o processo termina limpo.

process.stdin.setEncoding('utf8')
process.stdin.on('data', (pedaco) => {
  buffer += pedaco
  let corte
  while ((corte = buffer.indexOf('\n')) >= 0) {
    const linha = buffer.slice(0, corte).trim()
    buffer = buffer.slice(corte + 1)
    if (linha) atender(linha)
  }
})

async function atender(linha) {
  let pedido
  try {
    pedido = JSON.parse(linha)
  } catch {
    log('linha ilegível descartada')
    return
  }
  try {
    const resposta = await repassar(pedido)
    if (resposta !== null) process.stdout.write(resposta + '\n')
  } catch (e) {
    log('falhou: ' + (e && e.message ? e.message : e))
    // A REDE CAIU, MAS O PEDIDO EXISTE: sem uma resposta o cliente fica
    // esperando para sempre. Um erro de JSON-RPC devolve o controle a ele.
    const id = pedido && pedido.id
    if (id !== undefined && id !== null) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: 'Não consegui falar com o conector: ' + (e && e.message ? e.message : e) },
        }) + '\n',
      )
    }
  }
}
log('ligada a ' + ALVO)
