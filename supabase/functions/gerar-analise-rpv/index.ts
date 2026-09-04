// ============================================================================
// Edge Function: gerar-analise-rpv
// ----------------------------------------------------------------------------
// Gêmea da `gerar-contrato`. Recebe o PDF do processo (com os cálculos da contadoria dentro),
// extrai os dados pela IA, calcula a precificação (deságio calibrado p/ >=2,80%),
// gera a planilha de Análise de RPV colorida (ExcelJS) e sobe no Drive em
// A. Análises de crédito / {categoria} / {originador} / {cedente}.
//
// REAPROVEITA helpers idênticos da gerar-contrato (ver bloco "_shared" abaixo).
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from "../_shared/auth.ts";
import { chaveAnthropic, segredoGoogle } from "../_shared/segredos.ts";
import { emolumentoDaTabela, normalizarUf, obterEmolumentos, type TabelaEmolumentos } from "../_shared/emolumentos.ts";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import ExcelJS from 'npm:exceljs@4.4.0';
import { encodeBase64 as b64encode } from "jsr:@std/encoding@1/base64";

// ----------------------------------------------------------------------------
// Helpers compartilhados — em supabase/functions/_shared/credijuris.ts
// (extraídos VERBATIM da gerar-contrato; ver arquivo _shared/credijuris.ts).
// ----------------------------------------------------------------------------

// ======================= HELPERS (extraídos da gerar-contrato) =======================
// ============================================================================
// _shared/credijuris.ts
// Helpers compartilhados, EXTRAÍDOS VERBATIM da função gerar-contrato (testados).
// Importados por gerar-analise-rpv. Não reescrever — fonte única de verdade.
// ============================================================================

// ---- constantes ----
const DRIVE_ROOT_NAME = 'Credijuris - Atualizado';
const DRIVE_ANALISES_NAME = 'A. Análises de crédito';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// ---- tipos ----
type SB = SupabaseClient<any, any, any>;
interface DriveFile { id: string; name: string; mimeType?: string; parents?: string[] }

// ---- helpers ----

function normalizar(s: string): string {
  // Lowercase, sem acento, sem pontuação — pra busca.
  // O range ̀-ͯ cobre as combining marks (NFD separa "á" em "a"+◌́);
  // usar escapes Unicode em vez de caracteres literais sobrevive a deploys que
  // corrompam encoding (cmd → CP1252 → Deno UTF-8 invalidaria chars literais).
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[.\-/() ]/g, '');
}

function escapeDriveQuery(s: string): string {
  return s.replace(/'/g, "\\'");
}

async function storageGetBytes(sb: SB, bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error) throw new Error(`Storage download falhou (${bucket}/${path}): ${error.message}`);
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

async function refreshGoogleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google OAuth refresh falhou (${res.status}): ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('Google OAuth: sem access_token na resposta');
  return data.access_token as string;
}

async function driveListFiles(
  token: string,
  query: string,
  driveId?: string,
): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,mimeType,parents)',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '1000',
  });
  if (driveId) {
    params.set('corpora', 'drive');
    params.set('driveId', driveId);
  } else {
    params.set('corpora', 'allDrives');
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Drive list (${res.status}): ${txt.slice(0, 300)} | query=${query}`);
  }
  const data = await res.json();
  return data.files || [];
}

async function driveFindSharedDrive(token: string, name: string): Promise<{ id: string; name: string } | null> {
  let pageToken: string | undefined;
  while (true) {
    const params = new URLSearchParams({ fields: 'nextPageToken,drives(id,name)' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/drives?${params}`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) {
      // pode não ter permissão de listar drives — não é fatal, segue pra busca normal
      return null;
    }
    const data = await res.json();
    for (const d of (data.drives || [])) if (d.name === name) return d;
    pageToken = data.nextPageToken;
    if (!pageToken) return null;
  }
}

async function driveFindChild(token: string, name: string, parentId: string, mime?: string): Promise<DriveFile | null> {
  let q = `name = '${escapeDriveQuery(name)}' and '${parentId}' in parents and trashed = false`;
  if (mime) q += ` and mimeType = '${mime}'`;
  const files = await driveListFiles(token, q);
  return files[0] || null;
}

async function driveCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Drive criar pasta '${name}' (${res.status}): ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.id;
}

async function driveFindOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const existing = await driveFindChild(token, name, parentId, FOLDER_MIME);
  if (existing) return existing.id;
  return driveCreateFolder(token, name, parentId);
}

async function driveFindChildByTolerantName(
  token: string,
  parentId: string,
  needle: string,
  mustBeFolder = true,
): Promise<DriveFile | null> {
  let q = `'${parentId}' in parents and trashed = false`;
  if (mustBeFolder) q += ` and mimeType = '${FOLDER_MIME}'`;
  const files = await driveListFiles(token, q);
  const n = normalizar(needle);
  return files.find(f => normalizar(f.name) === n)
      ?? files.find(f => normalizar(f.name).includes(n))
      ?? null;
}

async function driveEncontrarAnalisesRoot(token: string): Promise<string> {
  const drive = await driveFindSharedDrive(token, DRIVE_ROOT_NAME);
  if (drive) {
    const child = await driveFindChildByTolerantName(token, drive.id, DRIVE_ANALISES_NAME);
    if (child) return child.id;
    throw new Error(`Shared Drive '${DRIVE_ROOT_NAME}' achado, mas pasta '${DRIVE_ANALISES_NAME}' não existe nele.`);
  }
  const roots = await driveListFiles(token, `name = '${escapeDriveQuery(DRIVE_ROOT_NAME)}' and trashed = false and mimeType = '${FOLDER_MIME}'`);
  if (!roots[0]) throw new Error(`'${DRIVE_ROOT_NAME}' não encontrado no Drive. Confirma que a conta do refresh_token tem acesso.`);
  const child = await driveFindChildByTolerantName(token, roots[0].id, DRIVE_ANALISES_NAME);
  if (!child) throw new Error(`Pasta '${DRIVE_ANALISES_NAME}' não existe dentro de '${DRIVE_ROOT_NAME}'.`);
  return child.id;
}

async function driveListarOriginadoresAnalise(token: string, categoria: string): Promise<string[]> {
  const analisesRootId = await driveEncontrarAnalisesRoot(token);
  const catFolder = await driveFindChildByTolerantName(token, analisesRootId, categoria);
  if (!catFolder) return [];
  const subs = await driveListFiles(token, `'${catFolder.id}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`);
  return subs.map(s => s.name).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function driveUploadBytes(
  token: string,
  name: string,
  parentId: string,
  bytes: Uint8Array,
  mime: string,
  sobrescrever = true,
): Promise<{ id: string; webViewLink?: string }> {
  if (sobrescrever) {
    const existing = await driveFindChild(token, name, parentId);
    if (existing) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${existing.id}?supportsAllDrives=true`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
    }
  }
  // Multipart upload (mais simples que resumable pra arquivos pequenos)
  const boundary = '-------cred' + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({ name, parents: [parentId] });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Drive upload '${name}' (${res.status}): ${txt.slice(0, 300)}`);
  }
  return await res.json();
}
// ===================== FIM DOS HELPERS COMPARTILHADOS =====================


