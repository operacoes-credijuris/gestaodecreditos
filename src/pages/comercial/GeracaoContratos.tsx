import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, FileText, Eye, Printer, Download, Upload, X, ExternalLink } from 'lucide-react'
import {
  templatesCrud,
  contratosCrud,
  investidoresCrud,
  cessoesCrud,
  useInvestidorDados,
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
import { IconButton } from '@/components/ui/IconButton'
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
import { getLabel, TIPO_CONTRATO, STATUS_CONTRATO } from '@/lib/labels'
import { formatBRL, formatDate } from '@/lib/format'
import { invokeFunction } from '@/lib/functions'
import { supabase } from '@/lib/supabase'

const TABS = [
  { key: 'gerar', label: 'Gerar contrato' },
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

// Normaliza string vazia (ou só espaços) para null — campos opcionais do payload.
const vazioNull = (s?: string | null) => (s?.trim() ? s.trim() : null)

export default function GeracaoContratos() {
  const [tab, setTab] = useState('gerar')
  return (
    <div>
      <PageHeader title="Geração de Contratos" />
      <div className="mb-5">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>
      {tab === 'gerar' ? (
        <GerarPanel />
      ) : tab === 'contratos' ? (
        <ContratosPanel />
      ) : (
        <ModelosPanel />
      )}
    </div>
  )
}

// ----------------------- Gerar (docx real, via Drive) -----------------------
//
// Portado de controledecessoes: sobe os documentos do cedente/escritório pro
// Storage, chama a Edge Function gerar-contrato (que extrai os dados via
// Claude, preenche os .docx e sobe no Drive) e mostra o link da pasta. O
// browser nunca monta o .docx — só recebe URLs de volta.
const CATEGORIAS = ['Requisições de Pequeno Valor', 'Precatórios'] as const
const TIPOS_GERACAO = [
  'cessao_credito',
  'cessao_honorarios_contratuais',
  'cessao_honorarios_sucumbenciais',
  'intermediacao',
  'procuracao',
] as const

type Papel = 'cedente' | 'escritorio'
type ResultadoGeracao = {
  tipos_gerados: string[]
  drive_folder_url: string
  pendentes: string[]
  originador_criado: string | null
}

// Storage rejeita nome de arquivo acentuado — mesma sanitização do app de origem.
function nomeArquivoSeguro(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\-()]/g, '_')
}

