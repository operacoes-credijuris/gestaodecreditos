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
// do que a planilha ia imprimir, dois botões de leitura, uma seção por titular
// apurado e as listas de CPFs e OABs achados nos anexos. Essas últimas eram o
// erro mais fácil de defender e o pior de manter: seis CPFs e cinco OABs de
// pessoas que aparecem nos autos — o procurador do Estado, o advogado da outra
// parte, o sócio citado numa procuração — oferecidos como se algum deles fosse a
// resposta. Quem identifica o titular é a leitura dos autos, que sabe QUAL papel
// procura; o que ela não achar se digita.
//
// O que sobrou é o que se olha: de quem estamos falando, e o que existe em nome
// dele. Os desfechos ficam no rodapé da janela (ver DueDiligence), porque são o
// que se faz depois de ler isto.
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
import { AlertTriangle, ExternalLink, Info, RefreshCw, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { formatCpfCnpjInput, onlyDigits } from '@/lib/format'
import { classificarParcelaCedida, lerTituloCard } from '@/lib/kommo'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'
import type {
  ApuracaoDD,
  ProcessoDD,
} from '../../supabase/functions/_shared/dueDiligencia.ts'
import {
  alvosDaCessao,
  type PapelApurado,
  type TitularLido,
} from '../../supabase/functions/_shared/titularesDaCessao.ts'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState, Loading, Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import type { ItemDeRisco } from '@/components/JanelaDeDesfecho'

/**
 * Um titular na tela: o rótulo que aparece e os papéis por trás dele.
 *
 * OS DOIS, porque quem lê precisa de um e quem decide precisa do outro. A aba
 * diz "Cedente e advogado" quando o mesmo CPF ocupa os dois papéis; a recusa,
 * porém, é do PAPEL — e recusar aquele grupo derruba as duas verbas.
 */
export interface GrupoDeTitular {
  key: string
  label: string
  papeis: PapelApurado[]
}

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

/**
 * A ORDEM DOS TITULARES NA TELA, que não é a alfabética.
 *
 * A consulta trazia por `papel`, e alfabeticamente ADVOGADO vem antes de
 * CEDENTE — a aba do advogado abria primeiro num crédito cujo titular é o
 * cedente. A ordem certa é a do negócio: quem cede o principal primeiro, quem
 * cede os honorários depois.
 */
const ORDEM_DO_PAPEL: Record<string, number> = { CEDENTE: 0, CONJUGE: 1, PJ: 2, ADVOGADO: 3 }

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
  onItensDeRisco?: (itens: ItemDeRisco[], grupos: GrupoDeTitular[]) => void
}) {
  const toast = useToast()
  const [carregando, setCarregando] = useState(true)
  const [apurando, setApurando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [custo, setCusto] = useState<string | null>(null)
  const [apuracoes, setApuracoes] = useState<ApuracaoDD[]>([])
  const [processos, setProcessos] = useState<ProcessoNaTela[]>([])

  // O NOME DO CARD SÓ ENTRA SE O CEDENTE FOR TITULAR DE ALGUMA VERBA CEDIDA.
  // Numa cessão só de honorários, prefixar o campo com o nome dele faria a
  // busca por NOME disparar no Refazer — cinco páginas pagas sobre quem não é
  // parte do negócio, por causa de um preenchimento que ninguém pediu.
  const [cedenteNome, setCedenteNome] = useState(
    alvosDaCessao(classificarParcelaCedida(lerTituloCard(tituloDoCard).parcelaCedida)).papeis.includes(
      'CEDENTE',
    )
      ? (cedenteDoCard ?? '')
      : '',
  )
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
  /** Qual titular está aberto na tabela. Vazio até a apuração chegar. */
  const [abaDoTitular, setAbaDoTitular] = useState('')

  // ------------------------------------------------- de quem é o que compramos
  //
  // A DILIGÊNCIA É DO TITULAR DA VERBA, e o título do card já diz qual verba é.
  // Procurar sempre pelo cedente E pelo advogado apura quem não é parte do
  // negócio: numa cessão só de honorários as dívidas do exequente não alcançam
  // nada, e numa cessão só do principal as do advogado também não. Cada consulta
  // a mais é paga, e cada alerta a mais sobre quem não importa ensina quem lê a
  // ignorar o alerta.
  //
  // ISTO GOVERNA O PREENCHIMENTO, e não a existência dos campos: os cinco estão
  // sempre à vista, e a leitura dos autos preenche só os titulares daqui. O que
  // fica em branco não vira busca.
  const alvos = useMemo(
    () => alvosDaCessao(classificarParcelaCedida(lerTituloCard(tituloDoCard).parcelaCedida)),
    [tituloDoCard],
  )

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
    setApuracoes(
      ((h.data ?? []) as ApuracaoDD[])
        .slice()
        .sort(
          (a, b) =>
            (ORDEM_DO_PAPEL[String(a.papel)] ?? 9) - (ORDEM_DO_PAPEL[String(b.papel)] ?? 9),
        ),
    )
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
      toast.error(
        'Os anexos deste card não têm texto para ler — processo digitalizado só tem imagem. ' +
          'Preencha os titulares à mão.',
      )
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
      // A LACUNA VAI PARA O TOAST, e não para uma caixa fixa sobre a tabela.
      // Ela é do MOMENTO da leitura; permanente, repetiria a mesma frase em toda
      // reabertura do card e empurraria a tabela para baixo. O registro que fica
      // é a observação em dd_historico, que a análise lê.
      for (const a of r.avisos ?? []) toast.error(a)
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
   * CAMPO EM BRANCO NÃO DISPARA NADA, e é essa a regra inteira. Quem decide de
   * quem se procura dívida é o preenchimento: a leitura dos autos preenche só os
   * titulares das verbas que o título declara, e quem opera pode acrescentar ou
   * apagar. Uma consulta paga sobre quem não é parte do negócio devolveria
   * alerta sobre dívida que não alcança o crédito — pior do que não apurar.
   */
  function alvosDosCampos(): Record<string, string>[] {
    const saida: Record<string, string>[] = []
    const cpf = onlyDigits(cedenteCpf)
    if (cedenteNome.trim() || cpf) {
      saida.push({ papel: 'CEDENTE', nome: cedenteNome.trim(), documento: cpf })
    }
    if (advNome.trim() || advOab.trim() || onlyDigits(advCpf)) {
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
      toast.error('Preencha o titular de quem se vai procurar dívida — os campos estão vazios.')
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

  /**
   * AS ABAS DA TABELA: uma por PESSOA, não uma por papel.
   *
   * Numa cessão de honorários o cedente É o advogado, e o mesmo CPF vira duas
   * apurações — as linhas 10 e 11 do questionário perguntam por pessoas
   * diferentes, e quando são a mesma as duas têm de responder. Na tela, porém,
   * duas abas com a mesma lista são duas abas erradas: quem clica na segunda
   * procura outra coisa e encontra a primeira de novo.
   */
  const abasDeTitular = useMemo(() => {
    const porPessoa = new Map<string, { ids: string[]; papeis: string[]; cru: PapelApurado[] }>()
    for (const a of apuracoes) {
      const chave = a.documento || a.oab || a.nome || a.id
      const atual = porPessoa.get(chave) ?? { ids: [], papeis: [], cru: [] }
      atual.ids.push(a.id)
      const papel = a.papel === 'ADVOGADO' ? 'Advogado' : a.papel === 'CEDENTE' ? 'Cedente' : String(a.papel)
      if (!atual.papeis.includes(papel)) atual.papeis.push(papel)
      if (a.papel === 'CEDENTE' || a.papel === 'ADVOGADO') {
        if (!atual.cru.includes(a.papel)) atual.cru.push(a.papel)
      }
      porPessoa.set(chave, atual)
    }
    return [...porPessoa.values()].map((v) => ({
      key: v.ids[0],
      ids: v.ids,
      // "Cedente e advogado" numa aba só, que é o que aquela pessoa é.
      label: v.papeis.join(' e '),
      papeis: v.cru,
    }))
  }, [apuracoes])

  /** O que pesa primeiro: quem abre a tabela procura a execução em curso. */
  const processosOrdenados = useMemo(() => {
    const peso = (r: unknown) => (r === 'ALTO' ? 0 : r === 'ATENCAO' ? 1 : 2)
    return processos.slice().sort((a, b) => peso(a.risco) - peso(b.risco))
  }, [processos])

  /**
   * A aba aberta acompanha o que existe.
   *
   * Sem isto, a aba escolhida continuaria apontando para a apuração do card
   * ANTERIOR depois de trocar de crédito, e a tabela abriria vazia sobre uma
   * lista cheia. Reapurar também troca os ids: a apuração é reescrita.
   */
  useEffect(() => {
    if (abasDeTitular.length === 0) return
    if (abasDeTitular.some((a) => a.key === abaDoTitular)) return
    setAbaDoTitular(abasDeTitular[0].key)
  }, [abasDeTitular, abaDoTitular])



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
    const rotuloDoTitular = new Map(
      abasDeTitular.flatMap((g) => g.ids.map((id) => [id, g.label] as const)),
    )
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
          // O TITULAR VAI JUNTO. É o que deixa a recusa ser de uma verba só: sem
          // ele, marcar dois processos não diz de quem eles são.
          grupo: rotuloDoTitular.get(p.historico_id) ?? '',
        } as ItemDeRisco
      })
  }, [processos, apuracoes, abasDeTitular])

  // Os itens sobem para a janela, que é onde ficam os botões de desfecho.
  useEffect(() => {
    onItensDeRisco?.(itensParaRecusa, abasDeTitular)
  }, [itensParaRecusa, abasDeTitular, onItensDeRisco])

  if (carregando) return <Loading label="Lendo a diligência…" />

  /**
   * A dica que não cabe embaixo do campo.
   *
   * NUM "i" AO LADO DO RÓTULO, e não numa linha de texto cinza sob cada caixa:
   * são três campos numa janela que já tem tabela, e três linhas de explicação
   * empurravam a tabela — o conteúdo — para fora da vista. Quem precisa da
   * explicação passa o mouse; quem já sabe não paga por ela.
   */
  const comDica = (rotulo: string, dica: string) => (
    <span className="inline-flex items-center gap-1">
      {rotulo}
      <span title={dica} aria-label={dica} className="cursor-help text-slate-400">
        <Info className="h-3.5 w-3.5" />
      </span>
    </span>
  )

  const campo = (
    rotulo: React.ReactNode,
    valor: string,
    onChange: (v: string) => void,
    documento = false,
  ) => (
    <Field label={rotulo}>
      <Input
        value={valor}
        disabled={apurando || lendoTitulares}
        inputMode={documento ? 'numeric' : undefined}
        onChange={(e) => onChange(documento ? formatCpfCnpjInput(e.target.value) : e.target.value)}
      />
    </Field>
  )

  /** Refazer a busca, e o que ela custou. */
  const refazer = (
    <div className="flex items-center justify-end gap-3">
      {custo && <span className="text-xs text-slate-500">Custo: {custo}</span>}
      <Button
        size="sm"
        variant="outline"
        onClick={() => void apurar()}
        loading={apurando}
        disabled={lendoTitulares || Boolean(passo)}
        icon={<Search className="h-4 w-4" />}
      >
        {apuracoes.length > 0 ? 'Refazer' : 'Apurar'}
      </Button>
    </div>
  )

  const idsDaAba = abasDeTitular.find((a) => a.key === abaDoTitular)?.ids ?? []
  // De-duplicado por processo: com o mesmo CPF em dois papéis, as duas apurações
  // guardam a mesma lista, e sem isto cada linha apareceria duas vezes.
  const daAba = processosOrdenados.filter(
    (x, i, todos) =>
      idsDaAba.includes(x.historico_id) &&
      todos.findIndex((y) => y.numero_processo === x.numero_processo) === i,
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

      {/* OS CAMPOS DO TITULAR, e só eles. Chegam preenchidos pela leitura dos
          autos e ficam editáveis porque é aqui que se corrige um homônimo ou um
          CPF que o PDF trouxe cortado — e, corrigido o campo, o Reapurar refaz a
          busca. Quais campos aparecem depende da verba cedida. */}
      {/* OS CINCO CAMPOS ESTÃO SEMPRE À VISTA, e o que decide a busca é o que
          está PREENCHIDO neles — campo em branco não dispara requisição.
          Esconder os campos do titular que não entra na cessão era mais direto,
          e estava errado por duas razões: some da tela a informação de que
          existe outro titular, e tira de quem opera a única saída para o caso em
          que ele discorda da leitura do título ("o card diz principal, mas os
          honorários vêm junto"). Preencher continua sendo um ato, e é ele que
          gasta consulta.

          QUEM PREENCHE É A LEITURA DOS AUTOS, e ela só procura os titulares das
          verbas que o título declara (ver alvosDaCessao): numa cessão só do
          principal os três campos do advogado ficam vazios, e nada é buscado em
          nome dele. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {campo('Cedente', cedenteNome, setCedenteNome)}
        {campo(
          comDica('CPF do cedente', 'Sem CPF a busca vai pelo nome, e homônimo entra.'),
          cedenteCpf,
          setCedenteCpf,
          true,
        )}
        {campo(
          alvos.cedenteEhOAdvogado ? 'Advogado (é quem cede)' : 'Advogado',
          advNome,
          setAdvNome,
        )}
        {campo(
          comDica('OAB', 'Serve para achar o CPF dele — a busca de dívida é sempre por CPF.'),
          advOab,
          setAdvOab,
        )}
        {campo('CPF do advogado', advCpf, setAdvCpf, true)}
      </div>

      {/* UMA TABELA POR TITULAR, em abas.
          A coluna "de quem" repetia "cedente" em vinte linhas seguidas para
          dizer o que o cabeçalho diz uma vez — e, com os dois titulares, misturava
          na mesma lista duas perguntas diferentes: a dívida do cedente e a do
          advogado respondem linhas distintas do questionário. Com um titular só
          a régua de abas não aparece: uma aba solitária não é uma escolha. */}
      {/* A LINHA DOS TITULARES, com o Reapurar na ponta.
          Ele estava no canto da grade de campos, e ali se lia como um controle
          DAQUELES CAMPOS — algo que confirma o que se acabou de digitar. É o
          contrário: ele refaz a busca inteira, cujos resultados as abas apenas
          recortam. Na borda desta linha, encostado na tabela que ele reescreve,
          está no lugar certo.

          A régua aparece com um titular só, e é de propósito: aqui ela não
          sugere uma visão escondida, ela ROTULA de quem é a tabela — sem ela,
          "94 processos" ficaria sem dono na tela. */}
      {abasDeTitular.length > 0 && (
        <Tabs
          items={abasDeTitular.map((a) => ({
            key: a.key,
            label: a.label,
            count: new Set(
              processos.filter((x) => a.ids.includes(x.historico_id)).map((x) => x.numero_processo),
            ).size,
          }))}
          value={abaDoTitular}
          onChange={setAbaDoTitular}
          trailing={refazer}
          trailingNaBorda
        />
      )}
      {abasDeTitular.length === 0 && <div className="flex justify-end">{refazer}</div>}

      {daAba.length === 0 ? (
        <EmptyState
          title={
            apuracoes.some((a) => idsDaAba.includes(a.id) && a.status === 'APURADO')
              ? 'Nenhum processo contra ele'
              : 'Nada apurado ainda'
          }
          description={
            apuracoes.some((a) => idsDaAba.includes(a.id) && a.status === 'APURADO')
              ? 'A busca correu e não achou nenhum processo em que ele seja réu.'
              : 'Confira os campos acima e clique em Apurar.'
          }
        />
      ) : (
        <Table dense>
          <THead>
            <TR>
              <TH>Processo</TH>
              <TH>Objeto</TH>
              <TH>Polo</TH>
              {/* nowrap: sem ele o cabeçalho quebra em "VALOR DA / CAUSA" e a
                  linha do cabeçalho fica com o dobro da altura das outras. */}
              <TH className="whitespace-nowrap text-right">Valor da causa</TH>
              <TH>Estágio</TH>
              <TH className="whitespace-nowrap">Risco</TH>
            </TR>
          </THead>
          <TBody>
            {daAba.map((x) => (
              <TR key={x.id}>
                <TD className="whitespace-nowrap font-mono text-xs">
                  {x.url_fonte ? (
                    <a
                      href={x.url_fonte}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                    >
                      {x.numero_processo}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    x.numero_processo
                  )}
                  {x.tribunal && <span className="block text-slate-400">{x.tribunal}</span>}
                </TD>
                <TD>{x.objeto ?? '—'}</TD>
                <TD>
                  <Badge tone={x.polo === 'PASSIVO' ? 'orange' : 'gray'} size="sm">
                    {x.polo === 'PASSIVO' ? 'réu' : x.polo === 'ATIVO' ? 'autor' : 'terceiro'}
                  </Badge>
                </TD>
                <TD className="text-right tabular-nums">{brl(x.valor_cobrado)}</TD>
                <TD className="text-xs">{x.estagio ?? '—'}</TD>
                {/* O SELO, SEM O PARÁGRAFO. O motivo do risco continua no banco e
                    vai para a anotação quando a IA redige a recusa; na tabela ele
                    triplicava a altura de cada linha e enterrava as colunas que se
                    comparam de relance. Fica no title, para quem quiser. */}
                <TD>
                  {/* nowrap no selo: "sem risco" quebrava em duas linhas e
                      esticava a altura da linha inteira por causa de um rótulo
                      de nove caracteres. */}
                  <span className="whitespace-nowrap" title={x.risco_motivo ?? undefined}>
                    <Badge tone={TOM_DO_RISCO[String(x.risco)] ?? 'gray'} size="sm">
                      {x.risco === 'NENHUM' ? 'sem risco' : String(x.risco).toLowerCase()}
                    </Badge>
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
