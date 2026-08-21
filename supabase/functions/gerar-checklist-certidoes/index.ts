// gerar-checklist-certidoes — monta o CHECKLIST DEFINITIVO de certidões de um crédito.
//
// Substitui a leitura manual da planilha "Modelo: Análise de Precatórios", aba
// Análise Jurídica. O que a pessoa faz hoje — ler a planilha e decidir quais
// certidões pedir — sai daqui pronto, a partir de duas tabelas de configuração
// (certidao_catalogo e certidao_regra, criadas na migration 0042).
//
// O ganho não é digitar menos. É NÃO ESQUECER: o cônjuge, a empresa em que o
// cedente é sócio, e cada estado e município onde ele já morou. É exatamente
// onde a conferência manual falha, porque a omissão não deixa rastro.
//
// USO (POST, com sessão logada):
//   { "kommo_lead_id": 15269795 }
//
// Idempotente: rodar duas vezes não duplica: o insert é ON CONFLICT DO NOTHING
// sobre (kommo_lead_id, sujeito_id, certidao_codigo, parametros_hash). Isso
// importa porque o operador vai clicar duas vezes.
//
// ⚠️ O QUE ESTA FUNÇÃO NÃO FAZ: emitir certidão. Ela produz a LISTA. A emissão
// é assunto da fila do operador — a maioria dos portais exige CAPTCHA ou login
// gov.br, e nada aqui tenta contornar isso.

import { corsHeaders } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'

const CORS = corsHeaders

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

// ---------------------------------------------------------------- tipos

interface Certidao {
  codigo: string
  nome_curto: string
  nome_oficial: string
  orgao_emissor: string
  ordem_canonica: number
  metodo: string
  captcha: string
  login: string
  dados_entrada: string[]
  dados_entrada_pf: string[]
  dados_entrada_pj: string[]
}

interface Regra {
  id: number
  tipo: 'FIXA' | 'VARIAVEL'
  condicao: Record<string, unknown>
  certidao_codigo: string
  aplica_a: string[]
  parametros: Record<string, string>
  obrigatoria: boolean
  justificativa: string
  origem: string
}

interface Sujeito {
  id: string
  papel: string
  tipo_pessoa: 'PF' | 'PJ'
  nome: string
  documento: string
  nome_mae: string | null
  data_nascimento: string | null
  rg: string | null
  uf_atual: string | null
  municipio_atual: string | null
  ufs_anteriores: string[]
  municipios_anteriores: string[]
  residencia_levantada: boolean
}

interface ItemNovo {
  kommo_lead_id: number
  sujeito_id: string
  certidao_codigo: string
  parametros: Record<string, string>
  parametros_hash: string
  obrigatoria: boolean
  regra_id: number
  status: string
  erro_classe: string | null
  erro_detalhe: string | null
}

// ---------------------------------------------------------------- avaliação

/**
 * Valores do contexto para um campo de condição.
 *
 * `uf` e `municipio` vêm do HISTÓRICO DE RESIDÊNCIA do sujeito, não dos
 * tribunais onde a busca por CPF achou processo. São eixos diferentes: uma
 * residência antiga pode não ter processo nenhum e ainda assim exigir a
 * certidão estadual daquele estado (planilha, linhas 48, 64 e 78).
 */
function valoresDe(campo: string, s: Sujeito, comarcas: string[]): string[] {
  switch (campo) {
    case 'uf':
      return [s.uf_atual, ...(s.ufs_anteriores ?? [])].filter(Boolean) as string[]
    case 'municipio':
      return [s.municipio_atual, ...(s.municipios_anteriores ?? [])].filter(Boolean) as string[]
    case 'comarca':
      return comarcas
    case 'tipo_pessoa':
      return [s.tipo_pessoa]
    case 'papel':
      return [s.papel]
    default:
      // Campo desconhecido não pode virar "condição não casou" em silêncio:
      // uma regra com typo passaria a nunca disparar e ninguém veria.
      throw new Error(`Campo desconhecido na condição da regra: ${campo}`)
  }
}

