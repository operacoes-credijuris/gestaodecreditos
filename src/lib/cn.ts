import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * O tailwind-merge precisa SABER os nomes próprios do tailwind.config.js.
 *
 * Sem isto ele não reconhece `text-corpo` como tamanho de letra: todo `text-x`
 * que não seja xs/sm/lg… ele toma por COR, e então `cn('text-corpo',
 * 'text-texto-2')` jogava fora o `text-corpo` como se fossem duas cores
 * brigando — o texto voltava para os 12px da raiz sem erro nenhum. O mesmo com
 * `rounded-cartao` (não seria trocado por um `rounded-lg` vindo da tela) e com
 * `shadow-nivel-1` (lido como cor de sombra). As cores por papel (`texto-2`,
 * `borda-forte`…) não precisam: o que não é tamanho ele já trata como cor.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['corpo'],
      radius: ['controle', 'campo', 'cartao', 'janela'],
      shadow: ['nivel-1', 'nivel-2', 'nivel-3'],
    },
  },
})

/**
 * Concatena classes condicionalmente e resolve conflitos de Tailwind de forma
 * determinística (a última classe vence — ex.: cn('p-4', 'p-0') === 'p-0').
 */
export function cn(...parts: ClassValue[]): string {
  return twMerge(clsx(parts))
}
