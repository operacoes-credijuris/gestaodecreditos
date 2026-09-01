// Guardas do relatório do investidor.
//
// O QUE ESTE ARQUIVO PROTEGE
//
// 1. Que o relatório e a planilha não voltem a fazer a conta cada um por si.
//    Era assim antes: o mesmo bloco `valorProjetado -> tir -> tirAgregada`
//    escrito em três lugares. Enquanto as cópias estão idênticas ninguém
//    percebe; na primeira que alguém ajustar só num lugar, a plataforma publica
//    dois números diferentes para a mesma carteira e um deles vai ao investidor.
//
// 2. Que o arquivo continue AUTOCONTIDO. Ele é enviado por WhatsApp e aberto no
//    celular de quem investiu, possivelmente sem internet. Uma fonte de CDN ou
//    um <script> que alguém acrescente "só para animar o gráfico" quebra isso
//    de forma silenciosa: abre perfeito na máquina de quem gerou.
//
// 3. Que o cartão de ganho e o percentual embaixo dele não se contradigam.
//
// 4. Que carteiras degeneradas (vazia, sem parâmetro, sem expectativa, tudo
//    liquidado) não derrubem a geração. É onde um relatório mensal costuma
//    falhar: no investidor que só tem uma operação.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Processo } from '../types'
import type { ParametrosAtualizacao } from '../projecao'
import { montarCarteiraDoInvestidor, type DadosCarteira } from '../carteiraInvestidor'
import { gerarRelatorioCarteiraHtml, mensagemWhatsapp } from '../relatorioCarteira'

const HOJE = '2026-09-01'

const PARAMS: ParametrosAtualizacao = {
  selic_aa: 15,
  ipca_12m_aa: 4.5,
  data_referencia: HOJE,
}

let seq = 0
function proc(p: Partial<Processo>): Processo {
  seq++
  return {
    id: `id-${seq}`,
    numero_cnj: String(50000000000000000000n + BigInt(seq)),
    numero_processo_administrativo: null,
    tribunal: 'TJGO',
    comarca: null,
    vara: null,
    cedente: `Cedente ${seq}`,
    cedente_advogado: 'Adv. Fulano',
    cessionario: 'Investidor Teste',
    originador: null,
    entidade_devedora: 'Estado de Goiás',
    data_aquisicao: '2025-09-01',
    expectativa_liquidacao: '2026-12-01',
    instrumento: null,
    numero_rtdpj: null,
    status: 'ativo',
    data_liquidacao: null,
    especie_requisitorio: 'rpv',
    tipo_credito: ['principal'],
    capital_investido: 10_000,
    valor_face: 14_000,
    data_referencia: '2025-09-01',
    indice_atualizacao: 'selic',
    ja_recebido: null,
    valor_estimado_complementar: null,
    advbox_lawsuit_id: null,
    drive_pasta_id: null,
    created_at: '2025-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...p,
  }
}

function dados(carteira: Processo[], extra: Partial<DadosCarteira> = {}): DadosCarteira {
  const capital = carteira.reduce((s, p) => s + (p.capital_investido ?? 0), 0)
  const recebido = carteira.reduce((s, p) => s + (p.ja_recebido ?? 0), 0)
  return {
    investidor: 'Investidor Teste',
    mesRef: 'setembro de 2026',
    carteira,
    resumos: undefined,
    ultimaMov: undefined,
    capitalTotal: carteira.length > 0 ? capital : null,
    jaRecebidoTotal: recebido > 0 ? recebido : null,
    parametros: PARAMS,
    hoje: HOJE,
    ...extra,
  }
}

