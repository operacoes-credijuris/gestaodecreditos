/**
 * Persistência do projeto em JSON: exportação, importação com validação
 * e snapshots para auditoria (T20). Sem dados pessoais: o projeto guarda
 * dados do ente e premissas, nunca CPF, dados médicos ou bancários.
 */
import type { CampoRastreado, Cenario, DadoRastreado, IdCenario, Origem, Projeto, Snapshot } from '../dominio/tipos';
import type { ResultadoProjecao } from '../motores/motorProjecao';

export const APP_VERSAO = '1.0.0';
const ORIGENS: Origem[] = ['oficial', 'analista', 'hipotese', 'estimado', 'ausente'];
const CAMPOS: CampoRastreado[] = ['rclAnterior', 'moraEm1Jan', 'totalPendente1Jan', 'aVencerExercicioSeguinte', 'saldoContaEspecial1Jan', 'planoAnual'];
const IDS_CENARIO: IdCenario[] = ['conservador', 'base', 'favoravel'];

export interface ResultadoValidacao {
  ok: boolean;
  erros: string[];
  avisos: string[];
  projeto?: Projeto;
}

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ehInteiro = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const ehNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validarDado(nome: string, v: unknown, erros: string[], permitirNegativo = false) {
  if (!ehObj(v)) { erros.push(`${nome}: estrutura ausente.`); return; }
  if (v.valor !== null && !ehInteiro(v.valor)) erros.push(`${nome}: valor deve ser número inteiro de centavos ou nulo.`);
  if (ehInteiro(v.valor) && !permitirNegativo && v.valor < 0) erros.push(`${nome}: valor negativo não é aceito.`);
  if (!ORIGENS.includes(v.origem as Origem)) erros.push(`${nome}: origem inválida (use ${ORIGENS.join(', ')}).`);
  if (v.valor === null && v.origem !== 'ausente') erros.push(`${nome}: valor nulo deve ter origem "ausente".`);
  if (v.dataBase !== undefined && v.dataBase !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v.dataBase))) erros.push(`${nome}: data-base deve estar em aaaa-mm-dd.`);
}

function validarFracao(nome: string, v: unknown, min: number, max: number, erros: string[]) {
  if (!ehNum(v)) erros.push(`${nome}: deve ser número.`);
  else if (v < min || v > max) erros.push(`${nome}: fora do intervalo permitido (${min * 100}% a ${max * 100}%).`);
}

function validarCenario(c: unknown, i: number, erros: string[]) {
  const p = `Cenário ${i + 1}`;
  if (!ehObj(c)) { erros.push(`${p}: estrutura ausente.`); return; }
  if (!IDS_CENARIO.includes(c.id as IdCenario)) erros.push(`${p}: identificador inválido.`);
  validarFracao(`${p} — crescimento da RCL`, c.crescimentoRCL, -0.5, 1, erros);
  validarFracao(`${p} — crescimento das inscrições`, c.crescimentoInscricoes, -0.5, 2, erros);
  validarFracao(`${p} — fração apresentada até 1º/fev`, c.pctApresentadoAteCorte, 0, 1, erros);
  validarFracao(`${p} — taxa a vencer`, c.taxaAVencer, -0.1, 1, erros);
  validarFracao(`${p} — taxa da mora`, c.taxaMora, -0.1, 1, erros);
  validarFracao(`${p} — execução dos depósitos`, c.execucaoDepositos, 0, 2, erros);
  validarFracao(`${p} — fração para acordos`, c.pctAcordos, 0, 1, erros);
  validarFracao(`${p} — deságio`, c.desagioAcordos, 0, 0.99, erros);
  validarFracao(`${p} — distribuição`, c.taxaDistribuicao, 0, 1, erros);
  validarFracao(`${p} — remuneração da conta`, c.remuneracaoConta, 0, 1, erros);
  validarFracao(`${p} — fração do exigível`, c.pctExigivel, 0, 1, erros);
  for (const k of ['novasInscricoesAno', 'valorDepositoFixo', 'extraordinariosAno', 'outrasExtincoesAno'] as const) {
    if (!ehInteiro(c[k]) || (c[k] as number) < 0) erros.push(`${p} — ${k}: valor em centavos inteiros, não negativo.`);
  }
  if (!['limite', 'plano', 'valor_fixo', 'pct_exigivel'].includes(String(c.baseDeposito))) erros.push(`${p}: base do depósito inválida.`);
  if (!['inicio', 'mensal', 'meio', 'fim'].includes(String(c.momentoDeposito))) erros.push(`${p}: momento do depósito inválido.`);
  if (!Array.isArray(c.choques)) erros.push(`${p}: lista de choques ausente.`);
}

