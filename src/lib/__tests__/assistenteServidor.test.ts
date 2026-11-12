/**
 * O ASSISTENTE NO SERVIDOR — defeitos confirmados na revisão de 12/11/2026.
 *
 * As regras que decidem o resultado das ferramentas moram em
 * `_shared/regrasDoAssistente.ts` (puro) e são testadas de verdade aqui; o que só
 * existe dentro do `Deno.serve` (o laço de rodadas, o container, a limpeza dos
 * arquivos) é conferido pela leitura do fonte, como nos outros testes do
 * assistente. Nada aqui chama a Anthropic, o Kommo ou o banco.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cortarPorTamanho,
  dataAAAAMMDD,
  diasEntre,
  escolherInvestidor,
  formasDoNumero,
  grupoDoValor,
  inteiroEntre,
  inteiroPositivoOuNulo,
  investidoresDistintos,
  ordenarDoMaisParado,
  paradosDaCarteira,
  pareceNumeroDeProcesso,
  pessoasDoAssistente,
  regexDosDigitos,
  TETO_DE_CARACTERES_DO_HISTORICO,
  traduzirErroDaAnthropic,
} from '../../../supabase/functions/_shared/regrasDoAssistente.ts'
import {
  aceitaRaciocinioAdaptativo,
  HAIKU_VIGENTE,
  MODELO_PADRAO_DO_ASSISTENTE,
  MODELOS_DO_ASSISTENTE,
  modeloVigente,
  OPUS_VIGENTE,
  resolverModeloDoAssistente,
  SONNET_VIGENTE,
} from '../../../supabase/functions/_shared/modeloDoAssistente.ts'
import {
  baseDoKommoEmPedacos,
  cardDaBase,
  COLUNAS_DO_SISTEMA,
  type EtapaDoEspelho,
  type LinhaDoEspelho,
  montarBaseDoKommo,
  TETO_DO_TEXTO_DA_NOTA,
} from '../../../supabase/functions/_shared/baseDoKommo.ts'
import { ordenarParalisados } from '../paralisados'
import { listarPessoas } from '../pessoas'
import type { InvestidorDados } from '../queries'

const RAIZ = join(__dirname, '..', '..', '..')
// Sem CR: a cópia de trabalho pode estar em CRLF (core.autocrlf).
const fonte = readFileSync(join(RAIZ, 'supabase/functions/assistente/index.ts'), 'utf8').replace(/\r\n/g, '\n')
/** O trecho de um `case` do executor, até o próximo `case`. */
const caso = (nome: string) => {
  const ini = fonte.indexOf(`case '${nome}': {`)
  expect(ini, nome).toBeGreaterThan(-1)
  const fim = fonte.indexOf("\n    case '", ini + 10)
  return fonte.slice(ini, fim === -1 ? undefined : fim)
}

// ------------------------------------------------------------------ números

