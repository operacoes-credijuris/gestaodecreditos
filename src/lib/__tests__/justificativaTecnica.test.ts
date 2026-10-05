/**
 * A JUSTIFICATIVA TÉCNICA DA PROPOSTA (pedido de 05/10/2026): as regras puras
 * que a tela e a Edge Function `justificativa-tecnica` dividem.
 *
 * Nada aqui chama a Anthropic, o Kommo ou o banco: a montagem do prompt com as
 * variáveis, a leitura do card, as fontes, a divisão da nota, os estados e a
 * trava — e onde o botão aparece nos três funis, sem mover card nenhum.
 */
import { describe, it, expect } from 'vitest'
import {
  abasDoFunil,
  ACOES,
  botoesDaAba,
  FUNIL_PRECATORIO,
  FUNIL_RPV,
  type Aba,
} from '@/lib/kommo'
import { espelhoDosTresFunis } from './fixtures/kanbans'
import {
  aceitaRascunho,
  AVISO_MIGRACAO_0076,
  COLUNAS_DA_JUSTIFICATIVA,
  DOMINIOS_SUGERIDOS,
  dataDeHoje,
  dividirNota,
  dossieDaResposta,
  ehTabelaAusente,
  esferaDoEnte,
  FUNIL_RPV_JUSTIFICATIVA,
  FUNIS_DA_JUSTIFICATIVA,
  fundoEscolhido,
  geracaoParada,
  lerDominios,
  MAX_DOMINIOS,
  montarPrompt,
  NAO_INFORMADO,
  NOTA_MAX_CARACTERES,
  podeEnviar,
  podeGerar,
  PROMPT_JUSTIFICATIVA_PADRAO,
  promptEmVigor,
  somarConsumo,
  textoComFontes,
  textoDoTeto,
  textoEmVigor,
  TRAVA_GERACAO_MIN,
  tribunalDoCnj,
  valoresDoCard,
  VARIAVEIS_DA_JUSTIFICATIVA,
  type CardDaJustificativa,
  type LinhaDaJustificativa,
} from '../../../supabase/functions/_shared/justificativaTecnica.ts'
import { corpoDasNotas } from '../../../supabase/functions/_shared/anotarNoKommo.ts'
import {
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
  idsDestinoDaTrilha,
} from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'

const AGORA = Date.parse('2026-10-05T15:00:00.000Z')
const minutosAntes = (m: number) => new Date(AGORA - m * 60_000).toISOString()

// ---------------------------------------------------------------- o prompt

// O BLOCO DE DADOS que a plataforma anexa ao fim (o prompt é só instrução): aqui
// conferimos só a troca das variáveis, antes dele.
const semAnexo = (t: string) => t.split('\n\nDADOS DO CRÉDITO (anexados')[0]

describe('montarPrompt — as variáveis no lugar', () => {
  it('troca as conhecidas, e a sem valor vira "(não informado)"', () => {
    const r = montarPrompt('Cedente {{cedente}}, fundo {{ fundo_escolhido }}, comissão {{comissao}}.', {
      cedente: 'MARIA DA SILVA',
      fundo_escolhido: 'BTG',
      comissao: '   ',
    })
    expect(semAnexo(r.texto)).toBe(`Cedente MARIA DA SILVA, fundo BTG, comissão ${NAO_INFORMADO}.`)
    expect(r.desconhecidas).toEqual([])
  })

  it('a desconhecida (erro de digitação) fica como está e é apontada', () => {
    const r = montarPrompt('{{cedente}} e {{cedent}} e {{cedent}}', { cedente: 'X' })
    expect(semAnexo(r.texto)).toBe('X e {{cedent}} e {{cedent}}')
    expect(r.desconhecidas).toEqual(['cedent'])
  })

  // MUDOU DE PROPÓSITO (05/10/2026): o prompt é só instrução, e o padrão também —
  // sem variável nenhuma; os dados entram pelo bloco anexado.
  it('o prompt padrão é só instrução: sem variável, e com os dados anexados', () => {
    const r = montarPrompt(PROMPT_JUSTIFICATIVA_PADRAO, { cedente: 'MARIA' })
    expect(PROMPT_JUSTIFICATIVA_PADRAO.includes('{{')).toBe(false)
    expect(r.desconhecidas).toEqual([])
    expect(r.anexouDados).toBe(true)
    expect(r.texto).toContain('- Cedente: MARIA')
  })

  it('campo vazio cai no padrão — nenhuma geração sai sem método', () => {
    expect(promptEmVigor('')).toBe(PROMPT_JUSTIFICATIVA_PADRAO)
    expect(promptEmVigor('   \n ')).toBe(PROMPT_JUSTIFICATIVA_PADRAO)
    expect(promptEmVigor(null)).toBe(PROMPT_JUSTIFICATIVA_PADRAO)
    expect(promptEmVigor('Meu prompt')).toBe('Meu prompt')
  })

  it('o padrão funciona sem proposta de fundo (RPV e Interno): manda amparar o preço da própria casa', () => {
    expect(PROMPT_JUSTIFICATIVA_PADRAO).toMatch(/Se não há proposta de fundo, a proposta é da própria Credijuris/)
    // E não manda a IA escrever o cadastro como "RÓTULO: valor" (a nota volta ao espelho).
    expect(PROMPT_JUSTIFICATIVA_PADRAO).toMatch(/Não escreva linhas no formato "RÓTULO: valor"/)
  })
})

