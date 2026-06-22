import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, FileText, Eye, Printer, Download } from 'lucide-react'
import {
  templatesCrud,
  contratosCrud,
  investidoresCrud,
  cessoesCrud,
} from '@/lib/queries'
import type {
  Contrato,
  ContratoTemplate,
  TipoContrato,
  StatusContrato,
} from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Tabs } from '@/components/ui/Tabs'
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Loading,
  EmptyState,
} from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { getLabel, TIPO_CONTRATO, STATUS_CONTRATO } from '@/lib/labels'
import { formatBRL, formatDate } from '@/lib/format'

const TABS = [
  { key: 'contratos', label: 'Contratos' },
  { key: 'modelos', label: 'Modelos' },
]

function detectarPlaceholders(texto: string): string[] {
  const re = /\{\{\s*([\w.]+)\s*\}\}/g
  const set = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) set.add(m[1])
  return [...set]
}

function renderizar(texto: string, dados: Record<string, string>): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => dados[k] ?? `____`)
}

export default function GeracaoContratos() {
  const [tab, setTab] = useState('contratos')
  return (
    <div>
      <PageHeader
        title="Geração de Contratos"
        description="Modelos de contrato com variáveis e geração de documentos."
      />
      <div className="mb-5">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>
      {tab === 'contratos' ? <ContratosPanel /> : <ModelosPanel />}
    </div>
  )
}

// ----------------------- Modelos -----------------------
const TPL_VAZIO: Partial<ContratoTemplate> = {
  nome: '',
  tipo: 'cessao',
  conteudo:
    'CONTRATO DE CESSÃO DE CRÉDITO\n\nCedente: {{investidor_nome}}\nDocumento: {{investidor_documento}}\nCrédito: {{cessao_codigo}}\nValor: {{cessao_valor}}\nData: {{data_hoje}}\n\n...',
}

