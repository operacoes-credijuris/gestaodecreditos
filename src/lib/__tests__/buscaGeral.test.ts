import { describe, it, expect } from 'vitest'
import {
  filtroDosCards,
  filtroDosContatos,
  filtroDosCreditos,
  lerPedidoDaBusca,
  lerTermo,
  LIMITE_TOTAL,
  montarResultados,
  padraoDosDigitos,
  padraoDoTexto,
  telasBuscaveis,
  TELAS_SEM_BUSCA,
} from '../buscaGeral'

describe('lerTermo: o que vai para a consulta', () => {
  it('só consulta o banco a partir de 3 letras', () => {
    expect(lerTermo('jo').consulta).toBe(false)
    expect(lerTermo('joa').consulta).toBe(true)
    expect(lerTermo('   jo  ').consulta).toBe(false)
  })

  it('tira o que quebraria o filtro do PostgREST e os curingas', () => {
    expect(lerTermo('Silva, João (pai)').texto).toBe('Silva João pai')
    expect(lerTermo('100%').texto).toBe('100')
    expect(lerTermo('a_b*c"d\\e').texto).toBe('a b c d e')
    // Só curingas não sobra nada para consultar: nunca traz a tabela inteira.
    expect(lerTermo('%%%').consulta).toBe(false)
  })

  it('número (com ou sem pontuação) procura pelos dígitos', () => {
    expect(lerTermo('0001234-56.2020').porNumero).toBe(true)
    expect(lerTermo('00012345620').porNumero).toBe(true)
    expect(lerTermo('123').porNumero).toBe(false) // poucos dígitos: texto
    expect(lerTermo('Vara 13 de 2020').porNumero).toBe(false)
  })
})

describe('padrões', () => {
  it('o texto em qualquer lugar, espaço vale qualquer trecho', () => {
    expect(padraoDoTexto('joao silva')).toBe('%joao%silva%')
  })
  it('os dígitos em qualquer formatação', () => {
    const re = new RegExp(padraoDosDigitos('00012345620'))
    expect(re.test('0001234-56.2020.8.05.0001')).toBe(true)
    expect(re.test('00012345620208050001')).toBe(true)
    expect(re.test('0001234-57.2020')).toBe(false)
  })
})

describe('filtros das consultas', () => {
  it('créditos por texto: partes e número, valores entre aspas', () => {
    expect(filtroDosCreditos(lerTermo('maria'))).toBe(
      'cedente.ilike."%maria%",cessionario.ilike."%maria%",entidade_devedora.ilike."%maria%",numero_cnj.ilike."%maria%"',
    )
  })
  it('créditos por número: judicial e administrativo, por expressão regular', () => {
    const f = filtroDosCreditos(lerTermo('1234-56'))
    expect(f).toBe('numero_cnj.imatch."1[^0-9]*2[^0-9]*3[^0-9]*4[^0-9]*5[^0-9]*6",numero_processo_administrativo.imatch."1[^0-9]*2[^0-9]*3[^0-9]*4[^0-9]*5[^0-9]*6"')
  })
  it('cards e contatos', () => {
    expect(filtroDosCards(lerTermo('ana'))).toBe('nome.ilike."%ana%"')
    expect(filtroDosContatos(lerTermo('vara'))).toContain('orgao.ilike."%vara%"')
    expect(filtroDosContatos(lerTermo('3333-4444'))).toContain('serventia_telefone.imatch.')
  })
  it('nenhum filtro tem vírgula ou parêntese vindos do que se digitou', () => {
    const f = filtroDosCreditos(lerTermo('a,b),or(id.gt.0'))
    // Só as vírgulas que separam as quatro condições.
    expect(f.split(',')).toHaveLength(4)
    expect(f).not.toMatch(/[()]/)
  })
})

describe('telasBuscaveis', () => {
  it('Configurações só para administrador', () => {
    expect(telasBuscaveis(false).some((t) => t.to === '/configuracoes')).toBe(false)
    expect(telasBuscaveis(true).some((t) => t.to === '/configuracoes')).toBe(true)
  })
  it('as cinco abas do Quadro entram, com o endereço de cada uma', () => {
    const quadro = telasBuscaveis(false).filter((t) => t.to.startsWith('/inteligencia'))
    expect(quadro.map((t) => t.to)).toEqual([
      '/inteligencia',
      '/inteligencia/previsoes',
      '/inteligencia/performance',
      '/inteligencia/recortes',
      '/inteligencia/carteiras',
    ])
    expect(quadro[0].titulo).toBe('Quadro econômico')
  })
})

describe('montarResultados', () => {
  const telas = telasBuscaveis(true)

  it('sem nada digitado sugere as primeiras telas', () => {
    const r = montarResultados({ digitado: '', telas })
    expect(r).toHaveLength(TELAS_SEM_BUSCA)
    expect(r.every((x) => x.tipo === 'tela')).toBe(true)
  })

  it('telas casam sem acento e desde a primeira letra', () => {
    const r = montarResultados({ digitado: 'previs', telas })
    expect(r.map((x) => x.alvo)).toContain('/inteligencia/previsoes')
    expect(montarResultados({ digitado: 'geracao', telas })[0].alvo).toBe('/comercial/contratos')
  })

  it('ordem: telas, cards, créditos, contatos; dentro do grupo, o que começa com o termo vem antes', () => {
    const r = montarResultados({
      digitado: 'cont',
      telas,
      cards: [{ kommo_lead_id: 7, pipeline_id: 1, status_id: 2, nome: 'Card Contreras', processo_cnj: null }],
      creditos: [
        { id: 'a', numero_cnj: '1', cedente: 'Maria Conti', entidade_devedora: null },
        { id: 'b', numero_cnj: '2', cedente: 'Contreras', entidade_devedora: null },
      ],
      contatos: [{ id: 'c', orgao: '2ª Vara de Contagem', tribunal: 'TJMG' }],
      onde: { funil: () => 'RPV', coluna: () => 'DILIGÊNCIA' },
    })
    expect(r.map((x) => x.tipo)).toEqual(['tela', 'tela', 'card', 'credito', 'credito', 'contato'])
    expect(r.filter((x) => x.tipo === 'credito').map((x) => x.alvo)).toEqual(['b', 'a'])
    const card = r.find((x) => x.tipo === 'card')!
    expect(card.onde).toBe('Diligência')
    expect(card.sub).toContain('RPV')
  })

  it('nunca passa do limite total', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({ id: String(i), orgao: `Vara ${i}`, tribunal: null }))
    expect(montarResultados({ digitado: 'vara', telas, contatos: muitos })).toHaveLength(LIMITE_TOTAL)
  })
})

describe('lerPedidoDaBusca', () => {
  it('lê só o que a busca deixa no state', () => {
    expect(lerPedidoDaBusca({ abrirCredito: 'x' })).toEqual({ abrirCredito: 'x' })
    expect(lerPedidoDaBusca({ filtrarContatos: 'Vara' })).toEqual({ filtrarContatos: 'Vara' })
    expect(lerPedidoDaBusca({ outra: 1, abrirCredito: 3 })).toEqual({})
    expect(lerPedidoDaBusca(null)).toEqual({})
  })
})