// ---------------------------------------------------------------- os dados do card

const notaDeGente = (texto: string, criado_em = '2026-09-01T10:00:00Z') => ({ texto, criado_em, automatica: false })
const notaNossa = (texto: string, criado_em = '2026-09-02T10:00:00Z') => ({ texto, criado_em, automatica: true })

describe('valoresDoCard — o que a plataforma sabe do crédito', () => {
  it('Externo com proposta escolhida: o fundo da nota e a cotação dele', () => {
    const card: CardDaJustificativa = {
      pipeline_id: FUNIL_PRECATORIO_EXTERNO,
      nome: 'Credijuris - ACME COMERCIO LTDA - 0001234-56.2020.8.26.0053 - principal - 30%',
      notas: [
        notaDeGente('ENTIDADE DEVEDORA: Estado de São Paulo\nVALOR DE FACE: R$ 1.000.000,00'),
        notaDeGente('Seguir com a proposta do BTG.\n\n— registrado por Ana pela plataforma Credijuris', '2026-10-01T10:00:00Z'),
      ],
      tags: ['Cotado BTG', 'Reprovado PJus'],
      raw: {
        custom_fields_values: [
          { field_id: 1, field_name: 'BTG', values: [{ value: 'R$ 850.000,00 / R$ 40.000,00' }] },
          { field_id: 2, field_name: 'PX Ativos', values: [{ value: 'R$ 800.000,00 / Spread' }] },
        ],
      },
    }
    const v = valoresDoCard(card, { agora: new Date(AGORA) })
    expect(v.funil).toBe('Precatório externo')
    expect(v.cedente).toBe('ACME COMERCIO LTDA')
    expect(v.processo).toBe('0001234-56.2020.8.26.0053')
    expect(v.tribunal).toBe('TJSP (pelo número do processo)')
    expect(v.ente_devedor).toBe('Estado de São Paulo')
    expect(v.parcela_cedida).toBe('principal')
    expect(v.valor_face).toBe('R$ 1.000.000,00')
    expect(v.valor_atualizado).toBe('')
    expect(v.fundo_escolhido).toBe('BTG')
    expect(v.valor_proposta).toBe('R$ 850.000,00')
    expect(v.comissao).toBe('R$ 40.000,00 (limitada)')
    expect(v.cotacoes_recebidas).toBe('  - PJus: reprovou o crédito\n  - BTG: R$ 850.000,00 / R$ 40.000,00\n  - PX Ativos: R$ 800.000,00 / Spread')
    expect(v.teto_rpv).toBe('')
    expect(v.data_hoje).toBe('05/10/2026')
  })

  it('proposta em SPREAD com percentual: a final como valor, a comissão com o percentual e sobre quanto', () => {
    const card: CardDaJustificativa = {
      pipeline_id: FUNIL_PRECATORIO_EXTERNO,
      nome: 'Credijuris - ACME COMERCIO LTDA - 0001234-56.2020.8.26.0053 - principal - 30%',
      notas: [notaDeGente('Seguir com a proposta do BTG.', '2026-10-01T10:00:00Z')],
      tags: ['Cotado BTG', 'Cotado PX Ativos', 'Cotado PJus'],
      raw: {
        custom_fields_values: [
          { field_id: 1, field_name: 'BTG', values: [{ value: 'R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)' }] },
          { field_id: 2, field_name: 'PX Ativos', values: [{ value: 'R$ 800.000,00 / Spread' }] },
          { field_id: 3, field_name: 'PJUS', values: [{ value: 'R$ 820.000,00 / R$ 30.000,00' }] },
        ],
      },
    }
    const v = valoresDoCard(card, { agora: new Date(AGORA) })
    expect(v.fundo_escolhido).toBe('BTG')
    expect(v.valor_proposta).toBe('R$ 807.500,00')
    expect(v.comissao).toBe('R$ 42.500,00 (spread de 5% sobre R$ 850.000,00)')
    expect(v.cotacoes_recebidas).toBe(
      [
        '  - PJus: R$ 820.000,00 / R$ 30.000,00',
        '  - BTG: proposta final R$ 807.500,00, comissão R$ 42.500,00 (spread de 5% sobre R$ 850.000,00)',
        '  - PX Ativos: R$ 800.000,00 / Spread',
      ].join('\n'),
    )
  })

  it('proposta em spread ANTIGO (sem percentual) e limitada: como antes', () => {
    const base = (valor: string): CardDaJustificativa => ({
      pipeline_id: FUNIL_PRECATORIO_EXTERNO,
      nome: 'Credijuris - ACME COMERCIO LTDA - 0001234-56.2020.8.26.0053',
      notas: [notaDeGente('Seguir com a proposta do BTG.', '2026-10-01T10:00:00Z')],
      raw: { custom_fields_values: [{ field_id: 1, field_name: 'BTG', values: [{ value: valor }] }] },
    })
    const antigo = valoresDoCard(base('R$ 850.000,00 / Spread'), { agora: new Date(AGORA) })
    expect(antigo.valor_proposta).toBe('R$ 850.000,00')
    expect(antigo.comissao).toBe('Spread (a comissão da casa sai da diferença sobre a proposta)')
    expect(antigo.cotacoes_recebidas).toBe('  - BTG: R$ 850.000,00 / Spread')
    const comPct = valoresDoCard(base('850 mil / spread de 5,5%'), { agora: new Date(AGORA) })
    expect(comPct.valor_proposta).toBe('R$ 850.000,00')
    expect(comPct.comissao).toBe('Spread de 5,5% sobre a proposta (a comissão da casa sai dela)')
  })

  it('RPV sem proposta de fundo: a ficha e o prazo da análise; a proposta sai "(não informado)"', () => {
    const card: CardDaJustificativa = {
      pipeline_id: FUNIL_RPV_JUSTIFICATIVA,
      nome: 'Credijuris - JOÃO PEREIRA - 5001234-12.2022.8.09.0051 - principal',
      notas: [],
      oportunidade: {
        ficha: { tribunal: 'TJGO', uf: 'GO', entidade_devedora: 'Município de Anápolis', valor_cedido: 45000.5 },
        prazoMeses: 4.5,
        dataPagamento: '02/2027',
      },
    }
    const v = valoresDoCard(card, { tetoRpv: 'R$ 16.210,00', agora: new Date(AGORA) })
    expect(v.funil).toBe('RPV')
    expect(v.tribunal).toBe('TJGO')
    expect(v.ente_devedor).toBe('Município de Anápolis')
    expect(v.valor_cedido).toBe('R$ 45.000,50')
    expect(v.prazo_estimado).toBe('4,5 meses, previsão 02/2027')
    expect(v.teto_rpv).toBe('R$ 16.210,00')
    expect(v.fundo_escolhido).toBe('')
    const { texto } = montarPrompt('{{fundo_escolhido}} | {{valor_proposta}} | {{comissao}} | {{cotacoes_recebidas}}', v)
    expect(semAnexo(texto)).toBe([NAO_INFORMADO, NAO_INFORMADO, NAO_INFORMADO, NAO_INFORMADO].join(' | '))
  })

  it('Interno: a ficha anotada pela análise (nota nossa) vence o cadastro do comercial', () => {
    const card: CardDaJustificativa = {
      pipeline_id: FUNIL_PRECATORIO_INTERNO,
      nome: 'Credijuris - EMPRESA X - 0009999-11.2019.4.01.3400',
      notas: [
        notaDeGente('ENTIDADE DEVEDORA: União'),
        notaNossa('TIPO: Precatório\nTRIBUNAL: TRF1\nENTIDADE DEVEDORA: União Federal (Fazenda Nacional)\nVALOR CEDIDO: R$ 2.000.000,00\n\n— Credijuris · nota automática da análise'),
      ],
    }
    const v = valoresDoCard(card)
    expect(v.funil).toBe('Precatório interno')
    expect(v.tribunal).toBe('TRF1')
    expect(v.ente_devedor).toBe('União Federal (Fazenda Nacional)')
    expect(v.valor_cedido).toBe('R$ 2.000.000,00')
    // O teto é só do RPV, mesmo que alguém o mande.
    expect(valoresDoCard(card, { tetoRpv: 'R$ 1,00' }).teto_rpv).toBe('')
  })

  it('a escolha mais nova vence, e o nome sai como na lista de fundos', () => {
    expect(
      fundoEscolhido([
        notaDeGente('Seguir com a proposta do BTG.', '2026-10-01T10:00:00Z'),
        notaDeGente('Seguir com a proposta da px ativos.', '2026-10-02T10:00:00Z'),
      ]),
    ).toBe('PX Ativos')
    expect(fundoEscolhido([notaDeGente('nada aqui')])).toBe('')
    expect(fundoEscolhido(null)).toBe('')
  })

  it('o tribunal pelo número CNJ', () => {
    expect(tribunalDoCnj('0001234-56.2020.8.26.0053')).toBe('TJSP')
    expect(tribunalDoCnj('0001234-56.2020.8.07.0001')).toBe('TJDFT')
    expect(tribunalDoCnj('0009999-11.2019.4.01.3400')).toBe('TRF1')
    expect(tribunalDoCnj('0009999-11.2019.5.18.0001')).toBe('TRT18')
    expect(tribunalDoCnj('não é número')).toBe('')
  })

  it('a esfera do ente, para o teto de RPV', () => {
    expect(esferaDoEnte('Município de Anápolis')).toBe('municipal')
    expect(esferaDoEnte('Instituto Nacional do Seguro Social - INSS')).toBe('federal')
    expect(esferaDoEnte('Autarquia X', 'TRF1')).toBe('federal')
    expect(esferaDoEnte('Estado de Goiás')).toBe('estadual')
    expect(esferaDoEnte('')).toBeNull()
  })

  it('o teto em uma linha, com a origem dita', () => {
    expect(textoDoTeto({ valor: 16210, escopo: 'capital', origem: 'semente' })).toBe(
      'R$ 16.210,00; referência do município-capital — o do município devedor não foi apurado; do mapa da plataforma, não conferido este ano',
    )
    expect(textoDoTeto({ valor: null })).toBe('')
    expect(textoDoTeto(null)).toBe('')
  })

  it('a data de hoje é a de Brasília', () => {
    // 02:00 UTC do dia 6 ainda é dia 5 em Brasília.
    expect(dataDeHoje(new Date('2026-10-06T02:00:00Z'))).toBe('05/10/2026')
  })
})

