import { describe, it, expect } from 'vitest'
import { casaBusca } from '../buscaDaTela'
import {
  agruparPorPrazo,
  diasAtePrazo,
  grupoDoPrazo,
  prazoCurto,
  seloDoPrazo,
} from '../prazoDasTarefas'
import { brlCurto, numerosDaSelecao, tomDaExpectativa } from '../numerosDosCreditos'
import {
  diasParado,
  faixaParalisado,
  ordenarParalisados,
  textoParalisado,
} from '../paralisados'
import { peticaoAlterada, trechosDaPrevia } from '../previaDaPeticao'
import { tarefaAlterada, type FormularioDaTarefa } from '../formularioDaTarefa'

/**
 * As regras de TELA da onda 2 do redesenho no Operacional (Créditos,
 * Requerimentos, Publicações, Tarefas, Contatos e a petição). São os itens
 * "Novo" da amostra aprovada que dependem de uma conta — agrupar, somar,
 * ordenar, marcar —, e não de dado novo. Nenhuma delas grava nada.
 */

describe('casaBusca — a busca das telas', () => {
  it('busca vazia casa com tudo', () => {
    expect(casaBusca(['qualquer'], '')).toBe(true)
    expect(casaBusca([], '   ')).toBe(true)
  })

  it('texto sem acento e sem maiúscula, em qualquer campo', () => {
    expect(casaBusca(['Goiânia', null], 'goiania')).toBe(true)
    expect(casaBusca(['TRT-5', 'José da Silva'], 'JOSE')).toBe(true)
    expect(casaBusca(['TRT-5'], 'tjba')).toBe(false)
  })

  it('o número colado cru acha o formatado, e vice-versa', () => {
    expect(casaBusca(['5001234-56.2020.8.13.0001'], '50012345620')).toBe(true)
    expect(casaBusca(['50012345620208130001'], '5001234-56')).toBe(true)
  })

  // A REGRA ALARGOU: antes, em Créditos, o número só casava com CNJ, RTDPJ e o
  // administrativo; agora casa com qualquer campo (a amostra aprovada).
  it('o número vale em QUALQUER campo, não só no do processo', () => {
    expect(casaBusca(['Fulano', 'Obs.: CPF 123.456.789-00'], '12345678900')).toBe(true)
  })

  it('poucos dígitos não comparam por número (o ano traria meia lista)', () => {
    expect(casaBusca(['1.234.567'], '345')).toBe(false)
    expect(casaBusca(['(71) 3222-1234'], '22 1')).toBe(false)
    // Em Contatos o mínimo é 3, e o número acha também dentro do e-mail.
    expect(casaBusca(['(71) 3222-1234'], '22 1', 3)).toBe(true)
    expect(casaBusca(['vara130@trt5.jus.br'], '1-30', 3)).toBe(true)
  })

  it('número e campo vazio não quebram', () => {
    expect(casaBusca([12345, undefined, ''], '2345')).toBe(true)
  })
})

