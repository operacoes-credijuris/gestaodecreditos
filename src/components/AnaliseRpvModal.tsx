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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { Select } from '@/components/ui/Field'
import { Loading } from '@/components/ui/Table'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'
import { montarTextoDoProcesso, type PaginaLida } from '@/lib/textoDoProcesso'
import { descreverSelecao, escolherPaginasParaImagem, LIMITES_PADRAO } from '@/lib/paginasDigitalizadas'
import { planoDeLeitura } from '../../supabase/functions/_shared/orcamentoLeitura.ts'
import { renderizarPaginas } from '@/lib/renderizarPaginas'
import { supabase } from '@/lib/supabase'

/** Fração -> "35,20%": formatPercent espera pontos percentuais. */
const pctBR = (fracao: number) => formatPercent(fracao * 100)

/**
 * Prazo de UMA pergunta ao servidor sobre o cartório — não da pesquisa inteira.
 *
 * A pesquisa da tabela de emolumentos (achar o provimento do estado, abrir o PDF
 * anexo, ler as linhas) leva minutos e agora roda em SEGUNDO PLANO no servidor.
 * O que acontece aqui é só perguntar "já chegou?", que é uma leitura de tabela e
 * responde em menos de um segundo.
 *
 * A versão anterior esperava a pesquisa inteira dentro de uma requisição, com
 * 140 s de prazo, e o que a tela mostrava era "o levantamento passou de 140s".
 * Aumentar o prazo não resolvia: o teto da requisição é 150 s, e a pesquisa é
 * mais lenta que isso por natureza.
 */
const PRAZO_PERGUNTA = 45_000
/**
 * Quanto tempo no total vale a pena ficar esperando a pesquisa terminar.
 *
 * São TRÊS etapas encadeadas no servidor (achar o documento, ler a escritura,
 * ler o registro), cada uma numa invocação própria. Dez minutos cobrem as três
 * com folga. Passar disso não perde o trabalho: a pesquisa continua no
 * servidor e a próxima abertura da janela encontra a tabela pronta.
 */
const PRAZO_LEVANTAMENTO = 10 * 60_000
/** Intervalo entre uma pergunta e a seguinte. */
const INTERVALO_PERGUNTA = 8_000
/**
 * Quantas perguntas seguidas podem falhar antes de desistir.
 *
 * Uma sozinha não quer dizer nada: a função é pesada para subir e a primeira
 * pergunta depois de um tempo parada pega a partida a frio. Três seguidas já
 * são sinal de que o servidor não está atendendo.
 */
const MAX_FALHAS_SEGUIDAS = 3

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
const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * O que a ação 'emolumentos' devolve.
 *
 * `estado` é o que manda: 'levantando' não é erro nem sucesso — é "volte a
 * perguntar". Antes a resposta era só `{emolumentos}` e não havia como
 * distinguir "não achei" de "ainda procurando".
 */
interface RespostaConsultaEmolumentos {
  estado?: 'pronta' | 'levantando' | 'falhou' | 'sem_uf'
  emolumentos?: { regra?: unknown; motivo?: string } | null
  reconsultar_em?: number
  /** Em que pé está a pesquisa, em português. */
  etapa?: string
  motivo?: string
}

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
  /** IRRF retido sobre os honorários, pela tabela progressiva. 0 quando não há. */
  ir_honorarios?: number
  custo_total: number
  /**
   * O que se recebe e o que se paga por CADA verba comprada.
   *
   * Existe porque total esconde a regra da casa: havendo principal no negócio,
   * os honorários são comprados pelo valor de face e todo o deságio cai sobre o
   * principal. Quem lê "deságio de 54%" sem ver as linhas supõe 54% em tudo — e
   * é outra conversa com o cedente. O deságio de cada uma sai da divisão.
   */
  parcelas?: Array<{ nome: string; liquido: number; preco: number }>
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
   * A tabela do estado ainda não foi levantada — a tela levanta e reprecifica.
   *
   * Não há preço aqui de propósito: o que se pede é a REGRA do estado (faixas e
   * acréscimos), que serve para QUALQUER valor de cessão. Perguntar "quanto
   * custa para este preço" foi a versão anterior, e ela exigia uma consulta nova
   * a cada mudança de preço.
   */
  falta_regra?: boolean
}
interface Risco {
  risco: string
  fundamento?: string
  grau?: string
}
/**
 * A auditoria dos cálculos, como o servidor a manda para a tela.
 *
 * `aplicada` é o campo que muda a decisão: TRUE significa que o preço na tela
 * já foi calibrado sobre o bruto revisado — o risco está embutido. FALSE com
 * divergências na lista significa o contrário: achou-se defeito na conta e o
 * preço NÃO desconta nada por isso.
 */
