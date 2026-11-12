import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * O QUE VAI AO LADO DO TÍTULO DA TELA (o h1), posto pela moldura do app — hoje,
 * o "?" da ajuda da tela (item "Novo" da amostra).
 *
 * POR CONTEXTO, E NÃO POR PROP: assim toda tela ganha a ajuda sem que cada uma
 * precise passá-la, e as props do PageHeader não mudam. Sem provedor (o padrão),
 * o cabeçalho é exatamente o de antes. Só o h1: o cabeçalho de aba (h2) não leva.
 */
export const AcessorioDoTitulo = createContext<ReactNode>(null)

export function PageHeader({
  title,
  description,
  actions,
  nivel = 1,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /**
   * UM h1 SÓ POR TELA. Numa moldura com abas (o Quadro econômico), o título da
   * moldura é o h1, e o cabeçalho de cada aba desce para h2 — e fica menor, para
   * a hierarquia que se vê ser a mesma que o leitor de tela anuncia.
   */
  nivel?: 1 | 2
}) {
  const Titulo = nivel === 1 ? 'h1' : 'h2'
  const acessorio = useContext(AcessorioDoTitulo)
  const comAcessorio = nivel === 1 && acessorio
  return (
    // O `.page-head` da amostra: título de 26px em extranegrito e as ações
    // alinhadas pela BASE do bloco (com a descrição), não pelo meio do título.
    // NA GRADE DE 4PX (auditoria visual, M3): 24px até o conteúdo (eram 18) e
    // 8px entre as ações. O primário do cabeçalho é sempre `size="md"`.
    <div className="mb-s6 flex flex-col gap-s3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {(() => {
          // NO CELULAR, O H1 EM 22PX (revisão geral, 07/10/2026): em 26px,
          // "Publicações e movimentações" e "Requerimentos administrativos"
          // ocupavam duas linhas e meia da tela de 375px antes de qualquer dado.
          const titulo = (
            // O H1 NA SERIFA (design system v3, 12/11/2026): a Source Serif 4
            // em seminegrito, 30px no computador — a assinatura de relatório
            // institucional, a única serifa da tela. O h2 da aba fica na Inter:
            // duas serifas competindo na mesma vista desfariam a hierarquia.
            <Titulo
              className={cn(
                'text-texto',
                nivel === 1
                  ? 'font-titulo text-2xl font-semibold tracking-[-0.01em] sm:text-4xl'
                  : 'font-display text-xl font-semibold tracking-[-0.01em]',
              )}
            >
              {title}
            </Titulo>
          )
          // AO LADO do h1, e não dentro: dentro, o nome do botão entraria no
          // nome do título que o leitor de tela anuncia. SEM QUEBRAR DE LINHA:
          // com o título em duas linhas (celular), o "?" descia sozinho para uma
          // terceira; agora fica no alto, ao lado da primeira linha (centrado
          // nela: 4px de 32px no computador, 2px de 28px no celular).
          return comAcessorio ? (
            <div className="flex items-start gap-s2">
              {titulo}
              <span className="mt-[2px] shrink-0 sm:mt-[3px]">{acessorio}</span>
            </div>
          ) : (
            titulo
          )
        })()}
        {description && (
          <p className="mt-s1.5 max-w-[72ch] text-corpo text-texto-2">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-s2">{actions}</div>}
    </div>
  )
}
