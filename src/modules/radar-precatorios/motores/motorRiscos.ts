/**
 * motorRiscos — alertas, conflitos de fonte, grau de robustez e
 * "o que falta para melhorar a previsão". Funções puras.
 *
 * O grau (A–D) mede a robustez da PROJEÇÃO, não a probabilidade de
 * pagamento nem o risco jurídico do crédito (seção 9.4).
 */
import type { CampoRastreado, Centavos, ObservacaoFonte, Origem, Projeto } from '../dominio/tipos';
import type { RegrasJuridicas } from '../regras/regrasJuridicas';
import type { ResultadoProjecao } from './motorProjecao';
import { formatarBRL, formatarData } from '../dominio/dinheiro';

export type NivelAlerta = 'bloqueio' | 'critico' | 'atencao' | 'info';

export interface Alerta {
  id: string;
  nivel: NivelAlerta;
  titulo: string;
  detalhe: string;
  tela?: 'ente' | 'enquadramento' | 'historico' | 'cenarios' | 'painel' | 'regras';
}

export const ROTULO_CAMPO: Record<CampoRastreado, string> = {
  rclAnterior: 'RCL do exercício anterior',
  moraEm1Jan: 'Estoque em mora em 1º/jan',
  totalPendente1Jan: 'Estoque total pendente em 1º/jan',
  aVencerExercicioSeguinte: 'A vencer no exercício seguinte',
  saldoContaEspecial1Jan: 'Saldo nas contas especiais em 1º/jan',
  planoAnual: 'Plano anual homologado',
};

export const ROTULO_ORIGEM: Record<Origem, string> = {
  oficial: 'Oficial',
  analista: 'Informado pelo analista',
  hipotese: 'Hipótese',
  estimado: 'Estimado',
  ausente: 'Ausente',
};

/* ------------------------------------------------------------------ */
/* Conflitos de fonte (T22)                                            */
/* ------------------------------------------------------------------ */

export interface Conflito {
  campo: CampoRastreado;
  valores: { valor: Centavos; fonte: string; dataBase?: string; dataColeta?: string; origem: Origem; emUso: boolean; possivelmenteDefasada: boolean }[];
}

/**
 * Compara o valor em uso com todas as fontes registradas do mesmo campo.
 * Valores diferentes geram conflito; o mais antigo (data-base, depois
 * coleta) é marcado como possivelmente defasado. Nada é sobrescrito.
 */
export function detectarConflitos(projeto: Projeto): Conflito[] {
  const porCampo = new Map<CampoRastreado, ObservacaoFonte[]>();
  for (const o of projeto.observacoes) {
    const l = porCampo.get(o.campo) ?? [];
    l.push(o);
    porCampo.set(o.campo, l);
  }
  const conflitos: Conflito[] = [];
  for (const [campo, obs] of porCampo) {
    const emUso = projeto.dados[campo];
    const lista = obs.map((o) => ({ valor: o.valor, fonte: o.fonte, dataBase: o.dataBase, dataColeta: o.dataColeta, origem: o.origem, emUso: false, possivelmenteDefasada: false }));
    if (emUso.valor !== null) {
      const jaListado = lista.find((v) => v.valor === emUso.valor && v.fonte === (emUso.fonte ?? ''));
      if (jaListado) jaListado.emUso = true;
      else lista.unshift({ valor: emUso.valor, fonte: emUso.fonte ?? 'Valor em uso (sem fonte registrada)', dataBase: emUso.dataBase, dataColeta: emUso.dataColeta, origem: emUso.origem, emUso: true, possivelmenteDefasada: false });
    }
    const distintos = new Set(lista.map((v) => v.valor));
    if (distintos.size < 2) continue;
    const chave = (v: (typeof lista)[number]) => `${v.dataBase ?? ''}|${v.dataColeta ?? ''}`;
    const maisRecente = [...lista].sort((a, b) => (chave(a) < chave(b) ? 1 : -1))[0];
    for (const v of lista) v.possivelmenteDefasada = chave(v) < chave(maisRecente) && v.valor !== maisRecente.valor;
    conflitos.push({ campo, valores: lista });
  }
  return conflitos;
}

/* ------------------------------------------------------------------ */
/* Alertas de dados                                                     */
/* ------------------------------------------------------------------ */

