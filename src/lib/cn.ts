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
 *
 * A GRADE DE 4 PX E AS ALTURAS DE CONTROLE (`p-s4`, `h-controle`) e AS CAMADAS
 * (`z-topo`), da auditoria visual de 03/10/2026, entram pelo mesmo motivo: sem
 * elas, `cn('h-controle', 'h-9')` deixava as duas classes, e quem vencia era a
 * ordem do CSS, não a tela.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['corpo'],
      radius: ['controle', 'campo', 'cartao', 'janela', 'flutuante'],
      shadow: ['nivel-1', 'nivel-2', 'nivel-3'],
      spacing: [
        's0.5', 's1', 's1.5', 's2', 's3', 's4', 's5', 's6', 's8', 's10', 's12', 's16',
        'controle-sm', 'controle', 'controle-lg',
      ],
    },
    classGroups: {
      z: [{ z: ['cabecalho', 'topo', 'assistente', 'assistente-painel', 'janela', 'aviso-versao', 'aviso'] }],
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
