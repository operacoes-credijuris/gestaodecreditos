// escavador-autos — pede os autos de um processo ao Escavador e entrega o que
// já chegou.
//
// É A PONTA QUE A PESSOA APERTA. O aviso de conclusão chega pela
// `escavador-callback`, que baixa os PDFs; esta aqui faz as três coisas que
// dependem de alguém: pedir, olhar como está, e abrir um documento.
//
// TRÊS AÇÕES, uma função:
//   { acao: 'pedir',     numero_cnj, tipo, lead_id? }
//   { acao: 'consultar', numero_cnj }
//   { acao: 'link',      caminho }
//
// O PEDIDO SEMPRE VAI COM `enviar_callback: 1`. Sem isso o Escavador conclui em
// silêncio e alguém tem de ficar perguntando — foi o que fizemos à mão no
// primeiro teste, com centenas de requisições e nenhum ganho.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveEscavador } from '../_shared/segredos.ts'
import { BASE_ESCAVADOR } from '../_shared/escavador.ts'
import { digitosDoCnj, mascaraCnj } from '../_shared/nucleo/cnj.ts'

/** O balde dos PDFs (migração 0068). */
const BALDE = 'autos-escavador'

/** Uma hora de validade no link assinado: o suficiente para ler, pouco para vazar. */
const VALIDADE_DO_LINK = 60 * 60

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ erro: ERRO_ACESSO }, 401)

    const corpo = (await req.json().catch(() => ({}))) as {
      acao?: string
      numero_cnj?: string
      tipo?: string
      lead_id?: number
      caminho?: string
    }
    const acao = String(corpo.acao ?? 'consultar')

    // ---------------------------------------------------------------- LINK
    if (acao === 'link') {
      const caminho = String(corpo.caminho ?? '').trim()
      if (!caminho) return jsonResponse({ erro: 'Informe o caminho do documento.' }, 400)
      // SÓ O QUE ESTÁ NA NOSSA TABELA. Caminho solto no corpo da requisição
      // assinaria qualquer objeto do balde; conferir contra a linha é o que
      // mantém a porta do tamanho da fechadura.
      const { data: doc } = await svc
        .from('escavador_documento')
        .select('caminho, nome')
        .eq('caminho', caminho)
        .maybeSingle()
      if (!doc) return jsonResponse({ erro: 'Documento não encontrado.' }, 404)
      const { data: assinado, error } = await svc.storage
        .from(BALDE)
        .createSignedUrl(caminho, VALIDADE_DO_LINK)
      if (error || !assinado?.signedUrl) {
        return jsonResponse({ erro: error?.message ?? 'Não consegui assinar o link.' }, 502)
      }
      return jsonResponse({ url: assinado.signedUrl, nome: doc.nome })
    }

    // O NÚMERO É A CHAVE DAS OUTRAS DUAS AÇÕES. Aceita colado de qualquer
    // lugar — com pontuação, sem, com espaço em volta — e sai na forma que o
    // Escavador exige, que é a com máscara.
    const digitos = digitosDoCnj(corpo.numero_cnj)
    if (digitos.length !== 20) {
      return jsonResponse(
        { erro: 'Número CNJ inválido. Ele tem 20 dígitos (ex.: 8015250-24.2020.8.05.0000).' },
        400,
      )
    }
    const numeroCnj = mascaraCnj(digitos)

    // ------------------------------------------------------------ CONSULTAR
    if (acao === 'consultar') {
      const { data: pedidos } = await svc
        .from('escavador_pedido')
        .select('*')
        .eq('numero_cnj', numeroCnj)
        .order('criado_em', { ascending: false })
        .limit(5)
      const { data: documentos } = await svc
        .from('escavador_documento')
        .select('*')
        .eq('numero_cnj', numeroCnj)
        .order('criado_em', { ascending: true })

      // O ESTADO DE VERDADE, quando ainda há pedido em aberto. É uma chamada
      // que não custa crédito, e evita a tela dizer "em andamento" para um
      // pedido que terminou enquanto o callback não chegava.
      let aviso: string | null = null
      const emAberto = (pedidos ?? []).find((p) => String(p.status) === 'PENDENTE')
      if (emAberto) {
        const chave = await chaveEscavador()
        if (chave) {
          const res = await fetch(
            `${BASE_ESCAVADOR}/processos/numero_cnj/${numeroCnj}/status-atualizacao`,
            { headers: { Authorization: `Bearer ${chave}`, Accept: 'application/json' } },
          )
          if (res.ok) {
            const j = await res.json().catch(() => null)
            const v = (j as { ultima_verificacao?: Record<string, unknown> } | null)
              ?.ultima_verificacao
            if (v && Number(v.id) === Number(emAberto.id)) {
              const status = String(v.status ?? emAberto.status)
              if (status !== emAberto.status) {
                await svc.from('escavador_pedido').update({
                  status,
                  motivo_erro: (v.motivo_erro as string | null) ?? null,
                  concluido_em: (v.concluido_em as string | null) ?? null,
                  atualizado_em: new Date().toISOString(),
                }).eq('id', emAberto.id)
                emAberto.status = status
                // TERMINOU E O CALLBACK NÃO VEIO: é sinal de URL não cadastrada
                // no painel deles, e sem dizer isso a tela ficaria eternamente
                // mostrando um pedido concluído e nenhum documento.
                if (status === 'SUCESSO' && (documentos ?? []).length === 0) {
                  aviso =
                    'O pedido terminou no Escavador, mas nenhum documento chegou aqui. ' +
                    'Confira se a URL de callback está cadastrada no painel deles ' +
                    '(Configurações → Integração Escavador).'
                }
              }
            }
          }
        }
      }

      return jsonResponse({
        numero_cnj: numeroCnj,
        pedidos: pedidos ?? [],
        documentos: documentos ?? [],
        aviso,
      })
    }

    // ---------------------------------------------------------------- PEDIR
    if (acao !== 'pedir') return jsonResponse({ erro: `Ação desconhecida: ${acao}.` }, 400)

    const tipo = corpo.tipo === 'documentos_publicos' ? 'documentos_publicos' : 'autos'
    const chave = await chaveEscavador()
    if (!chave) {
      return jsonResponse(
        { erro: 'Token do Escavador não configurado. Configurações → Escavador.' },
        400,
      )
    }

    // PEDIDO EM ABERTO NÃO VIRA DOIS. Cada solicitação é cobrada, e o Escavador
    // recusa duplicata com erro que a pessoa não saberia ler — melhor responder
    // aqui, com o pedido que já existe.
    const { data: aberto } = await svc
      .from('escavador_pedido')
      .select('*')
      .eq('numero_cnj', numeroCnj)
      .eq('status', 'PENDENTE')
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (aberto) {
      return jsonResponse({
        ok: true,
        repetido: true,
        pedido: aberto,
        mensagem: 'Já existe um pedido em andamento para este processo.',
      })
    }

    const opcoes: Record<string, number> = { enviar_callback: 1 }
    if (tipo === 'autos') {
      opcoes.autos = 1
      // A permissão de ver documento restrito é do CERTIFICADO, não do
      // Escavador: ele entra no tribunal como o advogado dono do e-CPF.
      opcoes.utilizar_certificado = 1
    } else {
      opcoes.documentos_publicos = 1
    }

    const res = await fetch(
      `${BASE_ESCAVADOR}/processos/numero_cnj/${numeroCnj}/solicitar-atualizacao`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chave}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(opcoes),
      },
    )
    const centavos = Number(res.headers.get('Creditos-Utilizados') ?? 0) || 0
    const txt = await res.text()
    let dados: Record<string, unknown> = {}
    try {
      dados = JSON.parse(txt) as Record<string, unknown>
    } catch { /* corpo não-JSON: o status conta a história */ }

    if (!res.ok) {
      return jsonResponse(
        {
          erro: `O Escavador recusou o pedido (HTTP ${res.status}).`,
          detalhe: String(dados.message ?? txt).slice(0, 300),
        },
        res.status === 402 ? 402 : 502,
      )
    }

    const pedidoId = Number(dados.id ?? 0) || null
    if (!pedidoId) {
      return jsonResponse(
        { erro: 'O Escavador aceitou o pedido mas não devolveu o id dele.', detalhe: txt.slice(0, 200) },
        502,
      )
    }

    // O REGISTRO É O QUE SOBREVIVE À ESPERA: sem ele, uma solicitação paga
    // ficaria só no painel do Escavador, e a tela não teria o que mostrar
    // enquanto o robô não conclui.
    const { data: pedido } = await svc.from('escavador_pedido').upsert({
      id: pedidoId,
      numero_cnj: numeroCnj,
      kommo_lead_id: Number(corpo.lead_id) || null,
      tipo,
      status: String(dados.status ?? 'PENDENTE'),
      centavos,
      criado_por: caller.id,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'id' }).select().maybeSingle()

    if (centavos > 0) {
      await svc.from('escavador_consumo').insert({
        kommo_lead_id: Number(corpo.lead_id) || null,
        operacao: tipo === 'autos' ? 'autos_pedido' : 'publicos_pedido',
        alvo: numeroCnj,
        centavos,
        requisicoes: 1,
        processos: 1,
        criado_por: caller.id,
      })
    }

    return jsonResponse({
      ok: true,
      pedido: pedido ?? { id: pedidoId, numero_cnj: numeroCnj, status: 'PENDENTE' },
      centavos,
      mensagem:
        'Pedido enviado. O Escavador avisa quando terminar, e os documentos aparecem aqui.',
    })
  } catch (err) {
    return jsonResponse({ erro: (err as Error).message }, 500)
  }
})