describe('números e datas do modelo são validados', () => {
  it('inteiroEntre: fração, texto, negativo e lixo', () => {
    const o = { min: 1, max: 40, padrao: 15 }
    expect(inteiroEntre(7.9, o)).toBe(7)
    expect(inteiroEntre('12', o)).toBe(12)
    expect(inteiroEntre(-3, o)).toBe(1)
    expect(inteiroEntre(0, o)).toBe(1)
    expect(inteiroEntre(999, o)).toBe(40)
    expect(inteiroEntre(Number.NaN, o)).toBe(15)
    expect(inteiroEntre('abc', o)).toBe(15)
    expect(inteiroEntre(undefined, o)).toBe(15)
    expect(inteiroEntre(Infinity, o)).toBe(15)
  })

  it('inteiroPositivoOuNulo: só inteiro >= 1; o resto não filtra', () => {
    expect(inteiroPositivoOuNulo(7.5)).toBe(7)
    expect(inteiroPositivoOuNulo('30')).toBe(30)
    expect(inteiroPositivoOuNulo(0)).toBeNull()
    expect(inteiroPositivoOuNulo(-5)).toBeNull()
    expect(inteiroPositivoOuNulo(0.4)).toBeNull()
    expect(inteiroPositivoOuNulo(undefined)).toBeNull()
    expect(inteiroPositivoOuNulo('x')).toBeNull()
  })

  it('dataAAAAMMDD: só data de verdade', () => {
    expect(dataAAAAMMDD('2026-11-12')).toBe('2026-11-12')
    expect(dataAAAAMMDD('2026-11-12T10:00:00Z')).toBe('2026-11-12')
    expect(dataAAAAMMDD('2026-02-30')).toBeNull()
    expect(dataAAAAMMDD('12/11/2026')).toBeNull()
    expect(dataAAAAMMDD(20261112)).toBeNull()
  })

  it('o executor usa a validação onde mexe com dias e limite', () => {
    expect(caso('ficha_do_credito')).toContain('inteiroEntre(args.movimentacoes, { min: 1, max: 40, padrao: 15 })')
    expect(caso('buscar_movimentacoes')).toContain('const dias = inteiroPositivoOuNulo(args.dias)')
    expect(caso('contar_publicacoes')).toContain('const dias = inteiroPositivoOuNulo(args.dias)')
    expect(caso('listar_publicacoes')).toContain('const dias = inteiroPositivoOuNulo(args.dias)')
    expect(caso('processos_parados')).toContain('inteiroEntre(args.dias, { min: 1, max: 3650, padrao: 20 })')
    expect(caso('funil_comercial')).toContain('inteiroPositivoOuNulo(args.parados_ha_dias)')
    for (const nome of ['buscar_movimentacoes', 'contar_publicacoes', 'listar_publicacoes', 'processos_parados']) {
      expect(caso(nome), nome).not.toContain("typeof args.dias === 'number'")
    }
  })
})

// ------------------------------------------------------- número do processo

describe('o número do processo casa pelos dígitos, com ou sem máscara', () => {
  const MASCARADO = '0001234-56.2020.8.09.0051'
  const CRU = '00012345620208090051'

  it('o número inteiro casa as duas grafias e nada além', () => {
    const re = new RegExp(regexDosDigitos(CRU, { inteiro: true }), 'i')
    expect(re.test(MASCARADO)).toBe(true)
    expect(re.test(CRU)).toBe(true)
    expect(re.test(` ${MASCARADO} `)).toBe(true)
    expect(re.test(`${CRU}1`)).toBe(false)
    expect(re.test(`9${MASCARADO}`)).toBe(false)
    // O mascarado como pedido também acha o cru.
    expect(new RegExp(regexDosDigitos(MASCARADO, { inteiro: true })).test(CRU)).toBe(true)
  })

  it('o trecho casa no meio, atravessando a máscara', () => {
    const re = new RegExp(regexDosDigitos('345620', { inteiro: false }))
    expect(re.test(MASCARADO)).toBe(true)
    expect(re.test(CRU)).toBe(true)
    expect(re.test('0009999-11.2021.8.09.0051')).toBe(false)
  })

  it('as duas formas padrão para o .in() do DJEN', () => {
    expect(formasDoNumero(CRU)).toEqual([CRU, MASCARADO])
    expect(formasDoNumero(MASCARADO)).toEqual([CRU, MASCARADO])
    expect(formasDoNumero('123')).toEqual(['123'])
    expect(formasDoNumero('')).toEqual([])
  })

  it('número x nome', () => {
    expect(pareceNumeroDeProcesso(MASCARADO)).toBe(true)
    expect(pareceNumeroDeProcesso(CRU)).toBe(true)
    expect(pareceNumeroDeProcesso('Maria 123')).toBe(false)
    expect(pareceNumeroDeProcesso('Maria')).toBe(false)
  })

  it('o filtro numero_cnj de listar/contar usa a expressão dos dígitos', () => {
    const trecho = fonte.slice(fonte.indexOf('function aplicarFiltrosGenericos'), fonte.indexOf('function desde('))
    expect(trecho).toContain("campo === 'numero_cnj'")
    expect(trecho).toContain("r.filter(\n        campo,\n        'imatch',")
    expect(trecho).toContain("regexDosDigitos(String(valor), { inteiro: operador === 'igual' })")
  })
})

// ------------------------------------------------------ ler_historico_apos_data

