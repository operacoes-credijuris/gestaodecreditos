import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, CheckCircle2, ChevronDown, ChevronRight, Pencil, Trash2, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { invokeFunction } from '@/lib/functions'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Segmented } from '@/components/ui/Segmented'
import { IconButton } from '@/components/ui/IconButton'
import { Select, Input } from '@/components/ui/Field'
import { CaixaSuave, TituloDaSecao, TituloDoGrupo } from '@/components/operacional/Pecas'
import { EmptyState, ErrorState, Loading, Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table'
import { getLabel, FASE_PROCESSUAL, FASE_ATIVO_ORDEM, FASE_COMPLEMENTAR_ORDEM } from '@/lib/labels'
import { formatCNJ, formatDate } from '@/lib/format'
import type { Processo } from '@/lib/types'
import { LEMBRAR, useEscolhaLembrada } from '@/lib/lembrarNaTela'

const TRILHAS = ['ativo', 'complementar'] as const

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
  { chave: 'slate', bola: 'bg-tom-ardosia-ponto', selecionado: 'bg-tom-ardosia-fundo text-tom-ardosia-texto' },
  { chave: 'blue', bola: 'bg-tom-azul-ponto', selecionado: 'bg-tom-azul-fundo text-tom-azul-texto' },
  { chave: 'green', bola: 'bg-tom-esmeralda-ponto', selecionado: 'bg-tom-esmeralda-fundo text-tom-esmeralda-texto' },
  { chave: 'purple', bola: 'bg-tom-violeta-ponto', selecionado: 'bg-tom-violeta-fundo text-tom-violeta-texto' },
  { chave: 'orange', bola: 'bg-tom-laranja-ponto', selecionado: 'bg-tom-laranja-fundo text-tom-laranja-texto' },
  { chave: 'red', bola: 'bg-tom-vermelho-ponto', selecionado: 'bg-tom-vermelho-fundo text-tom-vermelho-texto' },
  { chave: 'amber', bola: 'bg-tom-ambar-ponto', selecionado: 'bg-tom-ambar-fundo text-tom-ambar-texto' },
  { chave: 'pink', bola: 'bg-tom-rosa-ponto', selecionado: 'bg-tom-rosa-fundo text-tom-rosa-texto' },
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

  return {
    isLoading: apensos.isLoading || movs.isLoading,
    // FALHA NÃO É "NENHUMA MOVIMENTAÇÃO": sem isto, consulta que falhou virava
    // "Nenhuma movimentação nos últimos 7 dias" — ou uma lista pela metade, sem os
    // créditos que só casam pelo apenso.
    isError: apensos.isError || movs.isError,
    error: (apensos.error ?? movs.error) as Error | null,
    refetch: () => {
      if (apensos.isError) void apensos.refetch()
      if (movs.isError) void movs.refetch()
    },
    porCredito,
  }
}

/**
 * Seletor de "Situação" de uma linha — combina as opções já cadastradas
 * NAQUELA fase com a possibilidade de criar uma nova ali mesmo. Escopado por
 * fase_codigo por pedido explícito: uma situação criada em "Sequestro" não
 * pode aparecer em "Alvará Expedido".
 */
