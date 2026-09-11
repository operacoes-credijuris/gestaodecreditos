// mcp-autos — o conector pelo qual o Claude vem buscar os autos.
//
// POR QUE UM CONECTOR, e não um anexo. Abrir o aplicativo do Claude com os autos
// ANEXADOS não é possível de fora: a URL não carrega o conteúdo de um arquivo, a
// área de transferência só aceita texto/HTML/PNG, o aplicativo não declara alvo
// de compartilhamento, e a API interna de anexar fala com `window.parent` — é
// para página que roda dentro da conversa. Pôr o link do Kommo na pergunta
// também não resolveu: o modelo não busca o PDF.
//
// ENTÃO O SENTIDO SE INVERTE. Em vez de esta plataforma empurrar os autos para a
// conversa, a conversa vem buscá-los aqui. O botão "Executar análise" deposita o
// texto no balcão (`autos-guardar`) e põe um código na pergunta; o Claude chama
// a ferramenta com esse código e recebe os autos. Nada trafega pelo disco, nada
// é arrastado.
//
// FALA MCP POR HTTP (Streamable HTTP): JSON-RPC 2.0 no POST, resposta em JSON.
// É o transporte que o aplicativo usa para conector remoto.
//
// SEM JWT, DE PROPÓSITO — e é por isso que o código é um uuid. O aplicativo do
// Claude não tem como mandar o token do Supabase, então quem protege os autos é
// o código: 122 bits de acaso, duas horas de validade, um card só. Um código
// que não exista e um que tenha vencido recebem a MESMA resposta, para o
// endpoint não servir de sonda.

import { serviceClient } from "../_shared/auth.ts";
import { type AutosGuardados, montarEntrega } from "../_shared/entregaDosAutos.ts";

/** A chave do roteiro na tabela que a operação edita (ver migration 0065). */
const CHAVE_ROTEIRO = "qualificacao_preliminar";

/**
 * O roteiro que a operação tem em vigor, ou vazio para cair no padrão.
 *
 * FALHA EM SILÊNCIO DE PROPÓSITO. Se a tabela não existir ainda, ou a leitura
 * cair, a análise não pode parar por causa disso: ela segue com o roteiro
 * versionado no repositório, que é o mesmo texto que estava valendo antes de
 * esta tela existir.
 */
async function roteiroEmVigor(db: ReturnType<typeof serviceClient>): Promise<string> {
  const { data } = await db
    .from("prompts_operacao")
    .select("texto")
    .eq("chave", CHAVE_ROTEIRO)
    .maybeSingle();
  return String((data as { texto?: string } | null)?.texto ?? "");
}

// O aplicativo manda cabeçalhos próprios do MCP; sem eles no preflight, o
// navegador que hospeda a conversa recusa a chamada antes de sair.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

const VERSAO_PADRAO = "2025-06-18";
const SERVIDOR = { name: "credijuris-autos", title: "Credijuris — autos do crédito", version: "1.0.0" };

/** Só uuid: é o formato do código, e recusar o resto poupa uma ida ao banco. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// O DEPÓSITO PODE NÃO TER CHEGADO AINDA. O aplicativo abre e a pergunta é
// enviada em segundos; a leitura dos PDFs no navegador leva mais que isso. Então
// a ferramenta espera — é o que separa "ainda subindo" de "não existe".
const ESPERA_TOTAL_MS = 45_000;
const ESPERA_PASSO_MS = 1_500;

const FERRAMENTA = {
  name: "autos_do_credito",
  title: "Autos do crédito",
  description:
    "Devolve os autos de um crédito que a plataforma Credijuris pôs em análise — o texto integral dos PDFs anexados ao card do Kommo — E MAIS o roteiro da qualificação jurídica preliminar que a casa usa, que deve ser seguido à risca. " +
    "Use sempre que a pergunta trouxer um código de análise da Credijuris: os autos são a única fonte factual da análise e o roteiro é o método. " +
    "O código de 36 caracteres vem na própria pergunta que abriu a conversa.",
  inputSchema: {
    type: "object",
    properties: {
      codigo: {
        type: "string",
        description: "O código de análise (uuid de 36 caracteres) que a plataforma pôs na pergunta.",
      },
    },
    required: ["codigo"],
    additionalProperties: false,
  },
};

function resposta(corpo: unknown, status = 200, extras: Record<string, string> = {}) {
  return new Response(corpo === null ? null : JSON.stringify(corpo), {
    status,
    headers: { ...CORS, ...extras, "Content-Type": "application/json; charset=utf-8" },
  });
}

function erroRpc(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function okRpc(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

/** Resultado de ferramenta que deu errado — no MCP isso é `isError`, não erro de RPC. */
function falhaDaFerramenta(texto: string) {
  return { content: [{ type: "text", text: texto }], isError: true };
}

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buscarAutos(codigo: string) {
  const db = serviceClient();
  const limite = Date.now() + ESPERA_TOTAL_MS;
  for (;;) {
    const { data, error } = await db
      .from("analise_externa_autos")
      .select("lead_id, titulo, arquivos, criado_em, expira_em")
      .eq("codigo", codigo)
      .maybeSingle();
    if (error) return falhaDaFerramenta(`Não consegui ler o balcão dos autos: ${error.message}`);

    if (data) {
      // VENCIDO É TRATADO COMO INEXISTENTE na mensagem, mas aqui já sabemos a
      // diferença — e dizê-la ajuda quem está na conversa: reabrir a análise
      // pela plataforma resolve, tentar de novo não.
      if (new Date(String((data as any).expira_em)).getTime() < Date.now()) {
        return falhaDaFerramenta(
          "Este código de análise expirou (os autos ficam disponíveis por 2 horas). " +
            "Clique de novo em “Executar análise” na plataforma Credijuris para abrir uma conversa nova.",
        );
      }
      const g = data as unknown as AutosGuardados;
      if (Array.isArray(g.arquivos) && g.arquivos.length > 0) {
        await db
          .from("analise_externa_autos")
          .update({ lido_em: new Date().toISOString() })
          .eq("codigo", codigo);
        return {
          content: [{ type: "text", text: montarEntrega(g, await roteiroEmVigor(db)) }],
        };
      }
    }

    if (Date.now() >= limite) break;
    await dorme(ESPERA_PASSO_MS);
  }
  return falhaDaFerramenta(
    "Não encontrei autos para este código. Ou ele está errado, ou a plataforma ainda não terminou de ler os PDFs do card " +
      "(processos grandes levam algum tempo). Espere alguns segundos e chame esta ferramenta de novo com o mesmo código.",
  );
}

