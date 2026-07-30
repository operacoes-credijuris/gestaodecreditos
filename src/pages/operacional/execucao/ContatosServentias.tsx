import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { apensosCrud, contatosCrud, processosCrud, requerimentosCrud } from '@/lib/queries'
import type { ContatoServentia } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
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

// Uma linha de valor dentro da célula (opcionalmente com rótulo Serv./Gab.
// e, no caso do WhatsApp, como link clicável para o wa.me).
function LinhaValor({
  label,
  value,
  whatsapp,
}: {
  label?: string
  value: string
  whatsapp?: boolean
}) {
  return (
    <div className="flex items-baseline gap-1">
      {/* Rótulo Serv./Gab. não encolhe nem quebra; o valor ao lado é que quebra. */}
      {label && <span className="shrink-0 text-xs text-slate-500">{label}</span>}
      {whatsapp ? (
        <a
          href={waLink(value)}
          target="_blank"
          rel="noreferrer"
          className="text-emerald-600 hover:underline"
          title="Abrir conversa no WhatsApp"
        >
          {value}
        </a>
      ) : (
        <span className="text-slate-700">{value}</span>
      )}
    </div>
  )
}

// Célula de um tipo de contato (telefone, whatsapp ou e-mail). Para julgadores
// separa Serventia/Gabinete; para auxiliares mostra um valor único.
function CelulaContato({
  serventia,
  gabinete,
  tipo,
  whatsapp,
}: {
  serventia?: string | null
  gabinete?: string | null
  tipo: 'julgador' | 'auxiliar'
  whatsapp?: boolean
}) {
  if (tipo === 'auxiliar') {
    return serventia ? (
      <LinhaValor value={serventia} whatsapp={whatsapp} />
    ) : (
      <span className="text-slate-500">—</span>
    )
  }
  if (!serventia && !gabinete) return <span className="text-slate-500">—</span>
  return (
    <div className="space-y-0.5">
      {serventia && <LinhaValor label="Serv." value={serventia} whatsapp={whatsapp} />}
      {gabinete && <LinhaValor label="Gab." value={gabinete} whatsapp={whatsapp} />}
    </div>
  )
}

// Campos de texto do formulário que podem carregar erro de validação inline.
type CampoContato =
  | 'orgao'
  | 'tribunal'
  | 'serventia_telefone'
  | 'serventia_whatsapp'
  | 'gabinete_telefone'
  | 'gabinete_whatsapp'

