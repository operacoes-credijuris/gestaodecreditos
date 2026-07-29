import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type ToastType = 'success' | 'error' | 'info'
interface ToastAction {
  label: string
  onClick: () => void
}
interface ToastItem {
  id: number
  type: ToastType
  message: string
  action?: ToastAction
}
interface ToastOptions {
  /** Botão de ação inline (ex.: "Desfazer"). Estende a duração do toast. */
  action?: ToastAction
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, opts?: ToastOptions) => void
  success: (message: string, opts?: ToastOptions) => void
  error: (message: string, opts?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  // Timeout de auto-dismiss de cada toast, indexado pelo id.
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const remove = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer) clearTimeout(timer)
    timersRef.current.delete(id)
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // (Re)agenda o auto-dismiss de um toast, cancelando o timeout anterior.
  const scheduleRemove = useCallback(
    (id: number, ms: number) => {
      const timer = timersRef.current.get(id)
      if (timer) clearTimeout(timer)
      timersRef.current.set(
        id,
        setTimeout(() => remove(id), ms),
      )
    },
    [remove],
  )

  // Pausa o auto-dismiss enquanto o mouse está sobre o toast.
  const pauseRemove = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer) clearTimeout(timer)
    timersRef.current.delete(id)
  }, [])

  const toast = useCallback(
    (message: string, type: ToastType = 'info', opts?: ToastOptions) => {
      const id = ++counter
      setItems((prev) => [...prev, { id, type, message, action: opts?.action }])
      // Com ação, o usuário precisa de tempo para clicar em "Desfazer".
      scheduleRemove(id, opts?.action ? 7000 : 4500)
    },
    [scheduleRemove],
  )

  const value: ToastContextValue = {
    toast,
    success: (m, opts) => toast(m, 'success', opts),
    error: (m, opts) => toast(m, 'error', opts),
  }

  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
    error: <AlertCircle className="h-5 w-5 text-red-600" />,
    info: <Info className="h-5 w-5 text-blue-600" />,
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            // Pausa o auto-dismiss no hover; ao sair, reinicia com ~2s.
            onMouseEnter={() => pauseRemove(t.id)}
            onMouseLeave={() => scheduleRemove(t.id, 2000)}
            className={cn(
              'animate-toast-in flex items-start gap-3 rounded-lg border bg-white p-3 shadow-lg',
              t.type === 'success' && 'border-emerald-200',
              t.type === 'error' && 'border-red-200',
              t.type === 'info' && 'border-blue-200',
            )}
          >
            {icons[t.type]}
            <p className="flex-1 text-sm text-slate-700">{t.message}</p>
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onClick()
                  remove(t.id)
                }}
                className="shrink-0 text-sm font-semibold text-brand-600 hover:text-brand-700 hover:underline"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => remove(t.id)}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Fechar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>')
  return ctx
}
