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
// O ARQUIVO SEM TEXTO TAMBÉM É GUARDADO, e esta é a correção mais importante
// deste arquivo. Ele era descartado aqui dentro: dezenove anexos entravam,
// dezessete saíam, e os dois que faltavam — um acórdão e um ofício, ambos
// digitalizados — não existiam para a análise. Ela então declarava, com as
// palavras que o roteiro exige, que nada fora localizado, sem ter aberto os dois
// documentos que poderiam dizer o contrário. Agora eles entram com o MOTIVO, e
// com as páginas que o navegador vai subir como imagem.
//
// O TETO AQUI É DE ARMAZENAMENTO, não de leitura. Ele existe só para uma linha
// não virar um monstro no banco; quanto entra na CONVERSA é decisão do conector,
// e lá o que não cabe de uma vez é lido por página. Nada é cortado pelo meio:
// arquivo entra inteiro ou fica de fora COM AVISO — texto mutilado com um
// marcador no miolo foi o defeito que esta versão veio corrigir.
//
// USO (POST, com sessão logada):
//   { codigo, lead_id, titulo, arquivos: [{ nome, paginas, paginasTexto[],
//     texto, digitalizado, erro, paginas_imagem[] }] }
//   -> { pronto, guardados, com_texto, caracteres, paginas, de_fora, sem_texto }
//
// E TRÊS AÇÕES DE ANDAMENTO, desde 27/09/2026 (migração 0069):
//   { acao: 'reservar',  codigo, lead_id, titulo }        — no clique
//   { acao: 'progresso', itens: [{ codigo, estado, progresso }] } — batimento
//   { acao: 'falhou',    codigo, motivo }                 — a leitura quebrou
//
// POR QUE ELAS EXISTEM. A conversa do Claude abre no clique, e a leitura dos PDFs
// vem depois, numa fila do navegador — várias análises podem ser disparadas de
// uma vez. Sem saber que o código é válido e a leitura está em curso, o conector
// só sabia dizer "não achei", e o modelo às vezes seguia sem os autos. Com a
// reserva e o batimento, ele diz "ainda lendo, 7 de 15" ou "a leitura parou" — e
// proíbe começar pela metade.

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

/**
 * Teto de armazenamento do card inteiro. Existe para conter o absurdo, e não o
 * processo grande.
 *
 * ERA 2 MILHÕES, e cortava processo de verdade: em 27/09/2026 um card de
 * precatório chegou ao Claude sem os DOIS PDFs do processo de origem (17 MB e
 * 3,5 MB) — justamente onde ficam cessão e habilitação. A análise não tinha nem
 * como buscar neles.
 *
 * DEZESSEIS MILHÕES, MEDIDO, não chutado — e em duas rodadas. A primeira subiu
 * para 10 milhões olhando a CPU (2 s por chamada): guardar leva ~40 ms, e a
 * busca de 25 termos ~320 ms com 16 milhões, depois de ela passar a normalizar
 * cada página uma vez só (antes normalizava uma vez por termo). No mesmo dia o
 * mesmo card voltou com 4.904 páginas em dois arquivos — os dez milhões inteiros
 * — e um terceiro de fora.
 *
 * A SEGUNDA RODADA OLHOU A MEMÓRIA, que com esse volume passa a mandar: 256 MB
 * por chamada, contando a base do próprio Deno. Pico medido acima da base:
 * ~40 MB com 10 milhões, ~90 MB com 16, ~150 MB com 20. Vinte ficaria a um
 * susto do teto; dezesseis deixa folga larga, com a busca abaixo de um terço
 * do limite de CPU.
 */
const MAX_TOTAL = 16_000_000;

/** O mesmo balde das páginas digitalizadas da análise de RPV (migração 0055). */
const BALDE = "analises-input";

interface Guardado {
  nome: string;
  paginas: number;
  paginasTexto: string[];
  motivo?: string;
  imagensPrevistas?: number[];
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
    const acao = String((body as any).acao ?? "");

