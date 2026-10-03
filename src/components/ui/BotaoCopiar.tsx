// Copiar com um clique o que se copia o tempo todo — o número do processo, o
// CPF, o link, a resposta do assistente (revisão de qualidade de vida,
// 03/10/2026).
//
// A MESMA API do `components/BotaoCopiar.tsx` da frente de Comercial/Operacional
// (branch qv-q2): `BotaoCopiar({ valor, rotulo, aviso, className })` e
// `useCopiarTexto()`. Aqui, em ui/, para toda a plataforma, com três
// acréscimos opcionais que não mudam quem já usa aquela: `aviso` pode faltar
// (só o ✓, sem toast), `tamanho` e `pararClique`. E a cópia passa por
// lib/copiar.ts, que cai no jeito antigo (execCommand) quando o navegador
// recusa a área de transferência moderna. Unificando, aquele arquivo pode virar
// um reexporte deste.
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { AVISO_DE_COPIA_RECUSADA, copiarTexto } from '@/lib/copiar'
import { useToast } from './Toast'

/** Quanto tempo o ✓ de "copiado" fica no lugar do ícone (ms). */
const TEMPO_DO_COPIADO_MS = 1500

/**
 * Copia um texto e avisa. Devolve se deu certo, para quem quiser trocar o ícone.
 *
 * O aviso de falha sai sempre, dizendo como copiar à mão — calar a falha
 * deixaria a pessoa colar o que estava antes. O de sucesso, só com `aviso`.
 *
 * @param aviso o que vai no aviso de sucesso ("Número copiado.").
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useCopiarTexto() {
  const toast = useToast()
  return useCallback(
    async (texto: string, aviso?: string): Promise<boolean> => {
      const ok = await copiarTexto(texto)
      if (!ok) toast.error(AVISO_DE_COPIA_RECUSADA)
      else if (aviso) toast.success(aviso)
      return ok
    },
    [toast],
  )
}

export interface BotaoCopiarProps {
  /** O texto que vai para a área de transferência. Vazio: o botão não aparece. */
  valor: string
  /** Nome acessível e dica do botão: "Copiar o número do processo". */
  rotulo: string
  /**
   * O aviso de sucesso: "Número copiado.". Sem ele, só o ✓ no botão — o
   * "copiado" discreto, para o que se copia muitas vezes seguidas.
   */
  aviso?: string
  /** `sm` (24px, o padrão — linhas e cartões) ou `md` (32px). */
  tamanho?: 'sm' | 'md'
  /**
   * Não deixa o clique subir (padrão: sim): o botão mora em linhas e cartões que
   * abrem ficha ou expandem ao clique, e copiar não pode abrir nada.
   */
  pararClique?: boolean
  className?: string
}

/**
 * O botão de ícone que copia. Discreto (cinza), com o ✓ por um instante depois
 * do clique; o leitor de tela ouve "Copiado".
 */
export function BotaoCopiar({
  valor,
  rotulo,
  aviso,
  tamanho = 'sm',
  pararClique = true,
  className,
}: BotaoCopiarProps) {
  const copiar = useCopiarTexto()
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!valor) return null

  async function aoClicar(e: MouseEvent<HTMLButtonElement>) {
    if (pararClique) {
      e.stopPropagation()
      e.preventDefault()
    }
    if (!(await copiar(valor, aviso))) return
    setCopiado(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopiado(false), TEMPO_DO_COPIADO_MS)
  }

  const nome = copiado ? 'Copiado' : rotulo
  const Icone = copiado ? Check : Copy
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-label={nome}
      title={nome}
      className={cn(
        'inline-grid flex-none place-items-center rounded-controle text-texto-3 transition-colors',
        'hover:bg-superficie-3 hover:text-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
        // 24px de alvo (h-8 = 24px na escala de 3px por unidade), ícone de 12px.
        tamanho === 'sm' ? 'h-8 w-8' : 'h-[32px] w-[32px]',
        className,
      )}
    >
      <Icone
        className={cn(tamanho === 'sm' ? 'h-4 w-4' : 'h-[16px] w-[16px]', copiado && 'text-sucesso')}
        aria-hidden
      />
      {/* O "Copiado" anunciado: troca de nome do botão não é lida sozinha. */}
      <span className="sr-only" aria-live="polite">
        {copiado ? 'Copiado' : ''}
      </span>
    </button>
  )
}

/**
 * Um valor com o botão de copiar ao lado:
 * `<CopiarTexto valor={cnj} rotulo="Copiar o número do processo">{formatCNJ(cnj)}</CopiarTexto>`.
 * O que se mostra (`children`) pode vir formatado; o que se copia é `valor`.
 * Sem `children`, mostra o próprio `valor`.
 */
export function CopiarTexto({
  valor,
  children,
  className,
  ...botao
}: BotaoCopiarProps & { children?: ReactNode }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <span className="min-w-0 truncate">{children ?? valor}</span>
      <BotaoCopiar valor={valor} {...botao} />
    </span>
  )
}