function mesesEntre(isoA: string, isoB: string): number {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function alertasDeDados(projeto: Projeto, regras: RegrasJuridicas, hojeISO: string): Alerta[] {
  const a: Alerta[] = [];
  const d = projeto.dados;
  const t0 = projeto.anoBase;

  if (d.rclAnterior.valor === null) a.push({ id: 'rcl-ausente', nivel: 'bloqueio', titulo: `RCL de ${t0 - 1} ausente`, detalhe: 'Sem RCL a faixa do § 23 não é calculável. Fonte preferencial: RGF/Siconfi do exercício anterior.', tela: 'enquadramento' });
  else if (d.rclAnterior.valor <= 0) a.push({ id: 'rcl-invalida', nivel: 'bloqueio', titulo: 'RCL zero ou negativa', detalhe: 'Valor incompatível com a apuração. Nenhuma alíquota é presumida.', tela: 'enquadramento' });
  if (d.rclAnterior.valor !== null && d.rclAnterior.periodoReferencia && !d.rclAnterior.periodoReferencia.includes(String(t0 - 1))) {
    a.push({ id: 'rcl-periodo', nivel: 'critico', titulo: 'RCL de outro período', detalhe: `O período informado (${d.rclAnterior.periodoReferencia}) não corresponde ao exercício de ${t0 - 1}. Doze meses móveis não substituem a RCL do exercício anterior.`, tela: 'enquadramento' });
  }
  if (d.moraEm1Jan.valor === null) {
    if (d.aliquotaManual.valor) a.push({ id: 'aliquota-manual', nivel: 'critico', titulo: 'Simulação parametrizada (alíquota manual)', detalhe: 'O estoque em mora é desconhecido; a alíquota foi informada pelo analista e não tem verificação legal.', tela: 'enquadramento' });
    else a.push({ id: 'mora-ausente', nivel: 'bloqueio', titulo: 'Estoque em mora ausente', detalhe: 'Faixa indeterminada. O estoque total não substitui o estoque em mora.', tela: 'enquadramento' });
  } else if (d.moraEm1Jan.dataBase && d.moraEm1Jan.dataBase !== `${t0}-01-01`) {
    a.push({ id: 'mora-database', nivel: 'critico', titulo: 'Data-base da mora diferente de 1º/jan', detalhe: `A mora foi apurada em ${formatarData(d.moraEm1Jan.dataBase)}; o § 23 usa o estoque em mora em 1º/1/${t0}.`, tela: 'enquadramento' });
  }
  if (d.totalPendente1Jan.valor !== null && d.moraEm1Jan.valor !== null && d.totalPendente1Jan.valor < d.moraEm1Jan.valor) {
    a.push({ id: 'total-menor', nivel: 'bloqueio', titulo: 'Estoque total menor que a mora', detalhe: 'As grandezas são incompatíveis: confira datas-base e abrangência (TJ, outros ramos, administração indireta).', tela: 'enquadramento' });
  }
  if (d.totalPendente1Jan.valor === null) a.push({ id: 'total-ausente', nivel: 'atencao', titulo: 'Estoque total ausente', detalhe: 'A projeção considera só a mora. Informe o total pendente para incluir os créditos a vencer.', tela: 'enquadramento' });

  const camposPrincipais: CampoRastreado[] = ['rclAnterior', 'moraEm1Jan', 'totalPendente1Jan'];
  for (const c of camposPrincipais) {
    const v = d[c];
    if (v.valor === null) continue;
    if (v.origem === 'oficial' && !v.fonte) a.push({ id: `sem-fonte-${c}`, nivel: 'atencao', titulo: `${ROTULO_CAMPO[c]} marcado como oficial sem fonte`, detalhe: 'Registre o documento ou URL e a data de coleta.', tela: 'enquadramento' });
    if (v.origem === 'hipotese' || v.origem === 'analista') a.push({ id: `nao-oficial-${c}`, nivel: 'info', titulo: `${ROTULO_CAMPO[c]}: ${ROTULO_ORIGEM[v.origem].toLowerCase()}`, detalhe: 'Não é dado oficial. Os resultados herdam essa natureza.', tela: 'enquadramento' });
    if (v.dataColeta && mesesEntre(v.dataColeta, hojeISO) > 12) a.push({ id: `defasado-${c}`, nivel: 'atencao', titulo: `${ROTULO_CAMPO[c]} coletado há mais de 12 meses`, detalhe: `Coleta em ${formatarData(v.dataColeta)}. Confirme se não há versão mais recente.`, tela: 'enquadramento' });
  }

  for (const cf of detectarConflitos(projeto)) {
    const desc = cf.valores.map((v) => `${formatarBRL(v.valor)} (${v.fonte}${v.dataBase ? `, data-base ${formatarData(v.dataBase)}` : ''}${v.possivelmenteDefasada ? ', possivelmente defasada' : ''}${v.emUso ? ', em uso' : ''})`).join(' × ');
    a.push({ id: `conflito-${cf.campo}`, nivel: 'critico', titulo: `Fontes divergentes: ${ROTULO_CAMPO[cf.campo]}`, detalhe: `${desc}. O valor em uso não foi substituído automaticamente.`, tela: 'enquadramento' });
  }

  if (projeto.ente.regime === 'nao_informado') a.push({ id: 'regime', nivel: 'atencao', titulo: 'Regime de pagamento não informado', detalhe: 'Geral ou especial define contas, acordos e procedimento. Informe com a fonte (tribunal/CNJ).', tela: 'ente' });
  if (d.planoAnual.valor !== null && d.rclAnterior.valor && d.moraEm1Jan.valor !== null) {
    // checado na projeção (limite do ano-base); aqui só registra se o plano é hipótese
    if (d.planoAnual.origem !== 'oficial') a.push({ id: 'plano-nao-oficial', nivel: 'info', titulo: 'Plano anual não oficial', detalhe: 'O plano informado não está marcado como oficial (homologado pelo tribunal).', tela: 'enquadramento' });
  }

  const ultimoAno = t0 + projeto.config.horizonteAnos - 1;
  if (ultimoAno >= regras.adicionalDecenal.anoInicio) {
    a.push({ id: 'par24', nivel: 'info', titulo: 'Horizonte alcança o § 24 (adicional decenal)', detalhe: `Leitura em uso: ${regras.adicionalDecenal.leituras[projeto.juridico.leitura24]} Interpretação pendente de revisão jurídica.`, tela: 'regras' });
  }
  if (!projeto.juridico.aplicarTeto) a.push({ id: 'teto-afastado', nivel: 'atencao', titulo: 'Cenário normativo: teto afastado', detalhe: 'Simulação contrafactual para medir o efeito de uma decisão na ADI 7873. Não é a regra vigente.', tela: 'regras' });
  a.push({ id: 'adi', nivel: 'info', titulo: `${regras.controleConcentrado.acao} pendente no STF`, detalhe: `${regras.controleConcentrado.situacao} Consulta em ${formatarData(regras.controleConcentrado.consultadoEm)}.`, tela: 'regras' });
  if (regras.aprovacao !== 'aprovada') a.push({ id: 'regras-pendentes', nivel: 'info', titulo: `Regras jurídicas v${regras.versao} aguardando aprovação`, detalhe: 'Revisão jurídica necessária antes de uso decisório ou comercial.', tela: 'regras' });
  return a;
}

/* ------------------------------------------------------------------ */
/* Alertas da projeção (seção 6.6)                                      */
/* ------------------------------------------------------------------ */

export function alertasDaProjecao(projeto: Projeto, res: ResultadoProjecao): Alerta[] {
  const a: Alerta[] = [];
  if (res.status === 'bloqueada') {
    a.push({ id: 'proj-bloqueada', nivel: 'bloqueio', titulo: 'Projeção bloqueada', detalhe: res.motivoBloqueio ?? '', tela: 'enquadramento' });
    return a;
  }
  const L = res.linhas;
  if (!L.length) return a;
  if (!res.conservacaoOk) a.push({ id: 'conservacao', nivel: 'bloqueio', titulo: 'Conservação não conciliada', detalhe: 'A equação de conservação não fechou: o resultado não deve ser usado.', tela: 'painel' });
  if (!res.convergiu && !res.semMoraInicial && res.status === 'ok') a.push({ id: 'nao-converge', nivel: 'critico', titulo: 'Sem quitação da mora no horizonte', detalhe: res.mensagemConvergencia, tela: 'painel' });

  const anosCrescendo = L.filter((l) => l.novosCreditos + l.atualizacaoTotal > l.reducoes).length;
  if (anosCrescendo > 0) a.push({ id: 'entradas-superam', nivel: anosCrescendo === L.length ? 'critico' : 'atencao', titulo: 'Entradas superam as reduções', detalhe: `Em ${anosCrescendo} de ${L.length} exercícios, novas inscrições + atualização excedem pagamentos e extinções.`, tela: 'painel' });

  const anosInscAcimaTeto = L.filter((l) => l.limite !== null && l.novosCreditos > l.limite).length;
  if (anosInscAcimaTeto > 0) a.push({ id: 'faixa-baixa', nivel: 'atencao', titulo: 'Teto abaixo das novas inscrições', detalhe: `Em ${anosInscAcimaTeto} exercícios as novas inscrições superam o limite do § 23: mesmo pagando o teto, o estoque cresce.`, tela: 'painel' });

  const ini = L[0];
  const fim = L[L.length - 1];
  const n = L.length;
  if (n >= 2 && ini.passivoInicial > 0 && ini.rclAnterior.valor) {
    const gPassivo = Math.pow(fim.passivoFinal / ini.passivoInicial, 1 / n) - 1;
    const gRcl = Math.pow(fim.rclDoAno / ini.rclAnterior.valor, 1 / n) - 1;
    if (gPassivo > gRcl) a.push({ id: 'rcl-menor', nivel: 'atencao', titulo: 'Passivo cresce mais que a RCL', detalhe: `Crescimento médio do passivo ${(gPassivo * 100).toFixed(1).replace('.', ',')}% a.a. contra ${(gRcl * 100).toFixed(1).replace('.', ',')}% a.a. da RCL.`, tela: 'painel' });
  }
  const anosExecBaixa = L.filter((l) => l.execucao < 1).length;
  if (anosExecBaixa > 0) a.push({ id: 'execucao', nivel: 'atencao', titulo: 'Depósitos abaixo do previsto', detalhe: `Em ${anosExecBaixa} exercícios o cenário supõe execução inferior a 100% do aporte previsto.`, tela: 'cenarios' });
  if (fim.saldoContasFinal > ini.saldoContas1Jan && fim.saldoContasFinal > 0) a.push({ id: 'saldo-conta', nivel: 'atencao', titulo: 'Saldo acumulando nas contas especiais', detalhe: `Dinheiro depositado e não pago cresce de ${formatarBRL(ini.saldoContas1Jan)} para ${formatarBRL(fim.saldoContasFinal)}. Depósito não é pagamento ao credor.`, tela: 'painel' });
  if (L.some((l) => l.limitadoPeloTeto)) a.push({ id: 'teto-limita', nivel: 'info', titulo: 'Teto do § 23 limitou aportes', detalhe: 'O aporte planejado superou o limite em ao menos um exercício. Excedente só com dotação específica (§ 28).', tela: 'painel' });
  if (L.some((l) => l.enquadramento.status === 'calculada' && l.enquadramento.adicional.bp > 0)) a.push({ id: 'adicional-ativo', nivel: 'info', titulo: 'Resultado usa o adicional decenal', detalhe: 'Parte do horizonte depende da leitura do § 24, pendente de revisão jurídica.', tela: 'regras' });
  const planoT0 = projeto.dados.planoAnual.valor;
  if (planoT0 !== null && ini.limite !== null && planoT0 > ini.limite) a.push({ id: 'plano-acima', nivel: 'atencao', titulo: 'Plano acima do teto', detalhe: `Plano de ${formatarBRL(planoT0)} contra limite de ${formatarBRL(ini.limite)} em ${ini.ano}. Excedente depende de dotação específica (§ 28).`, tela: 'enquadramento' });
  for (const av of res.avisos) a.push({ id: `aviso-${av.slice(0, 24)}`, nivel: 'atencao', titulo: 'Premissa da projeção', detalhe: av, tela: 'painel' });
  return a;
}

/* ------------------------------------------------------------------ */
/* Grau de robustez (seção 9.4)                                          */
/* ------------------------------------------------------------------ */

export interface Grau {
  grau: 'A' | 'B' | 'C' | 'D';
  titulo: string;
  motivo: string;
  permitido: string;
}

export function grauRobustez(projeto: Projeto, alertas: Alerta[]): Grau {
  const bloqueios = alertas.filter((x) => x.nivel === 'bloqueio');
  const conflitos = alertas.filter((x) => x.id.startsWith('conflito-'));
  const defasados = alertas.filter((x) => x.id.startsWith('defasado-'));
  if (bloqueios.length || conflitos.length || defasados.length) {
    const motivos = [...bloqueios, ...conflitos, ...defasados].map((x) => x.titulo.toLowerCase()).join('; ');
    return { grau: 'D', titulo: 'Insuficiente', motivo: `Dados ausentes, defasados ou conflitantes: ${motivos}.`, permitido: 'Solicitar dados; faixa legal ou datas bloqueadas.' };
  }
  const hipot = (['rclAnterior', 'moraEm1Jan'] as const).some((c) => projeto.dados[c].origem === 'hipotese');
  return {
    grau: 'C',
    titulo: 'Exploratória',
    motivo: `Projeção agregada do ente, sem posição individual na fila${hipot ? ', com números hipotéticos' : ''}. Graus A e B exigem a fila e os valores por classe (Fase 2).`,
    permitido: 'Tendência do ente; sem data individual confiável.',
  };
}

/* ------------------------------------------------------------------ */
/* "O que falta para melhorar a previsão?" (seção 16)                    */
/* ------------------------------------------------------------------ */

export interface ItemChecklist {
  id: string;
  pergunta: string;
  status: 'ok' | 'pendente' | 'fase2';
  comoResolver: string;
}

export function oQueFalta(projeto: Projeto): ItemChecklist[] {
  const d = projeto.dados;
  const t0 = projeto.anoBase;
  const hist = projeto.historico;
  const it: ItemChecklist[] = [];
  const push = (id: string, pergunta: string, ok: boolean | 'fase2', comoResolver: string) =>
    it.push({ id, pergunta, status: ok === 'fase2' ? 'fase2' : ok ? 'ok' : 'pendente', comoResolver });

  push('rcl-exercicio', `A RCL é a do exercício de ${t0 - 1}, e não de 12 meses móveis?`, !!(d.rclAnterior.valor && d.rclAnterior.periodoReferencia?.includes(String(t0 - 1))), 'Informe o período de referência da RCL (RGF do 3º quadrimestre / 2º semestre).');
  push('mora', `O estoque informado é exclusivamente o em mora em 1º/1/${t0}?`, d.moraEm1Jan.valor !== null && d.moraEm1Jan.dataBase === `${t0}-01-01`, 'Informe a mora com data-base 1º de janeiro, separada do total.');
  push('serie', 'Os valores anuais informados são saldos (fotografias) ou entradas de novos precatórios?', projeto.serie.pontos.length === 0 || projeto.serie.tipo !== 'nao_informado', 'Classifique a série na tela Histórico.');
  push('abrangencia', 'A lista abrange todo o passivo relevante (TJ, outros ramos da Justiça, administração indireta)?', projeto.ente.abrangencia.trim().length > 0, 'Descreva a abrangência no cadastro do ente.');
  push('regime', 'O ente está no regime geral ou especial? Qual a fonte?', projeto.ente.regime !== 'nao_informado' && projeto.ente.fonteRegime.trim().length > 0, 'Informe o regime e a fonte (tribunal/CNJ).');
  push('plano', `Existe plano anual homologado para ${t0}? Foi revisto após a EC 136?`, d.planoAnual.valor !== null && d.planoAnual.origem === 'oficial', 'Registre o plano homologado com a fonte.');
  push('fluxos', 'Quanto foi planejado, depositado, distribuído e levantado nos últimos exercícios?', hist.filter((h) => h.depositos !== null && h.pagamentos !== null).length >= 3, 'Preencha ao menos 3 exercícios com depósitos e pagamentos no histórico.');
  push('acordos', 'Há conta separada para acordos diretos? Como são financiados?', projeto.ente.regime === 'geral', 'Confirme com o tribunal a conta de acordos e o percentual destinado.');
  push('aportados', 'Os valores já aportados continuam sendo corrigidos na base importada?', d.saldoContaEspecial1Jan.valor !== null, 'Informe o saldo das contas especiais em 1º/jan, separado do estoque.');
  push('historico3', 'Há ao menos 3 exercícios comparáveis de RCL e estoque?', hist.filter((h) => h.rcl !== null && h.estoqueFinal !== null).length >= 3, 'Complete o histórico com datas comparáveis.');
  push('preferencias', 'Existem créditos alimentares ou superpreferenciais que antecedem o título analisado?', 'fase2', 'Exige a fila individual (Fase 2).');
  push('valor-frente', 'Qual o valor corrigido à frente do título na fila pertinente?', 'fase2', 'Exige a fila individual (Fase 2).');
  push('alvo', 'O precatório-alvo tem pagamento parcial, cessão, bloqueio ou pendência de levantamento?', 'fase2', 'Avaliação jurídica do crédito e fila individual (Fase 2).');
  return it;
}