/** Carteira com um pouco de tudo: paga, vencida, âmbar, azul, complementar. */
function carteiraVariada(): Processo[] {
  return [
    proc({
      cedente: 'Ana Paga',
      tribunal: 'TJGO',
      data_aquisicao: '2025-10-01',
      data_liquidacao: '2026-04-01',
      ja_recebido: 13_000,
      status: 'encerrado',
    }),
    proc({
      cedente: 'Bruno Vencido',
      tribunal: 'TRF-1',
      expectativa_liquidacao: '2026-07-15',
    }),
    proc({
      cedente: 'Carla Ambar',
      tribunal: 'TJRJ',
      expectativa_liquidacao: '2026-09-20',
    }),
    proc({ cedente: 'Diego Azul', tribunal: 'TJGO', expectativa_liquidacao: '2027-03-01' }),
    proc({
      cedente: 'Elza Complementar',
      tribunal: 'TRF-6',
      data_liquidacao: '2026-02-10',
      ja_recebido: 11_500,
      valor_estimado_complementar: 900,
      status: 'complementar',
    }),
    // Nova do ciclo — adquirida no mês de hoje.
    proc({ cedente: 'Fábio Novo', tribunal: 'TJGO', data_aquisicao: '2026-09-01' }),
  ]
}

function gerar(carteira: Processo[], extra: Partial<DadosCarteira> = {}) {
  const c = montarCarteiraDoInvestidor(dados(carteira, extra))
  return { c, html: gerarRelatorioCarteiraHtml(c) }
}

describe('relatório: o arquivo é autocontido', () => {
  const { html } = gerar(carteiraVariada())

  it('não referencia nenhum recurso externo', () => {
    // Sem CDN, sem fonte remota, sem imagem hospedada: o investidor abre o
    // arquivo no celular, possivelmente offline.
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
    expect(html).not.toMatch(/@import/)
    expect(html).not.toMatch(/<link\b/i)
  })

  it('não contém script algum', () => {
    // Um .html com <script> é bloqueado por parte dos clientes de e-mail e
    // levanta suspeita legítima em quem recebe um documento financeiro.
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/\son[a-z]+=/i)
  })

  it('abre e fecha como documento completo', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })
})

describe('relatório: os números vêm do cálculo, não de recontagem', () => {
  it('o ganho em reais fecha com o percentual exibido ao lado dele', () => {
    // O cartão diz "R$ X" e, embaixo, "+Y% sobre o capital investido". Se as
    // duas coisas saírem de conjuntos diferentes de operações, o relatório se
    // contradiz na mesma caixa.
    const { c } = gerar(carteiraVariada())
    expect(c.ganhoTotal).not.toBeNull()
    expect(c.capitalConsiderado).not.toBeNull()
    const derivado = Math.round((c.ganhoTotal! / c.capitalConsiderado!) * 10000) / 100
    expect(derivado).toBe(c.retornoCarteira.valor)
  })

  it('publica exatamente a TIR consolidada calculada', () => {
    const { c, html } = gerar(carteiraVariada())
    expect(c.tirMedia.valor).not.toBeNull()
    const esperado = `${c.tirMedia.valor!.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}%`
    expect(html).toContain(esperado)
  })

  it('conta as liquidadas pela mesma régua da tela', () => {
    const { c } = gerar(carteiraVariada())
    expect(c.liquidadas).toBe(2)
  })

  it('não inventa taxa de referência quando a SELIC não está cadastrada', () => {
    const { html } = gerar(carteiraVariada(), {
      parametros: { selic_aa: null, ipca_12m_aa: null, data_referencia: null },
    })
    expect(html).toContain('Sem taxa de referência cadastrada')
    expect(html).not.toContain('× a SELIC')
  })
})

describe('relatório: o donut fecha a volta', () => {
  it('as fatias somam a circunferência, sem sobra nem estouro', () => {
    const { html } = gerar(carteiraVariada())
    const comprimentos = [...html.matchAll(/stroke-dasharray="([\d.]+) 364\.4"/g)].map((m) =>
      Number(m[1]),
    )
    expect(comprimentos.length).toBeGreaterThan(1)
    const soma = comprimentos.reduce((s, v) => s + v, 0)
    // Tolerância de 0,5 por causa do toFixed(1) de cada fatia.
    expect(Math.abs(soma - 2 * Math.PI * 58)).toBeLessThan(0.5)
  })
})

