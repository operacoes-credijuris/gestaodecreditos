// Janela da análise de RPV: preliminar, conversa e só então o salvamento.
//
// ANTES, UM CLIQUE FAZIA TUDO: lia o PDF, qualificava, extraía, precificava,
// gerava a planilha, subia no Drive e anotava o card no Kommo. Se a IA lesse um
// valor errado, a planilha errada já estava no Drive e o "✅ APROVADO" já estava
// no card antes de alguém ver o número. Decisão do dono: a análise passa a ser
// PRELIMINAR até a pessoa dizer que está boa.
//
//   1. abre -> lê os anexos do card -> 'analisar' -> mostra os números, a síntese,
//      os riscos e os avisos. Nada gravado.
//   2. a pessoa pede mudanças em linguagem natural -> 'refinar' -> a IA revisa a
//      análise, o motor REPRECIFICA e a tela mostra a nova versão. Quantas vezes
//      quiser.
//   3. "Salvar no Drive" -> 'salvar' -> planilha, Drive, anotação no Kommo.
//
// A ANÁLISE INTEIRA (`dados`) VIAJA COM A TELA. A função é sem estado: cada turno
// recebe a análise atual, o pedido e o histórico curto, e devolve a análise nova.
// A tela é a única memória — fechar a janela sem salvar descarta tudo, e o modal
// avisa (dirty) antes de deixar fechar.
//
// A IA NÃO ESCREVE PREÇO. Ela revisa os DADOS (valores lidos, datas, respostas
// do questionário, riscos); deságio, prazo e preço de cessão são recalculados
// em código a partir deles. Quem pede "baixe o deságio" recebe a pergunta de
// volta: qual dado de entrada mudar.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Save, SendHorizontal, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { invokeFunction } from '@/lib/functions'
import { formatBRL, formatPercent } from '@/lib/format'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Table'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'

/** Fração -> "35,20%": formatPercent espera pontos percentuais. */
const pctBR = (fracao: number) => formatPercent(fracao * 100)

export interface ValoresRpv {
  bruto: number
  liquido_base: number
  desagio: number
  preco_cessao: number
  comissao: number
  cartorio: number | null
  custo_total: number
  rentabilidade_mensal: number
  prazo_meses: number
  data_pagamento: string | null
}
export interface CartorioRpv {
  valor: string
  escritura: string
  registro: string
  faixa: string
  uf: string | null
  origem: 'cache' | 'busca' | 'nenhuma'
  fontes: string[]
  /**
   * O preço de cessão para o qual a tela deve consultar o cartório — presente
   * só enquanto o custo não veio. É o que torna a consulta uma pergunta
   * concreta ("quanto custa uma cessão de R$ 52.500 em PE?") em vez de um
   * pedido para transcrever a tabela inteira do estado, que foi o que falhou.
   */
  preco_consulta?: number | null
}
interface Risco {
  risco: string
  fundamento?: string
  grau?: string
}
/** O que a gerar-analise-rpv devolve, em qualquer das três ações. */
export interface RespostaAnaliseRpv {
  ok?: boolean
  preliminar?: boolean
  reprovado?: boolean
  motivos?: string[]
  avisos?: string[]
  aviso?: string | null
  cedente?: string
  modelo?: string
  esfera?: string
  regra_prazo?: string
  prazo_detalhe?: string
  valores?: ValoresRpv
  cartorio?: CartorioRpv
  atingiu_alvo?: boolean
  m1_sintese?: string | null
  riscos?: Risco[]
  m2?: Record<string, { resposta?: string; complemento?: string }>
  resposta?: string | null
  /** A análise inteira, opaca para a tela: volta para a função no próximo turno. */
  dados?: unknown
  /**
   * O custo de cartório que a função usou — escritura + registro em reais —,
   * opaco aqui.
   *
   * Dá a volta pelo navegador pelo mesmo motivo de `dados`: consultá-lo custa
   * uma busca web de 10 a 30 s, e repetir isso a cada pedido do chat estourava
   * o teto de 150 s da requisição. Devolvendo-o, a função só consulta de novo
   * se a UF do tribunal mudar.
   */
  custo_cartorio?: unknown
  avisos_qualificacao?: string[]
  drive_file_url?: string | null
  drive_folder_url?: string | null
}

