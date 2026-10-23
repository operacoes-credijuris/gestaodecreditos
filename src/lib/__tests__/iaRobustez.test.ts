import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  aposResposta,
  falhaDaRedacao,
  juntarDossies,
  type MensagemDaConversa,
} from '../../../supabase/functions/_shared/justificativaParalela.ts'
import { aplicarPatch } from '../../../supabase/functions/_shared/revisao.ts'
import {
  falhaDaResposta,
  MODELO_DA_CARTEIRA,
  MODELOS_DA_CARTEIRA,
  resolverModeloDaCarteira,
} from '../../../supabase/functions/carteira-resumo/regras.ts'
import { datasDaObtencao } from '../../../supabase/functions/bullai-certidoes/regras.ts'

/**
 * A ROBUSTEZ DAS CHAMADAS À IA E DAS GRAVAÇÕES (23/10/2026).
 *
 * Cada bloco é um defeito confirmado: resposta cortada no teto de tokens salva
 * como completa, pausa do servidor tratada como falha, gravação cujo erro se
 * perdia, autor da nota vindo do navegador, data de emissão regravada.
 */
const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(/\r\n/g, '\n')

const inicio: MensagemDaConversa[] = [{ role: 'user', content: 'pesquise' }]

describe('justificativa técnica: o teto de tokens não é fim normal', () => {
  it('max_tokens numa frente é "cortada", não "terminou" (e o conteúdo entra na conversa)', () => {
    const r = aposResposta(inicio, [{ type: 'text', text: 'DOSSIÊ pela met' }], 'max_tokens')
    expect(r.desfecho).toBe('cortada')
    expect(r.conversa).toHaveLength(2)
  })
  it('pause_turn, end_turn e refusal seguem como antes', () => {
    expect(aposResposta(inicio, [], 'pause_turn').desfecho).toBe('continuar')
    expect(aposResposta(inicio, [{ type: 'text', text: 'x' }], 'end_turn').desfecho).toBe('terminou')
    expect(aposResposta(inicio, [], 'refusal').desfecho).toBe('recusa')
  })
  it('a frente cortada fecha como parcial, e a redação recebe o aviso', () => {
    const f = ler('justificativa-tecnica/index.ts')
    expect(f).toContain("const cortada = depois.desfecho === 'cortada'")
    expect(f).toContain('parcial: encerrar || cortada,')
    const j = juntarDossies([
      { titulo: 'Teto', status: 'pronta', parcial: true, erro: null, dossie: { texto: 'achado', fontes: [] } },
    ])
    expect(j.texto).toContain('tamanho da resposta')
  })
  it('a redação cortada é falha com mensagem clara, não texto pronto para o Kommo', () => {
    expect(falhaDaRedacao('max_tokens')).toMatch(/tamanho máximo/)
    expect(falhaDaRedacao('refusal')).toMatch(/recusou a redação/)
    expect(falhaDaRedacao('end_turn')).toBeNull()
    const f = ler('justificativa-tecnica/index.ts')
    expect(f).toContain('const falha = falhaDaRedacao(resposta.stop_reason)')
    expect(f).toContain('if (feito.falha) throw new Error(feito.falha)')
    // A falha vem antes de qualquer gravação de 'pronta'.
    expect(f.indexOf('if (feito.falha) throw new Error(feito.falha)'))
      .toBeLessThan(f.indexOf('const final = textoComFontes(feito.texto, dossie.fontes)'))
  })
})

describe('justificativa técnica: o autor da nota é quem chama', () => {
  it('o envio ignora body.autor e lê o perfil', () => {
    const f = ler('justificativa-tecnica/index.ts')
    const enviar = f.slice(f.indexOf('async function enviar('), f.indexOf('Deno.serve('))
    expect(enviar).not.toContain('String(body.autor')
    expect(enviar).toContain(".from('profiles').select('nome, email').eq('id', caller.id).maybeSingle()")
    expect(enviar).toContain('const autor = perfil?.nome?.trim() || perfil?.email || caller.email || null')
  })
})

describe('teto da RPV: pausa retomada, recusa e corte ditos, gravação conferida', () => {
  const f = ler('_shared/tetosRpv.ts')
  it('pause_turn é retomado em laço com teto, como em emolumentos', () => {
    expect(f).toContain("for (let i = 0; i < MAX_RETOMADAS_TETO && resposta.stop_reason === 'pause_turn'; i++) {")
    expect(f).toContain("mensagens.push({ role: 'assistant', content: resposta.content })")
  })
  it('refusal, max_tokens e pausa que sobra viram falha com motivo', () => {
    expect(f).toContain("if (stopReason === 'refusal')")
    expect(f).toContain("if (stopReason === 'max_tokens')")
    expect(f).toContain('const falhaDaParada = motivoDaParadaDoTeto(resposta.stop_reason)')
    // A checagem vem antes de ler o registrar_teto.
    expect(f.indexOf('motivoDaParadaDoTeto(resposta.stop_reason)'))
      .toBeLessThan(f.indexOf("c.type === 'tool_use' && c.name === FERRAMENTA.name"))
  })
  it("o 'pronto' e o 'falhou' conferem o erro, com uma segunda tentativa", () => {
    expect(f).toContain('const erroPronto = await gravarComUmaRetentativa(() =>')
    expect(f).toContain('if (erroPronto) throw new Error(')
    expect(f).toContain('): Promise<string | null> {')
    expect(f).not.toContain('} catch (_) { /* a análise não para por causa disto */ }')
  })
})