describe('relatório: o gráfico de evolução fecha com os cartões', () => {
  // Uma primeira versão deste bloco checava se as duas linhas se tocavam em
  // hoje — e passava mesmo com o defeito reintroduzido, porque o ponto de hoje
  // é fixado no recebido por construção. Teste que não consegue falhar não
  // guarda nada. O que de fato pode quebrar é a ponta da linha projetada
  // divergir do cartão "Resultado bruto": basta um complementar contado duas
  // vezes, ou uma operação vencida deixada de fora dos eventos.
  const ys = (html: string, cor: string) => {
    const m = new RegExp(`<polyline points="([^"]+)" fill="none" stroke="${cor}"`).exec(html)
    expect(m).not.toBeNull()
    return m![1].split(' ').map((p) => Number(p.split(',')[1]))
  }

  it('a ponta da linha projetada é o resultado bruto da carteira', () => {
    const { c, html } = gerar(carteiraVariada())
    const bruto = (c.jaRecebidoTotal ?? 0) + (c.aReceber.total ?? 0)
    const rotulo = /fill="#85B7EB" font-family="Arial" font-weight="600">([^<]+)</.exec(html)
    expect(rotulo).not.toBeNull()
    expect(rotulo![1]).toBe(`R$ ${Math.round(bruto / 1000)}k`)
  })

  it('as séries acumuladas nunca caem', () => {
    // Em SVG o eixo Y cresce para baixo, então acumulado que sobe é y que não
    // aumenta. Recebido e projetado são somas do que já entrou ou vai entrar:
    // recuar significaria dinheiro desaparecendo.
    const { html } = gerar(carteiraVariada())
    for (const cor of ['#97C459', '#85B7EB']) {
      const serie = ys(html, cor)
      expect(serie.length).toBeGreaterThan(1)
      for (let i = 1; i < serie.length; i++) expect(serie[i]).toBeLessThanOrEqual(serie[i - 1])
    }
  })

  it('o capital comprometido sobe e desce — é a única série que pode cair', () => {
    const { html } = gerar(carteiraVariada())
    const serie = ys(html, '#042C53')
    expect(Math.min(...serie)).toBeLessThan(Math.max(...serie))
    // E termina em zero (y do eixo) quando todas as operações têm saída prevista.
    expect(serie[serie.length - 1]).toBe(240)
  })
})

describe('relatório: texto de terceiro é escapado', () => {
  it('nome de cedente com HTML não vira marcação', () => {
    const { html } = gerar([
      proc({ cedente: '<script>alert(1)</script> & Cia "S/A"' }),
    ])
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; Cia')
  })

  it('estágio processual vindo do resumo também é escapado', () => {
    const resumos = new Map([
      [
        'id-x',
        {
          processo_id: 'id-x',
          estagio_processual: '<img src=x onerror=alert(1)>',
          providencias: null,
          erro: null,
          gerado_em: HOJE,
        },
      ],
    ])
    const p = proc({ id: 'id-x', expectativa_liquidacao: '2026-09-10' })
    const { html } = gerar([p], { resumos })
    expect(html).not.toMatch(/<img src=x/i)
    expect(html).toContain('&lt;img src=x')
  })
})

