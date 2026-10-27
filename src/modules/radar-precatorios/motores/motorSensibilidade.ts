/**
 * motorSensibilidade — testes de estresse (seção 7) e "quanto precisaria
 * aportar?" (D3). Reaproveita o motor de projeção; nada é calculado à parte.
 */
import type { Cenario, Centavos, Projeto } from '../dominio/tipos';
import type { RegrasJuridicas } from '../regras/regrasJuridicas';
import { projetar, type ResultadoProjecao } from './motorProjecao';

export interface ResumoCenario {
  passivoFinal: Centavos | null;
  moraFinal: Centavos | null;
  anoZeragemMora: number | null;
  convergiu: boolean;
  bloqueada: boolean;
}

export function resumir(r: ResultadoProjecao): ResumoCenario {
  const ult = r.linhas[r.linhas.length - 1];
  return {
    passivoFinal: ult ? ult.passivoFinal : null,
    moraFinal: ult ? ult.moraProximo1Jan : null,
    anoZeragemMora: r.anoZeragemMora,
    convergiu: r.convergiu,
    bloqueada: r.status === 'bloqueada',
  };
}

export interface TesteEstresse {
  id: string;
  titulo: string;
  premissa: string;
  resumo: ResumoCenario;
  deltaPassivo: Centavos | null;
  deltaMora: Centavos | null;
}

/** Choque de um parâmetro por vez sobre o cenário escolhido (seção 7, "Stress tests"). */
export function testesDeEstresse(projeto: Projeto, cen: Cenario, regras: RegrasJuridicas): { base: ResumoCenario; testes: TesteEstresse[] } {
  const t0 = projeto.anoBase;
  const base = resumir(projetar(projeto, cen, regras));
  const rcl0 = projeto.dados.rclAnterior.valor ?? 0;
  const variantes: { id: string; titulo: string; premissa: string; cen: Cenario }[] = [
    { id: 'insc30', titulo: 'Novos precatórios +30% por três anos', premissa: `Inscrições de ${t0} a ${t0 + 2} 30% acima do cenário.`, cen: { ...cen, choques: [...cen.choques, { id: 'x1', tipo: 'aumento_inscricoes', anoInicio: t0, duracaoAnos: 3, valor: 0.3 }] } },
    { id: 'rcl10', titulo: 'RCL cai 10% em um exercício', premissa: `RCL de ${t0} 10% menor que a de ${t0 - 1} (afeta o limite de ${t0 + 1}).`, cen: { ...cen, choques: [...cen.choques, { id: 'x2', tipo: 'queda_rcl', anoInicio: t0, duracaoAnos: 1, valor: 0.1 }] } },
    { id: 'exec70', titulo: 'Ente realiza só 70% dos depósitos', premissa: 'Execução de 70% do aporte previsto em todos os anos.', cen: { ...cen, execucaoDepositos: 0.7, choques: cen.choques.filter((c) => c.tipo !== 'execucao_depositos') } },
    { id: 'atualiza', titulo: 'Dívida atualiza acima da RCL', premissa: 'Taxa da mora 3 p.p. acima do crescimento da RCL.', cen: { ...cen, taxaMora: cen.crescimentoRCL + 0.03 } },
    { id: 'acordos', titulo: 'Mais recursos para acordos', premissa: 'Mais 25 p.p. dos aportes destinados a acordos diretos, com o deságio do cenário.', cen: { ...cen, pctAcordos: Math.min(1, cen.pctAcordos + 0.25) } },
    { id: 'excepcional', titulo: 'Precatório excepcional', premissa: `Entrada de um precatório de 10% da RCL de ${t0 - 1} em ${t0 + 2}.`, cen: { ...cen, choques: [...cen.choques, { id: 'x3', tipo: 'precatorio_excepcional', anoInicio: t0 + 2, duracaoAnos: 1, valor: Math.round(rcl0 * 0.1) }] } },
  ];
  const testes = variantes.map((v) => {
    const r = resumir(projetar(projeto, v.cen, regras));
    return {
      id: v.id,
      titulo: v.titulo,
      premissa: v.premissa,
      resumo: r,
      deltaPassivo: r.passivoFinal !== null && base.passivoFinal !== null ? r.passivoFinal - base.passivoFinal : null,
      deltaMora: r.moraFinal !== null && base.moraFinal !== null ? r.moraFinal - base.moraFinal : null,
    };
  });
  return { base, testes };
}

