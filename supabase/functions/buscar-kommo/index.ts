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
//
// Com { "lead_id": 15269795, "todos": true } devolve TODOS os anexos com link,
// PDF ou não — é o que o histórico do card usa para abrir o arquivo que a pessoa
// clicou. O caminho da análise continua querendo PDF, e recusando o resto.

import { corsHeaders } from "../_shared/cors.ts";
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from "../_shared/auth.ts";
import { contaKommo } from "../_shared/segredos.ts";
import { kommoFetch } from "../_shared/kommoFetch.ts";
import { arquivosParaAnalise, lerJuntada, type ProcessoParaAnalise } from "../_shared/autosJuntos.ts";

const CORS = corsHeaders;
// O subdomínio da conta vem de integracao_kommo_secret, pelo contaKommo() — era
// fixo aqui, e trocar a conta pela tela deixava esta função na antiga (auditoria
// de bugs, 09/10/2026).
//
// TETO DE TEMPO DOS METADADOS: um card antigo tem centenas de anexos soltos, e
// cada um é uma ida ao drive, em série (o limite de taxa da conta não deixa
// paralelizar). Sem teto, o laço passava dos ~150 s da invocação e a função
// morria sem resposta. O que não coube volta em `sem_link`, dito.
const ORCAMENTO_METADADOS_MS = 100_000;
// A lista vem em páginas de 50; 20 páginas são 1.000 anexos. O que passar disso
// não some calado: volta em `sem_link`.
const MAX_PAGINAS_DA_LISTA = 20;

/**
 * Os processos do card que a rotina dos autos conhece, com as partes juntadas
 * e os documentos soltos de cada um — é o que deixa a análise preferir as
 * partes aos soltos (ver `arquivosParaAnalise`). Sem a migração 0077, ou sem
 * processo nenhum, volta vazio e nada é ignorado.
 */