describe('ler_historico_apos_data', () => {
  it('o corte de tamanho guarda os MAIS RECENTES', () => {
    const a = [
      { data: '2026-01-01', texto: 'a'.repeat(50) },
      { data: '2026-01-02', texto: 'b'.repeat(50) },
      { data: '2026-01-03', texto: 'c'.repeat(50) },
    ]
    const r = cortarPorTamanho(a, 120)
    expect(r.cortado).toBe(true)
    expect(r.andamentos.map((x) => x.data)).toEqual(['2026-01-02', '2026-01-03'])
    expect(cortarPorTamanho(a, 1000)).toEqual({ andamentos: a, cortado: false })
  })

  it('o mais recente entra sempre, cortado se sozinho já passa', () => {
    const r = cortarPorTamanho([{ texto: 'velho' }, { texto: 'x'.repeat(500) }], 100)
    expect(r.cortado).toBe(true)
    expect(r.andamentos).toHaveLength(1)
    expect(String(r.andamentos[0].texto)).toHaveLength(101)
  })

  it('lê do mais novo para o mais antigo, com gte, dígitos e erro por fonte', () => {
    const t = caso('ler_historico_apos_data')
    expect(t).toContain(".gte('data', desde)")
    expect(t).toContain(".gte('data_disponibilizacao', desde)")
    expect(t).not.toContain(".gt('data', desde)")
    expect(t).not.toContain("{ ascending: true })\n              .limit(20)")
    expect(t.match(/order\('data(_disponibilizacao)?', \{ ascending: false \}\)/g)).toHaveLength(2)
    expect(t).toContain('.limit(POR_FONTE + 1)')
    expect(t).toContain("qMov.eq('numero_digits', digitos)")
    expect(t).not.toContain('digitos.slice(0, 7)')
    expect(t).toContain('erro_movimentacoes: mov.error?.message')
    expect(t).toContain('erro_publicacoes: pub.error?.message')
    expect(t).toContain('truncado: truncadoNoBanco || truncadoPorTamanho || undefined')
    expect(t).toContain('TETO_DE_CARACTERES_DO_HISTORICO / cortados.length')
    expect(TETO_DE_CARACTERES_DO_HISTORICO).toBe(60_000)
  })
})

// ------------------------------------------------------------- ficha e listas

describe('ficha_do_credito e listas com total', () => {
  it('a ficha diz qual parte falhou, em vez de entregar vazio', () => {
    const t = caso('ficha_do_credito')
    expect(t).toContain("ouFalha('apensos', apensos, [])")
    expect(t).toContain("ouFalha('tarefas', tarefas, [])")
    expect(t).toContain("ouFalha('movimentacoes', movs, [])")
    expect(t).toContain("ouFalha('publicacoes', pubs, [])")
    expect(t).toContain("ouFalha('resumo_da_carteira', resumo, null)")
    expect(t).not.toContain('apensos: apensos.data ?? []')
  })

  it('listas que convidam a contar trazem o total exato e aviso_limite', () => {
    for (const nome of ['listar_publicacoes', 'funil_comercial', 'resumos_da_carteira', 'listar_tarefas']) {
      const t = caso(nome)
      expect(t, nome).toContain("count: 'exact'")
      expect(t, nome).toContain('aviso_limite')
    }
    const inv = caso('listar_investidores')
    expect(inv).toContain('total: pessoas.length')
    expect(inv).toContain('aviso_limite')
    // ordem estável nos resumos
    expect(caso('resumos_da_carteira')).toContain(".order('id', { ascending: true })")
  })

  it('listar_tarefas: responsável sobre TODAS as tarefas, piso de prazo, trecho do número', () => {
    const t = caso('listar_tarefas')
    expect(t).toContain('const lidas = await lerTudo(')
    expect(t).toContain("['date_deadline', 'id']")
    expect(t).toContain('normalizarNome(String(r)).includes(alvo)')
    expect(t).toContain("q.gte('date_deadline', prazoDe)")
    expect(t).toContain("q.ilike('numero_digits', `%${d}%`)")
    expect(fonte).toContain("prazo_de: {\n          type: 'string',")
  })
})

// ---------------------------------------------------------- creditos_a_vencer

describe('creditos_a_vencer', () => {
  it('três consultas, cada grupo com o seu total e nome honesto', () => {
    const t = caso('creditos_a_vencer')
    expect(t).toContain("lt('expectativa_liquidacao', hoje)")
    expect(t).toContain("gte('expectativa_liquidacao', hoje)")
    expect(t).toContain("gt('expectativa_liquidacao', fimSemana)")
    expect(t).toContain('atrasados: comTotal(atrasados)')
    expect(t).toContain('proximos_7_dias: comTotal(semana)')
    expect(t).toContain('de_8_a_30_dias: comTotal(mes)')
    expect(t).not.toContain('hoje_ou_atrasado')
  })
})

