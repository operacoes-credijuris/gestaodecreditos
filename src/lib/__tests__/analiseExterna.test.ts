import { describe, it, expect } from 'vitest'
import { promptDaAnaliseExterna, urlDoClaude } from '../analiseExterna'
import { lerTituloCard } from '../kommo'

/**
 * A CONVERSA QUE ABRE FORA DAQUI.
 *
 * No precatório externo quem decide o preço é o fundo comprador; a casa monta o
 * crédito e conversa sobre ele, no Claude. O que esta tela faz é abrir a
 * conversa já dizendo de que crédito se trata — e o que identifica o negócio
 * está no TÍTULO do card, que é o cadastro que o comercial escreveu.
 */
describe('promptDaAnaliseExterna', () => {
  it('monta a mensagem com o que o título traz', () => {
    const t = lerTituloCard(
      'CBR Ativos - Maria das Dores Silva - 1006377-08.2020.4.01.3814 - Crédito principal - 30%',
    )
    expect(promptDaAnaliseExterna(t)).toBe(
      'executar análise de crédito: Maria das Dores Silva - Crédito principal - 30% de honorários contratuais',
    )
  })

  // ZERO É INFORMAÇÃO: quer dizer cessão sem honorário contratual, e some da
  // mensagem se o teste for por truthy em vez de string vazia.
  it('0% entra na mensagem', () => {
    const t = lerTituloCard('CBR - Fulano - 1006377-08.2020.4.01.3814 - Crédito principal - 0%')
    expect(promptDaAnaliseExterna(t)).toContain('0% de honorários contratuais')
  })

  it('a vírgula do decimal volta na mensagem', () => {
    const t = lerTituloCard('CBR - Fulano - 1006377-08.2020.4.01.3814 - principal - 12,5%')
    expect(promptDaAnaliseExterna(t)).toContain('12,5% de honorários contratuais')
  })

  // CAMPO AUSENTE É OMITIDO, nunca preenchido com "não informado": a mensagem é
  // o começo de uma conversa, e uma lacuna anunciada convida o modelo a suprir o
  // que falta em vez de perguntar.
  it('sem percentual, a mensagem não fala de honorários', () => {
    const t = lerTituloCard('CBR - Fulano - 1006377-08.2020.4.01.3814 - Crédito principal')
    expect(promptDaAnaliseExterna(t)).toBe(
      'executar análise de crédito: Fulano - Crédito principal',
    )
  })

  it('título sem nada além do nome ainda abre a conversa', () => {
    expect(promptDaAnaliseExterna({ cedente: 'Fulano', parcelaCedida: '', honorariosPct: '' }))
      .toBe('executar análise de crédito: Fulano')
    expect(promptDaAnaliseExterna({ cedente: '', parcelaCedida: '', honorariosPct: '' }))
      .toBe('executar análise de crédito: ')
  })
})