// ============================================================================
// Constantes
// ============================================================================
const CLAUDE_MODEL = 'claude-opus-4-5';
const CLAUDE_MAX_TOKENS = 16000;                 // extração da análise é grande (M1+M2+M4)
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BUCKET_INPUT = 'analises-input';            // bucket novo (criar no painel)
const BUCKET_TEMPLATES = 'contratos-templates';  // MESMO bucket de templates da gerar-contrato
const TEMPLATE_NOME = 'Modelo_Analise_de_RPV.xlsx';  // sem acento — Supabase rejeita acento no nome
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

// EMOLUMENTOS DE CARTÓRIO: vêm de _shared/emolumentos.ts, por UF do tribunal.
//
// Aqui havia uma tabela fixa — a de Virginópolis-MG (Portaria 8.664/CGJ/2025) —
// aplicada a crédito de qualquer estado. Emolumento é preço público fixado por
// cada Tribunal de Justiça, e a diferença entre estados não é arredondamento.
// A tabela agora é a do estado onde o crédito tramita, achada pela IA na fonte
// oficial e guardada em cache por UF/ano (migração 0053). Ver ufDoCredito.

// Prazo em meses (linhas 21–33 do template). Cenário A = RPV não expedida; B = já expedida.
// Piso de 6 meses. T5/T42 SEMPRE vêm daqui — nunca de prazos de convênio inventados.
function prazoMeses(o: {
  serventiaDias: number; gabineteDias: number; scenario: 'A' | 'B';
  dataAquisicao: Date; dataFatalConvenio?: Date; diasAlvaraFixo?: number; periodoGraca?: number;
}): number {
  const sg = o.serventiaDias + o.gabineteDias;       // A17 + C17
  const c21 = sg, c22 = sg, c25 = sg, c26 = sg;
  const c27 = o.serventiaDias * 1.5;
  const c24 = o.periodoGraca ?? 60;
  let dias: number;
  if (o.scenario === 'A') {
    // e23 = dias até a expedição/pagamento da RPV. Quando o tribunal tem convênio com
    // data-limite para expedir (o TJGO tem, com 60 dias), usa essa data; a maioria dos
    // tribunais não tem -> estima pelo período de graça padrão, e a resposta avisa.
    const e23 = o.dataFatalConvenio
      ? Math.round((o.dataFatalConvenio.getTime() - o.dataAquisicao.getTime()) / 86400000)
      : (o.periodoGraca ?? 60);
    dias = c21 + c22 + e23 + c24 + c25 + c26 + c27;
  } else {
    dias = c21 + c22 + (o.diasAlvaraFixo ?? 21) + c24 + c25 + c26 + c27;
  }
  return Math.max(6, dias / 30);
}

// Modelo 1 (verde) se há honorários contratuais a destacar; senão Modelo 2 (azul).
function escolherModelo(honorariosContratuais: number): 1 | 2 {
  return honorariosContratuais > 0 ? 1 : 2;
}

// Calibra o MENOR deságio (mesmo % no principal e nos honorários) p/ rentab. mensal >= alvo.
// NUNCA lança erro: se nem no deságio máximo (95%) der pra atingir o alvo, devolve o MELHOR
// caso (maior rentabilidade) com atingiuAlvo=false, pra a planilha sempre ser gerada.
// Regra INSS (SÓ Estado de Goiás): horas extras com INSS zerado pela contadoria levam reserva de 14,25%,
// a alíquota da GOIASPREV (feito no extrator; ver ehEstadoDeGoias). Outros entes: sem reserva, com aviso.
function calibrarDesagio(o: {
  brutoTotal: number; honorarios: number; ir: number; inss: number;
  T5: number; modelo: 1 | 2; comissaoPct?: number; diligencia?: number; alvo?: number;
  /** Tabela de emolumentos da UF do tribunal; null = desconhecida (precifica sem cartório, e avisa). */
  tabela: TabelaEmolumentos | null;
}) {
  const alvo = o.alvo ?? 0.028;
  const dilig = o.diligencia ?? 250;
  // L5 = principal líquido; L7 = honorários (no Modelo 2, L7 é deduzido mas não adquirido)
  const L5 = o.brutoTotal - (o.ir + o.inss + o.honorarios);
  const L7 = o.honorarios;
  // Base e cessão dependem do modelo:
  //   Modelo 1: Y3 = L5+L7 ; cessão = (L5+L7)*(1-d)
  //   Modelo 2: Y3 = L5    ; cessão = L5*(1-d)
  const baseY3 = o.modelo === 1 ? L5 + L7 : L5;
  const Y5 = (o.comissaoPct ?? 0.09) * baseY3;

  // CARTÓRIO DESCONHECIDO ENTRA COMO ZERO, E MARCADO. Antes, deságio cuja cessão
  // caía fora da tabela era simplesmente pulado — e se TODOS caíssem fora, o
  // motor devolvia 95% de deságio, que é preço nenhum. Agora a calibragem sempre
  // fecha: sem tabela, precifica sem o cartório e diz isso em Y10 (null) e no
  // aviso. É a convenção que já valia para "acima de R$ 28 mil": confirmar com
  // o cartório. O preço sai um pouco otimista e a pessoa soma o custo à mão —
  // melhor que nenhum preço, e muito melhor que um preço com cartório inventado.
  const avaliar = (d: number) => {
    const cessao = o.modelo === 1 ? (L5 + L7) * (1 - d) : L5 * (1 - d);
    const emol = emolumentoDaTabela(o.tabela, cessao);
    const Y4 = cessao + Y5 + (emol.total ?? 0) + dilig;
    const Y9 = Math.pow(baseY3 / Y4, 1 / o.T5) - 1;
    return { d, cessao, emol, Y4, Y9 };
  };
  const montar = (r: any, atingiuAlvo: boolean) => ({
    desagio: r.d, L5, L7, Y3: baseY3, Y5,
    S5: L5 * (1 - r.d),
    S7: o.modelo === 1 ? L7 * (1 - r.d) : 0,
    cessao: r.cessao, Y10: r.emol.total, faixaCartorio: r.emol.descricao,
    emolumentos: { escritura: r.emol.escritura, registro: r.emol.registro },
    Y4: r.Y4, Y9: r.Y9,
    desagioEfetivo: 1 - r.cessao / baseY3, atingiuAlvo,
  });

  let melhor: any = null;                          // maior rentabilidade (fallback quando nada bate o alvo)
  for (let d = 0; d <= 0.95 + 1e-9; d += 0.0001) {
    const r = avaliar(d);
    if (r.Y9 >= alvo) return montar(r, true);      // 1º deságio que bate o alvo = menor deságio
    if (!melhor || r.Y9 > melhor.Y9) melhor = r;
  }
  return montar(melhor, false);                    // não bateu o alvo nem a 95%: melhor caso + flag
}

