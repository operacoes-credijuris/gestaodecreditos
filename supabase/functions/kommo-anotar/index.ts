// kommo-anotar — escreve uma anotação (nota de serviço) no card do Kommo.
// Usada pra registrar o resultado da análise no próprio card:
//   - reprovado  -> o motivo da recusa
//   - aprovado   -> o link da pasta do Drive
//
// Mesmo formato de nota que a kommo-mover do Pedro já usa (note_type service_message),
// que aparece no histórico do card e o kommo-sync ignora (não polui as notas do card).
//
// USO (POST, com sessão logada): { "lead_id": 15269795, "texto": "..." }

import { corsHeaders } from "../_shared/cors.ts";
import { getCaller } from "../_shared/auth.ts";
import { chaveKommo } from "../_shared/segredos.ts";

const CORS = corsHeaders;
const KOMMO_SUBDOMAIN = "contatocredijuriscom";
const SERVICO = "Análise Credijuris";

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const user = await getCaller(req);
    if (!user) return json({ erro: "Sessão inválida — faça login." }, 401);

    const body = await req.json().catch(() => ({}));
    const leadId = Number((body as any).lead_id ?? (body as any).kommo_lead_id ?? 0);
    const texto = String((body as any).texto ?? "").trim();
    if (!leadId || !texto) return json({ erro: "lead_id e texto são obrigatórios." }, 400);

    const token = await chaveKommo();
    if (!token) return json({ erro: "Token da Kommo não configurado (integracao_kommo_secret)." }, 500);

    const base = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4`;
    const res = await fetch(`${base}/leads/notes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          entity_id: leadId,
          note_type: "common",
          params: { text: texto },
        },
      ]),
    });

    if (!res.ok) {
      return json({ erro: `Kommo recusou a anotação (HTTP ${res.status}).`, detalhe: (await res.text()).slice(0, 300) }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
