// O preço da cessão: quais verbas se compra, quanto de deságio, e quanto custa.
//
// SEM DEPENDÊNCIA DE INTEGRAÇÃO, como emolumentos-calculo.ts e irpf.ts: só
// importa a conta do cartório, que também é pura. É o que permite testar o
// núcleo de dinheiro em src/lib/__tests__ — antes ele morava dentro da Edge
// Function, junto do SDK da IA, e nenhum teste o alcançava.
import { custoParaPreco, type CustoCartorio, type RegraEmolumentos } from './emolumentos-calculo.ts'
// irpf.ts também não importa nada: o módulo segue alcançável pelos testes.
import { irProgressivo } from './irpf.ts'

/**
 * Uma parcela do crédito que está sendo comprada.
 *
 * O preço deixou de ser um número só. São até três verbas — principal,
 * honorários contratuais e sucumbenciais —, cada uma com o seu líquido, e duas
 * regras da casa que só fazem sentido parcela a parcela:
 *
 *   1. O DESÁGIO NÃO É UNIFORME. Havendo principal no negócio, os honorários
 *      são comprados pelo valor de face e TODO o deságio necessário para bater
 *      a rentabilidade cai sobre o principal. É prática da Credijuris. Numa
 *      cessão só de honorários não há onde jogar o deságio, então ele volta a
 *      incidir sobre eles — senão não haveria margem nenhuma.
 *
 *   2. O CARTÓRIO É POR VERBA. Cada crédito cedido é uma escritura e um
 *      registro próprios: principal sozinho, um par; principal mais
 *      contratuais, dois; com sucumbenciais, três. Cobrar um par só sobre a
 *      soma subestima o custo — e subestima mais quanto mais fracionado for o
 *      negócio, porque a tabela de emolumentos é progressiva por faixa.
 */
export interface Parcela {
  nome: 'principal' | 'contratuais' | 'sucumbenciais'
  /** O que se compra desta verba, já líquido de IR e INSS. */
  liquido: number
  /**
   * O VALOR DE FACE da verba cedida, antes das retenções.
   *
   * Serve a UMA coisa: as tabelas de emolumentos que cobram o ato sobre o valor
   * do crédito, e não sobre o preço da cessão (ver BaseCalculo). O que se
   * declara na escritura é o crédito cedido pelo seu valor de face — o IR e o
   * INSS são retenção na fonte de quem paga, não abatimento do crédito. Passar o
   * líquido, como se fazia, subestimava o emolumento nesses estados; e o erro
   * era invisível, porque o cartório saía plausível.
   */
  bruto: number
  /** O deságio incide sobre ela? */
  desagiavel: boolean
}

export interface VerbasNegociadas {
  principal: boolean
  contratuais: boolean
  sucumbenciais: boolean
}

/**
 * Como o cenário se chama — os quatro valores da lista suspensa da C3.
 *
 * Mora aqui porque DOIS FLUXOS o escrevem: a análise de RPV, na célula C3 da aba
 * jurídica, e a análise jurídica do precatório, na ficha que volta ao card do
 * Kommo. O comercial lê os dois no mesmo lugar, e não deve ter de aprender dois
 * vocabulários por causa de uma diferença que só existe do nosso lado.
 *
 * Não há rótulo para "contratuais apenas": a lista da planilha não tem, e a
 * razão é que ceder os contratuais sem os sucumbenciais é o caso raro — quase
 * sempre o card que diz "contratuais" é um processo SEM sucumbenciais.
 *
 * A gerar-analise-rpv atribui o rótulo ramo por ramo em vez de chamar isto num
 * ponto só, e de propósito: quando o card diz "honorários" sem dizer quais e os
 * autos têm uma verba só, ela ESTREITA o rótulo para a verba que existe. Aqui,
 * que recebe só as verbas pedidas, não haveria como saber disso.
 */
export function rotuloDoCenario(v: VerbasNegociadas): string {
  if (v.principal) {
    return v.contratuais || v.sucumbenciais
      ? 'Crédito principal + Honorários'
      : 'Crédito principal — apenas'
  }
  if (v.contratuais) return 'Honorários contratuais + sucumbenciais'
  if (v.sucumbenciais) return 'Honorários sucumbenciais — apenas'
  return ''
}

/** Os valores do crédito, como saem dos autos ou como a auditoria os revisa. */
export interface ValoresCredito {
  brutoTotal: number
  ir: number
  inss: number
  contratuaisBrutos: number
  sucumbenciaisBrutos: number
}