function casaValor(esperado: unknown, presentes: string[]): boolean {
  if (typeof esperado === 'string') return presentes.includes(esperado)
  if (Array.isArray(esperado)) return esperado.some((v) => presentes.includes(String(v)))

  if (esperado && typeof esperado === 'object') {
    const op = esperado as Record<string, unknown>
    const listar = (k: string) => (op[k] as unknown[] ?? []).map(String)

    // not_in é EXCLUSÃO DURA: basta um valor presente na lista para a regra não
    // disparar. Use quando a presença do valor contamina o caso.
    if ('not_in' in op && presentes.some((v) => listar('not_in').includes(v))) return false

    // any_not_in dispara se existe ALGUM valor fora da lista.
    //
    // A diferença entre os dois não é acadêmica: um cedente que morou em MG e em
    // SP precisa da CENPROT Nacional (por causa de MG) E da CENPROT-SP. Com
    // not_in, a presença de SP cancelava a nacional e o dossiê perdia MG — um
    // furo que não aparece na tela, porque o item simplesmente não existe.
    if ('any_not_in' in op) {
      const fora = presentes.filter((v) => !listar('any_not_in').includes(v))
      if (fora.length === 0) return false
    }

    if ('eq' in op && !presentes.includes(String(op.eq))) return false
    if ('in' in op && !listar('in').some((v) => presentes.includes(v))) return false
    return true
  }
  throw new Error(`Valor de condição não suportado: ${JSON.stringify(esperado)}`)
}

function avalia(
  condicao: Record<string, unknown>,
  s: Sujeito,
  comarcas: string[],
): boolean {
  if (condicao.sempre === true) return true
  return Object.entries(condicao).every(([campo, esperado]) =>
    casaValor(esperado, valoresDe(campo, s, comarcas)),
  )
}

// ---------------------------------------------------------------- fan-out

/** JSON com chaves ordenadas — o hash tem que ser estável entre execuções. */
function canonico(o: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).sort()))
}