describe('urlDoClaude', () => {
  // ABRE O APLICATIVO, e não o navegador: o Claude Desktop registra o esquema
  // "claude://" e as rotas dele espelham as da web — o próprio app usa
  // "claude://claude.ai/new?surface=chat" no atalho da barra de tarefas.
  it('sem projeto, abre conversa nova no aplicativo', () => {
    expect(urlDoClaude('teste de análise')).toBe(
      'claude://claude.ai/new?q=teste%20de%20an%C3%A1lise',
    )
  })

  /**
   * NO APLICATIVO, O PROJETO CUSTARIA A PERGUNTA.
   *
   * Está no código do próprio Claude Desktop: o tratador de `claude://` tem um
   * ramo por rota, e enquanto o de `/new` repassa o `q`, o de `/project/…` chama
   * um copiador que só conhece os parâmetros de retorno de OAuth e descarta todo
   * o resto. Abrir o projeto pelo app abriria uma conversa de campo vazio — e
   * sem a pergunta não há código, sem código não há autos.
   */
  it('no aplicativo, o projeto cede lugar à pergunta', () => {
    expect(urlDoClaude('oi', 'https://claude.ai/project/abc-123')).toBe(
      'claude://claude.ai/new?q=oi',
    )
  })

  // NO NAVEGADOR O PROJETO VALE, porque ali a página lê o `?q=` em qualquer rota.
  it('no navegador, a conversa nasce dentro do projeto', () => {
    expect(urlDoClaude('oi', 'https://claude.ai/project/abc-123', false)).toBe(
      'https://claude.ai/project/abc-123?q=oi',
    )
  })

  it('projeto que já tem query recebe a pergunta com &', () => {
    expect(urlDoClaude('oi', 'https://claude.ai/project/abc?x=1', false)).toBe(
      'https://claude.ai/project/abc?x=1&q=oi',
    )
  })

  // A SAÍDA PARA MÁQUINA SEM O APP: ali o esquema não tem quem o atenda e o
  // clique não faz nada visível.
  it('pedindo o navegador, sai https', () => {
    expect(urlDoClaude('oi', '', false)).toBe('https://claude.ai/new?q=oi')
  })

  // A URL DO PROJETO É DIGITADA POR UMA PESSOA. Uma linha trocada por descuido
  // faria este botão abrir um site qualquer levando o nome do cedente na query.
  it('endereço que não é do claude.ai é ignorado', () => {
    for (const ruim of [
      'https://claude.ai.exemplo.com/projeto',
      'http://exemplo.com/x',
      'javascript:alert(1)',
      'nem url',
    ]) {
      expect(urlDoClaude('oi', ruim, false), ruim).toBe('https://claude.ai/new?q=oi')
    }
  })

  // SUBDOMÍNIO PASSA, MAS NORMALIZADO: o que se aproveita da URL digitada é o
  // CAMINHO; o host sai sempre daqui. Um "www." a mais não muda o destino, e
  // nenhum host de fora entra por essa porta.
  it('subdomínio do claude.ai é aceito, e o endereço sai normalizado', () => {
    expect(urlDoClaude('oi', 'https://www.claude.ai/project/abc', false)).toBe(
      'https://claude.ai/project/abc?q=oi',
    )
  })
})

describe('o código dos autos', () => {
  /**
   * OS AUTOS NÃO VÃO NA MENSAGEM: SÃO BUSCADOS.
   *
   * Nenhuma das quatro vias de anexar de verdade alcança um site que chama o app
   * de fora — URL não carrega conteúdo, o clipboard só aceita texto/HTML/PNG, o
   * app não declara alvo de compartilhamento, e a API interna de anexar fala com
   * `window.parent`. Pôr o link público do Kommo na pergunta também não
   * funcionou: o modelo não busca o PDF.
   *
   * O que vai é um CÓDIGO. A plataforma deposita o texto dos autos num balcão
   * sob ele, e o aplicativo o troca pelos autos no conector.
   */
  const dados = { cedente: 'Fulano', parcelaCedida: 'Crédito principal', honorariosPct: '30' }
  const codigo = '3f2a1c9e-4b7d-4a10-9c22-8de5f0a1b2c3'

  it('sem código, a pergunta é só a linha do crédito', () => {
    expect(promptDaAnaliseExterna(dados)).toBe(
      'executar análise de crédito: Fulano - Crédito principal - 30% de honorários contratuais',
    )
    expect(promptDaAnaliseExterna(dados, '   ')).toBe(promptDaAnaliseExterna(dados))
  })

  // A INSTRUÇÃO VEM JUNTO E NOMEIA A FERRAMENTA: um código solto não diz a
  // ninguém o que fazer com ele.
  it('com código, a pergunta manda ler os autos pelo conector', () => {
    const p = promptDaAnaliseExterna(dados, codigo)
    expect(p).toContain('executar análise de crédito: Fulano')
    expect(p).toContain('autos_do_credito')
    expect(p).toContain(codigo)
    expect(p).toMatch(/antes de responder/i)
  })

  // O CÓDIGO ATRAVESSA A URL INTEIRO: é ele que abre o balcão, e um caractere
  // perdido na codificação deixaria a conversa sem os autos.
  it('o código chega inteiro na URL do aplicativo', () => {
    const url = urlDoClaude(promptDaAnaliseExterna(dados, codigo))
    expect(url.startsWith('claude://claude.ai/new?q=')).toBe(true)
    expect(decodeURIComponent(url.slice('claude://claude.ai/new?q='.length))).toContain(codigo)
  })
})
