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
// POR ISSO O PLACAR NO TOPO. Ele mostra, com as mesmas funções que o servidor
// usa, exatamente o que vai sair impresso nas duas células. Uma tela de
// diligência que não mostra sua própria consequência convida a apurar e não
// olhar.
//
// A APURAÇÃO CUSTA DINHEIRO — a API do Escavador é paga por requisição — então
// o botão é explícito, nunca automático, e o custo da chamada volta na tela.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, ExternalLink, RefreshCw, ScanText, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { formatCpfCnpjInput, formatDate, onlyDigits } from '@/lib/format'
import { acharCpfs } from '@/lib/cpfNoTexto'
import { acharOabs } from '@/lib/dadosNoTexto'
import { classificarParcelaCedida, lerTituloCard, type AcaoTela } from '@/lib/kommo'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'
import {
  historicoDoCredito,
  type ApuracaoDD,
  type ProcessoDD,
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
// A MESMA JANELA DA ANÁLISE. Marcar o que motivou, escrever, deixar a IA redigir
// para quem lê no card: a recusa por diligência não é um segundo jeito de
// reprovar, é o mesmo jeito com outros itens para marcar.
import { JanelaDeDesfecho, type ItemDeRisco } from '@/components/JanelaDeDesfecho'

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
  ativo,
  acaoRecusar,
  onMover,
}: {
  leadId: number
  /** O título do card — é dele que sai QUAIS verbas estão sendo cedidas. */
  tituloDoCard: string
  cedenteDoCard: string
  /** Os PDFs já lidos na tela: é deles que saem os CPFs e as OABs sugeridos. */
  arquivos: ArquivoLido[]
  ativo: boolean
  /**
   * A recusa, quando a etapa aberta a oferece.
   *
   * VEM DE FORA porque a coluna de destino é do FUNIL, e não desta janela: RPV e
   * Precatório numeram a mesma coluna com ids diferentes, e quem sabe em que
   * etapa o card está é a tela que o listou. Sem a ação, o painel mostra a
   * apuração e não oferece desfecho — que é o certo nas abas terminais.
   */
  acaoRecusar?: AcaoTela | null
  onMover?: (statusId: number, comentario: string) => Promise<void>
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
  const [recusando, setRecusando] = useState(false)
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
   * PREENCHE, NÃO DECIDE. O resultado cai nos campos e quem confere olha a
   * evidência antes de gastar consulta paga — um processo tem o CPF do cedente,
   * o do advogado, o do ente devedor e o de cada terceiro.
   */
  async function lerTitulares() {
    const texto = arquivos
      .map((a) => a.texto ?? '')
      .filter((t) => t.trim())
      .join('\n\n===== PRÓXIMO ARQUIVO =====\n\n')
    if (!texto.trim()) {
      toast.error(
        'Os anexos deste card não têm texto para ler — processo digitalizado só tem imagem.',
      )
      return
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
      const quantos = achados.filter((t) => t.nome).length
      if (quantos === 0) toast.error('Não identifiquei os titulares nos autos.')
      else toast.success(`${quantos} titular(es) identificado(s) — confira antes de apurar.`)
    } catch (e) {
      setErro((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setLendoTitulares(false)
    }
  }

  // ------------------------------------------------------------------ ação

  async function apurar() {
    // SÓ OS TITULARES DA VERBA CEDIDA. Mandar os dois sempre gastaria consulta
    // paga com quem não é parte do negócio — e devolveria alerta sobre dívida
    // que não alcança o crédito, que é pior do que não apurar.
    const alvosParaApurar: Record<string, string>[] = []
    const cpf = onlyDigits(cedenteCpf)
    if (pedeCedente && (cedenteNome.trim() || cpf)) {
      alvosParaApurar.push({ papel: 'CEDENTE', nome: cedenteNome.trim(), documento: cpf })
    }
    if (pedeAdvogado && (advOab.trim() || onlyDigits(advCpf))) {
      alvosParaApurar.push({
        papel: 'ADVOGADO',
        nome: advNome.trim(),
        oab: advOab.trim(),
        documento: onlyDigits(advCpf),
      })
    }
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

  // -------------------------------------------------- o que a planilha dirá
  //
  // Calculado com A MESMA FUNÇÃO que o servidor usa para escrever as células.
  // Reimplementar a regra aqui só criaria uma segunda verdade.
  const linhas = useMemo(
    () => historicoDoCredito(apuracoes, processos),
    [apuracoes, processos],
  )

  const porApuracao = (id: string) => processos.filter((p) => p.historico_id === id)

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

  /**
   * A IA redige a recusa a partir dos processos marcados.
   *
   * `origem: 'diligencia'` não é etiqueta: é o que faz o texto explicar COMO um
   * processo de terceiro alcança esta operação — penhora do crédito cedido,
   * fraude à execução, massa falida. Sem isso a anotação listaria números de
   * processo e deixaria a conclusão por conta de quem lê.
   */
  async function redigirRecusa(desfecho: string, itens: string[], texto: string) {
    const r = await invokeFunction<{ mensagem?: string }>('redigir-desfecho', {
      desfecho,
      itens,
      texto,
      origem: 'diligencia',
      cedente: cedenteDoCard || null,
      numero_processo: lerTituloCard(tituloDoCard).numero || null,
    })
    const m = String(r?.mensagem ?? '').trim()
    if (!m) throw new Error('A IA não devolveu texto para a anotação.')
    return m
  }

  if (carregando) return <Loading label="Lendo a diligência…" />

  return (
    <div className="space-y-5">
      {erro && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* ------------------------------------------------ quem vamos procurar */}
      <section className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-slate-700">
          Apurar processos
        </h3>

        {/* QUEM SERÁ APURADO, E POR QUÊ — dito antes dos campos, porque é a
            decisão que os campos executam. A verba cedida sai do título do card;
            o titular dela é quem responde por dívida que alcança este crédito. */}
        <p className="mt-1 text-sm text-slate-600">{alvos.porque}</p>
        <p className="mt-1 text-xs text-slate-500">
          Verbas no título: <span className="font-medium">{alvos.verbas}</span>. A busca é por
          CPF no Escavador; o advogado entra pela OAB, de onde o CPF dele é obtido antes de
          procurar dívida em seu nome.
        </p>

        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={lerTitulares}
            loading={lendoTitulares}
            icon={<ScanText className="h-4 w-4" />}
          >
            Identificar titulares nos autos
          </Button>
        </div>

        {avisosDaLeitura.length > 0 && (
          <ul className="mt-2 space-y-1">
            {avisosDaLeitura.map((a) => (
              <li key={a} className="text-xs text-amber-700">
                {a}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {pedeCedente && (
            <>
              <Field label="Cedente">
                <Input
                  value={cedenteNome}
                  onChange={(e) => setCedenteNome(e.target.value)}
                  placeholder="Nome do cedente"
                />
              </Field>
              <Field
                label="CPF do cedente"
                hint="Sem CPF a busca vai pelo nome, e homônimo entra."
              >
                <Input
                  value={cedenteCpf}
                  onChange={(e) => setCedenteCpf(formatCpfCnpjInput(e.target.value))}
                  placeholder="000.000.000-00"
                  inputMode="numeric"
                />
              </Field>
            </>
          )}
          {pedeAdvogado && (
            <>
              <Field label={alvos.cedenteEhOAdvogado ? 'Advogado (é quem cede)' : 'Advogado'}>
                <Input
                  value={advNome}
                  onChange={(e) => setAdvNome(e.target.value)}
                  placeholder="Nome do advogado"
                />
              </Field>
              <Field
                label="OAB do advogado"
                hint={
                  onlyDigits(advCpf).length === 11
                    ? 'O CPF já veio dos autos — a OAB fica como conferência.'
                    : 'Como nos autos: "GO 12345".'
                }
              >
                <Input
                  value={advOab}
                  onChange={(e) => setAdvOab(e.target.value)}
                  placeholder="GO 12345"
                />
              </Field>
              {/* O CPF DO ADVOGADO, QUANDO OS AUTOS O TRAZEM, poupa uma consulta:
                  sem ele a apuração pergunta a OAB ao Escavador só para descobrir
                  o CPF antes de procurar dívida. */}
              <Field label="CPF do advogado" hint="Opcional: se vier, dispensa a busca pela OAB.">
                <Input
                  value={advCpf}
                  onChange={(e) => setAdvCpf(formatCpfCnpjInput(e.target.value))}
                  placeholder="000.000.000-00"
                  inputMode="numeric"
                />
              </Field>
            </>
          )}
        </div>

        {/* Sugestões do PDF: candidatos com o trecho ao lado, nunca escolha
            automática. Um processo tem o CPF do cedente, o do advogado e o de
            cada terceiro — adivinhar aqui é diligenciar a pessoa errada. */}
        {cpfsSugeridos.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              CPFs nos anexos
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {cpfsSugeridos.map((c) => (
                <button
                  key={c.cpf}
                  type="button"
                  title={c.contexto}
                  onClick={() =>
                    // Para o campo que esta cessão de fato pede: numa cessão só
                    // de honorários não há campo de cedente para preencher.
                    pedeCedente
                      ? setCedenteCpf(formatCpfCnpjInput(c.cpf))
                      : setAdvCpf(formatCpfCnpjInput(c.cpf))
                  }
                  className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:ring-brand-300"
                >
                  {formatCpfCnpjInput(c.cpf)}
                </button>
              ))}
            </div>
          </div>
        )}
        {pedeAdvogado && oabsSugeridas.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              OABs nos anexos
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {oabsSugeridas.map((o) => (
                <button
                  key={o.uf + o.numero}
                  type="button"
                  title={o.contexto}
                  onClick={() => {
                    setAdvOab(`${o.uf} ${o.numero}`)
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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={apurar} loading={apurando} icon={<Search className="h-4 w-4" />}>
            {apuracoes.length > 0 ? 'Reapurar no Escavador' : 'Apurar no Escavador'}
          </Button>
          <Button variant="ghost" onClick={() => void carregar()} icon={<RefreshCw className="h-4 w-4" />}>
            Recarregar
          </Button>
          {custo && <span className="text-xs text-slate-500">Custo desta consulta: {custo}</span>}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Reapurar substitui a foto anterior: os processos achados pelo Escavador são
          trocados pelos de agora.
        </p>
      </section>

      {/* --------------------------------------- o que vai sair na planilha */}
      {linhas.length > 0 && (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-slate-700">
            O que a análise vai imprimir
          </h3>
          <div className="mt-3 space-y-2">
            {linhas.map((l) => (
              <div key={l.papel} className="text-sm">
                <span className="font-medium text-slate-700">
                  Linha {l.linha} — histórico {l.papel === 'CEDENTE' ? 'do cedente' : 'do advogado'}:
                </span>{' '}
                {!l.apurada ? (
                  <Badge tone="gray">
                    {l.falhou ? 'apuração falhou' : 'não apurada'} — a IA responde
                  </Badge>
                ) : (
                  <Badge tone={l.temDivida ? 'red' : 'green'}>
                    {l.temDivida ? 'Sim, tem dívida' : 'Não'}
                  </Badge>
                )}
                {l.complemento && (
                  <p className="mt-0.5 text-xs text-slate-600">{l.complemento}</p>
                )}
                {l.indeterminados > 0 && (
                  <p className="mt-0.5 text-xs text-amber-700">
                    {l.indeterminados} processo(s) sem dizer se há valor cobrado — não contam
                    como dívida.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------- a apuração, por alvo */}
      {apuracoes.length === 0 ? (
        <EmptyState
          title="Nenhuma apuração ainda"
          description="Informe o CPF do cedente (e a OAB do advogado, se houver) e clique em Apurar. Enquanto ninguém apurar, as linhas 10 e 11 da análise continuam sendo respondidas pela leitura dos autos — que não enxerga dívida fora deste processo."
        />
      ) : (
        apuracoes.map((a) => {
          const meus = porApuracao(a.id)
          return (
            <section key={a.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-bold uppercase tracking-wide text-slate-700">
                    {a.papel === 'CEDENTE' ? 'Cedente' : a.papel === 'ADVOGADO' ? 'Advogado' : a.papel}
                    {' — '}
                    {a.nome}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {a.documento ? formatCpfCnpjInput(a.documento) : a.oab ? `OAB ${a.oab}` : '—'}
                    {a.apurado_em && ` · apurado em ${formatDate(a.apurado_em)}`}
                    {a.fonte && ` · fonte: ${a.fonte}`}
                  </p>
                </div>
                <Badge tone={a.status === 'APURADO' ? 'green' : a.status === 'FALHA' ? 'red' : 'gray'}>
                  {a.status === 'APURADO' ? 'apurado' : a.status === 'FALHA' ? 'falhou' : 'pendente'}
                </Badge>
              </header>

              {a.observacao && (
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 ring-1 ring-amber-200">
                  {a.observacao}
                </p>
              )}

              {meus.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">
                  {a.status === 'APURADO'
                    ? 'Nenhum processo em nome desta pessoa.'
                    : 'Nada a mostrar: a apuração não foi concluída.'}
                </p>
              ) : (
                <div className="mt-3">
                  <Table dense>
                    <THead>
                      <TR>
                        <TH>Processo</TH>
                        <TH>Objeto</TH>
                        <TH>Polo</TH>
                        <TH className="text-right">Valor da causa</TH>
                        <TH>Estágio</TH>
                        <TH>Risco para a cessão</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {meus
                        .slice()
                        .sort((x, y) =>
                          Number(y.risco === 'ALTO') - Number(x.risco === 'ALTO') ||
                          Number(y.risco === 'ATENCAO') - Number(x.risco === 'ATENCAO'),
                        )
                        .map((p) => (
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
                              {p.tribunal && (
                                <span className="block text-slate-400">{p.tribunal}</span>
                              )}
                            </TD>
                            <TD>{p.objeto ?? '—'}</TD>
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
                </div>
              )}
            </section>
          )
        })
      )}

      {/* A DECISÃO FICA DEPOIS DA LEITURA, e é essa a razão de ela estar no fim
          do painel e não no rodapé da janela: no rodapé pareceria valer para a
          aba de certidões também, e ficaria a um clique de quem só abriu para
          conferir. Aqui ela vem depois da lista que a fundamenta.

          SÓ COM APURAÇÃO. Recusar por processos que ninguém procurou seria
          assinar uma razão que não existe — e o botão sumido é mais honesto que
          um botão que abre uma janela sem nada para marcar. */}
      {acaoRecusar && onMover && apuracoes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <Button
            variant="danger"
            icon={<Ban className="h-4 w-4" />}
            onClick={() => setRecusando(true)}
            disabled={apurando}
          >
            {acaoRecusar.label}
          </Button>
          <span className="text-xs text-slate-500">
            {processos.length === 0
              ? 'Nenhum processo apurado: a recusa terá de ser escrita à mão.'
              : `Marque quais dos ${processos.length} processo(s) motivam a recusa.`}
          </span>
        </div>
      )}

      {recusando && acaoRecusar && onMover && (
        <JanelaDeDesfecho
          acao={acaoRecusar}
          achados={itensParaRecusa}
          onRedigir={redigirRecusa}
          onMover={onMover}
          onFechar={() => setRecusando(false)}
        />
      )}
    </div>
  )
}