// ---------------------------------------------------------- buscar_movimentacoes

describe('buscar_movimentacoes', () => {
  it('agrupa por dígitos e marca a verificação que falhou', () => {
    const t = caso('buscar_movimentacoes')
    expect(t).toContain('const chaveDoProcesso = (numero: string) => soDigitos(numero) || numero')
    expect(t).toContain('porProcesso.set(chave, a)')
    expect(t).toContain('!!movRecentes.error ||')
    expect(t).toContain('!!pubRecentes.error ||')
    expect(t).toContain('verificacao_de_atualidade_limitada: verificacaoLimitada || undefined')
    expect(t).toContain(".in('numero_digits', digitosDaAmostra)")
  })
})

// ------------------------------------------------------------- agrupamentos

describe('resumo financeiro: o mesmo nome é um grupo só', () => {
  it('cessionário, originador e ente pela chave normalizada', () => {
    const a = grupoDoValor('cessionario', 'José  da Silva ')
    const b = grupoDoValor('cessionario', 'jose da silva')
    expect(a.chave).toBe(b.chave)
    expect(a.rotulo).toBe('José da Silva')
    expect(grupoDoValor('entidade_devedora', ' Estado de Goiás').chave).toBe(
      grupoDoValor('entidade_devedora', 'ESTADO DE GOIAS ').chave,
    )
    expect(grupoDoValor('originador', '  ')).toEqual({ chave: '', rotulo: 'não informado' })
    expect(grupoDoValor('originador', null).rotulo).toBe('não informado')
  })

  it('status continua exato', () => {
    expect(grupoDoValor('status', 'ativo')).toEqual({ chave: 'ativo', rotulo: 'ativo' })
  })

  it('o executor usa a regra', () => {
    expect(caso('resumo_financeiro_creditos')).toContain('grupoDoValor(dimensao, l[dimensao])')
  })
})

// ---------------------------------------------------------------- investidores

describe('carteira_do_investidor: um investidor só', () => {
  const creditos = [
    { cessionario: 'João Silva' },
    { cessionario: 'joao silva ' },
    { cessionario: 'João Silva Neto' },
    { cessionario: 'Maria Silva' },
  ]

  it('distintos pela chave normalizada, com a contagem', () => {
    const d = investidoresDistintos(creditos)
    expect(d.map((x) => [x.nome, x.creditos])).toEqual([
      ['João Silva', 2],
      ['João Silva Neto', 1],
      ['Maria Silva', 1],
    ])
  })

  it('trecho ambíguo não escolhe; nome exato escolhe; um só escolhe', () => {
    const d = investidoresDistintos(creditos)
    expect(escolherInvestidor('Silva', d)).toBeNull()
    expect(escolherInvestidor('JOÃO SILVA', d)).toBe('joao silva')
    expect(escolherInvestidor('neto', investidoresDistintos([{ cessionario: 'João Silva Neto' }]))).toBe(
      'joao silva neto',
    )
  })

  it('o executor devolve os candidatos, corta a lista e lê os resumos em fatias', () => {
    const t = caso('carteira_do_investidor')
    expect(t).toContain('candidatos: distintos.map(')
    expect(t).toContain('const TETO_DA_CARTEIRA = 60')
    expect(t).toContain('const resumos = await lerPorIds(')
    expect(t).toContain('resumos.erro')
  })
})