    // O BATIMENTO vem em lote: uma chamada por minuto para TODAS as análises na
    // fila, e não uma por análise. Coluna ausente (migração 0069 por rodar) não
    // é erro de quem chama — o progresso é enfeite do caminho, não o caminho.
    if (acao === "progresso") {
      const itens = Array.isArray((body as any).itens) ? (body as any).itens : [];
      let anotados = 0;
      for (const it of itens.slice(0, 50)) {
        const c = String(it?.codigo ?? "").trim();
        if (!UUID.test(c)) continue;
        const { error } = await db
          .from("analise_externa_autos")
          .update({
            estado: String(it?.estado ?? "lendo").slice(0, 20),
            progresso: it?.progresso && typeof it.progresso === "object" ? it.progresso : {},
            atualizado_em: new Date().toISOString(),
          })
          .eq("codigo", c)
          // SÓ ENQUANTO NÃO HÁ AUTOS. Um batimento atrasado chegando depois do
          // depósito não pode rebaixar para "lendo" o que já está pronto.
          .eq("arquivos", "[]");
        if (!error) anotados++;
      }
      return json({ ok: true, anotados });
    }

    const codigo = String((body as any).codigo ?? "").trim();
    if (!UUID.test(codigo)) return json({ erro: "codigo inválido (esperado um uuid)." }, 400);

    if (acao === "falhou") {
      const motivo = limparParaOBanco((body as any).motivo).slice(0, 300);
      await db
        .from("analise_externa_autos")
        .update({ estado: "falhou", progresso: { motivo }, atualizado_em: new Date().toISOString() })
        .eq("codigo", codigo)
        .eq("arquivos", "[]");
      return json({ ok: true });
    }

    if (acao === "reservar") {
      const leadRes = Number((body as any).lead_id ?? 0);
      if (!Number.isFinite(leadRes) || leadRes <= 0) return json({ erro: "lead_id é obrigatório." }, 400);
      const base = {
        codigo,
        lead_id: leadRes,
        titulo: limparParaOBanco((body as any).titulo).slice(0, 500),
        arquivos: [],
        criado_em: new Date().toISOString(),
        expira_em: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        lido_em: null,
      };
      // COM AS COLUNAS DE PROGRESSO, e sem elas se a 0069 ainda não rodou: a
      // reserva vazia continua servindo — o conector segue esperando por ela
      // como sempre esperou —, só não diz quanto falta.
      let { error } = await db.from("analise_externa_autos").upsert({
        ...base,
        estado: "fila",
        progresso: { etapa: "fila", na_frente: Number((body as any).na_frente ?? 0) || 0 },
        atualizado_em: new Date().toISOString(),
      });
      if (error && /column|schema cache/i.test(error.message)) {
        ({ error } = await db.from("analise_externa_autos").upsert(base));
      }
      if (error) return json({ erro: `Não consegui reservar o balcão: ${error.message}` }, 500);
      return json({ ok: true, reservado: true });
    }

    const leadId = Number((body as any).lead_id ?? 0);
    if (!Number.isFinite(leadId) || leadId <= 0) return json({ erro: "lead_id é obrigatório." }, 400);

    const brutos = Array.isArray((body as any).arquivos) ? (body as any).arquivos : [];
    if (brutos.length === 0) return json({ erro: "Nenhum arquivo para guardar." }, 400);