describe('prazo das tarefas — grupos e selo', () => {
  it('conta dias pela data, ignorando a hora que o ADVBOX manda', () => {
    expect(diasAtePrazo('2026-10-02', '2026-10-02 18:00:00')).toBe(0)
    expect(diasAtePrazo('2026-10-02', '2026-09-28')).toBe(-4)
    expect(diasAtePrazo('2026-10-02', '2026-10-09')).toBe(7)
  })

  it('as fronteiras dos grupos são as da régua de cor', () => {
    expect(grupoDoPrazo(-1)).toBe('vencidas')
    expect(grupoDoPrazo(0)).toBe('hoje_amanha')
    expect(grupoDoPrazo(1)).toBe('hoje_amanha')
    expect(grupoDoPrazo(2)).toBe('proximos_7')
    expect(grupoDoPrazo(7)).toBe('proximos_7')
    expect(grupoDoPrazo(8)).toBe('mais_adiante')
  })

  it('o selo diz o mesmo que o grupo', () => {
    expect(seloDoPrazo(-4)).toEqual({ tom: 'perigo', rel: 'venceu há 4 dias' })
    expect(seloDoPrazo(-1)).toEqual({ tom: 'perigo', rel: 'venceu ontem' })
    expect(seloDoPrazo(0)).toEqual({ tom: 'perigo', rel: 'hoje' })
    expect(seloDoPrazo(1)).toEqual({ tom: 'perigo', rel: 'amanhã' })
    expect(seloDoPrazo(5)).toEqual({ tom: 'aviso', rel: 'em 5 dias' })
    expect(seloDoPrazo(12)).toEqual({ tom: 'neutro', rel: '' })
  })

  // O texto de dentro do bloco de data (auditoria visual, T1): curto, e com a
  // mesma régua do selo — nada depois de 7 dias.
  it('o prazo curto cabe no bloco e segue a régua do selo', () => {
    expect(prazoCurto(-12)).toBe('há 12 dias')
    expect(prazoCurto(-2)).toBe('há 2 dias')
    expect(prazoCurto(-1)).toBe('ontem')
    expect(prazoCurto(0)).toBe('hoje')
    expect(prazoCurto(1)).toBe('amanhã')
    expect(prazoCurto(7)).toBe('em 7 dias')
    expect(prazoCurto(8)).toBe('')
    for (const d of [-30, -1, 0, 1, 3, 7, 8, 40]) {
      expect(prazoCurto(d) === '').toBe(seloDoPrazo(d).rel === '')
    }
  })

  it('agrupa, ordena como a plataforma e deixa de fora quem não tem prazo', () => {
    const t = (id: string, prazo: string | null) => ({ id, prazo })
    const g = agruparPorPrazo(
      [
        t('velha', '2026-09-01'),
        t('ontem', '2026-10-01'),
        t('amanha', '2026-10-03'),
        t('hoje', '2026-10-02'),
        t('semana', '2026-10-06'),
        t('longe', '2026-11-30'),
        t('perto', '2026-10-20'),
        t('sem', null),
      ],
      '2026-10-02',
      (x) => x.prazo,
    )
    // Vencidas: a que estourou há menos tempo primeiro.
    expect(g.vencidas.map((x) => x.id)).toEqual(['ontem', 'velha'])
    expect(g.hoje_amanha.map((x) => x.id)).toEqual(['hoje', 'amanha'])
    expect(g.proximos_7.map((x) => x.id)).toEqual(['semana'])
    expect(g.mais_adiante.map((x) => x.id)).toEqual(['perto', 'longe'])
  })
})

describe('numerosDaSelecao — os cartões de Créditos', () => {
  const c = (
    status: string,
    capital: number | null,
    exp: string | null,
  ) => ({ status, capital_investido: capital, expectativa_liquidacao: exp }) as never

  it('soma o capital e conta o que a lista tem', () => {
    const n = numerosDaSelecao([c('ativo', 1000, null), c('ativo', null, null), c('complementar', 500.5, null)], '2026-10-02')
    expect(n.quantidade).toBe(3)
    expect(n.capital).toBe(1500.5)
  })

  it('expectativa vencida só conta em Ativo', () => {
    const n = numerosDaSelecao(
      [c('ativo', 0, '2026-09-30'), c('complementar', 0, '2026-09-30'), c('ativo', 0, '2026-10-02')],
      '2026-10-02',
    )
    expect(n.vencidas).toBe(1)
  })

  it('liquidam em 90 dias: de hoje até 89 dias, fora o Encerrado', () => {
    const n = numerosDaSelecao(
      [
        c('ativo', 0, '2026-10-02'),
        c('ativo', 0, '2026-12-30'), // 89 dias
        c('ativo', 0, '2026-12-31'), // 90 dias — fora
        c('complementar', 0, '2026-11-01'),
        c('encerrado', 0, '2026-11-01'),
        c('ativo', 0, '2026-10-01'), // já venceu — fora
      ],
      '2026-10-02',
    )
    expect(n.liquidamEm90).toBe(3)
  })

  it('o semáforo da expectativa (o mesmo de antes, agora em selo)', () => {
    const hoje = '2026-10-02'
    const limite = '2027-01-02'
    expect(tomDaExpectativa(null, hoje, limite)).toBeNull()
    expect(tomDaExpectativa('2026-10-01', hoje, limite)).toBe('vencida')
    expect(tomDaExpectativa('2026-10-02', hoje, limite)).toBe('alerta')
    expect(tomDaExpectativa('2027-01-02', hoje, limite)).toBe('alerta')
    expect(tomDaExpectativa('2027-01-03', hoje, limite)).toBe('folga')
  })

  it('o valor curto do cartão', () => {
    expect(brlCurto(1_300_000)).toBe('R$ 1,3 mi')
    expect(brlCurto(840_400)).toBe('R$ 840 mil')
    expect(brlCurto(950)).toMatch(/950/)
  })
})

