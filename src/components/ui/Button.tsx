import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'dangerOutline'
  | 'success'
  | 'warning'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

// AS VARIANTES (design system v3, 12/11/2026). O primário é `bg-marca` com a
// letra `marca-contraste`: o marinho com letra branca no claro, o champanhe com
// letra marinho no escuro. Os cheios levam o BRILHO da casa (`cj-brilho`, em
// index.css): uma luz de cima quase invisível e o fio claro na borda de cima —
// o que separa um botão de verdade de um retângulo chapado.
const variants: Record<Variant, string> = {
  // DESLIGADO NO ESCURO (auditoria visual, E6): o `opacity-50` sobre o cheio
  // virava uma cor lamacenta que ainda parecia clicável. No escuro, o primário
  // desligado é a superfície apagada, sem a transparência.
  primary:
    'cj-brilho bg-marca text-marca-contraste hover:bg-marca-hover dark:disabled:bg-superficie-3 dark:disabled:bg-none dark:disabled:text-texto-3 dark:disabled:opacity-100',
  // O SECUNDÁRIO É O CONTORNADO, na superfície, com a sombra de contato do
  // cartão (no claro ele "assenta" na página). `outline` É APELIDO DE
  // `secondary` (auditoria visual, §0.6): código novo usa `secondary`.
  secondary: 'border-borda-forte bg-superficie text-texto shadow-nivel-1 hover:border-borda-controle hover:bg-superficie-2',
  outline: 'border-borda-forte bg-superficie text-texto shadow-nivel-1 hover:border-borda-controle hover:bg-superficie-2',
  ghost: 'text-texto-2 hover:bg-superficie-3 hover:text-texto',
  // O hover CLAREIA um pouco em vez de escurecer: o vermelho e o verde já
  // estão no tom mais escuro em que o branco passa de 4,5:1 com folga.
  danger: 'cj-brilho bg-perigo-cheio text-white hover:brightness-110',
  // O PERIGO DENTRO DA JANELA (auditoria visual, §0.6): contornado, à esquerda
  // do rodapé ("Reprovar crédito"). O cheio fica só para a confirmação final.
  dangerOutline: 'border-perigo-borda bg-superficie text-perigo hover:bg-perigo-fundo',
  // Desfechos positivo e intermediário, para telas em que as saídas são
  // alternativas legítimas e a cor comunica mais rápido que o rótulo.
  success: 'cj-brilho bg-sucesso-cheio text-white hover:brightness-110',
  // O aviso é PÁLIDO (fundo de aviso, texto laranja-queimado): cheio, ele
  // brigava com o vermelho de perigo.
  warning: 'border-aviso-borda bg-aviso-fundo text-aviso hover:brightness-95',
}

// AS ALTURAS DE CONTROLE (auditoria visual, §0.2): o `md` tem 36px, a mesma
// altura do campo, do select e do segmentado — numa barra de filtros, tudo na
// mesma linha (eram 33, 35 e 39px). O `sm` (ação de linha) tem 28px; o `lg`,
// 40px, só no Entrar e em formulário de página inteira.
const sizes: Record<Size, string> = {
  sm: 'h-controle-sm px-s3 text-sm gap-s1.5',
  md: 'h-controle px-s4 text-sm gap-s2',
  lg: 'h-controle-lg px-s5 text-corpo gap-s2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  // `button` POR PADRÃO (23/10/2026), como o IconButton e o Chip: sem `type`, um
  // botão dentro de <form> é de envio, e um "Remover arquivo" ou "Voltar ao
  // card" posto ali gravaria o formulário. Todo envio da plataforma já diz
  // `type="submit"` com todas as letras — conferido em todos os formulários.
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        // whitespace-nowrap: as alturas são fixas (as de controle), então rótulo
        // que quebra em duas linhas vaza do botão em vez de esticá-lo.
        // BORDA EM TODAS AS VARIANTES (transparente onde não aparece), como a
        // `.btn` da amostra: assim o contornado e o cheio têm a mesma altura
        // quando uma tela troca `h-*` por padding.
        'inline-flex items-center justify-center whitespace-nowrap rounded-controle border border-transparent font-semibold tracking-[0.005em] transition-[background-color,border-color,color,box-shadow,transform,filter] duration-rapida ease-saida',
        // O anel de foco é o mesmo em toda variante (o da amostra): o foco diz
        // "você está aqui", não "isto é perigoso".
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-2 focus-visible:ring-offset-superficie',
        'active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:brightness-100 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-[16px] w-[16px] animate-spin" /> : icon}
      {children}
    </button>
  )
}
