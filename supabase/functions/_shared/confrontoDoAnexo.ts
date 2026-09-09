// O ANEXO É DESTE PROCESSO?
//
// POR QUE ESTA CONFERÊNCIA EXISTE. Anexo trocado de card produzia a análise
// COMPLETA do processo errado — com o número certo no nome do arquivo, porque o
// número do card sobrepõe o lido logo depois. Nada na tela denunciava: os
// valores eram plausíveis, o parecer era coerente, e o crédito precificado era
// outro.
//
// O QUE ESTAVA ERRADO NA PRIMEIRA VERSÃO. Ela comparava o número do card com o
// que a LEITURA devolveu — e a leitura recebe, no mesmo turno, o bloco
// [Anotações do card no Kommo], que cita OUTROS processos do titular: é ali que
// a equipe registra as dívidas apuradas na diligência e o motivo de uma
// reprovação. O modelo tomava um desses números como "o processo destes autos" e
// a análise morria com "anexo trocado de card" sobre um anexo que estava certo.
// Aconteceu em produção.
//
// A PERGUNTA CERTA É OUTRA: o número do card aparece nos ANEXOS? Só isso. Os
// CNJs são procurados no texto dos ARQUIVOS, e as anotações, mensagens e
// históricos do Kommo ficam de fora POR CONSTRUÇÃO — não por uma instrução ao
// modelo, que ele pode não seguir.
//
// E ISSO CONSERTA UM SEGUNDO DEFEITO, de graça: a comparação era par a par,
// então um card com dois anexos — os autos mais uma certidão de outro processo —
// podia bater no número errado. Pertencer ao CONJUNTO dos números dos anexos
// responde certo em qualquer combinação de arquivos.

/** Só os dígitos: a máscara varia por tribunal, o número não. */
const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** 20 dígitos de volta à forma que se lê: 1006377-08.2020.4.01.3814. */
export function mascaraCnj(digitos: string): string {
  return digitos.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')
}

/**
 * Os números de processo em formato CNJ que aparecem num texto.
 *
 * Com máscara ou sem, e com os separadores que cada tribunal usa — há autos que
 * escrevem "1006377-08.2020.4.01.3814", outros "1006377 08 2020 4 01 3814" e
 * outros os vinte dígitos colados.
 */
export function cnjsNoTexto(texto: unknown): Set<string> {
  const achados = String(texto ?? '')
    .match(/\d{7}[\s.\-]?\d{2}[\s.\-]?\d{4}[\s.\-]?\d[\s.\-]?\d{2}[\s.\-]?\d{4}/g) ?? []
  return new Set(achados.map(soDigitos).filter((d) => d.length === 20))
}

export type ConfrontoDoAnexo =
  /** O número do card está nos anexos (ou não há número de card para conferir). */
  | { desfecho: 'ok' }
  /** Os anexos têm números de processo, e nenhum é o do card. */
  | { desfecho: 'trocado'; motivo: string }
  /** Não há CNJ legível nos anexos: não se pode afirmar nem negar. */
  | { desfecho: 'nao_confere'; aviso: string }

/**
 * Confronta o processo do título do card com o dos arquivos anexados.
 *
 * `textoDosAnexos` é o texto dos ARQUIVOS, e só ele. Passar aqui as anotações do
 * Kommo é o defeito que esta função existe para não repetir.
 *
 * `numeroLidoPelaLeitura` entra apenas para a MENSAGEM — para dizer a quem
 * confere que aquele número pode ter vindo das anotações. Ele não decide nada.
 */
export function confrontarAnexoComCard(o: {
  numeroDoCard: unknown
  textoDosAnexos: unknown
  numeroLidoPelaLeitura?: unknown
}): ConfrontoDoAnexo {
  const cnjCard = soDigitos(o.numeroDoCard)
  // Sem número no card não há o que conferir — e o card sem número já tem aviso
  // próprio, na lista de pendentes.
  if (cnjCard.length !== 20) return { desfecho: 'ok' }

  const nosAnexos = cnjsNoTexto(o.textoDosAnexos)
  if (nosAnexos.has(cnjCard)) return { desfecho: 'ok' }

  if (nosAnexos.size > 0) {
    const outros = [...nosAnexos].slice(0, 3).map(mascaraCnj).join(', ')
    return {
      desfecho: 'trocado',
      motivo:
        `O card é do processo ${mascaraCnj(cnjCard)}, e esse número não aparece em nenhum dos arquivos anexados. ` +
        `Os anexos são do processo ${outros}${nosAnexos.size > 3 ? ' (e outros)' : ''}. ` +
        'Anexo trocado de card? Confira o arquivo e o título do card antes de rodar de novo.',
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
      `⚠️ NÃO DEU PARA CONFERIR SE O ANEXO É DESTE PROCESSO: o número do card (${mascaraCnj(cnjCard)}) não foi encontrado ` +
      'no texto dos arquivos, e eles não trazem nenhum número em formato CNJ legível — o que acontece quando o processo é digitalizado. ' +
      (cnjLido.length === 20 && cnjLido !== cnjCard
        ? `A leitura apontou ${mascaraCnj(cnjLido)} como o processo dos autos, mas esse número pode ter vindo das anotações do card, que citam outros processos do titular. `
        : '') +
      'CONFIRA À MÃO que o anexo é deste crédito antes de fechar.',
  }
}
