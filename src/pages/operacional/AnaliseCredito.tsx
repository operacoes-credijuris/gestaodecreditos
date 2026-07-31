// Análise de Crédito: as etapas do fluxo do operacional, alimentadas pelos cards
// do kanban do Kommo (espelho local em public.kommo_leads).
//
// Cada tela corresponde a exatamente uma coluna do Kommo, e as ações de cada
// etapa aparecem como botões no próprio card, com um clique — nenhuma etapa
// pede justificativa: a análise, inclusive o motivo de uma eventual reprovação,
// já foi escrita em Pendentes (ver src/lib/kommo.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ExternalLink, ArrowRight, Check, FileSearch, X } from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import {
  FUNIL_RPV,
  KOMMO_SUBDOMINIO,
  TELAS,
  ACOES,
  ST_DECISAO,
  ST_PROPOSTA,
  ST_DILIGENCIA,
  ST_REPROVADO,
  agruparPorTela,
  useKommoLeads,
  useAnalisesProntas,
  type TelaAnalise,
  type AcaoTela,
} from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Loading, ErrorState, EmptyState } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/format'

/** Ícone por destino — dá para reconhecer a ação sem ler o rótulo. */
const ICONES: Record<number, ReactNode> = {
  [ST_DECISAO]: <ArrowRight className="h-4 w-4" />,
  [ST_PROPOSTA]: <Check className="h-4 w-4" />,
  [ST_DILIGENCIA]: <FileSearch className="h-4 w-4" />,
  [ST_REPROVADO]: <X className="h-4 w-4" />,
}

/** Link para o card no Kommo — o operacional às vezes precisa do original. */
function urlCard(leadId: number): string {
  return `https://${KOMMO_SUBDOMINIO}.kommo.com/leads/detail/${leadId}`
}

function tituloCard(lead: KommoLead): string {
  return lead.nome?.trim() || `Card ${lead.kommo_lead_id}`
}

