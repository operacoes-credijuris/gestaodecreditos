// kommo-editar-nota — edita o texto de uma nota do card no Kommo, no lugar
// (20/10/2026, pedido do dono: o lápis da nota no histórico do card).
//
// O QUE ELA CONFERE antes de editar, tudo no Kommo e não no que a tela mandou:
//   - a nota existe e é DESTE card (entity_id);
//   - é nota de texto (`common`) e é de GENTE — não a automática da análise
//     (ver `ehNotaNossa`), não movimento, não anexo;
// e só então faz o PATCH do texto, com o rodapé de quem editou e quando (ver
// `_shared/edicaoDeNota.ts`). O espelho (`kommo_leads.notas`) recebe o texto
// novo na hora, para o histórico não mostrar o antigo até a próxima sincronização.
//
// USO (POST, com sessão logada): { "lead_id": 25131199, "nota_id": 123, "texto": "...", "autor": "Fulano" }

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { contaKommo } from '../_shared/segredos.ts'
import { kommoFetch } from '../_shared/kommoFetch.ts'
import { ehNotaNossa } from '../_shared/notaCredijuris.ts'
import { semEntidadesHtml } from '../_shared/etiquetasDoFundo.ts'
import { textoEditado, paramsDaNotaDeArquivo, textoProprioDaNotaDeArquivo } from '../_shared/edicaoDeNota.ts'
import { textoFicou } from '../_shared/notaComArquivo.ts'
import { postarNotas } from '../_shared/anotarNoKommo.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const leadId = Number(body.lead_id)
    const notaId = Number(body.nota_id)
    const novoCorpo = String(body.texto ?? '').trim()
    if (!leadId || !notaId) return jsonResponse({ error: 'lead_id e nota_id são obrigatórios.' }, 400)
    if (!novoCorpo) return jsonResponse({ error: 'O texto da nota não pode ficar vazio.' }, 400)

    // QUEM EDITA: o nome do perfil (o mesmo critério das outras funções que anotam).
    const { data: perfil } = await svc.from('profiles').select('nome, email').eq('id', caller.id).maybeSingle()
    const editor = String(body.autor ?? '').trim() || perfil?.nome?.trim() || perfil?.email || caller.email || 'usuário do sistema'

    const conta = await contaKommo()
    if (!conta) return jsonResponse({ error: 'Kommo não configurado.' }, 400)
    const base = `https://${conta.subdominio}.kommo.com/api/v4`
    const headers = { Authorization: `Bearer ${conta.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }

    // 1. A NOTA COMO O KOMMO A TEM.
    const lida = await kommoFetch(`${base}/leads/notes/${notaId}`, { headers })
    if (lida.status === 404 || lida.status === 204) {
      return jsonResponse({ error: 'Esta nota não existe mais no Kommo (foi apagada?). Sincronize o card.' }, 404)
    }
    if (!lida.ok) {
      return jsonResponse({ error: `O Kommo não deixou ler a nota (HTTP ${lida.status}).`, detalhe: (await lida.text().catch(() => '')).slice(0, 300) }, 502)
    }
    const nota = (await lida.json().catch(() => null)) as {
      entity_id?: number; note_type?: string; created_at?: number; params?: Record<string, unknown>
    } | null
    if (!nota || Number(nota.entity_id) !== leadId) {
      return jsonResponse({ error: 'Esta nota não é deste card.' }, 400)
    }
    // A NOTA DE ARQUIVO COM TEXTO TAMBÉM (27/10/2026, pedido do dono): a do
    // "Anotar" com anexo. A de arquivo sem texto (só o nome dele) não.
    const deArquivo = nota.note_type === 'attachment' && textoProprioDaNotaDeArquivo(nota.params) !== null
    if (nota.note_type !== 'common' && !deArquivo) {
      return jsonResponse({ error: 'Só as notas de texto podem ser editadas (não movimentação nem anexo).' }, 400)
    }
    const original = semEntidadesHtml(String(nota.params?.text ?? ''))
    const criadaEm = nota.created_at ? new Date(nota.created_at * 1000).toISOString() : null
    if (ehNotaNossa(original, criadaEm)) {
      return jsonResponse({ error: 'Nota automática da análise não se edita: é o registro do sistema.' }, 400)
    }

    // 2. O TEXTO NOVO, com o rastro da edição, NA MESMA NOTA.
    const texto = textoEditado(original, novoCorpo, editor, new Date())
    const res = await kommoFetch(
      `${base}/leads/notes/${notaId}`,
      // O `entity_id` É OBRIGATÓRIO (23/10/2026): sem ele o Kommo devolvia 400
      // "FieldMissing: entity_id" — a documentação do PATCH não o lista, mas a
      // validação do Kommo o exige. É o card já conferido acima.
      //
      // NA NOTA DE ARQUIVO, o arquivo vai junto, como o Kommo o tem: só o texto muda.
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(
          deArquivo
            ? { entity_id: leadId, note_type: 'attachment', params: paramsDaNotaDeArquivo(nota.params, texto) }
            : { entity_id: leadId, note_type: 'common', params: { text: texto } },
        ),
      },
      { idempotente: true },
    )
    if (!res.ok) {
      return jsonResponse({
        error: `O Kommo recusou a edição (HTTP ${res.status}).`,
        detalhe: (await res.text().catch(() => '')).slice(0, 300),
      }, 502)
    }

    // 2b. A NOTA DE ARQUIVO É CONFERIDA (27/10/2026): editar o texto dela pela
    // API nunca tinha sido feito, e o Kommo pode aceitar o pedido e guardar o
    // nome do arquivo no lugar. Não ficando o texto novo, ele vai numa nota de
    // texto ao lado — como no "Anotar" — e nada do que a pessoa escreveu se perde.
    let aviso: string | null = null
    if (deArquivo) {
      const relida = await kommoFetch(`${base}/leads/notes/${notaId}`, { headers }).catch(() => null)
      const depois = relida?.ok ? ((await relida.json().catch(() => null)) as { params?: { text?: unknown } } | null) : null
      if (!textoFicou(texto, depois?.params?.text)) {
        const r = await postarNotas(conta, leadId, [texto], { dePessoa: true, autor: editor })
        if (!r.ok) {
          return jsonResponse({
            error: 'O Kommo não guardou o texto novo na nota do arquivo, e a nota de texto ao lado também não subiu. Copie o texto antes de fechar.',
            detalhe: r.detalhe,
          }, 502)
        }
        return jsonResponse({
          ok: true,
          texto: null,
          aviso: 'O Kommo não deixou trocar o texto dentro da nota do arquivo; o texto editado foi gravado numa nota nova, logo abaixo no card.',
        })
      }
    }

    // 3. O ESPELHO, na hora. Falhar aqui não desfaz a edição: a próxima
    // sincronização traz o texto novo de qualquer jeito.
    try {
      const { data: card } = await svc.from('kommo_leads').select('notas').eq('kommo_lead_id', leadId).maybeSingle()
      const notas = Array.isArray(card?.notas) ? (card!.notas as Record<string, unknown>[]) : null
      if (notas) {
        const novas = notas.map((n) => (Number(n.id) === notaId ? { ...n, texto } : n))
        const { error } = await svc.from('kommo_leads').update({ notas: novas }).eq('kommo_lead_id', leadId)
        if (error) aviso = 'A nota mudou no Kommo; o histórico da plataforma atualiza na próxima sincronização.'
      }
    } catch {
      aviso = 'A nota mudou no Kommo; o histórico da plataforma atualiza na próxima sincronização.'
    }

    return jsonResponse({ ok: true, texto, aviso })
  } catch (e) {
    return jsonResponse({ error: `Falha ao editar a nota: ${(e as Error)?.message ?? String(e)}` }, 500)
  }
})
