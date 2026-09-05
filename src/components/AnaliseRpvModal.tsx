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
import {
  formatBRL,
  formatBRLInput,
  formatPercent,
  onlyDigits,
  parseBRLInput,
} from '@/lib/format'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Table'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'

/** Fração -> "35,20%": formatPercent espera pontos percentuais. */
const pctBR = (fracao: number) => formatPercent(fracao * 100)

/**
 * Prazo da consulta ao cartório.
 *
 * Subiu de 100 s quando a consulta passou a ABRIR os documentos (web_fetch) além
 * de buscá-los: ler o anexo de uma tabela de emolumentos é mais lento que ler o
 * resumo da busca, e era justamente não abrir o arquivo que fazia a consulta
 * voltar vazia. 140 s ainda fica abaixo do teto de 150 s da requisição — passar
 * disso só trocaria este aviso pelo erro cru da função.
 */
const PRAZO_CARTORIO = 140_000

/**
 * Uma promessa que desiste no prazo.
 *
 * Existe porque `invokeFunction` espera para sempre, e uma consulta pendurada
 * deixava a janela em silêncio — sem valor, sem erro, sem nada a fazer. Falhar
 * dizendo "passou de 100s" é uma resposta; esperar sem fim não é.
 *
 * A requisição em si não é cancelada (não há como, daqui) — só deixa de ser
 * esperada. É aceitável: ela não grava nada, e se chegar depois o resultado é
 * descartado.
 */
