/**
 * A LEITURA DO TEXTO DA IA (design system v3): o Markdown do `TextoIA` vestido
 * de relatório de mercado, sem mexer no componente compartilhado — as regras
 * descem pelo contêiner que o envolve. Vale para a resposta do assistente e
 * para o panorama do caso na geração de petição, que exibem prosa do mesmo
 * modelo (o mesmo motivo do `TextoIA` ser um só).
 *
 * A TABELA VIRA GRADE FINANCEIRA: quadro de linha fina, cabeçalho em
 * sobretítulo sobre a `superficie-2`, listra sutil, hover de linha e a última
 * linha sem fio. O negrito é o seminegrito da casa (peso máximo 600), e o
 * marcador da lista, o champanhe de ornamento (`ouro-forte`, a linha de 3:1).
 *
 * Só apresentação; em texto puro (junta, sem `cn`, para o tailwind-merge não
 * mexer nas variantes arbitrárias).
 */
export const LEITURA_DA_IA = [
  '[overflow-wrap:anywhere] [&_strong]:font-semibold marker:text-ouro-forte',
  '[&_div:has(>table)]:my-s1 [&_div:has(>table)]:rounded-campo [&_div:has(>table)]:border [&_div:has(>table)]:border-borda [&_div:has(>table)]:bg-superficie',
  '[&_th]:cj-sobretitulo [&_th]:whitespace-nowrap [&_th]:bg-superficie-2 [&_th]:px-s2 [&_th]:py-[7px]',
  '[&_td]:px-s2 [&_td]:py-[7px] [&_td]:text-texto [&_td:first-child]:font-medium',
  '[&_tbody_tr]:transition-colors [&_tbody_tr:nth-child(even)]:bg-superficie-2/60 [&_tbody_tr:hover]:bg-superficie-3/60',
  '[&_tbody_tr:last-child_td]:border-b-0',
  '[&_hr]:border-borda [&_blockquote]:border-ouro-borda',
].join(' ')
