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
  it('sem projeto, abre conversa nova com a pergunta pronta', () => {
    expect(urlDoClaude('teste de análise')).toBe(
      'https://claude.ai/new?q=teste%20de%20an%C3%A1lise',
    )
  })

  it('com projeto, a pergunta vai anexada à URL dele', () => {
    const u = urlDoClaude('oi', 'https://claude.ai/project/abc-123')
    expect(u).toBe('https://claude.ai/project/abc-123?q=oi')
  })

  it('projeto que já tem query recebe a pergunta com &', () => {
    expect(urlDoClaude('oi', 'https://claude.ai/project/abc?x=1')).toBe(
      'https://claude.ai/project/abc?x=1&q=oi',
    )
  })

  // A URL DO PROJETO É DIGITADA POR UMA PESSOA. Uma linha trocada por descuido
  // faria este botão abrir um site qualquer levando o nome do cedente na query.
  it('endereço que não é do claude.ai é ignorado', () => {
    for (const ruim of [
      'https://claude.ai.exemplo.com/projeto',
      'http://exemplo.com',
      'javascript:alert(1)',
      'nem url',
    ]) {
      expect(urlDoClaude('oi', ruim), ruim).toBe('https://claude.ai/new?q=oi')
    }
  })

  it('subdomínio do claude.ai é aceito', () => {
    expect(urlDoClaude('oi', 'https://www.claude.ai/project/abc')).toBe(
      'https://www.claude.ai/project/abc?q=oi',
    )
  })
})
