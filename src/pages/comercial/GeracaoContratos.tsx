import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import { FileText, Upload, X, ExternalLink } from 'lucide-react'
import { useInvestidorDados } from '@/lib/queries'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { TIPO_CONTRATO } from '@/lib/labels'
import { invokeFunction } from '@/lib/functions'
import { supabase } from '@/lib/supabase'

/**
 * A TELA É UMA SÓ, e não a primeira de três abas.
 *
 * As outras duas — "Contratos" e "Modelos" — eram de um gerador ANTERIOR, que
 * montava o contrato preenchendo `{{variáveis}}` num texto guardado no banco. O
 * caminho que a casa usa é outro: modelos .docx no Drive, preenchidos a partir da
 * análise de crédito. Nenhuma Edge Function lia `contrato_templates` — a aba de
 * modelos editava um texto que ninguém mais gerava.
 *
 * E UMA ABA SÓ NÃO É UMA ABA: "Geração de Contratos" no título e "Gerar contrato"
 * logo abaixo diziam a mesma coisa duas vezes, e a fileira de abas prometia
 * lugares para ir que não levavam a lugar nenhum.
 */
export default function GeracaoContratos() {
  return (
    <div>
      <PageHeader
        title="Geração de Contratos"
        description="O contrato sai dos modelos .docx e da análise de crédito já salva no Drive."
      />
      <GerarPanel />
    </div>
  )
}

/**
 * Um bloco do formulário: o que se pede, e para quê.
 *
 * O formulário tinha três grupos sem nome nenhum — quatro campos, duas caixas de
 * arquivo e uma linha de opções —, e quem abria a tela pela primeira vez não
 * tinha como saber que os documentos enviados ali não ficam guardados, nem o que
 * decide os contratos que saem. A explicação estava num quadro à direita, longe
 * do campo que ela explicava.
 */
function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 py-5 first:pt-1 last:pb-1">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
        {descricao && <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>}
      </div>
      {children}
    </section>
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
    <div className="space-y-4">
      {/* O RESULTADO ANTES DO FORMULÁRIO, e não numa coluna ao lado. Ele é a
          resposta do que a pessoa acabou de mandar, e ficava fora do caminho do
          olho — abaixo do botão, à direita, disputando espaço com uma explicação
          que estava sempre lá. */}
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

      <Card>
        <form onSubmit={handleSubmit} className="divide-y divide-slate-100">
          <Secao
            titulo="O crédito"
            descricao="Quem compra, de quem veio e qual processo — o número é o que localiza a análise no Drive."
          >
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
          </Secao>

          <Secao
            titulo="Documentos"
            descricao="Servem só para extrair os dados do cedente e do escritório. Nada fica guardado neste formulário."
          >
          <div className="grid gap-4 sm:grid-cols-2">
            <ArquivosField
              titulo="Do cedente"
              genero={cedenteGenero}
              onGeneroChange={setCedenteGenero}
              generoLabel="Gênero do cedente"
              arquivos={uploads.cedente}
              onAdicionar={(f) => adicionarArquivos('cedente', f)}
              onRemover={(i) => removerArquivo('cedente', i)}
            />
            <ArquivosField
              titulo="Do escritório"
              genero={socioGenero}
              onGeneroChange={setSocioGenero}
              generoLabel="Gênero do sócio responsável"
              arquivos={uploads.escritorio}
              onAdicionar={(f) => adicionarArquivos('escritorio', f)}
              onRemover={(i) => removerArquivo('escritorio', i)}
            />
          </div>
          </Secao>

          <Secao
            titulo="O que gerar"
            descricao="Pela análise de crédito a casa já sabe quais peças o negócio exige. Desmarque para escolher à mão."
          >
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={tiposAuto}
                onChange={(e) => setTiposAuto(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {/* O "(pela análise de crédito)" saiu daqui: estava dito na linha
                  de cima, e rótulo que repete a explicação ao lado faz a pessoa
                  ler duas vezes para descobrir que é a mesma frase. */}
              Escolher automaticamente
            </label>
            {!tiposAuto && (
              <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
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
          </Secao>

          {/* O ANDAMENTO AO LADO DO BOTÃO: a geração leva de 30 a 90 segundos, e
              sem ele o clique parece não ter feito nada. */}
          <div className="flex flex-wrap items-center justify-end gap-3 pt-5">
            {enviando && <p className="mr-auto text-sm text-slate-600">{progresso}</p>}
            <Button
              type="submit"
              loading={enviando}
              disabled={!podeSubmeter}
              icon={<FileText className="h-4 w-4" />}
            >
              Gerar contrato
            </Button>
          </div>
        </form>
      </Card>

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
  // O NOME AGRUPA OS RÁDIOS. Sem ele cada `input type=radio` é um grupo de um
  // só: a seleção continua certa (quem manda é o estado do React), mas a seta do
  // teclado não anda entre as duas opções, e o leitor de tela anuncia dois
  // controles soltos em vez de uma escolha.
  const grupo = `${inputId.current}-genero`
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-slate-700">{titulo}</p>
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span className="text-slate-500">{generoLabel}</span>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="radio"
              name={grupo}
              checked={genero === 'M'}
              onChange={() => onGeneroChange('M')}
            />
            Masculino
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="radio"
              name={grupo}
              checked={genero === 'F'}
              onChange={() => onGeneroChange('F')}
            />
            Feminino
          </label>
        </div>
      </div>
      <label
        htmlFor={inputId.current}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-6 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-600"
      >
        <Upload className="h-4 w-4" />
        {arquivos.length > 0 ? 'Adicionar mais arquivos' : 'Selecionar arquivos'}
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
            <li
              key={i}
              className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600"
            >
              <span className="truncate" title={f.name}>
                {f.name}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {/* O TAMANHO AO LADO DO NOME: é o que denuncia o arquivo vazio ou
                    o que veio errado antes de a geração começar e falhar longe. */}
                <span className="tabular-nums text-slate-400">{tamanhoLegivel(f.size)}</span>
                <button
                  type="button"
                  onClick={() => onRemover(i)}
                  className="text-slate-400 hover:text-red-500"
                  aria-label={`Remover ${f.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** "312 KB", "1,4 MB" — o tamanho como se lê, não em bytes. */
function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}
