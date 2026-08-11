// buscar-kommo — acha o LINK de download do PDF anexado no card do Kommo e devolve
// pro navegador. Quem baixa e lê o PDF é o NAVEGADOR (com pdf.js), então esta função
// fica levíssima e nunca estoura a CPU (não baixa nem lê o arquivo).
//
// USO (POST, com sessão logada): { "lead_id": 15269795 }
//   -> { pronto:true, download_url, nome_arquivo, mime }

import { corsHeaders } from "../_shared/cors.ts";
import { getCallerAtivo, serviceClient } from '../_shared/auth.ts';
import { chaveKommo } from "../_shared/segredos.ts";

const CORS = corsHeaders;
// Subdomínio da conta Kommo (o "nome" antes de .kommo.com). Trocar aqui se mudar.
const KOMMO_SUBDOMAIN = "contatocredijuriscom";

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const user = await getCallerAtivo(req, serviceClient());
    if (!user) return json({ erro: "Acesso não autorizado — faça login; se persistir, o acesso pode ter sido desativado." }, 401);

    const body = await req.json().catch(() => ({}));
    const leadId = String((body as any).lead_id ?? (body as any).kommo_lead_id ?? "").trim();
    if (!leadId) return json({ erro: "lead_id é obrigatório." }, 400);

    const token = await chaveKommo();
    if (!token) return json({ erro: "Token da Kommo não configurado (integracao_kommo_secret)." }, 500);

    const base = `https://${KOMMO_SUBDOMAIN}.kommo.com`;
    const auth = { Authorization: `Bearer ${token}` };

    // 1) lista os arquivos do card -> file_uuid
    const listRes = await fetch(`${base}/api/v4/leads/${leadId}/files`, { headers: auth });
    if (!listRes.ok) {
      return json({ erro: `Kommo recusou a lista de arquivos (HTTP ${listRes.status}).`, detalhe: (await listRes.text()).slice(0, 300) }, 502);
    }
    const listJson = await listRes.json();
    const arquivos = (listJson?._embedded?.files ?? []) as Array<{ file_uuid: string }>;
    if (arquivos.length === 0) return json({ erro: "Nenhum arquivo anexado neste card. Anexe o PDF do processo e tente de novo." }, 404);
    const fileUuid = arquivos[0].file_uuid;

    // 2) descobre a URL do drive da conta (ex.: drive-g)
    const accRes = await fetch(`${base}/api/v4/account?with=drive_url`, { headers: auth });
    const accJson = await accRes.json().catch(() => ({}));
    const driveUrl = (accJson as any)?.drive_url;
    if (!driveUrl) return json({ erro: "Não foi possível descobrir a drive_url da conta Kommo." }, 502);

    // 3) metadados do arquivo -> link de download (assinado, expira em ~1h; por isso o navegador baixa NA HORA)
    const metaRes = await fetch(`${driveUrl}/v1.0/files/${fileUuid}`, { headers: auth });
    if (!metaRes.ok) return json({ erro: `Kommo recusou os metadados do arquivo (HTTP ${metaRes.status}).` }, 502);
    const metaJson = await metaRes.json();
    const downloadHref = (metaJson as any)?._links?.download?.href;
    const nome = String((metaJson as any)?.name || "documento");
    const mime = String((metaJson as any)?.metadata?.mime_type || "application/pdf");
    if (!downloadHref) return json({ erro: "O arquivo não trouxe link de download." }, 502);

    return json({ pronto: true, download_url: downloadHref, nome_arquivo: nome, mime });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
