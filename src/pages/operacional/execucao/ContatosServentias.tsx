import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search, Phone, Mail, MessageCircle } from 'lucide-react'
import { contatosCrud, processosCrud, requerimentosCrud } from '@/lib/queries'
import type { ContatoServentia } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
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

// Identificador do órgão julgador = "comarca / vara" (igual à aba Créditos).
function buildOrgao(comarca?: string | null, vara?: string | null): string {
  const c = (comarca ?? '').trim()
  const v = (vara ?? '').trim()
  if (c && v) return `${c} / ${v}`
  return c || v
}

// Exibição do órgão: "[vara] de [comarca]" (ex.: "11ª Vara Federal de Belo
// Horizonte"). Órgãos auxiliares (texto livre) ficam como digitados.
function formatOrgaoLabel(orgao: string): string {
  const parts = orgao.split(' / ')
  if (parts.length === 2) return `${parts[1]} de ${parts[0]}`
  return orgao
}

function soDigitos(v?: string | null): string {
  return (v ?? '').replace(/\D/g, '')
}

// Máscara de telefone brasileiro: (DD) XXXXX-XXXX (9 díg.) ou (DD) XXXX-XXXX (8 díg.).
function formatTelefone(v: string): string {
  const d = soDigitos(v).slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

function telefoneIncompleto(v?: string | null): boolean {
  const d = soDigitos(v)
  return d.length > 0 && d.length < 10
}

function waLink(v: string): string {
  return `https://wa.me/55${soDigitos(v)}`
}

function nn(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

interface OrgaoRow {
  key: string
  orgao: string
  tribunal: string
  tipo: 'julgador' | 'auxiliar'
  contato: ContatoServentia | null
}

// Bloco de contato (telefone, whatsapp clicável, e-mail) reaproveitado
// pela serventia e pelo gabinete.
function BlocoContato({
  telefone,
  whatsapp,
  email,
}: {
  telefone?: string | null
  whatsapp?: string | null
  email?: string | null
}) {
  if (!telefone && !whatsapp && !email) {
    return <span className="text-slate-400">—</span>
  }
  return (
    <div className="space-y-0.5">
      {telefone && (
        <div className="flex items-center gap-1.5 text-slate-700">
          <Phone className="h-3.5 w-3.5 text-slate-400" />
          {telefone}
        </div>
      )}
      {whatsapp && (
        <a
          href={waLink(whatsapp)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-emerald-600 hover:underline"
          title="Abrir conversa no WhatsApp"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {whatsapp}
        </a>
      )}
      {email && (
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Mail className="h-3.5 w-3.5 text-slate-400" />
          {email}
        </div>
      )}
    </div>
  )
}

const AUXILIAR_VAZIO: Partial<ContatoServentia> = {
  tipo: 'auxiliar',
  orgao: '',
  tribunal: '',
  serventia_telefone: '',
  serventia_whatsapp: '',
  serventia_email: '',
  gabinete_telefone: '',
  gabinete_whatsapp: '',
  gabinete_email: '',
}

export default function ContatosServentias() {
  const contatos = contatosCrud.useList()
  const processos = processosCrud.useList()
  const requerimentos = requerimentosCrud.useList()
  const create = contatosCrud.useCreate()
  const update = contatosCrud.useUpdate()
  const remove = contatosCrud.useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [editing, setEditing] = useState<Partial<ContatoServentia> | null>(null)
  const [toDelete, setToDelete] = useState<ContatoServentia | null>(null)

  const isLoading = contatos.isLoading || processos.isLoading || requerimentos.isLoading
  const isError = contatos.isError || processos.isError || requerimentos.isError
  const error = (contatos.error || processos.error || requerimentos.error) as Error | null

  const linhas = useMemo<OrgaoRow[]>(() => {
    // Separa contatos salvos: julgadores (por órgão) e auxiliares.
    const julgadorContatos = new Map<string, ContatoServentia>()
    const auxiliares: ContatoServentia[] = []
    for (const c of contatos.data ?? []) {
      if (c.tipo === 'auxiliar') auxiliares.push(c)
      else if (c.orgao) julgadorContatos.set(c.orgao, c)
    }

    // Julgadores: órgãos puxados de Créditos e Requerimentos.
    const julgMap = new Map<string, OrgaoRow>()
    const addJulgador = (orgao: string, tribunal: string) => {
      if (!orgao) return
      const ex = julgMap.get(orgao)
      if (ex) {
        if (!ex.tribunal && tribunal) ex.tribunal = tribunal
        return
      }
      julgMap.set(orgao, {
        key: `j:${orgao}`,
        orgao,
        tribunal,
        tipo: 'julgador',
        contato: julgadorContatos.get(orgao) ?? null,
      })
    }
    for (const p of processos.data ?? []) {
      addJulgador(buildOrgao(p.comarca, p.vara), (p.tribunal ?? '').trim())
    }
    for (const req of requerimentos.data ?? []) {
      addJulgador((req.orgao ?? '').trim(), (req.tribunal_entidade ?? '').trim())
    }
    // Contatos julgadores salvos cujo órgão não aparece (mais) nas origens.
    for (const [orgao, c] of julgadorContatos) {
      if (!julgMap.has(orgao)) {
        julgMap.set(orgao, { key: `j:${orgao}`, orgao, tribunal: '', tipo: 'julgador', contato: c })
      }
    }

    let l: OrgaoRow[] = [...julgMap.values()]
    // Auxiliares (cadastro manual).
    for (const c of auxiliares) {
      l.push({
        key: `a:${c.id}`,
        orgao: c.orgao ?? '',
        tribunal: c.tribunal ?? '',
        tipo: 'auxiliar',
        contato: c,
      })
    }

    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((r) =>
        [
          formatOrgaoLabel(r.orgao),
          r.tribunal,
          r.contato?.serventia_telefone,
          r.contato?.serventia_whatsapp,
          r.contato?.serventia_email,
          r.contato?.gabinete_telefone,
          r.contato?.gabinete_whatsapp,
          r.contato?.gabinete_email,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l.sort((a, b) =>
      formatOrgaoLabel(a.orgao).localeCompare(formatOrgaoLabel(b.orgao), 'pt-BR'),
    )
  }, [contatos.data, processos.data, requerimentos.data, busca])

  function abrirEdicao(row: OrgaoRow) {
    if (row.contato) {
      setEditing(row.contato)
      return
    }
    setEditing({
      tipo: 'julgador',
      orgao: row.orgao,
      serventia_telefone: '',
      serventia_whatsapp: '',
      serventia_email: '',
      gabinete_telefone: '',
      gabinete_whatsapp: '',
      gabinete_email: '',
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const auxiliar = editing.tipo === 'auxiliar'
    if (auxiliar && !editing.orgao?.trim()) {
      toast.error('Informe o órgão.')
      return
    }
    const fones = [
      editing.serventia_telefone,
      editing.serventia_whatsapp,
      editing.gabinete_telefone,
      editing.gabinete_whatsapp,
    ]
    if (fones.some(telefoneIncompleto)) {
      toast.error('Telefone incompleto. Use DDD + 8 ou 9 dígitos.')
      return
    }
    try {
      const payload = {
        tipo: editing.tipo ?? 'julgador',
        orgao: nn(editing.orgao),
        tribunal: auxiliar ? nn(editing.tribunal) : null,
        serventia_telefone: nn(editing.serventia_telefone),
        serventia_whatsapp: nn(editing.serventia_whatsapp),
        serventia_email: nn(editing.serventia_email),
        gabinete_telefone: nn(editing.gabinete_telefone),
        gabinete_whatsapp: nn(editing.gabinete_whatsapp),
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
      toast.success(
        toDelete.tipo === 'auxiliar'
          ? 'Contato auxiliar removido.'
          : 'Contatos do órgão removidos.',
      )
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const editandoAuxiliar = editing?.tipo === 'auxiliar'

  return (
    <div>
      <PageHeader
        title="Contatos"
        description="Órgãos julgadores (puxados de Créditos/Requerimentos) e auxiliares (manuais)."
        actions={
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setEditing({ ...AUXILIAR_VAZIO })}
          >
            Novo contato
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por órgão, tribunal, telefone ou e-mail…"
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
            description="Cadastre créditos/requerimentos ou adicione um contato auxiliar."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Órgão</TH>
                <TH>Tribunal</TH>
                <TH>Serventia</TH>
                <TH>Gabinete</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {linhas.map((row) => {
                const c = row.contato
                return (
                  <TR key={row.key}>
                    <TD className="font-medium text-slate-800">
                      <div className="flex items-center gap-1.5">
                        {formatOrgaoLabel(row.orgao)}
                        {row.tipo === 'auxiliar' ? (
                          <Badge tone="purple">aux.</Badge>
                        ) : (
                          <Badge tone="blue">julg.</Badge>
                        )}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-slate-600">
                      {row.tribunal || '—'}
                    </TD>
                    <TD>
                      <BlocoContato
                        telefone={c?.serventia_telefone}
                        whatsapp={c?.serventia_whatsapp}
                        email={c?.serventia_email}
                      />
                    </TD>
                    <TD>
                      <BlocoContato
                        telefone={c?.gabinete_telefone}
                        whatsapp={c?.gabinete_whatsapp}
                        email={c?.gabinete_email}
                      />
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
                            title={
                              row.tipo === 'auxiliar'
                                ? 'Excluir contato auxiliar'
                                : 'Limpar contatos do órgão'
                            }
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
        title={
          editandoAuxiliar
            ? editing?.id
              ? `Editar — ${editing?.orgao ?? ''}`
              : 'Novo contato auxiliar'
            : `Contatos — ${formatOrgaoLabel(editing?.orgao ?? '')}`
        }
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
            {editandoAuxiliar && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Órgão" required>
                  <Input
                    value={editing.orgao ?? ''}
                    onChange={(e) => setEditing({ ...editing, orgao: e.target.value })}
                    placeholder="Ex.: Cartório do 2º Ofício"
                  />
                </Field>
                <Field label="Tribunal / Entidade">
                  <Input
                    value={editing.tribunal ?? ''}
                    onChange={(e) => setEditing({ ...editing, tribunal: e.target.value })}
                  />
                </Field>
              </div>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Serventia</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Telefone">
                  <Input
                    value={editing.serventia_telefone ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        serventia_telefone: formatTelefone(e.target.value),
                      })
                    }
                    placeholder="(00) 0000-0000"
                  />
                </Field>
                <Field label="WhatsApp">
                  <Input
                    value={editing.serventia_whatsapp ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        serventia_whatsapp: formatTelefone(e.target.value),
                      })
                    }
                    placeholder="(00) 00000-0000"
                  />
                </Field>
                <Field label="E-mail" className="sm:col-span-2">
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
                <Field label="Telefone">
                  <Input
                    value={editing.gabinete_telefone ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        gabinete_telefone: formatTelefone(e.target.value),
                      })
                    }
                    placeholder="(00) 0000-0000"
                  />
                </Field>
                <Field label="WhatsApp">
                  <Input
                    value={editing.gabinete_whatsapp ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        gabinete_whatsapp: formatTelefone(e.target.value),
                      })
                    }
                    placeholder="(00) 00000-0000"
                  />
                </Field>
                <Field label="E-mail" className="sm:col-span-2">
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
        message={
          toDelete?.tipo === 'auxiliar'
            ? `Excluir o contato auxiliar "${toDelete?.orgao || ''}"?`
            : `Limpar os contatos do órgão "${formatOrgaoLabel(toDelete?.orgao ?? '')}"?`
        }
        confirmLabel={toDelete?.tipo === 'auxiliar' ? 'Excluir' : 'Limpar'}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
