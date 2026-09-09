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
import { AlertTriangle, ExternalLink, RefreshCw, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { formatCpfCnpjInput, formatDate, onlyDigits } from '@/lib/format'
import { acharCpfs } from '@/lib/cpfNoTexto'
import { acharOabs } from '@/lib/dadosNoTexto'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'
import {
  historicoDoCredito,
  type ApuracaoDD,
  type ProcessoDD,
} from '../../supabase/functions/_shared/dueDiligencia.ts'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState, Loading, Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'

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
  cedenteDoCard,
  arquivos,
  ativo,
}: {
  leadId: number
  cedenteDoCard: string
  /** Os PDFs já lidos na tela: é deles que saem os CPFs e as OABs sugeridos. */
  arquivos: ArquivoLido[]
  ativo: boolean
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

  // ------------------------------------------------------------------ ação

  async function apurar() {
    const alvos: Record<string, string>[] = []
    const cpf = onlyDigits(cedenteCpf)
    if (cedenteNome.trim() || cpf) {
      alvos.push({ papel: 'CEDENTE', nome: cedenteNome.trim(), documento: cpf })
    }
    if (advOab.trim()) {
      alvos.push({ papel: 'ADVOGADO', nome: advNome.trim(), oab: advOab.trim() })
    }
    if (alvos.length === 0) {
      toast.error('Informe ao menos o CPF do cedente ou a OAB do advogado.')
      return
    }

    setApurando(true)
    setErro(null)
    try {
      const r = await invokeFunction<{
        custo?: string
        apuracoes?: { papel: string; status: string; total: number; observacao?: string | null }[]
      }>('dd-processos', { lead_id: leadId, alvos })
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
        <p className="mt-1 text-sm text-slate-600">
          A busca é por CPF no Escavador. O advogado entra pela OAB — nos autos ele não tem
          CPF, e é dela que o CPF dele é obtido antes de procurar dívida em seu nome.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Cedente">
            <Input
              value={cedenteNome}
              onChange={(e) => setCedenteNome(e.target.value)}
              placeholder="Nome do cedente"
            />
          </Field>
          <Field label="CPF do cedente" hint="Sem CPF a busca vai pelo nome, e homônimo entra.">
            <Input
              value={cedenteCpf}
              onChange={(e) => setCedenteCpf(formatCpfCnpjInput(e.target.value))}
              placeholder="000.000.000-00"
              inputMode="numeric"
            />
          </Field>
          <Field label="Advogado">
            <Input
              value={advNome}
              onChange={(e) => setAdvNome(e.target.value)}
              placeholder="Nome do advogado (opcional)"
            />
          </Field>
          <Field label="OAB do advogado" hint='Como nos autos: "GO 12345".'>
            <Input
              value={advOab}
              onChange={(e) => setAdvOab(e.target.value)}
              placeholder="GO 12345"
            />
          </Field>
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
                  onClick={() => setCedenteCpf(formatCpfCnpjInput(c.cpf))}
                  className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:ring-brand-300"
                >
                  {formatCpfCnpjInput(c.cpf)}
                </button>
              ))}
            </div>
          </div>
        )}
        {oabsSugeridas.length > 0 && (
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
    </div>
  )
}