export interface AuditoriaRpv {
  natureza: string | null
  risco_revisao: string | null
  aplicada: boolean
  corte: number
  bruto_autos: number | null
  bruto_conservador: number | null
  justificativa: string | null
  /**
   * O confronto item a item entre o título e a conta.
   *
   * Eram dois blocos de prosa — "o título manda" e "a conta aplicou" — e prosa
   * deixa passar: quem resume "a conta seguiu o título, com divergência no
   * índice" não conferiu o termo inicial dos juros de cada verba, e não tem
   * como saber que não conferiu. Uma linha por par verba × critério obriga a
   * percorrer, e mostra na tela o que foi olhado além do que foi achado.
   */
  confronto: Array<{
    verba: string
    criterio: string
    titulo: string
    conta: string
    /** 'sim' | 'nao' | 'titulo_silente' | 'conta_sem_memoria' */
    confere: string
  }>
  divergencias: Array<{
    item: string
    esperado: string
    encontrado: string
    fundamento: string
    gravidade: string
    /** O que acontece com o crédito se a divergência for CORRIGIDA. */
    efeito: string
  }>
  /** O veredito em uma frase, redigido no servidor — o mesmo que vai ao Kommo. */
  avisos: string[]
}
/** O que a gerar-analise-rpv devolve, em qualquer das três ações. */
export interface RespostaAnaliseRpv {
  ok?: boolean
  preliminar?: boolean
  reprovado?: boolean
  motivos?: string[]
  avisos?: string[]
  /** A auditoria dos cálculos. Null quando a conta não foi auditada. */
  auditoria?: AuditoriaRpv | null
  /** Quanto ESTA invocação levou dentro do servidor, e em quê. */
  tempo?: RelogioServidor
  /**
   * A metade "documento" da análise: questionário, síntese e riscos, crus.
   *
   * Só a ação 'documento' devolve isto, e a tela não interpreta nada — junta ao
   * `dados` da outra leitura e manda o conjunto de volta para consolidar.
   */
  dados_documento?: Record<string, unknown>
  aviso?: string | null
  cedente?: string
  modelo?: string
  esfera?: string
  /**
   * O resultado do Portão 1, devolvido pela ação 'qualificar'.
   *
   * Viaja de volta na chamada de 'analisar' para o servidor NÃO refazer a
   * leitura do processo: são duas requisições justamente porque as duas
   * leituras não cabiam no mesmo relógio de 150 s. Opaco para a tela.
   */
  qualificacao?: unknown
  /** A esfera do ENTE devedor (federal/estadual/municipal), para a pesquisa do teto. */
  ente_esfera?: string
  /** O município devedor, quando há um: o teto da RPV municipal é de cada município. */
  ente_municipio?: string | null
  regra_prazo?: string
  prazo_detalhe?: string
  /** Onde o processo está hoje, lido do último andamento. */
  etapa_atual?: string | null
  /**
   * Os atos que faltam até a liquidação, com os dias de cada um — é a soma
   * deles que vira o prazo. Null quando a IA não montou um roteiro utilizável e
   * o motor caiu na fórmula antiga.
   */
  roteiro?: { ato: string; dias: number; base: string }[] | null
  valores?: ValoresRpv
  /** De onde a IA tirou os números: documento, ID/página e data de atualização. */
  origem_valores?: string | null
  cartorio?: CartorioRpv
  atingiu_alvo?: boolean
  m1_sintese?: string | null
  riscos?: Risco[]
  m2?: Record<string, { resposta?: string; complemento?: string }>
  resposta?: string | null
  /** A análise inteira, opaca para a tela: volta para a função no próximo turno. */
  dados?: unknown
  /**
   * A REGRA de emolumentos do estado — faixas e acréscimos —, opaca aqui.
   *
   * Dá a volta pelo navegador pelo mesmo motivo de `dados`: levantá-la custa
   * busca e leitura de documento, e repetir isso a cada pedido do chat
   * estourava o teto de 150 s da requisição. Devolvendo-a, o motor recalcula o
   * cartório de qualquer preço novo sem consultar nada.
   */
  emolumentos?: unknown
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
 * O que está sendo comprado.
 *
 * Vem lido do "PARCELA CEDIDA" do card, e é EDITÁVEL: o cadastro do comercial
 * erra, e até agora a única saída era corrigir no Kommo e refazer a análise
 * inteira — duas chamadas de IA para trocar uma escolha. Mudar aqui só refaz as
 * contas, porque os valores dos autos ficam intactos e o que muda é quais
 * verbas entram.
 *
 * Os rótulos são os mesmos da lista suspensa da aba jurídica, para o que se lê
 * na tela ser o que sai no arquivo.
 */
const CENARIOS_RPV = [
  { valor: 'principal', label: 'Principal, apenas' },
  { valor: 'ambos', label: 'Principal + Honorários' },
  { valor: 'honorarios', label: 'Honorários (contratuais + sucumbenciais)' },
  { valor: 'sucumbenciais', label: 'Sucumbenciais, apenas' },
] as const

/**
 * O cenário do seletor que corresponde às verbas que o motor precificou.
 *
 * O SELETOR MOSTRA O QUE O MOTOR DECIDIU, e não só o que o card disse: com
 * "auto" quem escolhe é o destaque da contadoria; com "honorários" sem dizer
 * quais, os autos; e no chat a pessoa pode ditar as verbas. Em todos esses
 * casos o botão marcado tem de ser o que está sendo precificado, senão a tela
 * mostra um cenário e o preço é de outro.
 */
function cenarioDasVerbas(r: RespostaAnaliseRpv | null | undefined): string | null {
  const vb = (r as { dados?: { _verbas_negociadas?: Record<string, boolean> } } | null)?.dados?._verbas_negociadas
  if (!vb) return null
  return vb.principal && (vb.contratuais || vb.sucumbenciais) ? 'ambos'
    : vb.principal ? 'principal'
    : vb.contratuais ? 'honorarios'
    : 'sucumbenciais'
}

/**
 * Os avisos da análise, separados pelo que exige decisão.
 *
 * ANTES ERAM UMA LISTA CHAPADA de parágrafos de mesmo peso, dentro de um bloco
 * âmbar só. Com quinze linhas de texto — metade informação boa, metade alerta —
 * o operador lia tudo procurando o que importava, ou não lia nada. E no painel
 * do card os mesmos avisos vinham juntos num parágrafo único: uma parede.
 *
 * A separação é por marcador explícito, não por adivinhação de conteúdo: o
 * servidor prefixa com "⚠️" o que exige decisão. O resto é contexto, fica
 * recolhido, e some do caminho de quem só quer o número.
 */
/** O nome de cada verba na tela — 'principal' não é rótulo, é chave. */
const NOME_DA_VERBA: Record<string, string> = {
  principal: 'Crédito principal',
  contratuais: 'Honorários contratuais',
  sucumbenciais: 'Honorários sucumbenciais',
}

/**
 * O preço, verba a verba — o painel da janela de análise.
 *
 * SUBSTITUI UM BLOCO QUE MISTURAVA RESPOSTA E CONFERÊNCIA. Ali conviviam os três
 * números que decidem, a decomposição da base, o custo total, a procedência dos
 * valores em texto corrido e o nome do modelo da planilha — tudo com o mesmo
 * peso, num parágrafo que ninguém lia inteiro.
 *
 * O QUE FICOU, e por que nesta ordem: as VERBAS primeiro, porque é a pergunta
 * que o comercial responde ao cedente ("quanto vocês pagam pelo quê"); os TOTAIS
 * depois, porque são a soma delas; e o prazo, a rentabilidade e o cartório por
 * último, que é conferência de quem fecha.
 *
 * A LINHA POR VERBA EXISTE POR UMA REGRA DA CASA. Havendo principal no negócio,
 * os honorários são comprados PELO VALOR DE FACE e todo o deságio cai sobre o
 * principal. O total dizia "54,69%" e quem lesse suporia 54,69% em tudo — o
 * deságio efetivo sobre o negócio é bem menor, e é outra conversa. Agora as duas
 * coisas estão à vista, e o zero na linha dos honorários explica a diferença.
 */
function PainelPreco({ valores }: { valores: ValoresRpv }) {
  const parcelas = valores.parcelas ?? []
  const receber = valores.liquido_base
  const pagar = valores.preco_cessao
  // O deságio TOTAL é o efetivo — o que se paga sobre o que se recebe —, e não o
  // nominal do principal. São números diferentes quando há honorários no meio.
  const desagioTotal = receber > 0 ? 1 - pagar / receber : 0
  const desagioDe = (p: { liquido: number; preco: number }) =>
    p.liquido > 0 ? 1 - p.preco / p.liquido : 0

  const celula = 'py-1.5 text-right tabular-nums'

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200/80">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-400">
            <th className="px-4 py-2 text-left font-medium">Verba</th>
            {/* "A receber" e "A pagar" diziam a direção do dinheiro e não o que
                o número é. Aqui um lado é o CRÉDITO e o outro é o que se
                OFERECE por ele, e confundir os dois é o erro caro desta tela.
                "Proposta" porque é isso que a coluna vira na conversa com o
                cedente — e porque "preço da cessão" agora é o nome da linha
                equivalente na tabela de baixo, onde ele é um custo. */}
            <th className="px-3 py-2 text-right font-medium leading-tight">Valor do crédito</th>
            <th className="px-3 py-2 text-right font-medium leading-tight">Proposta</th>
            <th className="px-4 py-2 text-right font-medium">Deságio</th>
          </tr>
        </thead>
        <tbody className="text-slate-700">
          {parcelas.map((p) => (
            <tr key={p.nome} className="border-t border-slate-100">
              <td className="px-4 py-1.5 text-left">{NOME_DA_VERBA[p.nome] ?? p.nome}</td>
              <td className={cn(celula, 'px-3')}>{formatBRL(p.liquido)}</td>
              <td className={cn(celula, 'px-3')}>{formatBRL(p.preco)}</td>
              <td className={cn(celula, 'px-4 text-slate-500')}>
                {/* ZERO SAI COMO 0,00%, e não como traço. O traço se lê como
                    "não se aplica" ou "não calculado"; aqui o número existe e é
                    zero — a verba é comprada pelo valor de face. Numa coluna de
                    percentuais, um traço no meio faz duvidar da linha. */}
                {pctBR(Math.max(0, desagioDe(p)))}
              </td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
            <td className="px-4 py-2 text-left">Total</td>
            <td className={cn(celula, 'px-3 py-2')}>{formatBRL(receber)}</td>
            <td className={cn(celula, 'px-3 py-2')}>{formatBRL(pagar)}</td>
            <td className={cn(celula, 'px-4 py-2')}>{pctBR(desagioTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/**
 * O que se põe, o que se recebe, em quanto tempo.
 *
 * SEPARADA DA TABELA DE CIMA de propósito. Aquela é a NEGOCIAÇÃO — o que se
 * conversa com o cedente, verba a verba. Esta é o INVESTIMENTO, e as duas
 * respondem a perguntas diferentes: a de cima, "quanto ofereço por cada
 * verba?"; esta, "quanto sai do caixa e quanto volta?".
 *
 * O PREÇO DA CESSÃO NÃO É O CUSTO, e a tela deixava supor que fosse. Comissão,
 * cartório e correspondente somam, num negócio típico, quase dez por cento
 * acima do que se paga ao cedente — e a rentabilidade exibida ao lado sempre
 * foi calculada sobre o custo cheio, nunca sobre o preço. Quem lia só o preço e
 * a rentabilidade estava lendo dois números que não se dividem um pelo outro.
 * Daí a decomposição.
 *
 * O CUSTO TOTAL É O CHEIO, e não a soma das três linhas: o correspondente
 * (R$ 250 no padrão) entra nele e não aparece aqui — decisão do dono, que não
 * quer a linha na tela. É de propósito que o total continua sendo o do motor:
 * é sobre ele que a rentabilidade ao lado se calcula, e trocá-lo pela soma do
 * que está à vista deixaria os dois números sem relação um com o outro.
 */
function ResumoInvestimento({
  valores,
  cartorio,
  atingiuAlvo,
}: {
  valores: ValoresRpv
  cartorio?: CartorioRpv
  atingiuAlvo?: boolean
}) {
  const linha = (rotulo: ReactNode, valor: ReactNode, chave: string) => (
    <div key={chave} className="flex items-baseline justify-between gap-4 px-4 py-2 first:pt-2.5 last:pb-2.5">
      <dt className="text-slate-600">{rotulo}</dt>
      <dd className="tabular-nums text-slate-700">{valor}</dd>
    </div>
  )

  return (
    <section>
      <h3 className="font-display text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Resumo do investimento
      </h3>
      <div className="mt-2 overflow-hidden rounded-xl bg-white text-sm ring-1 ring-inset ring-slate-200/80">
        <dl>
          {linha('Preço total da cessão', formatBRL(valores.preco_cessao), 'cessao')}
          {linha('Comissão', formatBRL(valores.comissao), 'comissao')}
          {linha(
            <>
              Cartório
              {cartorio?.uf && <span className="text-slate-400"> · {cartorio.uf}</span>}
            </>,
            valores.cartorio == null ? (
              // Ausente é dito como ausente: um custo sem cartório parece menor
              // do que é, e um traço sozinho não avisa.
              <span className="text-amber-700">não incluído</span>
            ) : (
              formatBRL(valores.cartorio)
            ),
            'cartorio',
          )}

          <div className="border-t border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
            <div className="flex items-baseline justify-between gap-4 px-4 py-2">
              <dt>Custo total</dt>
              <dd className="tabular-nums">{formatBRL(valores.custo_total)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 pb-2">
              <dt>A receber</dt>
              <dd className="tabular-nums">{formatBRL(valores.liquido_base)}</dd>
            </div>
          </div>

          {/* PRAZO E RENTABILIDADE COMO LINHAS, e não numa faixa de cartões
              embaixo. Eles respondem à mesma pergunta das linhas de cima —
              quanto sai, quanto volta, em quanto tempo, a que taxa — e estavam
              num formato diferente, o que os fazia ler como rodapé decorativo
              em vez de parte da conta. */}
          <div className="border-t border-slate-200">
            {linha(
              'Prazo de resgate',
              <>
                {valores.prazo_meses} meses
                {valores.data_pagamento && (
                  <span className="text-slate-400"> · {valores.data_pagamento}</span>
                )}
              </>,
              'prazo',
            )}
            {linha(
              'Rentabilidade',
              <span className={cn(atingiuAlvo === false && 'text-amber-700')}>
                {pctBR(valores.rentabilidade_mensal)}
                <span className="text-slate-400"> ao mês</span>
              </span>,
              'rentabilidade',
            )}
          </div>
        </dl>
      </div>
    </section>
  )
}

/**
 * Os riscos, numa lista só e categorizada.
 *
 * O SELO É INLINE. Ele vinha numa coluna à esquerda, e selo curto ao lado de
 * parágrafo longo deixa uma faixa vazia embaixo dele em todo item — doze itens
 * viravam duas telas de rolagem. Agora ele é um pedaço do próprio parágrafo.
 *
 * HAVIA TRÊS LISTAS DIZENDO A MESMA COISA: os riscos, as caixas amarelas e um
 * "Notas da análise" recolhido, todos falando de teto de RPV excedido, cartório
 * fora do preço, preço no cenário conservador. Três lugares para o mesmo tipo
 * de informação é três lugares para esquecer de olhar. Agora é um — e os avisos
 * sem ⚠️, que são nota e não alerta, ficam no fim, no grau mais fraco.
 *
 * O FUNDAMENTO FICA À VISTA. Ele já esteve atrás de um "por quê", quando a
 * lista era longa; ela encolheu por dois motivos — o que era da conta foi para
 * a seção de Auditoria, e o prompt passou a mandar UM item por assunto em vez
 * de um por observação —, e num risco de duas ou três linhas o fundamento é a
 * metade que sustenta a outra. Quem lê "a cessão precisa de anuência do ente"
 * sem a norma ao lado não tem como discordar.
 *
 * O QUE NÃO ESTÁ AQUI: divergência de cálculo. Índice, termo inicial, base,
 * tributação e memória ausente são da auditoria, e aparecem na seção dela. A
 * regra é do prompt, não daqui: filtrar por texto acertaria hoje e erraria na
 * primeira frase reescrita.
 */
type GrauRisco = 'IMPEDITIVO' | 'ALTO' | 'MODERADO' | 'ATENÇÃO' | 'NOTA'

/**
 * Cinco vocabulários viravam um.
 *
 * A auditoria dos cálculos classifica a GRAVIDADE de cada divergência em
 * alta/media/baixa e o RISCO DE REVISÃO em alto/medio/baixo/nenhum; o bloco de
 * riscos da IA usa Impeditivo/Elevado/Moderado/Ponto de atenção. "Elevado" e
 * "Alto" são a mesma coisa dita de dois jeitos, e a tela mostrava os dois selos
 * lado a lado como se fossem graus diferentes.
 *
 * OS RADICAIS SÃO CURTOS DE PROPÓSITO — "alt", e não "alto". A auditoria
 * escreve a gravidade no FEMININO ("alta") e o bloco de riscos escreve o grau
 * no MASCULINO ("Alto"); casando a palavra inteira, toda divergência de
 * gravidade alta caía no grau mais fraco, e o achado que derruba o crédito
 * aparecia com o mesmo selo apagado de uma imprecisão sem efeito no valor.
 * Enquanto as divergências vinham pré-classificadas do servidor isso não
 * aparecia; agora elas chegam cruas, e a tradução é toda daqui.
 */
function normalizarGrau(bruto: unknown): GrauRisco {
  const g = String(bruto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (g.includes('impeditiv')) return 'IMPEDITIVO'
  if (g.includes('alt') || g.includes('elevad')) return 'ALTO'
  if (g.includes('moderad') || g.includes('medi')) return 'MODERADO'
  if (g.includes('nota') || g.includes('nenhum')) return 'NOTA'
  return 'ATENÇÃO'
}

const ORDEM_GRAU: Record<GrauRisco, number> = {
  IMPEDITIVO: 0, ALTO: 1, MODERADO: 2, 'ATENÇÃO': 3, NOTA: 4,
}
const COR_GRAU: Record<GrauRisco, string> = {
  IMPEDITIVO: 'bg-red-50 text-red-700 ring-red-200/70',
  ALTO: 'bg-amber-50 text-amber-800 ring-amber-200/70',
  MODERADO: 'bg-slate-100 text-slate-600 ring-slate-200/70',
  'ATENÇÃO': 'bg-slate-50 text-slate-500 ring-slate-200/70',
  NOTA: 'bg-slate-50 text-slate-400 ring-slate-200/60',
}

/**
 * O que cada veredito do confronto quer dizer, na tela.
 *
 * "conta_sem_memoria" NÃO é "confere". A planilha que traz só o total, sem
 * dizer qual índice e qual termo aplicou, não foi conferida — foi lida. A
 * distinção existe porque marcá-la como "sim" transformaria "não deu para
 * verificar" em "está certo", que é o oposto.
 */
const VEREDITO_CONFRONTO: Record<string, { texto: string; cor: string }> = {
  sim: { texto: 'confere', cor: 'text-slate-500' },
  nao: { texto: 'fora do título', cor: 'text-amber-700' },
  titulo_silente: { texto: 'título silente', cor: 'text-slate-400' },
  conta_sem_memoria: { texto: 'sem memória', cor: 'text-amber-700' },
}

/** O selo do grau, inline no parágrafo. */
function Selo({ grau }: { grau: GrauRisco }) {
  return (
    <span
      className={cn(
        'mr-2 inline-block rounded px-1.5 align-[2px] text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
        COR_GRAU[grau],
      )}
    >
      {grau}
    </span>
  )
}

interface ItemDeRisco {
  grau: GrauRisco
  texto: string
  fundamento?: string
}

function ListaDeRiscos({
  riscos,
  avisos,
}: {
  riscos: Array<{ grau?: string; risco?: string; fundamento?: string }>
  avisos?: string[]
}) {
  const itens = useMemo<ItemDeRisco[]>(() => {
    const dosRiscos: ItemDeRisco[] = riscos.map((r) => ({
      grau: normalizarGrau(r.grau),
      texto: String(r.risco ?? '').trim(),
      fundamento: String(r.fundamento ?? '').trim() || undefined,
    }))
    // O ⚠️ é o que separa alerta de nota nos avisos do motor — a mesma marca que
    // a anotação do Kommo usa para decidir o que vai para o card.
    const dosAvisos: ItemDeRisco[] = (avisos ?? []).map((a) => {
      const alerta = a.trim().startsWith('⚠️')
      const texto = a.replace(/^\s*⚠️\s*/, '').trim()
      const bloqueia = /ABAIXO DO M[ÍI]NIMO|N[ÃA]O D[ÁA] PARA FECHAR/i.test(texto)
      return { grau: bloqueia ? 'IMPEDITIVO' : alerta ? 'ATENÇÃO' : 'NOTA', texto }
    })
    return [...dosRiscos, ...dosAvisos]
      .filter((i) => i.texto.length > 0)
      .sort((a, b) => ORDEM_GRAU[a.grau] - ORDEM_GRAU[b.grau])
  }, [riscos, avisos])

  if (itens.length === 0) return null

  return (
    <section>
      <h3 className="font-display text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Riscos
      </h3>
      {/* O FUNDAMENTO FICA À VISTA, e não atrás de um clique. Escondê-lo tinha
          uma premissa que se mostrou falsa: a de que a lista seria longa. Ela
          encolheu — o que era da conta foi para a Auditoria, e o prompt agora
          manda agrupar em vez de repetir —, e num risco de duas ou três linhas
          o "por quê" é a metade que sustenta a outra. Quem lê "cessão precisa
          de anuência do ente" sem a norma ao lado não tem como discordar. */}
      <ul className="mt-2 space-y-2.5">
        {itens.map((it, i) => (
          <li key={i} className="text-sm leading-relaxed text-slate-700">
            {/* O selo é INLINE, dentro do parágrafo: fora dele, cada item
                deixava uma faixa vazia embaixo do selo. */}
            <Selo grau={it.grau} />
            {it.texto}
            {it.fundamento && (
              <span className="mt-1 block border-l-2 border-slate-200 pl-3 text-xs text-slate-500">
                {it.fundamento}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Duração em palavras curtas: "48s", "2m13s". */
function duracao(ms: number): string {
  const seg = Math.round(ms / 1000)
  if (seg < 60) return `${seg}s`
  const m = Math.floor(seg / 60)
  const r = seg % 60
  return r ? `${m}m${String(r).padStart(2, '0')}s` : `${m}m`
}

/** O relógio de dentro de UMA requisição. */
export interface RelogioServidor {
  ms: number
  fases: Array<[string, number]>
}

/** Uma etapa medida no navegador, com o que o servidor disse da sua parte. */
export interface FaseMedida {
  nome: string
  ms: number
  /**
   * Os relógios de dentro do servidor — plural porque uma etapa do navegador
   * pode ser mais de uma requisição CORRENDO JUNTA. A leitura da análise são
   * duas, em paralelo; somá-las daria um número que ninguém esperou.
   */
  servidor?: Array<{ rotulo: string } & RelogioServidor>
}

/**
 * ONDE O TEMPO FOI, medido de fora.
 *
 * O SERVIDOR NÃO CONSEGUE RESPONDER ESSA PERGUNTA, e foi o que atrapalhou por
 * várias rodadas. Ele mede uma invocação; a espera de quem clica é a soma de
 * cinco coisas — extrair o texto dos PDFs no próprio navegador, renderizar e
 * subir as páginas digitalizadas, a requisição de qualificação, a da análise, e
 * o levantamento da tabela de emolumentos. Desde que as duas leituras da IA
 * viraram requisições separadas, nenhum relógio do servidor via mais de um
 * pedaço, e o número que aparecia na tela era menor que a espera real.
 *
 * ERA UM AVISO, E AVISO É RISCO NESTA JANELA: caía na lista categorizada, com
 * selo, entre "teto da RPV excedido" e "cartório fora do preço". Diagnóstico de
 * desempenho não é risco da operação. Aqui embaixo, em corpo miúdo, quem
 * procura acha e quem não procura não tropeça.
 *
 * O DETALHE DE DENTRO DO SERVIDOR VAI NO title, e não na tela: são até quatro
 * sub-etapas por requisição, e elas só interessam depois que a linha de cima
 * aponta qual requisição é a lenta. A diferença entre o número do navegador e o
 * do servidor é rede mais partida a frio do worker — que é uma resposta
 * diferente de "a leitura da IA está lenta", e pede conserto diferente.
 */
function LinhaDoTempo({ fases }: { fases: FaseMedida[] }) {
  if (!fases.length) return null
  const total = fases.reduce((t, f) => t + f.ms, 0)
  const dentro = (f: FaseMedida) =>
    f.servidor?.length
      ? f.servidor
          .map(
            (r) =>
              `${r.rotulo}: no servidor ${duracao(r.ms)}` +
              (r.fases.length ? ' — ' + r.fases.map(([n, ms]) => `${n} ${duracao(ms)}`).join('; ') : ''),
          )
          .join('\n')
      : undefined

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
      {fases.map((f) => (
        <span key={f.nome} title={dentro(f)} className={cn(f.servidor && 'cursor-help')}>
          {f.nome} <span className="tabular-nums text-slate-500">{duracao(f.ms)}</span>
        </span>
      ))}
      <span aria-hidden>·</span>
      <span className="tabular-nums">{duracao(total)} no total</span>
    </p>
  )
}

/**
 * A auditoria dos cálculos, em seção própria.
 *
 * POR QUE SAIU DE DENTRO DOS RISCOS. As divergências da conta iam para a frente
 * da lista de riscos, prefixadas com "Cálculo:", e o veredito ia para os alertas
 * com um "detalhe nos riscos" no fim. Três consequências, todas ruins: a lista
 * de riscos crescia com itens de outra natureza; o alerta mandava procurar em
 * outro lugar; e a pergunta que se faz de verdade — "a conta foi conferida, e no
 * que ela não se sustenta?" — não tinha onde ser respondida.
 *
 * A DIFERENÇA QUE ESTA SEÇÃO EXISTE PARA MOSTRAR é entre risco EMBUTIDO e risco
 * SOLTO. Havendo divergência que derruba o crédito, o motor recalibra o preço
 * sobre o bruto revisado e o risco já está no número (`aplicada`); não dando
 * para estimar o valor revisado, o preço fica o mesmo e o risco é de quem
 * compra. Nos dois casos há divergências na lista, e a leitura é oposta.
 *
 * "AUDITEI E ESTÁ FIEL" TAMBÉM É RESULTADO, e aparece: silêncio se leria como
 * "não auditado", e a diferença entre as duas coisas é toda a diferença para
 * quem assina.
 */
function PainelAuditoria({ auditoria }: { auditoria: AuditoriaRpv }) {
  const [criterios, setCriterios] = useState(false)

  const divs = auditoria.divergencias ?? []
  const confronto = auditoria.confronto ?? []
  // O RÓTULO DO BOTÃO CONTA O QUE FOI OLHADO. "Ver o confronto" não diz se a
  // auditoria percorreu três itens ou vinte, e essa é a diferença entre uma
  // conferência e uma passada de olho.
  const naoConferem = confronto.filter((c) => c.confere === 'nao').length
  const semMemoria = confronto.filter((c) => c.confere === 'conta_sem_memoria').length
  const rotuloConfronto = confronto.length
    ? `Confronto com o título: ${confronto.length} ${confronto.length === 1 ? 'item conferido' : 'itens conferidos'}` +
      (naoConferem ? `, ${naoConferem} fora do título` : '') +
      (semMemoria ? `, ${semMemoria} sem memória de cálculo` : '')
    : 'Natureza do crédito'
  // O risco de revisão vem em "alto" | "medio" | "baixo" | "nenhum"; o selo é o
  // mesmo vocabulário dos riscos, para os dois blocos não terem escalas
  // paralelas. "baixo" e "nenhum" caem em NOTA, que é o grau mais fraco.
  const grauDoRisco = normalizarGrau(
    /^(baixo|nenhum)$/i.test(auditoria.risco_revisao ?? '') ? 'nota' : auditoria.risco_revisao,
  )
  const efeitoEmPalavras = (e: string) =>
    e === 'reduz' ? 'corrigida, derruba o crédito'
      : e === 'aumenta' ? 'corrigida, elevaria o crédito'
      : ''

  return (
    <section>
      <h3 className="font-display text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Auditoria dos cálculos
      </h3>

      <div className="mt-2 space-y-2.5 rounded-xl px-3.5 py-3 ring-1 ring-inset ring-slate-200/80">
        {/* O VEREDITO PRIMEIRO, na frase que o servidor redigiu — a mesma que
            vai para a anotação do Kommo. Duas redações do mesmo veredito
            divergem na primeira mudança de uma delas. */}
        <p className="text-sm leading-relaxed text-slate-700">
          <Selo grau={grauDoRisco} />
          {auditoria.avisos[0]?.replace(/^\s*⚠️\s*/, '') ??
            (divs.length
              ? `${divs.length} divergência(s) na conta.`
              : 'Conta conferida contra o título.')}
        </p>

        {/* O CORTE, EM NÚMEROS. "Reduzido em R$ 8.120" sozinho não diz sobre
            quanto; com as duas pontas, dá para conferir contra os autos. */}
        {auditoria.aplicada && auditoria.bruto_autos != null && auditoria.bruto_conservador != null && (
          <p className="text-xs tabular-nums text-slate-500">
            Bruto nos autos {formatBRL(auditoria.bruto_autos)} → no cenário conservador{' '}
            <span className="font-medium text-slate-700">{formatBRL(auditoria.bruto_conservador)}</span>
            {auditoria.corte > 0 && <> · corte de {formatBRL(auditoria.corte)}</>}
          </p>
        )}

        {auditoria.justificativa && (
          <p className="text-xs leading-relaxed text-slate-500">{auditoria.justificativa}</p>
        )}

        {divs.length > 0 && (
          <ul className="space-y-2.5 border-t border-slate-200/80 pt-2.5">
            {divs.map((d, i) => {
              const efeito = efeitoEmPalavras(d.efeito)
              return (
                <li key={i} className="text-sm leading-relaxed text-slate-700">
                  <Selo grau={normalizarGrau(d.gravidade)} />
                  {d.item}
                  {efeito && <span className="text-slate-500"> — {efeito}</span>}
                  <span className="mt-1 block border-l-2 border-slate-200 pl-3 text-xs text-slate-500">
                    O título/lei pede <span className="text-slate-700">"{d.esperado}"</span>; a conta fez{' '}
                    <span className="text-slate-700">"{d.encontrado}"</span>.
                    {d.fundamento && <> {d.fundamento}</>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

{/* O CONFRONTO, atrás de um clique — é a leitura de quem vai refazer a
            conta, não de quem está decidindo o preço. Mas o CONTADOR fica à
            vista: saber que 18 itens foram conferidos e 2 não bateram é
            informação de decisão; qual foi o índice do terceiro item não é. */}
        {(confronto.length > 0 || auditoria.natureza) && (
          <div className="border-t border-slate-200/80 pt-2.5">
            <button
              type="button"
              onClick={() => setCriterios((v) => !v)}
              className="text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
            >
              {criterios ? 'Esconder o confronto' : rotuloConfronto}
            </button>
            {criterios && (
              <div className="mt-2 space-y-2 text-xs leading-relaxed">
                {auditoria.natureza && (
                  <p>
                    <span className="font-medium text-slate-600">Natureza do crédito: </span>
                    <span className="text-slate-500">{auditoria.natureza}</span>
                  </p>
                )}
                {confronto.length > 0 && (
                  // A tabela rola por dentro: são quatro colunas de texto, e a
                  // janela não pode rolar de lado por causa de uma delas.
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[34rem] border-collapse">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="py-1 pr-3 text-left font-medium">Verba</th>
                          <th className="py-1 pr-3 text-left font-medium">Critério</th>
                          <th className="py-1 pr-3 text-left font-medium">O título manda</th>
                          <th className="py-1 pr-3 text-left font-medium">A conta fez</th>
                          <th className="py-1 text-left font-medium">Confere</th>
                        </tr>
                      </thead>
                      <tbody>
                        {confronto.map((c, i) => {
                          const v = VEREDITO_CONFRONTO[c.confere] ?? { texto: c.confere, cor: 'text-slate-400' }
                          return (
                            <tr key={i} className="border-t border-slate-200/70 align-top">
                              <td className="py-1 pr-3 text-slate-600">{c.verba}</td>
                              <td className="py-1 pr-3 text-slate-600">{c.criterio}</td>
                              <td className="py-1 pr-3 text-slate-500">{c.titulo}</td>
                              <td className="py-1 pr-3 text-slate-500">{c.conta}</td>
                              <td className={cn('py-1 whitespace-nowrap font-medium', v.cor)}>{v.texto}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * A grade dos números finais. Exportada porque o card também a mostra depois de
 * salvar — a mesma grade nos dois lugares, para o número que a pessoa aprovou na
 * janela ser o mesmo que ela reencontra no card.
 */
export function GradeValoresRpv({
  valores,
  cartorio,
  atingiuAlvo,
  origemValores,
  compacta = false,
}: {
  valores: ValoresRpv
  cartorio?: CartorioRpv
  atingiuAlvo?: boolean
  /** De onde a IA tirou os números: documento, ID/página e data de atualização. */
  origemValores?: string | null
  /**
   * No card, só os três números que decidem.
   *
   * O card é um item de lista, lido de relance entre dezenas de outros. Prazo,
   * cartório, custo, base e procedência são conferência — e conferência se faz
   * na janela, com o processo aberto ao lado.
   */
  compacta?: boolean
}) {
  const [detalhes, setDetalhes] = useState(false)

  return (
    <div className="text-xs text-slate-700">
      {/* OS TRÊS QUE DECIDEM, com peso de destaque.
          A grade antiga dava o mesmo peso a seis números e a duas linhas de
          texto corrido: o preço, que é a resposta, disputava atenção com a
          decomposição do cartório. */}
      <dl className="grid grid-cols-3 gap-x-4">
        <div>
          <dt className="text-slate-500">Preço da cessão</dt>
          <dd className="font-display text-base font-semibold leading-tight sm:text-lg text-slate-900 tabular-nums">
            {formatBRL(valores.preco_cessao)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Deságio</dt>
          <dd className="font-display text-base font-semibold leading-tight sm:text-lg text-slate-900 tabular-nums">
            {pctBR(valores.desagio)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Rentabilidade</dt>
          <dd
            className={cn(
              'font-display text-base font-semibold leading-tight sm:text-lg tabular-nums',
              atingiuAlvo === false ? 'text-amber-700' : 'text-slate-900',
            )}
          >
            {pctBR(valores.rentabilidade_mensal)}
            <span className="text-xs font-normal text-slate-500"> ao mês</span>
          </dd>
        </div>
      </dl>

      {atingiuAlvo === false && (
        <p className="mt-1 text-amber-700">Abaixo da meta de 2,80% ao mês.</p>
      )}

      {/* A SEGUNDA LINHA é conferência, e se lê como conferência: uma frase
          corrida, sem rótulo por cima de cada número. Rótulo repetido em célula
          pequena vira ruído — o que se quer aqui é a ordem de grandeza. */}
      {!compacta && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-500">
          <span className="tabular-nums">
            {valores.prazo_meses} meses
            {valores.data_pagamento && ` · ${valores.data_pagamento}`}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            cartório{' '}
            {valores.cartorio == null ? (
              // Ausente é dito como ausente: um preço sem cartório parece melhor
              // do que é, e um traço sozinho não avisa.
              <span className="text-amber-700">não incluído</span>
            ) : (
              formatBRL(valores.cartorio)
            )}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">custo total {formatBRL(valores.custo_total)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">base {formatBRL(valores.liquido_base)}</span>
        </p>
      )}

      {/* O RESTO ATRÁS DE UM CLIQUE.
          A procedência dos valores é o que evita o erro mais caro — escolher o
          número errado entre os cinco que um crédito tem nos autos —, mas é
          leitura de conferência, não de decisão. Fica a um clique, e não no
          meio dos números. */}
      {!compacta && (origemValores || cartorio || !!valores.ir_honorarios) && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setDetalhes((v) => !v)}
            className="font-medium text-slate-600 hover:underline"
          >
            {detalhes ? 'Ocultar detalhes' : 'Detalhes dos valores'}
          </button>
          {detalhes && (
            <dl className="mt-1.5 space-y-1 border-l-2 border-slate-200 pl-3 leading-relaxed">
              <div>
                <dt className="inline text-slate-500">Base do deságio: </dt>
                <dd className="inline tabular-nums">
                  {formatBRL(valores.liquido_base)} — bruto {formatBRL(valores.bruto)}
                  {!!valores.ir_honorarios && `, IR dos honorários ${formatBRL(valores.ir_honorarios)}`}
                </dd>
              </div>
              <div>
                <dt className="inline text-slate-500">Custo total: </dt>
                <dd className="inline tabular-nums">
                  {formatBRL(valores.custo_total)} — comissão {formatBRL(valores.comissao)}
                  {valores.cartorio != null && cartorio &&
                    `, escritura ${cartorio.escritura} + registro ${cartorio.registro}${cartorio.uf ? ` (${cartorio.uf})` : ''}`}
                </dd>
              </div>
              {origemValores && (
                <div>
                  <dt className="inline text-slate-500">De onde vieram: </dt>
                  <dd className="inline text-slate-600">{origemValores}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
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
  const [regraCartorio, setRegraCartorio] = useState<unknown>(null)
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
  /**
   * O cenário em vigor. Nasce do card e o operador pode trocar.
   *
   * 'indefinido' e 'auto' não são opções da lista — o primeiro é "honorários,
   * sem dizer quais" (o motor resolve contra os autos, e só para quando o
   * processo tem as duas verbas) e o segundo é "o card não disse". Nos dois
   * casos o seletor abre sem seleção, e escolher aqui dispensa a dedução.
   */
  const [cenario, setCenario] = useState<string>(dadosDoCard.tipo_aquisicao)
  const [trocandoCenario, setTrocandoCenario] = useState(false)

  /**
   * Os dados do card, JÁ COM O CENÁRIO EM VIGOR.
   *
   * Existe porque espalhar `...dadosDoCard` em cada chamada mandava sempre o
   * cenário que o card trazia, e não o que o operador escolheu. O seletor
   * sobrepunha na hora da troca, então os números na tela mudavam — mas a
   * mensagem seguinte do chat, a chegada da tabela de cartório e o SALVAR
   * voltavam ao cenário do card, em silêncio. O arquivo no Drive saía do
   * cenário errado, com o nome errado, e nada na tela dizia isso.
   */
  const corpoCard = useMemo(
    // `lead_id` vai em TODAS as chamadas, e não só na primeira: é por ele que a
    // função acha a due diligence dos sujeitos (dd_historico/dd_processo) e
    // preenche as linhas 10 e 11 da aba jurídica. A apuração costuma ser feita
    // DEPOIS da primeira análise, e é o 'salvar' que gera a planilha — mandá-lo
    // só no 'analisar' deixaria de fora justamente a chamada que importa.
    () => ({ ...dadosDoCard, tipo_aquisicao: cenario, lead_id: leadId }),
    [dadosDoCard, cenario, leadId],
  )
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [pedido, setPedido] = useState('')
  /** O relógio da análise que abriu a janela. Ver LinhaDoTempo. */
  const [fases, setFases] = useState<FaseMedida[]>([])
  const [salvo, setSalvo] = useState<RespostaAnaliseRpv | null>(null)
  /**
   * A análise EXATA que virou planilha, para saber se a de agora ainda é ela.
   *
   * Guardado o objeto, e não um contador: toda rodada que substitui a análise
   * faz `setAtual` com um objeto novo — revisão do chat, troca de cenário,
   * cartório informado à mão, reprecificação quando a tabela do estado chega.
   * Comparar por identidade pega as quatro sem ter que lembrar de incrementar
   * nada em cada uma delas.
   */
  const [salvoComoEstava, setSalvoComoEstava] = useState<RespostaAnaliseRpv | null>(null)
  const fimDoChat = useRef<HTMLDivElement>(null)

  const ocupado = passo !== null
  /**
   * Quantas vezes a análise foi substituída (revisão ou salvamento).
   *
   * A consulta do cartório tira uma foto deste número antes de começar; ao
   * voltar, só aplica a reprecificação se ninguém mexeu no meio.
   */
  const revisao = useRef(0)
  /**
   * A consulta de cartório já falhou nesta janela.
   *
   * Sem isto, cada mensagem do chat dispararia uma nova tentativa de 140 s numa
   * UF cuja tabela não se acha — spinner e faixa vermelha a cada frase, sem
   * chance de dar certo. A tentativa por MUDANÇA DE FAIXA continua acontecendo:
   * essa depende do preço, não da UF. Quem quer forçar uma nova busca reabre a
   * janela; quem quer resolver agora usa os campos manuais.
   */
  const cartorioFalhou = useRef(false)

  // Uma análise só, ao abrir. Reabrir a janela do mesmo card recomeça do zero
  // (a página monta a janela com `key` pelo card) — é o comportamento que se
  // quer: a preliminar não é rascunho salvo, é leitura fresca.
  const rodou = useRef(false)
  useEffect(() => {
    if (!open || rodou.current) return
    rodou.current = true
    void (async () => {
      // O CRONÔMETRO. `performance.now()` e não `Date.now()`: é monotônico, e
      // não anda se o relógio do sistema for ajustado no meio de uma espera de
      // minutos. Cada marca fecha a etapa anterior e abre a seguinte, e o
      // estado é atualizado a cada uma — a linha aparece já com o preparo
      // medido, e cresce conforme as etapas terminam, em vez de só existir no
      // fim de tudo.
      let marco = performance.now()
      const medidas: FaseMedida[] = []
      const marcar = (nome: string, ...servidor: Array<{ rotulo: string } & RelogioServidor>) => {
        const agora = performance.now()
        medidas.push({ nome, ms: agora - marco, servidor: servidor.length ? servidor : undefined })
        marco = agora
        setFases([...medidas])
      }
      try {
        const arquivos = await lerArquivos()
        // TODOS OS PDFs COM TEXTO, e não só o último.
        //
        // Era um PDF só — o último que a Kommo listasse —, e isso errava de
        // três jeitos: processo em dois arquivos analisava um; RG anexado por
        // último fazia a análise nem começar ("parece digitalizado"); petição
        // inicial por último fazia a IA precificar o valor da causa. Agora vai
        // tudo o que tem texto, cada arquivo com cabeçalho e cada página com
        // marcador, e o que NÃO deu para ler é dito à IA pelo nome — para ela
        // saber que a conta existe e está numa peça que não veio, em vez de
        // concluir que não há conta.
        //
        // Quando não cabe, a escolha é por PÁGINA (lib/textoDoProcesso.ts):
        // identificação no começo, andamento atual no fim, e no meio o que fala
        // de conta, homologação, requisitório e sentença — não mais 60% do
        // início, que é petição inicial e documento pessoal.
        const legiveis = arquivos.filter((a) => a.texto.trim().length > 0)
        // PÁGINAS DIGITALIZADAS VÃO COMO IMAGEM (lib/paginasDigitalizadas.ts):
        // arquivo inteiro escaneado, ou as páginas escaneadas dentro de um
        // arquivo com texto — o caso híbrido da conta da contadoria em imagem.
        //
        // O ORÇAMENTO É CONJUNTO, e é por isso que a escolha acontece em duas
        // etapas. Texto e imagem vão no MESMO pedido e disputam a mesma janela
        // de 200 mil tokens: 360 mil caracteres com 60 páginas somavam ~294 mil
        // e o pedido voltava HTTP 400 — depois de o navegador ter passado
        // minutos renderizando e subindo tudo. Ver _shared/orcamentoLeitura.ts.
        const paginas: PaginaLida[] = legiveis.flatMap((a) =>
          (a.paginasTexto ?? [a.texto]).map((texto, i) => ({ arquivo: a.nome, numero: i + 1, texto })),
        )
        const charsDisponiveis = paginas.reduce((n, p) => n + p.texto.length, 0)
        // 1ª passada: quantas páginas a seleção QUERIA mandar.
        const desejadas = escolherPaginasParaImagem(arquivos)
          .reduce((n, x) => n + x.numeros.length, 0)
        const plano = planoDeLeitura({
          charsTexto: charsDisponiveis,
          imagensPedidas: desejadas,
          charsNotas: notasKommo.length,
        })
        // 2ª passada: agora com o teto que cabe de verdade.
        const selecao = escolherPaginasParaImagem(arquivos, { ...LIMITES_PADRAO, max: plano.maxImagens })
        const emImagem = new Set(selecao.map((x) => x.arquivo))
        // "Ilegível" é só o que não tem texto E não vai como imagem.
        const ilegiveis = arquivos.filter((a) => a.texto.trim().length === 0 && !emImagem.has(a.nome))
        if (legiveis.length === 0 && selecao.length === 0) {
          const porque = arquivos
            .map((a) => `"${a.nome}": ${a.erro ?? (a.digitalizado ? `${a.paginas} página(s), ${a.densidade} caractere(s) por página — digitalizado` : 'sem texto selecionável')}`)
            .join('; ')
          throw new Error(`Nenhum anexo do card tem texto para ler nem página para enviar como imagem. ${porque || 'Nenhum PDF encontrado.'}`)
        }
        const montado = montarTextoDoProcesso(paginas, plano.maxCharsTexto)
        let t = montado.texto
        if (desejadas > plano.maxImagens) {
          t += `\n\nDAS ${desejadas} PÁGINAS DIGITALIZADAS DESTE PROCESSO, só ${plano.maxImagens} couberam neste pedido (o processo tem texto e imagem demais para uma passada só). ` +
            'As enviadas são as do FIM e as híbridas, que é onde ficam a conta e o requisitório. Se um valor parecer faltar, diga isso em origem_valores em vez de deduzi-lo.'
        }
        if (ilegiveis.length) {
          t += '\n\nANEXOS DO CARD QUE NÃO DEU PARA LER (o dado pode estar neles — NÃO conclua que a informação não existe nos autos): ' +
            ilegiveis.map((a) => `"${a.nome}" (${a.erro ?? (a.digitalizado ? `${a.paginas} páginas digitalizadas` : 'sem texto')})`).join('; ')
        }
        // RENDERIZA E SOBE AS PÁGINAS DIGITALIZADAS. A função lê
        // {userId}/{jobId}/processo/ e manda as imagens à IA junto com o texto.
        // Falha em uma página não derruba as outras; falha em todas, com texto
        // disponível, segue só com o texto e avisa.
        marcar('anexos')
        let jobId: string | undefined
        if (selecao.length) {
          const totalSel = selecao.reduce((n, x) => n + x.numeros.length, 0)
          setPasso(`Preparando ${totalSel} página(s) digitalizada(s) para leitura por imagem…`)
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('Sessão expirada — faça login de novo.')
          jobId = crypto.randomUUID()
          let enviadas = 0
          const falhas: string[] = []
          for (const sel of selecao) {
            const { imagens, falhas: f } = await renderizarPaginas(sel.bytes, sel.numeros, (feitas) => {
              setPasso(`Renderizando "${sel.arquivo}" (${feitas}/${sel.numeros.length} página(s))…`)
            })
            if (f.length) falhas.push(`"${sel.arquivo}" p. ${f.join(', ')}: não renderizou`)
            const base = sel.arquivo.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'arquivo'
            // EM PARALELO, com fila curta. Era um upload de cada vez: sessenta
            // páginas de 100 a 200 KB, uma após a outra, e o rótulo contando
            // devagar enquanto a rede ficava ociosa entre elas. Seis de cada vez
            // aproveitam a banda sem abrir conexões demais — o Storage responde
            // 429 quando se exagera, e aí a "otimização" custaria uma página.
            const CONCORRENCIA = 6
            const fila = [...imagens]
            const trabalhador = async () => {
              for (;;) {
                const img = fila.shift()
                if (!img) return
                const caminho = `${user.id}/${jobId}/processo/${base}-p${String(img.numero).padStart(4, '0')}.jpg`
                const { error } = await supabase.storage
                  .from('analises-input')
                  .upload(caminho, img.blob, { contentType: 'image/jpeg', upsert: true })
                if (error) { falhas.push(`"${sel.arquivo}" p. ${img.numero}: ${error.message}`); continue }
                enviadas++
                setPasso(`Enviando páginas digitalizadas (${enviadas}/${totalSel})…`)
              }
            }
            await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, imagens.length) }, trabalhador))
            // Os blobs já subiram: soltar a referência agora evita segurar
            // dezenas de MB até o fim da análise.
            imagens.length = 0
          }
          if (enviadas === 0) {
            jobId = undefined
            if (legiveis.length === 0) {
              throw new Error(
                `Não consegui enviar as páginas digitalizadas para leitura por imagem: ${falhas.slice(0, 3).join('; ')}. ` +
                'Se a mensagem falar de permissão (policy/RLS), a migração 0055 ainda não rodou.',
              )
            }
            t += `\n\nHAVIA PÁGINAS DIGITALIZADAS (${descreverSelecao(selecao)}) e NÃO foi possível enviá-las como imagem: ${falhas.slice(0, 3).join('; ')}. Se a conta ou o requisitório estiverem nelas, devolva null nos valores e diga isso em origem_valores.`
          } else {
            t += `\n\nPÁGINAS DIGITALIZADAS ENVIADAS COMO IMAGEM (${enviadas}): ${descreverSelecao(selecao)}. Leia-as como parte dos autos.`
            if (falhas.length) t += ` Não foi possível enviar: ${falhas.slice(0, 5).join('; ')}.`
          }
        }
        // DUAS REQUISIÇÕES, UMA POR LEITURA — e não é capricho.
        //
        // O servidor lê o processo duas vezes: o portão de qualificação e a
        // análise. As duas numa requisição só deixaram de caber no teto de
        // 150 s de tempo de parede, e o pedido passou a voltar HTTP 504 antes de
        // terminar. Separadas, cada uma tem o próprio relógio.
        //
        // Não custa o dobro: o cache de prompt da Anthropic vive do lado dela,
        // então a segunda chamada — que sai em seguida — lê o processo do cache
        // em vez de reprocessá-lo. E a qualificação vai pronta no corpo, para o
        // servidor não refazer o portão.
        // A etapa das imagens só existe quando houve imagem: linha com
        // "imagens 0s" em processo nato-digital é ruído.
        if (selecao.length) marcar('imagens')
        setPasso('Qualificando o crédito…')
        const q = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
          acao: 'qualificar',
          texto: t,
          job_id: jobId,
          notas_kommo: notasKommo,
          ...corpoCard,
        })
        marcar('qualificação', ...(q.tempo ? [{ rotulo: 'qualificação', ...q.tempo }] : []))
        // Reprovado no portão: não há segunda etapa, e a janela mostra o motivo.
        if (q.reprovado) { setAtual(q); return }

        // AS DUAS LEITURAS SAEM JUNTAS, e é a razão de existir a ação
        // 'documento'. A análise inteira numa chamada só levava 2m02s de uma
        // requisição de 2m13s, contra um teto de 150 s: vinte segundos de
        // folga. E o custo era de SAÍDA — o processo já estava no cache de
        // prompt desde a qualificação, e o que levava dois minutos era
        // escrever 29 linhas de questionário, a síntese, os critérios da
        // auditoria e os riscos, um token por vez.
        //
        // Saída não acelera; divide-se. Uma leitura escreve os valores, a
        // auditoria e o prazo; a outra, o questionário, a síntese e os riscos.
        // Nenhuma depende da outra, então o relógio passa a ser o MAIOR dos
        // dois em vez da soma — e cada requisição tem o seu próprio teto.
        //
        // EM DUAS REQUISIÇÕES, e não em duas chamadas dentro de uma: o corpo
        // carrega até 60 páginas em base64, e duas cópias vivas na memória do
        // mesmo worker é o que produziu o HTTP 546 antes.
        setPasso('Lendo os valores e o questionário (duas leituras ao mesmo tempo)…')
        const comum = { texto: t, job_id: jobId, notas_kommo: notasKommo, qualificacao: q.qualificacao, ...corpoCard }
        // Promise.all e não allSettled: sem o questionário a planilha sairia
        // com a aba jurídica em branco, e um documento assim é pior que
        // nenhum. Falhando uma, falha a análise, com a mensagem da que falhou.
        const [preco, doc] = await Promise.all([
          invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', { acao: 'analisar', ...comum }),
          invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', { acao: 'documento', ...comum }),
        ])
        marcar(
          'análise',
          ...(preco.tempo ? [{ rotulo: 'valores', ...preco.tempo }] : []),
          ...(doc.tempo ? [{ rotulo: 'questionário', ...doc.tempo }] : []),
        )

        // A CONSOLIDAÇÃO É DO SERVIDOR, e não daqui. Juntar os dois `dados` é
        // um spread de chaves que não se cruzam; o que NÃO é trivial é tudo o
        // que se deriva do conjunto — normalizar as respostas contra as listas
        // do modelo, escrever as linhas 10 e 11 com a due diligence, conferir a
        // linha 34 contra o campo que escolhe o bloco da planilha, checar o
        // piso de R$ 20 mil. Nada disso pôde acontecer nas duas leituras: cada
        // uma tinha metade. 'reprecificar' já faz exatamente isso a partir de
        // um `dados` pronto, sem IA e sem reler o processo — custa segundos.
        setPasso('Juntando as duas leituras…')
        const r = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
          acao: 'reprecificar',
          notas_kommo: notasKommo,
          dados: { ...(preco.dados as Record<string, unknown>), ...(doc.dados_documento ?? {}) },
          emolumentos: null,
          avisos_qualificacao: preco.avisos_qualificacao ?? [],
          ...corpoCard,
        })
        marcar('consolidação', ...(r.tempo ? [{ rotulo: 'consolidação', ...r.tempo }] : []))
        setAtual(r)
        // O SELETOR MOSTRA O QUE O MOTOR DECIDIU. Com "auto" — card que não diz
        // a parcela cedida —, quem escolhe é o destaque da contadoria, e sem
        // isto nenhum botão ficava marcado: a tela não dizia o que estava
        // sendo precificado.
        const c = cenarioDasVerbas(r)
        if (c) setCenario(c)

        // MANDA APURAR O TETO DO ENTE, se ainda não foi.
        //
        // Numa requisição PRÓPRIA e leve, e não dentro da análise: o disparo da
        // pesquisa é segurado por waitUntil no servidor, que mantém o worker
        // vivo com toda a memória dele até a pesquisa acabar — dentro da
        // análise, que carrega o processo inteiro, isso derruba o worker.
        //
        // Não espera e não mostra nada: esta análise já saiu com o aviso de
        // "teto não conferido", e quem se beneficia é a próxima deste ente.
        // Falhar aqui não pode atrapalhar nada, daí o catch vazio.
        if (r.ente_esfera && r.cartorio?.uf) {
          void invokeFunction('gerar-analise-rpv', {
            acao: 'teto',
            uf: r.cartorio.uf,
            esfera_ente: r.ente_esfera,
            municipio_ente: r.ente_municipio ?? null,
          }).catch(() => {})
        }

        // O CARTÓRIO CHEGA DEPOIS, e de propósito: a busca web leva dezenas de
        // segundos e, dentro da análise, derrubava o worker (HTTP 546).
        await levantarRegraCartorio(r)
        // MEDIDO MESMO QUANDO NÃO CUSTA NADA: zero aqui é a informação de que a
        // tabela do estado já estava em cache, e é o contraste com os minutos
        // de um estado novo que explica por que uma análise demorou e a
        // seguinte, não.
        marcar('cartório')
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

  /**
   * Levanta a REGRA de emolumentos do estado e reprecifica com ela.
   *
   * UMA VEZ POR ANÁLISE, e só quando a função pede (`falta_regra`). Antes isto
   * era uma consulta por PREÇO: cada mudança no chat exigia perguntar de novo
   * "quanto custa para este valor", com 140 s de espera, e o preço ainda podia
   * assentar com o emolumento de uma faixa vizinha. Agora o que volta é a
   * tabela do estado — faixas e acréscimos —, e o motor calcula o cartório de
   * qualquer preço sozinho, dentro da própria calibragem.
   *
   * Por isso não há mais rodadas de convergência, nem reconsulta quando o preço
   * muda, nem aviso de "saiu da faixa": o preço e o emolumento vêm da mesma
   * faixa por construção.
   */
  async function levantarRegraCartorio(r: RespostaAnaliseRpv): Promise<void> {
    const uf = r.cartorio?.uf
    if (r.reprovado || !uf || !r.cartorio?.falta_regra) return
    // Já falhou nesta janela: não insiste a cada mensagem do chat. Quem quer
    // tentar de novo reabre a janela; quem quer resolver agora usa os campos
    // manuais.
    if (cartorioFalhou.current) return
    // Foto do contador: se a pessoa revisar no meio, a reprecificação não
    // sobrescreve o que ela acabou de pedir — a regra fica guardada e entra na
    // rodada seguinte, que já a manda.
    const naEpoca = revisao.current

    setPassoCartorio(`Levantando a tabela de emolumentos de ${uf}…`)
    try {
      // PERGUNTA E REPETE, em vez de esperar. Cada volta é uma leitura de tabela
      // no servidor; a pesquisa corre em segundo plano lá. É isto que tira a
      // pesquisa do caminho crítico da tela — antes, uma requisição só tinha de
      // durar mais que a pesquisa inteira, e nunca durava.
      const ate = Date.now() + PRAZO_LEVANTAMENTO
      let e: RespostaConsultaEmolumentos | null = null
      let falhasSeguidas = 0
      for (let volta = 0; ; volta++) {
        try {
          e = await comPrazo(
            invokeFunction<RespostaConsultaEmolumentos>('gerar-analise-rpv', { acao: 'emolumentos', uf }),
            PRAZO_PERGUNTA,
            'o servidor não respondeu à consulta',
          )
          falhasSeguidas = 0
        } catch (erroDaVolta) {
          // UMA CONSULTA LENTA NÃO MATA O LEVANTAMENTO. A pesquisa corre no
          // servidor e não sabe nada desta tela; desistir dela porque uma
          // pergunta demorou é jogar fora um trabalho que está indo bem. Falha
          // isolada (partida a frio, rede oscilando) é só mais uma volta.
          falhasSeguidas++
          if (falhasSeguidas > MAX_FALHAS_SEGUIDAS || Date.now() >= ate) throw erroDaVolta
          if (revisao.current !== naEpoca) return
          setPassoCartorio(`Emolumentos de ${uf}: aguardando o servidor responder…`)
          await espera(INTERVALO_PERGUNTA)
          continue
        }
        if (e?.estado !== 'levantando') break
        if (Date.now() >= ate) break
        // A janela pode ter sido fechada, ou a pessoa já ter salvado: parar de
        // perguntar. A pesquisa continua no servidor e a próxima análise deste
        // estado já a encontra pronta.
        if (revisao.current !== naEpoca) return
        // A etapa vem do servidor. Dizer "lendo a tabela da escritura no
        // documento" é uma informação; "aguarde" com um cronômetro não é, e foi
        // o que deixou a espera parecendo travamento.
        setPassoCartorio(
          e.etapa
            ? `Emolumentos de ${uf}: ${e.etapa}… primeira vez neste estado, leva alguns minutos.`
            : `Levantando a tabela de emolumentos de ${uf}… primeira vez neste estado, leva alguns minutos.`,
        )
        // BACKOFF. Eram 8 s fixos, e cada volta custa ao servidor o par
        // getUser + profiles da autenticação mais a leitura da linha: numa
        // pesquisa de dez minutos, 75 voltas e mais de 200 consultas para
        // descobrir 74 vezes que ainda não acabou. As primeiras voltas seguem
        // rápidas (estado do cache costuma responder já na primeira), depois
        // afrouxa. O operador não nota 30 s numa espera de minutos.
        const base = e.reconsultar_em ? e.reconsultar_em * 1000 : INTERVALO_PERGUNTA
        const fator = volta < 8 ? 1 : volta < 20 ? 2 : 4
        await espera(Math.max(1000, base * fator))
      }

      // EXIGE A REGRA, não só o objeto: a função devolve `{regra: null, motivo}`
      // quando não acha, e verificar só `e.emolumentos` daria verdadeiro —
      // reprecificaria com a mesma ausência e a tela nunca diria que falhou.
      if (!e?.emolumentos?.regra) {
        cartorioFalhou.current = true
        const porque = e?.estado === 'levantando'
          ? `a pesquisa passou de ${PRAZO_LEVANTAMENTO / 60_000} minutos e continua rodando no servidor (${e.etapa ?? 'em andamento'}) — o trabalho não se perde: reabra a janela em alguns minutos e a tabela já deve estar pronta`
          : (e?.emolumentos?.motivo ?? e?.motivo)
        setFalhaCartorio(
          `Procurei a tabela de emolumentos de ${uf} e não consegui levantar${
            porque ? `: ${porque}` : '.'
          } O preço está sem escritura e registro — informe o custo à mão abaixo.`,
        )
        return
      }

      setRegraCartorio(e.emolumentos)
      if (revisao.current !== naEpoca) return

      setPassoCartorio('Refazendo o preço com o cartório…')
      // Sem IA: só recalcula. Por isso é ação própria, e não 'refinar'.
      const r2 = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
        acao: 'reprecificar',
        notas_kommo: notasKommo,
        dados: r.dados,
        emolumentos: e.emolumentos,
        avisos_qualificacao: r.avisos_qualificacao ?? [],
        ...corpoCard,
      })
      if (revisao.current !== naEpoca) return
      setFalhaCartorio(null)
      setAtual(r2)
    } catch (e) {
      cartorioFalhou.current = true
      // FALHA DITA, NÃO ENGOLIDA. A análise segue válida — está na tela, e o
      // aviso de "cartório não incluído" continua de pé —, mas um catch vazio
      // fazia a tela prometer que o preço se refaria e nunca explicar por quê.
      setFalhaCartorio(
        `Não consegui levantar a tabela de emolumentos de ${uf}: ${
          (e as Error)?.message ?? String(e)
        }. O preço está sem escritura e registro.`,
      )
    } finally {
      setPassoCartorio(null)
    }
  }

  /**
   * Troca as verbas negociadas e refaz as contas.
   *
   * NÃO chama a IA: os valores dos autos já estão em `dados` e não foram
   * mutilados pela escolha anterior — o que muda é quais verbas entram na base,
   * onde o deságio incide e quantas escrituras o cartório cobra. É a mesma ação
   * 'reprecificar' que a chegada da tabela de emolumentos usa.
   */
  async function trocarCenario(novo: string) {
    if (novo === cenario || !atual?.dados) return
    const naEpoca = revisao.current
    setCenario(novo)
    setTrocandoCenario(true)
    setErro(null)
    try {
      // O SELETOR VENCE O CHAT. Se a pessoa ditou as verbas no chat ("tira os
      // sucumbenciais") e depois clicou noutro cenário aqui, o clique é a
      // decisão mais recente — então a escolha do chat sai da análise antes de
      // ir. Sem isto o servidor, que dá precedência ao que o chat ditou,
      // ignoraria o clique em silêncio. É a única chave interna que a tela
      // toca, e só para apagá-la.
      const { _verbas_manuais: _descartada, ...semVerbasDoChat } =
        atual.dados as Record<string, unknown>
      void _descartada
      const r = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
        acao: 'reprecificar',
        notas_kommo: notasKommo,
        dados: semVerbasDoChat,
        emolumentos: regraCartorio ?? atual.emolumentos ?? null,
        avisos_qualificacao: atual.avisos_qualificacao ?? [],
        ...corpoCard,
        // O estado do React ainda não mudou quando esta chamada sai.
        tipo_aquisicao: novo,
      })
      if (revisao.current !== naEpoca) return
      setAtual(r)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setTrocandoCenario(false)
    }
  }

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
      // SEM `texto` E COM `emolumentos`, e as duas coisas pela mesma razão: a
      // revisão estourava o teto de 150 s da requisição (erros 504 e 546). O
      // processo inteiro reenviado a cada pedido e uma consulta de cartório por
      // rodada eram o custo. A revisão trabalha sobre o JSON já extraído, e a
      // TABELA do estado vem de volta — com ela o motor recalcula o cartório do
      // preço novo sem consultar nada.
      const r = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
        acao: 'refinar',
        notas_kommo: notasKommo,
        dados: atual.dados,
        emolumentos: regraCartorio ?? atual.emolumentos ?? null,
        instrucao,
        historico: historico.slice(-12),
        avisos_qualificacao: atual.avisos_qualificacao ?? [],
        ...corpoCard,
      })
      setAtual(r)
      // Se o chat ditou as verbas, o botão marcado tem de acompanhar.
      const c = cenarioDasVerbas(r)
      if (c) setCenario(c)
      setMensagens((m) => [...m, { papel: 'ia', texto: r.resposta || 'Alteração aplicada.' }])
      // A REVISÃO NÃO PRECISA MAIS RECONSULTAR NADA quando o preço muda: a
      // regra do estado já viajou junto e o motor recalculou o cartório do preço
      // novo sozinho. Isto aqui só cobre o caso de a regra ainda não existir —
      // primeira análise que falhou, ou UF corrigida no chat.
      void levantarRegraCartorio(r)
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
    // O VALOR DIGITADO VIRA UMA REGRA DE UMA FAIXA SÓ, aberta (`ate: null`).
    //
    // Assim o motor trata o custo informado exatamente como trataria o de uma
    // tabela — mesma função, mesmo caminho — e o valor continua valendo quando o
    // preço muda no chat. Um custo digitado é, por definição, um custo fixo:
    // quem o informou não deu uma tabela, deu um número.
    const emolumentos = {
      uf: uf ?? '',
      ano: new Date().getFullYear(),
      regra: {
        escritura: escritura === null ? null : { faixas: [{ ate: null, valor: escritura }] },
        registro: registro === null ? null : { faixas: [{ ate: null, valor: registro }] },
      },
      fontes: [],
      vigencia: null,
      observacao: 'Custo informado à mão pelo operador, não levantado em tabela.',
      origem: 'nenhuma' as const,
    }
    revisao.current += 1
    setRegraCartorio(emolumentos)
    setFalhaCartorio(null)
    setPasso('Refazendo o preço com o cartório informado…')
    try {
      const r = await invokeFunction<RespostaAnaliseRpv>('gerar-analise-rpv', {
        acao: 'reprecificar',
        notas_kommo: notasKommo,
        dados: atual.dados,
        emolumentos,
        avisos_qualificacao: atual.avisos_qualificacao ?? [],
        ...corpoCard,
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
        emolumentos: regraCartorio ?? atual.emolumentos ?? null,
        avisos_qualificacao: atual.avisos_qualificacao ?? [],
        ...corpoCard,
      })
      setSalvo(r)
      setSalvoComoEstava(atual)
      onSalvo(r)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setPasso(null)
    }
  }

  const riscos = useMemo(() => atual?.riscos ?? [], [atual])
  /**
   * A análise na tela já não é a que foi salva.
   *
   * SALVAR DEIXOU DE SER O FIM DA JANELA. Antes, gravada a planilha, o chat e o
   * botão sumiam: quem quisesse ver o mesmo processo em outro cenário — só o
   * principal, depois principal + honorários — tinha de fechar, reabrir e pagar
   * a leitura inteira do processo de novo, uns dois minutos, para uma conta que
   * a máquina já tinha na memória. E comparar cenários é justamente o que se
   * faz antes de propor.
   *
   * Cada cenário tem nome de arquivo próprio no Drive ("[Principal]",
   * "[Principal + Contratuais]"), então salvar duas vezes deixa duas planilhas
   * lado a lado na pasta do cedente. Salvar o MESMO cenário de novo grava uma
   * revisão do mesmo arquivo — o link não muda.
   */
  const mudouDesdeSalvar = !!salvo && atual !== salvoComoEstava
  // Sem mudança nenhuma, salvar de novo é reenviar bytes idênticos: mais uma
  // anotação no Kommo e mais uma revisão no Drive dizendo o mesmo.
  const podeSalvar =
    !!atual && !atual.reprovado && !!atual.dados && !ocupado && (!salvo || mudouDesdeSalvar)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      // Preliminar sem salvar é trabalho que se perde ao fechar — daí a
      // confirmação. Depois de salva ela também volta a sujar: mexeu no
      // cenário ou no chat e não regravou, o que está no Drive é o de antes.
      dirty={!!atual && !atual.reprovado && (!salvo || mudouDesdeSalvar)}
      // O TÍTULO DO CARD DESCEU PARA A LINHA DE BAIXO. Ele traz intermediador,
      // cedente e número do processo — três dados que somados passam de oitenta
      // caracteres e faziam o título quebrar em duas linhas de corpo grande, no
      // lugar de maior peso da janela. Em cima fica o que a janela É; embaixo,
      // em corpo pequeno, de qual crédito ela trata.
      //
      // A descrição que estava aqui ("Preliminar: nada foi gravado…") saiu: ela
      // explicava um estado que a própria janela mostra — enquanto houver o
      // botão Salvar, nada foi salvo.
      title="Análise de RPV"
      description={titulo}
      footer={
        <div className="flex items-center justify-end gap-3">
          {/* Só o Salvar. O "Fechar sem salvar" duplicava o X do canto, e o
              número do card ocupava o rodapé com um dado que ninguém usa
              dentro da janela. */}
          {salvo && !mudouDesdeSalvar && (
            <span className="text-xs text-slate-400">Nada mudou desde o último salvamento.</span>
          )}
          <Button
            onClick={salvar}
            disabled={!podeSalvar}
            loading={passo === 'Gerando a planilha e salvando no Drive…'}
            icon={<Save className="h-4 w-4" />}
          >
            Salvar no Drive
          </Button>
        </div>
      }
    >
      {erro && (
        <div className="mb-4 rounded-xl bg-red-50/70 px-3.5 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200/70">
          {erro}
        </div>
      )}

      {!atual && passo && <Loading label={passo} />}

      {atual?.reprovado && (
        <div className="rounded-xl bg-red-50/70 p-4 text-sm text-red-800 ring-1 ring-inset ring-red-200/70">
          <p className="font-semibold">Reprovado no Portão 1</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {(atual.motivos ?? []).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {atual && !atual.reprovado && atual.valores && (
        <div className="space-y-5">
          {/* O QUE ESTÁ SENDO COMPRADO, acima dos números — porque é a premissa
              deles. Vem do "PARCELA CEDIDA" do card e é editável: o cadastro do
              comercial erra, e até agora a única saída era corrigir no Kommo e
              refazer a análise inteira. Trocar aqui só refaz as contas.

              LISTA, e não fileira de botões. Eram quatro pílulas, uma delas com
              quarenta caracteres, quebrando em duas linhas e ocupando a largura
              da janela para exibir três opções que não estão em uso. A lista
              mostra o que está valendo e guarda o resto. */}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="cenario-rpv" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Negociando
            </label>
            <Select
              id="cenario-rpv"
              className="w-auto min-w-[16rem] py-1.5 text-sm"
              value={CENARIOS_RPV.some((c) => c.valor === cenario) ? cenario : ''}
              disabled={trocandoCenario || ocupado}
              onChange={(e) => void trocarCenario(e.target.value)}
            >
              {/* Sem opção marcada quando o card não disse a parcela cedida: a
                  lista não pode fingir uma escolha que ninguém fez. */}
              {!CENARIOS_RPV.some((c) => c.valor === cenario) && (
                <option value="">Selecione o que está sendo cedido…</option>
              )}
              {CENARIOS_RPV.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.label}
                </option>
              ))}
            </Select>
            {trocandoCenario && <span className="text-xs text-slate-400">refazendo as contas…</span>}
          </div>

          {/* O preço, verba a verba — a conversa com o cedente. */}
          <PainelPreco valores={atual.valores} />

          {/* E o que a operação custa e devolve — a conversa interna. */}
          <ResumoInvestimento
            valores={atual.valores}
            cartorio={atual.cartorio}
            atingiuAlvo={atual.atingiu_alvo}
          />

          {/* O CAMINHO ATÉ O DINHEIRO. Prazo é a variável que mais mexe no
              preço — 8 meses ou 14 mudam o deságio inteiro —, e antes ele era um
              número saído de uma fórmula fixa, sem como conferir. Aqui estão os
              atos que faltam, com os dias de cada um e de onde o número veio.
              Discordar de um item é uma frase no chat abaixo. */}
          {!!atual.roteiro?.length && (
            <section>
              <h3 className="font-display text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Caminho até a liquidação
              </h3>
              {atual.etapa_atual && (
                <p className="mt-1 text-xs text-slate-600">
                  <span className="text-slate-500">Hoje:</span> {atual.etapa_atual}
                </p>
              )}
              <ol className="mt-2 space-y-1">
                {atual.roteiro.map((a, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-slate-700">
                      {a.dias}d
                    </span>
                    <span className="min-w-0">
                      <span className="text-slate-800">{a.ato}</span>
                      {a.base && <span className="text-slate-500"> · {a.base}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-1.5 border-t border-slate-200 pt-1.5 text-xs text-slate-600">
                <span className="w-14 inline-block text-right font-semibold tabular-nums">
                  {atual.roteiro.reduce((t, a) => t + a.dias, 0)}d
                </span>{' '}
                somados
                {atual.valores &&
                  ` · prazo usado no preço: ${atual.valores.prazo_meses} meses`}
              </p>
            </section>
          )}

          {atual.m1_sintese && (
            <section>
              <h3 className="font-display text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Síntese
              </h3>
              <p className="mt-1 text-sm text-slate-800">{atual.m1_sintese}</p>
            </section>
          )}

          {/* A AUDITORIA ENTRE A SÍNTESE E OS RISCOS, e nessa ordem por um
              motivo: ela é o que pode mudar o VALOR do crédito, e os riscos são
              o que pode atrapalhar o recebimento. Quem lê de cima para baixo
              precisa saber quanto vale antes de saber o que ameaça. */}
          {atual.auditoria && <PainelAuditoria auditoria={atual.auditoria} />}

          {/* OS ALERTAS DA AUDITORIA SAEM DAQUI: o painel de cima já os diz, e
              esta lista os repetia palavra por palavra. Descontados pela
              comparação com a lista que o servidor manda, e não por procura de
              texto — o dia em que a frase mudar, a subtração continua certa. */}
          <ListaDeRiscos
            riscos={riscos}
            avisos={(atual.avisos ?? []).filter((a) => !(atual.auditoria?.avisos ?? []).includes(a))}
          />

          {/* A CONSULTA DO CARTÓRIO EM ANDAMENTO, visível e sem travar nada.
              O passo dela usava o mesmo estado do resto, que desabilita o campo
              do chat — e o rótulo só aparecia antes de a análise existir. Dava
              campo morto sem explicação. Agora ela tem linha própria, some
              sozinha e o chat segue utilizável enquanto isso. */}
          {passoCartorio && (
            <p className="flex items-center gap-2 rounded-xl px-3.5 py-3 text-xs text-slate-500 ring-1 ring-inset ring-slate-200/80">
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              {passoCartorio} Você já pode pedir alterações — o preço se refaz quando
              o custo chegar.
            </p>
          )}

          {/* A consulta do cartório falhou. Em vermelho, e separado dos avisos:
              o aviso da análise diz que a tela pediria o custo em seguida — sem
              isto, a promessa fica sem desfecho. */}
          {falhaCartorio && (
            <p className="rounded-xl bg-red-50/70 px-3.5 py-3 text-xs text-red-800 ring-1 ring-inset ring-red-200/70">
              {falhaCartorio}
            </p>
          )}

          {/* SAÍDA MANUAL. Aparece quando o preço está sem cartório e não há
              consulta em andamento. Quem opera sabe quanto custa a escritura no
              cartório onde lavra — sem isto, a busca falhando deixa a pessoa sem
              nada a fazer dentro da janela. */}
          {atual?.valores && atual.valores.cartorio == null && !passoCartorio && (
            <div className="rounded-xl px-3.5 py-3 ring-1 ring-inset ring-slate-200/80">
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

          {/* O AVISO DO SALVAMENTO NÃO OCUPA MAIS O LUGAR DO CHAT — ele fica
              acima dele. Trocar um pelo outro era o que impedia de continuar
              trabalhando depois de gravar, e o preço disso era reabrir a janela
              e reler o processo inteiro. */}
          {salvo && (
            <div
              className={cn(
                'rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset',
                mudouDesdeSalvar
                  ? 'bg-amber-50/70 text-amber-900 ring-amber-200/70'
                  : 'bg-emerald-50/70 text-emerald-800 ring-emerald-200/70',
              )}
            >
              {mudouDesdeSalvar
                ? 'A análise mudou depois de salva — a planilha no Drive ainda é a versão anterior. Salve de novo para gravar esta. '
                : '✅ Planilha salva. '}
              {salvo.drive_file_url && (
                <a className="font-medium underline" href={salvo.drive_file_url} target="_blank" rel="noreferrer">
                  Abrir a última planilha salva
                </a>
              )}
            </div>
          )}

          <LinhaDoTempo fases={fases} />

          <section className="border-t border-slate-200/80 pt-5">
            {/* A explicação saiu: ela ensinava o que o campo abaixo já ensina
                pelo exemplo do placeholder, e ocupava duas linhas em toda
                análise, inclusive na décima do dia. */}
            <h3 className="font-display flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <Sparkles className="h-3.5 w-3.5" /> Pedir alterações
            </h3>

            {mensagens.length > 0 && (
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                {mensagens.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      'max-w-[85%] whitespace-pre-line rounded-xl px-3.5 py-2 text-sm leading-relaxed',
                      m.papel === 'usuario'
                        ? 'ml-auto bg-brand-600 text-white'
                        : 'bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200/70',
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
                className="min-h-[44px] flex-1 resize-y rounded-xl border border-slate-200 px-3.5 py-2 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
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
              {/* SÓ O ÍCONE. Um botão sólido escrito "Enviar" ao lado do
                  campo pesava mais que o próprio campo, num gesto que na
                  prática se faz pelo Enter. Discreto, mas com alvo de clique
                  inteiro e rótulo acessível. */}
              <button
                type="button"
                onClick={pedirAlteracao}
                disabled={ocupado || !pedido.trim()}
                aria-label="Enviar pedido de alteração"
                title="Enviar (Enter)"
                className={cn(
                  'mb-0.5 shrink-0 rounded-lg p-2.5 text-slate-400 transition-colors',
                  'hover:bg-slate-100 hover:text-brand-700',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1',
                  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400',
                )}
              >
                {passo === 'Revisando a análise…' ? (
                  <span className="block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
              </button>
            </div>
          </section>
        </div>
      )}
    </Modal>
  )
}