export interface Auditoria {
  valores: ValoresCredito
  /** A auditoria mudou os valores? */
  aplicada: boolean
  /** Quanto do bruto ela cortou, em reais. */
  corte: number
  /** Por que não foi aplicada, quando não foi. */
  motivo?: string
}

/**
 * O CENÁRIO CONSERVADOR sobre os valores dos autos.
 *
 * Cálculo homologado não é cálculo definitivo: critério contrário ao título
 * executivo ou à lei se revisa mesmo depois do trânsito, e quem compra o
 * crédito é quem perde se a revisão vier. Quando a auditoria estima um bruto
 * revisado menor, é ele que precifica.
 *
 * AUDITORIA NUNCA AUMENTA CRÉDITO. Se a conta subestimou em favor da Fazenda,
 * isso é ganho eventual do cessionário e não entra no preço — comprar contando
 * com uma revisão favorável é apostar, não precificar. Por isso um bruto
 * conservador maior que o dos autos é recusado, e não simplesmente ignorado: o
 * motivo aparece na tela.
 *
 * As deduções acompanham o bruto pelo MESMO FATOR. Revisada a conta, IR, INSS e
 * honorários se recalculam sobre a base nova; escalar tudo junto mantém a
 * proporção sem fingir uma precisão que a estimativa não tem.
 */
export function aplicarAuditoria(autos: ValoresCredito, brutoConservador: number | null | undefined): Auditoria {
  const bruto = autos.brutoTotal
  const alvo = Number(brutoConservador)
  if (!Number.isFinite(alvo) || alvo <= 0) return { valores: autos, aplicada: false, corte: 0 }
  if (!(bruto > 0)) return { valores: autos, aplicada: false, corte: 0, motivo: 'sem bruto nos autos para comparar' }
  if (alvo >= bruto) {
    return {
      valores: autos, aplicada: false, corte: 0,
      motivo: alvo > bruto
        ? 'a auditoria estimou um crédito MAIOR que o dos autos, e isso não entra no preço: ganho eventual do cessionário não se compra'
        : 'a auditoria não achou divergência que reduza o crédito',
    }
  }
  const fator = alvo / bruto
  return {
    aplicada: true,
    corte: bruto - alvo,
    valores: {
      brutoTotal: alvo,
      ir: autos.ir * fator,
      inss: autos.inss * fator,
      contratuaisBrutos: autos.contratuaisBrutos * fator,
      sucumbenciaisBrutos: autos.sucumbenciaisBrutos * fator,
    },
  }
}

/**
 * As parcelas de um negócio, montadas a partir dos valores dos autos.
 *
 * `verbas` diz o que está sendo comprado; parcela de valor zero fica de fora,
 * porque verba que não existe não gera escritura nem entra na base.
 */
export function montarParcelas(o: {
  brutoTotal: number
  ir: number
  inss: number
  /** Honorários contratuais, valor BRUTO destacado do principal. */
  contratuaisBrutos: number
  /** Honorários sucumbenciais, valor BRUTO — vêm por fora, pagos pelo vencido. */
  sucumbenciaisBrutos: number
  verbas: VerbasNegociadas
}): Parcela[] {
  // CADA VERBA DE HONORÁRIO É TRIBUTADA EM SEPARADO, e não a soma das duas.
  //
  // É o que as fórmulas M7 e M8 do modelo fazem, e é o que a realidade costuma
  // ser: contratuais e sucumbenciais vêm em requisitórios distintos — os
  // sucumbenciais podem até ser precatório enquanto o principal é RPV —, e
  // competências separadas têm incidências separadas.
  //
  // A diferença não é de centavos: tributar a soma aplica a parcela a deduzir
  // UMA vez, tributar separado aplica DUAS. Num caso de R$ 21.655 + R$ 7.218
  // dá R$ 908,73 de imposto a mais ou a menos, e é exatamente o valor da
  // parcela. Motor e planilha divergirem nisso significava a tela mostrar um
  // líquido e o arquivo mostrar outro.
  const candidatas: Parcela[] = [
    {
      nome: 'principal',
      // Os contratuais saem de DENTRO do principal (por isso descontados aqui,
      // pelo bruto); os sucumbenciais não, porque quem os paga é o vencido.
      liquido: o.brutoTotal - o.ir - o.inss - o.contratuaisBrutos,
      // De face: o crédito do credor é o bruto menos a parte que já é do
      // advogado. IR e INSS não saem daqui — são retenção de quem paga.
      bruto: o.brutoTotal - o.contratuaisBrutos,
      desagiavel: true,
    },
    {
      nome: 'contratuais',
      liquido: o.contratuaisBrutos - irProgressivo(o.contratuaisBrutos).imposto,
      bruto: o.contratuaisBrutos,
      desagiavel: false,
    },
    {
      nome: 'sucumbenciais',
      liquido: o.sucumbenciaisBrutos - irProgressivo(o.sucumbenciaisBrutos).imposto,
      bruto: o.sucumbenciaisBrutos,
      desagiavel: false,
    },
  ]

  const dentro = candidatas.filter((p) => o.verbas[p.nome] && p.liquido > 0)

  // SEM PRINCIPAL NO NEGÓCIO, o deságio volta para os honorários: é o que
  // sobrou para absorvê-lo. Comprar honorário pelo valor de face sem principal
  // nenhum seria pagar o crédito inteiro e ainda arcar com comissão, cartório e
  // diligência — prejuízo garantido, não margem apertada.
  const temPrincipal = dentro.some((p) => p.nome === 'principal')
  return dentro.map((p) => ({ ...p, desagiavel: temPrincipal ? p.nome === 'principal' : true }))
}

