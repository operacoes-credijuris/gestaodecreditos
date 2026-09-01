import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, CheckCircle2, ChevronDown, Pencil, Trash2, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { invokeFunction } from '@/lib/functions'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Segmented } from '@/components/ui/Segmented'
import { StatCard } from '@/components/ui/StatCard'
import { IconButton } from '@/components/ui/IconButton'
import { Select, Input } from '@/components/ui/Field'
import { DrawerSection } from '@/components/ui/Drawer'
import { EmptyState, Loading, Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table'
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
  situacao_id: string | null
  situacao_data: string | null
}

interface SituacaoCatalogo {
  id: string
  fase_codigo: string
  nome: string
  cor: string | null
}

/**
 * Paleta fixa pra "Situação" — a cor carrega sentido pra quem usa (ex.:
 * vermelho pode ser "atenção"), por isso é escolhida na criação, não
 * calculada. `chave` é o que fica salvo em processos_fase_situacoes_catalogo.cor.
 */
const PALETA_SITUACAO = [
  { chave: 'slate', bola: 'bg-slate-400', selecionado: 'bg-slate-100 text-slate-700' },
  { chave: 'blue', bola: 'bg-blue-500', selecionado: 'bg-blue-50 text-blue-700' },
  { chave: 'green', bola: 'bg-emerald-500', selecionado: 'bg-emerald-50 text-emerald-700' },
  { chave: 'purple', bola: 'bg-violet-500', selecionado: 'bg-violet-50 text-violet-700' },
  { chave: 'orange', bola: 'bg-orange-500', selecionado: 'bg-orange-50 text-orange-700' },
  { chave: 'red', bola: 'bg-red-500', selecionado: 'bg-red-50 text-red-700' },
  { chave: 'amber', bola: 'bg-amber-500', selecionado: 'bg-amber-50 text-amber-700' },
  { chave: 'pink', bola: 'bg-pink-500', selecionado: 'bg-pink-50 text-pink-700' },
]

function classeSelecionadaParaCor(cor: string | null): string {
  return PALETA_SITUACAO.find((c) => c.chave === cor)?.selecionado ?? ''
}

