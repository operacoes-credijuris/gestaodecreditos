// ============================================================================
// Edge Function: gerar-analise-rpv
// ----------------------------------------------------------------------------
// Gêmea da `gerar-contrato`. Recebe o PDF do processo (com os cálculos da contadoria dentro),
// extrai os dados pela IA, calcula a precificação (deságio calibrado p/ >=2,80%),
// gera a planilha de Análise de RPV colorida (ExcelJS) e sobe no Drive em
// A. Análises de crédito / {categoria} / {originador} / {cedente}.
//
// Helpers do Drive/Storage: importados de _shared/credijuris.ts (fonte única).
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from "../_shared/auth.ts";
import { chaveAnthropic, segredoGoogle } from "../_shared/segredos.ts";
import {
  consultarRegra,
  custoParaPreco,
  executarPasso,
  regraDoCache,
  normalizarUf,
  type Emolumentos,
  type RegraEmolumentos,
} from "../_shared/emolumentos.ts";
import { municipioDoEnte, resolverUf, type OrigemUf } from "../_shared/tribunais.ts";
import {
  capNotas,
  MAX_IMAGENS as MAX_IMAGENS_ABS,
  MAX_TEXTO_CHARS,
  planoDeLeitura,
} from "../_shared/orcamentoLeitura.ts";
import {
  consultarTeto,
  executarPesquisaTeto,
  type EsferaTeto,
  type TetoConsultado,
} from "../_shared/tetosRpv.ts";
import { ANO_TABELA_IRRF, irProgressivo } from "../_shared/irpf.ts";
import { aplicarAuditoria, calibrarDesagio, montarParcelas, rotuloDoCenario, type VerbasNegociadas } from "../_shared/precificacao.ts";
import { aplicarPatch, aplicarParametrosManuais, parametrosParaCalibragem } from "../_shared/revisao.ts";
import {
  aplicarDiligenciaNoM2,
  historicoDoCredito,
  textoDaDiligencia,
  type ApuracaoDD,
  type HistoricoDePapel,
  type ProcessoDD,
} from "../_shared/dueDiligencia.ts";
import {
  driveEncontrarAnalisesRoot,
  driveFindChildByTolerantName,
  driveFindOrCreateFolder,
  driveListarOriginadoresAnalise,
  driveUploadBytes,
  normalizar,
  refreshGoogleAccessToken,
  storageGetBytes,
} from "../_shared/credijuris.ts";
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0';
import { encodeBase64 as b64encode } from "jsr:@std/encoding@1/base64";

// Helpers do Drive e do Storage: _shared/credijuris.ts, fonte única para esta
// função, a análise de precatório e a geração de contrato. Já viveram
// copiados aqui "verbatim" — e a correção do upload teve de ser feita duas
// vezes por causa disso.



// ============================================================================
// Constantes
// ============================================================================
/**
 * O modelo de TODAS as chamadas desta função — qualificação, análise e revisão.
 *
 * UM SÓ, e por dois motivos que se somam. O primeiro é consistência: a revisão
 * subiu para o Opus 5 e a leitura que PRECIFICA ficou no 4.5, porque o nome do
 * modelo estava escrito em dois lugares. O segundo é o CACHE DE PROMPT: o modelo
 * faz parte da chave, então a qualificação e a análise só reaproveitam o
 * processo lido (~170 mil tokens) se rodarem no mesmo. Trocar uma delas por um
 * modelo mais leve economiza numa ponta e paga o dobro na outra.
 */
const CLAUDE_MODEL = 'claude-opus-5';
const CLAUDE_MAX_TOKENS = 16000;                 // extração da análise é grande (M1+M2+M4)
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BUCKET_INPUT = 'analises-input';            // bucket novo (criar no painel)
const BUCKET_TEMPLATES = 'contratos-templates';  // MESMO bucket de templates da gerar-contrato
const TEMPLATE_NOME = 'Modelo_Analise_de_RPV.xlsx';  // sem acento — Supabase rejeita acento no nome

/**
 * Baixa o template de RPV do Storage, tolerando o nome do arquivo.
 *
 * O nome exato acima é o combinado, mas quem sobe o arquivo é uma pessoa, pelo
 * painel, e o arquivo nasce no Drive como "Modelo - Análise de RPV.xlsx". Um
 * hífen, um espaço ou um acento a mais faziam a análise morrer NO FIM — depois
 * das duas chamadas de IA e da consulta de cartório — com "Storage download
 * falhou", mensagem que não diz a quem lê que o problema é o nome do arquivo.
 *
 * Então: tenta o nome exato; não achando, lista o bucket e procura o modelo de
 * RPV comparando sem acento, sem caixa e sem pontuação. Havendo mais de um, usa
 * o mais recente — é o que a pessoa acabou de subir. Não havendo nenhum, o erro
 * LISTA o que existe no bucket, para o conserto ser evidente.
 */
/**
 * O template baixado, guardado enquanto o worker viver.
 *
 * Ele é baixado a CADA salvamento, e é o mesmo arquivo sempre — um .xlsx de
 * algumas dezenas de KB, imutável entre deploys do modelo. Numa invocação quente
 * o download é uma ida ao Storage que não muda nada. O cache vive no escopo do
 * módulo: some quando o worker recicla, que é exatamente quando faz sentido
 * conferir de novo se o dono trocou o modelo.
 */
let _templateCache: Uint8Array | null = null;

async function baixarTemplateRpv(sb: any): Promise<Uint8Array> {
  if (_templateCache) return _templateCache;
  const guardar = (b: Uint8Array) => { _templateCache = b; return b; };
  try {
    return guardar(await storageGetBytes(sb, BUCKET_TEMPLATES, TEMPLATE_NOME));
  } catch (_) { /* nome exato não está lá: procura pelo conteúdo do nome */ }

  const chave = (t: string) =>
    // REUSA normalizar(), que ja faz sem-acento + sem-pontuacao + minuscula e
    // documenta por que o range de marcas combinantes vai escapado. Duplicar a
    // regex aqui foi o que me fez colar os caracteres literais duas vezes.
    normalizar(t).replace(/[^a-z0-9]/g, '');

  const { data: arquivos, error } = await sb.storage
    .from(BUCKET_TEMPLATES)
    .list('', { limit: 200, sortBy: { column: 'updated_at', order: 'desc' } });
  if (error) throw new Error(`Não consegui ler o bucket ${BUCKET_TEMPLATES}: ${error.message}`);

  const candidatos = (arquivos ?? []).filter((a: any) => {
    const k = chave(a?.name ?? '');
    return k.endsWith('xlsx') && k.includes('rpv') && (k.includes('modelo') || k.includes('analise'));
  });
  if (candidatos.length === 0) {
    const havia = (arquivos ?? []).map((a: any) => a?.name).filter(Boolean).join(', ') || '(bucket vazio)';
    throw new Error(
      `Não achei o modelo de RPV no bucket ${BUCKET_TEMPLATES}. Esperado "${TEMPLATE_NOME}". ` +
        `O que há lá: ${havia}. Suba o arquivo com esse nome exato, sem acento.`,
    );
  }
  return guardar(await storageGetBytes(sb, BUCKET_TEMPLATES, candidatos[0].name));
}

/**
 * A pasta da categoria dentro de "A. Análises de crédito", memorizada.
 *
 * Todo salvamento fazia SETE idas ao Drive: renovar o token, achar o Shared
 * Drive, achar "A. Análises de crédito", achar a categoria, achar/criar o
 * originador, achar/criar o cedente, e então subir. As três primeiras respondem
 * sempre a mesma coisa — a raiz e a categoria não mudam — e agora respondem uma
 * vez por worker. As duas seguintes continuam consultando: originador e cedente
 * são criados o tempo todo.
 *
 * A chave inclui a categoria porque RPV e Precatórios são pastas diferentes.
 */
const _pastaDaCategoria = new Map<string, string>();

async function acharPastaDaCategoria(token: string, categoria: string): Promise<string> {
  const memo = _pastaDaCategoria.get(categoria);
  if (memo) return memo;
  const analisesRoot = await driveEncontrarAnalisesRoot(token);
  const cat = await driveFindChildByTolerantName(token, analisesRoot, categoria);
  const id = cat?.id ?? await driveFindOrCreateFolder(token, categoria, analisesRoot);
  _pastaDaCategoria.set(categoria, id);
  return id;
}
const DRIVE_CATEGORIA_PADRAO = 'Requisições de Pequeno Valor';
// A tela manda rótulo curto ("RPV"); o Drive usa o nome completo da pasta.
const CATEGORIA_MAP: Record<string, string> = {
  'RPV': 'Requisições de Pequeno Valor',
  'Requisições de Pequeno Valor': 'Requisições de Pequeno Valor',
  'Precatórios': 'Precatórios',
};
const resolverCategoria = (c?: string) => CATEGORIA_MAP[(c || '').trim()] ?? ((c || '').trim() || DRIVE_CATEGORIA_PADRAO);

const CORS = corsHeaders;
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const errorResponse = (message: string, status = 400, extra?: Record<string, unknown>) =>
  jsonResponse({ ok: false, error: message, ...(extra || {}) }, status);

const brl = (n: any) => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: any) => ((Number(n) || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

/**
 * fetch que tenta de novo quando a falha foi RÁPIDA.
 *
 * As duas chamadas de IA da extração usavam fetch cru: um 529 (overloaded), um
 * 429 ou uma conexão derr뫚 matava a análise na hora, e o operador via um
 * erro técnico e recomeçava do zero — duas leituras do processo perdidas. Com
 * mais análises por dia isso vira rotina. O SDK, usado na revisão e nos
 * emolumentos, já tentava de novo; estas não.
 *
 * SÓ REPETE O QUE FALHOU DEPRESSA. Uma resposta 5xx que chegou em segundos é
 * soluço do servidor e vale tentar de novo; uma que levou dois minutos é a
 * leitura inteira que não terminou, e repetir estouraria o tempo de parede da
 * função (400 s) com a segunda chamada ainda por fazer. Trinta segundos é a
 * linha entre as duas coisas.
 */
const STATUS_REPETIVEIS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
async function fetchComRetry(url: string, init: RequestInit, tentativas = 3): Promise<Response> {
  let ultimo: unknown = null;
  for (let i = 0; i < tentativas; i++) {
    const inicio = Date.now();
    try {
      const r = await fetch(url, init);
      if (r.ok || !STATUS_REPETIVEIS.has(r.status) || i === tentativas - 1) return r;
      if (Date.now() - inicio > 30_000) return r;
      await r.text().catch(() => '');
      ultimo = new Error(`Claude API ${r.status}`);
    } catch (e) {
      if (i === tentativas - 1 || Date.now() - inicio > 30_000) throw e;
      ultimo = e;
    }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1) + Math.floor(Math.random() * 500)));
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}

// Converte um número escrito como texto (US "1234.56", BR "1.234,56", "1234,56"...) para Number. null se não der.
function parseNumeroFlex(num: string): number | null {
  const t = String(num).trim().replace(/\s/g, '');
  if (!/\d/.test(t)) return null;
  const temP = t.includes('.'), temV = t.includes(',');
  let s = t;
  if (temP && temV) s = (t.lastIndexOf(',') > t.lastIndexOf('.')) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (temV) s = t.replace(/\./g, '').replace(',', '.');
  else if (temP) { const p = t.split('.'); s = (p.length === 2 && p[1].length <= 2) ? t : t.replace(/\./g, ''); }
  const v = Number(s);
  return isNaN(v) ? null : v;
}
// Reescreve valores em Real dentro de um texto para o padrão brasileiro (R$ 1.234,56).
// Só mexe em trechos "R$ <número>" — NÃO toca em datas (10/01/2024) nem números de processo.
function reformatarMoeda(s: any): any {
  if (typeof s !== 'string') return s;
  return s.replace(/R\$\s*(\d[\d.,]*\d|\d)/g, (full: string, num: string) => {
    const v = parseNumeroFlex(num);
    return v == null ? full : brl(v);
  });
}

// ============================================================================
// MOTOR DE PRECIFICAÇÃO  (porte fiel das fórmulas do template)
// ============================================================================

// CUSTO DE CARTÓRIO: a REGRA do estado vem de _shared/emolumentos.ts, extraída
// uma vez por UF; daqui em diante o custo de qualquer preço sai localmente.
//
// Aqui havia uma tabela fixa — a de Virginópolis-MG (Portaria 8.664/CGJ/2025) —
// aplicada a crédito de qualquer estado. Emolumento é preço público fixado por
// cada Tribunal de Justiça, e a diferença entre estados não é arredondamento.
// A tabela agora é a do estado onde o crédito tramita, achada pela IA na fonte
// oficial e guardada em cache por UF/ano (migração 0053). Ver ufDoCredito.

// ============================================================================
// PRAZO ATÉ O PAGAMENTO, POR ESFERA DO ENTE DEVEDOR
// ============================================================================
//
// Até aqui havia UM modelo de prazo — o das linhas 21-33 do template, que é o
// fluxo do TJGO: convênio com data-limite para expedir, período de graça, alvará
// de 21 dias. Aplicado a um RPV federal, estimava 7 meses para um crédito que a
// União paga em 60 dias direto na conta. Como o prazo manda no deságio, isso não
// é detalhe: é preço errado.
//
// Agora cada esfera tem a sua regra, numa tabela editável. Decisão do dono:
// "prazos legais por esfera". A ESFERA VEM DO ENTE DEVEDOR, não do tribunal —
// um TRT pode executar a União (federal) ou um município (estadual).
//
// O que continua igual em todas: os CICLOS do próprio processo (tempo médio de
// serventia e de gabinete, medidos dos pares de datas dos autos — M4). Esses não
// são de tribunal nenhum; são do processo em análise.
type Esfera = 'federal' | 'estadual' | 'goias';

interface RegraPrazo {
  /** Dias que o ente tem para pagar depois da requisição. */
  pagamentoDias: number;
  /** Dias de alvará: número fixo, 0 (sem alvará), ou 'se_exigir' (só quando os autos dizem que o tribunal exige). */
  alvaraDias: number | 'se_exigir';
  /** O tribunal tem convênio com data-limite para expedir (TJGO)? */
  convenio: boolean;
  /** Piso em meses — proteção contra extração otimista dos ciclos. */
  descricao: string;
}

// PISO ÚNICO DE 8 MESES, decisão do dono, e vale para TODA esfera: o que o
// cálculo achar abaixo disso vira 8. Substituiu os pisos por esfera (6 no TJGO,
// vindo do template; 3 nas demais, chute meu) — a experiência da equipe é que
// requisitório não paga antes disso, e prometer menos contamina o deságio, que
// é calibrado sobre o prazo.
//
// O piso NÃO se aplica a prazo digitado à mão no chat de revisão: ali é uma
// pessoa dizendo o que sabe daquele caso, e o motor avisa em vez de sobrepor.
const PISO_MESES = 8;
const REGRAS_PRAZO: Record<Esfera, RegraPrazo> = {
  federal: {
    pagamentoDias: 60, alvaraDias: 0, convenio: false,
    descricao: 'RPV federal: pagamento em 60 dias da requisição (Lei 10.259/2001, art. 17), depósito direto ao credor, sem alvará',
  },
  estadual: {
    pagamentoDias: 60, alvaraDias: 'se_exigir', convenio: false,
    descricao: 'RPV estadual/municipal: pagamento em 2 meses da requisição (CPC, art. 535, §3º); alvará só onde os autos mostram que o tribunal exige',
  },
  goias: {
    pagamentoDias: 60, alvaraDias: 21, convenio: true,
    descricao: 'TJGO: convênio com data-limite de expedição (60 dias) quando consta dos autos, período de graça e alvará de 21 dias — o fluxo do template original',
  },
};

/**
 * A esfera do ente devedor, para escolher a regra de prazo.
 *
 * Ordem: Estado de Goiás (regra própria) > federal (União, autarquias e
 * fundações federais, ou tribunal TRF — em TRF o ente é sempre federal) >
 * estadual (o resto: estados e municípios). esferaLida é o que a IA
 * classificou nos autos e desempata.
 */
/**
 * O ente devedor, classificado UMA VEZ para todo o motor.
 *
 * HAVIA DUAS CLASSIFICAÇÕES CONVIVENDO, e elas podiam discordar. O prazo saía de
 * `esferaDoEnte`, que deriva do nome do ente com uma lista de padrões; o teto da
 * RPV saía de `dados.esfera`, o texto que a IA classificou. Um ente que os
 * padrões reconhecem como federal mas que a IA marcou "Estadual" recebia prazo
 * federal e teto estadual — duas respostas para a mesma pergunta, nenhuma
 * conferida contra a outra.
 *
 * Agora é uma função só, e ela devolve as duas coisas que o motor precisa:
 * a ESFERA (que manda no teto) e se é GOIÁS (que tem regra de prazo própria).
 * A leitura da IA entra como desempate, não como fonte concorrente.
 */
interface EnteClassificado {
  /** A esfera do ente devedor — quem paga, não onde tramita. */
  esfera: EsferaTeto;
  /** Estado de Goiás, suas autarquias e fundações: regra de prazo própria. */
  goias: boolean;
  /** A esfera no vocabulário da tabela de prazos. */
  prazo: Esfera;
}

function classificarEnte(ente: unknown, esferaLida: unknown, tribunal: unknown): EnteClassificado {
  const e = String(ente ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const lida = String(esferaLida ?? '').toLowerCase();
  const trib = String(tribunal ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const goias = ehEstadoDeGoias(ente);

  const federalPorNome =
    /\buniao\b|fazenda nacional|\binss\b|\bibama\b|\bdnit\b|\bincra\b|\bfunasa\b|\bfnde\b|\bibge\b|\bufg\b|universidade federal|instituto federal|autarquia federal|fundacao.*federal|\bcaixa economica\b/.test(e);
  const municipalPorNome = /\bmunicipio\b|prefeitura|camara municipal|\bmunicipal\b/.test(e);

  // Ordem: Goiás (que é estadual por definição) > município pelo nome >
  // federal pelo nome ou pelo tribunal > o que a IA leu > estadual.
  let esfera: EsferaTeto;
  if (goias) esfera = 'estadual';
  else if (municipalPorNome) esfera = 'municipal';
  else if (federalPorNome || /^TRF/.test(trib)) esfera = 'federal';
  else if (lida.includes('federal')) esfera = 'federal';
  else if (lida.includes('municipal')) esfera = 'municipal';
  else esfera = 'estadual';

  return { esfera, goias, prazo: goias ? 'goias' : esfera === 'federal' ? 'federal' : 'estadual' };
}

/**
 * Prazo até o pagamento, em meses.
 *
 * ciclos = os tempos do processo (M4): dois ciclos de serventia+gabinete mais
 * meio ciclo de serventia — a mesma conta do template, porque ela mede o
 * processo, não o tribunal.
 *
 * A (não expedida): ciclos + [convênio ou nada] + pagamento + alvará.
 *   Goiás: como sempre foi (convênio ou 60 de graça, depois 60 de pagamento).
 *   Demais: ciclos + 60 + alvará quando cabe. NÃO soma "graça" duas vezes — era
 *   isso que inflava o prazo fora de Goiás (120 dias de espera inventada).
 * B (já expedida): o que resta do prazo de pagamento (desconta o já decorrido
 *   desde a expedição, quando a data consta) + alvará + UM ciclo para a
 *   liberação. Goiás mantém o template (ciclos + 21 + 60).
 */
/** Um ato do roteiro, já validado. */
interface AtoRoteiro { ato: string; dias: number; base: string }

/**
 * O roteiro que a IA montou, se ele serve para somar.
 *
 * Teto de 1.100 dias no ato e 40 itens: número solto de uma leitura ruim não
 * pode virar prazo de três anos num campo que manda no preço. Ato sem nome ou
 * com dias inválido é descartado; o roteiro inteiro só vale se sobrar pelo menos
 * um ato e a soma for plausível (até 60 meses).
 */
function roteiroValido(bruto: unknown): AtoRoteiro[] | null {
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > 40) return null;
  const atos: AtoRoteiro[] = [];
  for (const x of bruto as Array<Record<string, unknown>>) {
    const ato = String(x?.ato ?? '').trim();
    const dias = Number(x?.dias);
    if (!ato || !isFinite(dias) || dias < 0 || dias > 1100) continue;
    atos.push({ ato, dias, base: String(x?.base ?? '').trim() });
  }
  if (atos.length === 0) return null;
  const total = atos.reduce((t, a) => t + a.dias, 0);
  if (!(total > 0) || total / 30 > 60) return null;
  return atos;
}

function prazoMeses(o: {
  esfera: Esfera; serventiaDias: number; gabineteDias: number; scenario: 'A' | 'B';
  dataAquisicao: Date; dataFatalConvenio?: Date; dataExpedicao?: Date; exigeAlvara: boolean;
  /** O caminho que a IA montou até a liquidação. Quando serve, é ele que vale. */
  roteiro?: unknown;
}): { meses: number; regra: RegraPrazo; detalhe: string; roteiro: AtoRoteiro[] | null } {
  const regra = REGRAS_PRAZO[o.esfera];

  // O ROTEIRO VEM PRIMEIRO, e a fórmula fica de rede.
  //
  // A fórmula é (serventia+gabinete)*2 + serventia*1,5: dois ciclos e meio,
  // sempre, para qualquer processo. Ela não sabe em que etapa o processo está,
  // quantos atos faltam, nem que a CESSÃO tem atos próprios — habilitação,
  // intimação da Fazenda, homologação, substituição — que só acontecem depois
  // da compra e que ela nunca contou. O roteiro conta o caminho que falta, ato a
  // ato, com a velocidade medida neste juízo.
  const atos = roteiroValido(o.roteiro);
  if (atos) {
    const dias = atos.reduce((t, a) => t + a.dias, 0);
    const meses = Math.max(PISO_MESES, dias / 30);
    let detalhe = `${atos.length} ato(s) até a liquidação, somando ${Math.round(dias)}d`;
    if (meses > dias / 30) detalhe += ` — piso de ${PISO_MESES} meses aplicado (o roteiro deu ${(dias / 30).toFixed(1)})`;
    return { meses, regra, detalhe, roteiro: atos };
  }
  const sg = o.serventiaDias + o.gabineteDias;
  const ciclos = sg * 2 + o.serventiaDias * 1.5;
  const alvara = regra.alvaraDias === 'se_exigir' ? (o.exigeAlvara ? 21 : 0) : regra.alvaraDias;
  const diasDesde = (d?: Date) => (d ? Math.max(0, Math.round((o.dataAquisicao.getTime() - d.getTime()) / 86400000)) : null);
  const diasAte = (d?: Date) => (d ? Math.round((d.getTime() - o.dataAquisicao.getTime()) / 86400000) : null);

  let dias: number;
  let detalhe: string;
  if (o.esfera === 'goias') {
    // Fiel ao template do TJGO.
    if (o.scenario === 'A') {
      const e23 = diasAte(o.dataFatalConvenio) ?? 60;
      dias = ciclos + e23 + regra.pagamentoDias;
      detalhe = `ciclos do processo ${Math.round(ciclos)}d + até a expedição ${e23}d${o.dataFatalConvenio ? ' (convênio)' : ' (estimado)'} + pagamento ${regra.pagamentoDias}d`;
    } else {
      dias = ciclos + alvara + regra.pagamentoDias;
      detalhe = `ciclos do processo ${Math.round(ciclos)}d + alvará ${alvara}d + pagamento ${regra.pagamentoDias}d`;
    }
  } else if (o.scenario === 'A') {
    dias = ciclos + regra.pagamentoDias + alvara;
    detalhe = `ciclos do processo ${Math.round(ciclos)}d + pagamento ${regra.pagamentoDias}d${alvara ? ` + alvará ${alvara}d` : ''}`;
  } else {
    const decorridos = diasDesde(o.dataExpedicao) ?? 0;
    const restante = Math.max(0, regra.pagamentoDias - decorridos);
    dias = restante + alvara + sg;
    detalhe = `pagamento restante ${restante}d${o.dataExpedicao ? ` (${decorridos}d já decorridos)` : ''}${alvara ? ` + alvará ${alvara}d` : ''} + um ciclo de liberação ${Math.round(sg)}d`;
  }
  const meses = Math.max(PISO_MESES, dias / 30);
  if (meses > dias / 30) detalhe += ` — piso de ${PISO_MESES} meses aplicado (o cálculo deu ${(dias / 30).toFixed(1)})`;
  return { meses, regra, detalhe, roteiro: null };
}

// Modelo 1 (verde) se há honorários contratuais a destacar; senão Modelo 2 (azul).
/**
 * Qual bloco da planilha vale: o verde (1) ou o azul (2).
 *
 * A PERGUNTA É SOBRE OS AUTOS, NÃO SOBRE O NEGÓCIO. O verde é "os honorários
 * FORAM DESTACADOS na RPV ou nos cálculos da contadoria"; o azul, "não foram".
 * É fato do processo, e independe de estarmos comprando o principal, os
 * honorários ou os dois.
 *
 * Confundir as duas coisas punha metade dos casos no bloco errado: crédito com
 * destaque cuja cessão é só do principal caía no azul, e crédito sem destaque
 * cuja cessão inclui honorários caía no verde. Além de o documento afirmar algo
 * falso sobre o processo, os dois blocos calculam o honorário sobre bases
 * diferentes — o verde sobre o bruto, o azul sobre o líquido.
 *
 * Sem o campo (análise de antes desta versão), cai no valor destacado, que era
 * o critério anterior.
 */
function escolherModelo(destacados: unknown, honorariosContratuais: number): 1 | 2 {
  if (destacados === true) return 1;
  if (destacados === false) return 2;
  return honorariosContratuais > 0 ? 1 : 2;
}


/**
 * A UF do tribunal onde o crédito tramita — é a tabela de emolumentos dela que
 * vale, e o teto de RPV dela que se aplica.
 *
 * A lógica mora em _shared/tribunais.ts, com os mapas de região do TRT e do TRF
 * e a leitura do número CNJ. Aqui fica só a chamada, porque a etapa de
 * Precificação do precatório vai precisar da mesma resposta.
 */
function origemDoCredito(dados: any): OrigemUf {
  return resolverUf({
    uf_tramitacao: dados?.uf_tramitacao,
    tribunal: dados?.tribunal,
    numero_processo: dados?.numero_processo,
  });
}

// ============================================================================
// GERAÇÃO DA PLANILHA  (ExcelJS — carrega o template e preenche/colore)
// ============================================================================

// Cores (formatação condicional — regras tipo "expression", como na pipeline atual)
const COR = {
  verde: 'FFD9EAD3', vermelho: 'FFF4CCCC', azul: 'FFCFE2F3', roxo: 'FFD9D2E9',
  laranja: 'FFFCE5CD', cinza: 'FFEFEFEF',
};
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb }, fgColor: { argb } });
const regra = (ref: string, formula: string, cor: string, priority: number) =>
  ({ ref, formula, cor, priority });