function GerarPanel() {
  const toast = useToast()
  const investidorDados = useInvestidorDados()
  const investidores = useMemo(
    () => [...(investidorDados.data?.values() ?? [])].filter((v) => v.tipo === 'investidor'),
    [investidorDados.data],
  )

  const [jobId, setJobId] = useState(() => crypto.randomUUID())
  const [investidorNome, setInvestidorNome] = useState('')
  const [categoria, setCategoria] = useState<(typeof CATEGORIAS)[number]>(CATEGORIAS[0])
  const [originadores, setOriginadores] = useState<string[]>([])
  const [carregandoOriginadores, setCarregandoOriginadores] = useState(false)
  const [originador, setOriginador] = useState('')
  const [numeroProcesso, setNumeroProcesso] = useState('')
  const [cedenteGenero, setCedenteGenero] = useState<'M' | 'F'>('M')
  const [socioGenero, setSocioGenero] = useState<'M' | 'F'>('M')
  const [tiposAuto, setTiposAuto] = useState(true)
  const [tiposEscolhidos, setTiposEscolhidos] = useState<Set<string>>(new Set())
  const [uploads, setUploads] = useState<Record<Papel, File[]>>({ cedente: [], escritorio: [] })
  const [enviando, setEnviando] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [resultado, setResultado] = useState<ResultadoGeracao | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // Recarrega a lista de originadores (pastas em Drive) sempre que a categoria muda.
  useEffect(() => {
    let cancelado = false
    setCarregandoOriginadores(true)
    setOriginador('')
    invokeFunction<{ originadores: string[] }>('gerar-contrato', {
      acao: 'listar_originadores',
      categoria,
    })
      .then((r) => {
        if (!cancelado) setOriginadores(r.originadores ?? [])
      })
      .catch((e) => {
        if (!cancelado) toast.error((e as Error).message)
      })
      .finally(() => {
        if (!cancelado) setCarregandoOriginadores(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria])

  function adicionarArquivos(papel: Papel, lista: FileList | null) {
    if (!lista || lista.length === 0) return
    setUploads((u) => ({ ...u, [papel]: [...u[papel], ...Array.from(lista)] }))
  }

  function removerArquivo(papel: Papel, idx: number) {
    setUploads((u) => ({ ...u, [papel]: u[papel].filter((_, i) => i !== idx) }))
  }

  function alternarTipo(tipo: string) {
    setTiposEscolhidos((prev) => {
      const novo = new Set(prev)
      if (novo.has(tipo)) novo.delete(tipo)
      else novo.add(tipo)
      return novo
    })
  }

  function resetarFormulario() {
    setJobId(crypto.randomUUID())
    setInvestidorNome('')
    setOriginador('')
    setNumeroProcesso('')
    setUploads({ cedente: [], escritorio: [] })
    setTiposAuto(true)
    setTiposEscolhidos(new Set())
  }

  const podeSubmeter =
    !enviando && !!investidorNome && !!originador && !!numeroProcesso.trim()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!podeSubmeter) return
    setEnviando(true)
    setErro(null)
    setResultado(null)
    try {
      const { data: sessao } = await supabase.auth.getUser()
      const userId = sessao.user?.id
      if (!userId) throw new Error('Sessão expirada — faça login de novo.')

      // 1. Sobe os arquivos pro bucket 'contratos', em {user_id}/{job_id}/{papel}/<arquivo>
      let feitos = 0
      const total = uploads.cedente.length + uploads.escritorio.length
      for (const papel of ['cedente', 'escritorio'] as const) {
        for (const file of uploads[papel]) {
          feitos++
          setProgresso(`Enviando arquivos… (${feitos}/${total}) ${file.name}`)
          const path = `${userId}/${jobId}/${papel}/${nomeArquivoSeguro(file.name)}`
          const { error: upErr } = await supabase.storage
            .from('contratos')
            .upload(path, file, { upsert: true })
          if (upErr) throw new Error(`Falha ao enviar ${file.name}: ${upErr.message}`)
        }
      }

      // 2. Chama a geração — pode levar de 30 a 90 segundos (leitura da análise + IA).
      setProgresso('Gerando contrato(s)… isso pode levar até 1 minuto.')
      const data = await invokeFunction<ResultadoGeracao & { success: boolean; error?: string }>(
        'gerar-contrato',
        {
          job_id: jobId,
          investidor_nome: investidorNome,
          originador,
          numero_processo: numeroProcesso.trim(),
          categoria,
          cedente_genero: cedenteGenero,
          socio_genero: socioGenero,
          tipos: tiposAuto ? null : Array.from(tiposEscolhidos),
        },
      )
      if (data.error) throw new Error(data.error)

      setResultado(data)
      resetarFormulario()
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setProgresso('')
      setEnviando(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5 p-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Investidor (cessionário)" required>
              <Select value={investidorNome} onChange={(e) => setInvestidorNome(e.target.value)}>
                <option value="">Selecione…</option>
                {investidores.map((i) => (
                  <option key={i.nome_chave} value={i.nome_exibicao ?? i.nome_chave}>
                    {i.nome_exibicao ?? i.nome_chave}
                  </option>
                ))}
              </Select>
              {investidores.length === 0 && !investidorDados.isLoading && (
                <p className="mt-1 text-xs text-slate-500">
                  Nenhum investidor cadastrado — cadastre em "Dados pessoais e bancários".
                </p>
              )}
            </Field>

            <Field label="Categoria" required>
              <Select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as (typeof CATEGORIAS)[number])}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Originador" required>
              <Select value={originador} onChange={(e) => setOriginador(e.target.value)}>
                <option value="">
                  {carregandoOriginadores ? 'Carregando…' : 'Selecione…'}
                </option>
                {originadores.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Número do processo" required hint="Usado para localizar a análise no Drive">
              <Input
                value={numeroProcesso}
                onChange={(e) => setNumeroProcesso(e.target.value)}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ArquivosField
              titulo="Documentos do cedente"
              genero={cedenteGenero}
              onGeneroChange={setCedenteGenero}
              generoLabel="Gênero do cedente"
              arquivos={uploads.cedente}
              onAdicionar={(f) => adicionarArquivos('cedente', f)}
              onRemover={(i) => removerArquivo('cedente', i)}
            />
            <ArquivosField
              titulo="Documentos do escritório"
              genero={socioGenero}
              onGeneroChange={setSocioGenero}
              generoLabel="Gênero do sócio responsável"
              arquivos={uploads.escritorio}
              onAdicionar={(f) => adicionarArquivos('escritorio', f)}
              onRemover={(i) => removerArquivo('escritorio', i)}
            />
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={tiposAuto}
                onChange={(e) => setTiposAuto(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Escolher automaticamente (pela análise de crédito)
            </label>
            {!tiposAuto && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {TIPOS_GERACAO.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={tiposEscolhidos.has(t)}
                      onChange={() => alternarTipo(t)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {TIPO_CONTRATO[t]?.label ?? t}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            {enviando ? (
              <p className="text-sm text-slate-600">{progresso}</p>
            ) : (
              <span />
            )}
            <Button type="submit" loading={enviando} disabled={!podeSubmeter} icon={<FileText className="h-4 w-4" />}>
              Gerar contrato
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-4">
        {erro && (
          <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</Card>
        )}
        {resultado && (
          <Card className="space-y-3 border-green-200 bg-green-50 p-4">
            <p className="text-sm font-medium text-green-800">
              ✓ {resultado.tipos_gerados.length} contrato(s) gerado(s)
            </p>
            <p className="text-xs text-green-700">{resultado.tipos_gerados.join(', ')}</p>
            <a
              href={resultado.drive_folder_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-green-800 underline"
            >
              Abrir pasta no Drive <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {resultado.originador_criado && (
              <p className="text-xs text-amber-700">
                Pasta nova criada para o originador "{resultado.originador_criado}" — confira se não é erro de digitação.
              </p>
            )}
            {resultado.pendentes.length > 0 && (
              <div className="rounded bg-amber-50 p-2 text-xs text-amber-800">
                Variáveis não preenchidas: {resultado.pendentes.join(', ')}
              </div>
            )}
          </Card>
        )}
        <Card className="p-4 text-xs text-slate-500">
          O contrato é gerado a partir dos modelos .docx e da análise de crédito já salva
          no Drive. Documentos enviados aqui servem só para extrair dados do cedente e do
          escritório — nada é salvo permanentemente neste formulário.
        </Card>
      </div>
    </div>
  )
}

function ArquivosField({
  titulo,
  genero,
  onGeneroChange,
  generoLabel,
  arquivos,
  onAdicionar,
  onRemover,
}: {
  titulo: string
  genero: 'M' | 'F'
  onGeneroChange: (g: 'M' | 'F') => void
  generoLabel: string
  arquivos: File[]
  onAdicionar: (files: FileList | null) => void
  onRemover: (idx: number) => void
}) {
  const inputId = useRef(`file-${Math.random().toString(36).slice(2)}`)
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-medium text-slate-700">{titulo}</p>
      <div className="flex gap-4 text-sm text-slate-600">
        {generoLabel} :
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={genero === 'M'}
            onChange={() => onGeneroChange('M')}
          />
          Masculino
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={genero === 'F'}
            onChange={() => onGeneroChange('F')}
          />
          Feminino
        </label>
      </div>
      <label
        htmlFor={inputId.current}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-600"
      >
        <Upload className="h-4 w-4" />
        Selecionar arquivos
      </label>
      <input
        id={inputId.current}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onAdicionar(e.target.files)
          e.target.value = ''
        }}
      />
      {arquivos.length > 0 && (
        <ul className="space-y-1">
          {arquivos.map((f, i) => (
            <li key={i} className="flex items-center justify-between text-xs text-slate-600">
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => onRemover(i)}
                className="text-slate-400 hover:text-red-500"
                aria-label={`Remover ${f.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
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
  const { data, isLoading, isError, error, refetch } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<ContratoTemplate> | null>(null)
  const [toDelete, setToDelete] = useState<ContratoTemplate | null>(null)
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir, para detectar alterações não salvas.
  const snapRef = useRef('')

  const dirty = !!editing && JSON.stringify(editing) !== snapRef.current

  // Abre o formulário guardando o snapshot inicial e limpando erros antigos.
  function abrirForm(valores: Partial<ContratoTemplate>) {
    snapRef.current = JSON.stringify(valores)
    setErros({})
    setEditing(valores)
  }

  // Limpa o erro de um campo assim que o usuário o altera.
  function limparErro(campo: string) {
    setErros((prev) => (prev[campo] ? { ...prev, [campo]: '' } : prev))
  }

  // Botões próprios do footer não passam pela confirmação do Modal.
  function cancelar() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setEditing(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.nome?.trim()) {
      setErros({ nome: 'Obrigatório' })
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
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...TPL_VAZIO })}>
          Novo modelo
        </Button>
      </div>
      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            title="Nenhum modelo"
            description="Crie o primeiro modelo."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...TPL_VAZIO })}>
                Novo modelo
              </Button>
            }
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
                    <TD className="text-xs text-slate-600">
                      {vars.length ? vars.join(', ') : '—'}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label="Editar"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirForm(t)}
                        />
                        <IconButton
                          label="Excluir"
                          variant="danger"
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => setToDelete(t)}
                        />
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
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={cancelar}>
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
              <Field label="Nome do modelo" required error={erros.nome}>
                <Input
                  value={editing.nome ?? ''}
                  onChange={(e) => {
                    setEditing({ ...editing, nome: e.target.value })
                    limparErro('nome')
                  }}
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
  const { data, isLoading, isError, error, refetch } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [editing, setEditing] = useState<Partial<Contrato> | null>(null)
  const [dados, setDados] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<Contrato | null>(null)
  const [toDelete, setToDelete] = useState<Contrato | null>(null)
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário (editing + dados das variáveis) ao abrir.
  const snapRef = useRef('')

  const dirty = !!editing && JSON.stringify({ editing, dados }) !== snapRef.current

  // Limpa o erro de um campo assim que o usuário o altera.
  function limparErro(campo: string) {
    setErros((prev) => (prev[campo] ? { ...prev, [campo]: '' } : prev))
  }

  // Botões próprios do footer não passam pela confirmação do Modal.
  function cancelar() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setEditing(null)
  }

  const templateAtual = useMemo(
    () => (templates.data ?? []).find((t) => t.id === editing?.template_id),
    [templates.data, editing?.template_id],
  )
  const placeholders = useMemo(
    () => (templateAtual ? detectarPlaceholders(templateAtual.conteudo) : []),
    [templateAtual],
  )

  function abrirNovo() {
    const valores: Partial<Contrato> = {
      numero: `CT-${new Date().getFullYear()}-${String((data?.length ?? 0) + 1).padStart(3, '0')}`,
      tipo: 'cessao',
      status: 'rascunho',
      template_id: null,
      investidor_id: null,
      cessao_id: null,
    }
    snapRef.current = JSON.stringify({ editing: valores, dados: {} })
    setErros({})
    setDados({})
    setEditing(valores)
  }

  function abrirEdicao(c: Contrato) {
    const dadosIniciais = (c.dados as Record<string, string>) ?? {}
    snapRef.current = JSON.stringify({ editing: c, dados: dadosIniciais })
    setErros({})
    setDados(dadosIniciais)
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
      setErros({ template_id: 'Selecione um modelo' })
      return
    }
    // Variáveis do modelo sem valor: ausentes viram "____" no texto final
    // (vazias saem em branco) — confirma com o usuário antes de salvar.
    const vazias = placeholders.filter((ph) => !dados[ph]?.trim())
    if (
      vazias.length > 0 &&
      !window.confirm(
        `As variáveis a seguir não foram preenchidas e sairão como "____" (ou em branco) no contrato:\n\n${vazias.join(', ')}\n\nSalvar mesmo assim?`,
      )
    ) {
      return
    }
    const conteudo_final = templateAtual
      ? renderizar(templateAtual.conteudo, dados)
      : ''
    try {
      const { id, created_at, updated_at, ...rest } = editing as Contrato
      const payload = { ...rest, dados, conteudo_final }
      payload.investidor_id = vazioNull(payload.investidor_id)
      payload.cessao_id = vazioNull(payload.cessao_id)
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
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            title="Nenhum contrato"
            description="Crie modelos e gere contratos."
            action={
              <Button icon={<FileText className="h-4 w-4" />} onClick={abrirNovo}>
                Gerar contrato
              </Button>
            }
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
                        <IconButton
                          label="Visualizar"
                          icon={<Eye className="h-4 w-4" />}
                          onClick={() => setViewing(c)}
                        />
                        <IconButton
                          label="Editar"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirEdicao(c)}
                        />
                        <IconButton
                          label="Excluir"
                          variant="danger"
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => setToDelete(c)}
                        />
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
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={cancelar}>
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
              <Field label="Modelo" required error={erros.template_id}>
                <Select
                  value={editing.template_id ?? ''}
                  onChange={(e) => {
                    const t = (templates.data ?? []).find((x) => x.id === e.target.value)
                    setEditing({
                      ...editing,
                      template_id: vazioNull(e.target.value),
                      tipo: t?.tipo ?? editing.tipo,
                    })
                    limparErro('template_id')
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
                    setEditing({ ...editing, investidor_id: vazioNull(e.target.value) })
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
                    setEditing({ ...editing, cessao_id: vazioNull(e.target.value) })
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
              <p className="text-sm text-slate-600">
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
                  <p className="text-sm text-slate-600">
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
                  <p className="mb-1 text-xs font-medium text-slate-600">Pré-visualização</p>
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
