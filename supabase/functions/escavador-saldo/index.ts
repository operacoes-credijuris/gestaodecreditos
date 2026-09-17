// escavador-saldo — quanto ainda há para gastar na API do Escavador.
//
// POR QUE ISTO MERECE UMA FUNÇÃO. Das integrações da casa, o Escavador é a única
// em que CADA CONSULTA CUSTA DINHEIRO: a due diligence de um cedente gasta
// centavos por página de resultado, e o saldo acaba no meio de uma apuração sem
// avisar — o erro que aparece então é um 402 no meio do trabalho, longe da tela
// onde se resolve.
//
// O SALDO JÁ VINHA, mas só no instante em que alguém gravava um token novo: a
// função `salvar-token-escavador` o usa para CONFERIR a chave, e o número
// aparecia no aviso daquele salvamento. Quem abrisse Configurações no dia
// seguinte não via mais nada. Aqui ele é uma pergunta que se pode fazer a
// qualquer hora.
//
// NÃO CONSOME CRÉDITO — é a mesma chamada que confere o token, e é por isso que
// ela serve para conferi-lo: `/quantidade-creditos` é de graça.
//
// USO (POST, com sessão logada): {} -> { ok: true, saldo: { creditos, saldo, descricao } }

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveEscavador } from '../_shared/segredos.ts'
import { ErroEscavador, saldoEscavador } from '../_shared/escavador.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ATIVO, e não admin. Ler o saldo não revela o token nem gasta nada, e quem
    // precisa do número é quem vai rodar a diligência — não quem administra a
    // conta. Exigir admin aqui faria a tela mostrar um vazio para a maioria.
    const svc = serviceClient()
    const user = await getCallerAtivo(req, svc)
    if (!user) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const chave = await chaveEscavador()
    if (!chave) {
      return jsonResponse(
        { error: 'Token do Escavador não configurado — grave a chave em Configurações.' },
        400,
      )
    }

    return jsonResponse({ ok: true, saldo: await saldoEscavador(chave) })
  } catch (e) {
    // A FALHA VOLTA COM O TEXTO DO ESCAVADOR, já traduzido em _shared/escavador.ts
    // (401 é token recusado, 429 é limite de chamadas). Um "erro ao consultar
    // saldo" genérico mandaria procurar defeito no lugar errado.
    const erro = e as ErroEscavador
    return jsonResponse({ error: erro?.message ?? String(e) }, 400)
  }
})
