// autos-imagens — anota no balcão quais páginas digitalizadas já subiram como
// imagem, para o conector poder mostrá-las (ver `mcp-autos`, ferramenta
// `ver_paginas`).
//
// POR QUE UMA SEGUNDA CHAMADA, e não tudo em `autos-guardar`. O texto sai do
// pdf.js em segundos; a imagem tem de ser rasterizada página a página na thread
// principal do navegador — num processo digitalizado isso já levou dois minutos
// medidos. A conversa no Claude abre imediatamente e a ferramenta espera pelo
// depósito só 45 segundos. Então o texto vai primeiro e sozinho, e as imagens
// alcançam depois: o índice da entrega anuncia as páginas PREVISTAS desde o
// começo, e esta função troca a promessa pelo caminho de verdade.
//
// O CAMINHO É CONFERIDO CONTRA O DONO DA SESSÃO, e isso não é zelo: o endpoint
// do conector é público (quem autoriza é o código de 122 bits) e ele baixa do
// balde, com service_role, exatamente os caminhos que esta linha nomear. Sem
// esta conferência, um manifesto forjado transformaria o conector numa janela
// para o balde inteiro.
//
// USO (POST, com sessão logada):
//   { codigo, imagens: [{ arquivo, pagina, caminho }] }
//   -> { pronto: true, arquivos: 2, paginas: 34 }

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Teto de páginas por card: o mesmo teto absoluto da análise de RPV. */
const MAX_PAGINAS = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const db = serviceClient();
    const user = await getCallerAtivo(req, db);
    if (!user) return json({ erro: ERRO_ACESSO }, 401);

    const body = await req.json().catch(() => ({}));
    const codigo = String((body as any).codigo ?? "").trim();
    if (!UUID.test(codigo)) return json({ erro: "codigo inválido (esperado um uuid)." }, 400);

    const brutas = Array.isArray((body as any).imagens) ? (body as any).imagens : [];
    if (brutas.length === 0) return json({ erro: "Nenhuma imagem para anotar." }, 400);

    const prefixo = `${user.id}/`;
    const imagens: { arquivo: string; pagina: number; caminho: string }[] = [];
    for (const i of brutas.slice(0, MAX_PAGINAS)) {
      const caminho = String((i as any)?.caminho ?? "").trim();
      const pagina = Number((i as any)?.pagina ?? 0);
      const arquivo = limparParaOBanco((i as any)?.arquivo);
      // A PASTA DO DONO, e nada acima dela. `..` é recusado junto: o Storage
      // normaliza caminho, e um `id/../outro` passaria pelo prefixo.
      if (!caminho.startsWith(prefixo) || caminho.includes("..")) {
        return json({ erro: `Caminho fora da sua pasta: ${caminho}` }, 400);
      }
      if (!arquivo || !Number.isInteger(pagina) || pagina < 1) continue;
      imagens.push({ arquivo, pagina, caminho });
    }
    if (imagens.length === 0) return json({ erro: "Nenhuma imagem válida." }, 400);

    const { data, error } = await db
      .from("analise_externa_autos")
      .select("arquivos, expira_em")
      .eq("codigo", codigo)
      .maybeSingle();
    if (error) return json({ erro: `Não consegui ler o balcão: ${error.message}` }, 500);
    if (!data) return json({ erro: "Não há autos guardados com este código." }, 404);
    if (new Date(String((data as any).expira_em)).getTime() < Date.now()) {
      return json({ erro: "Estes autos já expiraram." }, 410);
    }

    // CASA PELO NOME, que é como o índice da entrega chama cada arquivo. Página
    // de arquivo que não está na lista é descartada em silêncio: ela não teria
    // como ser pedida depois, e inventar uma entrada nova faria o índice mentir.
    const arquivos = (Array.isArray((data as any).arquivos) ? (data as any).arquivos : []).map((a: any) => {
      const minhas = imagens.filter((i) => i.arquivo === a?.nome);
      if (minhas.length === 0) return a;
      const porPagina = new Map<number, string>();
      for (const j of Array.isArray(a?.imagens) ? a.imagens : []) {
        porPagina.set(Number(j?.pagina), String(j?.caminho ?? ""));
      }
      for (const i of minhas) porPagina.set(i.pagina, i.caminho);
      return {
        ...a,
        imagens: [...porPagina.entries()]
          .filter(([, c]) => c.length > 0)
          .map(([pagina, caminho]) => ({ pagina, caminho }))
          .sort((x, y) => x.pagina - y.pagina),
      };
    });

    const { error: erroUp } = await db
      .from("analise_externa_autos")
      .update({ arquivos })
      .eq("codigo", codigo);
    if (erroUp) return json({ erro: `Não consegui anotar as imagens: ${erroUp.message}` }, 500);

    return json({
      pronto: true,
      arquivos: arquivos.filter((a: any) => (a?.imagens ?? []).length > 0).length,
      paginas: arquivos.reduce((t: number, a: any) => t + (a?.imagens ?? []).length, 0),
    });
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e) }, 500);
  }
});