// Telefones sujeitos à validação de completude (DDD + 8 ou 9 dígitos).
const CAMPOS_FONE = [
  'serventia_telefone',
  'serventia_whatsapp',
  'gabinete_telefone',
  'gabinete_whatsapp',
] as const

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
  const apensos = apensosCrud.useList()
  const create = contatosCrud.useCreate()
  const update = contatosCrud.useUpdate()
  const remove = contatosCrud.useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  // Filtro por tribunal — 'todos' mostra todos os órgãos.
  const [filtroTribunal, setFiltroTribunal] = useState('todos')
  const [editing, setEditing] = useState<Partial<ContatoServentia> | null>(null)
  const [toDelete, setToDelete] = useState<ContatoServentia | null>(null)
  // Erros de validação por campo (mensagens inline nos <Field>).
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de dirty.
  const snapshotRef = useRef('')

  const dirty = !!editing && JSON.stringify(editing) !== snapshotRef.current

  // Abre o formulário zerando erros e registrando o snapshot inicial.
  function abrirForm(valores: Partial<ContatoServentia>) {
    snapshotRef.current = JSON.stringify(valores)
    setErros({})
    setEditing(valores)
  }

  // Fecha pelo botão "Cancelar" respeitando alterações pendentes (o Modal já
  // cobre X/overlay/Escape via prop dirty).
  function fecharForm() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setEditing(null)
  }

  // Atualiza um campo do formulário e limpa o erro inline correspondente.
  function alterarCampo(campo: CampoContato, valor: string) {
    setEditing((atual) => (atual ? { ...atual, [campo]: valor } : atual))
    setErros((prev) => {
      if (!(campo in prev)) return prev
      const proximos = { ...prev }
      delete proximos[campo]
      return proximos
    })
  }

  const isLoading =
    contatos.isLoading || processos.isLoading || requerimentos.isLoading || apensos.isLoading
  const isError =
    contatos.isError || processos.isError || requerimentos.isError || apensos.isError
  const error = (contatos.error ||
    processos.error ||
    requerimentos.error ||
    apensos.error) as Error | null

  // Base completa (sem busca/filtro) — alimenta a lista e as opções de tribunal.
  const todasLinhas = useMemo<OrgaoRow[]>(() => {
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
    // Apensos (de créditos e requerimentos) têm comarca/vara/tribunal próprios.
    for (const a of apensos.data ?? []) {
      addJulgador(buildOrgao(a.comarca, a.vara), (a.tribunal ?? '').trim())
    }
    // Julgadores são SEMPRE derivados das origens (Créditos/Requerimentos/
    // Apensos). Se o órgão some da origem, some daqui — contato salvo órfão
    // (de um órgão que não existe mais) não aparece na lista.

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

    return l.sort((a, b) =>
      formatOrgaoLabel(a.orgao).localeCompare(formatOrgaoLabel(b.orgao), 'pt-BR'),
    )
  }, [contatos.data, processos.data, requerimentos.data, apensos.data])

  // Tribunais distintos (com contagem de órgãos) para o filtro.
  const tribunais = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of todasLinhas) {
      const t = r.tribunal.trim()
      if (!t) continue
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  }, [todasLinhas])

  const linhas = useMemo<OrgaoRow[]>(() => {
    let l = todasLinhas
    if (filtroTribunal !== 'todos') {
      l = l.filter((r) => r.tribunal.trim() === filtroTribunal)
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
    return l
  }, [todasLinhas, filtroTribunal, busca])

  function abrirEdicao(row: OrgaoRow) {
    if (row.contato) {
      abrirForm(row.contato)
      return
    }
    abrirForm({
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
    // Validação inline por campo — toast fica só para erro de rede/backend.
    const novosErros: Record<string, string> = {}
    if (auxiliar && !editing.orgao?.trim()) novosErros.orgao = 'Informe o órgão'
    if (auxiliar && !editing.tribunal?.trim()) {
      novosErros.tribunal = 'Informe o tribunal / entidade'
    }
    for (const campo of CAMPOS_FONE) {
      if (telefoneIncompleto(editing[campo])) {
        novosErros[campo] = 'Use DDD + 8 ou 9 dígitos'
      }
    }
    if (Object.keys(novosErros).length > 0) {
      setErros(novosErros)
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
        // Auxiliar não tem separação serventia/gabinete.
        gabinete_telefone: auxiliar ? null : nn(editing.gabinete_telefone),
        gabinete_whatsapp: auxiliar ? null : nn(editing.gabinete_whatsapp),
        gabinete_email: auxiliar ? null : nn(editing.gabinete_email),
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
        actions={
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => abrirForm({ ...AUXILIAR_VAZIO })}
          >
            Novo contato
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por órgão, tribunal, telefone ou e-mail…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            className="sm:w-64"
            value={filtroTribunal}
            onChange={(e) => setFiltroTribunal(e.target.value)}
            aria-label="Filtrar por tribunal"
          >
            <option value="todos">Todos os tribunais ({todasLinhas.length})</option>
            {tribunais.map(([t, n]) => (
              <option key={t} value={t}>
                {t} ({n})
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState
            message={error?.message}
            onRetry={() => {
              // Refaz as quatro consultas que alimentam a listagem.
              contatos.refetch()
              processos.refetch()
              requerimentos.refetch()
              apensos.refetch()
            }}
          />
        ) : linhas.length === 0 ? (
          <EmptyState
            title="Nenhum órgão"
            description="Cadastre créditos/requerimentos ou um contato auxiliar."
            action={
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => abrirForm({ ...AUXILIAR_VAZIO })}
              >
                Novo contato
              </Button>
            }
          />
        ) : (
          <Table dense>
            <THead>
              <tr>
                <TH>Órgão</TH>
                <TH>Tribunal</TH>
                <TH>Telefone</TH>
                <TH>WhatsApp</TH>
                <TH>E-mail</TH>
                <TH className="text-right">
                  <span className="sr-only">Ações</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {linhas.map((row) => {
                const c = row.contato
                return (
                  <TR key={row.key}>
                    <TD className="font-medium text-slate-800">
                      {/* Nome do órgão é longo: quebra em várias linhas, sem truncar. */}
                      <div>{formatOrgaoLabel(row.orgao)}</div>
                      <div className="mt-0.5">
                        {row.tipo === 'auxiliar' ? (
                          <Badge size="sm" tone="purple">
                            auxiliar
                          </Badge>
                        ) : (
                          <Badge size="sm" tone="blue">
                            julgador
                          </Badge>
                        )}
                      </div>
                    </TD>
                    <TD className="text-slate-600">{row.tribunal || '—'}</TD>
                    {/* Telefones/WhatsApp seguem sem quebra (números). */}
                    <TD className="whitespace-nowrap">
                      <CelulaContato
                        tipo={row.tipo}
                        serventia={c?.serventia_telefone}
                        gabinete={c?.gabinete_telefone}
                      />
                    </TD>
                    <TD className="whitespace-nowrap">
                      <CelulaContato
                        tipo={row.tipo}
                        serventia={c?.serventia_whatsapp}
                        gabinete={c?.gabinete_whatsapp}
                        whatsapp
                      />
                    </TD>
                    {/* E-mails longos podem quebrar em qualquer caractere. */}
                    <TD className="break-all">
                      <CelulaContato
                        tipo={row.tipo}
                        serventia={c?.serventia_email}
                        gabinete={c?.gabinete_email}
                      />
                    </TD>
                    {/* Ações: botões permanecem em linha única. */}
                    <TD className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label="Editar contatos"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirEdicao(row)}
                        />
                        {row.tipo === 'auxiliar' && c && (
                          <IconButton
                            label="Excluir contato auxiliar"
                            variant="danger"
                            icon={<Trash2 className="h-4 w-4" />}
                            onClick={() => setToDelete(c)}
                          />
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
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={fecharForm}>
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
            {editandoAuxiliar ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Órgão" required error={erros.orgao}>
                    <Input
                      value={editing.orgao ?? ''}
                      onChange={(e) => alterarCampo('orgao', e.target.value)}
                      placeholder="Ex.: Cartório do 2º Ofício"
                    />
                  </Field>
                  <Field label="Tribunal / Entidade" required error={erros.tribunal}>
                    <Input
                      value={editing.tribunal ?? ''}
                      onChange={(e) => alterarCampo('tribunal', e.target.value)}
                    />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Telefone" error={erros.serventia_telefone}>
                    <Input
                      value={editing.serventia_telefone ?? ''}
                      onChange={(e) =>
                        alterarCampo('serventia_telefone', formatTelefone(e.target.value))
                      }
                      placeholder="(00) 0000-0000"
                    />
                  </Field>
                  <Field label="WhatsApp" error={erros.serventia_whatsapp}>
                    <Input
                      value={editing.serventia_whatsapp ?? ''}
                      onChange={(e) =>
                        alterarCampo('serventia_whatsapp', formatTelefone(e.target.value))
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
              </>
            ) : (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">Serventia</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Telefone" error={erros.serventia_telefone}>
                      <Input
                        value={editing.serventia_telefone ?? ''}
                        onChange={(e) =>
                          alterarCampo('serventia_telefone', formatTelefone(e.target.value))
                        }
                        placeholder="(00) 0000-0000"
                      />
                    </Field>
                    <Field label="WhatsApp" error={erros.serventia_whatsapp}>
                      <Input
                        value={editing.serventia_whatsapp ?? ''}
                        onChange={(e) =>
                          alterarCampo('serventia_whatsapp', formatTelefone(e.target.value))
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
                    <Field label="Telefone" error={erros.gabinete_telefone}>
                      <Input
                        value={editing.gabinete_telefone ?? ''}
                        onChange={(e) =>
                          alterarCampo('gabinete_telefone', formatTelefone(e.target.value))
                        }
                        placeholder="(00) 0000-0000"
                      />
                    </Field>
                    <Field label="WhatsApp" error={erros.gabinete_whatsapp}>
                      <Input
                        value={editing.gabinete_whatsapp ?? ''}
                        onChange={(e) =>
                          alterarCampo('gabinete_whatsapp', formatTelefone(e.target.value))
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
              </>
            )}
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
