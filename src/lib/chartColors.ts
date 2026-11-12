import { useTema, type Tema } from './tema'

/**
 * Cores dos gráficos (Recharts), as do design system v3 (repaginação,
 * 12/11/2026). Use estas constantes em vez de hex soltos.
 *
 * EM HEX, E NÃO EM VARIÁVEL CSS, porque o Recharts escreve a cor como ATRIBUTO
 * do SVG (`fill="…"`, `stroke="…"`), e atributo não resolve `var(--x)` em todo
 * navegador. Os neutros repetem os tokens de `src/index.css` (`--borda`,
 * `--borda-forte`, `--texto-3`, `--texto`, `--superficie`): mudou um token lá,
 * mude aqui também (o contraste.test.ts confere). Por isso há DUAS listas, a do
 * claro e a do escuro, e a tela pega a do tema que se vê por `useCoresDoGrafico`.
 *
 * AS SÉRIES SÃO UMA PALETA CATEGÓRICA, em ORDEM FIXA — safira, champanhe
 * envelhecido, verde-petróleo: o par azul × ouro da marca vem primeiro, e é
 * também o par mais seguro para daltonismo. VALIDADA pelo validate_palette.js
 * do guia de visualização (12/11/2026), nos dois temas: a faixa de
 * luminosidade, o croma mínimo, a separação sob deuteranopia, protanopia e
 * tritanopia (ΔE ≥ 9 em TODOS os pares) e 3:1 contra a superfície. TRÊS, E NÃO
 * MAIS: nenhuma quarta cor desta família passou em todos os pares — a quarta
 * série vira "Outros" (na cor `label`) ou gráficos pequenos lado a lado. O champanhe puro (#c8a96a) NÃO entra: no claro dava 2,3:1 no
 * cartão, e no escuro lia como cinza (croma baixo). Trocar uma cor aqui pede
 * rodar o validador de novo.
 */
export const CHART = {
  /** Série principal (barras/linhas): a safira. */
  primary: '#2c64b0',
  /** Segunda série: o champanhe envelhecido. */
  secondary: '#c2852a',
  /** Terceira série: o verde-petróleo. */
  accent: '#13866f',
  /** Grade — o token `--borda` (#e5e0d6). */
  grid: '#e5e0d6',
  /** Eixo de base — `--borda-forte` (#d2cabb). */
  axis: '#d2cabb',
  /** Rótulo de eixo e de barra — `--texto-3` (#5f6878). */
  label: '#5f6878',
  /** Valor em destaque (ponta da linha) e título da dica — `--texto` (#0e1a2b). */
  ink: '#0e1a2b',
  /** Contorno do ponto final da linha — `--superficie`. */
  surface: '#ffffff',
  /** Paleta categórica, na ordem fixa. */
  series: ['#2c64b0', '#c2852a', '#13866f'],
} as const

export type CoresDoGrafico = { [K in keyof typeof CHART]: (typeof CHART)[K] extends readonly string[] ? readonly string[] : string }

/** O mesmo, no escuro sóbrio: as séries validadas contra o cartão escuro (#111825). */
export const CHART_ESCURO: CoresDoGrafico = {
  primary: '#3f78c9',
  secondary: '#b98a34',
  accent: '#179077',
  grid: '#222c3e', // --borda
  axis: '#2f3b52', // --borda-forte
  label: '#8c97a9', // --texto-3
  ink: '#e8ecf2', // --texto
  surface: '#111825', // --superficie
  series: ['#3f78c9', '#b98a34', '#179077'],
}

export function coresDoGrafico(tema: Tema): CoresDoGrafico {
  return tema === 'escuro' ? CHART_ESCURO : CHART
}

/** As cores do gráfico no tema que se vê (troca junto com o botão da lua). */
export function useCoresDoGrafico(): CoresDoGrafico {
  return coresDoGrafico(useTema().tema)
}
