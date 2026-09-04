// ============================================================================
// buscar-judit  —  Etapa 1 da integração Judit
// Busca um processo por NÚMERO na Judit, monta o texto do processo
// (dados + movimentações + documentos-chave) e grava um .txt no bucket
// analises-input/{userId}/{jobId}/processo/  — de onde gerar-analise-rpv já lê.
//
// MODO PRODUÇÃO (POST, com sessão no header Authorization):
//   { "numero": "5209009-77.2021.8.09.0090" }
//   -> { pronto:true, job_id, numero, resumo } | { pronto:false, aguarde:true }
//
// MODO TESTE (GET no navegador, sem sessão) — só pra conferir o texto montado:
//   ?numero=5209009-77.2021.8.09.0090&teste=sim
//   -> { resumo, texto_preview }   (NÃO grava nada, NÃO roda IA)
// ============================================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from "../_shared/auth.ts";
import { chaveJudit } from "../_shared/segredos.ts";

const CORS = corsHeaders;
const JUDIT_REQUESTS = "https://requests.prod.judit.io/requests";
const JUDIT_RESPONSES = "https://requests.prod.judit.io/responses";
const JUDIT_LAWSUITS = "https://lawsuits.production.judit.io/lawsuits";
const BUCKET_INPUT = "analises-input";
const MAX_DOC_CHARS = 420000;
const MAX_DOCS_BAIXAR = 20;
const POLL_MAX = 22;

