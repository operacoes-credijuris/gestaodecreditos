// A aba "Processos judiciais" da janela de Due diligence — a segunda frente.
//
// A PERGUNTA QUE ELA RESPONDE, e que a aba de Certidões não responde: uma
// certidão positiva diz que EXISTE dívida; esta apuração diz O QUANTO ELA
// AMEAÇA A CESSÃO. É a diferença entre uma execução fiscal de trinta mil já em
// penhora e um protesto antigo de oitocentos reais — a primeira alcança o
// crédito que estamos comprando, a segunda não.
//
// SÃO AS LINHAS 10 E 11 DO QUESTIONÁRIO. "Histórico do cedente: tem dívida?" e
// "Histórico do advogado: tem dívida?" sempre estiveram na planilha e sempre
// foram respondidas pela IA lendo O PROCESSO DA CESSÃO — que não fala das
// dívidas de ninguém. O "Não" impresso queria dizer "não achei nos autos" e era
// lido como "diligência feita, nada consta". Quando esta tela apura, o motor
// (_shared/dueDiligencia.ts) passa a escrever as duas linhas a partir daqui.
//
// A TELA É OS CAMPOS DO TITULAR E A TABELA, e nada mais. Ela já teve um placar
// do que a planilha ia imprimir, as sugestões de CPF dos anexos sempre à mostra,
// dois botões de leitura e uma seção por titular apurado — moldura maior que o
// conteúdo num crédito com um titular só, que é o caso normal. O que sobrou é o
// que se olha: de quem estamos falando, e o que existe em nome dele. Os
// desfechos ficam no rodapé da janela (ver DueDiligence), porque são o que se
// faz depois de ler isto.
//
// ABRIR ESTA ABA JÁ É PEDIR A DILIGÊNCIA. Os três passos — ler no título quais
// verbas o card cede, achar nos autos quem são os titulares delas, procurar as
// dívidas em nome deles — correm sozinhos, em sequência, quando a aba abre. Não
// há decisão humana entre um e outro: o segundo não muda o que o primeiro
// concluiu, e o terceiro não muda o que o segundo achou. O que havia antes eram
// dois botões e um formulário em branco no meio deles, o que convidava a
// digitar à mão o que a leitura ia trazer melhor.
//
// A APURAÇÃO CUSTA DINHEIRO — a API do Escavador é paga por requisição —, e é
// disso que saem as três travas da corrente: ela não roda em crédito que já tem
// apuração (reabrir para conferir não pode cobrar de novo), não roda antes de os
// anexos terminarem de ser lidos, e não roda sem documento. Buscar por nome traz
// o homônimo junto e cada página é cobrada: sem CPF, CNPJ ou OAB a corrente para
// com os campos preenchidos e diz o que falta. O custo de cada chamada volta na
// tela.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, RefreshCw, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { formatCpfCnpjInput, onlyDigits } from '@/lib/format'
import { acharCpfs } from '@/lib/cpfNoTexto'
import { acharOabs } from '@/lib/dadosNoTexto'
import { classificarParcelaCedida, lerTituloCard } from '@/lib/kommo'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'
import type {
  ApuracaoDD,
  ProcessoDD,
} from '../../supabase/functions/_shared/dueDiligencia.ts'
import {
  alvosDaCessao,
  type TitularLido,
} from '../../supabase/functions/_shared/titularesDaCessao.ts'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState, Loading, Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import type { ItemDeRisco } from '@/components/JanelaDeDesfecho'

/** O que vem do banco, além do que o motor de RPV precisa. */
interface ProcessoNaTela extends ProcessoDD {
  id: string
  url_fonte?: string | null
  fonte?: string | null
}

const TOM_DO_RISCO: Record<string, 'red' | 'amber' | 'green' | 'gray'> = {
  ALTO: 'red',
  ATENCAO: 'amber',
  NENHUM: 'green',
  NAO_AVALIADO: 'gray',
}

const brl = (v: unknown): string => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0
    ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '—'
}

