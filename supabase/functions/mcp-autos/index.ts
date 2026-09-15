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

import { encodeBase64 } from "jsr:@std/encoding@1.0.11/base64";
import { serviceClient } from "../_shared/auth.ts";
import {
  arquivoDosAutos,
  type AutosGuardados,
  caminhoDaImagem,
  lerPaginas,
  montarEntrega,
  paginasComImagem,
  textoDaBusca,
} from "../_shared/entregaDosAutos.ts";

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

// AS IMAGENS DEMORAM MAIS QUE O TEXTO, e por um motivo de física: o texto sai
// pronto do pdf.js, e cada imagem precisa ser rasterizada e desenhada num canvas,
// na thread principal do navegador. Num processo digitalizado isso já levou dois
// minutos medidos. Quem chama `ver_paginas` espera mais, porque a alternativa é a
// análise seguir sem o documento.
const ESPERA_IMAGENS_MS = 90_000;

/** O mesmo balde das páginas digitalizadas da análise de RPV (migração 0055). */
const BALDE = "analises-input";

// CINCO PÁGINAS POR CHAMADA. Uma A4 a 1.568 px custa perto de 2.300 tokens ao
// modelo; cinco cabem com folga numa resposta, e o intervalo seguinte está a um
// pedido de distância.
const MAX_IMAGENS_POR_CHAMADA = 5;

const CODIGO = {
  type: "string",
  description: "O código de análise (uuid de 36 caracteres) que a plataforma pôs na pergunta.",
};

/**
 * QUATRO FERRAMENTAS, E NÃO UMA, e o motivo é o que este conector veio substituir.
 *
 * Antes havia só uma, que tentava despejar o processo inteiro na
 * conversa. Isso é PIOR do que o método manual que ele substituiu: quando alguém
 * subia o PDF no Claude, o arquivo ficava fora da conversa e o modelo abria o
 * que precisava. Despejando tudo, apareceu um teto que o método antigo não tinha
 * — e um processo de 341 páginas chegava com um quinto do conteúdo.
 *
 * Agora elas juntas fazem o que o arquivo aberto ao lado fazia: uma abre o caso e
 * diz o que existe, outra lê um trecho, a terceira procura — e a quarta VÊ o que
 * está em imagem, que é a única leitura possível de um documento escaneado.
 */