export function validarProjeto(obj: unknown): ResultadoValidacao {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (!ehObj(obj)) return { ok: false, erros: ['Arquivo não contém um projeto (objeto JSON).'], avisos };
  const raiz = ehObj(obj.projeto) ? obj.projeto : obj;
  if (raiz.schemaVersao !== 1) erros.push(`Versão de esquema não suportada: ${String(raiz.schemaVersao)} (esperado 1).`);
  if (!ehObj(raiz.ente)) erros.push('Cadastro do ente ausente.');
  else {
    const e = raiz.ente;
    if (typeof e.nome !== 'string' || !e.nome.trim()) erros.push('Ente: nome obrigatório.');
    if (!['municipio', 'estado', 'df'].includes(String(e.esfera))) erros.push('Ente: esfera inválida.');
    if (!['geral', 'especial', 'nao_informado'].includes(String(e.regime))) erros.push('Ente: regime inválido.');
  }
  if (!ehInteiro(raiz.anoBase) || raiz.anoBase < 2026 || raiz.anoBase > 2100) erros.push('Ano-base deve ser inteiro entre 2026 e 2100 (regras da EC 136/2025).');
  if (!ehObj(raiz.dados)) erros.push('Dados iniciais ausentes.');
  else {
    for (const c of CAMPOS) validarDado(c, raiz.dados[c], erros);
    validarDado('aliquotaManual', raiz.dados.aliquotaManual, erros);
    const a = raiz.dados.aliquotaManual as DadoRastreado<number> | undefined;
    if (a && ehInteiro(a.valor) && (a.valor <= 0 || a.valor > 2000)) erros.push('Alíquota manual deve estar entre 0,01% e 20%.');
  }
  if (!Array.isArray(raiz.cenarios) || raiz.cenarios.length !== 3) erros.push('São esperados exatamente três cenários (conservador, base, favorável).');
  else (raiz.cenarios as unknown[]).forEach((c, i) => validarCenario(c, i, erros));
  if (!ehObj(raiz.config)) erros.push('Configuração da projeção ausente.');
  else {
    const h = raiz.config.horizonteAnos;
    if (!ehInteiro(h) || h < 1 || h > 60) erros.push('Horizonte deve ser inteiro entre 1 e 60 anos.');
    if (!IDS_CENARIO.includes(raiz.config.cenarioAtivo as IdCenario)) erros.push('Cenário ativo inválido.');
  }
  if (!ehObj(raiz.juridico)) erros.push('Configuração jurídica ausente.');
  else {
    if (!['fixa', 'cumulativa', 'desligada'].includes(String(raiz.juridico.leitura24))) erros.push('Leitura do § 24 inválida.');
    if (!['anual', 'inicio_decenio'].includes(String(raiz.juridico.verificacao24))) erros.push('Verificação do § 24 inválida.');
    if (typeof raiz.juridico.aplicarTeto !== 'boolean') erros.push('Cenário normativo (aplicar teto) inválido.');
  }
  for (const k of ['observacoes', 'historico', 'movimentos', 'snapshots'] as const) {
    if (!Array.isArray(raiz[k])) erros.push(`Lista "${k}" ausente.`);
  }
  if (Array.isArray(raiz.movimentos)) {
    const ids = new Set<string>();
    for (const m of raiz.movimentos as Record<string, unknown>[]) {
      if (ids.has(String(m.id))) avisos.push(`Movimento "${String(m.id)}" repetido no arquivo.`);
      ids.add(String(m.id));
      if (!ehInteiro(m.valor) || (m.valor as number) < 0) erros.push(`Movimento "${String(m.id)}": valor deve ser centavos inteiros não negativos (use o tipo "estorno" para reverter).`);
    }
  }
  if (Array.isArray(raiz.historico)) {
    for (const h of raiz.historico as Record<string, unknown>[]) {
      for (const k of ['rcl', 'moraEm1Jan', 'estoqueInicial', 'novasInscricoes', 'atualizacao', 'depositos', 'pagamentos', 'baixas', 'estoqueFinal']) {
        const v = h[k];
        if (v !== null && v !== undefined && (!ehInteiro(v) || (v as number) < 0)) erros.push(`Histórico ${String(h.exercicio)}: "${k}" deve ser centavos inteiros não negativos.`);
      }
    }
  }
  if (!ehObj(raiz.serie)) erros.push('Série de interpretação ausente.');
  if (!ehObj(raiz.livroInicial)) erros.push('Livro inicial ausente.');
  if (erros.length) return { ok: false, erros, avisos };
  return { ok: true, erros, avisos, projeto: raiz as unknown as Projeto };
}

