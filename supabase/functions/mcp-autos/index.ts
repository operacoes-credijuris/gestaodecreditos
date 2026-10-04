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
  lerVarias,
  montarEntrega,
  paginasComImagem,
  pedidosDeLeitura,
  textoDaBusca,
} from "../_shared/entregaDosAutos.ts";
import { situacaoDosAutos, type BalcaoDosAutos } from "../_shared/esperaDosAutos.ts";
import { trilhaDoPipeline } from "../_shared/trilhasDoPrecatorio.ts";
import {
  aplicarRespostas,
  ESQUEMA_DA_SAIDA,
  secaoDaPlanilhaParaAConversa,
  type SaidaDaPlanilha,
} from "../_shared/questionarioJuridico.ts";
import {
  abrirModelo,
  checklistEmTexto,
  preencherCertidoesDoChecklist,
  salvarPlanilhaNoDrive,
} from "../_shared/planilhaJuridica.ts";
import { lerCadastroDoCard } from "../_shared/cadastroDoCard.ts";
import { anotacoesDaAnalise, VEREDITO_JURIDICO } from "../_shared/anotacaoKommo.ts";
import { assinarNota } from "../_shared/notaCredijuris.ts";
import { contaKommo } from "../_shared/segredos.ts";

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
const SERVIDOR = { name: "credijuris-autos", title: "Credijuris — autos do crédito", version: "1.2.0" };

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
/**
 * AS QUATRO SÓ LEEM, e dizê-lo ao aplicativo é o que tira o pedido de
 * autorização da frente de quem opera.
 *
 * O app do Claude separa as ferramentas de um conector em GRUPOS — "somente
 * leitura" e "escrita/exclusão" — e a permissão de cada grupo se escolhe em
 * Personalizar → Conectores (sempre permitir, pedir aprovação, bloquear). Sem
 * a anotação, estas caíam no grupo que pergunta a cada chamada, e uma análise
 * de precatório virava dez, quinze cliques de "permitir" por processo.
 *
 * É VERDADE, e não conveniência: nenhuma das quatro grava nada. Elas leem o
 * balcão dos autos por um código que vale duas horas — a única escrita do
 * caminho é o `lido_em`, que é registro de acesso, não efeito no mundo.
 */
