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

  it('com projeto, a conversa nasce dentro dele', () => {
    expect(urlDoClaude('oi', 'https://claude.ai/project/abc-123')).toBe(
      'claude://claude.ai/project/abc-123?q=oi',
    )
  })

  it('projeto que já tem query recebe a pergunta com &', () => {
    expect(urlDoClaude('oi', 'https://claude.ai/project/abc?x=1')).toBe(
      'claude://claude.ai/project/abc?x=1&q=oi',
    )
  })

  // A SAÍDA PARA MÁQUINA SEM O APP: ali o esquema não tem quem o atenda e o
  // clique não faz nada visível.
  it('pedindo o navegador, sai https', () => {
    expect(urlDoClaude('oi', '', false)).toBe('https://claude.ai/new?q=oi')
    expect(urlDoClaude('oi', 'https://claude.ai/project/abc', false)).toBe(
      'https://claude.ai/project/abc?q=oi',
    )
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
      expect(urlDoClaude('oi', ruim), ruim).toBe('claude://claude.ai/new?q=oi')
    }
  })

  it('subdomínio do claude.ai é aceito', () => {
    expect(urlDoClaude('oi', 'https://www.claude.ai/project/abc')).toBe(
      'claude://claude.ai/project/abc?q=oi',
    )
  })
})

describe('os anexos na pergunta', () => {
  /**
   * ENDEREÇO, E NÃO ARQUIVO. Nenhuma das quatro vias de anexar de verdade
   * alcança um site que chama o app de fora: URL não carrega conteúdo, o
   * clipboard só aceita texto/HTML/PNG, o app não declara alvo de
   * compartilhamento, e a API interna de anexar fala com `window.parent` — é
   * para página que roda DENTRO da conversa.
   *
   * O link contorna todas: o download do Kommo é público, e quem busca é o
   * Claude.
   */
  const dados = { cedente: 'Fulano', parcelaCedida: 'Crédito principal', honorariosPct: '30' }

  it('sem anexo, a pergunta é só a linha do crédito', () => {
    expect(promptDaAnaliseExterna(dados, [])).toBe(
      'executar análise de crédito: Fulano - Crédito principal - 30% de honorários contratuais',
    )
  })

  it('com anexos, a pergunta manda abrir cada um', () => {
    const p = promptDaAnaliseExterna(dados, [
      { nome: 'processo.pdf', download: 'https://drive.kommo.com/a.pdf' },
      { nome: 'calculo.pdf', download: 'https://drive.kommo.com/b.pdf' },
    ])
    expect(p).toContain('executar análise de crédito: Fulano')
    expect(p).toMatch(/Baixe e leia cada um antes de responder/)
    expect(p).toContain('- processo.pdf: https://drive.kommo.com/a.pdf')
    expect(p).toContain('- calculo.pdf: https://drive.kommo.com/b.pdf')
  })

  it('anexo sem link não entra na lista', () => {
    const p = promptDaAnaliseExterna(dados, [
      { nome: 'sem-link.pdf', download: '' },
      { nome: 'bom.pdf', download: 'https://drive.kommo.com/b.pdf' },
    ])
    expect(p).not.toContain('sem-link.pdf')
    expect(p).toContain('bom.pdf')
  })

  it('só anexos sem link é o mesmo que nenhum anexo', () => {
    expect(promptDaAnaliseExterna(dados, [{ nome: 'x.pdf', download: '' }])).toBe(
      promptDaAnaliseExterna(dados, []),
    )
  })
})