async function processosDoCard(svc: ReturnType<typeof serviceClient>, leadId: number): Promise<ProcessoParaAnalise[]> {
  const { data, error } = await svc
    .from("escavador_autos_processo")
    .select("numero_cnj, rotulo, juntada")
    .eq("kommo_lead_id", leadId);
  if (error || !data?.length) return [];
  const fora: ProcessoParaAnalise[] = [];
  for (const p of data as Array<{ numero_cnj: string; rotulo: string; juntada: unknown }>) {
    const j = lerJuntada(p.juntada);
    const juntado = !!j?.concluida && j.partes.length > 0;
    let soltos: { uuid: string; ordem: number }[] = [];
    if (juntado) {
      const { data: docs } = await svc
        .from("escavador_documento")
        .select("kommo_file_uuid, ordem")
        .eq("numero_cnj", p.numero_cnj)
        .not("kommo_file_uuid", "is", null)
        .range(0, 4999);
      soltos = ((docs ?? []) as Array<{ kommo_file_uuid: string; ordem: number | null }>)
        .map((d) => ({ uuid: String(d.kommo_file_uuid), ordem: Number(d.ordem) || 0 }));
    }
    fora.push({
      cnj: p.numero_cnj,
      rotulo: p.rotulo,
      juntado,
      partes: (j?.partes ?? []).map((x) => x.uuid),
      soltos,
      naoJuntados: (j?.naoJuntados ?? []).map((d) => d.ordem),
    });
  }
  return fora;
}

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
    const svc = serviceClient();
    const user = await getCallerAtivo(req, svc);
    if (!user) return json({ erro: ERRO_ACESSO }, 401);

    const body = await req.json().catch(() => ({}));
    const leadId = String((body as any).lead_id ?? (body as any).kommo_lead_id ?? "").trim();
    if (!leadId) return json({ erro: "lead_id é obrigatório." }, 400);

    const conta = await contaKommo();
    if (!conta) return json({ erro: "Token ou subdomínio da Kommo não configurado (integracao_kommo_secret)." }, 500);

    const base = `https://${conta.subdominio}.kommo.com`;
    const auth = { Authorization: `Bearer ${conta.token}` };

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
    for (let pagina = 0; proxima && pagina < MAX_PAGINAS_DA_LISTA; pagina++) {
      const listRes: Response = await kommoFetch(proxima, { headers: auth });
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
    // Saiu do laço com página seguinte: a lista NÃO está inteira, e isso se diz.
    const listaCortada = !!proxima;
    if (arquivos.length === 0) {
      return json({ erro: "Nenhum arquivo anexado neste card. Anexe o PDF do processo e tente de novo." }, 404);
    }

    // 1b) PARTES > SOLTOS (07/10/2026). O card antigo tem os documentos dos
    // autos soltos ("Conhecimento 001 - …", centenas) E, depois de rejuntado,
    // os mesmos autos em poucos PDFs. A análise lê as partes e deixa os soltos do
    // mesmo processo de fora — pelo uuid, antes mesmo de pedir os metadados de
    // cada um (eram centenas de idas ao drive). O histórico (`todos`) vê tudo.
    const pedeTodos = (body as any).todos === true;
    const processos = pedeTodos ? [] : await processosDoCard(svc, Number(leadId)).catch(() => []);
    const peloUuid = arquivosParaAnalise(arquivos.map((a) => ({ uuid: a.file_uuid })), processos);
    const ignoradosPeloUuid = new Set(peloUuid.ignorados.map((a) => a.uuid));
    const aOlhar = arquivos.filter((a) => !ignoradosPeloUuid.has(a.file_uuid));

    // 2) descobre a URL do drive da conta (ex.: drive-g)
    const accRes = await kommoFetch(`${base}/api/v4/account?with=drive_url`, { headers: auth });
    const accJson = await accRes.json().catch(() => ({}));
    const driveUrl = (accJson as any)?.drive_url;
    if (!driveUrl) return json({ erro: "Não foi possível descobrir a drive_url da conta Kommo." }, 502);

    // 3) busca os METADADOS de cada anexo (é aqui que vem nome + mime_type + link)
    //
    // Anexo cujo metadado não veio NÃO SOME: entra em `sem_link`, com o que se
    // souber dele. Sumir era o que acontecia — e o navegador então dizia "não
    // achei" sobre um arquivo que estava no card.
    const metas: Array<{ uuid: string; nome: string; mime: string; ext: string; download?: string }> = [];
    const semMetadado: string[] = [];
    if (listaCortada) {
      semMetadado.push(
        `o card tem mais de ${arquivos.length} anexos e a lista parou aí — os demais não foram olhados`,
      );
    }
    const inicioMetadados = Date.now();
    let semTempo = 0;
    for (const a of aOlhar) {
      if (Date.now() - inicioMetadados > ORCAMENTO_METADADOS_MS) { semTempo++; continue; }
      let m: unknown = null;
      try {
        const mRes = await kommoFetch(`${driveUrl}/v1.0/files/${a.file_uuid}`, { headers: auth });
        m = mRes.ok ? await mRes.json().catch(() => null) : null;
      } catch { /* falha de rede depois das tentativas: vira `sem_link`, como o não-ok */ }
      if (!m) { semMetadado.push(`anexo ${a.file_uuid.slice(0, 8)}`); continue; }
      metas.push({
        uuid: a.file_uuid,
        nome: String((m as any)?.name || ""),
        mime: String((m as any)?.metadata?.mime_type || "").toLowerCase(),
        ext: String((m as any)?.metadata?.extension || "").toLowerCase(),
        download: (m as any)?._links?.download?.href,
      });
    }
    if (semTempo > 0) {
      semMetadado.push(`${semTempo} anexo(s) não olhado(s): o tempo da consulta acabou antes — tente de novo`);
    }

    // TODOS OS ANEXOS, quando quem pergunta é o histórico do card.
    //
    // O caminho da análise quer PDF e RECUSA o resto — e recusar é certo lá: sem
    // PDF não há o que analisar, e devolver um JPG faria a leitura falhar mais
    // adiante, longe da causa. Aqui a pergunta é outra: a pessoa clicou no nome de
    // um arquivo que ela está VENDO no card, e ele pode ser o RG em foto.
    if (pedeTodos) {
      const todos = metas.filter((x) => !!x.download);
      return json({
        pronto: true,
        arquivos: todos.map((x) => ({ nome: x.nome, download: x.download!, mime: x.mime })),
        sem_link: [
          ...metas.filter((x) => !x.download).map((x) => x.nome || "anexo sem nome"),
          ...semMetadado,
        ],
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
    // A SEGUNDA PASSADA, pelo nome: o solto que subiu duas vezes e cujo uuid o
    // banco não guardou. A regra (e os cuidados dela) mora em autosJuntos.ts.
    const peloNome = arquivosParaAnalise(metas, processos);
    const soltosIgnorados = ignoradosPeloUuid.size + peloNome.ignorados.length;
    const lidos = peloNome.ler;
    const pdfs = lidos.filter(ehPdf);
    const naoPdf = lidos.filter((x) => !ehPdf(x)).map((x) => x.nome || x.ext || x.mime || "anexo sem nome");
    if (pdfs.length === 0) {
      const tipos = metas.map((x) => x.ext || x.mime || "desconhecido").join(", ");
      return json({ erro: `O card tem ${arquivos.length} anexo(s) (${tipos}), nenhum em PDF. Anexe o PDF do processo e tente de novo.` }, 404);
    }
    const comLink = pdfs.filter((x) => !!x.download);
    const semLink = [...pdfs.filter((x) => !x.download).map((x) => x.nome || "PDF sem nome"), ...semMetadado];
    if (comLink.length === 0) return json({ erro: "Nenhum PDF do card trouxe link de download.", sem_link: semLink }, 502);
    const ultimo = comLink[comLink.length - 1];

    // OS ANEXOS EM IMAGEM, com o link (01/10/2026): a análise pelo conector os
    // mostra ao Claude como imagem. Continuam em `nao_pdf` também — quem só lê
    // PDF (a due diligence, a análise de RPV) segue como antes.
    const ehImagem = (x: { mime: string; ext: string; nome: string }) =>
      /^image\/(jpeg|png|webp|gif|bmp)$/.test(x.mime) ||
      /^(jpe?g|png|webp|gif|bmp)$/.test(x.ext) ||
      /\.(jpe?g|png|webp|gif|bmp)$/i.test(x.nome);
    const imagens = lidos
      .filter((x) => !ehPdf(x) && ehImagem(x) && !!x.download)
      .map((x) => ({ nome: x.nome, download: x.download!, mime: x.mime }));
    return json({
      pronto: true,
      arquivos: comLink.map((x) => ({ nome: x.nome, download: x.download!, mime: x.mime })),
      nao_pdf: naoPdf,
      imagens,
      sem_link: semLink,
      // Os documentos soltos deixados de fora porque as partes juntadas do mesmo
      // processo estão no card.
      soltos_ignorados: soltosIgnorados,
      download_url: ultimo.download,
      nome_arquivo: ultimo.nome,
      mime: ultimo.mime,
    });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
