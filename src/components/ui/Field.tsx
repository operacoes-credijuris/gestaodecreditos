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

const baseControl =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 ' +
  'focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50'

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
    <div className={cn('space-y-1', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      {hint && !error && (
        <p id={idDica} className="text-xs text-slate-600">
          {hint}
        </p>
      )}
      {/* role="alert": erro que aparece depois do Salvar precisa ser anunciado,
          senão quem usa leitor de tela fica esperando sem saber que falhou. */}
      {error && (
        <p id={idErro} role="alert" className="text-xs text-red-600">
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
    return <input ref={ref} className={cn(baseControl, className)} {...campo} {...rest} />
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
    <select ref={ref} className={cn(baseControl, 'pr-8', className)} {...campo} {...rest}>
      {children}
    </select>
  )
})