/**
 * A UF do tribunal onde o crédito tramita — é a tabela de emolumentos dela que vale.
 *
 * Primeiro o que a IA leu dos autos (uf_tramitacao: a comarca ou a seção
 * judiciária está sempre no cabeçalho); senão, a sigla do tribunal quando é
 * estadual (TJGO -> GO). TRF e TRT cobrem vários estados, então sem a UF dos
 * autos não há como saber — e aí a resposta é null, com aviso, não um chute.
 */
function ufDoCredito(dados: any): string | null {
  const lida = normalizarUf(dados?.uf_tramitacao);
  if (lida) return lida;
  const m = /^TJ([A-Z]{2})$/.exec(String(dados?.tribunal || '').toUpperCase().trim());
  return m ? normalizarUf(m[1]) : null;
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

  // Sim/Não — aplica em toda a faixa de respostas (só pinta onde o texto casa)
  add('B12:B43', [
    { f: '$B9="Sim"', cor: COR.verde },
    { f: '$B9="Não"', cor: COR.vermelho },
  ]);
  // B20 — tipo de sentença
  add('B23', [
    { f: '$B23="Procedência"', cor: COR.verde },
    { f: '$B23="Improcedência"', cor: COR.vermelho },
    { f: '$B23="Procedência parcial"', cor: COR.azul },
    { f: '$B23="Homologatória de acordo"', cor: COR.roxo },
  ]);
  // B21 — líquida/ilíquida
  add('B24', [
    { f: '$B24="Líquida"', cor: COR.verde },
    { f: '$B24="Iliquída"', cor: COR.vermelho },
  ]);
  // B25 — valor apresentado / execução invertida
  add('B28', [
    { f: '$B28="Valor apresentado no CS"', cor: COR.roxo },
    { f: '$B28="Execução invertida"', cor: COR.azul },
  ]);
  // B27 — cenários de execução invertida (cinza p/ qualquer preenchimento)
  add('B30', [{ f: '$B30<>""', cor: COR.cinza }]);
  // B39 — expedição
  add('B42', [
    { f: '$B42="Minuta de RPV"', cor: COR.laranja },
    { f: '$B42="RPV"', cor: COR.verde },
    { f: '$B42="Alvará de pagamento"', cor: COR.azul },
    { f: '$B42="Sem expedição"', cor: COR.roxo },
  ]);
  // B40 — necessidade de alvará
  add('B43', [
    { f: '$B43="Não precisa de alvará"', cor: COR.azul },
    { f: '$B43="Precisa de alvará"', cor: COR.roxo },
  ]);
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

// dados = saída do extrator. Estrutura em SCHEMA_ANALISE (abaixo).
async function gerarPlanilha(templateBytes: Uint8Array, dados: any, calc: any, T5: number): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBytes as any);

  const aj = wb.getWorksheet('Análise jurídica')!;
  const MODELO1 = 'Quando o principal e honorários';
  const MODELO2 = 'Quando apenas o crédito princip';

  // ---------------- Aba jurídica: cabeçalho ----------------
  aj.getCell('C1').value = dados.numero_processo ?? '';
  aj.getCell('C2').value = dados.originador ?? '';
  // C3/C4/C5 agora são sub-rótulos (Crédito principal / Honorários contratuais / Honorários sucumbenciais) na planilha nova — NÃO sobrescrever.
  aj.getCell('C6').value = dados.cedente_cpf ?? '';
  aj.getCell('C7').value = dados.advogado_oab ?? '';
  aj.getCell('C8').value = dados.tribunal ?? '';

  // ---------------- Aba jurídica: respostas M2 (col B) + complementos (col D) ----------------
  // dados.m2 = { "12": {resposta, complemento}, ... } indexado pela LINHA da planilha (perguntas 12..43)
  const PULAR_LINHA = new Set([29]);       // 26 = bloco fixo "CUIDADO" (mesclado A26:D26) — nunca escrever
  const SEM_COMPLEMENTO = new Set([32]);   // 29: C29:D29 já é mesclado (instrução) — não gravar D29
  for (const [linha, item] of Object.entries<any>(dados.m2 || {})) {
    const r = Number(linha);
    if (PULAR_LINHA.has(r)) continue;
    if (item?.resposta != null && item.resposta !== '') aj.getCell(`B${r}`).value = item.resposta;
    // complemento só quando houver (regra: "Não" => D vazio; nada de "não encontrado")
    if (!SEM_COMPLEMENTO.has(r) && item?.complemento != null && item.complemento !== '') aj.getCell(`D${r}`).value = reformatarMoeda(item.complemento);
  }

  // bloco do valor final (B41) — espelha D37/B43 da metodologia
  aj.getCell('B44').value =
    `VALOR TOTAL BRUTO: ${brl(dados.bruto_total)}\n` +
    `Valor principal líquido: ${brl(calc.L5)}\n` +
    `Valor dos honorários contratuais: ${brl(calc.L7)}`;

  aplicarCoresJuridica(aj);

  // ---------------- Aba do modelo escolhido: precificação ----------------
  const m = wb.getWorksheet(dados.modelo === 1 ? MODELO1 : MODELO2)!;
  m.getCell('K5').value = dados.bruto_total;
  m.getCell('M5').value = dados.ir;
  m.getCell('N5').value = dados.inss;
  if (dados._soHonorarios) {
    m.getCell('L7').value = 0;                          // adquirindo só honorários: sem sub-honorários
    m.getCell('G5').value = 'Honorários Contratuais';   // natureza do que está sendo adquirido
  } else if (dados.modelo === 1) {
    m.getCell('L7').value = dados.honorarios;           // M1: honorários adquiridos (contadoria ou % informado)
    m.getCell('R7').value = calc.desagio;               // mesmo deságio no principal e honorários
  } else if (dados._honPctInformado) {
    m.getCell('L7').value = dados.honorarios;           // M2 com % informado: aplica a dedução de honorários calculada
  }
  m.getCell('R5').value = calc.desagio;
  m.getCell('T5').value = Number(T5.toFixed(4));
  m.getCell('I5').value = dados.data_aquisicao;        // DD/MM/AAAA (hoje)
  m.getCell('J5').value = dados.data_pagamento;        // hoje + T5 meses (último dia do mês)
  m.getCell('A17').value = dados.serventia_dias;       // M4
  m.getCell('C17').value = dados.gabinete_dias;        // M4
  m.getCell('W10').value = calc.Y10;                   // emolumento cartório (coluna W, após remover as colunas U e V)

  // Processo e Resumo (M1) no bloco de cima (B4 mesclado B4:B7, C4 mesclado C4:C7)
  m.getCell('B4').value = dados.numero_processo ?? '';
  m.getCell('C4').value = dados.m1_sintese ?? '';

  // Credor / Advogado / Ente / Fase processual (bloco de cima: linha 5 = principal, linha 7 = honorários)
  m.getCell('D5').value = dados._credor_titulo ?? dados.credor_nome ?? '';  // REQUERENTE (credor)
  m.getCell('D7').value = dados.advogado_nome ?? '';                        // ADVOGADO(A)
  m.getCell('F5').value = dados.ente_devedor ?? '';                        // Ente devedor
  m.getCell('F7').value = dados.ente_devedor ?? '';
  m.getCell('H5').value = dados.fase_processual ?? '';                     // Fase processual
  m.getCell('H7').value = dados.fase_processual ?? '';

  // Rótulo correto do bloco mantido (o bloco de cima fica para ambos os modelos)
  m.getCell('A1').value = dados.modelo === 1
    ? 'MODELO 1 (VERDE): USADO PARA QUANDO OS HONORÁRIOS FORAM DESTACADOS NA RPV OU NOS CÁLCULOS DA CONTADORIA JUDICIAL'
    : 'MODELO 2 (AZUL): USADO PARA QUANDO OS HONORÁRIOS NÃO FORAM DESTACADOS NA RPV OU NOS CÁLCULOS DA CONTADORIA JUDICIAL';

  // Apaga o bloco de baixo (sempre não usado: linhas 38-73). Desmescla primeiro p/ não corromper.
  try {
    const merges: string[] = ((m as any).model?.merges || []).slice();
    for (const rng of merges) {
      const mm = /[A-Z]+(\d+):[A-Z]+(\d+)/.exec(String(rng));
      if (mm && Number(mm[1]) >= 38) { try { (m as any).unMergeCells(rng); } catch (_) { /* ok */ } }
    }
  } catch (_) { /* ok */ }
  // spliceRows em bloco falha quando há mescladas; remove uma linha por vez, de baixo p/ cima (funciona)
  for (let r = m.rowCount; r >= 38; r--) m.spliceRows(r, 1);

  // Apaga a aba do outro modelo (não usada)
  wb.removeWorksheet(wb.getWorksheet(dados.modelo === 1 ? MODELO2 : MODELO1)!.id);

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
  uf_tramitacao: 'UF (sigla de 2 letras) onde o processo tramita — a da comarca, vara ou seção judiciária do cabeçalho, ex.: "GO", "SP". Indispensável em TRF e TRT, que cobrem vários estados',
  cedente_cpf: 'nome do cedente e CPF',
  advogado_oab: 'nome do advogado/escritório e OAB/CNPJ',
  credor_nome: 'nome completo do credor/cedente SEM o CPF (ex.: "Vanderlan Gomes de Morais")',
  advogado_nome: 'nome do advogado ou escritório SEM OAB/CNPJ',
  ente_devedor: 'ente devedor (quem vai pagar o crédito), ex.: "Estado de Goiás", "Estado de São Paulo", "Município de Belo Horizonte", "União", "INSS", "Fazenda Pública do Estado do Paraná"',
  fase_processual: 'fase processual atual resumida em poucas palavras, ex.: "Cumprimento de sentença", "Aguardando expedição de RPV", "RPV expedida", "Trânsito em julgado"',
  tipo_credito: 'um de: "Apenas o crédito principal" | "Crédito principal e honorários" | "Apenas os honorários"',

  // financeiro (dos cálculos da contadoria dentro do PDF)
  bruto_total: 'valor bruto total (principal + juros + Selic), número sem R$',
  principal_liquido: 'valor principal líquido após IR/INSS, número',
  honorarios: 'HONORÁRIOS CONTRATUAIS A DESTACAR (0 se não houver), número',
  ir: 'IR retido, número (0 se isento)',
  inss: 'INSS/contribuição previdenciária retida conforme os cálculos da contadoria, número (0 se zerado)',
  eh_horas_extras: 'true/false — se o crédito é de horas extras',

  // prazo / cenário
  rpv_ja_expedida: 'true se a RPV já foi expedida (cenário B); false se ainda não (cenário A)',
  data_fatal_convenio: 'se cenário A E o tribunal tem convênio com data-limite para expedir a RPV (o TJGO tem): a data (DD/MM/AAAA); null nos demais tribunais — não invente uma',

  // M4 — médias de tempo (em DIAS). Devolver também os pares para auditoria.
  serventia_dias: 'tempo médio da serventia em dias (média dos pares petição→conclusão)',
  gabinete_dias: 'tempo médio do gabinete em dias (média dos pares conclusão→decisão)',
  m4_pares: 'lista de pares {de, ate, dias, tipo:"serventia"|"gabinete"} usados na média',

  // M2 — 25 respostas. Chave = nº da linha na aba jurídica (12..43).
  m2: 'objeto { "9": {"resposta":"Sim/Não/...", "complemento":"data DD/MM/AAAA ou valor R$ ou vazio"}, ... } cobrindo as linhas 12 a 43',

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
  'Para os demais créditos, siga os cálculos da contadoria. ' +
  'O valor bruto = principal + juros + Selic. Os tempos do M4 são médias de pares de datas reais do andamento processual. ' +
  '=== MAPA EXATO DO M2 (objeto "m2"; a chave é o NÚMERO DA LINHA na aba jurídica) === ' +
  'Para cada linha, "resposta" vai na coluna B e "complemento" (quando o item pedir) vai na coluna D. ' +
  'Use SEMPRE os valores EXATOS das listas suspensas quando indicado — a coluna B só aceita esses valores. ' +
  'Datas em DD/MM/AAAA. Valores monetários SEMPRE em Real no padrão brasileiro: VÍRGULA como separador decimal e PONTO como separador de milhar, com prefixo R$ (ex.: R$ 1.234,56). NUNCA use ponto como separador decimal. Se a resposta for "Não", deixe o complemento vazio. ' +
  'Se o dado não estiver claro, deixe vazio (NUNCA escreva "não encontrado"/"verificar" no complemento). ' +
  '12: "Histórico do cedente: tem dívida?" -> Sim/Não; complemento: se Sim, números dos processos. ' +
  '13: "Histórico do advogado: tem dívida?" -> Sim/Não; complemento: se Sim, números dos processos. ' +
  '14: "Nesse tribunal, precisa de registro público?" -> Sim/Não; complemento: se Sim, link da jurisprudência. ' +
  '15: "Qual é o tipo da ação?" -> TEXTO livre (ex.: "ação de cobrança de horas extras de piso de magistério"); sem complemento. ' +
  '16: "Esse tipo de crédito pode ser negociado pela jurisprudência?" -> Sim/Não; complemento: se Sim, link. ' +
  '17: "Quem é o polo ativo?" -> TEXTO (nome); sem complemento. ' +
  '18: "O polo ativo é maior de idade?" -> Sim/Não. ' +
  '19: "O polo ativo possui prioridade legal (60+/doença grave/PCD)?" -> Sim/Não; complemento: qual(is). ' +
  '20: "Possui curatela ou tutela?" -> Sim/Não; complemento: nome do curador/tutor. ' +
  '21: "Quem está sendo processado?" -> TEXTO (ente); sem complemento. ' +
  '22: "Houve sentença?" -> Sim/Não; complemento: data. ' +
  '23: "Tipo da sentença" -> um EXATO de: Improcedência | Procedência | Procedência parcial | Homologatória de acordo. ' +
  '24: "A sentença é líquida ou ilíquida?" -> um EXATO de: Líquida | Iliquída; complemento: se Líquida, o valor. ' +
  '25: "Houve recurso?" -> Sim/Não; complemento: resultado e data do julgamento. ' +
  '26: "Houve trânsito em julgado?" -> Sim/Não; complemento: data. ' +
  '27: "Iniciou o cumprimento de sentença?" -> Sim/Não; complemento: data do peticionamento. ' +
  '28: "Foi apresentado valor no CS ou solicitado execução invertida?" -> um EXATO de: Valor apresentado no CS | Execução invertida. ' +
  '29: BLOCO FIXO "CUIDADO" — NÃO é pergunta. NÃO inclua a chave "29" no m2. ' +
  '30: "Em caso de execução invertida, qual cenário?" (só se foi execução invertida; senão vazio) -> um EXATO de: ' +
  '"Executado não apresentou valores e prazo ainda em curso" | "Executado não apresentou valores, prazo decorrido, sem manifestação da parte exequente" | ' +
  '"Executado não apresentou valores, prazo decorrido, já houve manifestação da parte exequente" | "Executado apresentou valores". ' +
  '31: "Em CS ordinário, a parte apresentou valor?" -> Sim/Não; complemento: valor total. ' +
  '32: "Houve impugnação ao valor?" -> Sim/Não; NÃO preencha complemento aqui (a data vai na linha 33). ' +
  '33: datas da impugnação -> resposta: se houve, a data da impugnação; complemento: se NÃO houve, a data do decurso do prazo. ' +
  '34: "Data da manifestação de concordância" -> resposta: a data (se houve concordância); sem complemento. ' +
  '35: "Houve homologação do valor (e impugnação resolvida)?" -> Sim/Não; complemento: data da homologação. ' +
  '36: "Existe contrato de honorários contratuais nos autos?" -> Sim/Não; complemento: data do contrato. ' +
  '37: "Contadoria judicial se manifestou?" -> Sim/Não; complemento: data da juntada dos cálculos. ' +
  '38: "Houve pedido de destaque de honorários contratuais?" -> Sim/Não; complemento: valor dos honorários destacados e o valor principal. ' +
  '39: "A manifestação da contadoria foi homologada/precluiu o prazo?" -> Sim/Não; complemento: data. ' +
  '40: "RPV foi mandada para expedição?" -> Sim/Não; complemento: data da decisão. ' +
  '41: "Nesse tribunal, é a serventia que expede ou outro órgão?" -> TEXTO (ex.: "Serventia" ou o órgão); complemento: números dos processos usados. ' +
  '42: "Houve expedição de documento?" -> um EXATO de: Minuta de RPV | RPV | Alvará de pagamento | Sem expedição; complemento: data do documento. ' +
  '43: "Nesse tribunal, precisa emitir alvará ou só a RPV?" -> um EXATO de: Não precisa de alvará | Precisa de alvará; complemento: números dos processos usados.';