describe('listar_investidores: a mesma lista da tela', () => {
  const processos = [
    { cessionario: 'José Souza', originador: 'Dr. Ana' },
    { cessionario: 'Jose  Souza', originador: null },
    { cessionario: 'Carla Sem Ficha', originador: 'Dr. Ana' },
  ]
  const fichas = [
    { tipo: 'investidor', nome_exibicao: 'José Souza (ficha)', nome_chave: 'jose souza', cpf: '1' },
    { tipo: 'investidor', nome_exibicao: 'Só Ficha', nome_chave: 'so ficha' },
    { tipo: 'originador', nome_exibicao: 'Dr. Ana', nome_chave: 'dr. ana' },
  ]

  it('créditos e fichas, créditos contados pela chave da ficha', () => {
    const inv = pessoasDoAssistente('investidor', processos, fichas)
    expect(inv.map((p) => [p.nome, p.creditos, !!p.ficha])).toEqual([
      ['Carla Sem Ficha', 1, false],
      ['José Souza', 2, true],
      ['Só Ficha', 0, true],
    ])
    const ori = pessoasDoAssistente('originador', processos, fichas)
    expect(ori.map((p) => [p.nome, p.creditos])).toEqual([['Dr. Ana', 2]])
  })

  it('os mesmos nomes e chaves de listarPessoas (src/lib/pessoas.ts)', () => {
    const dados = new Map(fichas.map((f) => [f.nome_chave, f as unknown as InvestidorDados]))
    for (const papel of ['investidor', 'originador'] as const) {
      const tela = listarPessoas(papel, processos as never, dados)
      const servidor = pessoasDoAssistente(papel, processos, fichas)
      expect(servidor.map((p) => [p.chave, p.nome])).toEqual(tela.map((p) => [p.chave, p.nome]))
    }
  })

  it('o executor monta pela regra e conta por normalizarNome', () => {
    const t = caso('listar_investidores')
    expect(t).toContain('pessoasDoAssistente(papel, procs, fichasLidas)')
    expect(t).toContain("normalizarNome(String(p[campo] ?? ''))")
    expect(t).not.toContain('.trim().toLowerCase()')
    expect(t).toContain("['ficha inteira (não cadastrada)']")
  })
})

// ----------------------------------------------------------------- paralisados

describe('processos_parados: o critério da tela', () => {
  const C1 = '00012345620208090051'
  const C2 = '00012349920218090051' // mesmo começo de 7 dígitos que C1
  const AP = '55555551120228090051' // apenso do crédito 1
  const creditos = [
    { id: 'c1', numero_cnj: '0001234-56.2020.8.09.0051', cedente: 'A', cessionario: 'X', status: 'ativo' },
    { id: 'c3', numero_cnj: '7777777-11.2019.8.09.0051', cedente: 'C', cessionario: 'Z', status: 'complementar' },
    { id: 'c4', numero_cnj: '8888888-11.2019.8.09.0051', cedente: 'D', cessionario: 'W', status: 'ativo' },
  ]
  const status = [
    { numero_processo: C1, ultima_movimentacao: '2026-09-01' },
    // C2 não é crédito ativo (encerrado ou de fora): com o prefixo de 7 dígitos, herdava o C1.
    { numero_processo: C2, ultima_movimentacao: '2026-01-01' },
    { numero_processo: '7777777-11.2019.8.09.0051', ultima_movimentacao: null },
    { numero_processo: AP, ultima_movimentacao: '2026-06-01' },
    { numero_processo: '88888881120198090051', ultima_movimentacao: '2026-05-01' },
  ]
  const r = paradosDaCarteira({
    status,
    creditos,
    apensos: [{ numero: '5555555-11.2022.8.09.0051', processo_id: 'c1' }],
    // o C4 teve andamento na janela, mesmo com o status atrasado
    comMovimentoNaJanela: new Set(['88888881120198090051']),
    corte: '2026-10-23',
    hoje: '2026-11-12',
  })

  it('dígitos inteiros, apenso herda o pai, andamento na janela tira da lista', () => {
    expect(r.map((p) => p.numero_processo)).toEqual([AP, C1, '7777777-11.2019.8.09.0051'])
    expect(r[0]).toMatchObject({ via_apenso: true, cedente: 'A', numero_cnj_do_credito: creditos[0].numero_cnj })
  })

  it('do MAIS parado ao menos parado, sem movimentação no fim, com os dias', () => {
    expect(r[0].dias_parado).toBe(diasEntre('2026-06-01', '2026-11-12'))
    expect(r[2].ultima_movimentacao).toBeNull()
    expect(r[2].dias_parado).toBeNull()
  })

  it('quem andou depois do corte não é parado', () => {
    const s = paradosDaCarteira({
      status: [{ numero_processo: C1, ultima_movimentacao: '2026-11-01' }],
      creditos,
      apensos: [],
      comMovimentoNaJanela: new Set(),
      corte: '2026-10-23',
      hoje: '2026-11-12',
    })
    expect(s).toEqual([])
  })

  it('a mesma ordem de ordenarParalisados (a da tela)', () => {
    const lista = [{ u: '2026-05-01' }, { u: null }, { u: '2026-01-01' }, { u: '2026-09-09' }, { u: null }]
    expect(ordenarDoMaisParado(lista, (x) => x.u)).toEqual(ordenarParalisados(lista, (x) => x.u))
  })

  it('o executor usa a regra e lê apensos e andamentos da janela', () => {
    const t = caso('processos_parados')
    expect(t).toContain('paradosDaCarteira({')
    expect(t).toContain("svc.from('apensos').select('numero, processo_id')")
    expect(t).toContain("svc.from('advbox_movimentacoes').select('numero_digits').gte('data', corte)")
    expect(t).not.toContain('.slice(0, 7)')
    expect(fonte).toContain('do MAIS parado ao menos parado')
  })
})

