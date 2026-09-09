// O ANEXO É DESTE PROCESSO?
//
// POR QUE ESTA CONFERÊNCIA EXISTE. Anexo trocado de card produzia a análise
// COMPLETA do processo errado — com o número certo no nome do arquivo, porque o
// número do card sobrepõe o lido. Nada na tela denunciava: os valores eram
// plausíveis, o parecer era coerente, e o crédito precificado era outro.
//
// DUAS FONTES, E SÓ DUAS: O TÍTULO DO CARD E OS ARQUIVOS ANEXADOS.
//
// As duas versões anteriores erraram por olhar para outro lugar, e o erro foi o
// mesmo nas duas — leram um número que tinha passado por uma ANOTAÇÃO do Kommo:
//
//   1. A primeira comparava o card com o número que a LEITURA devolveu. E a
//      leitura recebe, no mesmo turno, o bloco [Anotações do card no Kommo], que
//      cita OUTROS processos do titular: é ali que a equipe registra as dívidas
//      apuradas na diligência e o motivo de uma reprovação. O modelo tomava um
//      desses números como "o processo destes autos".
//
//   2. A segunda comparava com o `numero_processo` do cadastro — que tem uma
//      cadeia de reservas (título, espelho do CRM, linha "PROCESSO:" da
//      anotação) e, faltando o número no título, acaba no que alguém escreveu
//      numa nota. Foi assim que um card cujo título diz
//      "…- 10063770820204013814" chegou aqui como sendo de outro processo, e a
//      análise morreu acusando anexo trocado com o anexo certo em mãos.
//
// Agora a identidade do processo sai do TÍTULO, que é o que o operador tem à
// vista quando lê a mensagem de erro — e o CNJ é inconfundível dentro dele.
// Anotações, mensagens, histórico e espelho do CRM ficam de fora POR
// CONSTRUÇÃO: não há por onde entrarem, e não depende de o modelo obedecer a
// uma instrução.
//
// E ISSO CONSERTA UM TERCEIRO DEFEITO, de graça: a comparação era par a par,
// então um card com dois anexos — os autos mais uma certidão de outro processo —
// podia bater no número errado. Pertencer ao CONJUNTO dos números dos anexos
// responde certo em qualquer combinação de arquivos.

// A leitura do número mora em nucleo/cnj.ts: era ela, escrita três vezes, que
// deixou o kommo-sync sem reconhecer o CNJ cru do título.
import { cnjsNoTexto, digitosDoCnj as soDigitos, mascaraCnj } from './nucleo/cnj.ts'
export { cnjsNoTexto, mascaraCnj }

export type ConfrontoDoAnexo =
  /** O número do título está nos anexos. */
  | { desfecho: 'ok'; cnjDoCard: string }
  /** Os anexos têm números de processo, e nenhum é o do título. */
  | { desfecho: 'trocado'; motivo: string }
  /** Não deu para conferir: falta o número no título, ou CNJ legível nos anexos. */
  | { desfecho: 'nao_confere'; aviso: string }

/**
 * Confronta o processo do TÍTULO do card com o dos arquivos anexados.
 *
 * `textoDosAnexos` é o texto dos ARQUIVOS, e só ele. `tituloDoCard` é o título
 * do card, e só ele. Passar aqui uma anotação do Kommo — ou um número que já
 * passou por uma — é o defeito que esta função existe para não repetir.
 *
 * `numeroLidoPelaLeitura` entra apenas para a MENSAGEM, para dizer a quem
 * confere que aquele número pode ter vindo das anotações. Ele não decide nada.
 */
export function confrontarAnexoComCard(o: {
  tituloDoCard: unknown
  textoDosAnexos: unknown
  numeroLidoPelaLeitura?: unknown
}): ConfrontoDoAnexo {
  // O PRIMEIRO CNJ DO TÍTULO. Havendo mais de um — o que seria cadastro
  // estranho —, o primeiro é o que o padrão do título põe na posição do número.
  const cnjCard = [...cnjsNoTexto(o.tituloDoCard)][0] ?? ''
  if (!cnjCard) {
    // SEM NÚMERO NO TÍTULO NÃO SE CONFERE NADA, e não se inventa uma fonte. A
    // reserva óbvia seria a linha "PROCESSO:" da anotação — e é exatamente ela
    // que já fez esta conferência barrar um card bom.
    return {
      desfecho: 'nao_confere',
      aviso:
        '⚠️ NÃO DEU PARA CONFERIR SE O ANEXO É DESTE PROCESSO: o título do card não traz o número do processo, ' +
        'e é ele a identidade do card — as anotações não servem, porque citam outros processos do titular. ' +
        'Escreva o número no título do card para esta conferência voltar a valer, e CONFIRA À MÃO que o anexo é deste crédito.',
    }
  }

  const nosAnexos = cnjsNoTexto(o.textoDosAnexos)
  if (nosAnexos.has(cnjCard)) return { desfecho: 'ok', cnjDoCard: cnjCard }

  if (nosAnexos.size > 0) {
    const outros = [...nosAnexos].slice(0, 3).map(mascaraCnj).join(', ')
    return {
      desfecho: 'trocado',
      motivo:
        `O título do card diz que o processo é ${mascaraCnj(cnjCard)}, e esse número não aparece em nenhum dos arquivos anexados. ` +
        `Os anexos são do processo ${outros}${nosAnexos.size > 3 ? ' (e outros)' : ''}. ` +
        'Anexo trocado de card, ou número errado no título? Confira os dois antes de rodar de novo.',
    }
  }

  // NENHUM CNJ NO TEXTO NÃO PROVA NADA: processo digitalizado tem o número só na
  // imagem, e é justamente nele que o texto vem vazio. A análise SEGUE — com o
  // aviso, porque a conferência que ela não pôde fazer é a que separa "o preço
  // deste crédito" de "o preço de outro".
  const cnjLido = soDigitos(o.numeroLidoPelaLeitura)
  return {
    desfecho: 'nao_confere',
    aviso:
      `⚠️ NÃO DEU PARA CONFERIR SE O ANEXO É DESTE PROCESSO: o número do título (${mascaraCnj(cnjCard)}) não foi encontrado ` +
      'no texto dos arquivos, e eles não trazem nenhum número em formato CNJ legível — o que acontece quando o processo é digitalizado. ' +
      (cnjLido.length === 20 && cnjLido !== cnjCard
        ? `A leitura apontou ${mascaraCnj(cnjLido)} como o processo dos autos, mas esse número pode ter vindo das anotações do card, que citam outros processos do titular. `
        : '') +
      'CONFIRA À MÃO que o anexo é deste crédito antes de fechar.',
  }
}
