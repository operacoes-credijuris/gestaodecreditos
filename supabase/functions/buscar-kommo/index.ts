// buscar-kommo — acha o LINK de download do PDF anexado no card do Kommo e devolve
// pro navegador. Quem baixa e lê o PDF é o NAVEGADOR (com pdf.js), então esta função
// fica levíssima e nunca estoura a CPU (não baixa nem lê o arquivo).
//
// IMPORTANTE (pegadinha da Kommo): a lista /leads/{id}/files só traz file_uuid + id —
// NÃO traz nome nem mime_type. O tipo do arquivo só aparece nos METADADOS
// ({drive}/v1.0/files/{uuid}). Por isso buscamos os metadados de CADA anexo antes de
// decidir qual é o PDF (não dá pra filtrar por PDF só olhando a lista).
//
// USO (POST, com sessão logada): { "lead_id": 15269795 }
//   -> { pronto:true, download_url, nome_arquivo, mime }

import { corsHeaders } from "../_shared/cors.ts";
import { getCaller } from "../_shared/auth.ts";
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
    const user = await getCaller(req);
    if (!user) return json({ erro: "Sessão inválida — faça login." }, 401);

    const body = await req.json().catch(() => ({}));
    const leadId = String((body as any).lead_id ?? (body as any).kommo_lead_id ?? "").trim();
    if (!leadId) return json({ erro: "lead_id é obrigatório." }, 400);

    const token = await chaveKommo();
    if (!token) return json({ erro: "Token da Kommo não configurado (integracao_kommo_secret)." }, 500);

    const base = `https://${KOMMO_SUBDOMAIN}.kommo.com`;
    const auth = { Authorization: `Bearer ${token}` };

    // 1) lista os anexos do card (só vem file_uuid + id — SEM nome/tipo)
    const listRes = await fetch(`${base}/api/v4/leads/${leadId}/files`, { headers: auth });
    if (!listRes.ok) {
      return json({ erro: `Kommo recusou a lista de arquivos (HTTP ${listRes.status}).`, detalhe: (await listRes.text()).slice(0, 300) }, 502);
    }
    const listJson = await listRes.json();
    const arquivos = (listJson?._embedded?.files ?? []) as Array<{ file_uuid: string }>;
    if (arquivos.length === 0) {
      return json({ erro: "Nenhum arquivo anexado neste card. Anexe o PDF do processo e tente de novo." }, 404);
    }

    // 2) descobre a URL do drive da conta (ex.: drive-g)
    const accRes = await fetch(`${base}/api/v4/account?with=drive_url`, { headers: auth });
    const accJson = await accRes.json().catch(() => ({}));
    const driveUrl = (accJson as any)?.drive_url;
    if (!driveUrl) return json({ erro: "Não foi possível descobrir a drive_url da conta Kommo." }, 502);

    // 3) busca os METADADOS de cada anexo (é aqui que vem nome + mime_type + link)
    const metas: Array<{ nome: string; mime: string; ext: string; download?: string }> = [];
    for (const a of arquivos) {
      const mRes = await fetch(`${driveUrl}/v1.0/files/${a.file_uuid}`, { headers: auth });
      if (!mRes.ok) continue;
      const m = await mRes.json();
      metas.push({
        nome: String((m as any)?.name || ""),
        mime: String((m as any)?.metadata?.mime_type || "").toLowerCase(),
        ext: String((m as any)?.metadata?.extension || "").toLowerCase(),
        download: (m as any)?._links?.download?.href,
      });
    }

    // 4) escolhe o PDF (pelo mime OU pela extensão do nome) — o ÚLTIMO PDF anexado
    //    (o processo costuma entrar depois da foto/documento do comercial).
    const pdfs = metas.filter((x) => x.mime === "application/pdf" || x.ext === "pdf" || /\.pdf$/i.test(x.nome));
    if (pdfs.length === 0) {
      const tipos = metas.map((x) => x.ext || x.mime || "desconhecido").join(", ");
      return json({ erro: `O card tem ${arquivos.length} anexo(s) (${tipos}), nenhum em PDF. Anexe o PDF do processo e tente de novo.` }, 404);
    }
    const escolhido = pdfs[pdfs.length - 1];
    if (!escolhido.download) return json({ erro: "O PDF não trouxe link de download." }, 502);

    return json({ pronto: true, download_url: escolhido.download, nome_arquivo: escolhido.nome, mime: escolhido.mime });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