async function despachar(msg: any): Promise<unknown | null> {
  const { id, method, params } = msg ?? {};
  // Notificação não tem id e não tem resposta — devolver algo aqui é erro de
  // protocolo, e alguns clientes desligam por causa disso.
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize": {
      const pedida = params?.protocolVersion;
      return okRpc(id, {
        protocolVersion: typeof pedida === "string" && pedida ? pedida : VERSAO_PADRAO,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVIDOR,
        instructions:
          "Este conector entrega os autos de um crédito da Credijuris, junto com o roteiro de qualificação " +
          "jurídica preliminar que a casa segue. Quando a pergunta trouxer um código de análise, chame " +
          "`autos_do_credito` com ele antes de responder, siga o roteiro que vier no resultado e " +
          "escreva a análise na própria conversa, sem gerar arquivo nenhum.",
      });
    }
    case "ping":
      return okRpc(id, {});
    case "tools/list":
      return okRpc(id, { tools: [FERRAMENTA] });
    case "tools/call": {
      if (params?.name !== FERRAMENTA.name) {
        return erroRpc(id, -32602, `Ferramenta desconhecida: ${params?.name}`);
      }
      const codigo = String(params?.arguments?.codigo ?? "").trim();
      if (!UUID.test(codigo)) {
        return okRpc(
          id,
          falhaDaFerramenta(
            "O código informado não tem o formato de um código de análise da Credijuris " +
              "(são 36 caracteres, como 3f2a1c9e-4b7d-4a10-9c22-8de5f0a1b2c3). " +
              "Ele vem na pergunta que abriu esta conversa.",
          ),
        );
      }
      return okRpc(id, await buscarAutos(codigo));
    }
    // resources e prompts não existem aqui; responder a lista vazia é mais
    // gentil que -32601 com clientes que perguntam por hábito.
    case "resources/list":
      return okRpc(id, { resources: [] });
    case "prompts/list":
      return okRpc(id, { prompts: [] });
    default:
      return erroRpc(id, -32601, `Método não suportado: ${method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  // O cliente sonda os endereços de OAuth antes de conectar. 404 aqui é a
  // resposta que significa "este servidor não pede autenticação" — e é o que
  // queremos, porque quem autoriza é o código, não um login.
  if (url.pathname.includes("/.well-known/")) return new Response("not found", { status: 404, headers: CORS });

  // O GET abre o canal do servidor para o cliente (SSE), que este conector não
  // usa: ele só responde ao que lhe perguntam.
  if (req.method === "GET") return new Response("method not allowed", { status: 405, headers: CORS });
  // Encerrar a sessão: não há estado para descartar.
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return resposta(erroRpc(null, -32700, "JSON inválido."), 400);
  }

  const sessao = req.headers.get("mcp-session-id") ?? crypto.randomUUID();
  const extras = { "Mcp-Session-Id": sessao };

  try {
    if (Array.isArray(corpo)) {
      const saidas = (await Promise.all(corpo.map(despachar))).filter((x) => x !== null);
      // Lote só de notificações: nada a devolver.
      return saidas.length === 0 ? new Response(null, { status: 202, headers: { ...CORS, ...extras } }) : resposta(saidas, 200, extras);
    }
    const saida = await despachar(corpo);
    return saida === null
      ? new Response(null, { status: 202, headers: { ...CORS, ...extras } })
      : resposta(saida, 200, extras);
  } catch (e) {
    return resposta(erroRpc((corpo as any)?.id ?? null, -32603, String((e as Error)?.message ?? e)), 500, extras);
  }
});
