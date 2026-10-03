import { Fragment, useId, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { termosNoTexto, type TermoDoGlossario } from '@/lib/termosNoTexto'

/**
 * Um texto com os termos do glossário sublinhados em pontilhado (o
 * `abbr.termo` da amostra). Passar o mouse ou chegar pelo Tab num termo mostra
 * a definição numa dica; Escape a esconde.
 *
 *   <TextoComTermos texto="Sanado, o card volta para a Revisão." />
 *
 * Quais termos e onde: lib/termosNoTexto.ts (palavra inteira, a primeira
 * ocorrência de cada um). Só TEXTO PURO: o que vier é mostrado como está, nunca
 * interpretado como marcação.
 */
export function TextoComTermos({
  texto,
  glossario,
}: {
  texto: string
  /** Outro glossário (para teste ou recorte); sem ele, o da plataforma. */
  glossario?: readonly TermoDoGlossario[]
}) {
  const partes = useMemo(() => termosNoTexto(texto, glossario), [texto, glossario])
  return (
    <>
      {partes.map((p, i) =>
        p.termo ? (
          <TermoComDica key={i} rotulo={p.texto} definicao={p.termo.definicao} />
        ) : (
          <Fragment key={i}>{p.texto}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * Um termo com a sua dica.
 *
 * A DICA É PRÓPRIA, e não o `title` do navegador: o `title` não aparece com o
 * teclado (só com o mouse, e depois de um atraso), e o leitor de tela nem
 * sempre o lê. Aqui a definição está ligada ao termo por `aria-describedby` —
 * lida ao focar — e aparece tanto no mouse quanto no foco.
 *
 * Escape esconde a dica sem fechar a janela em volta (WCAG 1.4.13), e o mouse
 * pode passar do termo para a dica sem que ela suma.
 */
function TermoComDica({ rotulo, definicao }: { rotulo: string; definicao: string }) {
  const id = useId()
  const [aberta, setAberta] = useState(false)
  return (
    <span
      className="relative"
      onMouseEnter={() => setAberta(true)}
      onMouseLeave={() => setAberta(false)}
    >
      <abbr
        tabIndex={0}
        aria-describedby={id}
        onFocus={() => setAberta(true)}
        onBlur={() => setAberta(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && aberta) {
            e.stopPropagation()
            setAberta(false)
          }
        }}
        className="cursor-help rounded-[2px] underline decoration-texto-3 decoration-dotted underline-offset-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-anel"
      >
        {rotulo}
      </abbr>
      {/* O `pt-1` é transparente e faz parte da dica: o mouse atravessa o vão
          entre o termo e a caixa sem sair da área, e a dica não some no meio. */}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'absolute left-0 top-full z-40 w-max max-w-[280px] pt-1',
          !aberta && 'hidden',
        )}
      >
        <span className="block rounded-controle bg-texto px-2.5 py-1.5 text-left text-xs font-normal normal-case tracking-normal text-superficie shadow-nivel-2">
          {definicao}
        </span>
      </span>
    </span>
  )
}