describe('paralisados — ordem, faixa e texto', () => {
  it('do mais parado ao menos parado; sem movimentação no fim', () => {
    const l = ordenarParalisados(
      [
        { n: 'recente', u: '2026-09-01' },
        { n: 'nunca', u: null },
        { n: 'antigo', u: '2025-01-10' },
        { n: 'meio', u: '2026-05-01' },
      ],
      (x) => x.u,
    )
    expect(l.map((x) => x.n)).toEqual(['antigo', 'meio', 'recente', 'nunca'])
  })

  it('as faixas da plataforma', () => {
    expect(faixaParalisado(26)).toBe('aviso')
    expect(faixaParalisado(45)).toBe('aviso')
    expect(faixaParalisado(46)).toBe('serio')
    expect(faixaParalisado(91)).toBe('ruim')
    expect(faixaParalisado(181)).toBe('critico')
    expect(faixaParalisado(null)).toBe('critico')
  })

  it('o tempo escrito, de dias a meses', () => {
    expect(textoParalisado(26)).toBe('há 26 dias')
    expect(textoParalisado(59)).toBe('há 59 dias')
    expect(textoParalisado(132)).toBe('há 4 meses')
    expect(textoParalisado(null)).toBe('sem movimentação')
  })

  it('conta os dias desde a última movimentação', () => {
    expect(diasParado('2026-09-02', new Date('2026-10-02T10:00:00'))).toBe(30)
    expect(diasParado('2026-10-05', new Date('2026-10-02T10:00:00'))).toBe(0)
  })
})

describe('prévia da petição — as faltas marcadas', () => {
  it('marca o que sobrou entre colchetes, com ou sem a barra de escape', () => {
    const t = trechosDaPrevia('AO JUÍZO \\[ENDEREÇAMENTO DO JUÍZO\\]\nProcesso nº 123 — [NOME DO CESSIONÁRIO].')
    expect(t).toEqual([
      { texto: 'AO JUÍZO ', falta: false },
      { texto: '[ENDEREÇAMENTO DO JUÍZO]', falta: true },
      { texto: '\nProcesso nº 123 — ', falta: false },
      { texto: '[NOME DO CESSIONÁRIO]', falta: true },
      { texto: '.', falta: false },
    ])
  })

  it('texto todo preenchido vira um trecho só, sem marca', () => {
    expect(trechosDaPrevia('Tudo certo.')).toEqual([{ texto: 'Tudo certo.', falta: false }])
    expect(trechosDaPrevia('')).toEqual([])
  })

  it('só trocar o modelo não é alteração; objeto digitado e peça redigida são', () => {
    expect(peticaoAlterada({ instrucao: '', textoIA: '' })).toBe(false)
    expect(peticaoAlterada({ instrucao: 'Peça o sequestro', instrucaoInicial: 'Peça o sequestro', textoIA: '' })).toBe(false)
    expect(peticaoAlterada({ instrucao: 'Peça o sequestro', textoIA: '' })).toBe(true)
    expect(peticaoAlterada({ instrucao: '', textoIA: 'Texto da peça' })).toBe(true)
  })
})

describe('Nova tarefa — "Descartar alterações?"', () => {
  const vazio: FormularioDaTarefa = {
    lawsuit_id: null,
    tasks_id: '',
    start_date: '',
    date_deadline: '',
    from: '',
    guests: [],
    important: false,
    urgent: false,
    comments: '',
  }

  it('o que a tela preenche sozinha não conta', () => {
    expect(tarefaAlterada(vazio, { processoInicial: null, escolheRemetente: false })).toBe(false)
    // Processo vindo da publicação e remetente de quem não é admin.
    expect(
      tarefaAlterada({ ...vazio, lawsuit_id: 7, from: '3' }, { processoInicial: 7, escolheRemetente: false }),
    ).toBe(false)
  })

  it('o que a pessoa escolhe ou digita conta', () => {
    const op = { processoInicial: 7, escolheRemetente: true }
    expect(tarefaAlterada({ ...vazio, lawsuit_id: 8 }, op)).toBe(true)
    expect(tarefaAlterada({ ...vazio, lawsuit_id: null }, op)).toBe(true)
    expect(tarefaAlterada({ ...vazio, lawsuit_id: 7, from: '3' }, op)).toBe(true)
    expect(tarefaAlterada({ ...vazio, lawsuit_id: 7, comments: 'x' }, op)).toBe(true)
    expect(tarefaAlterada({ ...vazio, lawsuit_id: 7, guests: [1] }, op)).toBe(true)
    expect(tarefaAlterada({ ...vazio, lawsuit_id: 7, urgent: true }, op)).toBe(true)
  })
})