function SituacaoSelect({
  nomeFase,
  situacaoIdAtual,
  opcoes,
  criando,
  onCriar,
  onDefinir,
  onEditar,
  onExcluir,
}: {
  /** O nome da fase da linha, para o cabeçalho do menu (as situações são DESTA fase). */
  nomeFase: string
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
    if (!novoNome.trim() || criando) return
    let criada: SituacaoCatalogo | undefined
    try {
      criada = await onCriar(novoNome.trim(), novaCor)
    } catch {
      // O erro já saiu no aviso da mutação; o nome digitado fica no campo para
      // tentar de novo (antes, a promessa rejeitada ficava sem tratamento).
      return
    }
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
      {/* O BOTÃO DA SITUAÇÃO (o `.sit-btn` da amostra): a bolinha na cor da
          situação e o nome em texto de leitura. A cor carrega sentido para quem
          usa, mas não fala sozinha — o nome está sempre ao lado. */}
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="true"
        title="Situação dentro da fase — clique para trocar"
        className={cn(
          'flex h-controle-sm w-full items-center justify-between gap-s2 rounded-controle border px-s2 text-left text-sm transition-colors hover:border-borda-forte',
          situacaoAtual ? classeSelecionadaParaCor(situacaoAtual.cor) : 'border-borda-controle bg-superficie text-texto-3',
        )}
      >
        <span className="flex min-w-0 items-center gap-s1.5">
          {situacaoAtual && (
            <span
              aria-hidden="true"
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                PALETA_SITUACAO.find((c) => c.chave === situacaoAtual.cor)?.bola ?? 'bg-borda-forte',
              )}
            />
          )}
          <span className="truncate">{situacaoAtual?.nome ?? '—'}</span>
        </span>
        <ChevronDown className="h-[16px] w-[16px] shrink-0" aria-hidden="true" />
      </button>

      {aberto && (
        <div className="absolute z-20 mt-s1 max-h-72 w-full overflow-auto rounded-flutuante border border-borda bg-superficie py-s1 shadow-nivel-2 scrollbar-thin dark:ring-1 dark:ring-white/[0.06]">
          {/* O CABEÇALHO DIZ DE QUAL FASE SÃO AS SITUAÇÕES (o `.ph` da amostra):
              a lista muda de fase para fase, e quem abre o menu precisa saber. */}
          <p className="px-s3 pb-s1 pt-s2 font-display text-xs font-bold uppercase tracking-[0.06em] text-texto-3">
            Situações de "{nomeFase}"
          </p>
          <button
            type="button"
            onClick={() => {
              onDefinir(null)
              setAberto(false)
            }}
            className="block w-full px-s3 py-s2 text-left text-xs text-texto-3 hover:bg-superficie-3/60"
          >
            — (nenhuma)
          </button>

          {opcoes.map((o) =>
            editandoId === o.id ? (
              <div key={o.id} className="space-y-s1.5 border-t border-borda px-s3 py-s2">
                <input
                  autoFocus
                  className="h-controle-sm w-full rounded-controle border border-borda-controle bg-superficie px-s2 text-sm text-texto focus:border-anel focus:outline-none focus:ring-[3px] focus:ring-anel/20"
                  value={nomeEditado}
                  onChange={(e) => setNomeEditado(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditandoId(null)
                    if (e.key === 'Enter') confirmarEdicao()
                  }}
                />
                <div className="flex items-center gap-s1.5">
                  {PALETA_SITUACAO.map((c) => (
                    <button
                      key={c.chave}
                      type="button"
                      title={c.chave}
                      aria-label={`Cor ${c.chave}`}
                      aria-pressed={corEditada === c.chave}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setCorEditada(c.chave)}
                      className={cn(
                        'h-[20px] w-[20px] shrink-0 rounded-full',
                        c.bola,
                        corEditada === c.chave && 'ring-2 ring-offset-1 ring-texto-3',
                      )}
                    />
                  ))}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={confirmarEdicao}
                    disabled={!nomeEditado.trim()}
                    className="ml-s1 inline-flex h-controle-sm items-center rounded-controle px-s2 text-sm font-semibold text-marca-texto hover:bg-marca-leve disabled:text-texto-3 disabled:hover:bg-transparent"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setEditandoId(null)}
                    className="inline-flex h-controle-sm items-center rounded-controle px-s2 text-sm text-texto-2 hover:bg-superficie-3"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={o.id}
                className={cn(
                  'group flex items-center gap-s1.5 px-s3 py-s0.5 hover:bg-superficie-3/60',
                  o.id === situacaoIdAtual && 'bg-marca-leve',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    onDefinir(o.id)
                    setAberto(false)
                  }}
                  className="flex min-h-controle-sm min-w-0 flex-1 items-center gap-s1.5 text-left"
                >
                  <span
                    className={cn(
                      'h-[10px] w-[10px] shrink-0 rounded-full',
                      PALETA_SITUACAO.find((c) => c.chave === o.cor)?.bola ?? 'bg-borda-forte',
                    )}
                  />
                  <span className="truncate text-xs text-texto">{o.nome}</span>
                </button>
                {/* LÁPIS E LIXEIRA SEMPRE À VISTA (como a amostra), só apagados até o
                    mouse passar na linha: escondidos, quem não passava o mouse não
                    sabia que dava para editar ou excluir. */}
                <button
                  type="button"
                  title="Editar"
                  aria-label={`Editar ${o.nome}`}
                  onClick={() => {
                    setEditandoId(o.id)
                    setNomeEditado(o.nome)
                    setCorEditada(o.cor ?? PALETA_SITUACAO[1].chave)
                  }}
                  className="grid h-controle-sm w-controle-sm shrink-0 place-items-center rounded-controle text-texto-3 opacity-60 hover:text-texto-2 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Pencil className="h-[16px] w-[16px]" />
                </button>
                <button
                  type="button"
                  title="Excluir"
                  aria-label={`Excluir ${o.nome}`}
                  onClick={() => onExcluir(o.id)}
                  className="grid h-controle-sm w-controle-sm shrink-0 place-items-center rounded-controle text-texto-3 opacity-60 hover:text-perigo focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-[16px] w-[16px]" />
                </button>
              </div>
            ),
          )}

          <div className="border-t border-borda px-s3 py-s2">
            {novoAberto ? (
              <div className="space-y-s1.5">
                <input
                  autoFocus
                  disabled={criando}
                  className="h-controle-sm w-full rounded-controle border border-borda-controle bg-superficie px-s2 text-sm text-texto focus:border-anel focus:outline-none focus:ring-[3px] focus:ring-anel/20"
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
                <div className="flex items-center gap-s1.5">
                  {PALETA_SITUACAO.map((c) => (
                    <button
                      key={c.chave}
                      type="button"
                      title={c.chave}
                      aria-label={`Cor ${c.chave}`}
                      aria-pressed={novaCor === c.chave}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setNovaCor(c.chave)}
                      className={cn(
                        'h-[20px] w-[20px] shrink-0 rounded-full',
                        c.bola,
                        novaCor === c.chave && 'ring-2 ring-offset-1 ring-texto-3',
                      )}
                    />
                  ))}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void confirmarNovo()}
                    disabled={criando || !novoNome.trim()}
                    className="ml-s1 inline-flex h-controle-sm items-center rounded-controle px-s2 text-sm font-semibold text-marca-texto hover:bg-marca-leve disabled:text-texto-3 disabled:hover:bg-transparent"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNovoAberto(true)}
                className="min-h-[24px] text-xs font-semibold text-marca-texto hover:underline"
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

