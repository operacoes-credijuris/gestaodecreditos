import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'

/** Uma ação do menu "⋯". */
export interface AcaoDoMenu {
  rotulo: string
  /** O ícone (16px; o tamanho vem do menu). */
  icone?: ReactNode
  onSelecionar: () => void
  /** Ação destrutiva (Excluir): em vermelho, separada, sempre por ÚLTIMO. */
  perigo?: boolean
  desabilitada?: boolean
  /** O porquê de estar desligada, na dica. */
  motivo?: string
}

/** A largura do menu aberto (px), para alinhá-lo pela direita do "⋯". */
const LARGURA = 220

/**
 * O MENU "⋯" DAS AÇÕES DE LINHA (auditoria visual de 03/10/2026, C4).
 *
 * O problema que ele resolve: Créditos e Requerimentos tinham 4 ícones de 12px
 * por linha (+ ✎ 🗑 ›), de cor fraca, e o Excluir COLADO no Editar — um erro de
 * clique a 3px de distância. Agora a linha mostra só o "›" (abrir, ver
 * `AcoesDaLinha`) e este "⋯", com as ações por extenso; as destrutivas vão
 * por último, em vermelho, depois de um divisor.
 *
 * - O MENU VAI PARA O <body> por portal, com `position: fixed` medida pelo "⋯":
 *   abaixo de 1280px a tabela rola de lado (`overflow-x-auto`), e um menu
 *   `absolute` dentro dela seria cortado.
 * - O CLIQUE NÃO CHEGA À LINHA: o React leva o evento do portal até os
 *   ancestrais do componente, e a `<tr>` clicável abriria a ficha junto.
 * - Teclado: Enter/Espaço/seta abre e foca a primeira ação; ↑/↓, Home/End
 *   andam; Escape fecha e devolve o foco ao "⋯"; Tab fecha. Clique fora fecha;
 *   rolar a página fecha (a posição ficaria velha).
 */
