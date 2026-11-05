/**
 * motorPercentualRCL — enquadramento do art. 100, §§ 23 e 24, CF (EC 136/2025).
 *
 * Função pura. A razão mora/RCL é comparada com precisão exata em
 * centavos inteiros (BigInt): mora × 10.000 ≤ limiar_bp × RCL. Nenhum
 * arredondamento interfere no limiar (T01–T06). Arredondar só na tela.
 */
import type { Centavos, Leitura24, PontosBase, Verificacao24 } from '../dominio/tipos';
import type { RegrasJuridicas } from '../regras/regrasJuridicas';
import { arred } from '../dominio/dinheiro';

export interface EntradaEnquadramento {
  ano: number;
  rclAnterior: Centavos | null;
  moraEm1Jan: Centavos | null;
  regras: RegrasJuridicas;
  leitura24: Leitura24;
  verificacao24: Verificacao24;
  /** Para a verificação no início do decênio: mora em 1º/jan do ano inicial do decênio. */
  moraInicioDecenio?: Centavos | null;
  /** Alíquota manual quando a mora é desconhecida (simulação parametrizada). */
  aliquotaManualBp?: PontosBase | null;
}

export interface AdicionalDecenal {
  bp: PontosBase;
  decenio: number; // 0 antes de 2036; 1 em 2036–2045; 2 em 2046–2055…
  explicacao: string;
  pendenteRevisao: boolean;
}

interface BaseResultado {
  ano: number;
  regraId: string;
  versaoRegras: string;
  explicacao: string[];
}

export type ResultadoEnquadramento =
  | (BaseResultado & {
      status: 'calculada';
      razao: number;
      faixa: number; // 1..9 (inciso)
      descricaoFaixa: string;
      aliquotaBaseBp: PontosBase;
      adicional: AdicionalDecenal;
      aliquotaAplicavelBp: PontosBase;
      limite: Centavos;
      rclAnterior: Centavos;
      moraEm1Jan: Centavos;
    })
  | (BaseResultado & {
      status: 'manual';
      aliquotaAplicavelBp: PontosBase;
      limite: Centavos;
      rclAnterior: Centavos;
      aviso: string;
    })
  | (BaseResultado & { status: 'bloqueada'; motivo: 'rcl_ausente' | 'rcl_invalida'; mensagem: string })
  | (BaseResultado & { status: 'indeterminada'; motivo: 'mora_ausente' | 'mora_invalida'; mensagem: string; rclAnterior: Centavos });

const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

/** Faixa (1..9) e alíquota-base para mora e RCL já validadas (RCL > 0, mora ≥ 0). */
export function faixaConstitucional(mora: Centavos, rcl: Centavos, regras: RegrasJuridicas): { faixa: number; aliquotaBp: PontosBase } {
  const m = BigInt(Math.round(mora));
  const r = BigInt(Math.round(rcl));
  const lim = regras.faixas.limiaresBp;
  for (let i = 0; i < lim.length; i++) {
    if (m * BigInt(10000) <= BigInt(lim[i]) * r) return { faixa: i + 1, aliquotaBp: regras.faixas.aliquotasBp[i] };
  }
  return { faixa: lim.length + 1, aliquotaBp: regras.faixas.aliquotasBp[lim.length] };
}

export function descreverFaixa(faixa: number, regras: RegrasJuridicas): string {
  const lim = regras.faixas.limiaresBp.map((b) => `${b / 100}%`);
  const inciso = ROMANOS[faixa - 1] ?? String(faixa);
  if (faixa === 1) return `Inciso ${inciso}: sem estoque em mora ou até ${lim[0]} da RCL`;
  if (faixa === lim.length + 1) return `Inciso ${inciso}: acima de ${lim[lim.length - 1]} da RCL`;
  return `Inciso ${inciso}: acima de ${lim[faixa - 2]} até ${lim[faixa - 1]} da RCL`;
}