describe('relatório: carteiras degeneradas não derrubam a geração', () => {
  const casos: [string, Processo[], Partial<DadosCarteira>][] = [
    ['carteira vazia', [], { capitalTotal: null, jaRecebidoTotal: null }],
    ['uma operação só', [proc({})], {}],
    [
      'tudo liquidado',
      [proc({ data_liquidacao: '2026-01-10', ja_recebido: 12_000, status: 'encerrado' })],
      {},
    ],
    ['sem expectativa nenhuma', [proc({ expectativa_liquidacao: null })], {}],
    ['sem capital cadastrado', [proc({ capital_investido: null })], { capitalTotal: null }],
    ['sem valor de face', [proc({ valor_face: null })], {}],
    ['sem índice de atualização', [proc({ indice_atualizacao: null })], {}],
    ['sem parâmetros', [proc({})], { parametros: undefined }],
    ['sem tribunal', [proc({ tribunal: null })], {}],
    [
      'expectativa vencida há muito tempo',
      [proc({ expectativa_liquidacao: '2020-01-01' })],
      {},
    ],
  ]

  for (const [nome, carteira, extra] of casos) {
    it(nome, () => {
      const { html } = gerar(carteira, extra)
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Investidor Teste')
      // "NaN" e "undefined" no corpo são o sintoma clássico de conta feita sobre
      // campo ausente, e num documento financeiro é pior que a informação faltar.
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('undefined')
      expect(html).not.toContain('[object Object]')
    })
  }

  it('a carteira vazia diz que está vazia em vez de mostrar zeros', () => {
    const { html } = gerar([])
    expect(html).toContain('Nenhuma operação em aberto')
  })
})

describe('mensagem de acompanhamento', () => {
  it('usa o primeiro nome e repete só números que estão no relatório', () => {
    const { c } = gerar(carteiraVariada())
    const msg = mensagemWhatsapp(c)
    expect(msg.startsWith('Olá, Investidor!')).toBe(true)
    expect(msg).toContain('setembro de 2026')
    // Nada de promessa de data de pagamento.
    expect(msg).toContain('estimativas de recebimento, não datas garantidas')
  })

  it('a versão curta cabe numa notificação', () => {
    const { c } = gerar(carteiraVariada())
    expect(mensagemWhatsapp(c, { curta: true }).length).toBeLessThan(500)
  })

  it('não quebra numa carteira vazia', () => {
    const { c } = gerar([])
    expect(() => mensagemWhatsapp(c)).not.toThrow()
  })
})

describe('a conta acontece num lugar só', () => {
  // Teste estático, como o do assistente: lê o fonte. O que ele guarda não é o
  // comportamento de uma função, é a ARQUITETURA — que ninguém volte a chamar
  // as funções de projeção direto do exportador ou do gerador de HTML.
  const ler = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

  const PROIBIDAS = [
    'valorProjetado(',
    'tirAgregada(',
    'aReceberEstimado(',
    'retornoProjetadoCarteira(',
    'ganhoProjetado(',
    'statusLiquidacao(',
  ]

  it('o exportador de Excel não recalcula nada', () => {
    const src = ler('../exportarCarteira.ts')
    expect(PROIBIDAS.filter((f) => src.includes(f))).toEqual([])
    expect(src).toContain('montarCarteiraDoInvestidor(')
  })

  it('o gerador de HTML não recalcula nada', () => {
    const src = ler('../relatorioCarteira.ts')
    expect(PROIBIDAS.filter((f) => src.includes(f))).toEqual([])
  })

  it('a tela consome o mesmo módulo', () => {
    const src = ler('../../pages/comercial/CarteirasInvestidores.tsx')
    expect(src).toContain('montarCarteiraDoInvestidor')
  })

  it('a marca não entra por `?inline`', () => {
    // Armadilha real, encontrada na primeira versão: no Vite o sufixo `?inline`
    // vale para CSS. Num .png ele devolve a URL do arquivo com hash, o build
    // passa, a aba de conferência abre com a logo — e o arquivo que o investidor
    // salva no celular mostra um ícone quebrado. A marca tem de virar data: URI
    // em tempo de geração.
    const src = ler('../relatorioCarteira.ts')
    expect(src).not.toMatch(/\.png\?inline/)
    expect(src).toContain('readAsDataURL')
  })
})
