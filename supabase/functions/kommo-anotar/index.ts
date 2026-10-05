// kommo-anotar — escreve uma anotação (nota de serviço) no card do Kommo.
// Usada pra registrar o resultado da análise no próprio card:
//   - reprovado  -> o motivo da recusa
//   - aprovado   -> o link da pasta do Drive
//
// Mesmo formato de nota que a kommo-mover já usa: note_type service_message,
// que aparece no histórico do card e o kommo-sync IGNORA (ele só traz `common`).
//
// ISSO NÃO É DETALHE. Esta função escrevia `common`, e o cabeçalho dizia
// `service_message`. Consequência: a sincronização trazia a ficha e o veredito
// da análise de volta para kommo_leads.notas, e dali eles eram lidos como
// "anotações do comercial" — pela leitura do card (PARCELA CEDIDA:, HONORÁRIOS
// C.:) e pelo prompt da IA. Na segunda análise do mesmo card, o sistema lia a
// própria ficha achando que o comercial a tinha escrito: a escolha do operador
// no seletor virava o cadastro do card, o aviso de "parcela cedida não
// informada" nunca mais disparava, e um percentual que veio dos autos passava a
// ser "o que o card diz". O sistema confirmava a si mesmo.
//
// USO (POST, com sessão logada): { "lead_id": 15269795, "texto": "..." }

import { postarNotas } from "../_shared/anotarNoKommo.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from "../_shared/auth.ts";
import { contaKommo } from "../_shared/segredos.ts";

const CORS = corsHeaders;

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // ATIVO, e não só autenticado: desativar alguém em Configurações não
    // revoga o JWT dele, e esta função escreve no card que o comercial lê.
    const user = await getCallerAtivo(req, serviceClient());
    if (!user) return json({ erro: ERRO_ACESSO }, 401);

    const body = await req.json().catch(() => ({}));
    const leadId = Number((body as any).lead_id ?? (body as any).kommo_lead_id ?? 0);
    const texto = String((body as any).texto ?? "").trim();
    if (!leadId || !texto) return json({ erro: "lead_id e texto são obrigatórios." }, 400);
    // QUEM ESCREVEU O TEXTO decide o rodapé — e, com ele, se o espelho fica com
    // a nota ou a descarta. 'analise' é o padrão para não mudar o que os
    // chamadores antigos fazem; 'pessoa' é o desfecho digitado na janela.
    const dePessoa = String((body as any).origem ?? "analise") === "pessoa";
    const autor = String((body as any).autor ?? "").trim() || null;

    const conta = await contaKommo();
    if (!conta) return json({ erro: "Token ou subdomínio da Kommo não configurado (integracao_kommo_secret)." }, 500);
    const { token, subdominio } = conta;

    // O CORPO DE SEMPRE, montado em _shared/anotarNoKommo.ts desde 05/10/2026: a
    // justificativa técnica grava nota pelo mesmo caminho (em partes, numa
    // chamada só), e os dois escrevem igual.
    //
    // NOTA DE VERDADE (`common`), e não service_message. O service_message é
    // renderizado como LINHA DO HISTÓRICO: nome do serviço na frente e os
    // parágrafos colados num bloco corrido atrás de um "mais". A ficha do
    // crédito e o resumo da oportunidade chegavam ilegíveis — oito rótulos numa
    // linha só. O que impede a análise de reler a própria anotação não é mais o
    // tipo: é a marca no rodapé, que o kommo-sync descarta (ver
    // _shared/notaCredijuris.ts). Duas perguntas diferentes — como se lê e de
    // quem é — que estavam presas na mesma resposta.
    const r = await postarNotas({ token, subdominio }, leadId, [texto], { dePessoa, autor });
    if (!r.ok) {
      return json({ erro: `Kommo recusou a anotação (HTTP ${r.status}).`, detalhe: r.detalhe }, 502);
    }
    // O id da nota vai junto, para quem quiser guardá-lo; os chamadores de
    // sempre só leem o `ok`.
    return json({ ok: true, nota_id: r.ids[0] ?? null });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