function ModelosPanel() {
  const { useList, useCreate, useUpdate, useRemove } = templatesCrud
  const { data, isLoading } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<ContratoTemplate> | null>(null)
  const [toDelete, setToDelete] = useState<ContratoTemplate | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.nome?.trim()) {
      toast.error('Informe o nome do modelo.')
      return
    }
    try {
      const { id, created_at, updated_at, ...payload } = editing as ContratoTemplate
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Modelo atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Modelo criado.')
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
      toast.success('Modelo excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...TPL_VAZIO })}>
          Novo modelo
        </Button>
      </div>
      <Card>
        {isLoading ? (
          <Loading />
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            title="Nenhum modelo"
            description="Crie modelos com variáveis no formato {{variavel}}."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Modelo</TH>
                <TH>Tipo</TH>
                <TH>Variáveis</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {(data ?? []).map((t) => {
                const tp = getLabel(TIPO_CONTRATO, t.tipo)
                const vars = detectarPlaceholders(t.conteudo)
                return (
                  <TR key={t.id}>
                    <TD className="font-medium text-slate-800">{t.nome}</TD>
                    <TD>
                      <Badge tone={tp.tone}>{tp.label}</Badge>
                    </TD>
                    <TD className="text-xs text-slate-500">
                      {vars.length ? vars.join(', ') : '—'}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(t)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(t)}
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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar modelo' : 'Novo modelo'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-modelo"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-modelo" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome do modelo" required>
                <Input
                  value={editing.nome ?? ''}
                  onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                />
              </Field>
              <Field label="Tipo" required>
                <Select
                  value={editing.tipo ?? 'cessao'}
                  onChange={(e) =>
                    setEditing({ ...editing, tipo: e.target.value as TipoContrato })
                  }
                >
                  {Object.entries(TIPO_CONTRATO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Conteúdo"
              hint="Use {{variavel}} para campos dinâmicos. Ex.: {{investidor_nome}}, {{cessao_codigo}}, {{data_hoje}}."
            >
              <Textarea
                rows={12}
                className="font-mono text-xs"
                value={editing.conteudo ?? ''}
                onChange={(e) => setEditing({ ...editing, conteudo: e.target.value })}
              />
            </Field>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir o modelo "${toDelete?.nome || ''}"?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}

// ----------------------- Contratos -----------------------
function ContratosPanel() {
  const templates = templatesCrud.useList()
  const investidores = investidoresCrud.useList()
  const cessoes = cessoesCrud.useList()
  const { useList, useCreate, useUpdate, useRemove } = contratosCrud
  const { data, isLoading } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [editing, setEditing] = useState<Partial<Contrato> | null>(null)
  const [dados, setDados] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<Contrato | null>(null)
  const [toDelete, setToDelete] = useState<Contrato | null>(null)

  const templateAtual = useMemo(
    () => (templates.data ?? []).find((t) => t.id === editing?.template_id),
    [templates.data, editing?.template_id],
  )
  const placeholders = useMemo(
    () => (templateAtual ? detectarPlaceholders(templateAtual.conteudo) : []),
    [templateAtual],
  )

  function abrirNovo() {
    setDados({})
    setEditing({
      numero: `CT-${new Date().getFullYear()}-${String((data?.length ?? 0) + 1).padStart(3, '0')}`,
      tipo: 'cessao',
      status: 'rascunho',
      template_id: null,
      investidor_id: null,
      cessao_id: null,
    })
  }

  function abrirEdicao(c: Contrato) {
    setDados((c.dados as Record<string, string>) ?? {})
    setEditing(c)
  }

  function autoPreencher() {
    const inv = (investidores.data ?? []).find((i) => i.id === editing?.investidor_id)
    const ces = (cessoes.data ?? []).find((c) => c.id === editing?.cessao_id)
    const novo: Record<string, string> = { ...dados }
    const setIf = (k: string, v: string | null | undefined) => {
      if (placeholders.includes(k) && v != null) novo[k] = String(v)
    }
    setIf('investidor_nome', inv?.nome)
    setIf('investidor_documento', inv?.documento ?? '')
    setIf('investidor_email', inv?.email ?? '')
    setIf('cessao_codigo', ces?.codigo)
    setIf('cessao_valor', ces?.valor_cessao != null ? formatBRL(ces.valor_cessao) : '')
    setIf('data_hoje', new Date().toLocaleDateString('pt-BR'))
    setDados(novo)
    toast.success('Variáveis preenchidas automaticamente.')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.template_id) {
      toast.error('Selecione um modelo.')
      return
    }
    const conteudo_final = templateAtual
      ? renderizar(templateAtual.conteudo, dados)
      : ''
    try {
      const { id, created_at, updated_at, ...rest } = editing as Contrato
      const payload = { ...rest, dados, conteudo_final }
      if (!payload.investidor_id) payload.investidor_id = null
      if (!payload.cessao_id) payload.cessao_id = null
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Contrato atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Contrato gerado.')
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
      toast.success('Contrato excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  function imprimir(c: Contrato) {
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    win.document.write(
      `<html><head><title>${c.numero ?? 'Contrato'}</title>` +
        `<style>body{font-family:Georgia,serif;white-space:pre-wrap;padding:48px;line-height:1.6;color:#1e293b}</style>` +
        `</head><body>${(c.conteudo_final ?? '').replace(/</g, '&lt;')}</body></html>`,
    )
    win.document.close()
    win.focus()
    win.print()
  }

  function baixar(c: Contrato) {
    const blob = new Blob([c.conteudo_final ?? ''], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${c.numero ?? 'contrato'}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const nomeInvestidor = (id: string | null) =>
    id ? (investidores.data ?? []).find((i) => i.id === id)?.nome ?? '—' : '—'

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button icon={<FileText className="h-4 w-4" />} onClick={abrirNovo}>
          Gerar contrato
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <Loading />
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            title="Nenhum contrato"
            description="Crie modelos e gere contratos a partir deles."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Número</TH>
                <TH>Tipo</TH>
                <TH>Investidor</TH>
                <TH>Data</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {(data ?? []).map((c) => {
                const tp = getLabel(TIPO_CONTRATO, c.tipo)
                const st = getLabel(STATUS_CONTRATO, c.status)
                return (
                  <TR key={c.id}>
                    <TD className="font-medium text-slate-800">{c.numero || '—'}</TD>
                    <TD>
                      <Badge tone={tp.tone}>{tp.label}</Badge>
                    </TD>
                    <TD>{nomeInvestidor(c.investidor_id)}</TD>
                    <TD className="whitespace-nowrap">{formatDate(c.created_at)}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setViewing(c)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Visualizar"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => abrirEdicao(c)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(c)}
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

      {/* Visualização / impressão */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={`Contrato ${viewing?.numero ?? ''}`}
        size="lg"
        footer={
          viewing && (
            <>
              <Button
                variant="outline"
                icon={<Download className="h-4 w-4" />}
                onClick={() => baixar(viewing)}
              >
                Baixar
              </Button>
              <Button
                icon={<Printer className="h-4 w-4" />}
                onClick={() => imprimir(viewing)}
              >
                Imprimir / PDF
              </Button>
            </>
          )
        }
      >
        {viewing && (
          <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-serif text-sm leading-relaxed text-slate-700">
            {viewing.conteudo_final || '—'}
          </div>
        )}
      </Modal>

      {/* Criação / edição */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar contrato' : 'Gerar contrato'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-contrato"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-contrato" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número">
                <Input
                  value={editing.numero ?? ''}
                  onChange={(e) => setEditing({ ...editing, numero: e.target.value })}
                />
              </Field>
              <Field label="Modelo" required>
                <Select
                  value={editing.template_id ?? ''}
                  onChange={(e) => {
                    const t = (templates.data ?? []).find((x) => x.id === e.target.value)
                    setEditing({
                      ...editing,
                      template_id: e.target.value || null,
                      tipo: t?.tipo ?? editing.tipo,
                    })
                  }}
                >
                  <option value="">Selecione…</option>
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Investidor">
                <Select
                  value={editing.investidor_id ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, investidor_id: e.target.value || null })
                  }
                >
                  <option value="">— Nenhum —</option>
                  {(investidores.data ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cessão">
                <Select
                  value={editing.cessao_id ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, cessao_id: e.target.value || null })
                  }
                >
                  <option value="">— Nenhuma —</option>
                  {(cessoes.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" required>
                <Select
                  value={editing.status ?? 'rascunho'}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as StatusContrato })
                  }
                >
                  {Object.entries(STATUS_CONTRATO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {!templateAtual ? (
              <p className="text-sm text-slate-500">
                Selecione um modelo para preencher as variáveis.
              </p>
            ) : (
              <div className="space-y-3 rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">
                    Variáveis do modelo
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={autoPreencher}>
                    Preencher automaticamente
                  </Button>
                </div>
                {placeholders.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Este modelo não possui variáveis.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {placeholders.map((ph) => (
                      <Field key={ph} label={ph}>
                        <Input
                          value={dados[ph] ?? ''}
                          onChange={(e) =>
                            setDados((d) => ({ ...d, [ph]: e.target.value }))
                          }
                        />
                      </Field>
                    ))}
                  </div>
                )}
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500">Pré-visualização</p>
                  <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-serif text-xs text-slate-600 scrollbar-thin">
                    {renderizar(templateAtual.conteudo, dados)}
                  </div>
                </div>
              </div>
            )}
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir o contrato "${toDelete?.numero || ''}"?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
