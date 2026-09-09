import { PISO_NEGOCIO } from './piso.ts';

// O PORTÃO 1 — a decisão de o crédito entrar ou não.
//
// SEM DEPENDÊNCIA DE NADA, como precificacao.ts, prazo.ts e irpf.ts. Isto morava
// dentro da Edge Function, junto do SDK da IA, e nenhum teste alcançava a árvore
// que decide se um crédito é analisado. O comentário do valor, mais abaixo,
// registra um defeito que já voltou uma vez — ausência de dado saindo como
// aprovação — e que nada impedia de voltar de novo.
//
// Aqui moram também as três leituras de que ela depende (número escrito como
// texto, data brasileira, "SIM" em campo de resposta) e o reconhecimento do
// Estado de Goiás, que decide a aplicação de duas regras estaduais.

// Converte um número escrito como texto (US "1234.56", BR "1.234,56", "1234,56"...) para Number. null se não der.
export function parseNumeroFlex(num: string): number | null {
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

/**
 * 'DD/MM/AAAA' -> Date, ou null.
 *
 * CONFERE O QUE O CONSTRUTOR FEZ, porque ele ROLA: `new Date(2024, 1, 31)` é
 * 02/03/2024, e `new Date(2024, 98, 99)` é uma data válida anos à frente. As
 * duas passavam em `isNaN(getTime())` e alimentavam o corte goiano de
 * 15/11/2025 e as datas do prazo — uma data impossível nos autos virava uma
 * data plausível na conta, sem um aviso.
 */
export function parseDataBR(s: any): Date | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]), ano = Number(m[3]);
  const d = new Date(ano, mes - 1, dia);
  if (isNaN(d.getTime())) return null;
  return d.getDate() === dia && d.getMonth() === mes - 1 && d.getFullYear() === ano ? d : null;
}
export const ehSim = (v: any) => typeof v === 'string' && v.trim().toUpperCase().startsWith('SIM');

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
export function ehEstadoDeGoias(...candidatos: unknown[]): boolean {
  return candidatos.some((c) => {
    const t = String(c ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/municip|prefeitura|camara\s+municipal/.test(t)) return false;
    return (
      /estado\s+d[eo]\s+goias/.test(t) ||
      /fazenda\s+(publica\s+)?(d[eo]\s+estado\s+d[eo]\s+)?goias/.test(t) ||
      /goiasprev|goias\s+previd/.test(t) ||
      /\bipasgo\b/.test(t) ||
      // "GO" OU "GOIAS": era `detran[\s\-\/]*go\b`, e a fronteira depois de "go"
      // recusava "DETRAN GOIÁS" escrito por extenso — que é como a autarquia
      // aparece em metade dos requisitórios.
      /detran[\s\-\/]*go(ias)?\b/.test(t) || /departamento\s+estadual\s+de\s+transito\s+de\s+goias/.test(t) ||
      /\bagr\b.*goi|agencia\s+goiana/.test(t) ||
      /\bagehab\b|agrodefesa|\bgoinfra\b/.test(t) ||
      /\bueg\b|universidade\s+estadual\s+de\s+goias/.test(t) ||
      /procuradoria[\s-]*geral\s+d[eo]\s+estado\s+d[eo]\s+goias|\bpge[\s\-\/]*go\b/.test(t)
    );
  });
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
export { PISO_NEGOCIO } from './piso.ts';

// Aplica a ÁRVORE DE DECISÃO do Portão 1 sobre o JSON da IA.
// Retorna aprovado + motivos de recusa (se houver) + avisos (não reprovam).
export function avaliarQualificacao(q: any): { aprovado: boolean; motivos: string[]; avisos: string[] } {
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
