import type { ReactNode } from 'react'

/**
 * O `kbd` da amostra: a tecla desenhada ("Ctrl K", "/"). Mora em `ui/` desde a
 * auditoria visual (03/10/2026) para o topo, a janela de atalhos e o campo de
 * busca das listas (`CampoDeBusca`) mostrarem o atalho do mesmo jeito — antes
 * o topo usava `kbd` e as listas escreviam "( / )" no texto de exemplo.
 * `layout/Consultas.tsx` continua exportando o mesmo nome.
 */
export function Tecla({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-borda-forte bg-superficie px-1.5 py-0.5 font-sans text-xs font-semibold text-texto-2">
      {children}
    </kbd>
  )
}
