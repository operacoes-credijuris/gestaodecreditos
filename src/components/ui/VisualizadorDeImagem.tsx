import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, ExternalLink, ImageOff, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import { useJanelaAberta } from '@/lib/janelasAbertas'

/**
 * Uma imagem do visualizador. `src` quando o endereço já se sabe (o `blob:` de
 * um print colado); `obter` quando ele precisa ser pedido (o link assinado do
 * Kommo) — pedido SÓ quando a imagem aparece, e `forcar` pede um link novo
 * depois de o antigo não abrir.
 */
export interface ImagemDoVisualizador {
  chave: string
  nome: string
  src?: string | null
  obter?: (forcar?: boolean) => Promise<string>
}

type Situacao = { fase: 'carregando' } | { fase: 'pronta'; src: string } | { fase: 'falhou'; erro: string }

/**
 * Baixa a imagem com o nome dela.
 *
 * PELO BLOB, e não por `<a download>` direto: o atributo é ignorado em endereço
 * de outro domínio (o drive do Kommo), e o navegador abriria a imagem numa aba
 * em vez de salvá-la. O drive responde com CORS — é o mesmo `fetch` que a
 * análise já faz nos anexos do card. Se ainda assim falhar, abre numa aba.
 */
async function baixar(src: string, nome: string) {
  const salvar = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  if (src.startsWith('blob:') || src.startsWith('data:')) return salvar(src)
  try {
    const r = await fetch(src)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const url = URL.createObjectURL(await r.blob())
    salvar(url)
    // Revogar na mesma linha cancelaria o download em alguns navegadores.
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  } catch {
    window.open(src, '_blank', 'noopener')
  }
}

/**
 * O VISUALIZADOR DE IMAGEM (06/10/2026, pedido do dono, "meio parecido com o
 * Kommo"): a imagem grande, ajustada à tela, numa janela da plataforma.
 *
 * - ← → (botões, teclas ou o arrastar do dedo) passam pelas imagens da anotação;
 * - o nome do arquivo é o título da janela; "Abrir em nova aba" e "Baixar";
 * - Esc, X ou clique fora fecham.
 *
 * AS REGRAS DE JANELA SÃO AS DO `Modal` (lib/dialogo): foco preso e devolvido a
 * quem abriu (a miniatura), fundo travado, só a janela de cima ouve o Esc e as
 * setas — o visualizador aberto da caixa do Anotar não mexe na lista atrás. Vai
 * para o <body> por portal, na camada de janela (`z-janela`).
 */
