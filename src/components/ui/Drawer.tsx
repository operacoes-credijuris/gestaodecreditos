import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Painel lateral (slide-over) para exibir detalhes de um registro sem sair da
 * listagem. Desliza da direita com overlay desfocado; fecha por X, overlay ou
 * Escape. Use para "ficha" de leitura — edição continua nos modais.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  // Mantém o nó montado durante a animação de saída (mesmo padrão do drawer
  // mobile da sidebar).
  const [rendered, setRendered] = useState(open)
  const [visible, setVisible] = useState(open)

  useEffect(() => {
    if (open) {
      setRendered(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setVisible(false)
    const timer = setTimeout(() => setRendered(false), 200)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!rendered) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div
        className={cn(
          'absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          // max-w-2xl: a ficha usa grid de 2 colunas (DrawerSection) e em
          // max-w-md os valores longos quebravam demais.
          'absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-200',
          visible ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            onClick={onClose}
            aria-label="Fechar painel"
            className="rounded-lg p-1 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Par rótulo/valor para fichas dentro do Drawer. */
export function DrawerField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      {/* slate-600 e não slate-400: rótulo de 12px em caixa alta com slate-400
          dá 2,34:1 de contraste sobre branco, menos da metade do mínimo de 4,5.
          Era o texto menos legível da plataforma, e justamente o que diz ao
          usuário qual campo ele está lendo. Em slate-600 vai a 7,48 e continua
          secundário diante do valor, que é slate-800. */}
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children ?? '—'}</dd>
    </div>
  )
}

/** Seção titulada da ficha (agrupa DrawerFields). */
export function DrawerSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-slate-100 py-4 first:pt-0 last:border-b-0">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-brand-600">
        {title}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
    </section>
  )
}