export interface ParcelaPrecificada extends Parcela {
  /** O que se paga por esta verba. */
  preco: number
  /** Escritura + registro DESTA verba, ou null se a tabela não cobre o valor. */
  cartorio: CustoCartorio
}

export interface Precificacao {
  desagio: number
  parcelas: ParcelaPrecificada[]
  /** Base: a soma dos líquidos comprados. */
  Y3: number
  /** Comissão de originação e intermediação. */
  Y5: number
  /** Preço da cessão: a soma do que se paga por cada verba. */
  cessao: number
  /** Cartório somado de todas as verbas; null quando nenhuma pôde ser calculada. */
  Y10: number | null
  /** Custo total da operação. */
  Y4: number
  /** Rentabilidade mensal. */
  Y9: number
  desagioEfetivo: number
  atingiuAlvo: boolean
  /** Uma linha por verba, para a nota da planilha e para a tela. */
  descricaoCartorio: string
  /** Todas as verbas tiveram escritura E registro calculados? */
  cartorioCompleto: boolean
  /** As escrituras somadas, para a tela mostrar a decomposição. */
  escrituraTotal: number | null
  /** Os registros somados. */
  registroTotal: number | null
}

/**
 * As escrituras e os registros somados entre as verbas.
 *
 * Null quando nenhuma verba teve aquele ato calculado — distinto de zero, que
 * seria um ato de graça. Uma verba fora das faixas não zera a soma das outras:
 * meio custo com origem clara é útil, e o aviso pede o resto.
 */
function somarAtos(parcelas: ParcelaPrecificada[]): { escrituraTotal: number | null; registroTotal: number | null } {
  const somar = (pega: (p: ParcelaPrecificada) => number | null) => {
    const com = parcelas.map(pega).filter((v): v is number => v != null)
    return com.length ? com.reduce((s, v) => s + v, 0) : null
  }
  return {
    escrituraTotal: somar((p) => p.cartorio.escritura),
    registroTotal: somar((p) => p.cartorio.registro),
  }
}

/**
 * Acha o menor deságio que atinge a rentabilidade-alvo.
 *
 * NUNCA lança: se nem no teto (95%) der para atingir o alvo, devolve o melhor
 * caso com `atingiuAlvo: false`, para a planilha sempre sair.
 */