// Aplica todas as regras de cor da aba jurídica (texto = valor do dropdown).
function aplicarCoresJuridica(ws: any) {
  const add = (ref: string, rules: Array<{ f: string; cor: string }>) =>
    ws.addConditionalFormatting({
      ref,
      rules: rules.map((r, i) => ({ type: 'expression', formulae: [r.f], priority: i + 1, style: { fill: fill(r.cor) } })),
    });

  // AS LINHAS ANDARAM no modelo simplificado: o questionário saiu de 12..43 para
  // 10..37. Regra pintando a linha errada não dá erro — só colore a resposta
  // errada, que é pior que não colorir.

  // Sim/Não — em toda a faixa de respostas (só pinta onde o texto casa).
  // A fórmula é relativa à primeira célula da faixa: $B10 para a faixa que
  // começa em B10.
  add('B10:B38', [
    { f: '$B10="Sim"', cor: COR.verde },
    { f: '$B10="Não"', cor: COR.vermelho },
  ]);
  // B19 — tipo de sentença
  add('B19', [
    { f: '$B19="Procedência"', cor: COR.verde },
    { f: '$B19="Improcedência"', cor: COR.vermelho },
    { f: '$B19="Procedência parcial"', cor: COR.azul },
    { f: '$B19="Homologatória de acordo"', cor: COR.roxo },
  ]);
  // B20 — líquida/ilíquida
  add('B20', [
    { f: '$B20="Líquida"', cor: COR.verde },
    { f: '$B20="Iliquída"', cor: COR.vermelho },
  ]);
  // B24 — valor apresentado / execução invertida
  add('B24', [
    { f: '$B24="Valor apresentado no CS"', cor: COR.roxo },
    { f: '$B24="Execução invertida"', cor: COR.azul },
  ]);
  // B26 — cenários de execução invertida (cinza p/ qualquer preenchimento)
  add('B26', [{ f: '$B26<>""', cor: COR.cinza }]);
  // B38 — expedição
  add('B38', [
    { f: '$B38="Minuta de RPV"', cor: COR.laranja },
    { f: '$B38="RPV"', cor: COR.verde },
    { f: '$B38="Alvará de pagamento"', cor: COR.azul },
    { f: '$B38="Sem expedição"', cor: COR.roxo },
  ]);
  // A regra da necessidade de alvará saiu junto com a pergunta (linha 43 do
  // modelo antigo), que o dono removeu ao simplificar.
}

