// Cadastra na ADVBOX o processo de um crédito ou de um requerimento recém-salvo.
//
// POR QUE ISTO EXISTE: a ADVBOX só traz movimentações de processo que está
// cadastrado nela. Registro cadastrado aqui e esquecido lá fica sem andamentos, e a
// falta não aparece em lugar nenhum — a aba Movimentações simplesmente não mostra
// aquele processo, o que é indistinguível de "não houve movimentação".
//
// DUAS AÇÕES:
//   options — lê as listas da conta (usuários, fases, tipos, e o cliente por nome)
//             para a tela de Configurações oferecer escolhas em vez de pedir IDs.
//   criar   — cadastra UM registro, crédito ou requerimento. É IDEMPOTENTE:
//             consulta antes de criar, tanto no nosso banco quanto na ADVBOX.
//
// A IDEMPOTÊNCIA É O CORAÇÃO DISTO. Criar processo duplicado no sistema onde o
// escritório trabalha é dano que só se desfaz à mão, e a chamada acontece a cada
// salvamento — inclusive nos salvamentos repetidos de quem corrige um campo e salva
// de novo.
//
// O FORMATO DO NÚMERO decide o campo (CNJ -> process_number, resto ->
// protocol_number) e, no requerimento que é distribuído depois, o número é PROMOVIDO
// no registro que já existe. Ver o comentário de Alvo.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { getAdvboxCtx, getJson, pickArray, enviarJson } from '../_shared/advbox.ts'

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

/**
 * Converte para número o id que chegou como texto — e só quando ele É um número.
 *
 * Os ids vêm de <select> na tela de Configurações, e valor de <select> é sempre
 * string. A API aceita string ou inteiro em users_id, stages_id e
 * type_lawsuits_id, MAS documenta customers_id como array de INTEIROS: [8795916]
 * passa onde ["8795916"] pode ser recusado. O caso apareceria só quando alguém
 * reescolhesse o cliente na lista — muito depois de a integração ter funcionado,
 * e sem ninguém ligar uma coisa à outra.
 *
 * Devolve o valor original quando não é numérico, em vez de NaN: id que um dia
 * venha com letra deve chegar à API como está e ser recusado por ela, não virar
 * "NaN" no caminho.
 */
function idNumerico(v: number | string | undefined): number | string | undefined {
  if (v == null || v === '') return undefined
  const t = String(v).trim()
  const n = Number(t)
  return Number.isInteger(n) && String(n) === t ? n : v
}

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
  campo: CampoNumero,
): Promise<{ id: string } | null> {
  const formas = [numero.trim(), onlyDigits(numero)].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  )
  for (const forma of formas) {
    const j = await getJson(ctx, `/lawsuits?${campo}=${encodeURIComponent(forma)}`)
    const achados = pickArray(j)
    // Confere o número do que voltou em vez de confiar no filtro: se um dia ele
    // passar a casar parcialmente, aceitar o primeiro resultado vincularia o
    // registro ao processo errado — e vínculo errado é pior que vínculo ausente,
    // porque some do relatório de faltantes.
    const casado = achados.find((l) => onlyDigits(l[campo]) === onlyDigits(numero))
    if (casado?.id != null) return { id: String(casado.id) }
  }
  return null
}

/**
 * O que vai ser cadastrado — crédito ou requerimento administrativo.
 *
 * O FORMATO DO NÚMERO ESCOLHE O CAMPO, e a escolha tem consequência:
 *
 *   20 dígitos (CNJ) -> `process_number`. É validado pela ADVBOX contra as bases dos
 *                       tribunais, e é por ele que os robôs dela buscam os
 *                       andamentos. Só assim vem movimentação automática.
 *   qualquer outro    -> `protocol_number`. Campo livre, sem validação. O registro
 *                       existe na ADVBOX, com responsável e tarefas, e casa com a
 *                       sincronização (que procura pelos dois campos), mas NÃO ganha
 *                       andamento automático.
 *
 * Crédito é exceção: é sempre processo judicial, então número que não seja CNJ ali é
 * erro de cadastro, não outra natureza de registro.
 *
 * Requerimento distribuído GANHA o CNJ depois. Por isso o cadastro é tentado também
 * ao editar, e não só ao criar.
 */
type CampoNumero = 'process_number' | 'protocol_number'

/**
 * Número CNJ tem exatamente 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO). Teste estrito,
 * e não "tem muitos dígitos": protocolo administrativo longo passaria por CNJ, a
 * ADVBOX recusaria contra as bases dos tribunais, e o erro chegaria à tela como
 * falha de cadastro em vez de "este número não é judicial".
 */