// ------------------------------------------------------------ funil_comercial

describe('funil_comercial', () => {
  it('parados por etapa_em, mais parado primeiro, colunas 142/143 com nome, erro das colunas dito', () => {
    const t = caso('funil_comercial')
    expect(t).toContain(".lte('etapa_em', desde(paradosHaDias))")
    expect(t).toContain(".order('etapa_em', { ascending: true })")
    expect(t).toContain(".not('status_id', 'in', '(142,143)')")
    expect(t).toContain('COLUNAS_DO_SISTEMA[Number(c.status_id)]')
    expect(t).toContain('erro_colunas: erroEtapas')
    expect(fonte).toContain("parados_ha_dias: {\n          type: 'integer',")
  })
})

// --------------------------------------------------------------- erros

describe('erro da Anthropic sempre em português', () => {
  it('prompt grande demais pede um recorte menor', () => {
    const m = traduzirErroDaAnthropic(400, 'prompt is too long: 215000 tokens > 200000 maximum')
    expect(m).toMatch(/grande demais/)
    expect(m).toMatch(/recorte menor/)
    expect(m).not.toMatch(/prompt is too long/)
  })

  it('container expirado tem frase própria', () => {
    expect(traduzirErroDaAnthropic(400, 'Container container_abc has expired')).toMatch(/expirou/)
    expect(traduzirErroDaAnthropic(404, 'container not found')).toMatch(/expirou/)
  })

  it('o que não tem frase própria mantém o código HTTP, sem o inglês', () => {
    const m = traduzirErroDaAnthropic(400, 'messages.3.content: unexpected thing')
    expect(m).toContain('HTTP 400')
    expect(m).not.toContain('unexpected')
    expect(traduzirErroDaAnthropic(undefined, 'boom')).not.toContain('boom')
  })

  it('os casos de antes continuam', () => {
    expect(traduzirErroDaAnthropic(401, '')).toMatch(/chave de API/)
    expect(traduzirErroDaAnthropic(429, '')).toMatch(/Limite de uso/)
    expect(traduzirErroDaAnthropic(400, 'Your credit balance is too low')).toMatch(/sem crédito/)
    expect(traduzirErroDaAnthropic(529, 'Overloaded')).toMatch(/indisponível/)
    expect(traduzirErroDaAnthropic(413, 'request_too_large')).toMatch(/tamanho/)
  })

  it('handler e uploads passam pela tradução', () => {
    expect(fonte).toContain('return traduzirErroDaAnthropic(typeof status === ')
    expect(fonte).toContain("traduzirErroDaAnthropic(resp.status, String(corpo?.error?.message ?? ''))")
    expect(fonte).not.toMatch(/\n  return bruto\n/)
  })
})

// ------------------------------------------------------------------- modelos

