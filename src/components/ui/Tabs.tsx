import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { rolarParaAVista } from '@/lib/rolarParaAVista'

export interface TabItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  /**
   * Contagem ao lado do rótulo. Existe para o filtro não ser silencioso: quem vê
   * "RPV 38" sabe quantos registros a outra visão esconde.
   */
  count?: number
  /**
   * Visível mas não selecionável — para a visão que existe no domínio mas ainda
   * não está pronta. Deixar à vista é melhor que omitir: o usuário sabe que vem.
   * A navegação por setas pula estas.
   */
  disabled?: boolean
}

/** O `id` de cada aba quando há `idDoPainel` — o que o painel cita no `aria-labelledby`. */
export function idDaAba(idDoPainel: string, indice: number): string {
  return `${idDoPainel}-aba-${indice}`
}

export function Tabs({
  items,
  value,
  onChange,
  trailing,
  trailingNaBorda,
  rotulo,
  idDoPainel,
}: {
  items: TabItem[]
  value: string
  onChange: (key: string) => void
  /**
   * Conteúdo na mesma linha das abas, LOGO DEPOIS da última — um filtro que só
   * faz sentido junto delas, por exemplo.
   *
   * Colado nas abas, e não jogado na borda da página: o que está perto se lê
   * como pertencente ao que está perto. Na extremidade oposta pareceria um
   * controle da tela toda, e não daquelas abas.
   *
   * Fica FORA do `role="tablist"` de propósito: leitor de tela anuncia "aba 3 de
   * 5" contando os filhos da tablist, e um controle estranho ali entraria na
   * contagem como se fosse aba. A borda de baixo passou para o contêiner externo
   * para as duas partes dividirem a mesma linha.
   */
  trailing?: ReactNode
  /**
   * O `trailing` vai para a BORDA da linha, e não colado nas abas.
   *
   * A escolha é sobre A QUE o controle pertence. Um filtro daquelas abas fica
   * junto delas — é a regra acima. Um controle do PAINEL INTEIRO, como o botão
   * que refaz a busca cujos resultados as abas apenas recortam, pertence à
   * seção, e colado nas abas se leria como se filtrasse a aba aberta.
   */
  trailingNaBorda?: boolean
  /**
   * O nome do grupo de abas para o leitor de tela ("Seções do quadro"). Sem ele,
   * a lista de abas é anunciada sem dizer do que é.
   */
  rotulo?: string
  /**
   * O `id` do painel que mostra a aba aberta, quando as abas trocam o conteúdo de
   * UM painel só (a moldura do Quadro). A aba aberta passa a apontar para ele
   * (`aria-controls`), e cada aba ganha o `id` de `idDaAba`, para o painel dizer
   * de qual aba é (`aria-labelledby`).
   */
  idDoPainel?: string
}) {
  // Refs dos botões para mover o foco na navegação por setas.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const filaRef = useRef<HTMLDivElement>(null)
  // A ABA ABERTA SEMPRE À VISTA quando a régua rola de lado (celular).
  const indiceAberto = items.findIndex((it) => it.key === value)
  useEffect(() => {
    rolarParaAVista(filaRef.current, tabRefs.current[indiceAberto] ?? null)
  }, [indiceAberto])

  // Setas Esquerda/Direita movem o foco e selecionam a aba (com wrap).
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const delta = e.key === 'ArrowRight' ? 1 : -1
    // PULA AS DESABILITADAS. Sem isto a seta selecionaria uma aba que o clique
    // recusa: o teclado abriria uma visão que não existe. O laço tem teto no número
    // de abas para não girar para sempre quando todas estão desabilitadas.
    let next = index
    for (let i = 0; i < items.length; i++) {
      next = (next + delta + items.length) % items.length
      if (!items[next].disabled) break
    }
    if (items[next].disabled || next === index) return
    onChange(items[next].key)
    tabRefs.current[next]?.focus()
  }

  // `items-center`, e não `items-end`: o conteúdo do `trailing` é mais baixo que
  // as abas, e alinhado pela base ficava pendurado na borda. A régua de abas é o
  // item mais alto, então ela continua definindo a altura da linha e o
  // sublinhado da aba ativa segue encostado na borda de baixo.
  return (
    <div className="flex items-center gap-3 border-b border-borda">
      {/* Sem `flex-1`: a régua de abas fica com a largura do conteúdo, para o
          `trailing` encostar nela. Com flex-1 ela esticaria e empurraria o
          conteúdo para a borda da página. `min-w-0` mantém o scroll horizontal
          funcionando quando as abas não couberem. */}
      <div
        ref={filaRef}
        role="tablist"
        aria-label={rotulo}
        // `relative`: o que for `absolute` dentro (um `sr-only`) se mede por esta
        // régua que rola, e não pela página — senão a aba fora da vista alarga a
        // tela no celular.
        className="relative flex min-w-0 gap-1 overflow-x-auto scrollbar-thin"
      >
        {items.map((item, index) => {
          const active = item.key === value
          return (
            <button
              key={item.key}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              id={idDoPainel ? idDaAba(idDoPainel, index) : undefined}
              role="tab"
              aria-selected={active}
              // SÓ A ABA ABERTA aponta para o painel: há um painel só, com o
              // conteúdo dela; as outras não controlam nada que exista na tela.
              aria-controls={idDoPainel && active ? idDoPainel : undefined}
              // Roving tabindex: só a aba ativa entra na ordem de tabulação.
              tabIndex={active ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.key)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                // O `.tabs button` da amostra: 14px na fonte do corpo, cinza
                // secundário, e a aberta em azul com o sublinhado no azul da
                // logomarca. A desabilitada fica no cinza de metadado, apagada.
                'flex shrink-0 items-center gap-s1.5 whitespace-nowrap border-b-2 px-s3 py-s2 text-corpo font-semibold transition-colors',
                item.disabled
                  ? 'cursor-not-allowed border-transparent text-texto-3 opacity-60'
                  : active
                    ? 'border-marca-viva text-marca-texto'
                    : 'border-transparent text-texto-2 hover:border-borda-forte hover:text-texto',
              )}
            >
              {item.icon}
              {item.label}
              {item.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums',
                    active ? 'bg-marca-suave text-marca-texto' : 'bg-superficie-3 text-texto-2',
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {trailing && (
        <div className={cn('shrink-0', trailingNaBorda && 'ml-auto')}>{trailing}</div>
      )}
    </div>
  )
}
