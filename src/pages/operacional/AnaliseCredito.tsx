// Análise de Crédito: as etapas do fluxo do operacional, alimentadas pelos cards
// do kanban do Kommo (espelho local em public.kommo_leads).
//
// Cada tela corresponde a exatamente uma coluna do Kommo, e as ações de cada
// etapa aparecem como botões no próprio card. Ação com um clique: o único caso
// que abre diálogo é reprovar, porque exige motivo.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ExternalLink, ArrowRight, Check, FileSearch, X } from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import {
  FUNIL_RPV,
  TELAS,
  ACOES,
  ST_DECISAO,
  ST_PROPOSTA,
  ST_DILIGENCIA,
  ST_REPROVADO,
  exigeMotivo,
  agruparPorTela,
  useKommoLeads,
  useAnalisesProntas,
  type TelaAnalise,
  type AcaoTela,
} from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Modal } from '@/components/ui/Modal'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Loading, ErrorState, EmptyState } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { formatCNJ, formatDate } from '@/lib/format'

const KOMMO_SUBDOMINIO = 'contatocredijuriscom'

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
  const nota = lead.nota_texto?.trim()
  const ocupado = statusEmAndamento !== null

  return (
    <div className="border-b border-slate-100 p-4 transition-colors last:border-b-0 hover:bg-slate-50/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{tituloCard(lead)}</span>
            {analisePronta !== null && (
              <Badge size="sm" tone={analisePronta ? 'green' : 'yellow'}>
                {analisePronta ? 'finalizado' : 'em curso'}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            {lead.processo_cnj && (
              <span className="whitespace-nowrap font-medium text-slate-600">
                {formatCNJ(lead.processo_cnj)}
              </span>
            )}
            {lead.responsavel_nome && <span>{lead.responsavel_nome}</span>}
            {lead.criado_em && <span>· criado em {formatDate(lead.criado_em)}</span>}
          </div>
          {lead.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {lead.tags.map((t) => (
                <Badge key={t} size="sm" tone="gray">
                  {t}
                </Badge>
              ))}
            </div>
          )}
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
        {/* A nota do comercial vem em texto livre e o formato varia entre cards,
            então é exibida crua, recolhida por padrão. */}
        {nota && (
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            {aberto ? 'Ocultar dados do card' : 'Ver dados do card'}
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

      {nota && aberto && (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-inset ring-slate-100">
          {nota}
        </pre>
      )}
    </div>
  )
}

export default function AnaliseCredito() {
  const qc = useQueryClient()
  const toast = useToast()
  const { profile, user } = useAuth()
  const leads = useKommoLeads(FUNIL_RPV)
  const prontas = useAnalisesProntas()

  // Mesma cadeia de fallback da Edge Function kommo-mover, para o diálogo
  // mostrar exatamente o que vai ser gravado no card.
  const assinatura =
    profile?.nome?.trim() || profile?.email || user?.email || 'usuário do sistema'

  const [tela, setTela] = useState<TelaAnalise>('pendentes')
  const [busca, setBusca] = useState('')
  // Ação em curso, para o botão certo do card certo mostrar o spinner.
  const [emAndamento, setEmAndamento] = useState<{
    leadId: number
    statusId: number
  } | null>(null)
  // Só reprovar abre diálogo, porque exige motivo.
  const [reprovando, setReprovando] = useState<KommoLead | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erroMotivo, setErroMotivo] = useState<string | null>(null)

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
        [x.nome, x.processo_cnj, x.nota_texto, x.responsavel_nome]
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
      fecharReprovar()
    },
    onError: (e) => {
      setEmAndamento(null)
      // Reprovando, o erro fica no próprio diálogo (o motivo digitado não se
      // perde). Nas ações diretas não há diálogo, então vai por toast.
      if (reprovando) setErroMotivo((e as Error).message)
      else toast.error((e as Error).message)
    },
  })

  /** Reprovar pede motivo; as outras ações vão direto, com um clique. */
  function acionar(lead: KommoLead, acao: AcaoTela) {
    if (exigeMotivo(acao.statusId)) {
      setReprovando(lead)
      setMotivo('')
      setErroMotivo(null)
      return
    }
    setEmAndamento({ leadId: lead.kommo_lead_id, statusId: acao.statusId })
    mover.mutate({ leadId: lead.kommo_lead_id, statusId: acao.statusId, comentario: '' })
  }

  function fecharReprovar() {
    setReprovando(null)
    setMotivo('')
    setErroMotivo(null)
  }

  function confirmarReprovar() {
    if (!reprovando) return
    if (!motivo.trim()) {
      setErroMotivo('Informe o motivo da reprovação.')
      return
    }
    setErroMotivo(null)
    setEmAndamento({ leadId: reprovando.kommo_lead_id, statusId: ST_REPROVADO })
    mover.mutate({
      leadId: reprovando.kommo_lead_id,
      statusId: ST_REPROVADO,
      comentario: motivo.trim(),
    })
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

      <Modal
        open={!!reprovando}
        onClose={fecharReprovar}
        title="Reprovar crédito"
        footer={
          <>
            <Button variant="outline" onClick={fecharReprovar}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              icon={<X className="h-4 w-4" />}
              onClick={confirmarReprovar}
              loading={mover.isPending}
            >
              Reprovar
            </Button>
          </>
        }
      >
        {reprovando && (
          <div className="space-y-4">
            <div className="text-sm font-medium text-slate-800">
              {tituloCard(reprovando)}
            </div>
            <Field
              label="Motivo da reprovação"
              required
              error={erroMotivo ?? undefined}
              hint={`O comercial lê este texto no card, dentro do Kommo, assinado como "${assinatura}".`}
            >
              <Textarea
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: processo com penhora anterior à cessão."
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