// ---------------------------------------------------------------- os domínios

describe('lerDominios — a lista da pesquisa', () => {
  it('limpa protocolo, caminho e caixa; tira repetição; aponta o que não é domínio', () => {
    const r = lerDominios('https://www.CNJ.jus.br/programas/precatorios\nstf.jus.br, stf.jus.br;\nlocalhost\nnão é domínio\ntjsp.jus.br/')
    expect(r.dominios).toEqual(['www.cnj.jus.br', 'stf.jus.br', 'tjsp.jus.br'])
    expect(r.recusados).toEqual(['localhost', 'não', 'é', 'domínio'])
  })

  it('vazio = sem restrição', () => {
    expect(lerDominios('')).toEqual({ dominios: [], recusados: [] })
    expect(lerDominios(null)).toEqual({ dominios: [], recusados: [] })
  })

  it(`no máximo ${MAX_DOMINIOS} (o teto da API)`, () => {
    const muitos = Array.from({ length: 80 }, (_, i) => `site${i}.gov.br`).join('\n')
    expect(lerDominios(muitos).dominios).toHaveLength(MAX_DOMINIOS)
  })

  it('a lista sugerida é válida, sem repetição e cabe no teto', () => {
    const r = lerDominios(DOMINIOS_SUGERIDOS.join('\n'))
    expect(r.recusados).toEqual([])
    expect(r.dominios).toEqual([...DOMINIOS_SUGERIDOS])
    expect(DOMINIOS_SUGERIDOS.length).toBeLessThanOrEqual(MAX_DOMINIOS)
    // Os 27 Tribunais de Justiça estão lá.
    expect(DOMINIOS_SUGERIDOS.filter((d) => /^tj[a-z]+\.jus\.br$/.test(d))).toHaveLength(27)
  })
})

