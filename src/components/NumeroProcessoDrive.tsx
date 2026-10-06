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
import { Button } from '@/components/ui/Button'
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
  reservarIcone,
  classeDoIcone,
}: {
  /**
   * O crédito, quando a tarefa/linha casou com um. Nulo em tarefa de processo que
   * não está cadastrado — aí o número aparece como texto comum, sem link.
   */
  processo: Processo | null
  /** O número a exibir. Vem separado porque em Tarefas ele é o da tarefa. */
  numero: string | null | undefined
  className?: string
  /**
   * Guarda o espaço do ícone da pasta mesmo quando não há pasta para abrir.
   *
   * Só quem tem ALGO DEPOIS do número na mesma linha precisa disto: sem a reserva,
   * o que vem depois anda 14px para a esquerda nas linhas sem pasta, e numa lista
   * inteira isso vira ziguezague. Fora desse caso a reserva seria um buraco à
   * direita do número, então é opt-in.
   */
  reservarIcone?: boolean
  /**
   * Classes do ícone da pasta. Em Tarefas (auditoria visual, T2) ele só aparece
   * no hover ou no foco do cartão: depois do número vinham dois ícones (pasta e
   * copiar) em toda tarefa, e a linha ficava poluída.
   */
  classeDoIcone?: string
}) {
  const { abrir, abrindo, podeAbrir } = useAbrirPastaDoCredito(processo)
  const texto = formatCNJ(numero)

  if (!podeAbrir) {
    return (
      <span className={cn(reservarIcone && 'inline-flex items-center gap-s1', className)}>
        {texto}
        {reservarIcone && (
          <span className="inline-block h-[16px] w-[16px] flex-none" aria-hidden="true" />
        )}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => void abrir(e)}
      title="Abrir a pasta deste crédito no Drive"
      className={cn(
        'inline-flex min-h-[24px] items-center gap-s1 rounded-controle text-left underline decoration-dotted underline-offset-2 transition-colors hover:text-marca-texto hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anel',
        className,
      )}
    >
      {texto}
      {abrindo ? (
        <Loader2 className="h-[16px] w-[16px] flex-none animate-spin text-texto-3" />
      ) : (
        // O ícone é discreto e sempre presente: sublinhado pontilhado sozinho não
        // diria PARA ONDE o clique leva, e a plataforma tem outros textos
        // sublinhados.
        <FolderOpen className={cn('h-[16px] w-[16px] flex-none text-texto-3', classeDoIcone)} />
      )}
    </button>
  )
}

/**
 * O gesto de abrir a pasta do crédito no Drive, para o número clicável e para o
 * botão "Pasta no Drive" da ficha — UM caminho só, com o mesmo atalho do id
 * guardado e os mesmos avisos quando a pasta não é achada.
 */
export function useAbrirPastaDoCredito(processo: Processo | null) {
  const toast = useToast()
  const [abrindo, setAbrindo] = useState(false)
  const atualizar = processosCrud.useUpdate()
  const podeAbrir = !!processo && driveConfigurado

  async function abrir(e?: MouseEvent) {
    // A linha de Créditos inteira abre a ficha lateral. Sem parar o evento aqui, um
    // clique no número faria as duas coisas ao mesmo tempo.
    e?.stopPropagation()
    e?.preventDefault()
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

  return { abrir, abrindo, podeAbrir }
}

/**
 * "Pasta no Drive" no topo da ficha do crédito (item "Novo" da amostra). O mesmo
 * gesto do número clicável da tabela, num botão à vista. Sem Drive configurado
 * neste build, não aparece: prometeria o que não há como cumprir.
 */
export function BotaoPastaDrive({ processo }: { processo: Processo }) {
  const { abrir, abrindo, podeAbrir } = useAbrirPastaDoCredito(processo)
  if (!podeAbrir) return null
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={abrindo}
      icon={<FolderOpen className="h-[16px] w-[16px]" />}
      onClick={(e) => void abrir(e)}
      title="Abrir a pasta deste crédito no Drive"
    >
      Pasta no Drive
    </Button>
  )
}
