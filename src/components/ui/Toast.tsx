import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2, AlertCircle, Info, X, Copy, Check } from 'lucide-react'
import { duracaoDepoisDoMouse, duracaoDoAviso, detalhesDoErro, juntarAviso } from '@/lib/avisos'
import { copiarTexto } from '@/lib/copiar'
import { entradaCarregada } from '@/lib/versaoNova'
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
  /** Quando apareceu (ms): vai nos detalhes do erro copiados. */
  em: number
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
  // A PILHA DE AGORA, para o `toast` decidir sem esperar a renderização: dois
  // avisos iguais disparados no mesmo clique virariam duas caixas.
  const itemsRef = useRef<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer) clearTimeout(timer)
    timersRef.current.delete(id)
    itemsRef.current = itemsRef.current.filter((t) => t.id !== id)
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
      const novo: ToastItem = { id: ++counter, type, message, action: opts?.action, em: Date.now() }
      // AS REGRAS DA PILHA moram em lib/avisos.ts: o mesmo aviso não se empilha
      // (renova o tempo do que já está na tela), e passando de quatro sai o
      // mais antigo.
      const { pilha, repetido } = juntarAviso(itemsRef.current, novo)
      const alvo = repetido ?? novo
      const ficam = new Set(pilha.map((t) => t.id))
      for (const [id, timer] of timersRef.current) {
        if (ficam.has(id)) continue
        clearTimeout(timer)
        timersRef.current.delete(id)
      }
      itemsRef.current = pilha
      setItems(pilha)
      // O ERRO FICA ATÉ SER FECHADO (`null`); os outros somem sozinhos — com
      // ação ("Desfazer"), depois de mais tempo.
      const ms = duracaoDoAviso(alvo.type, !!alvo.action)
      if (ms !== null) scheduleRemove(alvo.id, ms)
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
    success: <CheckCircle2 className="mt-[2px] h-[16px] w-[16px] shrink-0 text-flutuante-ok" aria-hidden />,
    error: <AlertCircle className="mt-[2px] h-[16px] w-[16px] shrink-0 text-flutuante-erro" aria-hidden />,
    info: <Info className="mt-[2px] h-[16px] w-[16px] shrink-0 text-flutuante-info" aria-hidden />,
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        // 420px como na amostra, e nunca mais largo que a tela menos as margens
        // (no celular, `w-full` com `right-4` empurrava o aviso para fora).
        // ACIMA DO BOTÃO DO ASSISTENTE enquanto ele está à vista (o atributo
        // `data-assistente` no <html>, posto por ele): antes o aviso caía em
        // cima do botão (auditoria visual, M2). Na camada mais alta (z-aviso).
        className={cn(
          'fixed bottom-s4 right-s3 z-aviso flex w-[calc(100vw-24px)] max-w-[420px] flex-col gap-s2 sm:right-[20px]',
          '[html[data-assistente=botao]_&]:bottom-[76px] sm:[html[data-assistente=botao]_&]:bottom-[88px]',
          // Com o PAINEL do assistente aberto, fora da caixa de pergunta: no
          // celular e no tablet, no alto (o painel ocupa o pé da tela); no
          // computador, à esquerda do painel (420px + 20px de margem + 20px).
          'max-lg:[html[data-assistente=painel]_&]:bottom-auto max-lg:[html[data-assistente=painel]_&]:top-s4 lg:[html[data-assistente=painel]_&]:right-[460px]',
          // COM UMA JANELA OU GAVETA ABERTA (`data-janela`, posto por
          // lib/dialogo.ts), fora do rodapé dela, onde moram Cancelar e o botão
          // principal: no celular, logo acima do rodapé; no computador, no alto
          // e no meio. O `!` vence as regras do assistente logo acima.
          'max-sm:[html[data-janela]_&]:!bottom-[84px]',
          'sm:[html[data-janela]_&]:!bottom-auto sm:[html[data-janela]_&]:!top-s4 sm:[html[data-janela]_&]:!right-auto sm:[html[data-janela]_&]:!left-1/2 sm:[html[data-janela]_&]:-translate-x-1/2',
        )}
      >
        {items.map((t) => (
          <div
            key={t.id}
            // O ERRO É `alert`: o leitor de tela o anuncia na hora, interrompendo
            // o que estiver lendo — falha de gravação não pode esperar a vez. Os
            // outros seguem `status`, educados.
            role={t.type === 'error' ? 'alert' : 'status'}
            // Pausa o auto-dismiss no hover; ao sair, reinicia com ~2s (o erro
            // não tem tempo: fica até ser fechado).
            onMouseEnter={() => pauseRemove(t.id)}
            onMouseLeave={() => {
              const ms = duracaoDepoisDoMouse(t.type)
              if (ms !== null) scheduleRemove(t.id, ms)
            }}
            className="animate-toast-in flex items-start gap-s3 rounded-flutuante bg-texto px-s4 py-s3 text-superficie shadow-nivel-2"
          >
            {icons[t.type]}
            <p className="flex-1 text-corpo">{t.message}</p>
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onClick()
                  remove(t.id)
                }}
                className="-my-s1 inline-flex h-controle-sm shrink-0 items-center rounded-controle [@media(pointer:coarse)]:h-[40px] border border-superficie/35 px-s3 text-sm font-bold text-superficie transition-colors hover:bg-superficie/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-flutuante-info"
              >
                {t.action.label}
              </button>
            )}
            {t.type === 'error' && <CopiarDetalhes mensagem={t.message} em={t.em} />}
            <button
              onClick={() => remove(t.id)}
              className="-my-s1 -mr-s1 grid h-controle-sm w-controle-sm shrink-0 place-items-center rounded-controle text-superficie/75 [@media(pointer:coarse)]:h-[40px] [@media(pointer:coarse)]:w-[40px] transition-colors hover:bg-superficie/15 hover:text-superficie focus:outline-none focus-visible:ring-2 focus-visible:ring-flutuante-info"
              aria-label="Fechar aviso"
            >
              <X className="h-[16px] w-[16px]" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * O "Copiar detalhes" do aviso de erro: a mensagem com a tela, a hora e a versão
 * (lib/avisos.ts), pronta para colar na conversa com quem vai consertar. O ✓
 * no lugar do ícone diz que copiou.
 */
function CopiarDetalhes({ mensagem, em }: { mensagem: string; em: number }) {
  const { pathname, search } = useLocation()
  const [copiado, setCopiado] = useState(false)
  const nome = copiado ? 'Detalhes copiados' : 'Copiar detalhes do erro'
  const Icone = copiado ? Check : Copy
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copiarTexto(
          detalhesDoErro({
            mensagem,
            quando: new Date(em),
            tela: `${pathname}${search}`,
            versao: entradaCarregada(),
            navegador: typeof navigator === 'undefined' ? '' : navigator.userAgent,
          }),
        )
        if (ok) setCopiado(true)
      }}
      aria-label={nome}
      title={nome}
      className="-my-s1 grid h-controle-sm w-controle-sm shrink-0 place-items-center rounded-controle text-superficie/75 [@media(pointer:coarse)]:h-[40px] [@media(pointer:coarse)]:w-[40px] transition-colors hover:bg-superficie/15 hover:text-superficie focus:outline-none focus-visible:ring-2 focus-visible:ring-flutuante-info"
    >
      <Icone className="h-[16px] w-[16px]" aria-hidden />
    </button>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>')
  return ctx
}
