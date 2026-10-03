// O acabamento global do redesenho: o Ctrl+K com janela aberta (avisa só se ela
// estiver alterada), o "Descartar alterações?" da ficha lateral e os termos do
// glossário no texto.
import { describe, it, expect } from 'vitest'
import { AVISO_DA_BUSCA_COM_JANELA_ALTERADA, decidirAtalho } from '../atalhos'
import {
  estadoDasJanelas,
  fecharJanelasAbertas,
  janelasAbertas,
  registrarJanelaAberta,
} from '../janelasAbertas'
import {
  perguntaDeDescarteAberta,
  perguntarDescarte,
  registrarJanelaDeDescarte,
  responderDescarte,
  textoDoDescarte,
  type LugarDoDescarte,
} from '../descarte'
import { termosNoTexto, type TermoDoGlossario } from '../termosNoTexto'
import { GLOSSARIO } from '../ajudaDaPlataforma'

describe('Ctrl+K com janela aberta', () => {
  const botao = { tagName: 'BUTTON' }
  it('janela alterada: avisa; sem alteração: a busca toma o lugar dela', () => {
    expect(decidirAtalho('busca', botao, true, true)).toBe('avisar')
    expect(decidirAtalho('busca', botao, true, false)).toBe('substituir')
    expect(decidirAtalho('busca', botao, false, false)).toBe('agir')
    // Digitando NUM CAMPO DA JANELA vale a mesma regra.
    expect(decidirAtalho('busca', { tagName: 'INPUT' }, true, false)).toBe('substituir')
    expect(decidirAtalho('busca', { tagName: 'TEXTAREA' }, true, true)).toBe('avisar')
  })
  it('o filtro e os atalhos não mudam com a alteração da janela', () => {
    expect(decidirAtalho('filtro', botao, true, false)).toBe('ignorar')
    expect(decidirAtalho('atalhos', botao, true, false)).toBe('agir')
  })
  it('o aviso é o da amostra', () => {
    expect(AVISO_DA_BUSCA_COM_JANELA_ALTERADA).toBe(
      'Salve ou feche a janela aberta antes de buscar — o que foi digitado nela ainda não foi salvo.',
    )
  })
})

describe('estado das janelas abertas', () => {
  it('nenhuma, livre ou alterada', () => {
    expect(estadoDasJanelas([], false)).toBe('nenhuma')
    expect(estadoDasJanelas([{ alterada: false }], true)).toBe('livre')
    expect(estadoDasJanelas([{ alterada: false }, { alterada: true }], true)).toBe('alterada')
  })
  it('uma pergunta "Descartar alterações?" na tela conta como alteração', () => {
    expect(estadoDasJanelas([{ alterada: false }], true, true)).toBe('alterada')
  })
  it('diálogo na pilha que não se registrou: na dúvida, avisa', () => {
    expect(estadoDasJanelas([], true)).toBe('alterada')
  })
  it('o registro lê o estado de AGORA e fecha da de cima para a mais antiga', () => {
    const fechadas: string[] = []
    let sujo = false
    const sairA = registrarJanelaAberta(() => ({ alterada: false, fechar: () => fechadas.push('a') }))
    const sairB = registrarJanelaAberta(() => ({ alterada: sujo, fechar: () => fechadas.push('b') }))
    expect(estadoDasJanelas(janelasAbertas(), true)).toBe('livre')
    sujo = true
    expect(estadoDasJanelas(janelasAbertas(), true)).toBe('alterada')
    fecharJanelasAbertas()
    expect(fechadas).toEqual(['b', 'a'])
    sairA()
    sairB()
    expect(janelasAbertas()).toEqual([])
  })
})

describe('"Descartar alterações?" na ficha lateral', () => {
  it('o texto muda só a palavra do lugar; o padrão continua o da janela', () => {
    expect(textoDoDescarte()).toBe(
      'O que foi digitado nesta janela ainda não foi salvo. Fechando agora, se perde.',
    )
    expect(textoDoDescarte('ficha')).toBe(
      'O que foi digitado nesta ficha ainda não foi salvo. Fechando agora, se perde.',
    )
  })
  it('a janela recebe o lugar de quem perguntou, e a pergunta aberta é visível', async () => {
    const recebidos: [boolean, LugarDoDescarte][] = []
    const sair = registrarJanelaDeDescarte((aberta, lugar) => recebidos.push([aberta, lugar]))
    expect(perguntaDeDescarteAberta()).toBe(false)
    const p = perguntarDescarte('ficha')
    expect(perguntaDeDescarteAberta()).toBe(true)
    expect(recebidos[0]).toEqual([true, 'ficha'])
    responderDescarte(false)
    await expect(p).resolves.toBe(false)
    expect(perguntaDeDescarteAberta()).toBe(false)
    const q = perguntarDescarte()
    expect(recebidos[2]).toEqual([true, 'janela'])
    responderDescarte(true)
    await expect(q).resolves.toBe(true)
    sair()
  })
})

describe('termos do glossário no texto', () => {
  const termos = (texto: string, g?: readonly TermoDoGlossario[]) =>
    termosNoTexto(texto, g)
      .filter((p) => p.termo)
      .map((p) => p.texto)
  const junta = (texto: string) =>
    termosNoTexto(texto)
      .map((p) => p.texto)
      .join('')

  it('acha os termos e devolve o texto inteiro, como estava', () => {
    const t = 'Sanado, o card volta para a Revisão; a diligência some do Kommo.'
    expect(termos(t)).toEqual(['diligência', 'Kommo'])
    expect(junta(t)).toBe(t)
  })
  it('não casa dentro de outra palavra (acentos contam como letra)', () => {
    expect(termos('Vamos TIRAR a dúvida')).toEqual([])
    expect(termos('O juiz vai sanará-la')).toEqual([])
    expect(termos('Os Cedentes assinaram')).toEqual([])
    expect(termos('A TIR ficou em 22%')).toEqual(['TIR'])
  })
  it('caixa tanto faz, e o texto sai com a caixa original', () => {
    const [p] = termosNoTexto('rpv expedida').filter((x) => x.termo)
    expect(p.texto).toBe('rpv')
    expect(p.termo?.termo).toBe('RPV')
  })
  it('só a primeira ocorrência de cada termo', () => {
    expect(termos('RPV, depois outra RPV')).toEqual(['RPV'])
  })
  it('o termo mais longo ganha, e nada casa dentro de um termo já marcado', () => {
    expect(termos('O valor de face do crédito')).toEqual(['valor de face'])
    const g = [
      { termo: 'Portão', definicao: 'x' },
      { termo: 'Portão 1', definicao: 'y' },
    ]
    expect(termos('Passou no Portão 1 e depois no portão', g)).toEqual(['Portão 1', 'portão'])
  })
  it('caracteres especiais do termo são literais; texto vazio não tem pedaço', () => {
    expect(termos('a + b', [{ termo: '+', definicao: 'soma' }])).toEqual(['+'])
    expect(termosNoTexto('')).toEqual([])
  })
  it('todo termo do glossário da plataforma se acha sozinho', () => {
    for (const g of GLOSSARIO) expect(termos(`ver ${g.termo}.`), g.termo).toEqual([g.termo])
  })
})
