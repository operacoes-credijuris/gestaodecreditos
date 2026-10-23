/**
 * O 401 COM A SESSÃO BOA (22/10/2026): a justificativa técnica mostrou "Acesso
 * não autorizado. Faça login novamente" com a pessoa logada, e o vigia dela,
 * que falhava calado com o mesmo 401, deixou a geração parar no meio. Agora a
 * chamada renova a sessão e tenta uma vez de novo — só quando é a sessão que
 * foi recusada; o servidor repete a leitura do usuário quando o auth tropeça; e
 * um vigia do agendamento relança a frente morta mesmo com a janela fechada.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sessaoRecusada, erroDaFuncao } from '@/lib/functions'

const falha = (corpo: string, status: number) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(corpo, { status }),
})
const raiz = join(__dirname, '..', '..', '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

describe('sessaoRecusada', () => {
  it('o portão das funções e o gateway: renova', async () => {
    expect(await sessaoRecusada(falha(JSON.stringify({ error: 'Acesso não autorizado. Faça login novamente.' }), 401))).toBe(true)
    expect(await sessaoRecusada(falha(JSON.stringify({ error: 'Sessão inválida.' }), 401))).toBe(true)
    expect(await sessaoRecusada(falha(JSON.stringify({ msg: 'Invalid JWT' }), 401))).toBe(true)
  })
  it('o 401 de outro serviço e os outros status: não renova', async () => {
    expect(await sessaoRecusada(falha(JSON.stringify({ error: 'O Escavador recusou o token.' }), 401))).toBe(false)
    expect(await sessaoRecusada(falha(JSON.stringify({ error: 'Acesso não autorizado.' }), 403))).toBe(false)
    expect(await sessaoRecusada({ message: 'x' })).toBe(false)
  })
  it('lê uma cópia: a mensagem da tela continua saindo do corpo', async () => {
    const e = falha(JSON.stringify({ error: 'Acesso não autorizado.' }), 401)
    await sessaoRecusada(e)
    expect((await erroDaFuncao(e)).message).toBe('Acesso não autorizado. (HTTP 401)')
  })
})

describe('o servidor', () => {
  it('repete a leitura do usuário só quando o auth falha, não quando recusa', () => {
    const auth = ler('supabase/functions/_shared/auth.ts')
    expect(auth).toContain('if (tentativa >= 1 || !falhaDoAuth(error)) return null')
    expect(auth).toContain("return typeof s !== 'number' || s === 0 || s >= 500")
  })
  it('a justificativa tem o vigia do agendamento, só para chamada interna', () => {
    const f = ler('supabase/functions/justificativa-tecnica/index.ts')
    expect(f).toMatch(/if \(acao === 'vigiar-todas'\) \{\r?\n\s+if \(!interna\) return erro\(ERRO_ACESSO, 401\)/)
    expect(f).toContain(".eq('status', 'gerando')")
  })
  it('o cron do vigia passa o gateway: a função confere o acesso por conta própria (23/10/2026)', () => {
    const toml = ler('supabase/config.toml')
    expect(toml).toMatch(/\[functions\.justificativa-tecnica\]\r?\nverify_jwt = false/)
    const f = ler('supabase/functions/justificativa-tecnica/index.ts')
    for (const acao of ['vigiar', 'gerar', 'rascunho', 'enviar']) {
      expect(f).toMatch(new RegExp(`async function ${acao}\\(req[^)]*\\)[^{]*\\{\\r?\\n\\s+const caller = await getCallerAtivo\\(req, svc\\)`))
    }
  })
})
