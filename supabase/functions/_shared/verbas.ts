// QUAIS VERBAS ESTÃO SENDO COMPRADAS, e se há alguma.
//
// SEM DEPENDÊNCIA DE NADA além do rótulo do cenário, que também é puro. As duas
// decisões daqui moravam dentro da Edge Function:
//
//   `decidirVerbas` traduz o "PARCELA CEDIDA" do card no conjunto de verbas que
//   entra na conta. Um dos ramos DEVOLVE ERRO — "honorários" sem dizer quais,
//   num processo que tem os dois —, e nenhum tinha caso escrito.
//
//   `temVerbaNegociavel` é a única coisa entre "crédito sem valor nos autos" e
//   uma planilha afirmando zero.
//
// AS MARCAS SAEM NA ENTRADA, e é o outro conserto: elas eram gravadas só no ramo
// que as produz e nunca zeradas nos outros. `tipo_aquisicao` vem do corpo a cada
// chamada, e o seletor da janela reenvia o mesmo objeto trocando só o cenário —
// então "o card não diz a parcela cedida" e "o card diz contratuais e o processo
// tem sucumbenciais" sobreviviam à escolha que os desmentia.
import { rotuloDoCenario, type VerbasNegociadas } from './precificacao.ts'

export interface DecisaoDeVerbas {
  verbas: VerbasNegociadas
  tipoCredito: string
  /** O card pediu contratuais e o processo TEM sucumbenciais: entram, e se diz. */
  sucumbNaoPrevistos?: number
  /** "Honorários" resolvido contra os autos: qual dos dois existe. */
  honorariosResolvido?: 'contratuais' | 'sucumbenciais'
  /** Campo em branco no card: assumiu-se o principal, e isso vai avisado. */
  parcelaNaoInformada?: boolean
}

/** Quando a escolha é real e o motor não pode adivinhar. */
export interface AmbiguidadeDeVerbas {
  erro: 'honorarios_ambiguos'
  contratuais: number
  sucumbenciais: number
}