// ---------------------------------------------------------------- as fontes

describe('dossieDaResposta — o dossiê e as fontes citadas', () => {
  it('numera as citações na ordem, sem repetir página, e marca cada trecho com as suas', () => {
    const r = dossieDaResposta([
      { type: 'server_tool_use' },
      { type: 'web_search_tool_result', content: [] },
      {
        type: 'text',
        text: 'O Estado está no regime especial.',
        citations: [
          { type: 'web_search_result_location', url: 'https://www.tjsp.jus.br/Precatorios', title: 'TJSP — Precatórios' },
          { type: 'web_search_result_location', url: 'https://www.tjsp.jus.br/Precatorios/', title: 'repetida' },
        ],
      },
      { type: 'text', text: ' A LOA prevê R$ 1 bi.', citations: [{ type: 'web_search_result_location', url: 'https://www.al.sp.gov.br/loa', title: 'LOA 2026' }] },
      { type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: 'https://www.in.gov.br/ec136', content: { title: 'EC 136/2025' } } },
      { type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } },
      { type: 'text', text: ' Sem fonte.', citations: null },
    ])
    expect(r.texto).toBe('O Estado está no regime especial. [1] A LOA prevê R$ 1 bi. [2] Sem fonte.')
    expect(r.fontes).toEqual([
      { url: 'https://www.tjsp.jus.br/Precatorios', titulo: 'TJSP — Precatórios' },
      { url: 'https://www.al.sp.gov.br/loa', titulo: 'LOA 2026' },
      { url: 'https://www.in.gov.br/ec136', titulo: 'EC 136/2025' },
    ])
  })
})

