// autos-guardar — põe no balcão o texto dos autos de um card, para o Claude vir
// buscar pelo conector (ver `mcp-autos`).
//
// QUEM LEU O PDF FOI O NAVEGADOR, com pdf.js, como em toda a plataforma: a Edge
// Function tem teto de CPU e um processo digitalizado a derrubaria. Aqui chega
// só o texto.
//
// PÁGINA A PÁGINA, e não num bloco só. O navegador sempre extraiu assim, e
// juntar tudo numa string jogava fora a única informação que o roteiro exige em
// TODO campo da ficha: a página. Guardado por página, o conector cita a fonte em
// vez de estimá-la — e consegue entregar um intervalo sob demanda, que é o que
// substitui de verdade o velho "baixar do Kommo e subir no Claude".
//
// O TETO AQUI É DE ARMAZENAMENTO, não de leitura. Ele existe só para uma linha
// não virar um monstro no banco; quanto entra na CONVERSA é decisão do conector,
// e lá o que não cabe de uma vez é lido por página. Nada é cortado pelo meio:
// arquivo entra inteiro ou fica de fora COM AVISO — texto mutilado com um
// marcador no miolo foi o defeito que esta versão veio corrigir.
//
// USO (POST, com sessão logada):
//   { codigo, lead_id, titulo, arquivos: [{ nome, paginas, paginasTexto[], texto }] }
//   -> { pronto: true, guardados: 3, caracteres: 604203, paginas: 344, de_fora: [] }

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

/** Teto de armazenamento do card inteiro. Generoso: é para conter o absurdo. */
const MAX_TOTAL = 2_000_000;

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

    let usado = 0;
    const arquivos: { nome: string; paginas: number; paginasTexto: string[] }[] = [];
    const deFora: string[] = [];
    for (const a of brutos) {
      // LIMPO ANTES DE QUALQUER OUTRA COISA: texto de PDF traz NUL, e o
      // Postgres não guarda NUL nem em jsonb nem em text. Sem esta passagem a
      // gravação morria com "unsupported Unicode escape sequence" — e o erro
      // chegava como 500, indistinguível de defeito nosso.
      const nome = limparParaOBanco((a as any)?.nome) || "arquivo sem nome";

      // O FORMATO NOVO É A LISTA DE PÁGINAS; o antigo, um bloco só. Aceitar os
      // dois evita exigir que as duas pontas subam no mesmo instante.
      const cruas: unknown[] = Array.isArray((a as any)?.paginasTexto)
        ? (a as any).paginasTexto
        : [(a as any)?.texto ?? ""];
      const paginasTexto = cruas.map((p) => limparParaOBanco(p));
      const tamanho = paginasTexto.reduce((t, p) => t + p.length, 0);

      if (paginasTexto.join("").trim() === "") {
        deFora.push(`${nome} (sem texto legível)`);
        continue;
      }
      if (usado + tamanho > MAX_TOTAL) {
        deFora.push(`${nome} (passaria do limite de armazenamento)`);
        continue;
      }
      usado += tamanho;
      arquivos.push({
        nome,
        paginas: Number((a as any)?.paginas ?? 0) || paginasTexto.length,
        paginasTexto,
      });
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

    // A RESPOSTA CONTA O QUE FALTOU, e quem a ignorar mente para quem opera: a
    // tela dizia "N arquivo(s) à disposição" contando os LIDOS, não os guardados.
    return json({
      pronto: true,
      guardados: arquivos.length,
      caracteres: usado,
      paginas: arquivos.reduce((t, a) => t + a.paginasTexto.length, 0),
      de_fora: deFora,
    });
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e) }, 500);
  }
});
