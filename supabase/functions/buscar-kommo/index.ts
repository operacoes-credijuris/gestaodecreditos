// buscar-kommo — pega o PDF anexado no card do Kommo e grava no storage
// (analises-input/{userId}/{jobId}/processo/), de onde a gerar-analise-rpv já lê.
//
// Fluxo (o "mapa" que descobrimos testando):
//   1) GET /api/v4/leads/{lead_id}/files            -> file_uuid do anexo
//   2) GET /api/v4/account?with=drive_url           -> URL do drive da conta
//   3) GET {drive_url}/v1.0/files/{file_uuid}        -> _links.download.href (link assinado, expira rápido)
//   4) baixa o PDF na hora e grava no storage
//
// USO (POST, com sessão logada): { "lead_id": 15269795 }
//   -> { pronto:true, job_id, nome_arquivo, tamanho }

import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient, getCaller } from "../_shared/auth.ts";
import { chaveKommo } from "../_shared/segredos.ts";

const CORS = corsHeaders;
const BUCKET_INPUT = "analises-input";
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
    const user = await getCaller(req);
    if (!user) return json({ erro: "Sessão inválida — faça login." }, 401);
    const userId = user.id;

    const body = await req.json().catch(() => ({}));
    const leadId = String((body as any).lead_id ?? (body as any).kommo_lead_id ?? "").trim();
    if (!leadId) return json({ erro: "lead_id é obrigatório." }, 400);

    const token = await chaveKommo();
    if (!token) return json({ erro: "Token da Kommo não configurado (integracao_kommo_secret)." }, 500);

    const base = `https://${KOMMO_SUBDOMAIN}.kommo.com`;
    const auth = { Authorization: `Bearer ${token}` };

    // 1) lista os arquivos do card -> pega o file_uuid
    const listRes = await fetch(`${base}/api/v4/leads/${leadId}/files`, { headers: auth });
    if (!listRes.ok) {
      return json({ erro: `Kommo recusou a lista de arquivos (HTTP ${listRes.status}).`, detalhe: (await listRes.text()).slice(0, 300) }, 502);
    }
    const listJson = await listRes.json();
    const arquivos = (listJson?._embedded?.files ?? []) as Array<{ file_uuid: string }>;
    if (arquivos.length === 0) return json({ erro: "Nenhum arquivo anexado neste card. Anexe o PDF do processo e tente de novo." }, 404);
    const fileUuid = arquivos[0].file_uuid;

    // 2) descobre a URL do drive da conta (é específica da conta, ex.: drive-g)
    const accRes = await fetch(`${base}/api/v4/account?with=drive_url`, { headers: auth });
    const accJson = await accRes.json().catch(() => ({}));
    const driveUrl = (accJson as any)?.drive_url;
    if (!driveUrl) return json({ erro: "Não foi possível descobrir a drive_url da conta Kommo." }, 502);

    // 3) metadados do arquivo -> link de download
    const metaRes = await fetch(`${driveUrl}/v1.0/files/${fileUuid}`, { headers: auth });
    if (!metaRes.ok) return json({ erro: `Kommo recusou os metadados do arquivo (HTTP ${metaRes.status}).` }, 502);
    const metaJson = await metaRes.json();
    const downloadHref = (metaJson as any)?._links?.download?.href;
    const nomeBase = String((metaJson as any)?.name || "documento").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
    const ext = String((metaJson as any)?.metadata?.extension || "pdf").toLowerCase();
    const mime = String((metaJson as any)?.metadata?.mime_type || "application/pdf");
    if (!downloadHref) return json({ erro: "O arquivo não trouxe link de download." }, 502);

    // 4) baixa o arquivo AGORA (o link tem ?sign= que expira em ~1h)
    const dlRes = await fetch(downloadHref);
    if (!dlRes.ok) return json({ erro: `Download do arquivo falhou (HTTP ${dlRes.status}).` }, 502);
    const bytes = new Uint8Array(await dlRes.arrayBuffer());
    if (bytes.length === 0) return json({ erro: "O arquivo baixado está vazio." }, 502);

    // 5) grava no storage, no mesmo padrão do buscar-judit
    const svc = serviceClient();
    const jobId = crypto.randomUUID();
    const path = `${userId}/${jobId}/processo/${nomeBase}.${ext}`;
    const up = await svc.storage.from(BUCKET_INPUT).upload(path, new Blob([bytes], { type: mime }), { upsert: true });
    if (up.error) return json({ erro: `Falha ao gravar no storage: ${up.error.message}` }, 500);

    return json({ pronto: true, job_id: jobId, nome_arquivo: `${nomeBase}.${ext}`, tamanho: bytes.length });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
