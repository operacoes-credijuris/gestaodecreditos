/**
 * Cores de gráficos (Recharts) alinhadas à identidade da marca.
 * Use estas constantes em vez de hex soltos nos componentes.
 */
export const CHART = {
  /** Série principal (barras/linhas) — brand-600 */
  primary: '#0a6296',
  /** Série secundária — brand-400 */
  secondary: '#40abdc',
  /** Destaque/acento — verde-500 (o acento real dos materiais da marca) */
  accent: '#1fa75b',
  /** Grade e eixos */
  grid: '#e2e8f0',
  /** Texto de eixo/rótulo */
  label: '#64748b',
  /** Título/tooltips — brand-900 */
  ink: '#062f44',
  /** Paleta categórica (pizza/barras multi-série) */
  series: ['#0a6296', '#40abdc', '#1fa75b', '#86caea', '#075278', '#2ecc71'],
} as const