const PALAVRAS_CHAVE = [
  "CALCULO", "CONTA", "DEMONSTRATIVO", "MEMORIA", "PLANILHA",
  "DECISAO", "SENTENCA", "ACORDAO", "HOMOLOG",
  "REQUISICAO", "RPV", "PRECATORIO", "OFICIO", "ALVARA",
];

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}
function safeParse(t: string) { try { return JSON.parse(t); } catch { return t; } }
function normalizar(s: string) { return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
function ehDocChave(nome: string) { const n = normalizar(nome); return PALAVRAS_CHAVE.some((p) => n.includes(p)); }
function fmtData(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR");
}

// Busca na Judit + monta o texto do processo. Retorna {aguarde} se ainda coletando.
async function montarTextoProcesso(juditKey: string, numero: string, soLista = false) {
  const postRes = await fetch(JUDIT_REQUESTS, {
    method: "POST",
    headers: { "api-key": juditKey, "Content-Type": "application/json" },
    body: JSON.stringify({ search: { search_type: "lawsuit_cnj", search_key: numero }, with_attachments: true }),
  });
  const postJson = safeParse(await postRes.text());
  if (!postRes.ok) return { erro: "Judit recusou a busca", http: postRes.status, resposta: postJson };
  const requestId = (postJson as { request_id?: string })?.request_id;
  if (!requestId) return { erro: "Judit não devolveu request_id", resposta: postJson };

  let resp: any = null, completo = false;
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`${JUDIT_RESPONSES}?request_id=${requestId}&page_size=100`, { headers: { "api-key": juditKey } });
    resp = safeParse(await r.text());
    const st = (resp as { request_status?: string })?.request_status;
    const pd: any[] = Array.isArray((resp as any)?.page_data) ? (resp as any).page_data : [];
    // prossegue quando o processo terminou OU quando já há documento-chave pronto (done, não sigiloso)
    const temDocChave = pd.some((it) => ((it.response_data?.attachments) || []).some((a: any) => a.status === "done" && !a.private && ehDocChave(a.attachment_name || "")));
    if (st === "completed") { completo = true; break; }
    if (temDocChave && i >= 5) { completo = true; break; }
  }
  const pageData: any[] = Array.isArray((resp as { page_data?: any[] })?.page_data) ? (resp as any).page_data : [];
  if (!completo) return { aguarde: true };
  if (pageData.length === 0) return { nao_encontrado: true };

  const base = pageData[0].response_data || {};
  const _credorP = (base.parties || []).find((p: any) => p.side === "Active" && String(p.main_document || "").replace(/\D/g, "").length === 11);
  const cpf_credor = _credorP ? String(_credorP.main_document).replace(/\D/g, "") : "";
  const nome_credor = _credorP ? String(_credorP.name || "") : "";
  const movsMap = new Map<string, any>();
  const anexos: any[] = []; const anexoIds = new Set<string>();
  for (const item of pageData) {
    const d = item.response_data || {};
    for (const s of (d.steps || [])) { const k = `${s.step_date}|${(s.content || "").slice(0, 60)}`; if (!movsMap.has(k)) movsMap.set(k, s); }
    for (const a of (d.attachments || [])) { if (a.attachment_id && !anexoIds.has(a.attachment_id)) { anexoIds.add(a.attachment_id); anexos.push({ ...a, _instancia: d.instance || 1 }); } }
  }
  const movs = Array.from(movsMap.values()).sort((a, b) => String(a.step_date).localeCompare(String(b.step_date)));

  const partesTxt = (base.parties || [])
    .map((p: any) => `- ${p.name} [${p.side === "Active" ? "POLO ATIVO" : p.side === "Passive" ? "POLO PASSIVO" : p.person_type || p.side}]` + (p.main_document ? ` (${p.main_document})` : ""))
    .join("\n");
  let texto =
    `PROCESSO ${base.code || numero}\n` +
    `Tribunal: ${base.tribunal_acronym || ""} | Comarca: ${base.county || ""} | UF: ${base.state || ""}\n` +
    `Classe/Assunto: ${(base.classifications || []).map((c: any) => c.name).join(", ")} | ${(base.subjects || []).map((s: any) => s.name).join(", ")}\n` +
    `Situação: ${base.situation || ""} | Fase: ${base.phase || ""}\n` +
    `Valor da causa (inicial): ${base.amount ?? "?"} (ATENÇÃO: valor da causa, NÃO o valor atual do crédito — use os cálculos da contadoria nos documentos abaixo)\n` +
    `Justiça gratuita: ${base.free_justice}\n` +
    `PARTES:\n${partesTxt}\n\n` +
    `==================== MOVIMENTAÇÕES (${movs.length}) ====================\n` +
    movs.map((s) => `${fmtData(s.step_date)} — ${String(s.content || "").replace(/\s+/g, " ").trim()}`).join("\n") +
    `\n\n==================== DOCUMENTOS ====================\n`;

  const todosDocumentos = anexos.map((a) => `${a.attachment_name} [${a.status}${a.private ? "/SIGILOSO" : ""}${a.corrupted ? "/CORROMPIDO" : ""}]`);
  if (soLista) {
    return { ok: true, texto, numero: base.code || numero, resumo: { partes: (base.parties || []).map((p: any) => `${p.name} [${p.side}]`), valor_causa: base.amount, fase: base.phase, qtd_movimentacoes: movs.length, qtd_documentos_total: anexos.length, todos_documentos: todosDocumentos } };
  }

  const { extractText } = await import("npm:unpdf@1.6.2");
  // candidatos = documentos-chave, INCLUINDO os sigilosos (vamos TENTAR e registrar os que não abrirem)
  const VALOR = ["CALCULO", "CONTA", "DEMONSTRATIVO", "MEMORIA", "REQUISICAO", "RPV", "PRECATORIO", "OFICIO", "ALVARA", "PLANILHA"];
  const ehValor = (nome: string) => { const n = normalizar(nome); return VALOR.some((v) => n.includes(v)); };
  const chaves = anexos
    .filter((a) => ehDocChave(a.attachment_name || "") && !a.corrupted)
    .sort((a, b) => (ehValor(b.attachment_name || "") ? 1 : 0) - (ehValor(a.attachment_name || "") ? 1 : 0)) // docs de VALOR primeiro
    .slice(0, MAX_DOCS_BAIXAR);
  const baixados: string[] = []; const inacessiveis: string[] = [];
  for (const a of chaves) {
    if (texto.length > MAX_DOC_CHARS) break;
    try {
      const dl = await fetch(`${JUDIT_LAWSUITS}/${base.code || numero}/${a._instancia}/attachments/${a.attachment_id}`, { headers: { "api-key": juditKey } });
      if (!dl.ok) { inacessiveis.push(`${a.attachment_name}${a.private ? " \u2014 SIGILOSO (segredo de justiça)" : ` \u2014 indisponível (HTTP ${dl.status})`}`); continue; }
      const bytes = new Uint8Array(await dl.arrayBuffer());
      const { text } = await extractText(bytes, { mergePages: true });
      const t = Array.isArray(text) ? text.join("\n") : String(text || "");
      if (t.trim()) { texto += `\n----- ${a.attachment_name} (${fmtData(a.attachment_date)}) -----\n${t.trim()}\n`; baixados.push(a.attachment_name); }
      else inacessiveis.push(`${a.attachment_name} \u2014 sem texto extraível (possível imagem/escaneado)`);
    } catch (e) { inacessiveis.push(`${a.attachment_name} \u2014 erro: ${String((e as Error)?.message || e).slice(0, 50)}`); }
  }
  // Nota de transparência: o que NÃO deu pra ler (sigilosos etc.). A IA usa isso pra sinalizar e NUNCA inventar valor.
  if (inacessiveis.length > 0) {
    texto += `\n\n==================== DOCUMENTOS NÃO ACESSÍVEIS ====================\n` +
      `Os documentos abaixo NÃO puderam ser lidos (a maioria por SEGREDO DE JUSTIÇA — o tribunal bloqueia o acesso, inclusive por API). ` +
      `Baseie a análise nas partes NÃO sigilosas acima (movimentações, decisões, sentenças). ` +
      `Se algum VALOR (cálculo/RPV) não constar nas partes acessíveis, SINALIZE que o documento é sigiloso e o valor não pôde ser conferido — NUNCA invente número:\n` +
      inacessiveis.map((x) => `- ${x}`).join("\n") + "\n";
  }
  if (texto.length > MAX_DOC_CHARS) texto = texto.slice(0, MAX_DOC_CHARS) + "\n\n[...conteúdo cortado por tamanho...]";

  const resumo = {
    partes: (base.parties || []).map((p: any) => `${p.name} [${p.side}]`),
    valor_causa: base.amount, fase: base.phase,
    qtd_movimentacoes: movs.length, qtd_documentos_total: anexos.length,
    documentos_lidos: baixados, documentos_nao_acessados: inacessiveis, tamanho_texto: texto.length,
    todos_documentos: todosDocumentos,
  };
  return { ok: true, texto, resumo, numero: base.code || numero, cpf_credor, nome_credor };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const testeMode = url.searchParams.get("teste") === "sim";

    const svc = serviceClient();
    const juditKey = await chaveJudit();
    if (!juditKey) return json({ erro: "Chave da Judit não configurada (integracao_judit_secret)." }, 500);

    // ---------- MODO TESTE (navegador, sem sessão) ----------
    if (testeMode) {
      const numero = String(url.searchParams.get("numero") || "").trim();
      if (!numero) return json({ erro: "?numero= é obrigatório no modo teste" }, 400);
      const soLista = url.searchParams.get("so_lista") === "sim";
      const soValor = url.searchParams.get("so_valor") === "sim";
      const termo = (url.searchParams.get("termo") || "").trim();
      const r = await montarTextoProcesso(juditKey, numero, soLista);
      if ((r as any).aguarde) return json({ pronto: false, aguarde: true, mensagem: "Judit ainda coletando; rode de novo em ~2 min." });
      if ((r as any).erro || (r as any).nao_encontrado) return json(r);
      if (soLista && soValor) {
        const alvo = ["CALCULO", "CONTA", "MEMORIA", "DEMONSTRATIVO", "PLANILHA", "REQUISICAO", "RPV", "PRECATORIO", "ALVARA", "OFICIO"];
        const todos = ((r as any).resumo?.todos_documentos || []) as string[];
        const soOsDeValor = todos.filter((d) => { const n = d.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); return alvo.some((a) => n.includes(a)); });
        return json({ numero: (r as any).numero, qtd_documentos_total: (r as any).resumo?.qtd_documentos_total, documentos_de_valor: soOsDeValor });
      }
      const textoT = String((r as any).texto || "");
      if (termo) {
        const termos = termo.split(",").map((t) => normalizar(t.trim())).filter(Boolean);
        const linhas = textoT.split("\n").filter((l) => { const n = normalizar(l); return termos.some((t) => n.includes(t)); });
        return json({ resumo: (r as any).resumo, termos_buscados: termos, linhas_encontradas: linhas });
      }
      return json({ resumo: (r as any).resumo, texto_preview: textoT.slice(0, 8000) });
    }

    // ---------- MODO PRODUÇÃO (site, com sessão) ----------
    const user = await getCallerAtivo(req, serviceClient());
    if (!user) return json({ erro: ERRO_ACESSO }, 401);
    const userId = user.id;

    const body = await req.json().catch(() => ({}));
    const numero = String(body.numero || body.numero_processo || "").trim();
    if (!numero) return json({ erro: "Informe o número do processo (campo 'numero')." }, 400);

    const r = await montarTextoProcesso(juditKey, numero);
    if ((r as any).aguarde) return json({ pronto: false, aguarde: true, mensagem: "A Judit ainda está baixando os autos. Aguarde ~2 minutos e busque de novo." });
    if ((r as any).nao_encontrado) return json({ pronto: false, nao_encontrado: true, mensagem: "A Judit não encontrou este processo." });
    if ((r as any).erro) return json({ pronto: false, ...(r as any) }, 502);

    const jobId = crypto.randomUUID();
    const path = `${userId}/${jobId}/processo/processo-judit.txt`;
    const up = await svc.storage.from(BUCKET_INPUT).upload(path, new Blob([(r as any).texto], { type: "text/plain" }), { upsert: true });
    if (up.error) return json({ erro: "Falha ao gravar no storage: " + up.error.message }, 500);

    return json({ pronto: true, job_id: jobId, numero: (r as any).numero, cpf_credor: (r as any).cpf_credor || "", nome_credor: (r as any).nome_credor || "", resumo: (r as any).resumo });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