const FERRAMENTAS = [
  {
    name: "autos_do_credito",
    title: "Autos do crédito",
    description:
      "Abre a análise de um crédito da Credijuris: devolve o roteiro de qualificação que a casa segue, os dados do card, o ÍNDICE dos arquivos anexados e o conteúdo dos que couberem nesta mensagem. " +
      "Chame PRIMEIRO, sempre que a pergunta trouxer um código de análise. Arquivo que não couber aqui não se perdeu — leia com a ferramenta ler_paginas.",
    inputSchema: {
      type: "object",
      properties: { codigo: CODIGO },
      required: ["codigo"],
      additionalProperties: false,
    },
  },
  {
    name: "ler_paginas",
    title: "Ler páginas dos autos",
    description:
      "Devolve um intervalo de páginas de um arquivo dos autos, com o número de cada página. " +
      "Use para ler por inteiro o que não coube na primeira entrega e para conferir o entorno de um achado. O arquivo pode ser indicado pelo nome ou pela posição no índice.",
    inputSchema: {
      type: "object",
      properties: {
        codigo: CODIGO,
        arquivo: { type: "string", description: "Nome do arquivo, ou a posição dele no índice (1, 2, 3…)." },
        de: { type: "integer", description: "Primeira página a ler (1 é a primeira do arquivo)." },
        ate: { type: "integer", description: "Última página a ler. Omitido, vai até onde couber." },
      },
      required: ["codigo", "arquivo", "de"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_nos_autos",
    title: "Buscar nos autos",
    description:
      "Procura TERMOS no texto de TODOS os arquivos do crédito e devolve os trechos encontrados COM O NÚMERO DA PÁGINA. " +
      "MANDE A LISTA INTEIRA DE UMA VEZ, em `termos`: um eixo de varredura do roteiro é uma lista (cessão, cessionário, habilitação, reserva de crédito, expeça-se em nome de) e ela cabe numa chamada só. " +
      "Uma chamada por termo obriga quem está operando a autorizar a mesma varredura dez vezes seguidas. " +
      "Acento e caixa não importam. Ausência no texto não prova ausência nos autos: página digitalizada não tem texto para procurar.",
    inputSchema: {
      type: "object",
      properties: {
        codigo: CODIGO,
        termos: {
          type: "array",
          items: { type: "string" },
          description: "Os termos a procurar — todos os do eixo de uma vez. Até 25 por chamada.",
        },
        termo: { type: "string", description: "Um termo só. Existe para compatibilidade; prefira `termos`." },
      },
      required: ["codigo"],
      additionalProperties: false,
    },
  },
  {
    name: "ver_paginas",
    title: "Ver páginas digitalizadas",
    description:
      "Devolve como IMAGEM as páginas de um arquivo digitalizado — aquele que o índice marca como sem texto. " +
      "Documento escaneado não tem texto para extrair nem para procurar: `ler_paginas` e `buscar_nos_autos` são cegas nele, e ver é a única leitura que existe. " +
      "Até 5 páginas por chamada; peça o intervalo seguinte se precisar de mais. " +
      "As imagens levam alguns segundos a mais que o texto para ficarem prontas, e esta ferramenta espera por elas.",
    inputSchema: {
      type: "object",
      properties: {
        codigo: CODIGO,
        arquivo: { type: "string", description: "Nome do arquivo, ou a posição dele no índice (1, 2, 3…)." },
        de: { type: "integer", description: "Primeira página a ver (1 é a primeira do arquivo)." },
        ate: { type: "integer", description: "Última página a ver. Omitido, vai até onde couber." },
      },
      required: ["codigo", "arquivo", "de"],
      additionalProperties: false,
    },
  },
];

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

/**
 * Os autos guardados sob um código, ou a explicação de por que não vieram.
 *
 * A ESPERA CONTINUA AQUI, e serve às três ferramentas: o aplicativo abre e a
 * pergunta é enviada em segundos, enquanto a leitura dos PDFs no navegador leva
 * mais que isso.
 */
async function carregarAutos(codigo: string): Promise<
  { ok: true; g: AutosGuardados } | { ok: false; falha: ReturnType<typeof falhaDaFerramenta> }
> {
  const db = serviceClient();
  const limite = Date.now() + ESPERA_TOTAL_MS;
  for (;;) {
    const { data, error } = await db
      .from("analise_externa_autos")
      .select("lead_id, titulo, arquivos, criado_em, expira_em")
      .eq("codigo", codigo)
      .maybeSingle();
    if (error) {
      return { ok: false, falha: falhaDaFerramenta(`Não consegui ler o balcão dos autos: ${error.message}`) };
    }

    if (data) {
      // VENCIDO É TRATADO COMO INEXISTENTE na mensagem, mas aqui já sabemos a
      // diferença — e dizê-la ajuda quem está na conversa: reabrir a análise
      // pela plataforma resolve, tentar de novo não.
      if (new Date(String((data as any).expira_em)).getTime() < Date.now()) {
        return {
          ok: false,
          falha: falhaDaFerramenta(
            "Este código de análise expirou (os autos ficam disponíveis por 2 horas). " +
              "Clique de novo em “Executar análise” na plataforma Credijuris para abrir uma conversa nova.",
          ),
        };
      }
      const g = data as unknown as AutosGuardados;
      if (Array.isArray(g.arquivos) && g.arquivos.length > 0) {
        await db
          .from("analise_externa_autos")
          .update({ lido_em: new Date().toISOString() })
          .eq("codigo", codigo);
        return { ok: true, g };
      }
    }

    if (Date.now() >= limite) break;
    await dorme(ESPERA_PASSO_MS);
  }
  return {
    ok: false,
    falha: falhaDaFerramenta(
      "Não encontrei autos para este código. Ou ele está errado, ou a plataforma ainda não terminou de ler os PDFs do card " +
        "(processos grandes levam algum tempo). Espere alguns segundos e chame esta ferramenta de novo com o mesmo código.",
    ),
  };
}

/** O texto de uma ferramenta que deu certo. */
function okDaFerramenta(texto: string) {
  return { content: [{ type: "text", text: texto }] };
}

/**
 * As páginas digitalizadas de um arquivo, como imagem.
 *
 * ESTA FERRAMENTA EXISTE PORQUE A ANÁLISE ESTAVA SENDO FEITA SEM DOIS ANEXOS.
 * Um acórdão e um ofício vinham escaneados; o pdf.js não tira texto de imagem, e
 * eles eram descartados antes de chegar ao balcão. A análise saía inteira na
 * aparência, declarando ausências que nunca foram verificadas naqueles dois.
 *
 * ESPERA AS IMAGENS, e por isso tem laço próprio. O texto é depositado em
 * segundos; a rasterização das páginas acontece na thread principal do navegador
 * e leva bem mais. A conversa costuma chegar aqui antes de o navegador terminar,
 * e devolver "não há imagem" nesse instante seria mentir por alguns segundos de
 * diferença — e a análise seguiria sem o documento.
 */
async function verPaginas(codigo: string, arquivo: string, de: number, ate: number) {
  const limite = Date.now() + ESPERA_IMAGENS_MS;
  for (;;) {
    const carga = await carregarAutos(codigo);
    if (!carga.ok) return carga.falha;

    const a = arquivoDosAutos(carga.g, arquivo);
    if (!a) {
      const nomes = carga.g.arquivos.map((x, i) => `${i + 1}. ${x.nome}`).join("\n");
      return falhaDaFerramenta(`Não há arquivo "${arquivo}" neste crédito. Os arquivos são:\n${nomes}`);
    }

    const disponiveis = paginasComImagem(a);
    if (disponiveis.length === 0) {
      return falhaDaFerramenta(
        `O arquivo "${a.nome}" não tem página em imagem aqui` +
          (a.motivo ? ` (${a.motivo})` : "") +
          ". Se ele tem texto, use `ler_paginas`. Se não tem nem texto nem imagem, " +
          "ele não pôde ser lido: registre-o na análise como pendência de diligência, " +
          "e não como documento inexistente.",
      );
    }

    const querem = disponiveis
      .filter((p) => p >= de && p <= ate)
      .slice(0, MAX_IMAGENS_POR_CHAMADA);
    if (querem.length === 0) {
      return falhaDaFerramenta(
        `O arquivo "${a.nome}" não tem imagem no intervalo pedido (${de} a ${ate}). ` +
          `As páginas disponíveis em imagem são: ${disponiveis.join(", ")}.`,
      );
    }

    const caminhos = querem.map((p) => ({ pagina: p, caminho: caminhoDaImagem(a, p) }));
    const faltam = caminhos.filter((c) => !c.caminho);
    if (faltam.length > 0 && Date.now() < limite) {
      await dorme(ESPERA_PASSO_MS);
      continue;
    }

    const db = serviceClient();
    const conteudo: unknown[] = [];
    const erros: string[] = [];
    for (const c of caminhos) {
      if (!c.caminho) {
        erros.push(`p. ${c.pagina} (ainda não subiu)`);
        continue;
      }
      const { data, error } = await db.storage.from(BALDE).download(c.caminho);
      if (error || !data) {
        erros.push(`p. ${c.pagina} (${error?.message ?? "não encontrada"})`);
        continue;
      }
      const bytes = new Uint8Array(await data.arrayBuffer());
      conteudo.push({ type: "text", text: `--- ${a.nome} — página ${c.pagina} ---` });
      conteudo.push({ type: "image", data: encodeBase64(bytes), mimeType: "image/jpeg" });
    }

    const ultima = querem[querem.length - 1];
    const restam = disponiveis.filter((p) => p > ultima);
    const cabeca =
      `${a.nome} — páginas em imagem ${querem.join(", ")} (de ${disponiveis.length} disponíveis). ` +
      "Leia o que está escrito nelas: é documento dos autos, e a página citada é a que vem no rótulo." +
      (restam.length > 0 ? ` Ainda há imagem das páginas ${restam.join(", ")} — peça o próximo intervalo.` : "") +
      (erros.length > 0 ? ` Não consegui trazer: ${erros.join("; ")}.` : "");

    if (conteudo.length === 0) {
      return falhaDaFerramenta(
        `${cabeca} Nenhuma imagem pôde ser trazida agora. Tente de novo em alguns segundos; ` +
          "se continuar assim, registre na análise que o documento ficou sem leitura.",
      );
    }
    return { content: [{ type: "text", text: cabeca }, ...conteudo] };
  }
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
          "Este conector dá acesso aos autos de um crédito da Credijuris e ao roteiro de qualificação " +
          "jurídica preliminar que a casa segue. Quando a pergunta trouxer um código de análise, chame " +
          "`autos_do_credito` com ele ANTES de responder; depois use `ler_paginas` para o que não tiver " +
          "cabido na primeira entrega, `ver_paginas` para os arquivos que o índice marcar como " +
          "digitalizados (neles não há texto: ver é a única leitura) e `buscar_nos_autos` para os " +
          "eixos de varredura. AGRUPE AS BUSCAS: " +
          "mande todos os termos de um eixo numa chamada só, porque cada chamada pede autorização a quem " +
          "está operando a plataforma. Siga o roteiro que vier no resultado, cite a página de cada achado " +
          "e escreva a análise na própria conversa, sem gerar arquivo nenhum.",
      });
    }
    case "ping":
      return okRpc(id, {});
    case "tools/list":
      return okRpc(id, { tools: FERRAMENTAS });
    case "tools/call": {
      const nome = String(params?.name ?? "");
      if (!FERRAMENTAS.some((f) => f.name === nome)) {
        return erroRpc(id, -32602, `Ferramenta desconhecida: ${nome}`);
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
      // AS TRÊS CARREGAM O MESMO MATERIAL, e é por isso que a busca dele vem
      // antes do despacho: o código é a chave de todas, e a espera pelo depósito
      // também.
      const carga = await carregarAutos(codigo);
      if (!carga.ok) return okRpc(id, carga.falha);
      const args = params?.arguments ?? {};

      if (nome === "ler_paginas") {
        const arquivo = String(args.arquivo ?? "").trim();
        const de = Number(args.de ?? 1);
        const ate = Number(args.ate ?? Number.MAX_SAFE_INTEGER);
        return okRpc(id, okDaFerramenta(lerPaginas(carga.g, arquivo, de, ate)));
      }
      if (nome === "ver_paginas") {
        const de = Number(args.de ?? 1);
        const ate = Number(args.ate ?? Number.MAX_SAFE_INTEGER);
        return okRpc(id, await verPaginas(codigo, String(args.arquivo ?? "").trim(), de, ate));
      }
      if (nome === "buscar_nos_autos") {
        // OS DOIS FORMATOS. `termos` é o caminho — a lista do eixo numa chamada
        // só, porque cada chamada custa uma autorização de quem está operando.
        // `termo` sobrou para o modelo que insistir em um por vez.
        const pedidos = args.termos ?? args.termo ?? "";
        return okRpc(id, okDaFerramenta(textoDaBusca(carga.g, pedidos)));
      }
      return okRpc(id, okDaFerramenta(montarEntrega(carga.g, await roteiroEmVigor(serviceClient()))));
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
