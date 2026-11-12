/**
 * AUDITORIA E DO SERVIDOR (12/11/2026) — as correções das Edge Functions desta
 * rodada. A lógica pura (roteamento ATV-02/ATV-03, modelos aceitos) é testada
 * pelo valor; o resto, que vive dentro do `index.ts` de cada função (Deno, rede),
 * pelo código. Cada asserção falharia contra o código de antes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { modeloDaFase, MODELOS_DA_FASE, venceuOPrazo } from '../../../supabase/functions/fase-processual/regras.ts'
import {
  MODELO_DA_CARTEIRA,
  MODELOS_DA_CARTEIRA,
  resolverModeloDaCarteira,
} from '../../../supabase/functions/carteira-resumo/regras.ts'
import { OPUS_VIGENTE } from '../../../supabase/functions/_shared/modeloDoAssistente.ts'

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(/\r\n/g, '\n')

describe('fase-processual', () => {
  it('prazo vencido DEPOIS da homologação também é ATV-03 (não volta a ATV-02 a cada andamento)', () => {
    // Homologado em março, prazo até junho, hoje é novembro: já é sequestro.
    expect(venceuOPrazo('2026-06-30', '2026-03-10', '2026-11-12')).toBe(true)
    // Prazo vencido antes da homologação: ATV-03, como sempre foi.
    expect(venceuOPrazo('2026-02-01', '2026-03-10', '2026-03-11')).toBe(true)
    // Prazo correndo: ATV-02.
    expect(venceuOPrazo('2026-12-31', '2026-03-10', '2026-11-12')).toBe(false)
    // Vence hoje ainda não venceu (o calendário usa `< hoje`).
    expect(venceuOPrazo('2026-11-12', '2026-03-10', '2026-11-12')).toBe(false)
  })
  it('o modelo do corpo só passa se for da lista; Opus 5.5 (recusa ferramenta forçada) vale o padrão', () => {
    const padrao = 'claude-haiku-4-5-20251001'
    expect(modeloDaFase(undefined, padrao)).toBe(padrao)
    expect(modeloDaFase('  ', padrao)).toBe(padrao)
    expect(modeloDaFase('claude-opus-5-5', padrao)).toBe(padrao)
    expect(modeloDaFase('gpt-5', padrao)).toBe(padrao)
    expect(modeloDaFase(' claude-sonnet-5 ', padrao)).toBe('claude-sonnet-5')
    expect(MODELOS_DA_FASE).toContain(padrao)
  })
  it('o índice: roteamento pela regra, resposta cortada é falha, teto por chamada, hash apagado na falha', () => {
    const f = ler('fase-processual/index.ts')
    expect(f).toContain("venceuOPrazo(dataLimite, dataHomologacao, hojeEmBrasilia()) ? 'ATV-03' : 'ATV-02'")
    expect(f).not.toContain('const vencidoAntesDaHomologacao = dataLimite < dataHomologacao')
    expect(f).toContain('const incompleta = motivoDaRespostaIncompleta(r.stop_reason)')
    expect(f).toContain('{ timeout: tempoAteOTeto(inicio, Date.now(), { folgaMs: 20_000 }), maxRetries: 1 }')
    expect(f).toContain('const modelo = modeloDaFase(body.modelo, MODELO)')
    expect(f).not.toContain('body.modelo.trim()')
    // O upsert do catch apaga o hash, para a varredura seguinte tentar de novo.
    const doCatch = f.slice(f.indexOf('      } catch (e) {\n        await svc.from(\'processos_fase\').upsert({'))
    expect(doCatch.slice(0, 900)).toContain('fonte_hash: null,')
  })
  it('marcar_tratado e definir_situacao: zero linhas atualizadas não é ok', () => {
    const f = ler('fase-processual/index.ts')
    expect(f.match(/if \(!marcadas\?\.length\) return jsonResponse\(\{ error: SEM_LINHA_DE_FASE \}, 404\)/g)?.length).toBe(2)
  })
})

describe('carteira-resumo', () => {
  it('sem o Opus na lista: a carteira força a ferramenta, que o Opus 5.5 recusa', () => {
    expect(MODELOS_DA_CARTEIRA).not.toContain(OPUS_VIGENTE)
    expect(resolverModeloDaCarteira(OPUS_VIGENTE)).toBe(MODELO_DA_CARTEIRA)
    expect(resolverModeloDaCarteira('claude-opus-4-1')).toBe(MODELO_DA_CARTEIRA)
  })
  it('o lote tem relógio: crédito que não cabe volta para a fila, e a cadeia sempre segue', () => {
    const f = ler('carteira-resumo/index.ts')
    expect(f).toContain('const ORCAMENTO_MS = 95_000')
    expect(f).toContain('adiados.push(p.id)')
    expect(f).toContain('if (adiados.length) resto = [...adiados, ...resto]')
    expect(f).toContain("{ signal: sinalAteOTeto(inicio, { folgaMs: 25_000 }), maxRetries: 1 }")
    expect(f).toContain('if (estourouOTempo(e)) break')
  })
})

describe('Kommo e Escavador', () => {
  it('kommo-sync: limpeza do espelho calculada aqui e apagada em fatias, sem `not in` da lista inteira', () => {
    const f = ler('kommo-sync/index.ts')
    expect(f).not.toContain(".not('kommo_lead_id', 'in', `(${ids.join(',')})`)")
    expect(f).toContain(".in('kommo_lead_id', sairam.slice(i, i + 150))")
    expect(f).toContain('if (noEspelho.erro || noEspelho.cortada) {')
  })
  it('rotina: o concluído de outro card só vale dentro de REUSO_DIAS, e o pedido em curso vem primeiro', () => {
    const f = ler('escavador-autos-rotina/index.ts')
    expect(f).not.toContain(".in('estado', ['PEDINDO', 'AGUARDANDO', 'ANEXANDO', 'CONCLUIDO'])")
    expect(f).toContain('and(estado.eq.CONCLUIDO,concluido_em.gte."${reusoDesde}")')
    expect(f).toContain(".order('atualizado_em', { ascending: false })")
  })
  it('rotina: processos registrados ANTES de marcar o card LIDO, com o erro olhado', () => {
    const f = ler('escavador-autos-rotina/index.ts')
    const upsert = f.indexOf('const { error: erroUpsert } = await svc.from(\'escavador_autos_processo\').upsert(')
    const lido = f.indexOf("estado: lerDeNovo ? 'NOVO' : todos.length ? 'LIDO' : 'SEM_PROCESSO',")
    expect(upsert).toBeGreaterThan(0)
    expect(lido).toBeGreaterThan(upsert)
    expect(f).toContain('if (falhaDosProcessos) {')
  })
  it('escavador-autos: o pedido pago sem cota nem posse está desligado', () => {
    const f = ler('escavador-autos/index.ts')
    expect(f).toContain('const PEDIDO_PELA_TELA_LIGADO = false')
    expect(f).toContain('if (!PEDIDO_PELA_TELA_LIGADO) {')
  })
  it('mcp-autos: lote JSON-RPC com teto (a porta não tem login)', () => {
    const f = ler('mcp-autos/index.ts')
    expect(f).toContain('const MAX_ITENS_DO_LOTE = 10;')
    expect(f).toContain('if (corpo.length > MAX_ITENS_DO_LOTE) {')
  })
  it('buscar-kommo: lead_id só número, e os documentos soltos paginados', () => {
    const f = ler('buscar-kommo/index.ts')
    expect(f).toContain('if (!/^\\d{1,15}$/.test(leadId)) return json({ erro: "lead_id inválido." }, 400);')
    expect(f).not.toContain('.range(0, 4999);')
    expect(f).toContain('lerTodasAsLinhas<{ kommo_file_uuid: string; ordem: number | null }>')
  })
})

describe('Pagos e acesso', () => {
  it('getCallerAtivo: leitura do perfil que falha não deixa passar o desligado', () => {
    const f = ler('_shared/auth.ts')
    expect(f).toContain('if (!error) return data?.ativo === false ? null : user')
    expect(f).toContain('if (tentativa >= 1) return null')
  })
  it('bullai: só a recusa clara (4xx) libera a reserva; o resto manda conferir no painel', () => {
    const f = ler('bullai-certidoes/index.ts')
    expect(f).toContain('const recusaClara = typeof status === \'number\' && status >= 400 && status < 500 && status !== 408')
    expect(f).toContain('signal: AbortSignal.timeout(TEMPO_DO_PEDIDO_MS),')
    // O segundo PDF do mesmo portal não sobrescreve o primeiro.
    expect(f).toContain("const ordem = lista.length > 0 ? ` (${lista.length + 1})` : ''")
  })
  it('dd-credor: busca por CPF não concluída não vira relatório verde', () => {
    const f = ler('dd-credor/index.ts')
    expect(f).toContain('if (!concluida) return { aguarde: true, request_id: requestId };')
    expect(f).not.toContain('if (pd.length > 0 && i >= 3) break;')
  })
  it('dd-titulares: documento com dígito verificador errado fica vazio', () => {
    const f = ler('dd-titulares/index.ts')
    expect(f).toContain('.map((t) => (documentoComDigitoValido(t.documento) ? t : { ...t, documento: \'\' }))')
  })
})

describe('Análise, justificativa, petição', () => {
  it('gerar-analise-rpv: revisão com teto e fins incompletos; diligência paginada; remoção conferida', () => {
    const f = ler('gerar-analise-rpv/index.ts')
    expect(f).toContain('{ signal: sinalAteOTeto(inicio, { folgaMs: 30_000 }), maxRetries: 1 })')
    expect(f).toContain('notasKommo, _t0)')
    expect(f).toContain('if (incompleta) throw new Error(`A revisão não foi aplicada: ${incompleta}`)')
    expect(f).toContain('if (incompleta) throw new Error(`${incompleta} (${o.rotulo}) Rode de novo; persistindo, reduza os anexos do card.`)')
    expect(f).toContain('lerTodasAsLinhas<ProcessoDD>((de, ate) =>')
    expect(f).toContain('if (erroRemove) {')
  })
  it('tetos: a pesquisa tem relógio e o estouro vira falha gravada', () => {
    const f = ler('_shared/tetosRpv.ts')
    expect(f).toContain("{ signal: sinalAteOTeto(t0, { folgaMs: 15_000 }), maxRetries: 1 }")
    expect(f).toContain('if (Date.now() - t0 >= RETOMA_ATE_MS) break')
    expect(f).toContain("return await falhar('a pesquisa passou do tempo da função (cerca de 150 s)', 'tempo esgotado')")
  })
  it('emolumentos: a trava de worker morto acompanha o teto real (~150 s)', () => {
    expect(ler('_shared/emolumentos.ts')).toContain('const TRAVA_MINUTOS = 3')
  })
  it('pastaDoCard: leitura do card que falha não vira pasta recalculada', () => {
    expect(ler('_shared/pastaDoCard.ts')).toContain('if (erroCard) throw new Error(')
  })
  it('justificativa: vigia pelas mais recentes; gerar não pisa num envio; marca de enviada confere a linha', () => {
    const f = ler('justificativa-tecnica/index.ts')
    expect(f).toMatch(/\.eq\('status', 'gerando'\)\n\s+\.order\('atualizado_em', \{ ascending: false \}\)\n\s+\.limit\(50\)/)
    expect(f).toContain('.or(`enviando_desde.is.null,enviando_desde.lt."${envioVence}"`)')
    expect(f).toContain("return error ?? ((data?.length ?? 0) === 0 ? { message: 'a linha desta tentativa não foi encontrada' } : null)")
  })
  it('peticao-ia: redação com teto, reescrita só com relógio e sem derrubar a primeira peça', () => {
    const f = ler('peticao-ia/index.ts')
    expect(f).toContain('{ signal: sinalAteOTeto(inicio, { folgaMs: 10_000 }), maxRetries: 1 })')
    expect(f).toContain('if (problemas.length > 0 && Date.now() - inicio < TEMPO_PARA_REESCREVER_MS) {')
    expect(f).toContain("console.warn('peticao-ia: reescrita descartada:', mensagemDeErro(e))")
  })
  it('chamadas externas dos crons com teto (ADVBOX, BCB, DJEN)', () => {
    expect(ler('_shared/advbox.ts').match(/signal: AbortSignal\.timeout\(TETO_DA_CHAMADA_MS\)/g)?.length).toBe(2)
    expect(ler('parametros-bcb/index.ts')).toContain('signal: AbortSignal.timeout(20_000)')
    expect(ler('djen-publicacoes/index.ts')).toContain('signal: AbortSignal.timeout(20_000)')
  })
})

describe('assistente', () => {
  it('propor_peticao casa pelo número inteiro, não pelos 7 primeiros dígitos', () => {
    const f = ler('assistente/index.ts')
    expect(f).not.toContain('`%${digitos.slice(0, 7)}%`')
    expect(f).toContain("? q.filter('numero_cnj', 'imatch', regexDosDigitos(digitos, { inteiro: digitos.length >= 20 }))\n        : q.ilike('cedente', `%${busca}%`)")
  })
  it('painel: erro na leitura dos índices é erro, não projeção nula', () => {
    expect(ler('assistente/index.ts')).toContain('if (parametros.error) return { erro: `Não consegui ler os parâmetros de atualização: ${parametros.error.message}` }')
  })
})
