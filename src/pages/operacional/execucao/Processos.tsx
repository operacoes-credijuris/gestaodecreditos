import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search, ChevronRight } from 'lucide-react'
import {
  processosCrud,
  apensosCrud,
  useUltimaMovimentacao,
} from '@/lib/queries'
import { cn } from '@/lib/cn'
import { useApensosManager } from '@/components/Apensos'
import type {
  Processo,
  StatusProcesso,
  Instrumento,
  TipoCredito,
  IndiceAtualizacao,
} from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Loading,
  ErrorState,
  EmptyState,
} from '@/components/ui/Table'
import { IconButton } from '@/components/ui/IconButton'
import { SortableTH } from '@/components/ui/SortableTH'
import { Drawer, DrawerField, DrawerSection } from '@/components/ui/Drawer'
import { DrawerHistorico } from '@/components/Movimentacoes'
import { useToast } from '@/components/ui/Toast'
import {
  getLabel,
  STATUS_PROCESSO,
  INSTRUMENTO,
  TIPO_CREDITO,
  INDICE_ATUALIZACAO,
} from '@/lib/labels'
import {
  formatBRL,
  formatBRLInput,
  formatCNJ,
  formatDate,
  hojeISO,
  mesesDepois,
  onlyDigits,
  parseBRLInput,
  vazioNull,
} from '@/lib/format'

