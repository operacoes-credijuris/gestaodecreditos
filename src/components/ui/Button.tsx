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

// AS VARIANTES DA AMOSTRA (estilo.css, `.btn-*`). O primário é o azul de títulos
// do contrato chapado (#0A6296, 6,6:1 com o branco); o gradiente que partia do
// azul da logomarca saiu, porque no #0B81C5 o texto branco ficava em 4,2:1.
const variants: Record<Variant, string> = {
  // DESLIGADO NO ESCURO (auditoria visual, E6): o `opacity-50` sobre o azul
  // #1677b5 virava um azul lamacento que ainda parecia clicável. No escuro, o
  // primário desligado é a superfície apagada, sem a transparência.
  primary:
    'bg-marca text-white shadow-nivel-1 hover:bg-marca-hover dark:disabled:bg-superficie-3 dark:disabled:text-texto-3 dark:disabled:opacity-100',
  // A AMOSTRA NÃO TEM BOTÃO ESCURO. O "secundário" dela é o contornado — o que
  // aqui sempre se chamou `outline`. As cinco telas que pediam `secondary` (o
  // "Executar análise" do card, entre elas) ficam iguais ao contornado: na
  // amostra esse mesmo botão é `btn-secondary`.
  //
  // `outline` É APELIDO DE `secondary` (auditoria visual, §0.6): as duas sempre
  // tiveram as mesmas classes. Código novo usa `secondary`; o apelido fica para
  // nada quebrar.
  secondary: 'border-borda-forte bg-superficie text-texto hover:bg-superficie-3',
  outline: 'border-borda-forte bg-superficie text-texto hover:bg-superficie-3',
  ghost: 'text-texto-2 hover:bg-superficie-3 hover:text-texto',
  // O hover CLAREIA um pouco (o `filter: brightness` da amostra) em vez de
  // escurecer: o vermelho e o verde já estão no tom mais escuro em que o branco
  // passa de 4,5:1 com folga.
  danger: 'bg-perigo-cheio text-white shadow-nivel-1 hover:brightness-105',
  // O PERIGO DENTRO DA JANELA (auditoria visual, §0.6): contornado, à esquerda
  // do rodapé ("Reprovar crédito"). O cheio fica só para a confirmação final.
  dangerOutline: 'border-perigo-borda bg-superficie text-perigo hover:bg-perigo-fundo',
  // Desfechos positivo e intermediário, para telas em que as saídas são
  // alternativas legítimas e a cor comunica mais rápido que o rótulo.
  success: 'bg-sucesso-cheio text-white shadow-nivel-1 hover:brightness-105',
  // O aviso da amostra é PÁLIDO (fundo de aviso, texto âmbar escuro), e não o
  // laranja cheio de antes: cheio, ele brigava com o vermelho de perigo.
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
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        // whitespace-nowrap: as alturas são fixas (as de controle), então rótulo
        // que quebra em duas linhas vaza do botão em vez de esticá-lo.
        // BORDA EM TODAS AS VARIANTES (transparente onde não aparece), como a
        // `.btn` da amostra: assim o contornado e o cheio têm a mesma altura
        // quando uma tela troca `h-*` por padding.
        'inline-flex items-center justify-center whitespace-nowrap rounded-controle border border-transparent font-semibold transition-all duration-150',
        // O anel de foco é o mesmo em toda variante (o da amostra): o foco diz
        // "você está aqui", não "isto é perigoso".
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-2',
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
