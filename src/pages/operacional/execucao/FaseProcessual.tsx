import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, CheckCircle2, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { invokeFunction } from '@/lib/functions'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Segmented } from '@/components/ui/Segmented'
import { StatCard } from '@/components/ui/StatCard'
import { IconButton } from '@/components/ui/IconButton'
import { Select } from '@/components/ui/Field'
import { DrawerSection } from '@/components/ui/Drawer'
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
  tratado: boolean
  tratado_movimentacao_data: string | null
}

interface MovRecenteRow {
  numero_processo: string | null
  data: string | null
  conteudo: string | null
}

// Dias corridos desde uma data AAAA-MM-DD. Mesma lógica de
// PublicacoesMovimentacoes.tsx (diasDesde) — duplicada aqui de propósito, é
// uma conta de cinco linhas e não vale a pena um módulo compartilhado por isso.
function diasDesde(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

const dig = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

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

/**
 * Últimos 7 dias de movimentação, resolvidos ao crédito pela MESMA fonte e
 * MESMA lógica da aba Publicações e Movimentações (advbox_movimentacoes +
 * apensos, casamento por dígito) — não um recorte independente. É a aba que
 * já funciona e está atualizada; aqui só se decide, para cada crédito que
 * aparece nela, se a fase mudou ou permaneceu.
 */
function useMovimentacoesRecentes(processos: Processo[]) {
  const apensos = useQuery({
    queryKey: ['apensos_fase_processual'],
    queryFn: async () => {
      const { data, error } = await supabase.from('apensos').select('processo_id, numero').limit(5000)
      if (error) throw new Error(error.message)
      return (data ?? []) as { processo_id: string | null; numero: string | null }[]
    },
  })

  const movs = useQuery({
    queryKey: ['advbox_movimentacoes_recentes'],
    queryFn: async () => {
      const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('advbox_movimentacoes')
        .select('numero_processo, data, conteudo')
        .gte('data', desde)
        .order('data', { ascending: false })
        .limit(3000)
      if (error) throw new Error(error.message)
      return (data ?? []) as MovRecenteRow[]
    },
  })

  const porCredito = useMemo(() => {
    const processoPorDigitos = new Map<string, string>()
    for (const p of processos) {
      const d = dig(p.numero_cnj)
      if (d.length >= 6) processoPorDigitos.set(d, p.id)
    }
    for (const a of apensos.data ?? []) {
      if (!a.processo_id) continue
      const d = dig(a.numero)
      if (d.length >= 6 && !processoPorDigitos.has(d)) processoPorDigitos.set(d, a.processo_id)
    }
    const m = new Map<string, MovRecenteRow>()
    for (const mov of movs.data ?? []) {
      const credId = processoPorDigitos.get(dig(mov.numero_processo))
      if (!credId) continue
      const atual = m.get(credId)
      if (!atual || (mov.data ?? '') > (atual.data ?? '')) m.set(credId, mov)
    }
    return m
  }, [processos, apensos.data, movs.data])

  return { isLoading: apensos.isLoading || movs.isLoading, porCredito }
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

  const faseDe = useMemo(() => {
    const m = new Map<string, FaseRow>()
    for (const r of fase.data ?? []) m.set(r.processo_id, r)
    return m
  }, [fase.data])

  const daTrilha = useMemo(
    () => processos.filter((p) => p.status === trilha),
    [processos, trilha],
  )

  const recentes = useMovimentacoesRecentes(daTrilha)
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

  const marcarTratado = useMutation({
    mutationFn: (vars: { processo_id: string; tratado: boolean; movimentacao_data: string }) =>
      invokeFunction('fase-processual', { acao: 'marcar_tratado', ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processos_fase'] }),
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
            {recentes.isLoading ? (
              <Loading />
            ) : recentes.porCredito.size === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma movimentação nos últimos 7 dias.</p>
            ) : (
              <ul className="space-y-2">
                {daTrilha
                  .map((p) => ({ p, mov: recentes.porCredito.get(p.id), r: faseDe.get(p.id) }))
                  .filter((x): x is { p: Processo; mov: MovRecenteRow; r: FaseRow | undefined } => !!x.mov)
                  .map((x) => ({
                    ...x,
                    tratado: !!x.r?.tratado && x.r.tratado_movimentacao_data === x.mov.data,
                  }))
                  // Não tratados primeiro; dentro de cada grupo, mais recente primeiro.
                  .sort((a, b) => {
                    if (a.tratado !== b.tratado) return a.tratado ? 1 : -1
                    return (b.mov.data ?? '').localeCompare(a.mov.data ?? '')
                  })
                  .map(({ p, mov, r, tratado }) => {
                    // A fase entrou na MESMA data desta movimentação = foi ela
                    // que empurrou; caso contrário, o crédito só permaneceu.
                    const mudouDeFase = !!r && !!mov.data && r.data_entrada_fase === mov.data
                    return (
                      <li
                        key={p.id}
                        className={cn(
                          'cursor-pointer rounded-lg border border-slate-200 p-3 hover:bg-slate-50',
                          tratado && 'opacity-50',
                        )}
                        onClick={() => onAbrirDetalhe(p)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <label
                            className="flex shrink-0 items-center pt-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={tratado}
                              disabled={!mov.data}
                              onChange={(e) =>
                                mov.data &&
                                marcarTratado.mutate({
                                  processo_id: p.id,
                                  tratado: e.target.checked,
                                  movimentacao_data: mov.data,
                                })
                              }
                            />
                          </label>
                          <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                            {formatCNJ(p.numero_cnj)}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">{formatDate(mov.data)}</span>
                        </div>
                        {mov.conteudo && (
                          <p className="mt-1 line-clamp-2 text-xs italic text-slate-500">"{mov.conteudo}"</p>
                        )}
                        <div className="mt-2">
                          {r ? (
                            mudouDeFase ? (
                              <Badge tone="blue">Avançou para {getLabel(FASE_PROCESSUAL, r.fase_codigo).label}</Badge>
                            ) : (
                              <Badge tone="gray">Permaneceu em {getLabel(FASE_PROCESSUAL, r.fase_codigo).label}</Badge>
                            )
                          ) : (
                            <Badge tone="gray">Ainda não classificado</Badge>
                          )}
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
      <div className="col-span-2 flex items-center gap-3">
        <span className="text-sm font-medium text-slate-700">Fase processual</span>
        <Select
          className="w-auto border-blue-300 bg-blue-50 text-blue-700 focus:border-blue-500 focus:ring-blue-500"
          value={r?.fase_codigo ?? ''}
          disabled={query.isLoading || override.isPending}
          onChange={(e) => e.target.value && override.mutate(e.target.value)}
        >
          <option value="" disabled>
            {query.isLoading ? 'Carregando…' : 'Escolher fase…'}
          </option>
          {ordem.map((codigo) => (
            <option key={codigo} value={codigo}>
              {getLabel(FASE_PROCESSUAL, codigo).label}
            </option>
          ))}
        </Select>
      </div>
    </DrawerSection>
  )
}
