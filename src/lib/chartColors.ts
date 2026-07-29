/**
 * Cores de gráficos (Recharts) alinhadas à identidade da marca.
 * Use estas constantes em vez de hex soltos nos componentes.
 */
export const CHART = {
  /** Série principal (barras/linhas) — brand-600 */
  primary: '#234e88',
  /** Série secundária — brand-400 */
  secondary: '#4d83c6',
  /** Destaque/acento — gold-500 */
  accent: '#cda032',
  /** Grade e eixos */
  grid: '#e2e8f0',
  /** Texto de eixo/rótulo */
  label: '#64748b',
  /** Título/tooltips */
  ink: '#0f223d',
  /** Paleta categórica (pizza/barras multi-série) */
  series: ['#234e88', '#4d83c6', '#cda032', '#7ba7da', '#a98226', '#1a3760'],
} as const