    let usado = 0;
    const arquivos: Guardado[] = [];
    const deFora: string[] = [];
    const semTexto: { nome: string; motivo: string; imagens: number }[] = [];
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
      const paginas = Number((a as any)?.paginas ?? 0) || paginasTexto.length;
      const previstas = (Array.isArray((a as any)?.paginas_imagem) ? (a as any).paginas_imagem : [])
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n >= 1);

      if (paginasTexto.join("").trim() === "") {
        // SEM TEXTO NÃO É SEM DADO. O motivo separa o que se resolve vendo
        // (digitalizado) do que não se resolve de jeito nenhum (falhou o
        // download, não é PDF) — e quem lê a análise precisa saber qual dos dois
        // aconteceu, porque só um deles vira diligência.
        const erro = limparParaOBanco((a as any)?.erro).slice(0, 300);
        const motivo = erro
          ? `não consegui ler: ${erro}`
          : paginas > 0
          ? "digitalizado (sem camada de texto)"
          : "sem texto e sem páginas legíveis";
        arquivos.push({
          nome,
          paginas,
          paginasTexto: [],
          motivo,
          ...(previstas.length > 0 ? { imagensPrevistas: previstas } : {}),
        });
        semTexto.push({ nome, motivo, imagens: previstas.length });
        continue;
      }
      if (usado + tamanho > MAX_TOTAL) {
        deFora.push(`${nome} (passaria do limite de armazenamento)`);
        continue;
      }
      usado += tamanho;
      arquivos.push({
        nome,
        paginas,
        paginasTexto,
        // Híbrido: tem texto no geral e páginas escaneadas no meio — a conta da
        // contadoria costuma estar exatamente nelas.
        ...(previstas.length > 0 ? { imagensPrevistas: previstas } : {}),
      });
    }
    if (arquivos.length === 0) return json({ erro: "Nenhum dos arquivos pôde ser guardado." }, 400);

    // Varre o que venceu antes de escrever. Não há cron para isto e não precisa
    // haver: o balcão só cresce quando alguém o usa, então limpá-lo no uso
    // mantém a tabela do tamanho do movimento do dia.
    //
    // AS IMAGENS SAEM JUNTO. Elas vivem no balde, não na linha; apagar só a
    // linha deixaria no Storage as páginas de todo processo já analisado, sem
    // ninguém para apagá-las depois — o caminho delas morre com a linha.
    const agora = new Date().toISOString();
    const { data: vencidos } = await db
      .from("analise_externa_autos")
      .select("arquivos")
      .lt("expira_em", agora)
      .limit(50);
    const caminhos = (vencidos ?? []).flatMap((v: any) =>
      (Array.isArray(v?.arquivos) ? v.arquivos : []).flatMap((x: any) =>
        (Array.isArray(x?.imagens) ? x.imagens : []).map((i: any) => String(i?.caminho ?? "")),
      ),
    ).filter((c: string) => c.length > 0);
    if (caminhos.length > 0) await db.storage.from(BALDE).remove(caminhos);
    await db.from("analise_externa_autos").delete().lt("expira_em", agora);

    const deposito = {
      codigo,
      lead_id: leadId,
      titulo: limparParaOBanco((body as any).titulo).slice(0, 500),
      arquivos,
      // Reescrever o mesmo código (a pessoa clicou duas vezes) reabre o prazo:
      // o que vale é a última entrega.
      criado_em: new Date().toISOString(),
      expira_em: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      lido_em: null,
    };
    // O ESTADO FINAL VAI JUNTO: "imagens" enquanto houver página digitalizada a
    // caminho, "pronto" quando não houver. Sem a 0069, grava como antes.
    const aindaVemImagem = arquivos.some((a) => (a.imagensPrevistas ?? []).length > 0);
    let { error } = await db.from("analise_externa_autos").upsert({
      ...deposito,
      estado: aindaVemImagem ? "imagens" : "pronto",
      atualizado_em: new Date().toISOString(),
    });
    if (error && /column|schema cache/i.test(error.message)) {
      ({ error } = await db.from("analise_externa_autos").upsert(deposito));
    }
    if (error) return json({ erro: `Não consegui guardar os autos: ${error.message}` }, 500);

    // A RESPOSTA CONTA O QUE FALTOU, e quem a ignorar mente para quem opera: a
    // tela dizia "N arquivo(s) à disposição" contando os LIDOS, não os guardados.
    return json({
      pronto: true,
      guardados: arquivos.length,
      com_texto: arquivos.filter((a) => a.paginasTexto.length > 0).length,
      caracteres: usado,
      paginas: arquivos.reduce((t, a) => t + a.paginasTexto.length, 0),
      de_fora: deFora,
      sem_texto: semTexto,
    });
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e) }, 500);
  }
});