/**
 * A data da situação, na linha da tabela.
 *
 * GRAVA AO SAIR DO CAMPO (ou no Enter), e não a cada mudança. O campo de data do
 * navegador dispara `change` a cada pedaço digitado com o resto já preenchido: o
 * ano "2026" digitado à mão passava por 0002, 0020 e 0202, e cada um ia ao
 * servidor numa chamada própria, em paralelo — a última a CHEGAR ganhava, e podia
 * ser a de 0202. E, como o campo mostrava o valor do servidor, ele voltava para a
 * data antiga a cada tecla, até a gravação responder.
 *
 * O valor local acompanha o do servidor enquanto o campo não está em uso; se a
 * gravação falhar (o erro já sai no aviso da mutação), volta ao do servidor.
 */
function DataDaSituacao({
  valor,
  onGravar,
}: {
  valor: string | null
  onGravar: (data: string | null) => Promise<unknown>
}) {
  const [texto, setTexto] = useState(valor ?? '')
  const emUso = useRef(false)
  /** O último valor mandado (ou o do servidor): Enter seguido de sair do campo não grava duas vezes. */
  const gravado = useRef(valor ?? '')
  useEffect(() => {
    gravado.current = valor ?? ''
    if (!emUso.current) setTexto(valor ?? '')
  }, [valor])

  const gravar = (atual: string) => {
    emUso.current = false
    if (atual === gravado.current) return
    gravado.current = atual
    onGravar(atual || null).catch(() => {
      gravado.current = valor ?? ''
      setTexto(valor ?? '')
    })
  }

  return (
    <input
      type="date"
      aria-label="Data da situação"
      className="h-controle-sm w-full rounded-controle border border-borda-controle bg-superficie px-s2 text-sm tabular-nums text-texto focus:border-anel focus:outline-none focus:ring-[3px] focus:ring-anel/20"
      value={texto}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => {
        emUso.current = true
      }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={(e) => gravar(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') gravar(e.currentTarget.value)
      }}
    />
  )
}