describe('emolumentos: a gravação do estado é conferida', () => {
  const f = ler('_shared/emolumentos.ts')
  it('gravar olha o erro, tenta de novo e lança', () => {
    expect(f).toContain("import { gravarComUmaRetentativa } from './tetosRpv.ts'")
    expect(f).toContain('if (erro) throw new Error(`não consegui gravar o levantamento de ${uf}: ${erro}`)')
  })
  it('executarPasso segue sem lançar: a falha que não grava vai na resposta', () => {
    expect(f).toContain('const erro = await desistirSemLancar(svc, uf, ano, p, `a etapa "${p.etapa}" falhou:')
    expect(f).toContain('return { etapa: p.etapa, proxima: null, ...(erro ? { erro } : {}) }')
  })
})

describe('carteira-resumo: modelo da lista, erros ditos, corte não vira cache', () => {
  it('o modelo do corpo só passa se for da lista; o padrão é o Haiku', () => {
    expect(resolverModeloDaCarteira(undefined)).toBe(MODELO_DA_CARTEIRA)
    expect(resolverModeloDaCarteira('')).toBe(MODELO_DA_CARTEIRA)
    expect(resolverModeloDaCarteira('gpt-5')).toBe(MODELO_DA_CARTEIRA)
    expect(resolverModeloDaCarteira('claude-opus-1-qualquer')).not.toBe('claude-opus-1-qualquer')
    expect(resolverModeloDaCarteira(' claude-sonnet-5 ')).toBe('claude-sonnet-5')
    for (const m of MODELOS_DA_CARTEIRA) expect(resolverModeloDaCarteira(m)).toBe(m)
    expect(MODELOS_DA_CARTEIRA).toContain(MODELO_DA_CARTEIRA)
  })
  it('max_tokens é falha, não resumo', () => {
    expect(falhaDaResposta('max_tokens')).toMatch(/cortada/)
    expect(falhaDaResposta('tool_use')).toBeNull()
    expect(falhaDaResposta('end_turn')).toBeNull()
  })
  it('o índice usa a lista e checa leituras e gravações', () => {
    const f = ler('carteira-resumo/index.ts')
    expect(f).toContain('const modelo = resolverModeloDaCarteira(body.modelo)')
    expect(f).not.toContain('body.modelo.trim()')
    expect(f).toContain('if (falha) throw new RespostaInutil(falha)')
    expect(f).toContain('if (erroIds) {')
    expect(f).toContain('if (erroProc) {')
    expect(f).toContain('if (erroHashes) {')
    expect(f).toContain('if (erroGravar) {')
    expect(f).toContain('ok: errosDeGravacao.length === 0,')
    // O ok:true incondicional saiu.
    expect(f).not.toMatch(/return jsonResponse\(\{\n\s+ok: true,\n\s+modelo,/)
  })
})

describe('peticao-ia: o panorama cortado não vira cache', () => {
  it('max_tokens lança antes de ler a ferramenta e de gravar o fonte_hash', () => {
    const f = ler('peticao-ia/index.ts')
    const corte = f.indexOf("if (r.stop_reason === 'max_tokens') {\n          throw new Error('O panorama")
    expect(corte).toBeGreaterThan(0)
    expect(corte).toBeLessThan(f.indexOf('fonte_hash: insumos.fonte,'))
  })
})

describe('bullai-certidoes: emissão e validade só na passagem para OBTIDA', () => {
  it('item que já era OBTIDA não tem as datas regravadas', () => {
    expect(datasDaObtencao('OBTIDA', '2026-10-23', '2026-11-22')).toEqual({})
  })
  it('na passagem, grava emissão e validade', () => {
    expect(datasDaObtencao('PEDIDA', '2026-10-23', '2026-11-22'))
      .toEqual({ emitida_em: '2026-10-23', validade_ate: '2026-11-22' })
    expect(datasDaObtencao(null, '2026-10-23', null)).toEqual({ emitida_em: '2026-10-23', validade_ate: null })
  })
  it('o índice lê o status do item e não grava mais as datas direto', () => {
    const f = ler('bullai-certidoes/index.ts')
    expect(f).toContain(".select('certidao_codigo, bullai_job_id, status')")
    expect(f).toContain('datasDaObtencao(item?.status')
    expect(f).not.toContain('mudanca.emitida_em = hoje')
  })
})

describe('revisão: caminho de remoção sem índice não apaga o item 0', () => {
  const CAMPOS = new Set(['bloco_g_riscos', 'roteiro_prazo'])
  const LISTAS = new Set(['bloco_g_riscos', 'roteiro_prazo'])
  const base = () => ({ bloco_g_riscos: [{ risco: 'a' }, { risco: 'b' }], roteiro_prazo: [{ ato: 'x' }] })
  it('"riscos." e "roteiro_prazo. " são relatados, e a lista fica inteira', () => {
    const r = aplicarPatch(base(), {}, ['riscos.', 'roteiro_prazo. ', 'riscos.-1', 'riscos.1e0'], CAMPOS, LISTAS)
    expect((r.dados.bloco_g_riscos as unknown[]).length).toBe(2)
    expect((r.dados.roteiro_prazo as unknown[]).length).toBe(1)
    expect(r.remocoesVazias).toEqual(expect.arrayContaining(['riscos.', 'roteiro_prazo. ', 'riscos.-1', 'riscos.1e0']))
  })
  it('o índice de verdade continua apagando', () => {
    const r = aplicarPatch(base(), {}, ['riscos.0'], CAMPOS, LISTAS)
    expect((r.dados.bloco_g_riscos as Array<{ risco: string }>).map((x) => x.risco)).toEqual(['b'])
  })
})