describe('textoComFontes — a lista no fim, só com as citadas', () => {
  const fontes = [
    { url: 'https://a.gov.br', titulo: 'A' },
    { url: 'https://b.jus.br', titulo: 'B' },
    { url: 'https://c.gov.br', titulo: 'C' },
  ]

  it('renumera na ordem de leitura e lista só as usadas', () => {
    const r = textoComFontes('Fato um [3]. Fato dois [1, 3]. Fato três [3].', fontes)
    expect(r.texto).toBe('Fato um [1]. Fato dois [1, 2]. Fato três [1].\n\nFONTES\n[1] C — https://c.gov.br\n[2] A — https://a.gov.br')
    expect(r.fontes.map((f) => f.titulo)).toEqual(['C', 'A'])
  })

  it('tira a citação que não existe, e aceita faixa', () => {
    const r = textoComFontes('Inventada [9]. Faixa [1-2].', fontes)
    expect(r.texto).toBe('Inventada. Faixa [1, 2].\n\nFONTES\n[1] A — https://a.gov.br\n[2] B — https://b.jus.br')
  })

  it('sem citação nenhuma, sem lista', () => {
    expect(textoComFontes('Texto sem fonte.', fontes)).toEqual({ texto: 'Texto sem fonte.', fontes: [] })
  })
})

// ---------------------------------------------------------------- a nota