// Separa múltiplos nº RTDPJ (digitados com "e", vírgula, ";", "/" ou quebra)
// para exibir um por linha.
function splitRtdpj(v: string): string[] {
  return v
    .split(/\s*(?:\be\b|,|;|\/|\n)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Antecedência que acende o âmbar na coluna Expectativa. Régua num só lugar:
// mudar aqui muda a cor e o texto da dica junto.
const MESES_ALERTA_EXPECTATIVA = 3

/**
 * Semáforo da expectativa de liquidação: vermelho já venceu, âmbar vence
 * dentro da janela de MESES_ALERTA_EXPECTATIVA, verde ainda tem folga.
 * Comparação por texto (ISO é ordenável) contra a data de hoje, recalculada a
 * cada render — então a cor vira sozinha na virada do dia, sem ninguém mexer
 * no cadastro.
 */
function corExpectativa(
  data: string | null | undefined,
  hoje: string,
  limiteAlerta: string,
): { classe: string; titulo?: string } {
  const d = (data ?? '').slice(0, 10)
  if (!d) return { classe: 'text-slate-600' }
  if (d < hoje) return { classe: 'font-medium text-red-600', titulo: 'Expectativa vencida' }
  if (d <= limiteAlerta) {
    return {
      classe: 'font-medium text-amber-600',
      titulo: `Vence em até ${MESES_ALERTA_EXPECTATIVA} meses`,
    }
  }
  return {
    classe: 'font-medium text-emerald-600',
    titulo: `Vence em mais de ${MESES_ALERTA_EXPECTATIVA} meses`,
  }
}

/**
 * Data de liquidação, já recebido e valor estimado complementar só existem
 * depois que o crédito começou a ser pago — ou seja, fora do status Ativo.
 * Ficam ocultos no formulário e na ficha, e o salvamento os descarta em Ativo.
 * Ponto único da regra: mudou aqui, mudou nos quatro lugares que a usam.
 */
const emLiquidacao = (status?: StatusProcesso): boolean =>
  status === 'complementar' || status === 'encerrado'

const VAZIO: Partial<Processo> = {
  numero_cnj: '',
  tribunal: '',
  comarca: '',
  vara: '',
  cedente: '',
  cedente_advogado: '',
  cessionario: '',
  entidade_devedora: '',
  data_aquisicao: '',
  expectativa_liquidacao: '',
  instrumento: null,
  numero_rtdpj: '',
  status: 'ativo',
  data_liquidacao: '',
  tipo_credito: [],
  capital_investido: null,
  valor_face: null,
  data_referencia: '',
  indice_atualizacao: null,
  ja_recebido: null,
  valor_estimado_complementar: null,
}

/**
 * Campo de dinheiro com "R$" fixo à esquerda. O valor vive como número no
 * estado; os dígitos digitados entram como centavos (ver parseBRLInput), então
 * o campo nunca aceita um formato inválido.
 */
function CampoMoeda({
  valor,
  onChange,
}: {
  valor: number | null | undefined
  onChange: (v: number | null) => void
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
        R$
      </span>
      <Input
        className="pl-9 text-right tabular-nums"
        inputMode="numeric"
        placeholder="0,00"
        value={formatBRLInput(valor)}
        onChange={(e) => onChange(parseBRLInput(e.target.value))}
      />
    </div>
  )
}

// Nº de colunas da tabela de créditos — usado no colSpan da linha de apensos.
// Atualizar ao adicionar/remover colunas para a linha continuar ocupando a largura toda.
// A tabela mostra só o essencial para escanear; a ficha completa (advogado,
// tribunal, datas de liquidação etc.) abre no Drawer ao clicar na linha.
const N_COLUNAS = 7

// Bolinha de status ao lado do nº do processo — o status por extenso é
// redundante com o filtro de pílulas acima da tabela; a cor basta.
// Só os tones que STATUS_PROCESSO produz; tone novo cai no fallback cinza.
const DOT_STATUS: Record<string, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  gray: 'bg-slate-400',
}

export default function Processos() {
  const { useList, useCreate, useUpdate, useRemove } = processosCrud
  const { data, isLoading, isError, error, refetch } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const apensos = useApensosManager('processo_id')
  const ultimaMov = useUltimaMovimentacao()

  // Referências do semáforo da coluna Expectativa. Data local (sv-SE dá o
  // formato ISO), calculada no render: no dia seguinte a régua anda sozinha.
  const hoje = useMemo(() => hojeISO(), [])
  const limiteAlerta = useMemo(
    () => mesesDepois(hoje, MESES_ALERTA_EXPECTATIVA),
    [hoje],
  )

  const [busca, setBusca] = useState('')
  // Padrão ao abrir a página: mostra apenas processos ativos.
  const [filtroStatus, setFiltroStatus] = useState('ativo')
  // Ordenação padrão: data de aquisição, do mais antigo para o mais novo.
  // ultima_movimentacao não é campo do processo — vem do cache do ADVBOX, e o
  // comparador resolve pelo mapa (ver `lista`).
  const [sortBy, setSortBy] = useState<
    'data_aquisicao' | 'expectativa_liquidacao' | 'ultima_movimentacao'
  >('data_aquisicao')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [editing, setEditing] = useState<Partial<Processo> | null>(null)
  const [toDelete, setToDelete] = useState<Processo | null>(null)
  // Crédito com a ficha aberta no painel lateral (clique na linha).
  const [detalhe, setDetalhe] = useState<Processo | null>(null)
  // Apensos do crédito em detalhe (lista de leitura na ficha).
  const todosApensos = apensosCrud.useList()
  const apensosDoDetalhe = useMemo(
    () =>
      detalhe
        ? (todosApensos.data ?? []).filter((a) => a.processo_id === detalhe.id)
        : [],
    [todosApensos.data, detalhe],
  )
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de "dirty".
  const snapshotRef = useRef('')
  const dirty = !!editing && JSON.stringify(editing) !== snapshotRef.current

  // Abre o formulário limpando erros e registrando o snapshot do estado inicial.
  function abrirForm(p: Partial<Processo>) {
    setErros({})
    snapshotRef.current = JSON.stringify(p)
    setEditing(p)
  }

  // Fecha pelo botão "Cancelar" respeitando alterações pendentes (o Modal já
  // cobre X/overlay/Escape via prop dirty).
  function fecharForm() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setEditing(null)
  }

  function toggleSort(
    col: 'data_aquisicao' | 'expectativa_liquidacao' | 'ultima_movimentacao',
  ) {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  // Busca textual (sem o filtro de status) — reaproveitada na lista e nas
  // contagens exibidas no seletor de status.
  const baseBusca = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((p) =>
        [
          p.numero_cnj,
          p.cedente,
          p.cedente_advogado,
          p.cessionario,
          p.entidade_devedora,
          p.comarca,
          p.tribunal,
          p.numero_rtdpj,
          p.instrumento ? getLabel(INSTRUMENTO, p.instrumento).label : null,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca])

  const contagemStatus = useMemo(() => {
    const c: Record<string, number> = { todos: baseBusca.length }
    for (const k of Object.keys(STATUS_PROCESSO))
      c[k] = baseBusca.filter((p) => p.status === k).length
    return c
  }, [baseBusca])

  const lista = useMemo(() => {
    let l = baseBusca
    if (filtroStatus !== 'todos') l = l.filter((p) => p.status === filtroStatus)
    const dir = sortDir === 'asc' ? 1 : -1
    // A última movimentação não está no registro: resolve pelo mapa do ADVBOX.
    // Ambos os formatos são ISO (YYYY-MM-DD...), então localeCompare ordena
    // cronologicamente como texto.
    const valor = (p: Processo) =>
      sortBy === 'ultima_movimentacao'
        ? (ultimaMov.data?.get(onlyDigits(p.numero_cnj)) ?? '')
        : (p[sortBy] || '')
    return [...l].sort((a, b) => {
      const av = valor(a)
      const bv = valor(b)
      if (!av && !bv) return 0
      if (!av) return 1 // datas vazias sempre por último
      if (!bv) return -1
      return av.localeCompare(bv) * dir
    })
  }, [baseBusca, filtroStatus, sortBy, sortDir, ultimaMov.data])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.numero_cnj?.trim()) {
      // Validação inline: erro aparece junto ao campo, sem toast.
      setErros({ numero_cnj: 'Informe o número do processo' })
      return
    }
    try {
      const { id, created_at, updated_at, advbox_lawsuit_id, ...payload } =
        editing as Processo
      // Em Ativo os três campos ficam ocultos, então são descartados.
      if (!emLiquidacao(payload.status)) {
        payload.data_liquidacao = null
        payload.ja_recebido = null
        payload.valor_estimado_complementar = null
      }
      // Nº RTDPJ só se aplica a registro público e é opcional (vazio = nulo).
      payload.numero_rtdpj =
        payload.instrumento === 'registro_publico'
          ? vazioNull(payload.numero_rtdpj)
          : null
      // Datas em branco viram null.
      payload.data_aquisicao = vazioNull(payload.data_aquisicao)
      payload.expectativa_liquidacao = vazioNull(payload.expectativa_liquidacao)
      payload.data_liquidacao = vazioNull(payload.data_liquidacao)
      payload.data_referencia = vazioNull(payload.data_referencia)
      // Sem tipo marcado o banco espera lista vazia, não null (coluna NOT NULL).
      payload.tipo_credito = payload.tipo_credito ?? []
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Crédito atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Crédito cadastrado.')
      }
      setEditing(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await remove.mutateAsync(toDelete.id)
      toast.success('Crédito excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Créditos"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
            Novo crédito
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por número, cedente, advogado, cessionário, devedora, comarca, tribunal, instrumento, RTDPJ…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Segmented
            ariaLabel="Filtrar créditos por status"
            items={[
              ...Object.entries(STATUS_PROCESSO).map(([k, v]) => ({
                key: k,
                label: v.label,
                count: contagemStatus[k] ?? 0,
              })),
              { key: 'todos', label: 'Todos', count: contagemStatus.todos },
            ]}
            value={filtroStatus}
            onChange={setFiltroStatus}
          />
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum crédito"
            description="Cadastre o primeiro crédito."
            action={
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => abrirForm({ ...VAZIO })}
              >
                Novo crédito
              </Button>
            }
          />
        ) : (
          <Table dense>
            <THead>
              <tr>
                <TH>Processo</TH>
                <TH>Entidade devedora</TH>
                <SortableTH
                  label="Aquisição"
                  active={sortBy === 'data_aquisicao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('data_aquisicao')}
                />
                <SortableTH
                  label="Expectativa"
                  active={sortBy === 'expectativa_liquidacao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('expectativa_liquidacao')}
                />
                <SortableTH
                  label="Últ. movimentação"
                  active={sortBy === 'ultima_movimentacao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('ultima_movimentacao')}
                  className="w-[1%] whitespace-nowrap"
                />
                <TH>Instrumento</TH>
                <TH className="w-[1%] whitespace-nowrap">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((p) => {
                const st = getLabel(STATUS_PROCESSO, p.status)
                const inst = getLabel(INSTRUMENTO, p.instrumento)
                const exp = corExpectativa(p.expectativa_liquidacao, hoje, limiteAlerta)
                return (
                  <Fragment key={p.id}>
                  <TR onClick={() => setDetalhe(p)}>
                    <TD className="font-medium text-slate-800">
                      <div className="flex items-start gap-2">
                        <span
                          title={st.label}
                          aria-label={`Status: ${st.label}`}
                          className={cn(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            DOT_STATUS[st.tone] ?? 'bg-slate-400',
                          )}
                        />
                        <div className="min-w-0">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="whitespace-nowrap">
                              {formatCNJ(p.numero_cnj)}
                            </span>
                            {/* Contador de apensos colado no número: pertence ao
                                processo, não à coluna de ações. */}
                            {apensos.contador(p.id)}
                          </span>
                          {/* Nomes completos: quebram em linhas em vez de truncar. */}
                          <div className="text-xs font-normal text-slate-500">
                            {p.cedente || '—'} v. {p.cessionario || '—'}
                          </div>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      {/* Devedora e comarca/vara em linhas próprias, texto completo. */}
                      <div>{p.entidade_devedora || '—'}</div>
                      <div className="text-xs text-slate-500">
                        {[p.comarca, p.vara].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums text-slate-600">
                      {formatDate(p.data_aquisicao)}
                    </TD>
                    {/* Semáforo: vencida (vermelho), dentro da janela de alerta
                        (âmbar), com folga (verde). O title mantém a informação
                        para quem não distingue as cores. */}
                    <TD className="whitespace-nowrap tabular-nums">
                      <span className={exp.classe} title={exp.titulo}>
                        {formatDate(p.expectativa_liquidacao)}
                      </span>
                    </TD>
                    {/* Puxada do cache do ADVBOX, não digitada. Enquanto o mapa
                        carrega mostra vazio em vez de "—", que seria mentira. */}
                    <TD className="whitespace-nowrap tabular-nums text-slate-600">
                      {ultimaMov.isLoading
                        ? ''
                        : formatDate(
                            ultimaMov.data?.get(onlyDigits(p.numero_cnj)) ?? null,
                          )}
                    </TD>
                    {/* Sem nowrap: nº RTDPJ longo deve quebrar em vez de
                        alargar a tabela. O Badge é inline-flex e não quebra. */}
                    <TD>
                      {p.instrumento ? (
                        <Badge tone={inst.tone}>{inst.label}</Badge>
                      ) : (
                        '—'
                      )}
                      {p.instrumento === 'registro_publico' && p.numero_rtdpj && (
                        <div className="mt-0.5 text-xs text-slate-500">
                          {splitRtdpj(p.numero_rtdpj).map((n, i) => (
                            <div key={i}>{n}</div>
                          ))}
                        </div>
                      )}
                    </TD>
                    <TD>
                      {/* stopPropagation: os botões não devem abrir a ficha da linha */}
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {apensos.actions(p.id)}
                        <IconButton
                          label="Editar"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirForm(p)}
                        />
                        <IconButton
                          label="Excluir"
                          variant="danger"
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => setToDelete(p)}
                        />
                        <ChevronRight
                          className="h-4 w-4 text-slate-300"
                          aria-hidden="true"
                        />
                      </div>
                    </TD>
                  </TR>
                  {apensos.detailRow(p.id, N_COLUNAS)}
                  </Fragment>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar crédito' : 'Novo crédito'}
        size="lg"
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={fecharForm}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-processo"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-processo" onSubmit={handleSubmit} className="space-y-4">
            <Field label="Número do processo" required error={erros.numero_cnj}>
              <Input
                value={editing.numero_cnj ?? ''}
                onChange={(e) => {
                  setEditing({ ...editing, numero_cnj: e.target.value })
                  // Digitar no campo limpa o erro de validação dele.
                  if (erros.numero_cnj) setErros({})
                }}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Tribunal">
                <Input
                  value={editing.tribunal ?? ''}
                  onChange={(e) => setEditing({ ...editing, tribunal: e.target.value })}
                />
              </Field>
              <Field label="Comarca">
                <Input
                  value={editing.comarca ?? ''}
                  onChange={(e) => setEditing({ ...editing, comarca: e.target.value })}
                />
              </Field>
              <Field label="Vara">
                <Input
                  value={editing.vara ?? ''}
                  onChange={(e) => setEditing({ ...editing, vara: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cedente">
                <Input
                  value={editing.cedente ?? ''}
                  onChange={(e) => setEditing({ ...editing, cedente: e.target.value })}
                />
              </Field>
              <Field label="Advogado do cedente">
                <Input
                  value={editing.cedente_advogado ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, cedente_advogado: e.target.value })
                  }
                />
              </Field>
              <Field label="Cessionário">
                <Input
                  value={editing.cessionario ?? ''}
                  onChange={(e) => setEditing({ ...editing, cessionario: e.target.value })}
                />
              </Field>
              <Field label="Entidade devedora">
                <Input
                  value={editing.entidade_devedora ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, entidade_devedora: e.target.value })
                  }
                />
              </Field>
              <Field label="Data de aquisição">
                <Input
                  type="date"
                  value={editing.data_aquisicao ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, data_aquisicao: e.target.value })
                  }
                />
              </Field>
              <Field label="Expectativa de liquidação">
                <Input
                  type="date"
                  value={editing.expectativa_liquidacao ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, expectativa_liquidacao: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Instrumento"
                // Avisa que o campo condicional oculto será descartado no salvamento.
                hint={
                  editing.instrumento !== 'registro_publico' &&
                  editing.numero_rtdpj?.trim()
                    ? 'Ao salvar sem "Registro público", o nº RTDPJ será descartado.'
                    : undefined
                }
              >
                <Select
                  value={editing.instrumento ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      instrumento: (e.target.value || null) as Instrumento | null,
                    })
                  }
                >
                  <option value="">Não informado</option>
                  {Object.entries(INSTRUMENTO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {editing.instrumento === 'registro_publico' && (
                <Field label="Nº RTDPJ" hint="Opcional. Para mais de um, separe por vírgula.">
                  <Input
                    value={editing.numero_rtdpj ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, numero_rtdpj: e.target.value })
                    }
                    placeholder="Número do registro no RTDPJ"
                  />
                </Field>
              )}
              <Field
                label="Status"
                required
                // Avisa que os campos condicionais ocultos serão descartados.
                hint={
                  !emLiquidacao(editing.status) &&
                  (editing.data_liquidacao ||
                    editing.ja_recebido != null ||
                    editing.valor_estimado_complementar != null)
                    ? 'Ao salvar como Ativo, a data de liquidação, o já recebido e o valor estimado complementar serão descartados.'
                    : undefined
                }
              >
                <Select
                  value={editing.status ?? 'ativo'}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      status: e.target.value as StatusProcesso,
                    })
                  }
                >
                  {Object.entries(STATUS_PROCESSO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {emLiquidacao(editing.status) && (
                <Field label="Data de liquidação">
                  <Input
                    type="date"
                    value={editing.data_liquidacao ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, data_liquidacao: e.target.value })
                    }
                  />
                </Field>
              )}
            </div>

            {/* Financeiro do crédito. Fica só aqui e na ficha lateral — de
                propósito fora da tabela, que segue enxuta para escanear. */}
            <div>
              <Field label="Tipo de crédito">
                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                  {Object.entries(TIPO_CREDITO).map(([k, v]) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={(editing.tipo_credito ?? []).includes(
                          k as TipoCredito,
                        )}
                        onChange={() => {
                          const atuais = editing.tipo_credito ?? []
                          setEditing({
                            ...editing,
                            tipo_credito: atuais.includes(k as TipoCredito)
                              ? atuais.filter((t) => t !== k)
                              : [...atuais, k as TipoCredito],
                          })
                        }}
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
              </Field>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Capital investido">
                  <CampoMoeda
                    valor={editing.capital_investido}
                    onChange={(v) => setEditing({ ...editing, capital_investido: v })}
                  />
                </Field>
                <Field label="Valor de face">
                  <CampoMoeda
                    valor={editing.valor_face}
                    onChange={(v) => setEditing({ ...editing, valor_face: v })}
                  />
                </Field>
                <Field label="Data de referência">
                  <Input
                    type="date"
                    value={editing.data_referencia ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, data_referencia: e.target.value })
                    }
                  />
                </Field>
                <Field label="Índice de atualização">
                  <Select
                    value={editing.indice_atualizacao ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        indice_atualizacao: (e.target.value ||
                          null) as IndiceAtualizacao | null,
                      })
                    }
                  >
                    <option value="">Não informado</option>
                    {Object.entries(INDICE_ATUALIZACAO).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {emLiquidacao(editing.status) && (
                  <>
                    <Field label="Já recebido">
                      <CampoMoeda
                        valor={editing.ja_recebido}
                        onChange={(v) => setEditing({ ...editing, ja_recebido: v })}
                      />
                    </Field>
                    <Field label="Valor estimado complementar">
                      <CampoMoeda
                        valor={editing.valor_estimado_complementar}
                        onChange={(v) =>
                          setEditing({ ...editing, valor_estimado_complementar: v })
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Ficha completa do crédito — abre ao clicar na linha da tabela. */}
      <Drawer
        open={!!detalhe}
        onClose={() => setDetalhe(null)}
        title={
          detalhe && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-slate-800">
                  {formatCNJ(detalhe.numero_cnj)}
                </h2>
                <Badge tone={getLabel(STATUS_PROCESSO, detalhe.status).tone}>
                  {getLabel(STATUS_PROCESSO, detalhe.status).label}
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                {detalhe.cedente || '—'} v. {detalhe.cessionario || '—'}
              </p>
            </div>
          )
        }
        // Sem footer: a ficha é só leitura. Editar e excluir ficam nos botões
        // da própria linha da tabela.
      >
        {detalhe && (
          <>
            <DrawerSection title="Partes">
              <DrawerField label="Cedente">{detalhe.cedente || '—'}</DrawerField>
              <DrawerField label="Advogado do cedente">
                {detalhe.cedente_advogado || '—'}
              </DrawerField>
              <DrawerField label="Cessionário">
                {detalhe.cessionario || '—'}
              </DrawerField>
              <DrawerField label="Entidade devedora">
                {detalhe.entidade_devedora || '—'}
              </DrawerField>
            </DrawerSection>

            <DrawerSection title="Processo">
              <DrawerField label="Tribunal">{detalhe.tribunal || '—'}</DrawerField>
              <DrawerField label="Comarca">{detalhe.comarca || '—'}</DrawerField>
              <DrawerField label="Vara">{detalhe.vara || '—'}</DrawerField>
            </DrawerSection>

            <DrawerSection title="Aquisição e liquidação">
              <DrawerField label="Instrumento">
                {detalhe.instrumento
                  ? getLabel(INSTRUMENTO, detalhe.instrumento).label
                  : '—'}
              </DrawerField>
              <DrawerField label="Nº RTDPJ">
                {detalhe.instrumento === 'registro_publico' && detalhe.numero_rtdpj
                  ? splitRtdpj(detalhe.numero_rtdpj).map((n, i) => (
                      <div key={i}>{n}</div>
                    ))
                  : '—'}
              </DrawerField>
              <DrawerField label="Data de aquisição">
                {formatDate(detalhe.data_aquisicao)}
              </DrawerField>
              <DrawerField label="Expectativa de liquidação">
                {formatDate(detalhe.expectativa_liquidacao)}
              </DrawerField>
              {emLiquidacao(detalhe.status) && (
                <DrawerField label="Data de liquidação">
                  {formatDate(detalhe.data_liquidacao)}
                </DrawerField>
              )}
              {/* Ocupa a linha inteira: são até três selos lado a lado. */}
              <div className="col-span-2">
                <DrawerField label="Tipo de crédito">
                  {detalhe.tipo_credito?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {detalhe.tipo_credito.map((t) => {
                        const l = getLabel(TIPO_CREDITO, t)
                        return (
                          <Badge key={t} tone={l.tone}>
                            {l.label}
                          </Badge>
                        )
                      })}
                    </div>
                  ) : (
                    '—'
                  )}
                </DrawerField>
              </div>
              <DrawerField label="Capital investido">
                {formatBRL(detalhe.capital_investido)}
              </DrawerField>
              <DrawerField label="Valor de face">
                {formatBRL(detalhe.valor_face)}
              </DrawerField>
              <DrawerField label="Data de referência">
                {formatDate(detalhe.data_referencia)}
              </DrawerField>
              <DrawerField label="Índice de atualização">
                {detalhe.indice_atualizacao
                  ? getLabel(INDICE_ATUALIZACAO, detalhe.indice_atualizacao).label
                  : '—'}
              </DrawerField>
              {emLiquidacao(detalhe.status) && (
                <>
                  <DrawerField label="Já recebido">
                    {formatBRL(detalhe.ja_recebido)}
                  </DrawerField>
                  <DrawerField label="Valor estimado complementar">
                    {formatBRL(detalhe.valor_estimado_complementar)}
                  </DrawerField>
                </>
              )}
            </DrawerSection>

            <DrawerSection title={`Apensos (${apensosDoDetalhe.length})`}>
              {apensosDoDetalhe.length === 0 ? (
                <p className="col-span-2 text-sm text-slate-500">
                  Nenhum apenso vinculado.
                </p>
              ) : (
                <div className="col-span-2 space-y-2">
                  {apensosDoDetalhe.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-slate-200 p-2.5"
                    >
                      <div className="text-sm font-medium text-slate-800">
                        {formatCNJ(a.numero || '')}
                      </div>
                      <div className="text-xs text-slate-500">
                        {[a.classe_processual, a.tribunal, a.comarca]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>

            {/* Histórico integral do ADVBOX — SÓ do principal. Andamento de
                apenso fica na ficha do apenso (clique no card dele): autos
                próprios, sem mistura. */}
            <DrawerHistorico numero={detalhe.numero_cnj} />
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir o crédito ${formatCNJ(toDelete?.numero_cnj)}?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />

      {apensos.modals()}
    </div>
  )
}
