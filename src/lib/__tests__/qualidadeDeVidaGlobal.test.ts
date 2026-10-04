// A revisão de qualidade de vida do que é global (03/10/2026): copiar, a data
// relativa, os avisos que ficam, a versão nova, o "G e a letra", as escolhas
// lembradas, os recentes da busca, a conversa copiada e o que não está salvo nas
// Configurações.
import { describe, it, expect } from 'vitest'
import { copiarTexto } from '../copiar'
import { formatarRelativo } from '../format'
import { detalhesDoErro, duracaoDepoisDoMouse, duracaoDoAviso, juntarAviso, MAX_AVISOS } from '../avisos'
import { deveConferir, entradaDoHtml, haVersaoNova, INTERVALO_MINIMO_MS, nomeDoArquivo } from '../versaoNova'
import {
  decidirAtalho,
  destinoDaSequencia,
  ESPERA_DO_PREFIXO_MS,
  LISTA_DE_ATALHOS,
  NAVEGACAO_POR_LETRA,
  qualAtalho,
} from '../atalhos'
import { lerPreferenciaValida, umaDas, type Armazenamento } from '../preferencias'
import {
  chaveDosRecentes,
  ehListaDeRecentes,
  enderecoDoResultado,
  lembrarRecente,
  MAX_RECENTES,
  montarResultados,
  type ResultadoDaBusca,
} from '../buscaGeral'
import { chaveDoRascunho, textoDaConversa } from '../conversaDoAssistente'
import { IDS_DAS_SECOES, SECAO_INICIAL, textoDasPendencias } from '../menuDasConfiguracoes'
import { ITENS_DO_MENU, NAV_CONFIG } from '@/components/layout/navigation'

const tecla = (key: string, mod: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mod,
})

describe('copiar', () => {
  it('a área de transferência moderna primeiro', async () => {
    const copiados: string[] = []
    const ok = await copiarTexto('0001234-56.2026.8.09.0001', {
      clipboard: { writeText: async (t) => void copiados.push(t) },
      copiarAntigo: () => {
        throw new Error('não devia chegar aqui')
      },
    })
    expect(ok).toBe(true)
    expect(copiados).toEqual(['0001234-56.2026.8.09.0001'])
  })
  it('recusada, cai no jeito antigo; os dois falhando, diz que não copiou (sem lançar)', async () => {
    const recusa = { writeText: async () => Promise.reject(new Error('NotAllowedError')) }
    expect(await copiarTexto('x', { clipboard: recusa, copiarAntigo: () => true })).toBe(true)
    expect(await copiarTexto('x', { clipboard: recusa, copiarAntigo: () => false })).toBe(false)
    expect(
      await copiarTexto('x', {
        clipboard: null,
        copiarAntigo: () => {
          throw new Error('sem documento')
        },
      }),
    ).toBe(false)
  })
  it('texto vazio não copia nada', async () => {
    expect(await copiarTexto('', { clipboard: { writeText: async () => {} } })).toBe(false)
  })
})

describe('formatarRelativo', () => {
  const agora = new Date('2026-10-03T15:00:00')
  it('minutos e horas no mesmo dia', () => {
    expect(formatarRelativo('2026-10-03T14:59:40', agora)).toBe('agora há pouco')
    expect(formatarRelativo('2026-10-03T14:55:00', agora)).toBe('há 5 min')
    expect(formatarRelativo('2026-10-03T12:10:00', agora)).toBe('há 2 h')
  })
  it('de ontem para trás, o dia civil de tempoDecorrido', () => {
    expect(formatarRelativo('2026-10-02T23:30:00', new Date('2026-10-03T01:00:00'))).toBe('ontem')
    expect(formatarRelativo('2026-09-30T10:00:00', agora)).toBe('há 3 dias')
  })
  it('aceita milissegundos e Date', () => {
    expect(formatarRelativo(agora.getTime() - 10 * 60_000, agora)).toBe('há 10 min')
    expect(formatarRelativo(new Date(agora.getTime() - 3 * 3_600_000), agora)).toBe('há 3 h')
  })
  it('relógio um pouco adiantado vale "agora há pouco"; futuro de verdade e lixo voltam vazios', () => {
    expect(formatarRelativo(agora.getTime() + 60_000, agora)).toBe('agora há pouco')
    expect(formatarRelativo('2026-10-04T15:00:00', agora)).toBe('')
    expect(formatarRelativo('não é data', agora)).toBe('')
    expect(formatarRelativo(null, agora)).toBe('')
  })
})