interface MovRecenteRow {
  numero_processo: string | null
  data: string | null
  conteudo: string | null
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

function useSituacoesCatalogo() {
  return useQuery({
    queryKey: ['processos_fase_situacoes_catalogo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('processos_fase_situacoes_catalogo')
        .select('id, fase_codigo, nome, cor')
        .order('nome', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as SituacaoCatalogo[]
    },
  })
}

/**
 * Criar/editar/excluir situações do catálogo — usado tanto na lista quanto na
 * gaveta, então mora num hook só em vez de duplicado nos dois.
 */
function useSituacaoMutations() {
  const qc = useQueryClient()
  const toast = useToast()

  const criarSituacao = useMutation({
    mutationFn: async (vars: { fase_codigo: string; nome: string; cor: string }) => {
      const { data, error } = await supabase
        .from('processos_fase_situacoes_catalogo')
        .insert(vars)
        .select('id, fase_codigo, nome, cor')
        .single()
      if (error) throw new Error(error.message)
      return data as SituacaoCatalogo
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processos_fase_situacoes_catalogo'] }),
    onError: (e) => toast.error((e as Error).message),
  })

  const editarSituacao = useMutation({
    mutationFn: async (vars: { id: string; nome: string; cor: string }) => {
      const { error } = await supabase
        .from('processos_fase_situacoes_catalogo')
        .update({ nome: vars.nome, cor: vars.cor })
        .eq('id', vars.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processos_fase_situacoes_catalogo'] }),
    onError: (e) => toast.error((e as Error).message),
  })

  const excluirSituacao = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('processos_fase_situacoes_catalogo').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['processos_fase_situacoes_catalogo'] })
      // Créditos que estavam com essa situação selecionada ficam com
      // situacao_id nulo (on delete set null) — refletir isso na tela.
      qc.invalidateQueries({ queryKey: ['processos_fase'], refetchType: 'all' })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return { criarSituacao, editarSituacao, excluirSituacao }
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

/**
 * Seletor de "Situação" de uma linha — combina as opções já cadastradas
 * NAQUELA fase com a possibilidade de criar uma nova ali mesmo. Escopado por
 * fase_codigo por pedido explícito: uma situação criada em "Sequestro" não
 * pode aparecer em "Alvará Expedido".
 */
function SituacaoSelect({
  situacaoIdAtual,
  opcoes,
  criando,
  onCriar,
  onDefinir,
  onEditar,
  onExcluir,
}: {
  situacaoIdAtual: string | null
  opcoes: SituacaoCatalogo[]
  criando: boolean
  onCriar: (nome: string, cor: string) => Promise<SituacaoCatalogo | undefined>
  onDefinir: (situacaoId: string | null) => void
  onEditar: (situacaoId: string, nome: string, cor: string) => void
  onExcluir: (situacaoId: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [novoAberto, setNovoAberto] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novaCor, setNovaCor] = useState(PALETA_SITUACAO[1].chave)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nomeEditado, setNomeEditado] = useState('')
  const [corEditada, setCorEditada] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const situacaoAtual = opcoes.find((o) => o.id === situacaoIdAtual) ?? null

  // Fecha tudo ao clicar fora — mesmo padrão de useCliqueFora em Combobox.tsx,
  // reimplementado aqui porque aquele hook não é exportado e este menu tem
  // mais estado interno pra zerar ao fechar (edição, criação).
  useEffect(() => {
    if (!aberto) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false)
        setNovoAberto(false)
        setEditandoId(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [aberto])

  const confirmarNovo = async () => {
    if (!novoNome.trim()) return
    const criada = await onCriar(novoNome.trim(), novaCor)
    if (criada) onDefinir(criada.id)
    setNovoAberto(false)
    setNovoNome('')
  }

  const confirmarEdicao = () => {
    if (!editandoId || !nomeEditado.trim()) return
    onEditar(editandoId, nomeEditado.trim(), corEditada)
    setEditandoId(null)
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={cn(
          'flex w-full items-center justify-between rounded-md border px-2 py-1 text-left text-xs',
          situacaoAtual ? classeSelecionadaParaCor(situacaoAtual.cor) : 'border-slate-300 bg-white text-slate-500',
        )}
      >
        <span className="truncate">{situacaoAtual?.nome ?? '—'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {aberto && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg scrollbar-thin">
          <button
            type="button"
            onClick={() => {
              onDefinir(null)
              setAberto(false)
            }}
            className="block w-full px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
          >
            — (nenhuma)
          </button>

          {opcoes.map((o) =>
            editandoId === o.id ? (
              <div key={o.id} className="space-y-1.5 border-t border-slate-100 px-2 py-1.5">
                <input
                  autoFocus
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  value={nomeEditado}
                  onChange={(e) => setNomeEditado(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditandoId(null)
                    if (e.key === 'Enter') confirmarEdicao()
                  }}
                />
                <div className="flex items-center gap-1">
                  {PALETA_SITUACAO.map((c) => (
                    <button
                      key={c.chave}
                      type="button"
                      title={c.chave}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setCorEditada(c.chave)}
                      className={cn(
                        'h-4 w-4 shrink-0 rounded-full',
                        c.bola,
                        corEditada === c.chave && 'ring-2 ring-offset-1 ring-slate-400',
                      )}
                    />
                  ))}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={confirmarEdicao}
                    disabled={!nomeEditado.trim()}
                    className="ml-1 text-xs font-medium text-brand-700 hover:underline disabled:text-slate-300"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setEditandoId(null)}
                    className="text-xs text-slate-400 hover:underline"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={o.id}
                className={cn(
                  'group flex items-center gap-1.5 px-2 py-1.5 hover:bg-slate-50',
                  o.id === situacaoIdAtual && 'bg-brand-50/60',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    onDefinir(o.id)
                    setAberto(false)
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <span
                    className={cn(
                      'h-2.5 w-2.5 shrink-0 rounded-full',
                      PALETA_SITUACAO.find((c) => c.chave === o.cor)?.bola ?? 'bg-slate-300',
                    )}
                  />
                  <span className="truncate text-xs text-slate-700">{o.nome}</span>
                </button>
                {/* opacity-0 + group-hover: os ícones só aparecem ao passar o
                    mouse na linha, pra não poluir a lista toda de lápis/lixo. */}
                <button
                  type="button"
                  title="Editar"
                  onClick={() => {
                    setEditandoId(o.id)
                    setNomeEditado(o.nome)
                    setCorEditada(o.cor ?? PALETA_SITUACAO[1].chave)
                  }}
                  className="shrink-0 text-slate-300 opacity-0 hover:text-slate-600 group-hover:opacity-100"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  title="Excluir"
                  onClick={() => onExcluir(o.id)}
                  className="shrink-0 text-slate-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ),
          )}

          <div className="border-t border-slate-100 px-2 py-1.5">
            {novoAberto ? (
              <div className="space-y-1.5">
                <input
                  autoFocus
                  disabled={criando}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="Nome da nova situação…"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setNovoAberto(false)
                      setNovoNome('')
                    }
                    if (e.key === 'Enter') void confirmarNovo()
                  }}
                />
                <div className="flex items-center gap-1">
                  {PALETA_SITUACAO.map((c) => (
                    <button
                      key={c.chave}
                      type="button"
                      title={c.chave}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setNovaCor(c.chave)}
                      className={cn(
                        'h-4 w-4 shrink-0 rounded-full',
                        c.bola,
                        novaCor === c.chave && 'ring-2 ring-offset-1 ring-slate-400',
                      )}
                    />
                  ))}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void confirmarNovo()}
                    disabled={criando || !novoNome.trim()}
                    className="ml-1 text-xs font-medium text-brand-700 hover:underline disabled:text-slate-300"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNovoAberto(true)}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                + Nova situação…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
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
  const [recentesAbertas, setRecentesAbertas] = useState(true)
  const [buscaProcesso, setBuscaProcesso] = useState('')

  const fase = useFaseData()
  const situacoes = useSituacoesCatalogo()

  const situacoesPorFase = useMemo(() => {
    const m = new Map<string, SituacaoCatalogo[]>()
    for (const s of situacoes.data ?? []) {
      const l = m.get(s.fase_codigo) ?? []
      l.push(s)
      m.set(s.fase_codigo, l)
    }
    return m
  }, [situacoes.data])

  const { criarSituacao, editarSituacao, excluirSituacao } = useSituacaoMutations()

  const definirSituacao = useMutation({
    mutationFn: (vars: { processo_id: string; situacao_id: string | null; situacao_data: string | null }) =>
      invokeFunction('fase-processual', { acao: 'definir_situacao', ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processos_fase'], refetchType: 'all' }),
    onError: (e) => toast.error((e as Error).message),
  })

  const faseDe = useMemo(() => {
    const m = new Map<string, FaseRow>()
    for (const r of fase.data ?? []) m.set(r.processo_id, r)
    return m
  }, [fase.data])

  const daTrilha = useMemo(
    () => processos.filter((p) => p.status === trilha),
    [processos, trilha],
  )

  // Busca por número — troca de trilha e abre a fase certa sozinha, e já
  // deixa a ficha aberta: o pedido era achar o processo, não navegar até ele.
  function localizarProcesso() {
    const alvo = dig(buscaProcesso)
    if (alvo.length < 4) {
      toast.error('Digite ao menos 4 dígitos do número do processo.')
      return
    }
    const encontrado = processos.find((p) => dig(p.numero_cnj).includes(alvo))
    if (!encontrado) {
      toast.error('Nenhum processo encontrado com esse número.')
      return
    }
    if (encontrado.status === 'ativo' || encontrado.status === 'complementar') {
      setTrilha(encontrado.status)
      const r = faseDe.get(encontrado.id)
      setFiltro(r ? { tipo: 'fase', codigo: r.fase_codigo } : null)
    }
    onAbrirDetalhe(encontrado)
  }

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
      qc.invalidateQueries({ queryKey: ['processos_fase'], refetchType: 'all' })
      qc.invalidateQueries({ queryKey: ['processos_fase_mudancas'] })
      toast.success('Classificação atualizada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const marcarTratado = useMutation({
    mutationFn: (vars: { processo_id: string; tratado: boolean; movimentacao_data: string }) =>
      invokeFunction('fase-processual', { acao: 'marcar_tratado', ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processos_fase'], refetchType: 'all' }),
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                className="w-full pl-8 text-sm"
                placeholder="Localizar processo pelo número…"
                value={buscaProcesso}
                onChange={(e) => setBuscaProcesso(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') localizarProcesso()
                }}
              />
            </div>
            <IconButton
              label="Atualizar fases (só quem teve movimentação nova)"
              disabled={gerar.isPending}
              onClick={() => gerar.mutate({})}
              icon={<RefreshCw className={gerar.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
            />
          </div>
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
                <Table>
                  <THead>
                    <tr>
                      <TH className="normal-case">Processo</TH>
                      <TH className="w-96 normal-case">Situação</TH>
                      <TH className="normal-case">Data da situação</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {listaFiltrada.map(({ processo, r }) => {
                      // r sempre existe aqui (listaFiltrada já descarta linha sem
                      // classificação) — o fallback é só pro TypeScript.
                      const faseDaLinha = r?.fase_codigo ?? ''
                      const opcoes = situacoesPorFase.get(faseDaLinha) ?? []
                      return (
                        <TR key={processo.id} onClick={() => onAbrirDetalhe(processo)}>
                          <TD>
                            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                              {formatCNJ(processo.numero_cnj)}
                              {r?.conclusao_pendente && (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                              )}
                            </p>
                            <p className="text-xs text-slate-500">{processo.entidade_devedora || '—'}</p>
                          </TD>
                          <TD className="w-96">
                            <SituacaoSelect
                              situacaoIdAtual={r?.situacao_id ?? null}
                              opcoes={opcoes}
                              criando={criarSituacao.isPending}
                              onCriar={(nome, cor) =>
                                criarSituacao.mutateAsync({ fase_codigo: faseDaLinha, nome, cor })
                              }
                              onDefinir={(situacaoId) =>
                                definirSituacao.mutate({
                                  processo_id: processo.id,
                                  situacao_id: situacaoId,
                                  situacao_data: r?.situacao_data ?? null,
                                })
                              }
                              onEditar={(id, nome, cor) => editarSituacao.mutate({ id, nome, cor })}
                              onExcluir={(id) => excluirSituacao.mutate(id)}
                            />
                          </TD>
                          <TD className="w-40">
                            <input
                              type="date"
                              className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                              value={r?.situacao_data ?? ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                definirSituacao.mutate({
                                  processo_id: processo.id,
                                  situacao_id: r?.situacao_id ?? null,
                                  situacao_data: e.target.value || null,
                                })
                              }
                            />
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </Card>
          )}

          <Card className="p-4">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setRecentesAbertas((v) => !v)}
              aria-expanded={recentesAbertas}
            >
              <h3 className="text-sm font-semibold text-slate-700">
                Movimentações recentes
                {recentes.porCredito.size > 0 && (
                  <span className="ml-2 text-xs font-normal text-slate-400">({recentes.porCredito.size})</span>
                )}
              </h3>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-slate-400 transition-transform',
                  recentesAbertas && 'rotate-180',
                )}
              />
            </button>
            {recentesAbertas && (
              <div className="mt-3">
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
              </div>
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
      // refetchType: 'all' (não só 'active', o padrão) — a lista de
      // Fase Processual e a gaveta usam chaves diferentes ('processos_fase' e
      // 'processos_fase', processo.id), e sem isto a gaveta atualizava mas os
      // cards da lista ficavam com o valor antigo até um F5.
      qc.invalidateQueries({ queryKey: ['processos_fase'], refetchType: 'all' })
      qc.invalidateQueries({ queryKey: ['processos_fase_mudancas'] })
      toast.success('Fase atualizada manualmente.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const situacoes = useSituacoesCatalogo()

  const { criarSituacao, editarSituacao, excluirSituacao } = useSituacaoMutations()

  const definirSituacao = useMutation({
    mutationFn: (vars: { situacao_id: string | null; situacao_data: string | null }) =>
      invokeFunction('fase-processual', { acao: 'definir_situacao', processo_id: processo.id, ...vars }),
    // Chave geral, não só ['processos_fase', processo.id]: a tabela de Fase
    // Processual lê pela chave geral, e sem isto a Situação mudava na gaveta
    // mas a coluna da tabela ficava com o valor antigo até um F5.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processos_fase'], refetchType: 'all' }),
    onError: (e) => toast.error((e as Error).message),
  })

  if (!ehFase) return null

  const ordem = processo.status === 'ativo' ? FASE_ATIVO_ORDEM : FASE_COMPLEMENTAR_ORDEM
  const r = query.data
  const opcoesSituacao = (situacoes.data ?? []).filter((s) => s.fase_codigo === r?.fase_codigo)

  return (
    <DrawerSection title="Fase processual">
      {/* Grid próprio (não o flex de antes): rótulo e caixa em colunas
          COMPARTILHADAS entre as duas linhas, então elas começam e terminam
          exatamente no mesmo lugar — sem precisar adivinhar uma largura fixa
          que quebra assim que o texto muda (foi o que aconteceu com w-56: o
          rótulo "Fase processual" ou o nome de uma fase mais longa quebravam
          linha e empurravam o card pra baixo). */}
      <div className="col-span-2 grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-2">
        <span className="whitespace-nowrap text-sm font-medium text-slate-700">Fase processual</span>
        <Select
          className="w-full border-blue-300 bg-blue-50 text-blue-700 focus:border-blue-500 focus:ring-blue-500"
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

        {r && (
          <>
            <span className="whitespace-nowrap text-sm font-medium text-slate-700">Situação</span>
            <SituacaoSelect
              situacaoIdAtual={r.situacao_id}
              opcoes={opcoesSituacao}
              criando={criarSituacao.isPending}
              onCriar={(nome, cor) => criarSituacao.mutateAsync({ fase_codigo: r.fase_codigo, nome, cor })}
              onDefinir={(situacaoId) =>
                definirSituacao.mutate({ situacao_id: situacaoId, situacao_data: r.situacao_data })
              }
              onEditar={(id, nome, cor) => editarSituacao.mutate({ id, nome, cor })}
              onExcluir={(id) => excluirSituacao.mutate(id)}
            />
          </>
        )}
      </div>
    </DrawerSection>
  )
}
