// Análise de Crédito: as cinco telas do fluxo do operacional, alimentadas pelos
// cards do kanban do Kommo (espelho local em public.kommo_leads).
//
// O comercial cria o card com os dados do crédito; o operacional analisa e
// devolve movendo de coluna. A tela de Revisão é a única sem coluna
// correspondente no Kommo — é controle interno, marcado na nossa base.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, RefreshCw, ExternalLink, ArrowRightLeft } from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import {
  FUNIL_RPV,
  TELAS,
  NOME_STATUS,
  DESTINOS,
  exigeMotivo,
  agruparPorTela,
  useKommoLeads,
  useMarcacoes,
  type TelaAnalise,
} from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
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

/**
 * O nome do card no Kommo costuma vir como "CEDENTE - NOME - CNJ". Mostrar o
 * CNJ separado já é útil; o resto do nome fica como veio, sem tentar adivinhar
 * a estrutura (ela varia entre cards).
 */
function tituloCard(lead: KommoLead): string {
  return lead.nome?.trim() || `Card ${lead.kommo_lead_id}`
}

function CardCredito({
  lead,
  onMover,
}: {
  lead: KommoLead
  onMover: (l: KommoLead) => void
}) {
  const [aberto, setAberto] = useState(false)
  const nota = lead.nota_texto?.trim()

  return (
    <div className="border-b border-slate-100 p-4 last:border-b-0 hover:bg-slate-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-800">{tituloCard(lead)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            {lead.processo_cnj && (
              <span className="whitespace-nowrap font-medium text-slate-600">
                {formatCNJ(lead.processo_cnj)}
              </span>
            )}
            <span>{NOME_STATUS[lead.status_id] ?? `coluna ${lead.status_id}`}</span>
            {lead.responsavel_nome && <span>· {lead.responsavel_nome}</span>}
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

        <div className="flex flex-none items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            icon={<ArrowRightLeft className="h-4 w-4" />}
            onClick={() => onMover(lead)}
          >
            Mover
          </Button>
          <a
            href={urlCard(lead.kommo_lead_id)}
            target="_blank"
            rel="noreferrer"
            title="Abrir card no Kommo"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* A nota do comercial vem em texto livre e o formato varia entre cards,
          então é exibida crua, recolhida por padrão para não dominar a lista. */}
      {nota && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            {aberto ? 'Ocultar dados do card' : 'Ver dados do card'}
          </button>
          {aberto && (
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              {nota}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default function AnaliseCredito() {
  const qc = useQueryClient()
  const toast = useToast()
  const leads = useKommoLeads(FUNIL_RPV)
  const marcacoes = useMarcacoes()

  const [tela, setTela] = useState<TelaAnalise>('pendentes')
  const [busca, setBusca] = useState('')
  // Card com o diálogo de movimentação aberto, e o formulário dele.
  const [movendo, setMovendo] = useState<KommoLead | null>(null)
  const [destino, setDestino] = useState<string>('')
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

  const grupos = useMemo(
    () => agruparPorTela(leads.data ?? [], marcacoes.data ?? []),
    [leads.data, marcacoes.data],
  )

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
      fecharMover()
    },
    onError: (e) => setErroMover((e as Error).message),
  })

  function abrirMover(lead: KommoLead) {
    setMovendo(lead)
    setDestino('')
    setComentario('')
    setErroMover(null)
  }

  function fecharMover() {
    setMovendo(null)
    setDestino('')
    setComentario('')
    setErroMover(null)
  }

  function confirmarMover() {
    if (!movendo) return
    const statusId = Number(destino)
    if (!statusId) {
      setErroMover('Escolha a coluna de destino.')
      return
    }
    if (exigeMotivo(statusId) && !comentario.trim()) {
      setErroMover('Informe o motivo da reprovação.')
      return
    }
    setErroMover(null)
    mover.mutate({ leadId: movendo.kommo_lead_id, statusId, comentario: comentario.trim() })
  }

  const defTela = TELAS.find((t) => t.key === tela)!
  const carregando = leads.isLoading || marcacoes.isLoading
  const erro = leads.isError || marcacoes.isError
  const mensagemErro = ((leads.error ?? marcacoes.error) as Error | null)?.message

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

      {/* Divisão por tipo de crédito. Precatórios entram na fase 2: o funil
          existe no Kommo, mas o sync ainda só traz o de RPV. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Tipo de crédito"
          items={[
            { key: 'rpv', label: 'RPV', count: (leads.data ?? []).length },
            { key: 'precatorio', label: 'Precatórios', disabled: true },
          ]}
          value="rpv"
          onChange={() => {}}
        />
        <span className="text-xs text-slate-500">
          Precatórios em breve — hoje o sync traz apenas o Funil Geral RPV.
        </span>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome do card, processo, responsável ou conteúdo…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => sync.mutate()}
            loading={sync.isPending}
          >
            Sincronizar
          </Button>
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
        {carregando ? (
          <Loading />
        ) : erro ? (
          <ErrorState
            message={mensagemErro}
            onRetry={() => {
              leads.refetch()
              marcacoes.refetch()
            }}
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
                onMover={abrirMover}
              />
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!movendo}
        onClose={fecharMover}
        title="Mover card no Kommo"
        footer={
          <>
            <Button variant="outline" onClick={fecharMover}>
              Cancelar
            </Button>
            <Button onClick={confirmarMover} loading={mover.isPending}>
              Mover
            </Button>
          </>
        }
      >
        {movendo && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-slate-800">
                {tituloCard(movendo)}
              </div>
              <div className="text-xs text-slate-500">
                Está em {NOME_STATUS[movendo.status_id] ?? `coluna ${movendo.status_id}`}
              </div>
            </div>

            <Field label="Mover para" required error={erroMover ?? undefined}>
              <Select value={destino} onChange={(e) => setDestino(e.target.value)}>
                <option value="">Escolha a coluna…</option>
                {/* Sem a coluna atual: mover para onde já está não faz nada. */}
                {DESTINOS.filter((d) => d.statusId !== movendo.status_id).map((d) => (
                  <option key={d.statusId} value={String(d.statusId)}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={exigeMotivo(Number(destino)) ? 'Motivo da reprovação' : 'Observação'}
              required={exigeMotivo(Number(destino))}
              hint="Vai como anotação no card, assinada com o seu nome."
            >
              <Textarea
                rows={3}
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder={
                  exigeMotivo(Number(destino))
                    ? 'Por que o crédito foi reprovado?'
                    : 'Opcional.'
                }
              />
            </Field>

            {/* O Kommo não registra quem fez a movimentação quando ela vem pela
                API — o histórico mostra "Integração com a Plataforma". A
                anotação é o que preserva a autoria para o comercial. */}
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