export interface AporteNecessario {
  objetivo: 'zerar' | 'estabilizar';
  anoAlvo: number | null;
  extraAnual: Centavos | null;
  pctRCL: number | null;
  alcancavel: boolean;
  texto: string;
}

function buscar(ok: (extra: number) => boolean, teto: number): number | null {
  if (ok(0)) return 0;
  let hi = Math.max(100_00, teto);
  let tentativas = 0;
  while (!ok(hi)) {
    hi *= 2;
    if (++tentativas > 12) return null;
  }
  let lo = 0;
  while (hi - lo > 1_000_00) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 1_000_00) * 1_000_00; // arredonda para cima, em R$ 1.000
}

/**
 * Menor aporte extraordinário anual constante (§ 28, acima do teto) que,
 * somado ao cenário, zera o estoque em mora até 1º/jan do ano-alvo.
 */
export function aporteParaZerar(projeto: Projeto, cen: Cenario, regras: RegrasJuridicas, anosAteZerar: number): AporteNecessario {
  const anoAlvo = projeto.anoBase + anosAteZerar;
  const proj = { ...projeto, config: { ...projeto.config, horizonteAnos: Math.max(projeto.config.horizonteAnos, anosAteZerar) } };
  const r0 = projetar(proj, cen, regras);
  if (r0.status !== 'ok') return { objetivo: 'zerar', anoAlvo, extraAnual: null, pctRCL: null, alcancavel: false, texto: 'Indisponível: projeção bloqueada ou parametrizada.' };
  if (r0.semMoraInicial) return { objetivo: 'zerar', anoAlvo, extraAnual: 0, pctRCL: 0, alcancavel: true, texto: 'Sem estoque em mora no ano-base.' };
  const ok = (extra: number) => {
    const r = projetar(proj, cen, regras, { extraordinarioAdicional: extra });
    const l = r.linhas.find((x) => x.ano === anoAlvo - 1);
    return !!l && (l.moraProximo1Jan ?? Infinity) <= 100;
  };
  const passivo = r0.linhas[0]?.passivoInicial ?? 0;
  const extra = buscar(ok, Math.ceil(passivo / anosAteZerar));
  const rcl = projeto.dados.rclAnterior.valor ?? 0;
  if (extra === null) return { objetivo: 'zerar', anoAlvo, extraAnual: null, pctRCL: null, alcancavel: false, texto: 'Não encontrado dentro dos limites da busca.' };
  return {
    objetivo: 'zerar',
    anoAlvo,
    extraAnual: extra,
    pctRCL: rcl > 0 ? extra / rcl : null,
    alcancavel: true,
    texto: extra === 0 ? `O cenário já zera a mora até 1º/1/${anoAlvo}.` : `Aporte extra constante, acima do teto e com dotação específica (§ 28), necessário para zerar a mora até 1º/1/${anoAlvo}.`,
  };
}

/** Menor aporte extra anual que impede o passivo de crescer no horizonte. */
export function aporteParaEstabilizar(projeto: Projeto, cen: Cenario, regras: RegrasJuridicas): AporteNecessario {
  const r0 = projetar(projeto, cen, regras);
  if (r0.status !== 'ok' || !r0.linhas.length) return { objetivo: 'estabilizar', anoAlvo: null, extraAnual: null, pctRCL: null, alcancavel: false, texto: 'Indisponível: projeção bloqueada ou parametrizada.' };
  const ini = r0.linhas[0].passivoInicial;
  const ok = (extra: number) => {
    const r = projetar(projeto, cen, regras, { extraordinarioAdicional: extra });
    const l = r.linhas[r.linhas.length - 1];
    return !!l && l.passivoFinal <= ini;
  };
  const extra = buscar(ok, Math.ceil(ini / Math.max(1, r0.linhas.length)));
  const rcl = projeto.dados.rclAnterior.valor ?? 0;
  if (extra === null) return { objetivo: 'estabilizar', anoAlvo: null, extraAnual: null, pctRCL: null, alcancavel: false, texto: 'Não encontrado dentro dos limites da busca.' };
  return {
    objetivo: 'estabilizar',
    anoAlvo: r0.anoFinal,
    extraAnual: extra,
    pctRCL: rcl > 0 ? extra / rcl : null,
    alcancavel: true,
    texto: extra === 0 ? 'O passivo já não cresce no horizonte.' : `Aporte extra constante para o passivo de ${r0.anoFinal} não superar o de ${projeto.anoBase}.`,
  };
}
