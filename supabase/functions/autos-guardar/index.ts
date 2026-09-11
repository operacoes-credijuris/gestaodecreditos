// autos-guardar — põe no balcão o texto dos autos de um card, para o Claude vir
// buscar pelo conector (ver `mcp-autos`).
//
// QUEM LEU O PDF FOI O NAVEGADOR, com pdf.js, como em toda a plataforma: a Edge
// Function tem teto de CPU e um processo digitalizado a derrubaria. Aqui chega
// só o texto.
//
// USO (POST, com sessão logada):
//   { codigo, lead_id, titulo, arquivos: [{ nome, paginas, texto }] }
//   -> { pronto: true, guardados: 3, caracteres: 184203 }

import { corsHeaders } from "../_shared/cors.ts";
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from "../_shared/auth.ts";
import { limparParaOBanco } from "../_shared/textoParaOBanco.ts";

const CORS = corsHeaders;

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Um uuid, e nada além disso — é o que a tabela aceita como chave. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// OS TETOS SÃO DO CONTEXTO DA CONVERSA, e não do banco.
//
// Um resultado de ferramenta com 800 mil caracteres não é generosidade: é a
// janela do modelo estourando antes de ele chegar à conclusão. Cortamos aqui, no
// servidor, porque é aqui que a regra vale para todo mundo que escreve.
const MAX_POR_ARQUIVO = 120_000;
const MAX_TOTAL = 400_000;

/**
 * Corta pelo meio, preservando começo e fim.
 *
 * É ONDE ESTÁ O QUE IMPORTA: as partes e a fase inicial abrem o processo, o
 * valor e o dispositivo fecham. O meio de um processo longo é andamento.
 */
function cortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const inicio = Math.floor(max * 0.6);
  return (
    texto.slice(0, inicio) +
    "\n\n[...TRECHO DO MEIO OMITIDO POR TAMANHO...]\n\n" +
    texto.slice(texto.length - (max - inicio))
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // ATIVO, e não só autenticado: quem foi desativado em Configurações continua
    // com o JWT válido, e o que passa por aqui são os autos de um processo.
    const db = serviceClient();
    const user = await getCallerAtivo(req, db);
    if (!user) return json({ erro: ERRO_ACESSO }, 401);

    const body = await req.json().catch(() => ({}));
    const codigo = String((body as any).codigo ?? "").trim();
    if (!UUID.test(codigo)) return json({ erro: "codigo inválido (esperado um uuid)." }, 400);

    const leadId = Number((body as any).lead_id ?? 0);
    if (!Number.isFinite(leadId) || leadId <= 0) return json({ erro: "lead_id é obrigatório." }, 400);

    const brutos = Array.isArray((body as any).arquivos) ? (body as any).arquivos : [];
    if (brutos.length === 0) return json({ erro: "Nenhum arquivo com texto para guardar." }, 400);

    // Corta arquivo por arquivo e depois no total, na ordem da Kommo: o que
    // chegar depois do teto entra truncado, e o que não couber de todo fica de
    // fora COM AVISO — some sem dizer era o defeito a não repetir.
    let usado = 0;
    const arquivos: { nome: string; paginas: number; texto: string }[] = [];
    const deFora: string[] = [];
    for (const a of brutos) {
      // LIMPO ANTES DE QUALQUER OUTRA COISA: texto de PDF traz NUL, e o
      // Postgres nao guarda NUL nem em jsonb nem em text. Sem esta passagem a
      // gravacao morria com "unsupported Unicode escape sequence" — e o erro
      // chegava como 500, indistinguivel de defeito nosso.
      const nome = limparParaOBanco((a as any)?.nome) || "arquivo sem nome";
      const texto = limparParaOBanco((a as any)?.texto).trim();
      if (!texto) { deFora.push(`${nome} (sem texto legível)`); continue; }
      if (usado >= MAX_TOTAL) { deFora.push(`${nome} (não coube no limite total)`); continue; }
      const cortado = cortar(texto, Math.min(MAX_POR_ARQUIVO, MAX_TOTAL - usado));
      usado += cortado.length;
      arquivos.push({ nome, paginas: Number((a as any)?.paginas ?? 0) || 0, texto: cortado });
    }
    if (arquivos.length === 0) return json({ erro: "Nenhum dos arquivos trouxe texto legível." }, 400);

    // Varre o que venceu antes de escrever. Não há cron para isto e não precisa
    // haver: o balcão só cresce quando alguém o usa, então limpá-lo no uso
    // mantém a tabela do tamanho do movimento do dia.
    await db.from("analise_externa_autos").delete().lt("expira_em", new Date().toISOString());

    const { error } = await db.from("analise_externa_autos").upsert({
      codigo,
      lead_id: leadId,
      titulo: limparParaOBanco((body as any).titulo).slice(0, 500),
      arquivos,
      // Reescrever o mesmo código (a pessoa clicou duas vezes) reabre o prazo:
      // o que vale é a última entrega.
      criado_em: new Date().toISOString(),
      expira_em: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      lido_em: null,
    });
    if (error) return json({ erro: `Não consegui guardar os autos: ${error.message}` }, 500);

    return json({ pronto: true, guardados: arquivos.length, caracteres: usado, de_fora: deFora });
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e) }, 500);
  }
});
