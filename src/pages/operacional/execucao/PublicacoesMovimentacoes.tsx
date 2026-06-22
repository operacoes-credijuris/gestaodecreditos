import { useMemo, useState, type FormEvent } from 'react'
import {
  Plus,
  Trash2,
  Search,
  RefreshCw,
  CheckCircle2,
  Circle,
  Eye,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { publicacoesCrud } from '@/lib/queries'
import type { Publicacao, TipoPublicacao } from '@/lib/types'
import { invokeFunction } from '@/lib/functions'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
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
import { useToast } from '@/components/ui/Toast'
import { getLabel, FONTE_PUBLICACAO, TIPO_PUBLICACAO } from '@/lib/labels'
import { formatDate } from '@/lib/format'

const VAZIO: Partial<Publicacao> = {
  numero_processo: '',
  fonte: 'manual',
  tipo: 'publicacao',
  tribunal: '',
  data_publicacao: '',
  conteudo: '',
  lida: false,
  tratada: false,
}

export default function PublicacoesMovimentacoes() {
  const { useList, useCreate, useUpdate, useRemove } = publicacoesCrud
  const { data, isLoading, isError, error } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const qc = useQueryClient()

  const [busca, setBusca] = useState('')
  const [filtroFonte, setFiltroFonte] = useState('todas')
  const [filtroTrat, setFiltroTrat] = useState('todas')
  const [editing, setEditing] = useState<Partial<Publicacao> | null>(null)
  const [viewing, setViewing] = useState<Publicacao | null>(null)
  const [toDelete, setToDelete] = useState<Publicacao | null>(null)
  const [syncing, setSyncing] = useState<null | 'djen' | 'advbox'>(null)

  const lista = useMemo(() => {
    let l = data ?? []
    if (filtroFonte !== 'todas') l = l.filter((p) => p.fonte === filtroFonte)
    if (filtroTrat === 'pendentes') l = l.filter((p) => !p.tratada)
    if (filtroTrat === 'tratadas') l = l.filter((p) => p.tratada)
    if (filtroTrat === 'nao_lidas') l = l.filter((p) => !p.lida)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((p) =>
        [p.numero_processo, p.tribunal, p.conteudo]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca, filtroFonte, filtroTrat])

  const pendentes = (data ?? []).filter((p) => !p.tratada).length

  async function toggle(p: Publicacao, campo: 'lida' | 'tratada') {
    try {
      await update.mutateAsync({ id: p.id, changes: { [campo]: !p[campo] } })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function sync(servico: 'djen' | 'advbox') {
    setSyncing(servico)
    try {
      const fn = servico === 'djen' ? 'djen-consulta' : 'advbox-sync'
      const res = await invokeFunction<{ inseridos?: number; mensagem?: string }>(fn)
      await qc.invalidateQueries({ queryKey: ['publicacoes'] })
      toast.success(
        res?.mensagem ??
          `Sincronização ${servico.toUpperCase()} concluída${
            res?.inseridos != null ? ` (${res.inseridos} novos)` : ''
          }.`,
      )
    } catch (err) {
      toast.error(`Falha na sincronização ${servico.toUpperCase()}: ${(err as Error).message}`)
    } finally {
      setSyncing(null)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    try {
      const { id, created_at, ...payload } = editing as Publicacao
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Registro atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Registro cadastrado.')
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
      toast.success('Registro excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Publicações e Movimentações"
        description="Controle das publicações (DJEN) e movimentações processuais (ADVBOX)."
        actions={
          <>
            <Button
              variant="outline"
              icon={<RefreshCw className={syncing === 'djen' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
              loading={syncing === 'djen'}
              onClick={() => sync('djen')}
            >
              Sincronizar DJEN
            </Button>
            <Button
              variant="outline"
              icon={<RefreshCw className={syncing === 'advbox' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
              loading={syncing === 'advbox'}
              onClick={() => sync('advbox')}
            >
              Sincronizar ADVBOX
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...VAZIO })}>
              Manual
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por processo, tribunal, conteúdo…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            className="lg:w-44"
            value={filtroFonte}
            onChange={(e) => setFiltroFonte(e.target.value)}
          >
            <option value="todas">Todas as fontes</option>
            {Object.entries(FONTE_PUBLICACAO).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select
            className="lg:w-48"
            value={filtroTrat}
            onChange={(e) => setFiltroTrat(e.target.value)}
          >
            <option value="todas">Todas</option>
            <option value="pendentes">Pendentes (não tratadas)</option>
            <option value="nao_lidas">Não lidas</option>
            <option value="tratadas">Tratadas</option>
          </Select>
        </div>
        {pendentes > 0 && (
          <p className="mt-3 text-sm text-amber-700">
            <strong>{pendentes}</strong> registro(s) pendente(s) de tratamento.
          </p>
        )}
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum registro"
            description="Sincronize com DJEN/ADVBOX ou cadastre manualmente."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Data</TH>
                <TH>Processo</TH>
                <TH>Fonte / Tipo</TH>
                <TH>Conteúdo</TH>
                <TH className="text-center">Lida</TH>
                <TH className="text-center">Tratada</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((p) => {
                const ft = getLabel(FONTE_PUBLICACAO, p.fonte)
                const tp = getLabel(TIPO_PUBLICACAO, p.tipo)
                return (
                  <TR key={p.id} className={!p.lida ? 'bg-blue-50/40' : undefined}>
                    <TD className="whitespace-nowrap">{formatDate(p.data_publicacao)}</TD>
                    <TD className="font-medium text-slate-800">
                      {p.numero_processo || '—'}
                      <div className="text-xs font-normal text-slate-400">
                        {p.tribunal || '—'}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex flex-col gap-1">
                        <Badge tone={ft.tone}>{ft.label}</Badge>
                        <Badge tone={tp.tone}>{tp.label}</Badge>
                      </div>
                    </TD>
                    <TD className="max-w-md">
                      <p className="line-clamp-2 text-slate-600">{p.conteudo || '—'}</p>
                    </TD>
                    <TD className="text-center">
                      <button onClick={() => toggle(p, 'lida')} title="Marcar lida">
                        {p.lida ? (
                          <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-600" />
                        ) : (
                          <Circle className="mx-auto h-5 w-5 text-slate-300" />
                        )}
                      </button>
                    </TD>
                    <TD className="text-center">
                      <button onClick={() => toggle(p, 'tratada')} title="Marcar tratada">
                        {p.tratada ? (
                          <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-600" />
                        ) : (
                          <Circle className="mx-auto h-5 w-5 text-slate-300" />
                        )}
                      </button>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setViewing(p)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Ver"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(p)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Visualização */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title="Detalhe da publicação"
        size="lg"
      >
        {viewing && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={getLabel(FONTE_PUBLICACAO, viewing.fonte).tone}>
                {getLabel(FONTE_PUBLICACAO, viewing.fonte).label}
              </Badge>
              <Badge tone={getLabel(TIPO_PUBLICACAO, viewing.tipo).tone}>
                {getLabel(TIPO_PUBLICACAO, viewing.tipo).label}
              </Badge>
            </div>
            <p>
              <span className="text-slate-400">Processo:</span>{' '}
              {viewing.numero_processo || '—'}
            </p>
            <p>
              <span className="text-slate-400">Tribunal:</span> {viewing.tribunal || '—'}
            </p>
            <p>
              <span className="text-slate-400">Data:</span>{' '}
              {formatDate(viewing.data_publicacao)}
            </p>
            <div className="rounded-lg bg-slate-50 p-3 text-slate-700 whitespace-pre-wrap">
              {viewing.conteudo || '—'}
            </div>
          </div>
        )}
      </Modal>

      {/* Cadastro manual */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Registro manual"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-pub"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-pub" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número do processo">
                <Input
                  value={editing.numero_processo ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, numero_processo: e.target.value })
                  }
                />
              </Field>
              <Field label="Tribunal">
                <Input
                  value={editing.tribunal ?? ''}
                  onChange={(e) => setEditing({ ...editing, tribunal: e.target.value })}
                />
              </Field>
              <Field label="Tipo" required>
                <Select
                  value={editing.tipo ?? 'publicacao'}
                  onChange={(e) =>
                    setEditing({ ...editing, tipo: e.target.value as TipoPublicacao })
                  }
                >
                  {Object.entries(TIPO_PUBLICACAO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Data">
                <Input
                  type="date"
                  value={editing.data_publicacao ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, data_publicacao: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Conteúdo">
              <Textarea
                rows={5}
                value={editing.conteudo ?? ''}
                onChange={(e) => setEditing({ ...editing, conteudo: e.target.value })}
              />
            </Field>
            <input
              type="hidden"
              value={editing.fonte ?? 'manual'}
              readOnly
            />
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message="Excluir este registro?"
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