export function calibrarDesagio(o: {
  parcelas: Parcela[]
  T5: number
  comissaoPct?: number
  diligencia?: number
  alvo?: number
  /**
   * A REGRA de emolumentos do estado — faixas e acréscimos —, não um valor.
   *
   * É o que permite calcular o cartório DE CADA PREÇO CANDIDATO dentro do laço,
   * em vez de fixar um custo apurado para outro preço. null = tabela
   * desconhecida; precifica sem cartório, e quem chama avisa.
   */
  regra: RegraEmolumentos | null
  /**
   * O deságio DITADO, quando quem decide o preço já sabe onde quer fechar.
   *
   * Fecha o negócio no número pedido em vez de procurar o que bate a meta — e a
   * rentabilidade resultante sai calculada, para a decisão ser informada. Sem
   * isto, "quero fechar a 30%" só se conseguia mexendo em dados de entrada até
   * a calibragem cair perto, o que é adivinhação com passos extras.
   */
  desagioFixo?: number | null
}): Precificacao {
  const alvo = o.alvo ?? 0.028
  const dilig = o.diligencia ?? 250
  const Y3 = o.parcelas.reduce((s, p) => s + p.liquido, 0)
  const Y5 = (o.comissaoPct ?? 0.09) * Y3

  // CARTÓRIO DESCONHECIDO ENTRA COMO ZERO, E MARCADO: precifica sem ele, Y10
  // fica null e quem chama avisa que o preço saiu sem escritura e registro.
  // Preço um pouco otimista que a pessoa completa à mão é melhor que nenhum
  // preço, e muito melhor que um preço com cartório inventado.
  //
  // O CUSTO É RECALCULADO A CADA PREÇO CANDIDATO, e por verba. custoParaPreco é
  // pura e instantânea, então cabe dentro do laço — é isso que faz o preço sair
  // com o emolumento da faixa certa já na primeira passada.
  const avaliar = (d: number) => {
    const parcelas: ParcelaPrecificada[] = o.parcelas.map((p) => {
      const preco = p.liquido * (1 - (p.desagiavel ? d : 0))
      // O VALOR DE FACE da verba vai junto: é o "valor do crédito cedido" para
      // as tabelas que cobram o ato sobre ele, e não sobre o preço (ver
      // BaseCalculo em emolumentos-calculo.ts). Era o líquido, e o líquido é o
      // crédito já descontado de retenções que não são abatimento do crédito —
      // nesses estados o emolumento saía subestimado.
      return { ...p, preco, cartorio: custoParaPreco(o.regra, preco, p.nome, p.bruto || p.liquido) }
    })
    const cessao = parcelas.reduce((s, p) => s + p.preco, 0)
    const comCartorio = parcelas.filter((p) => p.cartorio.total != null)
    const Y10 = comCartorio.length ? comCartorio.reduce((s, p) => s + (p.cartorio.total ?? 0), 0) : null
    const Y4 = cessao + Y5 + (Y10 ?? 0) + dilig
    const Y9 = Y4 > 0 ? Math.pow(Y3 / Y4, 1 / o.T5) - 1 : 0
    return { d, parcelas, cessao, Y10, Y4, Y9 }
  }

  const montar = (r: ReturnType<typeof avaliar>, atingiuAlvo: boolean): Precificacao => ({
    desagio: r.d,
    parcelas: r.parcelas,
    Y3, Y5,
    cessao: r.cessao,
    Y10: r.Y10,
    Y4: r.Y4,
    Y9: r.Y9,
    desagioEfetivo: Y3 > 0 ? 1 - r.cessao / Y3 : 0,
    atingiuAlvo,
    // Uma linha por verba: é o que permite conferir de onde saiu cada
    // escritura, num custo que agora é soma de vários atos.
    descricaoCartorio: r.parcelas.map((p) => p.cartorio.descricao).join(' | '),
    cartorioCompleto: r.parcelas.length > 0 && r.parcelas.every((p) => p.cartorio.completo),
    ...somarAtos(r.parcelas),
  })

  // BUSCA BINÁRIA, e não varredura: 14 avaliações no lugar de 9.501. Vale
  // porque Y9 é monotonicamente CRESCENTE no deságio — mais deságio, cessão
  // menor, custo total menor, rentabilidade maior. As parcelas não desagiáveis
  // são constantes e não quebram a monotonia; o cartório delas também.
  //
  // A busca é sobre o ÍNDICE da grade de 0,01% (k de 0 a 9500), não sobre o
  // real, para o d devolvido ser exatamente o da grade.
  const PASSOS = 9500
  const dDe = (k: number) => k * 0.0001
  const bate = (k: number) => avaliar(dDe(k)).Y9 >= alvo

  if (!o.parcelas.length) return montar(avaliar(0), false)

  // DESÁGIO DITADO: não há o que procurar. `atingiuAlvo` diz se o número
  // escolhido bate a meta — é a informação que interessa a quem ditou.
  if (o.desagioFixo != null && Number.isFinite(o.desagioFixo)) {
    const d = Math.min(0.95, Math.max(0, o.desagioFixo))
    const r = avaliar(d)
    return montar(r, r.Y9 >= alvo)
  }

  if (!bate(PASSOS)) return montar(avaliar(dDe(PASSOS)), false)  // nem no teto
  if (bate(0)) return montar(avaliar(0), true)                   // bate sem deságio

  let baixo = 0, alto = PASSOS
  while (alto - baixo > 1) {
    const meio = (baixo + alto) >> 1
    if (bate(meio)) alto = meio; else baixo = meio
  }
  return montar(avaliar(dDe(alto)), true)
}