describe('avisos flutuantes', () => {
  it('o erro fica até ser fechado; os outros somem', () => {
    expect(duracaoDoAviso('error', false)).toBeNull()
    expect(duracaoDoAviso('error', true)).toBeNull()
    expect(duracaoDoAviso('success', false)).toBe(4500)
    expect(duracaoDoAviso('info', true)).toBe(7000)
    expect(duracaoDepoisDoMouse('error')).toBeNull()
    expect(duracaoDepoisDoMouse('success')).toBe(2000)
  })
  it('o mesmo aviso não se empilha', () => {
    const a: { id: number; type: 'error' | 'info'; message: string } = { id: 1, type: 'error', message: 'Falhou.' }
    const { pilha, repetido } = juntarAviso([a], { id: 2, type: 'error', message: 'Falhou.' })
    expect(pilha).toEqual([a])
    expect(repetido).toBe(a)
    // Mesmo texto, outro tipo: é outro aviso.
    expect(juntarAviso([a], { id: 3, type: 'info', message: 'Falhou.' }).pilha).toHaveLength(2)
  })
  it(`passando de ${MAX_AVISOS}, sai o mais antigo que não é erro`, () => {
    // MUDADO DE PROPÓSITO (auditoria visual de 03/10/2026, C10): a pilha passou
    // de 4 para 2 avisos. A regra de quem sai é a mesma; a conta, a da pilha nova.
    expect(MAX_AVISOS).toBe(2)
    const pilha = [
      { id: 1, type: 'error' as const, message: 'e1' },
      { id: 2, type: 'success' as const, message: 's1' },
    ]
    const r = juntarAviso(pilha, { id: 3, type: 'success', message: 's2' })
    expect(r.pilha.map((t) => t.id)).toEqual([1, 3])
    // Com outro limite, a mesma regra (o de antes, 4).
    const quatro = [...pilha, { id: 3, type: 'error' as const, message: 'e2' }, { id: 4, type: 'info' as const, message: 'i1' }]
    expect(juntarAviso(quatro, { id: 5, type: 'success', message: 's2' }, 4).pilha.map((t) => t.id)).toEqual([1, 3, 4, 5])
    // Só erros: sai o erro mais antigo, nunca o que acabou de chegar.
    const erros = [1, 2].map((id) => ({ id, type: 'error' as const, message: `e${id}` }))
    expect(juntarAviso(erros, { id: 3, type: 'error', message: 'e3' }).pilha.map((t) => t.id)).toEqual([2, 3])
  })
  it('os detalhes do erro dizem onde, quando e em que versão — sem dado da sessão', () => {
    const t = detalhesDoErro({
      mensagem: ' Não foi possível gravar. ',
      quando: new Date('2026-10-03T14:05:09'),
      tela: '/operacional/execucao/tarefas',
      versao: 'index-ab12.js',
      navegador: 'Mozilla/5.0',
    })
    expect(t).toBe(
      [
        'Não foi possível gravar.',
        '',
        'Tela: /operacional/execucao/tarefas',
        'Quando: 03/10/2026 às 14:05:09',
        'Versão: index-ab12.js',
        'Navegador: Mozilla/5.0',
      ].join('\n'),
    )
    expect(detalhesDoErro({ mensagem: 'x', quando: new Date(), tela: '', versao: null, navegador: '' })).toMatch(
      /Tela: \/\nQuando: .*\nVersão: não identificada\nNavegador: não identificado$/,
    )
  })
})

describe('aviso de versão nova', () => {
  const html = (src: string) =>
    `<!doctype html><html><head><script>(function(){})()</script>` +
    `<script type="module" crossorigin src="${src}"></script>` +
    `<link rel="modulepreload" crossorigin href="./assets/react-1.js"></head></html>`
  it('lê o arquivo de entrada do index.html publicado', () => {
    expect(entradaDoHtml(html('./assets/index-3fA9c1.js'))).toBe('index-3fA9c1.js')
    // A ordem dos atributos não importa.
    expect(entradaDoHtml('<script src="/a/index-x.js?v=1" type="module"></script>')).toBe('index-x.js')
    // Sem script de módulo (página de erro do servidor): não se sabe.
    expect(entradaDoHtml('<html><body>404</body></html>')).toBeNull()
    expect(entradaDoHtml('<script src="./velho.js"></script>')).toBeNull()
  })
  it('só é versão nova quando as duas entradas são conhecidas e diferem', () => {
    expect(haVersaoNova('index-a.js', 'index-b.js')).toBe(true)
    expect(haVersaoNova('index-a.js', 'index-a.js')).toBe(false)
    expect(haVersaoNova('index-a.js', null)).toBe(false)
    expect(haVersaoNova(null, 'index-b.js')).toBe(false)
  })
  it('o nome do arquivo, sem pasta nem busca', () => {
    expect(nomeDoArquivo('./assets/index-ab.js?x=1#y')).toBe('index-ab.js')
    expect(nomeDoArquivo('index.js')).toBe('index.js')
  })
  it('não confere com a aba escondida nem logo depois da última vez', () => {
    expect(deveConferir(1000, null, true)).toBe(true)
    expect(deveConferir(1000, null, false)).toBe(false)
    expect(deveConferir(1000 + INTERVALO_MINIMO_MS - 1, 1000, true)).toBe(false)
    expect(deveConferir(1000 + INTERVALO_MINIMO_MS, 1000, true)).toBe(true)
    // Relógio que voltou: confere.
    expect(deveConferir(500, 1000, true)).toBe(true)
  })
})

