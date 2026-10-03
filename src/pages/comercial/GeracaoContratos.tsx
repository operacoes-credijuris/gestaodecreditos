import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  File as IconeArquivo,
  FileText,
  Info,
  Upload,
  X,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  CATEGORIA_RPV,
  cardDoEndereco,
  originadorAAplicar,
  preenchimentoDoCard,
  type CardParaContrato,
  type PreenchimentoDoCard,
} from '@/lib/contratoDoCard'
import { useInvestidorDados } from '@/lib/queries'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { invokeFunction } from '@/lib/functions'
import { supabase } from '@/lib/supabase'
import {
  PECAS_DO_CONTRATO,
  faltaParaGerar,
  nomeDaPeca,
  nomeDaVariavel,
} from '@/lib/geracaoContratos'

/**
 * A TELA É UMA SÓ, e não a primeira de três abas.
 *
 * As outras duas — "Contratos" e "Modelos" — eram de um gerador ANTERIOR, que
 * montava o contrato preenchendo `{{variáveis}}` num texto guardado no banco. O
 * caminho que a casa usa é outro: modelos .docx no Drive, preenchidos a partir da
 * análise de crédito. Nenhuma Edge Function lia `contrato_templates` — a aba de
 * modelos editava um texto que ninguém mais gerava.
 *
 * ONDA 2 DO REDESENHO (02/10/2026): a cara da amostra aprovada (paginas1.js ›
 * renderContratos) — os passos 1-2-3, o resumo lateral com o que está pronto e o
 * que falta, e os nomes das peças e das variáveis em português (só na tela: a
 * função continua recebendo e devolvendo as chaves). As regras são as de antes.
 */
export default function GeracaoContratos() {
  return (
    <div>
      <PageHeader
        title="Geração de contratos"
        description="O contrato sai dos modelos .docx e da análise de crédito já salva no Drive."
      />
      <GerarPanel />
    </div>
  )
}

/**
 * Um passo do formulário: o número, o que se pede e para quê (o `.step` da
 * amostra).
 *
 * O formulário tinha três grupos sem nome nenhum, e quem abria a tela pela
 * primeira vez não tinha como saber que os documentos enviados ali não ficam
 * guardados, nem o que decide os contratos que saem. NUMERADOS porque é a ordem
 * em que se pensa o contrato: o crédito, os documentos, o que gerar.
 */
