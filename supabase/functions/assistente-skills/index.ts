// Gestão das Skills do assistente ("Clips"): listar, subir, ligar/desligar e
// remover. Exclusivo do admin — mesmo padrão de salvar-token-anthropic.
//
// Uma Skill é um pacote (SKILL.md + recursos) que roda dentro da ferramenta
// code_execution da Anthropic; o pacote em si fica hospedado lá (é escopado
// ao workspace inteiro, não por usuário). Esta função só guarda o METADADO
// local (skill_id, nome, se está ativa) — quem decide se o assistente usa a
// Skill numa conversa é a Edge Function `assistente`, lendo `ativo = true`.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, isAdmin, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCaller(req)
    if (!(await isAdmin(caller, svc))) {
      return jsonResponse({ error: 'Acesso restrito ao administrador.' }, 403)
    }

    const apiKey = await chaveAnthropic()
    if (!apiKey) {
      return jsonResponse(
        {
          error:
            'Configure a chave da Anthropic (Configurações → Integração Anthropic) ' +
            'antes de subir uma Skill.',
        },
        400,
      )
    }

    const contentType = req.headers.get('content-type') ?? ''

    // ---------------------------------------------------------- upload
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const nome = String(form.get('nome') ?? '').trim()
      const descricao = String(form.get('descricao') ?? '').trim() || null
      const arquivo = form.get('arquivo')

      if (!nome) return jsonResponse({ error: 'Dê um nome para a Skill.' }, 400)
      if (!(arquivo instanceof File)) {
        return jsonResponse({ error: 'Envie o arquivo .zip da Skill.' }, 400)
      }

      // Repassa o zip pra Anthropic — é ela quem valida o SKILL.md e devolve
      // o skill_id. A gente não abre o zip aqui, só encaminha.
      const repasse = new FormData()
      repasse.append('files[]', arquivo, arquivo.name)

      const resp = await fetch('https://api.anthropic.com/v1/skills', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: repasse,
      })
      const corpo = await resp.json().catch(() => null)
      if (!resp.ok) {
        return jsonResponse(
          {
            error:
              corpo?.error?.message ??
              `A Anthropic recusou a Skill (HTTP ${resp.status}).`,
          },
          400,
        )
      }
      const skillId = corpo?.id as string | undefined
      if (!skillId) {
        return jsonResponse({ error: 'A Anthropic não devolveu o id da Skill.' }, 502)
      }

      const { data, error } = await svc
        .from('assistente_skills')
        .insert({ skill_id: skillId, nome, descricao, criado_por: caller?.id ?? null })
        .select()
        .single()
      if (error) return jsonResponse({ error: error.message }, 400)
      return jsonResponse({ skill: data })
    }

    // ------------------------------------------------------ ações em JSON
    const body = await req.json().catch(() => ({}))
    const acao = String(body.acao ?? '')

    if (acao === 'listar') {
      const { data, error } = await svc
        .from('assistente_skills')
        .select('*')
        .order('criado_em', { ascending: false })
      if (error) return jsonResponse({ error: error.message }, 400)
      return jsonResponse({ skills: data })
    }

    if (acao === 'alternar') {
      const id = String(body.id ?? '')
      if (!id) return jsonResponse({ error: 'Informe a skill.' }, 400)
      const { data: atual, error: e0 } = await svc
        .from('assistente_skills')
        .select('ativo')
        .eq('id', id)
        .maybeSingle()
      if (e0) return jsonResponse({ error: e0.message }, 400)
      if (!atual) return jsonResponse({ error: 'Skill não encontrada.' }, 404)
      const { error } = await svc
        .from('assistente_skills')
        .update({ ativo: !atual.ativo })
        .eq('id', id)
      if (error) return jsonResponse({ error: error.message }, 400)
      return jsonResponse({ ok: true })
    }

    if (acao === 'remover') {
      const id = String(body.id ?? '')
      if (!id) return jsonResponse({ error: 'Informe a skill.' }, 400)
      // Só apaga a linha local — a Skill continua existindo na Anthropic
      // (é do workspace inteiro), pro caso de algum outro uso depender dela.
      const { error } = await svc.from('assistente_skills').delete().eq('id', id)
      if (error) return jsonResponse({ error: error.message }, 400)
      return jsonResponse({ ok: true })
    }

    return jsonResponse({ error: `Ação desconhecida: ${acao}` }, 400)
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