function comPrazo<T>(p: Promise<T>, ms: number, mensagem: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(mensagem)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

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
  /**
   * O preço final saiu da faixa da tabela consultada — vale perguntar de novo,
   * agora para o preço certo. A função só marca quando a faixa é real: com
   * tabela puramente percentual a faixa é um ponto, o preço sempre cai fora, e
   * reconsultar entraria em laço.
   */
  reconsultar_cartorio?: boolean
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
  /** Por que o cartório não entrou no preço, quando a consulta falhou. */
  const [falhaCartorio, setFalhaCartorio] = useState<string | null>(null)
  /**
   * O passo do CARTÓRIO, separado de `passo` — e é o conserto de um travamento.
   *
   * A consulta do cartório usava `passo`, e `ocupado` (que desabilita o campo do
   * chat) é `passo !== null`. Só que o rótulo de progresso só aparece ENQUANTO
   * NÃO HÁ ANÁLISE na tela: assim que os números chegavam, o texto sumia e o
   * campo continuava desabilitado, sem nada explicando. Consulta demorada ou
   * pendurada = campo morto.
   *
   * Agora o cartório é enriquecimento de fundo: não bloqueia o chat e mostra o
   * próprio progresso ao lado do valor.
   */
  const [passoCartorio, setPassoCartorio] = useState<string | null>(null)
  /**
   * O custo consultado, guardado à parte do `atual`.
   *
   * Existe pela corrida: a consulta leva dezenas de segundos e a pessoa pode
   * revisar a análise no meio. Se ela revisou, sobrescrever `atual` com a
   * reprecificação apagaria a revisão — então o custo fica aqui e entra na
   * PRÓXIMA rodada do chat (refinar e salvar já o mandam).
   */
  const [custoCartorio, setCustoCartorio] = useState<unknown>(null)
  /**
   * Custo de cartório digitado à mão, quando a consulta não resolve.
   *
   * Guarda SÓ DÍGITOS, e eles são centavos — a mesma máscara de dinheiro do
   * cadastro de créditos (ver parseBRLInput). Aceitar texto livre trazia uma
   * ambiguidade cara: em pt-BR o ponto é separador de milhar, então "1234.56"
   * digitado por quem pensa em inglês viraria R$ 123.456,00. Num campo que entra
   * no preço, é um erro de 100x que ninguém vê.
   */
  const [manual, setManual] = useState({ escritura: '', registro: '' })
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [pedido, setPedido] = useState('')
  const [salvo, setSalvo] = useState<RespostaAnaliseRpv | null>(null)
  const fimDoChat = useRef<HTMLDivElement>(null)

  const ocupado = passo !== null
  /**
   * Quantas vezes a análise foi substituída (revisão ou salvamento).
   *
   * A consulta do cartório tira uma foto deste número antes de começar; ao
   * voltar, só aplica a reprecificação se ninguém mexeu no meio.
   */
  const revisao = useRef(0)

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
          // FORA DO `passo`: enriquecimento de fundo não pode travar o chat.
          setPassoCartorio(`Consultando o cartório de ${uf} para ${formatBRL(preco)}…`)
          const naEpoca = revisao.current
          try {
            const e = await comPrazo(
              invokeFunction<{
                custo?: { total?: number | null; motivo?: string } | null
                motivo?: string
              }>('gerar-analise-rpv', { acao: 'emolumentos', uf, preco }),
              PRAZO_CARTORIO,
              `a consulta passou de ${PRAZO_CARTORIO / 1000}s`,
            )
            // EXIGE O VALOR, não só o objeto. A consulta devolve
            // `{total: null, motivo}` quando não acha nada — verificar só
            // `e.custo` daria verdadeiro nesse caso, reprecificaria com a mesma
            // ausência de cartório e a tela nunca diria que a consulta falhou.
            if (e?.custo?.total != null) {
              // Guardado SEMPRE, aplicado só se ninguém revisou no meio. Assim o
              // custo nunca se perde: refinar e salvar o mandam de todo jeito.
              setCustoCartorio(e.custo)
              if (revisao.current !== naEpoca) {
                setPassoCartorio(null)
                return
              }
              setPassoCartorio('Refazendo o preço com o cartório…')
              // Sem IA: só recalcula. Por isso é uma ação própria, e não 'refinar'.
              let r2 = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
                acao: 'reprecificar',
                notas_kommo: notasKommo,
                dados: r.dados,
                custo_cartorio: e.custo,
                avisos_qualificacao: r.avisos_qualificacao ?? [],
                ...dadosDoCard,
              })

              // SEGUNDA CONSULTA, quando o preço mudou de faixa.
              //
              // O cartório empurra o preço bem mais que o próprio valor dele — o
              // preço se reajusta para manter a meta de rentabilidade. Num caso
              // real: consulta a R$ 51.129 (faixa 50.000,01–55.000,00), preço
              // final R$ 47.902 — faixa de baixo. O emolumento embutido virava o
              // da faixa de cima, maior que o devido.
              //
              // UMA VEZ SÓ, e não um laço até convergir: a segunda consulta parte
              // de um preço já quase certo, então a terceira quase nunca mudaria
              // de faixa — e cada rodada custa dezenas de segundos. Se ainda
              // assim sobrar diferença, o aviso da função diz, com os dois
              // valores, e os campos manuais resolvem.
              const preco2 = r2.cartorio?.preco_consulta ?? r2.valores?.preco_cessao
              if (r2.reconsultar_cartorio && preco2 && revisao.current === naEpoca) {
                setPassoCartorio(`Preço mudou de faixa — reconsultando para ${formatBRL(preco2)}…`)
                const e2 = await comPrazo(
                  invokeFunction<{ custo?: { total?: number | null } | null }>(
                    'gerar-analise-rpv',
                    { acao: 'emolumentos', uf, preco: preco2 },
                  ),
                  PRAZO_CARTORIO,
                  `a reconsulta passou de ${PRAZO_CARTORIO / 1000}s`,
                )
                if (e2?.custo?.total != null) {
                  setCustoCartorio(e2.custo)
                  const r3 = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
                    acao: 'reprecificar',
                    notas_kommo: notasKommo,
                    dados: r.dados,
                    custo_cartorio: e2.custo,
                    avisos_qualificacao: r.avisos_qualificacao ?? [],
                    ...dadosDoCard,
                  })
                  r2 = r3
                }
                // e2 sem valor: fica o r2 da primeira consulta, com o aviso de
                // faixa que a função já pôs nele. Preço com cartório aproximado
                // é melhor que preço sem cartório nenhum.
              }

              if (revisao.current === naEpoca) setAtual(r2)
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
          } finally {
            setPassoCartorio(null)
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
    // A análise vai ser substituída: a consulta de cartório em voo, se houver,
    // guarda o custo e não sobrescreve o que sair daqui.
    revisao.current += 1
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
        custo_cartorio: custoCartorio ?? atual.custo_cartorio ?? null,
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

  /**
   * Aplica um custo de cartório DIGITADO, sem passar pela IA.
   *
   * A consulta automática depende de uma busca web que pode não achar a tabela
   * do estado — e aí o preço fica sem cartório e a pessoa não tem o que fazer
   * dentro da janela. Quem opera sabe quanto custa a escritura no cartório onde
   * lavra. Isto é a saída manual: mesma reprecificação, custo vindo do teclado.
   *
   * Marcado com origem 'nenhuma' e fonte "informado à mão", para a planilha e o
   * histórico nunca confundirem valor digitado com valor de tabela oficial.
   */
  async function aplicarCartorioManual() {
    if (!atual?.dados) return
    const positivo = (v: number | null) => (v !== null && v > 0 ? v : null)
    const escritura = positivo(parseBRLInput(manual.escritura))
    const registro = positivo(parseBRLInput(manual.registro))
    if (escritura === null && registro === null) return
    const uf = atual.cartorio?.uf ?? null
    const custo = {
      uf: uf ?? '',
      ano: new Date().getFullYear(),
      preco: atual.valores?.preco_cessao ?? 0,
      escritura,
      registro,
      total: (escritura ?? 0) + (registro ?? 0),
      completo: escritura !== null && registro !== null,
      // Sem faixa: o valor foi dado para ESTE preço e não se sabe até onde vale.
      // Assim o motor não avisa "saiu de faixa" sobre uma faixa que não existe.
      de: null,
      ate: null,
      descricao: `Escritura ${escritura === null ? '—' : formatBRL(escritura)} + registro ${
        registro === null ? '—' : formatBRL(registro)
      } (informado à mão)`,
      fontes: [],
      vigencia: null,
      observacao: 'Custo informado à mão pelo operador, não consultado em tabela.',
      origem: 'nenhuma' as const,
    }
    revisao.current += 1
    setCustoCartorio(custo)
    setFalhaCartorio(null)
    setPasso('Refazendo o preço com o cartório informado…')
    try {
      const r = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
        acao: 'reprecificar',
        notas_kommo: notasKommo,
        dados: atual.dados,
        custo_cartorio: custo,
        avisos_qualificacao: atual.avisos_qualificacao ?? [],
        ...dadosDoCard,
      })
      setAtual(r)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
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
        custo_cartorio: custoCartorio ?? atual.custo_cartorio ?? null,
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

          {/* A CONSULTA DO CARTÓRIO EM ANDAMENTO, visível e sem travar nada.
              O passo dela usava o mesmo estado do resto, que desabilita o campo
              do chat — e o rótulo só aparecia antes de a análise existir. Dava
              campo morto sem explicação. Agora ela tem linha própria, some
              sozinha e o chat segue utilizável enquanto isso. */}
          {passoCartorio && (
            <p className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              {passoCartorio} Você já pode pedir alterações — o preço se refaz quando
              o custo chegar.
            </p>
          )}

          {/* A consulta do cartório falhou. Em vermelho, e separado dos avisos:
              o aviso da análise diz que a tela pediria o custo em seguida — sem
              isto, a promessa fica sem desfecho. */}
          {falhaCartorio && (
            <p className="rounded-lg bg-red-50 p-3 text-xs text-red-800 ring-1 ring-inset ring-red-200">
              {falhaCartorio}
            </p>
          )}

          {/* SAÍDA MANUAL. Aparece quando o preço está sem cartório e não há
              consulta em andamento. Quem opera sabe quanto custa a escritura no
              cartório onde lavra — sem isto, a busca falhando deixa a pessoa sem
              nada a fazer dentro da janela. */}
          {atual?.valores && atual.valores.cartorio == null && !passoCartorio && (
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
              <p className="mb-2 text-xs text-slate-600">
                Informe o custo de cartório à mão e o preço se refaz. Digite só os
                números — os dois últimos dígitos são os centavos. Deixe em branco o
                que não souber.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-500">
                  Escritura
                  <input
                    className="mt-0.5 block w-32 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    inputMode="numeric"
                    placeholder="0,00"
                    value={manual.escritura ? formatBRLInput(parseBRLInput(manual.escritura)) : ''}
                    disabled={ocupado}
                    onChange={(e) =>
                      setManual((m) => ({ ...m, escritura: onlyDigits(e.target.value) }))
                    }
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Registro
                  <input
                    className="mt-0.5 block w-32 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    inputMode="numeric"
                    placeholder="0,00"
                    value={manual.registro ? formatBRLInput(parseBRLInput(manual.registro)) : ''}
                    disabled={ocupado}
                    onChange={(e) =>
                      setManual((m) => ({ ...m, registro: onlyDigits(e.target.value) }))
                    }
                  />
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={aplicarCartorioManual}
                  disabled={ocupado || (!manual.escritura.trim() && !manual.registro.trim())}
                  loading={passo === 'Refazendo o preço com o cartório informado…'}
                >
                  Aplicar
                </Button>
              </div>
            </div>
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
