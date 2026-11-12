// A tela do assistente (revisão de 12/11/2026): a lógica pura que o componente
// usa — lib/telaDoAssistente.ts. Cada bloco falharia antes da correção: ou a
// função não existia, ou o componente fazia a conta do jeito que quebrava.

import { describe, it, expect } from 'vitest'
import {
  anexoPrecisaDeSkill,
  comAcaoResolvida,
  comPergunta,
  comResposta,
  contarSkills,
  enterEnvia,
  historicoParaOModelo,
  normalizarMensagem,
  novoIdDeConversa,
  pendenciasReducer,
  proximaOpcao,
  skillsDoPedido,
  tituloDaConversa,
  type Mensagem,
  type Pendencias,
} from '../telaDoAssistente'
import { destinoDaResposta, textoDaConversa } from '../conversaDoAssistente'

const pergunta = (content: string, extra: Partial<Mensagem> = {}): Mensagem => ({ role: 'user', content, ...extra })
const resposta = (content: string, extra: Partial<Mensagem> = {}): Mensagem => ({ role: 'assistant', content, ...extra })

describe('a resposta que chega com outra conversa aberta (defeito 1)', () => {
  it('voltar à conversa de origem conta como a mesma conversa', () => {
    // Antes era uma marca de troca: A → B → A dava marca diferente, e a resposta
    // não entrava na tela de A, reaberta.
    expect(destinoDaResposta('A', 'A').naTela).toBe(true)
    expect(destinoDaResposta('A', 'B')).toEqual({ naTela: false, gravarEm: 'A' })
  })

  it('a resposta entra depois da pergunta pendente, sem duplicá-la', () => {
    const a = [pergunta('p1'), resposta('r1'), pergunta('p2')]
    expect(comResposta(a, pergunta('p2'), resposta('r2')).map((m) => m.content)).toEqual([
      'p1',
      'r1',
      'p2',
      'r2',
    ])
  })

  it('relida do banco SEM a pergunta (a gravação dela falhou), a pergunta entra antes da resposta', () => {
    const doBanco = [pergunta('p1'), resposta('r1')]
    expect(comResposta(doBanco, pergunta('p2'), resposta('r2')).map((m) => m.content)).toEqual([
      'p1',
      'r1',
      'p2',
      'r2',
    ])
  })

  it('a pergunta seguinte é ACRESCENTADA ao que o banco tem, não grava a tela por cima', () => {
    // O cenário do defeito: a tela de A não tinha p2/r2, o banco tinha.
    const doBanco = [pergunta('p1'), resposta('r1'), pergunta('p2'), resposta('r2')]
    expect(comPergunta(doBanco, pergunta('p3')).map((m) => m.content)).toEqual(['p1', 'r1', 'p2', 'r2', 'p3'])
  })

  it('cada conversa nova nasce com id próprio (dois "Nova" seguidos não se confundem)', () => {
    const a = novoIdDeConversa()
    const b = novoIdDeConversa()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})

describe('o pedido em curso é de uma conversa (defeito 1)', () => {
  type P = { pergunta: string }
  const r = (e: Pendencias<P>, a: Parameters<typeof pendenciasReducer<P>>[1]) => pendenciasReducer<P>(e, a)

  it('perguntar em A não deixa B carregando', () => {
    const e = r({}, { tipo: 'enviou', conversa: 'A', pedido: { pergunta: 'x' } })
    expect(e.A?.estado).toBe('enviando')
    expect(e.B).toBeUndefined()
  })

  it('o erro de A fica guardado em A até a pessoa voltar (e guarda o pedido para o Tentar de novo)', () => {
    let e = r({}, { tipo: 'enviou', conversa: 'A', pedido: { pergunta: 'x' } })
    e = r(e, { tipo: 'enviou', conversa: 'B', pedido: { pergunta: 'y' } })
    e = r(e, { tipo: 'falhou', conversa: 'A', erro: 'HTTP 503' })
    expect(e.A).toEqual({ estado: 'erro', pedido: { pergunta: 'x' }, erro: 'HTTP 503' })
    expect(e.B?.estado).toBe('enviando')
    // Tentar de novo: volta a enviar, com o mesmo pedido.
    e = r(e, { tipo: 'enviou', conversa: 'A', pedido: (e.A as { pedido: P }).pedido })
    expect(e.A?.estado).toBe('enviando')
    e = r(e, { tipo: 'respondeu', conversa: 'A' })
    expect(e.A).toBeUndefined()
  })

  it('a conversa excluída no meio do pedido não volta como erro', () => {
    let e = r({}, { tipo: 'enviou', conversa: 'A', pedido: { pergunta: 'x' } })
    e = r(e, { tipo: 'descartou', conversa: 'A' })
    e = r(e, { tipo: 'falhou', conversa: 'A', erro: 'tarde' })
    expect(e).toEqual({})
  })
})

describe('as Skills do pedido e a contagem (defeitos 2 e 9)', () => {
  const lista = [{ skill_id: 's1' }, { skill_id: 's2' }]

  it('antes de a lista chegar, o campo `skills` não vai (o servidor usa todas as ativas)', () => {
    expect(skillsDoPedido(false, new Set(), undefined)).toBeUndefined()
    expect(skillsDoPedido(true, new Set(['s1', 'removida']), lista)).toEqual(['s1'])
    expect(skillsDoPedido(true, new Set(), lista)).toEqual([])
  })

  it('a Skill removida em Configurações não conta no botão', () => {
    expect(contarSkills(new Set(['s1', 's2', 'removida']), lista, false)).toBe(2)
    expect(contarSkills(new Set(['s1', 'removida']), lista, true)).toBe(2)
    expect(contarSkills(new Set(), [], false)).toBe(0)
  })
})

describe('o histórico que vai ao modelo leva o que a tela mostrava (defeito 3)', () => {
  it('cartão de contato, petição proposta, arquivos gerados e anexos viram notas no texto', () => {
    const h = historicoParaOModelo([
      pergunta('Leia o ofício', { anexos: ['oficio.pdf', 'planilha.xlsx'] }),
      resposta('Pronto.', {
        contatoSugerido: { nome_contato: 'Cartório X', whatsapp: '+55 11 99999-0000', mensagem: 'Bom dia' },
        acaoProposta: {
          tipo: 'gerar_peticao',
          processo_id: 'p',
          numero_cnj: '0001234-56.2024.8.26.0100',
          cessionario: null,
          instrucao: 'habilitar a cessão',
        },
        acaoResolvida: 'cancelada',
        arquivos: [{ nome: 'resumo.xlsx', url: 'https://x' } as never],
      }),
    ])
    expect(h[0]).toEqual({ role: 'user', content: 'Leia o ofício\n\n[Anexos: oficio.pdf, planilha.xlsx]' })
    expect(h[1].content).toContain('[Cartão de contato: Cartório X, +55 11 99999-0000, mensagem: "Bom dia"]')
    expect(h[1].content).toContain(
      '[Ação proposta: gerar petição no processo 0001234-56.2024.8.26.0100 — habilitar a cessão (a pessoa cancelou)]',
    )
    expect(h[1].content).toContain('[Arquivos gerados: resumo.xlsx]')
    // Só papel e texto: nada dos objetos da tela vai junto.
    expect(Object.keys(h[1]).sort()).toEqual(['content', 'role'])
  })

  it('a pergunta que falhou (sem resposta) não vai — a nova vem no campo `pergunta`', () => {
    const h = historicoParaOModelo([pergunta('p1'), resposta('r1'), pergunta('falhou')])
    expect(h.map((m) => m.content)).toEqual(['p1', 'r1'])
    const h2 = historicoParaOModelo([pergunta('falhou'), pergunta('p2'), resposta('r2')])
    expect(h2.map((m) => m.content)).toEqual(['p2', 'r2'])
  })

  it('as notas não entram no que se copia da conversa', () => {
    const txt = textoDaConversa([pergunta('oi', { anexos: ['a.pdf'] }), resposta('olá', { truncada: true })])
    expect(txt).not.toMatch(/\[Anexos|Resposta interrompida|\[Esta resposta/)
  })
})

describe('o Tentar de novo e o texto que volta ao campo (defeito 4)', () => {
  it('reescrever a pergunta que falhou a substitui, em vez de deixá-la pendurada', () => {
    const a = [pergunta('p1'), resposta('r1'), pergunta('errada')]
    expect(comPergunta(a, pergunta('certa'), 'errada').map((m) => m.content)).toEqual(['p1', 'r1', 'certa'])
  })

  it('sem falha, a pergunta só se acrescenta (e a pergunta respondida nunca é tirada)', () => {
    const a = [pergunta('p1'), resposta('r1')]
    expect(comPergunta(a, pergunta('p2')).map((m) => m.content)).toEqual(['p1', 'r1', 'p2'])
    expect(comPergunta(a, pergunta('p2'), 'p1').map((m) => m.content)).toEqual(['p1', 'r1', 'p2'])
  })
})

describe('a petição confirmada ou cancelada fica gravada (defeito 5)', () => {
  const acao = {
    tipo: 'gerar_peticao' as const,
    processo_id: 'p',
    numero_cnj: null,
    cessionario: null,
    instrucao: 'x',
  }

  it('marca a proposta pela posição', () => {
    const a = [pergunta('p'), resposta('r', { acaoProposta: acao })]
    expect(comAcaoResolvida(a, 1, 'r', 'cancelada')[1].acaoResolvida).toBe('cancelada')
  })

  it('com a conversa do banco em outra ordem, acha pela fala', () => {
    const doBanco = [pergunta('p0'), resposta('r0'), pergunta('p'), resposta('r', { acaoProposta: acao })]
    const r = comAcaoResolvida(doBanco, 1, 'r', 'confirmada')
    expect(r[3].acaoResolvida).toBe('confirmada')
    expect(r[1].acaoResolvida).toBeUndefined()
  })
})

describe('o aviso de corte é uma marca, não texto (defeito 6)', () => {
  it('a conversa antiga, com o aviso dentro do texto, vira marca ao abrir', () => {
    const antiga = resposta(
      'Lista parcial…\n\n---\n\n**Resposta interrompida** por tamanho. Peça um recorte menor (por tribunal, por período) para ver o restante.',
    )
    expect(normalizarMensagem(antiga)).toEqual(resposta('Lista parcial…', { truncada: true }))
    expect(normalizarMensagem(resposta('normal'))).toEqual(resposta('normal'))
  })

  it('ao modelo vai uma nota curta, não o parágrafo da tela', () => {
    const h = historicoParaOModelo([pergunta('p'), resposta('parcial', { truncada: true })])
    expect(h[1].content).toBe('parcial\n\n[Esta resposta foi interrompida por tamanho.]')
  })
})

describe('Enter no celular e na composição (defeito 10)', () => {
  const base = { key: 'Enter', shiftKey: false, isComposing: false, toque: false }
  it('no computador, Enter envia e Shift+Enter não', () => {
    expect(enterEnvia(base)).toBe(true)
    expect(enterEnvia({ ...base, shiftKey: true })).toBe(false)
  })
  it('na tela de toque, o Enter quebra a linha', () => {
    expect(enterEnvia({ ...base, toque: true })).toBe(false)
  })
  it('o Enter que confirma uma composição (IME, acento) não envia', () => {
    expect(enterEnvia({ ...base, isComposing: true })).toBe(false)
    expect(enterEnvia({ ...base, keyCode: 229 })).toBe(false)
  })
})

describe('o anexo que só uma Skill lê (defeito 11)', () => {
  it('a mesma regra do servidor (tipoDeBloco)', () => {
    for (const t of ['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv']) {
      expect(anexoPrecisaDeSkill(t)).toBe(false)
    }
    for (const t of [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
      'image/heic',
      '',
    ]) {
      expect(anexoPrecisaDeSkill(t)).toBe(true)
    }
  })
})

describe('as setas nas listas de modelo e de Skills (defeito 13)', () => {
  it('desce, sobe e dá a volta; Home e End vão às pontas', () => {
    expect(proximaOpcao(-1, 3, 'ArrowDown')).toBe(0)
    expect(proximaOpcao(2, 3, 'ArrowDown')).toBe(0)
    expect(proximaOpcao(0, 3, 'ArrowUp')).toBe(2)
    expect(proximaOpcao(-1, 3, 'ArrowUp')).toBe(2)
    expect(proximaOpcao(1, 3, 'Home')).toBe(0)
    expect(proximaOpcao(1, 3, 'End')).toBe(2)
    expect(proximaOpcao(1, 3, 'a')).toBeNull()
    expect(proximaOpcao(0, 0, 'ArrowDown')).toBeNull()
  })
})

describe('o título da conversa', () => {
  it('é o começo da primeira pergunta', () => {
    expect(tituloDaConversa([pergunta('curta')])).toBe('curta')
    expect(tituloDaConversa([pergunta('x'.repeat(70))])).toBe(`${'x'.repeat(60)}…`)
    expect(tituloDaConversa([])).toBe('Conversa')
  })
})