export function decidirVerbas(
  tipoAquisicao: string,
  o: {
    /** O honorário contratual que vai ao preço (calculado ou destacado). */
    contratuais: number
    /** Os sucumbenciais brutos dos autos. */
    sucumbenciais: number
    /** O percentual do card, quando informado: prova de que há contratual. */
    pctCard: number | null
  },
): DecisaoDeVerbas | AmbiguidadeDeVerbas {
  const contratuais = Number(o.contratuais) || 0
  const sucumbenciais = Number(o.sucumbenciais) || 0

  if (tipoAquisicao === 'principal') {
    return {
      verbas: { principal: true, contratuais: false, sucumbenciais: false },
      tipoCredito: 'Crédito principal — apenas',
    }
  }
  if (tipoAquisicao === 'ambos') {
    // "Principal + honorários" leva o honorário que existir, dos dois tipos.
    return {
      verbas: { principal: true, contratuais: true, sucumbenciais: true },
      tipoCredito: 'Crédito principal + Honorários',
    }
  }
  if (tipoAquisicao === 'honorarios' || tipoAquisicao === 'contratuais') {
    return {
      verbas: { principal: false, contratuais: true, sucumbenciais: true },
      tipoCredito: 'Honorários contratuais + sucumbenciais',
      // Card diz só "contratuais" e o processo TEM sucumbenciais: entram no
      // preço, porque cede-se o honorário que existe — mas é o caso raro, e quem
      // fecha precisa saber que está comprando as duas verbas.
      ...(tipoAquisicao === 'contratuais' && sucumbenciais > 0 ? { sucumbNaoPrevistos: sucumbenciais } : {}),
    }
  }
  if (tipoAquisicao === 'sucumbenciais') {
    return {
      verbas: { principal: false, contratuais: false, sucumbenciais: true },
      tipoCredito: 'Honorários sucumbenciais — apenas',
    }
  }
  if (tipoAquisicao === 'indefinido') {
    // "HONORÁRIOS", SEM DIZER QUAIS — E OS AUTOS COSTUMAM DIZER POR ELE.
    //
    // A maioria das RPVs vem do JUIZADO ESPECIAL, onde não há sucumbência em
    // primeiro grau (art. 55 da Lei 9.099/95). Ali existe UM honorário só, o
    // contratual, e "honorários" não é ambíguo: é o único que existe.
    //
    // Isto já bloqueou a análise inteira, e o raciocínio estava certo pela
    // metade: chutar entre duas verbas é caro, mas só HÁ escolha quando as duas
    // existem. Bloquear antes de ler os autos recusava a maioria dos casos por
    // uma ambiguidade que não havia — e o comercial não tinha o que corrigir no
    // card, porque o card estava certo.
    const temContratuais = contratuais > 0 || o.pctCard != null
    const temSucumbenciais = sucumbenciais > 0
    // AS DUAS EXISTEM: aí sim a escolha é real e muda o preço — os contratuais
    // saem de dentro do principal, os sucumbenciais vêm por fora, pagos pelo
    // vencido. Não há como adivinhar qual foi cedida, e o palpite não aparece no
    // resultado.
    if (temContratuais && temSucumbenciais) {
      return { erro: 'honorarios_ambiguos', contratuais, sucumbenciais }
    }
    // Uma só: é ela, e o motor diz de qual se trata em vez de deixar o operador
    // supor. Verba de valor zero é descartada na montagem das parcelas, então
    // marcar as duas aqui não inventa escritura de cartório.
    return {
      verbas: { principal: false, contratuais: true, sucumbenciais: true },
      tipoCredito: temSucumbenciais
        ? 'Honorários sucumbenciais — apenas'
        : 'Honorários contratuais + sucumbenciais',
      honorariosResolvido: temSucumbenciais ? 'sucumbenciais' : 'contratuais',
    }
  }
  // Automático: o destaque da contadoria decide se há honorários a comprar.
  //
  // NADA DITO NÃO É "PRINCIPAL" — é campo em branco. O automático assume o
  // principal porque é o caso comum, mas assumir em silêncio custa caro: uma
  // cessão só de honorários sai precificada com o crédito principal dentro, e a
  // análise não tem como saber que errou. Como a parcela cedida também pode vir
  // no TÍTULO do card, campo em branco é esquecimento provável — então avisa.
  const comHonorarios = contratuais > 0 || o.pctCard != null
  return {
    verbas: { principal: true, contratuais: comHonorarios, sucumbenciais: comHonorarios },
    tipoCredito: comHonorarios ? 'Crédito principal + Honorários' : 'Crédito principal — apenas',
    parcelaNaoInformada: true,
  }
}

/** O que o chat ditou vence o card — e apaga o aviso de campo em branco. */
export function verbasDitadasNoChat(
  decisao: DecisaoDeVerbas,
  ditadas: VerbasNegociadas | null | undefined,
): DecisaoDeVerbas {
  if (!ditadas) return decisao
  return {
    ...decisao,
    verbas: ditadas,
    tipoCredito: rotuloDoCenario(ditadas) || decisao.tipoCredito,
    parcelaNaoInformada: false,
  }
}

/**
 * HÁ ALGUMA VERBA A NEGOCIAR?
 *
 * É a única coisa entre "o processo não tem o que este card manda comprar" e uma
 * planilha afirmando zero — que parece um resultado. O principal só conta pelo
 * que sobra depois das retenções e do honorário: bruto cheio com IR e honorário
 * que o consomem inteiro não é crédito, é uma conta que fecha em nada.
 */
export function temVerbaNegociavel(
  verbas: VerbasNegociadas,
  v: { bruto: number; ir: number; inss: number; contratuais: number; sucumbenciais: number },
): boolean {
  const n = (x: number) => Number(x) || 0
  const liquidoDoPrincipal = n(v.bruto) - n(v.ir) - n(v.inss) - n(v.contratuais)
  return (
    (!!verbas.principal && liquidoDoPrincipal > 0) ||
    (!!verbas.contratuais && n(v.contratuais) > 0) ||
    (!!verbas.sucumbenciais && n(v.sucumbenciais) > 0)
  )
}
