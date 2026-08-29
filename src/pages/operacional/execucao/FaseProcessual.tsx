import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, CheckCircle2, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Segmented } from '@/components/ui/Segmented'
import { StatCard } from '@/components/ui/StatCard'
import { IconButton } from '@/components/ui/IconButton'
import { Select } from '@/components/ui/Field'
import { DrawerField, DrawerSection } from '@/components/ui/Drawer'
import { EmptyState, Loading } from '@/components/ui/Table'
import { getLabel, FASE_PROCESSUAL, FASE_ATIVO_ORDEM, FASE_COMPLEMENTAR_ORDEM } from '@/lib/labels'
import { formatCNJ, formatDate } from '@/lib/format'
import type { Processo } from '@/lib/types'

interface FaseRow {
  processo_id: string
  fase_codigo: string
  data_entrada_fase: string | null
  movimentacao_ancora_data: string | null
  movimentacao_ancora_texto: string | null
  conclusao_pendente: boolean
  conclusao_desde: string | null
  data_limite_pagamento: string | null
  erro: string | null
}

interface MudancaRow {
  id: string
  processo_id: string
  fase_anterior: string | null
  fase_nova: string
  origem: 'auto' | 'manual'
  movimentacao_ancora_data: string | null
  movimentacao_ancora_texto: string | null
  criado_em: string
}

