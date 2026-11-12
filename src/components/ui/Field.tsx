import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/cn'

/**
 * O `.inp` da amostra, com duas diferenças conscientes:
 * - A BORDA É `borda-controle` (3,4:1 no branco), e não a `--border-strong` da
 *   amostra (1,6:1): um campo vazio precisa ser visto como campo (WCAG 1.4.11).
 *   O teste de contraste cobra isso.
 * - 36px DE ALTURA (`h-controle`), a mesma do botão médio, do segmentado e
 *   do select (auditoria visual de 03/10/2026, §0.2): antes eram 35px no texto
 *   e 37px na data, e numa linha de filtros nada se alinhava. A caixa de texto
 *   (Textarea) cresce com as linhas, e não tem a altura fixa.
 * Texto em 14px (`corpo`), o mesmo do texto corrido. O erro (aria-invalid, que o
 * Field põe) pinta a borda de vermelho além da mensagem embaixo.
 */
// v3 (12/11/2026): o foco é o ANEL CHAMPANHE — a borda acende no champanhe forte
// e um halo largo e fraco em volta —, com transição de 150ms. Uma sombra
// interna de 1px no alto dá ao campo a sensação de "rebaixado" no claro (no
// escuro ela some no fundo). O erro (aria-invalid) pinta a borda e o halo de
// vermelho.
const baseControl =
  'w-full rounded-campo border border-borda-controle bg-superficie px-4 py-2 text-corpo text-texto ' +
  'shadow-[inset_0_1px_1px_rgb(14_26_43/0.04)] transition-[border-color,box-shadow] duration-rapida ease-saida ' +
  'placeholder:text-texto-3 focus:border-anel focus:outline-none focus:ring-[3px] ' +
  'focus:ring-anel/25 aria-[invalid=true]:border-perigo aria-[invalid=true]:focus:ring-perigo/20 ' +
  'disabled:cursor-not-allowed disabled:bg-superficie-3 disabled:text-texto-2 disabled:opacity-100'

/**
 * Liga rótulo, dica e erro ao controle.
 *
 * POR CONTEXT, e não por cloneElement: Field também embrulha coisa que NÃO é
 * controle — bloco somente-leitura na carteira, grupo de checkboxes em Créditos —
 * e injetar id à força num filho arbitrário quebraria esses casos. Assim, quem
 * for controle consome; o resto ignora.
 *
 * O que isso conserta: clicar no texto "Número" no modal de apenso não focava o
 * campo (a pessoa clicava de novo achando que a tela travou), e num formulário de
 * sete campos iguais o leitor de tela anunciava só "edição, em branco", sem dizer
 * qual campo era.
 */
interface CampoCtx {
  id: string
  descritoPor?: string
  invalido: boolean
}
const FieldContext = createContext<CampoCtx | null>(null)

export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  const id = useId()
  const idErro = `${id}-erro`
  const idDica = `${id}-dica`
  const ctx: CampoCtx = {
    id,
    descritoPor: error ? idErro : hint ? idDica : undefined,
    invalido: !!error,
  }
  return (
    // Rótulo de 14px em seminegrito, 6px até o campo e 6px até a dica — o
    // `.field` da amostra.
    <div className={cn('space-y-2', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-texto">
          {label}
          {required && <span className="ml-0.5 text-perigo">*</span>}
        </label>
      )}
      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      {hint && !error && (
        <p id={idDica} className="text-xs text-texto-3">
          {hint}
        </p>
      )}
      {/* role="alert": erro que aparece depois do Salvar precisa ser anunciado,
          senão quem usa leitor de tela fica esperando sem saber que falhou. */}
      {error && (
        <p id={idErro} role="alert" className="text-xs font-semibold text-perigo">
          {error}
        </p>
      )}
    </div>
  )
}

/** Atributos que o controle herda do Field que o embrulha (se houver um). */
function useCampo(idProprio?: string) {
  const ctx = useContext(FieldContext)
  if (!ctx) return {}
  return {
    id: idProprio ?? ctx.id,
    'aria-describedby': ctx.descritoPor,
    'aria-invalid': ctx.invalido || undefined,
  }
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    const campo = useCampo(rest.id)
    return <input ref={ref} className={cn(baseControl, 'h-controle py-0', className)} {...campo} {...rest} />
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref) {
  const campo = useCampo(rest.id)
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(baseControl, 'resize-y', className)}
      {...campo}
      {...rest}
    />
  )
})

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  const campo = useCampo(rest.id)
  return (
    // `cj-select` (v3): a seta da casa, fina, no cinza de metadado, no lugar da
    // seta nativa do Windows — que no escuro vinha clara e grossa.
    <select ref={ref} className={cn(baseControl, 'cj-select h-controle py-0 pr-[36px]', className)} {...campo} {...rest}>
      {children}
    </select>
  )
})