describe('dividirNota — a nota do Kommo, em partes quando não cabe', () => {
  it('cabe numa: vai como está, sem cabeçalho de parte', () => {
    expect(dividirNota('Texto curto.')).toEqual(['Texto curto.'])
    expect(dividirNota('   ')).toEqual([])
  })

  it('não cabe: partes numeradas, cada uma dentro do limite, quebrando entre parágrafos e sem perder nada', () => {
    const paragrafos = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i + 1}. ` + 'palavra '.repeat(80).trim())
    const texto = paragrafos.join('\n\n')
    const partes = dividirNota(texto, 3000)
    expect(partes.length).toBeGreaterThan(1)
    partes.forEach((p, i) => {
      expect(p.length).toBeLessThanOrEqual(3000)
      expect(p.startsWith(`JUSTIFICATIVA TÉCNICA (parte ${i + 1} de ${partes.length})\n\n`)).toBe(true)
    })
    const corpo = partes.map((p) => p.replace(/^JUSTIFICATIVA TÉCNICA \(parte \d+ de \d+\)\n\n/, '')).join('\n\n')
    expect(corpo).toBe(texto)
  })

  it('uma linha maior que a nota é cortada no espaço, e nada some', () => {
    const linha = 'x'.repeat(10) + ' ' + 'palavra '.repeat(1000).trim()
    const partes = dividirNota(linha, 1500)
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(1500)
    const semCabecalho = partes.map((p) => p.replace(/^JUSTIFICATIVA TÉCNICA \(parte \d+ de \d+\)\n\n/, ''))
    expect(semCabecalho.join(' ').replace(/\s+/g, ' ')).toBe(linha)
  })

  it(`o padrão é ${NOTA_MAX_CARACTERES.toLocaleString('pt-BR')} caracteres por nota`, () => {
    expect(dividirNota('a'.repeat(NOTA_MAX_CARACTERES))).toHaveLength(1)
    expect(dividirNota(('b'.repeat(99) + '\n\n').repeat(120)).length).toBeGreaterThan(1)
  })

  it('a nota vai pelo mesmo corpo da kommo-anotar: common, sem gatilho, assinada por quem registrou', () => {
    expect(corpoDasNotas(123, ['Parte 1', 'Parte 2'], { dePessoa: true, autor: 'Ana' })).toEqual([
      {
        entity_id: 123,
        note_type: 'common',
        params: { text: 'Parte 1\n\n— registrado por Ana pela plataforma Credijuris' },
        is_need_to_trigger_digital_pipeline: false,
      },
      {
        entity_id: 123,
        note_type: 'common',
        params: { text: 'Parte 2\n\n— registrado por Ana pela plataforma Credijuris' },
        is_need_to_trigger_digital_pipeline: false,
      },
    ])
    // A da análise (o padrão de sempre da kommo-anotar) continua com a marca automática.
    expect(corpoDasNotas(1, ['Ficha'], { dePessoa: false })[0].params.text).toBe(
      'Ficha\n\n— Credijuris · nota automática da análise',
    )
  })
})

// ---------------------------------------------------------------- estados e trava

const linha = (l: Partial<LinhaDaJustificativa>): LinhaDaJustificativa => ({
  kommo_lead_id: 1,
  status: 'pronta',
  tentativa: 't1',
  atualizado_em: minutosAntes(1),
  ...l,
})

describe('podeGerar — abrir a janela não paga de novo', () => {
  it('sem linha: gera (é a primeira abertura)', () => {
    expect(podeGerar(null, false, AGORA)).toEqual({ ok: true })
  })
  it('gerando e viva: não — a geração em curso é a que vale (clique duplo, segunda aba)', () => {
    expect(podeGerar(linha({ status: 'gerando' }), false, AGORA)).toEqual({ ok: false, motivo: 'em-curso' })
    expect(podeGerar(linha({ status: 'gerando' }), true, AGORA)).toEqual({ ok: false, motivo: 'em-curso' })
  })
  it(`gerando e parada há mais de ${TRAVA_GERACAO_MIN} min: gera por cima da que morreu`, () => {
    const morta = linha({ status: 'gerando', atualizado_em: minutosAntes(TRAVA_GERACAO_MIN + 1) })
    expect(geracaoParada(morta, AGORA)).toBe(true)
    expect(podeGerar(morta, false, AGORA)).toEqual({ ok: true })
  })
  it('pronta, falha e enviada: só com "Gerar de novo" (refazer)', () => {
    for (const status of ['pronta', 'falha', 'enviada'] as const) {
      expect(podeGerar(linha({ status }), false, AGORA)).toEqual({ ok: false, motivo: 'ja-existe' })
      expect(podeGerar(linha({ status }), true, AGORA)).toEqual({ ok: true })
    }
  })
})

describe('podeEnviar e o rascunho', () => {
  it('só a pronta, com texto, sem outro envio vivo', () => {
    expect(podeEnviar(linha({}), 'texto', AGORA)).toEqual({ ok: true })
    expect(podeEnviar(null, 'texto', AGORA).ok).toBe(false)
    expect(podeEnviar(linha({}), '   ', AGORA).ok).toBe(false)
    expect(podeEnviar(linha({ status: 'gerando' }), 'texto', AGORA).ok).toBe(false)
    expect(podeEnviar(linha({ status: 'falha' }), 'texto', AGORA).ok).toBe(false)
  })
  it('a enviada não se reenvia (duplicaria a nota): o caminho é gerar de novo', () => {
    expect(podeEnviar(linha({ status: 'enviada' }), 'texto', AGORA)).toEqual({
      ok: false,
      erro: 'Esta justificativa já foi enviada ao Kommo.',
    })
  })
  it('a trava de envio vale enquanto é recente, e vence', () => {
    expect(podeEnviar(linha({ enviando_desde: minutosAntes(1) }), 'texto', AGORA).ok).toBe(false)
    expect(podeEnviar(linha({ enviando_desde: minutosAntes(10) }), 'texto', AGORA).ok).toBe(true)
  })
  it('o rascunho só se grava na pronta', () => {
    expect(aceitaRascunho(linha({}))).toBe(true)
    for (const status of ['gerando', 'falha', 'enviada'] as const) expect(aceitaRascunho(linha({ status }))).toBe(false)
    expect(aceitaRascunho(null)).toBe(false)
  })
  it('o texto em vigor: o editado vence o gerado; na enviada, o enviado', () => {
    expect(textoEmVigor(linha({ texto: 'gerado', texto_editado: null }))).toBe('gerado')
    expect(textoEmVigor(linha({ texto: 'gerado', texto_editado: 'editado' }))).toBe('editado')
    expect(textoEmVigor(linha({ texto: 'gerado', texto_editado: '' }))).toBe('')
    expect(textoEmVigor(linha({ status: 'enviada', texto: 'g', texto_editado: 'e', texto_enviado: 'enviado' }))).toBe('enviado')
  })
})

describe('somarConsumo — o custo, chamada a chamada', () => {
  it('soma tokens, buscas e páginas; campo ausente conta zero', () => {
    const a = somarConsumo(null, {
      input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: null,
      server_tool_use: { web_search_requests: 5, web_fetch_requests: 1 },
    })
    const b = somarConsumo(a, { input_tokens: 3000, output_tokens: 1500 })
    expect(b).toMatchObject({
      chamadas: 2, input_tokens: 4000, output_tokens: 1700, cache_read_input_tokens: 0, buscas: 5, fetches: 1,
    })
  })
})

describe('antes da migração 0076', () => {
  it('reconhece a tabela ausente nas formas do PostgREST e do Postgres', () => {
    expect(ehTabelaAusente({ code: 'PGRST205', message: "Could not find the table 'public.justificativa_tecnica' in the schema cache" })).toBe(true)
    expect(ehTabelaAusente({ code: '42P01', message: 'relation "public.justificativa_tecnica" does not exist' })).toBe(true)
    expect(ehTabelaAusente({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(ehTabelaAusente(null)).toBe(false)
  })
  it('a frase diz o que fazer e que nada foi cobrado', () => {
    expect(AVISO_MIGRACAO_0076).toMatch(/0076_justificativa_tecnica\.sql/)
    expect(AVISO_MIGRACAO_0076).toMatch(/Nada foi gerado nem cobrado/)
  })
})

// ---------------------------------------------------------------- onde o botão aparece

describe('o botão nos três funis — a Produção de proposta, e só ela', () => {
  const etapas = espelhoDosTresFunis()
  const comJustificativa = (abas: Aba[]) => abas.filter((a) => a.justificativaTecnica)

  it('Externo: a Proposta (PRODUÇÃO DE PROPOSTA)', () => {
    const abas = abasDoFunil(FUNIL_PRECATORIO, etapas, 'externo')
    expect(comJustificativa(abas).map((a) => [a.key, a.statusIds])).toEqual([
      ['ext-apresentacao', [COLUNAS_DA_JUSTIFICATIVA[FUNIL_PRECATORIO_EXTERNO]]],
    ])
  })

  it('Interno: Produção de proposta', () => {
    const abas = abasDoFunil(FUNIL_PRECATORIO, etapas, 'interno')
    expect(comJustificativa(abas).map((a) => [a.key, a.statusIds])).toEqual([
      ['int-aprovados', [COLUNAS_DA_JUSTIFICATIVA[FUNIL_PRECATORIO_INTERNO]]],
    ])
  })

  it('RPV: Produção de proposta, sem mudar os botões que a aba já tinha', () => {
    for (const trilha of ['interno', 'externo'] as const) {
      const abas = abasDoFunil(FUNIL_RPV, etapas, trilha)
      const [aba] = comJustificativa(abas)
      expect(comJustificativa(abas)).toHaveLength(1)
      expect(aba.key).toBe('aprovados')
      expect(aba.statusIds).toEqual([COLUNAS_DA_JUSTIFICATIVA[FUNIL_RPV_JUSTIFICATIVA]])
      // Nenhum botão pago novo, e as ações são as de sempre.
      expect(botoesDaAba(FUNIL_RPV, trilha, aba)).toBe('nenhum')
      expect(aba.acoes).toEqual(ACOES.aprovados)
    }
  })

  it('o botão não move card: nenhuma coluna nova entre os destinos que a kommo-mover aceita', () => {
    // A Produção de proposta já era destino (o Escolher proposta e o Aprovar crédito
    // levam o card PARA ela); a justificativa não acrescenta destino nenhum.
    expect(idsDestinoDaTrilha(FUNIL_PRECATORIO_EXTERNO)).toContain(111533988)
    expect(idsDestinoDaTrilha(FUNIL_PRECATORIO_INTERNO)).toContain(111533948)
    expect(Object.keys(FUNIS_DA_JUSTIFICATIVA).map(Number).sort()).toEqual(
      [FUNIL_RPV_JUSTIFICATIVA, FUNIL_PRECATORIO_INTERNO, FUNIL_PRECATORIO_EXTERNO].sort(),
    )
    expect(FUNIL_RPV_JUSTIFICATIVA).toBe(FUNIL_RPV)
  })
})

// O {{card}} E A REDE DE SEGURANÇA (05/10/2026): a operação escreveu {{card}}
// esperando os dados do crédito, e a IA recebia o texto literal, sem dado nenhum.
describe('montarPrompt — {{card}} e os dados anexados', () => {
  const valores = { cedente: 'MARIA DA SILVA', processo: '0001234-56.2020.8.26.0053', valor_proposta: 'R$ 807.500,00', cotacoes_recebidas: '- PJus: R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)' }
  it('{{card}} vira o bloco com todos os dados, um por linha', () => {
    const r = montarPrompt('Analise o crédito:\n{{card}}', valores)
    expect(r.desconhecidas).toEqual([])
    expect(r.anexouDados).toBe(false)
    expect(r.texto).toContain('- Cedente: MARIA DA SILVA')
    expect(r.texto).toContain('- Processo: 0001234-56.2020.8.26.0053')
    expect(r.texto).toContain('- Valor da proposta: R$ 807.500,00')
    expect(r.texto).toContain('- Tribunal: (não informado)')
    expect(r.texto).toContain('Cotações recebidas no card:\n- PJus:')
    expect(r.texto).not.toContain('{{card}}')
  })
  it('prompt sem nenhuma variável de dado: o bloco é anexado ao fim', () => {
    const r = montarPrompt('Escreva a justificativa. Hoje é {{data_hoje}}.', valores)
    expect(r.anexouDados).toBe(true)
    expect(r.texto).toMatch(/\n\nDADOS DO CRÉDITO \(anexados pela plataforma/)
    expect(r.texto).toContain('- Cedente: MARIA DA SILVA')
  })
  // MUDOU DE PROPÓSITO (05/10/2026): o prompt é só instrução; os dados vão
  // sempre, a menos que o prompt já os traga inteiros.
  it('prompt com só algumas variáveis recebe o bloco completo mesmo assim', () => {
    const r = montarPrompt('Cedente: {{cedente}}', valores)
    expect(r.anexouDados).toBe(true)
    expect(r.texto).toContain('- Valor da proposta: R$ 807.500,00')
  })
  it('o {{card}} e um prompt com todas as variáveis não recebem anexo', () => {
    expect(montarPrompt('{{card}}', valores).anexouDados).toBe(false)
    const todas = VARIAVEIS_DA_JUSTIFICATIVA.filter((v) => v.nome !== 'card').map((v) => `{{${v.nome}}}`).join(' ')
    expect(montarPrompt(todas, valores).anexouDados).toBe(false)
  })
})