export interface ArquivoExportado {
  formato: 'radar-precatorios';
  appVersao: string;
  exportadoEm: string;
  aviso: string;
  projeto: Projeto;
}

export function exportarProjeto(p: Projeto, agoraISO: string): string {
  const arq: ArquivoExportado = {
    formato: 'radar-precatorios',
    appVersao: APP_VERSAO,
    exportadoEm: agoraISO,
    aviso: 'Projeto de simulação. Não contém dados pessoais. Números hipotéticos e estimados estão identificados pela origem.',
    projeto: p,
  };
  return JSON.stringify(arq, null, 2);
}

export function importarProjeto(texto: string): ResultadoValidacao {
  let obj: unknown;
  try {
    obj = JSON.parse(texto);
  } catch {
    return { ok: false, erros: ['O conteúdo não é um JSON válido.'], avisos: [] };
  }
  return validarProjeto(obj);
}

/** FNV-1a de 32 bits, em hexadecimal: identifica o conjunto de entradas. */
export function hashTexto(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function entradasDoProjeto(p: Projeto): string {
  const { snapshots: _s, atualizadoEm: _a, ...resto } = p;
  void _s; void _a;
  return JSON.stringify(resto);
}

/** Congela projeto + resultado: alterações posteriores não mudam o snapshot (T20). */
export function criarSnapshot(p: Projeto, r: ResultadoProjecao, rotulo: string, agoraISO: string, cenario: IdCenario): Snapshot {
  const entradas = entradasDoProjeto(p);
  const l0 = r.linhas[0];
  const ult = r.linhas[r.linhas.length - 1];
  return Object.freeze({
    id: `snap-${hashTexto(entradas + agoraISO)}`,
    criadoEm: agoraISO,
    rotulo,
    versaoRegras: r.versaoRegras,
    hashEntradas: hashTexto(entradas),
    cenario,
    resumo: Object.freeze({
      limiteAnoBase: l0?.limite ?? null,
      aliquotaAnoBaseBp: l0 && (l0.enquadramento.status === 'calculada' || l0.enquadramento.status === 'manual') ? l0.enquadramento.aliquotaAplicavelBp : null,
      passivoInicial: l0?.passivoInicial ?? null,
      passivoFinal: ult?.passivoFinal ?? null,
      anoZeragemMora: r.anoZeragemMora,
      trajetoria: r.trajetoria,
    }),
    projetoCongelado: entradas,
  }) as Snapshot;
}

export function cenarioPorId(p: Projeto, id: IdCenario): Cenario {
  return p.cenarios.find((c) => c.id === id) ?? p.cenarios[1];
}
