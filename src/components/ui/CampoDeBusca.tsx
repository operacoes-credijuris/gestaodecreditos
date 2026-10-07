import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Input } from './Field'
import { Tecla } from './Tecla'

/**
 * A BUSCA DAS LISTAS (auditoria visual de 03/10/2026, C3): a lupa de 16px, a
 * altura de controle (36px) e, à direita, a tecla "/" desenhada — o mesmo `kbd`
 * do "Ctrl K" do topo. Antes cada tela escrevia "( / )" no texto de exemplo.
 *
 * - `atalho` (padrão: sim) marca o campo como O FILTRO DA TELA: é para ele que
 *   o "/" do teclado leva (layout/Consultas.tsx). Uma tela, um campo marcado.
 * - Escape no campo LIMPA a busca (a lista de atalhos promete isso).
 * - O texto de exemplo tem até 40 caracteres ("Buscar por número, cedente ou
 *   devedora"); a lista inteira dos campos em que se busca vai em `title`.
 *
 * Uso: `<CampoDeBusca valor={q} onMudar={setQ} placeholder="Buscar por número
 * ou cedente" title="Busca em: número, cedente, …" />`.
 */
export const CampoDeBusca = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
    valor: string
    onMudar: (v: string) => void
    /** Marca o campo como o filtro da tela (o "/" do teclado). Padrão: sim. */
    atalho?: boolean
    /** Classes da caixa em volta (largura, `flex-1`…). */
    classeDaCaixa?: string
    /** Algo à direita, antes da tecla (ex.: a contagem de resultados). */
    fim?: ReactNode
  }
>(function CampoDeBusca(
  { valor, onMudar, atalho = true, classeDaCaixa, fim, placeholder = 'Buscar', className, onKeyDown, ...rest },
  ref,
) {
  return (
    <div className={cn('relative min-w-0', classeDaCaixa)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-s3 top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-texto-3"
      />
      <Input
        ref={ref}
        type="search"
        aria-label={rest['aria-label'] ?? placeholder.replace(/…$/, '')}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && valor) {
            // PARA AQUI: o Escape limpa a busca, e não fecha a janela em volta.
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
            onMudar('')
          }
          onKeyDown?.(e)
        }}
        {...(atalho ? { 'data-filtro-tela': '', 'aria-keyshortcuts': '/' } : {})}
        className={cn('pl-[36px]', fim ? 'pr-[44px]' : atalho && 'pr-[44px] [@media(pointer:coarse)]:pr-s4', className)}
        {...rest}
      />
      {(atalho || fim) && (
        <span className="pointer-events-none absolute right-s3 top-1/2 flex -translate-y-1/2 items-center gap-s2 text-xs text-texto-3">
          {fim}
          {/* A tecla "/" só vale com teclado: no toque (celular), sai. */}
          {atalho && !valor && (
            <span className="[@media(pointer:coarse)]:hidden">
              <Tecla>/</Tecla>
            </span>
          )}
        </span>
      )}
    </div>
  )
})

/**
 * A BARRA DA LISTA (auditoria visual, C3), na mesma ordem em toda tela:
 * `[busca] [segmentado] [ordenar] … [contagem · atualizado]`. A busca cresce
 * até 520px; o que vai em `fim` encosta à direita. Numa TABELA, a barra fica no
 * cabeçalho do cartão (como em Créditos); numa lista de cartões, solta logo
 * acima dela.
 */
export function BarraDaLista({
  children,
  fim,
  className,
}: {
  /** A busca primeiro, depois os filtros e o ordenar. */
  children: ReactNode
  /** Contagem e "atualizado há…", à direita. */
  fim?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-s2 [&>*:first-child]:max-w-[520px] [&>*:first-child]:flex-1', className)}>
      {children}
      {fim && <div className="ml-auto flex items-center gap-s2 text-xs text-texto-3">{fim}</div>}
    </div>
  )
}