async function hash(o: Record<string, string>): Promise<string> {
  const bytes = new TextEncoder().encode(canonico(o))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Expande os parâmetros da regra. `{{ufs}}` gera UM ITEM POR UF de residência;
 * `{{cnj}}` só preenche.
 *
 * Quando o template pede uma coleção e o contexto não tem nenhum valor, o item
 * NÃO desaparece: nasce como pendência com escopo indefinido. Sumir seria o
 * comportamento errado — a certidão continua sendo exigida, só não se sabe
 * ainda de qual estado.
 */
function expandir(
  regra: Regra,
  s: Sujeito,
  comarcas: string[],
  cnj: string | null,
): { parametros: Record<string, string>; escopoIndefinido: string | null }[] {
  const fixos: Record<string, string> = {}
  let dimensao: { chave: string; valores: string[] } | null = null

  for (const [chave, valor] of Object.entries(regra.parametros ?? {})) {
    const m = /^\{\{\s*([a-z_]+)\s*\}\}$/.exec(String(valor))
    if (!m) {
      fixos[chave] = String(valor)
      continue
    }
    switch (m[1]) {
      case 'ufs':
        dimensao = { chave, valores: valoresDe('uf', s, comarcas) }
        break
      case 'municipios':
        dimensao = { chave, valores: valoresDe('municipio', s, comarcas) }
        break
      case 'comarcas':
        dimensao = { chave, valores: comarcas }
        break
      case 'cnj':
        if (cnj) fixos[chave] = cnj
        break
      default:
        throw new Error(`Template desconhecido na regra ${regra.id}: ${valor}`)
    }
  }

  if (!dimensao) return [{ parametros: fixos, escopoIndefinido: null }]

  if (dimensao.valores.length === 0) {
    return [{
      parametros: fixos,
      escopoIndefinido:
        `A regra exige '${dimensao.chave}', mas não há nenhum valor conhecido ` +
        `para ${s.papel}. Definir manualmente antes de emitir.`,
    }]
  }

  // Ordena para o resultado ser estável entre execuções.
  return [...new Set(dimensao.valores)].sort().map((v) => ({
    parametros: { ...fixos, [dimensao!.chave]: v },
    escopoIndefinido: null,
  }))
}

// ---------------------------------------------------------------- insumos

/**
 * O item pode sequer ser TENTADO?
 *
 * Faltar o nome da mãe não pode fazer a certidão desaparecer do checklist: ela
 * nasce PENDENTE_MANUAL com o campo que falta nomeado, e continua obrigatória.
 * É o princípio "não consegui emitir ≠ não precisa emitir" aplicado já na
 * origem, antes de qualquer tentativa de emissão.
 */
function classificarInicio(
  cert: Certidao,
  s: Sujeito,
  parametros: Record<string, string>,
): { status: string; erro_classe: string | null; erro_detalhe: string | null } {
  const exigidos = new Set([
    ...(cert.dados_entrada ?? []),
    ...((s.tipo_pessoa === 'PF' ? cert.dados_entrada_pf : cert.dados_entrada_pj) ?? []),
  ])

  const disponiveis = new Set<string>(Object.keys(parametros))
  if (s.documento) ['documento', 'cpf', 'cnpj'].forEach((k) => disponiveis.add(k))
  if (s.nome) disponiveis.add('nome')
  if (s.nome_mae) disponiveis.add('nome_mae')
  if (s.data_nascimento) disponiveis.add('data_nascimento')
  if (s.rg) disponiveis.add('rg')

  const faltando = [...exigidos].filter((k) => !disponiveis.has(k)).sort()
  if (faltando.length) {
    return {
      status: 'PENDENTE_MANUAL',
      erro_classe: 'DADO_FALTANTE',
      erro_detalhe:
        `Falta no cadastro de ${s.papel}: ${faltando.join(', ')}. ` +
        `A certidão continua obrigatória.`,
    }
  }

  // Bloqueio estrutural vai direto para a fila humana, sem nunca tentar
  // automação: não se contorna CAPTCHA nem login gov.br.
  if (cert.login === 'govbr' || cert.login === 'certificado_digital') {
    return {
      status: 'PENDENTE_MANUAL',
      erro_classe: 'BLOQUEIO',
      erro_detalhe: `Portal exige ${cert.login}.`,
    }
  }
  if (cert.metodo === 'manual') {
    return {
      status: 'PENDENTE_MANUAL',
      erro_classe: 'SEM_ADAPTER',
      erro_detalhe: 'Sem automação disponível — emissão manual.',
    }
  }
  return { status: 'PENDENTE', erro_classe: null, erro_detalhe: null }
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const svc = serviceClient()
    const user = await getCallerAtivo(req, svc)
    if (!user) return json({ erro: ERRO_ACESSO }, 401)

    const body = await req.json().catch(() => ({}))
    const leadId = Number((body as any).kommo_lead_id ?? (body as any).lead_id ?? 0)
    if (!leadId) return json({ erro: 'kommo_lead_id é obrigatório.' }, 400)

    // ---- 1. Sujeitos ----
    const { data: sujeitos, error: erroSuj } = await svc
      .from('dd_sujeito')
      .select('*')
      .eq('kommo_lead_id', leadId)
    if (erroSuj) return json({ erro: `Falha ao ler sujeitos: ${erroSuj.message}` }, 500)
    if (!sujeitos?.length) {
      return json({
        erro: 'Nenhum sujeito cadastrado para este crédito. ' +
              'O checklist é POR SUJEITO — informe ao menos o cedente.',
      }, 400)
    }

    // ---- 2. Catálogo e regras vigentes ----
    const hoje = new Date().toISOString().slice(0, 10)
    const [{ data: catalogo }, { data: regras }] = await Promise.all([
      svc.from('certidao_catalogo').select('*'),
      svc.from('certidao_regra').select('*')
        .lte('vigencia_inicio', hoje)
        .or(`vigencia_fim.is.null,vigencia_fim.gt.${hoje}`),
    ])
    if (!catalogo?.length) {
      return json({ erro: 'Catálogo de certidões vazio — a migration 0042 rodou?' }, 500)
    }
    if (!regras?.length) return json({ erro: `Nenhuma regra vigente em ${hoje}.` }, 500)

    const porCodigo = new Map<string, Certidao>(
      (catalogo as Certidao[]).map((c) => [c.codigo, c]),
    )

    // Comarca vem da pesquisa processual, que ainda não existe (integração Judit
    // pendente). Fica vazio de propósito: as regras que dependem de comarca vão
    // gerar pendência de escopo indefinido em vez de sumir do checklist.
    const comarcas: string[] = []

    const { data: lead } = await svc
      .from('kommo_leads').select('processo_cnj').eq('kommo_lead_id', leadId).maybeSingle()
    const cnj: string | null = lead?.processo_cnj ?? null

    // ---- 3. Montagem ----
    const itens: ItemNovo[] = []
    const vistos = new Set<string>()
    const avisos: string[] = []

    for (const s of sujeitos as Sujeito[]) {
      for (const r of regras as Regra[]) {
        if (!(r.aplica_a ?? []).includes(s.papel)) continue

        const cert = porCodigo.get(r.certidao_codigo)
        if (!cert) {
          avisos.push(
            `Regra ${r.id} aponta para a certidão ${r.certidao_codigo}, que não ` +
            `está no catálogo. Regra ignorada.`,
          )
          continue
        }
        if (r.tipo !== 'FIXA' && !avalia(r.condicao, s, comarcas)) continue

        for (const exp of expandir(r, s, comarcas, cnj)) {
          const h = await hash(exp.parametros)
          const chave = `${s.id}|${cert.codigo}|${h}`
          if (vistos.has(chave)) continue
          vistos.add(chave)

          const cls = exp.escopoIndefinido
            ? {
                status: 'PENDENTE_MANUAL',
                erro_classe: 'ESCOPO_INDEFINIDO',
                erro_detalhe: exp.escopoIndefinido,
              }
            : classificarInicio(cert, s, exp.parametros)

          itens.push({
            kommo_lead_id: leadId,
            sujeito_id: s.id,
            certidao_codigo: cert.codigo,
            parametros: exp.parametros,
            parametros_hash: h,
            obrigatoria: r.obrigatoria,
            regra_id: r.id,
            ...cls,
          })
        }
      }

      // Avisos que NÃO podem ser silenciados: cada um destes é um checklist
      // aparentemente completo e de fato furado.
      if (!s.residencia_levantada) {
        avisos.push(
          `${s.papel} (${s.nome}): histórico de residência não levantado. O ` +
          `checklist cobre apenas os endereços conhecidos hoje — pode faltar ` +
          `certidão estadual ou municipal de onde a pessoa morou antes.`,
        )
      }
    }

    if (!(sujeitos as Sujeito[]).some((s) => s.papel === 'CONJUGE')) {
      avisos.push(
        'Nenhum cônjuge informado. Se o cedente for casado, o checklist está ' +
        'INCOMPLETO: a planilha dá bloco próprio de certidões ao cônjuge ' +
        '(linhas 52 a 67).',
      )
    }

    // ---- 4. Grava ----
    const { error: erroIns } = await svc
      .from('dd_certidao')
      .upsert(itens, {
        onConflict: 'kommo_lead_id,sujeito_id,certidao_codigo,parametros_hash',
        ignoreDuplicates: true,
      })
    if (erroIns) return json({ erro: `Falha ao gravar checklist: ${erroIns.message}` }, 500)

    // ---- 5. Devolve o placar ----
    const { data: comp } = await svc
      .from('v_dd_completude').select('*').eq('kommo_lead_id', leadId).maybeSingle()

    return json({
      ok: true,
      kommo_lead_id: leadId,
      total: itens.length,
      obrigatorias: itens.filter((i) => i.obrigatoria).length,
      pendencia_imediata: itens.filter((i) => i.status === 'PENDENTE_MANUAL').length,
      por_sujeito: (sujeitos as Sujeito[]).map((s) => ({
        papel: s.papel,
        nome: s.nome,
        certidoes: itens.filter((i) => i.sujeito_id === s.id).length,
      })),
      completude: comp ?? null,
      avisos,
    })
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500)
  }
})