/** O que a página já sabe do card e a função precisa em toda chamada. */
export interface DadosDoCardRpv {
  numero_processo: string
  categoria: string
  intermediador: string
  tipo_aquisicao: string
  honorarios_pct: string
}

type Mensagem = { papel: 'usuario' | 'ia'; texto: string }

/**
 * A grade dos números finais. Exportada porque o card também a mostra depois de
 * salvar — a mesma grade nos dois lugares, para o número que a pessoa aprovou na
 * janela ser o mesmo que ela reencontra no card.
 */
export function GradeValoresRpv({
  valores,
  cartorio,
  atingiuAlvo,
}: {
  valores: ValoresRpv
  cartorio?: CartorioRpv
  atingiuAlvo?: boolean
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-700 sm:grid-cols-3">
      <div>
        <dt className="text-slate-500">Preço da cessão</dt>
        <dd className="font-display text-base font-semibold text-slate-900 tabular-nums">
          {formatBRL(valores.preco_cessao)}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Deságio</dt>
        <dd className="font-semibold tabular-nums">{pctBR(valores.desagio)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Rentabilidade</dt>
        <dd
          className={cn('font-semibold tabular-nums', atingiuAlvo === false && 'text-amber-700')}
        >
          {pctBR(valores.rentabilidade_mensal)} ao mês
          {atingiuAlvo === false && ' (abaixo da meta)'}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Prazo</dt>
        <dd className="tabular-nums">
          {valores.prazo_meses} meses
          {valores.data_pagamento && ` · pagamento ${valores.data_pagamento}`}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Cartório</dt>
        <dd className="tabular-nums">
          {valores.cartorio == null ? (
            // Ausente é dito como ausente: um preço sem cartório parece melhor do
            // que é, e um traço sozinho não avisa.
            <span className="text-amber-700">não incluído — confirmar</span>
          ) : (
            <>
              {formatBRL(valores.cartorio)}
              {cartorio && (
                <span className="text-slate-500">
                  {' '}
                  (escritura {cartorio.escritura} + registro {cartorio.registro}
                  {cartorio.uf && `, ${cartorio.uf}`})
                </span>
              )}
            </>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Custo total da operação</dt>
        <dd className="tabular-nums">
          {formatBRL(valores.custo_total)}
          <span className="text-slate-500"> (comissão {formatBRL(valores.comissao)})</span>
        </dd>
      </div>
      <div className="col-span-2 sm:col-span-3">
        <dt className="text-slate-500">Base do deságio</dt>
        <dd className="tabular-nums">
          {formatBRL(valores.liquido_base)}
          <span className="text-slate-500"> (bruto {formatBRL(valores.bruto)})</span>
        </dd>
      </div>
    </dl>
  )
}

export function AnaliseRpvModal({
  open,
  onClose,
  leadId,
  titulo,
  dadosDoCard,
  notasKommo,
  lerArquivos,
  onSalvo,
}: {
  open: boolean
  onClose: () => void
  leadId: number
  titulo: string
  dadosDoCard: DadosDoCardRpv
  /** Todas as anotações do card, do comercial: a IA lê junto com os autos. */
  notasKommo: string
  /** Lê (ou devolve do cache) os anexos do card. É da página, que já sabe fazer. */
  lerArquivos: () => Promise<ArquivoLido[]>
  /** Chamado depois de salvar, com a resposta final — a página anota no Kommo e atualiza o card. */
  onSalvo: (r: RespostaAnaliseRpv) => void
}) {
  const [passo, setPasso] = useState<string | null>('Lendo os anexos do card…')
  const [erro, setErro] = useState<string | null>(null)
  // O texto do processo NÃO fica em estado: ele é lido, mandado uma vez na
  // análise e descartado. Guardá-lo era o que permitia reenviá-lo a cada pedido
  // do chat — e era isso que estourava o tempo da requisição.
  const [atual, setAtual] = useState<RespostaAnaliseRpv | null>(null)
  /** Por que o cartório não entrou no preço, quando a busca da tabela falhou. */
  const [falhaCartorio, setFalhaCartorio] = useState<string | null>(null)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [pedido, setPedido] = useState('')
  const [salvo, setSalvo] = useState<RespostaAnaliseRpv | null>(null)
  const fimDoChat = useRef<HTMLDivElement>(null)

  const ocupado = passo !== null

  // Uma análise só, ao abrir. Reabrir a janela do mesmo card recomeça do zero
  // (a página monta a janela com `key` pelo card) — é o comportamento que se
  // quer: a preliminar não é rascunho salvo, é leitura fresca.
  const rodou = useRef(false)
  useEffect(() => {
    if (!open || rodou.current) return
    rodou.current = true
    void (async () => {
      try {
        const arquivos = await lerArquivos()
        // O ÚLTIMO PDF, como a análise de RPV sempre fez — e não "o último com
        // texto": com o cálculo digitalizado, o filtro faria a IA precificar a
        // petição inicial em silêncio, valor da causa no lugar do crédito.
        const pdfs = arquivos.filter((a) => a.paginas > 0 || a.texto.length > 0 || !a.erro)
        const alvo = pdfs[pdfs.length - 1] ?? arquivos[arquivos.length - 1]
        if (!alvo || alvo.texto.length === 0) {
          const porque = alvo?.erro
            ? alvo.erro
            : alvo?.digitalizado
              ? `tem ${alvo.paginas} página(s) e ${alvo.densidade} caractere(s) por página: parece digitalizado`
              : 'não trouxe texto selecionável'
          throw new Error(`O último PDF do card ("${alvo?.nome ?? '?'}") ${porque}.`)
        }
        let t = alvo.texto
        const MAX = 360000
        if (t.length > MAX) {
          const ini = Math.floor(MAX * 0.6)
          t = t.slice(0, ini) + '\n\n[...TRECHO INTERMEDIÁRIO OMITIDO POR TAMANHO...]\n\n' + t.slice(t.length - (MAX - ini))
        }
        setPasso('Qualificando e precificando…')
        const r = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
          acao: 'analisar',
          texto: t,
          notas_kommo: notasKommo,
          ...dadosDoCard,
        })
        setAtual(r)

        // O CARTÓRIO CHEGA DEPOIS, e de propósito, em DUAS etapas — que é o
        // jeito como se pergunta a um cartório: "quanto custa uma cessão DESTE
        // valor?". A análise calibra primeiro sem cartório e devolve o preço; a
        // consulta pergunta o custo PARA ESSE PREÇO; a reprecificação soma. A
        // consulta é requisição própria porque a busca web leva 10 a 30 s e,
        // dentro da análise, derrubava o worker (HTTP 546).
        const uf = r.cartorio?.uf
        const preco = r.cartorio?.preco_consulta
        if (!r.reprovado && uf && preco) {
          setPasso(`Consultando o cartório de ${uf} para ${formatBRL(preco)}…`)
          try {
            const e = await invokeFunction<{
              custo?: { total?: number | null; motivo?: string } | null
              motivo?: string
            }>('gerar-analise-rpv', { acao: 'emolumentos', uf, preco })
            // EXIGE O VALOR, não só o objeto. A consulta devolve
            // `{total: null, motivo}` quando não acha nada — verificar só
            // `e.custo` daria verdadeiro nesse caso, reprecificaria com a mesma
            // ausência de cartório e a tela nunca diria que a consulta falhou.
            if (e?.custo?.total != null) {
              setPasso('Refazendo o preço com o cartório…')
              // Sem IA: só recalcula. Por isso é uma ação própria, e não 'refinar'.
              const r2 = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
                acao: 'reprecificar',
                notas_kommo: notasKommo,
                dados: r.dados,
                custo_cartorio: e.custo,
                avisos_qualificacao: r.avisos_qualificacao ?? [],
                ...dadosDoCard,
              })
              setAtual(r2)
            } else {
              const porque = e?.custo?.motivo ?? e?.motivo
              setFalhaCartorio(
                `Consultei o custo de cartório de ${uf} para ${formatBRL(preco)} e não obtive resposta${
                  porque ? `: ${porque}` : '.'
                } O preço está sem escritura e registro — some o custo à mão.`,
              )
            }
          } catch (e) {
            // FALHA DITA, NÃO ENGOLIDA. A análise segue válida — está na tela e o
            // aviso de "cartório não incluído" continua de pé —, mas um catch
            // vazio aqui fazia a tela prometer que o preço se refaria e nunca
            // explicar por que não refez.
            setFalhaCartorio(
              `Não consegui consultar o cartório de ${uf}: ${
                (e as Error)?.message ?? String(e)
              }. O preço está sem escritura e registro.`,
            )
          }
        }
      } catch (e) {
        setErro((e as Error)?.message ?? String(e))
      } finally {
        setPasso(null)
      }
    })()
  }, [open, lerArquivos, notasKommo, dadosDoCard])

  useEffect(() => {
    fimDoChat.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [mensagens.length])

  async function pedirAlteracao() {
    const instrucao = pedido.trim()
    if (!instrucao || !atual?.dados) return
    setPedido('')
    setErro(null)
    const historico = [...mensagens, { papel: 'usuario' as const, texto: instrucao }]
    setMensagens(historico)
    setPasso('Revisando a análise…')
    try {
      // SEM `texto` E COM `custo_cartorio`, e as duas coisas pela mesma razão: a
      // revisão estourava o teto de 150 s da requisição (erros 504 e 546). O
      // processo inteiro reenviado a cada pedido e uma consulta web de cartório
      // por rodada eram o custo. A revisão trabalha sobre o JSON já extraído, e
      // o custo de cartório vem de volta em vez de ser consultado de novo.
      const r = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
        acao: 'refinar',
        notas_kommo: notasKommo,
        dados: atual.dados,
        custo_cartorio: atual.custo_cartorio ?? null,
        instrucao,
        historico: historico.slice(-12),
        avisos_qualificacao: atual.avisos_qualificacao ?? [],
        ...dadosDoCard,
      })
      setAtual(r)
      setMensagens((m) => [...m, { papel: 'ia', texto: r.resposta || 'Alteração aplicada.' }])
    } catch (e) {
      setMensagens((m) => [
        ...m,
        { papel: 'ia', texto: `Não consegui aplicar: ${(e as Error)?.message ?? String(e)}` },
      ])
    } finally {
      setPasso(null)
    }
  }

  async function salvar() {
    if (!atual?.dados) return
    setErro(null)
    setPasso('Gerando a planilha e salvando no Drive…')
    try {
      const r = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
        acao: 'salvar',
        notas_kommo: notasKommo,
        dados: atual.dados,
        custo_cartorio: atual.custo_cartorio ?? null,
        avisos_qualificacao: atual.avisos_qualificacao ?? [],
        ...dadosDoCard,
      })
      setSalvo(r)
      onSalvo(r)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setPasso(null)
    }
  }

  const riscos = useMemo(() => atual?.riscos ?? [], [atual])
  const podeSalvar = !!atual && !atual.reprovado && !!atual.dados && !salvo && !ocupado

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      // Preliminar sem salvar é trabalho que se perde ao fechar — daí a confirmação.
      dirty={!!atual && !atual.reprovado && !salvo}
      title={`Análise de RPV — ${titulo}`}
      description={
        salvo
          ? 'Planilha salva no Drive e card anotado no Kommo.'
          : atual?.reprovado
            ? 'Reprovado na qualificação. Nada foi gravado.'
            : 'Preliminar: nada foi gravado. Peça alterações à IA até a análise estar boa; então salve.'
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">{leadId ? `Card ${leadId}` : ''}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={ocupado}>
              {salvo ? 'Fechar' : 'Fechar sem salvar'}
            </Button>
            {!salvo && (
              <Button
                onClick={salvar}
                disabled={!podeSalvar}
                loading={passo === 'Gerando a planilha e salvando no Drive…'}
                icon={<Save className="h-4 w-4" />}
              >
                Salvar no Drive
              </Button>
            )}
          </div>
        </div>
      }
    >
      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {erro}
        </div>
      )}

      {!atual && passo && <Loading label={passo} />}

      {atual?.reprovado && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <p className="font-semibold">Reprovado no Portão 1</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {(atual.motivos ?? []).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {atual && !atual.reprovado && atual.valores && (
        <div className="space-y-4">
          {/* Os números primeiro: são a resposta. */}
          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
            <GradeValoresRpv
              valores={atual.valores}
              cartorio={atual.cartorio}
              atingiuAlvo={atual.atingiu_alvo}
            />
            {(atual.regra_prazo || atual.modelo) && (
              <p className="mt-3 text-xs text-slate-500">
                {atual.modelo}
                {atual.modelo && atual.regra_prazo && ' · '}
                {atual.regra_prazo}
                {atual.prazo_detalhe && ` — ${atual.prazo_detalhe}`}
              </p>
            )}
          </div>

          {atual.m1_sintese && (
            <section>
              <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-slate-500">
                Síntese
              </h3>
              <p className="mt-1 text-sm text-slate-800">{atual.m1_sintese}</p>
            </section>
          )}

          {riscos.length > 0 && (
            <section>
              <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-slate-500">
                Riscos
              </h3>
              <ul className="mt-1 space-y-1 text-sm">
                {riscos.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 rounded px-1.5 text-[11px] font-semibold uppercase leading-5',
                        /impeditivo/i.test(r.grau ?? '')
                          ? 'bg-red-100 text-red-800'
                          : /elevado/i.test(r.grau ?? '')
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700',
                      )}
                    >
                      {r.grau ?? 'risco'}
                    </span>
                    <span className="text-slate-800">
                      {r.risco}
                      {r.fundamento && <span className="text-slate-500"> — {r.fundamento}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!!atual.avisos?.length && (
            <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
              {atual.avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}

          {/* A busca da tabela de cartório falhou. Em vermelho, e separado dos
              avisos: o aviso da análise diz que a tela pediria a tabela em
              seguida — sem isto, a promessa fica sem desfecho. */}
          {falhaCartorio && (
            <p className="rounded-lg bg-red-50 p-3 text-xs text-red-800 ring-1 ring-inset ring-red-200">
              {falhaCartorio}
            </p>
          )}

          {salvo ? (
            <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800 ring-1 ring-inset ring-green-200">
              ✅ Planilha salva.{' '}
              {salvo.drive_file_url && (
                <a className="font-medium underline" href={salvo.drive_file_url} target="_blank" rel="noreferrer">
                  Abrir planilha
                </a>
              )}
            </div>
          ) : (
            <section className="border-t border-slate-200 pt-4">
              <h3 className="font-display flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Sparkles className="h-3.5 w-3.5" /> Pedir alterações à IA
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Em linguagem natural: corrija um valor ou uma data, suprima um risco, mude uma
                resposta do questionário. O preço é recalculado a cada alteração.
              </p>

              {mensagens.length > 0 && (
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                  {mensagens.map((m, i) => (
                    <div
                      key={i}
                      className={cn(
                        'max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm',
                        m.papel === 'usuario'
                          ? 'ml-auto bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-800',
                      )}
                    >
                      {m.texto}
                    </div>
                  ))}
                  <div ref={fimDoChat} />
                </div>
              )}

              <div className="mt-3 flex items-end gap-2">
                <textarea
                  className="min-h-[44px] flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  rows={2}
                  placeholder='Ex.: "o valor bruto homologado é R$ 84.320,10" · "suprima o risco 2" · "a RPV foi expedida em 12/03/2026"'
                  value={pedido}
                  disabled={ocupado}
                  onChange={(e) => setPedido(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter envia; Shift+Enter quebra linha — o mesmo gesto do chat.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void pedirAlteracao()
                    }
                  }}
                />
                <Button
                  onClick={pedirAlteracao}
                  disabled={ocupado || !pedido.trim()}
                  loading={passo === 'Revisando a análise…'}
                  icon={<SendHorizontal className="h-4 w-4" />}
                >
                  Enviar
                </Button>
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}
