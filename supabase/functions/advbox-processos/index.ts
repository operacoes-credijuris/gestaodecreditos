// Cadastra na ADVBOX o processo de um crédito recém-salvo.
//
// POR QUE ISTO EXISTE: a ADVBOX só traz movimentações de processo que está
// cadastrado nela. Crédito cadastrado aqui e esquecido lá fica sem andamentos, e a
// falta não aparece em lugar nenhum — a aba Movimentações simplesmente não mostra
// aquele processo, o que é indistinguível de "não houve movimentação".
//
// DUAS AÇÕES:
//   options — lê as listas da conta (usuários, fases, tipos, e o cliente por nome)
//             para a tela de Configurações oferecer escolhas em vez de pedir IDs.
//   criar   — cria o processo de UM crédito. É IDEMPOTENTE: consulta antes de
//             criar, tanto no nosso banco quanto na ADVBOX.
//
// A IDEMPOTÊNCIA É O CORAÇÃO DISTO. Criar processo duplicado no sistema onde o
// escritório trabalha é dano que só se desfaz à mão, e a chamada acontece a cada
// salvamento de crédito — inclusive nos salvamentos repetidos de quem corrige um
// campo e salva de novo.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { getAdvboxCtx, getJson, pickArray, postJson } from '../_shared/advbox.ts'

/** Configuração gravada em integracoes.config->criar_processo. */
interface ConfigCriar {
  ativo?: boolean
  users_id?: number | string
  stages_id?: number | string
  type_lawsuits_id?: number | string
  customers_id?: number | string
  customer_nome?: string
}

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

async function lerConfig(): Promise<ConfigCriar> {
  const { data } = await serviceClient()
    .from('integracoes')
    .select('config')
    .eq('servico', 'advbox')
    .maybeSingle()
  const cfg = (data?.config ?? {}) as { criar_processo?: ConfigCriar }
  return cfg.criar_processo ?? {}
}

/**
 * Procura na ADVBOX um processo com este número.
 *
 * Duas tentativas porque o filtro é de igualdade EXATA e não sabemos em qual forma
 * o processo foi cadastrado lá: com pontuação, como a plataforma guarda, ou só
 * dígitos, como muita gente digita. Uma consulta a mais é barata; um processo
 * duplicado, não.
 */
