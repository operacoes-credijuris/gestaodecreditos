/**
 * VARREDURA E (23/10/2026) — as Edge Functions que não tinham passado pelas
 * varreduras dos dois dias anteriores: due diligence (dd-*), Judit, Escavador,
 * extração do crédito, redação do desfecho e os salvar-token-*. A lógica pura
 * nova é testada direto; o resto, pelo código (o padrão de
 * auditoriaServidorCodigo.test.ts). Cada asserção falharia contra o código de antes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mensagemDoErroDaAnthropic } from '../../../supabase/functions/_shared/falhaDaAnthropic'
import { motivoDaRespostaIncompleta } from '../../../supabase/functions/_shared/respostaDoClaude'

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(/\r\n/g, '\n')

describe('mensagemDoErroDaAnthropic', () => {
  it('conta sem crédito sai em português, com o que fazer', () => {
    const m = mensagemDoErroDaAnthropic(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
      'a leitura',
    )
    expect(m).toMatch(/sem créditos/)
    expect(m).not.toMatch(/HTTP 400/)
  })
  it('chave recusada e sobrecarga também', () => {
    expect(mensagemDoErroDaAnthropic(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'x'))
      .toMatch(/chave da Anthropic foi recusada/)
    expect(mensagemDoErroDaAnthropic(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, 'x'))
      .toMatch(/sobrecarregada/)
  })
  it('falha desconhecida leva o status e a mensagem da API', () => {
    expect(mensagemDoErroDaAnthropic(400, { error: { type: 'invalid_request_error', message: 'prompt is too long' } }, 'a leitura'))
      .toBe('A IA recusou a leitura (HTTP 400): prompt is too long')
  })
  it('corpo que não é JSON (null) não quebra', () => {
    expect(mensagemDoErroDaAnthropic(502, null, 'a redação')).toBe('A IA recusou a redação (HTTP 502).')
  })
})

describe('motivoDaRespostaIncompleta', () => {
  it('corte, recusa, pausa e janela estourada não são resposta', () => {
    for (const s of ['max_tokens', 'refusal', 'pause_turn', 'model_context_window_exceeded']) {
      expect(motivoDaRespostaIncompleta(s), s).toBeTruthy()
    }
  })
  it('fim normal e chamada de ferramenta passam', () => {
    expect(motivoDaRespostaIncompleta('end_turn')).toBeNull()
    expect(motivoDaRespostaIncompleta('tool_use')).toBeNull()
    expect(motivoDaRespostaIncompleta(undefined)).toBeNull()
  })
})

describe('Anthropic por fetch: motivo, recusa e teto', () => {
  it('dd-qualificacao, dd-titulares e redigir-desfecho traduzem o erro e barram a recusa', () => {
    for (const arq of ['dd-qualificacao/index.ts', 'dd-titulares/index.ts', 'redigir-desfecho/index.ts']) {
      const f = ler(arq)
      expect(f, arq).toContain('mensagemDoErroDaAnthropic(res.status, resposta,')
      expect(f, arq).toContain('motivoDaRespostaIncompleta(resposta?.stop_reason)')
      expect(f, arq).toContain('signal: sinalAteOTeto(inicio)')
      expect(f, arq).not.toMatch(/A IA recusou a (leitura|redação) \(HTTP \$\{res\.status\}\)/)
    }
  })
  it('dd-credor e dd-qualificar: corpo não-JSON não derruba, e o motivo é traduzido', () => {
    for (const arq of ['dd-credor/index.ts', 'dd-qualificar/index.ts']) {
      const f = ler(arq)
      expect(f, arq).toContain('const j = await res.json().catch(() => null);')
      expect(f, arq).toContain('erro: mensagemDoErroDaAnthropic(res.status, j, "a leitura")')
      expect(f, arq).not.toContain('erro: "IA recusou"')
    }
  })
  it('extrair-credito: teto da invocação, uma repetição só, chave compartilhada e texto limitado', () => {
    const f = ler('extrair-credito/index.ts')
    expect(f).toContain("{ signal: sinalAteOTeto(inicio) })")
    expect(f).toContain('new Anthropic({ apiKey: chave, maxRetries: 1 })')
    expect(f).toContain("import { chaveAnthropic } from '../_shared/segredos.ts'")
    expect(f).not.toContain('async function chaveAnthropic()')
    expect(f).toContain('if (corpo.length > MAX_CARACTERES) {')
    expect(f).toContain('err instanceof Anthropic.APIUserAbortError')
  })
})

describe('Judit', () => {
  it('buscar-judit: o modo teste passa pelo portão antes de gastar consulta', () => {
    const f = ler('buscar-judit/index.ts')
    const portao = f.indexOf('const user = await getCallerAtivo(req, svc);')
    const teste = f.indexOf('if (testeMode) {')
    expect(portao).toBeGreaterThan(0)
    expect(teste).toBeGreaterThan(portao)
    // Um portão só, antes dos dois modos.
    expect(f.match(/getCallerAtivo\(req/g)).toHaveLength(1)
  })
  it('buscar-judit, dd-credor e dd-qualificar: espera e downloads têm relógio', () => {
    for (const arq of ['buscar-judit/index.ts', 'dd-credor/index.ts', 'dd-qualificar/index.ts']) {
      const f = ler(arq)
      expect(f, arq).toContain('if (Date.now() - inicio > ESPERA_MAX_MS) break;')
      expect(f, arq).toContain('if (Date.now() - inicio > LEITURA_MAX_MS) {')
      expect(f, arq).toContain('signal: AbortSignal.timeout(PEDIDO_MAX_MS)')
    }
    expect(ler('dd-credor/index.ts')).toContain('if (Date.now() - inicio > BUSCA_CPF_MAX_MS) break;')
  })
  it('dd-credor: o Drive é o compartilhado (todas as páginas, sem pasta duplicada)', () => {
    const f = ler('dd-credor/index.ts')
    expect(f).not.toContain('async function driveListFiles(')
    expect(f).not.toContain('async function driveFindOrCreateFolder(')
    expect(f).toContain('driveFindOrCreateFolder, driveUploadBytes, refreshGoogleAccessToken } from "../_shared/credijuris.ts"')
  })
})

describe('Escavador', () => {
  it('dd-processos: teto de alvos, sujeito_id conferido e prazo para as páginas', () => {
    const f = ler('dd-processos/index.ts')
    expect(f).toContain('if (alvos.length > MAX_ALVOS) {')
    expect(f).toContain("if (a.sujeito_id && !validos.has(String(a.sujeito_id))) a.sujeito_id = null")
    expect(f).toContain("processosDoEnvolvido(chave, { documento, nome, polo: 'PASSIVO' }, prazo)")
    expect(f).toContain('if (eSujeitos) return jsonResponse(')
  })
  it('escavador.ts: passado o prazo, a página seguinte não é pedida e o parcial é dito', () => {
    const f = ler('_shared/escavador.ts')
    expect(f).toContain('if (prazo !== undefined && paginas > 0 && Date.now() > prazo) {')
    expect(f).toContain("'envolvido_encontrado', prazo)")
  })
  it('escavador-callback: tratado antes de acordar a rotina; recusa da API vira erro', () => {
    const f = ler('escavador-callback/index.ts')
    const tratado = f.indexOf('.update({ tratado_em: new Date().toISOString() })')
    const rotina = f.indexOf('/functions/v1/escavador-autos-rotina')
    expect(tratado).toBeGreaterThan(0)
    expect(rotina).toBeGreaterThan(tratado)
    expect(f).toContain('if (st.status < 200 || st.status >= 300) {')
    expect(f).toContain('signal: AbortSignal.timeout(30_000)')
  })
  it('escavador-autos: pedido pago e não registrado é dito à tela', () => {
    const f = ler('escavador-autos/index.ts')
    expect(f).toContain("const { data: pedido, error: ePedido } = await svc.from('escavador_pedido').upsert({")
    expect(f).toContain('Não peça de novo')
  })
})

describe('salvar-token-*', () => {
  it('advbox: o token é aparado antes de gravar', () => {
    const f = ler('salvar-token-advbox/index.ts')
    expect(f).toContain("const token = typeof corpo?.token === 'string' ? corpo.token.trim() : ''")
  })
  it('kommo: o subdomínio só tem letras, dígitos e hífen', () => {
    const f = ler('salvar-token-kommo/index.ts')
    const m = f.match(/if \(!(\/\^\[a-z0-9\].*\$\/)\.test\(subdominio\)\)/)
    expect(m).toBeTruthy()
    const re = new RegExp(m![1].slice(1, -1))
    expect(re.test('contatocredijuriscom')).toBe(true)
    expect(re.test('minha-empresa')).toBe(true)
    expect(re.test('outro.site#')).toBe(false)
    expect(re.test('x@outro.site')).toBe(false)
    expect(re.test('-x')).toBe(false)
  })
})