const SO_LEITURA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

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
    annotations: SO_LEITURA,
  },
  {
    name: "ler_paginas",
    title: "Ler páginas dos autos",
    description:
      "Devolve páginas dos arquivos dos autos, com o número de cada página. " +
      "MANDE TODAS AS LEITURAS DE UMA VEZ, em `leituras`: os arquivos que não couberam na primeira entrega cabem numa chamada só, e os trechos a conferir também (até 20 por chamada). " +
      "Cada chamada pede autorização a quem está operando — um arquivo por chamada enche a tela de pedidos. " +
      "O arquivo pode ser indicado pelo nome ou pela posição no índice; sem páginas, vem o arquivo inteiro (até onde couber, e a resposta diz onde parou).",
    inputSchema: {
      type: "object",
      properties: {
        codigo: CODIGO,
        leituras: {
          type: "array",
          description: "Todas as leituras desta chamada. Ex.: [{\"arquivo\": \"3\"}, {\"arquivo\": \"7\"}, {\"arquivo\": \"2\", \"de\": 40, \"ate\": 45}].",
          items: {
            type: "object",
            properties: {
              arquivo: { type: "string", description: "Nome do arquivo, ou a posição dele no índice (1, 2, 3…)." },
              de: { type: "integer", description: "Primeira página. Omitida, é a 1." },
              ate: { type: "integer", description: "Última página. Omitida, vai até onde couber." },
            },
            required: ["arquivo"],
            additionalProperties: false,
          },
        },
        arquivo: { type: "string", description: "Um arquivo só. Existe para compatibilidade; prefira `leituras`." },
        de: { type: "integer", description: "Com `arquivo`: primeira página a ler." },
        ate: { type: "integer", description: "Com `arquivo`: última página a ler." },
      },
      required: ["codigo"],
      additionalProperties: false,
    },
    annotations: SO_LEITURA,
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
    annotations: SO_LEITURA,
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
    annotations: SO_LEITURA,
  },
  {
    name: "entregar_planilha",
    title: "Entregar a planilha da análise jurídica",
    description:
      "Grava a planilha da análise jurídica de um precatório INTERNO: recebe as respostas do questionário que veio em `autos_do_credito`, preenche o modelo da casa, salva na pasta do cedente no Drive e anota no card do Kommo. " +
      "Chame UMA VEZ, ao final, depois de escrever a qualificação — com o objeto inteiro (respostas, avisos, resumo, ficha). " +
      "Ela devolve o link da planilha: ponha-o na sua resposta a quem está operando.",
    inputSchema: {
      type: "object",
      properties: { codigo: CODIGO, ...ESQUEMA_DA_SAIDA.properties },
      required: ["codigo", "respostas", "ficha"],
      additionalProperties: false,
    },
    // ESTA GRAVA, e dizê-lo é o que a põe no grupo certo do app: escrita pede
    // aprovação — uma por análise, no fim —, ao contrário das quatro de leitura.
    // Não destrói nada (cria o arquivo e uma nota), mas repeti-la cria outra
    // nota no card: não é idempotente. E fala com o mundo de fora (Drive, Kommo).
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
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
  let ultima: BalcaoDosAutos | null = null;
  for (;;) {
    // `*`, E NÃO A LISTA DE COLUNAS: as de progresso (estado, progresso,
    // atualizado_em) chegaram com a migração 0069, e nomear coluna que ainda
    // não existe faz o PostgREST recusar a consulta inteira. Sem elas, a espera
    // funciona como antes — só com mensagens menos precisas.
    const { data, error } = await db
      .from("analise_externa_autos")
      .select("*")
      .eq("codigo", codigo)
      .maybeSingle();
    if (error) {
      return { ok: false, falha: falhaDaFerramenta(`Não consegui ler o balcão dos autos: ${error.message}`) };
    }

    ultima = (data ?? null) as BalcaoDosAutos | null;
    const situacao = situacaoDosAutos(ultima);
    if (situacao?.tipo === "pronto") {
      await db
        .from("analise_externa_autos")
        .update({ lido_em: new Date().toISOString() })
        .eq("codigo", codigo);
      return { ok: true, g: data as unknown as AutosGuardados };
    }
    // FALHOU, PAROU OU VENCEU: esperar mais não muda nada. Responder já poupa
    // quarenta segundos de uma espera inútil — e a mensagem manda parar.
    if (situacao && situacao.tipo !== "esperando") {
      return { ok: false, falha: falhaDaFerramenta(situacao.mensagem) };
    }

    if (Date.now() >= limite) break;
    await dorme(ESPERA_PASSO_MS);
  }

  // O TEMPO DESTA CHAMADA ACABOU. Com a linha reservada, sabemos que a leitura
  // está em curso e dizemos quanto falta; sem linha, pode ser código errado ou
  // o instante antes da reserva — e a mensagem cobre os dois sem mandar seguir.
  const situacao = situacaoDosAutos(ultima);
  return {
    ok: false,
    falha: falhaDaFerramenta(
      situacao && situacao.tipo === "esperando"
        ? situacao.mensagem
        : "Não encontrei autos para este código. Ou ele está errado, ou a plataforma ainda não começou a lê-los. " +
            "NÃO COMECE A ANÁLISE sem os autos: chame esta ferramenta de novo com o mesmo código.",
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


/**
 * A seção da planilha jurídica, para os cards do INTERNO — ou nada.
 *
 * É O QUE FAZ A PLANILHA NASCER DA CONVERSA (28/09/2026). A equipe pediu que
 * o "Executar análise" do Interno entregasse também a planilha da análise
 * jurídica, "senão perde o contexto que está sendo desenvolvido no desktop" —
 * o motor antigo preenchia a planilha numa segunda leitura, por outro modelo.
 * Aqui o questionário vai junto com os autos, lido do MODELO EM VIGOR no
 * Supabase, e a conversa o responde com a leitura que acabou de fazer.
 *
 * QUEM DECIDE É O FUNIL DO CARD, lido do espelho: é o card, e não quem clicou,
 * que diz a trilha. No Externo a planilha é do fundo, e não vai.
 *
 * FALHA NÃO DERRUBA A ENTREGA. Sem modelo no bucket, ou sem espelho, os autos
 * seguem — e a conversa é avisada de que a planilha ficou de fora, para não
 * entregar um bloco que ninguém vai poder gravar.
 */
async function secaoDaPlanilha(leadId: number): Promise<string> {
  const db = serviceClient();
  const { data: card } = await db
    .from("kommo_leads")
    .select("pipeline_id")
    .eq("kommo_lead_id", leadId)
    .maybeSingle();
  const trilha = card ? trilhaDoPipeline(Number((card as any).pipeline_id)) : undefined;
  if (trilha?.key !== "interno") return "";
  try {
    const { linhas } = await abrirModelo(db);
    const { texto } = await checklistEmTexto(db, leadId);
    return secaoDaPlanilhaParaAConversa(linhas, texto);
  } catch (e) {
    return (
      "## PLANILHA DA ANÁLISE JURÍDICA\n\n" +
      "O modelo da planilha não pôde ser carregado agora (" +
      String((e as Error)?.message ?? e).slice(0, 200) +
      "). Faça só a qualificação e diga, ao final, que a planilha ficou de fora."
    );
  }
}

/**
 * A PLANILHA ENTREGUE PELA PRÓPRIA CONVERSA — sem colar nada.
 *
 * É O MESMO CAMINHO DA `planilha-juridica`, e não uma segunda versão dele: o
 * cadastro do card lido por `lerCadastroDoCard` (o mesmo da tela), a gravação
 * por `aplicarRespostas`, a pasta por `salvarPlanilhaNoDrive` e a nota por
 * `anotacoesDaAnalise`. Muda só de onde as respostas vêm: da ferramenta, em vez
 * do bloco colado por quem opera.
 *
 * SÓ NO INTERNO, como a seção que a pede. No Externo a planilha é do fundo.
 */
async function entregarPlanilha(g: AutosGuardados, args: any) {
  const db = serviceClient();
  const { data: card } = await db
    .from("kommo_leads")
    .select("kommo_lead_id, nome, processo_cnj, notas, nota_texto, pipeline_id")
    .eq("kommo_lead_id", g.lead_id)
    .maybeSingle();
  if (!card) {
    return falhaDaFerramenta("Não achei o card deste crédito no espelho da plataforma — a planilha não foi gravada. Entregue o bloco JSON na resposta, para quem opera colar.");
  }
  if (trilhaDoPipeline(Number((card as any).pipeline_id))?.key !== "interno") {
    return falhaDaFerramenta("A planilha jurídica é do precatório INTERNO, e este card não é. Nada foi gravado.");
  }

  const cadastro = lerCadastroDoCard(card as any);
  const saida: SaidaDaPlanilha = {
    respostas: Array.isArray(args?.respostas) ? args.respostas : [],
    avisos: Array.isArray(args?.avisos) ? args.avisos : [],
    resumo: typeof args?.resumo === "string" ? args.resumo : undefined,
    ficha: args?.ficha && typeof args.ficha === "object" ? args.ficha : undefined,
  };

  const { wb, ws, linhas, comFormula } = await abrirModelo(db);
  const { temChecklist } = await checklistEmTexto(db, g.lead_id);
  // AS CERTIDÕES PRIMEIRO, do banco: nas linhas que o checklist responde, ele
  // prevalece sobre o que a conversa escreveu.
  const doChecklist = await preencherCertidoesDoChecklist(db, g.lead_id, ws, linhas);
  const { escritas, avisos, ficha, verbasNome } = aplicarRespostas(ws, linhas, comFormula, saida, {
    numero_processo: cadastro.numero,
    cedente: cadastro.cedente,
    tipo_aquisicao: cadastro.tipo_aquisicao,
    honorarios_pct: cadastro.honorarios_pct,
    temChecklist,
  });
  avisos.push(...doChecklist.avisos);
  // PLANILHA SEM RESPOSTA NÃO VAI AO DRIVE: seria lida como análise feita.
  if (escritas === 0) {
    return falhaDaFerramenta(
      "Nenhuma resposta entrou na planilha — confira se as linhas são as do questionário (L4, L5…). " +
        (avisos.length ? "Avisos: " + avisos.join(" | ") : ""),
    );
  }

  // A PASTA DA ANÁLISE DO CARD: a gravada nele, e só na falta dela o caminho
  // calculado (ver _shared/pastaDaAnalise.ts).
  const drive = await salvarPlanilhaNoDrive(
    wb,
    { originador: cadastro.intermediador, cedente: cadastro.cedente, numero_processo: cadastro.numero, verbasNome },
    { svc: db, leadId: g.lead_id },
  );

  // A NOTA NO CARD, com os mesmos textos que a plataforma escreve — é o que o
  // comercial lê, e ele não pode ler duas fichas diferentes para o mesmo ato.
  // Uma por vez: o feed do Kommo ordena pela chegada.
  const falhasDaNota: string[] = [];
  const conta = await contaKommo();
  if (!conta) {
    falhasDaNota.push("Kommo não configurado");
  } else {
    const textos = anotacoesDaAnalise({
      link: drive.drive_folder_url || drive.drive_file_url || "",
      ficha,
      avisos,
      analista: "Claude (conversa da análise)",
      veredito: VEREDITO_JURIDICO,
    });
    for (const texto of textos) {
      try {
        const res = await fetch(`https://${conta.subdominio}.kommo.com/api/v4/leads/notes`, {
          method: "POST",
          headers: { Authorization: `Bearer ${conta.token}`, "Content-Type": "application/json" },
          body: JSON.stringify([{
            entity_id: g.lead_id,
            // NOTA DE VERDADE, com a marca no rodapé — o mesmo formato da
            // kommo-anotar, que o kommo-sync reconhece e não relê como cadastro.
            note_type: "common",
            params: { text: assinarNota(texto) },
            is_need_to_trigger_digital_pipeline: false,
          }]),
        });
        if (!res.ok) falhasDaNota.push(`HTTP ${res.status}`);
      } catch (e) {
        falhasDaNota.push(String((e as Error)?.message ?? e));
      }
    }
  }

  return okDaFerramenta([
    `Planilha gravada: ${escritas + doChecklist.escritas} de ${linhas.length} linhas do questionário` +
      (doChecklist.escritas ? ` (${doChecklist.escritas} delas do checklist de certidões da plataforma).` : "."),
    drive.drive_file_url ? `Arquivo: ${drive.drive_file_url}` : "",
    `Pasta do cedente no Drive: ${drive.drive_folder_url} (o título do card na plataforma já abre esta pasta).`,
    falhasDaNota.length
      ? `A anotação no card do Kommo NÃO subiu (${falhasDaNota.join("; ")}) — avise quem está operando.`
      : "A ficha e o veredito foram anotados no card do Kommo.",
    avisos.length ? "\nAvisos da planilha:\n- " + avisos.join("\n- ") : "",
    "\nPonha o link da planilha na sua resposta a quem está operando.",
  ].filter(Boolean).join("\n"));
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
          "eixos de varredura. AGRUPE TUDO: " +
          "mande todos os termos de um eixo numa chamada só, e todas as leituras em `leituras` numa chamada " +
          "só, porque cada chamada pede autorização a quem está operando a plataforma. Siga o roteiro que vier no resultado, cite a página de cada achado " +
          "e escreva a análise na própria conversa, sem gerar arquivo nenhum. No precatório interno, depois da qualificação, entregue a planilha da análise jurídica com `entregar_planilha`.",
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
        // OS DOIS FORMATOS, como na busca. `leituras` é o caminho — todas numa
        // chamada, porque cada chamada custa uma autorização a quem opera. O
        // `arquivo` solto sobrou para o modelo que insistir em um por vez.
        const pedidos = pedidosDeLeitura(
          Array.isArray(args.leituras) && args.leituras.length > 0
            ? args.leituras
            : { arquivo: args.arquivo, de: args.de, ate: args.ate },
        );
        return okRpc(id, okDaFerramenta(lerVarias(carga.g, pedidos)));
      }
      if (nome === "ver_paginas") {
        const de = Number(args.de ?? 1);
        const ate = Number(args.ate ?? Number.MAX_SAFE_INTEGER);
        return okRpc(id, await verPaginas(codigo, String(args.arquivo ?? "").trim(), de, ate));
      }
      if (nome === "entregar_planilha") {
        return okRpc(id, await entregarPlanilha(carga.g, args));
      }
      if (nome === "buscar_nos_autos") {
        // OS DOIS FORMATOS. `termos` é o caminho — a lista do eixo numa chamada
        // só, porque cada chamada custa uma autorização de quem está operando.
        // `termo` sobrou para o modelo que insistir em um por vez.
        const pedidos = args.termos ?? args.termo ?? "";
        return okRpc(id, okDaFerramenta(textoDaBusca(carga.g, pedidos)));
      }
      const [roteiro, planilha] = await Promise.all([
        roteiroEmVigor(serviceClient()),
        secaoDaPlanilha(Number(carga.g.lead_id)),
      ]);
      return okRpc(id, okDaFerramenta(montarEntrega(carga.g, roteiro, undefined, planilha)));
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
