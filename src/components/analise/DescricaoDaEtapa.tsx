// A FRASE DA ETAPA, sob o nome dela: numa linha, com "mais" quando não cabe.
//
// NUMA LINHA SÓ (auditoria visual, A1a): em duas ela empurrava os cards para
// baixo da dobra. Mas o resto ficava só no `title` — que o celular não tem e o
// teclado não abre —, e é justamente a frase que diz a quem chega novo o que se
// faz naquela coluna ("O botão do card abre a Geração de contratos já com o
// processo e o…"). O "mais" abre a frase inteira ali mesmo, e só aparece quando
// ela foi cortada (revisão de UX de 20/10/2026, uso em equipe).
//
// SÓ APRESENTAÇÃO: o texto é o da trilha.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function DescricaoDaEtapa({ texto, children }: { texto: string; children: ReactNode }) {
  const frase = useRef<HTMLParagraphElement>(null)
  const [aberta, setAberta] = useState(false)
  const [cortada, setCortada] = useState(false)

  // OUTRA ETAPA, FRASE FECHADA de novo: a aberta era a da coluna anterior.
  useEffect(() => setAberta(false), [texto])

  // MEDE SE A LINHA CORTOU, e mede de novo quando a largura muda (o menu
  // recolhido, a janela girada). Aberta, não mede: o corte é o da linha fechada.
  useLayoutEffect(() => {
    const el = frase.current
    if (!el || aberta) return
    const medir = () => setCortada(el.scrollHeight > el.clientHeight + 1)
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [texto, aberta])

  return (
    <div className="mt-s1 flex max-w-[720px] items-baseline gap-s2">
      <p
        ref={frase}
        className={cn('min-w-0 text-corpo text-texto-2', !aberta && 'line-clamp-1')}
        title={aberta ? undefined : texto}
      >
        {children}
      </p>
      {(cortada || aberta) && (
        <button
          type="button"
          aria-expanded={aberta}
          onClick={() => setAberta((v) => !v)}
          className="inline-flex h-[21px] flex-none items-center rounded-controle px-s1 text-sm font-semibold text-marca-texto hover:bg-marca-leve [@media(pointer:coarse)]:h-controle-sm"
        >
          {aberta ? 'menos' : 'mais'}
          <span className="sr-only"> sobre esta etapa</span>
        </button>
      )}
    </div>
  )
}