// Dias corridos desde uma data AAAA-MM-DD. Mesma lógica de
// PublicacoesMovimentacoes.tsx (diasDesde) — duplicada aqui de propósito, é
// uma conta de cinco linhas e não vale a pena um módulo compartilhado por isso.
function diasDesde(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

function useFaseData() {
  return useQuery({
    queryKey: ['processos_fase'],
    queryFn: async () => {
      const { data, error } = await supabase.from('processos_fase').select('*').limit(5000)
      if (error) throw new Error(error.message)
      return (data ?? []) as FaseRow[]
    },
  })
}

// Últimos 7 dias da MOVIMENTAÇÃO em si (movimentacao_ancora_data), não de
// quando a classificação rodou (criado_em) — um crédito processado hoje pela
// primeira vez pode ter sua movimentação mais recente de meses atrás, e isso
// não é "recente" nenhum, mesmo saindo daqui agora.
function useMudancas() {
  return useQuery({
    queryKey: ['processos_fase_mudancas'],
    queryFn: async () => {
      const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('processos_fase_mudancas')
        .select('*')
        .gte('movimentacao_ancora_data', desde)
        .order('movimentacao_ancora_data', { ascending: false })
        .limit(200)
      if (error) throw new Error(error.message)
      return (data ?? []) as MudancaRow[]
    },
  })
}

export function FaseProcessual({
  processos,
  onAbrirDetalhe,
}: {
  processos: Processo[]
  onAbrirDetalhe: (p: Processo) => void
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const [trilha, setTrilha] = useState<'ativo' | 'complementar'>('ativo')
  const [filtro, setFiltro] = useState<{ tipo: 'fase'; codigo: string } | { tipo: 'concluso' } | null>(null)

  const fase = useFaseData()
  const mudancas = useMudancas()

  const faseDe = useMemo(() => {
    const m = new Map<string, FaseRow>()
    for (const r of fase.data ?? []) m.set(r.processo_id, r)
    return m
  }, [fase.data])

  const processoDe = useMemo(() => {
    const m = new Map<string, Processo>()
    for (const p of processos) m.set(p.id, p)
    return m
  }, [processos])

  const daTrilha = useMemo(
    () => processos.filter((p) => p.status === trilha),
    [processos, trilha],
  )
  const contagemTrilha = useMemo(() => {
    let ativo = 0
    let complementar = 0
    for (const p of processos) {
      if (p.status === 'ativo') ativo++
      else if (p.status === 'complementar') complementar++
    }
    return { ativo, complementar }
  }, [processos])

  const ordem = trilha === 'ativo' ? FASE_ATIVO_ORDEM : FASE_COMPLEMENTAR_ORDEM

  const contagem = useMemo(() => {
    const c: Record<string, number> = {}
    let semClassificacao = 0
    let conclusos = 0
    for (const p of daTrilha) {
      const r = faseDe.get(p.id)
      if (!r) {
        semClassificacao++
        continue
      }
      c[r.fase_codigo] = (c[r.fase_codigo] ?? 0) + 1
      if (r.conclusao_pendente) conclusos++
    }
    return { porFase: c, semClassificacao, conclusos }
  }, [daTrilha, faseDe])

  const listaFiltrada = useMemo(() => {
    if (!filtro) return []
    return daTrilha
      .map((p) => ({ processo: p, r: faseDe.get(p.id) }))
      .filter(({ r }) => {
        if (!r) return false
        if (filtro.tipo === 'concluso') return r.conclusao_pendente
        return r.fase_codigo === filtro.codigo
      })
      .sort((a, b) => (b.r!.data_entrada_fase ?? '').localeCompare(a.r!.data_entrada_fase ?? ''))
  }, [daTrilha, faseDe, filtro])

  const gerar = useMutation({
    mutationFn: (vars: { processo_id?: string; forcar?: boolean }) =>
      invokeFunction<{ gerados: number; pulados: number; falhas: number }>('fase-processual', vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['processos_fase'] })
      qc.invalidateQueries({ queryKey: ['processos_fase_mudancas'] })
      toast.success('Classificação atualizada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented
            ariaLabel="Trilha do crédito"
            items={[
              { key: 'ativo', label: 'Ativos', count: contagemTrilha.ativo },
              { key: 'complementar', label: 'Complementares', count: contagemTrilha.complementar },
            ]}
            value={trilha}
            onChange={(k) => {
              setTrilha(k as 'ativo' | 'complementar')
              setFiltro(null)
            }}
          />
          <IconButton
            label="Atualizar fases (só quem teve movimentação nova)"
            disabled={gerar.isPending}
            onClick={() => gerar.mutate({})}
            icon={<RefreshCw className={gerar.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
          />
        </div>
      </Card>

      {fase.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {ordem.map((codigo) => (
              <StatCard
                key={codigo}
                label={getLabel(FASE_PROCESSUAL, codigo).label}
                value={contagem.porFase[codigo] ?? 0}
                active={filtro?.tipo === 'fase' && filtro.codigo === codigo}
                onClick={() => setFiltro({ tipo: 'fase', codigo })}
              />
            ))}
            {/* Concluso não é posição na esteira — card à parte, filtro sobre o
                atributo conclusao_pendente, somado à fase substantiva de cada
                processo (mesmo processo pode aparecer aqui e no card da fase). */}
            <StatCard
              label="Concluso"
              value={contagem.conclusos}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="amber"
              active={filtro?.tipo === 'concluso'}
              onClick={() => setFiltro({ tipo: 'concluso' })}
            />
          </div>

          {contagem.semClassificacao > 0 && (
            <p className="text-sm text-slate-500">
              {contagem.semClassificacao} crédito(s) ainda sem classificação — clique em "Reclassificar
              tudo" para gerar.
            </p>
          )}

          {filtro && (
            <Card className="p-0">
              {listaFiltrada.length === 0 ? (
                <EmptyState title="Nada aqui" description="Nenhum crédito nesta seleção." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {listaFiltrada.map(({ processo, r }) => (
                    <li
                      key={processo.id}
                      className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                      onClick={() => onAbrirDetalhe(processo)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {formatCNJ(processo.numero_cnj)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {processo.entidade_devedora || '—'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                        {r?.conclusao_pendente && <Badge tone="yellow">Concluso</Badge>}
                        <span>{diasDesde(r?.data_entrada_fase ?? null)} dias na fase</span>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Movimentações recentes</h3>
            {mudancas.isLoading ? (
              <Loading />
            ) : (mudancas.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma movimentação nova nas últimas 48h.</p>
            ) : (
              <ul className="space-y-2">
                {(mudancas.data ?? []).map((m) => {
                  const p = processoDe.get(m.processo_id)
                  const mudouDeFase = m.fase_anterior !== null && m.fase_anterior !== m.fase_nova
                  return (
                    <li key={m.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm font-medium text-slate-800">
                          {p ? formatCNJ(p.numero_cnj) : m.processo_id}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {formatDate(m.movimentacao_ancora_data)}
                        </span>
                      </div>
                      {m.movimentacao_ancora_texto && (
                        <p className="mt-1 line-clamp-2 text-xs italic text-slate-500">
                          "{m.movimentacao_ancora_texto}"
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        {mudouDeFase ? (
                          <Badge tone="blue">
                            {getLabel(FASE_PROCESSUAL, m.fase_anterior!).label}
                            {' → '}
                            {getLabel(FASE_PROCESSUAL, m.fase_nova).label}
                          </Badge>
                        ) : (
                          <Badge tone="gray">Permaneceu em {getLabel(FASE_PROCESSUAL, m.fase_nova).label}</Badge>
                        )}
                        {m.origem === 'manual' && <Badge tone="purple">Manual</Badge>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

/**
 * Seção da gaveta de detalhe do crédito (a mesma gaveta da Visão Global) com a
 * fase processual e o seletor de override manual. Autocontida e busca por
 * conta própria, mesmo padrão de DrawerHistorico — não depende do estado da
 * lista acima.
 */
export function FaseDrawerSection({ processo }: { processo: Processo }) {
  const toast = useToast()
  const qc = useQueryClient()
  const ehFase = processo.status === 'ativo' || processo.status === 'complementar'

  // Hooks sempre chamados, mesmo quando o processo é encerrado (`enabled`
  // controla a busca em vez de pular o hook) — pular useQuery/useMutation
  // condicionalmente quebraria a ordem dos hooks entre renders.
  const query = useQuery({
    queryKey: ['processos_fase', processo.id],
    enabled: ehFase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('processos_fase')
        .select('*')
        .eq('processo_id', processo.id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as FaseRow | null) ?? null
    },
  })

  const override = useMutation({
    mutationFn: (fase_codigo: string) =>
      invokeFunction('fase-processual', { acao: 'override_manual', processo_id: processo.id, fase_codigo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['processos_fase'] })
      qc.invalidateQueries({ queryKey: ['processos_fase_mudancas'] })
      toast.success('Fase atualizada manualmente.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  if (!ehFase) return null

  const ordem = processo.status === 'ativo' ? FASE_ATIVO_ORDEM : FASE_COMPLEMENTAR_ORDEM
  const r = query.data

  return (
    <DrawerSection title="Fase processual">
      <DrawerField label="Fase atual">
        {query.isLoading ? (
          '…'
        ) : r ? (
          <Badge tone={getLabel(FASE_PROCESSUAL, r.fase_codigo).tone}>
            {getLabel(FASE_PROCESSUAL, r.fase_codigo).label}
          </Badge>
        ) : (
          'Ainda não classificado'
        )}
      </DrawerField>
      <DrawerField label="Reclassificar manualmente">
        <Select
          value={r?.fase_codigo ?? ''}
          disabled={override.isPending}
          onChange={(e) => e.target.value && override.mutate(e.target.value)}
        >
          <option value="" disabled>
            Escolher fase…
          </option>
          {ordem.map((codigo) => (
            <option key={codigo} value={codigo}>
              {getLabel(FASE_PROCESSUAL, codigo).label}
            </option>
          ))}
        </Select>
      </DrawerField>
      {r && (
        <>
          <DrawerField label="Desde">{formatDate(r.data_entrada_fase)}</DrawerField>
          <DrawerField label="Movimentação-âncora">
            {r.movimentacao_ancora_data ? `${formatDate(r.movimentacao_ancora_data)} — ` : ''}
            {r.movimentacao_ancora_texto || '—'}
          </DrawerField>
          {r.conclusao_pendente && (
            <DrawerField label="Concluso desde">{formatDate(r.conclusao_desde)}</DrawerField>
          )}
          {r.data_limite_pagamento && (
            <DrawerField label="Prazo de pagamento (calculado)">
              {formatDate(r.data_limite_pagamento)}
            </DrawerField>
          )}
          {r.erro && (
            <div className="col-span-2 text-xs text-red-600">Erro na última classificação: {r.erro}</div>
          )}
        </>
      )}
    </DrawerSection>
  )
}
