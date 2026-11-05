import type { Centavos, PontosBase } from './tipos';

/** Converte reais (número) em centavos inteiros. */
export const reais = (valor: number): Centavos => Math.round(valor * 100);

/** Arredonda para centavo inteiro (meio para cima, simétrico). */
export const arred = (v: number): Centavos => (v < 0 ? -Math.round(-v) : Math.round(v));

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "R$ 2.500.000,00" — formatação só na apresentação. */
export function formatarBRL(c: Centavos | null | undefined): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '—';
  return fmtBRL.format(c / 100);
}

/** "2.500.000,00" (sem símbolo) para campos de edição. */
export function formatarNumeroBRL(c: Centavos | null | undefined): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '';
  return fmtNum.format(c / 100);
}

/** Forma compacta para eixos e cartões: "R$ 2,5 mi", "R$ 300 mil", "R$ 1,2 bi". */
export function formatarCompacto(c: Centavos | null | undefined): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '—';
  const r = c / 100;
  const abs = Math.abs(r);
  const sinal = r < 0 ? '−' : '';
  const f = (n: number, casas: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
  if (abs >= 1e9) return `${sinal}R$ ${f(abs / 1e9, 2)} bi`;
  if (abs >= 1e6) return `${sinal}R$ ${f(abs / 1e6, 2)} mi`;
  if (abs >= 1e3) return `${sinal}R$ ${f(abs / 1e3, 1)} mil`;
  return `${sinal}R$ ${f(abs, 2)}`;
}

/**
 * Lê valores digitados no padrão brasileiro: "2.500.000,50", "2500000",
 * "2,5", "R$ 300.000". Retorna centavos ou null se ilegível.
 */
export function lerValorBRL(texto: string): Centavos | null {
  if (texto === undefined || texto === null) return null;
  let t = String(texto).trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (t === '') return null;
  let negativo = false;
  if (t.startsWith('-') || t.startsWith('−')) { negativo = true; t = t.slice(1); }
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return negativo ? -c : c;
}

/** Fração → "8,33%" (casas configuráveis). */
export function formatarPct(frac: number | null | undefined, casas = 2): string {
  if (frac === null || frac === undefined || Number.isNaN(frac)) return '—';
  return `${(frac * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

/** Pontos-base → "1,5%". */
export function formatarBp(bp: PontosBase | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  return `${(bp / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

/** "5,5" ou "5.5" ou "5,5%" → 0,055. */
export function lerPct(texto: string): number | null {
  const t = String(texto ?? '').trim().replace('%', '').replace(/\s/g, '').replace(',', '.');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t) / 100;
}

/** ISO aaaa-mm-dd → dd/mm/aaaa. */
export function formatarData(iso?: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** ISO completo → "14/10/2026 13:05". */
export function formatarDataHora(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