const pareceCNJ = (n: string) => onlyDigits(n).length === 20

interface Alvo {
  tabela: 'processos' | 'requerimentos' | 'apensos'
  id: string
  numero: string
  campo: CampoNumero
  /** Nome que identifica o registro na lista da ADVBOX (máx. 30 pela API). */
  pasta: string
  jaVinculado: string | null
}

/**
 * Pasta de um apenso: o nome do PAI, não a classe do incidente.
 *
 * "Agravo de instrumento" não identifica nada na lista da ADVBOX — o escritório tem
 * vários. O que identifica é de quem é o processo principal, e é por isso que vale
 * uma consulta a mais aqui. A classe entra como reserva quando o pai não tem nome.
 */
async function pastaDoApenso(
  svc: ReturnType<typeof serviceClient>,
  ap: { processo_id?: string | null; requerimento_id?: string | null; classe_processual?: string | null },
): Promise<string> {
  if (ap.processo_id) {
    const { data } = await svc
      .from('processos')
      .select('cedente')
      .eq('id', ap.processo_id)
      .maybeSingle()
    if (data?.cedente) return String(data.cedente).slice(0, 30)
  } else if (ap.requerimento_id) {
    const { data } = await svc
      .from('requerimentos')
      .select('assunto')
      .eq('id', ap.requerimento_id)
      .maybeSingle()
    if (data?.assunto) return String(data.assunto).slice(0, 30)
  }
  return String(ap.classe_processual ?? '').slice(0, 30)
}

/** Carrega do BANCO o que vai ser cadastrado. Quem chama manda só o id. */
async function lerAlvo(body: Record<string, unknown>): Promise<
  { alvo: Alvo } | { erro: string; status: number }