export function PainelProcessosJudiciais({
  leadId,
  tituloDoCard,
  cedenteDoCard,
  arquivos,
  lendoPdf,
  ativo,
  onItensDeRisco,
}: {
  leadId: number
  /** O título do card — é dele que sai QUAIS verbas estão sendo cedidas. */
  tituloDoCard: string
  cedenteDoCard: string
  /** Os PDFs já lidos na tela: é deles que a leitura dos titulares sai. */
  arquivos: ArquivoLido[]
  /**
   * Os anexos ainda estão sendo baixados e lidos.
   *
   * A CADEIA AUTOMÁTICA ESPERA POR ISTO. Sem saber que a leitura do PDF está em
   * curso, o painel abriria, veria `arquivos` vazio e concluiria "não há texto
   * nos autos" — sobre um card cujo processo está chegando naquele segundo.
   */
  lendoPdf?: boolean
  ativo: boolean
  /**
   * Os processos apurados, no formato que a janela do desfecho marca.
   *
   * SOBEM PARA A JANELA porque é lá que a decisão fica: reprovar e seguir são
   * botões do rodapé, ao lado de Fechar, e não do meio do painel. O painel
   * mostra a evidência; a janela decide com ela.
   */
  onItensDeRisco?: (itens: ItemDeRisco[]) => void
}) {
  const toast = useToast()
  const [carregando, setCarregando] = useState(true)
  const [apurando, setApurando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [custo, setCusto] = useState<string | null>(null)
  const [apuracoes, setApuracoes] = useState<ApuracaoDD[]>([])
  const [processos, setProcessos] = useState<ProcessoNaTela[]>([])

  const [cedenteNome, setCedenteNome] = useState(cedenteDoCard ?? '')
  const [cedenteCpf, setCedenteCpf] = useState('')
  const [advNome, setAdvNome] = useState('')
  const [advOab, setAdvOab] = useState('')
  const [advCpf, setAdvCpf] = useState('')
  const [lendoTitulares, setLendoTitulares] = useState(false)
  /**
   * A cadeia já rodou para ESTE card.
   *
   * Ref, e não estado: ela não desenha nada, e como estado o próprio render que
   * ela dispara reentraria no efeito. Guardar o id do lead — em vez de um
   * booleano — faz a trava acompanhar o card, que é o que ela protege: abrir o
   * card seguinte tem de apurar de novo, e o mesmo card não.
   */
  const jaEncadeou = useRef<number | null>(null)
  const [avisosDaLeitura, setAvisosDaLeitura] = useState<string[]>([])

  // ------------------------------------------------- de quem é o que compramos
  //
  // A DILIGÊNCIA É DO TITULAR DA VERBA, e o título do card já diz qual verba é.
  // Perguntar sempre pelo cedente E pelo advogado, como esta tela fazia, apura
  // quem não é parte do negócio: numa cessão só de honorários as dívidas do
  // exequente não alcançam nada, e numa cessão só do principal as do advogado
  // também não. Cada consulta a mais é paga, e cada alerta a mais sobre quem não
  // importa ensina quem lê a ignorar o alerta.
  const alvos = useMemo(
    () => alvosDaCessao(classificarParcelaCedida(lerTituloCard(tituloDoCard).parcelaCedida)),
    [tituloDoCard],
  )
  const pedeCedente = alvos.papeis.includes('CEDENTE')
  const pedeAdvogado = alvos.papeis.includes('ADVOGADO')

  // ------------------------------------------------------------------ banco

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    const [h, p] = await Promise.all([
      supabase
        .from('dd_historico')
        .select('id, papel, nome, documento, oab, status, fonte, apurado_em, observacao')
        .eq('kommo_lead_id', leadId)
        .order('papel'),
      supabase
        .from('dd_processo')
        .select(
          'id, historico_id, numero_processo, tribunal, objeto, polo, ha_cobranca, ' +
            'valor_cobrado, estagio, risco, risco_motivo, fonte, url_fonte',
        )
        .eq('kommo_lead_id', leadId),
    ])
    // AS TABELAS PODEM NÃO EXISTIR AINDA. A 0056 criou dd_historico e
    // dd_processo, a 0061 criou o resto; enquanto uma delas não tiver rodado, o
    // PostgREST devolve "relation does not exist" — que, cru na tela, se lê como
    // defeito do sistema em vez de migração pendente.
    const falha = h.error?.message ?? p.error?.message ?? null
    setErro(
      falha && /does not exist|schema cache/i.test(falha)
        ? 'As tabelas da due diligence ainda não existem no banco — rode as migrações ' +
            '0056 e 0061 no Supabase antes de usar esta aba.'
        : falha,
    )
    setApuracoes((h.data ?? []) as ApuracaoDD[])
    setProcessos((p.data ?? []) as unknown as ProcessoNaTela[])
    setCarregando(false)
  }, [leadId])

  useEffect(() => {
    if (ativo) void carregar()
  }, [ativo, carregar])

  // Prefill a partir do que JÁ foi apurado, para reapurar não exigir redigitar.
  useEffect(() => {
    const cedente = apuracoes.find((a) => a.papel === 'CEDENTE')
    const advogado = apuracoes.find((a) => a.papel === 'ADVOGADO')
    if (cedente) {
      setCedenteNome((v) => v || cedente.nome || '')
      setCedenteCpf((v) => v || formatCpfCnpjInput(cedente.documento ?? ''))
    }
    if (advogado) {
      setAdvNome((v) => v || advogado.nome || '')
      setAdvOab((v) => v || advogado.oab || '')
      setAdvCpf((v) => v || formatCpfCnpjInput(advogado.documento ?? ''))
    }
  }, [apuracoes])

  // ------------------------------------------------- sugestões vindas do PDF
  //
  // POR ARQUIVO, e nunca sobre a junção de vários: juntar textos cria vizinhança
  // que não existe em documento nenhum, e vizinhança falsa é achado falso. É a
  // regra do cabeçalho de cpfNoTexto.ts.
  const cpfsSugeridos = useMemo(() => {
    const vistos = new Set<string>()
    return arquivos
      .flatMap((a) => acharCpfs(a.texto ?? ''))
      .filter((c) => (vistos.has(c.cpf) ? false : (vistos.add(c.cpf), true)))
      .slice(0, 6)
  }, [arquivos])

  const oabsSugeridas = useMemo(() => {
    const vistos = new Set<string>()
    return arquivos
      .flatMap((a) => acharOabs(a.texto ?? ''))
      .filter((o) => {
        const k = o.uf + o.numero
        return vistos.has(k) ? false : (vistos.add(k), true)
      })
      .slice(0, 6)
  }, [arquivos])

  // -------------------------------------------------- ler os autos com IA

  /**
   * Quem são os titulares, lidos dos autos que a tela já carregou.
   *
   * O TEXTO VEM DAQUI, e não de uma nova busca: o PDF está na memória desde que
   * o card foi aberto, e uma segunda leitura custaria uma consulta à Judit para
   * obter o que já temos.
   *
   * DEVOLVE ALÉM DE PREENCHER. Os campos são para quem confere; o retorno é
   * para a cadeia automática, que precisa dos documentos no mesmo tique — estado
   * de React não está atualizado na linha seguinte ao setState, e apurar lendo
   * os campos apuraria os valores anteriores.
   */
  async function lerTitulares(): Promise<TitularLido[]> {
    const texto = arquivos
      .map((a) => a.texto ?? '')
      .filter((t) => t.trim())
      .join('\n\n===== PRÓXIMO ARQUIVO =====\n\n')
    if (!texto.trim()) {
      setAvisosDaLeitura([
        'Os anexos deste card não têm texto para ler — processo digitalizado só tem imagem. ' +
          'Preencha os titulares à mão.',
      ])
      return []
    }
    setLendoTitulares(true)
    setErro(null)
    try {
      const r = await invokeFunction<{ titulares?: TitularLido[]; avisos?: string[] }>(
        'dd-titulares',
        {
          lead_id: leadId,
          titulo: tituloDoCard,
          texto,
          parcela: classificarParcelaCedida(lerTituloCard(tituloDoCard).parcelaCedida),
        },
      )
      const achados = r.titulares ?? []
      const doCedente = achados.find((t) => t.papel === 'CEDENTE')
      const doAdvogado = achados.find((t) => t.papel === 'ADVOGADO')
      if (doCedente) {
        if (doCedente.nome) setCedenteNome(doCedente.nome)
        if (doCedente.documento) setCedenteCpf(formatCpfCnpjInput(doCedente.documento))
      }
      if (doAdvogado) {
        if (doAdvogado.nome) setAdvNome(doAdvogado.nome)
        if (doAdvogado.oab) setAdvOab(doAdvogado.oab)
        if (doAdvogado.documento) setAdvCpf(formatCpfCnpjInput(doAdvogado.documento))
      }
      setAvisosDaLeitura(r.avisos ?? [])
      return achados
    } catch (e) {
      setErro((e as Error).message)
      toast.error((e as Error).message)
      return []
    } finally {
      setLendoTitulares(false)
    }
  }

  // ------------------------------------------------------------------ ação

  /**
   * Os alvos a partir do que está NOS CAMPOS — o caminho do botão.
   *
   * SÓ OS TITULARES DA VERBA CEDIDA. Mandar os dois sempre gastaria consulta
   * paga com quem não é parte do negócio, e devolveria alerta sobre dívida que
   * não alcança o crédito, que é pior do que não apurar.
   */
  function alvosDosCampos(): Record<string, string>[] {
    const saida: Record<string, string>[] = []
    const cpf = onlyDigits(cedenteCpf)
    if (pedeCedente && (cedenteNome.trim() || cpf)) {
      saida.push({ papel: 'CEDENTE', nome: cedenteNome.trim(), documento: cpf })
    }
    if (pedeAdvogado && (advOab.trim() || onlyDigits(advCpf))) {
      saida.push({
        papel: 'ADVOGADO',
        nome: advNome.trim(),
        oab: advOab.trim(),
        documento: onlyDigits(advCpf),
      })
    }
    return saida
  }

  async function apurar(alvosParaApurar = alvosDosCampos()) {
    if (alvosParaApurar.length === 0) {
      toast.error(
        pedeCedente
          ? 'Informe ao menos o CPF do cedente ou a OAB do advogado.'
          : 'Informe a OAB (ou o CPF) do advogado, que é quem cede esta verba.',
      )
      return
    }

    setApurando(true)
    setErro(null)
    try {
      const r = await invokeFunction<{
        custo?: string
        apuracoes?: { papel: string; status: string; total: number; observacao?: string | null }[]
      }>('dd-processos', { lead_id: leadId, alvos: alvosParaApurar })
      setCusto(r.custo ?? null)
      const falhas = (r.apuracoes ?? []).filter((a) => a.status === 'FALHA')
      if (falhas.length > 0) {
        // FALHA NÃO É "NADA CONSTA". A apuração que não aconteceu precisa ficar
        // visível: é a diferença entre "procurei e não achei" e "não procurei",
        // e é a lacuna que o motor transforma em aviso na análise.
        toast.error(
          `Não apurei ${falhas.map((f) => f.papel.toLowerCase()).join(' e ')}: ` +
            (falhas[0].observacao ?? 'falha na consulta'),
        )
      } else {
        const achados = (r.apuracoes ?? []).reduce((s, a) => s + (a.total ?? 0), 0)
        toast.success(
          achados === 0
            ? 'Apurado: nenhum processo em nome dos sujeitos.'
            : `Apurado: ${achados} processo(s) encontrado(s).`,
        )
      }
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setApurando(false)
    }
  }

  // ------------------------------------------------- a cadeia, sem clique
  //
  // ABRIR A DILIGÊNCIA JÁ É PEDI-LA. Os três passos — ler as verbas no título,
  // achar os titulares nos autos, procurar as dívidas deles — não têm decisão
  // humana no meio: a segunda etapa não muda o que a primeira concluiu, e a
  // terceira não muda o que a segunda achou. Pedir dois cliques para executar
  // uma sequência determinística é transferir trabalho de máquina para pessoa, e
  // o campo em branco entre um clique e outro convida a preencher à mão o que a
  // leitura ia trazer melhor.
  //
  // O QUE AINDA SEGURA A CORRENTE, e por que cada um:
  //
  //   já apurado       a consulta é PAGA. Reabrir o card para conferir não pode
  //                    cobrar de novo; refazer a apuração é o botão Reapurar.
  //   PDF em leitura   os anexos chegam depois da janela. Rodar antes de eles
  //                    existirem concluiria "não há texto nos autos" sobre um
  //                    processo que está chegando naquele segundo.
  //   sem documento    buscar por nome traz o homônimo junto, e cada página é
  //                    cobrada. Sem CPF/CNPJ (ou OAB), a cadeia PARA com os
  //                    campos preenchidos e diz o que falta — quem confere
  //                    decide se manda buscar pelo nome mesmo assim.
  const [passo, setPasso] = useState<'lendo' | 'apurando' | null>(null)

  useEffect(() => {
    if (!ativo || carregando || erro) return
    // Já existe apuração para este crédito: a foto está na tela, e refazê-la
    // custa dinheiro.
    if (apuracoes.length > 0) return
    if (lendoPdf) return
    if (jaEncadeou.current === leadId) return
    jaEncadeou.current = leadId

    void (async () => {
      setPasso('lendo')
      const titulares = await lerTitulares()
      const paraApurar: Record<string, string>[] = []
      for (const papel of alvos.papeis) {
        const t = titulares.find((x) => x.papel === papel)
        // A IDENTIDADE É O QUE AUTORIZA A BUSCA AUTOMÁTICA. Documento para
        // qualquer um; OAB serve para o advogado, porque é dela que o Escavador
        // devolve o CPF dele.
        const temIdentidade = Boolean(t?.documento) || (papel === 'ADVOGADO' && Boolean(t?.oab))
        if (t && temIdentidade) {
          paraApurar.push({
            papel,
            nome: t.nome,
            documento: t.documento,
            oab: t.oab,
          })
        }
      }
      if (paraApurar.length === 0) {
        setPasso(null)
        return
      }
      setPasso('apurando')
      await apurar(paraApurar)
      setPasso(null)
    })()
    // As funções são recriadas a cada render e entrariam aqui como dependência
    // instável; a trava por `leadId` é o que garante uma execução por card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, carregando, erro, lendoPdf, apuracoes.length, leadId])

  // ------------------------------------------------------------- a tabela

  /** De quem é cada processo — só interessa quando há mais de um titular. */
  const deQuem = useMemo(
    () =>
      new Map(
        apuracoes.map((a) => [a.id, a.papel === 'ADVOGADO' ? 'advogado' : 'cedente'] as const),
      ),
    [apuracoes],
  )
  const maisDeUmTitular = apuracoes.length > 1

  /** O que pesa primeiro: quem abre a tabela procura a execução em curso. */
  const processosOrdenados = useMemo(() => {
    const peso = (r: unknown) => (r === 'ALTO' ? 0 : r === 'ATENCAO' ? 1 : 2)
    return processos.slice().sort((a, b) => peso(a.risco) - peso(b.risco))
  }, [processos])

  /**
   * O QUE A APURAÇÃO NÃO CONSEGUIU, num lugar só.
   *
   * A lacuna é a diferença entre "procurei e não achei" e "não procurei", e
   * some da tela se ninguém a escrever. Vem de dois lugares — o que a leitura
   * dos autos não achou e o que a busca ressalvou (nome sem CPF, lista
   * truncada) — e não faz sentido separá-los para quem lê.
   */
  const avisos = useMemo(() => {
    const dasApuracoes = apuracoes
      .flatMap((a) => [
        a.status === 'FALHA'
          ? `Não apurei ${a.papel === 'ADVOGADO' ? 'o advogado' : 'o cedente'}: ${a.observacao ?? 'falha na consulta'}`
          : null,
        a.status === 'APURADO' ? a.observacao : null,
      ])
      .filter((x): x is string => Boolean(x))
    return [...new Set([...avisosDaLeitura, ...dasApuracoes])]
  }, [apuracoes, avisosDaLeitura])

  /**
   * Os processos apurados, no formato que a janela do desfecho marca.
   *
   * O GRAU É O DA DILIGÊNCIA, sem tradução criativa: risco alto continua "ALTO"
   * e atenção continua "ATENÇÃO". Promovê-lo a IMPEDITIVO aqui faria a janela
   * afirmar, sobre um processo, algo que a apuração não afirmou.
   *
   * ORDENADOS PELO QUE PESA. Quem abre a janela para recusar procura a execução
   * em curso, não o inventário de 2014 — e ela tem de estar na primeira linha.
   */
  const itensParaRecusa: ItemDeRisco[] = useMemo(() => {
    const peso = (r: unknown) => (r === 'ALTO' ? 0 : r === 'ATENCAO' ? 1 : 2)
    const quem = new Map(apuracoes.map((a) => [a.id, a.papel === 'ADVOGADO' ? 'advogado' : 'cedente']))
    return processos
      .slice()
      .sort((a, b) => peso(a.risco) - peso(b.risco))
      .map((p) => {
        const partes = [
          p.objeto,
          Number(p.valor_cobrado) > 0 ? brl(p.valor_cobrado) : null,
          p.estagio,
          p.polo === 'PASSIVO' ? 'contra o ' + (quem.get(p.historico_id) ?? 'cedente') : null,
        ].filter(Boolean)
        return {
          grau: p.risco === 'ALTO' ? 'ALTO' : p.risco === 'ATENCAO' ? 'ATENÇÃO' : 'NOTA',
          texto: p.numero_processo + (partes.length ? ' — ' + partes.join(', ') : ''),
          fundamento: p.risco_motivo ?? undefined,
        } as ItemDeRisco
      })
  }, [processos, apuracoes])

  // Os itens sobem para a janela, que é onde ficam os botões de desfecho.
  useEffect(() => {
    onItensDeRisco?.(itensParaRecusa)
  }, [itensParaRecusa, onItensDeRisco])

  if (carregando) return <Loading label="Lendo a diligência…" />

  /** Um campo de identidade, que é tudo o que esta tela pede de entrada. */
  const campo = (
    rotulo: string,
    valor: string,
    onChange: (v: string) => void,
    dica?: string,
    documento = false,
  ) => (
    <Field label={rotulo} hint={dica}>
      <Input
        value={valor}
        disabled={apurando || lendoTitulares}
        inputMode={documento ? 'numeric' : undefined}
        onChange={(e) => onChange(documento ? formatCpfCnpjInput(e.target.value) : e.target.value)}
      />
    </Field>
  )

  return (
    <div className="space-y-4">
      {erro && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* A CORRENTE EM CURSO, dita passo a passo. Uma janela que abre e fica
          parada por vinte segundos se lê como travada — e quem não sabe que a
          máquina está trabalhando começa a preencher os campos à mão. */}
      {(lendoPdf || passo) && (
        <p className="flex items-center gap-2 text-sm text-brand-700">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {lendoPdf
            ? 'Lendo os anexos do card…'
            : passo === 'lendo'
              ? 'Identificando os titulares nos autos…'
              : 'Procurando processos no Escavador…'}
        </p>
      )}

      {/* OS CAMPOS DO TITULAR, e só eles.
          Eles chegam preenchidos pela leitura dos autos; ficam editáveis porque
          é aqui que se corrige um homônimo ou um CPF que o PDF trouxe cortado —
          e porque, corrigido o campo, o Reapurar é o que refaz a busca. Quais
          campos aparecem depende da verba cedida: numa cessão só de honorários
          não há cedente a apurar, e um campo de cedente ali seria um convite a
          apurar quem não é parte do negócio. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {pedeCedente && (
          <>
            {campo('Cedente', cedenteNome, setCedenteNome)}
            {campo(
              'CPF do cedente',
              cedenteCpf,
              setCedenteCpf,
              'Sem CPF a busca vai pelo nome, e homônimo entra.',
              true,
            )}
          </>
        )}
        {pedeAdvogado && (
          <>
            {campo(alvos.cedenteEhOAdvogado ? 'Advogado (é quem cede)' : 'Advogado', advNome, setAdvNome)}
            {campo('OAB', advOab, setAdvOab, 'Como nos autos: "GO 12345".')}
            {campo('CPF do advogado', advCpf, setAdvCpf, undefined, true)}
          </>
        )}
      </div>

      {/* AS SUGESTÕES SÓ APARECEM QUANDO O CAMPO ESTÁ VAZIO — ou seja, quando a
          leitura dos autos não achou o documento. No caminho normal a janela
          não as mostra; elas são a saída para quando a leitura falha, e não uma
          lista para conferir de rotina. */}
      {pedeCedente && !onlyDigits(cedenteCpf) && cpfsSugeridos.length > 0 && (
        <div>
          <p className="text-xs text-slate-500">
            Não achei o CPF nos autos. Estes aparecem nos anexos:
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {cpfsSugeridos.map((c) => (
              <button
                key={c.cpf}
                type="button"
                title={c.contexto}
                onClick={() => setCedenteCpf(formatCpfCnpjInput(c.cpf))}
                className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:ring-brand-300"
              >
                {formatCpfCnpjInput(c.cpf)}
              </button>
            ))}
          </div>
        </div>
      )}
      {pedeAdvogado && !advOab.trim() && !onlyDigits(advCpf) && oabsSugeridas.length > 0 && (
        <div>
          <p className="text-xs text-slate-500">Não achei a OAB nos autos. Estas aparecem nos anexos:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {oabsSugeridas.map((o) => (
              <button
                key={o.uf + o.numero}
                type="button"
                title={o.contexto}
                onClick={() => {
                  setAdvOab(o.uf + ' ' + o.numero)
                  if (o.nome) setAdvNome(o.nome)
                }}
                className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:ring-brand-300"
              >
                {o.uf} {o.numero}
                {o.nome && <span className="text-slate-400"> · {o.nome}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* O QUE A APURAÇÃO NÃO CONSEGUIU, dito em voz alta: busca pelo nome,
          lista truncada, titular não identificado. A lacuna é a diferença entre
          "procurei e não achei" e "não procurei", e some da tela se ninguém a
          escrever. */}
      {avisos.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          {avisos.map((a) => (
            <li key={a} className="text-xs text-amber-800">
              {a}
            </li>
          ))}
        </ul>
      )}

      {!passo && !lendoPdf && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void apurar()}
            loading={apurando}
            disabled={lendoTitulares}
            icon={<Search className="h-4 w-4" />}
          >
            {apuracoes.length > 0 ? 'Reapurar' : 'Apurar no Escavador'}
          </Button>
          {custo && <span className="text-xs text-slate-500">Custo desta consulta: {custo}</span>}
        </div>
      )}

      {/* A TABELA, UMA SÓ. Antes eram uma por titular apurado, com cabeçalho de
          seção cada uma; com um titular — que é o caso normal — a moldura era
          maior que o conteúdo. A coluna "de quem" só aparece quando há mais de
          um, que é quando a pergunta existe. */}
      {processos.length === 0 ? (
        <EmptyState
          title={
            apuracoes.some((a) => a.status === 'APURADO')
              ? 'Nenhum processo em nome dos titulares'
              : 'Nada apurado ainda'
          }
          description={
            apuracoes.some((a) => a.status === 'APURADO')
              ? 'A busca correu e não achou processo nenhum além do próprio crédito.'
              : 'Confira os campos acima e clique em Apurar no Escavador.'
          }
        />
      ) : (
        <Table dense>
          <THead>
            <TR>
              <TH>Processo</TH>
              <TH>Objeto</TH>
              {maisDeUmTitular && <TH>De quem</TH>}
              <TH>Polo</TH>
              <TH className="text-right">Valor da causa</TH>
              <TH>Estágio</TH>
              <TH>Risco para a cessão</TH>
            </TR>
          </THead>
          <TBody>
            {processosOrdenados.map((p) => (
              <TR key={p.id}>
                <TD className="whitespace-nowrap font-mono text-xs">
                  {p.url_fonte ? (
                    <a
                      href={p.url_fonte}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                    >
                      {p.numero_processo}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    p.numero_processo
                  )}
                  {p.tribunal && <span className="block text-slate-400">{p.tribunal}</span>}
                </TD>
                <TD>{p.objeto ?? '—'}</TD>
                {maisDeUmTitular && (
                  <TD className="text-xs">{deQuem.get(p.historico_id) ?? '—'}</TD>
                )}
                <TD>
                  <Badge tone={p.polo === 'PASSIVO' ? 'orange' : 'gray'} size="sm">
                    {p.polo === 'PASSIVO' ? 'réu' : p.polo === 'ATIVO' ? 'autor' : 'terceiro'}
                  </Badge>
                </TD>
                <TD className="text-right tabular-nums">{brl(p.valor_cobrado)}</TD>
                <TD className="text-xs">{p.estagio ?? '—'}</TD>
                <TD>
                  <Badge tone={TOM_DO_RISCO[String(p.risco)] ?? 'gray'} size="sm">
                    {p.risco === 'NENHUM' ? 'sem risco' : String(p.risco).toLowerCase()}
                  </Badge>
                  {p.risco_motivo && (
                    <p className="mt-1 text-xs text-slate-600">{p.risco_motivo}</p>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
