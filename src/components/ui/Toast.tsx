import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

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
  /**
   * Nem tudo que a tela precisa dizer é sucesso ou erro. O tipo 'info' já existia,
   * com ícone e borda próprios, mas sem atalho: quem quisesse usá-lo tinha de
   * chamar toast(msg, 'info') e, na prática, acabava marcando como erro um aviso
   * que não é falha — o que treina a equipe a ignorar vermelho.
   */
  info: (message: string, opts?: ToastOptions) => void
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

  // O VALOR É O MESMO OBJETO A VIDA TODA (useMemo sobre o `toast`, que é
  // estável). Recriado a cada render, como era, cada aviso que aparecia ou
  // sumia — duas renderizações deste provedor — redesenhava TODO componente que
  // usa `useToast`: a Análise de crédito inteira, as listas, as janelas. A
  // lista de avisos é desenhada aqui mesmo; quem só dispara avisos não precisa
  // saber dela.
  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (m, opts) => toast(m, 'success', opts),
      error: (m, opts) => toast(m, 'error', opts),
      info: (m, opts) => toast(m, 'info', opts),
    }),
    [toast],
  )

  // O AVISO DA AMOSTRA É ESCURO (fundo `texto`, letra `superficie`): sobre o
  // papel e os cartões brancos ele se destaca sem precisar de cor, e o TIPO vem
  // pelo ícone — verde, rosado ou azul-claro, os tons que leem no escuro. As
  // cores invertem juntas no modo escuro, porque são os mesmos dois tokens; o
  // ícone tem token próprio (`flutuante-*`), que no escuro vira o tom fundo que
  // lê sobre o aviso claro.
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 shrink-0 text-flutuante-ok" aria-hidden />,
    error: <AlertCircle className="h-5 w-5 shrink-0 text-flutuante-erro" aria-hidden />,
    info: <Info className="h-5 w-5 shrink-0 text-flutuante-info" aria-hidden />,
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        // 420px como na amostra, e nunca mais largo que a tela menos as margens
        // (no celular, `w-full` com `right-4` empurrava o aviso para fora).
        className="fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-24px)] max-w-[420px] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            // O ERRO É `alert`: o leitor de tela o anuncia na hora, interrompendo
            // o que estiver lendo — falha de gravação não pode esperar a vez. Os
            // outros seguem `status`, educados.
            role={t.type === 'error' ? 'alert' : 'status'}
            // Pausa o auto-dismiss no hover; ao sair, reinicia com ~2s.
            onMouseEnter={() => pauseRemove(t.id)}
            onMouseLeave={() => scheduleRemove(t.id, 2000)}
            className="animate-toast-in flex items-start gap-3 rounded-2xl bg-texto px-4 py-3 text-superficie shadow-nivel-2"
          >
            {icons[t.type]}
            <p className="flex-1 text-corpo">{t.message}</p>
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onClick()
                  remove(t.id)
                }}
                className="-my-0.5 shrink-0 rounded-controle border border-superficie/35 px-2.5 py-1 text-sm font-bold text-superficie transition-colors hover:bg-superficie/15"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => remove(t.id)}
              className="-my-0.5 -mr-1 shrink-0 rounded-controle p-1 text-superficie/75 transition-colors hover:bg-superficie/15 hover:text-superficie"
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