describe('"G" e depois a letra', () => {
  it('o "g" minúsculo, sem modificador, abre a sequência', () => {
    expect(qualAtalho(tecla('g'))).toBe('navegar')
    expect(qualAtalho(tecla('G'))).toBeNull()
    expect(qualAtalho(tecla('g', { ctrlKey: true }))).toBeNull()
  })
  it('as mesmas regras do "/": digitando ou com janela aberta, não navega', () => {
    expect(decidirAtalho('navegar', { tagName: 'INPUT' }, false)).toBe('ignorar')
    expect(decidirAtalho('navegar', { isContentEditable: true }, false)).toBe('ignorar')
    expect(decidirAtalho('navegar', { tagName: 'BODY' }, true)).toBe('ignorar')
    expect(decidirAtalho('navegar', { tagName: 'BODY' }, false)).toBe('agir')
  })
  it('a letra tem de vir a tempo, e sem modificador', () => {
    expect(destinoDaSequencia(tecla('t'), 1000, 1000 + ESPERA_DO_PREFIXO_MS)).toBe('/operacional/execucao/tarefas')
    expect(destinoDaSequencia(tecla('t'), 1000, 1001 + ESPERA_DO_PREFIXO_MS)).toBeNull()
    expect(destinoDaSequencia(tecla('t'), null, 1000)).toBeNull()
    expect(destinoDaSequencia(tecla('c', { ctrlKey: true }), 1000, 1100)).toBeNull()
    expect(destinoDaSequencia(tecla('z'), 1000, 1100)).toBeNull()
  })
  it('cada letra leva a um item do menu, sem letra repetida nem Configurações', () => {
    const letras = NAVEGACAO_POR_LETRA.map((n) => n.letra)
    expect(new Set(letras).size).toBe(letras.length)
    const menu = new Map(ITENS_DO_MENU.map((i) => [i.to, i.label]))
    for (const n of NAVEGACAO_POR_LETRA) {
      expect(menu.get(n.to), n.letra).toBe(n.rotulo)
      expect(n.to).not.toBe(NAV_CONFIG.to)
    }
  })
  it('não colide com o J/K da Análise de crédito nem com "/" e "?"', () => {
    for (const k of ['j', 'k', '/', '?']) {
      expect(NAVEGACAO_POR_LETRA.some((n) => n.letra === k), k).toBe(false)
    }
  })
  it('a lista do "?" fala da sequência, do Ctrl+Enter da busca e do J/K', () => {
    const descricoes = LISTA_DE_ATALHOS.map((a) => a.descricao)
    expect(descricoes.some((d) => /Ir para uma tela/.test(d))).toBe(true)
    expect(descricoes.some((d) => /aba nova/.test(d))).toBe(true)
    expect(descricoes).toContain('Andar entre os cards (Análise de crédito)')
    // A descrição é a chave da linha na janela: não pode repetir.
    expect(new Set(descricoes).size).toBe(descricoes.length)
  })
})

describe('escolhas lembradas', () => {
  const guardado = (valores: Record<string, string>): Armazenamento => ({
    getItem: (k) => valores[k] ?? null,
    setItem: () => {},
    removeItem: () => {},
  })
  const aceita = umaDas(['tribunal', 'ente', 'investidor'] as const)
  it('volta o que estava guardado, se ainda é uma das opções', () => {
    const a = guardado({ 'credijuris.quadro.recortes': '"investidor"' })
    expect(lerPreferenciaValida('quadro.recortes', 'tribunal', aceita, a)).toBe('investidor')
  })
  it('opção que não existe mais, lixo ou armazenamento quebrado: o padrão', () => {
    expect(lerPreferenciaValida('quadro.recortes', 'tribunal', aceita, guardado({ 'credijuris.quadro.recortes': '"uf"' }))).toBe('tribunal')
    expect(lerPreferenciaValida('quadro.recortes', 'tribunal', aceita, guardado({ 'credijuris.quadro.recortes': '{' }))).toBe('tribunal')
    const quebrado: Armazenamento = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    expect(lerPreferenciaValida('quadro.recortes', 'tribunal', aceita, quebrado)).toBe('tribunal')
    expect(lerPreferenciaValida('quadro.recortes', 'tribunal', aceita, null)).toBe('tribunal')
  })
  it('a seção das Configurações lembrada é validada contra as seções de hoje', () => {
    expect(IDS_DAS_SECOES).toContain(SECAO_INICIAL)
    expect(IDS_DAS_SECOES).toContain('usuarios')
    const a = guardado({ 'credijuris.configuracoes.secao': '"estrategica"' })
    expect(lerPreferenciaValida('configuracoes.secao', SECAO_INICIAL, umaDas(IDS_DAS_SECOES), a)).toBe(SECAO_INICIAL)
  })
})