function Passo({
  numero,
  titulo,
  descricao,
  children,
}: {
  numero: number
  titulo: string
  descricao: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-borda py-5 last:border-b-0">
      <div className="mb-4 flex gap-4">
        <span
          aria-hidden
          className="grid h-[28px] w-[28px] flex-none place-items-center rounded-full bg-marca font-display text-sm font-bold text-white"
        >
          {numero}
        </span>
        <div>
          <h2 className="mt-0.5 font-display text-lg font-bold text-texto">
            <span className="sr-only">Passo {numero}: </span>
            {titulo}
          </h2>
          <p className="mt-0.5 text-corpo text-texto-2">{descricao}</p>
        </div>
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

/** Um par "rótulo → valor" do resumo, com o que ainda falta em cinza. */
function LinhaResumo({ rotulo, valor, falta }: { rotulo: string; valor?: string; falta: string }) {
  return (
    <>
      <dt className="text-texto-3">{rotulo}</dt>
      <dd className="m-0 min-w-0 break-words text-texto">
        {valor || <span className="text-texto-3">{falta}</span>}
      </dd>
    </>
  )
}

function GerarPanel() {
  const investidorDados = useInvestidorDados()
  // SÓ QUEM TEM FICHA: a lista sai de investidor_dados, e não dos créditos. O
  // contrato sai da ficha do investidor (CPF, RG, endereço, gênero); nome só de
  // crédito não tem nada disso, e a função recusaria.
  const investidores = useMemo(
    () => [...(investidorDados.data?.values() ?? [])].filter((v) => v.tipo === 'investidor'),
    [investidorDados.data],
  )

  const [jobId, setJobId] = useState(() => crypto.randomUUID())
  const [investidorNome, setInvestidorNome] = useState('')
  const [categoria, setCategoria] = useState<(typeof CATEGORIAS)[number]>(CATEGORIAS[0])
  const [originadores, setOriginadores] = useState<string[]>([])
  const [carregandoOriginadores, setCarregandoOriginadores] = useState(false)
  const [erroOriginadores, setErroOriginadores] = useState<string | null>(null)
  const [recargaOriginadores, setRecargaOriginadores] = useState(0)
  const [originador, setOriginador] = useState('')
  const [numeroProcesso, setNumeroProcesso] = useState('')
  // O GÊNERO DE CADA PAPEL FICA GUARDADO depois de gerar: resetarFormulario não
  // mexe nele, nem na categoria.
  const [cedenteGenero, setCedenteGenero] = useState<'M' | 'F'>('M')
  const [socioGenero, setSocioGenero] = useState<'M' | 'F'>('M')
  const [tiposAuto, setTiposAuto] = useState(true)
  const [tiposEscolhidos, setTiposEscolhidos] = useState<Set<string>>(new Set())
  const [uploads, setUploads] = useState<Record<Papel, File[]>>({ cedente: [], escritorio: [] })
  const [enviando, setEnviando] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [resultado, setResultado] = useState<ResultadoGeracao | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // A CATEGORIA DA LISTA QUE CHEGOU, ou null enquanto nenhuma chegou (em voo, ou
  // com erro). É o que diz ao "Gerar contrato" do card que já há de onde escolher.
  const [categoriaDaLista, setCategoriaDaLista] = useState<string | null>(null)

  // Recarrega a lista de originadores (pastas em Drive) sempre que a categoria muda.
  // TROCAR A CATEGORIA ZERA O ORIGINADOR: a lista é outra pasta do Drive.
  useEffect(() => {
    let cancelado = false
    setCarregandoOriginadores(true)
    setOriginador('')
    // A LISTA ANTERIOR SAI ANTES DE RECARREGAR: se a leitura falhasse, ficavam os
    // originadores da outra categoria, escolhíveis como se fossem desta.
    setOriginadores([])
    setCategoriaDaLista(null)
    setErroOriginadores(null)
    invokeFunction<{ originadores: string[] }>('gerar-contrato', {
      acao: 'listar_originadores',
      categoria,
    })
      .then((r) => {
        if (cancelado) return
        setOriginadores(r.originadores ?? [])
        setCategoriaDaLista(categoria)
      })
      .catch((e) => {
        if (!cancelado) setErroOriginadores((e as Error).message)
      })
      .finally(() => {
        if (!cancelado) setCarregandoOriginadores(false)
      })
    return () => {
      cancelado = true
    }
  }, [categoria, recargaOriginadores])

  // ------------------------- "GERAR CONTRATO" A PARTIR DO CARD (onda 4, só admin)
  //
  // A Análise de crédito abre esta tela com `?card=<id>` (só o id). O card é lido
  // do ESPELHO (kommo_leads — leitura, nada é gravado), e a tela preenche a
  // categoria (RPV) e o número do processo. O ORIGINADOR ESPERA A LISTA DO DRIVE e
  // só é escolhido DELA (`originadorAAplicar`): um nome fora da lista faria o
  // `gerar-contrato` criar uma pasta nova. Nada é gerado sozinho — o botão
  // continua sendo o da pessoa.
  const { isAdmin } = useAuth()
  const [parametros, setParametros] = useSearchParams()
  const navegar = useNavigate()
  const cardPedido = isAdmin ? cardDoEndereco(parametros.get('card')) : null
  const [doCard, setDoCard] = useState<PreenchimentoDoCard | null>(null)
  const [erroDoCard, setErroDoCard] = useState<string | null>(null)
  /** O originador do card já foi aplicado: nunca de novo (a escolha à mão fica). */
  const originadorDoCardAplicado = useRef(false)
  /** O que o card deu ao originador: o item da lista, '' (sem item igual) ou null (ainda não). */
  const [originadorDoCard, setOriginadorDoCard] = useState<string | null>(null)

  useEffect(() => {
    if (cardPedido === null) return
    let cancelado = false
    originadorDoCardAplicado.current = false
    setOriginadorDoCard(null)
    setErroDoCard(null)
    supabase
      .from('kommo_leads')
      .select('kommo_lead_id, pipeline_id, nome, processo_cnj, notas, nota_texto')
      .eq('kommo_lead_id', cardPedido)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) return setErroDoCard(`Não consegui ler o card no espelho do Kommo: ${error.message}`)
        if (!data) return setErroDoCard('Não achei este card no espelho do Kommo — preencha à mão.')
        const p = preenchimentoDoCard(data as CardParaContrato)
        setDoCard(p)
        // SÓ O RPV TEM O BOTÃO, e só ele é preenchido: num card de outro funil a
        // tela diz isso e não adivinha categoria nem pasta.
        if (!p.ehRpv) return
        setCategoria(CATEGORIA_RPV)
        if (p.numero) setNumeroProcesso(p.numero)
      })
    return () => {
      cancelado = true
    }
  }, [cardPedido])

  // O ORIGINADOR, NO RETORNO DA LISTA E UMA VEZ SÓ (ver `originadorAAplicar`).
  useEffect(() => {
    const o = originadorAAplicar({
      card: doCard,
      jaAplicado: originadorDoCardAplicado.current,
      categoriaDaLista,
      carregando: carregandoOriginadores,
      lista: originadores,
    })
    if (o === undefined) return
    originadorDoCardAplicado.current = true
    setOriginador(o)
    setOriginadorDoCard(o)
  }, [doCard, categoriaDaLista, carregandoOriginadores, originadores])

  /** Dispensa o aviso do card: o formulário fica como está, e o endereço perde o card. */
  function esquecerCard() {
    setDoCard(null)
    setErroDoCard(null)
    setParametros(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('card')
        return n
      },
      { replace: true },
    )
  }

  function adicionarArquivos(papel: Papel, lista: FileList | File[] | null) {
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

  // O QUE FALTA, em palavras, para o resumo — o mesmo critério do botão (ver
  // lib/geracaoContratos.ts, com teste). Inclui a escolha à mão sem peça
  // nenhuma, que não pode ir: a função lê lista vazia como "escolha
  // automática" e gerava as peças da análise — o contrário do que a pessoa
  // pediu ao desmarcar a caixa.
  const falta = faltaParaGerar({
    investidor: investidorNome,
    originador,
    numeroProcesso,
    automatico: tiposAuto,
    pecas: tiposEscolhidos,
  })
  const semPecaEscolhida = !tiposAuto && tiposEscolhidos.size === 0
  const podeSubmeter = !enviando && falta.length === 0

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
      // O FORMULÁRIO VOLTOU AO BRANCO: o aviso "já preenchidos" do card deixaria
      // de ser verdade.
      if (doCard || erroDoCard) esquecerCard()
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setProgresso('')
      setEnviando(false)
    }
  }

  const totalArquivos = uploads.cedente.length + uploads.escritorio.length

  return (
    <div>
      {/* VINDO DO CARD (onda 4, só admin): o que foi preenchido, o que falta e o
          caminho de volta. O originador só se diz escolhido depois da lista. */}
      {(doCard || erroDoCard) && cardPedido !== null && (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-start gap-3 rounded-cartao border border-info-borda bg-info-fundo px-5 py-4"
        >
          <Info className="mt-0.5 h-[20px] w-[20px] flex-none text-info" aria-hidden />
          <p className="min-w-[220px] flex-1 text-corpo text-texto-2">
            {erroDoCard ? (
              erroDoCard
            ) : doCard && !doCard.ehRpv ? (
              <>Este card não é do funil de RPV — a tela não preencheu nada. Preencha à mão.</>
            ) : doCard ? (
              <>
                Vindo do card de <strong className="text-texto">{doCard.cedente || `card ${doCard.id}`}</strong>{' '}
                (Elaboração de contratos):{' '}
                {[
                  'categoria',
                  doCard.numero && 'processo',
                  originadorDoCard ? 'originador' : null,
                ]
                  .filter(Boolean)
                  .join(', ')
                  .replace(/, ([^,]*)$/, ' e $1')}{' '}
                {doCard.numero || originadorDoCard ? 'já preenchidos.' : 'já preenchida.'}
                {!doCard.numero && (
                  <>
                    {' '}
                    <strong className="text-texto">O card não tem número de processo</strong> — informe abaixo.
                  </>
                )}
                {originadorDoCard === null &&
                  (erroOriginadores
                    ? ' O originador entra quando a lista do Drive carregar — tente de novo no campo dele.'
                    : ' O originador entra quando a lista do Drive carregar.')}
                {originadorDoCard === '' &&
                  ` O intermediador "${doCard.intermediador || '—'}" não tem pasta de originador — escolha na lista.`}{' '}
                Escolha o investidor e confira os documentos.
              </>
            ) : null}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              icon={<ArrowLeft className="h-[16px] w-[16px]" aria-hidden />}
              onClick={() => navegar(`/operacional/analise?card=${encodeURIComponent(String(cardPedido))}`)}
            >
              Voltar ao card
            </Button>
            <IconButton
              label="Dispensar o aviso"
              icon={<X className="h-[16px] w-[16px]" />}
              onClick={esquecerCard}
            />
          </div>
        </div>
      )}
      {/* O RESULTADO ANTES DO FORMULÁRIO. Ele é a resposta do que a pessoa
          acabou de mandar, e fica no caminho do olho. */}
      {erro && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-3 rounded-cartao border border-perigo-borda bg-perigo-fundo px-5 py-4 text-perigo"
        >
          <AlertTriangle className="mt-0.5 h-[20px] w-[20px] flex-none" aria-hidden />
          <div>
            <p className="font-semibold text-texto">Não deu para gerar</p>
            <p className="mt-0.5 text-corpo text-texto-2">{erro}</p>
          </div>
        </div>
      )}
      {resultado && (
        <div className="mb-5 flex flex-wrap items-start gap-3 rounded-cartao border border-sucesso-borda bg-sucesso-fundo px-5 py-4 text-sucesso">
          <CheckCircle2 className="mt-0.5 h-[20px] w-[20px] flex-none" aria-hidden />
          {/* min-w: no celular o botão da pasta desce para a linha de baixo, em
              vez de espremer o texto numa coluna de uma palavra. */}
          <div className="min-w-[200px] flex-1 space-y-1">
            <p className="font-semibold text-texto">
              ✓ {resultado.tipos_gerados.length} contrato(s) gerado(s)
            </p>
            {/* OS NOMES EM PORTUGUÊS: a função devolve as chaves
                ("cessao_credito"), e só a tela traduz. */}
            <p className="text-corpo text-texto-2">
              {resultado.tipos_gerados.map(nomeDaPeca).join(', ')}
            </p>
            {resultado.originador_criado && (
              <p className="flex items-start gap-1.5 text-sm text-aviso">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
                Pasta nova criada para o originador "{resultado.originador_criado}" — confira se não é erro de digitação.
              </p>
            )}
            {resultado.pendentes.length > 0 && (
              <p className="flex items-start gap-1.5 text-sm text-aviso">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
                Variáveis não preenchidas: {resultado.pendentes.map(nomeDaVariavel).join(', ')}
              </p>
            )}
          </div>
          <a
            href={resultado.drive_folder_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-controle border border-borda-forte bg-superficie px-4 text-sm font-semibold text-texto transition-colors hover:bg-superficie-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-2"
          >
            <ExternalLink className="h-[16px] w-[16px]" aria-hidden />
            Abrir pasta no Drive
          </a>
        </div>
      )}

      {/* O FORMULÁRIO ABRAÇA O RESUMO: o botão "Gerar contrato" mora no resumo
          lateral, e continua sendo o submit do formulário (Enter num campo
          também gera, como antes). */}
      <form
        onSubmit={handleSubmit}
        className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
      >
        <Card className="px-6 py-1">
          <Passo
            numero={1}
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
                {/* FALHA NÃO É LISTA VAZIA: dizer "nenhum investidor cadastrado"
                    quando a leitura falhou mandava a pessoa cadastrar de novo quem
                    já tem ficha. */}
                {investidorDados.isError ? (
                  <p role="alert" className="text-xs font-semibold text-perigo">
                    Não consegui carregar os investidores: {(investidorDados.error as Error)?.message ?? 'erro desconhecido'}.{' '}
                    <button
                      type="button"
                      className="inline-flex min-h-[24px] items-center underline"
                      onClick={() => investidorDados.refetch()}
                    >
                      Tentar de novo
                    </button>
                  </p>
                ) : (
                  investidores.length === 0 && !investidorDados.isLoading && (
                    <p className="text-xs text-texto-3">
                      Nenhum investidor cadastrado — cadastre em "Dados cadastrais".
                    </p>
                  )
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

              {/* SÓ DA LISTA DO DRIVE: o originador é uma pasta de "A. Análises
                  de crédito / {categoria}". Um nome fora dela faria a função
                  criar pasta nova. */}
              <Field
                label="Originador"
                required
                hint={erroOriginadores ? undefined : 'As pastas de originador da categoria, no Drive.'}
              >
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
                {/* Mesmo padrão do investidor acima: falha não é lista vazia. */}
                {erroOriginadores && (
                  <p role="alert" className="text-xs font-semibold text-perigo">
                    Não consegui carregar os originadores: {erroOriginadores}.{' '}
                    <button
                      type="button"
                      className="inline-flex min-h-[24px] items-center underline"
                      onClick={() => setRecargaOriginadores((n) => n + 1)}
                    >
                      Tentar de novo
                    </button>
                  </p>
                )}
              </Field>

              <Field label="Número do processo" required hint="Usado para localizar a análise no Drive">
                <Input
                  className="tabular-nums"
                  value={numeroProcesso}
                  onChange={(e) => setNumeroProcesso(e.target.value)}
                  placeholder="0000000-00.0000.0.00.0000"
                />
              </Field>
            </div>
          </Passo>

          <Passo
            numero={2}
            titulo="Documentos"
            descricao="Servem para extrair os dados do cedente e do escritório. Os do cedente ficam arquivados no Drive, na pasta do processo (4. Documentos do cedente e advogado)."
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
          </Passo>

          <Passo
            numero={3}
            titulo="O que gerar"
            descricao="Pela análise de crédito a casa já sabe quais peças o negócio exige. Desmarque para escolher à mão."
          >
            <label className="inline-flex min-h-[24px] cursor-pointer items-center gap-2 text-corpo text-texto">
              <input
                type="checkbox"
                checked={tiposAuto}
                onChange={(e) => setTiposAuto(e.target.checked)}
                className="h-[16px] w-[16px] accent-marca"
              />
              Escolher automaticamente
            </label>
            {!tiposAuto && (
              <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">Peças a gerar</legend>
                {PECAS_DO_CONTRATO.map((t) => (
                  <label
                    key={t}
                    className="inline-flex min-h-[24px] cursor-pointer items-center gap-2 text-corpo text-texto"
                  >
                    <input
                      type="checkbox"
                      checked={tiposEscolhidos.has(t)}
                      onChange={() => alternarTipo(t)}
                      className="h-[16px] w-[16px] accent-marca"
                    />
                    {nomeDaPeca(t)}
                  </label>
                ))}
              </fieldset>
            )}
            {semPecaEscolhida && (
              <p className="mt-2 text-xs font-semibold text-aviso">
                Marque ao menos uma peça — ou volte a marcar "Escolher automaticamente".
              </p>
            )}
          </Passo>
        </Card>

        {/* O RESUMO AO LADO (item "Novo" da amostra): para conferir antes de
            gerar era preciso rolar o formulário inteiro, e o botão travado não
            dizia por quê. Aqui está o que foi escolhido, o que falta e o
            andamento — a geração leva de 30 a 90 segundos, e sem ele o clique
            parece não ter feito nada. */}
        <Card className="p-5 lg:sticky lg:top-6">
          <h2 className="mb-4 font-display text-lg font-bold text-texto">Resumo</h2>
          <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2.5 text-corpo">
            <LinhaResumo rotulo="Investidor" valor={investidorNome} falta="a escolher" />
            <LinhaResumo rotulo="Categoria" valor={categoria} falta="" />
            <LinhaResumo rotulo="Originador" valor={originador} falta="a escolher" />
            <LinhaResumo rotulo="Processo" valor={numeroProcesso.trim()} falta="a informar" />
            <LinhaResumo rotulo="Documentos" valor={`${totalArquivos} arquivo(s)`} falta="" />
            <LinhaResumo
              rotulo="Peças"
              valor={
                tiposAuto
                  ? 'Definidas pela análise'
                  : PECAS_DO_CONTRATO.filter((t) => tiposEscolhidos.has(t)).map(nomeDaPeca).join(', ')
              }
              falta="nenhuma marcada"
            />
          </dl>
          <Button
            type="submit"
            size="lg"
            className="mt-5 w-full"
            loading={enviando}
            disabled={!podeSubmeter}
            title={
              podeSubmeter || enviando
                ? undefined
                : 'Escolha o investidor e o originador, informe o número do processo e, na escolha à mão, marque ao menos uma peça.'
            }
            icon={<FileText className="h-[16px] w-[16px]" />}
          >
            {enviando ? 'Gerando…' : 'Gerar contrato'}
          </Button>
          <p aria-live="polite" className="mt-3 text-xs text-texto-3">
            {enviando
              ? progresso
              : falta.length === 0
                ? 'Leva até 1 minuto. Os arquivos vão para a pasta do crédito no Drive.'
                : `Falta: ${falta.join(', ')}.`}
          </p>
        </Card>
      </form>
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
  onAdicionar: (files: File[]) => void
  onRemover: (idx: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useRef(`arquivos-${Math.random().toString(36).slice(2)}`)
  // O NOME AGRUPA OS RÁDIOS. Sem ele cada `input type=radio` é um grupo de um
  // só: a seleção continua certa (quem manda é o estado do React), mas a seta do
  // teclado não anda entre as duas opções, e o leitor de tela anuncia dois
  // controles soltos em vez de uma escolha.
  const grupo = `${id.current}-genero`
  // ARRASTAR E SOLTAR. A caixa tracejada tem cara de área de soltar, e é o que a
  // pessoa faz — sem `onDrop` o arquivo solto ali sumia sem aviso nenhum. Entra
  // só o que tem extensão aceita; o resto é ignorado, como na escolha.
  const [arrastando, setArrastando] = useState(false)
  function soltar(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setArrastando(false)
    const aceitos = Array.from(e.dataTransfer.files).filter((f) =>
      EXTENSOES_ACEITAS.some((ext) => f.name.toLowerCase().endsWith(ext)),
    )
    if (aceitos.length > 0) onAdicionar(aceitos)
  }
  return (
    <div className="rounded-cartao border border-borda p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="font-semibold text-texto">{titulo}</p>
        <div
          role="radiogroup"
          aria-label={generoLabel}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-corpo text-texto-2"
        >
          <span className="text-xs text-texto-3">{generoLabel}</span>
          <label className="inline-flex min-h-[24px] cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={grupo}
              className="h-[16px] w-[16px] accent-marca"
              checked={genero === 'M'}
              onChange={() => onGeneroChange('M')}
            />
            Masculino
          </label>
          <label className="inline-flex min-h-[24px] cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={grupo}
              className="h-[16px] w-[16px] accent-marca"
              checked={genero === 'F'}
              onChange={() => onGeneroChange('F')}
            />
            Feminino
          </label>
        </div>
      </div>
      {/* BOTÃO, e não `label` de um input escondido: o input `hidden` não recebe
          foco, e a caixa ficava fora do alcance do teclado. */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        className={`flex w-full flex-col items-center justify-center gap-1 rounded-campo border-[1.5px] border-dashed px-4 py-4 text-center text-corpo transition-colors hover:border-marca-viva hover:bg-marca-leve focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-2 ${
          arrastando ? 'border-marca-viva bg-marca-leve' : 'border-borda-forte bg-superficie-2'
        }`}
      >
        <Upload className="h-[20px] w-[20px] text-texto-3" aria-hidden />
        <span className="font-semibold text-marca-texto">
          {arquivos.length > 0 ? 'Adicionar mais arquivos' : 'Selecionar ou soltar arquivos'}
        </span>
        <span className="text-xs text-texto-3">{EXTENSOES_ACEITAS.join(' ')}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={EXTENSOES_ACEITAS.join(',')}
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onAdicionar(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {arquivos.length > 0 && (
        <ul className="mt-2 grid gap-1">
          {arquivos.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-controle bg-superficie-2 py-0.5 pl-2.5 pr-1 text-corpo text-texto"
            >
              <IconeArquivo className="h-[14px] w-[14px] flex-none text-texto-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              {/* O TAMANHO AO LADO DO NOME: é o que denuncia o arquivo vazio ou
                  o que veio errado antes de a geração começar e falhar longe. */}
              <span className="flex-none tabular-nums text-texto-3">{tamanhoLegivel(f.size)}</span>
              <IconButton
                label={`Remover ${f.name}`}
                variant="danger"
                icon={<X className="h-[14px] w-[14px]" />}
                onClick={() => onRemover(i)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const EXTENSOES_ACEITAS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.docx', '.xlsx']

/** "312 KB", "1,4 MB" — o tamanho como se lê, não em bytes. */
function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}