// Title Case para nomes: 1ª letra de cada palavra maiúscula, resto minúsculo
// (conectores comuns em pt-BR ficam minúsculos: "Vanderlan Gomes de Morais").
function tituloNome(s: string): string {
  const conect = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la', 'le', 'van', 'von']);
  return String(s || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && conect.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// Remove caracteres proibidos em nome de arquivo do Drive
function limparNomeArquivo(s: string): string {
  return String(s || '').replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * Os riscos da análise, com as divergências da auditoria na frente.
 *
 * AS DIVERGÊNCIAS SÃO RISCOS, e é onde elas cabem: têm grau, fundamento e
 * consequência, que é exatamente a forma de um risco. Antes saíam por extenso
 * nos avisos e a IA ainda as repetia na lista de riscos — o mesmo achado duas
 * vezes, e a versão dos avisos com meia tela de fundamentação. A janela ficava
 * ilegível, e o painel do card, que junta todos os avisos num parágrafo só,
 * virava uma parede de texto.
 *
 * Vêm PRIMEIRO porque são o achado que muda o preço.
 */
function riscosComAuditoria(dados: any): any[] {
  const divs = Array.isArray(dados?.auditoria_divergencias) ? dados.auditoria_divergencias : [];
  const grau = (g: unknown) => {
    const x = String(g ?? '').toLowerCase();
    return x === 'alta' ? 'ALTO' : x === 'media' ? 'MODERADO' : 'PONTO DE ATENÇÃO';
  };
  return [
    ...divs.map((d: any) => {
      const ef = String(d?.efeito_se_corrigida ?? d?.efeito ?? '');
      return {
        grau: grau(d?.gravidade),
        risco: `Cálculo: ${String(d?.item ?? 'divergência')}` +
          (ef === 'reduz' ? ' — corrigida, derruba o crédito' : ef === 'aumenta' ? ' — corrigida, elevaria o crédito' : ''),
        fundamento: `O título/lei pede "${String(d?.esperado ?? '')}"; a conta fez "${String(d?.encontrado ?? '')}". ${String(d?.fundamento ?? '')}`.trim(),
      };
    }),
    ...(Array.isArray(dados?.bloco_g_riscos) ? dados.bloco_g_riscos : []),
  ];
}

/**
 * As listas suspensas da aba jurídica, linha a linha. Texto fora delas a célula
 * aceita e o Excel só reclama quando alguém edita — o arquivo sai "preenchido" e
 * a cor condicional não pinta. O prompt promete "marcado como inválido"; isto é
 * o que marca.
 */
const SIM_NAO = ['Sim', 'Não'];
const LISTAS_M2: Record<string, string[]> = {
  '10': SIM_NAO, '11': SIM_NAO, '14': SIM_NAO, '15': SIM_NAO, '16': SIM_NAO, '18': SIM_NAO,
  '21': SIM_NAO, '22': SIM_NAO, '23': SIM_NAO, '27': SIM_NAO, '28': SIM_NAO, '31': SIM_NAO,
  '32': SIM_NAO, '33': SIM_NAO, '34': SIM_NAO, '35': SIM_NAO, '37': SIM_NAO,
  '19': ['Improcedência', 'Procedência', 'Procedência parcial', 'Homologatória de acordo'],
  // "Iliquída" é a grafia da lista do modelo; a correção ortográfica tem de vir do modelo, não daqui.
  '20': ['Líquida', 'Iliquída'],
  '24': ['Valor apresentado no CS', 'Execução invertida'],
  '26': [
    'Executado não apresentou valores e prazo ainda em curso',
    'Executado não apresentou valores — prazo decorrido — sem manifestação da parte exequente',
    'Executado não apresentou valores — prazo decorrido — já houve manifestação da parte exequente',
    'Executado apresentou valores',
  ],
  '38': ['Minuta de RPV', 'RPV', 'Alvará de pagamento', 'Sem expedição'],
};

/**
 * Traz cada resposta para o valor EXATO da lista da sua linha, quando dá.
 *
 * "sim", "SIM", "Sim, em 12/03/2026" viram "Sim"; "procedencia parcial" vira
 * "Procedência parcial"; "Executado apresentou valores (fls. 300)" casa pela
 * opção mais longa contida. O que não casa fica como veio e é devolvido em
 * `foraDaLista`, para a análise avisar — corrigir sem saber o que a IA quis
 * dizer seria inventar resposta.
 */
function normalizarM2(m2: unknown): { m2: Record<string, any>; foraDaLista: string[] } {
  const saida: Record<string, any> = {};
  const fora: string[] = [];
  const entrada = (m2 && typeof m2 === 'object') ? (m2 as Record<string, any>) : {};
  for (const [linha, item] of Object.entries(entrada)) {
    const lista = LISTAS_M2[linha];
    const resposta = item?.resposta;
    if (!lista || typeof resposta !== 'string' || !resposta.trim()) { saida[linha] = item; continue; }
    const r = normalizar(resposta);
    let canon: string | null = lista.find((op) => normalizar(op) === r) ?? null;
    if (!canon && lista === SIM_NAO) canon = r.startsWith('sim') ? 'Sim' : r.startsWith('nao') ? 'Não' : null;
    if (!canon) {
      // A opção mais longa que a resposta contém: "Procedência parcial" antes de "Procedência".
      canon = [...lista].sort((a, b) => b.length - a.length).find((op) => r.includes(normalizar(op))) ?? null;
    }
    if (canon) saida[linha] = { ...item, resposta: canon };
    else { saida[linha] = item; fora.push(`linha ${linha}: "${resposta.slice(0, 60)}"`); }
  }
  return { m2: saida, foraDaLista: fora };
}

// dados = saída do extrator. Estrutura em SCHEMA_ANALISE (abaixo).
async function gerarPlanilha(templateBytes: Uint8Array, dados: any, calc: any, T5: number): Promise<Uint8Array> {
  // OS VALORES QUE DE FATO PRECIFICARAM, e não os dos autos.
  //
  // Quando a auditoria acha divergência que pode derrubar o crédito, o motor
  // calibra o deságio sobre a base REVISADA. Escrever o bruto dos autos e o
  // deságio revisado junta duas bases diferentes: a planilha recalcula por
  // dentro e o preço sai MAIOR que o autorizado — num corte de 10% sobre um
  // crédito de R$ 72 mil, R$ 4.315 a mais oferecidos ao cedente, com a
  // rentabilidade impressa calculada sobre um valor que a própria auditoria
  // disse que pode não existir.
  //
  // Declarado aqui em cima porque a aba jurídica também o usa, e ela é escrita
  // antes da precificação.
  const _vp = dados._valores_precificados ?? {
    brutoTotal: Number(dados.bruto_total) || 0,
    ir: Number(dados.ir) || 0,
    inss: Number(dados.inss) || 0,
    contratuaisBrutos: Number(dados.honorarios) || 0,
    sucumbenciaisBrutos: Number(dados.honorarios_sucumbenciais) || 0,
  };

  // CARREGADO AQUI, não no topo do arquivo. O ExcelJS é de longe a dependência
  // mais pesada desta função, e no topo ela entrava na partida de TODA
  // invocação — inclusive das leves, que nem planilha geram: a consulta de
  // emolumentos e cada etapa do levantamento. Numa partida a frio isso passava
  // dos 20 s e a tela dizia "o servidor não respondeu à consulta".
  const { default: ExcelJS } = await import('npm:exceljs@4.4.0');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBytes as any);

  const aj = wb.getWorksheet('Análise jurídica')!;
  // AS DUAS ABAS DE MODELO VIRARAM UMA. O modelo simplificado tem "Análise
  // jurídica" e "Precificação"; os dois modelos, que eram abas irmãs, agora são
  // dois BLOCOS empilhados na mesma aba — Modelo 1 (verde) nas linhas 1-11 e
  // Modelo 2 (azul) nas 13-23, com a mesma estrutura deslocada em 12 linhas.
  const prec = wb.getWorksheet('Precificação')!;
  /** Deslocamento do bloco em uso: 0 no Modelo 1, 12 no Modelo 2. */
  const off = dados.modelo === 1 ? 0 : 12;
  /** Célula do bloco em uso: cel('K', 5) -> K5 no Modelo 1, K17 no Modelo 2. */
  const cel = (col: string, linha: number) => prec.getCell(`${col}${linha + off}`);

  // ---------------- Aba jurídica: cabeçalho ----------------
  // O cabeçalho encurtou e as linhas andaram: cedente saiu de C6 para C4,
  // advogado de C7 para C5, tribunal de C8 para C6. C3 e C7 são novas.
  aj.getCell('C1').value = dados.numero_processo ?? '';
  aj.getCell('C2').value = dados.originador ?? '';
  aj.getCell('C3').value = dados.tipo_credito ?? '';   // "Quais créditos vão ser negociados?"
  aj.getCell('C4').value = dados.cedente_cpf ?? '';
  aj.getCell('C5').value = dados.advogado_oab ?? '';
  aj.getCell('C6').value = dados.tribunal ?? '';
  aj.getCell('C7').value = dados.juizo ?? '';          // "Juízo" — campo novo

  // ---------------- O modelo ainda é o que o código pensa que é? ----------------
  //
  // O questionário é escrito POR NÚMERO DE LINHA: a IA devolve { "19": {...} } e
  // isso vai para B19. Quando alguém insere uma pergunta no meio do modelo, tudo
  // abaixo dela desce — e as respostas passam a cair nas perguntas erradas SEM
  // ERRO NENHUM, porque "Sim" numa célula que espera "Sim" é aceito. O arquivo
  // sai bonito e mentindo.
  //
  // Já aconteceu duas vezes: o questionário saiu de 12..43 para 10..37, e depois
  // ganhou "Há honorários sucumbenciais?" na 36, empurrando a expedição para a
  // 38 e o valor final para a 39.
  //
  // Daí esta conferência. Ela não conserta nada — só troca uma planilha
  // silenciosamente errada por uma falha que diz onde olhar. Falhar aqui é o
  // desfecho bom: o documento errado seria assinado.
  const ANCORAS: Array<[number, string, string]> = [
    // As duas primeiras entraram quando a due diligence passou a ESCREVER nelas
    // (ver aplicarDiligenciaNoM2). Deslocamento de linha as outras âncoras já
    // pegam; o que só estas pegam é a 10 e a 11 TROCAREM ENTRE SI — e aí a
    // dívida do cedente sairia impressa como sendo do advogado, nas duas
    // células que a diligência acabou de garantir que estavam certas.
    //
    // A AGULHA É CURTA de propósito: uma palavra que qualquer redação daquelas
    // duas perguntas tem. O texto exato do modelo não está no repositório (ele
    // mora no Storage), e âncora escrita de memória derruba TODA análise se o
    // dono tiver reescrito a pergunta.
    [10, 'cedente', 'a pergunta sobre o histórico do cedente'],
    [11, 'advogado', 'a pergunta sobre o histórico do advogado'],
    [19, 'tipo da sentenca', 'tipo da sentença'],
    [24, 'foi apresentado valor', 'valor apresentado no CS / execução invertida'],
    [25, 'cuidado', 'bloco fixo CUIDADO (não é pergunta)'],
    [26, 'execucao invertida', 'cenários da execução invertida'],
    [28, 'impugnacao', 'houve impugnação ao valor'],
    [36, 'sucumbenciais', 'há honorários sucumbenciais'],
    [38, 'expedicao de algum documento', 'houve expedição de documento'],
    [39, 'valor total final', 'valor final do crédito (escrito por mim)'],
    [40, 'observacao importante', 'observações e riscos (escrito por mim)'],
  ];
  // O texto de uma célula pode vir como string OU como richText (pedaços com
  // formatação própria) — e várias destas perguntas vêm assim, com trechos em
  // negrito. Ler direto com String() devolveria "[object Object]", e a
  // conferência acusaria deslocamento em toda linha formatada.
  const textoDaCelula = (v: unknown): string => {
    if (v == null) return '';
    const rt = (v as { richText?: Array<{ text?: unknown }> })?.richText;
    if (Array.isArray(rt)) return rt.map((p) => String(p?.text ?? '')).join('');
    return String(v);
  };
  // `normalizar` (no topo do arquivo) tira acento, pontuação E espaço. Os dois
  // lados passam por ela, então "tipo da sentenca" casa com "Tipo da sentença:".
  // Reusar em vez de escrever outra: uma cópia desta normalização já entrou
  // errada aqui antes, com as combining marks coladas como caracteres literais
  // em lugar dos escapes Unicode.
  const fora = ANCORAS.filter(
    ([linha, trecho]) => !normalizar(textoDaCelula(aj.getCell(`A${linha}`).value)).includes(normalizar(trecho)),
  );
  if (fora.length) {
    throw new Error(
      'O modelo de Análise de RPV mudou de lugar e o código ainda escreve nas linhas antigas — ' +
      'as respostas cairiam nas perguntas erradas, sem erro visível. ' +
      fora.map(([linha, , oque]) => `A linha ${linha} devia ser "${oque}" e está com "${(textoDaCelula(aj.getCell(`A${linha}`).value) || '(vazia)').slice(0, 60)}"`).join('; ') +
      '. Rode scripts/conferir-planilha.cjs com o modelo novo e ajuste o mapa do m2.',
    );
  }

  // ---------------- Aba jurídica: respostas M2 (col B) + complementos (col D) ----------------
  // dados.m2 = { "10": {resposta, complemento}, ... } indexado pela LINHA da planilha (perguntas 10..38)
  // As duas linhas que não recebem escrita, no modelo simplificado:
  const PULAR_LINHA = new Set([25]);       // 25 = bloco fixo "CUIDADO" (A25:D25 mesclado)
  const SEM_COMPLEMENTO = new Set([28]);   // 28 = C28:D28 mesclado ("Responder na linha abaixo")
  for (const [linha, item] of Object.entries<any>(dados.m2 || {})) {
    const r = Number(linha);
    if (PULAR_LINHA.has(r)) continue;
    if (item?.resposta != null && item.resposta !== '') aj.getCell(`B${r}`).value = item.resposta;
    // complemento só quando houver (regra: "Não" => D vazio; nada de "não encontrado")
    if (!SEM_COMPLEMENTO.has(r) && item?.complemento != null && item.complemento !== '') aj.getCell(`D${r}`).value = reformatarMoeda(item.complemento);
  }

  // Linha 39: "Qual o valor final do crédito?" (mesclado). O modelo traz o
  // gabarito do texto; aqui ele sai preenchido.
  // A PERGUNTA É "qual o valor total final líquido do(s) crédito(s) SENDO
  // NEGOCIADO(S)?", e a resposta é a base sobre a qual o deságio foi calibrado
  // — não o bruto. O texto antigo começava pelo VALOR TOTAL BRUTO e nunca
  // chegava a dizer o total líquido negociado, que é justamente o que se
  // perguntou. A decomposição fica embaixo, onde ajuda em vez de confundir.
  aj.getCell('B39').value =
    `VALOR TOTAL LÍQUIDO NEGOCIADO: ${brl(calc.Y3)}\n` +
    `(bruto ${brl(_vp.brutoTotal)}${dados._auditoria_aplicada ? ` — revisado pela auditoria; nos autos, ${brl(Number(dados.bruto_total) || 0)}` : ''}; principal líquido ${brl(calc.L5)}` +
    (calc.L7 > 0 ? `; honorários líquidos ${brl(calc.L7)}` : '') +
    (Number(dados._ir_honorarios) > 0 ? `; IR sobre honorários ${brl(Number(dados._ir_honorarios))}` : '') +
    ')';

  // Linha 40: "Alguma observação importante para acrescentar nesse caso?"
  // (mesclado). Recebe os riscos que a IA levantou — é onde eles cabem dentro
  // da planilha. Antes existiam só na resposta da função e não chegavam ao
  // arquivo que fica no Drive.
  const riscos: any[] = riscosComAuditoria(dados);
  if (riscos.length)
    aj.getCell('B40').value = riscos
      .map((r) => `• ${r?.grau ? `[${r.grau}] ` : ''}${r?.risco ?? ''}${r?.fundamento ? ` — ${r.fundamento}` : ''}`)
      .join('\n');

  aplicarCoresJuridica(aj);

  // ---------------- Precificação: o bloco do modelo escolhido ----------------
  //
  // ONDE CADA COISA VAI (linhas do Modelo 1; o Modelo 2 é o mesmo +12):
  //   B4  processo        C4  resumo do processo
  //   D5  credor          D7  advogado          F5/F7 ente
  //   G5  natureza        H5/H7 fase            I5 data aquisição   J5 data pagamento
  //   K5  bruto           M5  IR                N5  INSS
  //   O5  deságio         Q5  prazo             L7  honorários contratuais
  //   T10/W10 cartório    T11/W11 diligência
  //
  // Três células trocaram de lugar em relação ao modelo antigo, e é o tipo de
  // mudança que não dá erro — só grava no lugar errado: deságio saiu de R5 para
  // O5, prazo de T5 para Q5, e o cartório deixou de ter uma célula só.
  //
  // As colunas S/T e V/W são dois CENÁRIOS lado a lado — "só principal" e
  // "principal + honorários" —, calculados por fórmula a partir das entradas.
  // O QUE A PLANILHA ESCREVE É O QUE PRECIFICOU, não o que está nos autos.
  //
  // Quando a auditoria acha divergência que pode derrubar o crédito, o motor
  // calibra o deságio sobre a base REVISADA. Escrever aqui o bruto dos autos e
  // o deságio revisado junta duas bases diferentes: a planilha recalcula tudo
  // por dentro e o preço sai MAIOR que o autorizado — num corte de 10% sobre um
  // crédito de R$ 72 mil, R$ 4.315 a mais oferecidos ao cedente, com a
  // rentabilidade impressa calculada sobre um valor que a própria auditoria
  // disse que pode não existir.
  {
    // A ORIGEM VAI EM NOTA NA CÉLULA DO BRUTO. É de lá que descende todo o
    // resto — líquido, deságio, preço —, e é o número que alguém vai querer
    // conferir contra os autos. Em nota, e não em célula vizinha: o layout é
    // fixo e uma célula a mais empurraria o que vem depois.
    //
    // Havendo corte de auditoria, a nota abre por ele: quem confere a célula
    // contra os autos precisa saber, ali, por que os números não batem.
    const k5 = cel('K', 5);
    k5.value = _vp.brutoTotal;
    const partes: string[] = [];
    if (dados._auditoria_aplicada) {
      partes.push(
        `CENÁRIO CONSERVADOR: o bruto dos autos é ${brl(Number(dados.bruto_total) || 0)} e foi reduzido ` +
        `em ${brl(Number(dados._auditoria_corte) || 0)} pela auditoria dos cálculos. ` +
        `${String(dados.auditoria_justificativa ?? '')}`.trim(),
      );
    }
    if (dados.origem_valores) partes.push(String(dados.origem_valores));
    if (partes.length) k5.note = partes.join('\n\n').slice(0, 1200);
  }
  cel('M', 5).value = _vp.ir;
  cel('N', 5).value = _vp.inss;
  // O PERCENTUAL, E NÃO O VALOR. O modelo passou a ter o percentual de
  // honorários em célula própria (K7/K19), e as linhas de honorários se
  // calculam a partir dele: o bruto sai do percentual, o IR sai do bruto pela
  // tabela progressiva, e o líquido é a diferença. Escrever o VALOR em L7,
  // como se fazia, destruía essa fórmula — e com ela o desconto de IR que o
  // dono acabou de pôr na planilha.
  //
  // O percentual é DERIVADO do valor que o motor usou, dividido pela mesma base
  // que a fórmula da planilha usa. Assim a planilha reproduz o número do motor
  // por construção, venha ele do destaque da contadoria ou de um percentual
  // digitado na tela — em vez de os dois calcularem por caminhos que podem
  // divergir. As bases diferem entre os modelos, como as fórmulas do modelo:
  // no Modelo 1 o honorário é percentual do BRUTO; no Modelo 2, do LÍQUIDO.
  const _baseHon = dados.modelo === 1
    ? _vp.brutoTotal
    : _vp.brutoTotal - _vp.ir - _vp.inss;
  const _pctHon = _baseHon > 0 ? _vp.contratuaisBrutos / _baseHon : 0;
  cel('K', 7).value = Number(_pctHon.toFixed(6));
  // OS SUCUMBENCIAIS, LIDOS DO PROCESSO — e zero quando não houver.
  //
  // Os 10% que o modelo traz são um padrão de planilha, não um dado: num
  // processo sem sucumbenciais eles inventavam milhares de reais, e as duas
  // colunas de cenário que se apoiam nesta linha eram feitas inteiramente
  // desse valor imaginário. Agora a IA extrai a verba dos anexos do card
  // (dispositivo da sentença, conta da contadoria, o próprio requisitório) e
  // zero vira zero.
  //
  // A base é o BRUTO nos dois modelos, como as fórmulas L8 e L20 do modelo.
  //
  // EM "SÓ HONORÁRIOS" O PERCENTUAL É ZERO, e não o que se extraiu. Naquele modo
  // a verba cedida VIRA o bruto e ocupa a linha do principal; deixar a linha de
  // sucumbenciais também preenchida contaria a MESMA verba duas vezes — numa
  // cessão de R$ 15.000 a planilha somaria R$ 30.000.
  const _brutoSucumb = _vp.brutoTotal;
  const _pctSucumb = _brutoSucumb > 0 ? _vp.sucumbenciaisBrutos / _brutoSucumb : 0;
  cel('K', 8).value = Number(_pctSucumb.toFixed(6));
  // O DESÁGIO VAI ONDE ELE INCIDE, linha por linha.
  //
  // Havendo principal no negócio, os honorários são comprados pelo valor de
  // face e todo o deságio cai sobre o principal — prática da Credijuris, ver
  // _shared/precificacao.ts. Numa cessão só de honorários não há onde jogá-lo,
  // e ele volta a incidir sobre eles.
  //
  // Cada linha recebe o deságio da SUA parcela, e zero quando a parcela não
  // está no negócio: um deságio numa linha que não se compra não muda o preço,
  // mas muda o que as colunas de cenário exibem.
  const _desagioDe = (nome: string) => {
    const p = (dados._parcelas ?? []).find((x: any) => x.nome === nome);
    return p ? (p.desagiavel ? calc.desagio : 0) : 0;
  };
  cel('O', 5).value = _desagioDe('principal');
  cel('O', 7).value = _desagioDe('contratuais');
  cel('O', 8).value = _desagioDe('sucumbenciais');
  cel('Q', 5).value = Number(T5.toFixed(4));
  cel('I', 5).value = dados.data_aquisicao;
  cel('J', 5).value = dados.data_pagamento;

  // CARTÓRIO NOS QUATRO CENÁRIOS. O modelo antigo tinha uma célula só; hoje são
  // quatro colunas lado a lado — T "só principal", W "principal + honorários",
  // Z "só honorários" e AC "só sucumbenciais" —, e a escritura e o registro
  // custam o mesmo em todas: o ato de cessão é um só.
  //
  // Deixar qualquer uma vazia faz aquele cenário exibir custo total MENOR que o
  // real e, portanto, rentabilidade maior — o erro que mais engana numa
  // comparação lado a lado, porque o número inflado aparece justamente na
  // coluna que se quer escolher.
  for (const col of ['T', 'W', 'Z', 'AC']) {
    const c = cel(col, 10);
    c.value = calc.Y10;
    // A decomposição vai em NOTA, não em célula vizinha: o layout é fixo e uma
    // célula a mais empurraria o que vem depois.
    if (calc.faixaCartorio) c.note = String(calc.faixaCartorio);
  }

  cel('B', 4).value = dados.numero_processo ?? '';
  cel('C', 4).value = dados.m1_sintese ?? '';
  cel('D', 5).value = dados._credor_titulo ?? dados.credor_nome ?? '';
  cel('D', 7).value = dados.advogado_nome ?? '';
  cel('F', 5).value = dados.ente_devedor ?? '';
  cel('H', 5).value = dados.fase_processual ?? '';
  // F7 e H7 NÃO SÃO ESCRITAS, e isso não é esquecimento: no modelo simplificado
  // a linha dos honorários espelha a do principal por fórmula (F7 = =F5,
  // H7 = =H5), então escrever repetiria o valor à toa — e, no caso de H7, com
  // dano: I7 e J7 são clones de fórmula compartilhada cujo MESTRE é H7.
  // Sobrescrever H7 deixa os clones órfãos e o ExcelJS recusa gravar o arquivo
  // inteiro ("Shared Formula master must exist above and or left of clone for
  // cell I7"). Ou seja: a análise rodava, custava as duas chamadas de IA, e
  // morria na hora de montar a planilha.

  // ======================================================================
  // O ARQUIVO ENTREGUE MOSTRA SÓ O CASO
  // ======================================================================
  //
  // A planilha de trabalho traz dois modelos (honorários destacados ou não) e
  // quatro cenários de negociação lado a lado. O arquivo que vai para o Drive
  // não precisa de nada disso: o modelo já foi escolhido pelo destaque, e o
  // cenário já foi escolhido pelo "PARCELA CEDIDA" das anotações do card. O que
  // sobra na tela é ruído — e pior que ruído, porque um número de cenário que
  // não é o negociado convida a ser lido como se fosse.

  // ESVAZIAR + OCULTAR, e não remover.
  //
  // Remover as linhas seria mais limpo, mas os blocos são da MESMA aba e o de
  // baixo tem fórmulas que apontam para as próprias linhas (=L17, =Q17, =T15…).
  // O spliceRows do ExcelJS apaga a linha e NÃO reescreve as referências:
  // remover o bloco de cima faria o de baixo subir com as fórmulas apontando
  // para o lugar errado, e a planilha sairia com números plausíveis e errados —
  // o pior desfecho possível num documento de preço. Ocultar não mexe em
  // referência nenhuma, e para quem abre o arquivo o efeito é o mesmo.
  //
  // Esvaziar TAMBÉM, e não só ocultar: se alguém reexibir as linhas, tem de
  // encontrar vazio, e não os números de exemplo do modelo (K17 = 20000).
  const inicioOutro = dados.modelo === 1 ? 13 : 1;
  const fimOutro = dados.modelo === 1 ? 23 : 11;
  for (let r = inicioOutro; r <= fimOutro; r++) {
    const row = prec.getRow(r);
    for (let c = 1; c <= prec.columnCount; c++) {
      const cell = row.getCell(c);
      // Só a célula-mestre de uma mesclagem aceita escrita; nas outras, o
      // ExcelJS lança.
      if (cell.isMerged && cell.master !== cell) continue;
      cell.value = null;
    }
  }
  prec.getCell(`A${inicioOutro}`).value =
    dados.modelo === 1
      ? 'MODELO 2 (AZUL) — não utilizado nesta análise: os honorários foram destacados.'
      : 'MODELO 1 (VERDE) — não utilizado nesta análise: os honorários não foram destacados.';
  // A linha em branco entre os blocos vai junto, senão sobra uma faixa colorida
  // solta onde havia um modelo inteiro.
  for (let r = inicioOutro; r <= fimOutro; r++) prec.getRow(r).hidden = true;
  prec.getRow(12).hidden = true;   // a linha vazia entre os dois blocos

  // OS CENÁRIOS: fica só o que está sendo negociado.
  //
  // Qual é vem do "PARCELA CEDIDA" das anotações do card (ver tipo_aquisicao) e
  // é o mesmo texto que aparece na C3 da aba jurídica.
  //
  // A coluna de cada cenário é onde o NÚMERO está, e no caso de "apenas
  // honorários" isso não é a coluna Y/Z: naquele modo o motor põe o honorário
  // na linha do principal (o honorário VIRA o bruto), então o número sai em
  // S/T. Manter Y/Z ali entregaria uma coluna vazia.
  const CENARIOS = {
    principal:    { sep: 'R', rot: 'S',  val: 'T'  },
    ambos:        { sep: 'U', rot: 'V',  val: 'W'  },
    honorarios:   { sep: 'X', rot: 'Y',  val: 'Z'  },
    sucumbenciais:{ sep: 'AA', rot: 'AB', val: 'AC' },
  } as const;
  // A COLUNA É A DAS VERBAS COMPRADAS, e agora bate uma a uma com as quatro do
  // modelo — antes o cenário de honorários caía na coluna do principal, porque
  // era lá que o truque punha a verba.
  const _v = dados._verbas_negociadas ?? { principal: true, contratuais: false, sucumbenciais: false };
  const cenarioUsado: keyof typeof CENARIOS =
    _v.principal && (_v.contratuais || _v.sucumbenciais) ? 'ambos'
    : _v.principal ? 'principal'
    : _v.contratuais ? 'honorarios'
    : 'sucumbenciais';
  for (const [nome, c] of Object.entries(CENARIOS)) {
    if (nome === cenarioUsado) continue;
    for (const col of [c.sep, c.rot, c.val]) prec.getColumn(col).hidden = true;
  }
  // O RÓTULO TEM DE DIZER A VERDADE. Em "apenas honorários" o número está na
  // coluna cujo rótulo diz "Negociando apenas Crédito Principal" — que naquele
  // caso é falso, porque não há principal nenhum na operação.
  // O rótulo de cada coluna já descreve o seu cenário no próprio modelo, e
  // agora a coluna escolhida é a que corresponde às verbas — então não há mais
  // rótulo a corrigir. Enquanto o cenário de honorários era exibido na coluna
  // do principal, o texto tinha de ser reescrito para não mentir.

  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}

// ============================================================================
// EXTRAÇÃO PELA IA  (mesmo padrão da gerar-contrato: api.anthropic.com direto)
// ============================================================================

// Esquema do que a IA deve devolver. Linhas em m2 = nº da linha na aba jurídica.
const SCHEMA_ANALISE = {
  numero_processo: 'número do processo',
  tribunal: 'tribunal (sigla, ex.: TJGO, TJSP, TJMG, TRF1, TRT18)',
  juizo: 'o juízo onde o processo tramita, como está no cabeçalho (ex.: "3ª Vara da Fazenda Pública de Recife", "17ª Vara Federal de PE")',
  uf_tramitacao: 'UF (sigla de 2 letras) onde o processo tramita. ONDE ACHAR, em ordem: (1) a SEÇÃO ou SUBSEÇÃO JUDICIÁRIA do cabeçalho, na Justiça Federal — "Seção Judiciária de Pernambuco" é PE, "Subseção Judiciária de Campinas/SP" é SP, "SJ/MG" é MG; (2) a COMARCA, na Justiça Estadual — "Comarca de Anápolis" é GO; (3) a cidade da VARA DO TRABALHO — "2ª Vara do Trabalho de Caruaru" é PE; (4) o endereço do fórum, o carimbo, o rodapé do documento ou a OAB do procurador do ente. É O CAMPO MAIS IMPORTANTE DEPOIS DOS VALORES: é ele que escolhe a tabela de emolumentos de cartório que entra no preço e o teto de RPV. Num TRF a sigla do tribunal NÃO diz o estado (o TRF1 cobre treze), então sem este campo o preço sai sem cartório — procure o cabeçalho em todas as peças anexadas antes de desistir. Só devolva null se realmente não houver nenhuma indicação de lugar em documento nenhum',
  cedente_cpf: 'nome do cedente e CPF',
  advogado_oab: 'nome do advogado/escritório e OAB/CNPJ',
  credor_nome: 'nome completo do credor/cedente SEM o CPF (ex.: "Vanderlan Gomes de Morais")',
  advogado_nome: 'nome do advogado ou escritório SEM OAB/CNPJ',
  ente_devedor: 'ente devedor (quem vai pagar o crédito), ex.: "Estado de Goiás", "Estado de São Paulo", "Município de Belo Horizonte", "União", "INSS", "Fazenda Pública do Estado do Paraná"',
  fase_processual: 'fase processual atual resumida em poucas palavras, ex.: "Cumprimento de sentença", "Aguardando expedição de RPV", "RPV expedida", "Trânsito em julgado"',
  tipo_credito: 'um de, EXATAMENTE: "Crédito principal — apenas" | "Crédito principal + Honorários" | "Honorários contratuais + sucumbenciais" | "Honorários sucumbenciais — apenas" — são os valores da lista suspensa da célula C3 da aba jurídica, e texto fora dela entra marcado como inválido',

  // financeiro — ver a seção "DE ONDE SAEM OS VALORES" no prompt do sistema
  bruto_total: 'VALOR BRUTO TOTAL do crédito que está sendo cedido, número sem R$: o total ANTES de qualquer retenção, já com principal + juros + correção. INCLUI os honorários contratuais destacados, porque eles saem de dentro dele. NÃO inclui os honorários sucumbenciais, que são verba própria e têm campo separado. NÃO é o valor da causa, nem o da condenação na sentença, nem o principal histórico sem atualização',
  principal_liquido: 'o que sobra PARA O CREDOR depois do IR, do INSS e dos honorários contratuais destacados, número. Tem de ser igual a bruto_total menos ir menos inss menos honorarios — se não fechar, algum dos números foi lido errado',
  honorarios_destacados:
    'true/false — os honorários contratuais foram DESTACADOS do crédito principal? É destaque quando o advogado pediu a reserva do art. 22, §4º, da Lei 8.906/94 e ela foi deferida, OU quando a conta da contadoria / o próprio requisitório já separam a verba dele da do credor, OU quando há requisitório em nome do advogado. ' +
    'NÃO É DESTAQUE a mera existência de contrato de honorários nos autos, nem a previsão de percentual no contrato: sem pedido deferido ou separação na conta, o advogado recebe do cliente, não do ente. ' +
    'É o que decide QUAL BLOCO da planilha vale — o verde (destacados) ou o azul (não destacados) —, e os dois calculam o honorário sobre bases diferentes: o verde sobre o BRUTO, o azul sobre o LÍQUIDO. Responder errado põe a análise no bloco errado e muda o valor do honorário',
  honorarios: 'HONORÁRIOS CONTRATUAIS A DESTACAR (0 se não houver), número: o pedaço do bruto que vai para o advogado por contrato, quando há pedido de destaque ou reserva nos autos. NÃO confundir com os sucumbenciais (campo próprio), que o vencido paga por fora',
  honorarios_contratuais_pct:
    'A PORCENTAGEM DOS HONORÁRIOS CONTRATUAIS SOBRE O CRÉDITO, número em pontos (30 = 30%), ou null. ' +
    'PROCURE A PORCENTAGEM ESCRITA, primeiro: ela aparece no contrato de honorários juntado aos autos, na petição que pede o destaque do art. 22 §4º, no despacho que o defere, e muitas vezes na própria conta da contadoria ("honorários contratuais — 30%"). ' +
    'SÓ SE NÃO HOUVER EM PARTE NENHUMA, calcule: o valor dos honorários dividido pelo valor do crédito, os dois DO MESMO DOCUMENTO — de preferência a conta da contadoria, que é onde as duas linhas convivem e a base é a que valeu de verdade. ' +
    'NÃO invente uma base: se você dividir, use o total que o próprio documento usou como base do honorário, não o bruto que você montou de outra peça. ' +
    'Serve para CONFERIR o percentual que o comercial cadastrou. Comparar valores em reais não serve, porque o mesmo percentual sobre bases diferentes dá reais diferentes — e é a base que costuma divergir, não o percentual',
  honorarios_contratuais_pct_origem:
    'de onde saiu o campo acima, em uma linha: ou a peça que traz a porcentagem escrita ("contrato de honorários, fl. 12", "conta da contadoria"), ou a divisão que você fez, dizendo os dois números ("R$ 12.400 / R$ 41.333 da conta da contadoria"). null quando não houve nem uma coisa nem outra',
  origem_valores: 'DE ONDE SAIU CADA NÚMERO, em uma ou duas frases: qual documento (conta da contadoria, decisão homologatória, RPV expedida), o ID ou a página, e até que data os valores estão atualizados. Ex.: "conta da contadoria de 12/03/2026 homologada em 20/04/2026, ID 3f21a90, fls. 412-415; valores atualizados até 03/2026". É o que permite conferir a escolha em dez segundos — não deixe vazio',
  honorarios_sucumbenciais: 'HONORÁRIOS SUCUMBENCIAIS fixados na sentença ou no acórdão, em reais — o valor que o ENTE DEVEDOR paga ao advogado por ter perdido, separado do que o cliente paga por contrato. Procure na parte dispositiva da sentença/acórdão, na conta da contadoria e no próprio requisitório: costuma vir como verba própria, às vezes em requisitório separado. Se a condenação fixar PERCENTUAL sobre o valor da causa ou da condenação, calcule o valor em reais. ZERO se a sentença não os fixou, se foram compensados, se a Fazenda não foi condenada neles, ou se você não achou — não estime por praxe: um percentual arbitrado por hábito vira dinheiro inventado na precificação',
  ir: 'IR retido SOBRE O PRINCIPAL, como a conta que vale calculou, número (0 se isento). NÃO some aqui o IR sobre os honorários — esse o sistema calcula sozinho pela tabela progressiva',
  inss: 'INSS/contribuição previdenciária retida SOBRE O PRINCIPAL, conforme os cálculos da contadoria, número (0 se zerado)',
  eh_horas_extras: 'true/false — se o crédito é de horas extras',

  // AUDITORIA DOS CÁLCULOS — ver a seção "AUDITORIA" no prompt do sistema.
  auditoria_natureza: 'a natureza do crédito para fins de correção: "tributária" | "não tributária" | "trabalhista" | "indefinida". É o que decide o regime de índices, e errar aqui contamina toda a auditoria',
  auditoria_criterio_titulo: 'o que o TÍTULO EXECUTIVO mandou aplicar, como está escrito nele: período de apuração, verbas deferidas, base de cálculo, índices de correção e juros, termo inicial de cada um. Cite o trecho e onde está. Se o título for silente em algum ponto, diga que é silente — não preencha com a praxe',
  auditoria_criterio_aplicado: 'o que a conta que vale EFETIVAMENTE aplicou, nos mesmos itens. Se a conta não explicita o índice, diga isso: conta sem memória é, por si, um achado',
  auditoria_divergencias:
    'lista das divergências entre o título e a conta, cada uma {item, esperado, encontrado, efeito_se_corrigida, gravidade, fundamento}: ' +
    '"item" = do que se trata (ex.: "índice de correção de 01/2015 a 12/2021"); ' +
    '"esperado" = o que o título ou a lei mandam; "encontrado" = o que a conta fez; ' +
    '"efeito_se_corrigida" = O QUE ACONTECE COM O CRÉDITO SE A DIVERGÊNCIA FOR CORRIGIDA — "reduz" quando a conta está inflada e a correção derruba o valor, "aumenta" quando a conta subestimou, "indefinido" quando não dá para dizer sem refazer a conta. NÃO é o efeito do erro: é o efeito do CONSERTO; ' +
    '"gravidade" = pela força do fundamento contra o que a conta fez, e SÓ por isso: "alta" com súmula, tema repetitivo ou jurisprudência consolidada; "media" com questão controvertida; "baixa" com imprecisão sem efeito no valor. NUNCA classifique por quem a divergência favorece; ' +
    '"fundamento" = a norma, a súmula, o tema ou a decisão que sustenta o "esperado". Lista vazia quando a conta está fiel ao título',
  auditoria_risco_revisao: '"alto" | "medio" | "baixo" | "nenhum" — a chance de a conta ser revista para MENOS, mesmo já homologada',
  auditoria_bruto_conservador:
    'o valor bruto no CENÁRIO CONSERVADOR, número, ou null quando não há divergência que reduza. ' +
    'Só pode ser MENOR que o bruto apurado — auditoria não aumenta crédito. ' +
    'Estime pelo efeito das divergências de gravidade alta e média que reduzem; se não der para estimar com base nos autos, devolva null e explique',
  auditoria_justificativa: 'em duas ou três frases: o que sustenta o cenário conservador, ou por que a conta foi considerada fiel',

  // prazo / cenário
  esfera: 'Federal | Estadual | Municipal — a do ENTE DEVEDOR (quem paga), não a do tribunal',
  rpv_ja_expedida: 'true se a RPV já foi expedida (cenário B); false se ainda não (cenário A)',
  data_expedicao_rpv: 'se já expedida: DD/MM/AAAA da expedição do ofício requisitório/RPV, ou null',
  data_fatal_convenio: 'se cenário A E o tribunal tem convênio com data-limite para expedir a RPV (o TJGO tem): a data (DD/MM/AAAA); null nos demais tribunais — não invente uma',

  // ROTEIRO ATÉ A LIQUIDAÇÃO — o que decide o prazo (ver regra 13).
  etapa_atual: 'em que ponto do cumprimento de sentença o processo está HOJE, em uma frase (ex.: "cálculos homologados, aguardando decisão que determina a expedição da RPV")',
  roteiro_prazo:
    'lista ORDENADA dos atos que ainda faltam até o dinheiro na conta, cada um {ato, dias, base}: ' +
    '"ato" = o que precisa acontecer, em poucas palavras; "dias" = quantos dias corridos esse ato leva NESTE processo, número; ' +
    '"base" = de onde saiu o número (média medida neste processo, prazo legal com o artigo, ou prática do tribunal). ' +
    'Inclua os atos da CESSÃO. Ver regra 13 para a montagem.',

  // M4 — médias de tempo (em DIAS). Devolver também os pares para auditoria.
  serventia_dias: 'tempo médio da serventia em dias (média dos pares petição→conclusão)',
  gabinete_dias: 'tempo médio do gabinete em dias (média dos pares conclusão→decisão)',
  m4_pares: 'lista de pares {de, ate, dias, tipo:"serventia"|"gabinete"} usados na média',

  // M2 — 25 respostas. Chave = nº da linha na aba jurídica (12..43).
  m2: 'objeto { "10": {"resposta":"Sim/Não/...", "complemento":"data DD/MM/AAAA ou valor R$ ou vazio"}, ... } cobrindo as linhas 10 a 38 (a 25 é bloco fixo e fica de fora)',

  // M1 + riscos (vão no .md, não na planilha)
  m1_sintese: 'Síntese do processo em UM parágrafo corrido, começando com "Trata-se", no máximo 10 linhas, SEM tópicos/bullets. ' +
    'Deve citar: (a) tipo da ação e natureza do crédito; (b) autor (cedente) e réu (ente devedor); (c) pedido e causa de pedir; ' +
    '(d) principais eventos processuais COM DATAS (sentença, recurso, trânsito em julgado, início do cumprimento de sentença, ' +
    'manifestação da contadoria, decisão que determinou a expedição); (e) tipo de requisitório (RPV/minuta/alvará); (f) fase atual do processo.',
  bloco_g_riscos: 'lista de riscos {risco, fundamento, grau:"Impeditivo|Elevado|Moderado|Ponto de atenção"}',
};

// ---- PORTÃO 1: QUALIFICAÇÃO (roda ANTES da análise) ----
const SCHEMA_QUALIFICACAO = {
  numero_processo: 'número no padrão CNJ ou "NÃO LOCALIZADO"',
  numero_credito_anexo: 'número do precatório/crédito anexo, ou null',
  titular_nome: 'nome completo do titular do crédito',
  cpf: 'CPF do titular',
  esfera: 'Federal | Estadual | Municipal',
  ente_devedor: 'qual Estado/Município/Órgão (ex.: "Estado de Goiás", "Estado do Paraná", "Município de Campinas", "União")',
  entidade_devedora: 'nome completo da entidade devedora',
  valor_credito: 'valor total atualizado do crédito como número (ex.: 124500.00), ou "NÃO LOCALIZADO"',
  data_planilha_calculo: 'DD/MM/AAAA da planilha MAIS ATUALIZADA (maior data / última homologada), ou "NÃO LOCALIZADO"',
  requisitorio_expedido: 'SIM | NÃO — o ofício requisitório (RPV/precatório) já foi expedido?',
  tipo_requisitorio: 'RPV | Precatório | null (se ainda não expedido, só há cálculo homologado)',
  oficio_localizacao: 'ID e páginas do ofício requisitório, ou null',
  planilha_localizacao: 'ID, data e páginas da planilha mais atualizada, ou null',
  honorarios_destacados: 'SIM | NÃO',
  honorarios_detalhe: 'se SIM: tipo (contratuais/sucumbenciais) e valor de cada; senão null',
  parcela_preferencial: 'PAGA | NÃO PAGA | NÃO HÁ MENÇÃO',
  credor_menor_ou_curatelado: 'SIM - Menor | SIM - Curatelado | NÃO HÁ INDICAÇÃO | INFORMAÇÃO INCERTA (não confundir com o advogado)',
  transito_conhecimento_data: 'DD/MM/AAAA do trânsito em julgado da FASE DE CONHECIMENTO (mérito), ou "NÃO LOCALIZADO"',
  transito_conhecimento_localizacao: 'ID/página, ou null',
  prazo_pagamento_vencido: 'SIM | NÃO | NÃO HÁ MENÇÃO — há decisão informando que o prazo de pagamento (60 dias) já venceu?',
  reserva_financeira: 'SIM | NÃO | NÃO HÁ MENÇÃO — há decisão informando reserva/sequestro/depósito de verba para o pagamento?',
  reserva_localizacao: 'ID/página, ou null',
  prazo_pagamento_iniciado: 'SIM | NÃO | NÃO HÁ MENÇÃO — a FASE DE PAGAMENTO já começou? Ex.: RPV expedida seguida de certidão/movimentação de "início do prazo de 60 dias para pagamento", certidão do setor de precatórios/RPVs do tribunal, ou intimação do ente público para pagar. (Diferente de "vencido": aqui o prazo apenas COMEÇOU, ainda não passou.)',
  prazo_pagamento_iniciado_localizacao: 'ID/página/data da movimentação, ou null',
  evidencias_referencias: 'breve indicação de onde cada informação aparece no processo',
  comentarios_analise: 'observações úteis para a análise (sem recomendação de investimento)',
};

/**
 * O system das DUAS chamadas — e é curto de propósito.
 *
 * Ele precisa ser IDÊNTICO nas duas para o cache de prompt casar (ver
 * extrairComFerramenta): o prefixo cacheado é ferramentas + system + material, e
 * qualquer diferença aqui derruba o reaproveitamento dos ~170 mil tokens do
 * processo na segunda chamada. O que é específico de cada tarefa desceu para o
 * fim do turno do usuário, depois do documento.
 */
const SYSTEM_BASE =
  'Você é analista jurídico-financeiro da Credijuris, trabalhando sobre processos judiciais de créditos RPV e precatórios de qualquer tribunal do país. ' +
  'Duas regras valem para tudo o que você faz aqui, e elas vêm antes de qualquer instrução específica: ' +
  '(1) SEJA CONSERVADOR — dado que não estiver claro no documento devolve null ou "NÃO LOCALIZADO", nunca uma suposição; NUNCA invente datas, valores ou nomes. ' +
  '(2) DIGA DE ONDE VEIO — para cada dado, indique a localização nesta ordem: numeração impressa ("fls.", "Pág. X de Y"), ID do documento, ou a passagem. ' +
  'O material do processo vem primeiro; a tarefa exata vem no fim da mensagem, junto com a ferramenta a chamar.';

const SYSTEM_QUALIFICACAO =
  'Você é um analista jurídico especializado em precatórios e RPVs, fazendo a QUALIFICAÇÃO (pré-análise) de um crédito para a Credijuris. ' +
  'A fonte é um processo judicial completo. Analise-o página por página com rigor e seja conservador: quando um dado não estiver claro, use "NÃO LOCALIZADO" (NUNCA invente datas, valores ou nomes). ' +
  'REGRA DE LOCALIZAÇÃO: indique onde cada dado está nesta ordem de prioridade: (1) numeração impressa ("fls.", "Pág. X de Y", numeração do PJe); (2) ID do documento (ex.: ID 295ff54); (3) a passagem. Informe o intervalo de páginas quando possível. ' +
  'REGRAS: datas em DD/MM/AAAA; valores como número puro (ex.: 124500.00); uma linha por credor (se houver mais de um, use o principal e cite os demais em comentarios_analise); baseie-se somente no documento enviado. ' +
  'DEFINIÇÕES IMPORTANTES: ' +
  '(a) "trânsito em julgado da FASE DE CONHECIMENTO" é a data em que a decisão de MÉRITO se tornou definitiva — NÃO confunda com o trânsito da fase de execução/cumprimento de sentença; ' +
  '(b) "prazo de pagamento (60 dias) vencido" e "reserva financeira": procure decisão/despacho informando que o prazo de pagamento já passou e/ou que já existe reserva, sequestro ou depósito de verba destinada ao pagamento; ' +
  '(b2) "prazo de pagamento iniciado": marque SIM se a FASE DE PAGAMENTO já começou — RPV expedida seguida de certidão/movimentação de "início do prazo de 60 dias para pagamento", certidão do setor de precatórios/RPVs do tribunal, ou intimação do ente para pagar — mesmo que o prazo ainda NÃO tenha vencido; se marcar SIM, informe a data/ID em prazo_pagamento_iniciado_localizacao; ' +
  '(c) "requisitório expedido": SIM se já foi expedido o ofício de RPV ou de precatório; se só há cálculo homologado nos autos, é NÃO (e tipo_requisitorio = null); ' +
  '(d) "credor menor/curatelado": indique se o TITULAR do crédito é menor de idade ou curatelado/interditado; NÃO confunda com o advogado.';

const SYSTEM_ANALISE =
  'Você é analista jurídico-financeiro da Credijuris especializado em créditos RPV de qualquer tribunal do país — estaduais, federais e trabalhistas. NÃO presuma as regras, os órgãos nem os prazos do TJGO para os demais tribunais. ' +
  'Trabalha com a metodologia Prompt Mestre v1.0 (módulos M1–M4). Seja preciso e conservador: ' +
  'quando um dado não estiver claro no documento, devolva null (NUNCA invente datas, valores ou nomes). ' +
  'Regra do INSS, VÁLIDA SÓ QUANDO O ENTE DEVEDOR É O ESTADO DE GOIÁS: se o crédito é de horas extras e a contadoria zerou o INSS, calcule uma reserva preventiva ' +
  'de 14,25% (alíquota previdenciária do servidor goiano) sobre o valor sem correção e devolva esse valor em "inss". ' +
  'Para QUALQUER OUTRO ente devedor, NÃO aplique reserva nenhuma: devolva o INSS exatamente como a contadoria calculou (0 se zerado) — a alíquota varia por ente e quem decide a reserva é a equipe. ' +
  'Os tempos do M4 são médias de pares de datas reais do andamento processual. ' +
  '=== AUDITORIA DOS CÁLCULOS === ' +
  'ANTES de dar o crédito por bom, AUDITE a conta. Cálculo homologado NÃO é cálculo definitivo: erro material e critério contrário a título executivo ou a lei se revisam mesmo depois do trânsito, e quem compra o crédito é quem perde se a revisão vier. A auditoria não existe para achar defeito — existe para que o preço embuta o risco que ela achar. ' +
  'O QUE CONFERIR, nesta ordem: ' +
  '(1) FIDELIDADE AO TÍTULO. Compare a conta com o que a sentença ou o acórdão mandaram: período de apuração, verbas deferidas (nem uma a mais, nem uma a menos), base de cálculo, percentuais, termo inicial de juros e de correção. Divergência aqui é a mais grave, porque a conta não pode inovar sobre o título. ' +
  '(2) OS ÍNDICES, pela natureza do crédito e pela data. Os marcos que valem para condenações da FAZENDA PÚBLICA (União, estados, DF e municípios): ' +
  '• ATÉ 08/12/2021, condenação NÃO TRIBUTÁRIA: correção pelo IPCA-E e juros pela remuneração da caderneta de poupança (STF, Tema 810, RE 870.947; STJ, Tema 905). A TR foi declarada inconstitucional como índice de correção — conta que ainda a use tem vício conhecido. ' +
  '• A PARTIR DE 09/12/2021: SELIC ÚNICA, cobrindo correção e juros ao mesmo tempo (EC 113/2021, art. 3º). Aplicação PROSPECTIVA sobre o valor já consolidado até 08/12/2021 — não se aplica SELIC retroativa ao período anterior, e não se soma SELIC a juros de mora do mesmo período, o que seria bis in idem. ' +
  '• CONDENAÇÃO TRIBUTÁRIA (repetição de indébito): SELIC desde o recolhimento indevido, sem cumulação com outro índice. ' +
  '• TRABALHISTA contra a Fazenda: o regime tem particularidades próprias e mudou com a ADC 58 do STF — se for o caso, diga qual índice a conta usou e sinalize a controvérsia em vez de afirmar o correto. ' +
  'SE A CONTA APLICOU SELIC A TODO O PERÍODO, incluindo o anterior a 09/12/2021, isso é divergência de gravidade MÉDIA: a leitura prospectiva é a predominante, mas há decisões em sentido contrário — e o que interessa é que uma revisão nesse ponto derruba o valor. ' +
  '(3) A ARITMÉTICA. Confira se as parcelas somam o total, se não há duplicidade entre verbas, e se o período de apuração não excede o que o título deferiu. ' +
'DE QUEM É O RISCO: DE QUEM COMPRA. Este é o ponto em que o raciocínio se inverte, e errar aqui esvazia a auditoria inteira. Quem lê esta análise NÃO é o credor — é o investidor que vai PAGAR pelo crédito hoje e receber do ente depois. Então: ' +
  'CONTA INFLADA É O PERIGO. Se a conta cobra MAIS do que o título mandava, o crédito está inchado, a Fazenda pode impugnar e a revisão DERRUBA o valor — e quem pagou pelo valor inchado perde a diferença. É a divergência mais grave que existe aqui, mesmo que ela "favoreça o credor". ' +
  'CONTA SUBESTIMADA É INDIFERENTE ao preço. Se a conta cobra MENOS do que era devido, o risco de revisão é para cima, o que só faria o cessionário receber mais do que pagou. Isso não entra no preço: registre como observação e siga. ' +
  'NÃO RACIOCINE ASSIM: "a conta aplicou índice mais generoso, isso favorece o credor, logo não há risco". Favorecer o credor é exatamente o que faz a Fazenda impugnar, e é exatamente o que se perde na revisão. Um exemplo real: correção de dano moral contada desde o evento danoso em vez de desde o arbitramento (Súmula 362/STJ) infla o crédito em todo o período intermediário — isso é gravidade ALTA e pede cenário conservador, não "baixa". ' +
  'O CENÁRIO CONSERVADOR É O QUE VALE. Havendo divergência cujo CONSERTO reduziria o crédito, estime o bruto revisado em "auditoria_bruto_conservador" — é ele que vai precificar. Auditoria NUNCA AUMENTA crédito. Se não der para estimar o valor revisado com o que há nos autos, devolva null e descreva o risco — preço com risco descrito é melhor que preço com risco embutido em número inventado. ' +
  '=== DE ONDE SAEM OS VALORES === ' +
  'O MESMO crédito aparece nos autos com vários valores diferentes, e escolher o errado não produz erro nenhum — produz um preço errado, com a mesma cara de um preço certo. Antes de preencher qualquer número, decida QUAL DOCUMENTO MANDA. ' +
  'ORDEM DE AUTORIDADE, use o primeiro que existir: ' +
  '(1) o REQUISITÓRIO EXPEDIDO (RPV ou ofício requisitório) — se já saiu, o valor requisitado é o que o ente vai pagar, e acabou a discussão; ' +
  '(2) o CÁLCULO HOMOLOGADO por decisão judicial — o valor homologado, não o que a parte pediu; ' +
  '(3) a CONTA DA CONTADORIA judicial, quando as partes foram intimadas e o prazo correu sem impugnação, ou a impugnação foi rejeitada; ' +
  '(4) o valor apresentado pelo EXECUTADO em execução invertida, quando o exequente concordou ou não impugnou no prazo; ' +
  '(5) o valor apresentado pelo EXEQUENTE, quando não houve impugnação e o prazo passou. ' +
  'Se NENHUM desses existir, devolva null nos valores. Não monte a conta você mesmo, não some parcelas soltas e não use o valor da petição inicial. ' +
  'OS ENGANOS MAIS COMUNS, que valem por lista de conferência: ' +
  '(a) o VALOR DA CAUSA e o valor da condenação na sentença — são de antes da atualização e quase nunca é o que se paga; ' +
  '(b) o principal HISTÓRICO, quando a conta separa "principal" de "atualizado" — o bruto é o atualizado; ' +
  '(c) o valor de OUTRO CREDOR: conta de ação coletiva traz dezenas de nomes, e a soma da tabela inteira não é o crédito. Use SÓ a linha do cedente identificado no card, e registre em comentarios_analise que havia outros; ' +
  '(d) a SOMA de vários requisitórios quando só um está sendo cedido; ' +
  '(e) o valor JÁ LÍQUIDO apresentado como se fosse o total; ' +
  '(f) valores de DATAS DIFERENTES somados entre si — se a conta é de março e há atualização de agosto, use UMA delas inteira e diga qual. ' +
  'CONFIRA ANTES DE DEVOLVER: bruto_total menos ir menos inss menos honorarios tem de dar principal_liquido. Se não fechar, você leu algum número errado ou misturou documentos — reveja. Se ainda assim não fechar, devolva o que leu e explique a divergência em comentarios_analise, em vez de forçar um número para a conta bater. ' +
  'E DIGA DE ONDE VEIO, em "origem_valores": documento, ID ou página, e a data de atualização. ' +
  '=== MAPA EXATO DO M2 (objeto "m2"; a chave é o NÚMERO DA LINHA na aba jurídica) === ' +
  'Para cada linha, "resposta" vai na coluna B e "complemento" (quando o item pedir) vai na coluna D. ' +
  'Use SEMPRE os valores EXATOS das listas suspensas quando indicado — a coluna B só aceita esses valores. ' +
  'Datas em DD/MM/AAAA. Valores monetários SEMPRE em Real no padrão brasileiro: VÍRGULA como separador decimal e PONTO como separador de milhar, com prefixo R$ (ex.: R$ 1.234,56). NUNCA use ponto como separador decimal. Se a resposta for "Não", deixe o complemento vazio. ' +
  'Se o dado não estiver claro, deixe vazio (NUNCA escreva "não encontrado"/"verificar" no complemento). ' +
  '10: "Histórico do cedente: tem dívida?" -> Sim/Não; complemento: se Sim, números dos processos. ' +
  '11: "Histórico do advogado: tem dívida?" -> Sim/Não; complemento: se Sim, números dos processos. ' +
  'SOBRE A 10 E A 11: elas perguntam por dívidas DE FORA deste processo, e você só tem os autos da cessão — responda "Sim" apenas com o que estiver NELES ' +
  '(penhora no rosto dos autos, ofício de outro juízo, execução noticiada aqui), e "Não" quando os autos nada disserem. Não deduza da profissão, do valor ou do perfil de ninguém. ' +
  'Quando vier no material um bloco "DUE DILIGENCE DE PROCESSOS DOS SUJEITOS", essas duas linhas passam a ser escritas pelo sistema a partir dele, e o que você puser aqui é somado ao que foi apurado — nunca substituído. ' +
  '12: "Qual é o tipo da ação?" -> TEXTO livre (ex.: "ação de cobrança de horas extras de piso de magistério"); sem complemento. ' +
  '13: "Quem é o polo ativo?" -> TEXTO (nome); sem complemento. ' +
  '14: "O polo ativo é maior de idade?" -> Sim/Não. ' +
  '15: "O polo ativo possui prioridade legal (60+/doença grave/PCD)?" -> Sim/Não; complemento: qual(is). ' +
  '16: "Possui curatela ou tutela?" -> Sim/Não; complemento: nome do curador/tutor. ' +
  '17: "Quem está sendo processado?" -> TEXTO (o ente devedor); sem complemento. ' +
  '18: "Houve sentença?" -> Sim/Não; complemento: data. ' +
  '19: "Tipo da sentença" -> um EXATO de: Improcedência | Procedência | Procedência parcial | Homologatória de acordo. ' +
  '20: "A sentença é líquida ou ilíquida?" -> um EXATO de: Líquida | Iliquída; complemento: se Líquida, o valor. ' +
  '21: "Houve recurso?" -> Sim/Não; complemento: resultado e data do julgamento. ' +
  '22: "Houve trânsito em julgado?" -> Sim/Não; complemento: data. ' +
  '23: "Iniciou o cumprimento de sentença?" -> Sim/Não; complemento: data do peticionamento. ' +
  '24: "Foi apresentado valor no CS ou solicitado execução invertida?" -> um EXATO de: Valor apresentado no CS | Execução invertida. ' +
  '25: BLOCO FIXO "CUIDADO" — NÃO é pergunta. NÃO inclua a chave "25" no m2. ' +
  '26 E 27 SÃO EXCLUSIVAS: responda UMA e deixe a outra vazia. Execução invertida (linha 24) -> preencha a 26 e deixe a 27 vazia; cumprimento de sentença iniciado pela exequente -> preencha a 27 e deixe a 26 vazia. Em qualquer dos dois casos siga normalmente da 28 em diante. ' +
  '(O bloco CUIDADO da linha 25 diz o mesmo, mas cita os itens 27/28/29 — a numeração dele ficou defasada de uma linha quando o questionário mudou. Vale o que está escrito aqui.) ' +
  '26: "Em caso de execução invertida, qual cenário?" (só se foi execução invertida; senão vazio) -> um EXATO de: ' +
  '"Executado não apresentou valores e prazo ainda em curso" | "Executado não apresentou valores — prazo decorrido — sem manifestação da parte exequente" | ' +
  '"Executado não apresentou valores — prazo decorrido — já houve manifestação da parte exequente" | "Executado apresentou valores". ' +
  '27: "Em CS ordinário, a parte apresentou valor?" -> Sim/Não; complemento: valor total. ' +
  '28: "Houve impugnação ao valor?" -> Sim/Não; NÃO preencha complemento aqui (a data vai na linha 29). ' +
  '29: datas da impugnação -> resposta: se houve, a data da impugnação; complemento: se NÃO houve, a data do decurso do prazo. ' +
  '30: "Data da manifestação de concordância" -> resposta: a data (se houve concordância); sem complemento. ' +
  '31: "Houve homologação do valor (e impugnação resolvida)?" -> Sim/Não; complemento: data da homologação. ' +
  '32: "Existe contrato de honorários contratuais nos autos?" -> Sim/Não; complemento: data do contrato. ' +
  '33: "Contadoria judicial se manifestou?" -> Sim/Não; complemento: data da juntada dos cálculos. ' +
  '34: "Houve pedido de destaque de honorários contratuais nos valores apresentados pela contadoria? E, se a contadoria não se manifestou, houve pedido de reserva pelo patrono?" -> Sim/Não; complemento: o PERCENTUAL dos honorários contratuais (ex.: "30%") — é o que a coluna do modelo pede, não o valor em reais. ' +
  '35: "A manifestação da contadoria foi homologada/precluiu o prazo?" -> Sim/Não; complemento: data. ' +
  '36: "Há honorários sucumbenciais neste processo?" -> Sim/Não; complemento: o PERCENTUAL dos honorários sucumbenciais (ex.: "10%") — é o que a coluna do modelo pede, não o valor em reais. Responda em COERÊNCIA com o campo "honorarios_sucumbenciais": se lá você pôs um valor, aqui é Sim; se pôs zero, aqui é Não. ' +
  '37: "RPV foi mandada para expedição?" -> Sim/Não; complemento: data da decisão. ' +
  '38: "Houve expedição de documento?" -> um EXATO de: Minuta de RPV | RPV | Alvará de pagamento | Sem expedição; complemento: data do documento. ' +
  'NÃO EXISTEM as linhas 39 e 40 no m2: são o valor final e as observações, e quem as preenche sou eu, com o cálculo pronto. ' +
  '=== REGRA 13 — O ROTEIRO ATÉ A LIQUIDAÇÃO (campo "roteiro_prazo") === ' +
  'É daqui que sai o prazo de resgate, e o prazo manda no preço: superestimar joga o preço para baixo e perde o negócio; subestimar compra um crédito que rende menos do que parece. Não chute um número redondo — MONTE O CAMINHO. ' +
  'PASSO 1: diga em "etapa_atual" onde o processo está HOJE, lendo o último andamento real. ' +
  'PASSO 2: liste, em ordem, SÓ OS ATOS QUE AINDA FALTAM daquele ponto até o dinheiro na conta do credor. Ato já praticado não entra. Um item por ato. ' +
  'PASSO 3: para cada ato, estime os dias corridos e diga em "base" de onde tirou o número, nesta ordem de preferência: ' +
  '(a) A VELOCIDADE MEDIDA NESTE PROCESSO — você já calculou serventia_dias e gabinete_dias a partir de pares de datas reais do andamento. Ato de cartório/serventia (juntada, intimação, expedição, remessa) usa serventia_dias; ato de decisão do juiz (despacho, homologação, deferimento) usa gabinete_dias. É a melhor evidência que existe: mede ESTE juízo, não uma média nacional. ' +
  '(b) PRAZO LEGAL, quando o ato tem um — cite o artigo. Ex.: impugnação/manifestação da Fazenda em 30 dias úteis (CPC 535); pagamento da RPV em 60 dias da requisição (Lei 10.259/2001 art. 17 no federal; CPC 535 §3º, II nos estaduais e municipais). Prazo em dias ÚTEIS: converta para corridos multiplicando por 1,4. ' +
  '(c) PRÁTICA DO TRIBUNAL, quando você conhece a peculiaridade daquele tribunal ou daquela espécie de processo, e diga qual é. ' +
  'PASSO 4 — OS ATOS DA CESSÃO, QUE NÃO PODEM FALTAR. O crédito está sendo comprado agora, então o caminho inclui o que a própria cessão exige, e isso acontece DEPOIS da aquisição: (i) protocolo da petição de habilitação do cessionário com o contrato de cessão; (ii) intimação da Fazenda executada para se manifestar sobre a cessão (contraditório — some o prazo dela); (iii) decisão que homologa a cessão e defere a substituição/sub-rogação no polo ativo; (iv) anotação da substituição e, onde o tribunal exigir, retificação ou reexpedição do requisitório em nome do cessionário. Se o requisitório JÁ foi expedido em nome do cedente, a retificação costuma ser o passo mais lento e às vezes recoloca o crédito na fila — considere isso. Se pela prática do tribunal algum desses atos não existe ou é dispensado, não invente: omita e explique em "base" do ato seguinte. ' +
  'PASSO 5: se algum ato depende de evento incerto (ordem cronológica de pagamento, dotação orçamentária, fila do ente), inclua o ato com a estimativa e diga a incerteza em "base". ' +
  'NÃO SOME NADA: devolva os atos e os dias de cada um. Quem soma sou eu.';

/**
 * O esquema de descrições vira uma ferramenta.
 *
 * As propriedades vão SEM `type` de propósito: os campos do esquema são de tudo
 * — número, booleano, texto, lista, objeto indexado por linha — e a descrição já
 * diz qual é. Declarar um tipo errado seria pior que não declarar nenhum: o
 * modelo obedeceria ao tipo e devolveria "0" onde a resposta é null.
 */
function ferramentaDoEsquema(nome: string, descricao: string, esquema: Record<string, string>) {
  const properties: Record<string, { description: string }> = {};
  for (const [k, v] of Object.entries(esquema)) properties[k] = { description: v };
  return { name: nome, description: descricao, input_schema: { type: 'object' as const, properties } };
}

const FERRAMENTA_ANALISE = ferramentaDoEsquema(
  'registrar_analise', 'Registra a análise completa do crédito RPV.', SCHEMA_ANALISE,
);
const FERRAMENTA_QUALIFICACAO = ferramentaDoEsquema(
  'registrar_qualificacao', 'Registra a qualificação (pré-análise) do crédito.', SCHEMA_QUALIFICACAO,
);

/**
 * Uma extração, pedida por FERRAMENTA em vez de "devolva APENAS este JSON".
 *
 * O QUE ISTO CONSERTA. O formato antigo era texto livre: a resposta vinha com
 * cerca de markdown, às vezes com um parágrafo antes, e — o caso caro — cortada
 * ao bater `max_tokens`. Cortada, o JSON.parse falhava, o regex de recuperação
 * também, e a função lançava DEPOIS de ter lido o processo inteiro. As duas
 * chamadas de IA iam para o lixo e o operador via "JSON INCOMPLETO".
 *
 * Três defesas, nesta ordem:
 *   1. FERRAMENTA. O modelo devolve um bloco tool_use — sem cerca, sem preâmbulo.
 *   2. `stop_reason` CONFERIDO. Cortou por tamanho, tenta de novo com teto maior
 *      em vez de morrer. É uma chamada a mais, contra perder duas.
 *   3. TEXTO LIVRE COMO REDE. Se o modelo responder em prosa mesmo assim, o
 *      caminho antigo ainda lê — nada do que funcionava deixou de funcionar.
 *
 * SEM `temperature`. Ela estava aqui — extração não é redação, e duas leituras
 * do mesmo processo deveriam dar os mesmos números —, mas o Opus 5 NÃO ACEITA
 * MAIS o parâmetro: a API responde 400 "`temperature` is deprecated for this
 * model" e a análise morre no portão de qualificação, antes de ler qualquer
 * coisa. Foi o que aconteceu na primeira análise depois da subida: eu pus o
 * `temperature: 0` e troquei o modelo para Opus 5 na mesma leva, e as duas
 * mudanças se anularam em produção.
 *
 * A reprodutibilidade que ela buscava não se resolve por parâmetro neste modelo.
 * O que segura os números aqui é outra coisa, e já existe: o esquema descreve
 * campo a campo o que se espera, a conferência de soma (bruto − IR − INSS −
 * honorários = líquido) acusa leitura misturada, e a auditoria compara a conta
 * com o título. Se a variação entre leituras virar problema real, o caminho é
 * medir duas passadas do mesmo processo e apertar o esquema — não voltar o
 * parâmetro.
 */
async function extrairComFerramenta(
  apiKey: string,
  o: {
    rotulo: string;
    /** As instruções DA TAREFA. Vão depois do processo, fora do cache. */
    instrucoes: string;
    ferramenta: ReturnType<typeof ferramentaDoEsquema>;
    conteudo: any[];
    maxTokens: number;
    /** Teto da segunda tentativa, quando a primeira cortar. 0 = não tenta. */
    maxTokensRetentativa?: number;
  },
): Promise<any> {
  // O PROCESSO É LIDO DUAS VEZES — QUALIFICAÇÃO E ANÁLISE — E ERA COBRADO DUAS.
  //
  // As duas chamadas mandam exatamente o mesmo material: o texto dos autos, as
  // páginas em imagem e as anotações do card. Isso são até 170 mil tokens de
  // entrada, pagos e reprocessados na íntegra na segunda chamada, que só começa
  // a responder depois de o servidor ter lido tudo de novo.
  //
  // O cache de prompt resolve — mas ele casa por PREFIXO EXATO, na ordem
  // ferramentas → system → mensagens. Por isso três coisas mudaram de lugar:
  //
  //   1. AS DUAS FERRAMENTAS VÃO NAS DUAS CHAMADAS. Ferramenta diferente é
  //      prefixo diferente, e prefixo diferente não casa. Os nomes são
  //      distantes (registrar_qualificacao / registrar_analise) e a instrução
  //      final diz qual chamar.
  //   2. O SYSTEM É UM SÓ, curto e comum. As instruções específicas de cada
  //      tarefa desceram para o fim do turno do usuário — que é onde a
  //      documentação da Anthropic recomenda pôr instrução quando o documento é
  //      longo, porque ela fica em posição de recência.
  //   3. A MARCA DO CACHE fica no ÚLTIMO bloco compartilhado. Tudo até ali é
  //      reaproveitado; o que vem depois (a instrução da tarefa) é barato.
  const conteudo = o.conteudo.map((b, i) =>
    i === o.conteudo.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b,
  );

  const pedir = async (maxTokens: number) => {
    const res = await fetchComRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: SYSTEM_BASE,
        tools: [FERRAMENTA_QUALIFICACAO, FERRAMENTA_ANALISE],
        // 'auto', e não forçado: forçar a ferramenta tira do modelo a chance de
        // raciocinar em texto antes de responder, e a auditoria dos cálculos
        // depende disso. A instrução no fim do turno já basta na prática.
        messages: [{
          role: 'user',
          content: [
            ...conteudo,
            { type: 'text', text: `${o.instrucoes}\n\n=== O QUE FAZER AGORA ===\nFaça o trabalho descrito acima e registre o resultado chamando a ferramenta ${o.ferramenta.name} UMA única vez. Não use a outra ferramenta e não escreva o JSON no texto da resposta.` },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API (${o.rotulo}) ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return await res.json();
  };

  let data = await pedir(o.maxTokens);
  const retentativa = o.maxTokensRetentativa ?? 0;
  if (data?.stop_reason === 'max_tokens' && retentativa > o.maxTokens) {
    data = await pedir(retentativa);
  }

  const uso = data.content?.find((c: { type: string; name?: string }) => c.type === 'tool_use' && c.name === o.ferramenta.name);
  if (uso?.input && typeof uso.input === 'object') return uso.input;

  // Rede: o caminho antigo, para o modelo que responder em prosa.
  const texto = (data.content ?? [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text?: string }) => String(c.text ?? '')).join('\n').trim();
  const raw = texto.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  if (raw) {
    try { return JSON.parse(raw); } catch { /* tenta o recorte */ }
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* incompleto */ } }
  }
  throw new Error(
    data?.stop_reason === 'max_tokens'
      ? `A leitura (${o.rotulo}) foi CORTADA por tamanho mesmo na segunda tentativa. O processo pode estar grande demais para uma passada só — tente reduzir os anexos do card.`
      : `A IA não registrou o resultado da ${o.rotulo}.${raw ? ` Ela disse: "${raw.slice(0, 200)}"` : ''}`,
  );
}

const extrairAnalise = (apiKey: string, contentBlocks: any[]) =>
  extrairComFerramenta(apiKey, {
    rotulo: 'análise', instrucoes: SYSTEM_ANALISE, ferramenta: FERRAMENTA_ANALISE,
    conteudo: contentBlocks, maxTokens: CLAUDE_MAX_TOKENS, maxTokensRetentativa: 26000,
  });

// ---- PORTÃO 1: chamada de IA + decisão ----
const extrairQualificacao = (apiKey: string, contentBlocks: any[]) =>
  extrairComFerramenta(apiKey, {
    rotulo: 'qualificação', instrucoes: SYSTEM_QUALIFICACAO, ferramenta: FERRAMENTA_QUALIFICACAO,
    conteudo: contentBlocks, maxTokens: 4000, maxTokensRetentativa: 8000,
  });

// ============================================================================
// REFINAMENTO — o chat da análise
// ============================================================================
//
// O usuário vê a análise preliminar e pede mudanças em linguagem natural
// ("o valor bruto está errado, é 84.320,10", "suprima o risco 3", "considere
// que a RPV já foi expedida em 12/03"). A IA aplica o pedido sobre o JSON da
// análise e devolve o JSON inteiro revisado; a precificação é RECALCULADA em
// código a partir dele — a IA nunca escreve deságio nem prazo.
//
// O TEXTO DO PROCESSO VAI NO SYSTEM, COM CACHE. Cada turno do chat precisa dos
// autos para poder responder "confira X" sem inventar, e mandá-los de novo a
// cada pergunta custaria o processo inteiro por mensagem. Como bloco de system
// com cache_control, o segundo turno em diante lê do cache.
/**
 * Os campos que o chat de revisão pode mexer, e quais deles são listas.
 *
 * Derivados do próprio SCHEMA_ANALISE: campo que não está no formato é
 * RECUSADO pelo patch e aparece na resposta como não aplicado. Antes qualquer
 * nome entrava — "valor_bruto" em vez de "bruto_total" era gravado, ignorado
 * pelo resto do motor, e o chat respondia que estava feito.
 *
 * Os campos internos (com "_" na frente) ficam de fora de propósito: são
 * decisões do motor, não dados da análise.
 */
const CAMPOS_EDITAVEIS: ReadonlySet<string> = new Set(Object.keys(SCHEMA_ANALISE));
const CAMPOS_LISTA: ReadonlySet<string> = new Set([
  'roteiro_prazo', 'bloco_g_riscos', 'm4_pares', 'auditoria_divergencias',
]);

const FERRAMENTA_REVISAO = {
  name: 'revisar_analise',
  description: 'Devolve a análise revisada conforme o pedido do usuário, e um resumo curto do que mudou.',
  input_schema: {
    type: 'object' as const,
    properties: {
      // SÓ O QUE MUDOU. Devolver a análise inteira fazia o modelo gerar milhares
      // de tokens a cada pedido — lento, caro, e com risco de perder campo no
      // caminho. O merge é feito aqui no servidor.
      alteracoes: {
        type: 'object',
        description: 'APENAS os campos que mudam, no mesmo formato do JSON recebido. Não repita o que fica igual. Para mexer numa linha do questionário, mande só {"m2": {"37": {...}}}.',
      },
      remover: {
        type: 'array',
        items: { type: 'string' },
        description: 'Caminhos a APAGAR, quando o pedido é suprimir algo: "m2.37" para uma linha do questionário, "riscos.2" para o terceiro risco (índice base zero). Vazio quando não há o que remover.',
      },
      prazo_meses_manual: {
        type: ['number', 'string', 'null'],
        description: 'Só quando o usuário DITAR o prazo até o pagamento ("o prazo é 10 meses"). O motor passa a usar este número em vez do calculado. Para VOLTAR ao prazo calculado ("tira o prazo manual", "usa o prazo do roteiro"), mande "auto". Null em qualquer outro caso — NUNCA preencha por conta própria.',
      },
      // OS PARÂMETROS DO NEGÓCIO, que antes eram fixos no código. Sem eles, um
      // pedido comercial legítimo ("fecha a 30%", "essa operação é sem
      // diligência") só se atendia mexendo em dado de entrada até a calibragem
      // cair perto — adivinhação com passos extras.
      parametros: {
        type: 'object',
        description:
          'Os parâmetros do negócio, só quando o usuário os DITAR. Preencha apenas o que ele pediu; o resto fica de fora. ' +
          '{"desagio": fração (0.30 para 30%) quando ele disser onde quer fechar — o motor para de procurar e usa este número, e a resposta diz a rentabilidade que sobrou; ' +
          '"alvo_mensal": fração, quando ele mudar a meta de rentabilidade (padrão 0.028); ' +
          '"comissao_pct": fração, quando a comissão for diferente dos 9% (4% originação + 5% intermediação); ' +
          '"diligencia": reais, quando o custo de correspondente for outro, ou 0 quando não houver}. ' +
          'Para DESFAZER um parâmetro ditado antes ("volta o deságio ao automático", "deixa a comissão padrão"), mande a chave com valor null.',
      },
      verbas: {
        type: 'object',
        description:
          'O que está sendo comprado, só quando o usuário MUDAR isso ("tira os sucumbenciais", "passa a ser só o principal"). ' +
          '{"principal": bool, "contratuais": bool, "sucumbenciais": bool}. Omita quando o pedido não for sobre isso. ' +
          'Para voltar ao que o card diz, mande null.',
      },
      resposta: { type: 'string', description: 'Para o usuário: o que você mudou e por quê, em até 6 linhas. Se não pôde atender, diga o que faltou. Sem preâmbulo.' },
    },
    required: ['alteracoes', 'resposta'],
  },
};

const SISTEMA_REVISAO =
  'Você é analista jurídico-financeiro da Credijuris e está REVISANDO uma análise de RPV a pedido de quem a conferiu. Recebe a análise atual (JSON), o histórico da conversa e um pedido. ' +
  'VOCÊ NÃO TEM OS AUTOS EM MÃOS — só a análise já extraída deles. Isso é de propósito: reenviar o processo inteiro a cada pedido fazia a revisão estourar o tempo da requisição. ' +
  'REGRAS: (1) devolva em "alteracoes" SÓ os campos que mudam; o que fica igual não se repete. (2) Quem afirma o dado é o usuário: ele está com o processo aberto. Aplique o que ele disser. Se o valor contrariar o que está no JSON, aplique mesmo assim e registre a troca em "resposta" ("bruto de X para Y, conforme você indicou"). (3) Se o pedido depende de um dado que NÃO está no JSON e o usuário não informou, peça o número em "resposta" e não altere nada — você não tem como consultar os autos. (4) Preço de cessão e rentabilidade você NÃO escreve: saem calculados dos seus campos. O DESÁGIO agora você pode ditar — mas só em "parametros", e só quando o usuário pedir um número (ver regra 9). Prazo ditado vai em "prazo_meses_manual". (4b) O CUSTO DE CARTÓRIO também não é seu, e não precisa ser pedido: escritura e registro são consultados na tabela do estado a partir do preço da cessão, e a tela REFAZ essa consulta sozinha sempre que o preço muda. Se pedirem para reajustar o cartório, responda que ele se recalcula automaticamente com o novo preço e não peça número nenhum — pedir o valor ao usuário é trabalho que a máquina já faz. Só peça se ele disser que a consulta automática falhou. (5) Mantenha o formato: números como número, datas DD/MM/AAAA, m2 indexado pela linha. (6) Para SUPRIMIR, use "remover" com o caminho ("m2.37", "riscos.2") — não mande o campo vazio em "alteracoes". ' +
  '(7) LISTAS se editam POR ÍNDICE, e não reenviando a lista inteira: para mudar o segundo ato do roteiro mande {"roteiro_prazo": {"1": {"dias": 90}}}; para acrescentar um, {"roteiro_prazo": {"+": {"ato": "...", "dias": 21}}}. Mandar a lista inteira SUBSTITUI o que havia — só faça isso quando for essa a intenção. Vale para roteiro_prazo, bloco_g_riscos, auditoria_divergencias e m4_pares. ' +
  '(8) USE O NOME EXATO DO CAMPO. Nome que não existe no formato é RECUSADO e aparece na resposta como não aplicado — não há como inventar um campo novo e esperar efeito. Na dúvida, olhe as chaves do JSON que você recebeu. ' +
  '(9) OS PARÂMETROS DO NEGÓCIO são seus, quando o usuário os ditar: deságio ("fecha a 30%"), meta de rentabilidade, comissão e diligência vão em "parametros"; o que está sendo comprado vai em "verbas". Isto substitui a regra antiga de recusar mexer no deságio: agora dá, desde que o usuário DITE. O que você continua NÃO fazendo é escolher esses números sozinho — sem pedido explícito, deixe fora. Para DESFAZER um parâmetro ditado numa rodada anterior, mande a chave com null (ou "auto" no prazo): o motor volta a calcular. ' +
  '(10) O SERVIDOR CONFERE o que você mandou e devolve ao usuário a lista do que mudou de fato. Prometer na "resposta" uma alteração que você não pôs em "alteracoes" aparece como divergência. Descreva o que fez, não o que pretendia. ' +
  'Responda chamando a ferramenta revisar_analise uma única vez.';


async function refinarDados(
  apiKey: string,
  dadosAtuais: any,
  instrucao: string,
  historico: Array<{ papel: 'usuario' | 'ia'; texto: string }>,
  notasKommo: string,
): Promise<{ dados: any; resposta: string }> {
  const anthropic = new Anthropic({ apiKey });
  const mensagens: Anthropic.MessageParam[] = [];
  for (const h of historico.slice(-12)) {
    mensagens.push({ role: h.papel === 'usuario' ? 'user' : 'assistant', content: h.texto || '…' });
  }
  // A API exige alternância e começo em 'user'; um histórico que comece pela IA
  // ganha um marcador de abertura.
  if (mensagens.length && mensagens[0].role !== 'user') mensagens.unshift({ role: 'user', content: '(início da revisão)' });
  // AS ANOTAÇÕES VÃO JUNTO NA REVISÃO, e não só na leitura inicial.
  //
  // A revisão não tem os autos — isso é de propósito, reenviar o processo a cada
  // pedido estourava o tempo da requisição. Mas as anotações são pequenas perto
  // do processo e são justamente onde está o combinado do negócio. Sem elas, um
  // pedido como "confira a parcela cedida na anotação" só podia ser respondido
  // com "não tenho essa informação", quando ela estava a um bloco de distância.
  const notas = notasKommo.trim() ? `\n\nANOTAÇÕES DO CARD NO KOMMO (do comercial):\n${capNotas(notasKommo)}` : '';
  mensagens.push({
    role: 'user',
    content: `ANÁLISE ATUAL (JSON):\n${JSON.stringify(dadosAtuais)}${notas}\n\nPEDIDO:\n${instrucao}`,
  });
  // max_tokens curto de propósito: a saída agora é um patch de poucos campos, e
  // um teto alto só dá margem para a resposta demorar.
  const resp = await anthropic.messages
    .stream({
      // A MESMA constante das extrações, e não um literal solto. Foi assim que
      // o motor de RPV ficou uma geração atrás sem ninguém ver: a revisão subiu
      // para o Opus 5 escrevendo o nome aqui, e a leitura que PRECIFICA ficou no
      // 4.5 lá em cima. Um nome só, um lugar só.
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: [{ type: 'text', text: SISTEMA_REVISAO, cache_control: { type: 'ephemeral' } }],
      tools: [FERRAMENTA_REVISAO],
      messages: mensagens,
    })
    .finalMessage();
  const uso = resp.content.find((c) => c.type === 'tool_use' && c.name === FERRAMENTA_REVISAO.name);
  if (!uso || uso.type !== 'tool_use') {
    const txt = resp.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join(' ').trim();
    throw new Error('A IA não devolveu a análise revisada.' + (txt ? ` Ela disse: "${txt.slice(0, 300)}"` : ''));
  }
  const entrada = uso.input as {
    alteracoes?: unknown; remover?: unknown; prazo_meses_manual?: unknown;
    parametros?: unknown; verbas?: unknown; resposta?: unknown;
  };
  const alteracoes = (entrada.alteracoes && typeof entrada.alteracoes === 'object' ? entrada.alteracoes : {}) as Record<string, unknown>;
  const remover = Array.isArray(entrada.remover) ? (entrada.remover as unknown[]).map(String) : [];
  const r = aplicarPatch(dadosAtuais, alteracoes, remover, CAMPOS_EDITAVEIS, CAMPOS_LISTA);

  // AS LINHAS DO QUESTIONÁRIO QUE O CHAT MANDOU ESCREVER ficam marcadas, e a
  // marca ACUMULA entre rodadas — quem corrigiu a linha 10 na terceira mensagem
  // não deveria vê-la revertida na quarta. Serve às linhas 10 e 11, que a due
  // diligence escreve depois: nelas, ordem explícita de quem confere manda na
  // resposta, e a diligência passa a aparecer na coluna D em vez de sobrepor em
  // silêncio (ver aplicarDiligenciaNoM2).
  {
    const antes = Array.isArray(dadosAtuais?._m2_do_chat) ? dadosAtuais._m2_do_chat.map(String) : [];
    r.dados._m2_do_chat = [...new Set([...antes, ...r.m2Tocadas])];
  }

  // OS PARÂMETROS DO NEGÓCIO viajam com a análise, não à parte: assim
  // sobrevivem à rodada seguinte do chat e ao salvamento, que dão a volta pelo
  // navegador. A leitura mora em _shared/revisao.ts, testada: null volta ao
  // automático, fora de faixa é ignorado e dito. Ver lá por que isto importa —
  // estes campos eram gravados e NUNCA lidos pelo motor.
  const pm = aplicarParametrosManuais(r.dados, {
    parametros: entrada.parametros,
    verbas: entrada.verbas,
    prazo_meses_manual: entrada.prazo_meses_manual,
  });
  r.dados = pm.dados;
  r.mudancas.push(...pm.mudancas);

  // O RELATÓRIO VAI JUNTO DA RESPOSTA, e é do servidor, não da IA. Prometer uma
  // alteração e não fazê-la era invisível: os dois textos vinham da mesma fonte.
  const partes = [String(entrada.resposta ?? '').trim() || 'Pedido processado.'];
  if (r.mudancas.length) partes.push('Aplicado: ' + r.mudancas.join('; ') + '.');
  else partes.push('⚠️ NADA foi alterado na análise por este pedido.');
  if (r.desconhecidos.length)
    partes.push(`⚠️ Campo(s) que não existem no formato e por isso NÃO foram aplicados: ${r.desconhecidos.join(', ')}.`);
  if (r.remocoesVazias.length)
    partes.push(`⚠️ Não achei o que remover em: ${r.remocoesVazias.join(', ')}.`);
  for (const a of pm.avisos) partes.push(`⚠️ ${a}.`);

  return { dados: r.dados, resposta: partes.join('\n') };
}

// "DD/MM/AAAA" -> Date (ou null se inválido)
function parseDataBR(s: any): Date | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}
const ehSim = (v: any) => typeof v === 'string' && v.trim().toUpperCase().startsWith('SIM');

/**
 * O ente devedor é o Estado de Goiás?
 *
 * Existe porque duas regras deste motor são ESTADUAIS de Goiás e estavam sendo
 * aplicadas a todo ente: o teto de 10 salários mínimos para RPV com trânsito da
 * fase de conhecimento posterior a 15/11/2025, e a reserva de INSS de 14,25%
 * (alíquota da GOIASPREV). Aplicadas a São Paulo ou à União, reprovavam crédito
 * bom ou descontavam contribuição por lei que não vale lá.
 *
 * Casa "Estado de Goiás" e "Fazenda Pública do Estado de Goiás", sem acento e
 * sem caixa. NÃO casa município goiano de propósito: a lei é do Estado, e cada
 * município legisla o próprio teto.
 */
// E AS AUTARQUIAS E FUNDAÇÕES ESTADUAIS GOIANAS — GOIASPREV, IPASGO, DETRAN-GO,
// AGR, Agehab, Agrodefesa, Goinfra, UEG, PGE-GO. Elas eram o furo: são as
// devedoras mais comuns em RPV de servidor goiano e escapavam do teto de 10
// salários mínimos, da reserva de INSS e do prazo do convênio, porque o nome
// não traz "Estado de Goiás". A lei estadual alcança o Estado, suas autarquias
// e fundações; a regra aqui alcança o mesmo. Município continua fora — "Município
// de Goiânia" e "Prefeitura de Anápolis" não entram mesmo com "Goiás" por perto.
function ehEstadoDeGoias(...candidatos: unknown[]): boolean {
  return candidatos.some((c) => {
    const t = String(c ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/municip|prefeitura|camara\s+municipal/.test(t)) return false;
    return (
      /estado\s+d[eo]\s+goias/.test(t) ||
      /fazenda\s+(publica\s+)?(d[eo]\s+estado\s+d[eo]\s+)?goias/.test(t) ||
      /goiasprev|goias\s+previd/.test(t) ||
      /\bipasgo\b/.test(t) ||
      /detran[\s\-\/]*go\b|departamento\s+estadual\s+de\s+transito\s+de\s+goias/.test(t) ||
      /\bagr\b.*goi|agencia\s+goiana/.test(t) ||
      /\bagehab\b|agrodefesa|\bgoinfra\b/.test(t) ||
      /\bueg\b|universidade\s+estadual\s+de\s+goias/.test(t) ||
      /procuradoria[\s-]*geral\s+d[eo]\s+estado\s+d[eo]\s+goias|\bpge[\s\-\/]*go\b/.test(t)
    );
  });
}

// Aplica a ÁRVORE DE DECISÃO do Portão 1 sobre o JSON da IA.
// Retorna aprovado + motivos de recusa (se houver) + avisos (não reprovam).
function avaliarQualificacao(q: any): { aprovado: boolean; motivos: string[]; avisos: string[] } {
  const motivos: string[] = [];
  const avisos: string[] = [];

  // 1) Dinheiro já reservado / prazo de pagamento vencido -> REPROVA
  if (ehSim(q.reserva_financeira) || ehSim(q.prazo_pagamento_vencido))
    motivos.push('Já há decisão de reserva financeira ou o prazo de pagamento (60 dias) já venceu — o valor já está designado para a conta do credor, então não é possível adquirir o crédito.');

  // 1b) Prazo de pagamento apenas INICIADO (RPV em fase de pagamento) -> ALERTA FORTE (revisão humana), NÃO reprova
  else if (ehSim(q.prazo_pagamento_iniciado))
    avisos.unshift('⚠️ ATENÇÃO — RPV JÁ EM FASE DE PAGAMENTO: a movimentação indica que o prazo de 60 dias para o ente público pagar JÁ COMEÇOU' +
      (q.prazo_pagamento_iniciado_localizacao ? ` (${q.prazo_pagamento_iniciado_localizacao})` : '') +
      '. RISCO: o pagamento pode ocorrer ANTES de a cessão ser habilitada nos autos — se isso acontecer, o valor cai na conta do credor original e não na de vocês. AVALIE COM A EQUIPE JURÍDICA se há tempo hábil para habilitar a cessão antes do pagamento ANTES de fechar este crédito.');

  // 2) Credor menor de idade ou curatelado
  if (ehSim(q.credor_menor_ou_curatelado))
    motivos.push('Credor menor de idade ou curatelado — a cessão exige autorização judicial (alvará).');

  // 3) Valor / tipo do crédito
  // parseNumeroFlex, e não Number(). A IA às vezes devolve "R$ 124.500,00" onde
  // o esquema pede número puro, e `Number()` disso é NaN: o portão concluía
  // "valor não identificado", PULAVA a verificação de piso e deixava passar com
  // um aviso brando. Ausência de dado saindo como aprovação — a mesma classe de
  // defeito que já se corrigiu nos campos da análise, e que tinha sobrevivido
  // aqui, justamente no lugar que decide se o crédito entra.
  const valor = typeof q.valor_credito === 'number'
    ? q.valor_credito
    : (parseNumeroFlex(String(q.valor_credito ?? '').replace(/[^\d.,\-]/g, '')) ?? NaN);
  const temValor = !isNaN(valor) && valor > 0;
  const tipo = String(q.tipo_requisitorio || '').toLowerCase();
  const isPrecatorio = tipo.includes('precat');
  const isRPV = tipo === 'rpv' || tipo.includes('rpv');
  const expedido = ehSim(q.requisitorio_expedido);
  if (temValor) {
    if (isPrecatorio) {
      if (valor <= 100000) motivos.push('Valor do precatório igual ou abaixo de R$ 100 mil (mínimo exigido para precatório).');
    } else {
      // RPV, ou ainda não expedido (só cálculo homologado) -> piso de R$ 20 mil.
      //
      // ESTE É O PORTÃO BARATO, e ele olha o BRUTO. A régua de verdade é o valor
      // TOTAL LÍQUIDO NEGOCIADO (a linha 39 da planilha), que só existe depois da
      // extração e da calibragem — ver PISO_NEGOCIO lá adiante. Reprovar aqui é
      // seguro por construção: o líquido nunca é maior que o bruto, então bruto
      // abaixo do piso já garante líquido abaixo do piso, e poupa a leitura
      // completa de um crédito que não serve.
      if (valor < PISO_NEGOCIO) motivos.push(
        `O crédito inteiro, ainda BRUTO, é de ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} — abaixo do mínimo de R$ 20 mil. ` +
        'Líquido será menos ainda, então não há o que negociar nem somando todas as verbas.',
      );
    }
  } else {
    avisos.push('Valor do crédito não identificado no processo — confira o valor manualmente.');
  }

  // 3b) ESTADO DE GOIÁS, E SÓ ELE: RPV já expedida com trânsito da fase de conhecimento
  // posterior a 15/11/2025 derruba o teto para 10 SM. É lei estadual goiana. Antes
  // valia para todo ente — e reprovava crédito paulista ou federal por regra que
  // não existe lá.
  if (expedido && isRPV && ehEstadoDeGoias(q.ente_devedor, q.entidade_devedora)) {
    const d = parseDataBR(q.transito_conhecimento_data);
    const corte = new Date(2025, 10, 15); // 15/11/2025 (mês 10 = novembro)
    if (d) {
      if (d.getTime() > corte.getTime())
        motivos.push('Estado de Goiás: trânsito em julgado da fase de conhecimento posterior a 15/11/2025 — o teto da RPV goiana cai para 10 salários mínimos, ficando abaixo de ~R$ 20 mil.');
    } else {
      avisos.push('Estado de Goiás: data do trânsito da fase de conhecimento não localizada — confira manualmente se é posterior a 15/11/2025 (teto de 10 SM).');
    }
  }

  return { aprovado: motivos.length === 0, motivos, avisos };
}

// Arquivo -> blocos de conteúdo p/ a IA.
// PDF: extrai TEXTO (sem limite de páginas). Imagem: envia como imagem. Texto: inline.
// OS TETOS DE TAMANHO MORAM EM _shared/orcamentoLeitura.ts, e não aqui.
//
// Eram três números soltos que ninguém somava: 420 mil caracteres de processo
// deste lado, 360 mil do lado do navegador (o que valia), 40 mil de anotações, e
// até 60 imagens. Somados, ~294 mil tokens numa janela de 200 mil — o pedido
// voltava HTTP 400 depois de minutos de renderização. Agora há UM orçamento, e
// ele é conjunto: ver planoDeLeitura.
const MAX_DOC_CHARS = MAX_TEXTO_CHARS;
const MARCA_CORTE = 'TRECHO INTERMEDIÁRIO OMITIDO POR TAMANHO';

// Corta textos muito grandes mantendo INÍCIO e FINAL.
//
// REDE DE SEGURANÇA, não a regra: quem escolhe o que vai é o navegador, página
// a página (src/lib/textoDoProcesso.ts), e o texto chega aqui já dentro do
// teto. Este corte só pega quem chamar a função por fora. Por isso a divisão é
// 30/70 e não 50/50: o começo é petição inicial e documento pessoal, e o que
// precifica — conta da contadoria, homologação, requisitório — está no fim.
function capTextoDoc(txt: string): string {
  if (txt.length <= MAX_DOC_CHARS) return txt;
  const head = Math.floor(MAX_DOC_CHARS * 0.3);
  const tail = MAX_DOC_CHARS - head;
  return txt.slice(0, head) +
    `\n\n[...${MARCA_CORTE} — documento muito grande; exibindo apenas o início e o final...]\n\n` +
    txt.slice(txt.length - tail);
}

function montarTextoPdf(filename: string, totalPages: number, txt: string): string {
  const cortado = capTextoDoc(txt);
  const parcial = cortado.length !== txt.length ? ', TEXTO PARCIAL' : '';
  return `[Documento: ${filename} — ${totalPages} páginas${parcial}]\n\n${cortado}`;
}

async function arquivoToContentBlocks(filename: string, bytes: Uint8Array): Promise<any[]> {
  const lower = filename.toLowerCase();
  const imgType =
    lower.endsWith('.png') ? 'image/png' :
    (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ? 'image/jpeg' :
    lower.endsWith('.webp') ? 'image/webp' :
    lower.endsWith('.gif') ? 'image/gif' : '';
  if (imgType) {
    return [
      { type: 'text', text: `[Documento (imagem): ${filename}]` },
      { type: 'image', source: { type: 'base64', media_type: imgType, data: b64encode(bytes) } },
    ];
  }
  if (lower.endsWith('.pdf')) {
    const { extractText } = await import('npm:unpdf@1.6.2');  // import preguiçoso: só carrega se receber PDF cru
    const { text, totalPages } = await extractText(bytes, { mergePages: true });
    const txt = (text || '').trim();
    if (!txt) {
      return [{ type: 'text', text: `[Documento: ${filename}] (PDF de ${totalPages} páginas SEM texto extraível — provavelmente escaneado/imagem; não foi possível ler o conteúdo. Envie um PDF com texto selecionável.)` }];
    }
    return [{ type: 'text', text: montarTextoPdf(filename, totalPages, txt) }];
  }
  if (lower.endsWith('.txt') || lower.endsWith('.csv') || lower.endsWith('.md')) {
    const bruto = new TextDecoder().decode(bytes).trim();
    const cortado = capTextoDoc(bruto);
    const parcial = cortado.length !== bruto.length ? ' — TEXTO PARCIAL (documento muito grande)' : '';
    return [{ type: 'text', text: `[Documento: ${filename}${parcial}]\n\n${cortado}` }];
  }
  return [{ type: 'text', text: `[Documento: ${filename}] (formato não suportado para leitura automática — por favor, envie o processo em PDF com texto.)` }];
}

// ============================================================================
// Datas
// ============================================================================
function hojeDDMMAAAA(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
// hoje + o prazo, em dias — a MESMA grandeza que a fórmula do preço usa.
//
// Era "último dia do mês, meses arredondados para baixo": 8,4 meses viravam o
// fim do 8º mês. A planilha (J5) e a tela mostravam uma data que não era a do
// cálculo, e quem conferia via o prazo de um jeito e a data de outro.
function dataPagamento(meses: number): string {
  const alvo = new Date(Date.now() + Math.round(Math.max(0, meses) * 30) * 86400000);
  return `${String(alvo.getDate()).padStart(2, '0')}/${String(alvo.getMonth() + 1).padStart(2, '0')}/${alvo.getFullYear()}`;
}

// ============================================================================
// Handler
// ============================================================================


/* ===== Teto da RPV do ente devedor. Alerta, NÃO impeditivo. ===== */
//
// A TABELA SAIU DO CÓDIGO E FOI PARA O BANCO (migração 0057, _shared/tetosRpv.ts).
// Eram 27 estados e suas capitais escritos numa constante, mais um salário
// mínimo ao lado, e dois defeitos que vinham juntos:
//
//   1. Mudam todo janeiro e o código não muda junto. O motor sabia e avisava
//      "TABELA DEFASADA" em TODA análise depois da virada — aviso que ninguém
//      pode resolver na hora, repetido até alguém editar e fazer deploy. Aviso
//      sem ação vira ruído, e ruído se ignora junto com os que importam.
//   2. O que faltava, faltava em silêncio. UF fora do mapa devolvia null, e null
//      era lido como "está dentro do teto". Ausência de dado saía como aprovação.
//
// Agora a tabela é cache com pesquisa: falta a linha, a IA procura a norma em
// segundo plano e a próxima análise daquele estado já sai conferida. Esta
// análise não espera — ela DIZ que o teto ainda não foi verificado.
const _brlTeto = (n: number): string =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Compara o bruto com o teto do ente e devolve o aviso — ou null se está dentro.
 *
 * `esfera` vem de classificarEnte, fonte única do motor. `uf` é a do crédito
 * (resolverUf), que tem precedência sobre a sigla do tribunal: TRT e TRF não
 * carregam estado nenhum, e a condenação de um estado ou município nessas
 * justiças segue o teto do ENTE devedor.
 */
function avisoDeTeto(
  teto: TetoConsultado, esfera: EsferaTeto, uf: string | null, bruto: number, municipio: string | null,
): string | null {
  // O QUE O RÓTULO DIZ É DE QUEM É O TETO, e num município isso não é detalhe:
  // cada um fixa o seu (CF, art. 100, §4º), e o número que herdamos é o da
  // CAPITAL. Chamar o teto de Goiânia de "municipal (GO)" ao analisar um crédito
  // contra Anápolis afirma como apurado o que é palpite informado.
  const ondeMunicipal = municipio ? `municipal — ${municipio}/${uf ?? '?'}` : `municipal (${uf ?? '?'})`;
  const onde = esfera === 'federal' ? 'federal'
    : esfera === 'municipal' ? ondeMunicipal
    : `estadual (${uf ?? '?'})`;

  if (teto.estado === 'pesquisando') {
    return `⚠️ TETO DA RPV NÃO CONFERIDO: estou levantando o teto ${onde} de ${teto.ano} na fonte oficial — ` +
      'é a primeira análise deste ente neste ano. Confira o teto à mão antes de fechar; ' +
      'a próxima análise deste ente já sai com ele.';
  }
  if (teto.estado === 'sem_uf') {
    return '⚠️ TETO DA RPV NÃO CONFERIDO: não identifiquei a UF do crédito, e o teto é fixado por lei de cada ente. Confira à mão.';
  }
  if (teto.estado === 'falhou') {
    return `⚠️ TETO DA RPV NÃO CONFERIDO (${onde}): ${teto.motivo ?? 'não consegui achar a norma'}. ` +
      'Confira o teto à mão antes de fechar — sem ele não dá para dizer se cabe renúncia.';
  }
  if (teto.valor == null) {
    return `⚠️ TETO DA RPV NÃO APLICÁVEL (${onde}): ${teto.motivo ?? 'a pesquisa não achou teto próprio para este ente'}. Confira à mão.`;
  }
  // REFERÊNCIA DA CAPITAL: o número não é do município do crédito.
  //
  // Ele serve de régua enquanto a pesquisa do município corre, e é melhor que
  // campo vazio — mas dizer "excede o teto" ou "está dentro" com base nele seria
  // afirmar o que não se apurou. Então o aviso sai NOS DOIS SENTIDOS: acima da
  // referência ou abaixo dela, o texto é o mesmo pedido de conferência, mudando
  // só o que a comparação sugere.
  if (teto.escopo === 'capital') {
    const capital = _brlTeto(teto.valor);
    const acima = bruto > teto.valor;
    return `⚠️ TETO MUNICIPAL NÃO CONFERIDO — ${municipio ?? 'município'}/${uf ?? '?'}: cada município fixa o próprio teto de RPV ` +
      '(CF, art. 100, §4º; sem lei local, vale o piso de 30 salários mínimos do ADCT, art. 87). ' +
      `O que tenho é a referência da CAPITAL de ${uf ?? '?'} (${capital}), e o bruto é ${_brlTeto(bruto)} — ` +
      (acima
        ? 'por essa régua HAVERIA excedente e renúncia. '
        : 'por essa régua caberia sem renúncia. ') +
      `Estou levantando o teto de ${municipio ?? 'do município'} na fonte oficial; confira à mão antes de fechar.`;
  }

  if (!bruto || bruto <= 0 || bruto <= teto.valor) return null;

  const fonte = [teto.vigencia, teto.fonte].filter(Boolean).join(' — ');
  return `⚠️ ATENÇÃO — TETO DA RPV: o valor bruto (${_brlTeto(bruto)}) EXCEDE o teto da RPV ${onde} de ${teto.ano} (${_brlTeto(teto.valor)}` +
    `${fonte ? `, ${fonte}` : ''}). Isso NÃO impede a operação, mas será necessária a RENÚNCIA ao valor que excede o teto para receber como RPV — o operacional deve avaliar.` +
    (teto.origem === 'semente' ? ' (Valor herdado do mapa antigo: a migração 0057 ainda não rodou, então ele não foi conferido este ano.)' : '');
}

/**
 * O PISO DE R$ 20 MIL, decisão do dono.
 *
 * ONDE ELE INCIDE MUDOU, e a mudança é o conserto. Ele era aplicado no portão de
 * qualificação, sobre `valor_credito` — o valor BRUTO total que a IA leu dos
 * autos, antes de IR, INSS e honorários, e sem relação com o que está sendo
 * comprado. Errava dos dois lados: uma cessão só de honorários de R$ 15 mil
 * passava porque o crédito inteiro tinha R$ 100 mil, e um crédito bruto de
 * R$ 25 mil que líquido dá R$ 17 mil também passava.
 *
 * Agora incide sobre o VALOR TOTAL LÍQUIDO NEGOCIADO — a linha 39 da aba
 * jurídica, que é o Y3 da calibragem: a soma dos líquidos das verbas que entram
 * no negócio. É o número que a planilha imprime como resposta à pergunta "qual o
 * valor total final líquido do(s) crédito(s) sendo negociado(s)?".
 *
 * O portão continua reprovando cedo quando o BRUTO já está abaixo do piso —
 * isso é seguro por construção, porque o líquido nunca é maior que o bruto, e
 * poupa a leitura completa de um crédito que não serve.
 */
const PISO_NEGOCIO = 20000;

/**
 * A due diligence de processos judiciais deste crédito, quando existe.
 *
 * Alimenta as linhas 10 e 11 da aba jurídica ("Histórico do cedente / do
 * advogado: tem dívida?"), que até aqui eram respondidas pela IA lendo o
 * processo DA CESSÃO — o único documento que ela tem, e o único que não fala
 * das outras dívidas de ninguém. Ver _shared/dueDiligencia.ts.
 *
 * NÃO DERRUBA A ANÁLISE, EM HIPÓTESE NENHUMA. A tabela pode nem existir (a
 * migration 0056 é recente e roda à mão, no editor do Supabase), e a tela de
 * onde a apuração vai sair ainda está por fazer. Falta de diligência é o estado
 * NORMAL hoje: quando a consulta não responde, a análise segue como sempre
 * seguiu, e só uma falha INESPERADA vira aviso — tabela ausente, não.
 */
async function lerDiligencia(
  sb: ReturnType<typeof serviceClient>,
  leadId: number | null,
): Promise<{ hs: HistoricoDePapel[]; falha: string | null }> {
  if (!leadId) return { hs: [], falha: null };
  const semTabela = (m: string) =>
    /does not exist|schema cache|PGRST205|relation .* does not exist/i.test(m);
  try {
    const { data: apuracoes, error: e1 } = await sb
      .from('dd_historico')
      .select('id, papel, nome, documento, oab, status, fonte, apurado_em, observacao')
      .eq('kommo_lead_id', leadId);
    if (e1) throw new Error(e1.message);
    const lista = (apuracoes ?? []) as ApuracaoDD[];
    if (lista.length === 0) return { hs: [], falha: null };

    const { data: processos, error: e2 } = await sb
      .from('dd_processo')
      .select(
        'historico_id, numero_processo, tribunal, objeto, polo, ha_cobranca, valor_cobrado, estagio, risco, risco_motivo',
      )
      .eq('kommo_lead_id', leadId);
    if (e2) throw new Error(e2.message);

    return { hs: historicoDoCredito(lista, (processos ?? []) as ProcessoDD[]), falha: null };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return { hs: [], falha: semTabela(msg) ? null : msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  /**
   * As páginas subidas para esta leitura, para apagar SE ALGO DER ERRADO.
   *
   * A limpeza existia em três pontos, todos DEPOIS de a IA ter respondido. Se a
   * leitura lançasse — tempo esgotado, 400 da API, JSON cortado —, as imagens
   * ficavam no bucket para sempre: não há lifecycle em `analises-input`, e
   * ninguém mais sabe a que job elas pertenciam. Fechar a janela no meio dava no
   * mesmo. Declarado FORA do try porque é no catch que ele precisa existir.
   */
  let limparUploads: (() => Promise<void>) | null = null;

  try {
    let body: any;
    try { body = await req.json(); } catch { return errorResponse('Corpo da requisição inválido/incompleto (o texto do processo pode ter chegado cortado).', 400); }

    // 0. UMA ETAPA DO LEVANTAMENTO DE EMOLUMENTOS.
    //
    // Vem da PRÓPRIA função, numa invocação nova — é assim que o relógio de
    // tempo de parede zera entre as etapas (ver executarPasso). Não há usuário
    // por trás, então esta ação é atendida antes da autenticação de usuário,
    // com uma checagem própria: só passa quem traz a service_role ou o segredo
    // de cron, e nenhum dos dois chega ao navegador.
    if (body.acao === 'emolumentos_passo') {
      const cronSecret = Deno.env.get('CRON_SECRET');
      const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const interna =
        (!!cronSecret && req.headers.get('x-cron-secret') === cronSecret) ||
        (!!svcKey && req.headers.get('Authorization') === `Bearer ${svcKey}`);
      if (!interna) return errorResponse(ERRO_ACESSO, 401);
      const sb = serviceClient();
      const r = await executarPasso(body.uf, (await chaveAnthropic()) ?? '', sb);
      return jsonResponse({ ok: true, ...r });
    }

    // 0b. A PESQUISA DO TETO DA RPV de um ente, em invocação própria.
    //
    // Mesmo desenho da etapa de emolumentos acima, e pelo mesmo motivo: a busca
    // web leva dezenas de segundos e não pode rodar dentro da análise que a
    // pessoa espera. Uma invocação nova zera o relógio de parede. Sem usuário
    // por trás, então a mesma checagem própria — service_role ou segredo de cron.
    if (body.acao === 'teto_passo') {
      const cronSecret = Deno.env.get('CRON_SECRET');
      const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const interna =
        (!!cronSecret && req.headers.get('x-cron-secret') === cronSecret) ||
        (!!svcKey && req.headers.get('Authorization') === `Bearer ${svcKey}`);
      if (!interna) return errorResponse(ERRO_ACESSO, 401);
      const r = await executarPesquisaTeto(
        String(body.uf ?? ''),
        String(body.esfera ?? ''),
        Number(body.ano) || new Date().getFullYear(),
        (await chaveAnthropic()) ?? '',
        serviceClient(),
        String(body.municipio ?? ''),
      );
      return jsonResponse({ ok: r.ok, motivo: r.motivo ?? null });
    }

    // 1. Auth (JWT do usuário)
    const user = await getCallerAtivo(req, serviceClient());
    if (!user) return errorResponse(ERRO_ACESSO, 401);
    const userId = user.id;
    const categoria: string = resolverCategoria(body.categoria);  // "RPV" -> "Requisições de Pequeno Valor"

    // service-role: lê secrets de configuracoes
    const sbAdmin = serviceClient();
    // 2a. A CONSULTA DO LEVANTAMENTO DE EMOLUMENTOS.
    //
    // SEPARADA DA ANÁLISE de propósito, por dois motivos que se somam.
    // Primeiro, rodá-la dentro da mesma requisição que faz duas extrações de IA
    // sobre um processo inteiro derrubava o worker (HTTP 546): cada requisição
    // faz uma coisa pesada, não três. Segundo, e maior: o levantamento é uma
    // PESQUISA — achar o provimento do estado e ler o PDF anexo leva minutos.
    //
    // Por isso esta ação NÃO ESPERA A PESQUISA. Ela responde na hora com o
    // estado ('pronta' | 'levantando' | 'falhou' | 'sem_uf') e, quando é o caso,
    // dispara a etapa que falta. O navegador volta a perguntar a cada oito
    // segundos, e cada pergunta é só uma leitura de linha.
    //
    // VEM ANTES DO BLOCO DE SEGREDOS de propósito: numa pergunta que se repete
    // a cada oito segundos, ler o segredo do Google e a chave da Anthropic são
    // duas idas ao banco que não servem para nada aqui — a chave é usada pelas
    // ETAPAS do levantamento (ação 'emolumentos_passo'), não pela consulta.
    if (body.acao === 'emolumentos') {
      const r = await consultarRegra(body.uf, sbAdmin);
      return jsonResponse({ ok: true, ...r });
    }

    const _google = await segredoGoogle();
    const cfg: Record<string, string> = {
      anthropic_api_key: (await chaveAnthropic()) ?? '',
      google_oauth_client_id: _google?.client_id ?? '',
      google_oauth_client_secret: _google?.client_secret ?? '',
      google_oauth_refresh_token: _google?.refresh_token ?? '',
    };


    if (body.acao === 'listar_originadores' || body.acao === 'listar_intermediadores') {
      const token = await refreshGoogleAccessToken(cfg.google_oauth_client_id, cfg.google_oauth_client_secret, cfg.google_oauth_refresh_token);
      const originadores = await driveListarOriginadoresAnalise(token, categoria);
      return jsonResponse({ ok: true, originadores });
    }

    // 3. Job principal
    //
    // AÇÕES. Sem `acao` é o fluxo antigo, inteiro num clique (mantido para não
    // quebrar chamada externa). Com `acao`, o fluxo é o do chat:
    //   'analisar'  lê, qualifica, extrai e precifica — devolve a PRELIMINAR,
    //               sem planilha, sem Drive, sem anotação no Kommo
    //   'refinar'   aplica um pedido do usuário sobre a análise e reprecifica
    //   'reprecificar' refaz as contas com a tabela de emolumentos que chegou
    //               depois, SEM chamar a IA — custa milissegundos
    //   'salvar'    recebe a análise final, gera a planilha e sobe no Drive
    const acao: 'analisar' | 'refinar' | 'reprecificar' | 'salvar' | null =
      body.acao === 'analisar' || body.acao === 'refinar' || body.acao === 'reprecificar' || body.acao === 'salvar'
        ? body.acao
        : null;
    const notasKommo: string = String(body.notas_kommo ?? '').trim();
    /**
     * O card. Chega em TODAS as ações (vai no `corpoCard` do navegador) porque a
     * due diligence é lida em todas: a apuração costuma ser feita DEPOIS da
     * primeira análise, e é no 'salvar' — que gera a planilha — que ela precisa
     * estar nas linhas 10 e 11. Opcional: chamada antiga, sem lead_id, apenas
     * não tem diligência.
     */
    const leadId: number | null = Number.isFinite(Number(body.lead_id)) && Number(body.lead_id) > 0
      ? Number(body.lead_id)
      : null;
    const jobId: string = body.job_id;
    const originador: string = body.originador ?? body.intermediador;
    const numeroProcesso: string = (body.numero_processo || '').trim();
    const tipoAquisicao: string = (body.tipo_aquisicao || 'auto');
    // 'auto' | 'principal' | 'ambos' | 'honorarios' (contratuais E sucumbenciais)
    // | 'contratuais' | 'sucumbenciais' | 'indefinido'
    //
    // 'indefinido' — o card diz "honorários" e não diz quais — é resolvido LÁ
    // NA FRENTE, contra os autos, e não aqui. Aqui a análise ainda não leu
    // nada, e a pergunta quase sempre tem resposta no processo: ver o ramo
    // 'indefinido' no bloco das verbas.
    const honPctRaw = (body.honorarios_pct === '' || body.honorarios_pct == null) ? null : Number(body.honorarios_pct);
    const honorariosPct = (honPctRaw != null && !isNaN(honPctRaw) && honPctRaw >= 0) ? honPctRaw : null;
    if (!originador) return errorResponse('Campo obrigatório: originador');
    for (const k of ['anthropic_api_key', 'google_oauth_client_id', 'google_oauth_client_secret', 'google_oauth_refresh_token'])
      if (!cfg[k]) return errorResponse(`Secret '${k}' não configurado (Anthropic/Google — ver integracao_*_secret)`, 500);

    // A DUE DILIGENCE DE PROCESSOS DOS SUJEITOS, se já houver.
    const diligencia = await lerDiligencia(sbAdmin, leadId);

    // 3a. Fonte do texto do processo:
    //   (A) texto já extraído no NAVEGADOR (pdf.js) e enviado no corpo -> caminho leve, sem estourar CPU;
    //   (B) fallback: lê o(s) arquivo(s) do storage analises-input/{userId}/{jobId}/processo/* (fluxo antigo).
    let contentBlocks: any[] = [];
    let arquivos: Array<{ name: string }> = [];
    let prefix = '';
    /** Quantas páginas digitalizadas foram à IA como imagem. */
    let paginasImagem = 0;
    /** Quantas ficaram de fora por não caberem na janela do modelo. */
    let cortouImagens = 0;
    const textoDireto = String(body.texto ?? body.texto_processo ?? '').trim();
    // SÓ QUEM LÊ O PROCESSO PRECISA DELE. 'refinar', 'reprecificar' e 'salvar'
    // trabalham sobre a análise que já veio pronta do navegador — exigir o texto
    // aqui era o HTTP 400 "Faltou o texto do processo": eu tirei o reenvio do
    // texto (que estourava o tempo da requisição) e esqueci esta guarda.
    const precisaDoProcesso = acao === 'analisar' || acao === null;
    if (!precisaDoProcesso) {
      // Nada a ler. O corte de conteúdo foi registrado na análise original e
      // viaja dentro de `dados`, então o aviso não se perde nas rodadas seguintes.
    } else {
      if (!textoDireto && !jobId) return errorResponse('Faltou o texto do processo (ou o job_id).');
      if (textoDireto) contentBlocks.push({ type: 'text', text: `[Documento do processo]\n\n${textoDireto}` });

      // TEXTO E IMAGEM JUNTOS, e não um OU outro. Era "ou": texto do navegador
      // OU arquivos do Storage. Processo digitalizado, que não tem texto, era
      // recusado na porta; e a conta da contadoria escaneada dentro de um
      // processo digital simplesmente não era lida — a IA concluía "não há
      // conta". Agora o navegador renderiza as páginas sem texto (pdf.js) e as
      // sobe em {userId}/{jobId}/processo/; elas entram aqui como imagem, ao
      // lado do texto das outras páginas. A IA lê tabela numérica em imagem
      // muito melhor que um OCR local, e é a tabela que decide o preço.
      if (jobId) {
        prefix = `${userId}/${jobId}/processo`;
        const { data: arqs, error: listErr } = await sbAdmin.storage.from(BUCKET_INPUT).list(prefix, { limit: 200 });
        if (listErr) throw new Error('Erro listando uploads: ' + listErr.message);
        if (!arqs?.length && !textoDireto) return errorResponse('Nenhum arquivo encontrado para esse job. Faça o upload do processo antes de gerar.');
        arquivos = (arqs ?? []).filter((a: { name?: string }) => !!a.name && !a.name.startsWith('.'));
        // A partir daqui há o que limpar, aconteça o que acontecer.
        limparUploads = async () => {
          if (!arquivos.length) return;
          try { await sbAdmin.storage.from(BUCKET_INPUT).remove(arquivos.map((a) => `${prefix}/${a.name}`)); } catch (_) { /* ok */ }
          arquivos = [];
        };
        // Pelo nome: o navegador nomeia por arquivo e página (…-p0042.jpg), então
        // a ordem alfabética é a ordem do processo.
        arquivos.sort((a, b) => a.name.localeCompare(b.name));
        const ehImagem = (n: string) => /\.(png|jpe?g|webp|gif)$/i.test(n);
        const imagens = arquivos.filter((a) => ehImagem(a.name));
        const outros = arquivos.filter((a) => !ehImagem(a.name));
        // O TETO É O ORÇAMENTO CONJUNTO, não um número fixo.
        //
        // Era 60 imagens sempre, ao lado de um texto de até 360 mil caracteres,
        // sem ninguém somar os dois — e a soma estourava a janela do modelo (ver
        // _shared/orcamentoLeitura.ts). O navegador já decide isto antes de
        // renderizar; aqui é a REDE, para o caso de um cliente desatualizado
        // mandar mais do que cabe. Sobrando, ficam as ÚLTIMAS: o navegador já
        // escolheu fim e começo, e entre os dois o fim é onde estão a conta e o
        // requisitório.
        const _plano = planoDeLeitura({
          charsTexto: textoDireto.length,
          imagensPedidas: imagens.length,
          charsNotas: notasKommo.length,
        });
        const imagensEnviadas = imagens.slice(-Math.min(_plano.maxImagens, MAX_IMAGENS_ABS));
        if (imagensEnviadas.length < imagens.length) {
          cortouImagens = imagens.length - imagensEnviadas.length;
        }
        if (imagensEnviadas.length) {
          contentBlocks.push({
            type: 'text',
            text: `[PÁGINAS DIGITALIZADAS DOS AUTOS, enviadas como imagem: ${imagensEnviadas.length}. São páginas do MESMO processo do texto acima — leia-as como parte dos autos. A conta da contadoria, a homologação e o requisitório podem estar SÓ nelas. O nome de cada imagem diz o arquivo e a página de origem.]`,
          });
        }
        // DOWNLOAD EM PARALELO, montagem EM ORDEM.
        //
        // Era um `await` por arquivo, em fila: sessenta páginas baixadas uma a
        // uma do Storage, dentro do relógio de parede da função. Seis de cada
        // vez usam a banda que estava ociosa entre elas. A ORDEM continua sendo
        // a do processo — os bytes vão para um vetor indexado e os blocos são
        // montados depois, na sequência: página fora de ordem confundiria a
        // leitura tanto quanto página faltando.
        const aBaixar = [...outros, ...imagensEnviadas];
        const bytesPorIndice: (Uint8Array | null)[] = new Array(aBaixar.length).fill(null);
        {
          const CONCORRENCIA = 6;
          let proximo = 0;
          const trabalhador = async () => {
            for (;;) {
              const i = proximo++;
              if (i >= aBaixar.length) return;
              bytesPorIndice[i] = await storageGetBytes(sbAdmin, BUCKET_INPUT, `${prefix}/${aBaixar[i].name}`);
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(CONCORRENCIA, aBaixar.length) }, trabalhador),
          );
        }
        for (let i = 0; i < aBaixar.length; i++) {
          const bytes = bytesPorIndice[i];
          if (!bytes) continue;
          contentBlocks.push(...await arquivoToContentBlocks(aBaixar[i].name, bytes));
        }
        paginasImagem = imagensEnviadas.length;
      }

      // AS ANOTAÇÕES DO CARD ENTRAM NA LEITURA. Antes só um regex do navegador as
      // lia, para três campos. Elas trazem o que o comercial já apurou — parcela
      // cedida, percentual de honorários, o que o cedente disse — e a IA precisa
      // disso tanto quanto dos autos. Decisão do dono.
      if (notasKommo) contentBlocks.push({ type: 'text', text: `[Anotações do card no Kommo, do comercial]\n\n${capNotas(notasKommo)}` });

      // A DILIGÊNCIA ENTRA NA LEITURA, mas NÃO decide as linhas 10 e 11 — quem
      // as escreve é o código, depois (aplicarDiligenciaNoM2). Ela vem aqui para
      // que o RESTO da análise fique coerente com elas: a IA levanta fraude à
      // execução em "riscos" e comenta a penhora sabendo o que foi apurado. Sem
      // isto, a planilha diria "Sim, tem dívida" na linha 10 e o parecer ao lado
      // ignoraria o assunto.
      if (diligencia.hs.length) {
        const t = textoDaDiligencia(diligencia.hs);
        if (t) {
          contentBlocks.push({
            type: 'text',
            text:
              '[DUE DILIGENCE DE PROCESSOS DOS SUJEITOS, apurada na plataforma por CPF/CNPJ/OAB]\n\n' + t +
              '\n\nIsto NÃO está nos autos que você recebeu: é busca por documento, feita fora deste processo. ' +
              'As linhas 10 e 11 do m2 serão escritas a partir daqui pelo sistema — não tente reproduzi-las nem contradizê-las. ' +
              'O que você tem a fazer com esta informação é OUTRA coisa: se houver processo com cobrança contra o cedente, ' +
              'avalie em "riscos" o risco de FRAUDE À EXECUÇÃO sobre o crédito que estamos comprando (CPC art. 792; CTN art. 185 nas dívidas fiscais) ' +
              'e diga em "comentarios_analise" o que isso significa para a cessão. Se a diligência não achou nada, não invente risco.',
          });
        }
      }
    }
    const houveCorte = contentBlocks.some((b: any) => typeof b?.text === 'string' && b.text.includes(MARCA_CORTE));

    // 3b. PORTÃO 1 — QUALIFICAÇÃO (roda ANTES de tudo). Só quando se está LENDO
    // o processo: refinar e salvar trabalham sobre análise que já passou por ele.
    let dados: any;
    let avisosQualif: string[] = [];
    let respostaRevisao: string | null = null;
    if (acao === 'refinar' || acao === 'reprecificar' || acao === 'salvar') {
      if (!body.dados || typeof body.dados !== 'object') return errorResponse('Faltou a análise atual (dados) para ' + acao + '.');
      if (acao === 'refinar') {
        const instrucao = String(body.instrucao ?? '').trim();
        if (!instrucao) return errorResponse('Faltou o pedido de alteração (instrucao).');
        const revisao = await refinarDados(cfg.anthropic_api_key, body.dados, instrucao, Array.isArray(body.historico) ? body.historico : [], notasKommo);
        dados = revisao.dados;
        respostaRevisao = revisao.resposta;
        // A AUDITORIA ACOMPANHA O BRUTO CORRIGIDO. O cenário conservador foi
        // estimado sobre o bruto que a IA leu; se a pessoa corrige o bruto no
        // chat e o conservador fica como estava, o corte passa a ser de outra
        // leitura — grande demais ou pequeno demais, sem relação com a conta
        // nova. Escala na mesma proporção: mantém o risco embutido (o lado
        // conservador) sem fingir que a estimativa antiga vale para a base nova.
        {
          const _n = (v: unknown): number =>
            typeof v === 'number' ? (Number.isFinite(v) ? v : 0)
            : typeof v === 'string' ? (parseNumeroFlex(v.replace(/[^\d.,\-]/g, '')) ?? 0) : 0;
          const _antes = _n(body.dados?.bruto_total), _depois = _n(dados.bruto_total);
          const _consAntes = _n(body.dados?.auditoria_bruto_conservador), _consDepois = _n(dados.auditoria_bruto_conservador);
          if (_antes > 0 && _depois > 0 && Math.abs(_depois - _antes) > 0.005 && _consAntes > 0 && Math.abs(_consDepois - _consAntes) < 0.005) {
            dados.auditoria_bruto_conservador = Number((_consAntes * (_depois / _antes)).toFixed(2));
            respostaRevisao +=
              `\nA auditoria acompanhou o bruto: o cenário conservador foi de ${brl(_consAntes)} para ${brl(dados.auditoria_bruto_conservador)}, na mesma proporção. ` +
              'Se a divergência era um valor fixo, e não proporcional, corrija "auditoria_bruto_conservador" aqui no chat.';
          }
        }
      } else {
        dados = body.dados;
      }
      avisosQualif = Array.isArray(body.avisos_qualificacao) ? body.avisos_qualificacao.map(String) : [];
    } else {
    const qualif = await extrairQualificacao(cfg.anthropic_api_key, contentBlocks);

    // O PDF É DESTE PROCESSO? O número do card sobrepõe o que a IA leu nos
    // autos — e sobrepunha em silêncio: anexo trocado de card produzia a
    // análise completa do processo errado, com o número certo no nome do
    // arquivo. Só compara quando os dois são CNJ inteiros (20 dígitos); "NÃO
    // LOCALIZADO" e número parcial não acusam nada.
    const _soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
    const _mascara = (d: string) => d.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6');
    const _cnjCard = _soDigitos(numeroProcesso);
    const _cnjAutos = _soDigitos(qualif.numero_processo);
    if (_cnjCard.length === 20 && _cnjAutos.length === 20 && _cnjCard !== _cnjAutos) {
      await limparUploads?.();
      return errorResponse(
        `O PDF anexado é do processo ${_mascara(_cnjAutos)}, mas o card é do processo ${_mascara(_cnjCard)}. ` +
        'Anexo trocado de card? Confira o arquivo e o título do card antes de rodar de novo.',
      );
    }

    // PRECATÓRIO NO FUNIL DE RPV. A qualificação já lia o tipo do requisitório,
    // mas só para o piso de valor: um precatório expedido de R$ 300 mil seguia
    // e era precificado com prazo de RPV — 8 meses para um crédito que a
    // Fazenda paga em anos. Com o comercial triando mais volume, o erro de
    // funil é esperado, e o preço errado não tem cara de erro.
    if (
      categoria !== 'Precatórios' &&
      /precat/i.test(String(qualif.tipo_requisitorio ?? '')) &&
      ehSim(qualif.requisitorio_expedido)
    ) {
      await limparUploads?.();
      return errorResponse(
        `Este processo tem PRECATÓRIO expedido${qualif.oficio_localizacao ? ` (${String(qualif.oficio_localizacao)})` : ''}, não RPV. ` +
        'O motor de RPV precificaria com prazo de meses um crédito que a Fazenda paga em anos. ' +
        'Mova o card para o funil de Precatórios e analise lá.',
      );
    }

    if (numeroProcesso) qualif.numero_processo = numeroProcesso;
    const veredito = avaliarQualificacao(qualif);
    if (!veredito.aprovado) {
      // Reprovado: não monta tabela jurídica nem precificação. Limpa os uploads e devolve o motivo.
      await limparUploads?.();
      return jsonResponse({
        ok: true,
        reprovado: true,
        motivos: veredito.motivos,
        avisos: veredito.avisos,
        qualificacao: qualif,
      });
    }
    avisosQualif = veredito.avisos;  // alertas da qualificação (seguem para a resposta final)

    // 3c. Extração pela IA (só chega aqui se foi APROVADO no Portão 1)
    dados = await extrairAnalise(cfg.anthropic_api_key, contentBlocks);
    dados._houveCorte = houveCorte;
    dados._paginas_imagem = paginasImagem;
    dados._imagens_cortadas = cortouImagens;
    // AS PÁGINAS SUBIDAS SÓ SERVEM À LEITURA, que acabou: saem já. Antes a
    // limpeza ficava para o 'salvar', que não sabe quais arquivos são — e a
    // preliminar que nunca é salva deixava tudo no bucket.
    await limparUploads?.();
    }
    dados.originador = originador;
    if (numeroProcesso) dados.numero_processo = numeroProcesso;
    // As respostas do questionário nas listas do modelo — vale para a extração e
    // para o que o chat escreveu, que também não passava por lista nenhuma.
    {
      const _m2 = normalizarM2(dados.m2);
      dados.m2 = _m2.m2;
      dados._m2_fora_da_lista = _m2.foraDaLista;
    }
    // LINHAS 10 E 11 — HISTÓRICO DO CEDENTE E DO ADVOGADO.
    //
    // Escritas AQUI, e não pela IA, porque a IA não tem como saber: ela lê o
    // processo da cessão, que não fala das outras dívidas de ninguém. O "Não"
    // que saía impresso queria dizer "não achei nos autos" e era lido como
    // "diligência feita". Com apuração no banco, a resposta vem dela — unida ao
    // que a IA tenha achado nos próprios autos, sem apagar nem um nem outro.
    //
    // RODA EM TODAS AS AÇÕES, de propósito: a apuração costuma vir DEPOIS da
    // primeira análise, e é o 'salvar' que gera a planilha. Sem apuração
    // concluída, nada é tocado — a análise sai exatamente como saía.
    {
      const _dd = aplicarDiligenciaNoM2(
        dados.m2,
        diligencia.hs,
        Array.isArray(dados._m2_do_chat) ? dados._m2_do_chat.map(String) : [],
      );
      dados.m2 = _dd.m2;
      dados._dd_notas = _dd.notas;
      dados._dd_linhas = _dd.escritas;
      if (diligencia.falha) {
        dados._dd_notas = [
          ...(_dd.notas ?? []),
          `⚠️ Não consegui ler a due diligence deste card: ${diligencia.falha}. As linhas 10 e 11 ficaram com o que a IA leu nos autos.`,
        ];
      }
    }
    // NÚMERO DE VERDADE, venha como vier. A IA — e o chat, que aceita texto — às
    // vezes devolvem "84.320,10" ou "R$ 84.320,10" onde se pediu número.
    // `Number("84.320,10")` é NaN, que virava ZERO: o bruto zerado dava "não
    // localizei valor" (mensagem enganosa, o valor estava lá), e IR/INSS
    // zerados faziam o líquido SUBIR em silêncio. parseNumeroFlex já existia
    // para isto e não era usado aqui.
    const numeroDoCampo = (v: unknown): number => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      if (typeof v === 'string') return parseNumeroFlex(v.replace(/[^\d.,\-]/g, '')) ?? 0;
      return 0;
    };
    const numeroOuNulo = (v: unknown): number | null => (v == null || v === '' ? null : numeroDoCampo(v));
    dados.bruto_total = numeroDoCampo(dados.bruto_total);
    dados.ir = numeroDoCampo(dados.ir);
    dados.inss = numeroDoCampo(dados.inss);
    dados.honorarios = numeroDoCampo(dados.honorarios);
    dados.honorarios_sucumbenciais = numeroDoCampo(dados.honorarios_sucumbenciais);
    dados.principal_liquido = numeroDoCampo(dados.principal_liquido);
    dados.serventia_dias = numeroDoCampo(dados.serventia_dias);
    dados.gabinete_dias = numeroDoCampo(dados.gabinete_dias);
    dados.auditoria_bruto_conservador = numeroOuNulo(dados.auditoria_bruto_conservador);
    dados.honorarios_contratuais_pct = numeroOuNulo(dados.honorarios_contratuais_pct);

    // 3b.1 O que está sendo cedido (escolha manual sobrepõe a detecção automática) + % de honorários
    const honAI = Number(dados.honorarios) || 0;          // honorários destacados pela contadoria (0 = sem destaque)
    // A base do percentual acompanha o BLOCO: o verde calcula o honorário sobre
    // o bruto, o azul sobre o líquido. É a mesma pergunta do bloco, então tem de
    // ser a mesma resposta — usar o valor destacado aqui e o fato lá em cima
    // deixava os dois discordando.
    const houveDestaque = escolherModelo(dados.honorarios_destacados, honAI) === 1;
    const brutoNum = Number(dados.bruto_total) || 0;
    const irNum = Number(dados.ir) || 0;
    const inssNum = Number(dados.inss) || 0;
    // honorários a usar: se o usuário informou %, aplica a regra (com destaque→bruto; sem destaque→líquido); senão, usa o da contadoria
    const _honBase = houveDestaque ? brutoNum : (brutoNum - irNum - inssNum);
    let honorariosCalc = honAI;
    if (honorariosPct != null) honorariosCalc = _honBase * (honorariosPct / 100);
    // A PORCENTAGEM DOS CONTRATUAIS SEGUNDO OS AUTOS.
    //
    // Lida do processo, não derivada aqui — e a diferença é o ponto. Derivar
    // exige escolher uma base, e a base é justamente o que costuma divergir: o
    // destaque pode ter saído sobre o bruto, sobre o líquido de INSS ou sobre o
    // valor atualizado de outra data. Percentual igual sobre bases diferentes dá
    // reais diferentes, e comparar reais acusaria divergência onde não há.
    //
    // A divisão em código fica como último recurso, para quando a IA não achou
    // a porcentagem escrita nem conseguiu dividir dentro de um documento só.
    const _pctAutosLido = Number(dados.honorarios_contratuais_pct);
    const _pctDoProcesso = Number.isFinite(_pctAutosLido) && _pctAutosLido > 0;
    const _pctAutos = _pctDoProcesso
      ? _pctAutosLido
      : (_honBase > 0 && honAI > 0 ? (honAI / _honBase) * 100 : null);
    // DE ONDE ELA VEIO, porque muda o peso de uma divergência: percentual lido
    // no contrato contradiz o card de verdade; percentual que eu estimei sobre
    // uma base escolhida por mim pode estar divergindo pela base, não pelo
    // negócio. Quem confere precisa saber qual dos dois está lendo.
    const _pctOrigem = _pctDoProcesso
      ? String(dados.honorarios_contratuais_pct_origem ?? 'lida no processo')
      : 'estimada aqui: honorário destacado ÷ base do bloco, porque o processo não traz a porcentagem escrita';

    // A PORCENTAGEM DA FICHA que volta ao card: a do comercial quando ele a
    // informou (é a dele que precificou), a dos autos quando não.
    dados._hon_pct = honorariosPct != null ? honorariosPct : _pctAutos;
    // ================================================================
    // QUAIS VERBAS ESTÃO SENDO COMPRADAS
    // ================================================================
    //
    // Antes, cessão só de honorários fazia a verba VIRAR o bruto e ocupar a
    // linha do principal — um truque para as fórmulas do modelo fecharem sem um
    // bloco próprio. Ele custava caro: destruía os valores dos autos (não dava
    // para trocar de cenário depois sem reextrair), somava contratuais e
    // sucumbenciais num lump só (uma escritura onde são duas) e deixava a
    // coluna de cenário certa vazia.
    //
    // Agora os valores dos autos ficam intactos e o que muda é só QUAIS VERBAS
    // entram na conta. Ver _shared/precificacao.ts.
    const _sucumbBrutosAutos = Number(dados.honorarios_sucumbenciais) || 0;
    let verbas: VerbasNegociadas;
    // O BLOCO DA PLANILHA SAI DOS AUTOS; as verbas, do negócio. Duas perguntas
    // diferentes, e amarrá-las punha metade dos casos no bloco errado.
    dados.modelo = escolherModelo(dados.honorarios_destacados, honAI);

    if (tipoAquisicao === 'principal') {
      verbas = { principal: true, contratuais: false, sucumbenciais: false };
      dados.tipo_credito = 'Crédito principal — apenas';
    } else if (tipoAquisicao === 'ambos') {
      // "Principal + honorários" leva o honorário que existir, dos dois tipos.
      verbas = { principal: true, contratuais: true, sucumbenciais: true };
      dados.tipo_credito = 'Crédito principal + Honorários';
    } else if (tipoAquisicao === 'honorarios' || tipoAquisicao === 'contratuais') {
      verbas = { principal: false, contratuais: true, sucumbenciais: true };
      dados.tipo_credito = 'Honorários contratuais + sucumbenciais';
      // Card diz só "contratuais" e o processo TEM sucumbenciais: entram no
      // preço, porque cede-se o honorário que existe — mas é o caso raro, e
      // quem fecha precisa saber que está comprando as duas verbas.
      if (tipoAquisicao === 'contratuais' && _sucumbBrutosAutos > 0) dados._sucumbNaoPrevistos = _sucumbBrutosAutos;
    } else if (tipoAquisicao === 'sucumbenciais') {
      verbas = { principal: false, contratuais: false, sucumbenciais: true };
      dados.tipo_credito = 'Honorários sucumbenciais — apenas';
    } else if (tipoAquisicao === 'indefinido') {
      // "HONORÁRIOS", SEM DIZER QUAIS — E OS AUTOS COSTUMAM DIZER POR ELE.
      //
      // A maioria das RPVs vem do JUIZADO ESPECIAL, onde não há sucumbência em
      // primeiro grau (art. 55 da Lei 9.099/95). Ali existe UM honorário só, o
      // contratual, e "honorários" não é ambíguo: é o único que existe.
      //
      // Isto já bloqueou a análise inteira, e o raciocínio estava certo pela
      // metade: chutar entre duas verbas é caro, mas só HÁ escolha quando as
      // duas existem. Bloquear antes de ler os autos recusava a maioria dos
      // casos por uma ambiguidade que não havia — e o comercial não tinha o que
      // corrigir no card, porque o card estava certo.
      const _temContratuais = honAI > 0 || honorariosPct != null;
      const _temSucumbenciais = _sucumbBrutosAutos > 0;
      // AS DUAS EXISTEM: aí sim a escolha é real e muda o preço — os
      // contratuais saem de dentro do principal, os sucumbenciais vêm por fora,
      // pagos pelo vencido. Não há como adivinhar qual foi cedida, e o palpite
      // não aparece no resultado.
      if (_temContratuais && _temSucumbenciais) {
        return errorResponse(
          `O card diz que a cessão é de HONORÁRIOS mas não diz quais, e este processo tem OS DOIS: ` +
          `contratuais de ${brl(honorariosCalc)} e sucumbenciais de ${brl(_sucumbBrutosAutos)}. ` +
          'Disso depende o preço: os contratuais saem do bolo do principal, os sucumbenciais vêm por fora, pagos pelo vencido. ' +
          'Escreva no card qual é — "honorários contratuais", "honorários sucumbenciais" ou "honorários contratuais + sucumbenciais" — e rode de novo.',
        );
      }
      // Uma só: é ela, e o motor diz de qual se trata em vez de deixar o
      // operador supor. Verba de valor zero é descartada na montagem das
      // parcelas, então marcar as duas aqui não inventa escritura de cartório.
      verbas = { principal: false, contratuais: true, sucumbenciais: true };
      dados.tipo_credito = _temSucumbenciais
        ? 'Honorários sucumbenciais — apenas'
        : 'Honorários contratuais + sucumbenciais';
      dados._honorarios_resolvido = _temSucumbenciais ? 'sucumbenciais' : 'contratuais';
    } else {
      // Automático: o destaque da contadoria decide se há honorários a comprar.
      //
      // NADA DITO NÃO É "PRINCIPAL" — é campo em branco. O automático assume o
      // principal porque é o caso comum, mas assumir em silêncio custa caro:
      // uma cessão só de honorários sai precificada com o crédito principal
      // dentro, e a análise não tem como saber que errou. Agora que a parcela
      // cedida também pode vir no TÍTULO do card, campo em branco é
      // esquecimento provável — então ele avisa.
      dados._parcela_nao_informada = true;
      const comHonorarios = honAI > 0 || honorariosPct != null;
      verbas = { principal: true, contratuais: comHonorarios, sucumbenciais: comHonorarios };
      dados.tipo_credito = comHonorarios ? 'Crédito principal + Honorários' : 'Crédito principal — apenas';
    }

    // O QUE O CHAT DITOU vence o que o card diz — até a pessoa trocar o
    // cenário no seletor da janela, que apaga a escolha do chat (ver
    // trocarCenario no modal). Sem isto, "tira os sucumbenciais" era gravado,
    // reportado como aplicado, e o preço saía com os sucumbenciais dentro.
    const _manual = parametrosParaCalibragem(dados);
    if (_manual.verbas) {
      verbas = _manual.verbas;
      dados.tipo_credito = rotuloDoCenario(verbas) || dados.tipo_credito;
      dados._parcela_nao_informada = false;
    }
    dados.honorarios = honorariosCalc;   // contratuais, valor BRUTO destacado
    dados._verbas_negociadas = verbas;
    dados._honPctInformado = honorariosPct != null;

    // SEM VERBA NENHUMA NÃO HÁ NEGÓCIO. Acontece quando o card manda comprar
    // honorários e o processo não tem nenhum: melhor dizer isso do que devolver
    // uma análise de valor zero, que parece um resultado.
    {
      const temAlgo =
        (verbas.principal && (Number(dados.bruto_total) || 0) - (Number(dados.ir) || 0) - (Number(dados.inss) || 0) - honorariosCalc > 0) ||
        (verbas.contratuais && honorariosCalc > 0) ||
        (verbas.sucumbenciais && _sucumbBrutosAutos > 0);
      if (!temAlgo) return errorResponse(
        `O card manda negociar ${dados.tipo_credito}, mas não localizei valor para nenhuma dessas verbas nos documentos. ` +
        (verbas.principal
          ? 'Confira os cálculos anexados ao card.'
          : 'Junte a peça que fixa os honorários (sentença, acórdão ou conta da contadoria), ou informe o percentual no formulário.'),
      );
    }

    // 3c. Prazo (T5) + datas — pela ESFERA DO ENTE DEVEDOR
    const scenario: 'A' | 'B' = (dados.rpv_ja_expedida === true || String(dados.rpv_ja_expedida) === 'true') ? 'B' : 'A';
    // UMA classificação do ente para o motor inteiro: o prazo e o teto da RPV
    // liam o ente por caminhos diferentes e podiam discordar.
    const ente = classificarEnte(dados.ente_devedor, dados.esfera, dados.tribunal);
    const esfera = ente.prazo;
    // ALVARÁ, agora lido do roteiro. A pergunta "nesse tribunal precisa emitir
    // alvará?" saiu do modelo simplificado (era a linha 43), e com ela a fonte
    // deste campo. Continua importando só na fórmula de reserva — quando o
    // roteiro vale, o alvará já é um ato dele, com os dias próprios. Ler o
    // roteiro mantém as duas leituras coerentes em vez de deixar isto sempre
    // falso e a fórmula subestimar o prazo em três semanas.
    const exigeAlvara = (Array.isArray(dados.roteiro_prazo) ? dados.roteiro_prazo : []).some(
      (a: any) => /alvar/i.test(String(a?.ato ?? '')),
    );
    const dataExpedicao = dados.data_expedicao_rpv ? parseDataBR(dados.data_expedicao_rpv) : null;
    const _prazoEstimado = esfera === 'goias' && scenario === 'A' && !dados.data_fatal_convenio;
    const prazo = prazoMeses({
      esfera,
      serventiaDias: Number(dados.serventia_dias) || 0,
      gabineteDias: Number(dados.gabinete_dias) || 0,
      scenario,
      dataAquisicao: new Date(),
      // parseDataBR, e NÃO a parseBR ingênua que morava no fim deste arquivo.
      // Ela devolvia `Invalid Date` para "NÃO LOCALIZADO" ou para uma data em
      // outro formato, e daí saía NaN: `Math.max(8, NaN)` é NaN, a calibragem
      // nunca batia a meta com NaN e devolvia o TETO DE 95% DE DESÁGIO, com o
      // prazo em branco na tela e "rentabilidade 0,00%" no aviso. Um preço
      // absurdo, com uma explicação errada ao lado.
      dataFatalConvenio: parseDataBR(dados.data_fatal_convenio) ?? undefined,
      dataExpedicao: dataExpedicao ?? undefined,
      exigeAlvara,
    });
    // PRAZO DITADO NO CHAT vence o calculado — inclusive abaixo do piso de 8
    // meses: ali é uma pessoa dizendo o que sabe daquele caso, e o motor avisa
    // em vez de sobrepor em silêncio.
    const prazoManual = Number(dados._prazo_manual);
    const usaManual = Number.isFinite(prazoManual) && prazoManual > 0;
    const T5 = usaManual ? prazoManual : prazo.meses;
    dados._esfera = esfera;
    dados._regra_prazo = prazo.regra.descricao;
    dados._prazo_detalhe = usaManual
      ? `prazo definido à mão: ${prazoManual} meses (o cálculo daria ${prazo.meses.toFixed(1)})`
      : prazo.detalhe;
    dados.data_aquisicao = hojeDDMMAAAA();
    dados.data_pagamento = dataPagamento(T5);

    // 3c.1 A regra de emolumentos do estado.
    //
    // NUNCA EXTRAI AQUI. Ou veio pronta do navegador (ação 'emolumentos', que
    // faz a busca em requisição própria), ou o preço sai sem cartório e
    // avisando. Extrair neste ponto foi o que derrubou o worker com HTTP 546.
    //
    // Só vale se for DA MESMA UF: se a pessoa corrigiu o tribunal no chat, a
    // regra de antes é de outro estado e tem de ser descartada.
    const origemUf = origemDoCredito(dados);
    const ufCredito = origemUf.uf;
    const recebida = body.emolumentos as Emolumentos | undefined;
    const daTela: Emolumentos | null =
      recebida && recebida.regra && (!ufCredito || recebida.uf === ufCredito) ? recebida : null;
    // SEGUNDO CRÉDITO DO MESMO ESTADO. Se a tabela já foi levantada alguma vez
    // este ano, ela está a uma consulta de distância — e aí o preço já sai com
    // escritura e registro na PRIMEIRA resposta. Sem isto, mesmo com a regra
    // pronta no banco, a análise saía "sem cartório", a tela pedia a regra e
    // mandava reprecificar: duas idas e voltas a mais e um piscar de "cartório
    // não incluído" que assustava à toa.
    //
    // regraDoCache SÓ LÊ. Disparar o levantamento daqui de dentro é o que
    // derrubava o worker; quando não há tabela, `falta_regra` continua indo
    // para a tela e é ela que pede, na requisição separada de sempre.
    const emolumentos: Emolumentos | null =
      daTela ?? (ufCredito ? await regraDoCache(ufCredito, sbAdmin) : null);

    // 3d. Calibragem do deságio — o cartório entra DENTRO dela, por preço.
    // AS PARCELAS FECHAM? Conferência de código, não de prompt.
    //
    // Pedir à IA que confira a própria conta ajuda e não basta: ela pode ler o
    // bruto de um documento e as retenções de outro, e a soma denuncia isso —
    // sem que nada mais denuncie. A tolerância é de um real ou 0,1% do bruto (o
    // que for maior), que cobre arredondamento de centavo sem deixar passar
    // troca de documento.
    const _liqDeclarado = Number(dados.principal_liquido) || 0;
    if (_liqDeclarado > 0) {
      const _liqCalculado = (Number(dados.bruto_total) || 0) - (Number(dados.ir) || 0) -
        (Number(dados.inss) || 0) - (Number(dados.honorarios) || 0);
      const _folga = Math.max(1, (Number(dados.bruto_total) || 0) * 0.001);
      if (Math.abs(_liqCalculado - _liqDeclarado) > _folga) dados._parcelasNaoFecham = {
        declarado: _liqDeclarado, calculado: _liqCalculado,
      };
    }

    // O IRRF SOBRE OS HONORÁRIOS, pela tabela progressiva.
    //
    // Conta, não estimativa: a célula do modelo trazia o texto "[ESTIMAR
    // CONFORME TABELA PROGRESSIVA DE IR]" à espera de que a IA pusesse um
    // número, e como ela não punha, a fórmula que subtraía a célula devolvia
    // #VALUE! e contaminava líquido, total e rentabilidade. Ver _shared/irpf.ts.
    //
    // Pagamento único (meses = 1), que é o mais pesado: se os honorários forem
    // rendimento recebido acumuladamente, o imposto real é menor, e errar para
    // mais deixa o preço conservador em vez de prometer um líquido que não vem.
    // AS VERBAS DO NEGÓCIO, e não mais um "modelo" que decidia tudo.
    //
    // O preço passou a ser a soma de até três parcelas, cada uma com o seu
    // líquido, o seu deságio e a sua escritura. Ver _shared/precificacao.ts: é
    // lá que moram as duas regras da casa — deságio só no principal quando ele
    // está no negócio, e um par de escritura e registro POR VERBA.
    const _verbas: VerbasNegociadas = {
      principal: dados._verbas_negociadas?.principal ?? true,
      contratuais: dados._verbas_negociadas?.contratuais ?? false,
      sucumbenciais: dados._verbas_negociadas?.sucumbenciais ?? false,
    };
    // A AUDITORIA ENTRA AQUI, antes de tudo: é ela que decide sobre QUAIS
    // valores o preço se forma. Cálculo homologado não é cálculo definitivo, e
    // quem compra o crédito é quem perde se a revisão vier — então o cenário
    // conservador é o que precifica. Ver _shared/precificacao.ts.
    const _auditoria = aplicarAuditoria(
      {
        brutoTotal: Number(dados.bruto_total) || 0,
        ir: Number(dados.ir) || 0,
        inss: Number(dados.inss) || 0,
        contratuaisBrutos: Number(dados.honorarios) || 0,
        sucumbenciaisBrutos: Number(dados.honorarios_sucumbenciais) || 0,
      },
      dados.auditoria_bruto_conservador,
    );
    // OS VALORES QUE DE FATO PRECIFICARAM. A planilha tem de escrever ESTES, e
    // não os dos autos: o deságio é calibrado sobre esta base, e aplicá-lo à
    // base cheia no documento oferece mais do que a auditoria autorizou.
    dados._valores_precificados = _auditoria.valores;
    dados._auditoria_aplicada = _auditoria.aplicada;
    dados._auditoria_corte = _auditoria.corte;
    dados._auditoria_motivo = _auditoria.motivo ?? null;

    const _contratuaisBrutos = _auditoria.valores.contratuaisBrutos;
    const _sucumbBrutos = _auditoria.valores.sucumbenciaisBrutos;
    // O IR de CADA verba, em separado — é o que as fórmulas M7 e M8 do modelo
    // fazem, e o que a realidade costuma ser: contratuais e sucumbenciais vêm em
    // requisitórios distintos. Ver _shared/precificacao.ts.
    const _irHon =
      (_verbas.contratuais ? irProgressivo(_contratuaisBrutos).imposto : 0) +
      (_verbas.sucumbenciais ? irProgressivo(_sucumbBrutos).imposto : 0);
    dados._ir_honorarios = _irHon;

    const _parcelas = montarParcelas({ ..._auditoria.valores, verbas: _verbas });
    dados._parcelas = _parcelas;

    // OS PARÂMETROS DITADOS NO CHAT ENTRAM AQUI. Era o elo que faltava: o chat
    // gravava deságio, meta, comissão e diligência na análise e esta chamada
    // não os recebia — calibrava sempre no automático e o operador via
    // "Aplicado" numa mudança que não tinha acontecido.
    const calc: any = calibrarDesagio({
      parcelas: _parcelas, T5,
      regra: emolumentos?.regra ?? null,
      desagioFixo: _manual.desagioFixo,
      alvo: _manual.alvo,
      comissaoPct: _manual.comissaoPct,
      diligencia: _manual.diligencia,
    });
    // Compatibilidade com quem lê o resultado pelo nome das células do modelo.
    calc.L5 = _parcelas.find((p) => p.nome === 'principal')?.liquido ?? 0;
    calc.L7 = _parcelas.find((p) => p.nome === 'contratuais')?.liquido ?? 0;
    calc.L8 = _parcelas.find((p) => p.nome === 'sucumbenciais')?.liquido ?? 0;
    calc.emolumentos = {
      escritura: calc.escrituraTotal, registro: calc.registroTotal, completo: calc.cartorioCompleto,
    };
    calc.faixaCartorio = emolumentos
      ? `${calc.descricaoCartorio} — tabela ${emolumentos.uf}/${emolumentos.ano}${emolumentos.vigencia ? `, ${emolumentos.vigencia}` : ''}`
      : `Confirmar com cartório${ufCredito ? ` — tabela de ${ufCredito} ainda não levantada` : ' — UF do tribunal não identificada'}`;
    calc.IR = Number(dados.ir) || 0; calc.INSS = Number(dados.inss) || 0;

    // ================================================================
    // O PISO DE R$ 20 MIL, sobre o VALOR TOTAL LÍQUIDO NEGOCIADO
    // ================================================================
    //
    // É a linha 39 da aba jurídica — "qual o valor total final líquido do(s)
    // crédito(s) sendo negociado(s)?" —, que é o Y3 da calibragem. Decisão do
    // dono: abaixo disso não se transaciona, ainda que somando todos os créditos
    // disponíveis no processo.
    //
    // POR QUE NÃO NO PORTÃO. Lá o número é o BRUTO que a IA leu, e ele errava
    // dos dois lados: uma cessão só de honorários de R$ 15 mil passava porque o
    // crédito inteiro tinha R$ 100 mil, e um bruto de R$ 25 mil que líquido dá
    // R$ 17 mil também passava. O portão continua reprovando quando o bruto já
    // está abaixo — isso é barato e seguro —, e a régua de verdade é aqui.
    //
    // A MENSAGEM SEPARA DOIS CASOS, porque a ação é diferente: se o processo TEM
    // R$ 20 mil somando todas as verbas e o que falta é a parcela cedida estar
    // estreita, quem lê pode alargar o negócio; se nem tudo somado chega lá, o
    // crédito não serve e não há o que ajustar.
    // Zerado a cada rodada: `dados` dá a volta pelo navegador, e um aviso de
    // piso que sobrevivesse à correção que o resolveu seria mentira.
    dados._abaixo_do_piso = null;
    if (Number(calc.Y3) > 0 && Number(calc.Y3) < PISO_NEGOCIO) {
      const _tudo = montarParcelas({
        ..._auditoria.valores,
        verbas: { principal: true, contratuais: true, sucumbenciais: true },
      }).reduce((s, p) => s + p.liquido, 0);
      const _cabe = _tudo >= PISO_NEGOCIO;
      const _motivo =
        `O valor total líquido negociado é ${brl(calc.Y3)}, abaixo do mínimo de ${brl(PISO_NEGOCIO)} ` +
        `(${String(dados.tipo_credito ?? 'verbas do negócio')}). ` +
        (_cabe
          ? `Somando TODAS as verbas do processo dá ${brl(_tudo)} — se a cessão puder incluir as demais, ` +
            'corrija o "PARCELA CEDIDA" do card (ou troque o cenário aqui na janela) e rode de novo.'
          : `Nem somando todas as verbas do processo se chega ao mínimo: o total líquido disponível é ${brl(_tudo)}.`);

      if (acao === 'analisar' || acao === null) {
        return jsonResponse({ ok: true, reprovado: true, motivos: [_motivo], avisos: avisosQualif, qualificacao: null });
      }
      if (acao === 'salvar') {
        return errorResponse(_motivo + ' Não gerei a planilha.');
      }
      // 'refinar' e 'reprecificar': não derruba o que está na tela — o operador
      // está no meio de uma conversa e pode estar justamente corrigindo isto.
      dados._abaixo_do_piso = _motivo;
    }

    // NÃO HÁ MAIS "TROCOU DE FAIXA". Com a regra dentro da calibragem, o preço
    // final e o emolumento vêm da MESMA faixa por construção — o custo foi
    // calculado para aquele preço, não herdado de outro. Some com isso toda a
    // convergência: reconsulta, limiar de mudança material e o aviso que mandava
    // a pessoa conferir à mão.

    // Nome do credor em Title Case (usado na pasta do Drive, no nome do arquivo e na aba de precificação)
    const credorBruto = (dados.credor_nome || (dados.cedente_cpf || '').split(/\bCPF\b/i)[0] || numeroProcesso || 'cedente');
    const credorTitulo = (tituloNome(credorBruto).slice(0, 80)) || 'Cedente';
    dados._credor_titulo = credorTitulo;

    // Avisos que valem para a preliminar e para a final.
    const avisosBase: string[] = [...avisosQualif];
    // Abaixo do piso depois de uma revisão: fica em primeiro lugar, porque
    // nenhum outro aviso importa se o negócio não pode ser feito.
    if (dados._abaixo_do_piso) avisosBase.unshift(`⚠️ ABAIXO DO MÍNIMO — NÃO DÁ PARA FECHAR: ${dados._abaixo_do_piso}`);
    // O TETO DO ENTE, do cache (e pesquisado em segundo plano quando falta).
    // Não espera pela pesquisa: quando ela está em curso, o aviso diz que o teto
    // ainda não foi conferido, em vez de calar — calar se lê como "está dentro".
    // O MUNICÍPIO DEVEDOR, quando há um. É por ele que o teto é procurado: o
    // número guardado por UF é o da capital, e cada município tem o seu.
    const _municipio = ente.esfera === 'municipal' ? municipioDoEnte(dados.ente_devedor) : null;
    const _teto = await consultarTeto(sbAdmin, ufCredito, ente.esfera, undefined, _municipio);
    const _avisoTetoBase = avisoDeTeto(_teto, ente.esfera, ufCredito, Number(dados.bruto_total) || 0, _municipio);
    if (_avisoTetoBase) avisosBase.push(_avisoTetoBase);
    // A TABELA DO IRRF ainda é fixa no código e muda todo janeiro. A dos tetos
    // saiu daqui (migração 0057): ela agora se pesquisa sozinha quando vira o
    // ano, e por isso não precisa mais deste aviso — que ninguém podia resolver
    // na hora e se repetia em toda análise até alguém fazer deploy.
    {
      const _anoAgora = new Date().getFullYear();
      if (_anoAgora !== ANO_TABELA_IRRF)
        avisosBase.push(`⚠️ TABELA DEFASADA: a tabela do IRRF do sistema é de ${ANO_TABELA_IRRF}, e estamos em ${_anoAgora}. O IR dos honorários pode estar errado — peça a atualização da tabela.`);
    }
    // PORCENTAGEM ESCRITA COMO FRAÇÃO é o erro de digitação provável: "0,30"
    // querendo dizer 30%. Não dá para corrigir sozinho — 0,30% é um número
    // legítimo, só improvável num contrato —, mas dá para dizer em voz alta,
    // porque errar aqui faz o honorário praticamente desaparecer do negócio.
    if (honorariosPct != null && honorariosPct > 0 && honorariosPct < 1)
      avisosBase.push(
        `⚠️ HONORÁRIOS CONTRATUAIS DE ${pct(honorariosPct / 100)} — baixo demais para um contrato. ` +
        `Se a intenção era ${pct(honorariosPct)}, escreva a porcentagem em pontos no card ` +
        '(30, e não 0,30) e rode de novo.',
      );
    // O CARD FOI VAGO E OS AUTOS RESPONDERAM. Não é alerta — não há decisão a
    // tomar —, mas quem confere precisa saber que a verba foi deduzida do
    // processo e não lida do cadastro.
    // O % DO CARD CONFERIDO CONTRA O % DOS AUTOS — em pontos percentuais.
    //
    // EM REAIS NÃO SERVE, e essa era a versão anterior: converter o percentual
    // do card numa base escolhida por mim e comparar com o valor destacado
    // acusava divergência sempre que a base fosse outra, ainda que o percentual
    // fosse exatamente o mesmo. Base é o que divergia, não o negócio.
    //
    // Um ponto percentual de tolerância: contrato de honorário é número redondo
    // (20, 30, 33), e a folga cobre o arredondamento de quando o percentual foi
    // obtido por divisão em vez de lido escrito.
    if (honorariosPct != null && _pctAutos != null && Math.abs(honorariosPct - _pctAutos) > 1)
      avisosBase.push(
        `⚠️ HONORÁRIOS CONTRATUAIS DIVERGENTES: o card diz ${pct(honorariosPct / 100)} e o processo indica ` +
        `${pct(_pctAutos / 100)} (${_pctOrigem}). ` +
        `PRECIFIQUEI PELO CARD, com ${brl(honorariosCalc)} de honorário — a contadoria destacou ${brl(honAI)}. ` +
        'Confira o contrato de honorários antes de fechar.',
      );
    if (dados._honorarios_resolvido)
      avisosBase.push(
        `O card diz apenas "honorários"; o processo tem só os ${dados._honorarios_resolvido}, ` +
        'então é essa a verba precificada.',
      );
    if (dados._parcela_nao_informada)
      avisosBase.push(
        `⚠️ PARCELA CEDIDA NÃO INFORMADA no card: precifiquei ${String(dados.tipo_credito ?? '')}, ` +
        'que é a suposição do automático. Se a cessão for só de honorários, o preço inclui o crédito principal ' +
        'e está muito alto — escreva a parcela cedida no card e rode de novo.',
      );
    // Região que cobre vários estados sem seção judiciária nos autos, ou UF que
    // contradiz a região: some sem isto, e o efeito visível seria só o cartório
    // faltando, sem dizer que a causa é não se saber de que estado é o crédito.
    if (origemUf.aviso) avisosBase.push(`⚠️ ${origemUf.aviso}`);
    if (!emolumentos)
      avisosBase.push(`⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO${ufCredito ? ` (${ufCredito})` : ''}: o deságio foi calibrado SEM escritura e registro — some o custo de cartório à mão antes de fechar a proposta.`);
    else if (calc.Y10 == null)
      avisosBase.push(`⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO: o preço de cessão (${brl(calc.cessao)}) ficou fora das faixas da tabela de ${emolumentos.uf}. Confirme o emolumento com o cartório e some à mão.`);
    else if (calc.emolumentos && !calc.emolumentos.completo)
      avisosBase.push(`⚠️ CARTÓRIO PARCIAL: na tabela de ${emolumentos.uf} achei só ${calc.emolumentos.escritura == null ? 'o registro' : 'a escritura'}. O preço inclui essa parte; some ${calc.emolumentos.escritura == null ? 'a escritura' : 'o registro'} à mão. ${emolumentos.observacao ?? ''}`.trim());
    else if (emolumentos.origem === 'busca')
      avisosBase.push(`Tabela de emolumentos de ${emolumentos.uf}/${emolumentos.ano} levantada agora (${emolumentos.observacao ?? 'sem detalhe'}). Fonte: ${emolumentos.fontes[0] ?? 'não informada'}. Vale conferir uma vez; daqui em diante ela vale para qualquer valor de cessão, sem nova consulta.`);
    // SOBRE O QUE O CARTÓRIO COBRA. A tabela de cada estado diz se o ato incide
    // sobre o preço da cessão ou sobre o valor do crédito; a IA passou a ler
    // isso ao levantar a tabela. Tabela levantada antes disso (ou que não diz)
    // vale pelo preço — e quem confere precisa saber que foi suposição.
    if (emolumentos?.regra) {
      const _atos = [emolumentos.regra.escritura, emolumentos.regra.registro].filter(Boolean) as Array<{ base_calculo?: string | null }>;
      if (_atos.length && _atos.some((a) => !a.base_calculo))
        avisosBase.push(
          `A tabela de ${emolumentos.uf} não diz sobre que valor cobra o ato (preço da cessão ou valor do crédito); calculei sobre o PREÇO. ` +
          'Se o cartório de lá cobrar sobre o crédito, o custo está subestimado — confira com o cartório onde vai lavrar.',
        );
    }
    if (Array.isArray(dados._m2_fora_da_lista) && dados._m2_fora_da_lista.length)
      avisosBase.push(
        `⚠️ RESPOSTA FORA DA LISTA no questionário (${dados._m2_fora_da_lista.join('; ')}): a planilha só aceita os valores da lista suspensa nessas linhas, ` +
        'e o Excel não avisa ao abrir. Corrija no chat ("na linha 19 a resposta é Procedência parcial").',
      );
    // O QUE A DUE DILIGENCE ACHOU. Vai para os avisos porque dívida do cedente
    // não muda o preço — muda a decisão de comprar: penhora que alcance este
    // crédito é fraude à execução, e isso é assunto de gente, não de fórmula.
    if (Array.isArray(dados._dd_notas)) for (const n of dados._dd_notas) avisosBase.push(String(n));
    if (_prazoEstimado) avisosBase.push('⚠️ PRAZO ESTIMADO — TJGO sem data-limite de convênio nos autos: a espera até a expedição foi estimada em 60 dias. Confira o prazo e a rentabilidade à mão.');
    if (String(dados.eh_horas_extras) === 'true' && !(Number(dados.inss) > 0) && dados._verbas_negociadas?.principal && !ehEstadoDeGoias(dados.ente_devedor))
      avisosBase.push('⚠️ INSS ZERADO EM HORAS EXTRAS fora do Estado de Goiás: a reserva preventiva de 14,25% é a alíquota da GOIASPREV e NÃO foi aplicada a este ente. Confira a alíquota previdenciária do ente devedor; se couber reserva, refaça a precificação com ela.');
    // O QUE ESTÁ FIXADO À MÃO aparece como nota: quem abre a análise depois
    // precisa saber que aquele deságio não é o calibrado, e como voltar.
    for (const d of _manual.descricao) avisosBase.push(`${d} — para voltar ao automático, peça no chat.`);
    if (calc.atingiuAlvo === false) {
      const _meta = _manual.alvo ?? 0.028;
      avisosBase.push(
        _manual.desagioFixo != null
          ? `⚠️ O deságio ditado (${pct(calc.desagio)}) NÃO atinge a meta de ${pct(_meta)} ao mês: a rentabilidade fica em ${pct(calc.Y9)} ao mês.`
          : `⚠️ Não foi possível atingir a meta de ${pct(_meta)} ao mês: mesmo no deságio máximo (95%), a rentabilidade fica em ${pct(calc.Y9)} ao mês — pode ser um crédito que não compensa nesse prazo, ou algum dado lido errado do PDF.`,
      );
    }
    if (dados._houveCorte)
      avisosBase.push('O processo é muito grande e PARTE do conteúdo foi omitida na leitura da IA. Confira com atenção os valores (bruto, líquido, IR, INSS, honorários) e as datas.');
    if (Number(dados._imagens_cortadas) > 0)
      avisosBase.push(
        `⚠️ ${Number(dados._imagens_cortadas)} página(s) digitalizada(s) NÃO couberam no pedido e ficaram de fora da leitura ` +
        '(o processo tem texto e imagem demais para uma passada só). Foram cortadas as do COMEÇO — o fim, onde ficam a conta e o requisitório, foi preservado. ' +
        'Se a peça que decide o valor estiver nas páginas iniciais, confira à mão.',
      );
    if (Number(dados._paginas_imagem) > 0)
      avisosBase.push(
        `⚠️ ${Number(dados._paginas_imagem)} página(s) digitalizada(s) foram lidas POR IMAGEM, não por texto. A leitura é boa mas não é infalível — ` +
        'confira os valores (bruto, IR, INSS, honorários) contra a conta da contadoria antes de fechar.',
      );
    // O QUE ENTROU NO PREÇO, verba a verba, com o deságio de cada uma. É o aviso
    // que responde à pergunta que o número sozinho não responde: 30% de deságio
    // sobre o quê. Havendo principal, os honorários vão pelo valor de face e o
    // deságio efetivo sobre o negócio é bem menor que o nominal.
    {
      const _ps: any[] = Array.isArray(dados._parcelas) ? dados._parcelas : [];
      if (_ps.some((p) => !p.desagiavel)) {
        avisosBase.push(
          `Honorários comprados pelo valor de face; o deságio de ${pct(calc.desagio)} caiu todo sobre o principal. Efetivo sobre o negócio: ${pct(calc.desagioEfetivo)}.`,
        );
      }
    }
    // A AUDITORIA, sempre — inclusive quando não achou nada. Silêncio aqui
    // seria lido como "não auditado", e a diferença entre "conferi e está fiel"
    // e "não conferi" é toda a diferença para quem assina.
    {
      const _divs: any[] = Array.isArray(dados.auditoria_divergencias) ? dados.auditoria_divergencias : [];
      const _risco = String(dados.auditoria_risco_revisao ?? '').toLowerCase();
      if (dados._auditoria_aplicada) {
        avisosBase.push(
          `⚠️ Preço no CENÁRIO CONSERVADOR: o bruto dos autos foi reduzido em ${brl(Number(dados._auditoria_corte) || 0)} ` +
          `pela auditoria dos cálculos. Motivo detalhado nos riscos.`,
        );
      } else if (_divs.length) {
        const _reduzem = _divs.filter((d: any) => String(d?.efeito_se_corrigida ?? d?.efeito ?? '') === 'reduz').length;
        avisosBase.push(
          `⚠️ Auditoria: ${_divs.length} divergência(s) na conta${_reduzem ? `, ${_reduzem} que derruba(m) o crédito se corrigida(s)` : ''} — ` +
          `o preço NÃO embute esse risco. Risco de revisão: ${_risco || 'não classificado'}. Detalhe nos riscos.`,
        );
      } else if (dados.auditoria_criterio_aplicado) {
        avisosBase.push(`Auditoria: conta conferida contra o título e os índices da Fazenda, e fiel. Risco de revisão: ${_risco || 'baixo'}.`);
      }
    }

    // DOIS OLHOS NO MESMO FATO. A linha 34 do questionário pergunta se houve
    // pedido de destaque, e o campo honorarios_destacados decide o bloco. Foram
    // extraídos pela mesma passada, mas de leituras diferentes — quando
    // discordam, um dos dois está errado, e o bloco pode ser o errado.
    {
      const _l34 = String((dados.m2 ?? {})['34']?.resposta ?? '').trim().toLowerCase();
      const _destacados = dados.honorarios_destacados;
      if (_l34 && typeof _destacados === 'boolean') {
        const _l34Sim = _l34.startsWith('sim');
        if (_l34Sim !== _destacados) {
          avisosBase.push(
            `⚠️ LEITURAS EM CONFLITO sobre o destaque dos honorários: a linha 34 do questionário diz "${_l34}" ` +
            `e o campo que escolhe o bloco da planilha diz "${_destacados ? 'destacados' : 'não destacados'}". ` +
            `A análise foi montada no bloco ${dados.modelo === 1 ? 'VERDE (destacados)' : 'AZUL (não destacados)'} — ` +
            'confira, porque os dois blocos calculam o honorário sobre bases diferentes (bruto no verde, líquido no azul).',
          );
        }
      }
    }

    if (dados._parcelasNaoFecham)
      avisosBase.push(
        `⚠️ AS PARCELAS NÃO FECHAM: bruto ${brl(Number(dados.bruto_total) || 0)} menos IR ${brl(Number(dados.ir) || 0)}, ` +
        `INSS ${brl(Number(dados.inss) || 0)} e honorários ${brl(Number(dados.honorarios) || 0)} dá ` +
        `${brl(dados._parcelasNaoFecham.calculado)}, mas o líquido lido dos autos é ${brl(dados._parcelasNaoFecham.declarado)} ` +
        `(diferença de ${brl(Math.abs(dados._parcelasNaoFecham.calculado - dados._parcelasNaoFecham.declarado))}). ` +
        'Algum valor veio de documento diferente dos outros. Confira antes de fechar — o preço foi calibrado sobre o bruto.' +
        (dados.origem_valores ? ` De onde a IA disse que tirou: ${String(dados.origem_valores).slice(0, 300)}` : ''),
      );
    if (Number(dados._sucumbNaoPrevistos) > 0)
      avisosBase.push(
        `⚠️ O card diz "honorários contratuais" e o processo TEM sucumbenciais (${brl(Number(dados._sucumbNaoPrevistos))}), ` +
        'que entraram no preço. Se a cessão for só dos contratuais, o preço está alto nesse valor — ajuste o "PARCELA CEDIDA" do card e rode de novo.',
      );

    const valores = {
      // O bruto QUE PRECIFICOU. Sem isto a tela mostrava o dos autos ao lado de
      // uma base calculada sobre outro valor, e a conta não fechava para quem
      // conferia.
      bruto: Number(dados._valores_precificados?.brutoTotal ?? dados.bruto_total) || 0,
      bruto_autos: Number(dados.bruto_total) || 0,
      auditoria_corte: Number(dados._auditoria_corte) || 0,
      liquido_base: Number(calc.Y3) || 0,
      desagio: Number(calc.desagio) || 0,
      preco_cessao: Number(calc.cessao) || 0,
      comissao: Number(calc.Y5) || 0,
      cartorio: calc.Y10 == null ? null : Number(calc.Y10),
      // O IR retido sobre os honorários. Vai para a tela porque é a diferença
      // entre o honorário que aparece nos autos e o que de fato se compra do
      // advogado — sem mostrá-lo, a base do deságio parece menor do que
      // deveria, sem explicação visível.
      ir_honorarios: Number(dados._ir_honorarios) || 0,
      custo_total: Number(calc.Y4) || 0,
      rentabilidade_mensal: Number(calc.Y9) || 0,
      prazo_meses: Number(T5.toFixed(1)),
      data_pagamento: dados.data_pagamento ?? null,
    };
    // De onde a IA disse que tirou os números. Vai para a tela porque a
    // conferência útil acontece ANTES de salvar, com o processo ainda aberto ao
    // lado — depois vira auditoria, que é mais cara e mais rara.
    const origemValores = dados.origem_valores ? String(dados.origem_valores) : null;

    const cartorioResp = {
      valor: calc.Y10 == null ? '—' : brl(calc.Y10),
      escritura: calc.emolumentos?.escritura == null ? '—' : brl(calc.emolumentos.escritura),
      registro: calc.emolumentos?.registro == null ? '—' : brl(calc.emolumentos.registro),
      faixa: calc.faixaCartorio,
      uf: emolumentos?.uf ?? ufCredito ?? null,
      origem: emolumentos?.origem ?? 'nenhuma',
      fontes: emolumentos?.fontes ?? [],
      // A tela levanta a tabela quando isto vem verdadeiro. Não manda preço:
      // o que se pede é a REGRA do estado, que serve para qualquer valor.
      falta_regra: !emolumentos,
    };

    // A PRELIMINAR: tudo calculado, nada gravado. A pessoa lê, pede mudanças no
    // chat, e só o 'salvar' gera planilha, Drive e anotação.
    // 'reprecificar' entra aqui: é a rodada que refaz as contas depois que a
    // tabela de emolumentos chega, sem tocar na IA — custa milissegundos.
    if (acao === 'analisar' || acao === 'refinar' || acao === 'reprecificar') {
      return jsonResponse({
        ok: true,
        preliminar: true,
        cedente: credorTitulo,
        modelo: dados.modelo === 1 ? 'Modelo 1 (verde)' : 'Modelo 2 (azul)',
        esfera,
        regra_prazo: prazo.regra.descricao,
        prazo_detalhe: prazo.detalhe,
        // O CAMINHO, e não só o número. Prazo é a variável que mais mexe no
        // preço, e sem os atos à vista ele é um número para acreditar ou não.
        // Com eles, a pessoa discorda de um item — "homologação da cessão aqui
        // leva 90 dias" — e pede a correção no chat.
        etapa_atual: dados.etapa_atual ?? null,
        roteiro: prazo.roteiro,
        valores,
        cartorio: cartorioResp,
        origem_valores: origemValores,
        atingiu_alvo: calc.atingiuAlvo !== false,
      // Devolvido para o navegador mandar de volta no próximo pedido do chat, e
      // a função não repetir a busca web. É preço público — não há sigilo aqui.
      emolumentos,
        avisos: avisosBase,
        aviso: avisosBase.length ? avisosBase.join(' ') : null,
        m1_sintese: dados.m1_sintese ?? null,
        riscos: riscosComAuditoria(dados),
        m2: dados.m2 ?? {},
        resposta: respostaRevisao,
        // A análise inteira, para a tela devolver no próximo turno. Opaco para ela.
        dados,
        avisos_qualificacao: avisosQualif,
      });
    }

    // 3e. Gera a planilha colorida
    const templateBytes = await baixarTemplateRpv(sbAdmin);
    const xlsx = await gerarPlanilha(templateBytes, dados, calc, T5);

    // 3f. Sobe no Drive: A. Análises de crédito / {categoria} / {originador} / {credor (Title Case)}
    const token = await refreshGoogleAccessToken(cfg.google_oauth_client_id, cfg.google_oauth_client_secret, cfg.google_oauth_refresh_token);
    const catId = await acharPastaDaCategoria(token, categoria);
    const interId = await driveFindOrCreateFolder(token, originador, catId);
    const cedenteId = await driveFindOrCreateFolder(token, credorTitulo, interId);
    // Nome do arquivo: "Análise de RPV [VERBAS] - CREDOR v. ENTE - NÚMERO"
    //
    // AS VERBAS ENTRAM NO NOME por pedido do dono: o comercial escolhe o arquivo
    // na hora de montar a proposta, e do nome dependia adivinhar se aquela
    // análise era do principal, dos honorários ou dos dois. Duas análises do
    // mesmo processo com cenários diferentes ficavam indistinguíveis na pasta.
    //
    // Fica logo depois de "Análise de RPV", e não no fim: nome de arquivo é
    // truncado pela direita em toda lista, e o que se precisa ler é justamente
    // isto.
    const SIGLA_VERBA: Record<string, string> = {
      principal: 'Principal', contratuais: 'Contratuais', sucumbenciais: 'Sucumbenciais',
    };
    const _verbasNome = (Array.isArray(dados._parcelas) ? dados._parcelas : [])
      .map((p: any) => SIGLA_VERBA[p.nome] ?? p.nome).join(' + ');
    const enteDevedor = String(dados.ente_devedor || '').trim();
    const nomeArquivo = limparNomeArquivo(
      `Análise de RPV${_verbasNome ? ` [${_verbasNome}]` : ''} - ${credorTitulo}` +
      `${enteDevedor ? ` v. ${enteDevedor}` : ''} - ${numeroProcesso}`,
    ) + '.xlsx';
    const up = await driveUploadBytes(token, nomeArquivo, cedenteId, xlsx, XLSX_MIME, true);

    // limpeza best-effort dos uploads
    await limparUploads?.();

    // Avisos: os mesmos da preliminar (avisosBase), montados antes do retorno antecipado.
    const avisos: string[] = [...avisosBase];
    const avisoFinal = avisos.length ? avisos.join(' ') + ' A planilha foi gerada assim mesmo para você conferir à mão.' : null;

    return jsonResponse({
      ok: true,
      cedente: credorTitulo,
      modelo: dados.modelo === 1 ? 'Modelo 1 (verde)' : 'Modelo 2 (azul)',
      desagio: pct(calc.desagio),
      rentabilidade_mensal: pct(calc.Y9),
      cessao: brl(calc.cessao),
      esfera,
      regra_prazo: prazo.regra.descricao,
      valores,
      cartorio: cartorioResp,
      origem_valores: origemValores,
      atingiu_alvo: calc.atingiuAlvo !== false,
      aviso: avisoFinal,
      drive_folder_url: `https://drive.google.com/drive/folders/${cedenteId}`,
      drive_file_url: up.webViewLink ?? null,
      // A LISTA, e não só a frase juntada.
      //
      // `aviso` é os avisos colados num parágrafo — serve para o toast e para
      // nada mais. Quem precisa deles um a um é a anotação do Kommo (leva só
      // os marcados com ⚠️) e a contagem de alertas no painel do card, que
      // lia `avisos` numa resposta que nunca os mandava e por isso nunca
      // aparecia.
      avisos,
      // A FICHA QUE VOLTA PARA O CARD DO KOMMO.
      //
      // O comercial não abre a planilha: ele lê a anotação. Ela dizia só
      // "aprovado" e o link, então saber SOBRE QUE CRÉDITO era a aprovação
      // exigia abrir o Drive. São os campos do cadastro dele, preenchidos com
      // o que a análise leu dos autos — é assim que ele confere o card.
      ficha: {
        tipo: categoria === 'Precatórios' ? 'Precatório' : 'RPV',
        processo: numeroProcesso || String(dados.numero_processo ?? ''),
        tribunal: String(dados.tribunal ?? '').trim(),
        // O TITULAR DO CRÉDITO LIDO DOS AUTOS, e não o do card: é o mesmo nome
        // que nomeia a pasta no Drive, então a ficha e o arquivo não divergem.
        cedente: credorTitulo,
        entidade_devedora: enteDevedor,
        parcela_cedida: String(dados.tipo_credito ?? '').trim(),
        // O VALOR DO CRÉDITO NEGOCIADO, e não o preço: a soma dos líquidos
        // das verbas que entraram no negócio. O preço fica na planilha, que
        // é onde a proposta se monta.
        valor_cedido: Number(calc.Y3) || 0,
        honorarios_pct: dados._hon_pct == null ? null : Number(dados._hon_pct),
      },
      // dados úteis pro .md/.csv (gerados no front ou em passo futuro)
      m1_sintese: dados.m1_sintese ?? null,
      riscos: riscosComAuditoria(dados),
    });
  } catch (e) {
    // As páginas subidas não servem a mais nada: a leitura que as pediu morreu.
    // Sem isto elas ficavam no bucket para sempre — e é justamente no caminho de
    // erro que ninguém olha.
    if (limparUploads) { try { await limparUploads(); } catch (_) { /* ok */ } }
    return errorResponse('Falha ao gerar análise: ' + (e instanceof Error ? e.message : String(e)), 500);
  }
});

// A parseBR ingênua que vivia aqui SAIU. Ela devolvia `Invalid Date` em vez de
// null, e o único lugar que a usava — a data-limite do convênio do TJGO —
// transformava isso num NaN que atravessava o motor inteiro e saía como deságio
// de 95%. Só existe parseDataBR, que devolve null e obriga quem chama a decidir.