describe('modelos do assistente', () => {
  it('a geração vigente nas três famílias, e o padrão é o Sonnet', () => {
    expect(MODELOS_DO_ASSISTENTE.map((m) => m.key)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
    expect(MODELO_PADRAO_DO_ASSISTENTE).toBe(SONNET_VIGENTE)
  })

  it('os três aceitam raciocínio adaptativo e esforço; o resto, não', () => {
    for (const m of MODELOS_DO_ASSISTENTE) expect(aceitaRaciocinioAdaptativo(m.key), m.key).toBe(true)
    expect(aceitaRaciocinioAdaptativo('claude-haiku-4-5-20251001')).toBe(false)
    expect(aceitaRaciocinioAdaptativo('qualquer')).toBe(false)
  })

  it('o id guardado no navegador antes da troca continua valendo, na mesma família', () => {
    expect(resolverModeloDoAssistente('claude-haiku-4-5-20251001')).toBe(HAIKU_VIGENTE)
    expect(resolverModeloDoAssistente('claude-sonnet-5')).toBe(SONNET_VIGENTE)
    expect(resolverModeloDoAssistente('claude-opus-5')).toBe(OPUS_VIGENTE)
    expect(modeloVigente('outro')).toBe('outro')
    expect(resolverModeloDoAssistente('outro')).toBe(MODELO_PADRAO_DO_ASSISTENTE)
  })

  it('o handler usa a lista, e não o prefixo do Haiku', () => {
    expect(fonte).not.toContain("startsWith('claude-haiku')")
    expect(fonte).toContain('const comRaciocinio = aceitaRaciocinioAdaptativo(modeloResolvido)')
  })
})

// ----------------------------------------------------------- base do Kommo

describe('base do Kommo mais leve', () => {
  const ETAPAS: EtapaDoEspelho[] = [
    { pipeline_id: 2, status_id: 20, pipeline_nome: 'PRECATÓRIO EXTERNO', nome: 'NEGOCIAÇÃO', ordem: 5 },
    { pipeline_id: 2, status_id: 10, pipeline_nome: 'PRECATÓRIO EXTERNO', nome: 'EM PRECIFICAÇÃO', ordem: 3 },
  ]
  const linha = (x: Partial<LinhaDoEspelho>): LinhaDoEspelho => ({
    kommo_lead_id: 1, pipeline_id: 2, status_id: 20, nome: 'Card', responsavel_nome: 'Ana',
    processo_cnj: '0001', tags: [], tags_em: {}, criado_em: '2026-10-01T00:00:00Z', atualizado_em: null,
    etapa_em: null, sincronizado_em: '2026-11-12T10:00:00Z', raw: {}, notas: [], ...x,
  })
  const porChave = new Map(ETAPAS.map((e) => [`${e.pipeline_id}:${e.status_id}`, e]))

  it('nota de anexo sai; nota longa é cortada em 1.500 caracteres e marcada', () => {
    const c = cardDaBase(
      linha({
        notas: [
          { texto: 'contrato.pdf', tipo: 'attachment' },
          { texto: 'x'.repeat(TETO_DO_TEXTO_DA_NOTA + 300), tipo: 'common' },
          { texto: 'curta', tipo: 'common' },
        ],
      }),
      porChave,
    )
    expect(c.notas).toHaveLength(2)
    expect(c.notas[0].texto).toHaveLength(TETO_DO_TEXTO_DA_NOTA + 1)
    expect(c.notas[0]).toMatchObject({ texto_cortado: true })
    expect(c.notas[1]).not.toHaveProperty('texto_cortado')
  })

  it('a base em pedaços é o MESMO arquivo de montarBaseDoKommo', () => {
    const linhas = [
      linha({ notas: [{ texto: 'a "citação" \\ com barra', tipo: 'common' }] }),
      linha({ kommo_lead_id: 2, status_id: 143, sincronizado_em: '2026-11-12T09:45:00Z' }),
      linha({ kommo_lead_id: 3, sincronizado_em: null }),
    ]
    const agora = new Date('2026-11-12T10:05:00Z')
    const b = baseDoKommoEmPedacos(ETAPAS)
    b.adicionar(linhas.slice(0, 1))
    b.adicionar(linhas.slice(1))
    expect(b.total).toBe(3)
    expect(b.pedacos(agora).join('')).toBe(JSON.stringify(montarBaseDoKommo(linhas, ETAPAS, agora)))
  })

  it('base vazia ainda é JSON válido', () => {
    const lido = JSON.parse(baseDoKommoEmPedacos(ETAPAS).pedacos(new Date('2026-11-12T10:05:00Z')).join(''))
    expect(lido).toMatchObject({ total_de_cards: 0, sincronizado_desde: null, cards: [] })
  })

  it('as colunas de sistema (ganho/perdido) são exportadas', () => {
    expect(COLUNAS_DO_SISTEMA[142]).toMatch(/Ganho/)
    expect(COLUNAS_DO_SISTEMA[143]).toMatch(/Perdido/)
  })

  it('a leitura é página a página, com o relógio e o sinal do teto', () => {
    const t = fonte.slice(fonte.indexOf('async function anexarBaseDoKommo'), fonte.indexOf('function tipoDeBloco'))
    expect(t).toContain('tempoAteOTeto(inicio, Date.now(), { minimoMs: 0 }) < TEMPO_MINIMO_PARA_O_MODELO_MS')
    expect(t).toContain('const TEMPO_MINIMO_PARA_O_MODELO_MS = 40_000')
    expect(t).toContain('.abortSignal(sinal)')
    expect(t).toContain('base.adicionar(')
    expect(t).toContain('new Blob(base.pedacos(new Date())')
    expect(t).not.toContain('JSON.stringify(base)')
    expect(t).toContain('paraApagar.push(String(corpo.id))')
  })
})

// --------------------------------------------------------------- o handler

describe('handler: container, arquivos, rodadas e histórico', () => {
  it('o container é guardado depois de TODA resposta e reusado nos dois caminhos', () => {
    expect(fonte).toContain('containerId = resposta.container?.id ?? containerId')
    // guardado logo depois de a resposta entrar na conversa, antes de qualquer desvio
    const guarda = fonte.indexOf('containerId = resposta.container?.id ?? containerId')
    const pausa = fonte.indexOf("if (resposta.stop_reason === 'pause_turn' && rodada < MAX_RODADAS - 1) {")
    expect(guarda).toBeGreaterThan(-1)
    expect(guarda).toBeLessThan(pausa)
    expect(fonte).toContain('...(containerId ? { id: containerId } : {}),')
    expect(fonte).toContain('.container = containerId')
    expect(fonte).not.toContain('containerPausado')
  })

  it('os arquivos enviados e os gerados são apagados da Anthropic no finally', () => {
    expect(fonte).toContain("method: 'DELETE'")
    expect(fonte).toContain('https://api.anthropic.com/v1/files/${encodeURIComponent(id)}')
    expect(fonte).toMatch(/\} finally \{\n[\s\S]*?emSegundoPlano\(apagarArquivosDaAnthropic\(arquivosParaApagar, chaveParaApagar\)\)/)
    // anexos: anotados assim que sobem (o 1º é apagado se o 2º falhar)
    const anexos = fonte.slice(fonte.indexOf('async function anexarArquivosDeEntrada'), fonte.indexOf('async function apagarArquivosDaAnthropic'))
    expect(anexos).toContain('paraApagar.push(fileId)')
    // gerados: só depois de copiados para o Storage
    const gerados = fonte.slice(fonte.indexOf('async function extrairArquivosGerados'), fonte.indexOf('const SISTEMA_BASE_KOMMO'))
    const copia = gerados.indexOf(".from('assistente-arquivos')\n        .upload(")
    const anota = gerados.indexOf('paraApagar?.push(fileId)')
    expect(copia).toBeGreaterThan(-1)
    expect(anota).toBeGreaterThan(copia)
  })

  it('rodadas esgotadas entregam o que existe, marcado como incompleto', () => {
    expect(fonte).toContain('return await entregarParcial()')
    const parcial = fonte.slice(fonte.indexOf('const entregarParcial = async () => {'), fonte.indexOf('let containerId'))
    expect(parcial).toContain('truncada: true')
    expect(parcial).toContain('acao_proposta: acaoProposta')
    expect(parcial).toContain('contato_sugerido: contatoProposto')
    expect(parcial).toContain('arquivos: arquivos.length > 0 ? arquivos : undefined')
    // depois do laço não há mais o 504 genérico
    const fimDoLaco = fonte.slice(fonte.indexOf("mensagens.push({ role: 'user', content: resultados })"), fonte.indexOf('} catch (err) {', fonte.indexOf("mensagens.push({ role: 'user', content: resultados })")))
    expect(fimDoLaco).not.toContain('PERGUNTA_LONGA_DEMAIS')
  })

  it('o histórico guarda 30 mensagens, e o comentário diz isso', () => {
    expect(fonte).toContain('const MENSAGENS_DO_HISTORICO = 30')
    expect(fonte).toContain('.slice(-MENSAGENS_DO_HISTORICO)')
    expect(fonte).not.toContain('.slice(-20)')
    expect(fonte).toContain('30 MENSAGENS')
  })
})
