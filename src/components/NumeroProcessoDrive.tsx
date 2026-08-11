// O número do processo, clicável, abrindo a pasta do crédito no Drive.
//
// Um componente só para as duas telas que mostram número de processo (Créditos e
// Tarefas): o gesto tem de ser o mesmo nas duas, e duas implementações do "clicou no
// número" acabariam levando a lugares diferentes.
//
// COMO EVITA A DEMORA: achar a pasta custa três chamadas ao Drive em sequência e pode
// pedir autorização do Google. Número de processo parece link, e link que demora meio
// segundo frustra. Então a primeira resolução guarda o id em processos.drive_pasta_id
// (migração 0033) e dali em diante o clique é instantâneo.
import { useState, type MouseEvent } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatCNJ } from '@/lib/format'
import { driveConfigurado } from '@/lib/drive'
import { useToast } from '@/components/ui/Toast'
import { processosCrud } from '@/lib/queries'
import type { Processo } from '@/lib/types'

export function NumeroProcessoDrive({
  processo,
  numero,
  className,
}: {
  /**
   * O crédito, quando a tarefa/linha casou com um. Nulo em tarefa de processo que
   * não está cadastrado — aí o número aparece como texto comum, sem link.
   */
  processo: Processo | null
  /** O número a exibir. Vem separado porque em Tarefas ele é o da tarefa. */
  numero: string | null | undefined
  className?: string
}) {
  const toast = useToast()
  const [abrindo, setAbrindo] = useState(false)
  const atualizar = processosCrud.useUpdate()

  const texto = formatCNJ(numero)
  const podeAbrir = !!processo && driveConfigurado

  async function abrir(e: MouseEvent) {
    // A linha de Créditos inteira abre a ficha lateral. Sem parar o evento aqui, um
    // clique no número faria as duas coisas ao mesmo tempo.
    e.stopPropagation()
    e.preventDefault()
    if (!processo || abrindo) return

    // Caminho rápido: id já conhecido, abre na hora sem tocar no Drive.
    if (processo.drive_pasta_id) {
      const { linkDaPasta } = await import('@/lib/peticaoPasta')
      window.open(linkDaPasta(processo.drive_pasta_id), '_blank', 'noopener,noreferrer')
      return
    }

    setAbrindo(true)
    try {
      const { resolverPastaDoCredito, linkDaPasta } = await import('@/lib/peticaoPasta')
      const r = await resolverPastaDoCredito(processo)
      if (r.tipo !== 'pronto') {
        toast.toast(r.motivo, 'info')
        return
      }
      window.open(linkDaPasta(r.pastaId), '_blank', 'noopener,noreferrer')
      // Guarda para o próximo clique ser instantâneo. Falha aqui não atrapalha o
      // usuário — a pasta já abriu; só custa resolver de novo na próxima vez.
      atualizar.mutate(
        { id: processo.id, changes: { drive_pasta_id: r.pastaId } },
        { onError: () => {} },
      )
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAbrindo(false)
    }
  }

  if (!podeAbrir) return <span className={className}>{texto}</span>

  return (
    <button
      type="button"
      onClick={abrir}
      title="Abrir a pasta deste crédito no Drive"
      className={cn(
        'inline-flex items-center gap-1 rounded text-left underline decoration-dotted underline-offset-2 transition-colors hover:text-brand-700 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
        className,
      )}
    >
      {texto}
      {abrindo ? (
        <Loader2 className="h-3.5 w-3.5 flex-none animate-spin text-slate-500" />
      ) : (
        // O ícone é discreto e sempre presente: sublinhado pontilhado sozinho não
        // diria PARA ONDE o clique leva, e a plataforma tem outros textos
        // sublinhados.
        <FolderOpen className="h-3.5 w-3.5 flex-none text-slate-500" />
      )}
    </button>
  )
}