export function MenuDeAcoes({
  acoes,
  rotulo = 'Mais ações',
  className,
}: {
  acoes: readonly AcaoDoMenu[]
  /** O nome do botão "⋯" para o leitor de tela (ex.: "Ações do crédito 0001234-56…"). */
  rotulo?: string
  className?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; acima: boolean } | null>(null)
  const botaoRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()

  // AS DESTRUTIVAS POR ÚLTIMO, seja qual for a ordem em que a tela as passou.
  const comuns = acoes.filter((a) => !a.perigo)
  const perigosas = acoes.filter((a) => a.perigo)

  const fechar = useCallback((devolverFoco: boolean) => {
    setAberto(false)
    if (devolverFoco) botaoRef.current?.focus()
  }, [])

  const itens = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])]

  // A POSIÇÃO: embaixo do "⋯", alinhada pela direita; sem espaço embaixo, em cima.
  useLayoutEffect(() => {
    if (!aberto) return
    const r = botaoRef.current?.getBoundingClientRect()
    if (!r) return
    const altura = menuRef.current?.offsetHeight ?? 0
    const acima = r.bottom + 4 + altura > window.innerHeight - 8 && r.top - 4 - altura > 8
    const left = Math.max(8, Math.min(r.right - LARGURA, window.innerWidth - LARGURA - 8))
    setPos({ top: acima ? r.top - 4 - altura : r.bottom + 4, left, acima })
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    itens()[0]?.focus()
    function fora(e: MouseEvent) {
      const alvo = e.target as Node
      if (!menuRef.current?.contains(alvo) && !botaoRef.current?.contains(alvo)) fechar(false)
    }
    const rolou = () => fechar(false)
    document.addEventListener('mousedown', fora)
    window.addEventListener('scroll', rolou, true)
    window.addEventListener('resize', rolou)
    return () => {
      document.removeEventListener('mousedown', fora)
      window.removeEventListener('scroll', rolou, true)
      window.removeEventListener('resize', rolou)
    }
  }, [aberto, fechar])

  function aoTeclarNoMenu(e: KeyboardEvent) {
    const lista = itens()
    const i = lista.indexOf(document.activeElement as HTMLButtonElement)
    const ir = (n: number) => {
      e.preventDefault()
      lista[(n + lista.length) % lista.length]?.focus()
    }
    if (e.key === 'ArrowDown') ir(i + 1)
    else if (e.key === 'ArrowUp') ir(i - 1)
    else if (e.key === 'Home') ir(0)
    else if (e.key === 'End') ir(lista.length - 1)
    else if (e.key === 'Escape') {
      // PARA AQUI: o Escape fecha o menu, e não a janela ou o painel atrás dele.
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      fechar(true)
    } else if (e.key === 'Tab') fechar(false)
  }

  const item = (a: AcaoDoMenu) => (
    <button
      key={a.rotulo}
      type="button"
      role="menuitem"
      disabled={a.desabilitada}
      title={a.desabilitada ? a.motivo : undefined}
      onClick={() => {
        fechar(true)
        a.onSelecionar()
      }}
      className={cn(
        'flex h-[36px] w-full items-center gap-s2 rounded-controle px-s2 text-left text-corpo transition-colors focus:outline-none',
        '[&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:shrink-0',
        a.perigo
          ? 'text-perigo hover:bg-perigo-fundo focus-visible:bg-perigo-fundo'
          : 'text-texto hover:bg-superficie-3 focus-visible:bg-superficie-3',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
      )}
    >
      {a.icone}
      <span className="min-w-0 flex-1 truncate">{a.rotulo}</span>
    </button>
  )

  if (acoes.length === 0) return null

  return (
    <>
      <IconButton
        ref={botaoRef}
        tamanho="linha"
        label={rotulo}
        icon={<MoreHorizontal aria-hidden />}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        className={className}
        onClick={(e) => {
          e.stopPropagation()
          setAberto((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !aberto) {
            e.preventDefault()
            setAberto(true)
          }
        }}
      />
      {aberto &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            aria-label={rotulo}
            onKeyDown={aoTeclarNoMenu}
            // O CLIQUE NÃO SOBE PARA A LINHA (ver o comentário do componente).
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: LARGURA }}
            className="animate-fade-in fixed z-aviso rounded-flutuante border border-borda bg-superficie p-s1.5 shadow-nivel-2 dark:ring-1 dark:ring-white/[0.06]"
          >
            {comuns.map(item)}
            {comuns.length > 0 && perigosas.length > 0 && <div className="mx-s1 my-s1 border-t border-borda" role="separator" />}
            {perigosas.map(item)}
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * AS AÇÕES DE UMA LINHA DE TABELA, num lugar só (auditoria visual, §0.9 e C4):
 * o "⋯" com as ações e o "›" que abre o registro, numa coluna de largura fixa
 * à direita (72px). O "›" é também o CAMINHO PELO TECLADO até a ficha: a linha
 * clicável não recebe foco.
 *
 * Uso: `<TD className="w-[72px]"><AcoesDaLinha onAbrir={…} rotuloAbrir="Abrir o
 * crédito …" acoes={[…]} /></TD>`.
 */
export function AcoesDaLinha({
  onAbrir,
  rotuloAbrir = 'Abrir',
  acoes = [],
  rotuloDasAcoes,
}: {
  onAbrir?: () => void
  rotuloAbrir?: string
  acoes?: readonly AcaoDoMenu[]
  rotuloDasAcoes?: string
}) {
  return (
    <div className="flex items-center justify-end gap-s1">
      <MenuDeAcoes acoes={acoes} rotulo={rotuloDasAcoes} />
      {onAbrir && (
        <IconButton
          tamanho="linha"
          label={rotuloAbrir}
          icon={<ChevronRight aria-hidden />}
          onClick={(e) => {
            e.stopPropagation()
            onAbrir()
          }}
        />
      )}
    </div>
  )
}