function CardCredito({
  lead,
  acoes,
  onAcao,
  analisePronta,
  statusEmAndamento,
}: {
  lead: KommoLead
  acoes: AcaoTela[]
  onAcao: (l: KommoLead, a: AcaoTela) => void
  /** null = não mostrar o selo (só faz sentido na etapa de revisão). */
  analisePronta: boolean | null
  /** Destino sendo processado neste card, ou null. */
  statusEmAndamento: number | null
}) {
  const [aberto, setAberto] = useState(false)
  const ocupado = statusEmAndamento !== null
  // Compatibilidade com cards sincronizados antes da coluna `notas` existir:
  // cai no nota_texto para não sumir o dado do crédito antes do próximo sync.
  const notas =
    lead.notas?.length > 0
      ? lead.notas
      : lead.nota_texto?.trim()
        ? [{ id: 0, texto: lead.nota_texto, criado_em: null, autor: null }]
        : []
  const posteriores = notas.length - 1

  return (
    <div className="border-b border-slate-100 p-4 transition-colors last:border-b-0 hover:bg-slate-50/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{tituloCard(lead)}</span>
            {analisePronta !== null && (
              <Badge size="sm" tone={analisePronta ? 'green' : 'yellow'}>
                {analisePronta ? 'Finalizado' : 'Em curso'}
              </Badge>
            )}
          </div>
          {/* Sem linha de metadados: o processo já vem no título, o responsável é
              sempre a Credijuris, e a data de criação do card é redundante com as
              datas das próprias anotações. Tags também ficam de fora — as atuais
              são artefato da migração do Chatwoot. Tudo continua em kommo_leads. */}
        </div>

        {/* Lado a lado: os rótulos são curtos e assim cada card ocupa uma linha
            em vez de três. flex-wrap para não estourar em tela estreita. */}
        {acoes.length > 0 && (
          <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
            {acoes.map((a) => (
              <Button
                key={a.statusId}
                size="sm"
                variant={a.variant}
                icon={ICONES[a.statusId]}
                onClick={() => onAcao(lead, a)}
                loading={statusEmAndamento === a.statusId}
                // Trava as outras ações do card enquanto uma corre: duas
                // movimentações simultâneas no mesmo card se atropelariam.
                disabled={ocupado}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        {/* As anotações vêm em texto livre e o formato varia entre cards, então
            são exibidas cruas, recolhidas por padrão. A contagem no rótulo evita
            que anotação nova passe batida com o bloco fechado. */}
        {notas.length > 0 && (
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            {aberto ? 'Ocultar histórico' : 'Ver histórico'}
            {posteriores > 0 && ` (+${posteriores})`}
          </button>
        )}
        <a
          href={urlCard(lead.kommo_lead_id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-600"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Abrir no Kommo
        </a>
      </div>

      {aberto && notas.length > 0 && (
        <div className="mt-2 space-y-2">
          {notas.map((n, i) => (
            <div key={n.id || i}>
              {/* Só a data. Sem rótulo de posição, porque há cards em que a
                  primeira anotação é um comentário curto e o bloco de dados vem
                  depois — numerar sugeriria uma ordem semântica que não existe.
                  E sem autor: a equipe usa um login só e se identifica no próprio
                  texto da anotação; os nomes que aparecem são de antes disso.
                  O campo continua guardado em kommo_leads.notas. */}
              <div className="mb-0.5 text-xs text-slate-400">
                {n.criado_em && formatDate(n.criado_em)}
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-inset ring-slate-100">
                {n.texto}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AnaliseCredito() {
  const qc = useQueryClient()
  const toast = useToast()
  const leads = useKommoLeads(FUNIL_RPV)
  const prontas = useAnalisesProntas()

  const [tela, setTela] = useState<TelaAnalise>('pendentes')
  const [busca, setBusca] = useState('')
  // Ação em curso, para o botão certo do card certo mostrar o spinner.
  const [emAndamento, setEmAndamento] = useState<{
    leadId: number
    statusId: number
  } | null>(null)

  // Sincroniza com o Kommo ao abrir a página, no mesmo padrão de Publicações e
  // Tarefas. O cron cobre o intervalo; isto cobre o "acabei de sentar".
  const sync = useMutation({
    mutationFn: () => invokeFunction('kommo-sync', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kommo_leads'] })
      qc.invalidateQueries({ queryKey: ['kommo_analise_interna'] })
    },
    onError: (e) => toast.error(`Sincronização Kommo: ${(e as Error).message}`),
  })
  const jaSincronizou = useRef(false)
  useEffect(() => {
    if (jaSincronizou.current) return
    jaSincronizou.current = true
    sync.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grupos = useMemo(() => agruparPorTela(leads.data ?? []), [leads.data])

  const lista = useMemo(() => {
    let l = grupos[tela]
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((x) =>
        [
          x.nome,
          x.processo_cnj,
          x.responsavel_nome,
          // Busca em TODAS as anotações, não só na primeira: informação
          // relevante costuma vir num comentário posterior.
          ...(x.notas ?? []).map((n) => n.texto),
          x.nota_texto,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [grupos, tela, busca])

  const mover = useMutation({
    mutationFn: (args: { leadId: number; statusId: number; comentario: string }) =>
      invokeFunction<{ mensagem: string; aviso: string | null }>('kommo-mover', args),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['kommo_leads'] })
      qc.invalidateQueries({ queryKey: ['kommo_analise_interna'] })
      // A função devolve aviso quando o card moveu mas a anotação não gravou —
      // é sucesso parcial, não erro, e o usuário precisa saber da diferença.
      if (r?.aviso) toast.error(r.aviso)
      else toast.success(r?.mensagem ?? 'Card movido.')
      setEmAndamento(null)
    },
    onError: (e) => {
      setEmAndamento(null)
      toast.error((e as Error).message)
    },
  })

  /** Toda ação é um clique: nenhuma etapa pede justificativa. */
  function acionar(lead: KommoLead, acao: AcaoTela) {
    setEmAndamento({ leadId: lead.kommo_lead_id, statusId: acao.statusId })
    mover.mutate({ leadId: lead.kommo_lead_id, statusId: acao.statusId, comentario: '' })
  }

  const defTela = TELAS.find((t) => t.key === tela)!

  return (
    <div>
      <PageHeader
        title="Análise de Crédito"
        actions={
          <SyncStatus
            syncing={sync.isPending}
            updatedAt={leads.dataUpdatedAt}
            label="sincronizando com o Kommo…"
          />
        }
      />

      {/* Precatórios entram na fase 2: o funil existe no Kommo, mas o sync
          ainda só traz o de RPV. */}
      <div className="mb-4">
        <Segmented
          ariaLabel="Tipo de crédito"
          items={[
            { key: 'rpv', label: 'RPV', count: (leads.data ?? []).length },
            { key: 'precatorio', label: 'Precatórios', disabled: true },
          ]}
          value="rpv"
          onChange={() => {}}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome do card, processo, responsável ou conteúdo…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="mt-3">
          <Segmented
            ariaLabel="Etapa da análise"
            items={TELAS.map((t) => ({
              key: t.key,
              label: t.label,
              count: grupos[t.key].length,
            }))}
            value={tela}
            onChange={(v) => setTela(v as TelaAnalise)}
          />
        </div>
      </Card>

      <Card>
        {leads.isLoading ? (
          <Loading />
        ) : leads.isError ? (
          <ErrorState
            message={(leads.error as Error)?.message}
            onRetry={() => leads.refetch()}
          />
        ) : lista.length === 0 ? (
          <EmptyState
            title={busca.trim() ? 'Nada encontrado' : `Nenhum card em ${defTela.label}`}
            description={
              busca.trim()
                ? 'Nenhum card corresponde à busca nesta etapa.'
                : defTela.descricaoVazia
            }
          />
        ) : (
          <div>
            {lista.map((l) => (
              <CardCredito
                key={l.kommo_lead_id}
                lead={l}
                acoes={ACOES[tela]}
                onAcao={acionar}
                // O selo só aparece em Pendentes: nas etapas seguintes a
                // análise já passou pela revisão, então dizer "finalizado"
                // seria ruído.
                analisePronta={
                  tela === 'pendentes'
                    ? (prontas.data?.has(l.kommo_lead_id) ?? false)
                    : null
                }
                statusEmAndamento={
                  emAndamento?.leadId === l.kommo_lead_id
                    ? emAndamento.statusId
                    : null
                }
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