/**
 * O cartão de uma fase (o `.kpi.click` da amostra): o NOME INTEIRO da fase, que
 * quebra em duas linhas em vez de ser cortado ("Homologado / Aguardando Período
 * de Graça" não cabia no cartão de números da plataforma), o número e
 * "crédito(s)". Clicar escolhe a fase; o escolhido ganha o contorno da marca.
 */
function CartaoDaFase({
  rotulo,
  n,
  ativo,
  onClick,
  aviso,
}: {
  rotulo: string
  n: number
  ativo: boolean
  onClick: () => void
  /** O Concluso, que é atributo e não fase: o fundo âmbar o separa das fases. */
  aviso?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'flex h-full flex-col gap-s1 rounded-cartao border p-s4 text-left shadow-nivel-1 transition hover:border-borda-forte focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
        aviso ? 'border-aviso-borda bg-aviso-fundo' : 'border-borda bg-superficie',
        ativo && 'border-marca-viva ring-[3px] ring-marca-viva/15',
      )}
    >
      <span className="flex min-h-[32px] items-start gap-s1.5 text-xs font-medium leading-snug text-texto-2">
        {aviso && <CheckCircle2 className="mt-px h-[14px] w-[14px] shrink-0 text-aviso" aria-hidden="true" />}
        {rotulo}
      </span>
      <span className="font-display text-2xl font-bold tabular-nums leading-tight text-texto">{n}</span>
      <span className="text-xs text-texto-3">{n === 1 ? 'crédito' : 'créditos'}</span>
    </button>
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
  // A trilha escolhida fica lembrada entre visitas (lib/lembrarNaTela.ts). A fase
  // aberta não: a lista dela muda de um dia para o outro.
  const [trilha, setTrilha] = useEscolhaLembrada(LEMBRAR.faseTrilha, TRILHAS, 'ativo')
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
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['processos_fase'], refetchType: 'all' })
      qc.invalidateQueries({ queryKey: ['processos_fase_mudancas'] })
      // A função responde 200 mesmo quando parte dos créditos falhou — conta em
      // `falhas`. Sucesso só quando não houve nenhuma.
      if (r?.falhas) {
        toast.error(
          `${r.falhas} crédito(s) não puderam ser classificados; os demais foram atualizados.`,
        )
      } else {
        toast.success('Classificação atualizada.')
      }
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
    <div className="space-y-s4">
      <div className="flex flex-col gap-s2 sm:flex-row sm:items-center">
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
          <div className="flex flex-1 items-center gap-s2">
            <div className="relative flex-1">
              <Input
                className="w-full"
                aria-label="Localizar processo pelo número"
                placeholder="Localizar processo pelo número… (Enter)"
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
              icon={<RefreshCw className={gerar.isPending ? 'h-[16px] w-[16px] animate-spin' : 'h-[16px] w-[16px]'} />}
              className="grid h-controle w-controle shrink-0 place-items-center border border-borda-forte bg-superficie p-0"
            />
          </div>
      </div>

      {fase.isLoading ? (
        <Loading />
      ) : fase.isError ? (
        // SEM ISTO A FALHA VIRAVA ZERO: todas as fases com 0 crédito, que se lê
        // como "não tem nada aqui", e não como "não consegui ler".
        <ErrorState message={(fase.error as Error)?.message} onRetry={() => fase.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-s3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {ordem.map((codigo) => (
              <CartaoDaFase
                key={codigo}
                rotulo={getLabel(FASE_PROCESSUAL, codigo).label}
                n={contagem.porFase[codigo] ?? 0}
                ativo={filtro?.tipo === 'fase' && filtro.codigo === codigo}
                onClick={() => setFiltro({ tipo: 'fase', codigo })}
              />
            ))}
            {/* Concluso não é posição na esteira — card à parte, filtro sobre o
                atributo conclusao_pendente, somado à fase substantiva de cada
                processo (mesmo processo pode aparecer aqui e no card da fase). */}
            <CartaoDaFase
              rotulo="Concluso"
              n={contagem.conclusos}
              ativo={filtro?.tipo === 'concluso'}
              onClick={() => setFiltro({ tipo: 'concluso' })}
              aviso
            />
          </div>

          {contagem.semClassificacao > 0 && (
            <p className="text-xs text-texto-3">
              {contagem.semClassificacao} crédito(s) ainda sem classificação — clique em "Atualizar
              fases" (ao lado da busca) para gerar.
            </p>
          )}

          {!filtro && (
            <CaixaSuave>
              <Info className="mt-s0.5 h-[16px] w-[16px] shrink-0 text-info" aria-hidden="true" />
              Escolha uma fase acima para ver os créditos dela.
            </CaixaSuave>
          )}

          {filtro && (
            <Card className="p-0">
              {/* O nome da fase e a contagem no topo do painel (a amostra): a lista
                  diz o que está mostrando. */}
              <div className="border-b border-borda px-s5 pb-s1 pt-s4">
                <TituloDoGrupo
                  titulo={
                    filtro.tipo === 'concluso'
                      ? 'Concluso'
                      : getLabel(FASE_PROCESSUAL, filtro.codigo).label
                  }
                  qtd={listaFiltrada.length}
                />
              </div>
              {situacoes.isError ? (
                // Sem o catálogo a coluna Situação mostrava "—" em toda linha, que se
                // lê como "nenhuma situação definida", e não como "não consegui ler".
                <ErrorState message={(situacoes.error as Error)?.message} onRetry={() => situacoes.refetch()} />
              ) : listaFiltrada.length === 0 ? (
                <EmptyState title="Nada aqui" description="Nenhum crédito nesta seleção." />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Processo</TH>
                      <TH className="md:w-96">Situação</TH>
                      <TH>Data da situação</TH>
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
                            <p className="flex items-center gap-s1.5 whitespace-nowrap font-semibold tabular-nums text-texto">
                              {formatCNJ(processo.numero_cnj)}
                              {r?.conclusao_pendente && (
                                <span title="Concluso para decisão">
                                  <CheckCircle2
                                    className="h-[16px] w-[16px] shrink-0 text-aviso-cheio"
                                    aria-label="Concluso para decisão"
                                  />
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-texto-2">{processo.entidade_devedora || '—'}</p>
                          </TD>
                          <TD className="min-w-[220px] md:w-96">
                            <SituacaoSelect
                              nomeFase={getLabel(FASE_PROCESSUAL, faseDaLinha).label}
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
                            <DataDaSituacao
                              valor={r?.situacao_data ?? null}
                              onGravar={(data) =>
                                definirSituacao.mutateAsync({
                                  processo_id: processo.id,
                                  situacao_id: r?.situacao_id ?? null,
                                  situacao_data: data,
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

          <Card className="p-s4 sm:p-s5">
            <button
              type="button"
              className="flex min-h-[24px] w-full items-center justify-between text-left"
              onClick={() => setRecentesAbertas((v) => !v)}
              aria-expanded={recentesAbertas}
            >
              <h3 className="font-display text-lg font-bold tracking-tight text-texto">
                Movimentações recentes
                {/* A CONTAGEM SÓ DEPOIS DE CARREGAR: "(0)" durante a leitura
                    afirmaria que não há nada. */}
                {recentes.porCredito.size > 0 && !recentes.isError && !recentes.isLoading && (
                  <span className="ml-s2 text-sm font-semibold text-texto-3">({recentes.porCredito.size})</span>
                )}
              </h3>
              <ChevronDown
                className={cn(
                  'h-[16px] w-[16px] shrink-0 text-texto-3 transition-transform',
                  recentesAbertas && 'rotate-180',
                )}
              />
            </button>
            {recentesAbertas && (
              <div className="mt-s3">
                {recentes.isLoading ? (
              <Loading />
            ) : recentes.isError ? (
              <ErrorState message={recentes.error?.message} onRetry={recentes.refetch} />
            ) : recentes.porCredito.size === 0 ? (
              <p className="text-corpo text-texto-2">Nenhuma movimentação nos últimos 7 dias.</p>
            ) : (
              <ul className="space-y-s2">
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
                        // TRATADA ESMAECE (a amostra): continua na lista, no fim, e
                        // volta a acender sozinha quando chega movimentação nova.
                        className={cn(
                          'cursor-pointer rounded-campo border border-borda p-s3 transition-colors hover:bg-superficie-3/60',
                          tratado && 'opacity-[.55]',
                        )}
                        onClick={() => onAbrirDetalhe(p)}
                      >
                        <div className="flex items-start justify-between gap-s3">
                          <label
                            className="flex min-h-[24px] min-w-[24px] shrink-0 items-center"
                            title="Marcar como tratado"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="h-[16px] w-[16px] border-borda-forte accent-marca"
                              aria-label={`Marcar ${formatCNJ(p.numero_cnj)} como tratado`}
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
                          <span className="min-w-0 flex-1 font-semibold tabular-nums text-texto">
                            {formatCNJ(p.numero_cnj)}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-texto-3">{formatDate(mov.data)}</span>
                          {/* O CAMINHO DO TECLADO (§0.12, revisão visual 2): o cartão abre
                              ao clique, mas não recebe foco — o "›" recebe. */}
                          <IconButton
                            tamanho="linha"
                            label={`Abrir ${formatCNJ(p.numero_cnj)}`}
                            icon={<ChevronRight />}
                            className="-my-s1"
                            onClick={(e) => {
                              e.stopPropagation()
                              onAbrirDetalhe(p)
                            }}
                          />
                        </div>
                        {mov.conteudo && (
                          <p className="mt-s1 line-clamp-2 text-corpo italic text-texto-2">"{mov.conteudo}"</p>
                        )}
                        <div className="mt-s2">
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
    <section>
      <TituloDaSecao>Fase processual</TituloDaSecao>
      {/* UM CAMPO EMBAIXO DO OUTRO, NA LARGURA INTEIRA (auditoria visual, C9):
          lado a lado, o select da fase cortava o nome ("Homologado / Aguardando
          F…"). A Situação vem embaixo, e só existe com fase: crédito ainda não
          classificado pede "Escolher fase…" primeiro. */}
      <div className="grid gap-s3">
        <label className="block space-y-s1.5">
          <span className="block text-corpo font-semibold text-texto">Fase processual</span>
          <Select
          className="w-full"
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
        </label>

        {r && (
          <div className="space-y-s1.5">
            <span className="block text-corpo font-semibold text-texto">Situação</span>
            {/* Mesmo motivo da lista: catálogo que falhou não é "nenhuma situação". */}
            {situacoes.isError ? (
              <p className="text-xs text-perigo">
                Não consegui carregar as situações: {(situacoes.error as Error)?.message ?? 'erro desconhecido'}.{' '}
                <button type="button" className="underline" onClick={() => situacoes.refetch()}>
                  Tentar de novo
                </button>
              </p>
            ) : (
              <SituacaoSelect
                nomeFase={getLabel(FASE_PROCESSUAL, r.fase_codigo).label}
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
            )}
          </div>
        )}
      </div>
    </section>
  )
}
