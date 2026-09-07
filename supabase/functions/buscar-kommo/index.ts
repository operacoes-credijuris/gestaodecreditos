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
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from "../_shared/auth.ts";
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
    // ATIVO, e não só autenticado: desativar alguém em Configurações não
    // revoga o JWT dele, e esta função entrega os anexos do processo.
    const user = await getCallerAtivo(req, serviceClient());
    if (!user) return json({ erro: ERRO_ACESSO }, 401);

    const body = await req.json().catch(() => ({}));
    const leadId = String((body as any).lead_id ?? (body as any).kommo_lead_id ?? "").trim();
    if (!leadId) return json({ erro: "lead_id é obrigatório." }, 400);

    const token = await chaveKommo();
    if (!token) return json({ erro: "Token da Kommo não configurado (integracao_kommo_secret)." }, 500);

    const base = `https://${KOMMO_SUBDOMAIN}.kommo.com`;
    const auth = { Authorization: `Bearer ${token}` };

    // 1) lista os anexos do card (só vem file_uuid + id — SEM nome/tipo)
    //
    // PAGINADA. A lista da Kommo vem em páginas, e um card com muitos anexos
    // (processo em partes, documentos do cedente, comprovantes) passa da
    // primeira. Ler só a primeira era perder arquivo sem nenhum sinal.
    const arquivos: Array<{ file_uuid: string }> = [];
    let proxima: string | null = `${base}/api/v4/leads/${leadId}/files?limit=50`;
    type PaginaDeArquivos = {
      _embedded?: { files?: Array<{ file_uuid: string }> };
      _links?: { next?: { href?: string } };
    };
    for (let pagina = 0; proxima && pagina < 10; pagina++) {
      const listRes: Response = await fetch(proxima, { headers: auth });
      // 204 = card sem anexo nenhum: corpo vazio, não erro.
      if (listRes.status === 204) break;
      if (!listRes.ok) {
        return json({ erro: `Kommo recusou a lista de arquivos (HTTP ${listRes.status}).`, detalhe: (await listRes.text()).slice(0, 300) }, 502);
      }
      const listJson: PaginaDeArquivos | null = await listRes.json().catch(() => null);
      if (!listJson) return json({ erro: "A Kommo devolveu uma resposta vazia/inválida na lista de arquivos do card." }, 502);
      arquivos.push(...(listJson._embedded?.files ?? []));
      proxima = listJson._links?.next?.href ?? null;
    }
    if (arquivos.length === 0) {
      return json({ erro: "Nenhum arquivo anexado neste card. Anexe o PDF do processo e tente de novo." }, 404);
    }

    // 2) descobre a URL do drive da conta (ex.: drive-g)
    const accRes = await fetch(`${base}/api/v4/account?with=drive_url`, { headers: auth });
    const accJson = await accRes.json().catch(() => ({}));
    const driveUrl = (accJson as any)?.drive_url;
    if (!driveUrl) return json({ erro: "Não foi possível descobrir a drive_url da conta Kommo." }, 502);

    // 3) busca os METADADOS de cada anexo (é aqui que vem nome + mime_type + link)
    //
    // Anexo cujo metadado não veio NÃO SOME: entra em `sem_link`, com o que se
    // souber dele. Sumir era o que acontecia — e o navegador então dizia "não
    // achei" sobre um arquivo que estava no card.
    const metas: Array<{ nome: string; mime: string; ext: string; download?: string }> = [];
    const semMetadado: string[] = [];
    for (const a of arquivos) {
      const mRes = await fetch(`${driveUrl}/v1.0/files/${a.file_uuid}`, { headers: auth });
      const m = mRes.ok ? await mRes.json().catch(() => null) : null;
      if (!m) { semMetadado.push(`anexo ${a.file_uuid.slice(0, 8)}`); continue; }
      metas.push({
        nome: String((m as any)?.name || ""),
        mime: String((m as any)?.metadata?.mime_type || "").toLowerCase(),
        ext: String((m as any)?.metadata?.extension || "").toLowerCase(),
        download: (m as any)?._links?.download?.href,
      });
    }

    // 4) TODOS os PDFs, na ordem da Kommo — e não só o último.
    //
    // Devolver um só era o defeito mais caro desta função: processo em dois
    // arquivos analisava um; RG anexado depois do processo fazia a análise nem
    // começar; petição inicial por último fazia a IA precificar o valor da
    // causa. Quem decide o que ler é o navegador, que vê o texto de cada um.
    // `download_url`/`nome_arquivo` continuam (o último PDF) para quem ainda lê
    // a resposta antiga.
    const ehPdf = (x: { mime: string; ext: string; nome: string }) =>
      x.mime === "application/pdf" || x.ext === "pdf" || /\.pdf$/i.test(x.nome);
    const pdfs = metas.filter(ehPdf);
    const naoPdf = metas.filter((x) => !ehPdf(x)).map((x) => x.nome || x.ext || x.mime || "anexo sem nome");
    if (pdfs.length === 0) {
      const tipos = metas.map((x) => x.ext || x.mime || "desconhecido").join(", ");
      return json({ erro: `O card tem ${arquivos.length} anexo(s) (${tipos}), nenhum em PDF. Anexe o PDF do processo e tente de novo.` }, 404);
    }
    const comLink = pdfs.filter((x) => !!x.download);
    const semLink = [...pdfs.filter((x) => !x.download).map((x) => x.nome || "PDF sem nome"), ...semMetadado];
    if (comLink.length === 0) return json({ erro: "Nenhum PDF do card trouxe link de download.", sem_link: semLink }, 502);
    const ultimo = comLink[comLink.length - 1];

    return json({
      pronto: true,
      arquivos: comLink.map((x) => ({ nome: x.nome, download: x.download!, mime: x.mime })),
      nao_pdf: naoPdf,
      sem_link: semLink,
      download_url: ultimo.download,
      nome_arquivo: ultimo.nome,
      mime: ultimo.mime,
    });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