async function extrairAnalise(apiKey: string, contentBlocks: any[]): Promise<any> {
  const userContent = [
    ...contentBlocks,
    { type: 'text', text: 'Extraia os dados e retorne APENAS este JSON preenchido (sem markdown, sem comentários):\n' + JSON.stringify(SCHEMA_ANALISE, null, 2) },
  ];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: CLAUDE_MAX_TOKENS, system: SYSTEM_ANALISE, messages: [{ role: 'user', content: userContent }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const block = data.content?.find((c: { type: string }) => c.type === 'text');
  if (!block) throw new Error('Claude retornou sem bloco de texto');
  let raw: string = block.text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* ainda incompleto */ } }
    throw new Error('A IA retornou um JSON INCOMPLETO (provável corte por tamanho da resposta). Início da resposta: ' + raw.slice(0, 200));
  }
}

// ---- PORTÃO 1: chamada de IA + decisão ----
async function extrairQualificacao(apiKey: string, contentBlocks: any[]): Promise<any> {
  const userContent = [
    ...contentBlocks,
    { type: 'text', text: 'Faça a QUALIFICAÇÃO e retorne APENAS este JSON preenchido (sem markdown, sem comentários):\n' + JSON.stringify(SCHEMA_QUALIFICACAO, null, 2) },
  ];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4000, system: SYSTEM_QUALIFICACAO, messages: [{ role: 'user', content: userContent }] }),
  });
  if (!res.ok) throw new Error(`Claude API (qualificação) ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const block = data.content?.find((c: { type: string }) => c.type === 'text');
  if (!block) throw new Error('Claude retornou sem bloco de texto (qualificação)');
  let raw: string = block.text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* ainda incompleto */ } }
    throw new Error('A IA (qualificação) retornou um JSON INCOMPLETO (provável corte por tamanho). Início: ' + raw.slice(0, 200));
  }
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
function ehEstadoDeGoias(...candidatos: unknown[]): boolean {
  return candidatos.some((c) => {
    const t = String(c ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return /estado\s+d[eo]\s+goias/.test(t) || /fazenda\s+(publica\s+)?d[eo]\s+estado\s+d[eo]\s+goias/.test(t);
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
  const valor = Number(q.valor_credito);
  const temValor = !isNaN(valor) && valor > 0;
  const tipo = String(q.tipo_requisitorio || '').toLowerCase();
  const isPrecatorio = tipo.includes('precat');
  const isRPV = tipo === 'rpv' || tipo.includes('rpv');
  const expedido = ehSim(q.requisitorio_expedido);
  if (temValor) {
    if (isPrecatorio) {
      if (valor <= 100000) motivos.push('Valor do precatório igual ou abaixo de R$ 100 mil (mínimo exigido para precatório).');
    } else {
      // RPV, ou ainda não expedido (só cálculo homologado) -> piso de R$ 20 mil
      if (valor < 20000) motivos.push('Valor abaixo de R$ 20 mil (mínimo exigido para RPV).');
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
const MAX_DOC_CHARS = 420000; // ~150-160k tokens (texto jurídico pt-BR é denso); deixa folga p/ o system prompt + a saída (Opus = 200k)
const MARCA_CORTE = 'TRECHO INTERMEDIÁRIO OMITIDO POR TAMANHO';

// Corta textos muito grandes mantendo INÍCIO e FINAL (a inicial fica no começo; cálculos da contadoria e expedição costumam ficar no fim).
function capTextoDoc(txt: string): string {
  if (txt.length <= MAX_DOC_CHARS) return txt;
  const head = Math.floor(MAX_DOC_CHARS * 0.5);
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
// hoje + meses, ajustado pro ÚLTIMO dia do mês resultante
function dataPagamento(meses: number): string {
  const d = new Date();
  const alvo = new Date(d.getFullYear(), d.getMonth() + Math.floor(meses) + 1, 0); // dia 0 do mês seguinte = último dia
  return `${String(alvo.getDate()).padStart(2, '0')}/${String(alvo.getMonth() + 1).padStart(2, '0')}/${alvo.getFullYear()}`;
}

// ============================================================================
// Handler
// ============================================================================


/* ===== Teto da RPV por ente (tabela do jurídico). Alerta, NÃO impeditivo. ===== */
const TETOS_RPV: Record<string, { est: number | null; mun: number | null }> = {"PE": {"est": 64840.0, "mun": 48630.0}, "PA": {"est": 48630.0, "mun": 48630.0}, "AM": {"est": 32420.0, "mun": 24315.0}, "DF": {"est": 32420.0, "mun": null}, "MA": {"est": 32420.0, "mun": 8475.55}, "RJ": {"est": 32420.0, "mun": 16210.0}, "RN": {"est": 32420.0, "mun": 16210.0}, "MS": {"est": 27655.5, "mun": 10099.18}, "RR": {"est": 27557.0, "mun": 24315.0}, "MG": {"est": 27345.69, "mun": 8475.55}, "MT": {"est": 26010.0, "mun": 8475.55}, "PR": {"est": 24782.81, "mun": 8537.55}, "ES": {"est": 21827.28, "mun": 48630.0}, "SP": {"est": 16913.0, "mun": 31667.41}, "AP": {"est": 16210.0, "mun": 48630.0}, "BA": {"est": 16210.0, "mun": 11010.97}, "GO": {"est": 16210.0, "mun": 48630.0}, "PB": {"est": 16210.0, "mun": 8475.55}, "RS": {"est": 16210.0, "mun": 48630.0}, "RO": {"est": 16210.0, "mun": 16210.0}, "SC": {"est": 16210.0, "mun": 8475.55}, "TO": {"est": 16210.0, "mun": 24315.0}, "CE": {"est": 15746.8, "mun": 8475.55}, "AC": {"est": 11347.0, "mun": 16210.0}, "AL": {"est": 8475.55, "mun": 21073.0}, "PI": {"est": 8475.55, "mun": 11347.0}, "SE": {"est": 8475.55, "mun": 8475.55}};
function _brlTeto(n: number): string {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Compara o valor bruto com o teto da RPV do ente. Devolve o aviso (ou null se estiver dentro do teto).
function checarTetoRPV(esfera: string | undefined, tribunal: string | undefined, bruto: number): string | null {
  const SM = 1621; // salário mínimo usado na tabela de tetos (teto federal = 60 x SM)
  const esf = String(esfera || '').toLowerCase();
  const trib = String(tribunal || '').toUpperCase();
  if (!bruto || bruto <= 0) return null;
  let teto: number | null = null;
  let ref = '';
  if (esf.includes('federal') || /^TRF/.test(trib) || trib === 'STJ' || trib === 'STF') {
    teto = 60 * SM; ref = 'federal (60 salários mínimos)';
  } else {
    const uf = trib.replace(/^TJ/, '').slice(0, 2);
    const t = TETOS_RPV[uf];
    if (!t) return null; // ente não localizado na tabela -> não arrisca um alerta errado
    if (esf.includes('municipal')) { teto = t.mun; ref = `municipal (referência: capital de ${uf})`; }
    else { teto = t.est; ref = `estadual (${uf})`; }
  }
  if (teto == null || bruto <= teto) return null;
  return `⚠️ ATENÇÃO — TETO DA RPV: o valor bruto (${_brlTeto(bruto)}) EXCEDE o teto da RPV ${ref} (${_brlTeto(teto)}). Isso NÃO impede a operação, mas será necessária a RENÚNCIA ao valor que excede o teto para receber como RPV — o operacional deve avaliar.`;
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    // 1. Auth (JWT do usuário)
    const user = await getCallerAtivo(req, serviceClient());
    if (!user) return errorResponse(ERRO_ACESSO, 401);
    const userId = user.id;

    let body: any;
    try { body = await req.json(); } catch { return errorResponse('Corpo da requisição inválido/incompleto (o texto do processo pode ter chegado cortado).', 400); }
    const categoria: string = resolverCategoria(body.categoria);  // "RPV" -> "Requisições de Pequeno Valor"

    // service-role: lê secrets de configuracoes
    const sbAdmin = serviceClient();
    const _google = await segredoGoogle();
    const cfg: Record<string, string> = {
      anthropic_api_key: (await chaveAnthropic()) ?? '',
      google_oauth_client_id: _google?.client_id ?? '',
      google_oauth_client_secret: _google?.client_secret ?? '',
      google_oauth_refresh_token: _google?.refresh_token ?? '',
    };

    // 2. Ação leve: listar originadores (popular dropdown do front)
    //
    // O nome antigo do papel ('intermediador') segue aceito aqui e no campo
    // abaixo: esta função é chamada por HTTP e não há como saber, de dentro do
    // repositório, se alguma automação de fora ainda manda o nome velho. Sem a
    // tolerância, a falha seria silenciosa — o arquivamento no Drive
    // simplesmente deixaria de acontecer.
    if (body.acao === 'listar_originadores' || body.acao === 'listar_intermediadores') {
      const token = await refreshGoogleAccessToken(cfg.google_oauth_client_id, cfg.google_oauth_client_secret, cfg.google_oauth_refresh_token);
      const originadores = await driveListarOriginadoresAnalise(token, categoria);
      return jsonResponse({ ok: true, originadores });
    }

    // 3. Job principal
    const jobId: string = body.job_id;
    const originador: string = body.originador ?? body.intermediador;
    const numeroProcesso: string = (body.numero_processo || '').trim();
    const tipoAquisicao: string = (body.tipo_aquisicao || 'auto');  // 'auto'|'principal'|'honorarios'|'ambos'
    const honPctRaw = (body.honorarios_pct === '' || body.honorarios_pct == null) ? null : Number(body.honorarios_pct);
    const honorariosPct = (honPctRaw != null && !isNaN(honPctRaw) && honPctRaw >= 0) ? honPctRaw : null;
    if (!originador) return errorResponse('Campo obrigatório: originador');
    for (const k of ['anthropic_api_key', 'google_oauth_client_id', 'google_oauth_client_secret', 'google_oauth_refresh_token'])
      if (!cfg[k]) return errorResponse(`Secret '${k}' não configurado (Anthropic/Google — ver integracao_*_secret)`, 500);

    // 3a. Fonte do texto do processo:
    //   (A) texto já extraído no NAVEGADOR (pdf.js) e enviado no corpo -> caminho leve, sem estourar CPU;
    //   (B) fallback: lê o(s) arquivo(s) do storage analises-input/{userId}/{jobId}/processo/* (fluxo antigo).
    let contentBlocks: any[] = [];
    let arquivos: Array<{ name: string }> = [];
    let prefix = '';
    const textoDireto = String(body.texto ?? body.texto_processo ?? '').trim();
    if (textoDireto) {
      contentBlocks = [{ type: 'text', text: `[Documento do processo]\n\n${textoDireto}` }];
    } else {
      if (!jobId) return errorResponse('Faltou o texto do processo (ou o job_id).');
      prefix = `${userId}/${jobId}/processo`;
      const { data: arqs, error: listErr } = await sbAdmin.storage.from(BUCKET_INPUT).list(prefix, { limit: 50 });
      if (listErr) throw new Error('Erro listando uploads: ' + listErr.message);
      if (!arqs?.length) return errorResponse('Nenhum PDF encontrado para esse job. Faça o upload do processo antes de gerar.');
      arquivos = arqs;
      for (const a of arquivos) {
        const bytes = await storageGetBytes(sbAdmin, BUCKET_INPUT, `${prefix}/${a.name}`);
        contentBlocks.push(...await arquivoToContentBlocks(a.name, bytes));
      }
    }
    const houveCorte = contentBlocks.some((b: any) => typeof b?.text === 'string' && b.text.includes(MARCA_CORTE));

    // 3b. PORTÃO 1 — QUALIFICAÇÃO (roda ANTES de tudo)
    const qualif = await extrairQualificacao(cfg.anthropic_api_key, contentBlocks);
    if (numeroProcesso) qualif.numero_processo = numeroProcesso;
    const veredito = avaliarQualificacao(qualif);
    if (!veredito.aprovado) {
      // Reprovado: não monta tabela jurídica nem precificação. Limpa os uploads e devolve o motivo.
      if (arquivos.length) { try { await sbAdmin.storage.from(BUCKET_INPUT).remove(arquivos.map(a => `${prefix}/${a.name}`)); } catch (_) { /* ok */ } }
      return jsonResponse({
        ok: true,
        reprovado: true,
        motivos: veredito.motivos,
        avisos: veredito.avisos,
        qualificacao: qualif,
      });
    }
    const avisosQualif = veredito.avisos;  // alertas da qualificação (seguem para a resposta final)

    // 3c. Extração pela IA (só chega aqui se foi APROVADO no Portão 1)
    const dados = await extrairAnalise(cfg.anthropic_api_key, contentBlocks);
    dados.originador = originador;
    if (numeroProcesso) dados.numero_processo = numeroProcesso;
    // Garante que os valores financeiros sejam NÚMERO (não texto) — assim o formato de moeda (R$) da planilha funciona
    dados.bruto_total = Number(dados.bruto_total) || 0;
    dados.ir = Number(dados.ir) || 0;
    dados.inss = Number(dados.inss) || 0;
    dados.honorarios = Number(dados.honorarios) || 0;

    // 3b.1 O que está sendo cedido (escolha manual sobrepõe a detecção automática) + % de honorários
    const honAI = Number(dados.honorarios) || 0;          // honorários destacados pela contadoria (0 = sem destaque)
    const houveDestaque = honAI > 0;
    const brutoNum = Number(dados.bruto_total) || 0;
    const irNum = Number(dados.ir) || 0;
    const inssNum = Number(dados.inss) || 0;
    // honorários a usar: se o usuário informou %, aplica a regra (com destaque→bruto; sem destaque→líquido); senão, usa o da contadoria
    let honorariosCalc = honAI;
    if (honorariosPct != null) {
      const base = houveDestaque ? brutoNum : (brutoNum - irNum - inssNum);
      honorariosCalc = base * (honorariosPct / 100);
    }
    let soHonorarios = false;
    if (tipoAquisicao === 'principal')       { dados.modelo = 2; dados.tipo_credito = 'Apenas o crédito principal'; }
    else if (tipoAquisicao === 'ambos')      { dados.modelo = 1; dados.tipo_credito = 'Crédito principal e honorários'; }
    else if (tipoAquisicao === 'honorarios') { dados.modelo = 2; soHonorarios = true; dados.tipo_credito = 'Apenas os honorários'; }
    else                                     { dados.modelo = escolherModelo(honAI); }  // automático (como hoje), pelo destaque da contadoria

    if (soHonorarios) {
      const valorHon = honorariosPct != null ? brutoNum * (honorariosPct / 100) : honAI;
      if (!(valorHon > 0))
        return errorResponse('Para calcular APENAS os honorários, informe o percentual de honorários no formulário (ou use um processo com honorários destacados nos cálculos da contadoria).');
      dados.bruto_total = valorHon;                          // o "bruto" do cálculo passa a ser o honorário
      dados.ir = 0; dados.inss = 0; dados.honorarios = 0;    // sem deduções do principal; cessão sobre o honorário
    } else {
      dados.honorarios = honorariosCalc;                     // dedução do líquido (L5) e, no Modelo 1, valor adquirido (L7)
    }
    dados._soHonorarios = soHonorarios;
    dados._honPctInformado = honorariosPct != null;

    // 3c. Prazo (T5) + datas
    const scenario: 'A' | 'B' = dados.rpv_ja_expedida ? 'B' : 'A';
    const _prazoEstimado = scenario === 'A' && !dados.data_fatal_convenio;
    const T5 = prazoMeses({
      serventiaDias: Number(dados.serventia_dias) || 0,
      gabineteDias: Number(dados.gabinete_dias) || 0,
      scenario,
      dataAquisicao: new Date(),
      dataFatalConvenio: dados.data_fatal_convenio ? parseBR(dados.data_fatal_convenio) : undefined,
    });
    dados.data_aquisicao = hojeDDMMAAAA();
    dados.data_pagamento = dataPagamento(T5);

    // 3c.1 Emolumentos de cartório da UF do tribunal (cache por UF/ano; busca web na primeira vez)
    const ufCredito = ufDoCredito(dados);
    const emolumentos = await obterEmolumentos(ufCredito, cfg.anthropic_api_key, sbAdmin);

    // 3d. Calibragem do deságio
    const calc: any = calibrarDesagio({
      brutoTotal: Number(dados.bruto_total), honorarios: Number(dados.honorarios) || 0,
      ir: Number(dados.ir) || 0, inss: Number(dados.inss) || 0, T5, modelo: dados.modelo,
      tabela: emolumentos.tabela,
    });
    calc.faixaCartorio = emolumentos.tabela
      ? `${calc.faixaCartorio} — tabela ${emolumentos.uf}/${emolumentos.ano}${emolumentos.vigencia ? `, ${emolumentos.vigencia}` : ''}`
      : calc.faixaCartorio;
    calc.IR = Number(dados.ir) || 0; calc.INSS = Number(dados.inss) || 0;

    // 3e. Gera a planilha colorida
    // Nome do credor em Title Case (usado na pasta do Drive, no nome do arquivo e na aba de precificação)
    const credorBruto = (dados.credor_nome || (dados.cedente_cpf || '').split(/\bCPF\b/i)[0] || numeroProcesso || 'cedente');
    const credorTitulo = (tituloNome(credorBruto).slice(0, 80)) || 'Cedente';
    dados._credor_titulo = credorTitulo;
    const templateBytes = await storageGetBytes(sbAdmin, BUCKET_TEMPLATES, TEMPLATE_NOME);
    const xlsx = await gerarPlanilha(templateBytes, dados, calc, T5);

    // 3f. Sobe no Drive: A. Análises de crédito / {categoria} / {originador} / {credor (Title Case)}
    const token = await refreshGoogleAccessToken(cfg.google_oauth_client_id, cfg.google_oauth_client_secret, cfg.google_oauth_refresh_token);
    const analisesRoot = await driveEncontrarAnalisesRoot(token);
    const catFolder = await driveFindChildByTolerantName(token, analisesRoot, categoria);
    const catId = catFolder?.id ?? await driveFindOrCreateFolder(token, categoria, analisesRoot);
    const interId = await driveFindOrCreateFolder(token, originador, catId);
    const cedenteId = await driveFindOrCreateFolder(token, credorTitulo, interId);
    // Nome do arquivo: "Análise de RPV - CREDOR v. ENTE DEVEDOR - NÚMERO DO PROCESSO"
    const enteDevedor = String(dados.ente_devedor || '').trim();
    const nomeArquivo = limparNomeArquivo(
      `Análise de RPV - ${credorTitulo}${enteDevedor ? ` v. ${enteDevedor}` : ''} - ${numeroProcesso}`,
    ) + '.xlsx';
    const up = await driveUploadBytes(token, nomeArquivo, cedenteId, xlsx, XLSX_MIME, true);

    // limpeza best-effort dos uploads
    if (arquivos.length) { try { await sbAdmin.storage.from(BUCKET_INPUT).remove(arquivos.map(a => `${prefix}/${a.name}`)); } catch (_) { /* ok */ } }

    // Avisos (alertas da qualificação + rentabilidade abaixo da meta e/ou documento cortado por tamanho)
    const avisos: string[] = [...avisosQualif];
    const _avisoTeto = checarTetoRPV(dados.esfera, dados.tribunal, Number(dados.bruto_total) || 0);
    if (_avisoTeto) avisos.push(_avisoTeto);
    // CARTÓRIO. Sem tabela, o preço saiu SEM o custo de cartório — e isso tem de
    // ser dito, porque um preço sem esse custo parece melhor do que é.
    if (!emolumentos.tabela)
      avisos.push(`⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO: não achei a tabela de emolumentos${emolumentos.uf ? ` de ${emolumentos.uf}` : ''} (${emolumentos.motivo ?? 'sem detalhe'}). O deságio foi calibrado SEM escritura e registro — some o custo de cartório à mão antes de fechar a proposta.`);
    else if (calc.Y10 == null)
      avisos.push(`⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO: o preço de cessão ficou fora das faixas da tabela de ${emolumentos.uf}/${emolumentos.ano}. Confirme o emolumento com o cartório e some à mão.`);
    else if (emolumentos.origem === 'busca')
      avisos.push(`Emolumentos de cartório de ${emolumentos.uf}/${emolumentos.ano} achados agora por busca web (${emolumentos.fontes[0] ?? 'fonte não informada'}). Vale conferir a tabela uma vez; as próximas análises desta UF usam o mesmo valor.`);
    if (_prazoEstimado) avisos.push('⚠️ PRAZO ESTIMADO — não há nos autos data-limite de convênio para expedição da RPV (existe no TJGO; a maioria dos tribunais não tem). O prazo até o pagamento foi ESTIMADO pelo período de graça padrão; confira o prazo e a rentabilidade à mão, pois a precificação pode precisar de ajuste para este tribunal.');
    // INSS ZERADO EM HORAS EXTRAS FORA DE GOIÁS: a reserva de 14,25% é a alíquota da
    // GOIASPREV e não foi aplicada. A alíquota do ente é decisão da equipe, não do motor.
    if (String(dados.eh_horas_extras) === 'true' && !(Number(dados.inss) > 0) && !dados._soHonorarios && !ehEstadoDeGoias(dados.ente_devedor))
      avisos.push('⚠️ INSS ZERADO EM HORAS EXTRAS fora do Estado de Goiás: a reserva preventiva de 14,25% é a alíquota da GOIASPREV e NÃO foi aplicada a este ente. Confira a alíquota previdenciária do ente devedor; se couber reserva, refaça a precificação com ela.');
    if (calc.atingiuAlvo === false)
      avisos.push(`Não foi possível atingir a meta de 2,80% ao mês: mesmo no deságio máximo (95%), a rentabilidade fica em ${pct(calc.Y9)} ao mês — pode ser um crédito que não compensa nesse prazo, ou algum dado lido errado do PDF.`);
    if (houveCorte)
      avisos.push('O processo é muito grande e PARTE do conteúdo foi omitida na leitura da IA. Confira com atenção os valores (bruto, líquido, IR, INSS, honorários) e as datas; se possível, gere de novo enviando um PDF menor só com os documentos essenciais (cálculos da contadoria, sentença e a decisão de expedição da RPV).');
    if (dados._soHonorarios)
      avisos.push('Cálculo de APENAS os honorários: confira se há descontos (como IR) sobre o valor dos honorários, pois isso varia conforme o processo.');
    const avisoFinal = avisos.length ? avisos.join(' ') + ' A planilha foi gerada assim mesmo para você conferir à mão.' : null;

    return jsonResponse({
      ok: true,
      cedente: credorTitulo,
      modelo: dados.modelo === 1 ? 'Modelo 1 (verde)' : 'Modelo 2 (azul)',
      desagio: pct(calc.desagio),
      rentabilidade_mensal: pct(calc.Y9),
      cessao: brl(calc.cessao),
      cartorio: {
        valor: calc.Y10 == null ? '—' : brl(calc.Y10),
        escritura: calc.emolumentos?.escritura == null ? '—' : brl(calc.emolumentos.escritura),
        registro: calc.emolumentos?.registro == null ? '—' : brl(calc.emolumentos.registro),
        faixa: calc.faixaCartorio,
        uf: emolumentos.uf || null,
        origem: emolumentos.origem,
        fontes: emolumentos.fontes,
      },
      atingiu_alvo: calc.atingiuAlvo !== false,
      aviso: avisoFinal,
      drive_folder_url: `https://drive.google.com/drive/folders/${cedenteId}`,
      drive_file_url: up.webViewLink ?? null,
      // dados úteis pro .md/.csv (gerados no front ou em passo futuro)
      m1_sintese: dados.m1_sintese ?? null,
      riscos: dados.bloco_g_riscos ?? [],
    });
  } catch (e) {
    return errorResponse('Falha ao gerar análise: ' + (e instanceof Error ? e.message : String(e)), 500);
  }
});

// DD/MM/AAAA -> Date
function parseBR(s: string): Date {
  const [d, m, y] = s.split('/').map(Number);
  return new Date(y, m - 1, d);
}
