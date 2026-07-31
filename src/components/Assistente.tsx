import { useEffect, useRef, useState } from 'react'
import { Sparkles, X, Send, AlertCircle } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { invokeFunction } from '@/lib/functions'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/cn'

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
}

interface RespostaAssistente {
  resposta: string
}

// Sugestões de partida: o painel em branco não dá pista do que ele sabe
// responder, e "pergunte qualquer coisa" na prática vira nenhuma pergunta.
const SUGESTOES = [
  'Quantos créditos estão ativos?',
  'Quais processos estão conclusos para decisão?',
  'Quantas publicações ainda não foram tratadas?',
  'Quanto já foi cedido, por situação?',
]

/**
 * Renderiza a resposta do modelo, que vem em Markdown — negrito, listas e
 * tabelas de processos. Sem isto o usuário lê os asteriscos e os pipes crus.
 *
 * O estilo vai bloco a bloco em vez de via plugin de tipografia: o painel tem
 * 420px, e os tamanhos padrão de um artigo ficariam grandes demais aqui.
 */
function RespostaMarkdown({ texto }: { texto: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-900">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>
        ),
        // Tabela de processos é larga e o painel é estreito: rola dentro do
        // próprio quadro, em vez de esticar a bolha da mensagem.
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto scrollbar-thin last:mb-0">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-slate-300 px-2 py-1 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="whitespace-nowrap border-b border-slate-200 px-2 py-1">
            {children}
          </td>
        ),
        code: ({ children }) => (
          <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">
            {children}
          </code>
        ),
        h1: ({ children }) => (
          <p className="mb-1 font-semibold text-slate-900">{children}</p>
        ),
        h2: ({ children }) => (
          <p className="mb-1 font-semibold text-slate-900">{children}</p>
        ),
        h3: ({ children }) => (
          <p className="mb-1 font-semibold text-slate-900">{children}</p>
        ),
      }}
    >
      {texto}
    </Markdown>
  )
}

/**
 * Assistente flutuante de perguntas sobre os dados do sistema.
 *
 * Toda a inteligência fica na Edge Function `assistente` — aqui só há a
 * conversa. A chave da API nunca passa pelo navegador.
 */
export function Assistente() {
  const [aberto, setAberto] = useState(false)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fimDaLista = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  // Rola para a última mensagem a cada troca — sem isso a resposta nova nasce
  // fora da área visível justamente quando a pessoa está esperando por ela.
  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, carregando])

  useEffect(() => {
    if (aberto) campo.current?.focus()
  }, [aberto])

  // Esc fecha, como no Drawer e no Modal.
  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aberto])

  async function enviar(pergunta: string) {
    const limpa = pergunta.trim()
    if (!limpa || carregando) return

    // O histórico enviado é o de ANTES desta pergunta: a função recebe a
    // pergunta atual separada, no campo `pergunta`.
    const historico = mensagens
    setMensagens([...historico, { role: 'user', content: limpa }])
    setTexto('')
    setErro(null)
    setCarregando(true)
    try {
      const { resposta } = await invokeFunction<RespostaAssistente>(
        'assistente',
        { pergunta: limpa, historico },
      )
      setMensagens((atual) => [...atual, { role: 'assistant', content: resposta }])
    } catch (e) {
      // A pergunta continua na tela; o erro aparece embaixo. Recolher a
      // pergunta obrigaria a pessoa a digitar tudo de novo para tentar.
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir assistente de dados"
        title="Perguntar ao assistente"
        className={cn(
          'fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center',
          'rounded-full bg-gradient-to-b from-brand-600 to-brand-700 text-white shadow-lg',
          'transition-all duration-150 hover:from-brand-500 hover:to-brand-600 hover:shadow-xl',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          'active:scale-95',
        )}
      >
        <Sparkles className="h-6 w-6" />
      </button>
    )
  }

  return (
    <div
      role="dialog"
      aria-label="Assistente de dados"
      className={cn(
        'fixed z-40 flex flex-col overflow-hidden rounded-xl border border-slate-200',
        'bg-white shadow-2xl',
        // Celular: ocupa a tela. Desktop: painel no canto, como um chat.
        'inset-x-3 bottom-3 top-16 sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5',
        'sm:h-[min(620px,calc(100vh-4rem))] sm:w-[420px]',
      )}
    >
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-brand-700" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
          Assistente de dados
        </p>
        <IconButton
          label="Fechar assistente"
          icon={<X className="h-4 w-4" />}
          onClick={() => setAberto(false)}
        />
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto scrollbar-thin px-4 py-4">
        {mensagens.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Pergunte sobre os créditos, publicações e cessões cadastrados.
              Para perguntas de fase processual, a resposta vem da busca no
              texto dos andamentos — confira a lista que eu mostrar.
            </p>
            <div className="flex flex-col gap-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className={cn(
                    'rounded-lg border border-slate-200 px-3 py-2 text-left text-sm',
                    'text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensagens.map((m, i) => (
          <div
            key={i}
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              m.role === 'user'
                ? 'ml-auto max-w-[92%] bg-brand-600 text-white'
                : // A resposta pode trazer tabela de processos: ocupa a
                  // largura inteira, senão a tabela nasce comprimida.
                  'w-full bg-slate-100 text-slate-800',
            )}
          >
            {m.role === 'user' ? (
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
            ) : (
              <div className="break-words">
                <RespostaMarkdown texto={m.content} />
              </div>
            )}
          </div>
        ))}

        {carregando && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
            </span>
            Consultando os dados…
          </div>
        )}

        {erro && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{erro}</span>
          </div>
        )}

        <div ref={fimDaLista} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          enviar(texto)
        }}
        className="flex items-end gap-2 border-t border-slate-200 bg-slate-50 px-3 py-3"
      >
        <textarea
          ref={campo}
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia, Shift+Enter quebra linha — convenção de chat.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar(texto)
            }
          }}
          placeholder="Faça uma pergunta…"
          className={cn(
            'max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-slate-300',
            'px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400',
            'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
          )}
        />
        <button
          type="submit"
          disabled={!texto.trim() || carregando}
          aria-label="Enviar pergunta"
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            'bg-gradient-to-b from-brand-600 to-brand-700 text-white transition-all',
            'hover:from-brand-500 hover:to-brand-600 active:scale-95',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            'disabled:from-brand-300 disabled:to-brand-300 disabled:active:scale-100',
          )}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
