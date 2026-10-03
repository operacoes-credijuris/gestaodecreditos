/**
 * Cores dos gráficos (Recharts), as da amostra aprovada (graficos.js e
 * estilo2.css, `--series-*`). Use estas constantes em vez de hex soltos.
 *
 * EM HEX, E NÃO EM VARIÁVEL CSS, porque o Recharts escreve a cor como ATRIBUTO
 * do SVG (`fill="…"`, `stroke="…"`), e atributo não resolve `var(--x)` em todo
 * navegador. Os neutros repetem os tokens de `src/index.css` (`--borda`,
 * `--borda-forte`, `--texto-3`, `--texto`, `--superficie`): mudou um token lá,
 * mude aqui também. No modo escuro (etapa posterior) esta lista ganha a versão
 * escura que a amostra já traz.
 *
 * AS SÉRIES SÃO UMA PALETA CATEGÓRICA validada para daltonismo, em ORDEM FIXA:
 * a primeira série de qualquer gráfico é sempre azul, a segunda laranja.
 */
export const CHART = {
  /** Série principal (barras/linhas) — `--series-1` da amostra. */
  primary: '#2a78d6',
  /** Segunda série — `--series-2`. */
  secondary: '#eb6834',
  /** Terceira série — `--series-3`. */
  accent: '#1baf7a',
  /** Grade — o token `--borda` (#e8e2d6). */
  grid: '#e8e2d6',
  /** Eixo de base — `--borda-forte` (#d6cdbd). */
  axis: '#d6cdbd',
  /** Rótulo de eixo e de barra — `--texto-3` (#626d7e). */
  label: '#626d7e',
  /** Valor em destaque (ponta da linha) e título da dica — `--texto` (#17202b). */
  ink: '#17202b',
  /** Contorno do ponto final da linha — `--superficie`. */
  surface: '#ffffff',
  /** Paleta categórica, na ordem fixa da amostra. */
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
} as const
