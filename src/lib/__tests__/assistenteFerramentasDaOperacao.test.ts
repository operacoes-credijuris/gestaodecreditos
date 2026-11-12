/**
 * AS FERRAMENTAS DA OPERAÇÃO DO ASSISTENTE (12/11/2026): fase processual, ficha
 * do card, resumo do funil, contratos e due diligence.
 *
 * Três camadas: as regras puras (nomes de fase, leitura de cotação, data da
 * coluna), a paridade com a tela (rótulos de fase iguais aos de src/lib/labels.ts,
 * contagem igual à da aba Fase processual) e os executores INTEIROS rodando
 * contra um banco de mentira — sem rede, sem Anthropic, sem o banco de produção.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FASE_ATIVO_ORDEM, FASE_COMPLEMENTAR_ORDEM, FASE_PROCESSUAL } from '@/lib/labels'
import {
  contarComoATela,
  FASE_ATIVO_ORDEM as ORDEM_ATIVO_SERVIDOR,
  FASE_COMPLEMENTAR_ORDEM as ORDEM_COMPLEMENTAR_SERVIDOR,
  FASE_PROCESSUAL_ROTULOS,
  lerFasePedida,
  rotuloDaFase,
} from '../../../supabase/functions/_shared/rotulosDaFase.ts'
import {
  analiseProntaDoCard,
  cardCasaComDigitos,
  cotacoesDoCardLegiveis,
  dataDoArgumento,
  etiquetasComData,
  executarDaOperacao,
  FERRAMENTAS_DA_OPERACAO,
  funisPedidos,
  naColunaDesde,
  notasRecentes,
  oportunidadeLegivel,
} from '../../../supabase/functions/assistente/ferramentasDaOperacao.ts'
import { BancoFalso, comoCliente } from './bancoFalsoDoAssistente'

const raiz = join(__dirname, '..', '..', '..')
const ler = (rel: string) => readFileSync(join(raiz, rel), 'utf8').replace(/\r\n/g, '\n')
const AGORA = new Date('2026-11-12T15:00:00Z')

async function rodar(banco: BancoFalso, nome: string, args: Record<string, unknown> = {}) {
  const r = await executarDaOperacao(comoCliente(banco), nome, args, AGORA)
  expect(r).not.toBeNull()
  return JSON.parse(r as string)
}

// ------------------------------------------------------------------ rótulos

describe('rótulos da fase: a cópia do servidor é igual à da tela', () => {
  it('mesmos códigos, nomes e tons de src/lib/labels.ts', () => {
    expect(FASE_PROCESSUAL_ROTULOS).toEqual(FASE_PROCESSUAL)
  })
  it('mesma ordem de cards nas duas trilhas', () => {
    expect(ORDEM_ATIVO_SERVIDOR).toEqual(FASE_ATIVO_ORDEM)
    expect(ORDEM_COMPLEMENTAR_SERVIDOR).toEqual(FASE_COMPLEMENTAR_ORDEM)
  })
  it('código fora da taxonomia volta como está (o getLabel da tela)', () => {
    expect(rotuloDaFase('ATV-04')).toBe('ATV-04')
    expect(rotuloDaFase('ATV-03')).toBe('Sequestro')
  })
})

describe('lerFasePedida', () => {
  const codigos = (t: string, trilha?: 'ativo' | 'complementar') => {
    const r = lerFasePedida(t, trilha)
    return r.tipo === 'codigos' ? r.codigos : r.tipo
  }
  it('código, com ou sem hífen', () => {
    expect(codigos('ATV-03')).toEqual(['ATV-03'])
    expect(codigos('cmp 06')).toEqual(['CMP-06'])
  })
  it('conclusos é atributo, não fase', () => {
    expect(codigos('conclusos para decisão')).toBe('conclusos')
    expect(codigos('Concluso')).toBe('conclusos')
  })
  it('nomes nas duas trilhas, e só na pedida', () => {
    expect(codigos('sequestro')).toEqual(['ATV-03', 'CMP-06'])
    expect(codigos('Alvarás')).toEqual(['ATV-06', 'CMP-08'])
    expect(codigos('penhora', 'complementar')).toEqual(['CMP-07'])
    expect(codigos('período de graça')).toEqual(['ATV-02', 'CMP-05'])
  })
  it('homologação aguarda (ATV-01); homologado já passou (ATV-02)', () => {
    expect(codigos('homologação')).toEqual(['ATV-01'])
    expect(codigos('homologado')).toEqual(['ATV-02'])
  })
  it('bloqueio é como a equipe chama o sequestro', () => {
    expect(codigos('pedido de bloqueio')).toEqual(['ATV-03', 'CMP-06'])
  })
  it('as opções do menu "Consultar processos por situação" se leem', () => {
    expect(codigos('alvará expedido e ainda não cumprido')).toEqual(['ATV-06', 'CMP-08'])
    expect(codigos('sem decisão de homologação')).toEqual(['ATV-01'])
  })
  it('o que não se reconhece devolve as opções', () => {
    const r = lerFasePedida('xyz')
    expect(r.tipo).toBe('desconhecida')
    if (r.tipo === 'desconhecida') expect(r.opcoes).toContain('ATV-01 — Aguardando Homologação')
  })
})

describe('contarComoATela (o laço da aba Fase processual)', () => {
  it('trilha pelo status, sem linha = sem classificação, concluso à parte, código antigo separado', () => {
    const c = contarComoATela(
      [
        { id: '1', status: 'ativo' },
        { id: '2', status: 'ativo' },
        { id: '3', status: 'ativo' },
        { id: '4', status: 'complementar' },
        { id: '5', status: 'encerrado' },
      ],
      [
        { processo_id: '1', fase_codigo: 'ATV-03', conclusao_pendente: true },
        { processo_id: '2', fase_codigo: 'ATV-04', conclusao_pendente: false },
        { processo_id: '4', fase_codigo: 'CMP-06', conclusao_pendente: false },
        { processo_id: '5', fase_codigo: 'ATV-01', conclusao_pendente: true },
      ],
    )
    expect(c.ativo.creditos).toBe(3)
    expect(c.ativo.sem_classificacao).toBe(1)
    expect(c.ativo.conclusos).toBe(1)
    expect(c.ativo.por_fase.find((f) => f.codigo === 'ATV-03')?.quantidade).toBe(1)
    expect(c.ativo.por_fase.find((f) => f.codigo === 'ATV-01')?.quantidade).toBe(0)
    expect(c.ativo.fora_da_taxonomia).toEqual({ 'ATV-04': 1 })
    expect(c.ativo.por_fase.map((f) => f.codigo)).toEqual(FASE_ATIVO_ORDEM)
    expect(c.complementar.por_fase.find((f) => f.codigo === 'CMP-06')?.quantidade).toBe(1)
  })
})

// ------------------------------------------------------------------ regras puras

describe('regras puras das fichas', () => {
  it('a data da coluna só vale para a coluna atual', () => {
    expect(naColunaDesde({ status_id: 1, etapa_status_id: 1, etapa_em: '2026-11-01T00:00:00Z' })).toBe('2026-11-01T00:00:00Z')
    expect(naColunaDesde({ status_id: 2, etapa_status_id: 1, etapa_em: '2026-11-01T00:00:00Z' })).toBeNull()
  })
  it('análise pronta só enquanto o card estiver na coluna em que foi marcado', () => {
    expect(analiseProntaDoCard({ status_id: 10 }, { status_id_quando_marcado: 10 })).toBe(true)
    expect(analiseProntaDoCard({ status_id: 11 }, { status_id_quando_marcado: 10 })).toBe(false)
    expect(analiseProntaDoCard({ status_id: 10 }, undefined)).toBe(false)
  })
  it('o número inteiro decide: o mesmo começo de outro ano não casa', () => {
    expect(cardCasaComDigitos({ processo_cnj: '0001234-56.2020.8.09.0051' }, '00012345620208090051')).toBe(true)
    expect(cardCasaComDigitos({ processo_cnj: '0001234-56.2021.8.09.0051' }, '00012345620208090051')).toBe(false)
    expect(cardCasaComDigitos({ nome: 'Ana - Joao - 0001234-56.2020.8.09.0051 - 2 - 30%' }, '00012345620208090051')).toBe(true)
  })
  it('datas do modelo: AAAA-MM-DD, ou nada, ou recusa', () => {
    expect(dataDoArgumento('2026-11-01')).toBe('2026-11-01')
    expect(dataDoArgumento(undefined)).toBeNull()
    expect(dataDoArgumento('01/11/2026')).toBe(false)
  })
  it('cotações legíveis: limitada, spread, e o aviso do campo Domus que era da Invest', () => {
    const campos = [
      { field_name: 'PJus', values: [{ value: 'R$ 850.000,00 / R$ 40.000,00' }] },
      { field_name: 'Domus', values: [{ value: 'R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)' }] },
      { field_name: 'BTG', values: [{ value: '' }] },
    ]
    const { cotacoes, aviso } = cotacoesDoCardLegiveis(campos, ['Cotado PJus'])
    expect(cotacoes.map((c) => c.fundo)).toEqual(['PJus', 'Domus'])
    expect(cotacoes[0]).toMatchObject({ proposta: 'R$ 850.000,00', comissao: 'R$ 40.000,00' })
    expect(cotacoes[1].comissao).toContain('spread de 5%')
    expect(aviso).toContain('INVEST')
    // Com etiqueta da Domus, o valor é da Domus: sem aviso.
    expect(cotacoesDoCardLegiveis(campos, ['Cotado Domus']).aviso).toBeUndefined()
  })
  it('etiquetas com a data em que entraram', () => {
    expect(etiquetasComData(['Enviado PJus', 'Outra'], { 'Enviado PJus': '2026-11-03T10:00:00Z' })).toEqual([
      { etiqueta: 'Enviado PJus', desde: '2026-11-03T10:00:00Z' },
      { etiqueta: 'Outra', desde: null },
    ])
  })
  it('notas: as mais recentes primeiro, cortadas, sem as vazias', () => {
    const n = notasRecentes(
      [
        { texto: 'antiga', criado_em: '2026-10-01T00:00:00Z' },
        { texto: '', criado_em: '2026-11-10T00:00:00Z' },
        { texto: 'x'.repeat(900), criado_em: '2026-11-05T00:00:00Z', automatica: true },
      ],
      5,
    )
    expect(n).toHaveLength(2)
    expect(n[0].do_sistema).toBe(true)
    expect(String(n[0].texto).length).toBeLessThan(710)
    expect(n[1].texto).toBe('antiga')
  })
  it('oportunidade torta não derruba a ficha', () => {
    expect(oportunidadeLegivel({ dataPagamento: 12 })).toBeNull()
    expect(oportunidadeLegivel({ ficha: { cedente: 'Maria', valor_cedido: 100000 } })).toContain('Maria')
  })
  it('funis pelo apelido da equipe', () => {
    expect(funisPedidos('RPV', [])).toEqual([13901939])
    expect(funisPedidos('precatório', [])).toEqual([14439512, 14439516])
    expect(funisPedidos(undefined, [])).toBeNull()
    expect(funisPedidos('nada', [])).toEqual([])
  })
})

// ------------------------------------------------------------------ declaradas × executadas

describe('ferramentas da operação: declaradas × executadas', () => {
  const fonte = ler('supabase/functions/assistente/ferramentasDaOperacao.ts')
  const indice = ler('supabase/functions/assistente/index.ts')
  const declaradas = FERRAMENTAS_DA_OPERACAO.map((f) => f.name)
  const executadas = [...fonte.matchAll(/^\s*case '([a-z_]+)': \{/gm)].map((m) => m[1])
  const doIndice = [...indice.matchAll(/^\s*name: '([a-z_]+)',\s*$/gm)].map((m) => m[1])

  it('as cinco, cada uma com executor', () => {
    expect(declaradas.sort()).toEqual(
      ['fase_processual', 'ficha_do_card', 'listar_contratos', 'resumo_do_funil', 'situacao_due_diligence'].sort(),
    )
    expect(executadas.sort()).toEqual([...declaradas].sort())
  })
  it('nenhum nome repetido entre o index.ts e este arquivo', () => {
    const todas = [...doIndice, ...declaradas]
    expect(new Set(todas).size).toBe(todas.length)
  })
  it('as que liam tabelas mortas saíram do index.ts, declaração e executor', () => {
    for (const morta of ['listar_analises', 'resumo_cessoes']) {
      expect(indice).not.toContain(`'${morta}'`)
    }
    expect(indice).not.toContain(".from('analises_credito')")
    expect(indice).not.toContain(".from('cessoes')")
    // situacao_due_diligence mudou de casa: nada dela ficou no index.ts.
    expect(indice).not.toContain("case 'situacao_due_diligence'")
  })
  it('o index.ts espalha as definições e manda o nome desconhecido para cá', () => {
    expect(indice).toContain('  ...FERRAMENTAS_DA_OPERACAO,\n]')
    expect(indice).toContain('const daOperacao = await executarDaOperacao(svc, nome, args)')
    expect(indice).toContain('if (daOperacao !== null) return daOperacao')
  })
  it('nome que não é de ninguém continua "desconhecido"', async () => {
    expect(await executarDaOperacao(comoCliente(new BancoFalso({})), 'nao_existe', {})).toBeNull()
  })
  it('as leituras grandes são paginadas e nenhuma ferramenta escreve', () => {
    expect(fonte).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(fonte).not.toMatch(/\.rpc\(/)
  })
  it('contratos: do jsonb `dados` saem só campos sem documento nem conta', () => {
    const colunas = /const COLUNAS_DO_CONTRATO =([\s\S]*?)\n\n/.exec(fonte)?.[1] ?? ''
    expect(colunas).toContain('dados->>CEDENTE_NOME')
    expect(colunas).not.toMatch(/CPF|CNPJ|RG|BANCO|AGENCIA|CONTA|PIX|ENDERECO/)
    expect(colunas).not.toMatch(/(^|[ ,'])dados(,|'|$)/)
  })
})

// ------------------------------------------------------------------ fase_processual

function bancoDaFase(extraProcessos = 0) {
  const processos = [
    { id: 'p1', numero_cnj: '0000001-11.2024.8.09.0001', cedente: 'Ana', cessionario: 'Inv A', status: 'ativo' },
    { id: 'p2', numero_cnj: '0000002-22.2024.8.09.0001', cedente: 'Bia', cessionario: 'Inv B', status: 'ativo' },
    { id: 'p3', numero_cnj: '0000003-33.2024.8.09.0001', cedente: 'Caio', cessionario: 'Inv A', status: 'ativo' },
    { id: 'p4', numero_cnj: '0000004-44.2024.8.09.0001', cedente: 'Duda', cessionario: 'Inv C', status: 'complementar' },
    { id: 'p5', numero_cnj: '0000005-55.2024.8.09.0001', cedente: 'Edu', cessionario: 'Inv C', status: 'encerrado' },
    ...Array.from({ length: extraProcessos }, (_, i) => ({
      id: `x${String(i).padStart(5, '0')}`,
      numero_cnj: `9${String(i).padStart(6, '0')}-00.2024.8.09.0001`,
      cedente: `Extra ${i}`,
      cessionario: 'Inv Z',
      status: 'ativo',
    })),
  ]
  const fase = (id: string, codigo: string, extra: Record<string, unknown> = {}) => ({
    processo_id: id,
    fase_codigo: codigo,
    data_entrada_fase: '2026-10-01',
    conclusao_pendente: false,
    conclusao_desde: null,
    data_limite_pagamento: null,
    situacao_id: null,
    situacao_data: null,
    movimentacao_ancora_data: '2026-10-01',
    movimentacao_ancora_texto: 'Decisão deferindo o sequestro.',
    classificado_em: '2026-11-11T09:00:00Z',
    ...extra,
  })
  return new BancoFalso({
    processos,
    processos_fase: [
      fase('p1', 'ATV-03', { conclusao_pendente: true, conclusao_desde: '2026-11-02', situacao_id: 's1', situacao_data: '2026-11-05' }),
      fase('p2', 'ATV-06', { data_limite_pagamento: '2026-11-20', data_entrada_fase: '2026-10-15' }),
      fase('p4', 'CMP-06', { classificado_em: '2026-11-12T08:00:00Z' }),
      fase('p5', 'ATV-01'),
      ...Array.from({ length: extraProcessos }, (_, i) => fase(`x${String(i).padStart(5, '0')}`, 'ATV-01')),
    ],
    processos_fase_situacoes_catalogo: [{ id: 's1', fase_codigo: 'ATV-03', nome: 'Cobrado no gabinete' }],
    processos_fase_mudancas: [
      { id: 'm1', processo_id: 'p1', fase_anterior: 'ATV-02', fase_nova: 'ATV-03', origem: 'auto', movimentacao_ancora_data: '2026-11-08', movimentacao_ancora_texto: 'Sequestro deferido', criado_em: '2026-11-09T12:00:00Z' },
      { id: 'm2', processo_id: 'p4', fase_anterior: null, fase_nova: 'CMP-06', origem: 'manual', criado_em: '2026-11-10T12:00:00Z' },
      { id: 'm3', processo_id: 'p2', fase_anterior: 'ATV-05', fase_nova: 'ATV-06', origem: 'auto', criado_em: '2026-10-01T12:00:00Z' },
    ],
  })
}

describe('fase_processual', () => {
  it('sem filtro: a contagem da aba, por trilha, com a situação e a data da classificação', async () => {
    const r = await rodar(bancoDaFase(), 'fase_processual')
    expect(r.contagem.ativo.creditos).toBe(3)
    expect(r.contagem.ativo.sem_classificacao).toBe(1)
    expect(r.contagem.ativo.conclusos).toBe(1)
    const seq = r.contagem.ativo.por_fase.find((f: { codigo: string }) => f.codigo === 'ATV-03')
    expect(seq).toMatchObject({ fase: 'Sequestro', quantidade: 1, por_situacao: { 'Cobrado no gabinete': 1 } })
    // O encerrado (p5) não conta, como na aba.
    expect(r.contagem.ativo.por_fase.find((f: { codigo: string }) => f.codigo === 'ATV-01').quantidade).toBe(0)
    expect(r.contagem.complementar.por_fase.find((f: { codigo: string }) => f.codigo === 'CMP-06').quantidade).toBe(1)
    expect(r.classificacao_mais_recente).toBe('2026-11-12T08:00:00Z')
    expect(r.creditos).toBeUndefined()
    expect(r.fonte).toContain('Fase processual')
  })

  it('passa de 1000 créditos sem perder ninguém (lê em páginas)', async () => {
    const r = await rodar(bancoDaFase(2500), 'fase_processual')
    expect(r.contagem.ativo.creditos).toBe(2503)
    expect(r.contagem.ativo.por_fase.find((f: { codigo: string }) => f.codigo === 'ATV-01').quantidade).toBe(2500)
  })

  it('por nome de fase, nas duas trilhas ou só na pedida', async () => {
    const duas = await rodar(bancoDaFase(), 'fase_processual', { fase: 'sequestro' })
    expect(duas.creditos.total).toBe(2)
    expect(duas.recorte.fase).toContain('ATV-03')
    const ativo = await rodar(bancoDaFase(), 'fase_processual', { fase: 'sequestro', trilha: 'ativo' })
    expect(ativo.creditos.lista.map((c: { numero_cnj: string }) => c.numero_cnj)).toEqual(['0000001-11.2024.8.09.0001'])
    expect(ativo.contagem.complementar).toBeUndefined()
  })

  it('conclusos: o atributo, com a data, e a situação marcada', async () => {
    const r = await rodar(bancoDaFase(), 'fase_processual', { fase: 'conclusos' })
    expect(r.creditos.total).toBe(1)
    expect(r.creditos.lista[0]).toMatchObject({
      cedente: 'Ana',
      concluso_desde: '2026-11-02',
      situacao: 'Cobrado no gabinete',
      fase: 'Sequestro (ATV-03)',
    })
  })

  it('janela da data limite de pagamento, em ordem de vencimento', async () => {
    const r = await rodar(bancoDaFase(), 'fase_processual', { limite_pagamento_ate: '2026-11-30' })
    expect(r.creditos.total).toBe(1)
    expect(r.creditos.lista[0].data_limite_pagamento).toBe('2026-11-20')
    expect(r.creditos.ordem).toContain('data limite')
  })

  it('situação por trecho do nome, sem acento', async () => {
    const r = await rodar(bancoDaFase(), 'fase_processual', { situacao: 'cobrado' })
    expect(r.creditos.total).toBe(1)
    const sem = await rodar(bancoDaFase(), 'fase_processual', { sem_situacao: true })
    expect(sem.creditos.total).toBe(2)
  })

  it('lista cortada diz quantos faltam', async () => {
    const r = await rodar(bancoDaFase(30), 'fase_processual', { fase: 'ATV-01', limite: 10 })
    expect(r.creditos.total).toBe(30)
    expect(r.creditos.lista).toHaveLength(10)
    expect(r.creditos.aviso_limite).toContain('10 de 30')
  })

  it('mudanças de fase desde a data, com os nomes e a origem', async () => {
    const r = await rodar(bancoDaFase(), 'fase_processual', { mudancas_desde: '2026-11-01' })
    expect(r.mudancas.total).toBe(2)
    expect(r.mudancas.lista[0]).toMatchObject({ cedente: 'Duda', de: 'primeira classificação', para: 'Sequestro (CMP-06)' })
    expect(r.mudancas.lista[0].origem).toContain('manual')
    expect(r.mudancas.lista[1]).toMatchObject({ de: 'Homologado / Aguardando Período de Graça (ATV-02)' })
  })

  it('fase desconhecida e data torta voltam como erro explicado', async () => {
    const r = await rodar(bancoDaFase(), 'fase_processual', { fase: 'xyz' })
    expect(r.erro).toContain('xyz')
    expect(r.fases_validas.length).toBeGreaterThan(10)
    expect((await rodar(bancoDaFase(), 'fase_processual', { mudancas_desde: 'ontem' })).erro).toContain('AAAA-MM-DD')
  })

  it('erro do banco não vira "nenhum crédito"', async () => {
    const b = bancoDaFase()
    b.erros.processos_fase = 'permission denied'
    const r = await rodar(b, 'fase_processual')
    expect(r.erro).toContain('permission denied')
    expect(r.contagem).toBeUndefined()
  })
})

// ------------------------------------------------------------------ Kommo

const ETAPAS = [
  { pipeline_id: 13901939, status_id: 1, pipeline_nome: 'RPV', nome: 'Análise Jurídica e Econômica', ordem: 10 },
  { pipeline_id: 13901939, status_id: 2, pipeline_nome: 'RPV', nome: 'Negociação', ordem: 20 },
  { pipeline_id: 13901939, status_id: 3, pipeline_nome: 'RPV', nome: 'Reprovados operacional', ordem: 30 },
  { pipeline_id: 13901939, status_id: 143, pipeline_nome: 'RPV', nome: 'Venda perdida', ordem: 11000 },
  { pipeline_id: 14439512, status_id: 4, pipeline_nome: 'PRECATÓRIO INTERNO', nome: 'REVISÃO', ordem: 10 },
  { pipeline_id: 14439508, status_id: 5, pipeline_nome: 'FUNIL GERAL', nome: 'NOVOS', ordem: 10 },
  { pipeline_id: 13971995, status_id: 6, pipeline_nome: 'PRECATÓRIO', nome: 'ANTIGA', ordem: 10 },
]

const card = (id: number, pipeline: number, status: number, extra: Record<string, unknown> = {}) => ({
  kommo_lead_id: id,
  pipeline_id: pipeline,
  status_id: status,
  nome: `Orig - Cedente ${id} - 0001234-56.2020.8.09.0051 - 1 - 30%`,
  responsavel_nome: 'Bia',
  processo_cnj: '0001234-56.2020.8.09.0051',
  etapa_em: '2026-10-01T12:00:00Z',
  etapa_status_id: status,
  sincronizado_em: '2026-11-12T14:45:00Z',
  ...extra,
})

describe('resumo_do_funil', () => {
  const banco = () =>
    new BancoFalso({
      kommo_etapa: ETAPAS,
      kommo_leads: [
        card(1, 13901939, 1),
        card(2, 13901939, 1, { etapa_em: '2026-11-11T12:00:00Z' }),
        card(3, 13901939, 3, { responsavel_nome: 'Caio' }),
        card(4, 13901939, 2, { etapa_status_id: 1 }),
        card(5, 14439512, 4),
        card(6, 14439508, 5),
        card(7, 13971995, 6),
        card(8, 13901939, 143),
      ],
      kommo_analise_interna: [
        { kommo_lead_id: 1, status_id_quando_marcado: 1, marcado_em: '2026-11-01T00:00:00Z' },
        { kommo_lead_id: 5, status_id_quando_marcado: 99, marcado_em: '2026-11-01T00:00:00Z' },
      ],
    })

  it('por padrão, só os funis de análise, com as colunas na ordem do kanban', async () => {
    const r = await rodar(banco(), 'resumo_do_funil')
    expect(r.por_funil.map((f: { funil: string }) => f.funil)).toEqual(['RPV', 'PRECATÓRIO INTERNO'])
    expect(r.total_de_cards).toBe(6)
    const rpv = r.por_funil[0]
    expect(rpv.colunas.map((c: { coluna: string }) => c.coluna)).toEqual([
      'Análise Jurídica e Econômica',
      'Negociação',
      'Reprovados operacional',
      'Venda perdida',
    ])
    expect(rpv.colunas[0]).toMatchObject({ quantidade: 2, analise_pronta: 1 })
    // A marcação do card 5 é de outra coluna: não vale.
    expect(r.por_funil[1].colunas[0].analise_pronta).toBeUndefined()
    expect(r.recorte.fora_por_padrao).toContain('Funil Geral')
    expect(r.sincronizado_entre.mais_recente).toBe('2026-11-12T14:45:00Z')
  })

  it('o Funil Geral e o antigo entram quando pedidos', async () => {
    const todos = await rodar(banco(), 'resumo_do_funil', { incluir_todos_os_funis: true })
    expect(todos.total_de_cards).toBe(8)
    const geral = await rodar(banco(), 'resumo_do_funil', { funil: 'geral' })
    expect(geral.por_funil.map((f: { funil: string }) => f.funil)).toEqual(['FUNIL GERAL'])
  })

  it('parados: dias na coluna atual, sem as colunas de desfecho e sem data que não é desta coluna', async () => {
    const r = await rodar(banco(), 'resumo_do_funil', { funil: 'rpv', parados_ha_dias: 30 })
    expect(r.lista.cards.map((c: { kommo_lead_id: number }) => c.kommo_lead_id)).toEqual([1])
    expect(r.lista.cards[0].dias_na_coluna).toBeGreaterThan(30)
    expect(r.sem_data_da_coluna).toBe(1)
    // Pedindo a coluna de desfecho, ela entra.
    const reprov = await rodar(banco(), 'resumo_do_funil', { funil: 'rpv', coluna: 'reprovados', parados_ha_dias: 30 })
    expect(reprov.lista.cards.map((c: { kommo_lead_id: number }) => c.kommo_lead_id)).toEqual([3])
  })

  it('lista de uma coluna e por responsável', async () => {
    const r = await rodar(banco(), 'resumo_do_funil', { coluna: 'analise juridica' })
    expect(r.lista.total).toBe(2)
    expect(r.lista.cards[0].kommo_lead_id).toBe(2) // a entrada mais recente primeiro, como na tela
    const caio = await rodar(banco(), 'resumo_do_funil', { responsavel: 'caio' })
    expect(caio.total_de_cards).toBe(1)
  })

  it('funil desconhecido e erro de leitura são ditos', async () => {
    expect((await rodar(banco(), 'resumo_do_funil', { funil: 'xpto' })).erro).toContain('xpto')
    const b = banco()
    b.erros.kommo_analise_interna = 'falhou'
    expect((await rodar(b, 'resumo_do_funil')).erro).toContain('falhou')
  })
})

describe('ficha_do_card', () => {
  const banco = () =>
    new BancoFalso({
      kommo_etapa: ETAPAS,
      kommo_leads: [
        {
          ...card(10, 13901939, 2),
          nome: 'Orig - Maria - 0001234-56.2020.8.09.0051 - 1 - 30% (principal)',
          tags: ['Cotado PJus', 'Enviado Domus'],
          tags_em: { 'Cotado PJus': '2026-11-03T10:00:00Z' },
          notas: [
            { texto: 'Primeira nota', criado_em: '2026-10-01T00:00:00Z', autor: 'Bia' },
            { texto: 'Cedente aceitou a proposta', criado_em: '2026-11-10T00:00:00Z', autor: 'Caio' },
          ],
          oportunidade: { ficha: { cedente: 'Maria', tribunal: 'TJGO', valor_cedido: 120000 }, prazoMeses: 8 },
          campos: [{ field_name: 'PJus', values: [{ value: 'R$ 100.000,00 / R$ 5.000,00' }] }],
          preco: 95000,
          fechado: null,
          criado_em: '2026-09-01T00:00:00Z',
          atualizado_em: '2026-11-10T00:00:00Z',
        },
        { ...card(11, 13901939, 1), nome: 'Orig - Maria - 0001234-56.2020.8.09.0051 - honorários' },
        { ...card(12, 13901939, 1), processo_cnj: '0009999-00.2021.8.09.0051', nome: 'Orig - João - 0009999-00.2021.8.09.0051' },
      ],
      kommo_analise_interna: [{ kommo_lead_id: 10, status_id_quando_marcado: 2, marcado_em: '2026-11-09T00:00:00Z' }],
      justificativa_tecnica: [
        { kommo_lead_id: 10, status: 'enviada', etapa: null, gerado_em: '2026-11-08T00:00:00Z', enviado_em: '2026-11-09T00:00:00Z', enviado_por: 'Bia', erro: null },
      ],
      escavador_autos_card: [{ kommo_lead_id: 10, estado: 'CONCLUIDO', total_documentos: 12, anexados: 12, paginas: 340 }],
      escavador_autos_processo: [{ kommo_lead_id: 10, numero_cnj: '0001234-56.2020.8.09.0051', rotulo: 'Processo', estado: 'CONCLUIDO' }],
      v_dd_completude: [{ kommo_lead_id: 10, necessarias: 8, obtidas_validas: 6, pendentes: 1, vencidas: 1, dispensadas: 0 }],
      processos: [{ numero_cnj: '0001234-56.2020.8.09.0051', cedente: 'Maria', cessionario: 'Inv A', status: 'ativo' }],
    })

  it('o mesmo processo em dois cards: devolve os candidatos', async () => {
    const r = await rodar(banco(), 'ficha_do_card', { busca: '0001234-56.2020.8.09.0051' })
    expect(r.encontrado).toBe(false)
    expect(r.candidatos.map((c: { kommo_lead_id: number }) => c.kommo_lead_id)).toEqual([10, 11])
    expect(r.candidatos[0]).toMatchObject({ funil: 'RPV', coluna: 'Negociação' })
  })

  it('a ficha inteira pelo id', async () => {
    const r = await rodar(banco(), 'ficha_do_card', { kommo_lead_id: 10, notas: 1 })
    expect(r.encontrado).toBe(true)
    expect(r.card).toMatchObject({ funil: 'RPV', coluna: 'Negociação', na_coluna_desde: '2026-10-01T12:00:00Z', valor_do_card: 95000 })
    expect(r.etiquetas[0]).toEqual({ etiqueta: 'Cotado PJus', desde: '2026-11-03T10:00:00Z' })
    expect(r.cotacoes_dos_fundos.cotacoes[0]).toMatchObject({ fundo: 'PJus', proposta: 'R$ 100.000,00', comissao: 'R$ 5.000,00' })
    expect(r.cotacoes_dos_fundos.leitura).toContain('proposta do fundo / comissão')
    expect(r.analise_interna.analise_pronta).toBe(true)
    expect(r.justificativa_tecnica).toMatchObject({ status: 'enviada', enviada_por: 'Bia' })
    expect(r.autos_escavador.card).toMatchObject({ estado: 'CONCLUIDO', documentos: 12 })
    expect(r.autos_escavador.card.significa).toContain('anexados')
    expect(r.due_diligence).toMatchObject({ pendentes: 1, vencidas: 1 })
    expect(r.credito_na_carteira.creditos).toHaveLength(1)
    expect(r.oportunidade).toContain('Maria')
    expect(r.notas_no_total).toBe(2)
    expect(r.notas_recentes).toEqual([expect.objectContaining({ texto: 'Cedente aceitou a proposta' })])
    expect(r.avisos).toBeUndefined()
  })

  it('por um processo só, direto; por nome também', async () => {
    expect((await rodar(banco(), 'ficha_do_card', { busca: '0009999-00.2021.8.09.0051' })).card.kommo_lead_id).toBe(12)
    expect((await rodar(banco(), 'ficha_do_card', { busca: 'João' })).card.kommo_lead_id).toBe(12)
  })

  it('a seção que falha vira aviso; o resto da ficha segue', async () => {
    const b = banco()
    b.erros.justificativa_tecnica = 'timeout'
    const r = await rodar(b, 'ficha_do_card', { kommo_lead_id: 10 })
    expect(r.encontrado).toBe(true)
    expect(r.avisos.join(' ')).toContain('Justificativa técnica')
    expect(r.justificativa_tecnica).toBeNull()
  })

  it('nada encontrado diz o alcance do espelho', async () => {
    const r = await rodar(banco(), 'ficha_do_card', { busca: '7777777-00.2020.8.09.0051' })
    expect(r.encontrado).toBe(false)
    expect(r.aviso).toContain('espelho')
  })
})

// ------------------------------------------------------------------ contratos

describe('listar_contratos', () => {
  const contrato = (id: string, extra: Record<string, unknown>) => ({
    id,
    numero: '0001234-56.2020.8.09.0051',
    tipo: 'cessao_credito',
    investidor_nome: 'Fundo Alfa',
    status: 'gerado',
    created_at: '2026-11-05T13:00:00Z',
    arquivo_url: `https://drive/${id}`,
    drive_folder_url: 'https://drive/pasta',
    job_id: 'j1',
    cedente: 'Maria',
    ...extra,
  })
  const banco = () =>
    new BancoFalso({
      contratos: [
        contrato('c1', {}),
        contrato('c2', { tipo: 'procuracao' }),
        contrato('c3', { investidor_nome: 'Beta Capital', job_id: 'j2', created_at: '2026-10-01T13:00:00Z' }),
        // 23h30 de 31/10 em Brasília = 01/11 em UTC: é de OUTUBRO.
        contrato('c4', { job_id: 'j3', created_at: '2026-11-01T02:30:00Z' }),
      ],
    })

  it('totais de todos, lista dos mais recentes', async () => {
    const r = await rodar(banco(), 'listar_contratos')
    expect(r.total).toBe(4)
    expect(r.geracoes).toBe(3)
    expect(r.por_tipo).toEqual({ 'Cessão de crédito': 3, Procuração: 1 })
    expect(r.contratos[0].investidor).toBe('Fundo Alfa')
  })

  it('filtro por investidor e por período, no dia de Brasília', async () => {
    expect((await rodar(banco(), 'listar_contratos', { investidor: 'beta' })).total).toBe(1)
    const nov = await rodar(banco(), 'listar_contratos', { desde: '2026-11-01', ate: '2026-11-30' })
    expect(nov.total).toBe(2)
    const out = await rodar(banco(), 'listar_contratos', { desde: '2026-10-31', ate: '2026-10-31' })
    expect(out.total).toBe(1)
  })

  it('lista cortada avisa que os totais são de todos', async () => {
    const r = await rodar(banco(), 'listar_contratos', { limite: 1 })
    expect(r.contratos).toHaveLength(1)
    expect(r.aviso_limite).toContain('1 mais recentes de 4')
  })
})

// ------------------------------------------------------------------ due diligence

describe('situacao_due_diligence', () => {
  const banco = () =>
    new BancoFalso({
      kommo_etapa: ETAPAS,
      kommo_leads: [
        card(20, 13901939, 1, { nome: 'Orig - Maria - 0001234-56.2020.8.09.0051 - principal' }),
        card(21, 13901939, 1, { nome: 'Orig - Maria - 0001234-56.2020.8.09.0051 - honorários' }),
      ],
      dd_sujeito: [{ kommo_lead_id: 20, papel: 'CEDENTE', nome: 'Maria Souza' }],
      v_dd_completude: [{ kommo_lead_id: 20, necessarias: 5, obtidas_validas: 2, pendentes: 1, vencidas: 1, dispensadas: 1 }],
      dd_certidao: [
        { id: 'a', kommo_lead_id: 20, status: 'PENDENTE', obrigatoria: true, certidao_catalogo: { nome_curto: 'CND Federal' }, dd_sujeito: { papel: 'CEDENTE' } },
        { id: 'b', kommo_lead_id: 20, status: 'OBTIDA', obrigatoria: true, validade_ate: '2026-11-01', certidao_catalogo: { nome_curto: 'CNDT' }, dd_sujeito: { papel: 'CONJUGE' } },
        { id: 'c', kommo_lead_id: 20, status: 'OBTIDA', obrigatoria: true, validade_ate: '2027-01-01', resultado: 'positiva', emitida_em: '2026-11-01', certidao_catalogo: { nome_curto: 'Distribuição cível' }, dd_sujeito: { papel: 'CEDENTE' } },
      ],
      dd_historico: [
        { id: 'h1', kommo_lead_id: 20, papel: 'CEDENTE', nome: 'Maria Souza', status: 'APURADO', apurado_em: '2026-11-02T00:00:00Z', liberado_em: null, reprovado_em: '2026-11-04T00:00:00Z', reprovado_motivo: 'Execução fiscal com penhora' },
      ],
      dd_processo: [
        { historico_id: 'h1', kommo_lead_id: 20, numero_processo: '5000001-00.2023.4.01.3500', risco: 'ALTO', risco_motivo: 'Penhora no rosto', polo: 'PASSIVO' },
        { historico_id: 'h1', kommo_lead_id: 20, numero_processo: '5000002-00.2023.4.01.3500', risco: 'NENHUM', polo: 'PASSIVO' },
      ],
      dd_etapa_documental: [],
      bullai_pedido: [
        { job_id: 'b1', kommo_lead_id: 20, status: 'running', is_final: false, criado_em: '2026-11-11T00:00:00Z' },
        { job_id: 'b2', kommo_lead_id: 20, status: 'done', is_final: true, criado_em: '2026-11-01T00:00:00Z' },
      ],
    })

  it('o número em dois cards devolve os candidatos', async () => {
    const r = await rodar(banco(), 'situacao_due_diligence', { busca: '0001234-56.2020.8.09.0051' })
    expect(r.encontrado).toBe(false)
    expect(r.candidatos).toHaveLength(2)
  })

  it('a diligência inteira: pendentes, vencidas, positivas, titulares, risco e BullAI', async () => {
    const r = await rodar(banco(), 'situacao_due_diligence', { kommo_lead_id: 20 })
    expect(r.encontrado).toBe(true)
    expect(r.certidoes.resumo).toMatchObject({ necessarias: 5, pendentes: 1 })
    expect(r.certidoes.pendentes).toEqual([{ certidao: 'CND Federal', status: 'PENDENTE' }])
    expect(r.certidoes.vencidas).toEqual([{ certidao: 'CNDT (conjuge)', venceu_em: '2026-11-01' }])
    expect(r.certidoes.positivas[0].certidao).toBe('Distribuição cível')
    expect(r.apuracao_dos_titulares[0]).toMatchObject({
      papel: 'CEDENTE',
      decisao: 'reprovado em 2026-11-04T00:00:00Z',
      motivo_da_reprovacao: 'Execução fiscal com penhora',
    })
    expect(r.processos_de_risco).toEqual([expect.objectContaining({ risco: 'ALTO', titular: 'CEDENTE' })])
    expect(r.pedidos_bullai_em_andamento).toHaveLength(1)
    expect(r.etapa_documental).toEqual({ concluida: false })
  })

  it('pelo nome do cedente cadastrado na diligência', async () => {
    const r = await rodar(banco(), 'situacao_due_diligence', { busca: 'Souza' })
    expect(r.encontrado).toBe(true)
    expect(r.card.kommo_lead_id).toBe(20)
  })

  it('tabela que falha vira aviso, não "nada pendente"', async () => {
    const b = banco()
    b.erros.dd_certidao = 'relation does not exist'
    const r = await rodar(b, 'situacao_due_diligence', { kommo_lead_id: 20 })
    expect(r.avisos.join(' ')).toContain('Certidões')
  })
})
