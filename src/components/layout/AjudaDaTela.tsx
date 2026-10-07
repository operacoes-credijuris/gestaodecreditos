import { useEffect, useId, useRef, useState } from 'react'
import { BookOpen, Command } from 'lucide-react'
import { haDialogoAberto } from '@/lib/dialogo'
import { useDentroDaJanela } from '@/lib/dentroDaJanela'
import { useConsultas } from './Consultas'

/**
 * O "?" ao lado do título da tela (item "Novo" da amostra): "Como funciona esta
 * tela" em três frases, e os atalhos para o glossário e para os atalhos de
 * teclado.
 *
 * Um balão, e não uma janela: não prende o foco nem escurece a tela. Fecha com
 * Escape (devolvendo o foco ao "?"), com clique fora e quando o foco sai dele.
 */
export function AjudaDaTela({ frases }: { frases: readonly string[] }) {
  const { abrirGlossario, abrirAtalhos } = useConsultas()
  const [aberto, setAberto] = useState(false)
  const caixaRef = useRef<HTMLDivElement>(null)
  const botaoRef = useRef<HTMLButtonElement>(null)
  const balaoRef = useRef<HTMLDivElement>(null)
  // NO CELULAR O BALÃO NÃO SAI PELA DIREITA (lib/dentroDaJanela.ts).
  const dx = useDentroDaJanela(balaoRef, aberto)
  const id = useId()

  useEffect(() => {
    if (!aberto) return
    balaoRef.current?.focus()
    function fora(e: MouseEvent) {
      if (!caixaRef.current?.contains(e.target as Node)) setAberto(false)
    }
    function tecla(e: KeyboardEvent) {
      // COM UMA JANELA ABERTA, o Escape é dela.
      if (e.key === 'Escape' && !haDialogoAberto()) {
        // E PARA AQUI, como o menu do usuário: o assistente ouve o Escape na
        // janela (window), depois do documento, e sem isto o mesmo Escape que
        // fechava o balão fechava também o assistente aberto ao lado.
        e.stopPropagation()
        setAberto(false)
        botaoRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  const abrir = (fn: () => void) => () => {
    setAberto(false)
    fn()
  }

  return (
    <div
      ref={caixaRef}
      className="relative inline-flex"
      onBlur={(e) => {
        if (aberto && !caixaRef.current?.contains(e.relatedTarget as Node | null)) setAberto(false)
      }}
    >
      {/* O `.ajuda` da amostra: um círculo de 24px com o "?". O ALVO DO TOQUE
          É MAIOR que o desenho (36px, a camada invisível `after:`): no celular,
          24px é pouco para o dedo, e o círculo maior pesaria ao lado do título. */}
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={id}
        aria-label="Como funciona esta tela"
        title="Como funciona esta tela"
        className="font-display relative grid h-8 w-8 place-items-center rounded-full border-[1.5px] border-borda-forte bg-superficie text-sm font-extrabold text-texto-2 transition-colors after:absolute after:-inset-[6px] after:content-[''] hover:border-marca-viva hover:text-marca-texto"
      >
        ?
      </button>
      {aberto && (
        <div
          ref={balaoRef}
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
          id={id}
          role="dialog"
          aria-modal="false"
          aria-label="Como funciona esta tela"
          tabIndex={-1}
          className="absolute left-0 top-full z-40 mt-s1.5 w-[340px] max-w-[calc(100vw-24px)] rounded-flutuante border border-borda bg-superficie px-s3 pb-s1.5 pt-s3 text-corpo shadow-nivel-2 outline-none dark:ring-1 dark:ring-white/[0.06]"
        >
          <p className="font-display font-bold text-texto">Como funciona esta tela</p>
          <ol className="mb-s3 mt-s2 grid list-decimal gap-s1.5 pl-s5 text-texto-2">
            {frases.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-s1">
            <button
              type="button"
              onClick={abrir(abrirGlossario)}
              className="inline-flex h-controle-sm items-center gap-s1.5 rounded-controle px-s2 text-sm font-semibold text-marca-texto hover:bg-marca-leve"
            >
              <BookOpen className="h-[16px] w-[16px]" aria-hidden />
              Glossário
            </button>
            <button
              type="button"
              onClick={abrir(abrirAtalhos)}
              className="inline-flex h-controle-sm items-center gap-s1.5 rounded-controle px-s2 text-sm font-semibold text-marca-texto hover:bg-marca-leve"
            >
              <Command className="h-[16px] w-[16px]" aria-hidden />
              Atalhos
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
