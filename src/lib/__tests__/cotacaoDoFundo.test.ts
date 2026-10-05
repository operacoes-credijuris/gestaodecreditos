/**
 * A COTAÇÃO DO FUNDO: o texto que vai para o campo do card no Kommo, a leitura
 * de volta (tolerante ao que alguém digitou lá) e o campo achado pelo nome.
 *
 * O texto gravado é EXATAMENTE "R$ 850.000,00 / R$ 40.000,00" ou
 * "R$ 850.000,00 / Spread" — pedido do dono em 05/10/2026.
 */
import { describe, it, expect } from 'vitest'
import {
  campoDoFundo,
  chaveDoNome,
  comCotacaoGravada,
  cotacoesDoCard,
  ehGrupoDasCotacoes,
  formatarReais,
  lerCotacao,
  lerReais,
  textoDaCotacao,
  validarCotacao,
  type CampoDoKommo,
} from '../../../supabase/functions/_shared/cotacaoDoFundo.ts'
import { FUNDOS_DA_PRECIFICACAO } from '../../../supabase/functions/_shared/etiquetasDoFundo.ts'

describe('formatarReais', () => {
  it('ponto de milhar, vírgula e espaço COMUM depois do R$', () => {
    expect(formatarReais(123456789)).toBe('R$ 1.234.567,89')
    expect(formatarReais(85000000)).toBe('R$ 850.000,00')
    expect(formatarReais(5)).toBe('R$ 0,05')
    expect(formatarReais(100000)).toBe('R$ 1.000,00')
    expect(formatarReais(99900)).toBe('R$ 999,00')
    expect(formatarReais(85000000)).not.toContain(' ')
  })
})

describe('lerReais (centavos)', () => {
  it.each([
    ['850000', 85000000],
    ['850.000', 85000000],
    ['850.000,00', 85000000],
    ['R$ 850.000,00', 85000000],
    ['R$ 850.000,00', 85000000],
    ['r$850.000,5', 85000050],
    ['850000,5', 85000050],
    ['850000.00', 85000000],
    ['1.234.567,89', 123456789],
    ['850 mil', 85000000],
    ['R$ 850 mil', 85000000],
    ['1,5 mi', 150000000],
    ['1.5 milhão', 150000000],
    ['2 milhões', 200000000],
    ['1.500 mil', 150000000],
    ['40.000', 4000000],
  ])('%s', (texto, centavos) => {
    expect(lerReais(texto)).toBe(centavos)
  })

  it.each(['', '   ', 'abc', '850.5', '1.23.456', '12,345', '850,000.00', 'R$', '-', '850 reais e pouco'])(
    'recusa o que tem duas leituras ou não é número: %j',
    (texto) => {
      expect(lerReais(texto)).toBeNull()
    },
  )

  it('volta o que formatarReais escreveu', () => {
    for (const c of [1, 99, 100, 85000000, 123456789, 4000000]) {
      expect(lerReais(formatarReais(c))).toBe(c)
    }
  })
})

describe('textoDaCotacao', () => {
  it('limitada: proposta / comissão em reais', () => {
    expect(
      textoDaCotacao({ propostaCentavos: 85000000, comissao: { modalidade: 'limitada', centavos: 4000000 } }),
    ).toBe('R$ 850.000,00 / R$ 40.000,00')
  })
  it('spread: proposta / Spread', () => {
    expect(textoDaCotacao({ propostaCentavos: 85000000, comissao: { modalidade: 'spread' } })).toBe(
      'R$ 850.000,00 / Spread',
    )
  })
})

