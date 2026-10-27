import type { Origem } from '../dominio/tipos';

export type Aba = 'painel' | 'ente' | 'enquadramento' | 'historico' | 'cenarios' | 'alvo' | 'regras' | 'testes' | 'projeto';

export const ABAS: { id: Aba; rotulo: string; curto: string }[] = [
  { id: 'painel', rotulo: 'Painel', curto: 'Painel' },
  { id: 'ente', rotulo: 'Ente devedor', curto: 'Ente' },
  { id: 'enquadramento', rotulo: 'Enquadramento EC 136', curto: 'EC 136' },
  { id: 'historico', rotulo: 'Histórico e livros', curto: 'Histórico' },
  { id: 'cenarios', rotulo: 'Cenários', curto: 'Cenários' },
  { id: 'alvo', rotulo: 'Precatório-alvo', curto: 'Alvo' },
  { id: 'regras', rotulo: 'Regras jurídicas', curto: 'Regras' },
  { id: 'testes', rotulo: 'Testes', curto: 'Testes' },
  { id: 'projeto', rotulo: 'Projeto e arquivos', curto: 'Projeto' },
];

/** Eixo em reais, sem símbolo: "2,5 mi", "300 mil". */
export function eixoReais(c: number): string {
  const r = c / 100;
  const a = Math.abs(r);
  const f = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (a >= 1e9) return `${f(r / 1e9)} bi`;
  if (a >= 1e6) return `${f(r / 1e6)} mi`;
  if (a >= 1e3) return `${f(r / 1e3)} mil`;
  return f(r);
}

/** A natureza mais fraca entre os insumos (para resultados derivados). */
export function origemMaisFraca(...os: Origem[]): Origem {
  const ordem: Origem[] = ['ausente', 'hipotese', 'estimado', 'analista', 'oficial'];
  return os.reduce((acc, o) => (ordem.indexOf(o) < ordem.indexOf(acc) ? o : acc), 'oficial' as Origem);
}

export function agoraISO(): string {
  return new Date().toISOString();
}

export function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function novoId(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
