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
//   -> { pronto:true, download_url, nome_arquivo, mime, arquivos:[{nome,download,mime}] }
//
// DEVOLVE TODOS OS PDFs, e não só um. O motivo: um processo de precatório vem
// com frequência em vários arquivos — petição inicial num, cálculo noutro,
// ofício noutro. A versão anterior devolvia só `pdfs[pdfs.length - 1]`, o último
// anexado, e isso escondia um problema real: se a petição inicial fosse anexada
// ANTES do cálculo, o sistema lia o cálculo e a qualificação das partes — nome,
// nascimento, endereço do cedente — simplesmente não chegava à tela. Ninguém
// tinha como notar: o campo aparecia vazio como se o dado não existisse.
//
// `download_url` continua apontando para o último PDF, para não quebrar nenhum
// chamador antigo. Mas ele NÃO é mais o que protege o fluxo de precificação: o
// navegador usa `arquivos` e escolhe ali o último item — ver
// analisarLeadCredijuris. A garantia de que a análise lê o mesmo documento de
// antes está naquela função, não neste campo.

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

    // 4) todos os PDFs do card (pelo mime OU pela extensão do nome)
    const pdfs = metas.filter((x) => x.mime === "application/pdf" || x.ext === "pdf" || /\.pdf$/i.test(x.nome));
    if (pdfs.length === 0) {
      // O NOME dos anexos, não só o tipo. Quando o processo está anexado como JPG
      // ou DOCX, "nenhum em PDF" sozinho não diz o que fazer; com o nome do
      // arquivo na frente, quem lê sabe exatamente o que reanexar.
      const lista = metas
        .map((x) => `${x.nome || "(sem nome)"}${x.ext ? ` (.${x.ext})` : ""}`)
        .join(", ");
      return json({
        erro:
          `O card tem ${arquivos.length} anexo(s) e nenhum em PDF: ${lista}. ` +
          `Só consigo ler PDF — anexe o processo em PDF e tente de novo.`,
        nao_pdf: metas.map((x) => x.nome || x.ext || x.mime || "(desconhecido)"),
      }, 404);
    }

    // PDF sem link de download não serve para nada, mas também não invalida os
    // outros: sai da lista e é REPORTADO. Sumir em silêncio seria o mesmo defeito
    // de antes, num tamanho menor.
    const comLink = pdfs.filter((p) => !!p.download);
    const semLink = pdfs.filter((p) => !p.download).map((p) => p.nome || "(sem nome)");
    if (comLink.length === 0) {
      return json({ erro: "Nenhum dos PDFs do card trouxe link de download." }, 502);
    }

    // O último continua sendo o `download_url` — ver o cabeçalho do arquivo.
    const escolhido = comLink[comLink.length - 1];

    return json({
      pronto: true,
      download_url: escolhido.download,
      nome_arquivo: escolhido.nome,
      mime: escolhido.mime,
      arquivos: comLink.map((p) => ({ nome: p.nome, download: p.download, mime: p.mime })),
      // Anexos que não são PDF (foto do documento em JPG, por exemplo) não são
      // lidos aqui — o pdf.js só abre PDF. Reportar o nome deles é o que evita
      // "o sistema não achou o RG" quando o RG está ali, em JPG.
      nao_pdf: metas
        .filter((x) => !pdfs.includes(x))
        .map((x) => x.nome || x.ext || x.mime || "(desconhecido)"),
      sem_link: semLink,
    });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