describe('recentes da busca geral', () => {
  const card: ResultadoDaBusca = {
    chave: 'card:10',
    tipo: 'card',
    titulo: 'Maria',
    sub: 'RPV · 0001',
    onde: 'Em análise',
    alvo: '10',
  }
  const tela: ResultadoDaBusca = { chave: 'tela:/x', tipo: 'tela', titulo: 'Tarefas', sub: 'Operacional', onde: 'Tela', alvo: '/operacional/execucao/tarefas' }
  it('o escolhido sobe ao topo, sem repetir, até o limite; o selo vira o tipo', () => {
    let r = lembrarRecente([], card)
    expect(r[0].onde).toBe('Card')
    r = lembrarRecente(r, tela)
    r = lembrarRecente(r, card)
    expect(r.map((x) => x.chave)).toEqual(['card:10', 'tela:/x'])
    for (let i = 0; i < 10; i++) r = lembrarRecente(r, { ...tela, chave: `tela:${i}` })
    expect(r).toHaveLength(MAX_RECENTES)
  })
  it('sem nada digitado, os recentes vêm antes das telas, sem repetir tela', () => {
    const telas = [
      { titulo: 'Tarefas', sub: 'Operacional', to: '/x' },
      { titulo: 'Contatos', sub: 'Operacional', to: '/y' },
    ]
    const r = montarResultados({ digitado: '', telas, recentes: [card, tela] })
    expect(r.map((x) => x.chave)).toEqual(['card:10', 'tela:/x', 'tela:/y'])
    expect(r[0].recente).toBe(true)
    expect(r[2].recente).toBeUndefined()
    // Digitando, os recentes não entram.
    expect(montarResultados({ digitado: 'cont', telas, recentes: [card] }).map((x) => x.chave)).toEqual(['tela:/y'])
  })
  it('o guardado é validado; a chave é por pessoa', () => {
    expect(ehListaDeRecentes([card, tela])).toBe(true)
    expect(ehListaDeRecentes([{ ...card, tipo: 'outro' }])).toBe(false)
    expect(ehListaDeRecentes('x')).toBe(false)
    expect(chaveDosRecentes('u1')).toBe('busca.recentes.u1')
    expect(chaveDosRecentes(null)).toBeNull()
  })
  it('só a tela e o card abrem numa aba nova', () => {
    expect(enderecoDoResultado(tela)).toBe('/operacional/execucao/tarefas')
    expect(enderecoDoResultado(card)).toBe('/operacional/analise?card=10')
    expect(enderecoDoResultado({ tipo: 'credito', alvo: 'abc' })).toBeNull()
    expect(enderecoDoResultado({ tipo: 'contato', alvo: 'abc' })).toBeNull()
  })
})

describe('assistente: conversa copiada e rascunho', () => {
  it('quem falou e o que disse; arquivos pelo nome, sem o link que vence', () => {
    expect(
      textoDaConversa([
        { role: 'user', content: 'Quais créditos vencem?' },
        { role: 'assistant', content: '**Dois** créditos.\n', arquivos: [{ nome: 'lista.xlsx' }] },
        { role: 'assistant', content: '  ' },
      ]),
    ).toBe('Você:\nQuais créditos vencem?\n\nAssistente:\n**Dois** créditos.\n(Arquivos: lista.xlsx)')
  })
  it('o rascunho é por pessoa', () => {
    expect(chaveDoRascunho('u1')).toBe('assistente.rascunho.u1')
    expect(chaveDoRascunho(undefined)).toBeNull()
  })
})

describe('Configurações: o que não está salvo', () => {
  it('as seções na ordem do menu, e o lembrete de que cada uma salva sozinha', () => {
    expect(textoDasPendencias(new Set())).toBe('')
    expect(textoDasPendencias(new Set(['kommo']))).toBe('Alteração não salva em Kommo. Salve no botão da seção.')
    expect(textoDasPendencias(new Set(['skills', 'advbox', 'kommo']))).toBe(
      'Alterações não salvas em ADVBOX, Kommo e Skills. Cada seção salva no próprio botão.',
    )
  })
})
