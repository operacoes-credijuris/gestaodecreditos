import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

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
  return (
    // O `.page-head` da amostra: título de 26px em extranegrito e as ações
    // alinhadas pela BASE do bloco (com a descrição), não pelo meio do título.
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Titulo
          className={cn(
            'font-display font-extrabold tracking-tight text-texto',
            nivel === 1 ? 'text-3xl' : 'text-xl',
          )}
        >
          {title}
        </Titulo>
        {description && (
          <p className="mt-1 text-corpo text-texto-2">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