> {
  const svc = serviceClient()
  const requerimentoId = String(body.requerimento_id ?? '')
  const processoId = String(body.processo_id ?? '')
  const apensoId = String(body.apenso_id ?? '')

  if (apensoId) {
    const { data, error } = await svc
      .from('apensos')
      .select(
        'id, numero, classe_processual, processo_id, requerimento_id, advbox_lawsuit_id',
      )
      .eq('id', apensoId)
      .maybeSingle()
    if (error) return { erro: error.message, status: 500 }
    if (!data) return { erro: 'Apenso não encontrado.', status: 404 }
    const numeroAp = String(data.numero ?? '').trim()
    return {
      alvo: {
        tabela: 'apensos',
        id: String(data.id),
        numero: numeroAp,
        // Apenso tem CNJ próprio (agravo, embargo, incidente), mas nem sempre: o
        // formato decide, como no requerimento.
        campo: pareceCNJ(numeroAp) ? 'process_number' : 'protocol_number',
        pasta: await pastaDoApenso(svc, data),
        jaVinculado: data.advbox_lawsuit_id ? String(data.advbox_lawsuit_id) : null,
      },
    }
  }

  if (requerimentoId) {
    const { data, error } = await svc
      .from('requerimentos')
      .select('id, numero_protocolo, assunto, orgao, advbox_lawsuit_id')
      .eq('id', requerimentoId)
      .maybeSingle()
    if (error) return { erro: error.message, status: 500 }
    if (!data) return { erro: 'Requerimento não encontrado.', status: 404 }
    const numeroReq = String(data.numero_protocolo ?? '').trim()
    return {
      alvo: {
        tabela: 'requerimentos',
        id: String(data.id),
        numero: numeroReq,
        // O formato decide: CNJ vai para o campo que liga o monitoramento, o resto
        // entra como protocolo. Ver o comentário de Alvo.
        campo: pareceCNJ(numeroReq) ? 'process_number' : 'protocol_number',
        // Assunto antes do órgão: é o que distingue dois requerimentos do mesmo
        // órgão na lista da ADVBOX.
        pasta: String(data.assunto ?? data.orgao ?? '').slice(0, 30),
        jaVinculado: data.advbox_lawsuit_id ? String(data.advbox_lawsuit_id) : null,
      },
    }
  }

  if (!processoId) {
    return {
      erro: 'Informe processo_id, requerimento_id ou apenso_id.',
      status: 400,
    }
  }
  const { data, error } = await svc
    .from('processos')
    .select('id, numero_cnj, cedente, advbox_lawsuit_id')
    .eq('id', processoId)
    .maybeSingle()
  if (error) return { erro: error.message, status: 500 }
  if (!data) return { erro: 'Crédito não encontrado.', status: 404 }
  return {
    alvo: {
      tabela: 'processos',
      id: String(data.id),
      numero: String(data.numero_cnj ?? '').trim(),
      campo: 'process_number',
      pasta: String(data.cedente ?? '').slice(0, 30),
      jaVinculado: data.advbox_lawsuit_id ? String(data.advbox_lawsuit_id) : null,
    },
  }
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

    // O registro é LIDO DO BANCO, não aceito do cliente: quem chama manda só o id.
    // Aceitar o número pelo corpo deixaria qualquer autenticado cadastrar na
    // ADVBOX do escritório algo que não existe na plataforma.
    const lido = await lerAlvo(body as Record<string, unknown>)
    if ('erro' in lido) return jsonResponse({ error: lido.erro }, lido.status)
    const { alvo } = lido

    if (alvo.jaVinculado) {
      // REQUERIMENTO QUE FOI DISTRIBUÍDO DEPOIS DE CADASTRADO. Ele entrou na ADVBOX
      // com o protocolo do órgão; agora tem CNJ, e é o CNJ que liga o monitoramento.
      // Sem promover o número aqui, o caso que motivou o pedido — requerimento que
      // vira processo — ficaria para sempre sem andamento automático, com o registro
      // existindo e ninguém entendendo por que nada chega.
      //
      // PUT parcial: só o campo do número vai no corpo, o resto do registro fica
      // como está (confirmado na documentação da API).
      if (alvo.tabela !== 'processos' && pareceCNJ(alvo.numero)) {
        const atual = (await getJson(ctx, `/lawsuits/${alvo.jaVinculado}`)) as
          | Record<string, unknown>
          | null
        const naAdvbox = (atual?.data as Record<string, unknown> | undefined) ?? atual
        // Só escreve se estiver diferente: salvar um requerimento já promovido não
        // precisa mandar PUT nenhum.
        if (onlyDigits(naAdvbox?.process_number) !== onlyDigits(alvo.numero)) {
          await enviarJson(ctx, 'PUT', `/lawsuits/${alvo.jaVinculado}`, {
            process_number: alvo.numero,
          })
          return jsonResponse({
            ok: true,
            promovido: true,
            lawsuit_id: alvo.jaVinculado,
          })
        }
      }
      return jsonResponse({ ok: true, ja_existia: true, lawsuit_id: alvo.jaVinculado })
    }

    // Sem número não há nem o que cadastrar nem como casar a sincronização depois.
    if (!alvo.numero) {
      return jsonResponse({
        ok: false,
        motivo: 'sem_numero',
        detalhe: 'Sem número não há o que cadastrar na ADVBOX.',
      })
    }
    // Crédito é sempre processo judicial: número que não seja CNJ ali é erro de
    // cadastro, e a ADVBOX recusaria contra as bases dos tribunais. Requerimento não
    // passa por aqui — para ele, não ser CNJ apenas muda o campo.
    if (alvo.tabela === 'processos' && !pareceCNJ(alvo.numero)) {
      return jsonResponse({
        ok: false,
        motivo: 'sem_cnj',
        detalhe:
          'A ADVBOX valida o número contra as bases dos tribunais, e este não tem os 20 dígitos de um CNJ.',
      })
    }

    // Já cadastrado lá por outra via (à mão, ou por um salvamento anterior que
    // falhou depois de criar)? Só vincula.
    const existente = await acharNaAdvbox(ctx, alvo.numero, alvo.campo)
    if (existente) {
      await svc
        .from(alvo.tabela)
        .update({ advbox_lawsuit_id: existente.id })
        .eq('id', alvo.id)
      return jsonResponse({ ok: true, ja_existia: true, lawsuit_id: existente.id })
    }

    const criado = await enviarJson(ctx, 'POST', '/lawsuits', {
      users_id: idNumerico(cfg.users_id),
      customers_id: [idNumerico(cfg.customers_id)],
      stages_id: idNumerico(cfg.stages_id),
      type_lawsuits_id: idNumerico(cfg.type_lawsuits_id),
      // O número vai no campo que corresponde à natureza do registro. Ver Alvo.
      [alvo.campo]: alvo.numero,
      // Pasta com o nome do cedente (ou o assunto do requerimento): é assim que o
      // escritório reconhece o registro na lista da ADVBOX.
      folder: alvo.pasta || undefined,
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
      .from(alvo.tabela)
      .update({ advbox_lawsuit_id: String(novoId) })
      .eq('id', alvo.id)
    if (erroUp) throw new Error(erroUp.message)

    return jsonResponse({ ok: true, criado: true, lawsuit_id: String(novoId) })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