describe('validarCotacao', () => {
  it('aceita as duas modalidades', () => {
    expect(validarCotacao({ propostaCentavos: 100, comissao: { modalidade: 'spread' } }).ok).toBe(true)
    expect(validarCotacao({ propostaCentavos: 100, comissao: { modalidade: 'limitada', centavos: 10 } }).ok).toBe(
      true,
    )
  })
  it('recusa proposta ausente, zero, negativa ou fracionada', () => {
    for (const p of [undefined, 0, -1, 10.5, '100', NaN]) {
      expect(validarCotacao({ propostaCentavos: p, comissao: { modalidade: 'spread' } }).ok).toBe(false)
    }
  })
  it('limitada sem valor é recusada', () => {
    const r = validarCotacao({ propostaCentavos: 100, comissao: { modalidade: 'limitada' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/comissão/)
  })
  it('modalidade desconhecida é recusada', () => {
    expect(validarCotacao({ propostaCentavos: 100, comissao: { modalidade: 'fixa' } }).ok).toBe(false)
    expect(validarCotacao({ propostaCentavos: 100 }).ok).toBe(false)
    expect(validarCotacao(null).ok).toBe(false)
  })
})

describe('lerCotacao (o texto do campo, de volta)', () => {
  it('lê o que a plataforma grava', () => {
    expect(lerCotacao('R$ 850.000,00 / R$ 40.000,00')).toEqual({
      texto: 'R$ 850.000,00 / R$ 40.000,00',
      proposta: 85000000,
      comissao: { modalidade: 'limitada', centavos: 4000000 },
    })
    expect(lerCotacao('R$ 850.000,00 / Spread')).toEqual({
      texto: 'R$ 850.000,00 / Spread',
      proposta: 85000000,
      comissao: { modalidade: 'spread' },
    })
  })

  it('tolera o que alguém digitou no Kommo', () => {
    expect(lerCotacao('850 mil / 40 mil')).toMatchObject({
      proposta: 85000000,
      comissao: { modalidade: 'limitada', centavos: 4000000 },
    })
    expect(lerCotacao('R$ 850.000 - spread')).toMatchObject({ proposta: 85000000, comissao: { modalidade: 'spread' } })
    expect(lerCotacao('850000 spread')).toMatchObject({ proposta: 85000000, comissao: { modalidade: 'spread' } })
    expect(lerCotacao('Proposta: 850.000,00 | Comissão: 40.000,00')).toMatchObject({
      proposta: 85000000,
      comissao: { modalidade: 'limitada', centavos: 4000000 },
    })
    expect(lerCotacao('R$ 850.000,00')).toMatchObject({ proposta: 85000000, comissao: null })
  })

  it('texto sem número fica como texto, sem valor adivinhado', () => {
    expect(lerCotacao('aguardando o comitê')).toEqual({
      texto: 'aguardando o comitê',
      proposta: null,
      comissao: null,
    })
  })

  it('campo vazio (ou o "..." do Kommo) é null', () => {
    for (const t of [null, undefined, '', '   ', '...', '…', '-']) expect(lerCotacao(t)).toBeNull()
  })

  it('volta exatamente o que textoDaCotacao escreveu', () => {
    const casos = [
      { propostaCentavos: 123456789, comissao: { modalidade: 'limitada' as const, centavos: 987654 } },
      { propostaCentavos: 100, comissao: { modalidade: 'spread' as const } },
    ]
    for (const c of casos) {
      const l = lerCotacao(textoDaCotacao(c))
      expect(l?.proposta).toBe(c.propostaCentavos)
      expect(l?.comissao).toEqual(c.comissao)
    }
  })
})

describe('o campo do fundo, pelo nome', () => {
  const grupos = [
    { id: 'leads_1', name: 'Principal' },
    { id: 'leads_9', name: 'Cotações/propostas' },
  ]
  const campo = (id: number, name: string, group_id: string | null = 'leads_9', type = 'text'): CampoDoKommo => ({
    id,
    name,
    type,
    group_id,
  })

  it('a chave ignora caixa, acento e símbolo', () => {
    expect(chaveDoNome('PJUS')).toBe(chaveDoNome('PJus'))
    expect(chaveDoNome('K&WC Ativos')).toBe(chaveDoNome('K & WC Ativos'))
    expect(chaveDoNome('Invest Precatorios')).toBe(chaveDoNome('Invest Precatórios'))
  })

  it('o grupo é reconhecido com ou sem acento e barra', () => {
    for (const n of ['Cotações/propostas', 'Cotacoes / Propostas', 'COTAÇÕES E PROPOSTAS', 'cotações-propostas']) {
      expect(ehGrupoDasCotacoes(n)).toBe(true)
    }
    expect(ehGrupoDasCotacoes('Principal')).toBe(false)
  })

  it('acha os sete fundos, e "PJUS" serve à PJus', () => {
    const campos = [
      campo(1, 'PJUS'),
      campo(2, 'BTG'),
      campo(3, 'PX Ativos'),
      campo(4, 'Invest Precatórios'),
      campo(5, 'K & WC Ativos'),
      campo(6, 'Precatur'),
      campo(7, 'Carbon'),
    ]
    const ids = FUNDOS_DA_PRECIFICACAO.map((f) => {
      const r = campoDoFundo(f, campos, grupos)
      return r.ok ? r.campo.id : null
    })
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('prefere o do grupo Cotações/propostas ao de mesmo nome noutra aba', () => {
    const r = campoDoFundo('BTG', [campo(10, 'BTG', 'leads_1'), campo(11, 'BTG', 'leads_9')], grupos)
    expect(r.ok && r.campo.id).toBe(11)
  })

  it('sem o grupo, vale o de mesmo nome se for um só', () => {
    const r = campoDoFundo('BTG', [campo(10, 'BTG', null)], [])
    expect(r.ok && r.campo.id).toBe(10)
  })

  it('campo ausente: o erro diz qual falta', () => {
    const r = campoDoFundo('Carbon', [campo(2, 'BTG')], grupos)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toContain('"Carbon"')
  })

  it('dois candidatos no mesmo nível: recusa, em vez de adivinhar', () => {
    const r = campoDoFundo('BTG', [campo(10, 'BTG'), campo(11, 'btg')], grupos)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/2 campos/)
  })

  it('campo de tipo que não aceita texto: recusa e diz o tipo', () => {
    const r = campoDoFundo('BTG', [campo(10, 'BTG', 'leads_9', 'numeric')], grupos)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toContain('"numeric"')
    expect(campoDoFundo('BTG', [campo(10, 'BTG', 'leads_9', 'textarea')], grupos).ok).toBe(true)
  })
})

describe('cotacoesDoCard (o que a janela de escolha mostra)', () => {
  it('lê por fundo, pelo nome do campo, e o que falta é null', () => {
    const c = cotacoesDoCard([
      { field_id: 1, field_name: 'PJUS', values: [{ value: 'R$ 850.000,00 / Spread' }] },
      { field_id: 2, field_name: 'BTG', values: [{ value: 'R$ 900.000,00 / R$ 40.000,00' }] },
      { field_id: 9, field_name: 'Telefone', values: [{ value: '11 99999-0000' }] },
    ])
    expect(Object.keys(c)).toEqual([...FUNDOS_DA_PRECIFICACAO])
    expect(c.PJus?.proposta).toBe(85000000)
    expect(c.BTG?.comissao).toEqual({ modalidade: 'limitada', centavos: 4000000 })
    expect(c.Carbon).toBeNull()
  })

  it('com dois campos de mesmo nome, vale o que tem cotação legível', () => {
    const c = cotacoesDoCard([
      { field_id: 1, field_name: 'BTG', values: [{ value: 'cliente pediu retorno' }] },
      { field_id: 2, field_name: 'BTG', values: [{ value: 'R$ 1.000,00 / Spread' }] },
    ])
    expect(c.BTG?.proposta).toBe(100000)
  })

  it('card sem campos (null do Kommo) não quebra', () => {
    expect(cotacoesDoCard(null).PJus).toBeNull()
  })

  it('comCotacaoGravada troca só o campo gravado', () => {
    const antes = [
      { field_id: 1, field_name: 'PJUS', values: [{ value: 'velho' }] },
      { field_id: 9, field_name: 'Telefone', values: [{ value: 'x' }] },
    ]
    const depois = comCotacaoGravada(antes, { id: 1, name: 'PJUS' }, 'R$ 1,00 / Spread')
    expect(depois).toHaveLength(2)
    expect(cotacoesDoCard(depois).PJus?.texto).toBe('R$ 1,00 / Spread')
    expect(depois.find((v) => v.field_id === 9)?.values?.[0]?.value).toBe('x')
  })
})
