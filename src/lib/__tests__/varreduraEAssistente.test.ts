/**
 * VARREDURA E (23/10/2026) — assistente e conector dos autos. As correções vivem
 * dentro do `index.ts` de cada função (Deno, `npm:`), então são conferidas pelo
 * código. Cada asserção falharia contra a versão anterior.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(/\r\n/g, '\n')

describe('assistente: teto de 150 s', () => {
  const f = ler('assistente/index.ts')
  it('conta o tempo do começo da invocação e passa o sinal ao SDK', () => {
    expect(f).toContain('const inicio = Date.now()')
    expect(f).toContain('{ signal: sinalAteOTeto(inicio) },')
    expect(f).toContain('if (tempoAteOTeto(inicio, Date.now(), { minimoMs: 0 }) < 25_000) {')
  })
  it('o aborto vira a frase de pergunta longa, não "Request was aborted."', () => {
    expect(f).toContain('if (err instanceof Anthropic.APIUserAbortError || estourouOTempo(err)) {')
    expect(f).toContain('return jsonResponse({ error: PERGUNTA_LONGA_DEMAIS }, 504)')
  })
})

describe('assistente: leituras sem o corte calado de 1000 linhas', () => {
  const f = ler('assistente/index.ts')
  it('painel, resumo financeiro, cessões, investidores e paralisados leem paginado', () => {
    expect(f).toContain("lerTudo(() => svc.from('processos').select(COLUNAS_PAINEL), ['id'])")
    expect(f).toContain("() => svc.from('cessoes').select('status, valor_face, valor_aquisicao, valor_cessao'),")
    expect(f).toContain("}, ['tipo', 'nome_chave'])")
    expect(f).toContain("() => svc.from('advbox_processo_status').select('numero_processo, ultima_movimentacao'),")
    // As formas antigas, cruas, não voltam.
    expect(f).not.toContain("svc.from('processos').select(COLUNAS_PAINEL),\n")
    expect(f).not.toContain('.limit(5000),')
    expect(f).not.toMatch(/\.select\('cessionario, originador'\)\n/)
  })
  it('o teto de investidores não vem antes do filtro de ficha incompleta', () => {
    const trecho = f.slice(f.indexOf("case 'listar_investidores'"), f.indexOf("case 'listar_analises'"))
    expect(trecho).not.toContain('.limit(LIMITE_MAX)')
    expect(trecho).toContain('pessoas: pessoas.slice(0, limite(args.limite)),')
  })
  it('a verificação de atualidade usa o teto real do PostgREST', () => {
    expect(f).toContain('const CAP_VERIFICACAO = 1000')
    expect(f).not.toContain('const CAP_VERIFICACAO = 2000')
  })
  it('limite inteiro e finito', () => {
    expect(f).toContain("typeof valor === 'number' && Number.isFinite(valor) ? Math.floor(valor) : 20")
  })
})

describe('assistente: histórico e arquivos gerados', () => {
  const f = ler('assistente/index.ts')
  it('descarta turno vazio e resposta órfã no começo', () => {
    expect(f).toContain("((m as { content: string }).content.trim() !== '') &&")
    expect(f).toContain("while (mensagens.length > 0 && mensagens[0].role === 'assistant') mensagens.shift()")
  })
  it('procura arquivos em todas as rodadas da pergunta, não só na última', () => {
    expect(f).toContain('const inicioDestaPergunta = mensagens.length')
    expect(f).toContain('.slice(inicioDestaPergunta)')
    expect(f).not.toContain('await extrairArquivosGerados(resposta.content, apiKey, caller.id)')
  })
  it('a chave do Storage sai sem acento, com o tipo do arquivo', () => {
    expect(f).toContain('const caminho = `${userId}/${fileId}-${nomeParaOStorage(nome)}`')
    expect(f).toContain("(typeof meta?.mime_type === 'string' && meta.mime_type) || 'application/octet-stream',")
  })
  it('model_context_window_exceeded também marca a resposta como interrompida', () => {
    expect(f).toContain("motivo === 'model_context_window_exceeded'")
  })
  it('sem cópia local da chave da Anthropic', () => {
    expect(f).toContain("import { chaveAnthropic } from '../_shared/segredos.ts'")
    expect(f).not.toContain('async function chaveAnthropic()')
  })
})

describe('nomeParaOStorage (a regra, reproduzida)', () => {
  // A função vive no index.ts da Edge Function (Deno.serve), que o vitest não
  // importa; a regra é extraída do fonte e executada aqui.
  const f = ler('assistente/index.ts')
  const corpo = f.slice(f.indexOf('function nomeParaOStorage'), f.indexOf('/**', f.indexOf('function nomeParaOStorage')))
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const nomeParaOStorage = new Function(
    `${corpo.replace(/\(nome: string\): string/, '(nome)')}; return nomeParaOStorage`,
  )() as (n: string) => string

  it('tira acento e mantém a extensão', () => {
    expect(nomeParaOStorage('Relatório de créditos.xlsx')).toBe('Relatorio de creditos.xlsx')
  })
  it('barra e ponto-ponto não abrem pasta', () => {
    const n = nomeParaOStorage('../../outro/planilha.xlsx')
    expect(n).not.toContain('/')
    expect(n).not.toContain('..')
  })
  it('nunca vazio', () => {
    expect(nomeParaOStorage('')).toBe('arquivo')
  })
  it('só caracteres que o Storage aceita', () => {
    expect(nomeParaOStorage('Análise #3 — R$ 10%.pdf')).toMatch(/^[A-Za-z0-9._\- ()]+$/)
  })
})

describe('mcp-autos: as duas esperas não passam do teto', () => {
  const f = ler('mcp-autos/index.ts')
  it('ver_paginas mede o prazo do começo da chamada', () => {
    expect(f).toContain('const ORCAMENTO_DA_CHAMADA_MS = 110_000;')
    expect(f).toContain('const limite = Math.min(Date.now() + ESPERA_IMAGENS_MS, inicio + ORCAMENTO_DA_CHAMADA_MS);')
    expect(f).toContain('de, ate, inicio));')
  })
})