/** § 24 — acréscimo decenal conforme a leitura configurada (pendente de revisão). */
export function adicionalDecenal(
  ano: number,
  moraEm1Jan: Centavos | null,
  leitura: Leitura24,
  verificacao: Verificacao24,
  regras: RegrasJuridicas,
  moraInicioDecenio?: Centavos | null,
): AdicionalDecenal {
  const r = regras.adicionalDecenal;
  const decenio = ano < r.anoInicio ? 0 : Math.floor((ano - r.anoInicio) / r.periodoAnos) + 1;
  if (decenio === 0) {
    return { bp: 0, decenio, explicacao: `Antes de ${r.anoInicio}: § 24 ainda não incide.`, pendenteRevisao: false };
  }
  if (leitura === 'desligada') {
    return { bp: 0, decenio, explicacao: 'Leitura "desligada": nenhum acréscimo até aprovação jurídica.', pendenteRevisao: true };
  }
  const moraReferencia = verificacao === 'inicio_decenio' ? (moraInicioDecenio ?? moraEm1Jan) : moraEm1Jan;
  const anoVerificacao = verificacao === 'inicio_decenio' ? r.anoInicio + (decenio - 1) * r.periodoAnos : ano;
  if (moraReferencia === null || moraReferencia === undefined) {
    return { bp: 0, decenio, explicacao: `Mora em 1º/1/${anoVerificacao} desconhecida: acréscimo não verificável.`, pendenteRevisao: true };
  }
  if (moraReferencia <= 0) {
    return { bp: 0, decenio, explicacao: `Sem estoque em mora em 1º/1/${anoVerificacao}: sem acréscimo.`, pendenteRevisao: true };
  }
  const bp = leitura === 'cumulativa' ? r.acrescimoBp * decenio : r.acrescimoBp;
  const txt =
    leitura === 'cumulativa'
      ? `${decenio}º decênio desde ${r.anoInicio}, leitura cumulativa: +${(bp / 100).toLocaleString('pt-BR')} p.p.`
      : `A partir de ${r.anoInicio}, leitura fixa: +${(bp / 100).toLocaleString('pt-BR')} p.p.`;
  return { bp, decenio, explicacao: `${txt} Mora verificada em 1º/1/${anoVerificacao}. Interpretação pendente de revisão jurídica.`, pendenteRevisao: true };
}

export function calcularEnquadramento(e: EntradaEnquadramento): ResultadoEnquadramento {
  const base: BaseResultado = { ano: e.ano, regraId: e.regras.faixas.id, versaoRegras: e.regras.versao, explicacao: [] };

  if (e.rclAnterior === null || e.rclAnterior === undefined || Number.isNaN(e.rclAnterior)) {
    return { ...base, status: 'bloqueada', motivo: 'rcl_ausente', mensagem: `RCL de ${e.ano - 1} não informada: a faixa constitucional não é calculável. Nenhuma alíquota é presumida.` };
  }
  if (e.rclAnterior <= 0) {
    return { ...base, status: 'bloqueada', motivo: 'rcl_invalida', mensagem: `RCL de ${e.ano - 1} igual a zero ou negativa: valor incompatível. Verifique a fonte (RGF/Siconfi). Nenhuma alíquota é presumida.` };
  }
  const rcl = e.rclAnterior;

  if (e.moraEm1Jan === null || e.moraEm1Jan === undefined || Number.isNaN(e.moraEm1Jan)) {
    if (e.aliquotaManualBp !== null && e.aliquotaManualBp !== undefined && e.aliquotaManualBp > 0) {
      const limite = arred((rcl * e.aliquotaManualBp) / 10000);
      return {
        ...base,
        status: 'manual',
        aliquotaAplicavelBp: e.aliquotaManualBp,
        limite,
        rclAnterior: rcl,
        aviso: 'Simulação parametrizada: alíquota informada manualmente, sem verificação legal da faixa (estoque em mora desconhecido).',
        explicacao: [`Limite = RCL ${e.ano - 1} × alíquota manual (não verificada).`],
      };
    }
    return {
      ...base,
      status: 'indeterminada',
      motivo: 'mora_ausente',
      rclAnterior: rcl,
      mensagem: `Estoque em mora em 1º/1/${e.ano} não informado: faixa indeterminada. O estoque total não substitui o estoque em mora.`,
    };
  }
  if (e.moraEm1Jan < 0) {
    return { ...base, status: 'indeterminada', motivo: 'mora_invalida', rclAnterior: rcl, mensagem: 'Estoque em mora negativo: valor inválido.' };
  }

  const mora = e.moraEm1Jan;
  const { faixa, aliquotaBp } = faixaConstitucional(mora, rcl, e.regras);
  const adicional = adicionalDecenal(e.ano, mora, e.leitura24, e.verificacao24, e.regras, e.moraInicioDecenio);
  const aliquotaAplicavelBp = aliquotaBp + adicional.bp;
  const limite = arred((rcl * aliquotaAplicavelBp) / 10000);
  const razao = mora / rcl;

  return {
    ...base,
    status: 'calculada',
    razao,
    faixa,
    descricaoFaixa: descreverFaixa(faixa, e.regras),
    aliquotaBaseBp: aliquotaBp,
    adicional,
    aliquotaAplicavelBp,
    limite,
    rclAnterior: rcl,
    moraEm1Jan: mora,
    explicacao: [
      `razão = mora em 1º/1/${e.ano} ÷ RCL ${e.ano - 1}`,
      `faixa = ${descreverFaixa(faixa, e.regras)}`,
      `alíquota aplicável = alíquota-base + adicional decenal`,
      `limite (teto) = RCL ${e.ano - 1} × alíquota aplicável`,
    ],
  };
}