export function VisualizadorDeImagem({
  aberto,
  imagens,
  inicial = 0,
  onFechar,
}: {
  aberto: boolean
  imagens: readonly ImagemDoVisualizador[]
  inicial?: number
  onFechar: () => void
}) {
  const tituloId = useId()
  const painel = useRef<HTMLDivElement>(null)
  const fechar = useRef<HTMLButtonElement>(null)
  const [indice, setIndice] = useState(inicial)
  const [situacoes, setSituacoes] = useState<Record<string, Situacao>>({})
  const [carregada, setCarregada] = useState<string | null>(null)
  const ehTopo = useFocoPreso(aberto, painel)
  useTravaScroll(aberto)
  useJanelaAberta(aberto, false, onFechar)

  // Abrindo de novo (outra miniatura), começa da que foi clicada. FECHANDO,
  // esquece os endereços: o link do Kommo vence, e quem reabre amanhã pede de
  // novo (ao cache de quem deu o `obter`, que sabe se o de ontem ainda vale).
  useEffect(() => {
    if (aberto) setIndice(Math.min(Math.max(0, inicial), Math.max(0, imagens.length - 1)))
    else {
      setSituacoes({})
      setCarregada(null)
    }
  }, [aberto, inicial, imagens.length])

  // O FOCO NO X, e não no "Abrir em nova aba" (o primeiro da ordem): Enter
  // logo depois de abrir não pode abrir uma aba. Corre depois do foco do
  // `useFocoPreso`, e o vence.
  useEffect(() => {
    if (aberto) fechar.current?.focus()
  }, [aberto])

  const total = imagens.length
  const atual = imagens[indice] as ImagemDoVisualizador | undefined
  const situacao: Situacao | undefined = atual
    ? atual.src
      ? { fase: 'pronta', src: atual.src }
      : situacoes[atual.chave]
    : undefined

  const pedir = useCallback(async (img: ImagemDoVisualizador, forcar = false) => {
    if (!img.obter) return
    setSituacoes((s) => ({ ...s, [img.chave]: { fase: 'carregando' } }))
    try {
      const src = await img.obter(forcar)
      setSituacoes((s) => ({ ...s, [img.chave]: { fase: 'pronta', src } }))
    } catch (e) {
      setSituacoes((s) => ({ ...s, [img.chave]: { fase: 'falhou', erro: (e as Error)?.message ?? String(e) } }))
    }
  }, [])

  // O LINK SE PEDE QUANDO A IMAGEM APARECE, e uma vez: passar por ela de novo
  // usa o que já veio (e o cache de quem deu o `obter` decide se ainda vale).
  useEffect(() => {
    if (!aberto || !atual || atual.src || situacoes[atual.chave]) return
    void pedir(atual)
  }, [aberto, atual, situacoes, pedir])

  const ir = useCallback(
    (passo: number) => {
      if (total < 2) return
      setIndice((i) => (i + passo + total) % total)
    },
    [total],
  )

  useEffect(() => {
    if (!aberto) return
    function onKey(e: KeyboardEvent) {
      if (!ehTopo()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onFechar()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        ir(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        ir(1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aberto, ehTopo, ir, onFechar])

  // O ARRASTAR DO DEDO, no celular: 48px para um lado troca de imagem.
  const inicioDoToque = useRef<number | null>(null)
  const tocou = (e: PointerEvent) => {
    inicioDoToque.current = e.pointerType === 'mouse' ? null : e.clientX
  }
  const soltou = (e: PointerEvent) => {
    const x0 = inicioDoToque.current
    inicioDoToque.current = null
    if (x0 === null) return
    const dx = e.clientX - x0
    if (Math.abs(dx) >= 48) ir(dx < 0 ? 1 : -1)
  }

  if (!aberto || !atual) return null
  const src = situacao?.fase === 'pronta' ? situacao.src : null
  const mostrada = src !== null && carregada === src

  const seta = (lado: 'anterior' | 'proxima') => (
    <button
      type="button"
      onClick={() => ir(lado === 'anterior' ? -1 : 1)}
      aria-label={lado === 'anterior' ? 'Imagem anterior' : 'Próxima imagem'}
      title={lado === 'anterior' ? 'Imagem anterior (←)' : 'Próxima imagem (→)'}
      className={cn(
        'absolute top-1/2 grid h-controle-lg w-controle-lg -translate-y-1/2 place-items-center rounded-full border border-borda bg-superficie text-texto shadow-nivel-2 transition-colors hover:bg-superficie-3 dark:ring-1 dark:ring-white/[0.06]',
        lado === 'anterior' ? 'left-s2 sm:left-s3' : 'right-s2 sm:right-s3',
      )}
    >
      {lado === 'anterior' ? (
        <ChevronLeft className="h-[20px] w-[20px]" aria-hidden />
      ) : (
        <ChevronRight className="h-[20px] w-[20px]" aria-hidden />
      )}
    </button>
  )

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-janela flex items-center justify-center bg-veu/80 p-s2 backdrop-blur-[2px] sm:p-s6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar()
      }}
    >
      <div
        ref={painel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="animate-modal-in flex max-h-full w-full max-w-[1200px] flex-col overflow-hidden rounded-janela bg-superficie shadow-nivel-3 outline-none dark:ring-1 dark:ring-white/[0.06]"
      >
        <div className="flex items-center gap-s2 border-b border-borda py-s2 pl-s4 pr-s2">
          <h2 id={tituloId} className="min-w-0 flex-1 truncate font-display text-lg font-bold text-texto" title={atual.nome}>
            {atual.nome}
          </h2>
          {total > 1 && (
            <span className="flex-none whitespace-nowrap text-xs tabular-nums text-texto-3" aria-live="polite">
              {indice + 1} de {total}
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="flex-none"
            disabled={!src}
            onClick={() => src && window.open(src, '_blank', 'noopener')}
            icon={<ExternalLink className="h-[16px] w-[16px]" aria-hidden />}
            aria-label="Abrir em nova aba"
            title="Abrir em nova aba"
          >
            <span className="hidden sm:inline">Abrir em nova aba</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="flex-none"
            disabled={!src}
            onClick={() => src && void baixar(src, atual.nome)}
            icon={<Download className="h-[16px] w-[16px]" aria-hidden />}
            aria-label={`Baixar ${atual.nome}`}
            title="Baixar"
          >
            <span className="hidden sm:inline">Baixar</span>
          </Button>
          <button
            ref={fechar}
            type="button"
            onClick={onFechar}
            className="grid h-[32px] w-[32px] flex-none place-items-center rounded-controle text-texto-2 transition-colors hover:bg-superficie-3 hover:text-texto"
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>

        <div
          className="relative flex min-h-[240px] flex-1 touch-pan-y items-center justify-center bg-superficie-2 p-s2 sm:p-s4"
          onPointerDown={tocou}
          onPointerUp={soltou}
          onPointerCancel={() => (inicioDoToque.current = null)}
        >
          {situacao?.fase === 'falhou' ? (
            <div className="flex max-w-[360px] flex-col items-center gap-s2 p-s4 text-center" role="alert">
              <ImageOff className="h-[32px] w-[32px] text-texto-3" aria-hidden />
              <p className="text-corpo text-texto-2">Não consegui carregar a imagem: {situacao.erro}</p>
              {atual.obter && <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="h-[16px] w-[16px]" aria-hidden />}
                onClick={() => void pedir(atual, true)}
              >
                Tentar de novo
              </Button>}
            </div>
          ) : (
            <>
              {!mostrada && (
                <div
                  className="skeleton absolute inset-s4 rounded-campo"
                  role="status"
                  aria-label={`Carregando ${atual.nome}`}
                />
              )}
              {src && (
                <img
                  key={src}
                  src={src}
                  alt={atual.nome}
                  draggable={false}
                  onLoad={() => setCarregada(src)}
                  onError={() =>
                    setSituacoes((s) => ({
                      ...s,
                      [atual.chave]: {
                        fase: 'falhou',
                        erro: atual.obter ? 'o endereço não abriu (pode ter vencido).' : 'o arquivo não é uma imagem que o navegador abra.',
                      },
                    }))
                  }
                  className={cn(
                    'relative block max-h-[calc(100dvh-128px)] max-w-full select-none rounded-controle object-contain transition-opacity duration-150',
                    mostrada ? 'opacity-100' : 'opacity-0',
                  )}
                />
              )}
            </>
          )}
          {total > 1 && (
            <>
              {seta('anterior')}
              {seta('proxima')}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
