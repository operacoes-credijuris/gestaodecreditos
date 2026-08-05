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

// ===== Análise automática do card (Judit -> due diligence -> planilha) =====
// Lê os dados do próprio card (título + notas) e roda a sequência no motor.
type ResultadoAnalise = {
  reprovado?: boolean
  motivo?: string
  relatorio_due_diligence?: string | null
  due_diligence_url?: string | null
  drive_file_url?: string | null
  drive_folder_url?: string | null
  aviso?: string | null
  erro?: string
  motivos?: string[]
  avisos?: string[]
  [k: string]: unknown
}

function lerCardCredijuris(lead: KommoLead) {
  const notas =
    lead.notas && lead.notas.length > 0
      ? lead.notas.map((n) => n.texto).join('\n')
      : (lead.nota_texto ?? '')
  const pegar = (re: RegExp) => (notas.match(re)?.[1] ?? '').trim()

  const numero = (lead.processo_cnj ?? pegar(/PROCESSO:\s*([0-9.\-]+)/i)).trim()
  const tipo = pegar(/TIPO:\s*(.+)/i)
  const categoria = /precat/i.test(tipo) ? 'Precatórios' : 'Requisições de Pequeno Valor'

  const partesTitulo = (lead.nome ?? '').split(' - ')
  const intermediador = (partesTitulo[0] ?? '').trim()
  const cedente =
    pegar(/CEDENTE:\s*(.+)/i) || (partesTitulo.length >= 2 ? partesTitulo[1].trim() : '')

  const parcela = pegar(/PARCELA CEDIDA:\s*(.+)/i).toLowerCase()
  const tipo_aquisicao =
    parcela.includes('principal') && parcela.includes('honor')
      ? 'ambos'
      : parcela.includes('honor')
        ? 'honorarios'
        : parcela.includes('principal')
          ? 'principal'
          : 'auto'

  const honMatch = notas.match(/HONOR[ÁA]RIOS?\s*C\.?:\s*([\d.,]+)\s*%/i)
  const honorarios_pct = honMatch ? honMatch[1].replace(/\./g, '').replace(',', '.') : ''

  return { numero, categoria, cedente, intermediador, tipo_aquisicao, honorarios_pct }
}

async function analisarLeadCredijuris(lead: KommoLead): Promise<ResultadoAnalise> {
  const dados = lerCardCredijuris(lead)

  // 1) Kommo: baixa o PDF anexado no card e grava no storage
  const bk = await invokeFunction<{
    pronto?: boolean
    job_id?: string
    erro?: string
    nome_arquivo?: string
  }>('buscar-kommo', { lead_id: lead.kommo_lead_id })
  if (bk.erro) throw new Error(bk.erro)
  if (!bk.pronto || !bk.job_id)
    throw new Error(
      'Não consegui pegar o PDF do card. Confira se o PDF do processo está anexado no card.',
    )

  // 2) Análise + precificação — o motor lê o PDF e gera a planilha no Drive
  const res = await invokeFunction<ResultadoAnalise>('gerar-analise-rpv', {
    job_id: bk.job_id,
    intermediador: dados.intermediador,
    numero_processo: dados.numero,
    categoria: dados.categoria,
    tipo_aquisicao: dados.tipo_aquisicao,
    honorarios_pct: dados.honorarios_pct,
  })
  return res
}

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
  onAnalisar,
  analisando,
  resultadoAnalise,
}: {
  lead: KommoLead
  acoes: AcaoTela[]
  onAcao: (l: KommoLead, a: AcaoTela) => void
  /** null = não mostrar o selo (só faz sentido na etapa de revisão). */
  analisePronta: boolean | null
  /** Destino sendo processado neste card, ou null. */
  statusEmAndamento: number | null
  onAnalisar: (l: KommoLead) => void
  analisando: boolean
  resultadoAnalise?: ResultadoAnalise
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

      {/* Análise automática Credijuris: Judit -> due diligence -> planilha */}
      <div className="mt-3">
        <Button
          size="sm"
          variant="secondary"
          icon={<FileSearch className="h-4 w-4" />}
          onClick={() => onAnalisar(lead)}
          loading={analisando}
          disabled={ocupado || analisando}
        >
          {analisando ? 'Analisando…' : 'Analisar (PDF do card)'}
        </Button>
        {resultadoAnalise && (
          <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-inset ring-slate-100">
            {resultadoAnalise.erro ? (
              <div className="text-red-700">Erro: {resultadoAnalise.erro}</div>
            ) : resultadoAnalise.reprovado && resultadoAnalise.motivo ? (
              <div className="text-red-700">
                ⛔ {resultadoAnalise.motivo}{' '}
                {resultadoAnalise.relatorio_due_diligence && (
                  <a
                    className="font-medium underline"
                    href={resultadoAnalise.relatorio_due_diligence}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver relatório
                  </a>
                )}
              </div>
            ) : resultadoAnalise.reprovado ? (
              <div className="text-red-700">
                Reprovado no Portão 1: {(resultadoAnalise.motivos ?? []).join(' ')}
              </div>
            ) : (
              <div className="text-green-700">
                ✅ Planilha gerada.{' '}
                {typeof resultadoAnalise.drive_file_url === 'string' && (
                  <a
                    className="font-medium underline"
                    href={resultadoAnalise.drive_file_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir planilha
                  </a>
                )}{' '}
                {typeof resultadoAnalise.due_diligence_url === 'string' && (
                  <a
                    className="font-medium underline"
                    href={resultadoAnalise.due_diligence_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Relatório de due diligence
                  </a>
                )}
                {resultadoAnalise.aviso && (
                  <div className="mt-1 text-amber-700">⚠️ {resultadoAnalise.aviso}</div>
                )}
              </div>
            )}
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
  // Análise automática (Judit + due diligence + planilha) por card.
  const [analisandoId, setAnalisandoId] = useState<number | null>(null)
  const [resultadoAnalise, setResultadoAnalise] = useState<Record<number, ResultadoAnalise>>({})

  async function onAnalisar(lead: KommoLead) {
    setAnalisandoId(lead.kommo_lead_id)
    try {
      const r = await analisarLeadCredijuris(lead)
      setResultadoAnalise((p) => ({ ...p, [lead.kommo_lead_id]: r }))
    } catch (e) {
      setResultadoAnalise((p) => ({
        ...p,
        [lead.kommo_lead_id]: { erro: (e as Error)?.message ?? String(e) },
      }))
    } finally {
      setAnalisandoId(null)
    }
  }

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
                onAnalisar={onAnalisar}
                analisando={analisandoId === l.kommo_lead_id}
                resultadoAnalise={resultadoAnalise[l.kommo_lead_id]}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
