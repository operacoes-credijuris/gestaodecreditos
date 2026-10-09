// A "Situação" e a "Data da situação" da Fase processual (auditoria de bugs,
// 09/10/2026).
//
// A ação `definir_situacao` da função grava OS DOIS CAMPOS JUNTOS, e cada lado
// da tela mandava o valor do outro como estava no último carregamento. Digitar
// a data e escolher a situação logo em seguida (antes de a lista recarregar)
// mandava o segundo pedido com a data ANTIGA — e ele desfazia a data recém
// gravada. O mesmo valia ao contrário.
//
// A correção tem duas partes, na tela: (1) o pedido entra no cache na hora
// (`aplicarSituacao`), então o próximo pedido já parte do valor novo; (2) os
// pedidos vão em fila (`scope` do React Query), então um não chega ao servidor
// antes do anterior.

export interface PedidoDeSituacao {
  processo_id: string
  situacao_id: string | null
  situacao_data: string | null
}

/** As linhas com o pedido aplicado à do processo (as demais, intactas). */
export function aplicarSituacao<T extends PedidoDeSituacao>(linhas: readonly T[], pedido: PedidoDeSituacao): T[] {
  return linhas.map((l) =>
    l.processo_id === pedido.processo_id
      ? { ...l, situacao_id: pedido.situacao_id, situacao_data: pedido.situacao_data }
      : l,
  )
}

/**
 * O campo de data foi deixado PELA METADE? O `<input type="date">` devolve ''
 * tanto para o campo limpo de propósito quanto para "05/__/2026"; só o
 * `validity.badInput` do navegador separa os dois. Pela metade não grava (a
 * data que estava lá não pode virar null).
 */
export function dataIncompleta(valor: string, badInput: boolean | undefined): boolean {
  return valor === '' && !!badInput
}
