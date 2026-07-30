// Análise de Crédito: as etapas do fluxo do operacional, alimentadas pelos cards
// do kanban do Kommo (espelho local em public.kommo_leads).
//
// Cada tela corresponde a exatamente uma coluna do Kommo, e as ações de cada
// etapa aparecem como botões no próprio card — em vez de um "Mover" genérico que
// obrigaria a escolher o destino numa lista.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ExternalLink } from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import {
  FUNIL_RPV,
  TELAS,
  ACOES,
  NOME_STATUS,
  exigeMotivo,
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
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Modal } from '@/components/ui/Modal'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Loading, ErrorState, EmptyState } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { formatCNJ, formatDate } from '@/lib/format'

const KOMMO_SUBDOMINIO = 'contatocredijuriscom'

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
}: {
  lead: KommoLead
  acoes: AcaoTela[]
  onAcao: (l: KommoLead, a: AcaoTela) => void
  /** null = não mostrar o selo (só faz sentido na etapa de revisão). */
  analisePronta: boolean | null
}) {
  const [aberto, setAberto] = useState(false)
  const nota = lead.nota_texto?.trim()

  return (
    <div className="border-b border-slate-100 p-4 last:border-b-0 hover:bg-slate-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{tituloCard(lead)}</span>
            {analisePronta !== null && (
              <Badge size="sm" tone={analisePronta ? 'green' : 'yellow'}>
                {analisePronta ? 'finalizado' : 'em curso'}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
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

        {/* Ações empilhadas: em Decisão são três, e lado a lado competiriam com
            o conteúdo do card. */}
        {acoes.length > 0 && (
          <div className="flex w-full flex-none flex-col gap-1.5 sm:w-44">
            {acoes.map((a) => (
              <Button
                key={a.statusId}
                size="sm"
                variant={a.variant}
                onClick={() => onAcao(lead, a)}
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
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Abrir no Kommo
        </a>
      </div>

      {nota && aberto && (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          {nota}
        </pre>
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
  // Ação pendente de confirmação: o card e o destino já escolhidos pelo botão.
  const [confirmando, setConfirmando] = useState<{
    lead: KommoLead
    acao: AcaoTela
  } | null>(null)
  const [comentario, setComentario] = useState('')
  const [erroMover, setErroMover] = useState<string | null>(null)

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
      fechar()
    },
    onError: (e) => setErroMover((e as Error).message),
  })

  function abrir(lead: KommoLead, acao: AcaoTela) {
    setConfirmando({ lead, acao })
    setComentario('')
    setErroMover(null)
  }

  function fechar() {
    setConfirmando(null)
    setComentario('')
    setErroMover(null)
  }

  function confirmar() {
    if (!confirmando) return
    const { lead, acao } = confirmando
    if (exigeMotivo(acao.statusId) && !comentario.trim()) {
      setErroMover('Informe o motivo da reprovação.')
      return
    }
    setErroMover(null)
    mover.mutate({
      leadId: lead.kommo_lead_id,
      statusId: acao.statusId,
      comentario: comentario.trim(),
    })
  }

  const defTela = TELAS.find((t) => t.key === tela)!
  const reprovando = confirmando ? exigeMotivo(confirmando.acao.statusId) : false

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
                onAcao={abrir}
                // O selo só aparece em Pendentes: nas etapas seguintes a
                // análise já passou pela revisão, então dizer "finalizado"
                // seria ruído.
                analisePronta={
                  tela === 'pendentes'
                    ? (prontas.data?.has(l.kommo_lead_id) ?? false)
                    : null
                }
              />
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!confirmando}
        onClose={fechar}
        title={confirmando ? confirmando.acao.label : ''}
        footer={
          <>
            <Button variant="outline" onClick={fechar}>
              Cancelar
            </Button>
            <Button
              variant={reprovando ? 'danger' : 'primary'}
              onClick={confirmar}
              loading={mover.isPending}
            >
              Confirmar
            </Button>
          </>
        }
      >
        {confirmando && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-slate-800">
                {tituloCard(confirmando.lead)}
              </div>
              <div className="text-xs text-slate-500">
                Vai para{' '}
                <span className="font-medium text-slate-700">
                  {NOME_STATUS[confirmando.acao.statusId]}
                </span>
              </div>
            </div>

            <Field
              label={reprovando ? 'Motivo da reprovação' : 'Observação'}
              required={reprovando}
              error={erroMover ?? undefined}
              hint="Vai como anotação no card do Kommo, assinada com o seu nome."
            >
              <Textarea
                rows={3}
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder={reprovando ? 'Por que o crédito foi reprovado?' : 'Opcional.'}
              />
            </Field>

            <p className="text-xs text-slate-500">
              A movimentação dispara as automações configuradas nesse funil do
              Kommo, e não há como suprimi-las.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