async function acharNaAdvbox(
  ctx: Awaited<ReturnType<typeof getAdvboxCtx>>,
  numero: string,
): Promise<{ id: string; process_number?: string } | null> {
  const formas = [numero.trim(), onlyDigits(numero)].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  )
  for (const forma of formas) {
    const j = await getJson(ctx, `/lawsuits?process_number=${encodeURIComponent(forma)}`)
    const achados = pickArray(j)
    // Confere o número do que voltou em vez de confiar no filtro: se um dia ele
    // passar a casar parcialmente, aceitar o primeiro resultado vincularia o
    // crédito ao processo errado — e vínculo errado é pior que vínculo ausente,
    // porque some do relatório de faltantes.
    const casado = achados.find(
      (l) => onlyDigits(l.process_number) === onlyDigits(numero),
    )
    if (casado?.id != null) {
      return { id: String(casado.id), process_number: String(casado.process_number ?? '') }
    }
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? 'criar')
    const ctx = await getAdvboxCtx()

    // ---------------- options ----------------
    if (action === 'options') {
      const s = (await getJson(ctx, '/settings')) as {
        users?: Record<string, unknown>[]
        stages?: Record<string, unknown>[]
        lawsuit_types?: Record<string, unknown>[]
      }
      const lista = (arr: Record<string, unknown>[] | undefined, campos: string[]) =>
        (arr ?? [])
          .map((o) => ({
            id: o.id,
            // O nome vem em campo diferente por lista (name, stage, type…), então
            // o primeiro campo preenchido vale — sem isto a tela mostraria
            // "undefined" em vez do rótulo.
            name: String(campos.map((c) => o[c]).find((v) => v != null) ?? ''),
          }))
          .filter((o) => o.id != null && o.name)
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

      const nome = String(body.cliente_nome ?? 'credijuris').trim()
      const jc = await getJson(ctx, `/customers?name=${encodeURIComponent(nome)}&limit=50`)
      const customers = pickArray(jc)
        .map((c) => ({ id: c.id, name: String(c.name ?? '') }))
        .filter((c) => c.id != null && c.name)

      return jsonResponse({
        ok: true,
        users: lista(s.users, ['name', 'user', 'nome']),
        stages: lista(s.stages, ['stage', 'name', 'nome']),
        lawsuit_types: lista(s.lawsuit_types, ['type', 'name', 'lawsuit_type', 'nome']),
        customers,
      })
    }

    // ---------------- criar ----------------
    if (action !== 'criar') return jsonResponse({ error: 'Ação desconhecida.' }, 400)

    const cfg = await lerConfig()
    // Sem configuração NÃO é erro: é o estado normal antes de alguém escolher o
    // responsável, a fase e o tipo. Devolve motivo para a tela poder ficar calada
    // em vez de acusar falha a cada crédito salvo.
    if (!cfg.ativo) return jsonResponse({ ok: false, motivo: 'desligado' })
    const faltando = (
      ['users_id', 'stages_id', 'type_lawsuits_id', 'customers_id'] as const
    ).filter((k) => cfg[k] == null || cfg[k] === '')
    if (faltando.length) {
      return jsonResponse({ ok: false, motivo: 'incompleto', faltando })
    }

    const processoId = String(body.processo_id ?? '')
    if (!processoId) return jsonResponse({ error: 'processo_id é obrigatório.' }, 400)

    // O crédito é LIDO DO BANCO, não aceito do cliente: quem chama manda só o id.
    // Aceitar o número pelo corpo deixaria qualquer autenticado cadastrar na
    // ADVBOX do escritório um processo que não existe na plataforma.
    const { data: proc, error: erroProc } = await svc
      .from('processos')
      .select('id, numero_cnj, cedente, advbox_lawsuit_id')
      .eq('id', processoId)
      .maybeSingle()
    if (erroProc) throw new Error(erroProc.message)
    if (!proc) return jsonResponse({ error: 'Crédito não encontrado.' }, 404)

    if (proc.advbox_lawsuit_id) {
      return jsonResponse({
        ok: true,
        ja_existia: true,
        lawsuit_id: proc.advbox_lawsuit_id,
      })
    }

    const numero = String(proc.numero_cnj ?? '').trim()
    if (onlyDigits(numero).length < 15) {
      return jsonResponse({
        ok: false,
        motivo: 'numero_invalido',
        detalhe:
          'A ADVBOX valida o número contra as bases dos tribunais, e este não parece um CNJ completo.',
      })
    }

    // Já cadastrado lá por outra via (à mão, ou por um salvamento anterior que
    // falhou depois de criar)? Só vincula.
    const existente = await acharNaAdvbox(ctx, numero)
    if (existente) {
      await svc
        .from('processos')
        .update({ advbox_lawsuit_id: existente.id })
        .eq('id', proc.id)
      return jsonResponse({ ok: true, ja_existia: true, lawsuit_id: existente.id })
    }

    const criado = await postJson(ctx, '/lawsuits', {
      users_id: cfg.users_id,
      customers_id: [cfg.customers_id],
      stages_id: cfg.stages_id,
      type_lawsuits_id: cfg.type_lawsuits_id,
      process_number: numero,
      // Pasta com o nome do cedente: é assim que o escritório reconhece o processo
      // na lista da ADVBOX. Limite de 30 caracteres é da API.
      folder: String(proc.cedente ?? '').slice(0, 30) || undefined,
    })
    const criadoObj = (criado ?? {}) as Record<string, unknown>
    const novoId =
      criadoObj.id ??
      (criadoObj.data as Record<string, unknown> | undefined)?.id ??
      (pickArray(criado)[0] as Record<string, unknown> | undefined)?.id

    if (novoId == null) {
      // Criou mas não devolveu id reconhecível: NÃO inventa vínculo. A consulta
      // da próxima passagem acha pelo número e vincula então.
      return jsonResponse({
        ok: true,
        criado: true,
        lawsuit_id: null,
        aviso: 'Processo criado, mas a ADVBOX não devolveu o id — o vínculo será feito no próximo salvamento.',
      })
    }

    const { error: erroUp } = await svc
      .from('processos')
      .update({ advbox_lawsuit_id: String(novoId) })
      .eq('id', proc.id)
    if (erroUp) throw new Error(erroUp.message)

    return jsonResponse({ ok: true, criado: true, lawsuit_id: String(novoId) })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
