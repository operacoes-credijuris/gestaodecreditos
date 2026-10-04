// O "TENTAR DE NOVO" EM FORMA DE LINK, dentro de uma frase de erro (item "Novo"
// da amostra, janelas-shell.js): enquanto a nova leitura corre, ele gira e diz
// "Tentando…". Sem isso o clique parecia não ter feito nada até a resposta
// chegar — e quem não vê efeito clica de novo.
//
// O botão grande do ErrorState (ui/Table.tsx) já faz o mesmo; este é o par dele
// para os avisos de uma linha.
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'

export function LinkTentarDeNovo({
  tentando,
  onClick,
  className,
}: {
  /** A leitura está em voo: gira, diz "Tentando…" e não aceita outro clique. */
  tentando: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={tentando}
      aria-busy={tentando || undefined}
      className={cn(
        'inline-flex min-h-[24px] items-center gap-s1 font-semibold underline disabled:cursor-wait disabled:no-underline disabled:opacity-80',
        className,
      )}
    >
      {tentando && <RefreshCw className="h-[14px] w-[14px] animate-spin" aria-hidden />}
      {tentando ? 'Tentando…' : 'Tentar de novo'}
    </button>
  )
}
