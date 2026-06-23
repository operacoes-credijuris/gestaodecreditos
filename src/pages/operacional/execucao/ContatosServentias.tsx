import { useMemo, useState, type FormEvent } from 'react'
import { Pencil, Trash2, Search, Phone, Mail } from 'lucide-react'
import { contatosCrud, processosCrud } from '@/lib/queries'
import type { ContatoServentia } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
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

// Identificador do órgão = "comarca / vara" (mesma composição da aba Créditos).
// É a chave interna que casa o contato com os créditos — não muda.
function buildOrgao(comarca?: string | null, vara?: string | null): string {
  const c = (comarca ?? '').trim()
  const v = (vara ?? '').trim()
  if (c && v) return `${c} / ${v}`
  return c || v
}

// Exibição do órgão na tela: "[vara] de [comarca]"
// (ex.: "11ª Vara Federal de Belo Horizonte"). Converte a chave interna.
function formatOrgaoLabel(orgao: string): string {
  const parts = orgao.split(' / ')
  if (parts.length === 2) return `${parts[1]} de ${parts[0]}`
  return orgao
}

interface OrgaoRow {
  orgao: string
  comarca: string
  vara: string
  contato: ContatoServentia | null
}

// '' -> null para não gravar string vazia em coluna de texto.
function nn(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

export default function ContatosServentias() {
  const contatos = contatosCrud.useList()
  const processos = processosCrud.useList()
  const create = contatosCrud.useCreate()
  const update = contatosCrud.useUpdate()
  const remove = contatosCrud.useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [editing, setEditing] = useState<Partial<ContatoServentia> | null>(null)
  const [toDelete, setToDelete] = useState<ContatoServentia | null>(null)

  const isLoading = contatos.isLoading || processos.isLoading
  const isError = contatos.isError || processos.isError
  const error = (contatos.error || processos.error) as Error | null

  const linhas = useMemo<OrgaoRow[]>(() => {
    const contatoPorOrgao = new Map<string, ContatoServentia>()
    for (const c of contatos.data ?? []) {
      if (c.orgao) contatoPorOrgao.set(c.orgao, c)
    }

    const rows = new Map<string, OrgaoRow>()
    // Órgãos puxados automaticamente da comarca/vara dos créditos.
    for (const p of processos.data ?? []) {
      const orgao = buildOrgao(p.comarca, p.vara)
      if (!orgao || rows.has(orgao)) continue
      rows.set(orgao, {
        orgao,
        comarca: (p.comarca ?? '').trim(),
        vara: (p.vara ?? '').trim(),
        contato: contatoPorOrgao.get(orgao) ?? null,
      })
    }
    // Contatos já salvos cujo órgão não aparece (mais) nos créditos.
    for (const [orgao, contato] of contatoPorOrgao) {
      if (!rows.has(orgao)) {
        rows.set(orgao, { orgao, comarca: orgao, vara: '', contato })
      }
    }

    let l = [...rows.values()]
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((r) =>
        [
          r.orgao,
          r.contato?.serventia_telefone,
          r.contato?.serventia_email,
          r.contato?.gabinete_telefone,
          r.contato?.gabinete_email,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l.sort((a, b) => a.orgao.localeCompare(b.orgao))
  }, [contatos.data, processos.data, busca])

  function abrirEdicao(row: OrgaoRow) {
    setEditing(
      row.contato ?? {
        orgao: row.orgao,
        serventia_telefone: '',
        serventia_email: '',
        gabinete_telefone: '',
        gabinete_email: '',
      },
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    try {
      const payload = {
        orgao: nn(editing.orgao),
        serventia_telefone: nn(editing.serventia_telefone),
        serventia_email: nn(editing.serventia_email),
        gabinete_telefone: nn(editing.gabinete_telefone),
        gabinete_email: nn(editing.gabinete_email),
      }
      if (editing.id) {
        await update.mutateAsync({ id: editing.id, changes: payload })
        toast.success('Contato atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Contato salvo.')
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
      toast.success('Contatos do órgão removidos.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Contatos"
        description="Contatos por órgão (comarca / vara), puxados automaticamente dos créditos."
      />

      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por órgão, telefone ou e-mail…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={error?.message} />
        ) : linhas.length === 0 ? (
          <EmptyState
            title="Nenhum órgão"
            description="Cadastre créditos com comarca/vara para que os órgãos apareçam aqui."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Órgão</TH>
                <TH>Serventia</TH>
                <TH>Gabinete</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {linhas.map((row) => {
                const c = row.contato
                return (
                  <TR key={row.orgao}>
                    <TD className="font-medium text-slate-800">
                      {formatOrgaoLabel(row.orgao)}
                    </TD>
                    <TD>
                      {c?.serventia_telefone && (
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          {c.serventia_telefone}
                        </div>
                      )}
                      {c?.serventia_email && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Mail className="h-3.5 w-3.5 text-slate-400" />
                          {c.serventia_email}
                        </div>
                      )}
                      {!c?.serventia_telefone && !c?.serventia_email && (
                        <span className="text-slate-400">—</span>
                      )}
                    </TD>
                    <TD>
                      {c?.gabinete_telefone && (
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          {c.gabinete_telefone}
                        </div>
                      )}
                      {c?.gabinete_email && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Mail className="h-3.5 w-3.5 text-slate-400" />
                          {c.gabinete_email}
                        </div>
                      )}
                      {!c?.gabinete_telefone && !c?.gabinete_email && (
                        <span className="text-slate-400">—</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => abrirEdicao(row)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Editar contatos"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {c && (
                          <button
                            onClick={() => setToDelete(c)}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                            title="Limpar contatos do órgão"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
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
        title={`Contatos — ${formatOrgaoLabel(editing?.orgao ?? '')}`}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-contato"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-contato" onSubmit={handleSubmit} className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Serventia</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="WhatsApp">
                  <Input
                    value={editing.serventia_telefone ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, serventia_telefone: e.target.value })
                    }
                    placeholder="(00) 00000-0000"
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    type="email"
                    value={editing.serventia_email ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, serventia_email: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Gabinete</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="WhatsApp">
                  <Input
                    value={editing.gabinete_telefone ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, gabinete_telefone: e.target.value })
                    }
                    placeholder="(00) 00000-0000"
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    type="email"
                    value={editing.gabinete_email ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, gabinete_email: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Limpar os contatos do órgão "${toDelete?.orgao || ''}"?`}
        confirmLabel="Limpar"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
